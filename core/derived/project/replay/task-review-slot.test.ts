import { expect, test } from 'bun:test'
import { dirname, join, resolve } from 'node:path'
import { Effect, Result, Schema } from 'effect'
import { staffSessionOperations } from '../../../../adapters/live/staff-session.ts'
import { openPageProject, receiveProjectPayload } from '../../../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot } from '../../../../adapters/web/project.ts'
import { startWork } from '../../../../src/store/project-activation.probe.ts'
import { create, host, open, pipeline, role, session, staff, staffInput, subscription, startFixtureSession, startSession, withJournal } from '../../../../src/store/project.probe.ts'
import { acceptStaffing } from '../../../../src/store/proposal.probe.ts'
import { activateTasks, promptDirection, reportReview, resultInput, reviewAs, send } from '../../../../src/store/task.probe.ts'
import { observeSession } from '../../../actions/staff-session.ts'
import { recordTaskCommands } from '../../../actions/task.ts'
import {
  Direction, EventNumber, ReadPosition, StaffSessionKey, Staff, TaskKey, staffingAt, subagentCapacity,
  type LiveSession, type Project,
} from '../../../schema/project.ts'
import { picked } from './itf.probe.ts'
import { integer, readTrace, record, registeredChecks } from './driver.ts'

const check = 'reviewSlot'
const kinds = ['success', 'fault', 'mutant'] as const
const workRole = role('maker')
const hostStaff = Staff.make({ ...staff, roles: [host], subagents: Schema.decodeUnknownSync(Staff.fields.subagents)(1) })
const ownStaff = Schema.decodeUnknownSync(Staff)({ ...staff, key: 'staff:own', roles: [pipeline], subagents: 1 })
const queuedStaff = Schema.decodeUnknownSync(Staff)({ ...staff, key: 'staff:queue', roles: [workRole], subagents: 0 })
const ownKey = StaffSessionKey.make('session:own')
const firstHost = { ...session, staff: hostStaff }
const ownSession = { ...session, key: ownKey, staff: ownStaff }
const lines = [1, 2, 3, 4].map((key) => ({ line: 'Task', key: TaskKey.make('task:slot-' + key) } as const))
const direction = Schema.decodeUnknownSync(Direction)({
  ...promptDirection,
  stages: [promptDirection.stages[0], { ...promptDirection.stages[0], role: pipeline }],
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
      staff: new Map([hostStaff, ownStaff, queuedStaff].map((staff) => [staff.key, staff])), subscriptions: new Map([[subscription.key, subscription]]),
    })
    const active = yield* activateTasks(journal, staffed, direction)
    const started = yield* startWork(journal, active)
    const live = yield* startFixtureSession(journal, started.state)
    let state = (yield* startSession(journal, live.state, {
      key: ownKey, staff: ownStaff.key, pane: session.pane, staffing: staffingAt(live.state),
    })).state
    let hostSession: LiveSession = firstHost
    const opened = new Map<number, ReturnType<typeof reviewAs>>()
    const operations = staffSessionOperations(dirname(path), journal, {
      reconcile: () => Effect.void,
      stop: () => Effect.void,
      launch: () => Effect.succeed(session.pane),
      observe: () => Effect.succeed('Running'),
      child: (live, taskKey, child) => Effect.sync(() => {
        if (child._tag !== 'Review') return
        opened.set(lines.findIndex(({ key }) => taskKey === key) + 1, { _tag: 'Review', session: live, line: 'Task', key: taskKey, review: child.review })
      }),
    })
    for (const [i, line] of lines.slice(0, 3).entries()) {
      const sent = yield* send(journal, state.read, line.key, host, i === 2 ? pipeline : workRole)
      const working = yield* staffInput(journal, { read: sent.state.read, ...line, move: 'next', input: {} }, hostSession)
      const result = yield* staffInput(journal, { ...resultInput(working.state.read), ...line }, hostSession)
      state = (yield* recordTaskCommands(journal, line.key, result.state.read, [])).state
    }
    const busy = lines[3]!
    const sent = yield* send(journal, state.read, busy.key, pipeline)
    state = (yield* operations.child(ownKey, busy.key, 'Work', staffingAt(sent.state))).state

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
        const phase = project.tasks.get(line.key)?.phase
        if (modeled === undefined) expect(phase?._tag).toBe('Done')
        else if (modeled === 'Waiting') expect(phase).toMatchObject({ _tag: 'Reviewing', assignment: { _tag: 'Waiting' } })
        else {
          if (phase?._tag !== 'Reviewing' || phase.assignment._tag !== 'Assigned') throw new Error('Expected an assigned review')
          expect(project.sessions.get(phase.assignment.actor.key)?.staff.key)
            .toBe(record(modeled).value === 0 ? hostStaff.key : ownStaff.key)
        }
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
          state = (yield* staffInput(journal, { ...resultInput(state.read), ...busy }, ownSession)).state
          break
        case 'editOlder':
          if (startedTasks.length === 0) {
            // An interrupted assignment touches the older task after the newer one, preserving its entry event.
            const oldest = lines[0]!
            const assigned = yield* operations.child(hostSession.key, oldest.key, 'Review', staffingAt(state))
            const retired = yield* observeSession(journal, assigned.state, hostSession.key, 'Ended')
            hostSession = { ...firstHost, key: StaffSessionKey.make('session:review-replacement') }
            state = (yield* startSession(journal, retired.state, {
              key: hostSession.key, staff: hostStaff.key, pane: session.pane, staffing: staffingAt(retired.state),
            })).state
            expect(state.tasks.get(oldest.key)!.lastChange).toBeGreaterThan(state.tasks.get(lines[1]!.key)!.lastChange)
            opened.delete(1)
          }
          break
        case 'assignReview': {
          const key = integer(record(picked(step.picks.subject)!).id)
          const live = key === 3 ? ownSession : hostSession
          const result = yield* Effect.result(operations.child(live.key, lines[key - 1]!.key, 'Review', staffingAt(state)))
          if (Result.isSuccess(result)) {
            state = result.success.state
            const auth = opened.get(key)
            expect(auth?.review).toEqual(reviewAs(state, lines[key - 1]!, live).review)
            startedTasks.push(key)
          } else {
            expect(result.failure.code).toBe('NoCapacity')
            expect(yield* journal.eventsAfter(before.read)).toEqual([])
            stoppedMutant = kind === 'mutant' && JSON.stringify(step.state.started) !== JSON.stringify(previous.started)
          }
          break
        }
        case 'finish': {
          const key = integer(record(picked(step.picks.subject)!).id)
          const childRun = integer(picked(step.picks.childRun))
          const current = opened.get(key)!
          const actor = key === 3 || childRun === key ? current
            : oldHost ?? { ...current, review: EventNumber.make(1) }
          const result = yield* Effect.result(reportReview(journal, state, 'Holds', lines[key - 1]!, actor))
          if (Result.isSuccess(result)) {
            state = result.success.state
            if (key !== 3) oldHost = current
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
