import { expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { Effect, Schema } from 'effect'
import { authenticateProjectHost, projectActivationCommand } from '../../adapters/cli/commands/activation.ts'
import { main } from '../../adapters/cli/main.ts'
import { bootstrapPane, NONCE_ENV, PROJECT_ENV } from '../../adapters/live/bootstrap.ts'
import { liveProjectBootstrap, projectActivationFiles, projectActivationOperations, projectIdAt } from '../../adapters/live/activation.ts'
import { startServer } from '../../adapters/web/server.ts'
import { projectActivationApproval, projectEvents, projectSnapshot } from '../../adapters/web/project.ts'
import { agree, approvedText, hostId, newerText, readyActivation, readyProject, startWork } from '../../src/store/project-activation.probe.ts'
import { create, open, staff, withJournal } from '../../src/store/project.probe.ts'
import { ownerAuthority } from '../../src/store/question.probe.ts'
import { ActivationEvent, ApprovedFiles, LaunchNonce, LaunchText, Rationale, ReadPosition } from '../schema/project.ts'
import { Authority } from './project.ts'
import { readOpenProject } from './staff-session.ts'

const auth = Effect.provideService(Authority, { actor: Effect.succeed(ownerAuthority) })
const reason = Rationale.make('The owner asked to restore the original.')
const refused = (code: string) => ({ _tag: 'Failure', failure: { code } })

test('activation requires accepted proposals and pins a checked inventory of files', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const { state } = yield* create(journal)
    writeFileSync(join(dirname(path), 'AGENTS.md'), approvedText)
    const files = yield* projectActivationFiles(dirname(path))
    expect(yield* Effect.result(agree(journal, state, files))).toMatchObject(refused('WrongMove'))
    expect(yield* Effect.result(startWork(journal, state))).toMatchObject(refused('WrongMove'))
    expect(yield* journal.eventsAfter(state.read)).toEqual([])
  }))),
))

test('current ack, rejected edits and durable binding are checked against actual files', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const f = yield* readyActivation(path)
    const response = yield* projectActivationApproval(f.journal, f.directory).pipe(auth)
    expect(Schema.decodeUnknownSync(ApprovedFiles)(yield* Effect.promise(() => response.json()))).toEqual(f.files)
    yield* agree(f.journal, f.project, f.files)
    yield* f.operations.reserve(hostId(1))
    yield* f.operations.mark
    yield* f.operations.spawn
    expect(yield* Effect.result(f.operations.commit)).toMatchObject(refused('RetiredSession'))
    expect(yield* Effect.result(f.operations.acknowledge(hostId(1), LaunchNonce.make('0'.repeat(64)))))
      .toMatchObject(refused('RetiredSession'))
    yield* f.operations.acknowledge(hostId(1), f.nonces.get(hostId(1))!)
    const marked = readFileSync(f.file)
    writeFileSync(f.file, newerText)
    expect(yield* Effect.result(f.operations.commit)).toMatchObject(refused('Unavailable'))
    writeFileSync(f.file, marked)
    const committed = yield* f.operations.commit
    const reopened = yield* open(path)
    const recovered = projectActivationOperations(f.directory, reopened, f.provider)
    expect(yield* recovered.reconcile).toBeNull()
    expect(yield* readOpenProject(reopened)).toEqual(committed.state)
    expect(yield* Effect.result(recovered.rollback(reason))).toMatchObject(refused('WrongMove'))
  }))),
))

test('rollback is repeatable, preserves later edits and keeps accepted proposals', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const f = yield* readyActivation(path)
    yield* agree(f.journal, f.project, f.files)
    yield* f.operations.reserve(hostId(1))
    yield* f.operations.spawn
    yield* f.operations.mark
    writeFileSync(f.file, newerText)
    yield* f.operations.rollback(reason)
    yield* f.operations.restore
    const rolled = yield* f.operations.reconcile
    expect(rolled?.state.activation._tag).toBe('Onboarding')
    expect(rolled?.state.proposals).toEqual(f.project.proposals)
    expect(readFileSync(f.file, 'utf8')).toBe(newerText)
    expect(f.running.size).toBe(0)
  }))),
))

