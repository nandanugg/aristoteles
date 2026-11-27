import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Effect, Schema } from 'effect'
import type { AuthenticatedActor } from '../../core/actions/project.ts'
import { acknowledgeSession, readOpenProject } from '../../core/actions/staff-session.ts'
import {
  EventNumber, HostCredential, LaunchNonce, LaunchVerifier, boundHostSession, PaneAddress, ProjectCredential, ProposalKey, Rationale, StaffSessionKey, TaskKey,
  liveSession, refuse, type Of, type Project, type Refusal, type Staff,
} from '../../core/schema/project.ts'
import { dbPath, digest, projectLock } from '../../core/services/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { boundHostAuthority, liveProjectBootstrap, projectActivationOperations } from './activation.ts'
import { bootstrapPane, observeBootstrap, spawnProjectRun, stopBootstrap } from './bootstrap.ts'
import { launchNextReview, type Reviews } from './proposal.ts'
import { staffSessionOperations, type Sessions } from './staff-session.ts'

const sessionFields = Schema.TaggedStruct('Session', { key: StaffSessionKey })
const Run = Schema.Union([
  Schema.TaggedStruct('Staff', { session: sessionFields, verifier: LaunchVerifier, proof: LaunchVerifier }),
  Schema.TaggedStruct('Review', {
    session: sessionFields, verifier: LaunchVerifier, review: EventNumber,
    line: Schema.Union([Schema.TaggedStruct('Task', { key: TaskKey }), Schema.TaggedStruct('Proposal', { key: ProposalKey })]),
  }),
])
const decode = Schema.decodeUnknownSync(Run, { onExcessProperty: 'error' })
const encode = Schema.encodeSync(Run)
const newKey = () => randomBytes(16).toString('hex')
const suffix = (key: Of<typeof StaffSessionKey>) => {
  const suffix = key.slice('session:'.length)
  if (!/^[a-f0-9]{32}$/u.test(suffix)) throw new Error('Invalid project session key')
  return suffix
}
const retired = () => refuse('RetiredSession', Rationale.make('Use the current project session or fresh review credential.'))
const perform = <A>(run: () => A): Effect.Effect<A, Refusal> => Effect.try({
  try: run, catch: () => refuse('Unavailable', Rationale.make('The project session provider could not complete that operation.')),
})

const current = (project: Project, run: Of<typeof Run>): AuthenticatedActor | null => {
  const session = liveSession(project, run.session.key)
  if (!session) return null
  if (run._tag === 'Staff') return { _tag: 'Staff', session }
  const { line, review } = run
  const phase = (line._tag === 'Proposal' ? project.proposals.get(line.key) : project.tasks.get(line.key))?.phase
  if (phase?._tag !== 'Reviewing' || phase.assignment._tag !== 'Assigned' ||
      phase.assignment.by.key !== session.staff.key || phase.assignment.review !== review) return null
  const actor = { _tag: 'Review', review, session } as const
  return line._tag === 'Task' ? { ...actor, line: 'Task', key: line.key } : { ...actor, line: 'Proposal', key: line.key }
}

export const newStaffSession = () => StaffSessionKey.make('session:' + newKey())

