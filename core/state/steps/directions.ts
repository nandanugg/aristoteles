// The steps of directions: a draft (a new direction, a revise of the current version, a commit
// of a company folder), and the version that an accepted draft makes. A draft is
// built as the old engine built it, without its checks: each standard and rule is its own entry;
// a kept one keeps its entry, a new one is named after its draft.
import {
  type AnswerId,
  type By,
  type Direction,
  type DirectionFile,
  type DirectionId,
  type EventOf,
  type EventRef,
  firstSentence,
  type FlowStep,
  human,
  type Human,
  type Limit,
  Moves,
  type OfficialDirection,
  type OnboardedDirection,
  type PositiveInt,
  type Reviser,
  type Revision,
  type RevisionId,
  type RevisionOrigin,
  type RoleName,
  type Rule,
  type RuleEntry,
  type Standard,
  type StandardEntry,
  type Stepped,
  type Time,
  type Version,
  versionId,
  whereOf,
  type Why,
  type Work,
} from '../../schema/index.ts'
import { type Act, type Build, built, damaged, put } from '../act.ts'
import { currentOf, directionAt, draftAt, officialAt, ruleAt, standardAt } from '../records.ts'
import { type Content, contentOf, sameRuleDefinition, sameWords } from '../versions.ts'

type StandardFile = DirectionFile['standards'][number]
type Seq = { readonly seq: number }

// The standards and rules that a draft makes, before the Work holds them.
interface Scratch {
  readonly standards: Map<StandardEntry, Standard>
  readonly rules: Map<RuleEntry, Rule>
}
const scratchOf = (): Scratch => ({ standards: new Map(), rules: new Map() })
const withScratch = (w: Work, s: Scratch): Work =>
  s.standards.size + s.rules.size === 0
    ? w
    : {
        ...w,
        standards: new Map([...w.standards, ...s.standards]),
        rules: new Map([...w.rules, ...s.rules]),
      }
const entryIn = (draft: RevisionId, key: string) => `${draft}/${key}` as StandardEntry
const limitOf = (n: PositiveInt | undefined): Limit =>
  n === undefined ? { _tag: 'Unlimited' } : { _tag: 'AtMost', max: n }

// A rule with the same id, words, and checker as a rule of an earlier version of the direction
// is that rule (its evidence and its open points stay), also when a version removed it; any
// other rule is new. supersedes names rules of the base.
const buildStandard = (
  w: Work,
  file: StandardFile,
  base: Content | undefined,
  entry: StandardEntry,
  scratch: Scratch,
): Standard => {
  const official = base === undefined ? undefined : officialAt(w, base.of)
  const rulesIn = (entries: ReadonlyArray<StandardEntry>) =>
    entries.flatMap((e) => standardAt(w, e).rules.map((r) => ruleAt(w, r)))
  const older = (official?.versions ?? []).flatMap((v) => rulesIn(v.standards))
  const baseRules = rulesIn(base?.standards ?? [])
  const rules = file.rules.map((r): RuleEntry => {
    const checkedBy: Rule['checkedBy'] =
      r.checkedBy === undefined
        ? { _tag: 'Decider' }
        : { _tag: 'Role', role: r.checkedBy as RoleName }
    const sameDefinition = (x: Rule) => sameRuleDefinition(x, { ...r, checkedBy })
    const same = baseRules.find(sameDefinition) ?? older.findLast(sameDefinition)
    if (same && r.supersedes.length === 0) {
      if (r.evidence === undefined || Bun.deepEquals(same.evidence, r.evidence)) return same.entry
      const ruleEntry = `${entry}/${r.id}` as RuleEntry
      scratch.rules.set(ruleEntry, { ...same, entry: ruleEntry, evidence: r.evidence })
      return ruleEntry
    }
    const supersedes = r.supersedes.flatMap((id) => {
      const old = baseRules.find((x) => x.id === id)
      return old ? [old.entry] : []
    })
    const ruleEntry = `${entry}/${r.id}` as RuleEntry
    const rule = {
      entry: ruleEntry,
      id: r.id,
      says: r.says,
      ...(r.test === undefined ? {} : { test: r.test }),
      ...(r.ref === undefined ? {} : { ref: r.ref }),
      checkedBy,
      ...(r.evidence === undefined ? {} : { evidence: r.evidence }),
      supersedes,
    }
    scratch.rules.set(ruleEntry, rule)
    return ruleEntry
  })
  return { entry, id: file.id, says: file.says, where: whereOf(file.where), rules }
}

