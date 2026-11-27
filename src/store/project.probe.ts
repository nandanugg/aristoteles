import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { startSession } from '../../core/actions/staff-session.ts'
import { Authority, submit } from '../../core/actions/project.ts'
import { staffingAt,
  Human, LiveSession, ProjectId, Role, Staff,
  type Of, type Projection, type StoredActor,
} from '../../core/schema/project.ts'
import { Env } from '../services/io.ts'
import type { Journal } from '../services/project.ts'
import { openProjectJournal } from './project.ts'

export const role = (name: 'host' | 'pipeline' | 'maker') => Schema.decodeUnknownSync(Role)({
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
export const ownerInput = (journal: Journal, input: unknown) =>
  submit(journal, input).pipe(Effect.provideService(Authority, {
    actor: Effect.succeed({ _tag: 'Human', actor: human } as const),
  }))
export const staffInput = (journal: Journal, input: unknown, live = session) =>
  submit(journal, input).pipe(Effect.provideService(Authority, {
    actor: Effect.succeed({ _tag: 'Staff', session: live } as const),
  }))
export const create = (journal: Journal, roles: readonly Of<typeof Role>[] = [], initialStaff = staff) => ownerInput(journal, { read: 0, line: { _tag: 'Project', id: journal.id }, move: 'open', input: { owner, host, pipeline, staff: initialStaff, roles } })
export const startFixtureSession = (journal: Journal, state: Projection) => {
  if (state?.status._tag !== 'Open') throw new Error('Open the test project first')
  return startSession(journal, state, {
    id: session.id, staff: staff.id, pane: session.pane, staffing: staffingAt(state),
  })
}

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
