// The content checks of a draft of a direction: the rules and the standards of its file, the
// answers that it names, and the commit of a company import. The checks run in the old order, and
// the first problem is the refusal, with a real choice. Who drafts, a company direction and a
// direction with no version are canAct's.
import { Effect } from 'effect'
import type { Derived } from '../derived/index.ts'
import {
  directionAt,
  draftAt,
  officialAt,
  type Rejection,
  rejectionAt,
  ruleAt,
  standardAt,
} from '../derived/reads.ts'
import type { Refusal } from '../schema/errors.ts'
import {
  type AnswerId,
  type Author,
  checkerProblem,
  create,
  type Direction,
  type DirectionId,
  type EventOf,
  type Limit,
  lookup,
  type PositiveInt,
  type Recorded,
  type Revision,
  type RoleName,
  type Rule,
  type RuleEntry,
  type StandardEntry,
  type Suggestion,
  usesProblem,
  type Work,
} from '../schema/index.ts'
import { foldStep } from '../state/index.ts'
import {
  type Content,
  contentNow,
  sameChecker,
  sameWords,
} from '../state/versions.ts'
import { asPick, no, type RefusalsOf } from './support.ts'

export const DRAFT = {
  // --- the answers ---
  notAnswer: (id: string) =>
    no(
      `${id} is not a Reject of a draft or a suggestion; --answers takes Rejects (v<n>) and ` +
        'suggestions (s<n>)',
      'Pick',
      'answer a Reject of a draft or a suggestion',
    ),
  onlyAnswers: () =>
    no(
      'a draft answers Rejects of drafts and suggestions only',
      'Pick',
      'answer the Rejects of drafts and the suggestions that the draft changes',
    ),
  // --- the rules of a standard ---
  supersedesItself: (rule: string) =>
    no(
      `rule ${rule} supersedes itself; a changed rule keeps its id, and supersedes names other ` +
        'rules',
      'Write',
      `take ${rule} out of its own supersedes`,
    ),
  programChecks: (program: string, rule: string) =>
    no(
      `aristoteles.yaml roles.${program} checks ${rule}, but that rule is not checkedBy ${program}`,
      'Write',
      `write checkedBy: ${program} on the rule ${rule}`,
    ),
  checker: (problem: string, rule: string) =>
    no(problem, 'Write', `name in checkedBy of ${rule} a role that reviews or approves the maker`),
  supersedesMissing: (rule: string, id: string) =>
    no(
      `rule ${rule} supersedes "${id}", which is not in the current version`,
      'Write',
      `name in supersedes of ${rule} only rules of the current version`,
    ),
  // --- the standards ---
  noStandard: (name: string, key: string) =>
    no(`${name} has no standard "${key}"`, 'Pick', `name a standard that ${name} has`),
  hasStandard: (name: string, key: string) =>
    no(
      `${name} already has the standard "${key}"`,
      'Pick',
      `replace "${key}", or add the standard with a new id`,
    ),
  ruleIdUsed: (id: string) =>
    no(
      `the rule id "${id}" is already used; a new rule needs a new id`,
      'Write',
      `give the new rule an id other than "${id}"`,
    ),
  tooMany: (name: string, count: string, max: string) =>
    no(
      `${name} would have ${count} standards; the limit is ${max}: remove or merge one, or ` +
        'move some to a new direction (work guide limits)',
      'Write',
      'remove or merge a standard, or move some to a new direction',
    ),
  ownerKept: (name: string, owner: string) =>
    no(
      `${name} is ${owner}'s; another draft of it keeps its owner`,
      'Write',
      `write ${owner} as the owner of ${name}`,
    ),
  // --- what a new direction answers ---
  aboutExisting: (says: string) =>
    no(
      `"${says}" is about something that exists; a new direction answers only suggestions that ` +
        'ask for a new direction',
      'Pick',
      'answer it with a revise of what it is about',
    ),
  notOwnReject: (reason: string, name: string) =>
    no(
      `"${reason}" is not a Reject of a draft of ${name}; a new direction answers suggestions ` +
        'for a new direction, and the Rejects of its own drafts',
      'Pick',
      `answer the suggestions for a new direction, or the Rejects of drafts of ${name}`,
    ),
  sameProposal: (draft: string, reason: string) =>
    no(
      `this draft proposes the same as ${draft}, so it cannot answer "${reason}"`,
      'Write',
      `write a draft that proposes something other than ${draft}`,
    ),
  // --- what a change answers ---
  otherDirection: (reason: string, other: string, name: string) =>
    no(
      `"${reason}" rejects a draft of ${other}, not of ${name}`,
      'Pick',
      `answer a Reject of a draft of ${name}`,
    ),
  asksNew: (words: string, name: string) =>
    no(
      `${words} asks for a new direction; a draft of ${name} does not answer it`,
      'Pick',
      'draft a new direction for it',
    ),
  aboutOther: (words: string, other: string, name: string) =>
    no(`${words} is about ${other}, not ${name}`, 'Pick', `revise ${other} for it`),
  aboutSpirit: (words: string, name: string) =>
    no(
      `${words} is about ${name} itself; a change of what it says answers it`,
      'Write',
      `change what ${name} says`,
    ),
  notInVersion: (words: string, says: string, name: string, n: string) =>
    no(
      `${words} is about "${says}", which is not in ${name} v${n}`,
      'Pick',
      `answer it with a revise of the direction that has "${says}"`,
    ),
  standardKept: (says: string) =>
    no(
      `a suggestion about the standard "${says}" is answered by a change of that standard`,
      'Write',
      `change the standard "${says}"`,
    ),
  ruleKept: (says: string) =>
    no(
      `a suggestion about the rule "${says}" is answered by a change of its standard`,
      'Write',
      `change the standard of the rule "${says}"`,
    ),
  aboutRoles: (words: string) =>
    no(
      `${words} is about the roles; a draft of a direction does not answer it`,
      'Pick',
      'leave it for the person to settle in the roles',
    ),
  uses: (problem: string) =>
    no(problem, 'Write', 'give uses: only the ids of the direction, its standards and its rules'),
  // --- a company commit ---
  localId: (id: string) =>
    no(
      `${id} is a direction of this dir; a company direction needs another id`,
      'Pick',
      'give the company direction another id',
    ),
  inAlready: (commit: string, id: string) =>
    no(
      `commit ${commit} of ${id} is in already`,
      'Wait',
      `a newer commit of ${id} comes in as a new draft`,
    ),
} satisfies RefusalsOf

