import { expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { Effect } from 'effect'
import { acceptStaffing } from '../../src/store/proposal.probe.ts'
import { readOpenProject, startSession } from '../../core/actions/staff-session.ts'
import { PaneAddress, Rationale, SessionId, TaskId, refuse, type Of } from '../../core/schema/project.ts'
import { open, send, staff, withJournal } from '../../src/store/project.probe.ts'
import { initialStaffing, sharedStaffing } from '../../src/store/staff-session.probe.ts'
import { staffSessionOperations, type Sessions } from './staff-session.ts'

const pane = { address: PaneAddress.make('%7') }
const missing = refuse('Unavailable', Rationale.make('Provider has not confirmed the stop.'))

test('concurrent launches use one lifetime, and unknown observations leave it live', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = yield* sharedStaffing(journal)
    const launched: Of<typeof SessionId>[] = []
    let observed: 'Unknown' | 'Ended' = 'Unknown'
    const provider: Sessions = {
      reconcile: () => Effect.void,
      launch: (_staff, id) => Effect.sync(() => { launched.push(id); return pane }),
      observe: () => Effect.sync(() => observed),
      child: () => Effect.void,
    }
    const first = staffSessionOperations(dirname(path), journal, provider)
    const other = staffSessionOperations(dirname(path), journal, provider)
    const id = SessionId.make('session:actual')
    const second = SessionId.make('session:duplicate')
    const outcomes = yield* Effect.all([
      Effect.result(first.launch(staff.id, id, project.staffingAt, null)),
      Effect.result(other.launch(staff.id, second, project.staffingAt, null)),
    ], { concurrency: 'unbounded' })
    expect(outcomes.map(({ _tag }) => _tag).sort()).toEqual(['Failure', 'Success'])
    expect(launched).toHaveLength(1)
    const address = { _tag: 'Session', id: launched[0]! } as const
    expect(yield* first.observe(address)).toBeNull()
    expect((yield* readOpenProject(journal)).sessions.get(address.id)?._tag).toBe('Live')
    observed = 'Ended'
    yield* first.observe(address)
    expect((yield* readOpenProject(journal)).sessions.get(address.id)?._tag).toBe('Ended')
  }))),
))

test('a losing launch is reconciled before another provider slot can be exposed', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = yield* sharedStaffing(journal)
    const existing = SessionId.make('session:existing')
    const lost = SessionId.make('session:lost')
    const pending = new Set<Of<typeof SessionId>>()
    let canStop = false
    const provider: Sessions = {
      reconcile: (current) => Effect.suspend(() => {
        for (const id of pending) {
          if (!current.sessions.has(id) && !canStop) return Effect.fail(missing)
          pending.delete(id)
        }
        return Effect.void
      }),
      launch: (_staff, id) => Effect.gen(function* () {
        pending.add(id)
        if (id === lost) {
          // A writer that already held provider authority wins the journal race.
          yield* startSession(journal, project, { id: existing, staff: staff.id, pane, staffing: project.staffingAt })
        }
        return pane
      }),
      observe: () => Effect.succeed('Running'),
      child: () => Effect.void,
    }
    const operations = staffSessionOperations(dirname(path), journal, provider)
    expect(yield* Effect.result(operations.launch(staff.id, lost, project.staffingAt, null)))
      .toMatchObject({ _tag: 'Failure', failure: { code: 'Unavailable' } })
    expect(pending.has(lost)).toBe(true)
    const other = initialStaffing().staff[1]!
    const otherId = SessionId.make('session:other')
    expect(yield* Effect.result(operations.launch(other.id, otherId, project.staffingAt, null)))
      .toMatchObject({ _tag: 'Failure', failure: { code: 'Unavailable' } })
    expect(pending.has(otherId)).toBe(false)
    canStop = true
    yield* operations.launch(other.id, otherId, project.staffingAt, null)
    expect(pending.has(lost)).toBe(false)
    const current = yield* readOpenProject(journal)
    expect([...current.sessions.values()].filter((item) => item._tag === 'Live').map(({ id }) => id)).toEqual([existing, otherId])
  }))),
))

test('the live adapter serializes child starts across roles assigned to one staff', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = yield* sharedStaffing(journal)
    let started = 0
    const provider: Sessions = {
      reconcile: () => Effect.void,
      launch: () => Effect.succeed(pane),
      observe: () => Effect.succeed('Running'),
      child: () => Effect.sync(() => { started += 1 }),
    }
    const operations = staffSessionOperations(dirname(path), journal, provider)
    const id = SessionId.make('session:test')
    yield* operations.launch(staff.id, id, project.staffingAt, null)
    const host = { _tag: 'Task', id: TaskId.make('task:host') } as const
    const pipeline = { _tag: 'Task', id: TaskId.make('task:pipeline') } as const
    yield* send(journal, (yield* readOpenProject(journal)).read, host.id, project.host)
    yield* send(journal, (yield* readOpenProject(journal)).read, pipeline.id, project.pipeline)
    const outcomes = yield* Effect.all([
      Effect.result(operations.child(id, host, 'Work', project.staffingAt)),
      Effect.result(operations.child(id, pipeline, 'Work', project.staffingAt)),
    ], { concurrency: 'unbounded' })
    expect(outcomes.map(({ _tag }) => _tag).sort()).toEqual(['Failure', 'Success'])
    expect(started).toBe(1)
  }))),
))

test('a child launched against a replaced plan is reconciled and can try again on the new basis', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = yield* sharedStaffing(journal)
    let pending = false
    let replace = true
    let stopped = 0
    const task = { _tag: 'Task', id: TaskId.make('task:stale-child') } as const
    const provider: Sessions = {
      reconcile: (current) => Effect.sync(() => {
        if (pending && current.tasks.get(task.id)?.phase._tag !== 'Working') {
          stopped += 1
          pending = false
        }
      }),
      launch: () => Effect.succeed(pane),
      observe: () => Effect.succeed('Running'),
      child: () => Effect.gen(function* () {
        pending = true
        if (replace) {
          replace = false
          const current = yield* readOpenProject(journal)
          yield* acceptStaffing(journal, current, initialStaffing(1))
        }
      }),
    }
    const operations = staffSessionOperations(dirname(path), journal, provider)
    const id = SessionId.make('session:child')
    yield* operations.launch(staff.id, id, project.staffingAt, null)
    yield* send(journal, (yield* readOpenProject(journal)).read, task.id)
    expect(yield* Effect.result(operations.child(id, task, 'Work', project.staffingAt)))
      .toMatchObject({ _tag: 'Failure', failure: { code: 'Stale' } })
    expect(stopped).toBe(1)
    const current = yield* readOpenProject(journal)
    expect(current.tasks.get(task.id)?.phase._tag).toBe('Sent')
    yield* operations.child(id, task, 'Work', current.staffingAt)
    expect((yield* readOpenProject(journal)).tasks.get(task.id)?.phase._tag).toBe('Working')
    expect(stopped).toBe(1)
  }))),
))
