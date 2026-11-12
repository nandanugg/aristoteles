// The small helpers that many views share (who, clock, headersOf, short, an, indented, the
// forwarded words). Pure: a fact that lives on disk (a result whose files
// changed, a source that moved) comes in as data (Outside), made by outsideOf.
import { Effect } from 'effect'
import type { ResultId, TaskId, Time } from '../domain/ids.ts'
import type { By, Result, Rule, TaskState } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import {
  blockerItems,
  evaluationWaits,
  isDo,
  openDo,
  resultsOf,
  taskAccepted,
} from '../engine/queries.ts'
import { attemptOf } from '../engine/status.ts'
import { changedSince, sameRevision } from '../files/digest.ts'
import type { Files, Spawn } from '../services/outside.ts'

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
  resultsOf(work, task).at(-1)

// What a task does now, in the words of its card on the UI (Nanda, 2026-11-11: "the task card
// only says what it's currently doing right now"). The attempt is that of its latest maker.
export const taskWords = (work: Work, task: TaskId, at: Time): string => {
  const t = work.tasks.get(task)
  if (t === undefined) throw new Error(`the work has no task ${task}`)
  if (t.end._tag === 'Replaced') return `replaced by ${t.end.next}`
  if (t.end._tag === 'Closed') return 'closed'
  if (taskAccepted(work, task, at)) return 'accepted'
  if (evaluationWaits(work, task) !== undefined) return 'waits for an evaluation'
  const mine = [...work.assignments.values()].filter((a) => a.task === task)
  const open = mine.filter((a) => a.end._tag === 'NotEnded')
  const maker = mine.findLast((a) => isDo(work, a.role))
  const working = maker !== undefined && openDo(work, maker.id)
  let attempt = ''
  if (maker) {
    const n = attemptOf(work, maker.id)
    attempt = `attempt ${n.number}${n.max._tag === 'AtMost' ? ` of ${n.max.max}` : ''}`
  }
  const needs = t.needs.filter((n) => !taskAccepted(work, n, at))
  const waitsFor = `waits for ${needs.join(', ')}`
  const result = latestResult(work, task)
  if (!result) {
    if (needs.length) return waitsFor
    if (working) return `works (${attempt})`
    if (open.length) return 'splits'
    return 'waits for an assign'
  }
  const items = blockerItems(work, result.id, at)
  if (items.some((i) => i._tag === 'Reject' || i._tag === 'Maker')) {
    return working ? `works (${attempt})` : 'stopped'
  }
  const decider = (i: (typeof items)[number]) =>
    i._tag === 'DeciderWaits' ||
    i._tag === 'DeciderAnyApprover' ||
    i._tag === 'DeciderAcceptedUnderOld'
  if (items.length && items.every(decider)) return 'waits for its decider'
  if (needs.length) return waitsFor
  return 'in review'
}

// --- what the words read from outside the Work -------------------------------------------------

// A source outside git that moved since a result was made from it.
export interface StaleSource {
  readonly source: string
  readonly was: string
  readonly now: string
}
// What lives on disk or in git: the results whose work changed after their report, and the
// results made from an outside source that moved. A view takes it as data.
export interface Outside {
  readonly changed: ReadonlySet<ResultId>
  readonly stale: ReadonlyMap<ResultId, StaleSource>
}
export const noOutside: Outside = { changed: new Set(), stale: new Map() }

// Read the disk and git once, for the results that a view may name.
export const outsideOf = (
  work: Work,
  cwd: string,
  results: ReadonlyArray<Result>,
): Effect.Effect<Outside, never, Files | Spawn> =>
  Effect.gen(function* () {
    const changed = new Set<ResultId>()
    const stale = new Map<ResultId, StaleSource>()
    for (const result of results) {
      if (yield* changedSince(cwd, result)) changed.add(result.id)
      const task = work.tasks.get(result.task)
      for (const m of result.madeFrom) {
        if (m._tag === 'Result') continue
        const seen = work.sources.get(m.name)
        const was = m._tag === 'Git' ? m.commit : m.revision
        if (seen === undefined || was === '') continue
        const now = seen._tag === 'Git' ? seen.commit : seen.revision
        const path = task?.descriptionAi.workspace.find((w) => w.source === m.name)?.path ?? ''
        if (!(yield* sameRevision(cwd, path, was, now))) {
          stale.set(result.id, { source: m.name, was, now })
          break
        }
      }
    }
    return { changed, stale }
  })
