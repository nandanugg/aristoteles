// The work CLI. main(argv, io) runs one command; io holds everything outside the process
// (files, the clock, the terminal, git, random, env), so the tests can run it in-process.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { kind } from './engine.js'
import { TASK_TEMPLATE, checkWorkspace, fileHashes, readApprovedBy, readConfig, readDirection, readTask, sha } from './config.js'
import { changedSince, checkOutput, digestOf, regionsInside, regionsOf, snapshotOf } from './digest.js'
import { rowsOf } from './aristoteles.js'
import { LOCK, fetchFolder, localDate, readLock, writeLock } from './company.js'
import { openStore } from './store.js'
import {
  RELAY_AT_ONCE, apply, findRule, idOf, lookup, replay, roleHash, versionId,
} from './state.js'
import {
  clock, describeInner, fileTurn, gitSources, latestResult, nextSteps, outputForm, renderBlockers, renderBrief,
  draftWaitsText, pieceNames, renderDirection, renderDraft, renderPiece, renderResult, renderStatus, reviseAgain, stopIdOf, renderTaskTree, renderWaiting, rulesFor, staleOf, waitersOf,
} from './render.js'

const refuse = (message, next) => Object.assign(new Error(message), { next })

// The file that a --file or --answers flag names, read from the project folder.
function readArgFile(ctx, file) {
  const path = join(ctx.io.cwd, file)
  if (!existsSync(path) || !statSync(path).isFile()) throw refuse(`there is no file ${file} in ${ctx.io.cwd}`)
  return readFileSync(path, 'utf8')
}

// --key=value flags keep their order, so a --breaks belongs to the --point before it.
function parse(argv) {
  const positional = []
  const flags = []
  const broken = [] // a word that starts with -- but is no flag, such as --max_attempts=1
  for (const arg of argv) {
    const m = arg.match(/^--([a-z-]+)(?:=(.*))?$/s)
    if (m) flags.push([m[1], m[2] ?? true])
    else if (arg.startsWith('--')) broken.push(arg)
    else positional.push(arg)
  }
  const one = (key) => flags.findLast(([k]) => k === key)?.[1]
  const all = (key) => flags.filter(([k]) => k === key).map(([, v]) => v)
  return { positional, flags, broken, one, all }
}

const measure = (state, a) => renderBrief(state, a, { token: 'a0.00000000000000000000000000' }).length

function context(io) {
  return {
    io,
    store: () => openStore(io),
    // A read shows the state at the real time (state.now), so an until that passed has ended.
    // Each read of the engine takes this time.
    read() {
      const store = openStore(io)
      try {
        const state = replay(store.events(), { measure })
        state.cwd = io.cwd
        state.now = io.now()
        return state
      } finally {
        store.close()
      }
    },
  }
}

// One write: replay, run the CLI checks in build, let the engine check by applying the
// event, then append it. Returns the state after the event, and the event id.
function write(ctx, build, token) {
  const store = ctx.store()
  try {
    let after
    const id = store.write((events) => {
      const state = replay(events, { measure })
      state.cwd = ctx.io.cwd
      state.now = ctx.io.now()
      state.changed = (result) => changedSince(ctx.io.cwd, result)
      // The caller's assignment is open, and has a claim where the act needs one, before
      // any check of the act itself.
      const rule = GUARD[ctx.type]
      if (ctx.token && rule) {
        const caller = agent(state, ctx.token)
        needOpen(state, caller)
        if (rule.claim) needClaim(state, caller, ctx.token)
      }
      const event = build(state)
      if (!event) return undefined
      event.at ??= ctx.io.now()
      if (event.channel === 'agent') guard(state, event, token ?? ctx.token)
      state.checking = true
      apply(state, { ...event, id: events.length ? events.at(-1).id + 1 : 1 })
      after = { state, event }
      return event
    }, (project) => rowsOf(after.state, project))
    return { ...after, id }
  } finally {
    store.close()
  }
}

// The caller: an agent by its token, or the person at a terminal.
const isToken = (s) => /^a\d+\./.test(String(s ?? ''))
function agent(state, token) {
  const m = String(token ?? '').match(/^(a\d+)(?:\.([a-z0-9]+))?$/)
  if (token === undefined) throw refuse('this command needs the assignment token that assign printed (a7.<secret>); the person reads work waiting')
  if (!m) throw refuse(`"${token}" is not an assignment token (a7.<secret>)`)
  if (!m[2]) throw refuse(`${m[1]} is an id; the command needs the token that assign printed (${m[1]}.<secret>)`)
  const a = lookup(state, m[1], ['a'])
  if (state.meta.get(a).secret !== sha(m[2])) throw refuse(`the token of ${m[1]} is wrong`)
  return a
}
// The prototype trusts the terminal and git user.name; DESIGN section 4 states the limit.
function person(ctx, state, confirm) {
  const { io } = ctx
  if (!io.isTTY) {
    throw refuse('this is a person command; a person runs it at a terminal',
      'an agent passes its token first: work <command> <token> ...')
  }
  if (Object.keys(io.env ?? {}).some((k) => k.startsWith('GIT_CONFIG'))) {
    throw refuse('GIT_CONFIG variables are set; a person command reads user.name from the git config files only')
  }
  const name = io.gitUser()
  if (state && !state.config.people.includes(name)) {
    throw refuse(`${name} (git user.name) is not in the people of work.yaml`)
  }
  if (confirm) {
    if (confirm.show) io.out(confirm.show)
    const typed = io.readLine(`Type "${confirm.word}" to confirm: `)
    if (typed?.trim() !== confirm.word) throw refuse('not confirmed; nothing was stored')
  }
  return name
}
const tierOf = (a) => a.role.tier
const upTo = (a) => (a.parent ? 'your parent' : 'the person')
// A low agent with no claim either has not read its brief yet, or its one unit is done.
const needClaim = (state, a, token) => {
  if (state.meta.get(a).claim) return
  const read = state.engine.read
  // Its one unit: a result or a review. An accepted result uses no attempt, so attempts do not show it.
  const done = read.results.some((r) => r.by === a) || read.reviews.some((r) => r.by === a)
  if (tierOf(a) === 'low' && done) {
    throw refuse('your unit is done; this assignment has no open brief', `STOP: ${upTo(a)} continues. Run work brief ${token} only if ${upTo(a)} gives you this token again`)
  }
  throw refuse('you have no brief in this attempt', `work brief ${token}; it takes the snapshot that your work follows`)
}
const needOpen = (state, a) => {
  if (a.finished) throw refuse(`${idOf(state, a)} is finished`, `do no more work for it; tell ${upTo(a)}`)
}

// The checks that hold for every act of an agent, in one place: the assignment is open, it
// has a claim where the act needs one, and each target is inside its task tree.
const GUARD = {
  assign: { claim: true, targets: ['task'] },
  report: { claim: true },
  review: { claim: true, targets: ['target'] },
  raise: { targets: ['result'] },
  ask: {},
  answer: { targets: ['q'] },
  note: {},
  suggest: {},
  source: {},
  checkpoint: { targets: ['task'] },
  waive: { claim: true, targets: ['result'] },
  'task.split': { claim: true, targets: ['task'] },
  'task.close': { claim: true, targets: ['task'] },
  'task.remake': { claim: true, targets: ['task'] },
  'direction.revise': { claim: true },
  'direction.new': { claim: true },
  relay: { claim: true },
  release: { targets: ['a'] },
  finish: { targets: ['a'] },
  'role.fit': {},
  evaluate: { claim: true },
  grant: {},
  revoke: {},
}
function guard(state, event, token) {
  const rule = GUARD[event.type]
  if (!rule) return
  const a = lookup(state, event.who, ['a'])
  needOpen(state, a)
  if (rule.claim) needClaim(state, a, token)
  for (const field of rule.targets ?? []) {
    const id = event.data[field]
    if (!id) continue
    // A draft has no task: anyone outside its reviser's tree may review it.
    const record = lookup(state, id, ['t', 'r', 'q', 'a', 'd', 'ev'])
    const task = record[kind] === 'Task' ? record : record.task ?? record.stops?.[0]
    if (task && !state.engine.read.within(task, a.task)) {
      throw refuse(`${id} is outside the task tree of ${idOf(state, a)} (${idOf(state, a.task)})`)
    }
  }
}
const caller = (ctx, state, token, confirm) => {
  const by = token ? agent(state, token) : undefined
  return { by, who: by ? idOf(state, by) : person(ctx, state, confirm), channel: by ? 'agent' : 'terminal' }
}
const inTree = (state, record, a) => {
  const task = record[kind] === 'Task' ? record : record.task ?? record.stops?.[0]
  return task && state.engine.read.within(task, a.task)
}
const belowOrSame = (a, root) => {
  for (let x = a; x; x = x.parent) if (x === root) return true
  return false
}

function checkHashes(ctx, state, token) {
  if (!state.config) return
  const hashes = fileHashes(ctx.io.cwd)
  const changed = Object.keys({ ...hashes, ...state.hashes }).filter((f) => hashes[f] !== state.hashes[f])
    .map((f) => (state.hashes[f] === undefined ? `${f} (new, not in the store: delete it)` : f))
  if (!changed.length) return
  let low = false
  try {
    low = token && tierOf(agent(state, token)) === 'low'
  } catch {}
  // A restore writes back the stored files; it does not remove a file that the store never had.
  const fresh = Object.keys(hashes).filter((f) => state.hashes[f] === undefined)
  const fix = [...(fresh.length ? [`the person deletes ${fresh.join(', ')}`] : []),
    ...(fresh.length < changed.length ? ['the person runs work config restore (back to the stored files), or work config apply (role words only)'] : [])]
  const lowFix = [...(fresh.length ? [`the person deletes ${fresh.join(', ')}`] : []),
    ...(fresh.length < changed.length ? ['the person restores it'] : [])]
  throw refuse(`${changed.join(', ')} changed since the stored config`, low
    ? `work raise ${token} --reason="${changed.join(', ')} changed; ${lowFix.join('; ')}", then STOP`
    : fix.join('; '))
}

// The directions that a task may name: each with a version, and its current standards.
const officialDirections = (state) =>
  Object.values(state.directions).map((d) => ({ id: d.id, standards: state.engine.read.current(d).standards }))

// One evidence line: <rule id> | <where> | <what>, or <where> | <what> for what no rule names.
function evidenceOf(values) {
  return values.map((v) => {
    const parts = String(v).split('|').map((p) => p.trim())
    if (![2, 3].includes(parts.length) || parts.some((p) => !p)) {
      throw refuse(`--evidence="${v}" needs <rule id> | <where you looked> | <what you saw>, or, with no rule, <where you looked> | <what you saw>`)
    }
    const [rule, where, what] = parts.length === 3 ? parts : [undefined, ...parts]
    return { ...(rule ? { rule } : {}), where, what }
  })
}
const evidenceFlag = (e) => `--evidence="${e.rule ? `${e.rule} | ` : ''}${e.where} | ${e.what}"`
// An agent's evidence names the place it looked (the file, the repo, or the region of the
// result) and says what it saw in at least three words. The refusal gives the command again,
// so the checker corrects the one field.
function checkEvidence(result, evidence, again) {
  const [file, region] = result.output.split(/[#@]/)
  const base = file.split('/').at(-1)
  evidence.forEach((e, i) => {
    const about = e.rule ?? 'the result'
    const where = e.where.toLowerCase()
    if (![file, base, region].filter(Boolean).some((x) => where.includes(x.toLowerCase()))) {
      throw refuse(`the evidence for ${about} says where "${e.where}"; name the place in ${result.output}`,
        again && `correct the place and run the review again: ${again(i, { where: `<the place in ${result.output} where you looked>` })}`)
    }
    const realWords = e.what.split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w))
    if (realWords.length < 3 || e.what.trim().toLowerCase() === e.where.trim().toLowerCase()) {
      throw refuse(`the evidence for ${about} says what "${e.what}"; say what you saw, in a sentence of words`,
        again && `correct what you saw and run the review again: ${again(i, { what: '<what you saw, in a sentence>' })}`)
    }
  })
}

function pointsOf(flags) {
  const points = []
  for (const [key, value] of flags) {
    if (key === 'point') points.push({ text: String(value) })
    if (key === 'breaks') {
      if (!points.length) throw refuse('--breaks belongs to the --point before it; put the --point first')
      points.at(-1).breaks = String(value)
    }
  }
  return points
}

// The reviewed work must be the reported work.
function checkDigest(ctx, state, target, by, token) {
  if (target[kind] !== 'Result' || !changedSince(ctx.io.cwd, target)) return
  const id = idOf(state, target)
  throw refuse(`the work changed after ${id} was reported`, by && tierOf(by) === 'low'
    ? `work raise ${token} --result=${id} --reason="the work changed after ${id} was reported", then STOP`
    : 'the maker reports it again as a new attempt; review that result')
}

// Splits a program's run line into words; double quotes keep spaces. No shell runs it.
const words = (line) => [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])

