import { expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Effect, Result, Schema } from 'effect'
import { projectActivationOperations } from '../../../../adapters/live/activation.ts'
import { openPageProject, receiveProjectPayload } from '../../../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot } from '../../../../adapters/web/project.ts'
import { agree, approvedText, hostId, newerText, readyActivation, startWork } from '../../../../src/store/project-activation.probe.ts'
import { open, withJournal } from '../../../../src/store/project.probe.ts'
import { readOpenProject } from '../../../actions/staff-session.ts'
import { ActivationEvent, HostCredential, Rationale, ReadPosition, type Of, type Refusal, type SessionId } from '../../../schema/project.ts'
import { readPosition } from '../../../state/project.ts'
import { picked } from '../../c16/replay/itf.ts'
import { integer, readTrace, record, registeredChecks } from './driver.ts'

const checks = ['activationCommit', 'activationRollback', 'activationHostBinding'] as const
const kinds = ['success', 'fault', 'mutant'] as const
const reason = Rationale.make('The owner canceled activation.')
const fixture = (check: string, kind: string) => join(import.meta.dir, 'traces', check + '-' + kind + '.itf.json.gz')
const numberOf = (id?: Of<typeof SessionId>) => id === undefined ? 0 : Number.parseInt(id.slice(8), 16)
const sorted = (values: Iterable<number>) => [...values].sort((a, b) => a - b)
const invalidCredential = HostCredential.make('host.' + '0'.repeat(64))
const modelRecord = Schema.decodeUnknownSync(Schema.Struct({
  phase: Schema.Literals(['Onboarding', 'Activating', 'Active', 'RollingBack']),
  file: Schema.Literals(['Approved', 'Marked', 'Newer']),
  reserved: Schema.Number, alive: Schema.Array(Schema.Number), acked: Schema.Array(Schema.Number),
  binding: Schema.Number, pending: Schema.Number, top: Schema.Number,
  delivered: Schema.Array(Schema.Number), used: Schema.Boolean,
}))

test('activation checks are registered and each witness set has a common model revision', () => {
  const registered = registeredChecks(resolve(import.meta.dir, '../../../..'))
  for (const check of checks) {
    expect(registered).toContain(check)
    expect(new Set(kinds.map((kind) => readTrace(fixture(check, kind), check, kind).modelRevision)).size).toBe(1)
  }
})

