import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { Authority, recordObserved, submit } from '../../core/actions/project.ts'
import {
  Human, LiveSession, ProjectId, ReadPosition, Role, Staff, Submission, TaskDraft, TaskId,
  type Of, type StoredActor,
} from '../../core/schema/project.ts'
import { readPosition } from '../../core/state/project.ts'
import { Env } from '../services/io.ts'
import type { ProjectJournal } from '../services/project.ts'
import { openProjectJournal } from './project.ts'

export const role = (name: 'host' | 'pipeline') => Schema.decodeUnknownSync(Role)({
  id: 'role:' + name,
  name,
  responsibility: {
    id: { subject: 'responsibility:' + name, number: 1 }, acceptedAt: 1,
    value: { id: 'responsibility:' + name, summary: 'Review work', introduction: 'Start with the evidence', duties: ['Check output'] },
  },
})
export const owner = Schema.decodeUnknownSync(Human)({ _tag: 'Human', id: 'human:owner', name: 'Owner' })
export const human: StoredActor = { _tag: 'Human', id: owner.id }
export const host = role('host')
export const pipeline = role('pipeline')
export const staff = Schema.decodeUnknownSync(Staff)({
  _tag: 'Staff', id: 'staff:worker', name: 'Worker', roles: [host, pipeline], subagents: 2,
  model: 'test-model', launch: 'agent', why: 'Read the evidence',
  subscription: {
    id: 'subscription:local', provider: 'local', account: 'test', plan: 'fixed', usageWindow: 300,
    sessions: { _tag: 'Unlimited' }, estimate: { _tag: 'NoEstimate' },
  },
})
export const session = Schema.decodeUnknownSync(LiveSession)({
  _tag: 'Live', id: 'session:1', staff, startedAt: 1, pane: { address: '%2' },
})
export const worker: StoredActor = { _tag: 'Staff', id: staff.id }
export const projectId = ProjectId.make('project:first')
export const taskId = TaskId.make('task:sample')
export const taskLine = { _tag: 'Task', id: taskId } as const
export const draft = (id = taskId) => Schema.decodeUnknownSync(TaskDraft)({
  id, name: 'First work', goal: 'Supply a result', role: host, reviewer: pipeline,
})

export const ownerInput = (journal: ProjectJournal, input: unknown) =>
  submit(journal, input).pipe(Effect.provideService(Authority, {
    actor: Effect.succeed({ _tag: 'Human', actor: human } as const),
  }))
export const staffInput = (journal: ProjectJournal, input: unknown, live = session) =>
  submit(journal, input).pipe(Effect.provideService(Authority, {
    actor: Effect.succeed({ _tag: 'Staff', session: live } as const),
  }))
export const create = (journal: ProjectJournal) => ownerInput(journal, {
  _tag: 'HumanChoice', read: 0,
  choice: { _tag: 'NewProject', project: { _tag: 'Project', id: journal.id }, owner, host, pipeline, staff },
})
export const send = (journal: ProjectJournal, read: Of<typeof ReadPosition>, id = taskId) =>
  recordObserved(journal, human, read, { _tag: 'TaskSent', draft: draft(id) })
export const begin = (journal: ProjectJournal, read: Of<typeof ReadPosition>) => staffInput(journal, {
  _tag: 'StaffReport', read,
  report: { _tag: 'Work', line: taskLine, report: { _tag: 'Began', session, place: 'Main' } },
})
export const resultInput = (read: Of<typeof ReadPosition>, artifact = 7): Submission =>
  Schema.decodeUnknownSync(Submission)({
    _tag: 'StaffReport', read, report: {
      _tag: 'Work', line: taskLine,
      report: { _tag: 'Result', attempt: 1, summary: 'Result', files: [{ path: 'artifact', contents: String(artifact) }] },
    },
  })
export const commandOutcomes = (journal: ProjectJournal, read: Of<typeof ReadPosition>) =>
  recordObserved(journal, worker, read, { _tag: 'CommandOutcomes', line: taskLine, outcomes: [] })

export const toWorking = (journal: ProjectJournal) => Effect.gen(function* () {
  const open = yield* create(journal)
  const sent = yield* send(journal, readPosition(open.state))
  return yield* begin(journal, readPosition(sent.state))
})

export const withJournal = async <A>(run: (path: string) => Promise<A>): Promise<A> => {
  const directory = mkdtempSync(join(tmpdir(), 'project-journal-'))
  try {
    return await run(join(directory, 'project.db'))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
export const open = (path: string, mode: 'Read' | 'Create' = 'Create', id = projectId) =>
  openProjectJournal(id, mode).pipe(Effect.provideService(Env, { vars: { ARISTOTELES_DB: path } }))
