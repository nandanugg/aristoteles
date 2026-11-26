// The commands of the work model's acts (P2). One generic path: who calls (an agent by its work
// token, the person at a terminal, or the harness), the words of the command made into a Body, the
// harness fields filled from the current state (the rule runner), then dispatchAct: the store
// checks the act and appends it. The basis travels with the step: --on <n> is the seq of the view
// the step was derived from. An agent's next step is not printed: it runs `work wait` again.
import { isAbsolute, join } from 'node:path'
import { Effect, Schema } from 'effect'
import { Authority as ProjectAuthority } from '../../../core/actions/project.ts'
import { decodeQuestionInput, submitQuestion } from '../../../core/actions/question.ts'
import {
  Answer as ProjectAnswer, QuestionDraft, QuestionId, Rationale, StoredActor, refuse as projectRefuse,
  type Of, type ReadPosition, type Refusal as ProjectRefusal,
} from '../../../core/schema/project.ts'
import type { Committed, Journal } from '../../../core/services/project.ts'
import { activationOf, gate } from '../../../core/actions/activation.ts'
import { settleWorker } from '../../../core/actions/worker.ts'
import {
  WORK,
  dispatchAct,
  formOf,
  openTop,
  recordForward,
  recordHostPane,
  workViewAt,
} from '../../../core/actions/work.ts'
import {
  caughtOn,
  resolvesFight,
  refExists,
  ruleHolds,
  runTest,
  type RuleRunFailed,
} from '../../../core/effects/rules.ts'
import {
  type Author,
  type Expected,
  type Recorded,
  refuse,
  UsageError,
  BodySchema,
  ContextFacts,
  ScopeConditions,
  LoopReviewMode,
  ActorSchema,
  AnswerBodySchema,
  QuestionBodySchema,
} from '../../../core/schema/index.ts'
import { activationLock, Dir, Env, Files, parseYaml, sha, Store } from '../../../core/services/index.ts'
import { loadWork } from '../../../core/state/index.ts'
import { childFor, foldRuntime, privateWorker } from '../../../core/state/worker-runtime.ts'
import { foldWork } from '../../../core/state/c16/fold.ts'
import { askCountOf, epochOf, findAsk, fixOf, vsum } from '../../../core/state/c16/reads.ts'
import type { WorkState } from '../../../core/state/c16/state.ts'
import { actorOf, keyOf, type Actor, type Body, type Reply } from '../../../core/state/c16/types.ts'
import type { ItemKey, ItemRec, Level, RoleDraft, TaskSpec, Verdict }
  from '../../../core/state/c16/data.ts'
import { kindOf } from '../../../core/state/c16/data.ts'
import { helperBrief } from './recheck.ts'
import { acquireBootstrapWorker, activationEvents, retireHostDelivery } from '../../live/activation.ts'
import { bootstrapSession } from '../../live/bootstrap.ts'
import { briefOf, contextWords, hostWords, makerWords, recheckBriefOf } from '../../words/work.ts'
import { type Args, textOf } from '../args.ts'
import { personAuthor, verifyWork, workTokenOf } from '../caller.ts'
import type { CliServices, Command, Commands } from '../command.ts'

// A new token's line; a maker's also gives the exact first prompt its role starts it with (the
// launch opening, which the marker line in the project's instruction files names).
const madeLines = (actor: string, token: string): ReadonlyArray<string> =>
  actor.startsWith('maker:')
    ? [`  ${actor}: ${token}`, `  its prompt: ${makerWords(actor, token)}`]
    : [`  ${actor}: ${token}`]

const HUMAN = { _tag: 'Human' } as const
const HOST = { _tag: 'Host' } as const
const HARNESS = { _tag: 'Harness' } as const

type Failure = Expected | ReturnType<typeof WORK.noTop>
type Run<A> = Effect.Effect<A, Failure, CliServices>

// What a parse reads: the words after the command (no token), the flags, who acts, and the state.
interface Ctx {
  readonly cmd: string
  readonly words: ReadonlyArray<string>
  readonly args: Args
  readonly who: Actor
  readonly state: WorkState
  readonly events: ReadonlyArray<Recorded>
}
interface Spec {
  readonly by: 'person' | 'agent' | 'either' | 'harness'
  readonly parse: (c: Ctx) => Run<Body>
}

const usage = (message: string) => Effect.fail(new UsageError({ message, next: null }))
const word = (c: Ctx, i: number, shape: string): Run<string> => {
  const w = c.words[i]
  return w === undefined ? usage(`work ${c.cmd} needs ${shape}`) : Effect.succeed(w)
}
const flag = (c: Ctx, key: string): Run<string> => {
  const v = textOf(c.args.one(key))
  return v === undefined ? usage(`work ${c.cmd} needs --${key}="<...>"`) : Effect.succeed(v)
}
const listOf = (v: string | true | undefined): ReadonlyArray<string> =>
  (typeof v === 'string' ? v.split(',') : []).map((x) => x.trim()).filter((x) => x !== '')
