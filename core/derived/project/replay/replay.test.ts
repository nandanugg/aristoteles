import { expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Effect, Result } from 'effect'
import { staffSessionOperations, type Sessions } from '../../../../adapters/live/staff-session.ts'
import { staffCards } from '../../../../adapters/web/app/staff-session.ts'
import { acceptStaffing, readOpenProject, startChild, startSession } from '../../../actions/staff-session.ts'
import { initialStaffing, launchStaff, maker, sharedStaffing } from '../../../../src/store/staff-session.probe.ts'
import { openPageProject, receiveProjectPayload } from '../../../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot } from '../../../../adapters/web/project.ts'
import {
  begin, commandOutcomes, create, open, resultInput, send, session, staff, staffInput, startFixtureSession, taskId, toWorking, withJournal,
} from '../../../../src/store/project.probe.ts'
import { EventNumber, ReadPosition, SessionId, TaskId, type Of, type Projection } from '../../../schema/project.ts'
import { fold, readPosition } from '../../../state/project.ts'
import { readTrace, registeredChecks, replayReportRace } from './driver.ts'

import { replayStaffCapacity, replayStaffReplacementObservations } from './staff.ts'

const root = resolve(import.meta.dir, '../../../..')
const traces = join(import.meta.dir, 'traces')
const check = 'taskReportRace'
const kinds = ['success', 'fault', 'mutant'] as const
const filename = (kind: typeof kinds[number]) => check + '-' + kind + '.itf.json.gz'
const origin = ReadPosition.make(0)

test('the append seam has all three registered trace inputs', () => {
  expect(registeredChecks(root)).toContain(check)
  expect(readdirSync(traces).filter((name) => name.startsWith(check + '-')).sort())
    .toEqual(kinds.map(filename).sort())
  expect(new Set(kinds.map((kind) => readTrace(join(traces, filename(kind)), check, kind).modelRevision)).size).toBe(1)
})

for (const kind of kinds) test('task report race append seam — ' + kind, () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const opened = yield* create(journal)
    const live = yield* startFixtureSession(journal, opened.state)
    const sent = yield* send(journal, readPosition(live.state))
    let current: Projection = sent.state
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    let basis = readPosition(sent.state)
    const trace = readTrace(join(traces, filename(kind)), check, kind)
    const completed = yield* Effect.promise(() => replayReportRace(trace, kind, {
      begin: async () => {
        const committed = await Effect.runPromise(begin(journal, readPosition(current)))
        current = committed.state
        basis = readPosition(current)
      },
      report: async () => {
        const outcome = await Effect.runPromise(Effect.result(staffInput(journal, resultInput(basis))))
        if (Result.isFailure(outcome)) {
          expect(outcome.failure.code).toBe('Stale')
          return 'Refused'
        }
        current = outcome.success.state
        return 'Committed'
      },
      commands: async () => {
        current = (await Effect.runPromise(commandOutcomes(journal, readPosition(current)))).state
      },
      observe: async () => {
        const response = await Effect.runPromise(projectEvents(journal, readPosition(page.current())))
        expect(Result.getOrThrow(receiveProjectPayload(page, await response.json()))).toEqual(current)
        const committed = await Effect.runPromise(journal.eventsAfter(origin))
        const state = Result.getOrThrow(fold(committed))
        expect(state).toEqual(current)
        if (state._tag !== 'Open') throw new Error('The replay has no opened project')
        const task = state.value.tasks.get(taskId)
        if (!task) throw new Error('The replay has no sent task')
        const phase = task.phase
        const attempt = phase._tag === 'Working' ? phase.attempt
          : phase._tag === 'Sent' ? undefined : phase.result.attempt
        const writes = committed.flatMap((event) => {
          const fact = event.input.fact
          return fact._tag === 'Result' ? fact.files.map((file) => Number(file.contents)) : []
        })
        return {
          phase: phase._tag,
          attempt: attempt?.number ?? 0,
          retryCount: phase._tag === 'Sent' ? phase.retryCount : phase._tag === 'Working' ? phase.attempt.retryCount : phase.result.attempt.retryCount,
          writes,
        }
      },
    }))
    expect(completed.guardedFault).toBe(kind === 'mutant')
    const reopened = yield* open(path, 'Read')
    const fresh = Result.getOrThrow(fold(yield* reopened.eventsAfter(origin)))
    expect(readPosition(fresh)).toBe(readPosition(current))
    expect(fresh).toEqual(page.current())
  }))),
))

