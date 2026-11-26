import { Context, DateTime, Effect, Result, Schema } from 'effect'
import {
  ReadPosition, Rationale, StoredEvent, Submission, liveSession, refuse, reviewOutcome,
  type EventNumber, type LiveSession, type Of, type Projection, type Refusal, type StoredActor,
} from '../schema/project.ts'
import type { Committed, Journal, Write } from '../services/project.ts'
import { applyEvent, fold, readPosition } from '../state/project.ts'

export type AuthenticatedActor =
  | { readonly _tag: 'Human'; readonly actor: Extract<StoredActor, { _tag: 'Human' }> }
  | { readonly _tag: 'Staff'; readonly session: LiveSession }
  | { readonly _tag: 'Review'; readonly session: LiveSession; readonly review: Of<typeof EventNumber> }
export class Authority extends Context.Service<Authority, {
  readonly actor: Effect.Effect<AuthenticatedActor, Refusal>
}>()('project/Authority') {}

type Moves = {
  [Event in StoredEvent as `${Event['line']['_tag']}:${Event['from']}:${Event['move']}`]:
    Pick<Event, 'line' | 'from' | 'move' | 'input'>
}
type MoveInput = Moves[keyof Moves]
type BuildMove = (state: Projection) => Result.Result<MoveInput, Refusal>

const commit = (
  journal: Journal, actor: StoredActor, read: Of<typeof ReadPosition>, build: BuildMove,
): Effect.Effect<Committed, Refusal> => Effect.gen(function* () {
  const at = yield* DateTime.now
  const edit: Write = (events, number) => Result.flatMap(fold(events), (state) => {
    if (read > readPosition(state)) return Result.fail(refuse('Stale', Rationale.make('That read is ahead of the journal.')))
    return Result.flatMap(build(state), (move) => {
      const entry = { number, actor, read, at, ...move }
      if (!Schema.is(StoredEvent)(entry)) {
        return Result.fail(refuse('WrongMove', Rationale.make('The stored input must match the move on its line.')))
      }
      return Result.map(applyEvent(state, entry), (updated) => ({ event: entry, state: updated }))
    })
  })
  return yield* journal.transact(edit)
})

const wrongActor = () => refuse('WrongActor', Rationale.make('Use the input for your authenticated actor.'))
const retired = () => refuse('RetiredSession', Rationale.make('Report from the attempt’s live session.'))
const readSubmission = Schema.decodeUnknownEffect(Submission, { onExcessProperty: 'error' })

type QuestionMove = Extract<MoveInput, { line: { _tag: 'Question' } }>
type QuestionSubmission =
  Extract<Extract<Submission, { _tag: 'HumanChoice' }>['choice'], { _tag: 'Question' | 'Answer' }>
const questionMove = (input: QuestionSubmission): QuestionMove => {
  if (input._tag === 'Answer') return { line: input.line, from: 'Open', move: 'answer', input: { answer: input.answer } }
  const { id, ...fields } = input.question
  return { line: { _tag: 'Question', id }, from: null, move: 'next', input: fields }
}
type ProposalMove = Extract<MoveInput, { line: { _tag: 'Proposal' } }>
type ProposalSubmission = Extract<Extract<Submission, { _tag: 'HumanChoice' }>['choice'],
  { _tag: 'Proposal' | 'SubmitProposal' | 'ChooseProposal' }>
