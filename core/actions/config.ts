// The actions of the workflow and its config: work init and the store start of onboarding,
// config apply and restore, role fit, the drafts of the words of a role and their accept or
// reject, the adjustments of roles and directions, and the page's settings.
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import {
  adjustmentDraftAt,
  adjustmentProblem,
  type Derived,
  type RoleWords,
  roleWordsDraftAt,
} from '../derived/index.ts'
import type { AdjustmentInput } from '../schema/actions.ts'
import {
  type Adjustment,
  checkerProblem,
  type ConfigFile,
  type DirectionId,
  create,
  currentVersion,
  type Event,
  isNonBlank,
  move,
  type OnboardedDirection,
  officialDirections,
  type Recorded,
  type RoleFile,
  RoleName,
  type Work,
} from '../schema/index.ts'
import {
  configOfText,
  onboardedOf,
  type OnboardingFiles,
  Files,
  readApprovedBy,
  readConfig,
  restoreConfig,
  roleHash,
  writeSettings,
} from '../services/index.ts'
import { foldStep } from '../state/index.ts'
import type { Refusal } from '../schema/errors.ts'
import { DRAFT } from './drafts.ts'
import {
  allowed,
  asWrite,
  configUnchanged,
  current,
  no,
  readYaml,
  type RefusalsOf,
} from './support.ts'
import type { Action } from './types.ts'

const CONFIG = 'aristoteles.yaml'
const FITNESS = join(import.meta.dir, '..', '..', 'guides', 'fitness.yaml')

export const REFUSALS = {
  DefineWorkflow: {
    notInPeople: (name: string) =>
      no(
        `${name} (git user.name) is not in the people of ${CONFIG}`,
        'Write',
        `add ${name || 'your name'} to the people of ${CONFIG}`,
      ),
    // The store start of onboarding (BUILD.md section 3).
    noHostRole: () =>
      no(
        'the workflow has no persistent high role; the host plays the high role of each top ' +
          'task, and the host is a terminal (ruling 15)',
        'Write',
        `make a high role of ${CONFIG} persistent`,
      ),
    sameId: (id: string) =>
      no(`two directions have the id ${id}`, 'Write', 'give each direction its own id'),
    owner: (id: string, owner: string) =>
      no(
        `the owner ${owner} of ${id} is not in the people of ${CONFIG}`,
        'Write',
        `name a person of ${CONFIG} as the owner of ${id}`,
      ),
    notRole: (rule: string, direction: string, role: string) =>
      no(
        `rule ${rule} of ${direction} is checked by ${role}, which is not an accepted role`,
        'Write',
        `name an accepted role in checkedBy of ${rule}`,
      ),
    checker: DRAFT.checker,
    hasStandard: DRAFT.hasStandard,
    ruleIdUsed: DRAFT.ruleIdUsed,
    supersedesMissing: DRAFT.supersedesMissing,
    tooMany: DRAFT.tooMany,
    programChecks: DRAFT.programChecks,
  },
  ApplyConfig: {
    notWords: (other: string) =>
      no(
        `work config apply changes only the words of roles; this also changes: ${other}`,
        'Write',
        `change back ${other} in ${CONFIG}; a high agent drafts such a change with work ` +
          'adjust, and the person accepts it',
      ),
  },
  RestoreConfig: {},
  FitRole: {
    noRole: (role: string) =>
      no(`there is no role "${role}"`, 'Pick', 'name a role of the workflow'),
    program: (role: string) =>
      no(`${role} is a program; it needs no fit record`, 'Pick', 'fit a role of a model'),
    staticChecks: (role: string, problems: string) =>
      no(
        `${role} fails the static checks: ${problems}`,
        'Write',
        `change the words of ${role} in ${CONFIG}, then answer again`,
      ),
    notFit: (no_: string) => no(`not fit: ${no_}`, 'Write', 'change the role, then answer again'),
    notStored: (role: string) =>
      no(
        `${role} is not in the stored config; run work config apply first`,
        'Pick',
        `apply the config that has ${role}, or fit a stored role`,
      ),
  },
  DraftRoleWords: {
    notWords: (file: string, what: string) =>
      no(`${file}: ${what}`, 'Write', `give only the new words of the role in ${file}`),
    sameWords: (role: string, file: string) =>
      no(
        `${file} gives the words that ${role} has now`,
        'Write',
        `write the new words of ${role} in ${file}`,
      ),
    notFit: (role: string, problems: string) =>
      no(
        `${role} with these words fails the static checks: ${problems}`,
        'Write',
        `change the words of ${role} in the file`,
      ),
  },
  AcceptRoleWords: {
    notBlock: (what: string) =>
      no(
        `${CONFIG}: ${what}`,
        'Write',
        `write the role as a block of its own under roles: in ${CONFIG}`,
      ),
  },
  RejectRoleWords: {
    noReason: () =>
      no('a reject of new words needs a reason', 'Write', 'write why with --reason'),
  },
  DraftAdjustment: {
    noWhy: (role: string) =>
      no(
        `the persistence of ${role} needs a reason`,
        'Write',
        'write why with --why: the card of the role shows it',
      ),
    notBlock: (what: string) =>
      no(`${CONFIG}: ${what}`, 'Write', `write each role as a block of its own under roles:`),
    notRole: (file: string, what: string) =>
      no(`${file}: ${what}`, 'Write', `give the keys of one role in ${file}`),
    config: (what: string) =>
      no(what, 'Write', 'change the role so that work config check reads it'),
  },
  AcceptAdjustment: {
    notBlock: (what: string) =>
      no(`${CONFIG}: ${what}`, 'Write', `write each role as a block of its own under roles:`),
    notExact: () =>
      no(
        `${CONFIG} would hold more than the adjustment`,
        'Write',
        `restore ${CONFIG} as stored (work config restore), then accept again`,
      ),
  },
  RejectAdjustment: {
    noReason: () =>
      no('a reject of an adjustment needs a reason', 'Write', 'write why with --reason'),
  },
  SaveSettings: {},
} satisfies Readonly<Record<string, RefusalsOf>>
const R = REFUSALS

