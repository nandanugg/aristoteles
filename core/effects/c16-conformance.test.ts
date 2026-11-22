// Replay through the SQLite dispatcher and the same snapshot read used by work wait.
// The model samples one successor of a split. Finish its other parts with ordinary
// accepted acts, and check their pending rechecks separately from the model projection.
import { expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import { dispatchAct } from '../actions/work.ts'
import { modelActOf, tsAct } from '../derived/c16/replay/acts.ts'
import { readTrace } from '../derived/c16/replay/itf.ts'
import { canonical, modelActors, modelCmp, modelTold, storeOf } from '../derived/c16/replay/model.ts'
import {
  actorOfName, advance, canonState, initial, project, start, stepText,
} from '../derived/c16/replay/project.ts'
import { diff, shipResolves } from '../derived/c16/replay/replay.ts'
import { create, type Author, type Time } from '../schema/index.ts'
import { Dir, Env, Now, Store, StoreLive, Tokens } from '../services/index.ts'
import { foldWork } from '../state/c16/fold.ts'
import { epochOf, testRule } from '../state/c16/reads.ts'
import type { WorkState } from '../state/c16/state.ts'
import type { Actor, Body } from '../state/c16/types.ts'
import { inspectWait } from './wait.ts'

const traces = join(import.meta.dir, '../derived/c16/replay/traces')
const names = readdirSync(traces).filter((name) => name.endsWith('.itf.json.gz')).sort()
const harness: Actor = { _tag: 'Harness' }
const human: Actor = { _tag: 'Human' }
const at = '2026-11-21T00:00:00.000Z' as Time
const by = (who: Actor): Author => who._tag === 'Human'
  ? { _tag: 'Person', name: 'Fixture', channel: 'terminal' }
  : { _tag: 'System' }

for (const name of names) {
  test(`store conformance: ${name}`, async () => {
    const trace = readTrace(join(traces, name))
    const dir = mkdtempSync(join(tmpdir(), 'c16-replay-'))
    writeFileSync(join(dir, 'aristoteles.yaml'), '')
    let id = 0
    const env = { ARISTOTELES_DB: join(dir, 'aristoteles.db') }
    const layer = Layer.mergeAll(
      StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env }))),
      Layer.succeed(Dir, { cwd: dir }),
      Layer.succeed(Now, { read: Effect.succeed(at) }),
      Layer.succeed(Tokens, { random: Effect.sync(() => `secret${id}`) }),
    )
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const modelFirst = storeOf(trace.states[0]!.store)
        let ctx = start([...modelFirst.tasks.keys()])
        const seed = initial(ctx.slots)
        const store = yield* (yield* Store).open(dir, { create: true })
        const event = create('Work', {
          _tag: 'Opened',
          hostSession: null,
          top: seed.top,
          items: [...seed.items],
          cards: [...seed.cards, ['sibling', { role: 'sibling', words: 'Split sibling', model: 'fixture' }]],
          maxTries: seed.maxTries,
          tokens: [],
        })
        yield* store.write(() => Effect.succeed({ draft: { at, author: by(human), event }, rows: [] }))
        const read = () => Effect.map(store.events, (events) => foldWork(events)!.state)
        let state = yield* read()
        const append = (who: Actor, body: Body) => Effect.gen(function* () {
          const before: WorkState = state
          const result = yield* Effect.scoped(dispatchAct({
            by: by(who),
            act: { id: `r${++id}`, who, ep: epochOf(before, who), body },
            on: before.seq, build: null, current: 'fixture',
          }))
          if (result.again) throw new Error('unexpected duplicate')
          state = yield* read()
          expect(state.seq).toBe(before.seq + 1)
          expect(project(state, ctx)).toEqual(project(result.state, ctx))
        })
        yield* append(human, { _tag: 'Revive', actor: { _tag: 'Host' } })
        yield* append(harness, { _tag: 'Revive', actor: { _tag: 'Pipe' } })
        for (const role of [...seed.cards.keys(), 'sibling']) {
          yield* append(harness, { _tag: 'Revive', actor: { _tag: 'Role', name: role } })
        }
        for (let i = 0; i < trace.states.length; i++) {
          const frame = trace.states[i]!
          const model = storeOf(frame.store)
          if (i > 0) {
            const pre = storeOf(trace.states[i - 1]!.store)
            const step = modelActOf(frame.action, frame.picks, pre)
            const resolves = step.tag === 'Ship' &&
              shipResolves(trace, i, step.value['fix'] as number)
            const act = tsAct(step, pre, model, state, ctx, i, resolves)
            const before = state
            const body = act.body._tag === 'Evaluate' && act.body.level === 'Split'
              ? { ...act.body, parts: act.body.parts.map((part, j) =>
                j === 0 ? part : { ...part, role: 'sibling' }) }
              : act.body
            yield* append(act.who, body).pipe(Effect.tapError((error) =>
              Effect.sync(() => console.error(name, i, act.body._tag, error))))
            ctx = advance(ctx, before, state)
            for (const task of ctx.ignored) {
              const t = state.tasks.get(task)!
              const role: Actor = { _tag: 'Role', name: t.role }
              if (t.state === 'Sent') {
                yield* append(role, { _tag: 'Open', open: { _tag: 'OpenMake', task } })
                const maker = state.tasks.get(task)!.maker!
                const actor: Actor = { _tag: 'Maker', id: maker }
                yield* append(actor, { _tag: 'ReadBrief', maker })
                const execute = [...state.asks.values()].find((a) => a.kind === 'Execute' &&
                  a.to._tag === 'Maker' && a.to.id === maker)!
                yield* append(actor, {
                  _tag: 'Report', ask: execute.id, output: '', files: [], caught: new Set(),
                })
                const check = [...state.asks.values()].find((a) => a.kind === 'Check' &&
                  a.about._tag === 'Task' && a.about.id === task)!
                yield* append(role, {
                  _tag: 'Review', ask: check.id, verdict: 'Pass', points: [],
                })
              }
              const pending = [...state.tasks.get(task)!.pending]
              const ref = pending.filter((item) => !testRule(state, item))
              if (ref.length) {
                yield* append({ _tag: 'Pipe' }, {
                  _tag: 'RecheckDone', task, items: new Set(ref), holds: true,
                })
              }
              if (pending.some((item) => testRule(state, item))) {
                yield* append(harness, { _tag: 'RunRule', task, holds: true })
              }
            }
          }
          const compared = canonState(state, ctx)
          const differences = diff(canonical(modelCmp(model)), project(compared, ctx))
          if (differences.length) throw new Error(`${name} step ${i}:\n${differences.join('\n')}`)
          for (const who of modelActors(model)) {
            const actor = actorOfName(ctx, who)
            const wait = yield* inspectWait(store, { actor, ep: epochOf(state, actor) })
            const expected = modelTold(model, who)
            if (wait?._tag === 'Step') {
              expect(expected).toContain(stepText(state, ctx, who, wait.step))
              if (wait.step.act === 'Hear') expect(wait.heard?.ask.id).toBe(wait.step.ask!)
            } else {
              expect(expected).toEqual([])
            }
          }
        }
      })).pipe(Effect.provide(layer)))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 30000)
}
