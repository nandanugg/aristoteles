// The actions of the workflow and its config: work init, config apply and restore, role fit, the
// drafts of the words of a role and their accept or reject, and the page's settings.
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { type Derived, type RoleWords, roleWordsDraftAt } from '../derived/index.ts'
import {
  type ConfigFile,
  create,
  currentVersion,
  type Event,
  isNonBlank,
  move,
  officialDirections,
  type RoleFile,
  RoleName,
  type Work,
} from '../schema/index.ts'
import { Files, readConfig, restoreConfig, roleHash, writeSettings } from '../services/index.ts'
import type { Refusal } from '../schema/errors.ts'
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
  },
  ApplyConfig: {
    notWords: (other: string) =>
      no(
        `work config apply changes only the words of roles; this also changes: ${other}`,
        'Write',
        `change back ${other} in ${CONFIG}; a new store takes such a change (DESIGN.md section 9)`,
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
  SaveSettings: {},
} satisfies Readonly<Record<string, RefusalsOf>>
const R = REFUSALS

const fail = <A = never>(r: Refusal): Effect.Effect<A, Refusal> => Effect.fail(r)

// --- work init ----------------------------------------------------------------------------------

// The first event of a store: the workflow of aristoteles.yaml. dispatch runs this on an empty
// store; on a store with events, canAct refuses DefineWorkflow (the store has a config).
export const defineWorkflow = (
  by: { readonly _tag: string; readonly name?: string },
  cwd: string,
): Effect.Effect<ReadonlyArray<Event>, Refusal, Files> =>
  Effect.gen(function* () {
    const { config, hashes, texts } = yield* readConfig(cwd).pipe(Effect.mapError(asWrite(CONFIG)))
    const name = by.name ?? ''
    if (!config.people.includes(name)) return yield* fail(R.DefineWorkflow.notInPeople(name))
    return [create('Workflow', { _tag: 'Defined', config, hashes, texts })]
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
    if (canon(rest) !== canon(rest0)) other.push(`the acts or tier of ${roleName}`)
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

// aristoteles.yaml with new words of a role: only the block of each drafted word in the block of
// the role is written again (a word that the role lacks goes at its end), so the person's git diff
// shows only those words. problem: what keeps the words out.
const withRoleWords = (
  file: string,
  role: string,
  words: RoleWords,
): { readonly text: string } | { readonly problem: string } => {
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
    const merged = withRoleWords(text, draft.role, draft.words)
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

export const ACTIONS = {
  DefineWorkflow,
  ApplyConfig,
  RestoreConfig,
  FitRole,
  DraftRoleWords,
  AcceptRoleWords,
  RejectRoleWords,
  SaveSettings,
}