const fail = <A = never>(r: Refusal): Effect.Effect<A, Refusal> => Effect.fail(r)

// --- work init, and the store start of onboarding ----------------------------------------------

// What the host writes again so that the store can start: a direction, a role, or a persistent
// high role (the host plays it).
export type StartFix =
  | { readonly _tag: 'Direction'; readonly direction: DirectionId }
  | { readonly _tag: 'Role'; readonly role: RoleName }
  | { readonly _tag: 'Lead' }
interface StartProblem {
  readonly refusal: Refusal
  readonly fix: StartFix
}

// What keeps the accepted directions of onboarding out of a new store: the checks of work
// direction new over the roles of the file, as no store exists yet. A workflow with no
// persistent high role has no host (ruling 15), so work init refuses it too.
const startProblem = (
  config: ConfigFile,
  directions: ReadonlyArray<OnboardedDirection>,
): StartProblem | undefined => {
  const S = R.DefineWorkflow
  if (Object.values(config.roles).every((r) => !isLead(r))) {
    return { refusal: S.noHostRole(), fix: { _tag: 'Lead' } }
  }
  const ids = new Set<string>()
  const rules = new Map<string, string | undefined>()
  for (const { direction: d } of directions) {
    const problem = directionProblem(config, d, ids, rules)
    if (problem !== undefined) {
      return { refusal: problem, fix: { _tag: 'Direction', direction: d.id } }
    }
  }
  for (const [name, role] of Object.entries(config.roles)) {
    if (role.kind !== 'program') continue
    const wrong = role.checks.find((id) => rules.has(id) && rules.get(id) !== name)
    if (wrong !== undefined) {
      return { refusal: S.programChecks(name, wrong), fix: { _tag: 'Role', role: RoleName.make(name) } }
    }
  }
  return undefined
}
const isLead = (r: RoleFile): boolean =>
  r.kind === 'agent' && r.tier === 'high' && r.persistence.persistent
