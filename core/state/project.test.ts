import { expect, test } from 'bun:test'
import { Effect, Result, Schema } from 'effect'
import { openPageProject, receiveProjectPayload } from '../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot } from '../../adapters/web/project.ts'
import { create, open, session, staffInput, withJournal } from '../../src/store/project.probe.ts'
import { commandOutcomes, promptDirection, reportReview, resultInput, send, taskKey, taskLine, toWorking } from '../../src/store/task.probe.ts'
import { startChild } from '../actions/staff-session.ts'
import { EventNumber, ProposalKey, Projection, ReadPosition, StaffSessionKey, StoredEvent, Submission, TaskKey } from '../schema/project.ts'
import { applyEvent, fold, readPosition } from './project.ts'

const initial = ReadPosition.make(0)
const encode = Schema.encodeSync(StoredEvent)
const decode = Schema.decodeUnknownSync(StoredEvent, { onExcessProperty: 'error' })
const expectCode = (result: Result.Result<unknown, unknown>, code: string) =>
  expect(result).toMatchObject({ _tag: 'Failure', failure: { code } })

test('stored rows round-trip and the codec enforces line, move and read position', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const empty = yield* projectSnapshot(journal)
    expect(yield* Effect.promise(() => empty.json())).toBeNull()
    const { event } = yield* create(journal)
    const row = encode(event)
    expect(decode(JSON.parse(JSON.stringify(row)))).toEqual(event)
    expect(() => decode({ ...row, ...taskLine })).toThrow()
    expect(() => decode({ ...row, move: 'back' })).toThrow()
    expect(() => decode({ ...row, from: 'Sent' })).toThrow()
    expect(() => decode({ ...row, read: 1 })).toThrow()
    expect(() => decode({ ...row, destination: 'Open' })).toThrow()
    expectCode(applyEvent(null, { ...event, number: EventNumber.make(2) }), 'InvalidInput')
  }))),
))

test('a Task line requires its own key and move input on both wires', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal)
    const request = resultInput(working.state.read)
    if (request.line !== 'Task' || request.move !== 'next') throw new Error('Expected a Task report')
    const key = ProposalKey.make('proposal:foreign')
    const input = { value: promptDirection }
    const read = Schema.decodeUnknownSync(Submission, { onExcessProperty: 'error' })
    // @ts-expect-error Task submissions require a TaskKey.
    const wrongRequestKey: Submission = { ...request, key }
    // @ts-expect-error Task reports cannot submit a Proposal's input.
    const wrongRequestInput: Submission = { ...request, input }
    expect(() => read(wrongRequestKey)).toThrow()
    expect(() => read(wrongRequestInput)).toThrow()
    expect(() => read({ ...request, line: { _tag: 'Task', key: taskKey } })).toThrow()

    const { event } = yield* staffInput(journal, request)
    if (event.line !== 'Task' || event.from !== 'Working' || event.move !== 'next') throw new Error('Expected a stored Task report')
    // @ts-expect-error Task events require a TaskKey.
    const wrongEventKey: StoredEvent = { ...event, key }
    // @ts-expect-error A Working Task cannot store a Proposal's input.
    const wrongEventInput: StoredEvent = { ...event, input }
    expect(() => decode(wrongEventKey)).toThrow()
    expect(() => decode(wrongEventInput)).toThrow()
  }))),
))

test('both write connections recheck a competing report under the append lock', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const first = yield* open(path)
    const second = yield* open(path)
    const working = yield* toWorking(first)
    const basis = readPosition(working.state)
    const request = resultInput(basis)
    const deliveries = yield* Effect.all([
      Effect.result(staffInput(first, request)), Effect.result(staffInput(second, request)),
    ], { concurrency: 'unbounded' })
    expect(deliveries.filter(Result.isSuccess)).toHaveLength(1)
    expectCode(deliveries.find(Result.isFailure)!, 'Stale')
    expect(yield* first.eventsAfter(basis)).toHaveLength(1)
    // The caller can recover a lost reply by fetching the committed row.
    expectCode(yield* Effect.result(staffInput(second, request)), 'Stale')
    expect(yield* second.eventsAfter(basis)).toHaveLength(1)
  }))),
))

test('a report refuses wrong authority, an invalid phase and a stale basis after back to the same attempt', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal, promptDirection)
    const read = readPosition(working.state)
    const request = resultInput(read)
    expectCode(yield* Effect.result(staffInput(journal, { ...request, move: 'back' })), 'InvalidInput')
    expectCode(yield* Effect.result(staffInput(journal, request, { ...session, key: StaffSessionKey.make('session:other') })), 'RetiredSession')
    expectCode(yield* Effect.result(commandOutcomes(journal, read)), 'WrongMove')
    expect(yield* journal.eventsAfter(read)).toEqual([])
    const result = yield* staffInput(journal, request)
    const review = yield* commandOutcomes(journal, readPosition(result.state))
    const assigned = yield* startChild(journal, review.state, taskLine.key, session, 'Review')
    const back = yield* reportReview(journal, assigned.state, 'Breaks')
    expect(back.state.tasks.get(taskKey)).toMatchObject({ retryCount: 1, phase: { _tag: 'Working', attempt: { number: 1 } } })
    expectCode(yield* Effect.result(staffInput(journal, request)), 'Stale')
    expect(yield* journal.eventsAfter(readPosition(back.state))).toEqual([])
    expect((yield* staffInput(journal, resultInput(readPosition(back.state)))).state.phase._tag).toBe('Active')
  }))),
))

test('an unrelated record changing after the basis does not invalidate the addressed report', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal)
    const read = readPosition(working.state)
    yield* send(journal, read, TaskKey.make('task:unrelated'))
    const result = yield* staffInput(journal, resultInput(read))
    expect(Number(result.event.number)).toBe(read + 2)
  }))),
))

test('the page deduplicates notifications and catches up via the canonical snapshot and committed feed', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal)
    const after = readPosition(working.state)
    const changes: Projection[] = []
    const snap = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snap.json()), (state) => changes.push(state)))
    const result = yield* staffInput(journal, resultInput(after))
    const review = yield* commandOutcomes(journal, readPosition(result.state))
    expectCode(page.receive([review.event]), 'InvalidInput')
    expect(page.current()).toEqual(working.state)
    const reopened = yield* open(path, 'Read')
    const response = yield* projectEvents(reopened, after)
    expect(Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => response.json())))).toEqual(review.state)
    page.receive([result.event, review.event])
    expect(changes).toEqual([review.state])
    const all = yield* reopened.eventsAfter(initial)
    expect(Result.getOrThrow(fold(all))).toEqual(page.current())
    const saved = Schema.encodeSync(Projection)(page.current())
    expect(Result.getOrThrow(openPageProject(saved, () => {})).current()).toEqual(review.state)
    expect(() => Schema.decodeUnknownSync(Submission, { onExcessProperty: 'error' })({
      ...(resultInput(after)), actor: { _tag: 'Staff', key: 'staff:worker' },
    })).toThrow()
  }))),
))
