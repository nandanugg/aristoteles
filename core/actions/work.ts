// The new path of the work model (P2): the person opens the top, and each act of an actor is one
// event, checked against the folded state by `refusal` (core/derived/work/accept.ts) inside the
// store write. An act id is stored once: a second copy gets the first outcome (G3 firstTime).
import { Effect } from 'effect'
import { currentOf, officialAt } from '../derived/reads.ts'
import { type Refusal as Check, cur, dirBased, refusal } from '../derived/work/accept.ts'
import {
  type Author,
  create,
  type Draft,
  type FlowStep,
  isMarked,
  isSpot,
  type Recorded,
  type Work,
  writtenBy,
} from '../schema/index.ts'
import { Dir, Now, sha, Store, Tokens, type ReaderRow } from '../services/index.ts'
import { fold } from '../state/index.ts'
import { foldWork } from '../state/work/fold.ts'
import { take } from '../state/work/effect.ts'
import { testRule, vsum } from '../state/work/items.ts'
import { epOf } from '../state/work/reads.ts'
import type {
  Act,
  Actor,
  Example,
  ItemKey,
  ItemRec,
  RoleDraft,
  Versions,
  What,
  WorkState,
} from '../state/work/types.ts'
import { HOST, makerActor, PIPE, roleActor } from '../state/work/types.ts'
import { folding, STORE } from './dispatch.ts'
import { no } from './support.ts'
import type { Refusal } from './types.ts'

const TRIES = 3

// What the actor writes: its id, who and epoch, the What, and the basis `on`: the seq of the view
// the act was derived from (null: none; the store refuses an act that needs one). The store sets
// the act's seen, seenVer and vers from that view. build: the build of the page that made the act
// (null: the CLI has none); current: the build of the code now.
export interface ActCall {
  readonly by: Author
  readonly act: Pick<Act, 'id' | 'who' | 'ep' | 'what'>
  readonly on: number | null
  readonly build: string | null
  readonly current: string
}
// A token the act made: the actor, its epoch and the secret (the store keeps only the hash).
export interface NewToken {
  readonly actor: Actor
  readonly ep: number
  readonly secret: string
}
// seq: the event that holds the act (the first copy's, when again); token: null on a copy.
export interface Acted {
  readonly seq: number
  readonly state: WorkState
  readonly again: boolean
  readonly token: NewToken | null
}

export const WORK = {
  noTop: () =>
    no('no top is open', 'Wait', 'the person opens the top (work open), then act again'),
  noPipeline: () =>
    no(
      'no role is the pipeline',
      'Escalate',
      'the person marks one persistent role with pipeline: true in aristoteles.yaml',
    ),
  open: () => no('the top is open already', 'Pick', 'act on the open top'),
  future: (on: number, seq: number) =>
    no(`--on ${on} is ahead of the state (${seq} acts taken)`, 'Pick', 'copy the --on of the step'),
  noBasis: (tag: string) =>
    no(`${tag} needs the basis of its step`, 'Pick', 'copy the --on <n> of the step you were told'),
  // The words of each check of `refusal`, and what the actor does next.
  checks: (c: Check, who: Actor, tag: string): Refusal => {
    switch (c) {
      case 'ended':
        return no('the project has ended', 'Escalate', 'the person starts a new project')
      case 'authority':
        return no(`${who} does not act ${tag}`, 'Escalate', 'leave the act to its own actor')
      case 'epoch':
        return no(`the token of ${who} is of an old epoch`, 'Pick', 'take the actor current token')
      case 'legal':
        return no(`${tag} is not legal in this state`, 'Wait', 'read the state again, then act')
      case 'basis':
        return no(`${tag} was built on a state that moved`, 'Pick', 'read again, then redo the act')
      case 'build':
        return no('the act comes from an old build of the page', 'Pick', 'reload, then act again')
    }
  },
} as const

// The actor whose token an act makes anew, if any: a new maker, a revived actor, a resumed maker,
// the host of a move.
const makesToken = (s: WorkState, a: Act): Actor | null => {
  const w = a.what
  switch (w._tag) {
    case 'AssignDo':
      return makerActor(`m${s.nextMaker}`)
    case 'Revive':
      return w.who
    case 'Resume':
      return makerActor(w.maker)
    case 'MoveHost':
      return HOST
    default:
      return null
  }
}

// The view an act was derived from: the state after the first `on` acts.
const viewAt = (events: ReadonlyArray<Recorded>, on: number): WorkState | null => {
  let n = 0
  const prefix = events.filter(({ event: e }) =>
    e._tag === 'Work' && (e.create._tag === 'Opened' || n++ < on)
  )
  return foldWork(prefix)?.state ?? null
}

