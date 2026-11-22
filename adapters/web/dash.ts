// The dashboard of a project (DESIGN 10, 10.1) as one pure value: the folded work,
// the roles of the config and the readings of the terminals go in, the whole Dash comes out. The
// page draws from a whole copy of it (browser.qnt). No clock here: `now` comes in.
import type { TerminalReading, WaitMarker } from '../../core/schema/outside.ts'
import { dos, owed } from '../../core/derived/c16/obligations.ts'
import { sessionAt } from '../../core/effects/engine.ts'
import { epochOf, liveMaker, verOf } from '../../core/state/c16/reads.ts'
import type { Task, WorkState } from '../../core/state/c16/state.ts'
import { type Actor, type Body, keyOf } from '../../core/state/c16/types.ts'
import { EDIT, type ItemKey, type ItemRec } from '../../core/state/c16/data.ts'
import type { Dash, DashStatusWord, DashTerminalCard } from './contract.ts'

const HOST: Actor = { _tag: 'Host' }
const PIPE: Actor = { _tag: 'Pipe' }

export interface DashForwardInput {
  readonly id: string
  readonly quote: string
  readonly body: Body
}

// The usage-limit message of the AI CLI (Claude Code: "5-hour limit reached", "Claude usage
// limit reached"), the one place that knows its text.
export const USAGE_LIMIT = /\b(?:usage|5-hour|weekly|session) limit reached\b/i
// A terminal with no wait beat and no output for this long is Inactive.
export const SILENT_MS = 60000

// What the page reads of one terminal: its pane lives, when it last printed, its last lines.
export interface Reading {
  readonly alive: boolean
  readonly lastOutput: number
  readonly tail: string
}

export interface DashInput {
  readonly dir: string
  readonly build: string
  readonly now: number
  readonly state: WorkState
  // The bound host's session of an activated workflow (core/state/c16/fold.ts), else null.
  readonly hostSession: string | null
  // The config: the host's model (the person's AI CLI: '' when unknown) and the pipeline role.
  readonly host: { readonly model: string; readonly reading: Reading | null }
  readonly pipe: { readonly name: string; readonly model: string } | null
  // The pump's terminals and their last lines by session, and the markers of `work wait`.
  readonly terminals: Readonly<Record<string, TerminalReading>>
  readonly tails: Readonly<Record<string, string>>
  readonly markers: ReadonlyArray<WaitMarker>
  // The acts that the host forwarded and the person has not confirmed or dropped.
  readonly forwards: ReadonlyArray<DashForwardInput>
  // The principle tags of each direction (`dir:<id>`), from the old Work direction record.
  readonly principles: Readonly<Record<ItemKey, ReadonlyArray<string>>>
}

const FIRST = 3

// --- the terminal cards --------------------------------------------------------------------------

const readingOf = (i: DashInput, actor: Actor): Reading | null => {
  if (actor._tag === 'Host') return i.host.reading
  const t = i.terminals[sessionAt(i.hostSession, keyOf(actor), epochOf(i.state, actor))]
  return t === undefined
    ? null
    : {
      alive: t._tag === 'Live',
      lastOutput: t.lastOutput,
      tail: i.tails[sessionAt(i.hostSession, keyOf(actor), epochOf(i.state, actor))] ?? '',
    }
}

// The last wait beat of the actor's current terminal (a marker of another session is old).
const beatOf = (i: DashInput, actor: Actor): number => {
  const key = keyOf(actor)
  const session = sessionAt(i.hostSession, key, epochOf(i.state, actor))
  return i.markers
    .filter((m) => m.actor === key && (m.session === null || m.session === session))
    .reduce((at, m) => Math.max(at, m.beat), 0)
}

// DESIGN 10: Inactive belongs to the terminal (down, no live pane, the limit message, silence);
// else Working only on real work of the role itself (dos); waiting on a maker is Waiting.
const statusOf = (i: DashInput, actor: Actor): DashStatusWord => {
  const r = readingOf(i, actor)
  const silent = r !== null && i.now - Math.max(beatOf(i, actor), r.lastOutput) >= SILENT_MS
  if (i.state.down.has(keyOf(actor)) || !r?.alive || USAGE_LIMIT.test(r.tail) || silent) {
    return 'Inactive'
  }
  return dos(i.state, actor).length > 0 ? 'Working' : 'Waiting'
}