interface Edit {
  readonly add: ReadonlyArray<Standard>
  readonly remove: ReadonlyArray<string>
  readonly replace: ReadonlyArray<readonly [string, Standard]>
}
// The base, with the edit. A rule that a new rule supersedes leaves the draft, and a standard
// that loses one is a new standard of this draft. Only the new standards go in, with the rules
// that they hold.
const draftStandards = (
  w: Work,
  baseEntries: ReadonlyArray<StandardEntry>,
  edit: Edit,
  scratch: Scratch,
  draft: RevisionId,
): ReadonlyArray<StandardEntry> => {
  const base = baseEntries.map((e) => standardAt(w, e))
  const replacement = new Map(edit.replace)
  let standards: ReadonlyArray<Standard> = [
    ...base.filter((s) => !edit.remove.includes(s.id)).map((s) => replacement.get(s.id) ?? s),
    ...edit.add,
  ]
  const wx = withScratch(w, scratch)
  const superseded = new Set(
    standards.flatMap((s) => s.rules.flatMap((r) => ruleAt(wx, r).supersedes)),
  )
  if (superseded.size > 0) {
    standards = standards.map((s) =>
      s.rules.some((r) => superseded.has(r))
        ? { ...s, entry: entryIn(draft, s.id), rules: s.rules.filter((r) => !superseded.has(r)) }
        : s,
    )
  }
  const fresh = standards.filter((s) => !w.standards.has(s.entry))
  for (const s of fresh) scratch.standards.set(s.entry, s)
  const held = new Set(fresh.flatMap((s) => s.rules))
  for (const e of [...scratch.rules.keys()]) if (!held.has(e)) scratch.rules.delete(e)
  return standards.map((s) => s.entry)
}

// --- the three kinds of draft --------------------------------------------------------------------

interface Planned {
  readonly direction: Direction
  readonly revision: Revision<Direction>
  readonly scratch: Scratch
}
interface DraftOf {
  readonly id: RevisionId
  readonly when: Time
  readonly at: number
}
interface DraftFields {
  readonly answerIds: ReadonlyArray<AnswerId>
  readonly why: Why
  readonly origin: RevisionOrigin
}
// A model run writes each draft.
const reviserOf = (by: By): Reviser => {
  if (by._tag === 'Agent') return by
  throw new Error(`the person ${by.name} writes no draft`)
}

// A new direction, or another draft of a direction with no version yet: no base.
const fresh = (
  w: Work,
  x: DraftOf,
  input: DraftFields & {
    readonly id: DirectionId
    readonly name: string
    readonly owner: Human
    readonly from: Direction['from']
    readonly maxStandards: Limit
    readonly source: Direction['source']
    readonly summary: string
    readonly flow: ReadonlyArray<FlowStep>
    readonly says: string
    readonly add: ReadonlyArray<Standard>
  },
  scratch: Scratch,
): Planned => {
  const existing = w.directions.get(input.id)
  const { name, owner } = input
  const fields = { name, from: input.from, maxStandards: input.maxStandards }
  const direction: Direction =
    existing === undefined
      ? { _tag: 'NewDirection', id: input.id, owner, source: input.source, ...fields }
      : { ...existing, ...fields }
  const edit = { add: input.add, remove: [], replace: [] }
  const standards = draftStandards(w, [], edit, scratch, x.id)
  const revision: Revision<Direction> = {
    _tag: 'New',
    id: x.id,
    of: input.id,
    summary: input.summary,
    flow: input.flow,
    says: input.says,
    standards,
    origin: input.origin,
    answers: input.answerIds,
    why: input.why,
    when: x.when,
    at: x.at,
  }
  return { direction, revision, scratch }
}