// One direction against the config and the directions before it (ids and rules: what they used).
const directionProblem = (
  config: ConfigFile,
  d: OnboardedDirection['direction'],
  ids: Set<string>,
  rules: Map<string, string | undefined>,
): Refusal | undefined => {
  const S = R.DefineWorkflow
  if (ids.has(d.id)) return S.sameId(d.id)
  ids.add(d.id)
  if (!config.people.includes(d.owner)) return S.owner(d.id, d.owner)
  if (d.maxStandards !== undefined && d.standards.length > d.maxStandards) {
    return S.tooMany(d.name, String(d.standards.length), String(d.maxStandards))
  }
  const standards = new Set<string>()
  for (const s of d.standards) {
    if (standards.has(s.id)) return S.hasStandard(d.name, s.id)
    standards.add(s.id)
    for (const r of s.rules) {
      if (rules.has(r.id)) return S.ruleIdUsed(r.id)
      rules.set(r.id, r.checkedBy)
      // A direction of a new store has no version before it, so it supersedes nothing.
      const [old] = r.supersedes
      if (old !== undefined) return S.supersedesMissing(r.id, old)
      if (r.checkedBy !== undefined && config.roles[r.checkedBy] === undefined) {
        return S.notRole(r.id, d.id, r.checkedBy)
      }
      const problem = checkerProblem(config.roles, r.id, r.checkedBy)
      if (problem !== null) return S.checker(problem, r.id)
    }
  }
  return undefined
}

// page: StartState. Whether the store of onboarding can start, from the files: the one reader for
// work onboard status and its wait, the agents page, and the start itself (O1). Blocked comes
// first: an accepted direction or role that the start refuses waits for the host, even while
// others still wait for the person.
export type StartState =
  | { readonly _tag: 'NoConfig' }
  | { readonly _tag: 'Blocked'; readonly refusal: Refusal; readonly fix: StartFix }
  | { readonly _tag: 'Waiting'; readonly on: WaitingOn }
  | { readonly _tag: 'Open' }
export type WaitingOn =
  | { readonly _tag: 'Direction'; readonly direction: DirectionId }
  | { readonly _tag: 'Role'; readonly role: RoleName }
export const startStateOf = (files: OnboardingFiles): StartState => {
  const { config } = files
  if (config === null) return { _tag: 'NoConfig' }
  // Any person of the people owns the directions here; the start checks the real one.
  const owner = config.people[0] ?? ''
  const accepted = files.directions.flatMap((f) =>
    f.stage._tag === 'Accepted' ? [onboardedOf(f.id, f.stage.draft, owner, { _tag: 'Local' })] : [],
  )
  const problem = startProblem(config, accepted)
  if (problem !== undefined) return { _tag: 'Blocked', ...problem }
  const direction = files.directions.find((f) => f.stage._tag !== 'Accepted')
  if (direction !== undefined) {
    return { _tag: 'Waiting', on: { _tag: 'Direction', direction: direction.id } }
  }
  const role = files.roles.find((r) => r.decision._tag !== 'Accepted')
  if (role !== undefined) return { _tag: 'Waiting', on: { _tag: 'Role', role: role.role } }
  return { _tag: 'Open' }
}

// The first event of a store: the workflow of aristoteles.yaml, and the directions that
// onboarding accepted (none for work init). dispatch runs this on an empty store; on a store
// with events, canAct refuses DefineWorkflow (the store has a config).
export const defineWorkflow = (
  by: { readonly _tag: string; readonly name?: string },
  cwd: string,
  directions: ReadonlyArray<OnboardedDirection>,
): Effect.Effect<ReadonlyArray<Event>, Refusal, Files> =>
  Effect.gen(function* () {
    const { config, hashes, texts } = yield* readConfig(cwd).pipe(Effect.mapError(asWrite(CONFIG)))
    const name = by.name ?? ''
    if (!config.people.includes(name)) return yield* fail(R.DefineWorkflow.notInPeople(name))
    const problem = startProblem(config, directions)
    if (problem !== undefined) return yield* fail(problem.refusal)
    for (const { direction } of directions) {
      yield* readApprovedBy(direction.id, direction, config.roles, config.people).pipe(
        Effect.mapError(asWrite(direction.id)),
      )
    }
    return [create('Workflow', { _tag: 'Defined', config, hashes, texts, directions })]
  })

const DefineWorkflow: Action<'DefineWorkflow'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    // As the old init: the file is read before the store, so a wrong file is named first.
    yield* readConfig(d.moment.outside.cwd).pipe(Effect.mapError(asWrite(CONFIG)))
    yield* allowed(d, by, input)
    return yield* Effect.die('DefineWorkflow: canAct lets no store with events define it again')
  })

