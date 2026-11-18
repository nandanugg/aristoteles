// The commands of the work model's acts (P2). One generic path: who calls (an agent by its work
// token, the person at a terminal, or the harness), the words of the command made into a What, the
// harness fields filled from the current state (the rule runner), then dispatchAct: the store
// checks the act and appends it. The basis travels with the step: --on <n> is the seq of the view
// the step was derived from. An agent's next step is not printed: it runs `work wait` again.
import { isAbsolute, join } from 'node:path'
import { Effect, Schema } from 'effect'
import { dispatchAct, formOf, openTop, recordHostPane } from '../../../core/actions/work.ts'
import {
  caughtOn,
  pendingHold,
  refExists,
  runTest,
  type RuleRunFailed,
} from '../../../core/effects/rules.ts'
import {
  type Author,
  type Expected,
  type Recorded,
  refuse,
  UsageError,
  WhatSchema,
} from '../../../core/schema/index.ts'
import { Dir, Env, Files, parseYaml, sha, Store } from '../../../core/services/index.ts'
import { loadWork } from '../../../core/state/index.ts'
import { foldWork } from '../../../core/state/work/fold.ts'
import { epOf } from '../../../core/state/work/reads.ts'
import type {
  Actor,
  ItemKey,
  ItemRec,
  Level,
  RoleDraft,
  TaskSpec,
  Verdict,
  What,
  WorkState,
} from '../../../core/state/work/types.ts'
import { HARNESS, HOST, kindOf, PERSON } from '../../../core/state/work/types.ts'
import { briefOf, hostWords } from '../../words/work.ts'
import { type Args, textOf } from '../args.ts'
import { personAuthor, verifyWork, workTokenOf } from '../caller.ts'
import type { Call, CliServices, Command, Commands } from '../command.ts'
import { WORK } from '../../../core/actions/work.ts'

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
  readonly by: 'person' | 'agent' | 'harness'
  readonly parse: (c: Ctx) => Run<What>
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
  c.who.startsWith('maker:')
    ? Effect.succeed(c.who.slice('maker:'.length))
    : usage(`work ${c.cmd} is for a maker; ${c.who} is not one`)

// --- files: a YAML or JSON the command reads ---------------------------------------------------

