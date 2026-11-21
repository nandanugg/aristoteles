// The replay of a model trace on the TS core. From the mapped initial state, for every step it
// establishes:
//   - the TS `refusal` accepts the act the model took (an act that is too strict is found);
//   - the TS state after `take` projects to the model's next state on the compared fields (model.ts
//     Cmp: the ghosts, canon's counters and the ended makers are not compared);
//   - `dos` of every actor is the model's told steps, as sets;
//   - the waitsFor relation of the TS asks is the model's, and every owed item has the model's
//     owner (the actors told a step that discharges it, the alternation of answers left out).
// It does not establish:
//   - the order of what an actor is told or what is owed (oldest first): sets only (the full-state
//     tests in fullstate.test.ts cover occurrence ids and the order);
//   - that a guard is not too weak: the model takes only acts it accepts, so an act the core
//     should refuse is not offered (the unit tests and mutate.sh cover that);
//   - the basis, the version sum and the epoch of an act: they are read from the TS state, so the
//     stale-basis and epoch fences are the unit tests' (accept.test.ts) and mutate.sh's;
//   - that the evidence an act carries (a Ship's resolvesFight, the harness's caught, holds,
//     own, contra) is present, current or from the right candidate: the replay supplies it from
//     the model's truths;
//   - the siblings of a split: the model's single successor is the first part, and the other parts
//     are held Done with their asks removed in the continuation state (project.ts canonState), so
//     the replay says nothing of their asks, obligations or told steps.
import { take } from '../../../state/c16/effect.ts'
import { refusal } from '../accept.ts'
import { modelActOf, toldTextOf, tsAct } from './acts.ts'
import type { Trace } from './itf.ts'
import {
  type Cmp,
  canonical,
  modelActors,
  modelCmp,
  modelOwed,
  modelTold,
  modelWaits,
  storeOf,
} from './model.ts'
import { advance, canonState, initial, owedTexts, project, start, told, waits } from './project.ts'

// The differing leaves of two values: `path: model | ts`.
export const diff = (model: unknown, ts: unknown, path = ''): ReadonlyArray<string> => {
  if (JSON.stringify(model) === JSON.stringify(ts)) return []
  const isRec = (x: unknown): x is { readonly [k: string]: unknown } =>
    typeof x === 'object' && x !== null && !Array.isArray(x)
  if (isRec(model) && isRec(ts)) {
    return [...new Set([...Object.keys(model), ...Object.keys(ts)])].flatMap((k) =>
      diff(model[k], ts[k], `${path}.${k}`)
    )
  }
  return [`${path}: ${JSON.stringify(model)} | ${JSON.stringify(ts)}`]
}

export interface Replayed {
  readonly steps: number
}

// The model chooses resolvesFight at the person's accept; the TS core records it at the Ship that
// made the draft (the draft at the person is fixed since). So a Ship takes the value of the first
// accept of that fix after it, before the fix ships again.
const shipResolves = (trace: Trace, at: number, fix: number): boolean => {
  for (let j = at + 1; j < trace.states.length; j++) {
    const pre = storeOf(trace.states[j - 1]!.store)
    const m = modelActOf(trace.states[j]!.action, trace.states[j]!.picks, pre)
    if (m.tag === 'Ship' && m.value['fix'] === fix) return false
    if (m.tag === 'Respond' && m.value['reply'] === 'AcceptIt' &&
        (m.value['ask'] as unknown as { about: number }).about === fix) {
      return m.value['resolvesFight'] === true
    }
  }
  return false
}

export const replay = (trace: Trace): Replayed => {
  const first = storeOf(trace.states[0]!.store)
  let ctx = start([...first.tasks.keys()])
  let s = initial(ctx.slots)
  const fail = (step: number, what: string, lines: ReadonlyArray<string>): never => {
    throw new Error(`${trace.instance} step ${step}: ${what}\n  ${lines.join('\n  ')}`)
  }
  const compare = (step: number, model: ReturnType<typeof storeOf>): void => {
    const cmp: Cmp = canonical(modelCmp(model))
    const lines = diff(cmp, project(s, ctx))
    if (lines.length > 0) fail(step, 'the state differs from the model (model | ts)', lines)
    const edges = diff(modelWaits(model), waits(s, ctx), 'waitsFor')
    if (edges.length > 0) fail(step, 'who waits for whom differs (model | ts)', edges)
    const owners = diff(modelOwed(model), owedTexts(s, ctx), 'owed')
    if (owners.length > 0) fail(step, 'what is owed, and by whom, differs (model | ts)', owners)
    const tolds = modelActors(model).flatMap((who) =>
      diff(modelTold(model, who), told(s, ctx, who), who)
    )
    if (tolds.length > 0) fail(step, 'what is told differs from the model (model | ts)', tolds)
  }
  compare(0, first)
  for (let i = 1; i < trace.states.length; i++) {
    const pre = storeOf(trace.states[i - 1]!.store)
    const post = storeOf(trace.states[i]!.store)
    const { action, picks } = trace.states[i]!
    const m = modelActOf(action, picks, pre)
    const said = toldTextOf(m)
    if (said !== null && !modelTold(pre, m.who).includes(said)) {
      fail(i, `the model took ${said}, which its told steps of ${m.who} do not hold`, [
        ...modelTold(pre, m.who),
      ])
    }
    const resolvesFight = m.tag === 'Ship' && shipResolves(trace, i, m.value['fix'] as number)
    const act = tsAct(m, pre, post, s, ctx, i, resolvesFight)
    const refused = refusal(s, act)
    if (refused !== null) {
      fail(i, `the TS core refuses what the model took: ${refused}`, [JSON.stringify(m)])
    }
    const next = take(s, act)
    ctx = advance(ctx, s, next)
    s = canonState(next, ctx)
    compare(i, post)
  }
  return { steps: trace.states.length - 1 }
}
