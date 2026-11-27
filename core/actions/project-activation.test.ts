import { expect, test } from 'bun:test'
import { dirname, join } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { Effect, Schema } from 'effect'
import { digest } from '../services/project.ts'
import { runProjectCli } from '../../adapters/cli/project.ts'
import { bootstrapPane, NONCE_ENV, PROJECT_ENV } from '../../adapters/live/bootstrap.ts'
import { liveProjectBootstrap, projectActivationFiles, projectActivationOperations, projectDirectoryAt, resumeProjectActivation } from '../../adapters/live/activation.ts'
import { projectActivationApproval, projectEvents, projectSnapshot } from '../../adapters/web/project.ts'
import { agree, approvedText, hostKey, newerText, readyActivation, readyProject, startWork } from '../../src/store/project-activation.probe.ts'
import { create, open, ownerInput, staff, withJournal } from '../../src/store/project.probe.ts'
import { ownerAuthority } from '../../src/store/question.probe.ts'
import { ApprovedFiles, HostCredential, LaunchNonce, LaunchText, Rationale, ReadPosition } from '../schema/project.ts'
import { Authority } from './project.ts'
import { observeSession, readOpenProject } from './staff-session.ts'

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

test('the project line can end only from Active after all sessions end', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const f = yield* readyActivation(path)
    const end = (read: typeof f.project.read) => ownerInput(f.journal, { read, line: 'Project', move: 'end', input: {} })
    expect(yield* Effect.result(end(f.project.read))).toMatchObject(refused('WrongMove'))
    const approving = yield* agree(f.journal, f.project, f.files)
    expect(yield* Effect.result(end(approving.state.read))).toMatchObject(refused('WrongMove'))
    expect(yield* f.journal.eventsAfter(approving.state.read)).toEqual([])
    const key = hostKey(1)
    yield* f.operations.reserve(key)
    yield* f.operations.mark
    yield* f.operations.spawn
    const live = yield* f.operations.acknowledge(key, f.nonces.get(key)!)
    expect(yield* Effect.result(end(live.state.read))).toMatchObject(refused('WrongMove'))
    yield* f.provider.stop(key)
    const stopped = yield* observeSession(f.journal, live.state, key, 'Ended')
    const ended = yield* end(stopped.state.read)
    expect(ended.state.phase).toEqual({ _tag: 'Ended', endedIn: ended.event.number })
    expect(yield* Effect.result(end(ended.state.read))).toMatchObject(refused('ProjectEnded'))
  }))),
))

test('current ack, rejected edits and durable binding are checked against actual files', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const f = yield* readyActivation(path)
    const response = yield* projectActivationApproval(f.journal, f.directory).pipe(auth)
    expect(Schema.decodeUnknownSync(ApprovedFiles)(yield* Effect.promise(() => response.json()))).toEqual(f.files)
    yield* agree(f.journal, f.project, f.files)
    yield* f.operations.reserve(hostKey(1))
    yield* f.operations.mark
    yield* f.operations.spawn
    expect(yield* Effect.result(f.operations.acknowledge(hostKey(1), LaunchNonce.make('0'.repeat(64)))))
      .toMatchObject(refused('RetiredSession'))
    const marked = readFileSync(f.file)
    writeFileSync(f.file, newerText)
    expect(yield* Effect.result(f.operations.acknowledge(hostKey(1), f.nonces.get(hostKey(1))!))).toMatchObject(refused('Unavailable'))
    writeFileSync(f.file, marked)
    const committed = yield* f.operations.acknowledge(hostKey(1), f.nonces.get(hostKey(1))!)
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
    yield* f.operations.reserve(hostKey(1))
    yield* f.operations.spawn
    yield* f.operations.mark
    writeFileSync(f.file, newerText)
    yield* f.operations.rollback(reason)
    yield* f.operations.restore
    const rolled = yield* f.operations.reconcile
    expect(rolled?.state.phase._tag).toBe('Onboarding')
    expect(rolled?.state.proposals).toEqual(f.project.proposals)
    expect(readFileSync(f.file, 'utf8')).toBe(newerText)
    expect(f.running.size).toBe(0)
  }))),
))