// Programs (gates) run after each report of a role that they review: in the workspace
// folder, or in a clean checkout of the reported commit. A program that cannot run, or runs
// too long, records a reject; its full output stays in .work/runs/.
function runProgram(ctx, c, result) {
  const workspace = result.task.aiDescription.workspace?.[0]
  const commit = result.output.match(/^([^#]+)@([0-9a-f]{7,40})$/)
  let folder = join(ctx.io.cwd, workspace?.path ?? '.')
  let tree
  try {
    if (commit) {
      tree = mkdtempSync(join(tmpdir(), 'work-gate-'))
      const add = Bun.spawnSync(['git', '-C', join(ctx.io.cwd, commit[1]), 'worktree', 'add', '--detach', tree, commit[2]])
      if (add.exitCode !== 0) return { ok: false, text: `could not check out ${commit[2]}: ${add.stderr.toString().trim()}` }
      folder = tree
    }
    const argv = words(c.run).map((w) => w.replace('{workspace.path}', folder).replace('{output}', result.output))
    const cwd = existsSync(folder) && statSync(folder).isDirectory() ? folder : ctx.io.cwd
    const seconds = c.timeout ?? 120
    const run = Bun.spawnSync(argv, { cwd, timeout: seconds * 1000 })
    const output = run.stdout.toString() + run.stderr.toString()
    if (run.exitCode === null) return { ok: false, text: `timed out after ${seconds} s`, output }
    return { ok: run.exitCode === 0, text: run.exitCode === 0 ? 'exit 0' : `exit ${run.exitCode}`, output }
  } catch (error) {
    return { ok: false, text: `could not run: ${error.message}` }
  } finally {
    if (tree) Bun.spawnSync(['git', '-C', join(ctx.io.cwd, commit[1]), 'worktree', 'remove', '--force', tree])
  }
}

function runPrograms(caller, state, result, out) {
  // A program writes as the system, not as the agent whose report started it.
  const ctx = { ...caller, token: undefined, type: undefined }
  const maker = result.by.role
  for (const [name, role] of Object.entries(state.roles)) {
    const c = role.config
    if (c.kind !== 'program' || c.on !== 'report') continue
    if (!role.acts.some((a) => a.act === 'Review' && a.resultsOf.includes(maker))) continue
    const rid = idOf(state, result)
    const tid = idOf(state, result.task)
    // A program checks only its rules that the task has now; a change can remove them.
    const checks = c.checks.filter((id) => state.engine.read.rulesOf(result.task).some((r) => r.id === id))
    if (checks.length === 0) {
      out(`${name} did not run on ${rid}: no direction of ${tid} has its checks (${c.checks.join(', ')}) now`)
      continue
    }
    const run = runProgram(ctx, c, result)
    const log = join('.work', 'runs', `${rid}-${name}.log`)
    mkdirSync(join(ctx.io.cwd, '.work', 'runs'), { recursive: true })
    writeFileSync(join(ctx.io.cwd, log), run.output ?? run.text)
    const tail = (run.output ?? '').trim().split('\n').filter(Boolean).slice(-3).join(' / ') || '(no output)'
    const where = `${c.run} on ${result.output}`
    const assigned = write(ctx, () => ({
      who: 'system', channel: 'program', type: 'assign',
      data: { task: tid, role: name, secret: sha(`program-${rid}`) },
    }))
    const pid = assigned.state.created[0]
    const data = run.ok
      ? { target: rid, decision: 'accept', evidence: checks.map((rule) => ({ rule, where: `${where}: exit 0`, what: `${tail} (${log})` })) }
      : { target: rid, decision: 'reject', points: [{ text: `${where}: ${run.text}: ${tail} (full output: ${log})`, breaks: checks[0] }] }
    write(ctx, () => ({ who: pid, channel: 'program', type: 'review', data }))
    write(ctx, () => ({ who: 'system', channel: 'program', type: 'finish', data: { a: pid } }))
    out(`${name} ran on ${rid}: ${run.ok ? 'accept' : `reject (${run.text}; ${log})`}`)
  }
}

const FITNESS = () => Bun.YAML.parse(readFileSync(join(import.meta.dir, 'guides', 'fitness.yaml'), 'utf8'))
const VAGUE = ['handle', 'ensure', 'look at', 'deal with', 'manage', 'take care', 'make sure', 'support']

function staticFit(state, roleName, role) {
  const problems = []
  if (role.tier === 'low' && role.acts.length !== 1) problems.push('a low role has exactly one act')
  for (const r of role.responsibilities) {
    const verb = VAGUE.find((v) => r.toLowerCase().includes(v))
    if (verb) problems.push(`"${r}" uses the vague verb "${verb}"; name the exact output and command`)
  }
  if (role.acts.some((a) => a.do) && !role.output) problems.push('a role with a do act names its output form')
  const rules = Object.values(state.directions).flatMap((d) => state.engine.read.current(d).standards.flatMap((s) => s.rules ?? []))
    .filter((r) => r.checkedBy?.role === roleName)
  const limit = state.config.limits[role.tier]?.Review?.rules
  if (limit !== undefined && rules.length > limit) {
    problems.push(`${rules.length} rules name this role; the ${role.tier} limit is ${limit}`)
  }
  return problems
}

// The parts of a split are checked like a task file, and keep the parent's context.
// One file has one name in the store: the file queue and the same-files checks compare names, so
// a workspace path through a link, or in another case than on disk, is refused with its real name.
// A path that does not exist yet is checked through the deepest folder of it that exists.
function checkRealNames(cwd, workspace = []) {
  const root = realpathSync.native(cwd)
  for (const w of workspace) {
    let known = w.path
    while (known !== '.' && !existsSync(join(cwd, known))) known = dirname(known)
    if (known === '.') continue
    const real = relative(root, realpathSync.native(join(cwd, known)))
    if (real.startsWith('..') || isAbsolute(real)) throw refuse(`workspace ${w.path} leads outside the project`)
    const name = known === w.path ? real : join(real, relative(known, w.path))
    if (name !== w.path) throw refuse(`workspace ${w.path} is ${name} on disk; name it ${name}, so that one file has one name`)
  }
}

// On a disk that ignores case, two names that differ only in case are one file: a new workspace
// path takes the case of the name that a task already uses.
function checkCaseTwins(state, workspace = []) {
  const lower = (x) => x.toLowerCase()
  const near = (x, y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
  const names = state.engine.read.tasks.filter((t) => !t.closed).flatMap((t) => (t.aiDescription.workspace ?? []).map((w) => w.path))
  for (const w of workspace) {
    const twin = names.find((n) => near(lower(n), lower(w.path)) && !near(n, w.path))
    if (twin) throw refuse(`workspace ${w.path} and ${twin} differ only in case, and on many disks they are one file; write it as ${twin} has it`)
  }
}

function checkParts(state, task, parts, file) {
  if (!Array.isArray(parts) || parts.length === 0) throw refuse(`${file} must be a list of parts`)
  // A task with a region is one unit of work: a part keeps the region of its task, so a part
  // would own the whole of what its task owns.
  const ownRegion = task.aiDescription.context.region
  if (ownRegion) {
    throw refuse(`${idOf(state, task)} has the region ${ownRegion}, so it is one unit of work; it is not split`,
      `run ${idOf(state, task)} with a medium role, or remake it with no region`)
  }
  const used = new Set(state.engine.read.directionsOf(task)
    .flatMap((d) => state.engine.read.current(d).standards.flatMap((s) => Object.keys(s.when ?? {}))))
  for (const [i, p] of parts.entries()) {
    if (!p?.name || !p?.text) throw refuse(`each part in ${file} needs a name and a text`)
    if (p.maxRounds !== undefined) throw refuse(`part ${p.name}: maxRounds is gone; when the tries of a maker end on a fault, the high role evaluates the mistake`)
    if (p.from !== undefined) lookup(state, String(p.from), ['r'])
    // A part that uses the work of other parts, or changes the same files, runs after them.
    if (p.after !== undefined && !Array.isArray(p.after)) throw refuse(`part ${p.name}: after is a list of part names, like after: [Schema]`)
    const above = parts.slice(0, i).map((x) => x?.name)
    if (above.includes(p.name)) throw refuse(`two parts in ${file} are named ${p.name}; each part needs its own name`)
    const unknown = (p.after ?? []).find((n) => !above.includes(n))
    if (unknown) throw refuse(`part ${p.name}: after names "${unknown}", which is not a part above it in ${file}`)
    for (const [key, value] of Object.entries(p.context ?? {})) {
      // region is the CLI's own key (a report of <file>#<region>, and who owns a region), so a
      // part may name one with no "when" that uses it.
      if (!used.has(key) && key !== 'region') throw refuse(`part ${p.name}: context key "${key}" is used by no "when" of its directions`)
      const was = task.aiDescription.context[key]
      if (was !== undefined && was !== value) {
        throw refuse(`part ${p.name} changes the context ${key} from ${was} to ${value}; a part keeps the rules of its task`)
      }
    }
    if (p.workspace !== undefined && (!Array.isArray(p.workspace) || p.workspace.length === 0)) {
      throw refuse(`part ${p.name} has an empty workspace; leave workspace out, and the part keeps its task's workspace`)
    }
    if (p.workspace) {
      try {
        checkWorkspace(`part ${p.name}`, p.workspace)
      } catch (error) {
        throw refuse(error.message)
      }
      // A part works in its task's workspace, with the same base.
      const own = task.aiDescription.workspace ?? []
      for (const w of p.workspace) {
        if (!own.some((o) => o.source === w.source && o.path === w.path && o.base === w.base)) {
          throw refuse(`part ${p.name}: workspace ${w.path} is not one of its task's (${own.map((o) => o.path).join(', ') || 'none'}), with the same base`)
        }
      }
    }
  }
  // Parts that share a document file own their regions of it, so a report keeps the regions of
  // the others: in one file, every part has its own region. A folder (a git repo) has no regions;
  // its parts make their own commits, and the task merges them.
  const regionOf = (p) => p.context?.region ?? task.aiDescription.context.region
  const filesOf = (p) => (p.workspace ?? task.aiDescription.workspace ?? []).map((w) => w.path)
  const isFolder = (f) => existsSync(join(state.cwd ?? '.', f)) && statSync(join(state.cwd ?? '.', f)).isDirectory()
  for (const f of new Set(parts.flatMap(filesOf))) {
    const sharing = parts.filter((p) => filesOf(p).includes(f))
    if (isFolder(f)) continue
    const bare = sharing.filter((p) => !regionOf(p))
    if (sharing.length > 1 && bare.length) {
      throw refuse(`the parts ${sharing.map((p) => p.name).join(', ')} share ${f}, and ${bare.map((p) => p.name).join(', ')} ${bare.length > 1 ? 'have' : 'has'} no region; each part needs its own region of the file, so no part changes the work of another`,
        `give each part its own region (context: { region: <heading id> }), or run ${idOf(state, task)} as one task`)
    }
    // No region of a part lies inside the region of another part (a sub-heading of it).
    const heads = existsSync(join(state.cwd ?? '.', f)) ? regionsOf(readFileSync(join(state.cwd ?? '.', f), 'utf8')) : []
    const span = (p) => heads.find((h) => h.slug === regionOf(p))
    const inner = sharing.find((p) => sharing.some((q) => q !== p && span(p) && span(q) && span(p).start > span(q).start && span(p).start < span(q).end))
    if (inner) {
      const outer = sharing.find((q) => q !== inner && span(q) && span(inner).start > span(q).start && span(inner).start < span(q).end)
      throw refuse(`the region ${regionOf(inner)} of ${f} lies inside the region ${regionOf(outer)}; two parts may not own one piece of the file`,
        'give each part a region that no other part holds')
    }
    const twin = sharing.find((p, i) => regionOf(p) && sharing.findIndex((q) => regionOf(q) === regionOf(p)) !== i)
    if (twin) {
      throw refuse(`two parts of ${idOf(state, task)} have the region ${regionOf(twin)} of ${f}; a region is the work of one task`,
        `give each part its own region, or run ${idOf(state, task)} as one task with a medium role`)
    }
  }
}

// The file of a new direction: the whole direction. Each says is any markdown; headers inside it
// only divide it, so that a role can read one piece (guides/writing.md).
const DIRECTION_TEMPLATE = `write a file like this, then run the command again:
  id: <direction id>
  name: <a short name>
  owner: <a person of work.yaml; the owner accepts the first version>
  from: [<the principles that ground it: Logos, Pathos, Ethos, Mythos, Oikos, Nomos, Telos, Kairos, Mnēmē, Topoi, Aporia>]
  says: |
    <what the direction asks for, in any markdown>
  approvedBy: <optional; who accepts the next versions: roles, and the owner>
  standards:
    - id: <standard id>
      says: |
        <how the output looks, in any markdown>
      rules:
        - { id: <rule id>, says: <one check>, checkedBy: <role> }`

// A new direction (Nanda, 2026-11-10): a model writes the whole of it, and its owner accepts it.
// The model is a high role (by its token), or a model run outside any task (--by=<its name>),
// such as the skill that reads an app. A person gives direction in words: work suggest.
function newDirection(ctx, args, rest) {
  const token = isToken(rest[0]) ? rest.shift() : undefined
  const runName = args.one('by')
  if (!token && ctx.io.isTTY) {
    throw refuse('the person gives direction in words: work suggest --says="<the direction that is missing>"; a model drafts it, and you accept or reject it')
  }
  const file = args.one('file')
  if (!file) throw refuse('a new direction needs --file=<direction.yaml>', DIRECTION_TEMPLATE)
  if (token && runName !== undefined) throw refuse('--by names a model run outside any task; an assignment is named by its token')
  if (!token && !/^[a-z][a-z0-9-]*$/.test(String(runName ?? ''))) {
    throw refuse('a model run outside any task names itself: --by=<its name in lower case>',
      `run it again with --by, for example: work direction new --file=${file} --by=assess`)
  }
  const raw = Bun.YAML.parse(readArgFile(ctx, file)) ?? {}
  // A run outside any task has no token; its id is the time of its act.
  const run = token ? undefined : { name: runName, id: ctx.io.now() }
  const done = write(ctx, (state) => {
    checkHashes(ctx, state)
    let who = `${run?.name} run ${run?.id}`
    if (token) {
      const by = agent(state, token)
      needOpen(state, by)
      needClaim(state, by, token)
      if (tierOf(by) !== 'high') throw refuse(`a ${tierOf(by)} role does not draft directions; suggest it: work suggest ${token} --says="..."`)
      who = idOf(state, by)
    }
    const direction = readDirection(file, raw, state.config.people)
    direction.approvedBy = readApprovedBy(file, raw, state.config.roles, state.config.people)
    const answers = args.one('answers') ? String(args.one('answers')).split(',') : []
    return { who, channel: token ? 'agent' : 'run', type: 'direction.new', data: { direction, answers, why: args.one('why'), ...(run ? { run } : {}) } }
  }, token)
  const state = done.state
  const did = state.created[0]
  const draft = lookup(state, did, ['d'])
  const answering = draft.answers.length ? `, answering ${draft.answers.map((y) => idOf(state, y)).join(', ')}` : ''
  const writer = token ? '' : `, by ${run.name} (a model run outside any task)`
  return [`${did} drafted: the new direction ${draft.of.id} (${draft.of.name})${writer}${answering}; it waits for the accept of ${draftWaitsText(state, draft)}.`,
    `next: work direction show ${did}; ${draft.of.owner.name} runs work review ${did} accept --evidence="<where you read in ${did}> | <what you saw>", or reject --reason="<why>"`]
}

// A review of a draft of a direction, or of an evaluation: one accept with evidence, or one
// reject with a reason. The accept that meets the deciders of a draft makes it official in
// aristoteles. The person types "accept" for a draft, because the accept can make it official.
function reviewDecision(ctx, args, token, targetId, decision) {
  const isDraft = targetId.startsWith('d')
  const done = write(ctx, (state) => {
    checkHashes(ctx, state, token)
    const target = lookup(state, targetId, ['d', 'ev'])
    const confirm = !token && isDraft && decision === 'accept'
      ? { word: 'accept', show: `accept ${targetId}:\n${renderDraft(state, target)}` } : undefined
    const { by, who, channel } = caller(ctx, state, token, confirm)
    if (by && tierOf(by) === 'low') throw refuse(`a low role does not review ${isDraft ? 'drafts of directions' : 'evaluations'}`)
    const data = { target: targetId, decision, reason: args.one('reason') }
    if (decision === 'accept') {
      data.evidence = evidenceOf(args.all('evidence'))
      if (!data.evidence.length) throw refuse(`an accept of ${targetId} needs --evidence="<where you read in it> | <what you saw there>"`)
      for (const e of data.evidence) if (e.rule) findRule(state, e.rule)
    } else if (!data.reason?.trim()) throw refuse(`a reject of ${targetId} needs --reason="<why>"`)
    return { who, channel, type: 'review', data }
  }, token)
  const state = done.state
  const read = state.engine.read
  const vid = state.created[0]
  const target = lookup(state, targetId, ['d', 'ev'])
  if (!isDraft) {
    const tid = idOf(state, read.stopTask(target.answers))
    return [decision === 'accept' ? `${vid}: ${targetId} is accepted; it counts for ${tid}.` : `${vid}: ${targetId} is rejected; ${tid} waits for a new evaluation.`]
  }
  const version = read.madeBy(target)
  if (version) {
    return [`${vid}: accept of ${targetId}. ${targetId} is official: ${versionId(version)}.`, ...followCommit(ctx, version),
      ...afterVersion(state, version),
      'next: running agents keep their snapshot; each new work brief follows it.']
  }
  if (decision === 'reject') {
    if (!read.vetoOf(target)) return [`${vid}: reject of ${targetId}.`, `${targetId} stays open; after this Reject, only the accept of ${target.of.owner.name} makes it official.`]
    const again = reviseAgain(state, target)
    return [`${vid}: reject of ${targetId}.`, `${targetId} is ended; ${again.text}.`, ...(again.step ? [`next: ${again.step}`] : [])]
  }
  return [`${vid}: accept of ${targetId}; it waits for the accept of ${draftWaitsText(state, target)}.`]
}
const findRelay = (state, id) => state.events.find((e) => `e${e.id}` === id)?.data
// What an official version leaves to do: the results that it makes old, and the tasks that
// no open assignment works on (no work next can show them).
function afterVersion(state, version) {
  const read = state.engine.read
  const tasks = read.tasks.filter((t) => !t.closed && read.directionsOf(t).includes(version.of))
  const old = tasks.map((t) => latestResult(state, t)).filter(Boolean)
    .filter((r) => state.engine.blockerItems(r, state.now).some((i) => i.kind === 'old-version'))
  const idle = tasks.filter((t) => !state.engine.taskAccepted(t, state.now) &&
    !read.assignments.some((x) => !x.finished && read.within(t, x.task)))
  return [
    ...(old.length ? [`now under an old version: ${old.map((r) => `${idOf(state, r)} (${idOf(state, r.task)})`).join(', ')}; ` +
      'each needs a check under the new version (work next shows it).'] : []),
    ...idle.map((t) => `no open assignment works on ${idOf(state, t)}: work assign ${idOf(state, t)} --role=<role>`),
  ]
}

const COMMANDS = {
  init(ctx) {
    const name = person(ctx, undefined)
    const { config, hashes, texts } = readConfig(ctx.io.cwd)
    if (!config.people.includes(name)) throw refuse(`${name} (git user.name) is not in the people of work.yaml`)
    const store = openStore(ctx.io, { create: true })
    try {
      store.write((events) => {
        if (events.length) throw refuse('the store exists; use work config apply')
        return { at: ctx.io.now(), who: name, channel: 'terminal', type: 'config', data: { config, hashes, texts } }
      })
    } finally {
      store.close()
    }
    const roles = Object.keys(config.roles)
    return [`store made for ${config.project} in aristoteles: ${roles.length} roles, and no direction yet.`,
      `next: work role fit <role> for each role (${roles.filter((r) => config.roles[r].kind !== 'program').join(', ')}); ` +
        'a model drafts each direction (work direction new --file=<direction.yaml> --by=<model>), and you accept it; ' +
        'then work task open --file=<task.yaml>']
  },

  config(ctx, args) {
    const sub = args.positional[0]
    if (sub === 'restore') {
      const state = ctx.read()
      person(ctx, state, { word: 'restore', show: `restore ${Object.keys(state.texts).join(', ')} to the stored text` })
      for (const [file, text] of Object.entries(state.texts)) writeFileSync(join(ctx.io.cwd, file), text)
      return [`restored ${Object.keys(state.texts).join(', ')}.`]
    }
    if (sub !== 'apply') throw refuse('use work config apply|restore')
    const { config, hashes, texts } = readConfig(ctx.io.cwd)
    const done = write(ctx, (state) => {
      const name = person(ctx, state, { word: 'apply' })
      const text = {}
      const other = []
      const old = state.config
      for (const key of ['project', 'people', 'limits', 'decide']) {
        if (JSON.stringify(config[key]) !== JSON.stringify(old[key])) other.push(key)
      }
      for (const [roleName, role] of Object.entries(config.roles)) {
        const was = old.roles[roleName]
        if (!was) { other.push(`new role ${roleName}`); continue }
        const { description, intro, responsibilities, output, ...rest } = role
        const { description: d0, intro: i0, responsibilities: r0, output: o0, ...rest0 } = was
        if (JSON.stringify(rest) !== JSON.stringify(rest0)) other.push(`the acts or tier of ${roleName}`)
        if (JSON.stringify([description, intro, responsibilities, output]) !== JSON.stringify([d0, i0, r0, o0])) {
          text[roleName] = { description, intro, responsibilities, output }
        }
      }
      if (other.length) {
        throw refuse(`work config apply changes only the words of roles; this also changes: ${other.join(', ')}`,
          'the prototype makes a new store for such a change (DESIGN.md section 9)')
      }
      return { who: name, channel: 'terminal', type: 'config.text', data: { roles: text, hashes, texts } }
    })
    const changed = Object.keys(done.event.data.roles)
    return [`applied: ${changed.length ? changed.join(', ') : 'no role words changed'}; each changed role needs a new work role fit.`]
  },

  task(ctx, args) {
    const [sub, ...rest] = args.positional
    if (sub === 'open') {
      const file = args.one('file')
      if (!file) return [TASK_TEMPLATE.trimEnd(), '', 'Save it as a file, then: work task open --file=<file>']
      const done = write(ctx, (state) => {
        checkHashes(ctx, state)
        const name = person(ctx, state)
        const task = readTask(file, readArgFile(ctx, file), officialDirections(state))
        checkRealNames(ctx.io.cwd, task.workspace)
        checkCaseTwins(state, task.workspace)
        return { who: name, channel: 'terminal', type: 'task.open', data: { task } }
      })
      const tid = done.state.created[0]
      return [`${tid} opened: ${done.event.data.task.name}`, `next: work assign ${tid} --role=<role>`]
    }
    if (sub === 'show' || sub === 'tree') {
      const state = ctx.read()
      const task = lookup(state, rest[0], ['t'])
      if (sub === 'tree') return [renderTaskTree(state, task)]
      const t = task.aiDescription
      const latest = latestResult(state, task)
      return [`${idOf(state, task)} ${task.name} · ${state.engine.Task.state(task, state.now)} · owner ${task.owner.name}`,
        `text: ${t.text}`, ...(t.partOf ? [`part of: ${t.partOf}`] : []),
        `directions: ${t.directions.map((d) => d.id).join(', ') || 'none'}`,
        ...(task.needs.length ? [`needs: ${task.needs.map((n) => idOf(state, n)).join(', ')}`] : []),
        ...(task.replaces ? [`replaces ${idOf(state, task.replaces)}`] : []),
        ...(task.closed?.replacedBy ? [`closed as replaced by ${idOf(state, task.closed.replacedBy)}`] : []),
        ...(latest ? [renderBlockers(state, latest)] : [])]
    }
    if (sub === 'split' || sub === 'close' || sub === 'remake') {
      const token = isToken(rest[0]) ? rest.shift() : undefined
      const done = write(ctx, (state) => {
        checkHashes(ctx, state)
        const { by, who, channel } = caller(ctx, state, token)
        if (by) {
          needClaim(state, by, token)
          if (tierOf(by) !== 'high') throw refuse(`a ${tierOf(by)} role does not ${sub} tasks`, `work raise ${token} --reason="..."`)
        }
        const task = lookup(state, rest[0], ['t'])
        if (by && !state.engine.read.mayChange(by, task, state.now)) {
          throw refuse(`${idOf(state, by)} (${by.role.role}) has no change act on ${rest[0]}`,
            `work raise ${token} --reason="a change grant on ${rest[0]}, to ${sub} it"`)
        }
        // The engine refuses these acts; here the refusal gets its ids and its next line.
        const read = state.engine.read
        const remakeLine = (tid) => `work task remake ${token ? `${token} ` : ''}${tid} --file=<task.yaml> --reason="<how the scope changed>"`
        if (sub === 'close') {
          // A needed task is not closed: the scope of the task that needs it changed.
          const needer = read.neederOf(task)
          if (needer) {
            const nid = idOf(state, needer)
            throw refuse(`${nid} needs ${idOf(state, read.tasks.find((t) => needer.needs.includes(t) && read.within(t, task)))}; ` +
              `without it the scope of ${nid} changes: remake ${nid}`, remakeLine(nid))
          }
          // The person may close a part with their own point; an agent may not drop it.
          const personReject = by && read.personRejects(task, { tree: true })[0]
          if (personReject) {
            const on = idOf(state, personReject.of.task ?? personReject.of)
            throw refuse(`${idOf(state, personReject)} is the person's open Reject on ${on}; a close would drop it`,
              `work raise ${token} --reason="${on} has the person's open point ${idOf(state, personReject)}"`)
          }
          return { who, channel, type: 'task.close', data: { task: rest[0], reason: args.one('reason') } }
        }
        if (sub === 'remake') {
          const file = args.one('file')
          if (!file) throw refuse('a remake needs --file=<task.yaml>: the new task, as for work task open', remakeLine(rest[0]))
          const t = readTask(file, readArgFile(ctx, file), officialDirections(state))
          checkRealNames(ctx.io.cwd, t.workspace)
          checkCaseTwins(state, t.workspace)
          return { who, channel, type: 'task.remake', data: { task: rest[0], file: t, reason: args.one('reason'), review: args.one('review') } }
        }
        const point = by && read.personRejects(task).find((r) => !r.breaks && !r.redo)
        if (point && !args.one('review')) {
          const pid = idOf(state, point)
          throw refuse(`${pid} is the person's open point on ${rest[0]}: "${point.reason}"; only that person's split answers it`,
            `work raise ${token} --reason="${pid} may need a split: work task split ${rest[0]} --file=<parts.yaml> --review=${pid}"`)
        }
        const file = args.one('file')
        if (!file) {
          throw refuse('a split needs --file=<parts.yaml>, a list of parts like:\n' +
            '  - { name: Design, text: Write the design., context: { region: design } }\n' +
            '  - { name: Failure, text: Write the failure cases., context: { region: failure } }')
        }
        const parts = Bun.YAML.parse(readArgFile(ctx, file))
        checkParts(state, task, parts, file)
        return { who, channel, type: 'task.split', data: { task: rest[0], parts, review: args.one('review') } }
      })
      if (sub === 'close') return [`${rest[0]} closed.`]
      if (sub === 'remake') {
        const read = done.state.engine.read
        const made = lookup(done.state, done.state.created[0], ['t'])
        const replaced = read.tasks.filter((t) => t.closed?.replacedBy === made).map((t) => idOf(done.state, t))
        const mid = idOf(done.state, made)
        // A remade top task is outside the tree of every agent of the old one: the person assigns it.
        const by = token ? agent(done.state, token) : undefined
        if (by && !read.within(made, by.task)) {
          return [`${rest[0]} is remade as ${mid}; closed as replaced: ${replaced.join(', ')}.`,
            `next: ${mid} is outside your task tree, so ${made.owner.name} assigns it (work waiting --for=${made.owner.name}); ` +
            `work next ${token} lists your finishes`]
        }
        return [`${rest[0]} is remade as ${mid}; closed as replaced: ${replaced.join(', ')}.`,
          `next: split ${mid} or assign it. To start from old work, name it in the task or part file ` +
          '(from: <result>); its maker starts there, and its result is new work.']
      }
      return [`${rest[0]} split into ${done.state.created.join(', ')}.`,
        `next: assign each part; ${rest[0]} needs them, so its own result comes after every part is accepted.`]
    }
    throw refuse('use work task open|show|tree|split|close|remake')
  },

  assign(ctx, args) {
    const rest = [...args.positional]
    const token = isToken(rest[0]) ? rest.shift() : undefined
    const [taskId] = rest
    const roleName = args.one('role')
    const secret = ctx.io.random()
    const data = {
      task: taskId, role: roleName, secret: sha(secret),
      maxAttempts: args.one('max-attempts') !== undefined ? Number(args.one('max-attempts')) : undefined,
    }
    const build = (state) => {
      checkHashes(ctx, state)
      const role = state.roles[roleName]
      if (!role) throw refuse(`there is no role "${roleName}"; work role list`)
      const c = role.config
      if (c.kind === 'program') throw refuse(`${roleName} is a program; it runs on each report by itself`)
      if (state.fits[roleName]?.hash !== roleHash(c)) {
        throw refuse(`${roleName} has no fit record for its current words`,
          `work role fit ${roleName}, answer the questions, then work role fit ${roleName} --answers=<file>`)
      }
      // A maker that writes a file or a commit writes it in its task's workspace; with none, it
      // would write outside the file queue and the same-files checks.
      const task = lookup(state, taskId, ['t'])
      const filePart = (c.output ?? '').split(/[#@]/)[0]
      const namesFile = filePart === '<file>' || filePart === '<repo>' || (filePart !== '' && !filePart.startsWith('<') && !filePart.startsWith('"'))
      if (role.acts.some((x) => x.act === 'Do') && namesFile && !task.aiDescription.workspace?.length) {
        throw refuse(`${taskId} names no workspace, and ${roleName} writes ${c.output}; the person opens the task with its workspace (work task remake)`)
      }
      const { by, who, channel } = caller(ctx, state, token)
      if (by) {
        needClaim(state, by, token)
        data.parent = idOf(state, by)
      }
      // The person approves directions, not results: a low role gets its work from a lead,
      // so every result has a decider below the person.
      if (!by && role.tier === 'low') {
        const leads = Object.values(state.roles).filter((r) => r.tier === 'medium' || r.tier === 'high').map((r) => r.role)
        throw refuse(`the person gives work to a medium or high role; ${roleName} is low, so a lead gives it its work`,
          `work assign ${taskId} --role=${leads.join('|') || '<role>'}`)
      }
      return { who, channel, type: 'assign', data }
    }
    if (args.one('dry-run')) {
      const state = ctx.read()
      const event = build(state)
      apply(state, { ...event, at: ctx.io.now() })
      const a = lookup(state, state.created[0], ['a'])
      const size = measure(state, a)
      const limit = a.role.limits?.Assignment?.briefChars
      return [`dry run: the brief of ${roleName} on ${taskId} has ${size} characters` +
        (limit ? `; the ${a.role.tier} limit is ${limit}.` : '.'), 'nothing was stored.']
    }
    const done = write(ctx, build)
    const a = lookup(done.state, done.state.created[0], ['a'])
    const tier = a.role.tier
    const model = { high: 'Opus', medium: 'Sonnet', low: 'Haiku' }[tier]
    // A maker that waits for a file is stored now; its subagent starts at its turn.
    const waits = fileTurn(done.state, a)
    const when = waits ? ` when ${idOf(done.state, waits.before)} finishes (work next says when)` : ''
    return [`${idOf(done.state, a)} · ${roleName} (${tier}) on ${taskId} ${a.task.name}`,
      ...(waits ? [`${idOf(done.state, a)} waits for ${waits.path}: ${idOf(done.state, waits.before)} (${idOf(done.state, waits.before.task)} ` +
        `${waits.before.task.name}) writes it first, and one maker writes a file at a time.`] : []),
      `Start ${model === 'Opus' ? 'an' : 'a'} ${model} subagent${when} with this prompt, and nothing else:`,
      `  Use the work skill. In ${ctx.io.cwd}, run: work brief ${idOf(done.state, a)}.${secret}, and do what the brief says.`,
      'The token is shown only now. Keep it: work next prints "give a new subagent the command of" a later attempt.']
  },

  assignment(ctx, args) {
    if (args.positional[0] !== 'show') throw refuse('use work assignment show <assignment>')
    const state = ctx.read()
    const a = lookup(state, args.positional[1], ['a'])
    // A program reads no brief: it runs its command on each report and records its checks.
    if (a.role.config?.kind === 'program') {
      const c = a.role.config
      return [`${idOf(state, a)} · ${a.role.role} (program) on ${idOf(state, a.task)} ${a.task.name}`,
        `runs "${c.run}" on ${c.on}; checks ${c.checks.join(', ') || 'nothing'}; the CLI starts it, not a subagent`]
    }
    return [renderBrief(state, a, { token: `${idOf(state, a)}.<token>` }), '', '(read-only: no snapshot, no claim)']
  },

  release(ctx, args) {
    const [first, second] = args.positional
    const done = write(ctx, (state) => {
      const { by, who, channel } = caller(ctx, state, isToken(first) ? first : undefined)
      const child = lookup(state, by ? second : first, ['a'])
      if (by && child.parent !== by) throw refuse(`${idOf(state, child)} is not your child`)
      return { who, channel, type: 'release', data: { a: idOf(state, child) } }
    })
    return [`${done.event.data.a} is released; the next work brief claims it.`]
  },

  brief(ctx, args) {
    const token = args.positional[0]
    let refusedText
    const done = write(ctx, (state) => {
      checkHashes(ctx, state, token)
      const a = agent(state, token)
      const meta = state.meta.get(a)
      needOpen(state, a)
      // A medium or high agent may read its brief again; a low claim is one subagent's.
      if (meta.claim && tierOf(a) === 'low') {
        throw refuse(`${meta.id} is claimed since ${clock(meta.claim.at)} by another subagent`, a.parent
          ? `STOP and tell your parent. If that subagent stopped, the parent runs work release <parent token> ${meta.id}`
          : `STOP. If that subagent stopped, the person runs work release ${meta.id}`)
      }
      // One maker writes a file at a time: a maker that waits for its file takes no snapshot yet.
      const waits = fileTurn(state, a)
      if (waits) {
        throw refuse(`${meta.id} waits for ${waits.path}: ${idOf(state, waits.before)} (${idOf(state, waits.before.task)} ` +
          `${waits.before.task.name}) writes it first, and one maker writes a file at a time`,
          `STOP and do not change ${waits.path}. ${a.parent ? 'Your parent' : 'The person'} starts you again when ${idOf(state, waits.before)} finishes`)
      }
      // A mistake is evaluated before new work: a maker of a task that waits for its evaluation, or
      // for the change that it asks for, takes no snapshot yet.
      const stop = state.engine.read.isDo(a.role) && state.engine.read.workStop(a.task, state.now)
      if (stop) throw refuse(stop, `STOP and tell ${a.parent ? 'your parent' : 'the person'}; work next says when the work goes on`)
      // A maker with no attempts left takes no claim: its parent assigns a new maker.
      if (state.engine.read.isDo(a.role) && !state.engine.read.openDo(a)) {
        refusedText = [`${meta.id} has used its ${a.maxAttempts} attempts; it makes no new result.`,
          a.parent ? `STOP and tell your parent: it assigns a new ${a.role.role}.` : `STOP: the person assigns a new ${a.role.role}.`]
        return undefined
      }
      const text = renderBrief(state, a, { token })
      const limit = a.role.limits?.Assignment?.briefChars
      if (limit !== undefined && text.length > limit) {
        const parts = text.split(/\n(?=[A-Z]{3,} )/)
        const largest = parts.map((p) => [p.split(' ')[0], p.length]).sort((x, y) => y[1] - x[1])[0]
        refusedText = [`the brief of ${meta.id} has ${text.length} characters; the ${tierOf(a)} limit is ${limit}.`,
          `The largest part is ${largest[0]} (${largest[1]} characters).`,
          `Run: work raise ${token} --reason="the brief is too big: ${largest[0]} has ${largest[1]} characters"`,
          'STOP after the raise.']
        return undefined
      }
      // The first brief of a task records how each of its files looked before any work (a
      // report equal to that is untouched work); a low checker's claim records the result
      // that it reviews.
      const data = { a: meta.id }
      if (state.engine.read.isDo(a.role) && a.task.untouched === undefined) {
        const form = outputForm(state, a)
        const files = [...(a.task.aiDescription.workspace ?? []).map((w) => w.path),
          ...(form.includes('<') || form.startsWith('"') ? [] : [form.split(/[#@]/)[0]])]
        data.untouched = Object.fromEntries([...new Set(files)].flatMap((f) => {
          const snapshot = snapshotOf(ctx.io.cwd, f)
          return snapshot ? [[f, snapshot]] : []
        }))
      }
      const latest = latestResult(state, a.task)
      if (tierOf(a) === 'low' && !state.engine.read.isDo(a.role) && latest) data.result = idOf(state, latest)
      return { who: meta.id, channel: 'agent', type: 'brief', data }
    }, token)
    if (refusedText) return refusedText
    const a = lookup(done.state, done.event.data.a, ['a'])
    return [renderBrief(done.state, a, { token })]
  },

  report(ctx, args) {
    const token = args.positional[0]
    const output = args.one('output')
    if (!output || output === true) throw refuse('a report needs --output=<what you made, and where>')
    const done = write(ctx, (state) => {
      checkHashes(ctx, state, token)
      const a = agent(state, token)
      checkOutput(ctx.io.cwd, output)
      const read = state.engine.read
      const expected = outputForm(state, a)
      const form = a.role.config.output
      if (!expected.includes('<') && !expected.startsWith('"')) {
        if (output !== expected) throw refuse(`the output of this task is ${expected}`, `work report ${token} --output=${expected}`)
      } else if (form && (form.includes('#') ? !output.includes('#') : form.includes('@') && !output.includes('@'))) {
        throw refuse(`the output of ${a.role.role} has the form ${form}`)
      }
      const workspace = a.task.aiDescription.workspace ?? []
      const file = output.split(/[#@]/)[0]
      const isCommit = /^[^#]+@[0-9a-f]{7,40}$/.test(output)
      // A file of the project folder is written only in the workspace of the task (one maker at a
      // time); a task with no workspace writes none.
      if ((workspace.length || existsSync(join(ctx.io.cwd, file))) && !workspace.some((w) => file === w.path || (!isCommit && file.startsWith(`${w.path}/`)))) {
        throw refuse(`${file} is not in the workspace of ${idOf(state, a.task)}: ${workspace.map((w) => w.path).join(', ') || 'none'}`)
      }
      // A commit belongs to the workspace repo itself, not to a repo inside it or around it.
      if (isCommit) {
        const top = Bun.spawnSync(['git', '-C', join(ctx.io.cwd, file), 'rev-parse', '--show-toplevel'])
        const real = (p) => { try { return realpathSync(p) } catch { return p } }
        if (top.exitCode !== 0 || real(top.stdout.toString().trim()) !== real(join(ctx.io.cwd, file))) {
          throw refuse(`${file} is not the top of its own git repo; the workspace repo is ${file}`)
        }
      }
      // A task may not take a region that another open task of its tree owns.
      const region = output.split('#')[1]
      let top = a.task
      while (top.serves) top = top.serves
      // The other open tasks whose work this report must keep: those of its tree (not its
      // ancestors), and the tasks it needs, from any tree.
      const others = [...new Set([...read.tasks.filter((t) => t !== a.task && !t.closed && read.within(t, top) && !read.within(a.task, t)),
        ...a.task.needs.filter((t) => !t.closed)])]
      const owner = others.find((t) => region && t.aiDescription.context.region === region)
      if (owner) throw refuse(`the region ${region} belongs to ${idOf(state, owner)} (${owner.name})`)
      const { digest, size, commit } = digestOf(ctx.io.cwd, output)
      // A task that starts from earlier work reports new work made on top of it.
      const start = a.task.aiDescription.from
      if (start && digest === start.digest) {
        throw refuse(`${output} is the starting point of ${idOf(state, a.task)} (${idOf(state, start)}); a report is new work`,
          tierOf(a) === 'low' ? `work raise ${token} --reason="<why the starting point already does the task>"` : undefined)
      }
      // For a commit, the digest is its tree; git takes the commits from the outputs.
      const commitOf = (r) => r.output.split('@')[1]
      const git = (...gitArgs) => Bun.spawnSync(['git', '-C', join(ctx.io.cwd, file), ...gitArgs])
      if (start && commit && /@[0-9a-f]{7,40}$/.test(start.output)) {
        const on = git('merge-base', '--is-ancestor', commitOf(start), commit)
        if (on.exitCode !== 0) {
          throw refuse(`${output} does not start from ${idOf(state, start)} (${start.output})`,
            `make your commit on top of ${start.output.split('@')[1]}, then report again`)
        }
      }
      // Untouched work: the output is as it was at the first brief of its task. A task that needs
      // others may keep the file as they left it, when one of them did accepted work.
      const before = a.task.untouched?.[file]
      const was = before && (region ? before.regions[region] : before.digest)
      const needsWorked = a.task.needs.some((t) => read.resultsOf(t).some((r) => state.engine.accepted(r, state.now)))
      if (!commit && was && digest === was && !needsWorked) {
        throw refuse(`${output} is the same as before any work on ${idOf(state, a.task)}; a report is new work`,
          tierOf(a) === 'low' ? `work raise ${token} --reason="<why the work stays as it is>"` : undefined)
      }
      const space = workspace.find((w) => w.path === file)
      // A commit is new work against its base: not on the base, and with other files than its
      // merge base. A base that git cannot read is refused; the check never passes by default.
      let mergeBase
      let patch
      if (commit && !space?.base) {
        throw refuse(`${file} is a git workspace of ${idOf(state, a.task)} with no base, so the CLI cannot check the commit`,
          tierOf(a) === 'low' ? `work raise ${token} --reason="the workspace ${file} names no base"` : 'the person opens the task with base: <branch> in its workspace')
      }
      if (commit) {
        if (git('rev-parse', '--verify', `${space.base}^{commit}`).exitCode !== 0) {
          throw refuse(`${file} has no ${space.base}, the base of this task, so the CLI cannot check the commit`,
            tierOf(a) === 'low' ? `work raise ${token} --reason="${file} has no base ${space.base}"` : `the person opens the task with a base that ${file} has`)
        }
        if (git('merge-base', '--is-ancestor', commit, space.base).exitCode === 0) {
          throw refuse(`${commitOf({ output })} is already on ${space.base}; a report is a new commit`)
        }
        mergeBase = git('merge-base', commit, space.base).stdout.toString().trim()
        if (!mergeBase) {
          throw refuse(`${output} shares no history with ${space.base}; a report is a commit on top of ${space.base}`,
            `make the commit on a branch from ${space.base}, then report again`)
        }
        const baseTree = git('rev-parse', `${mergeBase}^{tree}`).stdout.toString().trim()
        if (baseTree === digest) throw refuse(`${output} has the same files as ${space.base}; a report is new work`)
        // The work of a commit is its change against its merge base, as git patch-id names it: a
        // rebase or a new message of the same change is the same work. The diff has one fixed
        // form, whatever the repo or the environment sets (colour, an external diff, the diff
        // options), and white space counts: an indent can be the whole fix.
        const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(CONFIG|EXTERNAL_DIFF|DIFF_OPTS)/.test(k)))
        const diff = Bun.spawnSync(['git', '-C', join(ctx.io.cwd, file), '-c', 'diff.suppressBlankEmpty=false', 'diff', '--no-renames',
          '--no-color', '--no-ext-diff', '--no-textconv', '--full-index', '--src-prefix=a/', '--dst-prefix=b/', '--diff-algorithm=myers', '--unified=3',
          '--inter-hunk-context=0', '--indent-heuristic', mergeBase, commit], { env }).stdout
        patch = Bun.spawnSync(['git', '-C', join(ctx.io.cwd, file), 'patch-id', '--verbatim'], { stdin: diff, env })
          .stdout.toString().trim().split(' ')[0] || undefined
        if (diff.length > 0 && !patch) throw refuse(`git gave no patch-id for ${output}, so the CLI cannot compare it with other work`)
        // Another task's work is not this task's result (a task that needs it builds on top of it).
        const copied = read.results.find((r) => r.task !== a.task && !a.task.needs.includes(r.task) &&
          r.output.split('@')[0] === file && /@[0-9a-f]{7,40}$/.test(r.output) &&
          (commit.startsWith(commitOf(r)) || (patch && r.patch === patch)))
        if (copied) {
          throw refuse(`${output} is the work of ${idOf(state, copied)} of ${idOf(state, copied.task)} (${copied.task.name}); a report is the work of ${idOf(state, a.task)}`,
            tierOf(a) === 'low' ? `work raise ${token} --reason="the work of ${idOf(state, a.task)} is already in ${idOf(state, copied)}"` : undefined)
        }
      }
      const sameWork = (r) => (patch && r.patch ? r.patch === patch : r.digest === digest)
      const previous = latestResult(state, a.task)
      const redoOpen = previous && read.reviewsOf(previous).some((v) => v.redo && !read.answered(v))
      // After a recheck, a commit contains the new revision of its source.
      const now = space && state.sources[space.source]
      if (commit && redoOpen && now) {
        if (git('merge-base', '--is-ancestor', now, commit).exitCode !== 0) throw refuse(`${output} is not built on ${space.source}@${now}; rebase it first`)
      }
      const rejectedTwin = read.resultsOf(a.task).find((r) => r !== previous && sameWork(r) &&
        read.reviewsOf(r).some((v) => v.decision === 'Reject'))
      // A recheck asks for the work again; it does not make rejected work right.
      if (rejectedTwin) {
        throw refuse(`${output} is the same as ${idOf(state, rejectedTwin)}, which was rejected`,
          tierOf(a) === 'low' ? `work raise ${token} --reason="<why the rejected work is right>"` : undefined)
      }
      if (previous && sameWork(previous) && !redoOpen) {
        throw refuse(`nothing changed since ${idOf(state, previous)}; a report is new work`,
          tierOf(a) === 'low' ? `work raise ${token} --reason="<why the work stays as it is>"` : undefined)
      }
      // A report keeps the work that other open tasks own: each of their regions in this file,
      // and the whole file of a task that it needs, stays as that task's latest result left it.
      // Any open task counts but the ancestors of this one, whose result comes after it. A closed
      // task is not needed, so it owns nothing.
      const keepers = [...new Set([...read.tasks.filter((t) => t !== a.task && !t.closed && !read.within(a.task, t)),
        ...a.task.needs.filter((t) => !t.closed)])]
      // The regions of two tasks do not nest (round 7, D4): a heading that was not in the file at
      // the split can still put one region inside another, so the report checks it again.
      if (region) {
        const inside = regionsInside(ctx.io.cwd, output)
        for (const t of keepers.filter((x) => x.aiDescription.context.region && (x.aiDescription.workspace ?? []).some((w) => w.path === file))) {
          const theirRegion = t.aiDescription.context.region
          const nest = regionsInside(ctx.io.cwd, `${file}#${theirRegion}`).includes(region) ? `the region ${region} lies inside the region ${theirRegion} of ${idOf(state, t)} (${t.name})`
            : inside.includes(theirRegion) ? `the region ${theirRegion} of ${idOf(state, t)} (${t.name}) lies inside the region ${region}` : undefined
          if (nest) {
            throw refuse(`${nest}; the regions of two tasks do not nest`,
              tierOf(a) === 'low' ? `work raise ${token} --reason="${nest}"` : 'the person remakes the tasks with regions that do not nest')
          }
        }
      }
      for (const t of keepers) {
        const theirs = latestResult(state, t)
        if (!theirs || /@[0-9a-f]{7,40}$/.test(theirs.output)) continue
        const [theirFile, theirRegion] = theirs.output.split('#')
        const covered = theirFile === file && (theirRegion ? true : a.task.needs.includes(t))
        if (!covered || !changedSince(ctx.io.cwd, theirs)) continue
        const how = state.engine.taskAccepted(t, state.now) ? 'accepted' : 'reported'
        const what = theirRegion ? `the region ${theirRegion} of ${idOf(state, t)}` : `${theirFile} of ${idOf(state, t)}`
        throw refuse(`${output} changes ${what} (${t.name}) after ${idOf(state, theirs)} was ${how}`,
        tierOf(a) === 'low'
          ? `undo the change in ${theirRegion ?? theirFile}; if it must change: work raise ${token} --reason="${idOf(state, t)} needs a new result"`
          : `undo the change in ${theirRegion ?? theirFile}; it changes only through a new result of ${idOf(state, t)}`)
      }
      // A commit of a task that needs others contains the accepted commit of each one, so their
      // work stays in it.
      for (const part of commit ? a.task.needs.filter((t) => !t.closed) : []) {
        const theirs = latestResult(state, part)
        if (!theirs || theirs.output.split('@')[0] !== file || !/@[0-9a-f]{7,40}$/.test(theirs.output)) continue
        if (git('merge-base', '--is-ancestor', commitOf(theirs), commit).exitCode !== 0) {
          throw refuse(`${output} does not contain ${idOf(state, theirs)} of ${idOf(state, part)} (${theirs.output})`,
            `merge ${theirs.output.split('@')[1]} into your commit, then report again`)
        }
      }
      // Work that changes the same files runs one after the other (Nanda, 2026-11-07): a commit
      // may not change a file that the commit of another open task changes, when the two tasks
      // do not wait for each other and this commit does not contain the other one. The other
      // commit's files come from its own recorded base, so a merge into the base hides nothing.
      if (mergeBase) {
        const changed = (from, to) => git('diff', '--name-only', '--no-renames', from, to).stdout.toString().split('\n').filter(Boolean)
        const waitsFor = (x, y, seen = new Set()) =>
          x.needs.some((n) => read.within(y, n) || (!seen.has(n) && seen.add(n) && waitsFor(n, y, seen)))
        const linked = (x, y) => read.within(x, y) || read.within(y, x) || waitsFor(x, y) || waitsFor(y, x)
        const mine = changed(mergeBase, commit)
        for (const t of read.tasks.filter((x) => x !== a.task && !x.closed && !linked(a.task, x))) {
          const theirs = latestResult(state, t)
          if (!theirs || theirs.output.split('@')[0] !== file || !/@[0-9a-f]{7,40}$/.test(theirs.output)) continue
          // Their base is the one recorded for their workspace entry of this repo path.
          const theirSource = (t.aiDescription.workspace ?? []).find((w) => w.path === file)?.source
          const theirBase = theirs.madeFrom.find((m) => m.source === theirSource)?.revision
          if (!theirBase) continue
          const both = changed(theirBase, commitOf(theirs)).filter((f) => mine.includes(f))
          if (both.length === 0 || git('merge-base', '--is-ancestor', commitOf(theirs), commit).exitCode === 0) continue
          throw refuse(`${output} changes ${both.join(', ')}, and so does ${idOf(state, theirs)} of ${idOf(state, t)} (${t.name}), which does not wait for ${idOf(state, a.task)}; work that changes the same files runs one after the other`,
            tierOf(a) === 'low'
              ? `work raise ${token} --reason="${idOf(state, a.task)} and ${idOf(state, t)} change ${both[0]}; one must run after the other"`
              : `make one task wait for the other: a remake of the later one with needs: [${idOf(state, t)}] (work task remake), or a raise to the person`)
        }
      }
      const madeFrom = args.all('made-from').map((m) => {
        if (/^r\d+$/.test(m)) return { result: m }
        const [source, revision] = String(m).split('@')
        if (!revision) throw refuse(`--made-from=${m} needs <source>@<revision>, or a result id`)
        // The revision of a git source comes from git, not from the words of an agent.
        if (gitSources(state).some((w) => w.source === source)) {
          throw refuse(`--made-from=${m}: ${source} is a git source, and the CLI reads its revision from git`,
            `report again without --made-from=${m}`)
        }
        return { source, revision }
      })
      // A commit is made from its base: the CLI reads the merge base from git and records it.
      if (mergeBase) madeFrom.push({ source: space.source, revision: mergeBase.slice(0, 12) })
      return { who: idOf(state, a), channel: 'agent', type: 'report',
        data: { a: idOf(state, a), output, madeFrom, size, digest, ...(patch ? { patch } : {}) } }
    }, token)
    const state = done.state
    const result = lookup(state, state.created[0], ['r'])
    const a = result.by
    // A result made under an old snapshot uses no attempt; the line says so instead of a count.
    const used = state.engine.read.used(a)
    const lines = [used > 0
      ? `${idOf(state, result)} reported on ${idOf(state, a.task)} (attempt ${used}${a.maxAttempts ? ` of ${a.maxAttempts}` : ''}).`
      : `${idOf(state, result)} reported on ${idOf(state, a.task)}; it was made under an old version of a direction, so it uses no attempt (the next attempt reads a new brief first).`,
    ]
    runPrograms(ctx, state, result, (l) => lines.push(l))
    lines.push(tierOf(a) === 'low' ? 'STOP: your parent continues.' : `next: work next ${token}`)
    return lines
  },

  review(ctx, args) {
    const rest = [...args.positional]
    const token = isToken(rest[0]) ? rest.shift() : undefined
    const [targetId, decision] = rest
    if (!['accept', 'reject'].includes(decision)) throw refuse('a review is accept or reject; to raise, use work raise')
    if (/^(d|ev)\d+$/.test(targetId ?? '')) return reviewDecision(ctx, args, token, targetId, decision)
    const done = write(ctx, (state) => {
      checkHashes(ctx, state, token)
      const { by, who, channel } = caller(ctx, state, token)
      const target = lookup(state, targetId, ['r', 't'])
      // A low checker reviews the one result that its brief named.
      const briefed = by && state.meta.get(by).claim?.result
      if (by && tierOf(by) === 'low' && !state.engine.read.isDo(by.role) && !briefed) {
        throw refuse('your brief named no result to review', `work raise ${token} --reason="nothing was reported when I read my brief", then STOP`)
      }
      if (by && tierOf(by) === 'low' && briefed && targetId !== briefed) {
        throw refuse(`your brief named ${briefed}; a low checker reviews only that result`,
          targetId === idOf(state, latestResult(state, by.task))
            ? `work raise ${token} --result=${briefed} --reason="a newer result ${targetId} came after my brief", then STOP`
            : `work review ${token} ${briefed} ...`)
      }
      if (by && tierOf(by) === 'low' && target[kind] !== 'Result') {
        throw refuse(`a low checker reviews only the result in its brief${briefed ? `: ${briefed}` : ''}`)
      }
      const data = { target: targetId, decision }
      if (decision === 'accept') {
        data.evidence = evidenceOf(args.all('evidence'))
        data.reason = args.one('reason')
        data.settles = args.one('settles')
        // A settle decides a Raise; the evidence of an accept is about the reported work.
        if (!(data.settles && data.evidence.length === 0)) checkDigest(ctx, state, target, by, token)
        if (by) {
          const checks = rulesFor(state, by).map((r) => r.id)
          const named = data.evidence.map((e) => e.rule).filter(Boolean)
          const outside = named.filter((r) => !checks.includes(r))
          if (outside.length && tierOf(by) === 'low') {
            throw refuse(`${outside.join(', ')} is not in your checks: ${checks.join(', ') || 'none'}`)
          }
          const missing = tierOf(by) === 'low' ? checks.filter((r) => !named.includes(r)) : []
          if (missing.length && !data.settles) throw refuse(`no --evidence for: ${missing.join(', ')}`)
          // The same command with the one field to correct; the other lines stay as they were.
          const again = (index, fix) => `work review ${token} ${targetId} accept ` + data.evidence
            .map((e, i) => (i === index ? { ...e, ...fix } : e)).map(evidenceFlag).join(' ')
          if (target[kind] === 'Result') checkEvidence(target, data.evidence, again)
        }
        for (const e of data.evidence) if (e.rule) findRule(state, e.rule)
        if (!data.evidence.length && !data.settles) {
          throw refuse('an accept needs --evidence: <the place in the result where you read it> | <what you saw there>')
        }
      } else {
        data.points = pointsOf(args.flags)
        for (const p of data.points) if (p.breaks) findRule(state, p.breaks)
      }
      return { who, channel, type: 'review', data }
    }, token)
    const vid = done.state.created[0]
    const target = lookup(done.state, targetId, ['r', 't'])
    const d = done.event.data
    const what = d.decision === 'reject'
      ? `reject of ${targetId} with ${d.points.length} point(s): ${d.points.map((p, i) => `${vid}.${i + 1}`).join(', ')}`
      : d.settles ? `settles ${d.settles} on ${targetId}` : `accept of ${targetId}`
    const by = token ? lookup(done.state, done.event.who, ['a']) : undefined
    // A low checker's unit ends here; the state of the result is its parent's to read.
    if (by && tierOf(by) === 'low') return [`${vid}: your review of ${targetId} is recorded.`, `STOP: ${upTo(by)} continues.`]
    const lines = [`${vid}: ${what}.`]
    if (target[kind] === 'Result') {
      const items = done.state.engine.blockers(target, done.state.now)
      lines.push(items.length ? `${targetId} still has ${items.length} blocker(s): work blockers ${targetId}`
        : `${targetId} has no blockers; ${idOf(done.state, target.task)} is ${done.state.engine.Task.state(target.task, done.state.now)}.`)
    }
    return lines
  },

  // A decider asks for a new result after a change outside (a source outside git changed), or
  // to reopen accepted work.
  recheck(ctx, args) {
    const [token, targetId] = args.positional
    const done = write(ctx, (state) => {
      const a = agent(state, token)
      needOpen(state, a)
      needClaim(state, a, token)
      if (tierOf(a) === 'low') throw refuse('a low role does not ask for a recheck; raise it')
      const target = lookup(state, targetId, ['r'])
      if (!inTree(state, target, a)) throw refuse(`${targetId} is outside the task tree of ${idOf(state, a)}`)
      // A recheck asks for new work after a change outside (a newer source, newer work of a task
      // that it needs, a new version), or reopens accepted work. With none, it would be a free try.
      const outside = staleOf(state, target) || state.engine.blockerItems(target, state.now).some((i) => i.kind === 'old-need' || i.kind === 'old-version')
      if (!outside && !state.engine.accepted(target, state.now)) {
        throw refuse(`nothing changed outside since ${targetId} was made, and it is not accepted, so a recheck would be a free try`,
          `review it: work review ${token} ${targetId} reject --point="<what is wrong>", or work raise ${token} --result=${targetId} --reason="<what changed>"`)
      }
      return { who: idOf(state, a), channel: 'agent', type: 'review',
        data: { target: targetId, decision: 'recheck', reason: args.one('reason') } }
    })
    const target = lookup(done.state, targetId, ['r'])
    return [`${done.state.created[0]} asks for a new result of ${idOf(done.state, target.task)}; the gates run on the next report.`,
      `next: work next ${token}`]
  },

  raise(ctx, args) {
    const token = args.positional[0]
    const done = write(ctx, (state) => {
      const a = agent(state, token)
      needOpen(state, a)
      const result = args.one('result')
      if (result && !inTree(state, lookup(state, result, ['r']), a)) {
        throw refuse(`${result} is outside the task tree of ${idOf(state, a)}`)
      }
      return { who: idOf(state, a), channel: 'agent', type: 'raise', data: { a: idOf(state, a), reason: args.one('reason'), result } }
    })
    const id = done.state.created[0]
    const a = lookup(done.state, done.event.data.a, ['a'])
    const to = a.parent ? idOf(done.state, a.parent) : a.task.owner.name
    return [`${id} raised to ${to}.`, tierOf(a) === 'low' ? 'STOP: your parent continues.'
      : a.parent ? `next: work next ${token}` : `next: ${to} answers it; work waiting --for=${to} shows it`]
  },

  ask(ctx, args) {
    const token = args.positional[0]
    const done = write(ctx, (state) => {
      const a = agent(state, token)
      needOpen(state, a)
      if (tierOf(a) === 'low' && args.one('to') === 'owner') throw refuse('a low role asks its parent', `work ask ${token} --text="..."`)
      return { who: idOf(state, a), channel: 'agent', type: 'ask', data: { a: idOf(state, a), text: args.one('text'), to: args.one('to') } }
    })
    return [`${done.state.created[0]} asked; the task waits for the answer.`]
  },

  answer(ctx, args) {
    const rest = [...args.positional]
    const token = isToken(rest[0]) ? rest.shift() : undefined
    write(ctx, (state) => {
      const { who, channel } = caller(ctx, state, token)
      return { who, channel, type: 'answer', data: { q: rest[0], text: args.one('text') } }
    })
    return [`${rest[0]} answered; the asker's next brief shows the answer.`]
  },

  note(ctx, args) {
    const [token, which] = args.positional
    const kinds = { finding: 'Finding', message: 'Message' }
    if (!kinds[which]) throw refuse('a note is a finding or a message; a question is work ask')
    const done = write(ctx, (state) => {
      const a = agent(state, token)
      needOpen(state, a)
      return { who: idOf(state, a), channel: 'agent', type: 'note', data: { a: idOf(state, a), kind: kinds[which], text: args.one('text') } }
    })
    return [`${done.state.created[0]} noted.`]
  },

  // Feedback in words, from anyone: about a direction, a standard, or a rule (by id); with
  // nothing to be about, it asks for a new direction. A challenge is a suggestion that says that
  // something is wrong. A high role answers it with a draft.
  suggest(ctx, args) {
    const rest = [...args.positional]
    const token = isToken(rest[0]) ? rest.shift() : undefined
    const [about] = rest
    const done = write(ctx, (state) => {
      const { by, who, channel } = caller(ctx, state, token)
      if (by) needOpen(state, by)
      return { who, channel, type: 'suggest', data: { ...(about ? { about } : {}), says: args.one('says') } }
    }, token)
    const sid = done.state.created[0]
    return [`${sid}: a suggestion ${about ? `about ${about}` : 'for a new direction'}; it stays open until an official draft answers it.`,
      `next: a high role answers it with a draft: work direction revise <token> <direction> --file=<edit.yaml> --answers=${sid}`]
  },

  // An evaluation of a mistake (Nanda, 2026-11-08): the high role of the task's tree, or the
  // person, says what is wrong, why the task cannot be done as asked, and what to improve. It
  // answers one stop; a task id names its first stop that waits.
  evaluate(ctx, args) {
    const rest = [...args.positional]
    const token = isToken(rest[0]) ? rest.shift() : undefined
    const [stopId] = rest
    if (!stopId) {
      throw refuse('use work evaluate [<token>] <stop> --wrong="..." --why="..." --improve="..." --level=task|standard|direction|principle ' +
        '(a stop is ex<n>, the last try of a maker, or v<n>, a Reject of the person; a task id names its first stop)')
    }
    const done = write(ctx, (state) => {
      const { by, who, channel } = caller(ctx, state, token)
      if (by) needOpen(state, by)
      let stop = stopId
      if (/^t\d+$/.test(stopId)) {
        const waits = state.engine.read.evaluationWaits(lookup(state, stopId, ['t']))
        if (!waits) throw refuse(`${stopId} waits for no evaluation`)
        stop = stopIdOf(state, waits)
      } else if (!state.groups.has(stopId)) lookup(state, stopId, ['ex', 'v'])
      return { who, channel, type: 'evaluate', data: {
        stop, wrong: args.one('wrong'), why: args.one('why'), improve: args.all('improve'), level: args.one('level') } }
    }, token)
    const state = done.state
    const read = state.engine.read
    const e = lookup(state, state.created[0], ['ev'])
    const task = read.stopTask(e.answers)
    const tid = idOf(state, task)
    const next = read.evaluationWaits(task)
    return [`${idOf(state, e)} evaluates ${tid} at the level ${e.level}; it answers ${done.event.data.stop}.`,
      !read.evaluationCounts(e)
        ? `It counts after ${task.owner.name} accepts it: work review ${idOf(state, e)} accept --evidence="<where you read> | <what you saw>"`
        : next ? `${tid} also waits for an evaluation of ${stopIdOf(state, next)}: work evaluate ${stopIdOf(state, next)} ...`
          : read.workStop(task, state.now) ? 'The next maker starts after a change that its improvements ask for: a direction version that says something new to the task, a newer accepted result of a task that it needs, or a remake or a split.'
            : `${tid} goes on: work next prints its steps.`,
      token ? `next: work next ${token}` : 'next: work waiting']
  },

  evaluation(ctx, args) {
    const [sub, id] = args.positional
    if (sub !== 'show') throw refuse('use work evaluation show <evaluation>; the owner accepts or rejects one with work review <evaluation> accept|reject')
    const state = ctx.read()
    const read = state.engine.read
    const e = lookup(state, id, ['ev'])
    const task = read.stopTask(e.answers)
    const by = idOf(state, e.by) ?? e.by.actor?.name ?? e.by.name
    const decided = read.evaluationDecision(e)
    const words = (r) => r.reason ?? r.evidence.map((x) => x.says).join('; ')
    return [`${id} · ${idOf(state, task)} ${task.name} · answers ${stopIdOf(state, e.answers)} · level ${e.level} · by ${by}` +
      `${decided ? ` · ${decided.decision === 'Accept' ? 'accepted' : 'rejected'}: ${words(decided)}` : (read.evaluationCounts(e) ? '' : ' · waits for the person')}`,
      `wrong:   ${e.wrong}`, `why:     ${e.why}`, ...e.improve.map((x) => `improve: ${x}`)]
  },

  blockers(ctx, args) {
    const state = ctx.read()
    return [renderBlockers(state, lookup(state, args.positional[0], ['r']))]
  },

  waiting(ctx, args) {
    return [renderWaiting(ctx.read(), args.one('for'))]
  },

  status(ctx) {
    return [renderStatus(ctx.read())]
  },

  // A guide in words, for a model or a person: how to write a direction (writing), and the
  // questions of the review of a draft (direction-review). Guides are files; everything else is
  // in aristoteles.
  guide(ctx, args) {
    const names = [...new Bun.Glob('*.md').scanSync({ cwd: join(import.meta.dir, 'guides') })].map((f) => f.replace(/\.md$/, '')).sort()
    const name = args.positional[0]
    if (!names.includes(name)) throw refuse(`work guide <name>: the guides are ${names.join(', ')}`, `work guide ${names.at(-1)}`)
    return [readFileSync(join(import.meta.dir, 'guides', `${name}.md`), 'utf8').trimEnd()]
  },

  // A search in aristoteles (SQLite full-text search) over the words of directions, standards,
  // rules, suggestions, and reasons: each match with its place, the versions that hold it, and
  // the tasks that read those versions.
  search(ctx, args) {
    const words = args.positional.join(' ').trim()
    if (!words) throw refuse('a search needs its words: work search <words>')
    const query = words.split(/\s+/).map((w) => `"${w.replaceAll('"', '')}"*`).join(' ')
    const store = openStore(ctx.io)
    try {
      const p = store.project
      const found = store.query(`SELECT place, kind, snippet(words_search, 3, '[', ']', '...', 16) AS text FROM words_search
        WHERE words_search MATCH ? AND project = ? ORDER BY rank LIMIT 20`, query, p)
      if (!found.length) return [`nothing in ${p} says "${words}".`]
      const versionsOf = (x) => (x.kind === 'standard'
        ? store.query('SELECT DISTINCT v.id FROM version v JOIN draft_standard ds ON ds.project = v.project AND ds.draft = v.draft WHERE v.project = ? AND ds.standard = ? ORDER BY v.id', p, x.place)
        : x.kind === 'rule'
          ? store.query(`SELECT DISTINCT v.id FROM version v JOIN draft_standard ds ON ds.project = v.project AND ds.draft = v.draft
              JOIN standard_rule sr ON sr.project = ds.project AND sr.standard = ds.standard WHERE v.project = ? AND sr.rule = ? ORDER BY v.id`, p, x.place)
          : x.kind === 'draft' ? store.query('SELECT id FROM version WHERE project = ? AND draft = ?', p, x.place) : []).map((v) => v.id)
      const tasksOf = (versions) => (versions.length ? store.query(`SELECT DISTINCT t.id, t.name FROM brief b
        JOIN assignment a ON a.project = b.project AND a.id = b.assignment JOIN task t ON t.project = a.project AND t.id = a.task
        WHERE b.project = ? AND b.version IN (${versions.map(() => '?').join(', ')}) ORDER BY t.id`, p, ...versions) : [])
      const label = (x) => ({ standard: `standard ${x.place.split('/').at(-1)}`, rule: `rule ${x.place.split('/').at(-1)}`,
        draft: `what ${x.place} says`, suggestion: `suggestion ${x.place}`, reason: `the reason of ${x.place}` })[x.kind] ?? x.place
      const lines = [`${found.length} ${found.length > 1 ? 'matches' : 'match'} for "${words}" in ${p}:`]
      for (const x of found) {
        const versions = versionsOf(x)
        const tasks = tasksOf(versions)
        lines.push(`  ${label(x)}: ${x.text.replaceAll('\n', ' ')}`)
        if (versions.length) {
          const pieces = x.kind === 'draft' ? versions : versions.map((v) => `${v}#${x.place.split('/').at(-1)}`)
          lines.push(`    in ${pieces.join(', ')}${tasks.length ? ` · read by ${tasks.map((t) => `${t.id} (${t.name})`).join(', ')}` : ''}`)
        }
      }
      return lines
    } finally {
      store.close()
    }
  },

  next(ctx, args) {
    const token = args.positional[0]
    const state = ctx.read()
    const a = agent(state, token)
    if (a.finished) return [`${idOf(state, a)} is finished; there is nothing more for it.`]
    if (tierOf(a) === 'low') return [`a low role has one unit: work brief ${token} shows it.`]
    const steps = nextSteps(state, a, token)
    return steps.length ? steps : [`nothing is ready in ${idOf(state, a.task)}; work waiting shows what waits.`]
  },

  log(ctx, args) {
    const state = ctx.read()
    const last = Number(args.one('last') ?? 30)
    const cut = (t) => (t && t.length > 60 ? `${t.slice(0, 57)}...` : t)
    return state.events.slice(-last).map((e) => {
      const d = e.data
      const parts = {
        assign: () => `${d.role} on ${d.task}`,
        report: () => d.output,
        review: () => `${d.target} ${d.settles ? `settles ${d.settles}` : d.decision}` +
          `${d.points ? `: ${d.points.map((p) => `"${cut(p.text)}"${p.breaks ? ` breaks ${p.breaks}` : ''}`).join('; ')}` : ''}` +
          `${d.evidence?.length ? ` evidence for ${d.evidence.map((e) => e.rule ?? `the ${{ d: 'draft', ev: 'evaluation' }[d.target.match(/^[a-z]+/)?.[0]] ?? 'result'}`).join(', ')}` : ''}`,
        raise: () => `${d.result ? `on ${d.result} ` : ''}"${cut(d.reason)}"`,
        ask: () => `"${cut(d.text)}"`,
        answer: () => `${d.q}: "${cut(d.text)}"`,
        grant: () => `${d.act} on ${d.on?.join(',')} to ${d.to} until ${d.until}`,
        relay: () => `${d.person} ${describeInner(d.inner)} (${d.channel}) words "${cut(d.quote)}"`,
        ratify: () => d.event,
        'direction.revise': () => `${d.direction}${d.answers?.length ? ` answering ${d.answers.join(',')}` : ''}`,
        suggest: () => `${d.about ?? 'a new direction'}: "${cut(d.says)}"`,
        evaluate: () => `${d.stop} at the level ${d.level}`,
        'task.split': () => `${d.task}${d.review ? ` answering ${d.review}` : ''}`,
        'task.close': () => `${d.task} "${cut(d.reason)}"`,
        waive: () => `${d.result} ${d.rules?.join(',')} until ${d.until}`,
        finish: () => d.a,
        release: () => d.a,
        source: () => `${d.source}@${d.revision}`,
        checkpoint: () => `${d.task} next "${cut(d.next)}"`,
      }[e.type]?.() ?? ''
      const made = e.created?.length ? ` -> ${e.created.join(', ')}` : ''
      return `e${e.id} ${clock(e.at)} ${e.who} (${e.channel}) ${e.type}${parts ? ` ${parts}` : ''}${made}`
    })
  },

  direction(ctx, args) {
    const rest = [...args.positional]
    const sub = rest.shift()
    if (sub === 'show') {
      const state = ctx.read()
      // <id>[@<n>] or <draft>, then [#<standard, rule, or header>[#<header>]]: one piece, so a
      // role reads only it.
      const [address, ...keys] = String(rest[0]).split('#')
      let v
      if (/^d\d+$/.test(address)) {
        v = lookup(state, address, ['d'])
        if (!keys.length) return [renderDraft(state, v)]
      } else {
        const [id, number] = address.split('@')
        const d = state.directions[id]
        const pending = state.newDirections[id]
        if (!d && pending) {
          const last = state.engine.read.drafts.filter((x) => x.of === pending).at(-1)
          throw refuse(`${id} has no version yet`, `work direction show ${idOf(state, last)} shows its draft`)
        }
        if (!d) throw refuse(`there is no direction "${id}"`, 'work status lists the directions')
        if (number && !d.versions[Number(number) - 1]) throw refuse(`${id} has no version ${number}`)
        if (!keys.length) return [renderDirection(state, d, number ? Number(number) : undefined)]
        v = number ? d.versions[Number(number) - 1] : state.engine.read.current(d)
      }
      const piece = renderPiece(state, v, keys)
      if (!piece) throw refuse(`${rest[0]} names no piece; after # comes one of: ${pieceNames(v).join(', ')}`)
      return [piece]
    }
    if (sub === 'new') return newDirection(ctx, args, rest)
    if (sub !== 'revise') throw refuse('use work direction show|new|revise; a draft is accepted or rejected with work review <draft> accept|reject')
    const token = isToken(rest[0]) ? rest.shift() : undefined
    // A model writes each draft: the person gives direction in words, then accepts or rejects.
    if (!token) {
      throw refuse('the person gives direction in words: work suggest <direction, standard, or rule> --says="<the change>"; ' +
        'a high role writes the draft, and you accept or reject it')
    }
    const done = write(ctx, (state) => {
      checkHashes(ctx, state)
      const { by, who, channel } = caller(ctx, state, token)
      needOpen(state, by)
      needClaim(state, by, token)
      if (tierOf(by) !== 'high') throw refuse(`a ${tierOf(by)} role does not revise directions; raise it, or suggest it: work suggest ${token} <direction, standard, or rule> --says="..."`)
      const file = args.one('file')
      if (!file) {
        throw refuse('a revise needs --file=<edit.yaml>', 'write a file like this (any of the keys), then run the revise again:\n' +
          '  add:\n    - { id: <new standard id>, says: <the standard>, rules: [ { id: <new rule id>, says: <the rule>, checkedBy: <role> } ] }\n' +
          '  replace:\n    - { id: <standard id>, with: { id: <standard id>, says: <...>, rules: [ ... ] } }\n' +
          '  remove: [<standard id>]\n  says: <a new spirit needs the accept of the owner>')
      }
      const edit = Bun.YAML.parse(readArgFile(ctx, file)) ?? {}
      const answers = args.one('answers') ? String(args.one('answers')).split(',') : []
      for (const id of answers) {
        const record = state.groups.get(id)?.[0] ?? lookup(state, id, ['v', 's'])
        const task = record.of?.[kind] === 'Task' ? record.of : record.of?.task
        if (task && !state.engine.read.within(task, by.task)) throw refuse(`${id} is outside the task tree of ${idOf(state, by)}`)
      }
      return { who, channel, type: 'direction.revise', data: { direction: rest[0], edit, answers, why: args.one('why') } }
    })
    const state = done.state
    const did = state.created[0]
    const draft = lookup(state, did, ['d'])
    const answering = draft.answers.length ? `, answering ${draft.answers.map((y) => idOf(state, y)).join(', ')}` : ''
    return [`${did} drafted, built on ${versionId(draft.base)}${answering}; it waits for the accept of ${draftWaitsText(state, draft)}.`,
      `next: work direction show ${did}; a decider outside the tree of its reviser runs work review [<token>] ${did} accept ` +
        `--evidence="<where you read in ${did}> | <what you saw there>" (work waiting --for=${draft.of.owner.name} shows it to the owner)`]
  },

  // An executive act: one act for a time. The person gives it at a terminal; an agent gives it
  // with its token. Nobody gives more than they may do.
  grant(ctx, args) {
    const rest = [...args.positional]
    const token = isToken(rest[0]) ? rest.shift() : undefined
    const act = args.one('act')
    const on = String(args.one('on') ?? '').split(',').filter(Boolean)
    const until = args.one('until')
    if (!['approve', 'review', 'change'].includes(act)) throw refuse('--act is approve, review, or change')
    if (!on.length) throw refuse('--on names what the act covers: roles for approve and review, tasks or directions for change')
    if (!Number.isFinite(Date.parse(until))) throw refuse(`--until=${until} is not a time (2026-10-27T18:00:00Z)`)
    if (Date.parse(until) <= Date.parse(ctx.io.now())) throw refuse(`--until=${until} is in the past`)
    const done = write(ctx, (state) => {
      const confirm = token ? undefined : { word: 'grant', show: `grant: ${args.one('to')} may ${act} ${on.join(', ')} until ${until}` }
      const { by, who, channel } = caller(ctx, state, token, confirm)
      if (by) needClaim(state, by, token)
      return { who, channel, type: 'grant', data: { act, on, to: args.one('to'), until } }
    }, token)
    return [`${done.state.created[0]}: ${done.event.data.to} may ${act} ${on.join(', ')} until ${until}.`]
  },

  // The giver ends an executive act early; the acts before the revoke stay.
  revoke(ctx, args) {
    const rest = [...args.positional]
    const token = isToken(rest[0]) ? rest.shift() : undefined
    const done = write(ctx, (state) => {
      const { by, who, channel } = caller(ctx, state, token, token ? undefined : { word: 'revoke' })
      if (by) needClaim(state, by, token)
      return { who, channel, type: 'revoke', data: { x: rest[0] } }
    }, token)
    return [`${done.event.data.x} revoked; the acts before it stay.`]
  },

  waive(ctx, args) {
    const rest = [...args.positional]
    const token = isToken(rest[0]) ? rest.shift() : undefined
    const [result] = rest
    const rules = String(args.one('rules') ?? '').split(',').filter(Boolean)
    const until = args.one('until')
    const done = write(ctx, (state) => {
      const { by, who, channel } = caller(ctx, state, token)
      if (!Number.isFinite(Date.parse(until)) || Date.parse(until) <= Date.parse(ctx.io.now())) {
        throw refuse(`--until=${until} must be a time in the future`)
      }
      if (by) {
        needOpen(state, by)
        needClaim(state, by, token)
      }
      return { who, channel, type: 'waive', data: { result, rules, reason: args.one('reason'), until } }
    })
    return [`${done.state.created[0]}: ${rules.join(', ')} not checked on ${result} until ${until}; the task stays open, and work waiting shows it.`]
  },

  finish(ctx, args) {
    const [first, second] = args.positional
    let waiters = []
    const done = write(ctx, (state) => {
      const { by, who, channel } = caller(ctx, state, isToken(first) ? first : undefined)
      const target = by ? (second ? lookup(state, second, ['a']) : by) : lookup(state, first, ['a'])
      if (by && target !== by && target.parent !== by) throw refuse(`${idOf(state, target)} is not your child`)
      const open = state.engine.read.assignments.filter((x) => x.parent === target && !x.finished).map((x) => idOf(state, x))
      if (open.length) {
        throw refuse(`${idOf(state, target)} has open children: ${open.join(', ')}; finish them first`,
          by ? `work finish ${first} ${open[0]}` : `work finish ${open[0]}`)
      }
      waiters = waitersOf(state, target).map((y) => ({ id: idOf(state, y), path: fileTurn(state, y).path }))
      return { who, channel, type: 'finish', data: { a: idOf(state, target) } }
    })
    // A code maker's worktree goes when it finishes; its branch stays, because results name its
    // commits. The removal is best effort: a worktree that git does not know stays as it is.
    const id = done.event.data.a
    const tree = join(ctx.io.cwd, '.work', 'trees', id)
    const finished = lookup(done.state, id, ['a'])
    const had = existsSync(tree)
    if (had) {
      for (const w of finished.task.aiDescription.workspace ?? []) {
        Bun.spawnSync(['git', '-C', join(ctx.io.cwd, w.path), 'worktree', 'remove', '--force', tree])
      }
    }
    const removed = had && !existsSync(tree)
    // A maker that waited for this one may start now: its parent gives it to a new subagent.
    const turns = waiters
      .map((w) => ({ ...w, y: lookup(done.state, w.id, ['a']) }))
      .filter(({ y }) => !fileTurn(done.state, y))
      .map(({ id: yid, path, y }) => `${yid} may write ${path} now: ` +
        `${y.parent ? `its parent ${idOf(done.state, y.parent)} gives` : 'give'} a new subagent the command that work assign printed for ${yid}`)
    return [`${id} is finished.`, ...(removed ? [`its worktree is removed; its branch work/${id} stays.`] : []), ...turns]
  },

  source(ctx, args) {
    const [token, ref] = args.positional
    const [source, revision] = String(ref ?? '').split('@')
    if (!revision) throw refuse('use work source <token> <source>@<revision>')
    write(ctx, (state) => {
      const a = agent(state, token)
      needOpen(state, a)
      if (tierOf(a) === 'low') throw refuse('a low role records no source', 'STOP and tell your parent what changed')
      // A git source has its revision in git; the CLI reads the base of each commit there.
      if (gitSources(state).some((w) => w.source === source)) {
        throw refuse(`${source} is a git source: the CLI reads the base of each commit from git, and a new commit on it asks for no recheck`)
      }
      return { who: idOf(state, a), channel: 'agent', type: 'source', data: { source, revision } }
    })
    return [`${source} is at ${revision}.`]
  },

  // A checkpoint keeps the revision of each source outside git as it is now.
  checkpoint(ctx, args) {
    const [token, task] = args.positional
    const done = write(ctx, (state) => {
      const a = agent(state, token)
      needOpen(state, a)
      if (tierOf(a) === 'low') throw refuse('a low role does not checkpoint; report or raise')
      return { who: idOf(state, a), channel: 'agent', type: 'checkpoint',
        data: { task, next: args.one('next') } }
    })
    return [`${done.state.created[0]} saved for ${task}.`]
  },

  resume(ctx, args) {
    const [token, taskId] = args.positional
    const state = ctx.read()
    const a = agent(state, token)
    const task = lookup(state, taskId, ['t'])
    if (!state.engine.read.within(task, a.task)) throw refuse(`${taskId} is outside the task tree of ${idOf(state, a)}`)
    const saved = [...state.byId.entries()].filter(([id, r]) => id.startsWith('k') && r.task === task).at(-1)
    if (!saved) return [`${taskId} has no checkpoint; work next ${token} shows what is ready.`]
    const savedAt = state.events.find((e) => e.created?.includes(saved[0]))
    const author = savedAt?.who
    // The answers that came after the checkpoint, to questions about this tree.
    const answered = state.events.filter((e) => e.id > (savedAt?.id ?? 0) && e.type === 'answer').map((e) => e.data.q)
      .filter((q) => (state.byId.get(q)?.stops ?? []).some((t) => state.engine.read.within(t, task)))
    const now = Object.entries(state.sources).map(([source, revision]) => ({ source, revision }))
    const { changedOutside } = state.engine.Checkpoint.resume(saved[1], a, state.now, now)
    // Only results built on a revision that is no longer current need a recheck.
    const recheck = state.engine.read.resultsOf(task).filter((r) => r === latestResult(state, task) && staleOf(state, r))
    return [`resume ${taskId} from ${saved[0]} (saved by ${author}): next was "${saved[1].next}"`,
      `changed outside: ${changedOutside.map((c) => `${c.source}@${c.revision}`).join(', ') || 'nothing'}`,
      ...(answered.length ? [`answered since ${saved[0]}: ${answered.join(', ')} (work question show <id>)`] : []),
      ...(recheck.length
        ? recheck.map((r) => `check again: work recheck ${token} ${idOf(state, r)} --reason="${changedOutside.map((c) => c.source).join(', ')} changed"`)
        : ['check again: nothing']),
      ...nextSteps(state, a, token)]
  },

  relay(ctx, args) {
    const [token, who, act, target] = args.positional
    const quote = args.one('quote')
    const done = write(ctx, (state) => {
      const a = agent(state, token)
      if (a.parent || tierOf(a) === 'low') {
        throw refuse('only the top agent (medium or high, with no parent) relays the person', a.parent ? 'ask your parent' : undefined)
      }
      if (!state.config.people.includes(who)) throw refuse(`${who} is not in the people of work.yaml`)
      if (!quote || quote === true) throw refuse('a relay needs --quote="<their exact words>"')
      const channel = args.one('channel') ?? 'chat'
      if (!['chat', 'github'].includes(channel)) throw refuse('--channel is chat or github')
      const points = pointsOf(args.flags)
      const build = {
        reject: () => ({ type: 'review', data: { target, decision: 'reject', points: points.length ? points : [{ text: quote }], quote } }),
        accept: () => ({ type: 'review', data: { target, decision: 'accept', evidence: evidenceOf(args.all('evidence')),
          reason: args.one('reason') ?? quote, settles: args.one('settles'), quote } }),
        ask: () => ({ type: 'person.ask', data: { a: target, text: quote } }),
        answer: () => ({ type: 'answer', data: { q: target, text: quote } }),
        comment: () => ({ type: 'person.note', data: { task: target, text: quote } }),
      }[act]
      if (!build) throw refuse('a relay is reject, ask, answer, comment, or accept (of a result, a task, or a draft)')
      const inner = build()
      // A draft has no task tree: the person accepts or rejects it as its decider.
      const kinds = { reject: ['r', 't', 'd'], accept: ['r', 't', 'd'], ask: ['a'], answer: ['q'], comment: ['t'] }[act]
      const record = lookup(state, target, kinds)
      const task = record[kind] === 'Task' ? record : record.task ?? record.stops?.[0]
      if (task && !state.engine.read.within(task, a.task)) throw refuse(`${target} is outside the task tree of ${idOf(state, a)}`)
      if (act === 'accept' && record[kind] !== 'Revision' && !(inner.data.settles && !inner.data.evidence.length)) {
        checkDigest(ctx, state, record, a, token)
      }
      // A dry run: the person's act must be possible now, or the relay is refused.
      const probe = replay(state.events, { measure })
      probe.cwd = ctx.io.cwd
      probe.changed = state.changed
      probe.now = ctx.io.now()
      probe.checking = true
      try {
        apply(probe, { ...inner, who, channel: `relay:${channel}`, at: ctx.io.now(), id: 0 })
      } catch (error) {
        throw refuse(`${who} could not ${act} ${target} now: ${error.message}`, act === 'answer'
          ? `that question is not ${who}'s; to bring ${who}'s fact to the work, run work ask ${token} --to=owner --text="...", then relay ${who}'s answer to your question`
          : undefined)
      }
      return { who: idOf(state, a), channel: 'agent', type: 'relay', data: { person: who, act, quote, channel, inner } }
    }, token)
    const made = done.state.created.length ? ` -> ${done.state.created.join(', ')}` : ''
    return RELAY_AT_ONCE.has(act)
      ? [`${who}'s ${act} recorded${made} (relayed by ${done.event.who}, channel ${done.event.data.channel}).`]
      : [`e${done.id}: ${describeInner(done.event.data.inner)} waits until ${who} runs work ratify e${done.id} at a terminal.`]
  },

  ratify(ctx, args) {
    const id = args.positional[0]
    const done = write(ctx, (state) => {
      const pending = state.pending.get(id)
      if (!pending) throw refuse(`${id} is not a relayed act that waits for ratify; work waiting --for=<you> lists them`)
      const inner = pending.inner
      const show = [`${id}: ${describeInner(inner)}`, `relayed by ${pending.event.who}; their words: "${pending.event.data.quote}"`]
      if (inner.type === 'review' && /^d\d+$/.test(inner.data.target)) show.push(renderDraft(state, lookup(state, inner.data.target, ['d'])))
      const name = person(ctx, state, { word: 'ratify', show: show.join('\n') })
      return { who: name, channel: 'terminal', type: 'ratify', data: { event: id } }
    })
    const inner = findRelay(done.state, id)?.inner
    const draft = inner?.type === 'review' && /^d\d+$/.test(inner.data.target) ? lookup(done.state, inner.data.target, ['d']) : undefined
    const v = draft && done.state.engine.read.madeBy(draft)
    return [`${id} ratified${done.state.created.length ? ` -> ${done.state.created.join(', ')}` : ''}.`,
      ...(v ? [`${inner.data.target} is official: ${versionId(v)}.`, ...followCommit(ctx, v), ...afterVersion(done.state, v)] : [])]
  },

  question(ctx, args) {
    if (args.positional[0] !== 'show') throw refuse('use work question show <question>')
    const state = ctx.read()
    const q = lookup(state, args.positional[1], ['q'])
    const asker = q.from?.[kind] ? idOf(state, q.from) : q.from ?? 'someone'
    return [`${args.positional[1]} asked by ${asker}, for ${q.answerBy?.[kind] ? idOf(state, q.answerBy) : q.answerBy?.name}:`,
      q.text, '', q.answer === undefined ? 'no answer yet' : `answer: ${q.answer}`]
  },

  result(ctx, args) {
    if (args.positional[0] !== 'show') throw refuse('use work result show <result>')
    const state = ctx.read()
    return [renderResult(state, lookup(state, args.positional[1], ['r']))]
  },

  role(ctx, args) {
    const [sub, roleName] = args.positional
    const state = ctx.read()
    if (sub === 'list') {
      return Object.entries(state.config.roles).map(([n, r]) =>
        `${n.padEnd(14)}${(r.kind === 'program' ? 'program' : r.tier).padEnd(8)}${r.description}` +
        `${r.kind !== 'program' && state.fits[n]?.hash !== roleHash(r) ? '  (no fit record)' : ''}`)
    }
    if (sub === 'show') {
      const stored = state.config.roles[roleName]
      if (!stored) throw refuse(`there is no role "${roleName}"`)
      return [JSON.stringify(stored, null, 2)]
    }
    if (sub !== 'fit') throw refuse('use work role list|show|fit')
    // Fitness reads the role from work.yaml, so new words are fitted before config apply.
    const role = readConfig(ctx.io.cwd).config.roles[roleName] ?? state.config.roles[roleName]
    if (!role) throw refuse(`there is no role "${roleName}"`)
    if (role.kind === 'program') throw refuse(`${roleName} is a program; it needs no fit record`)
    const problems = staticFit(state, roleName, role)
    const questions = FITNESS().questions
    const file = args.one('answers')
    if (!file) {
      return [`static checks of ${roleName}: ${problems.length ? '' : 'pass'}`, ...problems.map((p) => `  - ${p}`), '',
        'Answer each question with yes or no, and why, in a file:',
        ...questions.map((q) => `  ${q.id}. ${q.ask}`), '',
        `  - { id: 1, yes: true, why: "<one real example of the role's work>" }`,
        `then: work role fit ${roleName} --answers=<file>`]
    }
    if (problems.length) throw refuse(`${roleName} fails the static checks: ${problems.join('; ')}`)
    const answers = Bun.YAML.parse(readArgFile(ctx, file)) ?? []
    const no = questions.filter((q) => !answers.some((x) => x.id === q.id && x.yes === true && String(x.why ?? '').trim()))
    if (no.length) throw refuse(`not fit: ${no.map((q) => `${q.id} (${q.short})`).join(', ')}`, 'change the role, then answer again')
    write(ctx, (s) => {
      const token = args.one('as')
      const { by, who, channel } = caller(ctx, s, token)
      if (by && tierOf(by) !== 'high') throw refuse('a person or a high role records role fitness')
      return { who, channel, type: 'role.fit', data: { role: roleName, hash: roleHash(s.config.roles[roleName]), answers } }
    })
    return [`${roleName} fits; recorded.`]
  },
}

const USAGE = [
  'work - code and document work under review. Agents pass their token first; a person runs',
  'commands with no token at a terminal.',
  '',
  'agents:  work brief <token>   (your brief lists the commands that you may run)',
  '         work next <token> | report | review | raise | ask | answer | recheck | relay ...',
  '         work direction new [<token>] --file=<direction.yaml> [--by=<model run>] (a model drafts a new direction)',
  'read:    work status | waiting [--for=<who>] | blockers <result> | task show|tree <task> | evaluation show <ev>',
  '         work direction show <id>[@<n>][#<standard|rule|header>]|<draft> | role list|show <role> | log [--last=<n>]',
  '         work assignment show <a>',
  '         work question show <q> | result show <r> | search <words> (aristoteles)',
  '         work guide writing|direction-review (how to write a direction, and how to review one)',
  'person:  work init | config apply|restore | task open|split|close | assign <task> --role=<role>',
  '         grant --act=approve|review|change --on=<ids> --to=<role> --until=<time> | revoke <x>',
  '         ratify <event> | answer <q> --text=<t> | review <r> reject ... (after its deciders accept it)',
  '         review <r> accept --settles=<raise> | review <t> reject ... | review <draft>|<ev> accept --evidence= | reject --reason=',
  '         suggest [<direction|standard|rule>] --says= (a high role writes the draft) | release|finish <a>',
  '         evaluate <stop>|<task> --wrong= --why= --improve= --level= | role fit <role> --answers=<file>',
]

// A refusal ends with one next line that fits the caller.
function nextFor(argv, ctx) {
  const token = argv.find((a) => /^a\d+\.[a-z0-9]+$/.test(a))
  if (!token) {
    return ctx.io.isTTY ? 'next: work waiting shows what waits for you'
      : 'next: check the ids with work status or work log; an agent passes its token first'
  }
  try {
    const state = ctx.read()
    const a = agent(state, token)
    if (a.role.tier === 'low') {
      return `next: do not try other commands; run work raise ${token} --reason="<the refusal, and what you tried>"`
    }
    return `next: work next ${token} lists the steps that are ready`
  } catch {
    return 'next: check the token that your parent gave you; if it is wrong, tell your parent'
  }
}

// The flags that each command reads, for each of its acts where it has several. Any other flag
// is a mistake (a typo, or a flag of another act), so the command is refused before it stores
// anything.
const FLAGS = {
  task: { open: ['file'], split: ['file', 'review'], close: ['reason'], remake: ['file', 'reason', 'review'], show: [], tree: [] },
  direction: { new: ['file', 'answers', 'why', 'by'], revise: ['file', 'answers', 'why'], show: [] },
  review: { accept: ['evidence', 'reason', 'settles'], reject: ['point', 'breaks', 'reason'] },
  relay: {
    reject: ['point', 'breaks', 'quote', 'channel'], accept: ['evidence', 'reason', 'settles', 'quote', 'channel'],
    ask: ['quote', 'channel'], answer: ['quote', 'channel'], comment: ['quote', 'channel'],
  },
  role: { fit: ['answers', 'as'], list: [], show: [] },
  assign: ['dry-run', 'max-attempts', 'role'],
  report: ['made-from', 'output'],
  recheck: ['reason'],
  raise: ['reason', 'result'],
  ask: ['text', 'to'],
  answer: ['text'],
  note: ['text'],
  suggest: ['says'],
  waiting: ['for'],
  search: [],
  guide: [],
  log: ['last'],
  grant: ['act', 'on', 'to', 'until'],
  waive: ['reason', 'rules', 'until'],
  checkpoint: ['next'],
  evaluate: ['improve', 'level', 'why', 'wrong'],
  evaluation: { show: [] },
}
// The word that names the act of a command with several acts.
const ACT_OF = {
  task: (words) => words[0], direction: (words) => words[0], role: (words) => words[0], evaluation: (words) => words[0],
  review: (words) => words.find((w) => w === 'accept' || w === 'reject'), relay: (words) => words[2],
}

// The daily refresh of the company directions in aristoteles.lock (Nanda, 2026-11-10): the
// first command of a day fetches each repo; a folder that changed comes in as a draft that its
// owner accepts. A failed fetch stops no command: the project stays on its accepted commit, and
// the next command tries again. Returns the lines that tell what happened.
function refreshCompany(ctx) {
  const lock = readLock(ctx.io.cwd)
  if (!lock) return []
  const today = localDate(ctx.io.now())
  const notes = []
  let changed = false
  for (const [id, entry] of Object.entries(lock)) {
    if (entry.refreshed === today) continue
    let fetched
    try {
      fetched = fetchFolder(ctx.io.env ?? {}, entry)
    } catch (error) {
      notes.push(`refresh: ${id} failed (${String(error.message).split('\n')[0]}); still on ${entry.commit?.slice(0, 7) ?? 'no commit'}`)
      continue
    }
    const { commit, folder } = fetched
    const source = { repo: entry.repo, path: entry.path, ...(entry.tag ? { tag: entry.tag } : {}), commit }
    const done = write({ ...ctx, token: undefined, type: 'company.import' }, (state) => {
      if (!state.config.people.includes(entry.owner)) throw refuse(`${LOCK} ${id}: owner ${entry.owner} is not in the people of work.yaml`)
      const read = state.engine.read
      const d = state.directions[id] ?? state.newDirections[id]
      const now = d && read.current(d)
      const same = now && now.says === folder.says && now.standards.length === folder.standards.length &&
        folder.standards.every((x, i) => now.standards[i].id === x.id && now.standards[i].says === x.says &&
          (now.standards[i].rules ?? []).length === x.rules.length && x.rules.every((r, j) => now.standards[i].rules[j].id === r.id && now.standards[i].rules[j].says === r.says))
      if (same || read.drafts.some((x) => x.of === d && x.source?.commit === commit)) return undefined
      return { who: 'refresh', channel: 'refresh', type: 'company.import',
        data: { id, source, folder, owner: entry.owner, checkers: { checkedBy: entry.checkedBy, rules: entry.rules } } }
    })
    if (done.event) {
      notes.push(`refresh: ${id} at ${commit.slice(0, 7)} came in as ${done.state.created[0]}; it waits for the accept of ${entry.owner} (work direction show ${done.state.created[0]})`)
    }
    Object.assign(entry, { newest: commit, refreshed: today })
    changed = true
  }
  if (changed) writeLock(ctx.io.cwd, lock)
  return notes
}
// After the owner accepts a commit of a company direction, the lockfile follows it.
function followCommit(ctx, version) {
  if (!version?.source) return []
  const lock = readLock(ctx.io.cwd)
  if (!lock?.[version.of.id]) return []
  lock[version.of.id].commit = version.source.commit
  writeLock(ctx.io.cwd, lock)
  return [`${version.of.id} follows ${version.source.commit.slice(0, 7)} of ${version.source.repo} now (${LOCK}).`]
}

export async function main(argv, io) {
  const ctx = context(io)
  const args = parse(argv)
  const name = args.positional.shift()
  if (!name || name === 'help') {
    io.out(USAGE.join('\n'))
    return 0
  }
  const command = COMMANDS[name]
  // The type of the event this command writes, for the checks that every act passes.
  const sub = args.positional[0]
  ctx.type = { task: `task.${sub}`, direction: `direction.${sub}`, recheck: 'review', role: 'role.fit' }[name] ?? name
  ctx.token = args.positional.find((a) => /^a\d+\.[a-z0-9]+$/.test(a))
  try {
    if (!command) throw refuse(`there is no command "${name}"; work help lists them`)
    if (args.broken.length) {
      throw refuse(`${args.broken[0]} is not a flag; a flag is --<lower-case words with dashes>=<value>, such as --max-attempts=2`,
        'run the command again with the flag written so')
    }
    const act = ACT_OF[name]?.(args.positional)
    const known = Array.isArray(FLAGS[name]) ? FLAGS[name] : FLAGS[name]?.[act]
    const unknown = known && args.flags.map(([key]) => key).find((key) => !known.includes(key))
    if (unknown) {
      throw refuse(`work ${name}${act ? ` ${act}` : ''} has no flag --${unknown}; it reads ${known.length ? known.map((k) => `--${k}`).join(', ') : 'no flags'}`,
        'run the command again without that flag')
    }
    if (!known && !FLAGS[name] && args.flags.length) {
      throw refuse(`work ${name} has no flag --${args.flags[0][0]}; it reads no flags`, 'run the command again without that flag')
    }
    // The refresh needs a store, so it runs after init.
    if (name !== 'init' && existsSync(join(io.cwd, LOCK))) {
      let notes = []
      try {
        notes = refreshCompany(ctx)
      } catch (error) {
        if (!/no work store/.test(error.message)) throw error
      }
      for (const note of notes) io.err(note)
    }
    const lines = await command(ctx, args)
    io.out(lines.join('\n'))
    return 0
  } catch (error) {
    io.err(`refused: ${error.message}`)
    const next = error.next ? `next: ${error.next}` : nextFor(argv, ctx)
    if (next) io.err(next)
    return 1
  }
}