// The current version, with the edit; a summary, a flow or words that the edit does not give stay.
const revised = (
  w: Work,
  x: DraftOf,
  input: DraftFields & {
    readonly direction: OfficialDirection
    readonly summary: string | undefined
    readonly flow: ReadonlyArray<FlowStep> | undefined
    readonly says: string | undefined
    readonly edit: Edit
  },
  scratch: Scratch,
): Planned => {
  const d = input.direction
  const current = currentOf(w, d.id)
  const base = contentOf(current)
  const standards = draftStandards(w, base.standards, input.edit, scratch, x.id)
  const revision: Revision<Direction> = {
    _tag: 'Change',
    base: versionId(d.id, base.number ?? 0),
    ...(d.currentEvidence ? { evidenceBase: d.currentEvidence.revision } : {}),
    id: x.id,
    of: d.id,
    summary: input.summary ?? current.summary,
    flow: input.flow ?? current.flow,
    says: input.says ?? base.says,
    standards,
    origin: input.origin,
    answers: input.answerIds,
    why: input.why,
    when: x.when,
    at: x.at,
  }
  return { direction: d, revision, scratch }
}

// direction new: the whole of a new direction, drafted by a model.
const planDrafted = (
  w: Work,
  x: DraftOf,
  data: EventOf<'Revision.Drafted'>['create'],
  by: By,
): Planned => {
  const d = data.direction
  const scratch = scratchOf()
  const add = d.standards.map((s) =>
    buildStandard(w, s, undefined, entryIn(x.id, s.id), scratch),
  )
  const input = {
    id: d.id,
    name: d.name,
    owner: human(d.owner),
    from: d.from,
    maxStandards: limitOf(d.maxStandards),
    source: { _tag: 'Local' } as const,
    summary: d.summary,
    flow: d.flow,
    says: d.says,
    add,
    answerIds: data.answers,
    why: data.why,
    origin: { _tag: 'Written', by: reviserOf(by) } as const,
  }
  return fresh(w, x, input, scratch)
}

// The store start of onboarding: a direction that the person accepted on the page, drafted as a
// whole and made version 1 in the same step (Question 20, option A). Its origin names the start
// event; a company direction keeps its source, so that the daily refresh follows it (P8).
export const onboarded = (b: Build, od: OnboardedDirection, event: EventRef, when: Time): void => {
  const id = b.name('revision')
  const x = { id, when, at: b.tick() }
  const w = b.work
  const d = od.direction
  const scratch = scratchOf()
  const add = d.standards.map((s) => buildStandard(w, s, undefined, entryIn(id, s.id), scratch))
  const source =
    od.source._tag === 'Local'
      ? ({ _tag: 'Local' } as const)
      : ({ _tag: 'External', repo: od.source.repo, path: od.source.path } as const)
  const input = {
    id: d.id,
    name: d.name,
    owner: human(d.owner),
    from: d.from,
    maxStandards: limitOf(d.maxStandards),
    source,
    summary: d.summary,
    flow: d.flow,
    says: d.says,
    add,
    answerIds: [],
    why: { _tag: 'NoneGiven' } as const,
    origin: { _tag: 'Onboarded', event } as const,
  }
  const planned = fresh(w, x, input, scratch)
  b.work = {
    ...w,
    directions: put(w.directions, planned.direction.id, planned.direction),
    standards: new Map([...w.standards, ...planned.scratch.standards]),
    rules: new Map([...w.rules, ...planned.scratch.rules]),
    drafts: put(w.drafts, id, planned.revision),
  }
  makeVersion(b, id, when)
}

