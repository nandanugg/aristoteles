import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { Effect, Result, Schema } from 'effect'
import { openPageProject, receiveProjectPayload } from '../../../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot, projectSubmission } from '../../../../adapters/web/project.ts'
import { open, ownerInput, session, staffInput, withJournal } from '../../../../src/store/project.probe.ts'
import { ownerAuthority } from '../../../../src/store/question.probe.ts'
import { cliProposal, evidence } from '../../../../src/store/proposal.probe.ts'
import { artifactQuote, begin, commandOutcomes, promptDirection, reportReview, resultInput, taskKey, taskLine, toWorking } from '../../../../src/store/task.probe.ts'
import { Authority, RetryLimit } from '../../../actions/project.ts'
import { assignProposalReview } from '../../../actions/proposal.ts'
import { observeSession, startChild } from '../../../actions/staff-session.ts'
import { Direction, GuidanceText, ModelName, ProposalKey, Rationale, ReadPosition, RetryLimit as Limit, StaffingPlan, takeAsIsEligibility, type Project, type TaskPhase } from '../../../schema/project.ts'
import type { Journal } from '../../../services/project.ts'
import { fold } from '../../../state/project.ts'
import { nextStep } from '../next-step.ts'
import { integer, readTrace, record } from './driver.ts'
import { picked } from './itf.probe.ts'

const check = 'fixOwnerChoice'
const origin = ReadPosition.make(0)
const proposalLine = { line: 'Proposal', key: ProposalKey.make('proposal:fix') } as const
const byPipeline = { _tag: 'Staff', session } as const
const why = Rationale.make('The review evidence identifies the cause.')
const fixDirection = (revision: number) => Direction.make({
  ...promptDirection,
  standards: promptDirection.standards.map((standard) => ({ ...standard,
    rules: standard.rules.map((rule) => ({ ...rule, text: GuidanceText.make('Use a clear result. Revision ' + revision) })),
  })),
})
const fixStaffing = (project: Project) => {
  if (project.staffing._tag !== 'StaffingAccepted') throw new Error('Expected accepted staffing')
  const plan = project.staffing.version.value
  const staff = new Map([...plan.staff].map(([key, row]) => [key, { ...row, model: ModelName.make('stronger-model') }]))
  return { _tag: 'Staffing', ...Schema.encodeSync(StaffingPlan)({ staff, subscriptions: plan.subscriptions }) } as const
}

const raiseAfterReview = (journal: Journal, project: Project) => Effect.gen(function* () {
  const task = project.tasks.get(taskKey)
  if (task?.phase._tag !== 'Working') throw new Error('Expected an active attempt')
  const reported = yield* staffInput(journal, resultInput(project.read, 7, task.phase.attempt.number))
  const { state: queued } = yield* commandOutcomes(journal, reported.state.read)
  const { state: assigned } = yield* startChild(journal, queued, taskKey, session, 'Review')
  return (yield* reportReview(journal, assigned, 'Breaks').pipe(
    Effect.provideService(RetryLimit, Limit.make(0)),
  )).state
})
const assess = (journal: Journal, read: Project['read'], missed: 'Staff' | 'Guidance' | 'MovingTarget') =>
  staffInput(journal, { ...taskLine, move: 'assess', read, input: { missed, why } })
const taskMove = (journal: Journal, project: Project, move: 'takeAsIs' | 'drop', owner: boolean) => {
  const input = { ...taskLine, move, read: project.read, input: { why } }
  return owner ? ownerInput(journal, input) : staffInput(journal, input)
}
const reviewFix = (journal: Journal, project: Project) => Effect.gen(function* () {
  const draft = project.proposals.get(proposalLine.key)
  const live = project.sessions.get(session.key)
  if (!draft || live?._tag !== 'Live') throw new Error('Missing fix review duty')
  const { state } = yield* assignProposalReview(journal, draft, live, project.read)
  const reviewed = yield* cliProposal(journal, state, { ...proposalLine, move: 'review', input: { facts: evidence('Holds', draft.value._tag) } },
    { _tag: 'Review', session: live, ...proposalLine, queuedIn: draft.changedIn })
  return reviewed.state
})

