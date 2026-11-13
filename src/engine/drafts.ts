// The drafts of directions: buildStandard, the handlers direction.new, direction.revise and
// company.import, draftStandards, writeDraft and the answer checks. A draft is built the same way
// for its check and for its apply: the guard refuses at the first problem (the check) or lets the
// build go on (the apply). Each standard and rule is its own entry: a kept one keeps its entry, a
// new one is named after the draft that made it (d3/facts-not-proof,
// d3/facts-not-proof/no-ticket-ids).
import { type Human, human } from '../domain/actor.ts'
import { whereOf } from '../domain/context.ts'
import {
  checkerProblem,
  type CompanyCheckers,
  type CompanyFolder,
  type DirectionFile,
  type ExternalSource,
  type ReviseFile,
  type StandardFile,
} from '../domain/files.ts'
import {
  type AnswerId,
  type DirectionId,
  type PositiveInt,
  type RevisionId,
  type RoleName,
  type RuleEntry,
  type StandardEntry,
  type Time,
  versionId,
} from '../domain/ids.ts'
import type {
  By,
  Deciders,
  Direction,
  Limit,
  Principle,
  Reviser,
  Revision,
  RevisionOrigin,
  Rule,
  Standard,
  Suggestion,
  Why,
} from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import { decidersOf, decidersProblem, leavesOf } from './deciders.ts'
import { found, type Guard } from './guard.ts'
import {
  type Content,
  contentOf,
  isPersonStop,
  madeBy,
  rulesUnder,
  sameFor,
  sameChecker,
  sameProposal,
  sameRule,
  sameWords,
  stopRefAnswered,
} from './queries.ts'
import {
  currentOf,
  directionAt,
  draftAt,
  isPerson,
  type Item,
  itemAt,
  officialAt,
  reviewItems,
  ruleAt,
  standardAt,
  taskAt,
  taskOfTarget,
} from './view.ts'

// The standards and rules that a draft makes, before the Work holds them.
export interface Scratch {
  readonly standards: Map<StandardEntry, Standard>
  readonly rules: Map<RuleEntry, Rule>
}
const scratchOf = (): Scratch => ({ standards: new Map(), rules: new Map() })
export const withScratch = (w: Work, s: Scratch): Work =>
  s.standards.size + s.rules.size === 0
    ? w
    : {
        ...w,
        standards: new Map([...w.standards, ...s.standards]),
        rules: new Map([...w.rules, ...s.rules]),
      }

const limitOf = (n: number | undefined): Limit =>
  n === undefined ? { _tag: 'Unlimited' } : { _tag: 'AtMost', max: n as PositiveInt }
const contentOfDraft = (x: Revision<Direction>): Content => ({
  of: x.of,
  number: null,
  says: x.says,
  standards: x.standards,
})

// --- what a draft answers ---------------------------------------------------------------------

// A Reject by all its points, one point, a Reject of a draft, or a suggestion.
export type Answer =
  | { readonly _tag: 'Item'; readonly item: Item }
  | { readonly _tag: 'Suggestion'; readonly suggestion: Suggestion }
export const answersNamed = (
  w: Work,
  ids: ReadonlyArray<string>,
  guard: Guard,
): ReadonlyArray<Answer> =>
  ids.flatMap((id): ReadonlyArray<Answer> => {
    const points = reviewItems(w).filter((i) => i.group === id)
    if (points.length > 0) return points.map((item) => ({ _tag: 'Item', item }))
    const f = found(w, id, ['v', 's'], guard)
    if (f?._tag === 'Suggestion') return [{ _tag: 'Suggestion', suggestion: f.suggestion }]
    const item = f === undefined ? undefined : itemAt(w, id)
    return item ? [{ _tag: 'Item', item }] : []
  })
// A Reject (one of its points, or a Reject of a draft) or a suggestion. A recheck or a resolve is
// no Reject record, so a draft does not answer it (the replay names only Rejects).
const isAnswer = (a: Answer): boolean =>
  a._tag === 'Suggestion' || (a.item.decision === 'Reject' && a.item.review._tag === 'Reject')
const answerId = (a: Answer): string => (a._tag === 'Suggestion' ? a.suggestion.id : a.item.id)

