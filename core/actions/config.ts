// The actions of the workflow and its config: work init and the store start of onboarding,
// config apply and restore, role fit (onboarding's first fit), and the page's settings.
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import type { Derived } from '../derived/index.ts'
import type { Refusal } from '../schema/errors.ts'
import {
  checkerProblem,
  type ConfigFile,
  create,
  currentVersion,
  type DirectionId,
  type Event,
  type EventOf,
  isNonBlank,
  move,
  type OnboardedDirection,
  officialDirections,
  type RoleFile,
  RoleName,
  type Work,
} from '../schema/index.ts'
import {
  Files,
  onboardedOf,
  type OnboardingFiles,
  readConfig,
  restoreConfig,
  roleHash,
  writeSettings,
} from '../services/index.ts'
import { DRAFT } from './drafts.ts'
import { allowed, asWrite, current, no, readYaml, type RefusalsOf } from './support.ts'
import type { Action } from './types.ts'

const CONFIG = 'aristoteles.yaml'
const FITNESS = join(import.meta.dir, '..', '..', 'guides', 'fitness.yaml')
// The new words of a role, as a change of the config stores them.
type RoleWords = EventOf<'Workflow.RoleWordsChanged'>['move']['roles'][string]

const REFUSALS = {
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
        'the workflow has no persistent role that splits; the host plays it on each top task, ' +
          'and the host is a terminal (ruling 15)',
        'Write',
        `make a role of ${CONFIG} that splits persistent`,
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
        `change back ${other} in ${CONFIG}; a change of more than the words of roles needs a new ` +
          'store',
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
  SaveSettings: {},
} satisfies Readonly<Record<string, RefusalsOf>>
const R = REFUSALS

const fail = <A = never>(r: Refusal): Effect.Effect<A, Refusal> => Effect.fail(r)

// --- work init, and the store start of onboarding ----------------------------------------------

// What the host writes again so that the store can start: a direction, a role, or a persistent
// role that splits (the host plays it).
export type StartFix =
  | { readonly _tag: 'Direction'; readonly direction: DirectionId }
  | { readonly _tag: 'Role'; readonly role: RoleName }
  | { readonly _tag: 'Lead' }
  | { readonly _tag: 'Staffing' }
interface StartProblem {
  readonly refusal: Refusal
  readonly fix: StartFix
}

// What keeps the accepted directions of onboarding out of a new store: the checks of work
// direction new over the roles of the file, as no store exists yet. A workflow with no
// persistent role that splits has no host (ruling 15), so work init refuses it too.
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
  r.kind === 'agent' && r.acts.includes('split') && r.persistence.persistent
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
  if (files.staffingProblem !== undefined) {
    return {
      _tag: 'Blocked',
      refusal: no(files.staffingProblem, 'Write', 'correct the staffing for this directory'),
      fix: { _tag: 'Staffing' },
    }
  }
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
const responsibility = <T extends object>(role: T) =>
  Object.fromEntries(Object.entries(role).filter(([key]) => key !== 'model' && key !== 'persistence'))

const diffConfig = (config: ConfigFile, old: ConfigFile, localStaffing: boolean) => {
  const text: Record<string, RoleWords> = {}
  const other: Array<string> = []
  for (const key of ['project', 'people', 'models', 'decide'] as const) {
    if (key === 'models' && localStaffing) continue
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
    if (canon(localStaffing ? responsibility(rest) : rest) !==
      canon(localStaffing ? responsibility(rest0) : rest0)) {
      other.push(`the acts, model, persistence or icon of ${roleName}`)
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
    const { config, hashes, texts, localStaffing } = yield* readConfig(cwd).pipe(Effect.mapError(asWrite(CONFIG)))
    const { text, other } = diffConfig(config, d.moment.work.config, localStaffing === true)
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
  for (const r of role.responsibilities) {
    const verb = VAGUE.exec(r)?.[1]?.toLowerCase()
    if (verb) {
      problems.push(`"${r}" uses the vague verb "${verb}"; name the exact output and command`)
    }
  }
  if (role.acts.some((a) => typeof a !== 'string' && 'do' in a) && !role.output) {
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
  const model = role.kind === 'agent' ? role.model : undefined
  const limit = model === undefined ? undefined : work.config.models[model]?.Review?.rules
  if (limit !== undefined && rules.length > limit) {
    problems.push(
      `${rules.length} rules name this role; the limit of ${model} is ${limit} ` +
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

export const ACTIONS = { DefineWorkflow, ApplyConfig, RestoreConfig, SaveSettings, FitRole }