// --- config apply and restore -------------------------------------------------------------------

// Equal values with their keys in any order: a stored config and a fresh read may order keys
// differently, and only the words matter here.
const canon = (value: unknown): string =>
  JSON.stringify(value, (_key, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  )
const roleIn = (roles: Readonly<Record<string, RoleFile>>, name: string): RoleFile | undefined =>
  Object.hasOwn(roles, name) ? roles[name] : undefined

// What differs between the file and the stored config: the words of roles, and anything else.
const diffConfig = (config: ConfigFile, old: ConfigFile) => {
  const text: Record<string, RoleWords> = {}
  const other: Array<string> = []
  for (const key of ['project', 'people', 'limits', 'decide'] as const) {
    if (canon(config[key]) !== canon(old[key])) other.push(key)
  }
  for (const [roleName, role] of Object.entries(config.roles)) {
    const was = roleIn(old.roles, roleName)
    if (!was) {
      other.push(`new role ${roleName}`)
      continue
    }
    const { description, intro, responsibilities, output, ...rest } = role
    const { description: d0, intro: i0, responsibilities: r0, output: o0, ...rest0 } = was
    if (canon(rest) !== canon(rest0)) {
      other.push(`the acts, tier, persistence or icon of ${roleName}`)
    }
    if (canon([description, intro, responsibilities, output]) !== canon([d0, i0, r0, o0])) {
      const words = { description, intro, responsibilities }
      text[roleName] = output === undefined ? words : { ...words, output }
    }
  }
  return { text, other }
}

// The change of the words of roles that aristoteles.yaml holds now; any other change is refused.
const roleWordsOfFile = (d: Derived): Effect.Effect<Event, Refusal, Files> =>
  Effect.gen(function* () {
    const cwd = d.moment.outside.cwd
    const { config, hashes, texts } = yield* readConfig(cwd).pipe(Effect.mapError(asWrite(CONFIG)))
    const { text, other } = diffConfig(config, d.moment.work.config)
    if (other.length) return yield* fail(R.ApplyConfig.notWords(other.join(', ')))
    const changed = { _tag: 'RoleWordsChanged' as const, roles: text, hashes, texts }
    return { _tag: 'Workflow', move: changed } as Event
  })

const ApplyConfig: Action<'ApplyConfig'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    return [yield* roleWordsOfFile(d)]
  })

// Files only: the stored text of each config file goes back to the dir.
const RestoreConfig: Action<'RestoreConfig'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const cwd = d.moment.outside.cwd
    for (const text of Object.values(d.moment.work.texts)) {
      yield* restoreConfig(cwd, text).pipe(Effect.mapError(asWrite(CONFIG)))
    }
    return []
  })

// Files only: the settings of the page go into aristoteles.yaml.
const SaveSettings: Action<'SaveSettings'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    yield* writeSettings(d.moment.outside.cwd, input.content.settings).pipe(
      Effect.mapError((e) => (e._tag === 'Refused' ? asWrite(CONFIG)(e) : e)),
      Effect.catchTag('OutsideFailed', (e) => Effect.die(e)),
    )
    return []
  })

// --- role fit -----------------------------------------------------------------------------------

// Each form of each vague verb, as whole words: "handles" is the verb, "handler" another word.
const VAGUE = new RegExp(
  `\\b(${[
    ['handle', 'handles', 'handled', 'handling'],
    ['ensure', 'ensures', 'ensured', 'ensuring'],
    ['look at', 'looks at', 'looked at', 'looking at'],
    ['deal with', 'deals with', 'dealt with', 'dealing with'],
    ['manage', 'manages', 'managed', 'managing'],
    ['take care', 'takes care', 'took care', 'taking care'],
    ['make sure', 'makes sure', 'made sure', 'making sure'],
    ['support', 'supports', 'supported', 'supporting'],
  ]
    .flat()
    .join('|')})\\b`,
  'i',
)

