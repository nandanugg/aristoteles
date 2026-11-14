// The steps of directions: a draft (a new direction, a revise of the current version, a commit
// of a company folder), the version that an accepted draft makes with its lessons, and a
// suggestion. A draft is built as the old engine built it, without its checks: each standard and
// rule is its own entry; a kept one keeps its entry, a new one is named after its draft.
import {
  type AnswerId,
  type By,
  type Deciders,
  type Direction,
  type DirectionFile,
  type DirectionId,
  type EventOf,
  human,
  type Human,
  type Limit,
  Moves,
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
  versionId,
  whereOf,
  type Why,
  type Work,
} from '../../schema/index.ts'
import { type Act, type Build, built, damaged, put } from '../act.ts'
import { decidersOf } from '../decisions.ts'
import { reviewItems, taskOfTarget } from '../items.ts'
import {
  currentOf,
  directionAt,
  draftAt,
  officialAt,
  ruleAt,
  standardAt,
  taskAt,
} from '../records.ts'
import { type Content, contentOf, findRule, sameChecker, sameWords } from '../versions.ts'

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
const limitOf = (n: number | undefined): Limit =>
  n === undefined ? { _tag: 'Unlimited' } : { _tag: 'AtMost', max: n as PositiveInt }

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
    const same = older.findLast(
      (x) => x.id === r.id && x.says === r.says && sameChecker(x.checkedBy, checkedBy),
    )
    if (same && r.supersedes.length === 0) return same.entry
    const supersedes = r.supersedes.flatMap((id) => {
      const old = baseRules.find((x) => x.id === id)
      return old ? [old.entry] : []
    })
    const ruleEntry = `${entry}/${r.id}` as RuleEntry
    const rule = { entry: ruleEntry, id: r.id, says: r.says, checkedBy, supersedes }
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
// A model writes each draft: an assignment, or a run outside any task.
const reviserOf = (by: By): Reviser => {
  if (typeof by === 'string' || by._tag === 'Agent') return by
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
    readonly approvedBy: Deciders | undefined
    readonly source: Direction['source']
    readonly says: string
    readonly add: ReadonlyArray<Standard>
  },
  scratch: Scratch,
): Planned => {
  const existing = w.directions.get(input.id)
  const { name, owner, approvedBy } = input
  const fields = {
    name,
    from: input.from,
    maxStandards: input.maxStandards,
    approvedBy:
      approvedBy === undefined
        ? ({ _tag: 'Owner' } as const)
        : ({ _tag: 'Deciders', deciders: approvedBy } as const),
  }
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

// The current version, with the edit.
const revised = (
  w: Work,
  x: DraftOf,
  input: DraftFields & {
    readonly direction: Direction
    readonly says: string | undefined
    readonly edit: Edit
  },
  scratch: Scratch,
): Planned => {
  const d = input.direction
  const base = contentOf(currentOf(w, d.id))
  const standards = draftStandards(w, base.standards, input.edit, scratch, x.id)
  const revision: Revision<Direction> = {
    _tag: 'Change',
    base: versionId(d.id, base.number ?? 0),
    id: x.id,
    of: d.id,
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

// A point of a closed task blocks no work, so a revise keeps only the answers that are not
// about closed tasks (Nanda, 2026-11-13). (derived: a point of an ended task is moot; the
// action of P5 drops these before it writes, and the fold keeps the rule for the old stores.)
const openAnswerIds = (w: Work, ids: ReadonlyArray<AnswerId>): ReadonlyArray<AnswerId> =>
  ids.filter((id) => {
    const items = reviewItems(w).filter((i) => i.id === id || i.group === id)
    return !(
      items.length > 0 &&
      items.every((i) => {
        const task = taskOfTarget(w, i.of)
        return task !== undefined && taskAt(w, task).end._tag !== 'NotEnded'
      })
    )
  })

// direction new: the whole of a new direction, drafted by a model.
const planDrafted = (
  w: Work,
  x: DraftOf,
  data: EventOf<'Revision.Drafted'>['create'],
  by: By,
): Planned => {
  const d = data.direction
  const roles = [...w.workflow.roles.keys()]
  const approvedBy = d.approvedBy === undefined ? undefined : decidersOf(d.approvedBy, roles)
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
    approvedBy,
    source: { _tag: 'Local' } as const,
    says: d.says,
    add,
    answerIds: data.answers,
    why: data.why,
    origin: { _tag: 'Written', by: reviserOf(by) } as const,
  }
  return fresh(w, x, input, scratch)
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
    says: edit.says,
    edit: { add, remove: edit.remove ?? [], replace },
    answerIds: openAnswerIds(w, data.answers),
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
  if (official === undefined) {
    const add = files.map((s) => buildStandard(w, s, undefined, entryIn(x.id, s.id), scratch))
    const input = {
      id,
      name: folder.name,
      owner: human(data.owner),
      from: [],
      maxStandards: { _tag: 'Unlimited' } as const,
      approvedBy: undefined,
      source: { _tag: 'External', repo: source.repo, path: source.path } as const,
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
  const input = { direction: official, says: folder.says, edit, answerIds: [], why, origin }
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

// The lessons of a new version: each new text of it (what it says, a new standard, a new rule of
// a new standard), or that the direction changed.
const lessonsOf = (w: Work, d: DirectionId, from: Content, to: Content): ReadonlyArray<string> => {
  const oldRules = new Set(from.standards.flatMap((e) => standardAt(w, e).rules))
  const newStandards = to.standards
    .filter((s) => !from.standards.includes(s))
    .map((e) => standardAt(w, e))
  const newRules = newStandards.flatMap((s) =>
    s.rules.filter((r) => !oldRules.has(r)).map((r) => ruleAt(w, r)),
  )
  const added = [
    ...(to.says !== from.says ? [to.says] : []),
    ...newStandards.map((s) => s.says),
    ...newRules.map((r) => r.says),
  ]
  return added.length > 0 ? added : [`${directionAt(w, d).name} changed`]
}
// The draft becomes the next version (version 1 of a new direction). Each new text of a later
// version becomes a lesson that later tasks can find.
export const makeVersion = (b: Build, draft: RevisionId, when: Time): void => {
  const w = b.work
  const x = draftAt(w, draft)
  const d = directionAt(w, x.of)
  const from = d._tag === 'Official' ? currentOf(w, d.id) : undefined
  const version = {
    of: d.id,
    number: ((from?.number ?? 0) + 1) as PositiveInt,
    says: x.says,
    standards: x.standards,
    revision: draft,
    when,
  }
  b.work = { ...w, directions: put(w.directions, d.id, Moves.makeOfficial(d, version)) }
  b.created.push(versionId(d.id, version.number))
  if (from === undefined) return
  for (const text of lessonsOf(b.work, d.id, contentOf(from), contentOf(version))) {
    const id = b.name('note')
    const rule = versionId(d.id, version.number)
    const lesson = { _tag: 'Lesson' as const, id, from: x.answers, text, rule, when }
    b.work = { ...b.work, notes: put(b.work.notes, id, lesson) }
  }
}

// --- suggestions ---------------------------------------------------------------------------------

// Feedback in words about a direction, a standard, or a rule of an official version now.
const suggestionAbout = (w: Work, about: EventOf<'Suggestion.Suggestion'>['create']['about']) => {
  switch (about._tag) {
    case 'NewDirection':
      return { _tag: 'NewDirection' } as const
    case 'Direction':
      return { _tag: 'Direction', direction: about.direction } as const
    case 'Standard': {
      for (const x of w.directions.values()) {
        if (x._tag !== 'Official') continue
        const s = currentOf(w, x.id)
          .standards.map((e) => w.standards.get(e))
          .find((s) => s?.id === about.key)
        if (s) return { _tag: 'Standard', standard: s.entry } as const
      }
      return undefined
    }
    case 'Rule': {
      const rule = findRule(w, about.key)
      return rule === undefined ? undefined : ({ _tag: 'Rule', rule: rule.entry } as const)
    }
  }
}
export const suggested = (
  work: Work,
  e: EventOf<'Suggestion.Suggestion'>,
  act: Act,
  r: Seq,
): Stepped =>
  built(work, (b) => {
    const d = e.create
    const about = suggestionAbout(b.work, d.about) ?? damaged(r, 'a suggestion about nothing')
    const id = b.name('suggestion')
    const suggestion = { id, about, says: d.says, by: act.by, when: act.when, at: b.tick() }
    b.work = { ...b.work, suggestions: put(b.work.suggestions, id, suggestion) }
  })