const DOING: Readonly<Record<string, string>> = {
  Evaluate: 'Evaluating',
  Advance: 'Assessing',
  WriteRule: 'Writing a rule for',
  RunTest: 'Testing the rule of',
  Ship: 'Drafting',
  LoopReview: 'Reviewing the draft of',
  Open: 'Starting work on',
  Reassign: 'Reassigning after',
  TopDone: 'Returning',
  AnswerQuestion: 'Answering a question about',
  Hear: 'Reading an answer about',
  Review: 'Reviewing',
  Resume: 'Resuming the maker of',
  RecheckDone: 'Rechecking',
}

const nameOf = (s: WorkState, target: string | null): string => {
  if (target === null) return s.top.name
  if (target === EDIT) return 'your direction edit'
  const m = s.makers.get(target)
  return s.tasks.get(m?.task ?? target)?.name ?? s.top.name
}

const workOf = (s: WorkState, actor: Actor): string => {
  const [first] = dos(s, actor)
  if (first !== undefined) {
    const target = first.fix ?? first.task ?? first.maker
    return `${DOING[first.act] ?? first.act} ${nameOf(s, target)}`
  }
  const waiting = [...s.tasks.values()].find(
    (t) => actor._tag === 'Role' && actor.name === t.role && liveMaker(s, t.id) !== null,
  )
  return waiting !== undefined
    ? `Waits for its maker on ${waiting.name}`
    : actor._tag === 'Host'
    ? 'Waits for the tasks'
    : actor._tag === 'Pipe'
    ? 'Waits for an escalation'
    : 'Waits for a task'
}

const terminalOf = (i: DashInput, actor: Actor, role: string, model: string): DashTerminalCard => ({
  role,
  session: sessionAt(i.hostSession, keyOf(actor), epochOf(i.state, actor)),
  model,
  status: statusOf(i, actor),
  work: workOf(i.state, actor),
})

// --- tasks and subagents -------------------------------------------------------------------------

const taskCard = (s: WorkState, t: Task) => ({
  id: t.id,
  name: t.name,
  role: t.role,
  state: t.state === 'Sent' ? ('QUEUED' as const) : ('WORKING' as const),
  description: t.goal,
  reject: t.state === 'InReview' && t.resultId >= 0 && !s.top.ended,
})

const subagentsOf = (s: WorkState, role: string, model: string) =>
  [...s.tasks.values()].flatMap((t) =>
    t.role === role && liveMaker(s, t.id) !== null
      ? [{ model, role, goal: t.goal }]
      : []
  )

// --- escalations ---------------------------------------------------------------------------------

const changesOf = (s: WorkState, draft: ReadonlyMap<ItemKey, ItemRec | null>) =>
  [...draft].map(([key, after]) => ({
    key,
    version: verOf(s.ver, key),
    before: s.items.get(key) ?? null,
    after,
  }))

const escalationsOf = (
  s: WorkState, decisions: ReadonlyMap<string, string>,
): Dash['row'] =>
  [...s.fixes].flatMap(([id, f]) => {
    if (f.stage === 'Closed') return []
    const ask = decisions.get(id) ?? null
    const task = s.tasks.get(id)
    const card = s.cards.get(f.roleDraft?.role ?? '')
    return [{
      id,
      ask,
      reply: ask === null ? [] : id === EDIT ? ['AcceptIt', 'SendItBack']
        : ['AcceptIt', 'SendItBack', 'TakeAsIs', 'EvaluateAgain'],
      status: f.stage === 'Evaluating' ? 'QUEUED'
        : ask === null ? 'IN_PIPELINE' : 'WAIT_FOR_REVIEW',
      summary: f.summary,
      ...(ask !== null && f.reviewMode !== undefined ? { reviewMode: f.reviewMode } : {}),
      task: task?.name ?? 'your direction edit',
      changes: changesOf(s, f.draft),
      card: f.roleDraft === null
        ? null
        : {
          role: f.roleDraft.role,
          before: card === undefined ? null : { words: card.words, model: card.model },
          after: { words: f.roleDraft.words, model: f.roleDraft.model },
        },
    }]
  })

// --- the sidebar ---------------------------------------------------------------------------------

const childrenOf = (s: WorkState, parent: ItemKey) =>
  [...s.items].filter(([, r]) => r.parent === parent)

