import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Effect, Schema } from 'effect'
import type { AuthenticatedActor } from '../../core/actions/project.ts'
import { readOpenProject } from '../../core/actions/staff-session.ts'
import {
  EventNumber, HostCredential, LaunchVerifier, PaneAddress, ProjectCredential, ProposalAddress, Rationale, SessionId, TaskAddress,
  liveSession, refuse, type Of, type Project, type Refusal, type Staff,
} from '../../core/schema/project.ts'
import { dbPath, digest } from '../../core/services/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { boundHostAuthority, liveProjectBootstrap, projectActivationOperations } from './activation.ts'
import { bootstrapPane, observeBootstrap, spawnProjectRun, stopBootstrap } from './bootstrap.ts'
import { launchNextReview, type Reviews } from './proposal.ts'
import { staffSessionOperations, type Sessions } from './staff-session.ts'

const Run = Schema.Union([
  Schema.TaggedStruct('Staff', { session: SessionId, verifier: LaunchVerifier }),
  Schema.TaggedStruct('Review', {
    session: SessionId, verifier: LaunchVerifier,
    line: Schema.Union([TaskAddress, ProposalAddress]), review: EventNumber,
  }),
])
const decode = Schema.decodeUnknownSync(Run, { onExcessProperty: 'error' })
const encode = Schema.encodeSync(Run)
const newKey = () => randomBytes(16).toString('hex')
const suffix = (id: Of<typeof SessionId>) => {
  const key = id.slice('session:'.length)
  if (!/^[a-f0-9]{32}$/u.test(key)) throw new Error('Invalid project session address')
  return key
}
const retired = () => refuse('RetiredSession', Rationale.make('Use the current project session or fresh review credential.'))
const perform = <A>(run: () => A): Effect.Effect<A, Refusal> => Effect.try({
  try: run, catch: () => refuse('Unavailable', Rationale.make('The project session provider could not complete that operation.')),
})

const current = (project: Project, run: Of<typeof Run>): AuthenticatedActor | null => {
  const session = liveSession(project, run.session)
  if (!session) return null
  if (run._tag === 'Staff') return { _tag: 'Staff', session }
  const { line, review } = run
  const phase = line._tag === 'Proposal' ? project.proposals.get(line.id)?.phase : project.tasks.get(line.id)?.phase
  return phase?._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' &&
    phase.assignment.by.id === session.staff.id && phase.assignment.review === review
    ? { _tag: 'Review', line, review, session } : null
}

export const newStaffSession = () => SessionId.make('session:' + newKey())

export const projectRuns = (dir: string, db: string | undefined, journal: Journal) => {
  const database = resolve(dir, dbPath({ ARISTOTELES_DB: db }))
  const area = join(dir, '.work', 'project-runs', digest(journal.id + '\0' + database))
  const file = (key: string) => join(area, key + '.json')
  const read = (key: string) => decode(JSON.parse(readFileSync(file(key), 'utf8')))
  const launch = (key: string, record: Omit<Extract<Of<typeof Run>, { _tag: 'Staff' }>, 'verifier'> |
    Omit<Extract<Of<typeof Run>, { _tag: 'Review' }>, 'verifier'>, staff: Staff, prompt: string) => {
    const token = 'run.' + key + '.' + randomBytes(32).toString('hex')
    const verifier = LaunchVerifier.make(digest(token))
    mkdirSync(area, { mode: 0o700, recursive: true })
    // Leave the intent for reconciliation if the process starts without a committed assignment.
    writeFileSync(file(key), JSON.stringify(encode({ ...record, verifier })), { flag: 'wx', mode: 0o600 })
    spawnProjectRun(dir, key, db, staff, token, prompt)
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
      if (current(project, run) && observeBootstrap(dir, key) !== 'ended') continue
      stopBootstrap(dir, key)
      if (observeBootstrap(dir, key) !== 'ended') throw new Error('Could not confirm session retirement')
      unlinkSync(file(key))
    }
  })
  const child = (session: Extract<AuthenticatedActor, { _tag: 'Staff' }>['session'],
    line: Of<typeof TaskAddress | typeof ProposalAddress>, review: Of<typeof EventNumber>) => perform(() => {
    launch(newKey(), { _tag: 'Review', session: session.id, line, review }, session.staff,
      'You have a fresh review. Run work wait with the credential in ARISTOTELES_TOKEN and report facts with evidence.')
  })
  const reviews: Reviews = {
    reconcile,
    open: (proposal, session, review) => child(session, { _tag: 'Proposal', id: proposal.id }, review),
  }
  const sessions: Sessions = {
    reconcile,
    launch: (staff, id, previous) => previous ? Effect.fail(refuse('Unavailable', Rationale.make('This provider has no saved checkpoint.')))
      : perform(() => launch(suffix(id), { _tag: 'Staff', session: id }, staff,
        'Run work wait with the credential in ARISTOTELES_TOKEN to get the next project step.')),
    observe: (session) => perform(() => {
      const observation = observeBootstrap(dir, suffix(session.id))
      return observation === 'live' ? 'Running' : observation === 'ended' ? 'Ended' : 'Unknown'
    }),
    child: (session, line, assignment) => assignment._tag === 'Review' ? child(session, line, assignment.review)
      : Effect.fail(refuse('Unavailable', Rationale.make('Use the assigned staff session to begin task work.'))),
  }
  return {
    sessions: staffSessionOperations(dir, journal, sessions, launchNextReview(dir, journal, reviews)),
    review: launchNextReview(dir, journal, reviews),
    authenticate: (token: Of<typeof ProjectCredential>): Effect.Effect<AuthenticatedActor, Refusal> => Effect.gen(function* () {
      const project = yield* readOpenProject(journal)
      if (Schema.is(HostCredential)(token) && project.activation._tag === 'Active') {
        const operations = projectActivationOperations(dir, journal, liveProjectBootstrap(dir, db, journal.id))
        return yield* boundHostAuthority(operations, project.activation.binding.id, token)
      }
      const key = /^run\.([a-f0-9]{32})\.[a-f0-9]{64}$/u.exec(token)?.[1]
      if (!key) return yield* Effect.fail(retired())
      const run = yield* Effect.mapError(perform(() => read(key)), retired)
      if (!timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(run.verifier, 'hex')) ||
          observeBootstrap(dir, key) !== 'live' || observeBootstrap(dir, suffix(run.session)) !== 'live')
        return yield* Effect.fail(retired())
      const actor = current(project, run)
      return actor ?? (yield* Effect.fail(retired()))
    }),
  }
}