const pointsOf = (c: Ctx): ReadonlyArray<string> =>
  c.args.all('points').flatMap((v) =>
    typeof v === 'string' ? v.split('\n').map((x) => x.trim()).filter((x) => x !== '') : []
  )
const onOf = (args: Args): number | null => {
  const v = textOf(args.one('on'))
  return v === undefined || !/^\d+$/.test(v) ? null : Number(v)
}
const makerOf = (c: Ctx): Run<string> =>
  c.who._tag === 'Maker'
    ? Effect.succeed(c.who.id)
    : usage(`work ${c.cmd} is for a maker; ${keyOf(c.who)} is not one`)

// --- files: a YAML or JSON the command reads ---------------------------------------------------

const isObj = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

const readFacts = Schema.decodeUnknownResult(ContextFacts, { onExcessProperty: 'error' })
const readScope = Schema.decodeUnknownResult(ScopeConditions, { onExcessProperty: 'error' })

const contextOfArgs = (args: Args): Run<ContextFacts> =>
  Effect.gen(function* () {
    const facts = new Map<string, string>()
    for (const flag of args.all('context')) {
      if (typeof flag !== 'string') return yield* usage('--context needs key=value')
      for (const entry of flag.split(',')) {
        const at = entry.indexOf('=')
        const key = entry.slice(0, at).trim()
        const value = entry.slice(at + 1).trim()
        if (at < 1 || !key || !value) return yield* usage('--context needs key=value')
        const checked = readFacts({ [key]: value })
        if (checked._tag === 'Failure') return yield* usage(`unknown context fact "${key}"; sections use --sections`)
        if (facts.has(key) && facts.get(key) !== value) return yield* usage(`context key "${key}" has two values`)
        facts.set(key, value)
      }
    }
    return Object.fromEntries(facts)
  })

const readFile = (path: string): Run<unknown> =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const body = yield* (yield* Files).read(isAbsolute(path) ? path : join(cwd, path))
    if (body === null) return yield* refuse(`${path} is not a file`, 'name a file that exists')
    return yield* Effect.try({
      try: () => parseYaml(body) as unknown,
      catch: (e) => e as Expected,
    })
  })

const fromFile = <A>(c: Ctx, key: string, make: (raw: unknown) => Run<A>): Run<A> =>
  Effect.flatMap(flag(c, key), (path) => Effect.flatMap(readFile(path), make))

const specOf = (raw: unknown): Run<TaskSpec> => {
  const r = isObj(raw) ? raw : {}
  const name = text(r.name)
  const goal = text(r.goal)
  const role = text(r.role)
  const sections = Array.isArray(r.sections) ? r.sections.filter((s) => typeof s === 'string') : []
  if (name === null || goal === null || role === null) return refuse('a part needs name, goal, sections and role')
  const facts = readFacts(r.facts === undefined ? {} : r.facts)
  if (facts._tag === 'Failure') return refuse(`part ${name} has invalid facts: ${facts.failure}`)
  return Effect.succeed({ name, goal, role, sections, facts: facts.success })
}
const partsOf = (raw: unknown): Run<ReadonlyArray<TaskSpec>> =>
  Array.isArray(raw)
    ? Effect.forEach(raw, specOf)
    : refuse('the parts file is a list of {name, goal, sections, role, facts?}')
const cardOf = (raw: unknown): Run<RoleDraft> => {
  const r = isObj(raw) ? raw : {}
  const [role, words, model] = [text(r.role), text(r.words), text(r.model)]
  return role === null || words === null || model === null
    ? refuse('the role draft file needs role, words and model')
    : Effect.succeed({ role, words, model })
}

// The item record of a file's entry: its kind from the key, the form from its evidence.
const recOf = (key: ItemKey, raw: unknown, parent: ItemKey | null): Run<ItemRec> => {
  const r = isObj(raw) ? raw : {}
  const says = text(r.says)
  const examples = Array.isArray(r.examples) ? r.examples : []
  const fits = examples.every(
    (e) => isObj(e) && (e.fits === 'follows' || e.fits === 'breaks') && text(e.sample) !== null,
  )
  if (says === null) return refuse(`${key} needs says`)
  if (!fits) return refuse(`${key}: an example is {fits: follows|breaks, sample: <text>}`)
  const test = text(r.test)
  const ref = text(r.ref)
  const scope = readScope(r.where ?? {})
  if (scope._tag === 'Failure') return refuse(`${key} has invalid where conditions: ${scope.failure}`)
  return Effect.succeed({
    kind: kindOf(key),
    parent: text(r.parent) ?? parent,
    name: text(r.name) ?? key.slice(key.indexOf(':') + 1),
    says,
    where: Object.keys(scope.success).length ? scope.success : null,
    test,
    ref,
    form: formOf(test ?? undefined, ref ?? undefined),
    examples: examples.map((e) => ({ fits: e.fits, sample: e.sample })),
  })
}