// The checks of a role's own words: its acts, its responsibilities, its output.
export const wordsFit = (role: RoleFile): ReadonlyArray<string> => {
  const problems: Array<string> = []
  if (role.tier === 'low' && role.acts.length !== 1) problems.push('a low role has exactly one act')
  for (const r of role.responsibilities) {
    const verb = VAGUE.exec(r)?.[1]?.toLowerCase()
    if (verb) {
      problems.push(`"${r}" uses the vague verb "${verb}"; name the exact output and command`)
    }
  }
  if (role.acts.some((a) => 'do' in a) && !role.output) {
    problems.push('a role with a do act names its output form')
  }
  return problems
}
// The static checks of a role: its own words, and the rules that name it.
export const staticFit = (work: Work, roleName: string, role: RoleFile): ReadonlyArray<string> => {
  const problems = [...wordsFit(role)]
  // Only an official direction has rules now; a direction with only a draft has none yet.
  const rules = officialDirections(work)
    .flatMap((d) => currentVersion(d).standards)
    .flatMap((s) => work.standards.get(s)?.rules ?? [])
    .flatMap((r) => work.rules.get(r) ?? [])
    .filter((r) => r.checkedBy._tag === 'Role' && r.checkedBy.role === roleName)
  const limit = role.tier === undefined ? undefined : work.config.limits[role.tier].Review?.rules
  if (limit !== undefined && rules.length > limit) {
    problems.push(
      `${rules.length} rules name this role; the ${role.tier} limit is ${limit} ` +
        '(work guide limits)',
    )
  }
  return problems
}

const Fitness = Schema.Struct({
  questions: Schema.Array(
    Schema.Struct({ id: Schema.Number, short: Schema.String, ask: Schema.String }),
  ),
})
type Answer = Readonly<Record<string, unknown>> | null

const FitRole: Action<'FitRole'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const w = d.moment.work
    const cwd = d.moment.outside.cwd
    const key = input.target.role
    // The role is read from aristoteles.yaml, so new words are fitted before config apply.
    const fromFile = yield* readConfig(cwd).pipe(
      Effect.map((r) => roleIn(r.config.roles, key)),
      Effect.mapError(asWrite(CONFIG)),
    )
    const wanted = fromFile ?? roleIn(w.config.roles, key)
    if (!wanted) return yield* fail(R.FitRole.noRole(key))
    if (wanted.kind === 'program') return yield* fail(R.FitRole.program(key))
    const problems = staticFit(w, key, wanted)
    if (problems.length) return yield* fail(R.FitRole.staticChecks(key, problems.join('; ')))
    const files = yield* Files
    const fitness = Schema.decodeUnknownSync(Fitness)(
      Bun.YAML.parse((yield* files.read(FITNESS)) ?? ''),
    )
    const answers = (yield* readYaml(cwd, input.content.answers)) ?? []
    const given: ReadonlyArray<Answer> = Array.isArray(answers) ? answers : []
    const yes = (id: number) =>
      given.find((x) => x?.id === id && x.yes === true && isNonBlank(String(x.why ?? '')))
    const missing = fitness.questions.filter((q) => yes(q.id) === undefined)
    if (missing.length) {
      return yield* fail(R.FitRole.notFit(missing.map((q) => `${q.id} (${q.short})`).join(', ')))
    }
    const fit = fitness.questions.map((q) => ({
      id: q.id,
      yes: true as const,
      why: String(yes(q.id)?.why ?? '') as never,
    }))
    const stored = roleIn(w.config.roles, key)
    if (!stored) return yield* fail(R.FitRole.notStored(key))
    const fitted = { _tag: 'Fitted' as const, hash: roleHash(stored), answers: fit as never }
    return [move('Role', RoleName.make(key), fitted)]
  })

// --- the words of a role after the first start (ruling 2026-11-14) ------------------------------

// An agent that edits aristoteles.yaml stops every write until the person applies it. So its new
// words wait in the store (Role.WordsDrafted) for the person: an accept writes them into
// aristoteles.yaml and stores them as config apply does; a reject gives the drafter a reason.
const WORD_KEYS: ReadonlyArray<string> = ['description', 'intro', 'responsibilities', 'output']
type Raw = Record<string, unknown>
const isRaw = (x: unknown): x is Raw => typeof x === 'object' && x !== null && !Array.isArray(x)

