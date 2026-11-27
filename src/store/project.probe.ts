import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Effect, Schema } from 'effect'
import { acknowledgeSession, reserveSession } from '../../core/actions/staff-session.ts'
import { Authority, submit } from '../../core/actions/project.ts'
import { boundHostSession, staffingAt,
  Human, LiveSession, ReadPosition, Role, Staff, Rationale, refuse,
  type EventNumber, type Pane, type Refusal, type Project, type StaffKey, type StaffSessionKey,
  type Of, type Projection, type StoredActor,
} from '../../core/schema/project.ts'
import { Env } from '../services/io.ts'
import type { Committed, Journal } from '../services/project.ts'
import { openProjectJournal } from './project.ts'

export const role = (name: 'host' | 'pipeline' | 'maker') => Schema.decodeUnknownSync(Role)({
  key: 'role:' + name,
  name,
  responsibility: {
    number: 1, acceptedAt: 1,
    value: { summary: 'Review work', introduction: 'Start with the evidence', duties: ['Check output'] },
  },
})
export const owner = Schema.decodeUnknownSync(Human)({ _tag: 'Human', name: 'Owner' })
export const human: StoredActor = { _tag: 'Human' }
export const host = role('host')
export const pipeline = role('pipeline')
export const staff = Schema.decodeUnknownSync(Staff)({
  _tag: 'Staff', key: 'staff:worker', name: 'Worker', roles: [host, pipeline], subagents: 2,
  model: 'test-model', launch: 'agent', why: 'Read the evidence',
  subscription: {
    key: 'subscription:local', provider: 'local', account: 'test', plan: 'fixed', usageWindow: 300,
    sessions: { _tag: 'Unlimited' }, estimate: { _tag: 'NoEstimate' },
  },
})
export const session = Schema.decodeUnknownSync(LiveSession)({
  _tag: 'Live', key: 'session:' + '1'.repeat(32), staff, startedAt: 1, pane: { address: '%2' },
})
export const worker: StoredActor = { _tag: 'Staff', key: staff.key }
export const ownerInput = (journal: Journal, input: unknown) =>
  submit(journal, input).pipe(Effect.provideService(Authority, {
    actor: Effect.succeed({ _tag: 'Human', actor: human } as const),
  }))
export const staffInput = (journal: Journal, input: unknown, live = session) =>
  submit(journal, input).pipe(Effect.provideService(Authority, {
    actor: Effect.succeed({ _tag: 'Staff', session: live } as const),
  }))
export const create = (journal: Journal, roles: readonly Of<typeof Role>[] = [], initialStaff = staff) => ownerInput(journal, { read: 0, line: 'Project', move: 'open', input: { owner, host, pipeline, staff: initialStaff, roles } })
export const startFixtureSession = (journal: Journal, state: Projection, live = session) => {
  if (state?.status._tag !== 'Open') throw new Error('Open the test project first')
  const bound = boundHostSession(state)
  if (bound?.key === live.key) return Effect.map(journal.eventsAfter(ReadPosition.make(0)), (events) => ({
    state, event: events.findLast((event) => event.line === 'Session' &&
      event.key === live.key && event.from === 'Starting' && event.move === 'next')!,
  }))
  return startSession(journal, state, {
    key: live.key, staff: live.staff.key, pane: live.pane, staffing: staffingAt(state),
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
export const open = (path: string, mode: 'Read' | 'Create' = 'Create', directory = pathToFileURL(dirname(path))) =>
  openProjectJournal(directory, mode).pipe(Effect.provideService(Env, { vars: { ARISTOTELES_DB: path } }))

export const startSession = (
  journal: Journal, project: Project, session: {
    readonly key: Of<typeof StaffSessionKey>; readonly staff: Of<typeof StaffKey>
    readonly pane: Of<typeof Pane>; readonly staffing: Of<typeof EventNumber>
  },
): Effect.Effect<Committed, Refusal> => Effect.gen(function* () {
  const staff = project.staff.get(session.staff)
  if (!staff) return yield* Effect.fail(refuse('WrongActor', Rationale.make('Staffing does not include that staff.')))
  const address = session.key
  const reserved = yield* reserveSession(journal, project, address, staff, session.staffing)
  return yield* acknowledgeSession(journal, reserved.state, address, session.pane)
})

export const resumeSession = (
  journal: Journal, project: Project, key: Of<typeof StaffSessionKey>,
  input: { readonly key: Of<typeof StaffSessionKey>; readonly pane: Of<typeof Pane>; readonly staffing: Of<typeof EventNumber> },
): Effect.Effect<Committed, Refusal> => Effect.gen(function* () {
  const paused = project.sessions.get(key)
  if (paused?._tag !== 'Paused') return yield* Effect.fail(refuse('RetiredSession', Rationale.make('Resume a paused session.')))
  const reserved = yield* reserveSession(journal, project, input.key, paused.staff, input.staffing, key)
  return yield* acknowledgeSession(journal, reserved.state, input.key, input.pane)
})