const KEY = /^(dir|std|rule):.+$/
// A draft file: item key -> its record, or null to remove the item.
const draftOf = (raw: unknown): Run<ReadonlyMap<ItemKey, ItemRec | null>> =>
  Effect.gen(function* () {
    if (!isObj(raw)) return yield* refuse('the draft file maps item keys (rule:<id>) to records')
    const entry = (key: ItemKey, v: unknown): Run<readonly [ItemKey, ItemRec | null]> =>
      !KEY.test(key)
        ? refuse(`${key} is not an item key (dir:<id>, std:<id> or rule:<id>)`)
        : v === null
        ? Effect.succeed([key, null])
        : Effect.map(recOf(key, v, null), (rec) => [key, rec])
    const entries = yield* Effect.forEach(Object.entries(raw), ([key, v]) => entry(key, v))
    return new Map(entries)
  })

// --- the rule runner: the harness fields ------------------------------------------------------

const ranRules = <A, R>(
  run: Effect.Effect<A, RuleRunFailed, R>,
): Effect.Effect<A, Expected, R> =>
  Effect.catchTag(run, 'RuleRunFailed', (e) =>
    Effect.fail(refuse(`the test "${e.test}" did not run: ${e.message}`, 'fix the test command')))

const checkFiles = (files: ReadonlyArray<string>): Run<void> =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const there = yield* Files
    for (const f of files) {
      const outside = isAbsolute(f) || f.split('/').includes('..')
      if (outside || (yield* there.kind(join(cwd, f))) !== 'file') {
        return yield* refuse(`${f} is not a file of the project`, 'name the paths you changed')
      }
    }
  })

// --- the acts ------------------------------------------------------------------------------------

const VERDICTS: Readonly<Record<string, Verdict>> = {
  pass: 'Pass',
  fail: 'Fail',
  'raise-tries': 'RaiseTries',
  'raise-no-rule': 'RaiseNoRule',
  'raise-misses': 'RaiseMisses',
}
const LEVELS: Readonly<Record<string, Level>> = {
  split: 'Split',
  fit: 'Fit',
  principle: 'Principle',
  direction: 'Direct',
  standard: 'Standard',
}
const pick = <A>(c: Ctx, table: Readonly<Record<string, A>>, i: number): Run<A> =>
  Effect.flatMap(word(c, i, Object.keys(table).join('|')), (w) => {
    const v = Object.hasOwn(table, w) ? table[w] : undefined
    return v === undefined
      ? usage(`work ${c.cmd}: "${w}" is none of ${Object.keys(table).join('|')}`)
      : Effect.succeed(v)
  })

const person = (parse: Spec['parse']): Spec => ({ by: 'person', parse })
const agent = (parse: Spec['parse']): Spec => ({ by: 'agent', parse })
const pure = (body: Body): Spec['parse'] => () => Effect.succeed(body)
const target = (shape: string) => (c: Ctx) => word(c, 0, shape)

const actorKey = (key: string): Run<Actor> => {
  const decoded = Schema.decodeUnknownOption(ActorSchema)(key)
  return decoded._tag === 'Some' ? Effect.succeed(decoded.value) : usage(`Unknown actor: ${key}`)
}

const answerText = (c: Ctx): Run<string> => {
  const value = c.args.one('text')
  return typeof value === 'string' ? Effect.succeed(value) : flag(c, 'text')
}

const readSchema = <S extends Schema.Top & { readonly DecodingServices: never }>(
  path: string, schema: S,
): Run<S['Type']> => Effect.flatMap(readFile(path), (value) => {
  const decoded = Schema.decodeUnknownOption(schema)(value)
  return decoded._tag === 'Some'
    ? Effect.succeed(decoded.value)
    : usage(`${path} does not contain the required form`)
})

const replies = {
  accept: 'AcceptIt', 'send-back': 'SendItBack', take: 'TakeAsIs', again: 'EvaluateAgain',
} as const

const respondWith = (c: Ctx, value: string, reply: Reply): Run<Body> => {
  const points = pointsOf(c)
  if (reply === 'SendItBack' && !points.length) return usage('Send back needs --points')
  return Effect.succeed({ _tag: 'Respond', ask: value, reply, points })
}

