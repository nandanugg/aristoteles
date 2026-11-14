// What stops a result and a task, one line each with its ids: the lines of `work blockers`, of the
// OPEN block of a brief, and of the show of a result. The state of a question, an escalation or a
// draft comes from Derived; a record that the states do not carry (a review, a rule, a change) is
// read from the Work.
import {
  answered,
  answeredItem,
  blockersOfResult,
  decidingNow,
  decisionWaitsFor,
  directionIdsOf,
  itemAt,
  itemsOf,
  officialAt,
  resultAt,
  ruleAt,
  standardAt,
  taskAt,
} from '../../core/derived/reads.ts'
import type { Derived } from '../../core/derived/index.ts'
import {
  type Answerer,
  type Blocker,
  type ResultId,
  type Suggestion,
  type TaskId,
  versionId,
  type Work,
} from '../../core/schema/index.ts'
import type { Item } from '../../core/derived/reads.ts'
import { checkerOf, forwardedOf, latestResult, short, who } from './common.ts'
import { aboutId } from './shared.ts'

const quoteOf = (work: Work, id: string): string | undefined => forwardedOf(work, id)?.quote
const ruleKey = (work: Work, entry: string): string => ruleAt(work, entry as never).id
const itemOf = (work: Work, id: string): Item => {
  const item = itemAt(work, id)
  if (item === undefined) throw new Error(`the work has no review ${id}`)
  return item
}
const answersInclude = (ids: ReadonlyArray<string>, r: Item): boolean =>
  ids.includes(r.id) || (r.group !== undefined && ids.includes(r.group))
const currentNumber = (work: Work, d: Parameters<typeof officialAt>[1]): number | undefined =>
  officialAt(work, d)?.versions.at(-1)?.number

// Who answers a question or an escalation now (C1: past an ended agent); the first one asked when
// the record is no longer open.
export const answererOfQuestion = (d: Derived, id: string, first: Answerer): Answerer => {
  const state = d.states.questions.get(id as never) ?? d.states.escalations.get(id as never)
  return state?._tag === 'Open' ? state.answerer : first
}
// The open questions that stop a task or a result (C2: a question of an ended task is Irrelevant).
export const openQuestionsOf = (d: Derived, target: TaskId | ResultId) =>
  [...d.states.questions].flatMap(([id, state]) => {
    const q = d.moment.work.questions.get(id)
    return state._tag === 'Open' && q !== undefined && q.stops === target ? [q] : []
  })

// What a direction change answered a Reject: a split or a remake, or the version made from a
// draft that answers it.
const answeringChange = (work: Work, item: Item) =>
  work.changes.find((c) => answersInclude(c.answers, item))
const answeringVersion = (d: Derived, item: Item): string | undefined => {
  for (const [id, state] of d.states.revisions) {
    const draft = d.moment.work.drafts.get(id)
    if (draft !== undefined && state._tag === 'Official' && answersInclude(draft.answers, item)) {
      return state.version
    }
  }
  return undefined
}

// The lines of one blocker of a result: one line, or one per Reject that breaks its rule. The
// OPEN block of a brief prints the same lines.
export const blockerLines = (
  d: Derived,
  r: ResultId,
  blocker: Blocker,
): ReadonlyArray<string> => {
  const work = d.moment.work
  const quote = (id: string) => {
    const q = quoteOf(work, id)
    return q ? `: "${short(q, 80)}"` : ''
  }
  const byOf = (item: Item) => `, ${who(work, item.by, item.id)}${quote(item.id)}`
  return blockerLine(d, r, blocker, quote, byOf).split('\n')
}

