// aristoteles.yaml and the files that people and models write: each reader checks the file and
// refuses with the old words ("<file>: <problem>"). Parsing is Bun.YAML; reading is the Files
// service. The settings of the UI are in settings.ts.
import { basename, join } from 'node:path'
import { Effect, Schema } from 'effect'
import type { Refused } from '../domain/errors.ts'
import {
  CONTEXT_KEYS,
  type ConfigFile,
  type DeciderFile,
  DirectionFile,
  RuleRef,
  Flow,
  type FlowStep,
  type RoleFile,
  usesProblem,
} from '../domain/files.ts'
import { AUTHORITY, oneOf, PRINCIPLES, ROLE_ICONS } from '../domain/closed.ts'
import { PositiveInt } from '../domain/ids.ts'
import { refuse } from '../domain/errors.ts'
import { Files } from '../services/outside.ts'
import {
  CONFIG,
  fail,
  LIMIT_KEYS,
  list,
  MECHANISM_KEYS,
  parseYaml,
  type Raw,
  refusing,
  SETTING_KEYS,
  sha,
} from './core.ts'
import { readSettingsOf, withSettings } from './settings.ts'

export { CONFIG, LIMIT_KEYS, MECHANISM_KEYS, SETTING_KEYS, sha }

// The fit hash of a role: the sha of its JSON in the key order of readRoles (parity: the stored
// hashes of `work role fit` compare with this).
export const roleHash = (role: RoleFile): string => sha(JSON.stringify(role))

export interface ConfigRead {
  readonly config: ConfigFile
  readonly hashes: Readonly<Record<string, string>>
  readonly texts: Readonly<Record<string, string>>
}

// The mechanism of a parsed file: its keys, and the limits of each model (the commands of a
// model are settings).
const mechanismOf = (raw: Raw): Raw => ({
  ...Object.fromEntries(MECHANISM_KEYS.map((k) => [k, raw[k] ?? null])),
  models: Object.fromEntries(
    Object.entries<Raw>(raw.models ?? {}).map(([name, m]) => [name, m?.limits ?? null]),
  ),
})
// The hash of the mechanism only: a change of the settings (the UI writes them) is not a change
// of the stored config. A file that does not parse is still a changed file.
const mechanismHash = (text: string): string => {
  let raw: Raw
  try {
    raw = Bun.YAML.parse(text) ?? {}
  } catch {
    return sha(text)
  }
  return sha(JSON.stringify(mechanismOf(raw)))
}

// Who decides: a name (a role; for a direction, a person too), or one of { or }, { and },
// { order } of these. Each name comes once (each item needs its own accept), and a person comes
// last in an order (the approve is the last accept).
const deciderNames = (x: Raw): string[] =>
  typeof x === 'string' ? [x] : (Object.values(x)[0] as Raw[]).flatMap(deciderNames)

const readDeciders = (
  where: string,
  value: Raw,
  names: string[],
  people: ReadonlyArray<string> = [],
): DeciderFile => {
  const read = (x: Raw): Raw => {
    if (typeof x === 'string') {
      if (!names.includes(x)) fail(where, `"${x}" is not one of ${names.join(', ')}`)
      return x
    }
    const keys = Object.keys(x ?? {})
    const items = x?.[keys[0] as string]
    if (
      keys.length !== 1 ||
      !['or', 'and', 'order'].includes(keys[0] as string) ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      fail(where, 'who decides is a name, or one of { or: [...] }, { and: [...] }, { order: [...] }')
    }
    return { [keys[0] as string]: items.map(read) }
  }
  const by = read(value)
  const all = deciderNames(by)
  const twice = all.find((n, i) => all.indexOf(n) !== i)
  if (twice) fail(where, `names ${twice} two times; each item needs its own accept, so name it once`)
  const persons = (x: Raw): string[] => deciderNames(x).filter((n) => people.includes(n))
  if (persons(by).length > 1) fail(where, 'names more than one person; one approve is the last accept')
  const personLast = (x: Raw): boolean =>
    typeof x === 'string' ||
    (x.order
      ? x.order.slice(0, -1).every((y: Raw) => persons(y).length === 0) &&
        personLast(x.order.at(-1))
      : Object.values<Raw[]>(x)[0]?.every(personLast) === true)
  if (!personLast(by)) {
    fail(where, `names ${persons(by)[0]} before another item of an order; the person approves last`)
  }
  return by
}

