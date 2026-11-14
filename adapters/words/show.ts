// The show views: a task and its tree, a result with its reviews, a direction, a draft, one piece
// of them, a question, an evaluation, an assignment. Golden text, as the old CLI showed them. Every
// state a view prints comes from Derived: the end of a task, the state of a draft, an escalation,
// an evaluation. Findings that change a view: C1 (an assignment of an ended task), S6/S7 (a draft
// that is Outdated or Conflicted: Conflicted has no old words, so its line says nothing of it),
// EscalationState Irrelevant (ruling 10.7: printed as irrelevant, never open).
import {
  assignmentAt,
  directionAt,
  draftAt,
  evaluationDecision,
  isAssignment,
  itemAt,
  itemsOf,
  officialAt,
  partsOf,
  resultAt,
  ruleAt,
  standardAt,
  stopTask,
  taskAt,
  versionAt,
} from '../../core/derived/reads.ts'
import { sameWords } from '../../core/state/versions.ts'
import type { Derived } from '../../core/derived/index.ts'
import {
  type AssignmentId,
  type By,
  type Direction,
  type DirectionId,
  type EvaluationId,
  type QuestionId,
  type ResultId,
  type Review,
  type Revision,
  replacesOf,
  type RevisionId,
  type Rule,
  type StandardEntry,
  type TaskId,
  type Version,
  type VersionId,
  versionIdOf,
  type Why,
  whereRecord,
  type Work,
} from '../../core/schema/index.ts'
import { answererOfQuestion, renderBlockers } from './blockers.ts'
import { briefOf } from './brief.ts'
import {
  checkerOf,
  forwardedOf,
  headersOf,
  indented,
  latestResult,
  stateWord,
  who,
} from './common.ts'
import { answerText, draftWaitsText, drafterOf, stopIdOf } from './shared.ts'

// --- one record in words ------------------------------------------------------------------------

// A reviewer as a view names it: an assignment with its role, a person, a model run.
const byWords = (work: Work, by: By, record: string): string =>
  isAssignment(by) ? `${by} (${assignmentAt(work, by).role})` : who(work, by, record)
const quoteOf = (work: Work, id: string): string | undefined => forwardedOf(work, id)?.quote
const ruleKey = (work: Work, entry: string): string => ruleAt(work, entry as never).id
const byName = (by: By): string => (typeof by === 'string' ? by : by.name)

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

// --- a result and its reviews --------------------------------------------------------------