// direction revise: a draft of a direction, built on its current version.
const planRevised = (
  w: Work,
  x: DraftOf,
  data: EventOf<'Revision.Revised'>['create'],
  by: By,
  r: Seq,
): Planned => {
  const official = officialAt(w, data.direction) ?? damaged(r, `${data.direction} has no version`)
  const base = contentOf(currentOf(w, official.id))
  const scratch = scratchOf()
  const edit = data.edit
  const add = (edit.add ?? []).map((s) =>
    buildStandard(w, s, base, entryIn(x.id, s.id), scratch),
  )
  const replace = (edit.replace ?? []).map(
    (o) => [o.id, buildStandard(w, o.with, base, entryIn(x.id, o.with.id), scratch)] as const,
  )
  const input = {
    direction: official,
    summary: edit.summary,
    flow: edit.flow,
    says: edit.says,
    edit: { add, remove: edit.remove ?? [], replace },
    answerIds: data.answers,
    why: data.why,
    origin: { _tag: 'Written', by: reviserOf(by) } as const,
  }
  return revised(w, x, input, scratch)
}

// company import: a commit of a company folder comes in as a draft of the whole direction, as
// the change from the current version: a standard with other words is replaced, a new one
// added, a gone one removed, so a rule with the same words keeps its evidence.
const planImported = (
  w: Work,
  x: DraftOf,
  data: EventOf<'Revision.Imported'>['create'],
): Planned => {
  const { direction: id, source, folder, checkers } = data
  const checkedBy = (rule: string) => checkers.rules?.[rule] ?? checkers.checkedBy
  const files: ReadonlyArray<StandardFile> = folder.standards.map((s) => ({
    id: s.id,
    says: s.says,
    rules: s.rules.map((r) => ({
      id: r.id,
      says: r.says,
      checkedBy: checkedBy(r.id),
      supersedes: [],
    })),
  }))
  const official = officialAt(w, id)
  const scratch = scratchOf()
  const origin: RevisionOrigin = { _tag: 'Imported', commit: source.commit, ref: source.ref }
  const why: Why = { _tag: 'NoneGiven' }
  // A company folder has no summary: its words are the company's (Nanda, 2026-11-15). It has no
  // flow either: a new one gets its flow, with its examples (ExamplesAdded), and a change keeps the
  // flow of the current version.
  const summary = firstSentence(folder.says)
  if (official === undefined) {
    const add = files.map((s) => buildStandard(w, s, undefined, entryIn(x.id, s.id), scratch))
    const input = {
      id,
      name: folder.name,
      owner: human(data.owner),
      from: [],
      maxStandards: { _tag: 'Unlimited' } as const,
      source: { _tag: 'External', repo: source.repo, path: source.path } as const,
      summary,
      flow: [],
      says: folder.says,
      add,
      answerIds: [],
      why,
      origin,
    }
    return fresh(w, x, input, scratch)
  }
  const base = contentOf(currentOf(w, id))
  const made = files.map((s) => buildStandard(w, s, base, entryIn(x.id, s.id), scratch))
  const wx = withScratch(w, scratch)
  const was = base.standards.map((e) => standardAt(w, e))
  const edit: Edit = {
    add: made.filter((s) => !was.some((y) => y.id === s.id)),
    replace: made
      .filter((s) => was.some((y) => y.id === s.id && !sameWords(wx, y, s)))
      .map((s) => [s.id, s] as const),
    remove: was.filter((y) => !made.some((s) => s.id === y.id)).map((y) => y.id),
  }
  const input = {
    direction: official,
    summary,
    flow: undefined,
    says: folder.says,
    edit,
    answerIds: [],
    why,
    origin,
  }
  return revised(w, x, input, scratch)
}

