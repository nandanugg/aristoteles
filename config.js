// Reads work.yaml (the mechanism: people, roles, limits, deciders) and checks its shape. The
// result is plain data: `work init` and `work config apply` store it as an act, and the replay
// builds the engine from that act, never from the file. The directions are not files: each one
// lives in aristoteles, from a model's draft and its owner's accept (Nanda, 2026-11-10).

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'

export const TIERS = ['low', 'medium', 'high']
// The limits of a tier sit under the part that checks them, as on the page:
//   Assignment: briefChars (the printed brief), attempts (the default and the ceiling of a maker)
//   Review:     rules (how many rules one review checks)
//   Result:     size (the changed lines of one result)
//   Note:       waiverHours (the longest waiver that a role may give; the default is 72 hours)
export const LIMIT_KEYS = { Assignment: ['briefChars', 'attempts'], Review: ['rules'], Result: ['size'], Note: ['waiverHours'] }
export const sha = (text) => createHash('sha256').update(text).digest('hex')

const fail = (where, message) => {
  throw new Error(`${where}: ${message}`)
}
const list = (value) => (Array.isArray(value) ? value : [])

export function readConfig(dir) {
  const path = join(dir, 'work.yaml')
  if (!existsSync(path)) throw new Error(`no work.yaml in ${dir}; write one (see DESIGN.md section 3)`)
  const text = readFileSync(path, 'utf8')
  const raw = Bun.YAML.parse(text) ?? {}
  const hashes = { 'work.yaml': sha(text) }
  const texts = { 'work.yaml': text }

  if (typeof raw.project !== 'string') fail('work.yaml', 'project must be a name')
  const people = list(raw.people).map((p) => p?.name)
  if (people.length === 0 || people.some((p) => typeof p !== 'string')) {
    fail('work.yaml', 'people must list at least one { name: ... }')
  }
  const limits = {}
  const parts = Object.keys(LIMIT_KEYS)
  for (const tier of TIERS) {
    limits[tier] = {}
    for (const [part, group] of Object.entries(raw.limits?.[tier] ?? {})) {
      if (!parts.includes(part)) fail('work.yaml', `limits.${tier}.${part} is not a part with limits (${parts.join(', ')})`)
      for (const [key, value] of Object.entries(group ?? {})) {
        if (!LIMIT_KEYS[part].includes(key)) fail('work.yaml', `limits.${tier}.${part}.${key} is not a limit of ${part} (${LIMIT_KEYS[part].join(', ')})`)
        if (!(Number.isInteger(value) && value >= 1)) fail('work.yaml', `limits.${tier}.${part}.${key} is a whole number of 1 or more`)
      }
      limits[tier][part] = { ...group }
    }
    limits[tier].Note = { waiverHours: 72, ...limits[tier].Note }
  }

  if (raw.directions !== undefined) {
    fail('work.yaml', 'directions are not files: each one lives in aristoteles. A model drafts it (work direction new --file=<direction.yaml>), and its owner accepts it; remove the directions key')
  }
  const roles = readRoles(raw.roles ?? {}, people)
  // Every workflow has the three tiers, from Sol to Terra to Luna: the high role evaluates a mistake.
  for (const tier of ['high', 'medium', 'low']) {
    if (!Object.values(roles).some((r) => r.tier === tier)) {
      fail('work.yaml', `the workflow has no ${tier} role; every workflow has the three tiers (high, medium, low), and the high role evaluates a mistake`)
    }
  }
  // Who decides the results of a maker, when more than one role approves it: each named role
  // has an Approve act on the maker. With no entry, any one of them decides.
  const decide = list(raw.decide).map((d, i) => {
    const where = `work.yaml decide ${i + 1}`
    if (!roles[d?.resultsOf]?.acts.some((a) => a.do)) fail(where, `resultsOf names "${d?.resultsOf}", which is not a role that does work`)
    const by = readDeciders(where, d.by, Object.keys(roles))
    const other = deciderNames(by).find((n) => !roles[n].acts.some((a) => a.approve?.includes(d.resultsOf)))
    if (other) fail(where, `${other} has no Approve act on ${d.resultsOf}; only a role that approves it decides it`)
    // One entry for each maker: a second would never be read. Two deciders combine in one entry.
    const first = list(raw.decide).findIndex((x) => x?.resultsOf === d.resultsOf)
    if (first < i) fail(where, `decide ${first + 1} already says who decides ${d.resultsOf}; name all its deciders in one entry, with or, and, or order`)
    return { resultsOf: d.resultsOf, by }
  })
  return { config: { project: raw.project, people, limits, roles, decide }, hashes, texts }
}