// What is wrong with the new words of a role in a file; undefined: they read.
const wordsProblem = (words: unknown): string | undefined => {
  if (!isRaw(words) || Object.keys(words).length === 0) {
    return `it gives no words of a role (${WORD_KEYS.join(', ')})`
  }
  const other = Object.keys(words).filter((k) => !WORD_KEYS.includes(k))
  if (other.length) {
    return (
      `${other.join(', ')}: only the words of a role change after the first start ` +
      `(${WORD_KEYS.join(', ')}); a new act or tier needs a new store`
    )
  }
  const texts = ['description', 'intro', 'output']
  const text = texts.find((k) => k in words && typeof words[k] !== 'string')
  if (text !== undefined) return `${text} is a text`
  const r = words.responsibilities
  if (r !== undefined && (!Array.isArray(r) || r.some((x) => typeof x !== 'string'))) {
    return 'responsibilities is a list of texts'
  }
  return undefined
}

const yamlLines = (value: unknown): ReadonlyArray<string> =>
  Bun.YAML.stringify(value, null, 2)
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
const indentOf = (line: string): number => line.length - line.trimStart().length
// The end of the block of the key on a line: the next line at its indent or less, but a list
// item at its indent is its value (blank lines before the end stay outside).
const blockEnd = (lines: ReadonlyArray<string>, start: number): number => {
  const indent = indentOf(lines[start] ?? '')
  const inside = (l: string) =>
    l.trim() === '' || indentOf(l) > indent || (indentOf(l) === indent && /^\s*- /.test(l))
  let end = start + 1
  while (end < lines.length && inside(lines[end] ?? '')) end++
  while (end > start + 1 && (lines[end - 1] ?? '').trim() === '') end--
  return end
}
// The line of a key at an indent, in lines from..to-1; -1: none.
const keyLine = (
  lines: ReadonlyArray<string>,
  [from, to]: readonly [number, number],
  indent: number,
  key: string,
): number =>
  lines.findIndex(
    (l, i) =>
      i >= from && i < to && indentOf(l) === indent && l.trimStart().startsWith(`${key}:`),
  )

// aristoteles.yaml with new keys of a role (its words, its tier, its persistence): only the block
// of each key in the block of the role is written again (a key that the role lacks goes at its
// end), so the person's git diff shows only those keys. problem: what keeps the keys out.
type Edited = { readonly text: string } | { readonly problem: string }
const withRoleKeys = (
  file: string,
  role: string,
  words: Readonly<Record<string, unknown>>,
): Edited => {
  const lines = file.split('\n')
  const top = lines.findIndex((l) => /^roles:\s*$/.test(l))
  if (top === -1) return { problem: 'it has no block of roles' }
  const indent = indentOf(lines.slice(top + 1).find((l) => l.trim() !== '') ?? '')
  const at = keyLine(lines, [top + 1, blockEnd(lines, top)], indent, role)
  // A role on one line ({ ... }) has no block to write a word into.
  if (at === -1 || !(lines[at] ?? '').trimEnd().endsWith(':')) {
    return { problem: `the role ${role} is not a block of its own under roles` }
  }
  for (const [key, value] of Object.entries(words)) {
    const end = blockEnd(lines, at)
    const first = lines.slice(at + 1, end).find((l) => l.trim() !== '')
    const inner = first === undefined ? indent + 2 : indentOf(first)
    const block = yamlLines({ [key]: value }).map((l) => ' '.repeat(inner) + l)
    const k = keyLine(lines, [at + 1, end], inner, key)
    if (k === -1) lines.splice(end, 0, ...block)
    else lines.splice(k, blockEnd(lines, k) - k, ...block)
  }
  return { text: lines.join('\n') }
}

const DraftRoleWords: Action<'DraftRoleWords'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const w = d.moment.work
    const { role } = input.target
    const { file } = input.content
    const words = yield* readYaml(d.moment.outside.cwd, file)
    const problem = wordsProblem(words)
    if (problem !== undefined) return yield* fail(R.DraftRoleWords.notWords(file, problem))
    const stored = roleIn(w.config.roles, role)
    if (stored === undefined) return yield* Effect.die(`canAct let a draft name no role ${role}`)
    const drafted = words as RoleWords
    const wanted = { ...stored, ...drafted }
    const wordsOf = (r: RoleFile) => canon(WORD_KEYS.map((k) => r[k as keyof RoleFile]))
    if (wordsOf(wanted) === wordsOf(stored)) {
      return yield* fail(R.DraftRoleWords.sameWords(role, file))
    }
    const problems = staticFit(w, role, wanted)
    if (problems.length) return yield* fail(R.DraftRoleWords.notFit(role, problems.join('; ')))
    return [move('Role', role, { _tag: 'WordsDrafted', words: drafted })]
  })