for (const kind of kinds) test('staff capacity — ' + kind, () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const linked = yield* sharedStaffing(journal)
    const opened = yield* launchStaff(journal, linked, 0, 1)
    const roles = [linked.host, linked.pipeline, maker]
    const ids = initialStaffing().staff.map(({ id }) => id)
    // The model reuses a child tuple after release. A production begin addresses a fresh sent task.
    const drafts = roles.map((role, index) =>
      Array.from({ length: 4 }, (_, copy) => ({ id: TaskId.make('task:' + index + '-' + copy), role })))
    let initial = readPosition(opened.state)
    for (const draft of drafts.flat()) {
      initial = readPosition((yield* send(journal, initial, draft.id, draft.role)).state)
    }
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    const active = new Map<number, Of<typeof TaskId>>()
    const used = new Map<number, number>()
    const versions = new Map([[1, linked.staffingAt]])
    let pendingLifetime = 2
    const trace = readTrace(join(traces, 'staffCapacity-' + kind + '.itf.json.gz'), 'staffCapacity', kind)
    const project = () => Effect.runPromise(readOpenProject(journal))
    const assertUnchanged = async (before: Of<typeof ReadPosition>) => expect((await project()).read).toBe(before)
    yield* Effect.promise(() => replayStaffCapacity(trace, kind, {
      startSession: async (staff, version) => {
        const current = await project()
        const result = await Effect.runPromise(Effect.result(startSession(journal, current, {
          id: SessionId.make('session:' + pendingLifetime++), staff: ids[staff]!, pane: session.pane,
          staffing: versions.get(version) ?? EventNumber.make(current.read + 1),
        })))
        if (Result.isSuccess(result)) return 'Committed'
        await assertUnchanged(current.read)
        if (result.failure.code === 'Stale') return 'Stale'
        expect(['NoCapacity', 'WrongMove']).toContain(result.failure.code)
        return 'Refused'
      },
      startChild: async (role) => {
        const current = await project()
        const copy = used.get(role) ?? 0
        const id = drafts[role]![copy]!.id
        const result = await Effect.runPromise(Effect.result(startChild(
          journal, current, { _tag: 'Task', id }, session, 'Work',
        )))
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe('NoCapacity')
          await assertUnchanged(current.read)
          return false
        }
        active.set(role, id)
        used.set(role, copy + 1)
        return true
      },
      finishChild: async (role) => {
        const current = await project()
        const id = active.get(role)
        if (!id) throw new Error('No started child')
        const input = resultInput(current.read)
        if (input._tag !== 'StaffReport') throw new Error('Wrong test input')
        await Effect.runPromise(staffInput(journal, { ...input, report: { ...input.report, line: { _tag: 'Task', id } } }))
        active.delete(role)
      },
      changePlan: async () => {
        await Effect.runPromise(acceptStaffing(journal, await project(), initialStaffing(1)))
        versions.set(2, (await project()).staffingAt)
      },
      observe: async () => {
        const current = await project()
        const response = await Effect.runPromise(projectEvents(journal, readPosition(page.current())))
        expect(Result.getOrThrow(receiveProjectPayload(page, await response.json()))).toEqual({ _tag: 'Open', value: current })
        const cards = staffCards(page.current())
        const first = cards[0]
        if (!first) throw new Error('Expected the shared staff card')
        const limit = first.capacity.sessionLimit
        if (limit._tag !== 'Limited') throw new Error('Expected a provider limit')
        const children = [...current.tasks.values()].flatMap((task) =>
          task.phase._tag === 'Working' ? [roles.findIndex((role) => role.id === task.role.id)] : [],
        ).sort()
        expect(Number(first.capacity.usedSubagents)).toBe(children.length)
        expect(Number(first.capacity.liveSessions)).toBe([...current.sessions.values()].filter((s) => s._tag === 'Live').length)
        return {
          limit: limit.max,
          children,
          sessions: [...current.sessions.values()].flatMap((live) => live._tag === 'Live' ? [ids.indexOf(live.staff.id)] : []).sort(),
          allowance: cards.map(({ staff }) => staff.subagents),
          assignments: roles.map((role) => cards.findIndex(({ staff }) => staff.roles.some((item) => item.id === role.id))),
        }
      },
    }))
  }))),
))

for (const kind of kinds) test('staff replacement observations — ' + kind, () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal)
    const current = working.state
    if (current._tag !== 'Open') throw new Error('Expected a test project')
    const address = { _tag: 'Session', id: session.id } as const
    const replacement = SessionId.make('session:2')
    let expectedPrior: Of<typeof SessionId> | null = null
    let observation: 'Paused' | 'Ended' = 'Ended'
    let id = session.id
    const provider: Sessions = {
      reconcile: () => Effect.void,
      launch: (_staff, _id, previous) => Effect.sync(() => {
        expect(previous).toBe(expectedPrior)
        return session.pane
      }),
      observe: () => Effect.sync(() => observation),
      child: () => Effect.void,
    }
    const operations = staffSessionOperations(dirname(path), journal, provider)
    const trace = readTrace(join(traces, 'staffReplacement-' + kind + '.itf.json.gz'), 'staffReplacement', kind)
    yield* Effect.promise(() => replayStaffReplacementObservations(trace, {
      retire: async (checkpoint) => {
        observation = checkpoint ? 'Paused' : 'Ended'
        await Effect.runPromise(operations.observe(address))
      },
      replace: async (checkpoint) => {
        expectedPrior = checkpoint ? session.id : null
        await Effect.runPromise(operations.launch(staff.id, replacement, current.value.staffingAt, checkpoint ? address : null))
        id = replacement
      },
      observe: async () => {
        const project = await Effect.runPromise(readOpenProject(journal))
        const actual = project.sessions.get(id)
        if (!actual) throw new Error('Expected a session participant')
        if (id === replacement) expect(project.sessions.get(session.id)?._tag).toBe(observation)
        return [actual._tag, id === replacement ? 2 : 1]
      },
    }))
  }))),
))