// Who accepts the next versions of a direction (from its draft file): roles of work.yaml and
// its owner. A version is reviewed by a medium or high role, and approved by the owner.
export function readApprovedBy(file, d, roles, people) {
  if (d.approvedBy === undefined) return undefined
  const approvedBy = readDeciders(file, d.approvedBy, [...Object.keys(roles), ...people], people)
  for (const n of deciderNames(approvedBy)) {
    if (roles[n] && (roles[n].kind === 'program' || roles[n].tier === 'low')) fail(file, `approvedBy names ${n}, a role that reviews no direction (only a medium or high role does)`)
    if (people.includes(n) && n !== d.owner) fail(file, `approvedBy names ${n}, who is not the owner (${d.owner}); the owner approves`)
  }
  return approvedBy
}

// Who decides: a name (a role; for a direction, a person too), or one of { or: [...] },
// { and: [...] }, { order: [...] } of these. order: each one, in this order. Each name comes
// once (each item needs its own accept), and a person comes last in an order (the approve is
// the last accept).
const deciderNames = (x) => (typeof x === 'string' ? [x] : Object.values(x)[0].flatMap(deciderNames))
function readDeciders(where, value, names, people = []) {
  const read = (x) => {
    if (typeof x === 'string') {
      if (!names.includes(x)) fail(where, `"${x}" is not one of ${names.join(', ')}`)
      return x
    }
    const keys = Object.keys(x ?? {})
    const items = x?.[keys[0]]
    if (keys.length !== 1 || !['or', 'and', 'order'].includes(keys[0]) || !Array.isArray(items) || items.length === 0) {
      fail(where, 'who decides is a name, or one of { or: [...] }, { and: [...] }, { order: [...] }')
    }
    return { [keys[0]]: items.map(read) }
  }
  const by = read(value)
  const all = deciderNames(by)
  const twice = all.find((n, i) => all.indexOf(n) !== i)
  if (twice) fail(where, `names ${twice} two times; each item needs its own accept, so name it once`)
  const persons = (x) => deciderNames(x).filter((n) => people.includes(n))
  if (persons(by).length > 1) fail(where, 'names more than one person; one approve is the last accept')
  const personLast = (x) => typeof x === 'string' ||
    (x.order ? x.order.slice(0, -1).every((y) => persons(y).length === 0) && personLast(x.order.at(-1)) : Object.values(x)[0].every(personLast))
  if (!personLast(by)) fail(where, `names ${persons(by)[0]} before another item of an order; the person approves last`)
  return by
}

export function readDirection(file, d, people) {
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
      return { id: r.id, says: r.says, checkedBy: r.checkedBy, supersedes: list(r.supersedes) }
    })
    if (s.when !== undefined) fail(file, `standard ${s.id}: "when" is now "where" (the context where the standard applies)`)
    return { id: s.id, says: s.says, where: s.where, rules }
  })
  return {
    id: d.id, name: d.name, owner: d.owner, from: list(d.from), says: d.says,
    maxStandards: d.maxStandards, standards, approvedBy: d.approvedBy,
  }
}

// An act is exactly one of do, review, approve, change. A change names directions by id: they
// live in aristoteles, so a name may come before its direction does.
function readAct(where, act, roleNames) {
  const keys = Object.keys(act ?? {})
  if (keys.length !== 1 || !['do', 'review', 'approve', 'change'].includes(keys[0])) {
    fail(where, 'each act is one of { do: <work> }, { review: [roles] }, { approve: [roles] }, ' +
      '{ change: [direction ids] }')
  }
  const [key] = keys
  if (key === 'do') return { do: String(act.do) }
  for (const name of list(act[key])) {
    if (key !== 'change' && !roleNames.includes(name)) fail(where, `${key} names "${name}", which does not exist`)
  }
  return { [key]: list(act[key]) }
}

function readRoles(raw, people) {
  const names = Object.keys(raw)
  const roles = {}
  for (const [name, r] of Object.entries(raw)) {
    const where = `work.yaml roles.${name}`
    if (r?.kind === 'program') {
      if (typeof r.run !== 'string' || r.on !== 'report') fail(where, 'a program needs run and on: report')
    } else {
      // The person acts with no token at a terminal, so no role is played by a person.
      if (!TIERS.includes(r?.tier)) fail(where, 'tier is low, medium, or high (the person needs no role)')
      for (const key of ['description', 'intro']) {
        if (typeof r[key] !== 'string' || !r[key].trim()) fail(where, `${key} is required`)
      }
      if (list(r.responsibilities).length === 0) fail(where, 'responsibilities must list at least one')
    }
    const acts = list(r.acts).map((a) => readAct(where, a, names))
    if (acts.length === 0) fail(where, 'acts must list at least one act')
    roles[name] = {
      kind: r.kind ?? 'agent', tier: r.tier,
      description: r.description ?? '', intro: r.intro ?? '',
      responsibilities: list(r.responsibilities), output: r.output, acts,
      run: r.run, on: r.on, checks: list(r.checks), timeout: r.timeout,
    }
  }
  return roles
}