for (const check of checks) for (const kind of kinds) test(check + ' — ' + kind, () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const trace = readTrace(fixture(check, kind), check, kind)
    const f = yield* readyActivation(path)
    let journal = f.journal
    let operations = f.operations
    const delivered = new Map<number, Of<typeof HostCredential>>()
    const nonce = (id: Of<typeof SessionId>) => {
      const value = f.nonces.get(id)
      if (value === undefined) throw new Error('The replay has no nonce for this launch')
      return value
    }
    const old = hostId(1)
    const replacement = hostId(2)
    const spawnAndAcknowledge = (id: Of<typeof SessionId>) => Effect.gen(function* () {
      yield* operations.spawn
      yield* operations.acknowledge(id, nonce(id))
    })

    if (check !== 'activationCommit') yield* agree(journal, f.project, f.files)
    if (check === 'activationHostBinding') {
      yield* operations.mark
      yield* operations.reserve(old)
      yield* spawnAndAcknowledge(old)
      yield* operations.commit
    }

    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    const observe = Effect.suspend(() => Effect.gen(function* () {
      const project = yield* readOpenProject(journal)
      const response = yield* projectEvents(journal, readPosition(page.current()))
      expect(Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => response.json())))).toEqual(project)
      expect(project.proposals).toEqual(f.project.proposals)
      const phase = project.activation
      const contents = readFileSync(f.file, 'utf8')
      const reserved = phase._tag === 'Activating' || phase._tag === 'RollingBack' ? numberOf(phase.launches.at(-1)?.id) : 0
      const binding = phase._tag === 'Active' ? numberOf(phase.binding.id) : 0
      const events = yield* journal.eventsAfter(ReadPosition.make(0))
      const acked = new Set<number>()
      if (phase._tag !== 'Onboarding') for (const event of events) {
        if (event.number >= phase.at && Schema.is(ActivationEvent)(event) && event.move === 'acknowledge')
          acked.add(numberOf(event.input.id))
      }
      return {
        phase: phase._tag,
        file: contents === approvedText ? 'Approved' : contents === newerText ? 'Newer' : 'Marked',
        reserved,
        alive: sorted([...f.running].map(numberOf)),
        acked: sorted(acked),
        binding,
        pending: phase._tag === 'Active' ? numberOf(phase.replacement?.id) : 0,
        top: phase._tag === 'Active' && phase.work._tag !== 'NotStarted' ? binding : 0,
        delivered: sorted(delivered.keys()),
        used: phase._tag === 'Active' && phase.work._tag === 'Used',
      }
    }))
    const projection = (step: (typeof trace.states)[number]) => {
      const state = modelRecord(step.state.record)
      const active = state.binding !== 0
      // The journal exposes a committed binding immediately, including after a lost IO note.
      return { ...state, phase: active ? 'Active' as const : state.phase, reserved: active ? 0 : state.reserved }
    }

    const refusal = <A>(operation: Effect.Effect<A, Refusal>, ...codes: Refusal['code'][]) => Effect.gen(function* () {
      const before = yield* readOpenProject(journal)
      const result = yield* Effect.result(operation)
      if (Result.isSuccess(result)) throw new Error('Activation unexpectedly committed')
      expect(codes).toContain(result.failure.code)
      expect((yield* readOpenProject(journal)).read).toBe(before.read)
    })

    let previous = projection(trace.states[0]!)
    expect<unknown>(yield* observe).toEqual(previous)
    for (const [index, step] of trace.states.slice(1).entries()) {
      const expected = projection(step)
      const prior = record(trace.states[index]!.state.record!)
      let guarded = false
      switch (step.action) {
        case '': break
        case 'approve': yield* agree(journal, f.project, f.files); break
        case 'markFile': yield* operations.mark; break
        case 'editFile': writeFileSync(f.file, newerText); break
        case 'startHost': yield* operations.reserve(hostId(integer(picked(step.picks.launch)))); break
        case 'launchHost':
          if (check === 'activationRollback') {
            yield* operations.reserve(old)
            yield* spawnAndAcknowledge(old)
          } else yield* operations.spawn
          break
        case 'acknowledge': {
          const id = hostId(integer(prior.reserved))
          yield* operations.acknowledge(id, nonce(id))
          break
        }
        case 'loseHost': f.running.delete(old); break
        case 'tryCommit': {
          const reserved = integer(prior.reserved)
          const candidate = hostId(reserved)
          const phase = (yield* readOpenProject(journal)).activation
          const mayCommit = phase._tag === 'Activating' && phase.launches.at(-1)?.pane != null &&
            f.running.has(candidate) && prior.file === 'Marked'
          if (mayCommit) yield* operations.commit
          else {
            yield* refusal(operations.commit, 'RetiredSession', 'Unavailable')
            guarded = kind === 'mutant' && expected.binding !== previous.binding
          }
          break
        }
        case 'activate':
          if (prior.reserved === 0) {
            yield* operations.reserve(old)
            yield* spawnAndAcknowledge(old)
          }
          yield* operations.commit
          break
        case 'cancel':
          if (prior.phase === 'Active') yield* refusal(operations.rollback(reason), 'WrongMove')
          else yield* operations.rollback(reason)
          break
        case 'probeWork': yield* refusal(operations.authenticate(old, invalidCredential), 'RetiredSession'); break
        case 'crashBeforeNote':
        case 'crashDuringCleanup':
          journal = yield* open(path)
          operations = projectActivationOperations(f.directory, journal, f.provider)
          break
        case 'restoreFile':
          yield* operations.restore
          guarded = kind === 'mutant' && previous.file === 'Newer' && expected.file === 'Approved'
          break
        case 'note':
        case 'finishCleanup':
        case 'reconcile': yield* operations.reconcile; break
        case 'startReplacement': yield* operations.reserve(replacement); break
        case 'launchReplacement': yield* spawnAndAcknowledge(replacement); break
        case 'chooseBinding': yield* operations.commit; break
        case 'openProject': yield* startWork(journal, yield* readOpenProject(journal)); break
        case 'collect': {
          const launch = integer(picked(step.picks.launch))
          const id = hostId(launch)
          if (prior.binding === launch && prior.used === false) {
            delivered.set(launch, yield* operations.collect(id, nonce(id)))
          } else {
            yield* refusal(operations.collect(id, nonce(id)), 'RetiredSession')
            guarded = kind === 'mutant' && Array.isArray(expected.delivered) && expected.delivered.includes(launch)
          }
          break
        }
        case 'firstWork': {
          const launch = integer(prior.binding)
          const credential = delivered.get(launch)
          if (!credential) throw new Error('Work must use a delivered credential')
          yield* operations.authenticate(hostId(launch), credential)
          break
        }
        default: throw new Error('Unknown activation action: ' + step.action)
      }
      expect<unknown>({ step: index + 1, action: step.action, state: yield* observe }).toEqual({
        step: index + 1, action: step.action, state: guarded ? previous : expected,
      })
      if (guarded) {
        expect(index + 2).toBe(trace.states.length)
        return
      }
      previous = expected
    }
    expect(kind).not.toBe('mutant')
  }))),
))