// The act with the fields that the store takes from its view: the basis of the step (seen,
// seenVer, vers) and, for a recheck, the items that the view's task waits to have rechecked.
const viewed = (view: WorkState | null, a: ActCall['act']): Omit<Act, 'old'> => {
  if (view === null) return { ...a, seen: -1, seenVer: 0, vers: new Map() }
  const w = a.what
  const what: What = w._tag === 'RecheckDone'
    ? {
      ...w,
      items: new Set([...(view.tasks.get(w.task)?.pend ?? [])].filter((x) => !testRule(view, x))),
    }
    : w
  return { ...a, what, seen: cur(view, what), seenVer: vsum(view), vers: view.ver }
}

// The reader rows of the items whose version moved.
const moved = (
  before: Versions,
  after: Versions,
  dir: string,
  seq: number,
): ReadonlyArray<ReaderRow> =>
  [...after]
    .filter(([x, v]) => before.get(x) !== v)
    .map(([item, version]) => ['item_version', { project: dir, item, version, seq }])

export const dispatchAct = (call: ActCall) =>
  Effect.gen(function* () {
    const store = yield* Store
    const { cwd } = yield* Dir
    const clock = yield* Now
    const tokens = yield* Tokens
    const opened = yield* store
      .open(cwd, { create: false })
      .pipe(Effect.catchTag('Refused', (e) => Effect.fail(STORE.noStore(e.message, cwd))))
    let done: Acted | undefined
    const seq = yield* opened.write((events) =>
      Effect.gen(function* () {
        const folded = yield* folding(() => foldWork(events))
        if (folded === null) return yield* Effect.fail(WORK.noTop())
        const first = folded.ids.get(call.act.id)
        if (first !== undefined) {
          done = { seq: first, state: folded.state, again: true, token: null }
          return null
        }
        const now = folded.state
        if (call.on !== null && call.on > now.seq) {
          return yield* Effect.fail(WORK.future(call.on, now.seq))
        }
        const needsBasis = cur(now, call.act.what) >= 0 || dirBased(call.act.what)
        if (call.on === null && needsBasis) {
          return yield* Effect.fail(WORK.noBasis(call.act.what._tag))
        }
        const act: Act = {
          ...viewed(call.on === null ? null : viewAt(events, call.on), call.act),
          old: call.build !== null && call.build !== call.current,
        }
        const check = refusal(now, act)
        if (check !== null) return yield* Effect.fail(WORK.checks(check, act.who, act.what._tag))
        const actor = makesToken(now, act)
        const secret = actor === null ? null : yield* tokens.random
        const made = actor === null || secret === null ? null : { actor, secret }
        const event = create('Work', {
          _tag: 'Acted',
          act,
          token: made === null ? null : [made.actor, sha(made.secret)],
        })
        if (!writtenBy(call.by, event)) {
          return yield* Effect.die(`${call.by._tag} does not write Work.Acted`)
        }
        const draft: Draft = { at: yield* clock.read, author: call.by, event }
        const next = (events.at(-1)?.seq ?? 0) + 1
        const state = take(now, act)
        done = {
          seq: next,
          state,
          again: false,
          token: made === null ? null : { ...made, ep: epOf(state, made.actor) },
        }
        return { draft, rows: moved(now.ver, state.ver, opened.dir, next) }
      }),
    )
    if (done === undefined) return yield* Effect.die('dispatchAct: the store built no act')
    return seq === null ? done : { ...done, seq }
  })

// --- the top -------------------------------------------------------------------------------------

// What the person opens the top with; the directions are the official ones of the old Work.
export interface OpenCall {
  readonly by: Author
  readonly name: string
  readonly goal: string
  readonly sections: ReadonlyArray<string>
}
// The secrets of the epoch 0 tokens: the host, the pipe and each persistent role.
export interface Opened {
  readonly seq: number
  readonly secrets: ReadonlyArray<{ readonly actor: Actor; readonly secret: string }>
}

const none = { test: null, ref: null, form: 'none', examples: [] } as const

// The examples that the marked steps of a flow give to the ids they use: a written text, or the
// excerpt of a spot.
const examplesOf = (
  flow: ReadonlyArray<FlowStep>,
  ...ids: ReadonlyArray<string>
): ReadonlyArray<Example> =>
  flow.filter(isMarked).flatMap((s) =>
    s.uses.some((u) => ids.includes(u))
      ? s.examples.map((e) => ({
          fits: e.fit === 'Follows' ? ('follows' as const) : ('breaks' as const),
          sample: isSpot(e.output) ? e.output.excerpt : e.output.written,
        }))
      : [],
  )

// The form of a rule by its evidence: none means a reader alone judges it (WriteRule refuses it).
export const formOf = (test: string | undefined, ref: string | undefined): ItemRec['form'] =>
  test !== undefined ? (ref !== undefined ? 'both' : 'mech') : ref !== undefined ? 'ref' : 'none'