export const drafted = (
  work: Work,
  e: EventOf<'Revision.Drafted'> | EventOf<'Revision.Revised'> | EventOf<'Revision.Imported'>,
  act: Act,
  r: Seq,
): Stepped =>
  built(work, (b) => {
    const id = b.name('revision')
    const x = { id, when: act.when, at: b.tick() }
    const d = e.create
    const planned =
      d._tag === 'Drafted'
        ? planDrafted(b.work, x, d, act.by)
        : d._tag === 'Revised'
          ? planRevised(b.work, x, d, act.by, r)
          : planImported(b.work, x, d)
    const w = b.work
    b.work = {
      ...w,
      directions: put(w.directions, planned.direction.id, planned.direction),
      standards: new Map([...w.standards, ...planned.scratch.standards]),
      rules: new Map([...w.rules, ...planned.scratch.rules]),
      drafts: put(w.drafts, id, planned.revision),
    }
  })

// --- the version of an accepted draft ------------------------------------------------------------

// Evidence can change independently of the numbered governance snapshot.
const evidenceOnly = (w: Work, from: Version<Direction>, draft: Revision<Direction>): boolean => {
  if (draft.origin._tag !== 'Written' || draft.summary !== from.summary || draft.says !== from.says ||
    !Bun.deepEquals(draft.flow, from.flow) || draft.standards.length !== from.standards.length) return false
  const previous = new Map(from.standards.map((entry) => {
    const standard = standardAt(w, entry)
    return [standard.id, standard] as const
  }))
  let changed = false
  for (const entry of draft.standards) {
    const after = standardAt(w, entry)
    const before = previous.get(after.id)
    if (before === undefined || !sameWords(w, before, after, sameRuleDefinition)) return false
    changed ||= !sameWords(w, before, after, (a, b) =>
      sameRuleDefinition(a, b) && Bun.deepEquals(a.evidence, b.evidence))
  }
  return changed
}

// An accepted draft changes the current evidence or makes the next numbered version.
export const makeVersion = (b: Build, draft: RevisionId, when: Time): void => {
  const w = b.work
  const x = draftAt(w, draft)
  const d = directionAt(w, x.of)
  const from = d._tag === 'Official' ? currentOf(w, d.id) : undefined
  if (d._tag === 'Official' && from !== undefined && evidenceOnly(w, from, x)) {
    b.work = { ...w, directions: put(w.directions, d.id, Moves.acceptEvidence(d, x)) }
    return
  }
  const version = {
    of: d.id,
    number: ((from?.number ?? 0) + 1) as PositiveInt,
    summary: x.summary,
    flow: x.flow,
    says: x.says,
    standards: x.standards,
    revision: draft,
    when,
  }
  b.work = { ...w, directions: put(w.directions, d.id, Moves.makeOfficial(d, version)) }
  b.created.push(versionId(d.id, version.number))
}

// A model gives a company draft of a new direction its flow with its examples (P10 rejected,
// onboarding 2026-11-14); a draft of a change has none to take.
export const examplesAdded = (work: Work, e: EventOf<'Revision.ExamplesAdded'>, r: Seq): Stepped => {
  const x = work.drafts.get(e.id)
  if (x?._tag !== 'New') return damaged(r, `${e.id} is no draft of a new direction`)
  const added = Moves.MOVES['Revision.ExamplesAdded'](x, e.move.flow)
  // Each named rule of the draft gets its evidence (pass 3b: cases live on rules).
  const given = new Map(e.move.evidence)
  let rules = work.rules
  for (const entry of x.standards) {
    for (const r of work.standards.get(entry)?.rules ?? []) {
      const rule = rules.get(r)
      const evidence = rule === undefined ? undefined : given.get(rule.id)
      if (rule !== undefined && evidence !== undefined) rules = put(rules, r, { ...rule, evidence })
    }
  }
  return { work: { ...work, rules, drafts: put(work.drafts, e.id, added) }, created: [] }
}
