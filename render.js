// Everything that `work` prints for a reader: the brief, the open items, the ready steps.
// Each line says what to do next, with the exact command and its ids filled in.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { kind } from './engine.js'
import { changedSince, sameRevision } from './digest.js'
import { idOf, versionId } from './state.js'

const GUIDES = join(import.meta.dir, 'guides')
// The open drafts of a direction: built on its current version (a new direction: on none), not
// official, and not ended by the Reject of a decider.
const openDrafts = (state, d) => {
  const read = state.engine.read
  return read.drafts.filter((x) => x.of === d && x.base === read.current(d) && !read.madeBy(x) && !read.vetoOf(x))
}
// The directions that have no version yet: each has a draft of a model, and waits for its owner.
const newDirections = (state) => {
  const read = state.engine.read
  return [...new Set(read.drafts.filter((x) => !x.base && !read.directions.includes(x.of)).map((x) => x.of))]
}
// Words of any markdown, on lines that keep the indent of the view.
const indented = (text, pad) => String(text).trimEnd().split('\n').join(`\n${pad}`)

// The headers inside the words of one entry divide them, so that a role reads one piece
// (Nanda, 2026-11-10): a header is a markdown line that starts with #, and its name in an
// address is in lower case, with dashes for spaces (Cost first -> cost-first).
export const headerName = (title) => title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export function headersOf(text) {
  const lines = String(text).split('\n')
  const found = []
  let fence = false
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence
    const m = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (m) found.push({ level: m[1].length, title: m[2], name: headerName(m[2]), line: i })
  })
  return found.map((h, i) => {
    const end = found.slice(i + 1).find((x) => x.level <= h.level)
    return { ...h, text: lines.slice(h.line, end ? end.line : lines.length).join('\n').trimEnd() }
  })
}
// The words of an entry for a brief: the text before its first header, and an address for each
// header, so that a long entry costs only what the role reads.
export function briefWords(text, address, pad) {
  const heads = headersOf(text)
  if (!heads.length) return indented(text, pad)
  const lead = String(text).split('\n').slice(0, heads[0].line).join('\n').trim()
  const top = Math.min(...heads.map((h) => h.level))
  return [lead || '(read the pieces below)', ...heads.map((h) => `${'  '.repeat(h.level - top)}- ${h.title}: work direction show ${address}#${h.name}`)]
    .join(`\n${pad}`)
}
// What answered a Reject: a split or a remake, or the version made from a draft that answers it.
const answeringChange = (state, reject) => state.engine.read.changes.find((c) => c.answers.includes(reject))
const answeringVersion = (state, reject) => {
  const read = state.engine.read
  const draft = read.drafts.find((d) => d.answers.includes(reject) && read.madeBy(d))
  return draft && read.madeBy(draft)
}
// Whose accept a draft waits for, in words: a role, or a person.
export const draftWaitsText = (state, draft) =>
  state.engine.read.draftWaitsFor(draft).map((leaf) => leaf.role ?? leaf.name).join(' or ')
// The id of a stop: an Exhaustion (ex<n>), or the person's Reject by its group id (v<n>).
export const stopIdOf = (state, stop) => (stop.points ? idOf(state, stop).replace(/\.\d+$/, '') : idOf(state, stop))
// What a draft answers, in words: a suggestion, or a Reject (of an earlier draft, a result, or a
// task) with its reason.
const answerText = (state, y) => (y[kind] === 'Suggestion'
  ? `${idOf(state, y)} "${short(y.says, 80)}"`
  : `${idOf(state, y)}, the Reject${y.of[kind] === 'Revision' ? ` of ${idOf(state, y.of)}` : ''} by ${who(state, y.by)}: "${short(y.reason, 80)}"`)
// A draft that a decider rejected waits for a new draft, until a later draft answers the Reject
// or its reviser writes a later draft.
const waitsForNewDraft = (state, x) => {
  const read = state.engine.read
  return read.drafts.every((y) => !y.answers.includes(read.vetoOf(x)) && !(y.of === x.of && y.by === x.by && y.at > x.at))
}
// An assignment whose tree has an open task that follows the direction.
const followsDirection = (state, a, d) => {
  const read = state.engine.read
  return read.tasks.some((t) => !t.closed && read.within(t, a.task) && read.directionsOf(t).includes(d))
}
// The suggestions that wait for a draft, each with its direction: about a direction, or about a
// standard or a rule of its current version, and no draft answers it yet (an official one, or one
// that waits for its deciders). A suggestion with nothing to be about asks for a new direction,
// which no task follows, so it is not here.
// A draft answers a suggestion while it is official, open, or rejected with no newer draft yet
// (then the Reject's row carries it).
const drafted = (state, y) => {
  const read = state.engine.read
  return read.drafts.some((x) => x.answers.includes(y) &&
    (read.madeBy(x) || openDrafts(state, x.of).includes(x) || (read.vetoOf(x) && waitsForNewDraft(state, x))))
}
const openSuggestions = (state) => {
  const read = state.engine.read
  return read.suggestions.filter((y) => y.about && !drafted(state, y)).flatMap((y) => {
    const d = read.directions.find((z) => z === y.about || holderOf(state, z, y.about))
    return d ? [{ y, d }] : []
  })
}
const holderOf = (state, d, about) =>
  state.engine.read.current(d).standards.find((s) => s === about || (s.rules ?? []).includes(about))
// What a draft changes to answer a suggestion: what the direction says, or the standard.
const suggestionNeeds = (state, { y, d }) =>
  (y.about === d ? `a draft that changes what ${d.id} says` : `a draft that changes the standard ${holderOf(state, d, y.about).id}`)
// Who wrote a draft: an assignment, a model run, or the refresh that brought in a commit of a
// company direction.
const drafter = (state, x) => (x.source
  ? `the refresh: commit ${x.source.commit.slice(0, 7)}${x.source.tag ? ` (tag ${x.source.tag})` : ''} of ${x.source.repo} (${x.source.path})`
  : who(state, x.by))
// Who writes the next draft after a decider's Reject: its reviser; when the reviser is finished,
// an open high role of a tree that follows the direction; else a new one that the person assigns.
export const reviseAgain = (state, x) => {
  const read = state.engine.read
  // A company direction changes in its repo: the project stays on its accepted commit.
  if (x.source) return { text: `${x.of.id} stays on its accepted commit; it changes in ${x.source.repo} (${x.source.path}), with a pull request` }
  // A model run outside any task (the skill that reads an app) is run again; it answers the Reject.
  if (x.by[kind] !== 'Assignment') {
    return { text: `its writer ${who(state, x.by)}, a model run outside any task, writes a new draft that answers it`,
      step: `work direction new --file=<direction.yaml> --by=${x.by.actor?.name ?? 'model'} --answers=${idOf(state, read.vetoOf(x))}` }
  }
  if (!x.by.finished) return { text: 'its reviser revises the current version again' }
  const finished = `its reviser ${idOf(state, x.by)} is finished`
  const next = read.assignments.find((y) => !y.finished && y.role.tier === 'high' && followsDirection(state, y, x.of))
  if (next) return { text: `${finished}; ${idOf(state, next)} (${next.role.role}) revises the current version` }
  const top = read.tasks.find((t) => !t.closed && !t.serves && read.directionsOf(t).includes(x.of))
  return { text: `${finished}; a new ${x.by.role.role} revises the current version`,
    step: `work assign ${top ? idOf(state, top) : '<task>'} --role=${x.by.role.role}` }
}
const guideCache = {}
export const guide = (tier) =>
  (guideCache[tier] ??= Bun.YAML.parse(readFileSync(join(GUIDES, `${tier}.yaml`), 'utf8')))