// A suggestion is answered at its level: one about a rule by a change of its standard, one about
// a standard by a change of that standard, one about a direction by a change of what it says.
const suggestionAnswered = (
  w: Work,
  s: Suggestion,
  from: Content,
  to: Content,
): string | undefined => {
  const words = `"${s.says}"`
  const name = directionAt(w, from.of).name
  const about = s.about
  if (about._tag === 'NewDirection') {
    return `${words} asks for a new direction; a draft of ${name} does not answer it`
  }
  if (about._tag === 'Direction') {
    if (about.direction !== from.of) {
      return `${words} is about ${directionAt(w, about.direction).name}, not ${name}`
    }
    return to.says === from.says
      ? `${words} is about ${name} itself; a change of what it says answers it`
      : undefined
  }
  const target: string = about._tag === 'Standard' ? about.standard : about.rule
  const says =
    about._tag === 'Standard' ? standardAt(w, about.standard).says : ruleAt(w, about.rule).says
  const holder = from.standards.find(
    (e) => e === target || standardAt(w, e).rules.includes(target as RuleEntry),
  )
  if (holder === undefined) {
    return `${words} is about "${says}", which is not in ${name} v${from.number}`
  }
  if (to.standards.includes(holder)) {
    return holder === target
      ? `a suggestion about the standard "${says}" is answered by a change of that standard`
      : `a suggestion about the rule "${says}" is answered by a change of its standard`
  }
  return undefined
}
// A Reject of a result or a task is answered only by a real change in a direction that its task
// follows. A point that names a rule is answered by changed work with evidence.
const rejectAnswered = (w: Work, r: Item, from: Content, to: Content): string | undefined => {
  const reason = r.reason ?? ''
  const task = taskOfTarget(w, r.of)
  if (task === undefined) return `"${reason}" is not a Reject of a result or a task`
  if (isPersonStop(w, r) && !stopRefAnswered(w, { _tag: 'Item', item: r, at: r.at })) {
    return (
      `"${reason}" waits for an evaluation of ${task} first: what is wrong, why, and what ` +
      `to improve`
    )
  }
  const breaks = r.breaks
  if (
    breaks !== undefined &&
    rulesUnder(w, task, from, to).some((x) => sameRule(ruleAt(w, x), ruleAt(w, breaks)))
  ) {
    return (
      `"${reason}" names the rule ${ruleAt(w, breaks).id}; changed work with evidence ` +
      `answers it, not a direction change`
    )
  }
  const name = directionAt(w, from.of).name
  const t = taskAt(w, task)
  if (!t.descriptionAi.directions.includes(from.of)) {
    return `${name} is not a direction of ${t.name}, so it cannot answer "${reason}"`
  }
  // The change must say something new to this task.
  if (sameFor(w, to, from, task)) {
    return (
      `this change of ${name} says the same to ${task} as before, so it cannot answer ` +
      `"${reason}"`
    )
  }
  return undefined
}
// A Reject of an earlier draft of this direction is answered by a draft that proposes something
// else.
const draftRejectAnswered = (w: Work, r: Item, from: Content, to: Content): string | undefined => {
  const reason = r.reason ?? ''
  const rejected = draftAt(w, r.of.id as RevisionId)
  if (rejected.of !== from.of) {
    return (
      `"${reason}" rejects a draft of ${directionAt(w, rejected.of).name}, not of ` +
      `${directionAt(w, from.of).name}`
    )
  }
  if (sameProposal(w, to, contentOfDraft(rejected))) {
    return `this draft proposes the same as ${rejected.id}, so it cannot answer "${reason}"`
  }
  return undefined
}

// --- standards ----------------------------------------------------------------------------------

// Who checks a rule: the role that it names, else the decider of the result. A program checks
// only the rules that name it.
const checkerOf = (
  w: Work,
  id: string,
  checkedBy: string | undefined,
  guard: Guard,
): Rule['checkedBy'] => {
  const roles = w.config.roles
  const program = Object.entries(roles).find(
    ([n, x]) => x.kind === 'program' && x.checks.includes(id) && n !== checkedBy,
  )
  if (program) {
    guard(
      `aristoteles.yaml roles.${program[0]} checks ${id}, but that rule is not checkedBy ` +
        `${program[0]}`,
    )
  }
  if (checkedBy === undefined) return { _tag: 'Decider' }
  guard(checkerProblem(roles, id, checkedBy) ?? undefined)
  return { _tag: 'Role', role: checkedBy as RoleName }
}