// An act is one of do, review, approve, change, assign, or a word of authority (split, direct,
// fit). A change names directions by id: they live in aristoteles, so a name may come before its
// direction does.
const ACT_FIX =
  'each act is one of { do: <work> }, { review: [roles] }, { approve: [roles] }, ' +
  `{ change: [direction ids] }, { assign: [roles] }, ${AUTHORITY.join(', ')}`
const readAct = (where: string, act: Raw, roleNames: string[]): Raw => {
  if (typeof act === 'string') {
    if (!(AUTHORITY as ReadonlyArray<string>).includes(act)) fail(where, ACT_FIX)
    return act
  }
  const keys = Object.keys(act ?? {})
  const known = ['do', 'review', 'approve', 'change', 'assign']
  if (keys.length !== 1 || !known.includes(keys[0] as string)) fail(where, ACT_FIX)
  const key = keys[0] as string
  if (key === 'do') return { do: String(act.do) }
  for (const name of list(act[key])) {
    if (key !== 'change' && !roleNames.includes(name)) {
      fail(where, `${key} names "${name}", which does not exist`)
    }
  }
  return { [key]: list(act[key]) }
}

// Every role is a card with an icon of the page's set (P1).
const readIcon = (where: string, icon: unknown): void => {
  if (!(ROLE_ICONS as ReadonlyArray<unknown>).includes(icon)) {
    fail(where, `icon is required: one of ${ROLE_ICONS.join(', ')}`)
  }
}
// An agent role says how it runs, apart from its model (ruling 7); a program runs in the CLI, so
// it has none (P12).
const PERSISTENCE_FIX =
  'persistence is required: { persistent: true|false, why: <one line> } (a persistent role gets ' +
  'a terminal of its own; a disposable role runs as a subagent)'
const readPersistence = (where: string, p: Raw): void => {
  const keys = Object.keys(p ?? {})
  const why = p?.why
  if (
    typeof p !== 'object' ||
    p === null ||
    typeof p.persistent !== 'boolean' ||
    typeof why !== 'string' ||
    !why.trim() ||
    keys.some((k) => k !== 'persistent' && k !== 'why')
  ) {
    fail(where, PERSISTENCE_FIX)
  }
}

// The keys keep the file's order and an absent key is left out, so the JSON of a role (and its
// roleHash) is stable; persistence and icon go last.
const readRoles = (raw: Raw, models: ReadonlyArray<string>): Record<string, RoleFile> => {
  const names = Object.keys(raw)
  const roles: Record<string, RoleFile> = {}
  for (const [name, r] of Object.entries<Raw>(raw)) {
    const where = `${CONFIG} roles.${name}`
    if (r?.kind === 'program') {
      if (typeof r.run !== 'string' || r.on !== 'report') fail(where, 'a program needs run and on: report')
      if (r.persistence !== undefined) {
        fail(where, 'a program runs in the CLI, never in a terminal: remove its persistence')
      }
      if (r.model !== undefined) fail(where, 'a program runs no model: remove its model')
    } else {
      // The person acts with no token at a terminal, so no role is played by a person.
      if (!models.includes(r?.model)) {
        const names = models.length ? models.join(', ') : 'none yet'
        fail(where, `model names an entry of the models table (${names})`)
      }
      for (const key of ['description', 'intro']) {
        if (typeof r[key] !== 'string' || !r[key].trim()) fail(where, `${key} is required`)
      }
      if (list(r.responsibilities).length === 0) fail(where, 'responsibilities must list at least one')
      readPersistence(where, r.persistence)
      if (r.pipeline !== undefined && r.pipeline !== true) {
        fail(where, 'pipeline is true on the one role that is the pipeline, or absent')
      }
      if (r.pipeline === true && !r.persistence.persistent) {
        fail(where, 'the pipeline role is persistent: set persistence.persistent to true')
      }
    }
    if (r.kind === 'program' && r.pipeline !== undefined) {
      fail(where, 'a program is never the pipeline role: remove pipeline')
    }
    readIcon(where, r.icon)
    const acts = list(r.acts).map((a) => readAct(where, a, names))
    if (acts.length === 0) fail(where, 'acts must list at least one act')
    if (r.kind === 'program' && acts.some((a) => typeof a === 'string' || a.assign)) {
      fail(where, 'a program only reviews; it assigns nothing and has no authority')
    }
    for (const n of acts.flatMap((a) => (typeof a === 'string' ? [] : list(a.assign)))) {
      if (raw[n]?.kind === 'program') fail(where, `assign names ${n}, a program; it runs by itself`)
    }
    const some = <K extends string>(key: K, value: unknown) =>
      value === undefined ? {} : { [key]: value }
    roles[name] = {
      kind: r.kind ?? 'agent',
      ...some('model', r.model),
      description: r.description ?? '',
      intro: r.intro ?? '',
      responsibilities: list(r.responsibilities),
      ...some('output', r.output),
      acts,
      ...some('run', r.run),
      ...some('on', r.on),
      checks: list(r.checks),
      ...some('timeout', r.timeout),
      ...some('persistence', r.persistence),
      ...some('pipeline', r.pipeline),
      icon: r.icon,
    } as unknown as RoleFile
  }
  const piped = Object.entries<Raw>(raw).filter(([, r]) => r?.pipeline === true)
  if (piped.length > 1) {
    fail(CONFIG, `at most one role is the pipeline; ${piped.map(([n]) => n).join(', ')} all are`)
  }
  return roles
}