const RANK = { low: 1, medium: 2, high: 3 }
const block = (head, lines) => {
  const [first = '', ...rest] = lines
  return [`${head.padEnd(Math.max(9, head.length + 1))}${first}`, ...rest.map((l) => `${' '.repeat(9)}${l}`)]
}
// "a" or "an", as the word starts.
const an = (word) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`)
const short = (text, n = 120) => (text.length > n ? `${text.slice(0, n - 3)}...` : text)
export const clock = (iso) => (iso ? iso.slice(11, 16) : '--:--')
// An assignment by its id; a person by name, marked when an agent relayed their words.
export const who = (state, actor) => {
  if (actor?.[kind] === 'Assignment') return idOf(state, actor)
  if (actor?.actor) return `${actor.actor.name ?? actor.actor}${actor.channel?.startsWith('relay') ? ' (relayed)' : ''}`
  return actor?.name ?? actor
}
const checkerOf = (rule) =>
  rule.checkedBy ? rule.checkedBy.role : 'decider'

export const lowerRoles = (state, a) =>
  Object.values(state.roles).filter((r) => r.tier && RANK[r.tier] < RANK[a.role.tier])
const partsOf = (state, task) => state.engine.read.tasks.filter((t) => t.serves === task)
// The tasks that a task needs: their accepted work goes into its result.
const needsOf = (task) => task.needs ?? []

function actKinds(state, a) {
  const read = state.engine.read
  const acts = read.actsOf(a, state.now)
  return {
    do: acts.some((x) => x.act === 'Do'),
    review: acts.some((x) => x.act === 'Review' || x.act === 'Approve'),
    approve: acts.some((x) => x.act === 'Approve'),
    change: read.mayChange(a, a.task, state.now),
    lower: lowerRoles(state, a).length > 0,
    top: !a.parent && a.role.tier !== 'low',
    evaluate: a.role.tier === 'high',
    any: true,
  }
}
const lowChecker = (state, a) => a.role.tier === 'low' && !actKinds(state, a).do

export const latestResult = (state, task) => state.engine.read.resultsOf(task).at(-1)

// A low checker checks its checks; everyone else reads every rule of the task.
export function rulesFor(state, a) {
  const read = state.engine.read
  return a.role.tier === 'low' && actKinds(state, a).review ? read.checksOf(a) : read.rulesOf(a.task)
}

// Role words and output forms name the workspace and the context; fill them in. A task that
// needs other tasks reports its whole workspace.
function fillText(text, task, state) {
  const t = task.aiDescription
  let out = text.replaceAll('<task id>', task.id ?? '<task id>')
  if (t.workspace?.length === 1) {
    if (needsOf(task).length && !t.context?.region) out = out.replaceAll('<file>#<region>', t.workspace[0].path)
    out = out.replaceAll('<file>', t.workspace[0].path).replaceAll('<repo>', t.workspace[0].path)
  }
  for (const [key, value] of Object.entries(t.context ?? {})) out = out.replaceAll(`<${key}>`, value)
  return out
}
export function outputForm(state, a) {
  const t = a.task.aiDescription
  // A task that needs others reports its whole workspace: a document file, or a commit in the
  // workspace repo. A task with a region keeps its region: a part that runs after another part
  // owns only its own region of the file.
  if (needsOf(a.task).length > 0 && t.workspace?.length === 1 && !t.context?.region) {
    return a.role.config.output?.includes('@') ? `${t.workspace[0].path}@<commit>` : t.workspace[0].path
  }
  const form = a.role.config.output
  return form ? fillText(form, a.task, state) : '"<what you made, and where it is>"'
}

// A maker that reports a commit works in its own git worktree. Any other maker writes the files of
// its workspace in the project folder, which all makers share.
const writesInPlace = (a) => (a.role.config?.output?.includes('@') ? [] : (a.task.aiDescription.workspace ?? []).map((w) => w.path))
const overlap = (x, y) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)

// One maker for each file at a time (Nanda, 2026-11-08): makers that write one file in the
// project folder take turns in the order of their assigns, and a turn ends when its maker
// finishes. So a region of one part cannot overwrite a region of another, and the file changes
// one maker after the other. Returns the file that maker a waits for and the earliest open maker
// before it, or undefined when it is a's turn.
export function fileTurn(state, a) {
  const read = state.engine.read
  if (!read.isDo(a.role)) return undefined
  const files = writesInPlace(a)
  for (const x of read.assignments) {
    if (x === a) return undefined
    if (x.finished || !read.isDo(x.role)) continue
    for (const f of writesInPlace(x)) {
      const path = files.find((g) => overlap(f, g))
      if (path) return { path, before: x }
    }
  }
  return undefined
}
// The makers that wait for maker x to finish.
export const waitersOf = (state, x) => state.engine.read.assignments.filter((y) => fileTurn(state, y)?.before === x)
// Why maker x makes no result now, so that its parent finishes it when another maker waits for
// its file; undefined while it can work.
export function idleWhy(state, x) {
  const need = x.task.needs.find((n) => !state.engine.taskAccepted(n, state.now))
  if (x.task.closed) return `its task ${idOf(state, x.task)} is closed`
  if (state.engine.taskAccepted(x.task, state.now)) return `${idOf(state, x.task)} is accepted`
  if (!state.engine.read.openDo(x)) return 'it has no attempts left'
  if (state.engine.read.workStop(x.task, state.now)) return `${idOf(state, x.task)} waits for an evaluation, so it cannot report`
  if (need) return `${idOf(state, x.task)} needs ${idOf(state, need)} (${need.name}), which is not accepted, so it cannot report`
  return undefined
}

// A git source is a workspace with a base. The CLI reads the base of each commit from git, as
// evidence; no agent records its revision. A new commit on the base asks for no recheck: work
// that uses other work, or changes the same files, needs it, so it runs after it.
export const gitSources = (state) =>
  state.engine.read.tasks.flatMap((t) => t.aiDescription?.workspace ?? []).filter((w) => w.base)

// A result made from a revision of a source outside git that is no longer the one that a medium
// or high agent recorded with work source.
export function staleOf(state, result) {
  const workspace = result.task.aiDescription.workspace ?? []
  for (const m of result.madeFrom ?? []) {
    const now = m.source && state.sources[m.source]
    const path = workspace.find((w) => w.source === m.source)?.path
    if (now && m.revision && !sameRevision(state.cwd ?? '.', path, m.revision, now)) {
      return { source: m.source, was: m.revision, now }
    }
  }
  return undefined
}
// A point that only a direction change can close, and that no change has closed yet.
const needsChange = (state, item) =>
  item.kind === 'change' || (item.kind === 'reject' && !item.ref.breaks && !state.engine.read.answered(item.ref))
// The open Rejects of a task itself: a direction change or a split answers each one, also
// when the Reject came after the task's latest result, and while its parts are open.
const taskRejects = (state, task) => state.engine.read.reviews.filter((r) => r.of === task && r.decision === 'Reject' &&
  !r.redo && !state.engine.read.answered(r))
const activeWaivers = (state, result) => state.engine.read.notes.filter((n) => n.kind === 'Finding' && n.about === result &&
  n.notChecked && (!state.now || Date.parse(n.until) >= Date.parse(state.now)))

// The open items of one result, with ids. A low maker sees what to fix, a low checker only
// its own checks; medium, high, and views see everything.
export function resultItems(state, result, a) {
  const checker = a && lowChecker(state, a)
  const checks = a ? rulesFor(state, a) : []
  const wanted = (item) => {
    if (checker) return item.kind === 'evidence' && checks.includes(item.ref)
    if (!a || a.role.tier !== 'low') return true
    // The decider's accept is not a low maker's act, so its OPEN does not show it.
    if (item.kind === 'decider') return false
    return item.kind !== 'evidence' || item.rejects.length > 0
  }
  const r = idOf(state, result)
  const lines = []
  if (state.cwd && changedSince(state.cwd, result)) {
    lines.push(`${r} changed after it was reported; the maker reports it again`)
  }
  const stale = staleOf(state, result)
  if (stale && !checker) lines.push(`${r} was built on ${stale.source}@${stale.was}; ${stale.source} is now at ${stale.now}`)
  const quote = (ref) => (ref?.quote ? `: "${short(ref.quote, 80)}"` : '')
  for (const item of state.engine.blockerItems(result, state.now).filter(wanted)) {
    const id = idOf(state, item.ref)
    const by = item.ref?.by ? `, ${who(state, item.ref.by)}${quote(item.ref)}` : ''
    if (item.kind === 'evidence' && item.rejects.length > 0) {
      for (const reject of item.rejects) {
        lines.push(`${idOf(state, reject)} breaks ${item.ref.id}: "${reject.reason}" (on ${idOf(state, reject.of)}, ${who(state, reject.by)}${quote(reject)})`)
      }
    } else if (item.kind === 'evidence') {
      lines.push(`no evidence on ${r} for ${item.ref.id} (checked by ${checkerOf(item.ref)})`)
    } else if (item.kind === 'reject' && state.engine.read.answered(item.ref) &&
      (!item.ref.breaks || answeringChange(state, item.ref) || answeringVersion(state, item.ref))) {
      // The change that answered it: a split or a remake of the task, or a direction version
      // (for a point with a rule: the version that took the rule off the task).
      const change = answeringChange(state, item.ref)
      const version = answeringVersion(state, item.ref)
      lines.push(change
        ? `${id} rejected ${r}: "${item.ref.reason}"; the ${change[kind] === 'Split' ? 'split' : 'remake'} of ${idOf(state, change.task)} answered it`
        : `${id} rejected ${r}: "${item.ref.reason}"; ${version ? versionId(version) : 'a direction change'} answered it` +
          `${item.ref.breaks ? ` (${item.ref.breaks.id} left the task)` : ''}, so the next result follows the new version`)
    } else if (item.kind === 'reject' && !item.ref.breaks) {
      lines.push(`${id} needs a direction change: "${item.ref.reason}" (on ${r}${by})`)
    } else if (item.kind === 'reject') {
      lines.push(`${id} breaks ${item.ref.breaks.id}: "${item.ref.reason}" (on ${r}${by})`)
    } else if (item.kind === 'unchanged') {
      lines.push(`${id}: ${r} is the same work that was rejected: "${item.ref.reason}"`)
    } else if (item.kind === 'redo') {
      lines.push(`${id} asks for a new result: "${item.ref.reason}" (${who(state, item.ref.by)})`)
    } else if (item.kind === 'change') {
      lines.push(`${id} needs a direction change: "${item.ref.reason}" (${who(state, item.ref.by)}${quote(item.ref)})`)
    } else if (item.kind === 'raise') {
      lines.push(`${id} raised on ${r}: "${item.ref.reason}" (waits for ${who(state, item.ref.answerBy)})`)
    } else if (item.kind === 'question') {
      lines.push(`${id} waits for ${who(state, item.ref.answerBy)}: ${short(item.ref.text)}`)
    } else if (item.kind === 'old-version') {
      lines.push(`${r} was checked under an old version of ${item.ref.id}; it is checked again under ` +
        `${versionId(state.engine.read.current(item.ref))}: ${item.rules.map((x) => `${x.id} (${checkerOf(x)})`).join(', ')}`)
    } else if (item.kind === 'decider') {
      lines.push(item.old
        ? `${r} was accepted by its decider under an old version; the decider accepts it again`
        : `no accept yet by ${item.waits ?? `a role that decides ${r}`}`)
    } else if (item.kind === 'maker') {
      lines.push(`${r} was reviewed by its own maker`)
    } else if (item.kind === 'old-need') {
      lines.push(`${r} was made before ${idOf(state, item.newer)} of ${idOf(state, item.ref)} (${item.ref.name}); ` +
        'the maker reports again with that work')
    } else {
      lines.push(`${item.text} (on ${r})`)
    }
  }
  if (!checker) {
    for (const n of activeWaivers(state, result)) {
      lines.push(`${idOf(state, n)} waives ${n.notChecked.map((x) => x.id).join(', ')} on ${r} until ${n.until} (${who(state, n.by)}); the task stays open`)
    }
  }
  return lines
}

// What stops a task besides its latest result: its questions, Rejects of the task, and the
// suggestions about its directions that no official draft answers yet.
function taskItems(state, task) {
  const read = state.engine.read
  const lines = []
  for (const q of read.openQuestions(task)) lines.push(`${idOf(state, q)} waits for ${who(state, q.answerBy)}: ${short(q.text)}`)
  for (const r of read.reviews.filter((x) => x.of === task && x.decision === 'Reject' && !read.answered(x))) {
    lines.push(`${idOf(state, r)} returns the task: "${r.reason}" (${who(state, r.by)}); a direction change or a split answers it`)
  }
  const answered = (x) => read.drafts.some((d) => d.answers.includes(x) && read.madeBy(d))
  for (const x of read.suggestions.filter((y) => y.about && !answered(y) && touches(state, y.about, task))) {
    lines.push(`${idOf(state, x)} suggests about ${aboutId(x.about)}: "${short(x.says)}" (${who(state, x.by)})`)
  }
  return lines
}
const touches = (state, about, task) => {
  const read = state.engine.read
  const directions = read.directionsOf(task)
  return directions.includes(about) ||
    directions.some((d) => read.current(d).standards.some((s) => s === about || (s.rules ?? []).includes(about)))
}
const aboutId = (about) => about.id ?? about.says

export function openItems(state, task, a) {
  const result = latestResult(state, task)
  const own = result ? resultItems(state, result, a) : []
  if (a && lowChecker(state, a)) return own
  return [...new Set([...own, ...taskItems(state, task)])]
}

// Answers: a low maker sees the answers to its own questions, medium and high the answers of
// the task; a low checker none. Each is cut short; work question show prints it in full.
// The programs that run on each report of this role.
const programsFor = (state, a) => Object.entries(state.roles)
  .filter(([, r]) => r.config.kind === 'program' && r.acts.some((x) => x.act === 'Review' && x.resultsOf.includes(a.role)))
  .map(([name, r]) => `${name}: ${r.config.run} (runs on each report, in a clean checkout of a commit; checks ${r.config.checks.join(', ')})`)

const fill = (text, values) => text.replace(/\{(\w+)\}/g, (all, key) => values[key] ?? all)

// The commands of the tier guide that this assignment may run, with its ids filled in.
export function turnLines(state, a, token) {
  const g = guide(a.role.tier)
  const kinds = actKinds(state, a)
  const result = latestResult(state, a.task)
  // The evidence lines name only the rules whose evidence from this role counts.
  const checks = rulesFor(state, a).filter((r) =>
    r.checkedBy === a.role || (r.checkedBy === undefined && kinds.approve) || (a.role.tier === 'low' && kinds.review))
  const values = {
    you: token,
    id: idOf(state, a),
    task: idOf(state, a.task),
    result: result ? idOf(state, result) : '<result>',
    output: outputForm(state, a),
    evidence: checks.length > 0
      ? checks.map((r) => `--evidence="${r.id} | <where you looked${result ? ` in ${result.output}` : ''}> | <what you saw>"`).join(' ')
      : `--evidence="<the place in ${result ? result.output : 'the result'} where you read it> | <what you saw there>"`,
    lower: lowerRoles(state, a).map((r) => r.role).join('|'),
  }
  const shown = Object.entries(g.commands).filter(([, c]) => kinds[c.when])
  const width = Math.max(...shown.map(([name]) => name.length)) + 2
  return shown.flatMap(([name, c]) => [
    `  ${name.padEnd(width)}${fill(c.run, values)}`,
    `  ${' '.repeat(width)}${fill(c.rule, values)}`,
  ])
}
const stopLine = (state, a) => {
  const stop = guide(a.role.tier).stop
  return typeof stop === 'string' ? stop : actKinds(state, a).do ? stop.do : stop.review
}

export function renderBrief(state, a, { token }) {
  const read = state.engine.read
  const id = state.meta.get(a)?.id ?? 'a?'
  const tier = a.role.tier
  const task = a.task
  const t = task.aiDescription
  const kinds = actKinds(state, a)
  const attempts = kinds.do ? ` · attempt ${read.used(a) + 1}${a.maxAttempts ? ` of ${a.maxAttempts}` : ''}` : ''
  const intro = guide(tier).intro.split('\n')
  const lines = [
    `work brief ${id} · ${a.role.role} (${tier}) · ${idOf(state, task)} ${task.name}${attempts}`,
    `snapshot: ${read.directionsOf(task).map((d) => versionId(read.current(d))).join(', ') || 'no directions'}`,
    ...(state.cwd ? [`project: ${state.cwd} (run every work command in this folder)`] : []),
    '',
    ...block('YOU ARE', [`${tier} tier. ${intro[0]}`, ...intro.slice(1)]),
    ...block('ROLE', [fillText(a.role.config.description, task, state),
      ...a.role.config.responsibilities.map((r) => `- ${fillText(r, task, state)}`)]),
    // A low checker reads the maker's task to know what was asked; it writes nothing.
    ...block('TASK', [lowChecker(state, a) ? `the maker's task (you check it; you do not do it): ${t.text}` : t.text,
      ...(t.partOf ? [`part of: ${t.partOf}`] : [])]),
  ]
  // A closed task takes no work: its assignment stops, and its parent assigns on the new task.
  if (task.closed) {
    const remade = task.closed.replacedBy
    let old = task
    while (old.serves && old.serves.closed?.replacedBy === remade) old = old.serves
    lines.splice(3, 0, `CLOSED   ${idOf(state, task)} was closed ${remade ? `when ${idOf(state, old)} was remade as ${idOf(state, remade)}` : `("${short(task.closed.reason ?? '', 80)}")`}; ` +
      `STOP: ${a.parent ? 'your parent' : 'the person'} ${remade ? `assigns on ${idOf(state, remade)}` : 'decides what is next'}.`, '')
  }
  // The tasks that this task needs, one line each: their accepted work goes into its result.
  const needs = read.briefOf(a, state.now, (x) => state.idOf.get(x) ?? who(state, x)).needs
  if (needs.length) {
    const waiting = task.needs.some((n) => !state.engine.taskAccepted(n, state.now))
    lines.push(...block('NEEDS', [...needs, waiting
      ? (kinds.do ? 'Not all of them are accepted yet. Do not report until each one is; STOP and tell your parent.'
        : 'Not all of them are accepted yet. This task takes its result after each one is.')
      : a.role.config.output?.includes('@')
        ? 'Their work is done. Merge their accepted commits with git merge (a squash or a copy is refused); ' +
          'then do only what your task asks beyond them, and what combines them.'
        : 'Their work is done: use it as it is (a change to it is refused). ' +
          'Do only what your task asks beyond them, and what combines them.']))
  }
  // The latest evaluation of the task: what went wrong before, why, and what changed for it.
  const evaluation = read.briefOf(a, state.now, (x) => state.idOf.get(x) ?? who(state, x)).evaluation
  if (evaluation.length) lines.push(...block('EVALUATION', evaluation))
  // The starting point: earlier work that the maker starts from; its result is new work.
  const start = t.from
  if (start && !lowChecker(state, a)) {
    lines.push(...block('FROM', [`${idOf(state, start)} of ${idOf(state, start.task)} ${start.task.name}: ${start.output}`,
      'Start from this work and change what your task asks; a report of it as it is is refused.']))
  }
  // A code maker works in its own git worktree, so two makers on one repo do not change each
  // other's files; the work commands still run in the project folder. It starts at the commit
  // of the starting point, or at the base.
  const tree = kinds.do && a.role.config.output?.includes('@') ? join(state.cwd ?? '.', '.work', 'trees', id) : undefined
  const startAt = (w) => (start && start.output.startsWith(`${w.path}@`) ? start.output.split('@')[1] : w.base ?? 'HEAD')
  const programs = kinds.do ? programsFor(state, a) : []
  const waits = fileTurn(state, a)
  if (t.workspace?.length || programs.length) {
    lines.push(...block('WORK IN', [...(t.workspace ?? []).flatMap((w) => [
      `${w.path} (source ${w.source}${w.base ? `, base ${w.base}` : ''})` +
      `${w.verify && !lowChecker(state, a) ? `; verify: ${w.verify} (run it in ${tree ? 'your worktree' : 'the project folder'}; exit 0 = ready)` : ''}`,
      ...(tree ? [`your worktree: ${tree}, branch work/${id} from ${startAt(w)}; make and commit the change only there`,
        `make it once, if it is not there: git -C ${w.path} worktree add -b work/${id} ${tree} ${startAt(w)}`] : []),
      // One maker writes a file at a time: a maker that waits for the file does not touch it.
      ...(waits && overlap(waits.path, w.path) ? [`${idOf(state, waits.before)} (${idOf(state, waits.before.task)} ${waits.before.task.name}) writes ${waits.path} first; ` +
        `do not change it: your turn comes when ${idOf(state, waits.before)} finishes`] : [])]),
    ...programs]))
  }
  if (t.references?.length) lines.push(...block('READ', t.references))
  const rules = rulesFor(state, a)
  if (rules.length) {
    const width = Math.max(...rules.map((r) => r.id.length)) + 2
    const versionOf = (r) => (a.under ?? []).find((v) => v.standards.some((x) => (x.rules ?? []).includes(r)))
    lines.push(...block(lowChecker(state, a) ? 'CHECKS' : 'RULES',
      rules.map((r) => `${r.id.padEnd(width)}${briefWords(r.says, `${versionOf(r) ? versionId(versionOf(r)) : 'its direction'}#${r.id}`, ' '.repeat(9 + width))}  (${checkerOf(r)})`)))
  }
  const result = lowChecker(state, a) && state.meta.get(a)?.claim?.result
    ? state.byId.get(state.meta.get(a).claim.result) : latestResult(state, task)
  if (kinds.review && result) {
    // A commit names the base it was made from, so a checker can compare with it.
    const from = result.madeFrom.filter((m) => m.source && m.revision).map((m) => `${m.source}@${m.revision}`)
    lines.push(...block('REVIEW', [`${idOf(state, result)} by ${idOf(state, result.by)} (${result.by.role.role}): ${result.output}` +
      `${from.length ? ` (made from ${from.join(', ')})` : ''}`]))
  } else if (lowChecker(state, a)) {
    lines.push(...block('REVIEW', ['nothing is reported yet; STOP and tell your parent']))
  }
  // ANSWERS, NOTES, and NEEDS come from the engine's brief, with the CLI's ids.
  const short3 = read.briefOf(a, state.now, (x) => state.idOf.get(x) ?? who(state, x))
  const answers = short3.answers
  if (answers.length) lines.push(...block('ANSWERS', answers))
  const notes = short3.notes
  if (notes.length) lines.push(...block('NOTES', notes))
  const open = openItems(state, task, a)
  if (open.length) {
    const shown = open.slice(0, 6)
    const more = open.length - shown.length
    lines.push(...block('OPEN', [...shown, ...(more > 0 ? [`(${more} more: work blockers ${idOf(state, latestResult(state, task))})`] : [])]))
  }
  const ready = tier !== 'low' ? nextSteps(state, a, token) : []
  if (ready.length) lines.push('', 'READY', ...ready.map((s) => `  ${s}`))
  lines.push('', 'YOUR TURN', ...turnLines(state, a, token), stopLine(state, a))
  return lines.join('\n')
}

// The steps that are ready in the subtree of a medium or high assignment.
export function nextSteps(state, a, token) {
  const read = state.engine.read
  const steps = []
  const add = (what, command) => steps.push(what, ...(command ? [`  ${command}`] : []))
  const live = (t) => read.assignments.filter((x) => x.task === t && !x.finished)
  const meta = (x) => state.meta.get(x)
  const raisedBy = (result) => read.reviews.some((r) => r.decision === 'Raise' && r.by === a && r.of === result &&
    !read.reviews.some((x) => x.settles === r))
  const latestOf = (r) => latestResult(state, r.task) === r && !state.engine.taskAccepted(r.task, state.now) && !r.task.closed
  // The change points of a result, as steps for this assignment.
  // An open draft for a direction of the task waits for its deciders; a second revise would only
  // make another draft, so the step says what it waits for.
  const pendingOf = (t) => read.directionsOf(t).flatMap((d) => openDrafts(state, d))
  const changeStep = (t, result, item, first = '') => {
    const vid = idOf(state, item.ref)
    const pending = pendingOf(t)
    if (pending.length) {
      const ids = pending.map((x) => idOf(state, x))
      add(`${vid} needs a direction change${first}; ${ids.join(', ')} waits for the accept of ${draftWaitsText(state, pending[0])} (work direction show ${ids[0]})`)
      return
    }
    add(`${vid} needs a direction change${first}: "${item.ref.reason}"`, a.role.tier === 'high'
      ? `work direction revise ${token} ${read.directionsOf(t).map((d) => d.id).join('|')} --file=<edit.yaml> --answers=${vid}`
      : `work raise ${token} --result=${idOf(state, result)} --reason="${vid} needs a direction change"`)
  }
  const changeSteps = (t, result, items) => {
    if (raisedBy(result)) return
    for (const item of items.filter((i) => needsChange(state, i))) changeStep(t, result, item)
  }
  // The token is shown only at assign; a parent that lost it ends the child and assigns again.
  // A finish and a new assign start a new round, so the line says when it is right.
  const noToken = (child, t) => steps.push(`  the token is the one that work assign printed for ${idOf(state, child)}; ` +
    `give the same command to a new subagent. Only if you lost that token: work finish ${token} ${idOf(state, child)}, ` +
    `then work assign ${token} ${idOf(state, t)} --role=${child.role.role}` +
    (read.isDo(child.role) ? ' (a new maker; when its latest try has a fault, the task waits for an evaluation first)' : ''))
  const checkerSteps = (t, result, roles) => {
    const rid = idOf(state, result)
    for (const role of roles) {
      if (role.config?.kind === 'program') {
        add(`${role.role} runs on the next report of ${idOf(state, t)}; a recheck asks for one`, `work recheck ${token} ${rid} --reason="check again under the new version"`)
        continue
      }
      // Only a child of this assignment is this assignment's to start or release; with no
      // child for the role, it assigns one, or raises when the role is not of a lower tier.
      const checker = live(t).find((x) => x.role === role && x.parent === a)
      if (role === a.role) {
        add(`check ${rid} yourself`, `work review ${token} ${rid} accept --evidence="<rule id> | <where> | <what>"`)
      } else if (checker && meta(checker).claim) {
        add(`${idOf(state, checker)} is checking ${rid} (claimed since ${clock(meta(checker).claim.at)}); if its subagent stopped:`,
          `work release ${token} ${idOf(state, checker)}`)
      } else if (checker) {
        add(`check ${rid}: give a new subagent the command of ${idOf(state, checker)}; the same assignment checks each new result, with the token that work assign printed for it`,
          `work brief ${idOf(state, checker)}.<the token that assign printed>`)
        noToken(checker, t)
      } else if (RANK[role.tier] >= RANK[a.role.tier]) {
        add(`${rid} needs ${role.role}, which only a higher tier assigns`, `work raise ${token} --result=${rid} --reason="${rid} needs ${role.role}"`)
      } else {
        add(`check ${rid} with ${role.role}`, `work assign ${token} ${idOf(state, t)} --role=${role.role}`)
      }
    }
  }

  for (const q of read.notes.filter((n) => n.kind === 'Question' && n.answer === undefined && n.answerBy === a)) {
    const qid = idOf(state, q)
    add(`answer ${qid}: ${short(q.text, 200)}`, `work answer ${token} ${qid} --text="<the answer>"`)
  }
  for (const raise of read.reviews.filter((r) => r.decision === 'Raise' && r.answerBy === a && latestOf(r.of) &&
    !read.reviews.some((x) => x.settles === r))) {
    add(`settle ${idOf(state, raise)}: ${raise.reason}`,
      `work review ${token} ${idOf(state, raise.of)} accept --settles=${idOf(state, raise)} --reason="<the decision>"`)
  }
  // A result made from an old revision of a source outside git shows until a newer result exists.
  for (const t of read.tasks.filter((x) => read.within(x, a.task) && !x.closed)) {
    const result = latestResult(state, t)
    const stale = result && staleOf(state, result)
    if (stale && read.decidesResults(a, result, state.now) && !read.reviewsOf(result).some((v) => v.redo && !read.answered(v))) {
      add(`${idOf(state, result)} was built on ${stale.source}@${stale.was}; ${stale.source} is now at ${stale.now}`,
        `work recheck ${token} ${idOf(state, result)} --reason="${stale.source} is now at ${stale.now}"`)
    }
    // A result made before the latest result of a task that it needs: its maker reports again.
    const oldNeed = result && state.engine.blockerItems(result, state.now).find((i) => i.kind === 'old-need')
    if (oldNeed && read.decidesResults(a, result, state.now) && !read.reviewsOf(result).some((v) => v.redo && !read.answered(v))) {
      const newer = `${idOf(state, oldNeed.newer)} of ${idOf(state, oldNeed.ref)}`
      add(`${idOf(state, result)} was made before ${newer}; its maker reports again with that work`,
        `work recheck ${token} ${idOf(state, result)} --reason="${newer} is newer; use it"`)
    }
  }
  // A child whose task closed (or was remade) takes no more work: the parent finishes it.
  for (const child of read.assignments.filter((x) => x.parent === a && !x.finished && x.task.closed)) {
    const remade = child.task.closed.replacedBy
    add(`finish ${idOf(state, child)}: its task ${idOf(state, child.task)} is closed${remade ? `, and ${idOf(state, remade)} replaces it` : ''}`,
      `work finish ${token} ${idOf(state, child)}`)
  }
  if (a.task.closed) {
    add(`${idOf(state, a.task)} is closed: finish your children, then yourself`, `work finish ${token}`)
    return steps
  }
  // One maker writes a file at a time: a child maker that makes no more results, and that another
  // maker waits for, is finished, so that the next maker starts.
  for (const child of read.assignments.filter((x) => x.parent === a && !x.finished && !x.task.closed)) {
    const waiters = waitersOf(state, child)
    const done = idleWhy(state, child)
    if (!waiters.length || !done) continue
    add(`finish ${idOf(state, child)}: ${done}, and ${waiters.map((y) => idOf(state, y)).join(', ')} ` +
      `${waiters.length > 1 ? 'wait' : 'waits'} for ${fileTurn(state, waiters[0]).path}`, `work finish ${token} ${idOf(state, child)}`)
  }
  // A task that waits for an evaluation, or for the change that its evaluation asks for. The
  // high role of its tree writes the evaluation; everyone else is told whom the task waits for.
  function evaluationStep(t) {
    const tid = idOf(state, t)
    // Each stop gets its own evaluation, so each stop that waits gets its own line.
    const stops = read.stopsOf(t).filter((x) => !read.stopAnswered(x))
    for (const waits of stops) {
      const sid = stopIdOf(state, waits)
      const what = waits[kind] === 'Exhaustion'
        ? `${idOf(state, waits.maker)} used its last try on a fault (${sid}: ${idOf(state, waits.result)}, ${short(waits.fault.reason ?? '', 100)})`
        : `${who(state, waits.by.actor)} rejected ${idOf(state, waits.of)} (${sid}): "${short(waits.reason, 100)}"`
      const pending = read.evaluations.filter((e) => e.answers === waits && !read.evaluationDecision(e) && !read.evaluationCounts(e)).at(-1)
      if (pending) {
        add(`${idOf(state, pending)} evaluates ${tid} at the level ${pending.level}, and waits for ${t.owner.name}'s accept`)
        continue
      }
      if (a.role.tier === 'high') {
        add(`evaluate ${tid}: ${what}. Say what is wrong, why it cannot be done as asked, and what to improve; the level is that of the deepest cause`,
          `work evaluate ${token} ${sid} --wrong="<what is wrong, with the results and the rules>" --why="<why it cannot be done as asked>" ` +
          '--improve="<one change; one --improve for each change>" --level=task|standard|direction|principle')
        continue
      }
      const high = read.assignments.find((x) => !x.finished && x.role.tier === 'high' && read.within(t, x.task))
      add(high ? `${tid} waits for an evaluation by ${idOf(state, high)} (${high.role.role}): ${what}`
        : `${tid} waits for an evaluation: ${what}; no high role works on it, so the person assigns one`)
    }
    if (stops.length) return
    // Evaluated; the next maker starts only on inputs that differ from those that failed.
    const e = read.evaluations.filter((x) => read.stopTask(x.answers) === t && read.evaluationCounts(x)).at(-1)
    const eid = e ? idOf(state, e) : 'the evaluation'
    const asks = `${eid} asks for: "${short(e?.improve.join('; ') ?? '', 160)}"`
    // The change is made: a split gives the task parts, and a draft waits for its deciders.
    if (read.tasks.some((p) => p.serves === t && !p.closed)) {
      add(`${tid} waits for its parts, as ${eid} asks`)
      return
    }
    const pending = pendingOf(t)
    if (pending.length) {
      add(`${tid}: ${idOf(state, pending[0])} waits for the accept of ${draftWaitsText(state, pending[0])}; it is the change that ${eid} asks for (work direction show ${idOf(state, pending[0])})`)
      return
    }
    if (a.role.tier !== 'high') {
      add(`${tid} waits for the change that ${asks}`)
      return
    }
    // A task with no direction gets its change through a remake; so does a change of the task.
    if (e?.level === 'task' || read.directionsOf(t).length === 0) {
      const region = t.aiDescription.context.region
      add(`${tid}: ${asks}; ${region ? 'remake it (its region is one unit, so it is not split)' : 'remake or split it'}, then a new maker starts`, read.mayChange(a, t, state.now)
        ? `work task remake ${token} ${tid} --file=<task.yaml> --reason="as ${eid} says"${region ? '' : `, or work task split ${token} ${tid} --file=<parts.yaml>`}`
        : `work raise ${token} --reason="${tid} needs the remake that ${eid} asks for"`)
      return
    }
    add(`${tid}: ${asks}; draft that change, then a new maker starts when its deciders accept it`,
      `work direction revise ${token} ${read.directionsOf(t).map((d) => d.id).join('|')} --file=<edit.yaml>`)
  }
  // The decider decides when only its accept is left; it may Reject instead.
  function deciderStep(result, items) {
    const rid = idOf(state, result)
    const decider = items.find((i) => i.kind === 'decider')
    if (!decider || !items.every((i) => i.kind === 'decider')) return
    if (read.decidesNow(a, result, state.now)) {
      add(decider.old ? `decide ${rid} again under the new version` : `decide ${rid}`,
        `work review ${token} ${rid} accept --evidence="<the place in ${result.output} where you read it> | <what you saw there>", or reject it with --point`)
      return
    }
    // The decision waits for another role: say who, so the work does not look finished.
    for (const role of read.decisionWaitsOn(result)) {
      const decider = read.assignments.find((x) => !x.finished && x.role === role && read.within(result.task, x.task))
      if (decider) add(`${rid} waits for the accept of ${idOf(state, decider)} (${role.role})`)
      // A role of a lower tier is this assignment's to give; a higher one is the person's.
      else if (lowerRoles(state, a).includes(role)) {
        add(`${rid} waits for the accept of ${an(role.role)}, and no ${role.role} works on ${idOf(state, result.task)}`,
          `work assign ${token} ${idOf(state, result.task)} --role=${role.role}`)
      } else add(`${rid} waits for the accept of ${an(role.role)}, and no ${role.role} works on ${idOf(state, result.task)}; the person assigns one`)
    }
  }
  // A draft for a direction of this tree that waits for this role's accept: a role that
  // approvedBy names, or, with none, a role with a Change act on the direction. The reviser and
  // the actors below it do not review it.
  const own = read.directions.filter((d) => read.tasks.some((t) => read.within(t, a.task) && read.directionsOf(t).includes(d)))
  for (const x of own.flatMap((d) => openDrafts(state, d))) {
    const reviserTree = x.by === a || (() => { for (let y = a.parent; y; y = y.parent) if (y === x.by) return true; return false })()
    const mine = read.draftWaitsFor(x).some((leaf) => (leaf.acts ? leaf === a.role : read.mayChange(a, x.of, state.now)))
    if (!mine || read.reviewsOf(x).some((r) => r.by === a) || reviserTree) continue
    const did = idOf(state, x)
    add(`review ${did}: a draft of ${x.of.name} waits for your accept; say if it is precise enough`,
      `work direction show ${did}, then work review ${token} ${did} accept --evidence="<where you read in ${did}> | <what you saw>", or reject --reason="<why>"`)
  }
  // The reviser of a draft that a decider rejected revises the current version again, and the
  // new draft answers the Reject. When the reviser is finished, a high role of a tree that
  // follows the direction does it.
  for (const x of read.drafts.filter((y) => y.base && y.base === read.current(y.of) && !read.madeBy(y) && read.vetoOf(y))) {
    const mine = x.by === a || (x.by.finished && followsDirection(state, a, x.of))
    if (!mine || a.role.tier !== 'high' || !waitsForNewDraft(state, x)) continue
    const rejected = read.vetoOf(x)
    add(`${idOf(state, x)} is rejected by ${idOf(state, rejected.by) ?? who(state, rejected.by?.actor ?? rejected.by)}: "${short(rejected.reason, 120)}"; revise the current version again`,
      `work direction revise ${token} ${x.of.id} --file=<edit.yaml> --answers=${idOf(state, rejected)}`)
  }
  // A high role of a tree that follows the direction answers each open suggestion about it.
  for (const open of openSuggestions(state).filter(({ d }) => a.role.tier === 'high' && !d.source && followsDirection(state, a, d))) {
    const sid = idOf(state, open.y)
    add(`${sid} suggests about ${aboutId(open.y.about)}: "${short(open.y.says, 120)}" (${who(state, open.y.by)}); answer it with ${suggestionNeeds(state, open)}`,
      `work direction revise ${token} ${open.d.id} --file=<edit.yaml> --answers=${sid}`)
  }
  if (state.engine.taskAccepted(a.task, state.now)) {
    // The top assignment puts accepted code on its base: the CLI prints the step, and the project
    // does it its own way (a merge, or a pull request).
    const accepted = latestResult(state, a.task)
    const [repo, sha] = accepted?.output.split('@') ?? []
    const space = (a.task.aiDescription.workspace ?? []).find((w) => w.path === repo && w.base)
    if (!a.parent && space && /^[0-9a-f]{7,40}$/.test(sha ?? '') &&
      Bun.spawnSync(['git', '-C', join(state.cwd ?? '.', repo), 'merge-base', '--is-ancestor', sha, space.base]).exitCode !== 0) {
      add(`put ${accepted.output} on ${space.base}: ${idOf(state, a.task)} is accepted, and its commit is not on ${space.base} yet; do it as the project does (a pull request, or a merge)`,
        `for example: git -C ${repo} checkout ${space.base} && git -C ${repo} merge ${sha}`)
    }
    for (const child of read.assignments.filter((x) => x.parent === a && !x.finished)) {
      add(`finish ${idOf(state, child)}`, `work finish ${token} ${idOf(state, child)}`)
    }
    add(`${idOf(state, a.task)} is accepted: finish yourself`, `work finish ${token}`)
    return steps
  }
  const tasks = read.tasks.filter((t) => read.within(t, a.task) && !t.closed && !state.engine.taskAccepted(t, state.now))
  const mediums = lowerRoles(state, a).filter((r) => r.tier === 'medium')
  const makers = lowerRoles(state, a).filter((r) => r.tier === 'low' && r.acts.some((x) => x.act === 'Do'))
  for (const t of tasks) {
    const tid = idOf(state, t)
    const result = latestResult(state, t)
    const items = result ? state.engine.blockerItems(result, state.now) : []
    // A mistake is evaluated before anything else moves the task (Nanda, 2026-11-08).
    if (read.workStop(t, state.now)) {
      evaluationStep(t)
      continue
    }
    // A Reject of the task itself waits for a change, also while its parts are open; only the
    // person's own split answers the person's Reject.
    for (const r of taskRejects(state, t).filter((x) => !items.some((i) => i.ref === x))) {
      const vid = idOf(state, r)
      const byPerson = typeof r.by?.actor === 'object'
      add(`${vid} returns ${tid}: "${r.reason}"; a direction change${byPerson ? `, or ${t.owner.name}'s own split or remake,` : ', a split, or a remake'} answers it`,
        a.role.tier === 'high'
          ? `work direction revise ${token} ${read.directionsOf(t).map((d) => d.id).join('|')} --file=<edit.yaml>`
          : `work raise ${token} --reason="${vid} needs a direction change or a split of ${tid}"`)
    }
    // The tasks it needs come first. One outside this tree is another tree's work: say so.
    const outside = t.needs.filter((n) => !n.closed && !state.engine.taskAccepted(n, state.now) && !read.within(n, a.task))
    for (const n of outside) {
      add(`${tid} waits for ${idOf(state, n)} ${n.name} (${state.engine.Task.state(n, state.now)}), which is outside your task tree; ` +
        'wait until it is accepted, or raise if it must change')
    }
    // A part that runs after other parts (after: in the split) waits for them; the parts that
    // need nothing open run at the same time.
    for (const n of t.needs.filter((x) => !x.closed && !state.engine.taskAccepted(x, state.now) && read.within(x, a.task) && x.serves !== t)) {
      add(`${tid} ${t.name} runs after ${idOf(state, n)} ${n.name} (${state.engine.Task.state(n, state.now)}); its maker starts when ${idOf(state, n)} is accepted`)
    }
    if (t.needs.some((n) => !n.closed && !state.engine.taskAccepted(n, state.now))) continue
    // An open medium whose task holds this one runs it: first one that this assignment gave the
    // work to, at any depth; else one that another parent gave it (a second medium would only
    // do the same work again).
    const mine = (x) => { for (let y = x.parent; y; y = y.parent) if (y === a) return true; return false }
    const running = read.assignments.filter((x) => !x.finished && x.role.tier === 'medium' &&
      RANK[a.role.tier] > RANK.medium && read.within(t, x.task))
    const lead = running.find(mine) ?? running[0]
    if (lead) {
      // A medium runs it; only the person's checks, the change points, and this assignment's
      // own turn to decide (decide: and, order) come up to here.
      add(`${idOf(state, lead)} (${lead.role.role}) runs ${tid} ${t.name}`)
      if (result) changeSteps(t, result, items)
      if (result) deciderStep(result, items)
      continue
    }
    // A task with a region is one unit of work: a medium role runs it; a task with no region
    // is split first.
    if (a.role.tier === 'high' && t === a.task && !result && !t.needs.length && mediums.length) {
      if (t.aiDescription.context.region) {
        add(`run ${tid} with a medium role (its region ${t.aiDescription.context.region} is one unit, so it is not split)`,
          `work assign ${token} ${tid} --role=${mediums.map((r) => r.role).join('|')}`)
        continue
      }
      if (read.mayChange(a, t, state.now)) {
        add(`split ${tid} first, then give each part to a medium role`, `work task split ${token} ${tid} --file=<parts.yaml>`)
        continue
      }
    }
    if (t !== a.task && mediums.length) {
      add(`run ${tid} ${t.name} with a medium role`, `work assign ${token} ${tid} --role=${mediums.map((r) => r.role).join('|')}`)
      continue
    }
    const changed = result && state.cwd && changedSince(state.cwd, result)
    const fix = items.some((i) => (i.kind === 'reject' && (i.ref.breaks || read.answered(i.ref))) || ['unchanged', 'redo'].includes(i.kind))
    const maker = live(t).find((x) => read.openDo(x))
    if (!result || changed || fix) {
      if (result) for (const item of items.filter((i) => needsChange(state, i))) changeStep(t, result, item, ' first')
      const waits = maker && fileTurn(state, maker)
      if (waits) {
        add(`${idOf(state, maker)} waits for ${waits.path}: ${idOf(state, waits.before)} (${idOf(state, waits.before.task)} ${waits.before.task.name}) ` +
          `writes it first, and one maker writes a file at a time; start ${idOf(state, maker)} when ${idOf(state, waits.before)} finishes`)
      } else if (maker && meta(maker).claim) {
        add(`${idOf(state, maker)} is working on ${tid} (claimed since ${clock(meta(maker).claim.at)}); if its subagent stopped:`,
          `work release ${token} ${idOf(state, maker)}`)
      } else if (maker) {
        const attempt = `attempt ${read.used(maker) + 1}${maker.maxAttempts ? ` of ${maker.maxAttempts}` : ''}`
        add(`${result ? 'redo' : 'make'} ${tid}: give a new subagent the command of ${idOf(state, maker)} (${attempt})`,
          `work brief ${idOf(state, maker)}.<the token that assign printed>`)
        if (maker.parent === a) noToken(maker, t)
      } else if (makers.length) {
        add(`make ${tid} ${t.name}`, `work assign ${token} ${tid} --role=${makers.map((r) => r.role).join('|')}`)
      } else {
        add(`${tid} needs a new result, and no lower role makes it`, `work raise ${token} --reason="no role makes ${tid}"`)
      }
      continue
    }
    const rid = idOf(state, result)
    const checkers = (list) => [...new Set(list.filter(Boolean))]
    // The work is unchanged after a direction change; the rules of the changed standards
    // are checked again by their own checkers, not made again.
    const old = items.filter((i) => i.kind === 'old-version')
    const again = old.flatMap((i) => i.rules)
    if (old.length) add(`check ${rid} again under the new version`)
    checkerSteps(t, result, checkers([...items.filter((i) => i.kind === 'evidence'), ...again.map((ref) => ({ ref }))]
      .map((i) => i.ref.checkedBy)))
    changeSteps(t, result, items)
    deciderStep(result, items)
  }
  return steps
}

export function renderBlockers(state, result) {
  const lines = [...resultItems(state, result), ...taskItems(state, result.task)]
  const latest = latestResult(state, result.task)
  const note = latest !== result ? [`(${idOf(state, result)} is not the latest result of ${idOf(state, result.task)}; ${idOf(state, latest)} is)`] : []
  return lines.length === 0
    ? `${idOf(state, result)} (${result.output}) has no blockers; it is accepted.`
    : [`${idOf(state, result)} (${result.output}) is stopped by:`, ...lines.map((l) => `  ${l}`), ...note].join('\n')
}

// A result and each review of it, with the evidence and the points: what a decider reads
// before it decides on its checkers' work.
export function renderResult(state, result) {
  const read = state.engine.read
  const name = (by) => (by?.[kind] === 'Assignment' ? `${idOf(state, by)} (${by.role.role})` : who(state, by))
  const from = result.madeFrom.filter((m) => m.source && m.revision).map((m) => `${m.source}@${m.revision}`)
  const lines = [`${idOf(state, result)} on ${idOf(state, result.task)} by ${name(result.by)}: ${result.output}` +
    `${from.length ? ` (made from ${from.join(', ')})` : ''}`,
  ]
  const open = read.openRaises(result)
  for (const v of read.reviewsOf(result)) {
    const words = v.quote ? ` (their words: "${v.quote}")` : ''
    if (v.redo) lines.push(`${idOf(state, v)} recheck by ${name(v.by)}: "${v.reason}"`)
    else if (v.decision === 'Raise') {
      const settle = read.reviews.find((r) => r.settles === v)
      lines.push(`${idOf(state, v)} raise by ${name(v.by)}, for ${name(v.answerBy)}: "${v.reason}" ` +
        `(${open.includes(v) ? 'open' : `settled by ${idOf(state, settle)}`})`)
    } else if (v.decision === 'Reject') {
      lines.push(`${idOf(state, v)} reject by ${name(v.by)}${v.breaks ? `, breaks ${v.breaks.id}` : ''}: "${v.reason}"${words}`)
    } else {
      lines.push(`${idOf(state, v)} accept by ${name(v.by)}${v.settles ? `, settles ${idOf(state, v.settles)}` : ''}` +
        `${v.reason ? `: "${v.reason}"` : ''}${words}`,
      ...v.evidence.map((e) => `  ${e.meets ? `${e.meets.id ?? e.meets.says} | ` : ''}${e.at} | ${e.says}`))
    }
  }
  if (!read.reviewsOf(result).length) lines.push('no reviews yet')
  return [...lines, renderBlockers(state, result)].join('\n')
}

export function renderTaskTree(state, task, depth = 0) {
  const pad = '  '.repeat(depth)
  const r = latestResult(state, task)
  let suffix = ''
  if (r && state.cwd && changedSince(state.cwd, r)) suffix = ` (${idOf(state, r)} changed after it was reported)`
  else if (r && state.engine.read.reviewsOf(r).some((v) => v.decision === 'Reject')) suffix = ` (${idOf(state, r)} rejected)`
  const lines = [`${pad}${idOf(state, task)} ${task.name} · ${state.engine.Task.state(task, state.now)}${suffix}`]
  for (const part of partsOf(state, task)) lines.push(...renderTaskTree(state, part, depth + 1).split('\n'))
  return lines.join('\n')
}

// What a version or a draft says, with what it changes from its base: + new, ~ replaced,
// - removed.
// One entry in a view: a one-line entry on one line; an entry of several lines (markdown) as a
// block of its own, with its checker after its id, so that the next entry stands apart.
const entryLines = (head, says, checker) => (String(says).includes('\n')
  ? ['', `${head}${checker ? ` (${checker})` : ''}:`, ...String(says).trimEnd().split('\n').map((l) => (l ? `${' '.repeat(head.search(/\S/) + 4)}${l}` : ''))]
  : [`${head}: ${says}${checker ? ` (${checker})` : ''}`])
function contentLines(v, base) {
  const lines = String(v.says).includes('\n') ? ['says:', ...String(v.says).trimEnd().split('\n').map((l) => (l ? `  ${l}` : ''))] : [`says: ${v.says}`]
  const baseIds = base ? base.standards.map((s) => s.id) : []
  const baseRules = base ? base.standards.flatMap((s) => s.rules ?? []) : []
  for (const s of v.standards) {
    const mark = !base || base.standards.includes(s) ? '  ' : baseIds.includes(s.id) ? '~ ' : '+ '
    lines.push(...entryLines(`${mark}${s.id}${s.where ? ` where ${JSON.stringify(s.where)}` : ''}`, s.says))
    for (const r of s.rules ?? []) lines.push(...entryLines(`${base && !baseRules.includes(r) ? '+ ' : '  '}  ${r.id}`, r.says, checkerOf(r)))
  }
  for (const s of base ? base.standards.filter((x) => !v.standards.some((y) => y.id === x.id)) : []) lines.push(`- ${s.id}: ${indented(s.says, '    ')}`)
  if (base && v.says !== base.says) lines.push(`says was: ${indented(base.says, '  ')}`)
  return lines
}

// An official version of a direction, the draft that made it, and the open drafts.
export function renderDirection(state, d, number) {
  const read = state.engine.read
  const v = number ? d.versions[number - 1] : read.current(d)
  const draft = v.revision
  const lines = [`${versionId(v)} ${d.name} (owner ${d.owner.name}) · ${v.replacedBy ? `replaced by ${versionId(v.replacedBy)}` : 'current'}`,
    `made from ${idOf(state, draft) ?? 'the config file'}, drafted by ${who(state, draft.by)}`,
    ...contentLines(v, draft.base)]
  for (const x of read.drafts.filter((y) => y.of === d && y.base && !read.madeBy(y))) {
    const end = read.vetoOf(x) ? ' (ended by a Reject)' : x.base.replacedBy ? ' (built on an old version)' : ''
    lines.push(`draft: ${idOf(state, x)}${end}; reviews: ${read.reviewsOf(x).map((r) => r.decision).join(', ') || 'none'}; ` +
      `work direction show ${idOf(state, x)}`)
  }
  return lines.join('\n')
}

// One piece of a version (work direction show <id>@<n>#<key>[#<header>]): a standard with its
// rules, one rule, or the text under a header inside the words of an entry. Undefined when the
// version has no such piece.
export function renderPiece(state, v, keys) {
  const at = v[kind] === 'Revision' ? idOf(state, v) : versionId(v)
  const standard = v.standards.find((s) => s.id === keys[0])
  const rule = v.standards.flatMap((s) => s.rules ?? []).find((r) => r.id === keys[0])
  const entry = standard ?? rule
  const under = (label, text, name) => {
    const found = headersOf(text).filter((h) => h.name === name)
    return found.map((h) => `${at} · ${label} · ${h.title}\n${h.text}`)
  }
  if (entry && keys[1]) {
    const pieces = under(`${standard ? 'standard' : 'rule'} ${entry.id}`, entry.says, keys[1])
    return pieces.length ? pieces.join('\n\n') : undefined
  }
  if (standard) {
    return [`${at} · standard ${standard.id}${standard.where ? ` where ${JSON.stringify(standard.where)}` : ''}`, standard.says,
      ...(standard.rules ?? []).map((r) => `- rule ${r.id} (${checkerOf(r)}): ${indented(r.says, '  ')}`)].join('\n')
  }
  if (rule) return [`${at} · rule ${rule.id} (${checkerOf(rule)})`, rule.says].join('\n')
  const pieces = [...under('direction', v.says, keys[0]),
    ...v.standards.flatMap((s) => [...under(`standard ${s.id}`, s.says, keys[0]),
      ...(s.rules ?? []).flatMap((r) => under(`rule ${r.id}`, r.says, keys[0]))])]
  return pieces.length ? pieces.join('\n\n') : undefined
}
// The names that a version gives to #: its standards, its rules, and its headers.
export function pieceNames(v) {
  const words = [v.says, ...v.standards.flatMap((s) => [s.says, ...(s.rules ?? []).map((r) => r.says)])]
  return [...v.standards.map((s) => s.id), ...v.standards.flatMap((s) => (s.rules ?? []).map((r) => r.id)),
    ...new Set(words.flatMap((w) => headersOf(w).map((h) => h.name)))]
}

// A draft: what it changes in its base, who drafted it, what it answers, its reviews, and
// where it ends.
export function renderDraft(state, x) {
  const read = state.engine.read
  const d = x.of
  const made = read.madeBy(x)
  const vetoed = read.vetoOf(x)
  const end = made ? `official: ${versionId(made)}` : vetoed ? 'ended by a Reject'
    : x.base?.replacedBy || (!x.base && read.current(d)) ? 'built on an old version'
    : `waits for the accept of ${draftWaitsText(state, x)}`
  // A draft that answers the Reject of an earlier draft also shows what changed since that draft.
  const since = x.answers.filter((y) => y[kind] === 'Review' && y.of[kind] === 'Revision')
    .flatMap((y) => [`since ${idOf(state, y.of)}, which ${idOf(state, y)} rejected:`, ...sinceLines(state, x, y.of).map((l) => `  ${l}`)])
  const on = x.base ? `built on ${versionId(x.base)}` : 'a new direction'
  return [`${idOf(state, x)} a draft of ${d.name} (owner ${d.owner.name}), ${on} · ${end}`,
    `drafted by ${drafter(state, x)}`,
    ...x.answers.map((y) => `answers: ${answerText(state, y)}`),
    ...contentLines(x, x.base),
    ...since,
    ...read.reviewsOf(x).map((r) => `review: ${idOf(state, r)} ${r.decision} by ${who(state, r.by)}: ${r.reason ?? r.evidence.map((e) => `${e.at} | ${e.says}`).join('; ')}`)].join('\n')
}

// What a draft changes from an earlier draft that was rejected: + new, ~ changed, - dropped.
function sinceLines(state, x, earlier) {
  const { sameWords, sameRule } = state.engine.read
  const lines = []
  for (const s of x.standards) {
    const was = earlier.standards.find((y) => y.id === s.id)
    if (!was) lines.push(`+ ${s.id}: ${s.says}`)
    if (!was || sameWords(s, was)) continue
    lines.push(`~ ${s.id}: ${s.says}`)
    if (s.says !== was.says) lines.push(`  was: ${was.says}`)
    const [where, whereWas] = [JSON.stringify(s.where ?? {}), JSON.stringify(was.where ?? {})]
    if (where !== whereWas) lines.push(`  where: ${where}, was ${whereWas}`)
    for (const r of s.rules ?? []) if (!(was.rules ?? []).some((q) => sameRule(r, q))) lines.push(`+   ${r.id}: ${r.says} (${checkerOf(r)})`)
    for (const q of was.rules ?? []) if (!(s.rules ?? []).some((r) => sameRule(r, q))) lines.push(`-   ${q.id}: ${q.says} (${checkerOf(q)})`)
  }
  for (const s of earlier.standards.filter((y) => !x.standards.some((z) => z.id === y.id))) lines.push(`- ${s.id}: ${s.says}`)
  if (x.says !== earlier.says) lines.push(`says: ${x.says}`, `says was: ${earlier.says}`)
  return lines
}

// A relayed act in words: what it does and to what.
export function describeInner(inner) {
  const d = inner.data
  if (inner.type === 'review' && d.decision === 'accept') {
    return `accept ${d.target}${d.settles ? ` settling ${d.settles}` : ''}` +
      `${d.evidence?.length ? ` with evidence ${d.evidence.map((e) => `${e.rule ? `${e.rule} | ` : ''}${e.where} | ${e.what}`).join('; ')}` : ''}`
  }
  if (inner.type === 'review') return `reject ${d.target}: ${d.points.map((p) => `"${p.text}"${p.breaks ? ` breaks ${p.breaks}` : ''}`).join('; ')}`
  if (inner.type === 'answer') return `answer ${d.q}: "${d.text}"`
  if (inner.type === 'person.ask') return `ask ${d.a}: "${d.text}"`
  return `comment on ${d.task}: "${d.text}"`
}

// What waits, for a person or an assignment, with the command that settles it.
export function renderWaiting(state, forWho) {
  const read = state.engine.read
  const rows = []
  const matches = (name) => !forWho || name === forWho
  const current = (result) => result && latestResult(state, result.task) === result && !result.task.closed &&
    !state.engine.taskAccepted(result.task, state.now)
  for (const q of read.notes.filter((n) => n.kind === 'Question' && n.answer === undefined)) {
    const to = who(state, q.answerBy)
    if (!matches(to)) continue
    const cmd = q.answerBy?.[kind] === 'Assignment' ? `work answer <${to} token> ${idOf(state, q)}` : `work answer ${idOf(state, q)}`
    rows.push(`${idOf(state, q)} for ${to}: ${short(q.text, 200)}\n    ${cmd} --text="..."`)
  }
  for (const r of read.reviews.filter((x) => x.decision === 'Raise' && current(x.of) && !read.reviews.some((y) => y.settles === x))) {
    const to = who(state, r.answerBy)
    if (!matches(to)) continue
    rows.push(`${idOf(state, r)} raised on ${idOf(state, r.of)} by ${who(state, r.by)} for ${to}: ${r.reason}\n` +
      `    work review ${r.answerBy?.[kind] === 'Assignment' ? `<${to} token> ` : ''}` +
      `${idOf(state, r.of)} accept --settles=${idOf(state, r)} --reason="..."`)
  }
  for (const [id, p] of state.pending) {
    const d = p.inner.data
    const target = state.byId.get(d.target)
    const settled = (p.inner.type === 'answer' && state.byId.get(d.q)?.answer !== undefined) ||
      (p.inner.type === 'review' && target?.[kind] === 'Revision' && Boolean(read.madeBy(target) || read.vetoOf(target))) ||
      (p.inner.type === 'review' && target?.[kind] === 'Result' && !current(target))
    if (matches(p.inner.who) && !settled) {
      rows.push(`${id} relayed by ${p.event.who} for ${p.inner.who}: ${describeInner(p.inner)}\n` +
        `    their words: "${p.event.data.quote}"\n    work ratify ${id}`)
    }
  }
  const open = read.tasks.filter((t) => !t.closed && !state.engine.taskAccepted(t, state.now))
  const changePoints = []
  for (const t of open) {
    const result = latestResult(state, t)
    if (!result) continue
    const rid = idOf(state, result)
    const items = state.engine.blockerItems(result, state.now)
    // A task that waits for an evaluation takes no answer yet: its evaluation row comes first.
    if (!read.evaluationWaits(t)) for (const item of items) if (needsChange(state, item)) changePoints.push({ t, item })
    for (const n of activeWaivers(state, result)) {
      if (matches(t.owner.name)) {
        rows.push(`${idOf(state, n)} waives ${n.notChecked.map((x) => x.id).join(', ')} on ${rid} until ${n.until} (${who(state, n.by)})`)
      }
    }
  }
  // A Reject of an open task itself is a change point too, with or without a result.
  for (const t of open.filter((x) => !read.evaluationWaits(x))) {
    for (const r of taskRejects(state, t).filter((x) => !changePoints.some(({ item }) => item.ref === x))) {
      changePoints.push({ t, item: { kind: 'change', ref: r } })
    }
  }
  for (const d of [...read.directions, ...newDirections(state)]) {
    const points = changePoints.filter(({ t }) => read.directionsOf(t).includes(d)).map(({ item }) => idOf(state, item.ref))
    if (!matches(d.owner.name)) continue
    // A draft that a decider rejected ended: its reviser revises again.
    for (const x of read.drafts.filter((y) => y.of === d && y.base === read.current(d) && !read.madeBy(y) && read.vetoOf(y))) {
      if (!waitsForNewDraft(state, x)) continue
      const rejected = read.vetoOf(x)
      const again = reviseAgain(state, x)
      rows.push(`${idOf(state, x)} is rejected by ${idOf(state, rejected.by) ?? who(state, rejected.by?.actor ?? rejected.by)}: "${short(rejected.reason, 120)}"; ` +
        `${again.text}\n    ${again.step ?? `work direction show ${idOf(state, x)}`}`)
    }
    const drafts = openDrafts(state, d)
    for (const x of drafts) {
      const did = idOf(state, x)
      // approvedBy: a draft that waits for a role's accept first names that role, and the assign
      // when no open assignment of that role, outside the reviser's tree, can review it.
      const before = read.draftWaitsFor(x).filter((leaf) => leaf.acts)
      if (before.length) {
        const inTree = (y) => y === x.by || (() => { for (let z = y.parent; z; z = z.parent) if (z === x.by) return true; return false })()
        const top = read.tasks.find((t) => !t.closed && !t.serves && read.directionsOf(t).includes(d))
        const follows = (y) => read.tasks.some((t) => !t.closed && read.within(t, y.task) && read.directionsOf(t).includes(d))
        for (const role of before) {
          const reviewer = read.assignments.find((y) => !y.finished && y.role === role && !inTree(y) && follows(y) &&
            !read.reviewsOf(x).some((r) => r.by === y))
          rows.push(reviewer
            ? `${did} waits for the accept of ${idOf(state, reviewer)} (${role.role}) before yours`
            : `${did} waits for the accept of ${an(role.role)} outside the tree of its reviser before yours\n` +
              `    work assign ${top ? idOf(state, top) : '<task>'} --role=${role.role}`)
        }
        continue
      }
      const answers = x.answers.length ? `; it answers ${x.answers.map((y) => answerText(state, y)).join('; ')}` : ''
      rows.push(`${did} drafted for ${d.id} by ${drafter(state, x)}${answers}; reviews: ${read.reviewsOf(x).map((r) => r.decision).join(', ') || 'none'}\n` +
        `    work direction show ${did}; work review ${did} accept --evidence="<where you read in ${did}> | <what you saw>", or reject --reason="<why>"`)
    }
    if (points.length && drafts.length === 0) {
      rows.push(`${points.join(', ')} ${points.length > 1 ? 'need' : 'needs'} a change of ${d.id}; a high role drafts it, ` +
        `or you suggest it\n    work suggest ${d.id} --says="<the change>"`)
    }
  }
  // A point with no rule on a task can also be answered by the owner's own split of it.
  const splitShown = new Set()
  for (const { t, item } of changePoints) {
    if ((item.ref.of.task ?? item.ref.of) !== t || !matches(t.owner.name) || splitShown.has(item.ref)) continue
    splitShown.add(item.ref)
    // A task with parts, or with a region (one unit, not split), is remade instead.
    const openParts = read.tasks.some((p) => p.serves === t && !p.closed) || Boolean(t.aiDescription.context.region)
    rows.push(openParts
      ? `${idOf(state, item.ref)} can also be answered by your remake of ${idOf(state, t)}\n` +
        `    work task remake ${idOf(state, t)} --file=<task.yaml> --reason="<how the scope changed>" --review=${idOf(state, item.ref)}`
      : `${idOf(state, item.ref)} can also be answered by your split of ${idOf(state, t)}\n` +
        `    work task split ${idOf(state, t)} --file=<parts.yaml> --review=${idOf(state, item.ref)}`)
  }
  // An evaluation of a direction or a principle waits for the owner's accept; a task that waits
  // for an evaluation, with no high role in its tree, waits for the person's assign (or own
  // evaluation).
  const highRoles = Object.values(state.roles).filter((r) => r.tier === 'high').map((r) => r.role)
  for (const t of open.filter((x) => matches(x.owner.name) && read.workStop(x, state.now))) {
    // Each stop gets its own evaluation, so each stop that waits gets its own row.
    const stops = read.stopsOf(t).filter((x) => !read.stopAnswered(x))
    const waits = stops[0]
    const highOpen = read.assignments.some((x) => !x.finished && x.role.tier === 'high' && read.within(t, x.task))
    let top = t
    while (top.serves) top = top.serves
    if (!waits) {
      // Evaluated: the task waits for the change that its evaluation asks for. With no high role
      // open in its tree, the person makes that change.
      // The person can always make that change, also when a high role works on the task and
      // has no act for it.
      const e = read.evaluations.filter((x) => read.stopTask(x.answers) === t && read.evaluationCounts(x)).at(-1)
      const changing = read.tasks.some((p) => p.serves === t && !p.closed) ||
        read.directionsOf(t).some((d) => openDrafts(state, d).length > 0)
      if (!e || changing) continue
      rows.push(`${idOf(state, t)} ${t.name} waits for the change that ${idOf(state, e)} asks for: "${short(e.improve.join('; '), 160)}"\n` +
        (e.level === 'task' || read.directionsOf(t).length === 0 ? `    work task remake ${idOf(state, t)} --file=<task.yaml> --reason="as ${idOf(state, e)} says"`
          : `    work suggest ${read.directionsOf(t).map((d) => d.id).join('|')} --says="<the change>"; a high role drafts it, and you accept the draft`))
      continue
    }
    const unwritten = []
    for (const stop of stops) {
      const pending = read.evaluations.filter((e) => e.answers === stop && !read.evaluationDecision(e) && !read.evaluationCounts(e)).at(-1)
      if (!pending) {
        unwritten.push(stop)
        continue
      }
      const eid = idOf(state, pending)
      rows.push(`${eid} evaluates ${idOf(state, t)} at the level ${pending.level}, and waits for your accept\n` +
        `    work review ${eid} accept --evidence="<where you read> | <what you saw>", or reject --reason="..." (read it in full: work evaluation show ${eid})\n` +
        `    wrong: ${short(pending.wrong, 160)}\n    why: ${short(pending.why, 160)}` +
        pending.improve.map((x) => `\n    improve: ${short(x, 160)}`).join(''))
    }
    if (highOpen || !unwritten.length) continue
    rows.push(`${idOf(state, t)} ${t.name} waits for ${unwritten.length > 1 ? `${unwritten.length} evaluations, one for each stop` : 'an evaluation'}, and no high role works on it\n` +
      `    work assign ${idOf(state, top)} --role=${highRoles.join('|')}, or evaluate it yourself: ` +
      unwritten.map((stop) => `work evaluate ${stopIdOf(state, stop)} ` +
        '--wrong="<what is wrong>" --why="<why it cannot be done as asked>" --improve="<one change>" --level=task|standard|direction|principle').join(', then '))
  }
  // A suggestion that no open high role can answer: the person assigns one on a task that follows
  // its direction.
  for (const { y, d } of openSuggestions(state).filter((x) => matches(x.d.owner.name))) {
    // A company direction changes in its repo, with a pull request; the person says OK first.
    if (d.source) {
      rows.push(`${idOf(state, y)} suggests about ${aboutId(y.about)}: "${short(y.says, 120)}" (${who(state, y.by)}); ${d.id} is a company direction\n` +
        `    it changes in ${d.source.repo} (${d.source.path}), with a pull request; the refresh brings the new commit in`)
      continue
    }
    if (read.assignments.some((x) => !x.finished && x.role.tier === 'high' && followsDirection(state, x, d))) continue
    const top = read.tasks.find((t) => !t.closed && !t.serves && read.directionsOf(t).includes(d))
    rows.push(`${idOf(state, y)} suggests about ${aboutId(y.about)}: "${short(y.says, 120)}" (${who(state, y.by)}); no high role works on a task that follows ${d.id}\n` +
      (top ? `    work assign ${idOf(state, top)} --role=${highRoles.join('|')}`
        : `    no open task follows ${d.id}; a high role starts on a task that names it`))
  }
  // A suggestion that asks for a new direction: no task follows it, so a model run outside any
  // task drafts it (the skill that reads an app), and its owner accepts it. Each person sees it.
  if (!forWho || state.config.people.includes(forWho)) {
    for (const y of read.suggestions.filter((x) => !x.about && !drafted(state, x))) {
      rows.push(`${idOf(state, y)} asks for a new direction: "${short(y.says, 120)}" (${who(state, y.by)}); a model drafts it\n` +
        `    work direction new --file=<direction.yaml> --by=<model> --answers=${idOf(state, y)}`)
    }
  }
  // A result whose decision waits for a role that no open assignment plays waits for an assign.
  for (const t of open.filter((x) => matches(x.owner.name))) {
    const result = latestResult(state, t)
    if (!result || !state.engine.blockerItems(result, state.now).every((i) => i.kind === 'decider')) continue
    for (const role of read.decisionWaitsOn(result)) {
      if (read.assignments.some((x) => !x.finished && x.role === role && read.within(t, x.task))) continue
      let top = t
      while (top.serves) top = top.serves
      // The person gives work only to medium and high roles: a low decider comes from a lead,
      // whose own next prints the assign.
      if (role.tier === 'low') {
        if (read.assignments.some((x) => !x.finished && x.role.tier !== 'low' && read.within(t, x.task))) continue
        rows.push(`${idOf(state, result)} waits for the accept of ${an(role.role)}, and no lead works on ${idOf(state, t)} to give it its work\n` +
          `    work assign ${idOf(state, top)} --role=${Object.values(state.roles).filter((r) => r.tier && r.tier !== 'low').map((r) => r.role).join('|')}`)
        continue
      }
      rows.push(`${idOf(state, result)} waits for the accept of ${an(role.role)}, and no ${role.role} works on ${idOf(state, t)}\n` +
        `    work assign ${idOf(state, top)} --role=${role.role}`)
    }
  }
  // A maker that waits for a file: the file changes one maker after the other. When the maker
  // before it makes no more results and has no parent (the person gave it its work), the person
  // finishes it.
  for (const y of read.assignments.filter((x) => !x.finished && !x.task.closed && matches(x.task.owner.name))) {
    const waits = fileTurn(state, y)
    if (!waits) continue
    const x = waits.before
    const done = idleWhy(state, x)
    rows.push(`${idOf(state, y)} (${y.role.role} on ${idOf(state, y.task)}) waits for ${waits.path}: ${idOf(state, x)} ` +
      `(${idOf(state, x.task)} ${x.task.name}) writes it first` +
      (done && !x.parent ? `, and makes no more results\n    work finish ${idOf(state, x)}` : ''))
  }
  // A task that is not done, and that no open assignment works on, waits for an assign.
  const working = (t) => read.assignments.some((x) => !x.finished && read.within(t, x.task))
  const idle = open.filter((t) => !working(t))
  const leads = Object.values(state.roles).filter((r) => r.tier && r.tier !== 'low').map((r) => r.role)
  for (const t of idle.filter((x) => !idle.includes(x.serves) && matches(x.owner.name))) {
    rows.push(`${idOf(state, t)} ${t.name} is ${state.engine.Task.state(t, state.now)}, and no open assignment works on it\n` +
      `    work assign ${idOf(state, t)} --role=${leads.join('|') || '<role>'}`)
  }
  // A task that needs a task of another tree waits for that tree, which its own agents cannot move.
  // A part that runs after another part of its own tree is the lead's to show, not this list's.
  const topOf = (x) => { while (x.serves) x = x.serves; return x }
  for (const t of open.filter((x) => matches(x.owner.name))) {
    for (const n of t.needs.filter((x) => !x.closed && topOf(x) !== topOf(t) && !state.engine.taskAccepted(x, state.now))) {
      rows.push(`${idOf(state, t)} ${t.name} waits for ${idOf(state, n)} ${n.name} (${state.engine.Task.state(n, state.now)}), of another task tree\n` +
        `    it moves when ${idOf(state, n)} is accepted: work task show ${idOf(state, n)}`)
    }
  }
  return rows.length ? rows.join('\n') : `nothing waits${forWho ? ` for ${forWho}` : ''}.`
}

export function renderStatus(state) {
  const read = state.engine.read
  const today = state.now?.slice(0, 10)
  const when = (iso) => (iso.slice(0, 10) === today ? clock(iso) : `${iso.slice(5, 10)} ${clock(iso)}`)
  const rows = read.assignments.filter((a) => !a.finished).map((a) => {
    const meta = state.meta.get(a)
    const attempts = read.isDo(a.role) ? ` · attempts ${read.used(a)}${a.maxAttempts ? `/${a.maxAttempts}` : ''}` : ''
    const claim = meta.claim ? ` · claimed since ${when(meta.claim.at)}` : ''
    const parent = a.parent ? ` · parent ${idOf(state, a.parent)}` : ''
    return `${meta.id} ${a.role.role} (${a.role.tier ?? 'program'}) on ${idOf(state, a.task)}${attempts}${claim}${parent}`
  })
  return rows.length ? rows.join('\n') : 'no open assignments.'
}
