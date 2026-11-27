import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { waitOnProject } from '../../adapters/cli/commands/project.ts'
import { resumeSession, startSession, open, session, staff, staffInput, withJournal } from '../../src/store/project.probe.ts'
import { begin, commandOutcomes, resultInput, send, taskKey, taskLine, toWorking } from '../../src/store/task.probe.ts'
import { initialStaffing, launchStaff, sharedStaffing } from '../../src/store/staff-session.probe.ts'
import { staffingAt,
  SessionCount, StaffSessionKey, SubagentCount, TaskKey, capacity, staffByKey, type Staff, type StaffingPlan,
} from '../schema/project.ts'
import { applyEvent, readPosition } from '../state/project.ts'
import { acceptStaffing } from '../../src/store/proposal.probe.ts'
import { observeSession, readOpenProject, startChild } from './staff-session.ts'

const address = session.key
const rejected = (code: string) => ({ _tag: 'Failure', failure: { code } })

test('shared staff covers both roles and a stale staffing plan or a duplicate lifetime refuses', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = yield* sharedStaffing(journal)
    const plan = initialStaffing()
    const [host, other] = [...plan.staff.values()]
    const equalRoles: Staff = { ...other!, roles: host!.roles }
    const noSubagents = { ...host!, subagents: SubagentCount.make(0) }
    expect(yield* Effect.result(acceptStaffing(journal, project, { ...plan, staff: new Map([[noSubagents.key, noSubagents], [other!.key, other!]]) })))
      .toMatchObject(rejected('StaffingMinimum'))
    expect(yield* Effect.result(acceptStaffing(journal, project, { ...plan, staff: new Map([[host!.key, host!], [equalRoles.key, equalRoles]]) })))
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
    expect(staffByKey(changed, staff.key)?.roles).toHaveLength(2)
    expect(staffingAt(changed) > readPosition(launched.state)).toBe(true)
    expect((yield* readOpenProject(journal)).read).toBe(changed.read)
  }))),
))

test('pause retires authority, releases charges, and resumes the same attempt with a new session', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal)
    const project = yield* readOpenProject(journal)
    expect(yield* waitOnProject(journal, Effect.succeed(session.key))).toMatchObject({ _tag: 'Available' })
    yield* observeSession(journal, project, address, 'Paused')
    const paused = yield* readOpenProject(journal)
    expect(paused.sessions.get(session.key)?._tag).toBe('Paused')
    expect(Number(capacity(paused, staff).liveSessions)).toBe(0)
    expect(yield* Effect.result(waitOnProject(journal, Effect.succeed(session.key)))).toMatchObject(rejected('RetiredSession'))
    const continued = { ...session, key: StaffSessionKey.make('session:2') }
    yield* resumeSession(journal, paused, address, {
      key: continued.key, pane: continued.pane, staffing: staffingAt(paused),
    })
    const resumed = yield* readOpenProject(journal)
    expect(resumed.sessions.get(session.key)?._tag).toBe('Paused')
    expect(resumed.tasks.get(taskKey)?.phase).toMatchObject({ _tag: 'Working', attempt: { number: 1, actor: { key: continued.key } } })
    expect(yield* Effect.result(staffInput(journal, resultInput(resumed.read), session))).toMatchObject(rejected('RetiredSession'))
    expect(yield* Effect.result(staffInput(journal, resultInput(readPosition(working.state)), continued))).toMatchObject(rejected('Stale'))
    const reported = yield* staffInput(journal, resultInput(resumed.read), continued)
    expect(reported.event.actor).toEqual({ _tag: 'Session', key: continued.key })
    expect(applyEvent(resumed, {
      ...reported.event, actor: { _tag: 'Session', key: session.key },
    })).toMatchObject(rejected('RetiredSession'))
    expect((yield* readOpenProject(journal)).read).toBe(reported.state.read)
  }))),
))

test('confirmed crash restarts Working, keeps reviewed output and makes assigned reviews wait', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal)
    const result = yield* staffInput(journal, resultInput(readPosition(working.state)))
    yield* commandOutcomes(journal, readPosition(result.state))
    const project = yield* readOpenProject(journal)
    yield* startChild(journal, project, taskLine.key, session, 'Review')
    const ongoing = TaskKey.make('task:ongoing')
    const sent = yield* send(journal, (yield* readOpenProject(journal)).read, ongoing)
    yield* startChild(journal, yield* readOpenProject(journal), ongoing, session, 'Work')
    const before = yield* readOpenProject(journal)
    expect(Number(capacity(before, staff).usedSubagents)).toBe(2)
    yield* observeSession(journal, before, address, 'Ended')
    const after = yield* readOpenProject(journal)
    expect(after.read).not.toBe(readPosition(sent.state))
    expect(after.sessions.get(session.key)?._tag).toBe('Ended')
    expect(after.tasks.get(ongoing)?.phase).toMatchObject({ _tag: 'Sent', retryCount: 0 })
    expect(after.tasks.get(ongoing)?.lastAttempt).toMatchObject({ _tag: 'Attempted', number: 1 })
    const previous = before.tasks.get(taskKey)?.phase
    const released = after.tasks.get(taskKey)?.phase
    if (previous?._tag !== 'Reviewing') throw new Error('The review must already be assigned')
    expect(released).toEqual({ ...previous, assignment: { _tag: 'Waiting' } })
    expect(Number(capacity(after, staff).usedSubagents)).toBe(0)
    const continued = { ...session, key: StaffSessionKey.make('session:2') }
    yield* startSession(journal, after, { key: continued.key, staff: continued.staff.key, pane: continued.pane, staffing: staffingAt(after) })
    const latest = yield* readOpenProject(journal)
    yield* startChild(journal, latest, ongoing, continued, 'Work')
    expect((yield* readOpenProject(journal)).tasks.get(ongoing)?.phase).toMatchObject({
      _tag: 'Working', attempt: { number: 2, retryCount: 0, actor: { key: continued.key } },
    })
    expect(yield* Effect.result(begin(journal, latest.read))).toMatchObject(rejected('RetiredSession'))
  }))),
))