const isObj = (v: unknown): v is Readonly<Record<string, unknown>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

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
  return name === null || goal === null || role === null
    ? refuse('a part needs name, goal, sections and role')
    : Effect.succeed({ name, goal, role, sections })
}
const partsOf = (raw: unknown): Run<ReadonlyArray<TaskSpec>> =>
  Array.isArray(raw)
    ? Effect.forEach(raw, specOf)
    : refuse('the parts file is a list of {name, goal, sections, role}')
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
  const where = Array.isArray(r.where) ? r.where.filter((s) => typeof s === 'string') : null
  return Effect.succeed({
    kind: kindOf(key),
    parent: text(r.parent) ?? parent,
    name: text(r.name) ?? key.slice(key.indexOf(':') + 1),
    says,
    where,
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

// The paths of the last Report of a task.
const filesOfLast = (s: WorkState, events: ReadonlyArray<Recorded>, task: string) =>
  events.flatMap((r) =>
    r.event._tag === 'Work' && r.event.create._tag === 'Acted' &&
      r.event.create.act.what._tag === 'Report' &&
      s.makers.get(r.event.create.act.what.maker)?.task === task
      ? [r.event.create.act.what.files]
      : []
  ).at(-1) ?? []

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
const pure = (what: What): Spec['parse'] => () => Effect.succeed(what)
const target = (shape: string) => (c: Ctx) => word(c, 0, shape)

const SPECS: Readonly<Record<string, Spec>> = {
  end: person(pure({ _tag: 'EndProject' })),
  answer: person((c) =>
    Effect.gen(function* () {
      const asker = yield* word(c, 0, 'the asker (an actor of an open question)')
      return { _tag: 'Answer', asker, answer: yield* flag(c, 'text') }
    })
  ),
  accept: person((c) => Effect.map(target('a fix')(c), (fix) => ({ _tag: 'Accept', fix }))),
  'send-back': person((c) =>
    Effect.map(target('a fix')(c), (fix) => ({ _tag: 'SendBack', fix, points: pointsOf(c) }))
  ),
  reject: person((c) =>
    Effect.map(target('a task')(c), (task) => ({ _tag: 'Reject', task, points: pointsOf(c) }))
  ),
  decide: person((c) =>
    Effect.gen(function* () {
      const task = yield* word(c, 0, 'a task')
      const take = yield* pick(c, { take: true, again: false }, 1)
      return { _tag: 'Decide', task, take }
    })
  ),
  send: agent((c) =>
    Effect.gen(function* () {
      const spec = {
        name: yield* flag(c, 'name'),
        goal: yield* flag(c, 'goal'),
        sections: listOf(c.args.one('sections')),
        role: yield* flag(c, 'role'),
      }
      return { _tag: 'SendTask', spec }
    })
  ),
  reassign: agent(pure({ _tag: 'Reassign' })),
  'top-done': agent(pure({ _tag: 'TopDone' })),
  assign: agent((c) => Effect.map(target('a task')(c), (task) => ({ _tag: 'AssignDo', task }))),
  review: agent((c) =>
    Effect.gen(function* () {
      const task = yield* word(c, 0, 'a task')
      return { _tag: 'Review', task, v: yield* pick(c, VERDICTS, 1), points: pointsOf(c) }
    })
  ),
  resume: agent((c) => Effect.map(target('a maker')(c), (maker) => ({ _tag: 'Resume', maker }))),
  brief: agent((c) => Effect.map(makerOf(c), (maker) => ({ _tag: 'ReadBrief', maker }))),
  ask: agent((c) =>
    Effect.map(flag(c, 'text'), (question) => ({ _tag: 'Ask', asker: c.who, question }))
  ),
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
      return { _tag: 'Report', maker, output, files, caught }
    })
  ),
  evaluate: agent((c) =>
    Effect.gen(function* () {
      const task = yield* word(c, 0, 'a task')
      const level = yield* pick(c, LEVELS, 1)
      const summary = yield* flag(c, 'summary')
      const parts = level === 'Split' ? yield* fromFile(c, 'parts', partsOf) : []
      const roleDraft = level === 'Fit' ? yield* fromFile(c, 'role-draft', cardOf) : null
      return { _tag: 'Evaluate', task, level, parts, roleDraft, summary }
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
      return { _tag: 'WriteRule', fix, rule, rec, refOk }
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
      return { _tag: 'Ship', fix, items: new Set(draft.keys()), draft }
    })
  ),
  loop: agent((c) =>
    Effect.gen(function* () {
      const fix = yield* word(c, 0, 'a fix')
      const toPerson = yield* pick(c, { person: true, revise: false }, 1)
      return { _tag: 'LoopReview', fix, toPerson }
    })
  ),
  recheck: agent((c) =>
    Effect.gen(function* () {
      const task = yield* word(c, 0, 'a task')
      const holds = yield* pick(c, { holds: true, fails: false }, 1)
      return { _tag: 'RecheckDone', task, items: new Set<ItemKey>(), holds }
    })
  ),
  'rule-run': {
    by: 'harness',
    parse: (c) =>
      Effect.gen(function* () {
        const task = yield* word(c, 0, 'a task')
        const files = filesOfLast(c.state, c.events, task)
        const holds = files.length === 0 || c.state.tasks.get(task) === undefined
          ? true
          : yield* ranRules(pendingHold(c.state, task, files))
        return { _tag: 'RunRule', task, holds }
      }),
  },
}

// --- one act -------------------------------------------------------------------------------------

// The id of an act: what the sender wrote (the harness fields are the same on a repeat, or not
// the sender's), so a repeated command is the same act.
const senderOf = (w: What): What => {
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
const idOf = (who: Actor, ep: number, what: What, on: number | null): string =>
  sha(JSON.stringify([who, ep, Schema.encodeSync(WhatSchema)(senderOf(what)), on]))

// The state and events of the dir; no Work.Opened yet is "no top is open".
const readFolded = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const store = yield* (yield* Store).open(cwd, { create: false })
  const events = yield* store.events
  const folded = foldWork(events)
  return folded === null ? yield* WORK.noTop() : { events, folded }
})

// The person: git user.name checked against the people of the config.
const personOf = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const loaded = yield* loadWork(cwd)
  return yield* personAuthor(loaded._tag === 'NoStore' ? undefined : loaded.work)
})

const outcome = (what: What, seq: number, again: boolean): string =>
  again
    ? `${what._tag} was taken already (event e${seq}); nothing changed.`
    : `${what._tag} taken (event e${seq}).`

const runAct = (cmd: string, spec: Spec): Command => (call) =>
  Effect.gen(function* () {
    const { events, folded } = yield* readFolded
    const author: Author = spec.by === 'person' ? yield* personOf : { _tag: 'System' }
    const actor = spec.by === 'agent' ? yield* verifyWork(folded, call.token) : null
    const who = actor?.who ?? (spec.by === 'person' ? PERSON : HARNESS)
    const ep = actor?.ep ?? 0
    const ctx: Ctx = {
      cmd,
      words: call.args.positional,
      args: call.args,
      who,
      state: folded.state,
      events,
    }
    const what = yield* spec.parse(ctx)
    const on = onOf(call.args)
    const acted = yield* dispatchAct({
      by: author,
      act: { id: idOf(who, ep, what, on), who, ep, what },
      on,
      build: null,
      current: 'cli',
    })
    const line = outcome(what, acted.seq, acted.again)
    const token = acted.token
    const made = token !== null
      ? [`  ${token.actor}: ${workTokenOf(token.actor, token.ep, token.secret)}`]
      : acted.again && (what._tag === 'AssignDo' || what._tag === 'Resume')
      ? ['  its token was printed by the first run.']
      : []
    if (what._tag === 'ReadBrief') {
      const after = yield* (yield* (yield* Store).open((yield* Dir).cwd, { create: false })).events
      return briefOf(acted.state, after, what.maker)
    }
    const next = call.token === null
      ? []
      : [`Your next step: run work wait ${call.token} again.`]
    return [line, ...made, ...next]
  })