// The limits of each model of the models table (its commands are settings.ts's).
const readLimits = (raw: Raw): ConfigFile['models'] => {
  const models: Raw = {}
  const parts = Object.keys(LIMIT_KEYS)
  for (const [name, m] of Object.entries<Raw>(raw.models ?? {})) {
    const at = `models.${name}.limits`
    models[name] = {}
    for (const [part, group] of Object.entries<Raw>(m?.limits ?? {})) {
      if (!parts.includes(part)) {
        fail(CONFIG, `${at}.${part} is not a part with limits (${parts.join(', ')})`)
      }
      const keys: readonly string[] = LIMIT_KEYS[part as keyof typeof LIMIT_KEYS]
      for (const [key, value] of Object.entries<Raw>(group ?? {})) {
        if (!keys.includes(key)) {
          fail(CONFIG, `${at}.${part}.${key} is not a limit of ${part} (${keys.join(', ')})`)
        }
        if (!Schema.is(PositiveInt)(value)) {
          fail(CONFIG, `${at}.${part}.${key} is a whole number of 1 or more`)
        }
      }
      models[name][part] = { ...group }
    }
  }
  return models
}

// The mechanism of a parsed file, checked. dir gives the name of the project.
const configOf = (dir: string, raw: Raw): ConfigFile => {
  if (raw.project !== undefined) {
    fail(CONFIG, 'the name of a dir is the name of its folder; remove the project key')
  }
  if (raw.directions !== undefined) {
    fail(
      CONFIG,
      'directions are not files: each one lives in aristoteles. A model drafts it (work direction new --file=<direction.yaml>), and its owner accepts it; remove the directions key',
    )
  }
  const known: readonly string[] = [...MECHANISM_KEYS, ...SETTING_KEYS]
  const unknown = Object.keys(raw).find((k) => !known.includes(k))
  if (unknown) fail(CONFIG, `"${unknown}" is not a key of ${CONFIG} (${known.join(', ')})`)
  readSettingsOf(raw)
  const people: string[] = list(raw.people).map((p) => p?.name)
  if (people.length === 0 || people.some((p) => typeof p !== 'string')) {
    fail(CONFIG, 'people must list at least one { name: ... }')
  }
  // The log tells an agent from a person by the name: an id like a1 is an agent's.
  const idLike = people.find((p) => /^[a-z]+\d+$/.test(p))
  if (idLike) {
    fail(
      CONFIG,
      `the person "${idLike}" has the name of an id (like a1 or t2); give the person another name`,
    )
  }
  const models = readLimits(raw)
  const roles = readRoles(raw.roles ?? {}, Object.keys(models))
  // A role that splits evaluates a mistake, and hosts each project.
  if (!Object.values(roles).some((r) => r.acts.includes('split'))) {
    fail(CONFIG, 'no role splits; a role with the split act hosts each project and evaluates a mistake')
  }
  // Who decides the results of a maker, when more than one role approves it: each named role
  // has an Approve act on the maker. With no entry, any one of them decides.
  const decide = list(raw.decide).map((d, i) => {
    const where = `${CONFIG} decide ${i + 1}`
    if (!roles[d?.resultsOf]?.acts.some((a: Raw) => a?.do)) {
      fail(where, `resultsOf names "${d?.resultsOf}", which is not a role that does work`)
    }
    const by = readDeciders(where, d.by, Object.keys(roles))
    const other = deciderNames(by).find(
      (n) => !roles[n]?.acts.some((a: Raw) => a?.approve?.includes(d.resultsOf)),
    )
    if (other) {
      fail(where, `${other} has no Approve act on ${d.resultsOf}; only a role that approves it decides it`)
    }
    // One entry for each maker: a second would never be read. Two deciders combine in one entry.
    const first = list(raw.decide).findIndex((x) => x?.resultsOf === d.resultsOf)
    if (first < i) {
      fail(
        where,
        `decide ${first + 1} already says who decides ${d.resultsOf}; name all its deciders in one entry, with or, and, or order`,
      )
    }
    return [d.resultsOf, by] as const
  })
  // One entry per maker, so the stored config cannot hold a second (the checks above refuse it).
  const decided = Object.fromEntries(decide)
  return { project: basename(dir), people, models, roles, decide: decided } as unknown as ConfigFile
}