// The items of the official directions: dir:<id>, std:<entry>, rule:<entry>.
const itemsOf = (w: Work): ReadonlyArray<readonly [ItemKey, ItemRec]> =>
  [...w.directions.keys()].flatMap((id) => {
    if (officialAt(w, id) === undefined) return []
    const v = currentOf(w, id)
    const d: ItemRec = {
      ...none,
      kind: 'dir',
      parent: null,
      name: w.directions.get(id)?.name ?? id,
      says: v.says,
      where: null,
      examples: examplesOf(v.flow, id),
    }
    const parts = v.standards.flatMap((entry) => {
      const std = w.standards.get(entry)
      if (std === undefined) return []
      const sections = std.where._tag === 'Where' ? std.where.conditions.get('section') : undefined
      const s: ItemRec = {
        ...none,
        kind: 'std',
        parent: `dir:${id}`,
        name: std.id,
        says: std.says,
        where: sections ?? null,
        examples: examplesOf(v.flow, std.id),
      }
      const rules = std.rules.flatMap((r) => {
        const rule = w.rules.get(r)
        if (rule === undefined) return []
        const rr: ItemRec = {
          ...none,
          kind: 'rule',
          parent: `std:${entry}`,
          name: rule.id,
          says: rule.says,
          where: null,
          test: rule.test ?? null,
          ref: rule.ref ?? null,
          form: formOf(rule.test, rule.ref),
          examples: examplesOf(v.flow, rule.id),
        }
        return [[`rule:${r}`, rr] as const]
      })
      return [[`std:${entry}`, s] as const, ...rules]
    })
    return [[`dir:${id}`, d] as const, ...parts]
  })

// The cards of the persistent agent roles but the pipeline role (it is PIPE): the role's intro
// and model.
const cardsOf = (w: Work): ReadonlyArray<readonly [string, RoleDraft]> =>
  Object.entries(w.config.roles).flatMap(([role, f]) =>
    f.kind === 'agent' && f.persistence.persistent && f.pipeline !== true
      ? [[role, { role, words: f.intro, model: f.model }] as const]
      : [],
  )

// The tries of a task before a raise: the fewest attempts that a model limits, else three.
const triesOf = (w: Work): number => {
  const limits = Object.values(w.config.models).flatMap((m) =>
    m.Assignment?.attempts === undefined ? [] : [m.Assignment.attempts],
  )
  return limits.length === 0 ? TRIES : Math.min(...limits)
}

export const openTop = (call: OpenCall) =>
  Effect.gen(function* () {
    const store = yield* Store
    const { cwd } = yield* Dir
    const clock = yield* Now
    const tokens = yield* Tokens
    const opened = yield* store
      .open(cwd, { create: false })
      .pipe(Effect.catchTag('Refused', (e) => Effect.fail(STORE.noStore(e.message, cwd))))
    let secrets: Opened['secrets'] = []
    const seq = yield* opened.write((events) =>
      Effect.gen(function* () {
        if (events.length === 0) {
          return yield* Effect.fail(STORE.noStore(`no work store in ${cwd}`, cwd))
        }
        if ((yield* folding(() => foldWork(events))) !== null) {
          return yield* Effect.fail(WORK.open())
        }
        const work = yield* folding(() => fold(events))
        const roles = Object.values(work.config.roles)
        if (!roles.some((f) => f.kind === 'agent' && f.pipeline === true)) {
          return yield* Effect.fail(WORK.noPipeline())
        }
        const items = itemsOf(work)
        const cards = cardsOf(work)
        const actors = [HOST, PIPE, ...cards.map(([role]) => roleActor(role))]
        secrets = yield* Effect.forEach(actors, (actor) =>
          Effect.map(tokens.random, (secret) => ({ actor, secret })),
        )
        const event = create('Work', {
          _tag: 'Opened',
          top: {
            name: call.name,
            goal: call.goal,
            sections: call.sections,
            directions: items
              .filter(([, r]) => r.kind === 'dir')
              .map(([x]) => x.slice('dir:'.length)),
          },
          items,
          cards,
          maxTries: triesOf(work),
          tokens: secrets.map((t) => [t.actor, sha(t.secret)]),
        })
        if (!writtenBy(call.by, event)) {
          return yield* Effect.die(`${call.by._tag} does not write Work.Opened`)
        }
        const draft: Draft = { at: yield* clock.read, author: call.by, event }
        const next = (events.at(-1)?.seq ?? 0) + 1
        const zero = new Map(items.map(([x]) => [x, 0]))
        return { draft, rows: moved(new Map(), zero, opened.dir, next) }
      }),
    )
    if (seq === null) return yield* Effect.die('openTop: the store built no top')
    return { seq, secrets }
  })
