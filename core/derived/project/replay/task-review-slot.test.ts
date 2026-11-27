import { expect, test } from 'bun:test'
import { dirname, join, resolve } from 'node:path'
import { Effect, Result, Schema } from 'effect'
import { staffSessionOperations } from '../../../../adapters/live/staff-session.ts'
import { openPageProject, receiveProjectPayload } from '../../../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot } from '../../../../adapters/web/project.ts'
import { startWork } from '../../../../src/store/project-activation.probe.ts'
import { create, host, open, pipeline, role, session, staff, staffInput, startFixtureSession, withJournal } from '../../../../src/store/project.probe.ts'
import { acceptStaffing } from '../../../../src/store/proposal.probe.ts'
import { activateTasks, promptDirection, reportReview, resultInput, reviewAs, send } from '../../../../src/store/task.probe.ts'
import { observeSession, startSession } from '../../../actions/staff-session.ts'
import { recordTaskCommands } from '../../../actions/task.ts'
import {
  Direction, EventNumber, ReadPosition, SessionId, Staff, StaffingId, TaskId, staffingAt, subagentCapacity,
  type LiveSession, type Project,
} from '../../../schema/project.ts'
import { picked } from './itf.probe.ts'
import { integer, readTrace, record, registeredChecks } from './driver.ts'

const check = 'reviewSlot'
const kinds = ['success', 'fault', 'mutant'] as const
const workRole = role('maker')
const hostStaff = Staff.make({ ...staff, roles: [host], subagents: Schema.decodeUnknownSync(Staff.fields.subagents)(1) })
const ownStaff = Schema.decodeUnknownSync(Staff)({ ...staff, id: 'staff:own', roles: [pipeline], subagents: 1 })
const queuedStaff = Schema.decodeUnknownSync(Staff)({ ...staff, id: 'staff:queue', roles: [workRole], subagents: 0 })
const ownId = SessionId.make('session:own')
const firstHost = { ...session, staff: hostStaff }
const ownSession = { ...session, id: ownId, staff: ownStaff }
const lines = [1, 2, 3, 4].map((id) => ({ _tag: 'Task', id: TaskId.make('task:slot-' + id) } as const))
const direction = Schema.decodeUnknownSync(Direction)({
  ...promptDirection,
  stages: [promptDirection.stages[0], { ...promptDirection.stages[0], id: 'stage:own', role: pipeline }],
})
const fixture = (kind: typeof kinds[number]) => join(import.meta.dir, 'traces', check + '-' + kind + '.itf.json.gz')

test('review slot witnesses are registered and share a model revision', () => {
  expect(registeredChecks(resolve(import.meta.dir, '../../../..'))).toContain(check)
  expect(new Set(kinds.map((kind) => readTrace(fixture(kind), check, kind).modelRevision)).size).toBe(1)
})

