// Fixture ports for exercising the replay before the pass 9 scheduler lands.
// The permit fixture uses the real SQLite store for every C16 act.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import { dispatchAct } from '../actions/work.ts'
import { tsAct } from '../derived/c16/replay/acts.ts'
import { type MStore } from '../derived/c16/replay/model.ts'
import { KEY, advance, canonState, initial, project, start } from '../derived/c16/replay/project.ts'
import { type AdmissionCommand, type PermitsCommand, type RuntimeDriver } from '../derived/pass9/replay/driver.ts'
import { type JournalRow, type RuntimeRow, readJournal } from '../derived/pass9/replay/journal.ts'
import { permitsRead } from '../derived/pass9/replay/runtime-port.ts'
import type { JobPhase } from '../derived/pass9/replay/model.ts'
import type { AdmissionRead, PermitsRead } from '../derived/pass9/replay/project.ts'
import { create, type Author, type Time } from '../schema/index.ts'
import { Dir, Env, Now, Store, StoreLive, Tokens } from '../services/index.ts'
import { foldWork } from '../state/c16/fold.ts'
import { epochOf, testRule } from '../state/c16/reads.ts'
import type { WorkState } from '../state/c16/state.ts'
import { type Actor, type Body } from '../state/c16/types.ts'

export const inProject = async <A>(run: (dir: string) => Promise<A>): Promise<A> => {
  const dir = mkdtempSync(join(tmpdir(), 'pass9-replay-'))
  writeFileSync(join(dir, 'aristoteles.yaml'), '')
  try {
    return await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const recording = () => {
  const rows: JournalRow[] = []
  return {
    rows,
    append: (event: RuntimeRow) => { rows.push({ seq: rows.length + 1, event }) },
    read: () => readJournal(rows),
  }
}

export interface AdmissionFixture {
  readonly pipeCap: number
}

export const fixtureAdmission = (options: AdmissionFixture): RuntimeDriver<AdmissionCommand, AdmissionRead> => {
  const jobs = new Map<number, JobPhase>([[0, 'Owed'], [1, 'Owed'], [2, 'Owed']])
  const fixes = new Set<number>()
  const rechecks = new Set<number>()
  const snap = (event?: AdmissionRead['event']): AdmissionRead => ({
    jobs: [...jobs].map(([id, phase]) => ({ id, phase })),
    fixes: [...fixes], rechecks: [...rechecks], ...(event ? { event } : {}),
  })
  return {
    read: async () => snap(),
    step: async (command) => {
      switch (command.kind) {
        case 'startPipe':
          if (fixes.size >= options.pipeCap) throw new Error('fixture Pipe cap exceeded')
          fixes.add(command.job)
          jobs.set(command.job, 'Held')
          break
        case 'yieldPipe':
          break
        case 'waitPipe':
          return snap({ kind: 'pipeDenied' })
        case 'handToPerson':
        case 'finishPipe':
          fixes.delete(command.job)
          jobs.set(command.job, command.kind === 'finishPipe' ? 'Closed' : 'AwaitPerson')
          break
        case 'decide':
          jobs.set(command.job, command.outcome)
          break
        case 'startRecheck':
          rechecks.add(2)
          jobs.set(2, 'Held')
          break
        case 'finishRecheck':
          rechecks.delete(2)
          jobs.set(2, 'Closed')
          break
      }
      return snap()
    },
  }
}

const at = '2026-11-23T00:00:00.000Z' as Time
const by = (actor: Actor): Author => actor._tag === 'Human'
  ? { _tag: 'Person', name: 'Fixture', channel: 'terminal' } : { _tag: 'System' }

export const withPermitsFixture = async (
  dir: string,
  scenario: 'child' | 'park' | 'defer',
  run: (port: RuntimeDriver<PermitsCommand, PermitsRead>) => Promise<void>,
) => {
  const env = { ARISTOTELES_DB: `${dir}/aristoteles.db` }
  let id = 0
  const layer = Layer.mergeAll(
    StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env }))),
    Layer.succeed(Dir, { cwd: dir }),
    Layer.succeed(Now, { read: Effect.succeed(at) }),
    Layer.succeed(Tokens, { random: Effect.sync(() => `secret${id}`) }),
  )
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    let ctx = start([0, 1], 1)
    const seed = initial(ctx.slots, { sections: ctx.sections, maxTries: 1 })
    const store = yield* (yield* Store).open(dir, { create: true })
    const human: Actor = { _tag: 'Human' }
    const harness: Actor = { _tag: 'Harness' }
    yield* store.write(() => Effect.succeed({
      draft: { at, author: by(human), event: create('Work', {
        _tag: 'Opened', hostSession: null, top: seed.top, items: [...seed.items], cards: [...seed.cards],
        tokens: [], maxTries: seed.maxTries,
      }) }, rows: [],
    }))
    const readState = Effect.map(store.events, (events) => foldWork(events)!.state)
    let state = yield* readState
    const execute = (who: Actor, body: Body) => Effect.gen(function* () {
      const result = yield* Effect.scoped(dispatchAct({
        by: by(who), act: { id: `p${++id}`, who, ep: epochOf(state, who), body },
        on: state.seq, build: null, current: 'pass9-fixture',
      }))
      if (result.again) throw new Error('fixture act already dispatched')
      const next = yield* readState
      if (next.seq !== state.seq + 1) throw new Error('expected one C16 transition')
      ctx = advance(ctx, state, next)
      state = next
    })
    yield* execute(human, { _tag: 'Revive', actor: { _tag: 'Host' } })
    yield* execute(harness, { _tag: 'Revive', actor: { _tag: 'Pipe' } })
    for (const role of seed.cards.keys()) yield* execute(harness, { _tag: 'Revive', actor: { _tag: 'Role', name: role } })

    // Only runtime rows are substituted. The C16 protocol above uses the actual store.
    const journal = recording()
    let parentGeneration = 0
    let activeJob: { id: string; on: number; items: ReadonlyArray<readonly [string, number]> } | null = null
    const worker = (name: string, generation: number) => ({ worker: name, generation, launch: `${name}-${generation}` })
    const parent = () => worker('parent', parentGeneration)
    const launch = (key: ReturnType<typeof parent>, job?: string) => {
      journal.append({ kind: 'WorkerReserved', ...key, slot: `slot-${key.launch}`, ...(job ? { job } : {}) })
      journal.append({ kind: 'WorkerBound', ...key })
    }
    launch(worker('parent', ++parentGeneration))
    const background = scenario === 'child'
    const inspect = (s: WorkState): PermitsRead => {
      const tasks = [...ctx.slotTask].flatMap(([slot, task]) => {
        const found = s.tasks.get(task)
        return found ? [{ slot, task: found }] : []
      })
      const makers = tasks.filter(({ task }) => {
        const maker = task.maker ? s.makers.get(task.maker) : undefined
        return maker !== undefined && !maker.ended && !s.down.has(`maker:${maker.id}`)
      })
      return permitsRead(journal.rows, 'parent', activeJob?.id ?? null, {
        protocol: project(canonState(s, ctx), ctx),
        attempts: tasks.filter(({ task }) => task.state === 'Working' || task.state === 'InReview').map(({ slot }) => slot),
        makerChildren: makers.map(({ slot }) => slot),
        parkSupported: scenario !== 'defer',
        foreground: !background && makers.some(({ task }) => task.state === 'Working'),
      })
    }
    const runAct = (act: Extract<PermitsCommand, { kind: 'act' }>['act']) => {
      if (act.tag === 'AskEdit') return execute(human, {
        _tag: 'AskEdit', draft: new Map([[KEY['D']!, { ...state.items.get(KEY['D']!)!, says: 'Edited direction' }]]),
      })
      // This instance has no injected bad results. The converter only reads model pre/post
      // for those injected outcomes and rule form, so use the actual folded rule forms.
      const before = project(canonState(state, ctx), ctx)
      const ruleForm = new Map(Object.entries(before.ruleForm).map(([k, v]) => [Number(k), v]))
      const actual = { ruleForm, tasks: new Map(), fixes: state.fixes } as unknown as MStore
      const call = tsAct(act, actual, actual, state, ctx, id, false)
      return execute(call.who, call.body)
    }
    yield* Effect.promise(() => run({
      read: async () => inspect(await Effect.runPromise(readState)),
      step: async (command) => {
        if (command.kind === 'act') {
          await Effect.runPromise(runAct(command.act).pipe(Effect.provide(layer)))
          if (command.act.tag === 'RecheckDone' && activeJob !== null) {
            journal.append({ kind: 'Work.Acted', delivery: null, recheck: { job: activeJob.id, report: `report-${activeJob.id}` } })
            activeJob = null
          }
        } else if (command.kind === 'routeRecheck') {
          const next = [...ctx.slotTask].sort(([a], [b]) => a - b).find(([, id]) =>
            state.tasks.get(id)?.state === 'Done' &&
            [...state.tasks.get(id)!.pending].some((item) => !testRule(state, item)))
          if (!next) throw new Error('fixture has no owed recheck')
          const job = `job-${journal.rows.length}`
          const items = [...state.tasks.get(next[1])!.pending].filter((item) => !testRule(state, item))
            .map((item) => [item, state.ver.get(item) ?? 0] as const)
          activeJob = { id: job, on: state.seq, items }
          journal.append({ kind: 'RecheckQueued', job, target: next[0], on: state.seq, items })
          if (scenario === 'child') {
            journal.append({ kind: 'ChildReserved', ...parent(), child: job, subject: next[0], role: 0, job })
            journal.append({ kind: 'ChildBound', ...parent(), child: job })
            journal.append({ kind: 'RecheckHelperBound', job, allocation: job, route: 'child' })
          } else if (scenario !== 'defer') journal.append({ kind: 'CheckpointSaved', job })
        } else {
          if (!activeJob) throw new Error('fixture has no active recheck')
          const { id: job, on, items } = activeJob
          const helper = worker(job, 1)
          switch (command.kind) {
            case 'requestPark':
              if (scenario === 'defer') journal.append({ kind: 'RecheckDeferred', job })
              else journal.append({ kind: 'WorkerParkRequested', ...parent(), job })
              break
            case 'confirmPark':
              journal.append({ kind: 'WorkerParkConfirmed', ...parent(), job })
              break
            case 'capacityOffered':
              journal.append({ kind: 'WorkerEnded', ...parent() })
              break
            case 'failPark':
              journal.append({ kind: 'WorkerParkCancelled', ...parent(), job })
              journal.append({ kind: 'RecheckDeferred', job })
              break
            case 'startFresh':
              launch(helper, job)
              journal.append({ kind: 'RecheckHelperBound', job, allocation: job, route: 'fresh' })
              break
            case 'helperReports':
              journal.append({ kind: 'RecheckReported', job, report: `report-${job}`, on, items })
              if (scenario === 'child') journal.append({ kind: 'ChildReleased', ...parent(), child: job })
              else journal.append({ kind: 'WorkerEnded', ...helper })
              break
            case 'resumeParent':
              launch(worker('parent', ++parentGeneration))
              break
          }
        }
        return inspect(await Effect.runPromise(readState))
      },
    }))
  })).pipe(Effect.provide(layer)))
}