test('format 16 opens a real marked tmux host and retires credential delivery on use', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const f = yield* readyProject(path, { ...staff, launch: LaunchText.make('sleep 30 # {session}') })
    const provider = liveProjectBootstrap(f.directory, path, f.journal.id)
    const operations = projectActivationOperations(f.directory, f.journal, provider)
    yield* agree(f.journal, f.project, f.files)
    const id = hostId(1)
    yield* operations.reserve(id)
    yield* Effect.acquireRelease(Effect.void, () => Effect.asVoid(Effect.result(provider.stop(id))))
    yield* projectActivationCommand(f.journal, operations, 'resume').pipe(auth)
    expect(yield* provider.observe(id)).toBe('Running')
    const current = yield* readOpenProject(f.journal)
    if (current.activation._tag !== 'Activating') throw new Error('Expected prepared launch')
    const nonce = readFileSync(join(f.directory, '.work/onboarding/activation/project', f.journal.id, String(current.activation.at),
      'launch-' + id.slice(8), 'nonce'), 'utf8')
    const pane = bootstrapPane(f.directory, id.slice(8))
    if (!pane) throw new Error('Expected running tmux pane')
    const cli = (action: 'ack' | 'collect', from = pane.pane) => Effect.promise(async () => {
      const out: string[] = []
      const err: string[] = []
      const status = await main(['activation', action, id], {
        cwd: f.directory, isTTY: false, out: (text) => { out.push(text) }, err: (text) => { err.push(text) },
        readLine: () => null, now: () => new Date().toISOString(), gitUser: () => '', random: () => '',
        env: {
          ARISTOTELES_DB: path, [PROJECT_ENV]: f.journal.id, [NONCE_ENV]: nonce,
          TMUX_PANE: from, TMUX: pane.socket + ',0,0',
        },
      })
      return { status, out, err }
    })
    const wrongPane = yield* cli('ack', '%999')
    expect(wrongPane.status).toBe(1)
    const ack = yield* cli('ack')
    expect(ack).toEqual({ status: 0, out: ['Project host acknowledged.'], err: [] })
    const active = yield* readOpenProject(f.journal)
    expect(active.activation._tag).toBe('Active')
    const collected = yield* cli('collect')
    expect(collected.status).toBe(0)
    const credential = collected.out[0]!
    expect(credential).toMatch(/^host\.[a-f0-9]{64}$/)
    expect(yield* Effect.result(authenticateProjectHost(operations, id, credential))).toMatchObject(refused('RetiredSession'))
    yield* startWork(f.journal, active)
    const used = yield* authenticateProjectHost(operations, id, credential)
    expect(used.activation).toMatchObject({ _tag: 'Active', work: { _tag: 'Used', at: expect.any(Number), usedAt: expect.any(Number) } })
    const retired = yield* cli('collect')
    expect(retired.status).toBe(1)
    const logs = [wrongPane, ack, retired].flatMap(({ out, err }) => [...out, ...err]).join(' ')
    for (const secret of [nonce, credential]) expect(logs.includes(secret)).toBe(false)
    expect(collected.err).toEqual([])
    const snapshot = yield* projectSnapshot(f.journal)
    const events = yield* projectEvents(f.journal, ReadPosition.make(0))
    for (const response of [snapshot, events]) {
      const body = yield* Effect.promise(() => response.text())
      expect(body.includes(credential)).toBe(false)
      expect(body.includes(nonce)).toBe(false)
      expect(body.includes('verifier')).toBe(false)
    }
  }))),
))

test('first work pins the old bound launch when it beats the replacement commit', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const f = yield* readyActivation(path)
    const old = hostId(1)
    const replacement = hostId(2)
    yield* agree(f.journal, f.project, f.files)
    yield* f.operations.mark
    yield* f.operations.reserve(old)
    yield* f.operations.spawn
    yield* f.operations.acknowledge(old, f.nonces.get(old)!)
    yield* f.operations.commit
    const credential = yield* f.operations.collect(old, f.nonces.get(old)!)
    f.running.delete(old)
    yield* f.operations.reserve(replacement)
    yield* f.operations.spawn
    const ready = yield* f.operations.acknowledge(replacement, f.nonces.get(replacement)!)
    const { state } = yield* startWork(f.journal, ready.state)
    expect(yield* Effect.result(f.operations.commit)).toMatchObject(refused('RetiredSession'))
    expect(yield* Effect.result(f.operations.collect(replacement, f.nonces.get(replacement)!)))
      .toMatchObject(refused('RetiredSession'))
    expect(yield* Effect.result(f.operations.authenticate(old, credential))).toMatchObject(refused('RetiredSession'))
    expect(yield* f.journal.eventsAfter(state.read)).toEqual([])
    const cleaned = yield* f.operations.reconcile
    expect(cleaned?.state.activation).toMatchObject({ _tag: 'Active', binding: { id: old }, replacement: null })
    expect(f.running.has(replacement)).toBe(false)
  }))),
))

