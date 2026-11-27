import { Effect, Schema } from 'effect'
import { Authority, submit } from '../../core/actions/project.ts'
import { assignProposalReview } from '../../core/actions/proposal.ts'
import { observeSession, readOpenProject } from '../../core/actions/staff-session.ts'
import { recordTaskCommands, sendTask } from '../../core/actions/task.ts'
import { hostRole, staffedIn,
  ApprovedFiles, Direction, rolesOf, ProposalKey, StaffSessionKey, Submission, TaskDraft, TaskKey, staffOf,
  type Of, type Project, type ReadPosition,
} from '../../core/schema/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { startWork } from './project-activation.probe.ts'
import { startSession, create, host, ownerInput, pipeline, session, staff, staffInput, subscription, startFixtureSession } from './project.probe.ts'
import { acceptStaffing, cliProposal, direction, evidence } from './proposal.probe.ts'

export const taskKey = TaskKey.make('task:sample')
export const taskLine = { line: 'Task', key: taskKey } as const
export const boundHost = session.key

export const acceptDirection = (journal: Journal, project: Project, value: Direction, previous?: Of<typeof TaskDraft>['direction']) => Effect.gen(function* () {
  const assigned = staffOf(project, hostRole(project).key)!
  const existing = [...project.sessions.values()].find((value) => value._tag === 'Live' && value.staff.key === assigned.key)
  const key = existing?.key ?? StaffSessionKey.make('session:direction-' + project.read)
  const current = existing ? project : (yield* startSession(journal, project, {
    key, staff: assigned.key, pane: session.pane, staffedIn: staffedIn(project),
  })).state
  const active = current.sessions.get(key)
  if (active?._tag !== 'Live') throw new Error('Missing direction review session')
  const proposalKey = ProposalKey.make('proposal:direction-' + project.read)
  const line = { line: 'Proposal', key: proposalKey } as const
  const drafted = yield* cliProposal(journal, current, { line: 'Proposal', key: proposalKey, move: 'open', input: { value, previous: previous ? { _tag: 'Version', version: previous } : { _tag: 'None' } } })
  const submitted = yield* cliProposal(journal, drafted.state, { ...line, move: 'submit', input: { value } })
  const proposal = submitted.state.proposals.get(proposalKey)
  if (!proposal) throw new Error('Missing direction to approve')
  const reviewing = yield* assignProposalReview(journal, proposal, active, submitted.state.read)
  const reviewed = yield* cliProposal(journal, reviewing.state, { ...line, move: 'review', input: { facts: evidence('Holds') } },
    { _tag: 'Review', session: active, ...line, queuedIn: proposal.changedIn })
  const accepted = yield* cliProposal(journal, reviewed.state, { ...line, move: 'accept', input: {} })
  return existing ? accepted.state : (yield* observeSession(journal, accepted.state, key, 'Ended')).state
})

const files = Schema.decodeUnknownSync(ApprovedFiles)([{ path: 'AGENTS.md', hash: 'a'.repeat(64), before: 'Unmarked' }])
export const activateTasks = (journal: Journal, project: Project, value?: Direction) => Effect.gen(function* () {
  const staffed = project.staffing._tag === 'StaffingAccepted' ? project : yield* acceptStaffing(journal, project,
    { staff: new Map([[staff.key, staff]]), subscriptions: new Map([[subscription.key, subscription]]) })
  const selected = value ?? Schema.decodeUnknownSync(Direction)({
    ...direction, standards: [], stages: rolesOf(staffed).map((role) => ({
      ...direction.stages[0], role: role.key,
    })),
  })
  const ready = yield* acceptDirection(journal, staffed, selected)
  const line = { line: 'Project' } as const
  const authorized = yield* ownerInput(journal, { read: ready.read, ...line, move: 'next', input: { files } })
  const assigned = staffOf(authorized.state, hostRole(authorized.state).key)!
  return (yield* startSession(journal, authorized.state, {
    key: boundHost, staff: assigned.key, pane: session.pane, staffedIn: staffedIn(authorized.state),
  })).state
})

