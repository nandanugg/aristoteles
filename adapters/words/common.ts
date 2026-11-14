// The small helpers that many views share: who, clock, headers, short, an, indented, the words of a
// forwarded act. What a card says of a task (taskWords) is the page view's (P9), and the readings
// of the outside are Readings' (core/services), not here.
import type { ForwardedAct } from '../../core/schema/index.ts'
import type { By, Result, Rule, TaskId, TaskState, Work } from '../../core/schema/index.ts'
import { latestResultOf } from '../../core/derived/reads.ts'
import type { Derived } from '../../core/derived/index.ts'

// HH:MM of a time, or --:-- (golden in work log and waiting).
export const clock = (iso: string | null | undefined): string => (iso ? iso.slice(11, 16) : '--:--')

// The state of a task in the old words. A task that waits for an evaluation has a Reject that
// is not answered (Returned); a replaced task is closed.
const TASK_STATE_WORD: { readonly [K in TaskState['_tag']]: string } = {
  Open: 'Open',
  InReview: 'In review',
  Returned: 'Returned',
  Accepted: 'Accepted',
  WaitsForEvaluation: 'Returned',
  Closed: 'Closed',
  Replaced: 'Closed',
}
export const taskStateWord = (state: TaskState): string => TASK_STATE_WORD[state._tag]
// The word of a task, read from its derived state.
export const stateWord = (d: Derived, task: TaskId): string => {
  const state = d.states.tasks.get(task)
  if (state === undefined) throw new Error(`the work has no task ${task}`)
  return taskStateWord(state)
}

// --- who -------------------------------------------------------------------------------------

// An act of a person that the top agent forwarded and that counted at once: the log keeps the
// person's exact words with the Forwarded event, which made the record. An act that the
// person confirmed at a terminal is the person's own (no mark).
export interface Forwarded {
  readonly quote: string
}
const forwardedByWork = new WeakMap<Work, ReadonlyMap<string, Forwarded>>()
const forwardedIn = (work: Work): ReadonlyMap<string, Forwarded> => {
  const cached = forwardedByWork.get(work)
  if (cached) return cached
  const found = new Map<string, Forwarded>()
  for (const { recorded, created } of work.events) {
    const e = recorded.event
    if (e._tag !== 'Forward' || !('create' in e)) continue
    for (const id of created) found.set(id, { quote: e.create.quote })
  }
  forwardedByWork.set(work, found)
  return found
}
// The forward that made a record, by the record's id (a point of a Reject: the Reject's id).
export const forwardedOf = (work: Work, id: string): Forwarded | undefined =>
  forwardedIn(work).get(id.replace(/\.\d+$/, ''))

// The name of an actor as the CLI prints it: an assignment id, a person, a model run. A person
// whose words an agent forwarded gets " (forwarded)" when the id of the record is given.
export const who = (work: Work, by: By, record?: string): string => {
  if (typeof by === 'string') return by
  const forwarded = by._tag === 'Human' && record !== undefined && forwardedOf(work, record)
  return forwarded ? `${by.name} (forwarded)` : by.name
}

// --- text ------------------------------------------------------------------------------------

// "a" or "an", as the word starts.
export const an = (word: string): string => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`)
export const short = (text: string, n = 120): string =>
  text.length > n ? `${text.slice(0, n - 3)}...` : text
// Words of any markdown, on lines that keep the indent of the view.
export const indented = (text: string, pad: string): string =>
  String(text).trimEnd().split('\n').join(`\n${pad}`)
// Who checks a rule: a role, or the decider of the result.
export const checkerOf = (rule: Rule): string =>
  rule.checkedBy._tag === 'Role' ? rule.checkedBy.role : 'decider'

// The headers inside the words of one entry divide them, so that a role reads one piece
// (Nanda, 2026-11-10): a header is a markdown line that starts with #, and its name in an
// address is in lower case, with dashes for spaces (Cost first -> cost-first).
export const headerName = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// One header of a text: its level, its title, its slug, its line, and its words up to the next
// header of the same or a higher level.
export interface Header {
  readonly level: number
  readonly title: string
  readonly slug: string
  readonly line: number
  readonly text: string
}
export const headersOf = (text: string): ReadonlyArray<Header> => {
  const lines = String(text).split('\n')
  const found: Array<Omit<Header, 'text'>> = []
  let fence = false
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence
    const m = fence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) {
      const title = m[2] as string
      found.push({ level: (m[1] as string).length, title, slug: headerName(title), line: i })
    }
  })
  return found.map((h, i) => {
    const end = found.slice(i + 1).find((x) => x.level <= h.level)
    return {
      ...h,
      text: lines
        .slice(h.line, end ? end.line : lines.length)
        .join('\n')
        .trimEnd(),
    }
  })
}
// The words of an entry for a brief: the text before its first header, and an address for each
// header, so that a long entry costs only what the role reads.
export const briefWords = (text: string, address: string, pad: string): string => {
  const heads = headersOf(text)
  const first = heads[0]
  if (first === undefined) return indented(text, pad)
  const lead = String(text).split('\n').slice(0, first.line).join('\n').trim()
  const top = Math.min(...heads.map((h) => h.level))
  return [
    lead || '(read the pieces below)',
    ...heads.map(
      (h) => `${'  '.repeat(h.level - top)}- ${h.title}: work direction show ${address}#${h.slug}`,
    ),
  ].join(`\n${pad}`)
}

// The latest result of a task.
export const latestResult = (work: Work, task: Result['task']): Result | undefined =>
  latestResultOf(work, task)

// --- a forwarded act in words -----------------------------------------------------------------

const pointWords = (p: { readonly text: string; readonly breaks?: string | null }): string =>
  `"${p.text}"${p.breaks ? ` breaks ${p.breaks}` : ''}`

// A forwarded act in words: what it does and to what. A resolve names its result through the
// escalation, so it needs the work; without it, the escalation.
export const describeInner = (act: ForwardedAct, work?: Work): string => {
  const evidence = (list: ReadonlyArray<{ rule: string | null; where: string; what: string }>) =>
    list.length
      ? ' with evidence ' +
        list.map((e) => `${e.rule ? `${e.rule} | ` : ''}${e.where} | ${e.what}`).join('; ')
      : ''
  if (act._tag === 'Review') {
    const d = act.create
    if (d._tag === 'Accept') {
      return `accept ${d.of.id}${evidence(d.of.evidence)}`
    }
    if (d._tag === 'Resolve') {
      const escalated = work?.reviews.get(d.escalation)
      const target = escalated?._tag === 'Escalate' ? escalated.of : d.escalation
      return `resolve ${d.escalation} on ${target}${evidence(d.evidence)}`
    }
    if (d._tag === 'Reject') {
      const of = d.of
      const points = of._tag === 'Revision' ? [`"${of.reason}"`] : of.points.map(pointWords)
      return `reject ${of.id}: ${points.join('; ')}`
    }
  }
  if (act._tag === 'Question') {
    if ('move' in act) return `answer ${act.id}: "${act.move.text}"`
    return `ask ${act.create.to.assignment}: "${act.create.text}"`
  }
  if (act._tag === 'Note') return `comment on ${act.create.about}: "${act.create.text}"`
  throw new Error('a forwarded act is a review, a question or a comment')
}
