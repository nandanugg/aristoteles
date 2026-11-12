// The commands init, config, role.
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import type { Refused } from '../../domain/errors.ts'
import { refuse } from '../../domain/errors.ts'
import { create, move } from '../../domain/events.ts'
import type { ConfigFile, RoleFile, RoleWords } from '../../domain/files.ts'
import { currentVersion, officialDirections } from '../../domain/derived.ts'
import { isNonBlank, RoleName } from '../../domain/ids.ts'
import type { Work } from '../../domain/work.ts'
import { readConfig, restoreConfig, roleHash } from '../../config/config.ts'
import { Dir, Now } from '../../services/io.ts'
import { Store } from '../../services/store.ts'
import { textOf } from '../args.ts'
import { callerOf, personChannel, personOf, tierOf } from '../caller.ts'
import type { Command, Commands } from '../command.ts'
import { actOf, readArgFile, readWork, writeAct } from '../run.ts'
import { Files } from '../../services/outside.ts'
import { GUIDES } from '../guides.ts'

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

const init: Command = () =>
  Effect.gen(function* () {
    const store = yield* Store
    const { cwd } = yield* Dir
    const clock = yield* Now
    const name = yield* personOf(undefined)
    const { config, hashes, texts } = yield* readConfig(cwd)
    if (!config.people.includes(name)) {
      return yield* refuse(`${name} (git user.name) is not in the people of aristoteles.yaml`)
    }
    const channel = yield* personChannel
    const opened = yield* store.open(cwd, { create: true })
    yield* opened.write((events) =>
      Effect.gen(function* () {
        if (events.length) return yield* refuse('the store exists; use work config apply')
        const at = yield* clock.read
        // No reader rows yet: the first act after init adds every row (as the old init did).
        const author = { _tag: 'Person' as const, name, channel }
        const event = create('Workflow', { _tag: 'Defined', config, hashes, texts })
        return { draft: { at, author, event }, rows: [] }
      }),
    )
    const roles = Object.keys(config.roles)
    const withModel = roles.filter((r) => config.roles[r]?.kind !== 'program')
    return [
      `store made for ${config.project} in aristoteles: ${roles.length} roles, and no direction yet.`,
      `next: work role fit <role> for each role (${withModel.join(', ')}); ` +
        'a model drafts each direction (work direction new --file=<direction.yaml> --by=<model>), and you accept it; ' +
        'then work task open --file=<task.yaml>',
    ]
  })

// What differs between the file and the stored config: the words of roles go in `text`, and
// anything else is a change that apply refuses.
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

const config: Command = (call) =>
  Effect.gen(function* () {
    const sub = call.args.positional[0]
    const { cwd } = yield* Dir
    if (sub === 'restore') {
      const { work } = yield* readWork
      const files = Object.keys(work.texts)
      yield* personOf(work, { word: 'restore', show: `restore ${files.join(', ')} to the stored text` })
      for (const text of Object.values(work.texts)) yield* restoreConfig(cwd, text)
      return [`restored ${files.join(', ')}.`]
    }
    if (sub !== 'apply') return yield* refuse('use work config apply|restore')
    const { config, hashes, texts } = yield* readConfig(cwd)
    let changed: ReadonlyArray<string> = []
    yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const name = yield* personOf(work, { word: 'apply' })
        const { text, other } = diffConfig(config, work.config)
        if (other.length) {
          return yield* refuse(
            `work config apply changes only the words of roles; this also changes: ${other.join(', ')}`,
            'the prototype makes a new store for such a change (DESIGN.md section 9)',
          )
        }
        changed = Object.keys(text)
        const changed_ = { _tag: 'RoleWordsChanged' as const, roles: text, hashes, texts }
        const event = { _tag: 'Workflow' as const, move: changed_ }
        return { author: { _tag: 'Person' as const, name, channel: yield* personChannel }, event }
      }),
    )
    return [
      `applied: ${changed.length ? changed.join(', ') : 'no role words changed'}; each changed role needs a new work role fit.`,
    ]
  })

const VAGUE = ['handle', 'ensure', 'look at', 'deal with', 'manage', 'take care', 'make sure', 'support']

// The static checks of a role: its acts, its words, its output, and the rules that name it.
const staticFit = (work: Work, roleName: string, role: RoleFile): ReadonlyArray<string> => {
  const problems: Array<string> = []
  if (role.tier === 'low' && role.acts.length !== 1) problems.push('a low role has exactly one act')
  for (const r of role.responsibilities) {
    const verb = VAGUE.find((v) => r.toLowerCase().includes(v))
    if (verb) problems.push(`"${r}" uses the vague verb "${verb}"; name the exact output and command`)
  }
  if (role.acts.some((a) => 'do' in a) && !role.output) {
    problems.push('a role with a do act names its output form')
  }
  // Only an official direction has rules now; a direction with only a draft has none yet.
  const rules = officialDirections(work)
    .flatMap((d) => currentVersion(d).standards)
    .flatMap((s) => work.standards.get(s)?.rules ?? [])
    .flatMap((r) => work.rules.get(r) ?? [])
    .filter((r) => r.checkedBy._tag === 'Role' && r.checkedBy.role === roleName)
  const limit = role.tier === undefined ? undefined : work.config.limits[role.tier].Review?.rules
  if (limit !== undefined && rules.length > limit) {
    problems.push(`${rules.length} rules name this role; the ${role.tier} limit is ${limit}`)
  }
  return problems
}