const SPECS: Readonly<Record<string, Spec>> = {
  end: person(pure({ _tag: 'EndProject' })),
  answer: { by: 'either', parse: (c) =>
    Effect.gen(function* () {
      const ask = yield* word(c, 0, 'an ask ID')
      const file = textOf(c.args.one('file'))
      const answer = file
        ? yield* readSchema(file, AnswerBodySchema)
        : { _tag: 'Single' as const, text: yield* answerText(c) }
      return { _tag: 'AnswerQuestion', ask, answer }
    }),
  },
  hear: agent((c) => Effect.map(target('an ask ID')(c), (ask) => ({ _tag: 'Hear', ask }))),
  'ask-raise': agent((c) => Effect.gen(function* () {
    const to = yield* actorKey(yield* word(c, 0, 'the actor asked'))
    return { _tag: 'AskRaise', to }
  })),
  respond: person((c) => Effect.gen(function* () {
    const ask = yield* word(c, 0, 'an ask ID')
    return yield* respondWith(c, ask, yield* pick(c, replies, 1))
  })),
  accept: person((c) => Effect.flatMap(target('an ask ID')(c),
    (ask) => respondWith(c, ask, 'AcceptIt'))),
  'send-back': person((c) => Effect.flatMap(target('an ask ID')(c),
    (ask) => respondWith(c, ask, 'SendItBack'))),
  reject: person((c) => Effect.gen(function* () {
    const task = yield* word(c, 0, 'a task')
    const points = pointsOf(c)
    if (!points.length) return yield* usage('Reject needs --points')
    return { _tag: 'Open', open: { _tag: 'OpenReject', task, points } }
  })),
  decide: person((c) => Effect.gen(function* () {
    const ask = yield* word(c, 0, 'an ask ID')
    return yield* respondWith(c, ask, yield* pick<Reply>(c, { take: 'TakeAsIs', again: 'EvaluateAgain' }, 1))
  })),
  'ask-edit': person((c) => Effect.map(fromFile(c, 'file', draftOf),
    (draft) => ({ _tag: 'AskEdit', draft }))),
  send: agent((c) =>
    Effect.gen(function* () {
      const spec = {
        name: yield* flag(c, 'name'),
        goal: yield* flag(c, 'goal'),
        sections: listOf(c.args.one('sections')),
        facts: yield* contextOfArgs(c.args),
        role: yield* flag(c, 'role'),
      }
      return { _tag: 'Open', open: { _tag: 'OpenSend', spec } }
    })
  ),
  reassign: agent(pure({ _tag: 'Reassign' })),
  'top-done': agent(pure({ _tag: 'TopDone' })),
  assign: agent((c) => Effect.map(target('a task')(c), (task) => ({ _tag: 'Open', open: { _tag: 'OpenMake', task } }))),
  review: agent((c) =>
    Effect.gen(function* () {
      const ask = yield* word(c, 0, 'a Check ask ID')
      return { _tag: 'Review', ask, verdict: yield* pick(c, VERDICTS, 1), points: pointsOf(c) }
    })
  ),
  resume: agent((c) => Effect.map(target('a maker')(c), (maker) => ({ _tag: 'Resume', maker }))),
  brief: agent((c) => Effect.map(makerOf(c), (maker) => ({ _tag: 'ReadBrief', maker }))),
  ask: agent((c) => Effect.gen(function* () {
    const to = yield* actorKey(c.words[0] ?? 'human')
    const file = textOf(c.args.one('file'))
    const title = textOf(c.args.one('question')) ?? textOf(c.args.one('text'))
    if (!file && title === undefined) return yield* usage('Ask needs --text or --file')
    const question = file
      ? yield* readSchema(file, QuestionBodySchema)
      : { title: title!, form: { _tag: 'Single' as const } }
    return { _tag: 'Open', open: { _tag: 'OpenQuestion', question, to } }
  })),
  report: agent((c) =>
    Effect.gen(function* () {
      const maker = yield* makerOf(c)
      const output = yield* flag(c, 'output')
      const files = listOf(c.args.one('files'))
      yield* checkFiles(files)
      const task = c.state.makers.get(maker)?.task
      const caught = task === undefined || files.length === 0
        ? new Set<ItemKey>()
        : yield* ranRules(caughtOn(c.state, task, files))
      const ask = yield* word(c, 0, 'an Execute ask ID')
      return { _tag: 'Report', ask, output, files, caught }
    })
  ),
  evaluate: agent((c) =>
    Effect.gen(function* () {
      const task = yield* word(c, 0, 'a task')
      const level = yield* pick(c, LEVELS, 1)
      const summary = yield* flag(c, 'summary')
      const parts = level === 'Split' ? yield* fromFile(c, 'parts', partsOf) : []
      const roleDraft = level === 'Fit' ? yield* fromFile(c, 'role-draft', cardOf) : null
      return { _tag: 'Evaluate', fix: task, level, parts, roleDraft, summary }
    })
  ),
  advance: agent((c) => Effect.map(target('a fix')(c), (fix) => ({ _tag: 'Advance', fix }))),
  rule: agent((c) =>
    Effect.gen(function* () {
      const fix = yield* word(c, 0, 'a fix')
      const raw = yield* readFile(yield* word(c, 1, 'a rule file'))
      const r = isObj(raw) ? raw : {}
      const id = text(r.id)
      const std = text(r.standard)
      if (id === null || std === null) {
        return yield* refuse('the rule file needs id, standard, says')
      }
      const parent = std.startsWith('std:') ? std : `std:${std}`
      if (!c.state.items.has(parent)) return yield* refuse(`${parent} is no standard of the state`)
      const rule = `rule:${id}`
      const rec = yield* recOf(rule, { ...r, name: id }, parent)
      const { cwd } = yield* Dir
      const refOk = rec.ref === null ? true : yield* refExists(cwd, rec.ref)
      return { _tag: 'WriteRule', fix, rule, rec, refOk, fights: listOf(c.args.one('fights')) }
    })
  ),
  'rule-test': agent((c) =>
    Effect.gen(function* () {
      const fix = yield* word(c, 0, 'a fix')
      const { own, contra } = yield* ranRules(runTest(c.state, fix))
      return { _tag: 'RunTest', fix, own, contra }
    })
  ),
  ship: agent((c) =>
    Effect.gen(function* () {
      const fix = yield* word(c, 0, 'a fix')
      const draft = yield* Effect.flatMap(word(c, 1, 'a draft file'), (f) =>
        Effect.flatMap(readFile(f), draftOf))
      const recorded = fixOf(c.state, fix)
      const mechanical = recorded.form === 'Mech' || recorded.form === 'Both'
      const resolved = mechanical && recorded.contradicted
        ? yield* ranRules(resolvesFight(c.state, fix, draft))
        : !mechanical && c.args.one('resolves') === true
      return { _tag: 'Ship', fix, items: new Set(draft.keys()), draft, resolvesFight: resolved }
    })
  ),
  loop: agent((c) =>
    Effect.gen(function* () {
      const fix = yield* word(c, 0, 'a fix')
      const toPerson = yield* pick(c, { person: true, revise: false }, 1)
      const mode = Schema.decodeUnknownOption(LoopReviewMode)(textOf(c.args.one('mode')))
      if (mode._tag === 'None') {
        return yield* usage('work loop needs --mode="self-review turns", "fresh subagent", or "other provider"')
      }
      return { _tag: 'LoopReview', fix, toPerson, mode: mode.value }
    })
  ),
  recheck: agent((c) =>
    Effect.gen(function* () {
      const task = yield* word(c, 0, 'a task')
      const holds = yield* pick(c, { holds: true, fails: false }, 1)
      if (onOf(c.args) === null) return yield* usage('work recheck needs --on from the dispatched brief')
      const items = listOf(yield* flag(c, 'items'))
      if (items.length === 0 || new Set(items).size !== items.length) {
        return yield* usage('work recheck needs a nonempty list of distinct item keys in --items')
      }
      return { _tag: 'RecheckDone', task, items: new Set<ItemKey>(items), holds }
    })
  ),
  'rule-run': {
    by: 'harness',
    parse: (c) =>
      Effect.gen(function* () {
        const task = yield* word(c, 0, 'a task')
        const holds = yield* ranRules(ruleHolds(c.state, c.events, task))
        return { _tag: 'RunRule', task, holds }
      }),
  },
}