test('format 22 opens a real marked tmux host and retires credential delivery on use', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const f = yield* readyProject(path, { ...staff, launch: LaunchText.make('sleep 30 # {session}') }, projectDirectoryAt(dirname(path)))
    const provider = liveProjectBootstrap(f.directory, path, f.journal.directory)
    const operations = projectActivationOperations(f.directory, f.journal, provider)
    yield* agree(f.journal, f.project, f.files)
    const key = hostKey(1)
    yield* operations.reserve(key)
    yield* Effect.acquireRelease(Effect.void, () => Effect.asVoid(Effect.result(provider.stop(key))))
    yield* resumeProjectActivation(f.journal, operations, 'resume')
    expect(yield* provider.observe(key)).toBe('Running')
    const current = yield* readOpenProject(f.journal)
    if (current.phase._tag !== 'Activating') throw new Error('Expected prepared launch')
    const nonce = readFileSync(join(f.directory, '.work/onboarding/activation/project', digest(f.journal.directory.href), String(current.phase.approvedIn),
      'launch-' + key.slice(8), 'nonce'), 'utf8')
    const pane = bootstrapPane(f.directory, key.slice(8))
    if (!pane) throw new Error('Expected running tmux pane')
    const cli = (action: 'ack' | 'collect', from = pane.pane) => Effect.promise(async () => {
      const out: string[] = []
      const err: string[] = []
      const status = await runProjectCli(['activation', action, key], {
        cwd: f.directory, isTTY: false, out: (text) => { out.push(text) }, err: (text) => { err.push(text) },
        gitUser: () => '',
        env: {
          ARISTOTELES_DB: path, [PROJECT_ENV]: f.journal.directory.href, [NONCE_ENV]: nonce,
          TMUX_PANE: from, TMUX: pane.socket + ',0,0',
        },
      })
      return { status, out, err }
    })
    const wrongPane = yield* cli('ack', '%999')
    expect(wrongPane.status).toBe(1)
    const ack = yield* cli('ack')
    expect(ack).toMatchObject({ status: 0, err: [] })
    expect(ack.out[0]).toStartWith('Project host acknowledged.')
    expect(ack.out[0]).toContain('Session introduction for ' + staff.name)
    expect(ack.out[0]).toContain('Accepted direction ')
    const active = yield* readOpenProject(f.journal)
    expect(active.phase._tag).toBe('Active')
    const collected = yield* cli('collect')
    expect(collected.status).toBe(0)
    const credential = collected.out[0]!
    expect(credential).toMatch(/^host\.[a-f0-9]{64}$/)
    expect(yield* Effect.result(operations.authenticate(key, Schema.decodeUnknownSync(HostCredential)(credential)))).toMatchObject(refused('RetiredSession'))
    yield* startWork(f.journal, active)
    const used = yield* operations.authenticate(key, Schema.decodeUnknownSync(HostCredential)(credential))
    expect(used.phase).toMatchObject({ _tag: 'Active', work: { _tag: 'Used', startedIn: expect.any(Number), usedIn: expect.any(Number) } })
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
    const old = hostKey(1)
    const replacement = hostKey(2)
    yield* agree(f.journal, f.project, f.files)
    yield* f.operations.mark
    yield* f.operations.reserve(old)
    yield* f.operations.spawn
    yield* f.operations.acknowledge(old, f.nonces.get(old)!)
    const credential = yield* f.operations.collect(old, f.nonces.get(old)!)
    f.running.delete(old)
    yield* f.operations.reserve(replacement)
    yield* f.operations.spawn
    const ready = yield* readOpenProject(f.journal)
    const { state } = yield* startWork(f.journal, ready)
    expect(yield* Effect.result(f.operations.acknowledge(replacement, f.nonces.get(replacement)!))).toMatchObject(refused('RetiredSession'))
    expect(yield* Effect.result(f.operations.collect(replacement, f.nonces.get(replacement)!)))
      .toMatchObject(refused('RetiredSession'))
    expect(yield* Effect.result(f.operations.authenticate(old, credential))).toMatchObject(refused('RetiredSession'))
    expect(yield* f.journal.eventsAfter(state.read)).toEqual([])
    const cleaned = yield* f.operations.reconcile
    expect(cleaned?.state.phase).toMatchObject({ _tag: 'Active' })
    expect(cleaned?.state.sessions.get(replacement)?._tag).toBe('Ended')
    expect(f.running.has(replacement)).toBe(false)
  }))),
))