const Fitness = Schema.Struct({
  questions: Schema.Array(
    Schema.Struct({ id: Schema.Number, short: Schema.String, ask: Schema.String }),
  ),
})

type Answer = Readonly<Record<string, unknown>>

const readYaml = (text: string): Effect.Effect<unknown, Refused> =>
  Effect.try({
    try: () => Bun.YAML.parse(text) as unknown,
    catch: (e) => refuse(e instanceof Error ? e.message : String(e)),
  })

const role: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const [sub, roleName] = args.positional
    const { cwd } = yield* Dir
    const { work } = yield* readWork
    if (sub === 'list') {
      // The name column fits the longest name, so a long name keeps the columns in line; it is
      // never narrower than the old 14 columns.
      const roles = Object.entries(work.config.roles)
      const width = Math.max(12, ...roles.map(([n]) => n.length)) + 2
      return roles.map(([n, r]) => {
        const tier = r.kind === 'program' ? 'program' : (r.tier ?? '')
        const unfit = r.kind !== 'program' && work.fits.get(RoleName.make(n))?.hash !== roleHash(r)
        const fit = unfit ? '  (no fit record)' : ''
        return `${n.padEnd(width)}${tier.padEnd(8)}${r.description}${fit}`
      })
    }
    const key = String(roleName)
    if (sub === 'show') {
      const stored = roleIn(work.config.roles, key)
      if (!stored) return yield* refuse(`there is no role "${key}"`)
      return [JSON.stringify(stored, null, 2)]
    }
    if (sub !== 'fit') return yield* refuse('use work role list|show|fit')
    // Fitness reads the role from aristoteles.yaml, so new words are fitted before config apply.
    const fromFile = roleIn((yield* readConfig(cwd)).config.roles, key)
    const wanted = fromFile ?? roleIn(work.config.roles, key)
    if (!wanted) return yield* refuse(`there is no role "${key}"`)
    if (wanted.kind === 'program') return yield* refuse(`${key} is a program; it needs no fit record`)
    const problems = staticFit(work, key, wanted)
    const files = yield* Files
    const fitness = Schema.decodeUnknownSync(Fitness)(
      Bun.YAML.parse((yield* files.read(join(GUIDES, 'fitness.yaml'))) ?? ''),
    )
    const file = textOf(args.one('answers'))
    if (!file) {
      return [
        `static checks of ${key}: ${problems.length ? '' : 'pass'}`,
        ...problems.map((p) => `  - ${p}`),
        '',
        'Answer each question with yes or no, and why, in a file:',
        ...fitness.questions.map((q) => `  ${q.id}. ${q.ask}`),
        '',
        `  - { id: 1, yes: true, why: "<one real example of the role's work>" }`,
        `then: work role fit ${key} --answers=<file>`,
      ]
    }
    if (problems.length) return yield* refuse(`${key} fails the static checks: ${problems.join('; ')}`)
    const answers = (yield* readYaml(yield* readArgFile(file))) ?? []
    const given = Array.isArray(answers) ? (answers as ReadonlyArray<Answer | null>) : []
    const no = fitness.questions.filter(
      (q) => !given.some((x) => x?.id === q.id && x.yes === true && String(x.why ?? '').trim()),
    )
    if (no.length) {
      return yield* refuse(
        `not fit: ${no.map((q) => `${q.id} (${q.short})`).join(', ')}`,
        'change the role, then answer again',
      )
    }
    // The record keeps the yes and the why of each question, in their order (new: the old one
    // kept the whole file).
    const yesOf = (id: number) => {
      const why = String(given.find((x) => x?.id === id && x.yes === true)?.why ?? '')
      return isNonBlank(why) ? Effect.succeed({ id, yes: true as const, why }) : Effect.die(why)
    }
    const [first, ...more] = yield* Effect.forEach(fitness.questions, (q) => yesOf(q.id))
    if (first === undefined) return yield* Effect.die('guides/fitness.yaml has no question')
    const fit = [first, ...more] as const
    yield* writeAct(call, (s) =>
      Effect.gen(function* () {
        const token = textOf(args.one('as')) ?? null
        const caller = yield* callerOf(s, token)
        if (caller._tag === 'Agent' && tierOf(s, caller.assignment) !== 'high') {
          return yield* refuse('a person or a high role records role fitness')
        }
        const stored = roleIn(s.config.roles, key)
        if (!stored) return yield* refuse(`${key} is not in the stored config; run work config apply first`)
        const fitted = { _tag: 'Fitted' as const, hash: roleHash(stored), answers: fit }
        return actOf(caller, move('Role', RoleName.make(key), fitted))
      }),
    )
    return [`${key} fits; recorded.`]
  })

export const commands: Commands = { init, config, role }
