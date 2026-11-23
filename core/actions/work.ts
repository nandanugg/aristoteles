// The new path of the work model (P2): the person opens the top, and each act of an actor is one
// event, checked against the folded state by `refusal` (core/derived/c16/accept.ts) inside the
// store write. An act id is stored once: a second copy gets the first outcome (G3 firstTime).
import { ACTIVATION, activationOf, gate } from './activation.ts'
import { Effect, Schema } from 'effect'
import { currentOf, officialAt } from '../derived/reads.ts'
import { currentOffer, obligationOf, oldestWorkerStep } from '../derived/c16/worker.ts'
import { foldRuntime, matchesStep, privateWorker } from '../state/worker-runtime.ts'
import { basisOf, refused } from '../derived/c16/accept.ts'
import {
  type Author,
  create,
  type Draft,
  isSpot,
  type Recorded,
  type Work,
  BodySchema,
  writtenBy,
  type Turn,
  type WorkerDelivery,
  type WorkerPlacement,
} from '../schema/index.ts'
import { activationLock, Dir, Files, Now, readStaffing, sha, Store, Tokens, type ReaderRow } from '../services/index.ts'
import { fold } from '../state/index.ts'
import { foldWork } from '../state/c16/fold.ts'
import { take } from '../state/c16/effect.ts'
import { epochOf, vsum } from '../state/c16/reads.ts'
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
  readonly credential?: string
  readonly turn?: string
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
export const workViewAt = (events: ReadonlyArray<Recorded>, on: number): WorkState | null => {
  let n = 0
  const prefix: Recorded[] = []
  for (const entry of events) {
    const { event } = entry
    if (event._tag === 'Work' && event.create._tag === 'Acted' && n++ >= on) break
    if (event._tag === 'Work' || event._tag === 'Runtime') prefix.push(entry)
  }
  return foldWork(prefix)?.state ?? null
}

// The view contributes the basis and versions. The caller supplies what it inspected.
const viewed = (view: WorkState | null, a: ActCall['act']): Omit<Act, 'old'> =>
  view === null
    ? { ...a, seen: -1, seenVer: 0, vers: new Map() }
    : { ...a, seen: basisOf(view, a.body), seenVer: vsum(view), vers: view.ver }

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

const checkLoopMode = (body: Body, events: ReadonlyArray<Recorded>, cwd: string) =>
  Effect.gen(function* () {
    if (body._tag !== 'LoopReview' || body.mode === 'self-review turns') return
    if (body.mode === 'other provider') {
      return yield* named('legal', 'No distinct provider is bound for pipeline review.',
        'Report the review mode actually used within the staffing arrangement.')
    }
    const files = yield* Effect.serviceOption(Files)
    const staffing = files._tag === 'Some'
      ? yield* readStaffing(cwd).pipe(Effect.provideService(Files, files.value), Effect.orElseSucceed(() => null))
      : null
    const work = yield* folding(() => fold(events))
    const name = Object.entries(work.config?.roles ?? {}).find(([, role]) =>
      role.kind === 'agent' && role.pipeline === true)?.[0]
    const pipeline = name === undefined ? undefined : staffing?.roles[name]
    if (!pipeline || pipeline.subagentAllowance === 0 || staffing?.clis[pipeline.cli]?.backgroundChildren !== true) {
      return yield* named('legal', 'Staffing does not allow the reported fresh-subagent review.',
        'Report the review mode actually used within the staffing arrangement.')
    }
  })

const requestOf = (call: ActCall): string => sha(JSON.stringify([
  call.by, keyOf(call.act.who), call.act.ep, Schema.encodeSync(BodySchema)(call.act.body),
  call.on, call.build, call.forward ?? null, call.turn === undefined ? null : sha(call.turn),
]))

