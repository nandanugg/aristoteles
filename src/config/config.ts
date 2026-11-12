// aristoteles.yaml and the files that people and models write: each reader checks the file and
// refuses with the old words ("<file>: <problem>"). Parsing is Bun.YAML; reading is the Files
// service. The settings of the UI are in settings.ts.
import { basename, join, posix } from 'node:path'
import { Effect } from 'effect'
import type { Refused } from '../domain/errors.ts'
import {
  CONTEXT_KEYS,
  type ConfigFile,
  type DeciderFile,
  type DirectionFile,
  type RoleFile,
  type TaskFile,
  type Workspace,
} from '../domain/files.ts'
import { oneOf, PRINCIPLES } from '../domain/closed.ts'
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
  TIERS,
} from './core.ts'
import { readSettingsOf, withSettings } from './settings.ts'

export { CONFIG, LIMIT_KEYS, MECHANISM_KEYS, SETTING_KEYS, sha, TIERS }

// The fit hash of a role: the sha of its JSON in the key order of readRoles (parity: the stored
// hashes of `work role fit` compare with this).
export const roleHash = (role: RoleFile): string => sha(JSON.stringify(role))

export interface ConfigRead {
  readonly config: ConfigFile
  readonly hashes: Readonly<Record<string, string>>
  readonly texts: Readonly<Record<string, string>>
}