// readConfig(dir): the mechanism, its hash and its text.
export const readConfig = (dir: string): Effect.Effect<ConfigRead, Refused, Files> =>
  Effect.gen(function* () {
    const files = yield* Files
    const text = yield* files.read(join(dir, CONFIG))
    if (text === null) {
      return yield* refuse(`no ${CONFIG} in ${dir}; write one (see DESIGN.md section 3)`)
    }
    return yield* configOfText(dir, text)
  })

// The same read of a text that is not in the file yet (work config check reads the merged draft).
export const configOfText = (dir: string, text: string): Effect.Effect<ConfigRead, Refused> =>
  refusing(() => ({
    config: configOf(dir, parseYaml(text)),
    hashes: { [CONFIG]: mechanismHash(text) },
    texts: { [CONFIG]: text },
  }))

// fileHashes(dir): the hash of the mechanism in the file now.
export const fileHashes = (
  dir: string,
): Effect.Effect<Readonly<Record<string, string>>, never, Files> =>
  Effect.gen(function* () {
    const files = yield* Files
    const text = yield* files.read(join(dir, CONFIG))
    const hashes: Record<string, string> = {}
    if (text !== null) hashes[CONFIG] = mechanismHash(text)
    return hashes
  })

// restoreConfig(dir, text): writes back the stored mechanism and keeps the settings of the file as
// they are now: the settings are not stored, and the UI may have changed them since.
export const restoreConfig = (dir: string, stored: string): Effect.Effect<void, Refused, Files> =>
  Effect.gen(function* () {
    const files = yield* Files
    const path = join(dir, CONFIG)
    const nowText = yield* files.read(path)
    let now: Raw = {}
    try {
      now = nowText === null ? {} : (Bun.YAML.parse(nowText) ?? {})
    } catch {}
    yield* files.write(path, stored).pipe(Effect.orDie)
    const settings: Raw = Object.fromEntries(SETTING_KEYS.map((k) => [k, now[k]]))
    // The commands of a model are the file's now; its limits are the stored ones.
    const was = parseYaml(stored).models ?? {}
    const names = [...new Set([...Object.keys(was), ...Object.keys(now.models ?? {})])]
    settings.models = Object.fromEntries(
      names.map((n) => {
        const { limits: _, ...commands } = now.models?.[n] ?? {}
        const limits = was[n]?.limits
        return [n, { ...was[n], ...commands, ...(limits ? { limits } : {}) }]
      }),
    )
    const text = yield* refusing(() => withSettings(stored, settings))
    yield* files.write(path, text).pipe(Effect.orDie)
  })

// One key of a context or a where: a key that model.ts Context knows, with a text value.
const checkContextEntry = (where: string, what: string, key: string, value: unknown): void => {
  if (!(CONTEXT_KEYS as ReadonlyArray<string>).includes(key)) {
    fail(where, `${what} key "${key}" is not one of ${CONTEXT_KEYS.join(', ')}`)
  }
  if (typeof value !== 'string') fail(where, `${what} ${key} is a text, like ${key}: introduction`)
}

// The flow: key of a draft (Nanda, 2026-11-15: a direction has a flow): the steps from the first act
// of an actor down to the output, each { from, to, says }, with its place where the project
// defines it, and a step that the direction governs marked with uses and its examples. The Schema
// is the rule; a refusal says where it stopped.
const decodeFlow = Schema.decodeUnknownSync(Flow)
const decodeDirection = Schema.decodeUnknownSync(DirectionFile)
const flowOf = (file: string, value: unknown): ReadonlyArray<FlowStep> => {
  if (!Array.isArray(value)) {
    const steps = 'the steps from the first act down to the output'
    fail(file, `flow is required: ${steps}, each step that the direction governs with uses and examples`)
  }
  try {
    return decodeFlow(value)
  } catch (e) {
    const hint =
      'a step needs from, to and says; a step that the direction governs needs uses and examples ' +
      'together (one that follows the direction, one that breaks it)'
    return fail(file, `flow: ${hint}; ${(e as Error).message.replace(/\s*\n\s*/g, ' ')}`)
  }
}
// The flow of a company draft, which readDirection does not read.
export const readFlow = (file: string, value: unknown): Effect.Effect<ReadonlyArray<FlowStep>, Refused> =>
  refusing(() => flowOf(file, value))

