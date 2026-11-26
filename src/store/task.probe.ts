import { Effect, Schema } from 'effect'
import { observeActivation } from '../../core/actions/project-activation.ts'
import { Authority } from '../../core/actions/project.ts'
import { assignProposalReview } from '../../core/actions/proposal.ts'
import { observeSession, readOpenProject, startSession } from '../../core/actions/staff-session.ts'
import { recordTaskCommands, sendTask } from '../../core/actions/task.ts'
import {
  ApprovedFiles, Direction, ProposalId, SessionId, StaffingId, Submission, TaskDraft, TaskId, staffOf,
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
  const assigned = staffOf(project, project.host)!
  const existing = [...project.sessions.values()].find((value) => value._tag === 'Live' && value.staff.id === assigned.id)
  const id = existing?.id ?? SessionId.make('session:direction-' + project.read)
  const current = existing ? project : (yield* startSession(journal, project, {
    id, staff: assigned.id, pane: session.pane, staffing: project.staffingAt,
  })).state
  const active = current.sessions.get(id)
  if (active?._tag !== 'Live') throw new Error('Missing direction review session')
  const proposalId = ProposalId.make('proposal:direction-' + project.read)
  const line = { _tag: 'Proposal', id: proposalId } as const
  const drafted = yield* cliProposal(journal, current, { _tag: 'Proposal', id: proposalId, value })
  const submitted = yield* cliProposal(journal, drafted.state, { _tag: 'SubmitProposal', line, value, question: null })
  const proposal = submitted.state.proposals.get(proposalId)
  if (!proposal) throw new Error('Missing direction to approve')
  const reviewing = yield* assignProposalReview(journal, proposal, active, submitted.state.read)
  const reviewed = yield* cliProposal(journal, reviewing.state, { _tag: 'Review', line, facts: evidence('Holds') },
    { _tag: 'Review', session: active, review: proposal.lastChange })
  const accepted = yield* cliProposal(journal, reviewed.state, { _tag: 'ChooseProposal', line, choice: { _tag: 'accept' } })
  return existing ? accepted.state : (yield* observeSession(journal, accepted.state, { _tag: 'Session', id }, 'Ended')).state
})

const files = Schema.decodeUnknownSync(ApprovedFiles)([{ path: 'AGENTS.md', hash: 'a'.repeat(64), before: 'Unmarked' }])
export const activateTasks = (journal: Journal, project: Project, value?: Direction) => Effect.gen(function* () {
  const staffed = project.staffing ? project : yield* acceptStaffing(journal, project,
    { id: StaffingId.make('staffing:task'), staff: [staff], subscriptions: [staff.subscription] })
  const selected = value ?? Schema.decodeUnknownSync(Direction)({
    ...direction, standards: [], stages: [...staffed.roles.values()].map((role) => ({
      ...direction.stages[0], id: 'stage:' + role.id.split(':')[1], role,
    })),
  })
  const ready = yield* acceptDirection(journal, staffed, selected)
  const line = { _tag: 'Activation', id: journal.id } as const
  const authorized = yield* ownerInput(journal, { _tag: 'HumanChoice', read: ready.read, choice: { _tag: 'Activate', line, files } })
  const reserved = yield* observeActivation(journal, authorized.state, { line, from: 'Activating', move: 'reserve', input: { id: boundHost } })
  const binding = { id: boundHost, pane: session.pane }
  const acknowledged = yield* observeActivation(journal, reserved.state, { line, from: 'Activating', move: 'acknowledge', input: binding })
  return (yield* observeActivation(journal, acknowledged.state, { line, from: 'Activating', move: 'next', input: binding })).state
})

export const draftFor = (project: Project, id = taskId, role = host, reviewer = pipeline) => {
  const accepted = [...project.proposals.values()].findLast(({ phase }) => phase._tag === 'Accepted' && phase.version.value._tag === 'Direction')
  if (accepted?.phase._tag !== 'Accepted' || accepted.phase.version.value._tag !== 'Direction') throw new Error('Missing task direction')
  const { value, acceptedAt } = accepted.phase.version
  return Schema.decodeUnknownSync(TaskDraft)({
    id, name: 'First work', goal: 'Supply a result', role: role.id, reviewer: reviewer.id,
    direction: { id: value.id, acceptedAt }, stages: value.stages.filter((stage) => stage.role.id === role.id).map(({ id }) => id), facts: [],
  })
}

export const send = (journal: Journal, read: Of<typeof ReadPosition>, id = taskId, role = host) => Effect.gen(function* () {
  const project = yield* readOpenProject(journal)
  return yield* sendTask(journal, read, draftFor(project, id, role)).pipe(Effect.provideService(Authority, {
    actor: Effect.succeed({ _tag: 'Host', id: boundHost, staff } as const),
  }))
})
export const begin = (journal: Journal, read: Of<typeof ReadPosition>) => staffInput(journal, {
  _tag: 'StaffReport', read, report: { _tag: 'Work', line: taskLine, report: { _tag: 'Start' } },
})
export const resultInput = (read: Of<typeof ReadPosition>, artifact = 7, attempt = 1): Submission =>
  Schema.decodeUnknownSync(Submission)({
    _tag: 'StaffReport', read, report: {
      _tag: 'Work', line: taskLine,
      report: {
        _tag: 'Result', attempt, summary: 'Result',
        files: [{ path: 'artifact', image: { _tag: 'Present', contents: String(artifact) }, changed: [{ first: 1, last: 1 }] }],
      },
    },
  })
export const commandOutcomes = (journal: Journal, read: Of<typeof ReadPosition>) => recordTaskCommands(journal, taskLine, read, [])

export const toWorking = (journal: Journal, value?: Direction) => Effect.gen(function* () {
  const opened = yield* create(journal)
  const active = yield* activateTasks(journal, opened.state, value)
  const { state } = yield* startWork(journal, active)
  const live = yield* startFixtureSession(journal, state)
  const sent = yield* send(journal, live.state.read)
  return yield* begin(journal, sent.state.read)
})