// --- the commands --------------------------------------------------------------------------------

// The acts that no old command has.
const NEW = [
  'end',
  'accept',
  'send-back',
  'reject',
  'decide',
  'reassign',
  'top-done',
  'advance',
  'rule',
  'rule-test',
  'rule-run',
  'ship',
  'loop',
  'recheck',
  'resume',
] as const
// The commands that the old CLI had: the work token (w.<actor>...) makes the new act, any other
// call goes to the old command until phase 5 removes it.
const SHARED = ['send', 'assign', 'review', 'brief', 'ask', 'report', 'evaluate'] as const

const isWork = (call: Call): boolean => call.token?.startsWith('w.') === true

// The person's answer to an agent's question names the asker, not a question id (q1).
const answerIsNew = (call: Call): boolean => !/^q\d+$/.test(call.args.positional[0] ?? '')

// The new `work run continue` has no run id (the old one names a run and the person's words).
const isContinue = (call: Call): boolean =>
  call.args.positional.length === 1 && call.args.positional[0] === 'continue'

const fresh = (names: ReadonlyArray<string>): Commands =>
  Object.fromEntries(names.flatMap((n) => {
    const spec = SPECS[n]
    return spec === undefined ? [] : [[n, runAct(n, spec)] as const]
  }))

// The old commands with the new acts beside them.
export const sharing = (old: Commands): Commands => {
  const both = (n: (typeof SHARED)[number]): Command => {
    const was = old[n]
    const now = runAct(n, SPECS[n] as Spec)
    return (call) => (isWork(call) || was === undefined ? now(call) : was(call))
  }
  const answer = old.answer
  const now = runAct('answer', SPECS.answer as Spec)
  const oldRun = old.run
  return {
    ...Object.fromEntries(SHARED.map((n) => [n, both(n)] as const)),
    run: (call) =>
      oldRun === undefined || isContinue(call) ? runContinue(call) : oldRun(call),
    answer: (call) => (answer === undefined || answerIsNew(call) ? now(call) : answer(call)),
  }
}

// work top open --name= --goal= --sections=a,b: the person opens the top; each actor's token.
const top: Command = (call) =>
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
    const opened = yield* openTop({ by, name, goal, sections })
    return [
      `Top "${name}" opened (event e${opened.seq}): ${goal}`,
      `Sections: ${sections.join(', ')}`,
      'Each actor runs work wait with its token:',
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
    const { folded } = yield* readFolded
    const by = yield* personOf
    const pane = yield* paneOfPerson
    const s = folded.state
    const what: What = s.down.has(HOST)
      ? { _tag: 'Revive', who: HOST }
      : { _tag: 'MoveHost', fromSession: s.session }
    const on = s.seq
    const acted = yield* dispatchAct({
      by,
      act: { id: idOf(PERSON, 0, what, on), who: PERSON, ep: 0, what },
      on,
      build: null,
      current: 'cli',
    })
    if (acted.token === null) return [outcome(what, acted.seq, acted.again)]
    yield* recordHostPane(by, pane)
    const token = workTokenOf(acted.token.actor, acted.token.ep, acted.token.secret)
    return [outcome(what, acted.seq, false), `  host: ${token}`, ...hostWords(acted.state, token)]
  })

// work hook stopped <token>: the CLI of the actor stopped at its prompt, so its exit is recorded
// (the harness; nothing when the token is old or the actor is down). A hook never breaks the CLI:
// no output, and no failure.
const hook: Command = (call) =>
  Effect.gen(function* () {
    const { folded } = yield* readFolded
    const { who, ep } = yield* verifyWork(folded, call.token)
    if (call.args.positional[0] !== 'stopped') return []
    if (ep !== epOf(folded.state, who) || folded.state.down.has(who)) return []
    const what: What = { _tag: 'Exit', who }
    yield* dispatchAct({
      by: { _tag: 'System' },
      act: { id: idOf(HARNESS, ep, what, null), who: HARNESS, ep: 0, what },
      on: null,
      build: null,
      current: 'cli',
    })
    return []
  }).pipe(Effect.catch(() => Effect.succeed([])))

export const commands: Commands = { ...fresh(NEW), top, hook }