const blockerLine = (
  d: Derived,
  r: ResultId,
  blocker: Blocker,
  quote: (id: string) => string,
  byOf: (item: Item) => string,
): string => {
  const work = d.moment.work
  switch (blocker._tag) {
    case 'Evidence': {
      const rule = ruleAt(work, blocker.ref)
      if (blocker.rejects.length === 0) {
        return `no evidence on ${r} for ${rule.id} (checked by ${checkerOf(rule)})`
      }
      return blocker.rejects
        .map((id) => {
          const reject = itemOf(work, id)
          return (
            `${id} breaks ${rule.id}: "${reject.reason}" ` +
            `(on ${reject.of.id}, ${who(work, reject.by, id)}${quote(id)})`
          )
        })
        .join('\n')
    }
    case 'OldEvidence':
      return `the evidence for "${ruleAt(work, blocker.ref).says}" uses an old result (on ${r})`
    case 'Reject': {
      const item = itemOf(work, blocker.ref)
      const change = answeringChange(work, item)
      const version = answeringVersion(d, item)
      if (answered(work, item.id) && (!item.breaks || change || version)) {
        const answer = change
          ? `the ${change._tag === 'Split' ? 'split' : 'remake'} of ${change.task} answered it`
          : `${version ?? 'a direction change'} answered it` +
            `${item.breaks ? ` (${ruleKey(work, item.breaks)} left the task)` : ''}, ` +
            'so the next result follows the new version'
        return `${item.id} rejected ${r}: "${item.reason}"; ${answer}`
      }
      if (!item.breaks) {
        return `${item.id} needs a direction change: "${item.reason}" (on ${r}${byOf(item)})`
      }
      return (
        `${item.id} breaks ${ruleKey(work, item.breaks)}: ` +
        `"${item.reason}" (on ${r}${byOf(item)})`
      )
    }
    case 'Unchanged': {
      const item = itemOf(work, blocker.ref)
      return `${item.id}: ${r} is the same work that was rejected: "${item.reason}"`
    }
    case 'Recheck': {
      const item = itemOf(work, blocker.ref)
      return `${item.id} asks for a new result: "${item.reason}" (${who(work, item.by, item.id)})`
    }
    case 'Change': {
      const item = itemOf(work, blocker.ref)
      return (
        `${item.id} needs a direction change: "${item.reason}" ` +
        `(${who(work, item.by, item.id)}${quote(item.id)})`
      )
    }
    case 'Escalation': {
      const item = itemOf(work, blocker.ref)
      const first = item.review._tag === 'Escalate' ? item.review.answerBy : undefined
      const waits = first === undefined ? '' : who(work, answererOfQuestion(d, item.id, first))
      return `${item.id} escalated on ${r}: "${item.reason}" (waits for ${waits})`
    }
    case 'Question': {
      const q = work.questions.get(blocker.ref)
      if (q === undefined) throw new Error(`the work has no question ${blocker.ref}`)
      const to = who(work, answererOfQuestion(d, q.id, q.answerBy))
      return `${q.id} waits for ${to}: ${short(q.text)}`
    }
    case 'OldVersion': {
      const now = currentNumber(work, blocker.ref)
      const rules = blocker.rules.map((e) => ruleAt(work, e))
      return (
        `${r} was checked under an old version of ${blocker.ref}; it is checked again under ` +
        `${versionId(blocker.ref, now ?? 0)}: ` +
        rules.map((x) => `${x.id} (${checkerOf(x)})`).join(', ')
      )
    }
    case 'DeciderAcceptedUnderOld':
      return (
        `${r} was accepted by its decider under an old version; the decider runs work brief ` +
        '(it reads the current version), then accepts it again'
      )
    case 'DeciderWaits':
      return `no accept yet by ${decisionWaitsFor(work, r, decidingNow(work, r))}`
    case 'DeciderAnyApprover':
      return `no accept yet by a role that decides ${r}`
    case 'Maker':
      return `${r} was reviewed by its own maker`
    case 'OldNeed': {
      const need = taskAt(work, blocker.ref)
      return (
        `${r} was made before ${blocker.newer} of ${blocker.ref} (${need.name}); ` +
        'the maker reports again with that work'
      )
    }
  }
}

// Whether a suggestion is about a direction that the task follows, or one of its standards.
const touches = (work: Work, about: Suggestion['about'], task: TaskId): boolean => {
  if (about._tag === 'NewDirection') return false
  const directions = directionIdsOf(work, task)
  if (about._tag === 'Direction') return directions.includes(about.direction)
  return directions.some((d) => {
    const v = officialAt(work, d)?.versions.at(-1)
    return (
      v !== undefined &&
      v.standards.some(
        (s) =>
          (about._tag === 'Standard' && s === about.standard) ||
          (about._tag === 'Rule' && standardAt(work, s).rules.includes(about.rule)),
      )
    )
  })
}

// What stops a task besides its latest result: its questions, Rejects of the task, and the
// suggestions about its directions that no official draft answers yet.
export const taskLines = (d: Derived, task: TaskId): ReadonlyArray<string> => {
  const work = d.moment.work
  const lines: Array<string> = []
  for (const q of openQuestionsOf(d, task)) {
    lines.push(
      `${q.id} waits for ${who(work, answererOfQuestion(d, q.id, q.answerBy))}: ${short(q.text)}`,
    )
  }
  for (const r of itemsOf(work, task)) {
    if (r.decision !== 'Reject' || answeredItem(work, r)) continue
    lines.push(
      `${r.id} returns the task: "${r.reason}" (${who(work, r.by, r.id)}); ` +
        'a direction change or a split answers it',
    )
  }
  const done = (id: string) =>
    [...d.states.revisions].some(
      ([draft, state]) =>
        state._tag === 'Official' && work.drafts.get(draft)?.answers.includes(id as never),
    )
  for (const s of work.suggestions.values()) {
    if (s.about._tag === 'NewDirection' || done(s.id) || !touches(work, s.about, task)) continue
    lines.push(
      `${s.id} suggests about ${aboutId(work, s.about)}: "${short(s.says)}" (${who(work, s.by)})`,
    )
  }
  return lines
}

// The open items of one result, with ids, as a view reads them (no assignment: medium, high
// and views see everything). The readings of the outside are in the moment.
const resultLines = (d: Derived, r: ResultId): ReadonlyArray<string> => {
  const { outside } = d.moment
  const lines: Array<string> = []
  if (outside.changed.has(r)) {
    lines.push(`${r} changed after it was reported; the maker reports it again`)
  }
  const stale = outside.stale.get(r)
  if (stale) {
    lines.push(
      `${r} was built on ${stale.source}@${stale.was}; ${stale.source} is now at ${stale.now}`,
    )
  }
  for (const blocker of blockersOfResult(d.moment.work, r)) {
    lines.push(...blockerLines(d, r, blocker))
  }
  return lines
}

// What stops a result: the items of the result, then those of its task.
export const renderBlockers = (d: Derived, result: ResultId): ReadonlyArray<string> => {
  const work = d.moment.work
  const task = resultAt(work, result).task
  const lines = [...resultLines(d, result), ...taskLines(d, task)]
  const latest = latestResult(work, task)
  if (lines.length === 0) {
    return [`${result} (${resultAt(work, result).output}) has no blockers; it is accepted.`]
  }
  const note =
    latest !== undefined && latest.id !== result
      ? [`(${result} is not the latest result of ${task}; ${latest.id} is)`]
      : []
  return [
    `${result} (${resultAt(work, result).output}) is stopped by:`,
    ...lines.flatMap((l) => l.split('\n')).map((l) => `  ${l}`),
    ...note,
  ]
}
