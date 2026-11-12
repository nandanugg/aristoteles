// The show views: a task tree, a result with its reviews, what blocks a
// result, a direction, a draft, one piece of them, and the words of a forwarded act. Golden
// text: the integrated tests pin it.
import { answererOf, versionIdOf } from '../domain/derived.ts'
import { whereRecord } from '../domain/context.ts'
import type { ForwardedAct } from '../domain/events.ts'
import type {
  AssignmentId,
  DirectionId,
  ResultId,
  RevisionId,
  StandardEntry,
  TaskId,
  Time,
  VersionId,
} from '../domain/ids.ts'
import { versionId } from '../domain/ids.ts'
import type {
  Blocker,
  By,
  Direction,
  Revision,
  Rule,
  Suggestion,
  Stop,
  Version,
  Why,
} from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import {
  answered,
  answeredItem,
  answersInclude,
  blockerItems,
  decisionWaitsText,
  directionsOf,
  draftWaitsFor,
  madeBy,
  openQuestions,
  openEscalationItems,
  partsOf,
  within,
  sameRule,
  sameWords,
  vetoOf,
} from '../engine/queries.ts'
import { taskState } from '../engine/status.ts'
import {
  assignmentAt,
  directionAt,
  draftAt,
  isAssignment,
  type Item,
  itemAt,
  itemsOf,
  officialAt,
  resultAt,
  ruleAt,
  standardAt,
  taskAt,
  versionAt,
} from '../engine/view.ts'
import {
  checkerOf,
  forwardedOf,
  headersOf,
  indented,
  latestResult,
  noOutside,
  type Outside,
  short,
  taskStateWord,
  who,
} from './common.ts'
import { leafName } from '../engine/deciders.ts'

// --- one record in words ------------------------------------------------------------------------

// A reviewer as a view names it: an assignment with its role, a person, a model run.
const byWords = (work: Work, by: By, record: string): string =>
  isAssignment(by) ? `${by} (${assignmentAt(work, by).role})` : who(work, by, record)
const quoteOf = (work: Work, id: string): string | undefined => forwardedOf(work, id)?.quote
const ruleKey = (work: Work, entry: string): string => ruleAt(work, entry as never).id

// What a draft or a version holds: its words and its standards.
interface Words {
  readonly says: string
  readonly standards: ReadonlyArray<StandardEntry>
}

// The version of an id (tsd-writing@2).
const versionOfId = (work: Work, id: VersionId): Version<Direction> => {
  const at = id.lastIndexOf('@')
  return versionAt(work, id.slice(0, at) as DirectionId, Number(id.slice(at + 1)))
}
const currentNumber = (work: Work, d: DirectionId): number | undefined => {
  const official = officialAt(work, d)
  return official?.versions.at(-1)?.number
}

// --- what blocks a result and a task ---------------------------------------------------------

// What a direction change answered a Reject: a split or a remake, or the version made from a
// draft that answers it.
const answeringChange = (work: Work, item: Item) =>
  work.changes.find((c) => answersInclude(c.answers, item))
const answeringVersion = (work: Work, item: Item) => {
  const draft = [...work.drafts.values()].find(
    (d) => answersInclude(d.answers, item) && madeBy(work, d.id) !== undefined,
  )
  return draft && madeBy(work, draft.id)
}

// A suggestion's target: a direction, a standard or a rule, by the name the person knows.
export const aboutId = (work: Work, about: Suggestion['about']): string => {
  switch (about._tag) {
    case 'NewDirection':
      return 'a new direction'
    case 'Direction':
      return about.direction
    case 'Standard':
      return standardAt(work, about.standard).id
    case 'Rule':
      return ruleAt(work, about.rule).id
  }
}

const itemOf = (work: Work, id: string): Item => {
  const item = itemAt(work, id)
  if (item === undefined) throw new Error(`the work has no review ${id}`)
  return item
}

// The open items of one result, with ids, as a view reads them (no assignment: medium, high
// and views see everything).
const resultLines = (
  work: Work,
  result: ResultId,
  at: Time,
  outside: Outside,
): ReadonlyArray<string> => {
  const r = result
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
  for (const blocker of blockerItems(work, r, at)) lines.push(...blockerLines(work, r, blocker))
  return lines
}