test('the retained activation routes read the journal and append only checked activation choices', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const directory = dirname(path)
    const git = (...args: string[]) => Bun.spawnSync(['git', '-C', directory, ...args]).exitCode
    expect(git('init', '-q')).toBe(0)
    expect(git('config', 'user.name', 'Owner')).toBe(0)
    const f = yield* readyProject(path, { ...staff, launch: LaunchText.make('sleep 30 # {session}') }, projectIdAt(directory))
    const provider = liveProjectBootstrap(directory, path, f.journal.id)
    yield* Effect.acquireRelease(Effect.void, () => Effect.ignore(Effect.gen(function* () {
      const current = yield* readOpenProject(f.journal)
      const phase = current.activation
      const launch = phase._tag === 'Active' ? phase.binding
        : phase._tag === 'Activating' ? phase.launches.at(-1) : null
      if (launch) yield* provider.stop(launch.id)
    })))
    const server = yield* Effect.acquireRelease(
      Effect.sync(() => startServer({ dir: directory, env: { ARISTOTELES_DB: path } })),
      (server) => Effect.sync(server.stop),
    )
    const origin = new URL(server.url).origin
    const post = (body: unknown) => Effect.promise(() => fetch(origin + '/api/activation', {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    const line = { _tag: 'Activation', id: f.project.id } as const
    const legacy = yield* post({ action: 'start', entries: [] })
    expect(legacy.status).toBe(400)
    const early = yield* post({ _tag: 'HumanChoice', read: f.project.read, choice: { _tag: 'StartWork', line } })
    expect(early.status).toBe(409)
    expect(yield* f.journal.eventsAfter(f.project.read)).toEqual([])
    const approval = yield* Effect.promise(() => fetch(origin + '/api/activation/approval'))
    expect(approval.status).toBe(200)
    const files = yield* Effect.promise(() => approval.json())
    expect(files).toEqual(f.files)
    const begun = yield* post({ _tag: 'HumanChoice', read: f.project.read, choice: { _tag: 'Activate', line, files } })
    expect(begun.status).toBe(200)
    // The page starts recovery asynchronously with its own journal handle.
    let launch
    for (let i = 0; i < 50; ++i) {
      const phase = (yield* readOpenProject(f.journal)).activation
      launch = phase._tag === 'Activating' ? phase.launches.at(-1) : undefined
      if (launch && (yield* provider.observe(launch.id)) === 'Running') break
      yield* Effect.sleep(20)
    }
    if (!launch || (yield* provider.observe(launch.id)) !== 'Running') throw new Error('The retained route did not launch the host')
    const activating = (yield* readOpenProject(f.journal)).activation
    if (activating._tag !== 'Activating') throw new Error('Missing launch basis')
    const nonce = LaunchNonce.make(readFileSync(join(directory, '.work/onboarding/activation/project',
      f.journal.id, String(activating.at), 'launch-' + launch.id.slice(8), 'nonce'), 'utf8'))
    const operations = projectActivationOperations(directory, f.journal, provider)
    yield* operations.acknowledge(launch.id, nonce)
    yield* operations.commit
    const active = yield* readOpenProject(f.journal)
    const started = yield* post({ _tag: 'HumanChoice', read: active.read, choice: { _tag: 'StartWork', line } })
    expect(started.status).toBe(200)
    const [event] = yield* f.journal.eventsAfter(active.read)
    expect(Schema.is(ActivationEvent)(event)).toBe(true)
    expect(event).toMatchObject({ from: 'Active', move: 'start', input: {} })
    const dash = yield* Effect.promise(() => fetch(origin + '/api/dash').then((r) => r.json()))
    expect(dash).toMatchObject({ activation: { phase: 'active', step: 'Work is open.' } })
  }))),
))