for (const kind of kinds) test('task review slots — ' + kind, () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const created = yield* create(journal, [workRole], hostStaff)
    const staffed = yield* acceptStaffing(journal, created.state, {
      id: StaffingId.make('staffing:review-slot'), staff: [hostStaff, ownStaff, queuedStaff], subscriptions: [staff.subscription],
    })
    const active = yield* activateTasks(journal, staffed, direction)
    const started = yield* startWork(journal, active)
    const live = yield* startFixtureSession(journal, started.state)
    let state = (yield* startSession(journal, live.state, {
      id: ownId, staff: ownStaff.id, pane: session.pane, staffing: staffingAt(live.state),
    })).state
    let hostSession: LiveSession = firstHost
    const opened = new Map<number, ReturnType<typeof reviewAs>>()
    const operations = staffSessionOperations(dirname(path), journal, {
      reconcile: () => Effect.void,
      launch: () => Effect.succeed(session.pane),
      observe: () => Effect.succeed('Running'),
      child: (live, line, child) => Effect.sync(() => {
        if (child._tag !== 'Review') return
        opened.set(lines.findIndex(({ id }) => line.id === id) + 1, { _tag: 'Review', session: live, line, review: child.review })
      }),
    })
    for (const [i, line] of lines.slice(0, 3).entries()) {
      const sent = yield* send(journal, state.read, line.id, host, i === 2 ? pipeline : workRole)
      const working = yield* staffInput(journal, { read: sent.state.read, line, move: 'next', input: {} }, hostSession)
      const result = yield* staffInput(journal, { ...resultInput(working.state.read), line }, hostSession)
      state = (yield* recordTaskCommands(journal, line, result.state.read, [])).state
    }
    const busy = lines[3]!
    const sent = yield* send(journal, state.read, busy.id, pipeline)
    state = (yield* operations.child(ownId, busy, 'Work', staffingAt(sent.state))).state

    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    const startedTasks: number[] = []
    let oldHost: ReturnType<typeof reviewAs> | undefined
    let stoppedMutant = false
    const compare = (expected: ReturnType<typeof readTrace>['states'][number]['state'], project: Project) => {
      if (!Array.isArray(expected.queue) || !Array.isArray(expected.busy)) throw new Error('Missing modeled review slots')
      const queue = new Map(expected.queue.map((value) => [integer(record(value).id), record(value).review]))
      expect(startedTasks).toEqual(expected.started as number[])
      for (const [index, line] of lines.slice(0, 3).entries()) {
        const modeled = queue.get(index + 1)
        const phase = project.tasks.get(line.id)?.phase
        if (modeled === undefined) expect(phase?._tag).toBe('Done')
        else if (modeled === 'Waiting') expect(phase).toMatchObject({ _tag: 'Reviewing', assignment: { _tag: 'Waiting' } })
        else expect(phase).toMatchObject({ _tag: 'Reviewing', assignment: {
          _tag: 'Assigned', by: { id: record(modeled).value === 0 ? hostStaff.id : ownStaff.id },
        } })
      }
      const occupied = [hostStaff, ownStaff].map((by, i) => subagentCapacity(project, by).freeSubagents ? null : [0, 2][i])
        .filter((by) => by !== null)
      expect(occupied).toEqual(expected.busy as number[])
    }
    const trace = readTrace(fixture(kind), check, kind)
    compare(trace.states[0]!.state, state)
    for (const [i, step] of trace.states.slice(1).entries()) {
      const previous = trace.states[i]!.state
      const before = state
      switch (step.action) {
        case '': break
        case 'freeOwn':
          state = (yield* staffInput(journal, { ...resultInput(state.read), line: busy }, ownSession)).state
          break
        case 'editOlder':
          if (startedTasks.length === 0) {
            // An interrupted assignment touches the older task after the newer one, preserving its entry event.
            const oldest = lines[0]!
            const assigned = yield* operations.child(hostSession.id, oldest, 'Review', staffingAt(state))
            const retired = yield* observeSession(journal, assigned.state, { _tag: 'Session', id: hostSession.id }, 'Ended')
            hostSession = { ...firstHost, id: SessionId.make('session:review-replacement') }
            state = (yield* startSession(journal, retired.state, {
              id: hostSession.id, staff: hostStaff.id, pane: session.pane, staffing: staffingAt(retired.state),
            })).state
            expect(state.tasks.get(oldest.id)!.lastChange).toBeGreaterThan(state.tasks.get(lines[1]!.id)!.lastChange)
            opened.delete(1)
          }
          break
        case 'assignReview': {
          const id = integer(record(picked(step.picks.subject)!).id)
          const live = id === 3 ? ownSession : hostSession
          const result = yield* Effect.result(operations.child(live.id, lines[id - 1]!, 'Review', staffingAt(state)))
          if (Result.isSuccess(result)) {
            state = result.success.state
            const auth = opened.get(id)
            expect(auth?.review).toEqual(reviewAs(state, lines[id - 1]!, live).review)
            startedTasks.push(id)
          } else {
            expect(result.failure.code).toBe('NoCapacity')
            expect(yield* journal.eventsAfter(before.read)).toEqual([])
            stoppedMutant = kind === 'mutant' && JSON.stringify(step.state.started) !== JSON.stringify(previous.started)
          }
          break
        }
        case 'finish': {
          const id = integer(record(picked(step.picks.subject)!).id)
          const childRun = integer(picked(step.picks.childRun))
          const current = opened.get(id)!
          const actor = id === 3 || childRun === id ? current
            : oldHost ?? { ...current, review: EventNumber.make(1) }
          const result = yield* Effect.result(reportReview(journal, state, 'Holds', lines[id - 1]!, actor))
          if (Result.isSuccess(result)) {
            state = result.success.state
            if (id !== 3) oldHost = current
          } else {
            expect(result.failure.code).toBe('RetiredSession')
            expect(yield* journal.eventsAfter(before.read)).toEqual([])
          }
          break
        }
        default: throw new Error('Unknown review slot action: ' + step.action)
      }
      const feed = yield* projectEvents(journal, page.current()?.read ?? ReadPosition.make(0))
      expect(Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => feed.json())))).toEqual(state)
      compare(stoppedMutant ? previous : step.state, state)
      if (stoppedMutant) break
    }
    expect(stoppedMutant).toBe(kind === 'mutant')
  }))),
))