// The checker of a rule can give evidence that counts: a role that reviews or approves a
// role that does the work, and a program that lists the rule in its checks. roles holds the
// role configs of work.yaml by name.
export function checkerProblem(roles, id, checkedBy) {
  if (checkedBy === undefined) return undefined
  if (checkedBy === 'Human') {
    return `rule ${id} is checked by Human; the person approves directions and standards, not results: name the role that reviews it`
  }
  const role = roles[checkedBy]
  if (!role) return `rule ${id} is checked by "${checkedBy}", which is not a role`
  const checked = role.acts.flatMap((a) => [...(a.review ?? []), ...(a.approve ?? [])])
  if (!checked.some((name) => roles[name]?.acts.some((a) => a.do))) {
    return `rule ${id} is checked by ${checkedBy}, which reviews or approves no role that does the work, so its evidence never counts`
  }
  if (role.kind === 'program' && !role.checks.includes(id)) {
    return `rule ${id} is checked by the program ${checkedBy}, which does not list it in its checks`
  }
  return undefined
}

// The hash of work.yaml, with no parse: a broken file is still a changed file.
export function fileHashes(dir) {
  const hashes = {}
  const path = join(dir, 'work.yaml')
  if (existsSync(path)) hashes['work.yaml'] = sha(readFileSync(path, 'utf8'))
  return hashes
}

// A task file: the text, the directions, the context, the workspace, the references. A task
// names only a direction that has a version: directions holds those, with their current
// standards.
export function readTask(path, text, directions) {
  const t = Bun.YAML.parse(text) ?? {}
  for (const key of ['name', 'text']) {
    if (typeof t[key] !== 'string' || !t[key].trim()) fail(path, `${key} is required`)
  }
  const ids = directions.map((d) => d.id)
  for (const id of list(t.directions)) {
    if (!ids.includes(id)) fail(path, `no direction "${id}" with a version; a model drafts it (work direction new), and its owner accepts it`)
  }
  const context = t.context ?? {}
  const used = new Set(
    directions.filter((d) => list(t.directions).includes(d.id))
      .flatMap((d) => d.standards.flatMap((s) => Object.keys(s.where ?? {}))),
  )
  for (const key of Object.keys(context)) {
    // region is the CLI's own key (a report of <file>#<region>), so it needs no "where".
    if (!used.has(key) && key !== 'region') fail(path, `context key "${key}" is used by no "where" of its directions`)
  }
  checkWorkspace(path, list(t.workspace))
  // There are no rounds (Nanda, 2026-11-08): a maker has its tries, and a mistake is evaluated.
  if (t.maxRounds !== undefined) fail(path, 'maxRounds is gone: when the tries of a maker end on a fault, the high role evaluates the mistake; leave maxRounds out')
  // The tasks that this task needs: their ids; each one is accepted before this task reports.
  const needs = list(t.needs).map(String)
  for (const id of needs) if (!/^t\d+$/.test(id)) fail(path, `needs names "${id}", which is not a task id (t..)`)
  // The starting point: an earlier result that the maker starts from (not a result of this task).
  if (t.from !== undefined && !/^r\d+$/.test(String(t.from))) fail(path, `from names "${t.from}", which is not a result id (r..)`)
  return {
    name: t.name, text: t.text, directions: list(t.directions), context, needs,
    // The keys that the file names: a remake keeps the others from the task that it replaces.
    named: ['directions', 'context', 'needs', 'workspace'].filter((key) => t[key] !== undefined),
    ...(t.from !== undefined ? { from: String(t.from) } : {}),
    workspace: list(t.workspace), references: list(t.references).map(String),
  }
}

// A workspace path is relative and stays inside the project.
export function checkWorkspace(where, workspace) {
  for (const w of workspace) {
    if (typeof w?.source !== 'string' || typeof w?.path !== 'string') {
      fail(where, 'each workspace entry needs a source and a path')
    }
    if (w.path.startsWith('/') || w.path.split('/').includes('..')) fail(where, `workspace ${w.path} is outside the project`)
    // One file has one name: the file queue and the same-files checks compare names.
    const plain = posix.normalize(w.path).replace(/\/+$/, '') || '.'
    if (plain !== w.path) fail(where, `workspace ${w.path} names ${plain}; write it as ${plain}, so that one file has one name`)
  }
}

export const TASK_TEMPLATE = `name: <a short name>
text: <what to make, in one or two sentences>
directions: [<direction id>]
context: {}            # keys that a standard's "where" uses, for example { region: introduction }
workspace:
  - { source: <name>, path: <file or folder>, base: <branch, for code>, verify: "<command; exit 0 when the work is ready>" }
references: []         # files or sections to read, for example docs/facts.md#dedupe
`