for (const kind of ['success', 'fault', 'mutant'] as const) test('Raised fix owner choice and retry bound — ' + kind, () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const trace = readTrace(join(import.meta.dir, 'traces', check + '-' + kind + '.itf.json.gz'), check, kind)
    const journal = yield* open(path)
    const { state: working } = yield* toWorking(journal, promptDirection)
    expect(trace.states[0]!.state.retained).toBe(true)
    let state = yield* raiseAfterReview(journal, working)
    const response = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => response.json()), () => {}))
    const beforeProposal = state.read
    let firstReview = beforeProposal
    let blocked = false
    for (const step of trace.states.slice(1)) {
      const before = state
      const actor = picked(step.picks.actor)
      switch (step.action) {
        case '': break
        case 'assess': {
          const missed = picked(step.picks.missed)
          const live = state.sessions.get(session.key)
          if (live?._tag !== 'Live') throw new Error('Expected pipeline authority')
          expect(nextStep(state, live, yield* journal.eventsAfter(origin), state.read)).toMatchObject({ for: 'Assess' })
          state = (yield* assess(journal, state.read, missed === 'StaffMiss' ? 'Staff' : missed === 'MovingTarget' ? 'MovingTarget' : 'Guidance')).state
          break
        }
        case 'submitFirst': {
          const task = state.tasks.get(taskKey)
          const value = task?.phase._tag === 'Raised' && task.phase.fix._tag === 'Assessed' &&
            task.phase.fix.assessment.missed !== 'Guidance' ? fixStaffing(state) : fixDirection(1)
          const committed = yield* cliProposal(journal, state, {
            ...proposalLine, move: 'submit', input: { subject: { _tag: 'Fix', task: taskKey }, value },
          }, byPipeline)
          expect(committed.following).toEqual([])
          expect(committed.state.tasks.get(taskKey)).toEqual(task)
          state = committed.state
          break
        }
        case 'review': {
          state = yield* reviewFix(journal, state)
          if (firstReview === beforeProposal) firstReview = state.read
          break
        }
        case 'sendBack':
          state = (yield* cliProposal(journal, state, { ...proposalLine, move: 'sendBack', input: { why } })).state
          break
        case 'resubmit': {
          const input = { ...proposalLine, move: 'submit', input: { value: fixDirection(2) } }
          expect(Result.getOrThrow(Result.flip(yield* Effect.result(cliProposal(journal, state, input, byPipeline)))).code).toBe('Stale')
          state = (yield* assess(journal, state.read, 'Guidance')).state
          state = (yield* cliProposal(journal, state, input, byPipeline)).state
          break
        }
        case 'accept': {
          const request = { ...proposalLine, move: 'accept', input: {} }
          const accepted = typeof step.state.proposal === 'object' && record(step.state.proposal!).tag === 'Accepted'
          const read = integer(picked(step.picks.read)) === 1 ? firstReview : state.read
          if (accepted) {
            const stale = yield* Effect.result(ownerInput(journal, { ...request, read: firstReview }))
            expect(Result.getOrThrow(Result.flip(stale)).code).toBe('Stale')
            expect(yield* journal.eventsAfter(before.read)).toEqual([])
          }
          const result = yield* Effect.result(actor === 9 ? ownerInput(journal, { ...request, read }) : staffInput(journal, { ...request, read }))
          if (!accepted) {
            expect(result._tag).toBe('Failure')
            expect(yield* journal.eventsAfter(before.read)).toEqual([])
          } else {
            const committed = Result.getOrThrow(result)
            expect(committed.following.map(({ move }) => move)).toEqual(['applyFix'])
            state = committed.state
          }
          break
        }
        case 'takeAsIs':
        case 'drop': {
          const result = yield* Effect.result(taskMove(journal, state, step.action, actor === 9))
          expect(Result.getOrThrow(Result.flip(result)).code).toBe('WrongActor')
          break
        }
        case 'tryAgain': {
          const result = yield* Effect.result(staffInput(journal, { ...taskLine, move: 'tryAgain', input: {}, read: state.read }))
          const retries = integer(step.state.retries)
          if (state.tasks.get(taskKey)?.automaticRetry === 'Used') {
            expect(Result.getOrThrow(Result.flip(result)).code).toBe('WrongMove')
            expect(yield* journal.eventsAfter(before.read)).toEqual([])
            blocked = retries > 1
          } else state = Result.getOrThrow(result).state
          break
        }
        case 'raiseAgain': {
          const { state: working } = yield* begin(journal, state.read)
          expect(working.tasks.get(taskKey)?.phase).toMatchObject({
            _tag: 'Working', attempt: { number: 2, feedback: { _tag: 'Review' } },
          })
          state = yield* raiseAfterReview(journal, working)
          break
        }
        default: throw new Error('Unexpected fix witness action: ' + step.action)
      }
      const events = yield* projectEvents(journal, ReadPosition.make(page.current()?.read ?? 0))
      expect(Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => events.json())))).toEqual(state)
      expect(Result.getOrThrow(fold(yield* journal.eventsAfter(origin)))).toEqual(state)
      if (blocked) break
      const task = state.tasks.get(taskKey)
      expect(task?.phase._tag).toBe(step.state.phase === 'SentAgain' ? 'Sent' : 'Raised')
      expect(task?.automaticRetry).toBe(integer(step.state.retries) === 0 ? 'Available' : 'Used')
      const expected = step.state.proposal === 'Removed' ? undefined : String(record(step.state.proposal!).tag).replace('ProposalReview', 'Reviewing')
      expect<unknown>(state.proposals.get(proposalLine.key)?.phase._tag).toBe(expected)
    }
    expect(blocked).toBe(kind === 'mutant')
    if (kind === 'success') {
      expect(state.tasks.get(taskKey)?.direction).toMatchObject({ number: 2, value: fixDirection(2) })
      const duplicate = yield* Effect.result(ownerInput(journal, { ...proposalLine, move: 'accept', input: {}, read: state.read }))
      expect(duplicate._tag).toBe('Failure')
    }
    if (kind === 'fault') {
      const accept = () => ownerInput(journal, { ...proposalLine, move: 'accept', input: {}, read: state.read })
      expect(Result.getOrThrow(Result.flip(yield* Effect.result(accept()))).code).toBe('InvalidInput')
      state = (yield* observeSession(journal, state, session.key, 'Ended')).state
      const accepted = yield* accept()
      expect(accepted.following.map(({ move }) => move)).toEqual(['apply', 'applyFix'])
      expect(accepted.state.tasks.get(taskKey)).toMatchObject({
        retryCount: 0, automaticRetry: 'Used', phase: { _tag: 'Sent', feedback: { _tag: 'Review' } },
      })
    }
  })))))

