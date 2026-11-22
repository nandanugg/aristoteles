// The new path of the work model (P2): the person opens the top, and each act of an actor is one
// event, checked against the folded state by `refusal` (core/derived/c16/accept.ts) inside the
// store write. An act id is stored once: a second copy gets the first outcome (G3 firstTime).
import { ACTIVATION, activationOf, gate } from './activation.ts'
import { Effect, Schema } from 'effect'
import { currentOf, officialAt } from '../derived/reads.ts'
import { basisOf, refused } from '../derived/c16/accept.ts'
import {
  type Author,
  create,
  type Draft,
  type FlowStep,
  isMarked,
  isSpot,
  type Recorded,
  type Work,
  BodySchema,
  writtenBy,
} from '../schema/index.ts'
import { Dir, Now, sha, Store, Tokens, type ReaderRow } from '../services/index.ts'
import { fold } from '../state/index.ts'
import { foldWork } from '../state/c16/fold.ts'
import { take } from '../state/c16/effect.ts'
import { epochOf, testRule, vsum } from '../state/c16/reads.ts'
import type { WorkState } from '../state/c16/state.ts'
import { actorOf, keyOf, type Act, type Actor, type Body, type RefusalName }
  from '../state/c16/types.ts'
import type { Example, ItemKey, ItemRec, RoleDraft, Versions } from '../state/c16/data.ts'
import { Refusal as WorkRefusal } from '../schema/errors.ts'
import { NonBlank } from '../schema/index.ts'

const HOST = { _tag: 'Host' } as const
const HUMAN = { _tag: 'Human' } as const
const PIPE = { _tag: 'Pipe' } as const
const makerActor = (id: string): Actor => ({ _tag: 'Maker', id })
const roleActor = (name: string): Actor => ({ _tag: 'Role', name })
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
  readonly act: Pick<Act, 'id' | 'who' | 'ep' | 'body'>
  readonly on: number | null
  readonly build: string | null
  readonly current: string
  readonly forward?: string
  readonly evidence?: Versions
  readonly actorEpoch?: number
}
// A token the act made: the actor, its epoch and the secret (the store keeps only the hash).
export interface NewToken {
  readonly actor: string
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
  notForwardable: (tag: string) =>
    no(`${tag} is not an act that the host may forward`, 'Escalate', 'the person acts at the page'),
  noForward: (id: string) =>
    no(`${id} is no forward that waits`, 'Pick', 'the page lists the forwards that wait'),
} as const

// The actor whose token an act makes anew, if any: a new maker, a revived actor, a resumed maker,
// the host of a move.
const makesToken = (s: WorkState, a: Act): Actor | null => {
  const w = a.body
  switch (w._tag) {
    case 'Open':
      return w.open._tag === 'OpenMake' ? makerActor(`m${s.nextMaker}`) : null
    case 'Revive':
      return w.actor
    case 'Resume':
      return makerActor(w.maker)
    case 'MoveHost':
      return HOST
    default:
      return null
  }
}

// The view an act was derived from: the state after the first `on` acts (Acted events only;
// the bookkeeping events of the Work group are no acts).
const viewAt = (events: ReadonlyArray<Recorded>, on: number): WorkState | null => {
  let n = 0
  const prefix = events.filter(({ event: e }) =>
    e._tag === 'Work' &&
    (e.create._tag === 'Opened' || (e.create._tag === 'Acted' && n++ < on))
  )
  return foldWork(prefix)?.state ?? null
}