const fail = (r: Refusal): Effect.Effect<never, Refusal> => Effect.fail(r)

// Checks in their order, as the old engine's guard ran them: the first problem is the refusal.
type Guard = (problem: Refusal | undefined) => void
const firstOf = (checks: (guard: Guard) => void): Refusal | undefined => {
  let found: Refusal | undefined
  checks((problem) => {
    found ??= problem
  })
  return found
}
const failIf = (r: Refusal | undefined): Effect.Effect<void, Refusal> =>
  r === undefined ? Effect.void : fail(r)

// --- the answers ---------------------------------------------------------------------------------

// What an id of --answers names: a Reject of a draft, or a suggestion. Any other id (an accept)
// is none: a draft does not answer it.
type Answer =
  | { readonly _tag: 'Reject'; readonly reject: Rejection }
  | { readonly _tag: 'Suggestion'; readonly suggestion: Suggestion }
  | { readonly _tag: 'Other'; readonly id: string }
const answersOf = (w: Work, ids: ReadonlyArray<AnswerId>): ReadonlyArray<Answer> =>
  ids.flatMap((id): ReadonlyArray<Answer> => {
    const suggestion = w.suggestions.get(id as never)
    if (suggestion !== undefined) return [{ _tag: 'Suggestion', suggestion }]
    const reject = rejectionAt(w, id)
    return [reject === undefined ? { _tag: 'Other', id } : { _tag: 'Reject', reject }]
  })
const isAnswer = (a: Answer): boolean => a._tag !== 'Other'
const answerId = (a: Answer): string =>
  a._tag === 'Suggestion' ? a.suggestion.id : a._tag === 'Reject' ? a.reject.id : a.id