const directionsOf = (i: DashInput) => {
  const s = i.state
  return [...s.items].filter(([, r]) => r.kind === 'dir').map(([key, d]) => {
    const standards = childrenOf(s, key).map(([sk, std]) => ({
      key: sk,
      rec: std,
      name: std.name,
      version: verOf(s.ver, sk),
      summary: std.says,
      rules: childrenOf(s, sk).map(([rk, r]) => ({
        key: rk,
        rec: r,
        name: r.name,
        version: verOf(s.ver, rk),
        says: r.says,
        form: r.form,
      })),
    }))
    return {
      key,
      rec: d,
      name: d.name,
      version: verOf(s.ver, key),
      principles: i.principles[key] ?? [],
      summary: d.says,
      first: standards.slice(0, FIRST).map((x) => x.name),
      examples: d.examples,
      standards,
    }
  })
}

const describeForward = (body: Body): string => {
  switch (body._tag) {
    case 'Open':
      return body.open._tag === 'OpenReject' ? `Reject the result of ${body.open.task}` : 'Open'
    case 'AskEdit':
      return 'Send a direction edit to the pipeline'
    case 'AnswerQuestion':
      return `Answer question ${body.ask}`
    case 'Respond':
      return `Respond to decision ${body.ask}`
    case 'EndProject':
      return 'End the project'
    default:
      return body._tag
  }
}

const humanOwed = (s: WorkState): Dash['person']['owed'] =>
  owed(s).flatMap(({ owner, ob, age }): Dash['person']['owed'] => {
    if (owner !== 'human') return []
    if (ob._tag === 'EndOb') return [{ _tag: 'EndProject', age }]
    if (ob._tag === 'ReviveOb') return [{ _tag: 'ReviveHost', age }]
    if (ob._tag !== 'AskOb') return []
    const ask = s.asks.get(ob.ask)
    if (ask?.kind === 'Decide' && ask.about._tag === 'Fix') {
      return [{ _tag: 'Decide', ask: ask.id, fix: ask.about.id, age }]
    }
    if (ask?.kind === 'Question') {
      if (!ask.question) throw new Error(`Owed question ${ask.id} has no body`)
      const makerTask = ask.from._tag === 'Maker' ? s.makers.get(ask.from.id)?.task : undefined
      const role = ask.from._tag === 'Role' ? ask.from.name : s.tasks.get(makerTask ?? '')?.role
      return [{ _tag: 'Question', ask: ask.id, from: keyOf(ask.from),
        role: role ?? null, age, question: ask.question }]
    }
    return []
  })

// --- the dashboard -------------------------------------------------------------------------------

export const dashOf = (i: DashInput): Dash => {
  const s = i.state
  const tasks = [...s.tasks.values()]
  const person = humanOwed(s)
  const row = escalationsOf(s, new Map(person.flatMap((x) =>
    x._tag === 'Decide' ? [[x.fix, x.ask] as const] : [])))
  return {
    header: { dir: i.dir, project: s.top.name, seq: s.seq, build: i.build },
    queue: tasks
      .filter((t) => t.state === 'Sent' || t.state === 'Working' || t.state === 'InReview')
      .map((t) => taskCard(s, t)),
    results: tasks.filter((t) => !s.top.ended && t.state === 'Done' && t.resultId >= 0)
      .map(({ id, name }) => ({ id, name })),
    host: { card: terminalOf(i, HOST, 'host', i.host.model), subagents: [] },
    columns: [...s.cards].map(([role, card]) => {
      const current = tasks.find((t) =>
        t.role === role && t.state !== 'Done' && t.state !== 'Split')
      return {
        role,
        card: terminalOf(i, { _tag: 'Role', name: role }, role, card.model),
        task: current === undefined ? null : taskCard(s, current),
        subagents: subagentsOf(s, role, card.model),
      }
    }),
    pipe: terminalOf(i, PIPE, i.pipe?.name ?? 'pipeline', i.pipe?.model ?? ''),
    row,
    rowShown: row.some((e) => e.status === 'WAIT_FOR_REVIEW'),
    person: { owed: person },
    forwards: i.forwards.map((f) => ({
      id: f.id,
      quote: f.quote,
      words: [describeForward(f.body)],
    })),
    directions: directionsOf(i),
  }
}