// --- one act -------------------------------------------------------------------------------------

// The id of an act: what the sender wrote (the harness fields are the same on a repeat, or not
// the sender's), so a repeated command is the same act.
const senderOf = (w: Body): Body => {
  switch (w._tag) {
    case 'Report':
      return { ...w, caught: new Set() }
    case 'WriteRule':
      return { ...w, refOk: true }
    case 'RunTest':
      return { ...w, own: true, contra: [] }
    case 'RunRule':
      return { ...w, holds: false }
    default:
      return w
  }
}
const idOf = (
  who: Actor, ep: number, body: Body, on: number | null, state: WorkState,
): string => {
  let occurrence = body._tag === 'ReadBrief' ? vsum(state) : on
  if (body._tag === 'Open' && body.open._tag === 'OpenQuestion') {
    const to = body.open.to
    const pending = findAsk(state, { kind: 'Question', from: who, to, about: { _tag: 'None' } })
    const answered = [...state.answered.values()].some(({ ask }) =>
      keyOf(ask.from) === keyOf(who) && keyOf(ask.to) === keyOf(to))
    occurrence = askCountOf(state, who, to) - (pending || answered ? 1 : 0)
  }
  return sha(JSON.stringify([who, ep, Schema.encodeSync(BodySchema)(senderOf(body)), occurrence]))
}

