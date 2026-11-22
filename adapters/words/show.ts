// The show views: a direction, a draft, one piece of them, the examples of a direction. Golden
// text, as the old CLI showed them. Every state a view prints comes from Derived. Finding S6/S7: a
// draft that is Outdated or Conflicted says nothing of it (Conflicted has no old words).
import {
  directionAt,
  draftAt,
  officialAt,
  ruleAt,
  standardAt,
  versionAt,
} from '../../core/derived/reads.ts'
import { type Derived, spotCurrent } from '../../core/derived/index.ts'
import {
  type Direction,
  type DirectionId,
  type Example,
  type FlowStep,
  isMarked,
  isSpot,
  type Revision,
  type RevisionId,
  type Sample,
  type Spot,
  type StandardEntry,
  type Version,
  type VersionId,
  versionIdOf,
  type Why,
  whereRecord,
  type Work,
} from '../../core/schema/index.ts'
import { checkerOf, headersOf, indented, short, who } from './common.ts'
import { draftWaitsText, drafterOf } from './shared.ts'

// --- one record in words ------------------------------------------------------------------------

// What a draft or a version holds: its summary, its flow, its words and its standards.
interface Words {
  readonly summary: string
  readonly flow: ReadonlyArray<FlowStep>
  readonly says: string
  readonly standards: ReadonlyArray<StandardEntry>
}

// The version of an id (tsd-writing@2).
const versionOfId = (work: Work, id: VersionId): Version<Direction> => {
  const at = id.lastIndexOf('@')
  return versionAt(work, id.slice(0, at) as DirectionId, Number(id.slice(at + 1)))
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
// The flow of a direction (Nanda, 2026-11-15: a direction has a flow), one numbered line for each
// step: who acts, on whom or on what file, what happens, where the project defines it, and for a
// step that the direction governs the ids that apply there. An act of one actor on its own names
// the actor once. No step: no line.
const whoOfStep = (s: FlowStep) => (s.from === s.to ? s.from : `${s.from} -> ${s.to}`)
export const flowLines = (
  flow: ReadonlyArray<FlowStep>,
  head = 'flow:',
): ReadonlyArray<string> => {
  if (flow.length === 0) return []
  const step = (s: FlowStep, i: number) => {
    const line = s.place?.line === undefined ? '' : `:${s.place.line}`
    const place = s.place === undefined ? '' : ` (${s.place.file}${line})`
    const uses = s.uses ? ` [uses ${s.uses.join(', ')}]` : ''
    return `  ${i + 1}. ${whoOfStep(s)}: ${s.says}${place}${uses}`
  }
  return [head, ...flow.map(step)]
}

// The summary comes first (Nanda, 2026-11-15: a direction has a summary), then the flow.
const contentLines = (work: Work, v: Words, base: Words | undefined): ReadonlyArray<string> => {
  const lines: Array<string> = [
    `summary: ${v.summary}`,
    ...flowLines(v.flow),
    ...(String(v.says).includes('\n')
      ? [
          'says:',
          ...String(v.says)
            .trimEnd()
            .split('\n')
            .map((l) => (l ? `  ${l}` : '')),
        ]
      : [`says: ${v.says}`]),
  ]
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
  if (base && v.summary !== base.summary) lines.push(`summary was: ${base.summary}`)
  if (base && JSON.stringify(v.flow) !== JSON.stringify(base.flow)) {
    lines.push(...(base.flow.length ? flowLines(base.flow, 'flow was:') : ['flow was: none']))
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
      `${
        draft.origin._tag === 'Written'
          ? who(draft.origin.by)
          : draft.origin._tag === 'Onboarded'
            ? drafterOf(work, draft)
            : 'refresh'
      }`,
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
    lines.push(`draft: ${x.id}${end}; work direction show ${x.id}`)
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

// A draft: what it changes in its base, who drafted it, what it answers, and where it ends.
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
          : `waits for the accept of ${draftWaitsText(work, id)}`
  const on = base ? `built on ${x._tag === 'Change' ? x.base : ''}` : 'a new direction'
  return [
    `${id} a draft of ${dir.name} (owner ${dir.owner.name}), ${on} · ${end}`,
    `drafted by ${drafterOf(work, x)}`,
    ...x.answers.map((a) => `answers: ${a}`),
    ...contentLines(work, x, base),
  ].join('\n')
}

// Why a draft changes its direction, under the draft where the decider reads it (new: the owner's
// ruling, 2026-11-12): the reason, then the reviser's words; nothing when none was given.
export const whyLines = (why: Why): ReadonlyArray<string> =>
  why._tag === 'NoneGiven' ? [] : [`why: ${why.reason}`, ...(why.words === null ? [] : [why.words])]

// One example (Nanda, 2026-11-15): its fit, its input when it has one, and its output; a real
// sample with its place and its excerpt, stale when the excerpt is no longer in its file, and the
// host's own words as written by the host. textOf gives the text of a file now (null: no such
// file); with none, no state shows.
export const exampleOneLines = (
  e: Example,
  textOf?: (file: string) => string | null,
): ReadonlyArray<string> => {
  const stale = (s: Spot) => textOf !== undefined && !spotCurrent(textOf(s.file), s)
  const sample = (name: string, s: Sample) =>
    isSpot(s)
      ? `      ${name} · ${s.file}:${s.line} "${short(s.excerpt, 80)}"${stale(s) ? ' · stale' : ''}`
      : `      ${name} · written by the host: "${short(s.written, 80)}"`
  return [
    `    ${e.fit}`,
    ...(e.input ? [sample('input', e.input)] : []),
    sample('output', e.output),
  ]
}
// The examples of a flow, under the marked step that each shows.
export const exampleLines = (
  flow: ReadonlyArray<FlowStep>,
  textOf?: (file: string) => string | null,
): ReadonlyArray<string> =>
  flow.flatMap((s, i) =>
    isMarked(s)
      ? [`  step ${i + 1} · ${whoOfStep(s)}`, ...(s.examples ?? []).flatMap((e) => exampleOneLines(e, textOf))]
      : [],
  )