// The act with the fields that the store takes from its view: the basis of the step (seen,
// seenVer, vers) and, for a recheck, the items that the view's task waits to have rechecked.
const viewed = (view: WorkState | null, a: ActCall['act']): Omit<Act, 'old'> => {
  if (view === null) return { ...a, seen: -1, seenVer: 0, vers: new Map() }
  const w = a.body
  const body: Body = w._tag === 'RecheckDone'
    ? {
      ...w,
      items: new Set([...(view.tasks.get(w.task)?.pending ?? [])].filter((x) => !testRule(view, x))),
    }
    : w
  return { ...a, body, seen: basisOf(view, body), seenVer: vsum(view), vers: view.ver }
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

const named = (refused: RefusalName, words: string, next = 'Read the state again.'): Refusal =>
  new WorkRefusal({ message: words, choice: { kind: 'Pick', words: NonBlank.make(next) },
    refused, words, next })

const requestOf = (call: ActCall): string => sha(JSON.stringify([
  call.by, keyOf(call.act.who), call.act.ep, Schema.encodeSync(BodySchema)(call.act.body),
  call.on, call.build, call.forward ?? null,
]))

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
        // The activation gate first (contract 6c D: before noTop and any side effect).
        yield* gate(events)
        const folded = yield* folding(() => foldWork(events))
        if (folded === null) return yield* Effect.fail(WORK.noTop())
        const now = folded.state
        const request = requestOf(call)
        const first = folded.ids.get(call.act.id)
        if (first !== undefined) {
          const saved = events.find((event) => event.seq === first)?.event
          if (saved?._tag !== 'Work' || saved.create._tag !== 'Acted' ||
            saved.create.request !== request) {
            return yield* Effect.fail(named('legal', 'This act ID names a different submission.'))
          }
          done = { seq: first, state: now, again: true, token: null }
          return null
        }
        if (call.forward !== undefined && !folded.forwards.some((f) => f.id === call.forward)) {
          return yield* Effect.fail(WORK.noForward(call.forward))
        }
        const invalidView = call.on !== null && (call.on < 0 || call.on > now.seq)
        const act: Act = {
          ...viewed(call.on === null ? now : invalidView ? null : viewAt(events, call.on), call.act),
          old: call.build !== null && call.build !== call.current,
        }
        const via = call.by._tag === 'Person' && call.by.channel === 'ui' ? 'page' : 'terminal'
        const check = refused(now, act, via)
        if (check && check.refused !== 'basis') {
          return yield* Effect.fail(named(check.refused, check.words, check.next))
        }
        const needsBasis = basisOf(now, act.body) >= 0 ||
          act.body._tag === 'AskEdit'
        if (invalidView || (call.on === null && needsBasis)) {
          return yield* Effect.fail(named('basis', 'The act needs the basis of its current view.'))
        }
        if (check) return yield* Effect.fail(named(check.refused, check.words, check.next))
        if (act.body._tag === 'Exit' && call.actorEpoch !== undefined &&
          call.actorEpoch !== epochOf(now, act.body.actor)) {
          return yield* Effect.fail(named('epoch', 'This process was replaced by a newer one.'))
        }
        const evidence = call.evidence
        if (evidence && (evidence.size !== now.ver.size ||
          [...evidence].some(([item, version]) => now.ver.get(item) !== version))) {
          return yield* Effect.fail(named('basis', 'The evidence was computed before items changed.'))
        }
        const actor = makesToken(now, act)
        const secret = actor === null ? null : yield* tokens.random
        const made = actor === null || secret === null ? null : { actor: keyOf(actor), secret }
        const event = create('Work', {
          _tag: 'Acted',
          act,
          request,
          forward: call.forward ?? null,
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
          token: made === null ? null : { ...made, ep: epochOf(state, actorOf(made.actor)) },
        }
        return { draft, rows: moved(now.ver, state.ver, opened.dir, next) }
      }),
    )
    if (done === undefined) return yield* Effect.die('dispatchAct: the store built no act')
    return seq === null ? done : { ...done, seq }
  })

// --- the forwards --------------------------------------------------------------------------------

// The acts of the person at a terminal only (run continue): neither the page nor a forward.
export const atTerminal = (body: Body): boolean =>
  body._tag === 'MoveHost' || body._tag === 'Revive'

// The id of an act of the page: a resend or a double click is the same act.
export const pageActId = (body: Body, on: number | null): string =>
  sha(JSON.stringify(['page', Schema.encodeSync(BodySchema)(body), on]))

const storeOpened = Effect.gen(function* () {
  const { cwd } = yield* Dir
  return yield* (yield* Store)
    .open(cwd, { create: false })
    .pipe(Effect.catchTag('Refused', (e) => Effect.fail(STORE.noStore(e.message, cwd))))
})

// The host's carry of the person's words: the act waits on the page for the person's confirm.
// Refused unless the person may act it (authority) and need not be at a terminal.
const forwardable = (body: Body): boolean =>
  body._tag === 'AnswerQuestion' || body._tag === 'Respond' || body._tag === 'AskEdit' ||
  body._tag === 'EndProject' || (body._tag === 'Open' && body.open._tag === 'OpenReject')

export const recordForward = (
  by: Author,
  fwd: { readonly act: Body; readonly on: number | null; readonly quote: string },
) =>
  Effect.gen(function* () {
    const clock = yield* Now
    const opened = yield* storeOpened
    let id = ''
    yield* opened.write((events) =>
      Effect.gen(function* () {
        yield* gate(events)
        const folded = yield* folding(() => foldWork(events))
        if (folded === null) return yield* Effect.fail(WORK.noTop())
        const s = folded.state
        if (!forwardable(fwd.act)) {
          return yield* Effect.fail(WORK.notForwardable(fwd.act._tag))
        }
        if (fwd.on !== null && fwd.on > s.seq) {
          return yield* Effect.fail(WORK.future(fwd.on, s.seq))
        }
        id = `f${(events.at(-1)?.seq ?? 0) + 1}`
        const event = create('Work', { _tag: 'Forwarded', id, ...fwd })
        if (!writtenBy(by, event)) {
          return yield* Effect.die(`${by._tag} does not write Work.Forwarded`)
        }
        return { draft: { at: yield* clock.read, author: by, event }, rows: [] }
      }),
    )
    return id
  })

