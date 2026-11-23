// Fixture ports for exercising the replay before the pass 9 scheduler lands.
// The permit fixture uses the real SQLite store for every C16 act.
import { Effect, Layer } from 'effect'
import { dispatchAct } from '../actions/work.ts'
import { tsAct } from '../derived/c16/replay/acts.ts'
import { type MStore } from '../derived/c16/replay/model.ts'
import { KEY, advance, canonState, initial, project, start } from '../derived/c16/replay/project.ts'
import { type AdmissionCommand, type PermitsCommand, type RuntimeDriver, type WorkerCommand } from '../derived/pass9/replay/driver.ts'
import { type JournalRow, type RuntimeRow, readJournal } from '../derived/pass9/replay/journal.ts'
import { permitsRead, workerDriver } from '../derived/pass9/replay/runtime-port.ts'
import type { Identity, JobPhase, TaskPhase } from '../derived/pass9/replay/model.ts'
import type { AdmissionRead, Owed, PermitsRead, Turn, WorkerObservation } from '../derived/pass9/replay/project.ts'
import { create, type Author, type Time } from '../schema/index.ts'
import { Dir, Env, Now, Store, StoreLive, Tokens } from '../services/index.ts'
import { foldWork } from '../state/c16/fold.ts'
import { epochOf, testRule } from '../state/c16/reads.ts'
import type { WorkState } from '../state/c16/state.ts'
import type { Actor, Body } from '../state/c16/types.ts'

const recording = () => {
  const rows: JournalRow[] = []
  return {
    rows,
    append: (event: RuntimeRow) => { rows.push({ seq: rows.length + 1, event }) },
    read: () => readJournal(rows),
  }
}

export const fixtureWorker = (): RuntimeDriver<WorkerCommand, WorkerObservation> => {
  const journal = recording()
  const owed = new Map<Identity, Owed>()
  let generation = 0
  let age = 0
  let printed: WorkerObservation['read']['printed'] = null
  const launch = () => ({ worker: 'fixture', generation, launch: `launch-${generation}` })
  const start = () => {
    generation++
    journal.append({ kind: 'WorkerReserved', ...launch(), slot: 'one' })
    journal.append({ kind: 'WorkerBound', ...launch() })
  }
  start()
  const snapshot = () => journal.read().worker('fixture', { owed: [...owed.values()], printed })
  return workerDriver({
    read: async () => ({ worker: 'fixture', rows: [...journal.rows], owed: [...owed.values()], printed }),
    perform: async (command) => {
      const before = snapshot()
      switch (command.kind) {
        case 'offer':
          owed.set(command.identity, { actor: command.identity, obligation: `ob-${++age}`, age, ready: true })
          break
        case 'withdraw':
          if (before.activeTurn?.actor === command.identity) journal.append({
            kind: 'TurnClosed', worker: before.worker, generation, turn: before.activeTurn.turn,
          })
          owed.delete(command.identity)
          break
        case 'printOldest': {
          const oldest = owed.values().next().value
          if (!oldest || before.activeTurn || before.session !== 'Online') throw new Error('fixture cannot issue a wait')
          const scope: Turn = {
            worker: 'fixture', actor: oldest.actor, obligation: oldest.obligation, generation,
            epoch: 0, turn: `turn-${++age}`, on: age, step: 'fixture',
          }
          journal.append({ kind: 'TurnOffered', scope })
          printed = { scope, tokenActor: scope.actor, tokenEpoch: scope.epoch }
          break
        }
        case 'submit': {
          const requested = printed?.scope ?? null
          if (!requested) throw new Error('fixture has no printed receipt')
          const accepted = before.activeTurn?.turn === requested.turn && before.session === 'Online'
          if (accepted) {
            owed.delete(requested.actor)
            journal.append({ kind: 'Work.Acted', delivery: requested })
          }
          printed = null
          return {
            requested, outcome: accepted ? 'taken' : 'refused',
            credential: { actor: requested.actor, epoch: requested.epoch, generation: requested.generation },
            ...(accepted ? {} : { refused: requested.generation === generation ? 'stale' : 'epoch' }),
          }
        }
        case 'exit':
          journal.append({ kind: 'WorkerFenced', ...launch() })
          journal.append({ kind: 'WorkerEnded', ...launch() })
          break
        case 'park':
          journal.append({ kind: 'RecheckQueued', job: 'park', target: 0, on: 0, items: [] })
          journal.append({ kind: 'CheckpointSaved', job: 'park' })
          journal.append({ kind: 'WorkerParkRequested', ...launch(), job: 'park' })
          journal.append({ kind: 'WorkerParkConfirmed', ...launch(), job: 'park' })
          break
        case 'relaunch':
          start()
          break
      }
      return undefined
    },
  })
}