// A rule with the same id, words, and checker as a rule of an earlier
// version of the direction is that rule (its evidence and its open points stay), also when an
// earlier version removed it; any other rule is new. supersedes names rules of the base.
const buildStandard = (
  w: Work,
  file: StandardFile,
  base: Content | undefined,
  entry: StandardEntry,
  scratch: Scratch,
  guard: Guard,
): Standard => {
  const official = base === undefined ? undefined : officialAt(w, base.of)
  const rulesIn = (entries: ReadonlyArray<StandardEntry>) =>
    entries.flatMap((e) => standardAt(w, e).rules.map((r) => ruleAt(w, r)))
  const older = (official?.versions ?? []).flatMap((v) => rulesIn(v.standards))
  const baseRules = rulesIn(base?.standards ?? [])
  const rules = file.rules.map((r): RuleEntry => {
    if (r.supersedes.includes(r.id)) {
      guard(
        `rule ${r.id} supersedes itself; a changed rule keeps its id, and supersedes names other ` +
          `rules`,
      )
    }
    const checkedBy = checkerOf(w, r.id, r.checkedBy, guard)
    const same = older.findLast(
      (x) => x.id === r.id && x.says === r.says && sameChecker(x.checkedBy, checkedBy),
    )
    if (same && r.supersedes.length === 0) return same.entry
    const supersedes = r.supersedes.flatMap((id) => {
      const old = baseRules.find((x) => x.id === id)
      if (!old) guard(`rule ${r.id} supersedes "${id}", which is not in the current version`)
      return old ? [old.entry] : []
    })
    const ruleEntry = `${entry}/${r.id}` as RuleEntry
    scratch.rules.set(ruleEntry, {
      entry: ruleEntry,
      id: r.id,
      says: r.says,
      checkedBy,
      supersedes,
    })
    return ruleEntry
  })
  return { entry, id: file.id, says: file.says, where: whereOf(file.where), rules }
}
const entryIn = (draft: RevisionId, key: string) => `${draft}/${key}` as StandardEntry

interface Edit {
  readonly add: ReadonlyArray<Standard>
  readonly remove: ReadonlyArray<string>
  readonly replace: ReadonlyArray<readonly [string, Standard]>
}
// The base, with the edit. A new rule can supersede older rules: they
// leave the draft, and a standard that loses one is a new standard of this draft.
const draftStandards = (
  w: Work,
  d: { readonly id: DirectionId; readonly name: string; readonly maxStandards: Limit },
  baseEntries: ReadonlyArray<StandardEntry>,
  edit: Edit,
  scratch: Scratch,
  draft: RevisionId,
  guard: Guard,
): ReadonlyArray<StandardEntry> => {
  const base = baseEntries.map((e) => standardAt(w, e))
  const keys = base.map((s) => s.id)
  for (const key of [...edit.remove, ...edit.replace.map(([old]) => old)]) {
    if (!keys.includes(key)) guard(`${d.name} has no standard "${key}"`)
  }
  for (const s of edit.add) {
    if (keys.includes(s.id)) guard(`${d.name} already has the standard "${s.id}"`)
  }
  const replacement = new Map(edit.replace)
  let standards: ReadonlyArray<Standard> = [
    ...base.filter((s) => !edit.remove.includes(s.id)).map((s) => replacement.get(s.id) ?? s),
    ...edit.add,
  ]
  // A rule id names one rule in the project: a new rule takes no id that another rule has.
  const wx = withScratch(w, scratch)
  const oldRules = new Set(base.flatMap((s) => s.rules))
  const all = standards.flatMap((s) => s.rules)
  const others = [...w.directions.values()]
    .filter((x) => x._tag === 'Official' && x.id !== d.id)
    .flatMap((x) => currentOf(w, x.id).standards.flatMap((e) => standardAt(w, e).rules))
  const seen = new Set(
    [...all.filter((r) => oldRules.has(r)), ...others].map((r) => ruleAt(wx, r).id),
  )
  for (const r of all) {
    if (oldRules.has(r)) continue
    const id = ruleAt(wx, r).id
    if (seen.has(id)) guard(`the rule id "${id}" is already used; a new rule needs a new id`)
    seen.add(id)
  }
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
  if (d.maxStandards._tag === 'AtMost' && standards.length > d.maxStandards.max) {
    guard(
      `${d.name} would have ${standards.length} standards; the limit is ${d.maxStandards.max}: ` +
        `remove or merge one, or move some to a new direction (work guide limits)`,
    )
  }
  // The new standards go in, with only the rules that they hold.
  const fresh = standards.filter((s) => !w.standards.has(s.entry))
  for (const s of fresh) scratch.standards.set(s.entry, s)
  const held = new Set(fresh.flatMap((s) => s.rules))
  for (const e of [...scratch.rules.keys()]) if (!held.has(e)) scratch.rules.delete(e)
  return standards.map((s) => s.entry)
}