// The lines of one blocker of a result: one line, or one per Reject that breaks its rule. The
// OPEN block of a brief (P5a) prints the same lines.
export const blockerLines = (work: Work, r: ResultId, blocker: Blocker): ReadonlyArray<string> => {
  const quote = (id: string) => {
    const q = quoteOf(work, id)
    return q ? `: "${short(q, 80)}"` : ''
  }
  const byOf = (item: Item) => `, ${who(work, item.by, item.id)}${quote(item.id)}`
  return blockerLine(work, r, blocker, quote, byOf).split('\n')
}

const blockerLine = (
  work: Work,
  r: ResultId,
  blocker: Blocker,
  quote: (id: string) => string,
  byOf: (item: Item) => string,
): string => {
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
      const version = answeringVersion(work, item)
      if (answered(work, item.id) && (!item.breaks || change || version)) {
        const answer = change
          ? `the ${change._tag === 'Split' ? 'split' : 'remake'} of ${change.task} answered it`
          : `${version ? versionIdOf(version) : 'a direction change'} answered it` +
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
      const waits = item.answerBy === undefined ? '' : who(work, answererOf(work, item.answerBy))
      return `${item.id} escalated on ${r}: "${item.reason}" (waits for ${waits})`
    }
    case 'Question': {
      const q = work.questions.get(blocker.ref)
      if (q === undefined) throw new Error(`the work has no question ${blocker.ref}`)
      return `${q.id} waits for ${who(work, answererOf(work, q.answerBy))}: ${short(q.text)}`
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
      return `no accept yet by ${decisionWaitsText(work, r)}`
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
const touches = (work: Work, about: ReturnType<typeof aboutOf>, task: TaskId): boolean => {
  if (about === undefined) return false
  const directions = directionsOf(work, task)
  if (about._tag === 'Direction') return directions.some((d) => d.id === about.direction)
  return directions.some((d) => {
    const v = officialAt(work, d.id)?.versions.at(-1)
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
const aboutOf = (s: Suggestion) => (s.about._tag === 'NewDirection' ? undefined : s.about)

// What stops a task besides its latest result: its questions, Rejects of the task, and the
// suggestions about its directions that no official draft answers yet.
export const taskLines = (work: Work, task: TaskId): ReadonlyArray<string> => {
  const lines: Array<string> = []
  for (const q of openQuestions(work, task)) {
    lines.push(`${q.id} waits for ${who(work, answererOf(work, q.answerBy))}: ${short(q.text)}`)
  }
  for (const r of itemsOf(work, task)) {
    if (r.decision !== 'Reject' || answeredItem(work, r)) continue
    lines.push(
      `${r.id} returns the task: "${r.reason}" (${who(work, r.by, r.id)}); ` +
        'a direction change or a split answers it',
    )
  }
  const done = (id: string) =>
    [...work.drafts.values()].some((d) => d.answers.includes(id as never) && madeBy(work, d.id))
  for (const s of work.suggestions.values()) {
    const about = aboutOf(s)
    if (about === undefined || done(s.id) || !touches(work, about, task)) continue
    lines.push(
      `${s.id} suggests about ${aboutId(work, s.about)}: "${short(s.says)}" (${who(work, s.by)})`,
    )
  }
  return lines
}

// What stops a result: the items of the result, then those of its task.
export const renderBlockers = (
  work: Work,
  result: ResultId,
  at: Time,
  outside: Outside = noOutside,
): ReadonlyArray<string> => {
  const task = resultAt(work, result).task
  const lines = [...resultLines(work, result, at, outside), ...taskLines(work, task)]
  const latest = latestResult(work, task)
  if (lines.length === 0)
    return [`${result} (${resultAt(work, result).output}) has no blockers; it is accepted.`]
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

// --- a result and its reviews --------------------------------------------------------------

// A result and each review of it, with the evidence and the points: what a decider reads
// before it decides on its checkers' work.
export const renderResult = (
  work: Work,
  id: ResultId,
  at: Time,
  outside: Outside = noOutside,
): ReadonlyArray<string> => {
  const result = resultAt(work, id)
  const from = result.madeFrom.flatMap((m) =>
    m._tag === 'Git'
      ? [`${m.name}@${m.commit}`]
      : m._tag === 'Outside'
        ? [`${m.name}@${m.revision}`]
        : [],
  )
  const lines = [
    `${id} on ${result.task} by ${byWords(work, result.by, id)}: ${result.output}` +
      `${from.length ? ` (made from ${from.join(', ')})` : ''}`,
  ]
  const open = openEscalationItems(work, id)
  const items = itemsOf(work, id)
  for (const v of items) {
    const q = quoteOf(work, v.id)
    const words = q ? ` (their words: "${q}")` : ''
    const by = byWords(work, v.by, v.id)
    if (v.redo) lines.push(`${v.id} recheck by ${by}: "${v.reason}"`)
    else if (v.decision === 'Escalate') {
      const resolvedBy = resolveOf(work, v.id)
      const to = v.answerBy === undefined ? '' : byWords(work, answererOf(work, v.answerBy), v.id)
      lines.push(
        `${v.id} escalation by ${by}, for ${to}: "${v.reason}" ` +
          `(${open.some((o) => o.id === v.id) ? 'open' : `resolved by ${resolvedBy}`})`,
      )
    } else if (v.decision === 'Reject') {
      lines.push(
        `${v.id} reject by ${by}${v.breaks ? `, breaks ${ruleKey(work, v.breaks)}` : ''}: ` +
          `"${v.reason}"${words}`,
      )
    } else {
      lines.push(
        `${v.id} ${v.resolves ? `resolve by ${by}, resolves ${v.resolves}` : `accept by ${by}`}` +
          `${v.reason ? `: "${v.reason}"` : ''}${words}`,
        ...v.evidence.map(
          (e) => `  ${e.meets ? `${ruleKey(work, e.meets)} | ` : ''}${e.at} | ${e.says}`,
        ),
      )
    }
  }
  if (items.length === 0) lines.push('no reviews yet')
  return [...lines, ...renderBlockers(work, id, at, outside)]
}
// The review that resolved an escalation.
const resolveOf = (work: Work, escalation: string): string | undefined => {
  for (const r of work.reviews.values())
    if (r._tag === 'Resolve' && r.escalation === escalation) return r.id
  return undefined
}

// --- the task tree --------------------------------------------------------------------------

export const renderTaskTree = (
  work: Work,
  task: TaskId,
  at: Time,
  outside: Outside = noOutside,
  depth = 0,
): ReadonlyArray<string> => {
  const pad = '  '.repeat(depth)
  const t = taskAt(work, task)
  const r = latestResult(work, task)
  let suffix = ''
  if (r && outside.changed.has(r.id)) suffix = ` (${r.id} changed after it was reported)`
  else if (r && itemsOf(work, r.id).some((v) => v.decision === 'Reject')) {
    suffix = ` (${r.id} rejected)`
  }
  const lines = [`${pad}${task} ${t.name} · ${taskStateWord(taskState(work, task, at))}${suffix}`]
  for (const part of partsOf(work, task)) {
    lines.push(...renderTaskTree(work, part.id, at, outside, depth + 1))
  }
  return lines
}

// --- directions and drafts --------------------------------------------------------------------

// One entry in a view: a one-line entry on one line; an entry of several lines (markdown) as a
// block of its own, with its checker after its id, so that the next entry stands apart.
const entryLines = (head: string, says: string, checker?: string): ReadonlyArray<string> =>
  String(says).includes('\n')
    ? [
        '',
        `${head}${checker ? ` (${checker})` : ''}:`,
        ...String(says)
          .trimEnd()
          .split('\n')
          .map((l) => (l ? `${' '.repeat(head.search(/\S/) + 4)}${l}` : '')),
      ]
    : [`${head}: ${says}${checker ? ` (${checker})` : ''}`]

const whereWords = (s: { readonly where: Parameters<typeof whereRecord>[0] }): string => {
  const record = whereRecord(s.where)
  return record ? ` where ${JSON.stringify(record)}` : ''
}

// What a version or a draft says, with what it changes from its base: + new, ~ replaced,
// - removed.
const contentLines = (work: Work, v: Words, base: Words | undefined): ReadonlyArray<string> => {
  const lines: Array<string> = String(v.says).includes('\n')
    ? [
        'says:',
        ...String(v.says)
          .trimEnd()
          .split('\n')
          .map((l) => (l ? `  ${l}` : '')),
      ]
    : [`says: ${v.says}`]
  const baseStandards = base ? base.standards.map((e) => standardAt(work, e)) : []
  const baseIds = baseStandards.map((s) => s.id)
  const baseRules = baseStandards.flatMap((s) => s.rules)
  for (const entry of v.standards) {
    const s = standardAt(work, entry)
    const mark =
      !base || base.standards.includes(entry) ? '  ' : baseIds.includes(s.id) ? '~ ' : '+ '
    lines.push(...entryLines(`${mark}${s.id}${whereWords(s)}`, s.says))
    for (const re of s.rules) {
      const r = ruleAt(work, re)
      lines.push(
        ...entryLines(
          `${base && !baseRules.includes(re) ? '+ ' : '  '}  ${r.id}`,
          r.says,
          checkerOf(r),
        ),
      )
    }
  }
  const ids = v.standards.map((e) => standardAt(work, e).id)
  for (const s of baseStandards.filter((x) => !ids.includes(x.id))) {
    lines.push(`- ${s.id}: ${indented(s.says, '    ')}`)
  }
  if (base && v.says !== base.says) lines.push(`says was: ${indented(base.says, '  ')}`)
  return lines
}

// An official version of a direction, the draft that made it, and the open drafts.
export const renderDirection = (work: Work, version: VersionId): string => {
  const v = versionOfId(work, version)
  const d = directionAt(work, v.of)
  const official = officialAt(work, v.of)
  const next = official?.versions[v.number]
  const draft = draftAt(work, v.revision)
  const base = draft._tag === 'Change' ? versionOfId(work, draft.base) : undefined
  const lines = [
    `${version} ${d.name} (owner ${d.owner.name}) · ` +
      `${next ? `replaced by ${versionIdOf(next)}` : 'current'}`,
    `made from ${draft.id}, drafted by ` +
      `${draft.origin._tag === 'Written' ? who(work, draft.origin.by) : 'refresh'}`,
    ...contentLines(work, v, base),
  ]
  for (const x of work.drafts.values()) {
    if (x.of !== v.of || x._tag !== 'Change' || madeBy(work, x.id)) continue
    const end = vetoOf(work, x.id)
      ? ' (ended by a Reject)'
      : versionOfId(work, x.base).number !== currentNumber(work, v.of)
        ? ' (built on an old version)'
        : ''
    const reviews = itemsOf(work, x.id).map((r) => r.decision)
    lines.push(
      `draft: ${x.id}${end}; reviews: ${reviews.join(', ') || 'none'}; work direction show ${x.id}`,
    )
  }
  return lines.join('\n')
}

// Who wrote a draft: an assignment, a model run, or the refresh that brought in a commit of a
// company direction.
export const drafterOf = (work: Work, x: Revision<Direction>): string => {
  if (x.origin._tag === 'Written') return who(work, x.origin.by)
  const source = directionAt(work, x.of).source
  const where = source._tag === 'External' ? `${source.repo} (${source.path})` : ''
  const tag = x.origin.ref._tag === 'Tag' ? ` (tag ${x.origin.ref.tag})` : ''
  return `the refresh: commit ${x.origin.commit.slice(0, 7)}${tag} of ${where}`
}

// One piece of a version (work direction show <id>@<n>#<key>[#<header>]): a standard with its
// rules, one rule, or the text under a header inside the words of an entry. undefined when the
// version has no such piece.
export const renderPiece = (
  work: Work,
  v: VersionId | RevisionId,
  keys: ReadonlyArray<string>,
): string | undefined => {
  const words = wordsOf(work, v)
  const at = isDraftId(v) ? v : v
  const standards = words.standards.map((e) => standardAt(work, e))
  const rules = standards.flatMap((s) => s.rules.map((e) => ruleAt(work, e)))
  const standard = standards.find((s) => s.id === keys[0])
  const rule = rules.find((r) => r.id === keys[0])
  const entry = standard ?? rule
  const under = (label: string, text: string, name: string | undefined) =>
    headersOf(text)
      .filter((h) => h.slug === name)
      .map((h) => `${at} · ${label} · ${h.title}\n${h.text}`)
  if (entry && keys[1]) {
    const pieces = under(`${standard ? 'standard' : 'rule'} ${entry.id}`, entry.says, keys[1])
    return pieces.length ? pieces.join('\n\n') : undefined
  }
  if (standard) {
    return [
      `${at} · standard ${standard.id}${whereWords(standard)}`,
      standard.says,
      ...standard.rules.map((e) => {
        const r = ruleAt(work, e)
        return `- rule ${r.id} (${checkerOf(r)}): ${indented(r.says, '  ')}`
      }),
    ].join('\n')
  }
  if (rule) return [`${at} · rule ${rule.id} (${checkerOf(rule)})`, rule.says].join('\n')
  const pieces = [
    ...under('direction', words.says, keys[0]),
    ...standards.flatMap((s) => [
      ...under(`standard ${s.id}`, s.says, keys[0]),
      ...s.rules.flatMap((e) => under(`rule ${ruleAt(work, e).id}`, ruleAt(work, e).says, keys[0])),
    ]),
  ]
  return pieces.length ? pieces.join('\n\n') : undefined
}
const isDraftId = (id: string): id is RevisionId => /^d\d+$/.test(id)
const wordsOf = (work: Work, id: VersionId | RevisionId): Words =>
  isDraftId(id) ? draftAt(work, id) : versionOfId(work, id)

// The names that a version gives to #: its standards, its rules, and its headers.
export const pieceNames = (work: Work, v: VersionId | RevisionId): ReadonlyArray<string> => {
  const words = wordsOf(work, v)
  const standards = words.standards.map((e) => standardAt(work, e))
  const rules = standards.flatMap((s) => s.rules.map((e) => ruleAt(work, e)))
  const texts = [
    words.says,
    ...standards.flatMap((s) => [s.says, ...s.rules.map((e) => ruleAt(work, e).says)]),
  ]
  return [
    ...standards.map((s) => s.id),
    ...rules.map((r) => r.id),
    ...new Set(texts.flatMap((t) => headersOf(t).map((h) => h.slug))),
  ]
}

// What a draft answers, in words: a suggestion, or a Reject (of an earlier draft, a result, or
// a task) with its reason.
export const answerText = (work: Work, id: string): string => {
  const suggestion = work.suggestions.get(id as never)
  if (suggestion) return `${id} "${short(suggestion.says, 80)}"`
  const y = itemAt(work, id) ?? itemAt(work, `${id}.1`)
  if (y === undefined) throw new Error(`the work has no review ${id}`)
  return (
    `${id}, the Reject${y.of._tag === 'Revision' ? ` of ${y.of.id}` : ''} by ` +
    `${who(work, y.by, id)}: "${short(y.reason ?? '', 80)}"`
  )
}

// What a draft changes from an earlier draft that was rejected: + new, ~ changed, - dropped.
const sinceLines = (work: Work, x: Words, earlier: Words): ReadonlyArray<string> => {
  const lines: Array<string> = []
  const mine = x.standards.map((e) => standardAt(work, e))
  const was = earlier.standards.map((e) => standardAt(work, e))
  for (const s of mine) {
    const old = was.find((y) => y.id === s.id)
    if (!old) lines.push(`+ ${s.id}: ${s.says}`)
    if (!old || sameWords(work, s, old)) continue
    lines.push(`~ ${s.id}: ${s.says}`)
    if (s.says !== old.says) lines.push(`  was: ${old.says}`)
    const [where, whereWas] = [
      JSON.stringify(whereRecord(s.where) ?? {}),
      JSON.stringify(whereRecord(old.where) ?? {}),
    ]
    if (where !== whereWas) lines.push(`  where: ${where}, was ${whereWas}`)
    const rules = s.rules.map((e) => ruleAt(work, e))
    const oldRules = old.rules.map((e) => ruleAt(work, e))
    for (const r of rules) {
      if (!oldRules.some((q) => sameRule(r, q)))
        lines.push(`+   ${r.id}: ${r.says} (${checkerOf(r)})`)
    }
    for (const q of oldRules) {
      if (!rules.some((r) => sameRule(r, q))) lines.push(`-   ${q.id}: ${q.says} (${checkerOf(q)})`)
    }
  }
  for (const s of was.filter((y) => !mine.some((z) => z.id === y.id))) {
    lines.push(`- ${s.id}: ${s.says}`)
  }
  if (x.says !== earlier.says) lines.push(`says: ${x.says}`, `says was: ${earlier.says}`)
  return lines
}

// A draft: what it changes in its base, who drafted it, what it answers, its reviews, and
// where it ends.
export const renderDraft = (work: Work, id: RevisionId): string => {
  const x = draftAt(work, id)
  const d = directionAt(work, x.of)
  const made = madeBy(work, id)
  const vetoed = vetoOf(work, id)
  const now = currentNumber(work, x.of)
  const base = x._tag === 'Change' ? versionOfId(work, x.base) : undefined
  const end = made
    ? `official: ${versionIdOf(made)}`
    : vetoed
      ? 'ended by a Reject'
      : (base && base.number !== now) || (!base && now !== undefined)
        ? 'built on an old version'
        : `waits for the accept of ${draftWaitsText(work, id)}`
  // A draft that answers the Reject of an earlier draft also shows what changed since that draft.
  const since = x.answers.flatMap((a) => {
    const y = itemAt(work, a)
    if (y === undefined || y.review._tag !== 'Reject' || y.of._tag !== 'Revision') return []
    return [
      `since ${y.of.id}, which ${a} rejected:`,
      ...sinceLines(work, x, draftAt(work, y.of.id)).map((l) => `  ${l}`),
    ]
  })
  const on = base ? `built on ${x._tag === 'Change' ? x.base : ''}` : 'a new direction'
  return [
    `${id} a draft of ${d.name} (owner ${d.owner.name}), ${on} · ${end}`,
    `drafted by ${drafterOf(work, x)}`,
    ...x.answers.map((a) => `answers: ${answerText(work, a)}`),
    ...contentLines(work, x, base),
    ...since,
    ...itemsOf(work, id).map(
      (r) =>
        `review: ${r.id} ${r.decision} by ${who(work, r.by, r.id)}: ` +
        `${r.reason ?? r.evidence.map((e) => `${e.at} | ${e.says}`).join('; ')}`,
    ),
  ].join('\n')
}

// Why a draft changes its direction, under the draft where the decider reads it (new: the owner's
// ruling, 2026-11-12): the reason, then the reviser's words; nothing when none was given.
export const whyLines = (why: Why): ReadonlyArray<string> =>
  why._tag === 'NoneGiven' ? [] : [`why: ${why.reason}`, ...(why.words === null ? [] : [why.words])]

// draftWaitsText(draft): "the accept of Nanda": whose accept a draft waits for, in words.
export const draftWaitsText = (work: Work, draft: RevisionId): string =>
  draftWaitsFor(work, draft).map(leafName).join(' or ')

// stopIdOf(stop): ex3, or v4 for the points of one reject.
export const stopIdOf = (_work: Work, stop: Stop): string =>
  stop._tag === 'PersonReject' ? stop.id.replace(/\.\d+$/, '') : stop.id

// --- the drafts that wait, and what follows a Reject of one ---------------------------------

// Whether a draft is built on the current version of its direction (a new direction: on none).
export const builtOnCurrent = (work: Work, x: Revision<Direction>): boolean => {
  const now = currentNumber(work, x.of)
  return x._tag === 'Change' ? versionOfId(work, x.base).number === now : now === undefined
}
// The open drafts of a direction: built on its current version, not official, and not ended by
// the Reject of a decider.
export const openDrafts = (work: Work, d: DirectionId): ReadonlyArray<Revision<Direction>> =>
  [...work.drafts.values()].filter(
    (x) => x.of === d && builtOnCurrent(work, x) && !madeBy(work, x.id) && !vetoOf(work, x.id),
  )
// A draft that a decider rejected waits for a new draft, until a later draft answers the Reject
// or its reviser writes a later draft.
export const waitsForNewDraft = (work: Work, x: Revision<Direction>): boolean => {
  const veto = vetoOf(work, x.id)
  const sameReviser = (y: Revision<Direction>) =>
    x.origin._tag === 'Written' &&
    y.origin._tag === 'Written' &&
    (typeof x.origin.by === 'string' || typeof y.origin.by === 'string'
      ? x.origin.by === y.origin.by
      : x.origin.by.run === y.origin.by.run && x.origin.by.name === y.origin.by.name)
  return [...work.drafts.values()].every(
    (y) =>
      !(veto !== undefined && y.answers.includes(veto.id as never)) &&
      !(y.of === x.of && sameReviser(y) && y.at > x.at),
  )
}
// An assignment whose tree has an open task that follows the direction.
export const followsDirection = (work: Work, a: AssignmentId, d: DirectionId): boolean => {
  const task = assignmentAt(work, a).task
  return [...work.tasks.values()].some(
    (t) =>
      t.end._tag === 'NotEnded' &&
      within(work, t.id, task) &&
      directionsOf(work, t.id).some((x) => x.id === d),
  )
}

// A suggestion answered by a draft: official, open, or rejected with no newer draft yet.
export const drafted = (work: Work, id: string): boolean =>
  [...work.drafts.values()].some(
    (x) =>
      x.answers.includes(id as never) &&
      (madeBy(work, x.id) !== undefined ||
        openDrafts(work, x.of).some((o) => o.id === x.id) ||
        (vetoOf(work, x.id) !== undefined && waitsForNewDraft(work, x))),
  )

// The official direction that a suggestion is about (the direction, or the holder of its
// standard or rule in the current version).
export const holderOf = (work: Work, about: Suggestion['about']): Direction | undefined => {
  for (const d of work.directions.values()) {
    const v = officialAt(work, d.id)?.versions.at(-1)
    if (v === undefined) continue
    if (about._tag === 'Direction' && about.direction === d.id) return d
    if (about._tag === 'Standard' && v.standards.includes(about.standard)) return d
    if (
      about._tag === 'Rule' &&
      v.standards.some((s) => standardAt(work, s).rules.includes(about.rule))
    ) {
      return d
    }
  }
  return undefined
}
// The suggestions that wait for a draft, each with the official direction that it is about.
export const suggestionsToDraft = (work: Work) =>
  [...work.suggestions.values()].flatMap((y) => {
    if (y.about._tag === 'NewDirection' || drafted(work, y.id)) return []
    const d = holderOf(work, y.about)
    return d ? [{ y, d }] : []
  })

// What follows the Reject of a decider: its reviser revises again; when the reviser is
// finished, an open high role of a tree that follows the direction; else a new one that the
// person assigns. text is the words; step is the command that follows, when there is one.
export const reviseAgainOf = (
  work: Work,
  draft: RevisionId,
): { readonly text: string; readonly step: string | null } => {
  const x = draftAt(work, draft)
  // A company direction changes in its repo: the project stays on its accepted commit.
  if (x.origin._tag === 'Imported') {
    const source = directionAt(work, x.of).source
    const where = source._tag === 'External' ? `${source.repo} (${source.path})` : ''
    return {
      text: `${x.of} stays on its accepted commit; it changes in ${where}, with a pull request`,
      step: null,
    }
  }
  const by = x.origin.by
  // A model run outside any task (the skill that reads an app) is run again; it answers the Reject.
  if (typeof by !== 'string') {
    return {
      text:
        `its writer ${who(work, by)}, a model run outside any task, ` +
        'writes a new draft that answers it',
      step:
        `work direction new --file=<direction.yaml> --by=${by.name} ` +
        `--answers=${vetoOf(work, draft)?.id}`,
    }
  }
  const reviser = assignmentAt(work, by)
  if (reviser.end._tag === 'NotEnded') {
    return { text: 'its reviser revises the current version again', step: null }
  }
  const finished = `its reviser ${by} is finished`
  const next = [...work.assignments.values()].find(
    (y) =>
      y.end._tag === 'NotEnded' &&
      tierOfRole(work, y.role) === 'high' &&
      followsDirection(work, y.id, x.of),
  )
  if (next) {
    return {
      text: `${finished}; ${next.id} (${next.role}) revises the current version`,
      step: null,
    }
  }
  const top = [...work.tasks.values()].find(
    (t) =>
      t.end._tag === 'NotEnded' &&
      t.serves._tag === 'TopTask' &&
      directionsOf(work, t.id).some((d) => d.id === x.of),
  )
  return {
    text: `${finished}; a new ${reviser.role} revises the current version`,
    step: `work assign ${top ? top.id : '<task>'} --role=${reviser.role}`,
  }
}
// The next line after a vetoed draft.
export const reviseAgain = (work: Work, draft: RevisionId): string =>
  reviseAgainOf(work, draft).text

// The tier of a role: low, medium or high; a check program has none.
export const tierOfRole = (work: Work, role: string): string | undefined => {
  const r = work.workflow.roles.get(role as never)
  return r?._tag === 'Model' ? r.tier : undefined
}

// --- a forwarded act in words -----------------------------------------------------------------

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
const pointWords = (p: { readonly text: string; readonly breaks?: string | null }): string =>
  `"${p.text}"${p.breaks ? ` breaks ${p.breaks}` : ''}`

export type { Rule }