export interface AdmissionFixture {
  readonly kind: 'pipe' | 'saturation' | 'collocated'
  readonly pipeCap: number
  readonly childAllowance: number
}

export const fixtureAdmission = (options: AdmissionFixture): RuntimeDriver<AdmissionCommand, AdmissionRead> => {
  const tasks = new Map<number, TaskPhase>(options.kind === 'pipe' ? [] : [[0, 'Queued'], [1, 'Queued']])
  const jobs = new Map<number, JobPhase>(options.kind === 'pipe' ? [[0, 'Owed'], [1, 'Owed'], [2, 'Owed']] : [])
  const owner = (task: number) => options.kind === 'collocated' ? task : 0
  const attempts = new Map<number, number>()
  const children = new Map<number, number>()
  const serial = new Set<number>()
  const fixes = new Set<number>()
  const rechecks = new Set<number>()
  const snap = (event?: AdmissionRead['event']): AdmissionRead => ({
    tasks: [...tasks].map(([id, phase]) => ({ id, phase, owner: owner(id) })),
    jobs: [...jobs].map(([id, phase]) => ({ id, phase })),
    attempts: [...attempts].map(([subject, owner]) => ({ subject, owner })),
    children: [...children].map(([subject, owner]) => ({ subject, owner })),
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
        case 'openMake': {
          const r = owner(command.task)
          const used = [...children.values()].filter((n) => n === r).length
          if (options.childAllowance === 0) {
            tasks.set(command.task, 'Serial')
          } else {
            if (used >= options.childAllowance) throw new Error('fixture child allowance exceeded')
            children.set(command.task, r)
            tasks.set(command.task, 'Child')
          }
          attempts.set(command.task, r)
          break
        }
        case 'endMaker':
          if (tasks.get(command.task) === 'Serial' && command.outcome === 'Checking') serial.add(command.task)
          tasks.set(command.task, command.outcome)
          children.delete(command.task)
          break
        case 'releaseAttempt': {
          const serialReviewed = serial.delete(command.task) && command.outcome === 'Finished'
          tasks.set(command.task, command.outcome)
          attempts.delete(command.task)
          children.delete(command.task)
          if (serialReviewed) return snap({ kind: 'serialReviewed' })
          break
        }
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
  scenario: 'child' | 'serial' | 'admission' | 'park' | 'defer',
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
    const serial = scenario === 'serial'
    const background = scenario === 'child' || scenario === 'admission'
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
        makerChildren: serial ? [] : makers.map(({ slot }) => slot),
        parkSupported: scenario !== 'defer',
        foreground: (serial || !background) && makers.some(({ task }) => task.state === 'Working'),
      })
    }
    const runAct = (act: Extract<PermitsCommand, { kind: 'act' }>['act']) => {
      if (act.tag === 'AskEdit') return execute(human, {
        _tag: 'AskEdit', draft: new Map([[KEY['D']!, { ...state.items.get(KEY['D']!)!, says: 'Edited direction' }]]),
      })
      // This instance has no injected bad results. The converter only reads model pre/post
      // for those injected outcomes and rule form, so use the actual folded rule forms.
      const before = inspect(state).protocol
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