// Each id names a record (the words of lookup).
export const answersFound = (w: Work, ids: ReadonlyArray<AnswerId>) =>
  Effect.forEach(ids, (id) => lookup(w, id, ['v', 's']).pipe(Effect.mapError(asPick)), {
    discard: true,
  })
// --- the rules and the standards of a file ----------------------------------------------------

interface RuleOfFile {
  readonly id: string
  readonly says: string
  readonly checkedBy?: string | undefined
  readonly test?: string | undefined
  readonly ref?: string | undefined
  readonly supersedes: ReadonlyArray<string>
}
interface StandardOfFile {
  readonly id: string
  readonly rules: ReadonlyArray<RuleOfFile>
}
// A rule as the draft holds it: a rule with the id, the words and the checker of an earlier
// version keeps that rule's entry (its evidence and its open points stay); any other is new.
interface Built {
  readonly id: string
  readonly entry: RuleEntry | undefined
}
type Roles = Work['config']['roles']

// Who checks a rule: the role that it names, else the decider of the result. A program checks
// only the rules that name it.
const checkerOf = (
  roles: Roles,
  id: string,
  checkedBy: string | undefined,
  guard: Guard,
): Rule['checkedBy'] => {
  const program = Object.entries(roles).find(
    ([n, x]) => x.kind === 'program' && x.checks.some((c) => c === id) && n !== checkedBy,
  )
  if (program !== undefined) guard(DRAFT.programChecks(program[0], id))
  if (checkedBy === undefined) return { _tag: 'Decider' }
  const problem = checkerProblem(roles, id, checkedBy)
  if (problem !== null) guard(DRAFT.checker(problem, id))
  return { _tag: 'Role', role: checkedBy as RoleName }
}

// The rules of one standard of a file (the old buildStandard); supersedes names rules of the base.
const rulesOfFile = (
  w: Work,
  roles: Roles,
  file: StandardOfFile,
  base: Content | undefined,
  guard: Guard,
): ReadonlyArray<Built> => {
  const official = base === undefined ? undefined : officialAt(w, base.of)
  const rulesIn = (entries: ReadonlyArray<StandardEntry>) =>
    entries.flatMap((e) => standardAt(w, e).rules.map((r) => ruleAt(w, r)))
  const older = (official?.versions ?? []).flatMap((v) => rulesIn(v.standards))
  const baseRules = rulesIn(base?.standards ?? [])
  return file.rules.map((r): Built => {
    if (r.supersedes.includes(r.id)) guard(DRAFT.supersedesItself(r.id))
    const checkedBy = checkerOf(roles, r.id, r.checkedBy, guard)
    const same = older.findLast(
      (x) =>
        x.id === r.id &&
        x.says === r.says &&
        x.test === r.test &&
        x.ref === r.ref &&
        sameChecker(x.checkedBy, checkedBy),
    )
    if (same && r.supersedes.length === 0) return { id: r.id, entry: same.entry }
    for (const id of r.supersedes) {
      if (!baseRules.some((x) => x.id === id)) guard(DRAFT.supersedesMissing(r.id, id))
    }
    return { id: r.id, entry: undefined }
  })
}