// The hash of the mechanism only: a change of the settings (the UI writes them) is not a change
// of the stored config. A file that does not parse is still a changed file.
const mechanismHash = (text: string): string => {
  let raw: Raw
  try {
    raw = Bun.YAML.parse(text) ?? {}
  } catch {
    return sha(text)
  }
  return sha(JSON.stringify(Object.fromEntries(MECHANISM_KEYS.map((k) => [k, raw[k] ?? null]))))
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

// An act is exactly one of do, review, approve, change. A change names directions by id: they
// live in aristoteles, so a name may come before its direction does.
const readAct = (where: string, act: Raw, roleNames: string[]): Raw => {
  const keys = Object.keys(act ?? {})
  if (keys.length !== 1 || !['do', 'review', 'approve', 'change'].includes(keys[0] as string)) {
    fail(
      where,
      'each act is one of { do: <work> }, { review: [roles] }, { approve: [roles] }, ' +
        '{ change: [direction ids] }',
    )
  }
  const key = keys[0] as string
  if (key === 'do') return { do: String(act.do) }
  for (const name of list(act[key])) {
    if (key !== 'change' && !roleNames.includes(name)) {
      fail(where, `${key} names "${name}", which does not exist`)
    }
  }
  return { [key]: list(act[key]) }
}

// The keys keep the old order and an absent key is left out, so the JSON of a role (and its
// roleHash) is the same as the old one.
const readRoles = (raw: Raw): Record<string, RoleFile> => {
  const names = Object.keys(raw)
  const roles: Record<string, RoleFile> = {}
  for (const [name, r] of Object.entries<Raw>(raw)) {
    const where = `${CONFIG} roles.${name}`
    if (r?.kind === 'program') {
      if (typeof r.run !== 'string' || r.on !== 'report') fail(where, 'a program needs run and on: report')
    } else {
      // The person acts with no token at a terminal, so no role is played by a person.
      if (!(TIERS as readonly string[]).includes(r?.tier)) {
        fail(where, 'tier is low, medium, or high (the person needs no role)')
      }
      for (const key of ['description', 'intro']) {
        if (typeof r[key] !== 'string' || !r[key].trim()) fail(where, `${key} is required`)
      }
      if (list(r.responsibilities).length === 0) fail(where, 'responsibilities must list at least one')
    }
    const acts = list(r.acts).map((a) => readAct(where, a, names))
    if (acts.length === 0) fail(where, 'acts must list at least one act')
    const some = <K extends string>(key: K, value: unknown) =>
      value === undefined ? {} : { [key]: value }
    roles[name] = {
      kind: r.kind ?? 'agent',
      ...some('tier', r.tier),
      description: r.description ?? '',
      intro: r.intro ?? '',
      responsibilities: list(r.responsibilities),
      ...some('output', r.output),
      acts,
      ...some('run', r.run),
      ...some('on', r.on),
      checks: list(r.checks),
      ...some('timeout', r.timeout),
    } as unknown as RoleFile
  }
  return roles
}

const readLimits = (raw: Raw): ConfigFile['limits'] => {
  const limits: Raw = {}
  const parts = Object.keys(LIMIT_KEYS)
  for (const tier of TIERS) {
    limits[tier] = {}
    for (const [part, group] of Object.entries<Raw>(raw.limits?.[tier] ?? {})) {
      if (!parts.includes(part)) {
        fail(CONFIG, `limits.${tier}.${part} is not a part with limits (${parts.join(', ')})`)
      }
      const keys: readonly string[] = LIMIT_KEYS[part as keyof typeof LIMIT_KEYS]
      for (const [key, value] of Object.entries<Raw>(group ?? {})) {
        if (!keys.includes(key)) {
          fail(CONFIG, `limits.${tier}.${part}.${key} is not a limit of ${part} (${keys.join(', ')})`)
        }
        if (!(Number.isInteger(value) && value >= 1)) {
          fail(CONFIG, `limits.${tier}.${part}.${key} is a whole number of 1 or more`)
        }
      }
      limits[tier][part] = { ...group }
    }
  }
  return limits
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
  const limits = readLimits(raw)
  const roles = readRoles(raw.roles ?? {})
  // Every workflow has the three tiers, from Sol to Terra to Luna: the high role evaluates a mistake.
  for (const tier of ['high', 'medium', 'low']) {
    if (!Object.values(roles).some((r) => r.tier === tier)) {
      fail(
        CONFIG,
        `the workflow has no ${tier} role; every workflow has the three tiers (high, medium, low), and the high role evaluates a mistake`,
      )
    }
  }
  // Who decides the results of a maker, when more than one role approves it: each named role
  // has an Approve act on the maker. With no entry, any one of them decides.
  const decide = list(raw.decide).map((d, i) => {
    const where = `${CONFIG} decide ${i + 1}`
    if (!roles[d?.resultsOf]?.acts.some((a: Raw) => a.do)) {
      fail(where, `resultsOf names "${d?.resultsOf}", which is not a role that does work`)
    }
    const by = readDeciders(where, d.by, Object.keys(roles))
    const other = deciderNames(by).find(
      (n) => !roles[n]?.acts.some((a: Raw) => a.approve?.includes(d.resultsOf)),
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
  return { project: basename(dir), people, limits, roles, decide: decided } as unknown as ConfigFile
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
    const settings = Object.fromEntries(SETTING_KEYS.map((k) => [k, now[k]]))
    const text = yield* refusing(() => withSettings(stored, settings))
    yield* files.write(path, text).pipe(Effect.orDie)
  })

// A workspace path is relative and stays inside the dir.
const checkWorkspaceOf = (where: string, workspace: Raw[]): void => {
  for (const w of workspace) {
    if (typeof w?.source !== 'string' || typeof w?.path !== 'string') {
      fail(where, 'each workspace entry needs a source and a path')
    }
    if (w.path.startsWith('/') || w.path.split('/').includes('..')) {
      fail(where, `workspace ${w.path} is outside the dir`)
    }
    // One file has one name: the file queue and the same-files checks compare names.
    const plain = posix.normalize(w.path).replace(/\/+$/, '') || '.'
    if (plain !== w.path) {
      fail(where, `workspace ${w.path} names ${plain}; write it as ${plain}, so that one file has one name`)
    }
  }
}
export const checkWorkspace = (
  where: string,
  workspace: ReadonlyArray<Workspace>,
): Effect.Effect<void, Refused> => refusing(() => checkWorkspaceOf(where, [...workspace]))

// One key of a context or a where: a key that model.ts Context knows, with a text value.
const checkContextEntry = (where: string, what: string, key: string, value: unknown): void => {
  if (!(CONTEXT_KEYS as ReadonlyArray<string>).includes(key)) {
    fail(where, `${what} key "${key}" is not one of ${CONTEXT_KEYS.join(', ')}`)
  }
  if (typeof value !== 'string') fail(where, `${what} ${key} is a text, like ${key}: introduction`)
}

// A task file: the text, the directions, the context, the workspace, the references. A task
// names only a direction that has a version: directions holds those, with their standards.
export const readTask = (
  path: string,
  text: string,
  directions: ReadonlyArray<{ readonly id: string; readonly standards: ReadonlyArray<unknown> }>,
): Effect.Effect<TaskFile, Refused> =>
  refusing(() => {
    const t = parseYaml(text)
    for (const key of ['name', 'text']) {
      if (typeof t[key] !== 'string' || !t[key].trim()) fail(path, `${key} is required`)
    }
    const ids = directions.map((d) => d.id)
    for (const id of list(t.directions)) {
      if (!ids.includes(id)) {
        fail(
          path,
          `no direction "${id}" with a version; a model drafts it (work direction new), and its owner accepts it`,
        )
      }
    }
    const context = t.context ?? {}
    const used = new Set(
      directions
        .filter((d) => list(t.directions).includes(d.id))
        .flatMap((d) => d.standards.flatMap((s) => Object.keys((s as Raw).where ?? {}))),
    )
    for (const [key, value] of Object.entries(context)) {
      // section is the CLI's own key (a report of <file>#<section>), so it needs no "where".
      if (!used.has(key) && key !== 'section') {
        fail(path, `context key "${key}" is used by no "where" of its directions`)
      }
      // The context is closed: only the known keys, each with a text (model.ts Context).
      checkContextEntry(path, 'context', key, value)
    }
    checkWorkspaceOf(path, list(t.workspace))
    // There are no rounds (Nanda, 2026-11-08): a maker has its tries, and a mistake is evaluated.
    if (t.maxRounds !== undefined) {
      fail(
        path,
        'maxRounds is gone: when the tries of a maker end on a fault, the high role evaluates the mistake; leave maxRounds out',
      )
    }
    // The tasks that this task needs: their ids; each one is accepted before this task reports.
    const needs = list(t.needs).map(String)
    for (const id of needs) {
      if (!/^t\d+$/.test(id)) fail(path, `needs names "${id}", which is not a task id (t..)`)
    }
    // The starting point: an earlier result that the maker starts from.
    if (t.from !== undefined && !/^r\d+$/.test(String(t.from))) {
      fail(path, `from names "${t.from}", which is not a result id (r..)`)
    }
    return {
      name: t.name,
      text: t.text,
      directions: list(t.directions),
      context,
      needs,
      // The keys that the file names: a remake keeps the others from the task that it replaces.
      named: ['directions', 'context', 'needs', 'workspace'].filter((key) => t[key] !== undefined),
      ...(t.from !== undefined ? { from: String(t.from) } : {}),
      workspace: list(t.workspace),
      references: list(t.references).map(String),
    } as unknown as TaskFile
  })

// Who accepts the next versions of a direction (from its draft file): roles of aristoteles.yaml
// and its owner. A version is reviewed by a medium or high role, and approved by the owner.
export const readApprovedBy = (
  file: string,
  raw: unknown,
  roles: Readonly<Record<string, RoleFile>>,
  people: ReadonlyArray<string>,
): Effect.Effect<DeciderFile | undefined, Refused> =>
  refusing(() => {
    const d = raw as Raw
    if (d.approvedBy === undefined) return undefined
    const approvedBy = readDeciders(file, d.approvedBy, [...Object.keys(roles), ...people], people)
    for (const n of deciderNames(approvedBy)) {
      const role = roles[n]
      if (role && (role.kind === 'program' || role.tier === 'low')) {
        fail(file, `approvedBy names ${n}, a role that reviews no direction (only a medium or high role does)`)
      }
      if (people.includes(n) && n !== d.owner) {
        fail(file, `approvedBy names ${n}, who is not the owner (${d.owner}); the owner approves`)
      }
    }
    return approvedBy
  })

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
        for (const [key, value] of Object.entries(where)) {
          checkContextEntry(file, `standard ${s.id}: where`, key, value)
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
    return {
      id: d.id,
      name: d.name,
      owner: d.owner,
      from,
      says: d.says,
      ...(d.maxStandards !== undefined ? { maxStandards: d.maxStandards } : {}),
      standards,
      ...(d.approvedBy !== undefined ? { approvedBy: d.approvedBy } : {}),
    } as unknown as DirectionFile
  })

export const TASK_TEMPLATE = `name: <a short name>
text: <what to make, in one or two sentences>
directions: [<direction id>]
context: {}            # keys that a standard's "where" uses, for example { section: introduction }
workspace:
  - { source: <name>, path: <file or folder>, base: <branch, for code>, verify: "<command; exit 0 when the work is ready>" }
references: []         # files or sections to read, for example docs/facts.md#dedupe
`
