import { Effect, Schema } from 'effect'
import { observeActivation } from '../../core/actions/project-activation.ts'
import { Authority } from '../../core/actions/project.ts'
import { assignProposalReview } from '../../core/actions/proposal.ts'
import { observeSession, readOpenProject, startSession } from '../../core/actions/staff-session.ts'
import { recordTaskCommands, sendTask } from '../../core/actions/task.ts'
import { staffingAt,
  ApprovedFiles, Direction, rolesOf, ProposalId, SessionId, StaffingId, Submission, TaskDraft, TaskId, staffOf,
  type Of, type Project, type ReadPosition,
} from '../../core/schema/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { startWork } from './project-activation.probe.ts'
import { create, host, ownerInput, pipeline, session, staff, staffInput, startFixtureSession } from './project.probe.ts'
import { acceptStaffing, cliProposal, direction, evidence } from './proposal.probe.ts'

export const taskId = TaskId.make('task:sample')
export const taskLine = { _tag: 'Task', id: taskId } as const
export const boundHost = SessionId.make('session:' + '1'.repeat(32))

export const acceptDirection = (journal: Journal, project: Project, value: Direction) => Effect.gen(function* () {
  const assigned = staffOf(project, project.roles.host)!
  const existing = [...project.sessions.values()].find((value) => value._tag === 'Live' && value.staff.id === assigned.id)
  const id = existing?.id ?? SessionId.make('session:direction-' + project.read)
  const current = existing ? project : (yield* startSession(journal, project, {
    id, staff: assigned.id, pane: session.pane, staffing: staffingAt(project),
  })).state
  const active = current.sessions.get(id)
  if (active?._tag !== 'Live') throw new Error('Missing direction review session')
  const proposalId = ProposalId.make('proposal:direction-' + project.read)
  const line = { _tag: 'Proposal', id: proposalId } as const
  const drafted = yield* cliProposal(journal, current, { line: { _tag: 'Proposal', id: proposalId }, move: 'open', input: { value } })
  const submitted = yield* cliProposal(journal, drafted.state, { line, move: 'submit', input: { value, question: null } })
  const proposal = submitted.state.proposals.get(proposalId)
  if (!proposal) throw new Error('Missing direction to approve')
  const reviewing = yield* assignProposalReview(journal, proposal, active, submitted.state.read)
  const reviewed = yield* cliProposal(journal, reviewing.state, { line, move: 'review', input: { facts: evidence('Holds') } },
    { _tag: 'Review', session: active, review: proposal.lastChange })
  const accepted = yield* cliProposal(journal, reviewed.state, { line, move: 'accept', input: {} })
  return existing ? accepted.state : (yield* observeSession(journal, accepted.state, { _tag: 'Session', id }, 'Ended')).state
})

const files = Schema.decodeUnknownSync(ApprovedFiles)([{ path: 'AGENTS.md', hash: 'a'.repeat(64), before: 'Unmarked' }])
export const activateTasks = (journal: Journal, project: Project, value?: Direction) => Effect.gen(function* () {
  const staffed = project.staffing ? project : yield* acceptStaffing(journal, project,
    { id: StaffingId.make('staffing:task'), staff: [staff], subscriptions: [staff.subscription] })
  const selected = value ?? Schema.decodeUnknownSync(Direction)({
    ...direction, standards: [], stages: rolesOf(staffed).map((role) => ({
      ...direction.stages[0], id: 'stage:' + role.id.split(':')[1], role,
    })),
  })
  const ready = yield* acceptDirection(journal, staffed, selected)
  const line = { _tag: 'Activation', id: journal.id } as const
  const authorized = yield* ownerInput(journal, { read: ready.read, line, move: 'next', input: { files } })
  const launch = { _tag: 'HostLaunch', id: boundHost } as const
  const reserved = yield* observeActivation(journal, authorized.state, { line: launch, from: null, move: 'reserve', input: {} })
  const input = { pane: session.pane }
  const acknowledged = yield* observeActivation(journal, reserved.state, { line: launch, from: 'Reserved', move: 'acknowledge', input })
  return (yield* observeActivation(journal, acknowledged.state, { line: launch, from: 'Acknowledged', move: 'bind', input })).state
})

export const draftFor = (project: Project, id = taskId, role = host, reviewer = pipeline) => {
  const accepted = [...project.proposals.values()].findLast(({ phase }) => phase._tag === 'Accepted' && phase.version.value._tag === 'Direction')
  if (accepted?.phase._tag !== 'Accepted' || accepted.phase.version.value._tag !== 'Direction') throw new Error('Missing task direction')
  const { value, acceptedAt } = accepted.phase.version
  return Schema.decodeUnknownSync(Schema.Struct({ id: TaskId, ...TaskDraft.fields }))({
    id, name: 'First work', goal: 'Supply a result', reviewer: reviewer.id,
    direction: { id: value.id, acceptedAt }, stages: value.stages.filter((stage) => stage.role.id === role.id), facts: [],
  })
}

export const send = (journal: Journal, read: Of<typeof ReadPosition>, id = taskId, role = host) => Effect.gen(function* () {
  const project = yield* readOpenProject(journal)
  const { id: task, ...draft } = draftFor(project, id, role)
  return yield* sendTask(journal, { _tag: 'Task', id: task }, read, draft).pipe(Effect.provideService(Authority, {
    actor: Effect.succeed({ _tag: 'Host', id: boundHost, staff } as const),
  }))
})
export const begin = (journal: Journal, read: Of<typeof ReadPosition>) => staffInput(journal, { read, line: taskLine, move: 'next', input: {} })
export const resultInput = (read: Of<typeof ReadPosition>, artifact = 7, attempt = 1): Submission =>
  Schema.decodeUnknownSync(Submission, { onExcessProperty: 'error' })({ read, line: taskLine, move: 'next', input: { attempt, summary: 'Result', files: [{ path: 'artifact', image: { _tag: 'Present', contents: String(artifact) }, changed: [{ first: 1, last: 1 }] }] } })
export const commandOutcomes = (journal: Journal, read: Of<typeof ReadPosition>) => recordTaskCommands(journal, taskLine, read, [])

export const toWorking = (journal: Journal, value?: Direction) => Effect.gen(function* () {
  const opened = yield* create(journal)
  const active = yield* activateTasks(journal, opened.state, value)
  const { state } = yield* startWork(journal, active)
  const live = yield* startFixtureSession(journal, state)
  const sent = yield* send(journal, live.state.read)
  return yield* begin(journal, sent.state.read)
})