interface Edit {
  readonly add: ReadonlyArray<{ readonly id: string; readonly rules: ReadonlyArray<Built> }>
  readonly remove: ReadonlyArray<string>
  readonly replace: ReadonlyArray<{ readonly id: string; readonly rules: ReadonlyArray<Built> }>
}
interface Drafted {
  readonly id: DirectionId
  readonly name: string
  readonly maxStandards: Limit
}
// The standards of the draft (the old draftStandards): the keys that the edit names, one rule per
// rule id in the project (S7 refuses a twin of another open draft at its accept), the limit.
const standardChecks = (
  w: Work,
  d: Drafted,
  baseEntries: ReadonlyArray<StandardEntry>,
  edit: Edit,
  guard: Guard,
): void => {
  const base = baseEntries.map((e) => standardAt(w, e))
  const keys = base.map((s) => s.id)
  for (const key of [...edit.remove, ...edit.replace.map((r) => r.id)]) {
    if (!keys.includes(key)) guard(DRAFT.noStandard(d.name, key))
  }
  for (const s of edit.add) if (keys.includes(s.id)) guard(DRAFT.hasStandard(d.name, s.id))
  // Each rule of the draft by its id, and whether it is a rule of the base.
  const oldRules = new Set(base.flatMap((s) => s.rules))
  const ofFile = (rules: ReadonlyArray<Built>) =>
    rules.map((r) => ({ id: r.id, old: r.entry !== undefined && oldRules.has(r.entry) }))
  const replacement = new Map(edit.replace.map((r) => [r.id, ofFile(r.rules)] as const))
  const standards = [
    ...base
      .filter((s) => !edit.remove.includes(s.id))
      .map(
        (s) => replacement.get(s.id) ?? s.rules.map((e) => ({ id: ruleAt(w, e).id, old: true })),
      ),
    ...edit.add.map((s) => ofFile(s.rules)),
  ]
  const others = [...w.directions.values()]
    .filter((x) => x._tag === 'Official' && x.id !== d.id)
    .flatMap((x) =>
      contentNow(w, x.id).standards.flatMap((e) =>
        standardAt(w, e).rules.map((r) => ruleAt(w, r).id),
      ),
    )
  const all = standards.flat()
  const seen = new Set([...all.filter((r) => r.old).map((r) => r.id), ...others])
  for (const r of all) {
    if (r.old) continue
    if (seen.has(r.id)) guard(DRAFT.ruleIdUsed(r.id))
    seen.add(r.id)
  }
  const max = d.maxStandards
  if (max._tag === 'AtMost' && standards.length > max.max) {
    guard(DRAFT.tooMany(d.name, String(standards.length), String(max.max)))
  }
}
const limitOf = (n: PositiveInt | undefined): Limit =>
  n === undefined ? { _tag: 'Unlimited' } : { _tag: 'AtMost', max: n }

// --- what a draft answers ------------------------------------------------------------------------

const contentOfDraft = (x: Revision<Direction>): Content => ({
  of: x.of,
  number: null,
  says: x.says,
  standards: x.standards,
})
const sameProposal = (w: Work, x: Content, y: Content): boolean =>
  x.says === y.says &&
  x.standards.length === y.standards.length &&
  x.standards.every((s) =>
    y.standards.some((t) => sameWords(w, standardAt(w, s), standardAt(w, t))),
  )
// A suggestion is answered at its level: one about a rule by a change of its standard, one about
// a standard by a change of that standard, one about a direction by a change of what it says.
const suggestionAnswered = (
  w: Work,
  s: Suggestion,
  from: Content,
  to: Content,
): Refusal | undefined => {
  const words = `"${s.says}"`
  const name = directionAt(w, from.of).name
  const about = s.about
  if (about._tag === 'NewDirection') return DRAFT.asksNew(words, name)
  if (about._tag === 'Roles') return DRAFT.aboutRoles(words)
  if (about._tag === 'Direction') {
    if (about.direction !== from.of) {
      return DRAFT.aboutOther(words, directionAt(w, about.direction).name, name)
    }
    return to.says === from.says ? DRAFT.aboutSpirit(words, name) : undefined
  }
  const target: string = about._tag === 'Standard' ? about.standard : about.rule
  const says =
    about._tag === 'Standard' ? standardAt(w, about.standard).says : ruleAt(w, about.rule).says
  const holder = from.standards.find(
    (e) => e === target || standardAt(w, e).rules.some((r) => r === target),
  )
  if (holder === undefined) return DRAFT.notInVersion(words, says, name, String(from.number))
  if (to.standards.includes(holder)) {
    return holder === target ? DRAFT.standardKept(says) : DRAFT.ruleKept(says)
  }
  return undefined
}
// A Reject of an earlier draft of this direction is answered by a draft that proposes another.
const draftRejectAnswered = (
  w: Work,
  r: Rejection,
  from: Content,
  to: Content,
): Refusal | undefined => {
  const rejected = draftAt(w, r.draft)
  if (rejected.of !== from.of) {
    const other = directionAt(w, rejected.of).name
    return DRAFT.otherDirection(r.reason, other, directionAt(w, from.of).name)
  }
  return sameProposal(w, to, contentOfDraft(rejected))
    ? DRAFT.sameProposal(rejected.id, r.reason)
    : undefined
}