test('task closure and pending fix withdrawal share one append', () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const { state: working } = yield* toWorking(journal, promptDirection)
    const raised = yield* raiseAfterReview(journal, working)
    const { state: assessed } = yield* assess(journal, raised.read, 'Guidance')
    const proposed = (value: unknown) => cliProposal(journal, assessed, {
      ...proposalLine, move: 'submit', input: { subject: { _tag: 'Fix', task: taskKey }, value },
    }, byPipeline)
    const wrongKind = yield* Effect.result(proposed(fixStaffing(assessed)))
    expect(Result.getOrThrow(Result.flip(wrongKind)).code).toBe('WrongMove')
    const wrongTier = yield* Effect.result(proposed({ ...fixDirection(1), text: 'Changed the whole direction.' }))
    expect(Result.getOrThrow(Result.flip(wrongTier)).code).toBe('InvalidInput')
    expect(yield* journal.eventsAfter(assessed.read)).toEqual([])
    const { state: submitted } = yield* cliProposal(journal, assessed, {
      ...proposalLine, move: 'submit', input: { subject: { _tag: 'Fix', task: taskKey }, value: fixDirection(1) },
    }, byPipeline)
    const reviewed = yield* reviewFix(journal, submitted)
    const write = (sql: string) => Effect.sync(() => {
      const db = new Database(path)
      try { db.exec(sql) } finally { db.close() }
    })
    yield* write(`CREATE TRIGGER fail_withdrawal BEFORE INSERT ON project_event WHEN NEW.number = ${reviewed.read + 2}
      BEGIN SELECT RAISE(ABORT, 'test interrupted append'); END`)
    expect(Result.getOrThrow(Result.flip(yield* Effect.result(taskMove(journal, reviewed, 'drop', true)))).code).toBe('Unavailable')
    expect(yield* journal.eventsAfter(reviewed.read)).toEqual([])
    yield* write('DROP TRIGGER fail_withdrawal')
    const dropped = yield* taskMove(journal, reviewed, 'drop', true)
    expect(dropped.following.map(({ move }) => move)).toEqual(['remove'])
    expect(dropped.state.tasks.get(taskKey)?.phase).toEqual({ _tag: 'Dropped', why })
    expect(dropped.state.proposals.get(proposalLine.key)?.phase).toEqual({ _tag: 'Removed' })
  })))))

