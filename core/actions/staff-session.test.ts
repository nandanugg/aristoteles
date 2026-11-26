import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { waitOnProject } from '../../adapters/cli/commands/wait.ts'
import { open, session, staff, staffInput, withJournal } from '../../src/store/project.probe.ts'
import { begin, commandOutcomes, resultInput, send, taskId, taskLine, toWorking } from '../../src/store/task.probe.ts'
import { initialStaffing, launchStaff, sharedStaffing } from '../../src/store/staff-session.probe.ts'
import {
  SessionCount, SessionId, SubagentCount, TaskId, capacity, type Staff, type StaffingPlan,
} from '../schema/project.ts'
import { readPosition } from '../state/project.ts'
import { acceptStaffing } from '../../src/store/proposal.probe.ts'
import { observeSession, readOpenProject, resumeSession, startChild, startSession } from './staff-session.ts'

const address = { _tag: 'Session', id: session.id } as const
const rejected = (code: string) => ({ _tag: 'Failure', failure: { code } })

test('shared staff covers both roles and a stale staffing plan or a duplicate lifetime refuses', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = yield* sharedStaffing(journal)
    const plan = initialStaffing()
    const equalRoles: Staff = { ...plan.staff[1]!, roles: plan.staff[0].roles }
    const noSubagents = { ...plan.staff[0], subagents: SubagentCount.make(0) }
    expect(yield* Effect.result(acceptStaffing(journal, project, { ...plan, staff: [noSubagents, plan.staff[1]!] })))
      .toMatchObject(rejected('StaffingMinimum'))
    expect(yield* Effect.result(acceptStaffing(journal, project, { ...plan, staff: [plan.staff[0], equalRoles] })))
      .toMatchObject(rejected('InvalidInput'))
    const launched = yield* launchStaff(journal, project, 0, 1)
    const current = yield* readOpenProject(journal)
    const subscription = {
      ...plan.subscriptions[0], sessions: { _tag: 'Limited', max: SessionCount.make(1) },
    } as const
    const fewer: StaffingPlan = { ...plan, subscriptions: [subscription] }
    yield* acceptStaffing(journal, current, fewer)
    expect(yield* Effect.result(launchStaff(journal, project, 1, 2))).toMatchObject(rejected('Stale'))
    const changed = yield* readOpenProject(journal)
    expect(yield* Effect.result(launchStaff(journal, changed, 1, 2))).toMatchObject(rejected('NoCapacity'))
    expect(yield* Effect.result(launchStaff(journal, changed, 0, 2))).toMatchObject(rejected('WrongMove'))
    expect(changed.staff.get(staff.id)?.roles).toHaveLength(2)
    expect(changed.staffingAt > readPosition(launched.state)).toBe(true)
    expect((yield* readOpenProject(journal)).read).toBe(changed.read)
  }))),
))

test('pause retires authority, releases charges, and resumes the same attempt with a new session', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal)
    const project = yield* readOpenProject(journal)
    expect(yield* waitOnProject(journal, Effect.succeed(session.id))).toMatchObject({ _tag: 'Available' })
    yield* observeSession(journal, project, address, 'Paused')
    const paused = yield* readOpenProject(journal)
    expect(paused.sessions.get(session.id)?._tag).toBe('Paused')
    expect(Number(capacity(paused, staff).liveSessions)).toBe(0)
    expect(yield* Effect.result(waitOnProject(journal, Effect.succeed(session.id)))).toMatchObject(rejected('RetiredSession'))
    const continued = { ...session, id: SessionId.make('session:2') }
    yield* resumeSession(journal, paused, address, {
      id: continued.id, pane: continued.pane, staffing: paused.staffingAt,
    })
    const resumed = yield* readOpenProject(journal)
    expect(resumed.sessions.get(session.id)?._tag).toBe('Paused')
    expect(resumed.tasks.get(taskId)?.phase).toMatchObject({ _tag: 'Working', attempt: { number: 1, session: { id: continued.id } } })
    expect(yield* Effect.result(staffInput(journal, resultInput(resumed.read), session))).toMatchObject(rejected('RetiredSession'))
    expect(yield* Effect.result(staffInput(journal, resultInput(readPosition(working.state)), continued))).toMatchObject(rejected('Stale'))
    yield* staffInput(journal, resultInput(resumed.read), continued)
  }))),
))

test('confirmed crash restarts Working, keeps reviewed output and makes assigned reviews wait', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal)
    const result = yield* staffInput(journal, resultInput(readPosition(working.state)))
    yield* commandOutcomes(journal, readPosition(result.state))
    const project = yield* readOpenProject(journal)
    yield* startChild(journal, project, taskLine, session, 'Review')
    const ongoing = TaskId.make('task:ongoing')
    const sent = yield* send(journal, (yield* readOpenProject(journal)).read, ongoing)
    yield* startChild(journal, yield* readOpenProject(journal), { _tag: 'Task', id: ongoing }, session, 'Work')
    const before = yield* readOpenProject(journal)
    expect(Number(capacity(before, staff).usedSubagents)).toBe(2)
    yield* observeSession(journal, before, address, 'Ended')
    const after = yield* readOpenProject(journal)
    expect(after.read).not.toBe(readPosition(sent.state))
    expect(after.sessions.get(session.id)?._tag).toBe('Ended')
    expect(after.tasks.get(ongoing)?.phase).toMatchObject({ _tag: 'Sent', retryCount: 0 })
    expect(after.tasks.get(ongoing)?.attempts).toMatchObject({ _tag: 'PreviouslyWorked', last: 1 })
    const previous = before.tasks.get(taskId)?.phase
    const released = after.tasks.get(taskId)?.phase
    if (previous?._tag !== 'Reviewing') throw new Error('The review must already be assigned')
    expect(released).toEqual({ ...previous, by: null, review: null })
    expect(Number(capacity(after, staff).usedSubagents)).toBe(0)
    const continued = { ...session, id: SessionId.make('session:2') }
    yield* startSession(journal, after, { id: continued.id, staff: continued.staff.id, pane: continued.pane, staffing: after.staffingAt })
    const latest = yield* readOpenProject(journal)
    yield* startChild(journal, latest, { _tag: 'Task', id: ongoing }, continued, 'Work')
    expect((yield* readOpenProject(journal)).tasks.get(ongoing)?.phase).toMatchObject({
      _tag: 'Working', attempt: { number: 2, retryCount: 0, session: { id: continued.id } },
    })
    expect(yield* Effect.result(begin(journal, latest.read))).toMatchObject(rejected('RetiredSession'))
  }))),
))