const deliveryOf = (
  call: ActCall, events: ReadonlyArray<Recorded>, folded: NonNullable<ReturnType<typeof foldWork>>,
  saved?: WorkerDelivery | null,
  synthesize?: (offer: Turn) => void,
) => Effect.gen(function* () {
  const actor = keyOf(call.act.who)
  const ep = call.act.ep
  const { placements, workers } = foldRuntime(events)
  const placement = placements.find((p) => p.members.includes(actor))
  if (!placement) {
    if (call.turn !== undefined) return yield* named('authority', 'This actor has no worker turn.')
    return null
  }
  if (call.credential === undefined) return yield* named('authority', 'This act needs the current worker identity credential.')
  const worker = workers.get(placement.worker)
  const member = worker?.binding?.members.find((m) => m.actor === actor)
  const match = /^w\.(.+)\.(\d+)\.([a-z0-9]+)$/.exec(call.credential)
  if (!match || match[1] !== actor || Number(match[2]) !== ep) {
    return yield* named('authority', 'The credential does not name the submitting identity.')
  }
  const secret = match[3]
  if (!worker || worker.fenced || worker.ended || !member || member.epoch !== ep ||
    secret === undefined || member.verifier !== sha(secret)) {
    return yield* named('epoch', 'This worker binding is no longer current.')
  }
  const generation = worker.reservation.generation
  if (saved) {
    if (saved.worker !== placement.worker || saved.generation !== generation || saved.actor !== actor) {
      return yield* named('epoch', 'This submission was recorded under a replaced worker binding.')
    }
    return saved
  }
  const privateCall = privateWorker(placement) && call.turn === undefined
  let offer = worker.offer
  if (privateCall && (!offer || !currentOffer(folded.state, offer))) {
    const selected = oldestWorkerStep(folded.state, placement.members)
    if (!selected || selected.actor !== actor || !matchesStep(call.act.body, selected.step)) {
      return yield* named('authority', 'This act is not the next owed step of the private worker.')
    }
    const turn = `turn-${(events.at(-1)?.seq ?? 0) + 1}`
    offer = {
      worker: placement.worker, generation, actor, epoch: ep, turn, step: selected.step,
      obligation: obligationOf(folded.state, selected.step), on: folded.state.seq,
      receiptVerifier: sha(JSON.stringify([secret, turn, 'private'])),
    }
    synthesize?.(offer)
  }
  const privateDelivery = { worker: placement.worker, generation, actor, epoch: ep,
    on: offer?.on ?? folded.state.seq, kind: 'private' as const }
  const verifier = privateCall && offer ? offer.receiptVerifier :
    call.turn === undefined ? null : sha(call.turn)
  if (!offer || offer.receiptVerifier !== verifier) {
    return yield* named('stale', 'The worker turn is missing or no longer current.')
  }
  if (offer.actor !== actor || offer.epoch !== ep || !matchesStep(call.act.body, offer.step)) {
    return yield* named('authority', 'This act is not the step offered to this identity.')
  }
  if (!currentOffer(folded.state, offer)) return yield* named('stale', 'The offered obligation was withdrawn.')
  if ((!privateCall || call.on !== null) && offer.on !== call.on) {
    return yield* named('basis', 'Use the offered turn basis.')
  }
  if (privateCall) return privateDelivery
  const { _tag: _tag, receiptVerifier: _verifier, ...delivery } = offer as typeof offer & { _tag?: string }
  return delivery
})

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
          yield* deliveryOf(call, events, folded, saved.create.delivery)
          done = { seq: first, state: now, again: true, token: null }
          return null
        }
        if (call.forward !== undefined && !folded.forwards.some((f) => f.id === call.forward)) {
          return yield* Effect.fail(WORK.noForward(call.forward))
        }
        let inlineOffer: Turn | undefined
        const delivery = yield* deliveryOf(call, events, folded, undefined, (offer) => { inlineOffer = offer })
        const invalidView = call.on !== null && (call.on < 0 || call.on > now.seq)
        const act: Act = {
          ...viewed(call.on === null ? now : invalidView ? null : workViewAt(events, call.on), call.act),
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
        yield* checkLoopMode(act.body, events, cwd)
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
          act, delivery,
          ...(inlineOffer === undefined ? {} : { inlineOffer }),
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
  readonly hostLaunch?: string
}
// The secrets of the epoch 0 tokens: the host, the pipe and each persistent role.
export interface Opened {
  readonly seq: number
  readonly secrets: ReadonlyArray<{ readonly actor: string; readonly secret: string }>
}

const none = { test: null, ref: null, form: 'none', examples: [] } as const

