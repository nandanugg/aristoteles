// The dashboard of a project (DESIGN 10, 10.1) as one pure value: the folded work, the events,
// the roles of the config and the readings of the terminals go in, the whole Dash comes out. The
// page draws from a whole copy of it (browser.qnt). No clock here: `now` comes in.
import type { TerminalReading, WaitMarker } from '../../core/schema/outside.ts'
import type { Recorded } from '../../core/schema/index.ts'
import { dos } from '../../core/derived/work/obligations.ts'
import { sessionOf } from '../../core/effects/engine.ts'
import { verOf } from '../../core/state/work/items.ts'
import { epOf, liveMaker } from '../../core/state/work/reads.ts'
import type { Actor, ItemKey, ItemRec, Task, WorkState } from '../../core/state/work/types.ts'
import { EDIT, HOST, PERSON, PIPE, roleActor } from '../../core/state/work/types.ts'
import { stepWords } from '../words/work.ts'
import type { Dash, DashStatusWord, DashTerminalCard } from './contract.ts'

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
  readonly events: ReadonlyArray<Recorded>
  // The config: the host's model (the person's AI CLI: '' when unknown) and the pipeline role.
  readonly host: { readonly model: string; readonly reading: Reading | null }
  readonly pipe: { readonly name: string; readonly model: string } | null
  // The pump's terminals and their last lines by session, and the markers of `work wait`.
  readonly terminals: Readonly<Record<string, TerminalReading>>
  readonly tails: Readonly<Record<string, string>>
  readonly markers: ReadonlyArray<WaitMarker>
  // The principle tags of each direction (`dir:<id>`), from the old Work direction record.
  readonly principles: Readonly<Record<ItemKey, ReadonlyArray<string>>>
}

const FIRST = 3

// --- the terminal cards --------------------------------------------------------------------------

const readingOf = (i: DashInput, actor: Actor): Reading | null => {
  if (actor === HOST) return i.host.reading
  const t = i.terminals[sessionOf(actor, epOf(i.state, actor))]
  return t === undefined
    ? null
    : {
      alive: t._tag === 'Live',
      lastOutput: t.lastOutput,
      tail: i.tails[sessionOf(actor, epOf(i.state, actor))] ?? '',
    }
}

// The last wait beat of the actor's current terminal (a marker of another session is old).
const beatOf = (i: DashInput, actor: Actor): number =>
  i.markers
    .filter((m) => m.actor === actor)
    .filter((m) => m.session === null || m.session === sessionOf(actor, epOf(i.state, actor)))
    .reduce((at, m) => Math.max(at, m.beat), 0)

// DESIGN 10: Inactive belongs to the terminal (down, no live pane, the limit message, silence);
// else Working only on real work of the role itself (dos); waiting on a maker is Waiting.
const statusOf = (i: DashInput, actor: Actor): DashStatusWord => {
  const r = readingOf(i, actor)
  const silent = r !== null && i.now - Math.max(beatOf(i, actor), r.lastOutput) >= SILENT_MS
  return i.state.down.has(actor) || r === null || !r.alive || USAGE_LIMIT.test(r.tail) || silent
    ? 'Inactive'
    : dos(i.state, actor).length > 0
    ? 'Working'
    : 'Waiting'
}

const DOING: Readonly<Record<string, string>> = {
  Evaluate: 'Evaluating',
  Advance: 'Assessing',
  WriteRule: 'Writing a rule for',
  RunTest: 'Testing the rule of',
  Ship: 'Drafting',
  LoopReview: 'Reviewing the draft of',
  SendTask: 'Sending tasks for',
  Reassign: 'Reassigning after',
  TopDone: 'Returning',
  AssignDo: 'Assigning a maker for',
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
  if (first !== undefined) return `${DOING[first.tag] ?? first.tag} ${nameOf(s, first.target)}`
  const waiting = [...s.tasks.values()].find(
    (t) => roleActor(t.role) === actor && liveMaker(s, t.id) !== null,
  )
  return waiting !== undefined
    ? `Waits for its maker on ${waiting.name}`
    : actor === HOST
    ? 'Waits for the tasks'
    : actor === PIPE
    ? 'Waits for an escalation'
    : 'Waits for a task'
}

const terminalOf = (i: DashInput, actor: Actor, role: string, model: string): DashTerminalCard => ({
  role,
  session: sessionOf(actor, epOf(i.state, actor)),
  model,
  status: statusOf(i, actor),
  work: workOf(i.state, actor),
})

// --- tasks and subagents -------------------------------------------------------------------------

const taskCard = (t: Task) => ({
  id: t.id,
  name: t.name,
  role: t.role,
  state: t.st === 'Sent' ? ('QUEUED' as const) : ('WORKING' as const),
  description: t.goal,
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

const escalationsOf = (s: WorkState) =>
  [...s.fixes].flatMap(([id, f]) => {
    if (f.stage === 'SClosed') return []
    const task = s.tasks.get(id)
    const card = s.cards.get(f.roleDraft?.role ?? '')
    return [{
      id,
      status: f.stage === 'SEval'
        ? ('QUEUED' as const)
        : f.stage === 'SAtPerson'
        ? ('WAIT_FOR_REVIEW' as const)
        : ('IN_PIPELINE' as const),
      summary: f.summary,
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

// --- the dashboard -------------------------------------------------------------------------------

export const dashOf = (i: DashInput): Dash => {
  const s = i.state
  const tasks = [...s.tasks.values()]
  const row = escalationsOf(s)
  return {
    header: { dir: i.dir, project: s.top.name, seq: s.seq, build: i.build },
    queue: tasks.filter((t) => t.st === 'Sent' || t.st === 'Working' || t.st === 'InReview')
      .map(taskCard),
    host: { card: terminalOf(i, HOST, 'host', i.host.model), subagents: [] },
    columns: [...s.cards].map(([role, card]) => {
      const current = tasks.find((t) => t.role === role && t.st !== 'Done' && t.st !== 'Split')
      return {
        role,
        card: terminalOf(i, roleActor(role), role, card.model),
        task: current === undefined ? null : taskCard(current),
        subagents: subagentsOf(s, role, card.model),
      }
    }),
    pipe: terminalOf(i, PIPE, i.pipe?.name ?? 'pipeline', i.pipe?.model ?? ''),
    row,
    rowShown: row.some((e) => e.status === 'WAIT_FOR_REVIEW'),
    person: dos(s, PERSON).map((x) => ({
      tag: x.tag,
      target: x.target,
      words: stepWords(s, x, i.events),
    })),
    directions: directionsOf(i),
  }
}