// The state and events of the dir; no Work.Opened yet is "no top is open".
const readFolded = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const store = yield* (yield* Store).open(cwd, { create: false })
  const events = yield* store.events
  yield* gate(events)
  const folded = foldWork(events)
  return folded === null ? yield* WORK.noTop() : { events, folded }
})

// The person: git user.name checked against the people of the config.
const personOf = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const loaded = yield* loadWork(cwd)
  return yield* personAuthor(loaded._tag === 'NoStore' ? undefined : loaded.work)
})

const outcome = (body: Body, seq: number, again: boolean): string =>
  again
    ? `${body._tag} was taken already (event e${seq}); nothing changed.`
    : `${body._tag} taken (event e${seq}).`

const runAct = (cmd: string, spec: Spec): Command => (call) =>
  Effect.gen(function* () {
    const { events, folded } = yield* readFolded
    const asAgent = spec.by === 'agent' || (spec.by === 'either' && call.token !== null)
    const asHuman = spec.by === 'person' || (spec.by === 'either' && !asAgent)
    const candidate = /^w\.(.+)\.(\d+)\.[a-z0-9]+$/.exec(call.token ?? '')
    const runtime = foldRuntime(events)
    const identity = candidate?.[1]
    if (identity?.startsWith('review:')) return yield* refuse('A review child only acknowledges and completes its allocation.')
    const managed = identity !== undefined && (runtime.placements.some((placement) => placement.members.includes(identity)) ||
      runtime.serial.has(identity) || childFor(runtime, identity) !== undefined)
    const actor = !asAgent ? null : managed && identity !== undefined
      ? { who: identity, ep: Number(candidate?.[2]) }
      : yield* verifyWork(folded, call.token)
    const author: Author = asHuman ? yield* personOf : { _tag: 'System' }
    const who = actor ? actorOf(actor.who) : asHuman ? HUMAN : HARNESS
    const ep = actor?.ep ?? 0
    const ctx: Ctx = {
      cmd,
      words: call.args.positional,
      args: call.args,
      who,
      state: folded.state,
      events,
    }
    const body = yield* spec.parse(ctx)
    const on = onOf(call.args)
    const turn = textOf(call.args.one('turn'))
    const recheckJob = textOf(call.args.one('job'))
    const recheckReport = textOf(call.args.one('report'))
    if ((recheckJob === undefined) !== (recheckReport === undefined)) {
      return yield* usage('Use both --job and --report for a helper verdict.')
    }
    const baseId = idOf(who, ep, body, on, folded.state)
    const acted = yield* dispatchAct({
      by: author,
      act: { id: turn === undefined ? baseId : sha(JSON.stringify([who, ep, body._tag, on, turn])), who, ep, body },
      ...(asAgent && call.token !== null ? { credential: call.token } : {}),
      ...(turn === undefined ? {} : { turn }),
      ...(recheckJob && recheckReport ? { recheck: { job: recheckJob, report: recheckReport } } : {}),
      on,
      build: null,
      current: 'cli',
      ...(['Report', 'WriteRule', 'RunTest', 'Ship', 'RunRule'].includes(body._tag)
        ? { evidence: folded.state.ver }
        : {}),
    })
    if (actor?.who === 'host' && call.token !== null) {
      yield* retireHostDelivery((yield* Dir).cwd, call.token)
    }
    const line = outcome(body, acted.seq, acted.again)
    const token = acted.token
    const route = acted.makerRoute
    const made = route ? route.child === null
      ? [`${route.actor} will work on this worker. Run the worker wait again for its turn.`]
      : [`Reserved ${route.child} for ${route.actor}. Run work worker child-start ${call.token} ${route.child}.`]
      : token !== null
      ? madeLines(token.actor, workTokenOf(token.actor, token.ep, token.secret))
      : acted.again && ((body._tag === 'Open' && body.open._tag === 'OpenMake') || body._tag === 'Resume')
      ? ['  its token was printed by the first run.']
      : []
    if (body._tag === 'ReadBrief') {
      const after = yield* (yield* (yield* Store).open((yield* Dir).cwd, { create: false })).events
      const brief = briefOf(acted.state, after, body.maker)
      return runtime.serial.has(keyOf(who))
        ? [...brief.slice(0, -2), 'Run work worker wait with your worker credential for the report turn.']
        : brief
    }
    const placement = runtime.placements.find((entry) => entry.members.includes(keyOf(who)))
    const groupWait = runtime.serial.has(keyOf(who)) || (placement !== undefined && !privateWorker(placement))
    const next = call.token === null || body._tag === 'Report' && childFor(runtime, keyOf(who))
      ? []
      : [groupWait ? 'Your next step: run work worker wait with your worker credential.'
        : `Your next step: run work wait ${call.token} again.`]
    return [line, ...made, ...next]
  })