export const draftFor = (project: Project, key = taskKey, role = host, reviewer = pipeline) => {
  const accepted = [...project.proposals.values()].findLast(({ phase }) => phase._tag === 'Accepted' && phase.version.value._tag === 'Direction')
  if (accepted?.phase._tag !== 'Accepted' || accepted.phase.version.value._tag !== 'Direction') throw new Error('Missing task direction')
  const { value } = accepted.phase.version
  return Schema.decodeUnknownSync(Schema.Struct({ key: TaskKey, ...TaskDraft.fields }))({
    key, name: 'First work', goal: 'Supply a result', reviewer: reviewer.key,
    direction: accepted.phase.version, stages: value.stages.filter((stage) => stage.role === role.key), facts: [],
  })
}

export const send = (journal: Journal, read: Of<typeof ReadPosition>, key = taskKey, role = host, reviewer = pipeline) => Effect.gen(function* () {
  const project = yield* readOpenProject(journal)
  const { key: task, ...draft } = draftFor(project, key, role, reviewer)
  return yield* sendTask(journal, task, read, draft).pipe(Effect.provideService(Authority, {
    actor: Effect.succeed({ _tag: 'Host', session } as const),
  }))
})
export const begin = (journal: Journal, read: Of<typeof ReadPosition>) => staffInput(journal, { read, ...taskLine, move: 'next', input: {} })
export const resultInput = (read: Of<typeof ReadPosition>, artifact = 7, attempt = 1): Submission =>
  Schema.decodeUnknownSync(Submission, { onExcessProperty: 'error' })({ read, ...taskLine, move: 'next', input: { attempt, summary: 'Result', files: [{ path: 'artifact', image: { _tag: 'Present', contents: String(artifact) }, changed: [{ first: 1, last: 1 }] }] } })
export const commandOutcomes = (journal: Journal, read: Of<typeof ReadPosition>) => recordTaskCommands(journal, taskLine.key, read, [])

export const toWorking = (journal: Journal, value?: Direction) => Effect.gen(function* () {
  const opened = yield* create(journal)
  const active = yield* activateTasks(journal, opened.state, value)
  const { state } = yield* startWork(journal, active)
  const live = yield* startFixtureSession(journal, state)
  const sent = yield* send(journal, live.state.read)
  return yield* begin(journal, sent.state.read)
})

export const promptDirection = Schema.decodeUnknownSync(Direction)({
  ...direction, standards: direction.standards.map((standard) => ({ ...standard, rules: [{
    _tag: 'Rule', name: 'Readable result', text: 'Use clear wording.',
    verification: { _tag: 'Prompt', question: 'Is the result clear?',
      source: { _tag: 'Quote', file: 'artifact', lines: { first: 1, last: 1 }, text: '7' } },
    knownBreaks: [], examples: { holds: [{ _tag: 'MadeUp', text: 'Use a clear result.' }], breaks: [{ _tag: 'MadeUp', text: 'Done, details omitted.' }] },
  }] })),
})
export const artifactQuote = { _tag: 'Quote', file: 'artifact', lines: { first: 1, last: 1 }, text: '7' } as const

export const reviewAs = (project: Project, line = taskLine, live = session) => {
  const phase = project.tasks.get(line.key)?.phase
  if (phase?._tag !== 'Reviewing' || phase.assignment._tag !== 'Assigned') throw new Error('Missing task review assignment')
  return { _tag: 'Review', ...line, session: live, queuedIn: phase.assignment.queuedIn } as const
}

export const reportReview = (
  journal: Journal, project: Project, holds: 'Holds' | 'Breaks', line = taskLine, actor = reviewAs(project, line),
) => submit(journal, { read: project.read, ...line, move: 'review', input: { facts: {
  outcomes: [{ _tag: holds, rule: promptDirection.standards[0]!.rules[0]!, evidence: artifactQuote }], findings: [],
} } }).pipe(Effect.provideService(Authority, { actor: Effect.succeed(actor) }))
