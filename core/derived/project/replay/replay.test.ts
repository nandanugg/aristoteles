import { expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Effect, Result } from 'effect'
import { openPageProject, receiveProjectPayload } from '../../../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot } from '../../../../adapters/web/project.ts'
import {
  begin, commandOutcomes, create, open, resultInput, send, staffInput, taskId, withJournal,
} from '../../../../src/store/project.probe.ts'
import { ReadPosition, type Projection } from '../../../schema/project.ts'
import { fold, readPosition } from '../../../state/project.ts'
import { readTrace, registeredChecks, replayReportRace } from './driver.ts'

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
    const sent = yield* send(journal, readPosition(opened.state))
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