// The evidence of a rule file (DESIGN 4): test is a command, ref is file#anchor:lines.
const evidenceOf = (file: string, r: Raw): { test?: string; ref?: string } => {
  if (r.test !== undefined && (typeof r.test !== 'string' || !r.test.trim())) {
    fail(file, `rule ${r.id}: test is a shell command (no output = the rule holds)`)
  }
  if (r.ref !== undefined && !Schema.is(RuleRef)(r.ref)) {
    fail(file, `rule ${r.id}: ref is file#anchor:lines, e.g. docs/x.md#tables:10-20`)
  }
  return {
    ...(r.test === undefined ? {} : { test: r.test }),
    ...(r.ref === undefined ? {} : { ref: r.ref }),
  }
}

export const readDirection = (
  file: string,
  raw: unknown,
  people: ReadonlyArray<string>,
): Effect.Effect<DirectionFile, Refused> =>
  refusing(() => {
    const d = raw as Raw
    for (const key of ['id', 'name', 'says', 'owner']) {
      if (typeof d[key] !== 'string' || !d[key].trim()) fail(file, `${key} is required`)
    }
    // Nanda, 2026-11-15: each direction starts with a summary.
    if (typeof d.summary !== 'string' || !d.summary.trim()) {
      fail(
        file,
        'summary is required: one or two plain sentences that say what the direction asks and ' +
          'why it matters, for a person who reads it the first time',
      )
    }
    if (!people.includes(d.owner)) fail(file, `owner ${d.owner} is not in people`)
    const standards = list(d.standards).map((s, i) => {
      if (typeof s?.id !== 'string' || typeof s?.says !== 'string') {
        fail(file, `standard ${i + 1} needs an id and says`)
      }
      const rules = list(s.rules).map((r, j) => {
        if (typeof r?.id !== 'string' || typeof r?.says !== 'string') {
          fail(file, `rule ${j + 1} of ${s.id} needs an id and says`)
        }
        return {
          id: r.id,
          says: r.says,
          ...(r.checkedBy !== undefined ? { checkedBy: r.checkedBy } : {}),
          ...evidenceOf(file, r),
          supersedes: list(r.supersedes),
        }
      })
      if (s.when !== undefined) {
        fail(file, `standard ${s.id}: "when" is now "where" (the context where the standard applies)`)
      }
      if (s.where !== undefined) {
        const where = s.where as Raw
        if (typeof where !== 'object' || where === null || Array.isArray(where)) {
          fail(
            file,
            `standard ${s.id}: where is a map of context keys, like where: { section: introduction }`,
          )
        }
        if (Object.keys(where).length === 0) {
          fail(
            file,
            `standard ${s.id}: where names no key; leave it out, and the standard applies everywhere`,
          )
        }
        // One value, or a list of values: any one of them matches (Nanda, 2026-11-13).
        for (const [key, value] of Object.entries(where)) {
          const values = Array.isArray(value) ? value : [value]
          if (values.length === 0) fail(file, `standard ${s.id}: where ${key} lists no value`)
          for (const v of values) checkContextEntry(file, `standard ${s.id}: where`, key, v)
        }
      }
      return { id: s.id, says: s.says, ...(s.where !== undefined ? { where: s.where } : {}), rules }
    })
    // The principles that ground it, of the eleven (the owner's ruling, 2026-11-12: new code).
    const from = list(d.from).map((word) => {
      const principle = oneOf(PRINCIPLES, String(word))
      if (principle !== undefined) return principle
      const words = PRINCIPLES.join(', ')
      const message = `from names "${word}", which is not a principle; the principles are ${words}`
      return fail(file, message)
    })
    const flow = flowOf(file, d.flow)
    const marks = usesProblem(d.id, flow, standards)
    if (marks !== undefined) fail(file, marks)
    const read = {
      id: d.id,
      name: d.name,
      owner: d.owner,
      from,
      summary: d.summary,
      flow,
      says: d.says,
      ...(d.maxStandards !== undefined ? { maxStandards: d.maxStandards } : {}),
      standards,
      ...(d.approvedBy !== undefined ? { approvedBy: d.approvedBy } : {}),
    }
    try {
      return decodeDirection(read)
    } catch (e) {
      return fail(file, (e as Error).message.replace(/\s*\n\s*/g, ' '))
    }
  })