// --- the three kinds of draft --------------------------------------------------------------------

// A draft, built: the direction as the draft leaves it (a new one, or the same), and the new
// standards and rules.
export interface Planned {
  readonly direction: Direction
  readonly revision: Revision<Direction>
  readonly scratch: Scratch
}
// What every draft has, for its record.
export interface DraftOf {
  readonly id: RevisionId
  readonly when: Time
  readonly at: number
}

// A model writes each draft: an assignment, or a run outside any task (the check refuses the
// person before this).
const reviserOf = (by: By): Reviser => {
  if (typeof by === 'string' || by._tag === 'Agent') return by
  throw new Error(`the person ${by.name} writes no draft`)
}

// A new direction, or another draft of a direction that
// has no version yet (after a Reject); the whole direction, with no base.
const fresh = (
  w: Work,
  x: DraftOf,
  input: {
    readonly id: DirectionId
    readonly name: string
    readonly owner: Human
    readonly from: ReadonlyArray<Principle>
    readonly maxStandards: Limit
    readonly approvedBy: Deciders | undefined
    readonly source: Direction['source']
    readonly says: string
    readonly add: ReadonlyArray<Standard>
    readonly answers: ReadonlyArray<Answer>
    readonly answerIds: ReadonlyArray<AnswerId>
    readonly why: Why
    readonly origin: RevisionOrigin
  },
  scratch: Scratch,
  guard: Guard,
): Planned => {
  const existing = w.directions.get(input.id)
  const { name, owner, approvedBy } = input
  if (input.answers.some((a) => !isAnswer(a))) guard('a draft answers Rejects and suggestions only')
  if (existing !== undefined && existing.owner.name !== owner.name) {
    guard(`${existing.name} is ${existing.owner.name}'s; another draft of it keeps its owner`)
  }
  const problem = approvedBy && decidersProblem(approvedBy)
  if (problem) guard(`approvedBy of ${name} ${problem}`)
  const stranger =
    approvedBy &&
    leavesOf(approvedBy).find((l): l is Human => l._tag === 'Human' && l.name !== owner.name)
  if (stranger) {
    guard(`approvedBy of ${name} names ${stranger.name}, who is not its owner; the owner approves`)
  }
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
  const standards = draftStandards(
    w,
    direction,
    [],
    { add: input.add, remove: [], replace: [] },
    scratch,
    x.id,
    guard,
  )
  const wx = withScratch(w, scratch)
  for (const a of input.answers) {
    if (a._tag === 'Suggestion') {
      if (a.suggestion.about._tag !== 'NewDirection') {
        guard(
          `"${a.suggestion.says}" is about something that exists; a new direction answers only ` +
            `suggestions that ask for a new direction`,
        )
      }
      continue
    }
    const rejected = a.item.of
    const reason = a.item.reason ?? ''
    if (rejected._tag !== 'Revision' || draftAt(w, rejected.id).of !== input.id) {
      guard(
        `"${reason}" is not a Reject of a draft of ${name}; a new direction answers suggestions ` +
          `for a new direction, and the Rejects of its own drafts`,
      )
      continue
    }
    const proposal: Content = { of: input.id, number: null, says: input.says, standards }
    if (sameProposal(wx, proposal, contentOfDraft(draftAt(w, rejected.id)))) {
      guard(`this draft proposes the same as ${rejected.id}, so it cannot answer "${reason}"`)
    }
  }
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

// The base, with the edit; each answer must be
// answered by this change at its level.
const revised = (
  w: Work,
  x: DraftOf,
  input: {
    readonly direction: Direction
    readonly says: string | undefined
    readonly edit: Edit
    readonly answers: ReadonlyArray<Answer>
    readonly answerIds: ReadonlyArray<AnswerId>
    readonly why: Why
    readonly origin: RevisionOrigin
  },
  scratch: Scratch,
  guard: Guard,
): Planned => {
  const d = input.direction
  const base = contentOf(currentOf(w, d.id))
  if (input.answers.some((a) => !isAnswer(a))) guard('a draft answers Rejects and suggestions only')
  const standards = draftStandards(w, d, base.standards, input.edit, scratch, x.id, guard)
  const to: Content = { of: d.id, number: null, says: input.says ?? base.says, standards }
  const wx = withScratch(w, scratch)
  for (const a of input.answers) {
    if (!isAnswer(a)) continue
    const problem =
      a._tag === 'Suggestion'
        ? suggestionAnswered(wx, a.suggestion, base, to)
        : a.item.of._tag === 'Revision'
          ? draftRejectAnswered(wx, a.item, base, to)
          : rejectAnswered(wx, a.item, base, to)
    guard(problem)
  }
  const revision: Revision<Direction> = {
    _tag: 'Change',
    base: versionId(d.id, base.number ?? 0),
    id: x.id,
    of: d.id,
    says: to.says,
    standards,
    origin: input.origin,
    answers: input.answerIds,
    why: input.why,
    when: x.when,
    at: x.at,
  }
  return { direction: d, revision, scratch }
}

// direction.new: the whole of a new direction, drafted by a model (a high role, or a model run
// outside any task). Another draft of a direction with no version yet answers the Reject of the
// last one.
export const planDrafted = (
  w: Work,
  x: DraftOf,
  data: {
    readonly direction: DirectionFile
    readonly answers: ReadonlyArray<AnswerId>
    readonly why: Why
  },
  by: By,
  guard: Guard,
): Planned => {
  const d = data.direction
  if (officialAt(w, d.id)) {
    guard(
      `${d.id} has a version; a high role revises it: work direction revise <token> ${d.id} ` +
        `--file=<edit.yaml>`,
    )
  }
  const existing = w.directions.get(d.id)
  if (existing?.source._tag === 'External')
    guard(`${d.id} is a company direction; it changes in its repo`)
  const answers = answersNamed(w, data.answers, guard)
  const roles = [...w.workflow.roles.keys()]
  const approvedBy = d.approvedBy === undefined ? undefined : decidersOf(d.approvedBy, roles)
  const scratch = scratchOf()
  const add = d.standards.map((s) =>
    buildStandard(w, s, undefined, entryIn(x.id, s.id), scratch, guard),
  )
  if (isPerson(w, by)) {
    guard(
      `the person gives direction in words, as a suggestion about ${existing?.name ?? d.name}; a ` +
        `high role writes the draft`,
    )
  }
  return fresh(
    w,
    x,
    {
      id: d.id,
      name: d.name,
      owner: human(d.owner),
      from: d.from,
      maxStandards: limitOf(d.maxStandards),
      approvedBy,
      source: { _tag: 'Local' },
      says: d.says,
      add,
      answers,
      answerIds: data.answers,
      why: data.why,
      origin: { _tag: 'Written', by: reviserOf(by) },
    },
    scratch,
    guard,
  )
}

// direction.revise: a draft of a direction, built on its current version.
export const planRevised = (
  w: Work,
  x: DraftOf,
  data: {
    readonly direction: DirectionId
    readonly edit: ReviseFile
    readonly answers: ReadonlyArray<AnswerId>
    readonly why: Why
  },
  by: By,
  guard: Guard,
): Planned | undefined => {
  const id = data.direction
  const official = officialAt(w, id)
  if (official?.source._tag === 'External') {
    const { repo, path } = official.source
    guard(
      `${id} is a company direction from ${repo} (${path}); it changes there, with a pull ` +
        `request. Suggest the change: work suggest <token> ${id} --says="..."`,
    )
  }
  if (official === undefined && w.directions.has(id)) {
    guard(
      `${id} has no version yet; a draft of it is the whole direction: work direction new ` +
        `--file=<direction.yaml>`,
    )
  }
  if (official === undefined) {
    guard(`there is no direction "${id}"`)
    return undefined
  }
  const base = contentOf(currentOf(w, id))
  const answers = answersNamed(w, data.answers, guard)
  const wrong = answers.find((a) => !isAnswer(a))
  if (wrong) {
    guard(
      `${answerId(wrong)} is not a Reject point or a suggestion; --answers takes points ` +
        `(v<n>.<m>, or v<n> for all of them) and suggestions (s<n>)`,
    )
  }
  const scratch = scratchOf()
  const edit = data.edit
  const add = (edit.add ?? []).map((s) =>
    buildStandard(w, s, base, entryIn(x.id, s.id), scratch, guard),
  )
  const replace = (edit.replace ?? []).map(
    (r) =>
      [r.id, buildStandard(w, r.with, base, entryIn(x.id, r.with.id), scratch, guard)] as const,
  )
  if (isPerson(w, by)) {
    guard(
      `the person gives direction in words, as a suggestion about ${official.name}; a high role ` +
        `writes the draft`,
    )
  }
  return revised(
    w,
    x,
    {
      direction: official,
      says: edit.says,
      edit: { add, remove: edit.remove ?? [], replace },
      answers,
      answerIds: data.answers,
      why: data.why,
      origin: { _tag: 'Written', by: reviserOf(by) },
    },
    scratch,
    guard,
  )
}

// company.import: a commit of a company direction comes in as a draft of the whole direction,
// with its source, and only the owner accepts it. The draft is the change from the current
// version: a standard with other words is replaced, a new one added, a gone one removed, so a
// rule with the same words keeps its evidence.
export const planImported = (
  w: Work,
  x: DraftOf,
  data: {
    readonly direction: DirectionId
    readonly source: ExternalSource
    readonly folder: CompanyFolder
    readonly owner: string
    readonly checkers: CompanyCheckers
  },
  guard: Guard,
): Planned => {
  const { direction: id, source, folder, checkers } = data
  const existing = w.directions.get(id)
  if (existing !== undefined && existing.source._tag !== 'External') {
    guard(`${id} is a direction of this dir; a company direction needs another id`)
  }
  const again = [...w.drafts.values()].some(
    (d) =>
      d.of === id &&
      d.origin._tag === 'Imported' &&
      d.origin.commit === source.commit &&
      madeBy(w, d.id) === undefined,
  )
  if (again) guard(`commit ${source.commit.slice(0, 7)} of ${id} is in already`)
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
    const add = files.map((s) =>
      buildStandard(w, s, undefined, entryIn(x.id, s.id), scratch, guard),
    )
    return fresh(
      w,
      x,
      {
        id,
        name: folder.name,
        owner: human(data.owner),
        from: [],
        maxStandards: { _tag: 'Unlimited' },
        approvedBy: undefined,
        source: { _tag: 'External', repo: source.repo, path: source.path },
        says: folder.says,
        add,
        answers: [],
        answerIds: [],
        why,
        origin,
      },
      scratch,
      guard,
    )
  }
  const base = contentOf(currentOf(w, id))
  const built = files.map((s) => buildStandard(w, s, base, entryIn(x.id, s.id), scratch, guard))
  const wx = withScratch(w, scratch)
  const was = base.standards.map((e) => standardAt(w, e))
  const edit: Edit = {
    add: built.filter((s) => !was.some((y) => y.id === s.id)),
    replace: built
      .filter((s) => was.some((y) => y.id === s.id && !sameWords(wx, y, s)))
      .map((s) => [s.id, s] as const),
    remove: was.filter((y) => !built.some((s) => s.id === y.id)).map((y) => y.id),
  }
  return revised(
    w,
    x,
    { direction: official, says: folder.says, edit, answers: [], answerIds: [], why, origin },
    scratch,
    guard,
  )
}

// The lessons of a new version: each new text of it (what it says, a new standard, a new rule
// of a new standard), or that the direction changed.
export const lessonsOf = (
  w: Work,
  d: DirectionId,
  from: Content,
  to: Content,
): ReadonlyArray<string> => {
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