const recheckBrief: Command = (call) =>
  Effect.gen(function* () {
    const { vars } = yield* Env
    if (call.args.positional[0]?.startsWith('h.') || vars.ARISTOTELES_RECHECK_CREDENTIAL) {
      return yield* helperBrief(call)
    }
    const [task, ...rest] = call.args.positional
    if (!task || rest.length) return yield* usage('work recheck-brief needs one task')
    const { folded, events } = yield* readFolded
    const current = folded.state
    const on = onOf(call.args)
    if (call.args.one('on') !== undefined && (on === null || on > current.seq)) {
      return yield* usage('work recheck-brief needs a valid --on from the dispatched step')
    }
    const state = on === null || on === current.seq ? current : workViewAt(events, on)
    if (state === null) return yield* WORK.noTop()
    const brief = recheckBriefOf(state, task)
    return brief ?? (yield* refuse(`Task ${task} owes no pipeline recheck on --on ${state.seq}`,
      'use the basis printed for its recheck step'))
  })

// --- the commands --------------------------------------------------------------------------------

const ACTS = [
  'end',
  'answer',
  'hear',
  'ask-raise',
  'respond',
  'ask-edit',
  'accept',
  'send-back',
  'reject',
  'decide',
  'send',
  'reassign',
  'top-done',
  'assign',
  'review',
  'resume',
  'brief',
  'ask',
  'report',
  'evaluate',
  'advance',
  'rule',
  'rule-test',
  'rule-run',
  'ship',
  'loop',
  'recheck',
] as const

const fresh = (names: ReadonlyArray<string>): Commands =>
  Object.fromEntries(names.flatMap((n) => {
    const spec = SPECS[n]
    return spec === undefined ? [] : [[n, runAct(n, spec)] as const]
  }))

// work top open --name= --goal= --sections=a,b: the person opens the top; each actor's token.
export const topCommand = (open: typeof openTop): Command => (call) =>
  Effect.gen(function* () {
    if (call.args.positional[0] !== 'open') {
      return yield* usage('work top open --name= --goal= --sections=a,b')
    }
    const by = yield* personOf
    const name = textOf(call.args.one('name'))
    const goal = textOf(call.args.one('goal'))
    if (name === undefined || goal === undefined) {
      return yield* usage('work top open needs --name="<...>" --goal="<...>" --sections=a,b')
    }
    const sections = listOf(call.args.one('sections'))
    const facts = yield* contextOfArgs(call.args)
    const { cwd } = yield* Dir
    const binding = activationOf(yield* activationEvents(cwd))?.binding
    const opened = yield* open({
      by, name, goal, sections, facts,
      ...(binding ? { hostSession: bootstrapSession(binding.launch), hostLaunch: binding.launch } : {}),
    })
    return [
      `Top "${name}" opened (event e${opened.seq}): ${goal}`,
      `Sections: ${sections.join(', ')}`,
      ...contextWords(facts),
      'Each actor runs work wait with its token:',
      ...(opened.hostBound ? ['  host: holds its token from activation'] : []),
      ...opened.secrets.map((t) => `  ${t.actor}: ${workTokenOf(t.actor, 0, t.secret)}`),
    ]
  })

// The person's pane for the host: the socket (the first part of $TMUX) and $TMUX_PANE.
const paneOfPerson = Effect.gen(function* () {
  const { vars } = yield* Env
  const socket = (vars.TMUX ?? '').split(',')[0] ?? ''
  const pane = vars.TMUX_PANE ?? ''
  return socket === '' || !/^%\d+$/.test(pane)
    ? yield* refuse(
      'the host runs inside tmux, so that the page shows its terminal',
      'start this AI CLI in a tmux pane, then run work run continue',
    )
    : { socket, pane }
})

// work run continue (the person, in the pane of the host): the host is down, so it is revived;
// else the host moves here, from the session of the view. The new token is printed, with the
// host's first words.
const runContinue: Command = () =>
  Effect.gen(function* () {
    const { events, folded } = yield* readFolded
    const by = yield* personOf
    const runtime = foldRuntime(events)
    const placement = runtime.placements.find(({ members }) => members.includes('host'))
    if (placement) {
      if (!privateWorker(placement)) {
        return yield* refuse('The Host shares a worker. Its identity cannot move on its own.')
      }
      const { cwd } = yield* Dir
      if (folded.hostSession !== null) {
        yield* acquireBootstrapWorker(cwd, placement.worker, folded.hostSession)
      }
      yield* activationLock(cwd)
      const current = foldRuntime(yield* activationEvents(cwd)).workers.get(placement.worker)
      if (current && !current.ended) {
        const { worker, generation, launch } = current.reservation
        const fenced = yield* settleWorker(worker, generation, launch)
        if (fenced === null) return ['The Host worker is already being replaced.']
      }
      return ['The Host worker will resume in a new managed session.']
    }
    const pane = yield* paneOfPerson
    const s = folded.state
    const body: Body = s.down.has('host')
      ? { _tag: 'Revive', actor: HOST }
      : { _tag: 'MoveHost', fromSession: s.session }
    const on = s.seq
    const acted = yield* dispatchAct({
      by,
      act: { id: idOf(HUMAN, 0, body, on, s), who: HUMAN, ep: 0, body },
      on,
      build: null,
      current: 'cli',
    })
    if (acted.token === null) return [outcome(body, acted.seq, acted.again)]
    yield* recordHostPane(by, pane)
    const token = workTokenOf(acted.token.actor, acted.token.ep, acted.token.secret)
    return [outcome(body, acted.seq, false), `  host: ${token}`, ...hostWords(acted.state, token)]
  })