// The file must be as stored before the words go in, so the stored change holds only them; a
// refused change leaves the file as it was.
const AcceptRoleWords: Action<'AcceptRoleWords'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const draft = roleWordsDraftAt(d.moment.work, input.target.draft)
    if (draft === undefined) return yield* Effect.die(`canAct let an accept name no draft`)
    const files = yield* Files
    const path = join(d.moment.outside.cwd, CONFIG)
    const text = (yield* files.read(path)) ?? ''
    const merged = withRoleKeys(text, draft.role, draft.words)
    if ('problem' in merged) return yield* fail(R.AcceptRoleWords.notBlock(merged.problem))
    yield* files.write(path, merged.text).pipe(Effect.orDie)
    const restore = files.write(path, text).pipe(Effect.orDie)
    return [yield* roleWordsOfFile(d).pipe(Effect.tapError(() => restore))]
  })

const RejectRoleWords: Action<'RejectRoleWords'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { draft } = input.target
    const x = roleWordsDraftAt(d.moment.work, draft)
    if (x === undefined) return yield* Effect.die(`canAct let a reject name no draft`)
    const reason = input.content.reason
    if (!isNonBlank(reason)) return yield* fail(R.RejectRoleWords.noReason())
    return [move('Role', x.role, { _tag: 'WordsRejected', draft, reason })]
  })

// --- adjustments after the first start (ruling 14) ---------------------------------------------

// The block of the roles, and the indent of a role in it; undefined: no block.
const rolesBlock = (lines: ReadonlyArray<string>) => {
  const top = lines.findIndex((l) => /^roles:\s*$/.test(l))
  if (top === -1) return undefined
  const indent = indentOf(lines.slice(top + 1).find((l) => l.trim() !== '') ?? '')
  return { top, end: blockEnd(lines, top), indent }
}
// aristoteles.yaml with a role adjustment: a new role at the end of the roles, a removed role's
// block gone, or one key of a role written again.
const withAdjustment = (file: string, a: Adjustment): Edited => {
  switch (a._tag) {
    case 'SetTier':
      return withRoleKeys(file, a.role, { tier: a.tier })
    case 'SetPersistence':
      return withRoleKeys(file, a.role, { persistence: a.persistence })
    case 'RetireDirection':
      return { text: file }
    default:
      break
  }
  const lines = file.split('\n')
  const block = rolesBlock(lines)
  if (block === undefined) return { problem: 'it has no block of roles' }
  if (a._tag === 'AddRole') {
    const body = yamlLines(a.file).map((l) => ' '.repeat(block.indent + 2) + l)
    lines.splice(block.end, 0, `${' '.repeat(block.indent)}${a.role}:`, ...body)
    return { text: lines.join('\n') }
  }
  const at = keyLine(lines, [block.top + 1, block.end], block.indent, a.role)
  if (at === -1) return { problem: `the role ${a.role} is not a block of its own under roles` }
  lines.splice(at, blockEnd(lines, at) - at)
  return { text: lines.join('\n') }
}