// The Work with the draft that an event makes, and that draft: the fold builds its standards.
const withDraft = (d: Derived, by: Author, event: ReturnType<typeof create<'Revision'>>) => {
  const w = d.moment.work
  const seq = (w.events.at(-1)?.recorded.seq ?? 0) + 1
  const stepped = foldStep(w, { seq, at: d.moment.at, author: by, event } as Recorded)
  const draft = [...stepped.work.drafts.values()].at(-1)
  return { work: stepped.work, draft }
}

// --- the three kinds of draft --------------------------------------------------------------------

// A new direction, or another draft of a direction with no version (the old planDrafted and
// fresh). The engine's checks of approvedBy are readApprovedBy's, which runs first.
export const checkDrafted = (
  d: Derived,
  by: Author,
  data: Omit<EventOf<'Revision.Drafted'>['create'], '_tag'>,
): Effect.Effect<void, Refusal> => {
  const w = d.moment.work
  const file = data.direction
  const answers = answersOf(w, data.answers)
  const existing = w.directions.get(file.id)
  const problem = firstOf((guard) => {
    const add = file.standards.map((s) => ({
      id: s.id,
      rules: rulesOfFile(w, w.config.roles, s, undefined, guard),
    }))
    if (answers.some((a) => !isAnswer(a))) guard(DRAFT.onlyAnswers())
    if (existing !== undefined && existing.owner.name !== file.owner) {
      guard(DRAFT.ownerKept(existing.name, existing.owner.name))
    }
    const drafted = { id: file.id, name: file.name, maxStandards: limitOf(file.maxStandards) }
    standardChecks(w, drafted, [], { add, remove: [], replace: [] }, guard)
  })
  if (problem !== undefined || answers.length === 0) return failIf(problem)
  const proposed = create('Revision', { _tag: 'Drafted', ...data })
  const { work, draft } = withDraft(d, by, proposed)
  if (draft === undefined) return Effect.void
  const to = contentOfDraft(draft)
  for (const a of answers) {
    if (a._tag === 'Suggestion') {
      if (a.suggestion.about._tag !== 'NewDirection') {
        return fail(DRAFT.aboutExisting(a.suggestion.says))
      }
      continue
    }
    if (a._tag !== 'Reject') continue
    const { draft: of, reason } = a.reject
    if (draftAt(w, of).of !== file.id) return fail(DRAFT.notOwnReject(reason, file.name))
    if (sameProposal(work, to, contentOfDraft(draftAt(w, of)))) {
      return fail(DRAFT.sameProposal(of, reason))
    }
  }
  return Effect.void
}

// A draft of a direction built on its current version (the old planRevised and revised): each
// open answer must be answered by this change at its level.
export const checkRevised = (
  d: Derived,
  by: Author,
  data: Omit<EventOf<'Revision.Revised'>['create'], '_tag'>,
): Effect.Effect<void, Refusal> => {
  const w = d.moment.work
  const official = officialAt(w, data.direction)
  if (official === undefined) return Effect.void
  const base = contentNow(w, official.id)
  const answers = answersOf(w, data.answers)
  const roles = w.config.roles
  const problem = firstOf((guard) => {
    const wrong = answers.find((a) => !isAnswer(a))
    if (wrong !== undefined) guard(DRAFT.notAnswer(answerId(wrong)))
    const edit = data.edit
    const add = (edit.add ?? []).map((s) => ({
      id: s.id,
      rules: rulesOfFile(w, roles, s, base, guard),
    }))
    const replace = (edit.replace ?? []).map((r) => ({
      id: r.id,
      rules: rulesOfFile(w, roles, r.with, base, guard),
    }))
    standardChecks(w, official, base.standards, { add, remove: edit.remove ?? [], replace }, guard)
    // A new flow marks its steps with the ids of the direction as the change leaves it.
    if (edit.flow !== undefined) {
      const kept = base.standards
        .map((e) => standardAt(w, e))
        .filter((s) => !(edit.remove ?? []).includes(s.id))
        .map((s) => ({ id: s.id, rules: s.rules.map((e) => ruleAt(w, e)) }))
      const standards = [...kept, ...(edit.replace ?? []).map((r) => r.with), ...(edit.add ?? [])]
      const problem = usesProblem(official.id, edit.flow, standards)
      if (problem !== undefined) guard(DRAFT.uses(problem))
    }
  })
  if (problem !== undefined || answers.length === 0) return failIf(problem)
  const { work, draft } = withDraft(d, by, create('Revision', { _tag: 'Revised', ...data }))
  if (draft === undefined) return Effect.void
  const to = contentOfDraft(draft)
  for (const a of answers) {
    const refused =
      a._tag === 'Suggestion'
        ? suggestionAnswered(work, a.suggestion, base, to)
        : a._tag === 'Reject'
          ? draftRejectAnswered(work, a.reject, base, to)
          : undefined
    if (refused !== undefined) return fail(refused)
  }
  return Effect.void
}