// work hook stopped <token>: the CLI of the actor stopped at its prompt, so its exit is recorded
// (the harness; nothing when the token is old or the actor is down). A hook never breaks the CLI:
// no output, and no failure.
const hook: Command = (call) =>
  Effect.gen(function* () {
    const { events, folded } = yield* readFolded
    const { who, ep } = yield* verifyWork(folded, call.token)
    if (call.args.positional[0] !== 'stopped' ||
      foldRuntime(events).placements.some((placement) => placement.members.includes(who)) ||
      childFor(foldRuntime(events), who)) return []
    if (ep !== epochOf(folded.state, actorOf(who)) || folded.state.down.has(who)) return []
    const body: Body = { _tag: 'Exit', actor: actorOf(who) }
    yield* dispatchAct({
      by: { _tag: 'System' },
      act: { id: idOf(HARNESS, ep, body, null, folded.state), who: HARNESS, ep: 0, body },
      on: null,
      build: null,
      current: 'cli',
      actorEpoch: ep,
    })
    return []
  }).pipe(Effect.catch(() => Effect.succeed([])))

// work forward <host-token> <person-act ...> --quote="<their words>": the host carries the
// person's words from its chat as the person's act (the same words as the person's command, with
// its --on); it waits on the page for the person's confirm.
const forward: Command = (call) =>
  Effect.gen(function* () {
    const { events, folded } = yield* readFolded
    const { who } = yield* verifyWork(folded, call.token)
    if (who !== 'host') return yield* refuse('only the host forwards', 'leave it to the host')
    const [word = '', ...words] = call.args.positional
    const spec = Object.hasOwn(SPECS, word) ? SPECS[word] : undefined
    if (spec?.by !== 'person' && spec?.by !== 'either') {
      return yield* usage('work forward <token> end|answer|respond|reject|ask-edit ...')
    }
    const quote = textOf(call.args.one('quote'))
    if (quote === undefined) return yield* usage('work forward needs --quote="<their words>"')
    const ctx: Ctx = { cmd: word, words, args: call.args, who: HUMAN, state: folded.state, events }
    const body = yield* spec.parse(ctx)
    const id = yield* recordForward({ _tag: 'System' }, { act: body, on: onOf(call.args), quote })
    return [`${id}: ${body._tag} waits for the person to confirm it on the page.`]
  })

// work run continue is the only act of `run`; it lives here with the host's acts.
const run: Command = (call) =>
  call.args.positional.length === 1 && call.args.positional[0] === 'continue'
    ? runContinue(call)
    : usage('work run continue (the host, in its own tmux pane)')

export const commands: Commands = { ...fresh(ACTS), 'recheck-brief': recheckBrief, run, top: topCommand(openTop), hook, forward }

// Format 16 question and answer commands bind the addressed recipient or question before intake.
export const projectQuestionCommand = (
  journal: Journal, command: 'question' | 'answer', target: string, read: Of<typeof ReadPosition>, yaml: string,
): Effect.Effect<Committed, ProjectRefusal, ProjectAuthority> => Effect.gen(function* () {
  const raw = yield* Effect.try({
    try: () => parseYaml(yaml),
    catch: () => projectRefuse('InvalidInput', Rationale.make('Load a valid YAML question or answer.')),
  })
  if (command === 'answer') {
    const id = yield* decodeQuestionInput(QuestionId, target)
    const answer = yield* decodeQuestionInput(ProjectAnswer, raw)
    return yield* submitQuestion(journal, read, { _tag: 'Answer', line: { _tag: 'Question', id }, answer })
  }
  const to = yield* decodeQuestionInput(StoredActor, { _tag: target.startsWith('human:') ? 'Human' : 'Staff', id: target })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || 'to' in raw) {
    return yield* Effect.fail(projectRefuse('InvalidInput', Rationale.make('Address the recipient in the command.')))
  }
  const question = yield* decodeQuestionInput(QuestionDraft, { ...raw, to })
  return yield* submitQuestion(journal, read, { _tag: 'Question', question })
})