// The adjustment of the input: the files that it names read and checked.
const adjustmentOf = (
  d: Derived,
  input: AdjustmentInput,
): Effect.Effect<Adjustment, Refusal, Files> =>
  Effect.gen(function* () {
    const cwd = d.moment.outside.cwd
    switch (input._tag) {
      case 'SetPersistence': {
        const { role, persistent, why } = input
        if (!isNonBlank(why)) return yield* fail(R.DraftAdjustment.noWhy(role))
        return { _tag: 'SetPersistence', role, persistence: { persistent, why } }
      }
      case 'AddRole': {
        // The new role as work config check reads it, in the file with the role added.
        const raw = yield* readYaml(cwd, input.file)
        if (!isRaw(raw) || Object.keys(raw).length === 0) {
          return yield* fail(R.DraftAdjustment.notRole(input.file, 'it gives no keys of a role'))
        }
        const text = (yield* (yield* Files).read(join(cwd, CONFIG))) ?? ''
        const lines = text.split('\n')
        const block = rolesBlock(lines)
        if (block === undefined) {
          return yield* fail(R.DraftAdjustment.notBlock('it has no block of roles'))
        }
        const body = yamlLines(raw).map((l) => ' '.repeat(block.indent + 2) + l)
        lines.splice(block.end, 0, `${' '.repeat(block.indent)}${input.role}:`, ...body)
        const read = yield* configOfText(cwd, lines.join('\n')).pipe(
          Effect.mapError((e) => R.DraftAdjustment.config(e.message)),
        )
        const file = read.config.roles[input.role]
        if (file === undefined) return yield* Effect.die('the added role reads back')
        return { _tag: 'AddRole', role: input.role, file }
      }
      default:
        return input
    }
  })

const DraftAdjustment: Action<'DraftAdjustment'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const adjustment = yield* adjustmentOf(d, input.content.adjustment)
    const problem = adjustmentProblem(d, adjustment)
    if (problem !== undefined) return yield* fail(problem)
    // A role adjustment must leave a file that work config check reads.
    const cwd = d.moment.outside.cwd
    const text = (yield* (yield* Files).read(join(cwd, CONFIG))) ?? ''
    const edited = withAdjustment(text, adjustment)
    if ('problem' in edited) return yield* fail(R.DraftAdjustment.notBlock(edited.problem))
    yield* configOfText(cwd, edited.text).pipe(
      Effect.mapError((e) => R.DraftAdjustment.config(e.message)),
    )
    return [create('Adjustment', { _tag: 'Drafted', adjustment })]
  })

// A role adjustment writes aristoteles.yaml as an accept of role words does (the file must be as
// stored first; a refusal writes it back), and stores its new text; the file then holds what the
// fold makes of the accept, and nothing more. A direction adjustment stores the text of now.
const AcceptAdjustment: Action<'AcceptAdjustment'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const w = d.moment.work
    const { draft } = input.target
    const x = adjustmentDraftAt(w, draft)
    if (x === undefined) return yield* Effect.die('canAct let an accept name no adjustment')
    if (!('role' in x.adjustment)) {
      return [move('Adjustment', draft, { _tag: 'Accepted', hashes: w.hashes, texts: w.texts })]
    }
    const files = yield* Files
    const cwd = d.moment.outside.cwd
    const path = join(cwd, CONFIG)
    const text = (yield* files.read(path)) ?? ''
    const edited = withAdjustment(text, x.adjustment)
    if ('problem' in edited) return yield* fail(R.AcceptAdjustment.notBlock(edited.problem))
    yield* files.write(path, edited.text).pipe(Effect.orDie)
    const restore = files.write(path, text).pipe(Effect.orDie)
    const read = yield* readConfig(cwd).pipe(
      Effect.mapError(asWrite(CONFIG)),
      Effect.tapError(() => restore),
    )
    const event = move('Adjustment', draft, {
      _tag: 'Accepted',
      hashes: read.hashes,
      texts: read.texts,
    })
    const seq = (w.events.at(-1)?.recorded.seq ?? 0) + 1
    const after = foldStep(w, { seq, at: d.moment.at, author: by, event } as Recorded)
    if (canon(after.work.config) !== canon(read.config)) {
      yield* restore
      return yield* fail(R.AcceptAdjustment.notExact())
    }
    return [event]
  })

const RejectAdjustment: Action<'RejectAdjustment'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const reason = input.content.reason
    if (!isNonBlank(reason)) return yield* fail(R.RejectAdjustment.noReason())
    return [move('Adjustment', input.target.draft, { _tag: 'Rejected', reason })]
  })

export const ACTIONS = {
  DefineWorkflow,
  ApplyConfig,
  RestoreConfig,
  FitRole,
  DraftRoleWords,
  AcceptRoleWords,
  RejectRoleWords,
  DraftAdjustment,
  AcceptAdjustment,
  RejectAdjustment,
  SaveSettings,
}
