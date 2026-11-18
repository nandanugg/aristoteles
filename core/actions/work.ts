// The new path of the work model (P2): the person opens the top, and each act of an actor is one
// event, checked against the folded state by `refusal` (core/derived/work/accept.ts) inside the
// store write. An act id is stored once: a second copy gets the first outcome (G3 firstTime).
import { Effect } from 'effect'
import { currentOf, officialAt } from '../derived/reads.ts'
import { type Refusal as Check, refusal } from '../derived/work/accept.ts'
import {
  type Author,
  create,
  type Draft,
  type Work,
  writtenBy,
} from '../schema/index.ts'
import { Dir, Now, sha, Store, Tokens, type ReaderRow } from '../services/index.ts'
import { fold } from '../state/index.ts'
import { foldWork } from '../state/work/fold.ts'
import { take } from '../state/work/effect.ts'
import { epOf } from '../state/work/reads.ts'
import type {
  Act,
  Actor,
  ItemKey,
  ItemRec,
  RoleDraft,
  Versions,
  WorkState,
} from '../state/work/types.ts'
import { HOST, makerActor, PIPE, roleActor } from '../state/work/types.ts'
import { folding, STORE } from './dispatch.ts'
import { no } from './support.ts'
import type { Refusal } from './types.ts'

const TRIES = 3

// What the actor writes: the act without the store's field (old), and the build of the page that
// built it (null: the CLI has none). current: the build of the code now.
export interface ActCall {
  readonly by: Author
  readonly act: Omit<Act, 'old'>
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
  open: () => no('the top is open already', 'Pick', 'act on the open top'),
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
        const act: Act = { ...call.act, old: call.build !== null && call.build !== call.current }
        const check = refusal(folded.state, act)
        if (check !== null) return yield* Effect.fail(WORK.checks(check, act.who, act.what._tag))
        const actor = makesToken(folded.state, act)
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
        const state = take(folded.state, act)
        done = {
          seq: next,
          state,
          again: false,
          token: made === null ? null : { ...made, ep: epOf(state, made.actor) },
        }
        return { draft, rows: moved(folded.state.ver, state.ver, opened.dir, next) }
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

// The items of the official directions: dir:<id>, std:<entry>, rule:<entry>. A rule has no test
// command yet, so its form is a reference.
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
          form: 'ref',
        }
        return [[`rule:${r}`, rr] as const]
      })
      return [[`std:${entry}`, s] as const, ...rules]
    })
    return [[`dir:${id}`, d] as const, ...parts]
  })

// The cards of the persistent agent roles: the role's intro and model.
const cardsOf = (w: Work): ReadonlyArray<readonly [string, RoleDraft]> =>
  Object.entries(w.config.roles).flatMap(([role, f]) =>
    f.kind === 'agent' && f.persistence.persistent
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