// A result and each review of it, with the evidence and the points: what a decider reads
// before it decides on its checkers' work.
export const renderResult = (d: Derived, id: ResultId): ReadonlyArray<string> => {
  const work = d.moment.work
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
  const items = itemsOf(work, id)
  for (const v of items) {
    const q = quoteOf(work, v.id)
    const words = q ? ` (their words: "${q}")` : ''
    const by = byWords(work, v.by, v.id)
    if (v.redo) lines.push(`${v.id} recheck by ${by}: "${v.reason}"`)
    else if (v.decision === 'Escalate') {
      const first = v.review._tag === 'Escalate' ? v.review.answerBy : undefined
      const to = first === undefined ? '' : byWords(work, answererOfQuestion(d, v.id, first), v.id)
      const state = d.states.escalations.get(v.id as never)
      // Ruling 10.7: an escalation whose result or task ended is irrelevant, never open.
      const how =
        state?._tag === 'Resolved'
          ? `resolved by ${state.by}`
          : state?._tag === 'Irrelevant'
            ? 'irrelevant'
            : 'open'
      lines.push(`${v.id} escalation by ${by}, for ${to}: "${v.reason}" (${how})`)
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
  return [...lines, ...renderBlockers(d, id)]
}

// --- the task tree --------------------------------------------------------------------------

export const renderTaskTree = (d: Derived, task: TaskId, depth = 0): ReadonlyArray<string> => {
  const work = d.moment.work
  const pad = '  '.repeat(depth)
  const t = taskAt(work, task)
  const r = latestResult(work, task)
  let suffix = ''
  if (r && d.moment.outside.changed.has(r.id)) suffix = ` (${r.id} changed after it was reported)`
  else if (r && itemsOf(work, r.id).some((v) => v.decision === 'Reject')) {
    suffix = ` (${r.id} rejected)`
  }
  const lines = [`${pad}${task} ${t.name} · ${stateWord(d, task)}${suffix}`]
  for (const part of partsOf(work, task)) lines.push(...renderTaskTree(d, part.id, depth + 1))
  return lines
}

// `work task show`: the task, its words, and what stops its latest result.
export const renderTask = (d: Derived, id: TaskId): ReadonlyArray<string> => {
  const work = d.moment.work
  const task = taskAt(work, id)
  const t = task.descriptionAi
  const latest = latestResult(work, id)
  const replaced = replacesOf(work, id)
  const state = d.states.tasks.get(id)
  return [
    `${task.id} ${task.name} · ${stateWord(d, id)} · owner ${task.owner.name}`,
    `text: ${t.text}`,
    ...(t.partOf ? [`part of: ${t.partOf}`] : []),
    `directions: ${t.directions.join(', ') || 'none'}`,
    ...(task.needs.length ? [`needs: ${task.needs.join(', ')}`] : []),
    ...(replaced ? [`replaces ${replaced}`] : []),
    ...(state?._tag === 'Replaced' ? [`closed as replaced by ${state.next}`] : []),
    ...(latest ? renderBlockers(d, latest.id) : []),
  ]
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
export const renderDirection = (d: Derived, version: VersionId): string => {
  const work = d.moment.work
  const v = versionOfId(work, version)
  const dir = directionAt(work, v.of)
  const official = officialAt(work, v.of)
  const next = official?.versions[v.number]
  const draft = draftAt(work, v.revision)
  const base = draft._tag === 'Change' ? versionOfId(work, draft.base) : undefined
  const lines = [
    `${version} ${dir.name} (owner ${dir.owner.name}) · ` +
      `${next ? `replaced by ${versionIdOf(next)}` : 'current'}`,
    `made from ${draft.id}, drafted by ` +
      `${draft.origin._tag === 'Written' ? who(work, draft.origin.by) : 'refresh'}`,
    ...contentLines(work, v, base),
  ]
  for (const [id, state] of d.states.revisions) {
    const x = work.drafts.get(id)
    if (x === undefined || x.of !== v.of || x._tag !== 'Change' || state._tag === 'Official') {
      continue
    }
    const end =
      state._tag === 'Vetoed'
        ? ' (ended by a Reject)'
        : state._tag === 'Outdated'
          ? ' (built on an old version, so it stopped)'
          : ''
    const reviews = itemsOf(work, x.id).map((r) => r.decision)
    lines.push(
      `draft: ${x.id}${end}; reviews: ${reviews.join(', ') || 'none'}; work direction show ${x.id}`,
    )
  }
  return lines.join('\n')
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
  const standards = words.standards.map((e) => standardAt(work, e))
  const rules = standards.flatMap((s) => s.rules.map((e) => ruleAt(work, e)))
  const standard = standards.find((s) => s.id === keys[0])
  const rule = rules.find((r) => r.id === keys[0])
  const entry = standard ?? rule
  const under = (label: string, text: string, name: string | undefined) =>
    headersOf(text)
      .filter((h) => h.slug === name)
      .map((h) => `${v} · ${label} · ${h.title}\n${h.text}`)
  if (entry && keys[1]) {
    const pieces = under(`${standard ? 'standard' : 'rule'} ${entry.id}`, entry.says, keys[1])
    return pieces.length ? pieces.join('\n\n') : undefined
  }
  if (standard) {
    return [
      `${v} · standard ${standard.id}${whereWords(standard)}`,
      standard.says,
      ...standard.rules.map((e) => {
        const r = ruleAt(work, e)
        return `- rule ${r.id} (${checkerOf(r)}): ${indented(r.says, '  ')}`
      }),
    ].join('\n')
  }
  if (rule) return [`${v} · rule ${rule.id} (${checkerOf(rule)})`, rule.says].join('\n')
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

// Two rules are the same when they have the same id, words, and checker.
const sameRule = (a: Rule, b: Rule): boolean =>
  a.entry === b.entry ||
  (a.id === b.id &&
    a.says === b.says &&
    (a.checkedBy._tag === 'Decider'
      ? b.checkedBy._tag === 'Decider'
      : b.checkedBy._tag === 'Role' && a.checkedBy.role === b.checkedBy.role))

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
export const renderDraft = (d: Derived, id: RevisionId): string => {
  const work = d.moment.work
  const x: Revision<Direction> = draftAt(work, id)
  const dir = directionAt(work, x.of)
  const base = x._tag === 'Change' ? versionOfId(work, x.base) : undefined
  const state = d.states.revisions.get(id)
  const end =
    state?._tag === 'Official'
      ? `official: ${state.version}`
      : state?._tag === 'Vetoed'
        ? 'ended by a Reject'
        : state?._tag === 'Outdated'
          ? `built on an old version, so it stopped (${state.current} is current)`
          : `waits for the accept of ${draftWaitsText(d, id)}`
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
    `${id} a draft of ${dir.name} (owner ${dir.owner.name}), ${on} · ${end}`,
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

// --- a question, an evaluation, an assignment ---------------------------------------------

// `work question show`: who asked, for whom, and the answer. C2: the answer is read from the
// state, so a question of an ended task reads as no answer.
export const renderQuestion = (d: Derived, id: QuestionId): ReadonlyArray<string> => {
  const q = d.moment.work.questions.get(id)
  const state = d.states.questions.get(id)
  if (q === undefined) throw new Error(`the work has no question ${id}`)
  return [
    `${id} asked by ${byName(q.from)}, for ${byName(q.answerBy)}:`,
    q.text,
    '',
    state?._tag === 'Answered' ? `answer: ${state.answer}` : 'no answer yet',
  ]
}

// `work evaluation show`: the stop it answers, its level, its words, and whether the owner
// decided it.
export const renderEvaluation = (d: Derived, id: EvaluationId): ReadonlyArray<string> => {
  const work = d.moment.work
  const e = work.evaluations.get(id)
  if (e === undefined) throw new Error(`the work has no evaluation ${id}`)
  const task = work.tasks.get(stopTask(work, e.answers))
  const decided = evaluationDecision(work, e)
  // The owner decides an evaluation with one accept, or one reject with a reason.
  const words = (r: Review) =>
    r._tag === 'Accept'
      ? (r.reason ?? r.of.evidence.map((x) => x.says).join('; '))
      : r._tag === 'Reject' && 'reason' in r.of
        ? r.of.reason
        : ''
  const tail = decided
    ? ` · ${decided._tag === 'Accept' ? 'accepted' : 'rejected'}: ${words(decided)}`
    : d.states.evaluations.get(id)?._tag === 'Counts'
      ? ''
      : ' · waits for the person'
  return [
    `${id} · ${task?.id ?? ''} ${task?.name ?? ''} · answers ${stopIdOf(e.answers)} · ` +
      `level ${e.level} · by ${byName(e.by)}${tail}`,
    `wrong:   ${e.wrong}`,
    `why:     ${e.why}`,
    ...e.improve.map((x) => `improve: ${x}`),
  ]
}

// `work assignment show`: the brief with no snapshot and no claim, or the line of a program.
export const renderAssignment = (d: Derived, id: AssignmentId): ReadonlyArray<string> => {
  const work = d.moment.work
  const a = assignmentAt(work, id)
  const config = work.config.roles[a.role]
  // A program reads no brief: it runs its command on each report and records its checks.
  if (config?.kind === 'program') {
    const task = work.tasks.get(a.task)
    return [
      `${a.id} · ${a.role} (program) on ${a.task} ${task?.name ?? ''}`,
      `runs "${config.run}" on ${config.on}; checks ${config.checks.join(', ') || 'nothing'}; ` +
        'the CLI starts it, not a subagent',
    ]
  }
  return [briefOf(d, a.id, `${a.id}.<token>`), '', '(read-only: no snapshot, no claim)']
}