// The cases of a rule (its evidence: pass 3b, cases live on rules): a written text, or the excerpt
// of a spot.
const examplesOf = (cases: ReadonlyArray<import('../schema/index.ts').Example>): ReadonlyArray<Example> =>
  cases.map((e) => ({
    fits: e.fit === 'Follows' ? ('follows' as const) : ('breaks' as const),
    sample: isSpot(e.output) ? e.output.excerpt : e.output.written,
  }))

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
      // a direction shows the cases of all its rules
      examples: examplesOf(v.standards.flatMap((entry) =>
        (w.standards.get(entry)?.rules ?? []).flatMap((r) => w.rules.get(r)?.evidence?.cases ?? []))),
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
        // a standard shows the cases of its rules
        examples: examplesOf(std.rules.flatMap((r) => w.rules.get(r)?.evidence?.cases ?? [])),
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
          ...(rule.evidence?.knownBreaks.length ? {
            knownBreaks: rule.evidence.knownBreaks.map((spot) =>
              `${spot.file}:${spot.line} — ${spot.excerpt} (searched: ${rule.evidence!.scope.searched.join(', ')})`),
          } : {}),
          examples: examplesOf(rule.evidence?.cases ?? []),
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

const placementsOf = (work: Work, staffing: import('../services/index.ts').Staffing) => {
  const groups = new Map<string, WorkerPlacement>()
  const roles = Object.entries(work.config.roles)
  const host = roles.find(([, role]) => role.kind === 'agent' && role.persistence.persistent &&
    role.acts.includes('split'))?.[0]
  const assignments = [
    ...(host === undefined ? [] : [['host', host] as const]),
    ...roles.flatMap(([name, role]) => role.kind !== 'agent' ? [] :
      role.pipeline === true ? [['pipe', name] as const] :
        role.persistence.persistent ? [[keyOf(roleActor(name)), name] as const] : []),
  ]
  for (const [actor, name] of assignments) {
    const binding = staffing.roles[name]
    if (!binding?.persistent) return null
    const worker = binding.workerGroup === undefined ? `role:${name}` : `group:${binding.workerGroup}`
    const placement = groups.get(worker)
    if (placement && (placement.account !== binding.account || placement.model !== binding.model ||
      placement.cli !== binding.cli || placement.launch !== binding.launch)) return null
    groups.set(worker, {
      worker, account: binding.account, cli: binding.cli, model: binding.model, launch: binding.launch,
      sessionLimit: staffing.accounts[binding.account]?.sessionLimit ?? null,
      members: [actor, ...(placement?.members ?? [])],
    })
  }
  return [...groups.values()]
}

export const writeTop = (call: OpenCall, managed: boolean) =>
  Effect.gen(function* () {
    const store = yield* Store
    const { cwd } = yield* Dir
    const clock = yield* Now
    const tokens = yield* Tokens
    const opened = yield* store
      .open(cwd, { create: false })
      .pipe(Effect.catchTag('Refused', (e) => Effect.fail(STORE.noStore(e.message, cwd))))
    if (activationOf(yield* opened.events) !== null) yield* activationLock(cwd)
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
        if (bound !== null && call.hostLaunch !== undefined && bound.launch !== call.hostLaunch) {
          return yield* Effect.fail(ACTIVATION.legal('the host binding moved; open the top again'))
        }
        if (bound !== null && (call.hostSession === undefined || call.hostSession === '')) {
          return yield* Effect.fail(
            ACTIVATION.legal('no managed session was supplied for the bound host'),
          )
        }
        const files = yield* Effect.serviceOption(Files)
        const staffing = managed && files._tag === 'Some'
          ? yield* readStaffing(cwd).pipe(Effect.provideService(Files, files.value))
          : null
        if (managed && staffing === null) return yield* ACTIVATION.legal('Top open needs staffing for this directory.')
        const placements = staffing === null ? undefined : placementsOf(work, staffing)
        if (placements === null) {
          return yield* ACTIVATION.legal('Persistent role staffing does not define compatible workers.')
        }
        const made = placements !== undefined ? [] : bound === null ? actors :
          actors.filter((a) => keyOf(a) !== keyOf(HOST))
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
          ...(placements === undefined ? {} : {
            placements, placementRevision: sha(JSON.stringify(placements)),
          }),
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
  }).pipe(Effect.scoped)

export const openTop = (call: OpenCall) => writeTop(call, true)

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