// The forward is spent: the person dropped it, or confirmed it.
export const dropForward = (by: Author, id: string) =>
  Effect.gen(function* () {
    const clock = yield* Now
    const opened = yield* storeOpened
    yield* opened.write((events) =>
      Effect.gen(function* () {
        yield* gate(events)
        const folded = yield* folding(() => foldWork(events))
        if (folded === null) return yield* Effect.fail(WORK.noTop())
        if (!folded.forwards.some((f) => f.id === id)) {
          return yield* Effect.fail(WORK.noForward(id))
        }
        const event = create('Work', { _tag: 'ForwardDropped', id })
        if (!writtenBy(by, event)) {
          return yield* Effect.die(`${by._tag} does not write Work.ForwardDropped`)
        }
        return { draft: { at: yield* clock.read, author: by, event }, rows: [] }
      }),
    )
  })

// The person confirms a forward: its act is theirs, with the `on` it was forwarded with (a state
// that moved since refuses it by its basis); then the forward is spent.
export const confirmForward = (by: Author, id: string, build: string | null, current: string) =>
  Effect.gen(function* () {
    const events = yield* (yield* storeOpened).events
    // Before the forward is resolved; the act itself is gated again inside dispatchAct's write.
    yield* gate(events)
    const folded = yield* folding(() => foldWork(events))
    if (folded === null) return yield* Effect.fail(WORK.noTop())
    const first = folded.ids.get(`confirm:${id}`)
    const recorded = events.find((event) => event.seq === first)
    const saved = recorded?.event
    const f = folded.forwards.find((x) => x.id === id)
    if (f === undefined) {
      if (build !== null && build !== current) {
        return yield* Effect.fail(named('build', 'The page build is old.'))
      }
      if (saved?._tag === 'Work' && saved.create._tag === 'Acted' &&
        saved.create.forward === id && JSON.stringify(recorded?.author) === JSON.stringify(by)) {
        return { seq: first!, state: folded.state, again: true, token: null }
      }
      return yield* Effect.fail(WORK.noForward(id))
    }
    return yield* dispatchAct({
      by,
      act: { id: `confirm:${id}`, who: HUMAN, ep: 0, body: f.act },
      on: f.on,
      build,
      current,
      forward: id,
    })
  })

// --- the top -------------------------------------------------------------------------------------

// What the person opens the top with; the directions are the official ones of the old Work.
export interface OpenCall {
  readonly by: Author
  readonly name: string
  readonly goal: string
  readonly sections: ReadonlyArray<string>
  // An activated workflow: the managed session of the bound host (the startup side finds it by
  // its launch); required then, ignored otherwise.
  readonly hostSession?: string
}
// The secrets of the epoch 0 tokens: the host, the pipe and each persistent role.
export interface Opened {
  readonly seq: number
  readonly secrets: ReadonlyArray<{ readonly actor: string; readonly secret: string }>
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
    let hostBound = false
    const seq = yield* opened.write((events) =>
      Effect.gen(function* () {
        if (events.length === 0) {
          return yield* Effect.fail(STORE.noStore(`no work store in ${cwd}`, cwd))
        }
        yield* gate(events)
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
        // An activated workflow: the host already holds its credential from activation (contract
        // 6c B3); the top binds its verifier and makes no new host secret.
        const bound = activationOf(events)?.binding ?? null
        hostBound = bound !== null
        if (bound !== null && (call.hostSession === undefined || call.hostSession === '')) {
          return yield* Effect.fail(
            ACTIVATION.legal('the bound host has no live session: relaunch it before the top'),
          )
        }
        const made = bound === null ? actors : actors.filter((a) => keyOf(a) !== keyOf(HOST))
        secrets = yield* Effect.forEach(made, (actor) =>
          Effect.map(tokens.random, (secret) => ({ actor: keyOf(actor), secret })),
        )
        const hashes: ReadonlyArray<readonly [string, string]> = [
          ...(bound === null ? [] : [[keyOf(HOST), bound.verifier] as const]),
          ...secrets.map((t) => [t.actor, sha(t.secret)] as const),
        ]
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
          tokens: hashes,
          hostSession: bound === null ? null : (call.hostSession ?? null),
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
    return { seq, secrets, hostBound }
  })

// The person's pane for the host: bookkeeping that the engine and the page read (no act).
export const recordHostPane = (
  by: Author,
  pane: { readonly socket: string; readonly pane: string },
) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const clock = yield* Now
    const opened = yield* (yield* Store)
      .open(cwd, { create: false })
      .pipe(Effect.catchTag('Refused', (e) => Effect.fail(STORE.noStore(e.message, cwd))))
    return yield* opened.write((events) =>
      Effect.gen(function* () {
        yield* gate(events)
        if ((yield* folding(() => foldWork(events))) === null) return yield* WORK.noTop()
        const event = create('Work', { _tag: 'HostPane', ...pane })
        if (!writtenBy(by, event)) {
          return yield* Effect.die(`${by._tag} does not write Work.HostPane`)
        }
        return { draft: { at: yield* clock.read, author: by, event }, rows: [] }
      }),
    )
  })