const proposalMove = (input: ProposalSubmission): ProposalMove => {
  switch (input._tag) {
    case 'Proposal': return { line: { _tag: 'Proposal', id: input.id }, from: null, move: 'next', input: { value: input.value } }
    case 'SubmitProposal': return { line: input.line, from: 'Drafting', move: 'submit', input: { value: input.value, question: input.question } }
    case 'ChooseProposal': {
      const { choice, line } = input
      if (choice._tag === 'sendBack') return { line, from: 'WaitingForOwner', move: 'sendBack', input: { why: choice.why } }
      return { line, from: 'WaitingForOwner', move: choice._tag, input: {} }
    }
  }
}
export const submit = (journal: Journal, input: unknown): Effect.Effect<Committed, Refusal, Authority> =>
  Effect.gen(function* () {
    const request = yield* Effect.mapError(readSubmission(input), () =>
      refuse('InvalidInput', Rationale.make('The submission does not match the checked input.')))
    const authority = yield* Authority
    const authenticated = yield* authority.actor
    if (request._tag === 'HumanChoice') {
      if (authenticated._tag !== 'Human') return yield* Effect.fail(wrongActor())
      const { choice } = request
      if (choice._tag === 'Question' || choice._tag === 'Answer')
        return yield* commit(journal, authenticated.actor, request.read, () => Result.succeed(questionMove(choice)))
      if (choice._tag === 'Proposal' || choice._tag === 'SubmitProposal' || choice._tag === 'ChooseProposal')
        return yield* commit(journal, authenticated.actor, request.read, () => Result.succeed(proposalMove(choice)))
      const address = choice._tag === 'NewProject' ? choice.project : choice.line
      if (address.id !== journal.id) {
        return yield* Effect.fail(refuse('InvalidInput', Rationale.make('The choice addresses a different project.')))
      }
      return yield* commit(journal, authenticated.actor, request.read, () => {
        if (choice._tag === 'EndProject')
          return Result.succeed({ line: choice.line, from: 'Open', move: 'end', input: {} })
        const { project, owner, host, pipeline, staff, roles } = choice
        return Result.succeed({ line: project, from: null, move: 'next', input: { owner, host, pipeline, staff, roles } })
      })
    }
    const report = request.report
    if (report._tag === 'Review') {
      if (authenticated._tag !== 'Review') return yield* Effect.fail(wrongActor())
      const { session, review } = authenticated
      const actor = { _tag: 'Staff', id: session.staff.id } as const
      const { line, facts } = report
      return yield* commit(journal, actor, request.read, (project) => {
        const proposal = project?.proposals.get(line.id)
        if (proposal?.phase._tag !== 'Reviewing' || proposal.phase.by?.id !== session.staff.id ||
            proposal.phase.review !== review || !project || !liveSession(project, session.id)) return Result.fail(retired())
        return Result.succeed(reviewOutcome(facts) === 'Holds'
          ? { line, from: 'Reviewing', move: 'next', input: { session, review, facts } }
          : { line, from: 'Reviewing', move: 'sendBack', input: { session, review, facts } })
      })
    }
    if (authenticated._tag !== 'Staff') return yield* Effect.fail(wrongActor())
    const { session } = authenticated
    const actor: StoredActor = { _tag: 'Staff', id: session.staff.id }
    return yield* commit(journal, actor, request.read, (project) => {
      if (project?.status._tag !== 'Open') return Result.fail(retired())
      const current = liveSession(project, session.id)
      if (!current || current.staff.id !== session.staff.id) return Result.fail(retired())
      if (report._tag === 'Proposal' || report._tag === 'SubmitProposal')
        return Result.succeed(proposalMove(report))
      if (report._tag !== 'Work') return Result.succeed(questionMove(report))
      const { line, report: result } = report
      if (result === null) return Result.succeed({
        line, from: 'Sent', move: 'next', input: { session: current, staffing: project.staffingAt, place: 'Main' },
      })
      const task = project.tasks.get(line.id)
      if (task?.phase._tag === 'Working' && task.phase.attempt.session.id !== session.id) return Result.fail(retired())
      return Result.succeed({ line, from: 'Working', move: 'next', input: result })
    })
  })

// The provider and other engine ports record the input of a specific line move.
export const recordObserved = (
  journal: Journal, actor: StoredActor, read: Of<typeof ReadPosition>, move: MoveInput,
): Effect.Effect<Committed, Refusal> => commit(journal, actor, read, () => Result.succeed(move))