for (const retained of [false, true]) test('page take as is requires an actual finished result — ' + retained, () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const { state: working } = yield* toWorking(journal, promptDirection)
    const state = retained ? yield* raiseAfterReview(journal, working)
      : (yield* staffInput(journal, { ...taskLine, move: 'raise', read: working.read,
        input: { attempt: 1, reason: 'WrongTask', evidence: [artifactQuote] },
      })).state
    const request = new Request('http://localhost/api/project/submissions', { method: 'POST',
      body: JSON.stringify({ ...taskLine, move: 'takeAsIs', read: state.read, input: { why } }) })
    const response = yield* projectSubmission(journal, request).pipe(
      Effect.provideService(Authority, { actor: Effect.succeed(ownerAuthority) }),
    )
    expect(response.status).toBe(retained ? 200 : 409)
    const events = yield* journal.eventsAfter(state.read)
    expect(events).toHaveLength(retained ? 1 : 0)
    const current = Result.getOrThrow(fold(events, state))
    expect(current?.tasks.get(taskKey)?.phase).toMatchObject(retained
      ? { _tag: 'Done', accepted: { _tag: 'Owner', why }, result: { summary: 'Result' } }
      : { _tag: 'Raised', retained: { _tag: 'NoResult' } })
  })))))


test('a moving-target reassessment leaves the policy with the app and keeps the owner choice', () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const { state: working } = yield* toWorking(journal, promptDirection)
    const raised = yield* raiseAfterReview(journal, working)
    const phase = raised.tasks.get(taskKey)?.phase
    if (phase?._tag !== 'Raised') throw new Error('Expected raised evidence')
    const reasons: readonly (readonly [Extract<TaskPhase, { _tag: 'Raised' }>['reason'], 'Allowed' | 'WrongMove'])[] = [
      ['Tries', 'Allowed'], ['Misses', 'Allowed'], ['NoRule', 'Allowed'], ['ContractWrong', 'Allowed'],
      ['TooBig', 'WrongMove'], ['WrongTask', 'WrongMove'], ['RejectedByHuman', 'WrongMove'],
    ]
    for (const [reason, expected] of reasons) {
      expect(takeAsIsEligibility({ ...phase, reason })).toBe(expected)
      expect(takeAsIsEligibility({ ...phase, reason, retained: { _tag: 'NoResult' } })).toBe('WrongMove')
    }
    const { state: assessed } = yield* assess(journal, raised.read, 'Guidance')
    const { state: submitted } = yield* cliProposal(journal, assessed, {
      ...proposalLine, move: 'submit', input: { subject: { _tag: 'Fix', task: taskKey }, value: fixDirection(1) },
    }, byPipeline)
    const reviewed = yield* reviewFix(journal, submitted)
    const { state: returned } = yield* cliProposal(journal, reviewed, { ...proposalLine, move: 'sendBack', input: { why } })
    const reassessed = yield* assess(journal, returned.read, 'MovingTarget')
    expect(reassessed.following.map(({ move }) => move)).toEqual(['remove'])
    expect(reassessed.state.proposals.get(proposalLine.key)?.phase._tag).toBe('Removed')
    expect(reassessed.state.tasks.get(taskKey)?.phase).toMatchObject({
      _tag: 'Raised', fix: { _tag: 'Assessed', assessment: { missed: 'MovingTarget', why } },
    })
    const accepted = yield* taskMove(journal, reassessed.state, 'takeAsIs', true)
    expect(accepted.state.tasks.get(taskKey)?.phase).toMatchObject({ _tag: 'Done', accepted: { _tag: 'Owner', why } })
  })))))