// S8 (ruling 10.4): a commit of a company direction is in already while a draft of it waits or
// made a version (RevisionState). A Vetoed one comes in again on each refresh, until the owner
// accepts it or the repo moves on; an Outdated one stopped before the current version (S6). The
// refresh reads this rule too, so it offers only what this action takes.
const AGAIN: ReadonlySet<string> = new Set(['Vetoed', 'Outdated'])
export const importedAlready = (d: Derived, id: DirectionId, commit: string): boolean =>
  [...d.moment.work.drafts.values()].some(
    (x) =>
      x.of === id &&
      x.origin._tag === 'Imported' &&
      x.origin.commit === commit &&
      !AGAIN.has(d.states.revisions.get(x.id)?._tag ?? ''),
  )

// A commit of a company folder (the old planImported): the whole direction, as the change from
// its current version.
export const checkImported = (
  d: Derived,
  data: Omit<EventOf<'Revision.Imported'>['create'], '_tag'>,
): Effect.Effect<void, Refusal> => {
  const w = d.moment.work
  const { direction: id, source, folder, checkers } = data
  const existing = w.directions.get(id)
  if (existing !== undefined && existing.source._tag !== 'External') return fail(DRAFT.localId(id))
  if (importedAlready(d, id, source.commit)) {
    return fail(DRAFT.inAlready(source.commit.slice(0, 7), id))
  }
  const checkedBy = (rule: string) => checkers.rules?.[rule] ?? checkers.checkedBy
  const files = folder.standards.map((s) => ({
    id: s.id,
    rules: s.rules.map((r) => ({ ...r, checkedBy: checkedBy(r.id), supersedes: [] })),
  }))
  const official = officialAt(w, id)
  const roles = w.config.roles
  return failIf(
    firstOf((guard) => {
      if (official === undefined) {
        const add = files.map((s) => ({
          id: s.id,
          rules: rulesOfFile(w, roles, s, undefined, guard),
        }))
        if (existing !== undefined && existing.owner.name !== data.owner) {
          guard(DRAFT.ownerKept(existing.name, existing.owner.name))
        }
        const drafted = { id, name: folder.name, maxStandards: limitOf(undefined) }
        standardChecks(w, drafted, [], { add, remove: [], replace: [] }, guard)
        return
      }
      // A standard of the folder with the same words as the current one keeps its rules, so it
      // counts as a replace here: its rules are the base's either way.
      const base = contentNow(w, id)
      const built = files.map((s) => ({ id: s.id, rules: rulesOfFile(w, roles, s, base, guard) }))
      const was = base.standards.map((e) => standardAt(w, e).id)
      const edit = {
        add: built.filter((s) => !was.includes(s.id)),
        replace: built.filter((s) => was.includes(s.id)),
        remove: was.filter((x) => !built.some((s) => s.id === x)),
      }
      standardChecks(w, official, base.standards, edit, guard)
    }),
  )
}