export const projectRuns = (dir: string, db: string | undefined, journal: Journal) => {
  const database = resolve(dir, dbPath({ ARISTOTELES_DB: db }))
  const area = join(dir, '.work', 'project-runs', digest(journal.directory.href + '\0' + database))
  const file = (key: string) => join(area, key + '.json')
  const read = (key: string) => decode(JSON.parse(readFileSync(file(key), 'utf8')))
  const launch = (key: string, record: Omit<Extract<Of<typeof Run>, { _tag: 'Staff' }>, 'verifier'> |
    Omit<Extract<Of<typeof Run>, { _tag: 'Review' }>, 'verifier'>, staff: Staff, prompt: string, nonce?: Of<typeof LaunchNonce>) => {
    const token = 'run.' + key + '.' + randomBytes(32).toString('hex')
    const verifier = LaunchVerifier.make(digest(token))
    mkdirSync(area, { mode: 0o700, recursive: true })
    // Leave the intent for reconciliation if the process starts without a committed assignment.
    writeFileSync(file(key), JSON.stringify(encode({ ...record, verifier })), { flag: 'wx', mode: 0o600 })
    spawnProjectRun(dir, key, db, staff, token, prompt, nonce)
    const pane = bootstrapPane(dir, key)
    if (!pane) throw new Error('Missing launched pane')
    return { address: PaneAddress.make(pane.pane) }
  }
  const reconcile = (project: Project) => perform(() => {
    if (!existsSync(area)) return
    for (const name of readdirSync(area)) {
      const match = /^([a-f0-9]{32})\.json$/u.exec(name)
      if (!match) continue
      const key = match[1]!
      const run = read(key)
      if ((current(project, run) || run._tag === 'Staff' && project.sessions.get(run.session.key)?._tag === 'Starting') &&
          observeBootstrap(dir, key) !== 'ended') continue
      stopBootstrap(dir, key)
      if (observeBootstrap(dir, key) !== 'ended') throw new Error('Could not confirm session retirement')
      unlinkSync(file(key))
    }
  })
  const child = (session: Extract<AuthenticatedActor, { _tag: 'Staff' }>['session'],
    line: Extract<Of<typeof Run>, { _tag: 'Review' }>['line'], review: Of<typeof EventNumber>) => perform(() => {
    launch(newKey(), { _tag: 'Review', session: { _tag: 'Session', key: session.key }, line, review }, session.staff,
      'You have a fresh review. Run work wait with the credential in ARISTOTELES_TOKEN and report facts with evidence.')
  })
  const reviews: Reviews = {
    reconcile,
    open: (proposal, session, review) => child(session, { _tag: 'Proposal', key: proposal.key }, review),
  }
  const sessions: Sessions = {
    reconcile,
    launch: (staff, key, previous) => previous ? Effect.fail(refuse('Unavailable', Rationale.make('This provider has no saved checkpoint.')))
      : perform(() => {
        const nonce = LaunchNonce.make(randomBytes(32).toString('hex'))
        launch(suffix(key), { _tag: 'Staff', session: { _tag: 'Session', key }, proof: digest(nonce) }, staff,
          `Run work session ack ${key} in this pane, then work wait with ARISTOTELES_TOKEN.`, nonce)
        return null
      }),
    stop: (session) => perform(() => {
      const key = suffix(session.key)
      stopBootstrap(dir, key)
      if (existsSync(file(key))) unlinkSync(file(key))
    }),
    observe: (session) => perform(() => {
      const observation = observeBootstrap(dir, suffix(session.key))
      return observation === 'live' ? 'Running' : observation === 'ended' ? 'Ended' : 'Unknown'
    }),
    child: (session, key, assignment) => assignment._tag === 'Review' ? child(session, { _tag: 'Task', key }, assignment.review)
      : Effect.fail(refuse('Unavailable', Rationale.make('Use the assigned staff session to begin task work.'))),
  }
  return {
    sessions: staffSessionOperations(dir, journal, sessions, launchNextReview(dir, journal, reviews)),
    review: launchNextReview(dir, journal, reviews),
    acknowledge: (key: Of<typeof StaffSessionKey>, nonce: Of<typeof LaunchNonce>) => Effect.scoped(Effect.gen(function* () {
      yield* projectLock(dir)
      const project = yield* readOpenProject(journal)
      const starting = project.sessions.get(key)
      if (starting?._tag !== 'Starting') return yield* Effect.fail(retired())
      const pane = yield* Effect.mapError(perform(() => {
        const run = read(suffix(key))
        if (run._tag !== 'Staff' || run.session.key !== key ||
            !timingSafeEqual(Buffer.from(digest(nonce), 'hex'), Buffer.from(run.proof, 'hex'))) return null
        return bootstrapPane(dir, suffix(key))
      }), retired)
      if (!pane) return yield* Effect.fail(retired())
      return yield* acknowledgeSession(journal, project, key, { address: PaneAddress.make(pane.pane) })
    })),
    authenticate: (token: Of<typeof ProjectCredential>): Effect.Effect<AuthenticatedActor, Refusal> => Effect.gen(function* () {
      const project = yield* readOpenProject(journal)
      const binding = boundHostSession(project)
      if (Schema.is(HostCredential)(token) && binding) {
        const operations = projectActivationOperations(dir, journal, liveProjectBootstrap(dir, db, journal.directory))
        return yield* boundHostAuthority(operations, binding.key, token)
      }
      const key = /^run\.([a-f0-9]{32})\.[a-f0-9]{64}$/u.exec(token)?.[1]
      if (!key) return yield* Effect.fail(retired())
      const run = yield* Effect.mapError(perform(() => read(key)), retired)
      if (!timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(run.verifier, 'hex')) ||
          observeBootstrap(dir, key) !== 'live' || observeBootstrap(dir, suffix(run.session.key)) !== 'live')
        return yield* Effect.fail(retired())
      const actor = current(project, run)
      return actor ?? (yield* Effect.fail(retired()))
    }),
  }
}
