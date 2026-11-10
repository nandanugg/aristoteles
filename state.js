// The replay: it builds the engine from the stored events, one handler per event type.
// A command checks a new event by applying it to the replayed state: if the engine throws,
// the command is refused and nothing is stored.

import { createWork, kind } from './engine.js'
import { checkerProblem, sha } from './config.js'

const MODEL = { high: 'opus', medium: 'sonnet', low: 'haiku' }
const PREFIX = { Task: 't', Assignment: 'a', Result: 'r', Review: 'v', Executive: 'x', Checkpoint: 'k',
  Question: 'q', Note: 'n', Suggestion: 's', Revision: 'd', Exhaustion: 'ex', Evaluation: 'ev' }

export const roleHash = (role) => sha(JSON.stringify(role))

export function replay(events, { measure } = {}) {
  const state = {
    engine: undefined, config: undefined, hashes: {}, events,
    byId: new Map(), idOf: new Map(), counters: {},
    roles: {}, directions: {}, newDirections: {}, meta: new Map(), groups: new Map(),
    fits: {}, pending: new Map(), sources: {}, measure,
  }
  for (const event of events) {
    apply(state, event)
    event.created = state.created
  }
  return state
}

export function apply(state, event) {
  const handler = handlers[event.type]
  if (!handler) {
    throw new Error(`the store is damaged at e${event.id}: unknown event type "${event.type}"; the person restores the store from a copy`)
  }
  // Each handler passes event.at to the engine as the time of the act (when).
  state.created = []
  handler(state, event)
  // The engine makes some records itself: lessons, and the stops of makers (Exhaustion).
  for (const note of state.engine?.read.notes ?? []) {
    if (!state.idOf.has(note)) name(state, note, note.kind === 'Question' ? 'q' : 'n')
  }
  for (const stop of state.engine?.read.exhaustions ?? []) {
    if (!state.idOf.has(stop)) name(state, stop, 'ex')
  }
}

// Ids: a kind prefix and a counter (t3, a7, r12). Points of a Reject are v4.1, v4.2.
const name = (state, record, prefix) => {
  const p = prefix ?? PREFIX[record.kind === 'Question' ? 'Question' : record[kind]]
  state.counters[p] = (state.counters[p] ?? 0) + 1
  const id = `${p}${state.counters[p]}`
  state.byId.set(id, record)
  state.idOf.set(record, id)
  state.created.push(id)
  return id
}
export const idOf = (state, record) => state.idOf.get(record)

export function lookup(state, id, expected) {
  const prefix = String(id).match(/^[a-z]+/)?.[0]
  if (expected && !expected.includes(prefix)) {
    throw new Error(`"${id}" is not ${expected.map((p) => `a ${noun(p)} id (${p}..)`).join(' or ')}`)
  }
  const record = state.byId.get(String(id))
  if (!record) throw new Error(`there is no ${noun(prefix)} ${id}`)
  return record
}
const noun = (prefix) =>
  ({ t: 'task', a: 'assignment', r: 'result', v: 'review', q: 'question', x: 'executive act', k: 'checkpoint',
    n: 'note', s: 'suggestion', d: 'draft', ex: 'stop', ev: 'evaluation' })[prefix] ?? `record with the prefix ${prefix}`

export const versionId = (v) => `${v.of.id}@${v.number}`

// A rule by its id, in the official version of each direction: a draft changes what an id
// means only when it becomes official. Replay keeps the order, so an event reads the
// version that was official when it was written.
export function findRule(state, ruleId) {
  for (const d of Object.values(state.directions)) {
    for (const s of state.engine.read.current(d).standards) {
      const rule = (s.rules ?? []).find((r) => r.id === ruleId)
      if (rule) return rule
    }
  }
  throw new Error(`there is no rule "${ruleId}" in an official version`)
}
// The tasks that a task file names in needs: each one exists and is open.
function neededTasks(state, ids = []) {
  return ids.map((id) => {
    const task = lookup(state, id, ['t'])
    if (task.closed) throw new Error(`${id} is closed; a task does not need a closed task`)
    return task
  })
}
function findTarget(state, id) {
  if (state.directions[id]) return state.directions[id]
  for (const d of Object.values(state.directions)) {
    const standard = state.engine.read.current(d).standards.find((s) => s.id === id)
    if (standard) return standard
  }
  return findRule(state, id)
}

// The person is one actor on every channel; the channel of a relay or a ratify stays in the
// record of the CLI.
function personBy(state, who, task, channel = 'terminal') {
  const read = state.engine.read
  return {
    actor: { name: who },
    role: { role: 'person', acts: [] },
    task,
    under: task ? read.directionsOf(task).map(read.current) : [],
    channel,
  }
}
export const byOf = (state, event, task) =>
  /^a\d+$/.test(event.who) ? lookup(state, event.who, ['a']) : personBy(state, event.who, task, event.channel)

const taskOf = (record) => (record[kind] === 'Task' ? record : record.task)

// Who decides, from the config: a role name, a person's name, or { or | and | order: [...] }.
const decidersOf = (state, x) => {
  if (typeof x === 'string') return state.roles[x] ?? { name: x }
  if (x.or) return state.engine.Or(x.or.map((y) => decidersOf(state, y)))
  if (x.and) return state.engine.And(x.and.map((y) => decidersOf(state, y)))
  return state.engine.Order(x.order.map((y) => decidersOf(state, y)))
}

// A direction becomes one that tasks follow when its first version is official: the roles whose
// Change acts name its id get it.
function linkDirection(state, direction) {
  state.directions[direction.id] = direction
  delete state.newDirections[direction.id]
  for (const role of Object.values(state.roles)) {
    for (const act of role.acts) {
      if (act.act === 'Change' && act.directionIds?.includes(direction.id) && !act.changesOf.includes(direction)) act.changesOf.push(direction)
    }
  }
}

// A standard from a revise file: its rules may name older rules that they supersede. A rule
// that keeps its id, its words, and its checker stays the same rule, so its evidence and its
// open points stay.
function buildStandard(state, s, base) {
  // A rule with the same id, words, and checker is the same rule, also when an earlier version
  // removed it and this one adds it back: the newest earlier copy is kept. A new direction has
  // no base, so each of its rules is new.
  const older = base ? base.of.versions.flatMap((v) => v.standards.flatMap((x) => x.rules ?? [])) : []
  const checker = (r) => {
    // A program checks only the rules that name it.
    const program = Object.entries(state.config.roles).find(([n, x]) => x.kind === 'program' && x.checks.includes(r.id) && n !== r.checkedBy)
    if (program) throw new Error(`work.yaml roles.${program[0]} checks ${r.id}, but that rule is not checkedBy ${program[0]}`)
    if (r.checkedBy === undefined) return undefined
    const problem = checkerProblem(state.config.roles, r.id, r.checkedBy)
    if (problem) throw new Error(problem)
    return state.roles[r.checkedBy]
  }
  return {
    id: s.id, says: s.says, where: s.where,
    rules: (s.rules ?? []).map((r) => {
      // A changed rule keeps its id; supersedes names the other rules that it replaces.
      if ((r.supersedes ?? []).includes(r.id)) throw new Error(`rule ${r.id} supersedes itself; a changed rule keeps its id, and supersedes names other rules`)
      const same = older.findLast((x) => x.id === r.id && x.says === r.says && x.checkedBy === checker(r))
      if (same && !r.supersedes?.length) return same
      return {
        id: r.id, says: r.says, checkedBy: checker(r),
        supersedes: (r.supersedes ?? []).map((id) => {
          const found = (base?.standards ?? []).flatMap((x) => x.rules ?? []).find((x) => x.id === id)
          if (!found) throw new Error(`rule ${r.id} supersedes "${id}", which is not in the current version`)
          return found
        }),
      }
    }),
  }
}

const handlers = {
  config(state, { data, who, at }) {
    if (state.engine) throw new Error('the store has a config; use work config apply')
    const w = createWork()
    state.engine = w
    // A copy: later events change the config in memory, never the stored event.
    state.config = structuredClone(data.config)
    state.hashes = { ...data.hashes }
    state.texts = { ...(data.texts ?? {}) }
    const config = state.config
    for (const [roleName, r] of Object.entries(config.roles)) {
      const actor = r.kind === 'program' ? `program:${roleName}` : MODEL[r.tier]
      // The person who made the store owns the roles, so they may grant acts on them.
      const limits = r.kind === 'program' ? {} : config.limits[r.tier]
      state.roles[roleName] = {
        role: roleName, tier: r.kind === 'program' ? undefined : r.tier, playedBy: actor, acts: [], owner: { name: who },
        limits, config: r,
      }
    }
    for (const [roleName, r] of Object.entries(config.roles)) {
      state.roles[roleName].acts = r.acts.map((a) => {
        if (a.do) return { act: 'Do', work: a.do }
        if (a.review) return { act: 'Review', resultsOf: a.review.map((n) => state.roles[n]) }
        if (a.approve) return { act: 'Approve', resultsOf: a.approve.map((n) => state.roles[n]) }
        // The directions come later (linkDirection), each with its first version.
        return { act: 'Change', changesOf: [], directionIds: a.change }
      })
    }
    w.Workflow.define({
      system: config.project, roles: Object.values(state.roles),
      measure: state.measure ? (a) => state.measure(state, a) : undefined,
      decide: (config.decide ?? []).map((d) => ({ resultsOf: state.roles[d.resultsOf], by: decidersOf(state, d.by) })),
      when: at,
    })
  },

  'config.text'(state, { data }) {
    // Only the words of roles change here: description, intro, responsibilities, output.
    for (const [roleName, text] of Object.entries(data.roles)) {
      Object.assign(state.roles[roleName].config, text)
      Object.assign(state.config.roles[roleName], text)
    }
    state.hashes = data.hashes
    state.texts = data.texts ?? state.texts
  },

  'role.fit'(state, { data, who }) {
    state.fits[data.role] = { hash: data.hash, by: who, answers: data.answers }
  },

  'task.open'(state, { data, who, at }) {
    const t = data.task
    const task = state.engine.Task.start({
      name: t.name, owner: { name: who }, humanDescription: t.text, when: at,
      needs: neededTasks(state, t.needs),
      aiDescription: {
        text: t.text, directions: t.directions.map((id) => state.directions[id]),
        context: t.context, references: t.references, workspace: t.workspace,
        ...(t.from ? { from: lookup(state, t.from, ['r']) } : {}),
      },
    })
    task.id = name(state, task)
  },

  // A remake replaces a task whose scope changed; the new task gets the next task id.
  'task.remake'(state, event) {
    const { data } = event
    const old = lookup(state, data.task, ['t'])
    const t = data.file
    // A stored remake from before named was kept names every key.
    const named = (key) => t.named === undefined || t.named.includes(key)
    const review = data.review ? (state.groups.get(data.review) ?? [lookup(state, data.review, ['v'])]) : undefined
    const task = state.engine.Task.remake(old, {
      by: byOf(state, event, old), when: event.at, reason: data.reason, review,
      input: {
        // What the file does not name, the new task keeps from the old one (needs, directions,
        // context); the engine says which of them an agent may change.
        name: t.name, humanDescription: t.text,
        ...(named('needs') ? { needs: neededTasks(state, t.needs) } : {}),
        aiDescription: {
          text: t.text, references: t.references,
          ...(named('workspace') ? { workspace: t.workspace } : {}),
          ...(named('directions') ? { directions: t.directions.map((id) => state.directions[id]) } : {}),
          ...(named('context') ? { context: t.context } : {}),
          ...(t.from ? { from: lookup(state, t.from, ['r']) } : {}),
        },
      },
    })
    task.id = name(state, task)
  },

  assign(state, event) {
    const { data } = event
    const task = lookup(state, data.task, ['t'])
    const role = state.roles[data.role]
    const parent = data.parent ? lookup(state, data.parent, ['a']) : undefined
    const assignment = state.engine.Assignment.give({
      role, task, parent, maxAttempts: data.maxAttempts, when: event.at,
    })
    const id = name(state, assignment)
    assignment.label = `${id} (${data.role})`
    state.meta.set(assignment, { id, secret: data.secret, claim: null, briefs: 0, by: event.who, at: event.at })
  },

  // A brief takes the snapshot and the claim. The first brief of a task records how its
  // output looked before any work (a report equal to it is untouched work).
  brief(state, { data, at }) {
    const a = lookup(state, data.a, ['a'])
    state.engine.Assignment.brief(a, at)
    const meta = state.meta.get(a)
    meta.briefs += 1
    meta.claim = { at, result: data.result }
    if (data.untouched !== undefined && a.task.untouched === undefined) a.task.untouched = data.untouched
  },

  release(state, { data }) {
    state.meta.get(lookup(state, data.a, ['a'])).claim = null
  },

  report(state, { data, at }) {
    const a = lookup(state, data.a, ['a'])
    const madeFrom = (data.madeFrom ?? []).map((m) =>
      m.result ? { result: lookup(state, m.result, ['r']), source: m.result } : m)
    const result = state.engine.Result.report(a.task, {
      by: a, when: at, output: data.output, madeFrom, size: data.size, digest: data.digest, patch: data.patch,
    })
    name(state, result)
    endUnit(state, a)
  },

  // A review of a result, a task, a draft, or an evaluation. A draft or an evaluation takes one
  // Accept with evidence, or one Reject with a reason.
  review(state, event) {
    const { data, at } = event
    const target = lookup(state, data.target, ['r', 't', 'd', 'ev'])
    const w = state.engine
    const read = w.read
    const of = target[kind] === 'Revision' ? undefined : target[kind] === 'Evaluation' ? read.stopTask(target.answers) : taskOf(target)
    const by = byOf(state, event, of)
    const evidence = (data.evidence ?? []).map((e) => ({ says: e.what, meets: e.rule ? findRule(state, e.rule) : undefined, at: e.where }))
    if (target[kind] === 'Revision' || target[kind] === 'Evaluation') {
      if (data.decision === 'recheck') throw new Error(`a recheck asks for a new result; ${data.target} takes an accept or a reject`)
      const decision = data.decision === 'reject' ? 'Reject' : 'Accept'
      const reason = data.reason ?? data.points?.map((p) => p.text).join('; ')
      const review = w.Review.decide(target, by, at, decision, evidence, reason)
      review.quote = data.quote
      name(state, review, 'v')
      const version = target[kind] === 'Revision' && read.madeBy(target)
      if (version) {
        state.created.push(versionId(version))
        if (version.number === 1) linkDirection(state, target.of)
      }
      if (by[kind] === 'Assignment') endUnit(state, by)
      return
    }
    // At write time only: an accept is about the reported work, so the work must be unchanged.
    // A settle with no evidence decides a Raise, so it is not checked.
    const settleOnly = data.settles && !(data.evidence ?? []).length
    if (state.checking && data.decision === 'accept' && !settleOnly && target[kind] === 'Result' && state.changed?.(target)) {
      throw new Error(`the work changed after ${data.target} was reported`)
    }
    if (data.decision === 'recheck') {
      const review = w.Review.decide(target, by, at, 'Reject', [], data.reason, { redo: true })
      name(state, review, 'v')
    } else if (data.decision === 'reject') {
      if (!data.points?.length) throw new Error('a reject needs at least one --point')
      const records = data.points.map((p) =>
        w.Review.decide(target, by, at, 'Reject', [], p.text, { breaks: p.breaks ? findRule(state, p.breaks) : undefined }))
      const group = name(state, { group: records }, 'v')
      records.forEach((record, i) => {
        state.byId.set(`${group}.${i + 1}`, record)
        state.idOf.set(record, `${group}.${i + 1}`)
        record.quote = data.quote
        // The points of one Reject are one act: for the person, one stop.
        record.points = records
      })
      state.groups.set(group, records)
    } else {
      const settles = data.settles ? lookup(state, data.settles, ['v']) : undefined
      const review = w.Review.decide(target, by, at, 'Accept', evidence, data.reason, { settles })
      review.quote = data.quote
      name(state, review, 'v')
    }
    if (by[kind] === 'Assignment') endUnit(state, by)
  },

  raise(state, { data, at }) {
    const a = lookup(state, data.a, ['a'])
    const w = state.engine
    if (data.result) {
      const review = w.Review.decide(lookup(state, data.result, ['r']), a, at, 'Raise', [], data.reason)
      name(state, review, 'v')
    } else {
      if (!data.reason?.trim()) throw new Error('a raise needs a reason')
      const question = w.Note.add({
        kind: 'Question', text: data.reason, stops: [a.task], answerBy: w.read.openAncestor(a) ?? a.task.owner, from: a,
      }, at)
      name(state, question, 'q')
    }
    endUnit(state, a)
  },

  ask(state, { data, at }) {
    const a = lookup(state, data.a, ['a'])
    if (!data.text?.trim()) throw new Error('a question needs its text')
    const answerBy = data.to === 'owner' ? a.task.owner : (state.engine.read.openAncestor(a) ?? a.task.owner)
    const question = state.engine.Note.add({ kind: 'Question', text: data.text, stops: [a.task], answerBy, from: a }, at)
    name(state, question, 'q')
  },

  answer(state, event) {
    const q = lookup(state, event.data.q, ['q'])
    if (!event.data.text?.trim()) throw new Error('an answer needs its text')
    state.engine.Note.answer(q, event.data.text, byOf(state, event, q.stops?.[0]), event.at)
  },

  note(state, event) {
    const a = lookup(state, event.data.a, ['a'])
    if (!event.data.text?.trim()) throw new Error('a note needs its text')
    const note = state.engine.Note.add({ kind: event.data.kind, text: event.data.text, about: a.task, by: a }, event.at)
    name(state, note, 'n')
  },

  // Feedback in words: about a direction, a standard, or a rule (by id), or about nothing (a
  // new direction). A challenge is a suggestion that says that something is wrong.
  suggest(state, event) {
    const about = event.data.about === undefined ? undefined : findTarget(state, event.data.about)
    const suggestion = state.engine.Suggestion.make({ about, says: event.data.says, by: byOf(state, event), when: event.at })
    name(state, suggestion, 's')
  },

  // A draft of a direction, built on its current version. It names the Rejects (points) and
  // the suggestions that it answers.
  'direction.revise'(state, event) {
    const { data } = event
    const direction = state.directions[data.direction]
    if (direction?.source) {
      throw new Error(`${data.direction} is a company direction from ${direction.source.repo} (${direction.source.path}); it changes there, with a pull request. Suggest the change: work suggest <token> ${data.direction} --says="..."`)
    }
    if (!direction && state.newDirections[data.direction]) {
      throw new Error(`${data.direction} has no version yet; a draft of it is the whole direction: work direction new --file=<direction.yaml>`)
    }
    if (!direction) throw new Error(`there is no direction "${data.direction}"`)
    const base = state.engine.read.current(direction)
    const edit = data.edit
    const answers = (data.answers ?? []).flatMap((id) => state.groups.get(id) ?? [lookup(state, id, ['v', 's'])])
    const wrong = answers.find((x) => !(x[kind] === 'Suggestion' || (x[kind] === 'Review' && x.decision === 'Reject')))
    if (wrong) {
      throw new Error(`${idOf(state, wrong)} is not a Reject point or a suggestion; --answers takes points (v<n>.<m>, or v<n> for all of them) and suggestions (s<n>)`)
    }
    const draft = state.engine.Direction.revise(direction, {
      says: edit.says,
      add: (edit.add ?? []).map((s) => buildStandard(state, s, base)),
      remove: edit.remove ?? [],
      replace: (edit.replace ?? []).map((r) => [r.id, buildStandard(state, r.with, base)]),
      answers, why: data.why,
      by: byOf(state, event), when: event.at,
    })
    const id = name(state, draft, 'd')
    draft.label = id
  },

  // A new direction: the whole of it, drafted by a model (a high role, or a model run outside any
  // task). Another draft of a direction with no version yet answers the Reject of the last one.
  'direction.new'(state, event) {
    const { data } = event
    const d = data.direction
    if (state.directions[d.id]) throw new Error(`${d.id} has a version; a high role revises it: work direction revise <token> ${d.id} --file=<edit.yaml>`)
    const existing = state.newDirections[d.id]
    if (existing?.source) throw new Error(`${d.id} is a company direction; it changes in its repo`)
    const answers = (data.answers ?? []).flatMap((id) => state.groups.get(id) ?? [lookup(state, id, ['v', 's'])])
    const by = data.run ? { name: data.run.name, run: data.run.id } : byOf(state, event)
    const draft = state.engine.Direction.revise(existing, {
      name: d.name, owner: { name: d.owner }, from: d.from, maxStandards: d.maxStandards,
      approvedBy: d.approvedBy === undefined ? undefined : decidersOf(state, d.approvedBy),
      says: d.says, add: d.standards.map((s) => buildStandard(state, s, undefined)),
      answers, why: data.why, by, when: event.at,
    })
    draft.of.id = d.id
    state.newDirections[d.id] = draft.of
    draft.label = name(state, draft, 'd')
  },

  // A commit of a company direction (company.js): the refresh brings its folder in as a draft of
  // the whole direction, with its source, and only the owner accepts it. The draft is the change
  // from the current version: a standard with other words is replaced, a new one added, a gone
  // one removed, so a rule with the same words keeps its evidence.
  'company.import'(state, event) {
    const { id, source, folder, owner, checkers = {} } = event.data
    const existing = state.directions[id] ?? state.newDirections[id]
    if (existing && !existing.source) throw new Error(`${id} is a direction of this project; a company direction needs another id`)
    const read = state.engine.read
    if (read.drafts.some((x) => x.of === existing && x.source?.commit === source.commit && !read.madeBy(x))) {
      throw new Error(`commit ${source.commit.slice(0, 7)} of ${id} is in already`)
    }
    const checkedBy = (ruleId) => checkers.rules?.[ruleId] ?? checkers.checkedBy
    const entries = folder.standards.map((x) => ({ id: x.id, says: x.says,
      rules: x.rules.map((r) => ({ id: r.id, says: r.says, checkedBy: checkedBy(r.id), supersedes: [] })) }))
    const base = existing && read.current(existing)
    const by = { name: 'refresh', run: source.commit }
    let edit
    if (!base) {
      edit = { name: folder.name, owner: { name: owner }, from: [], says: folder.says, add: entries.map((x) => buildStandard(state, x, undefined)) }
    } else {
      const built = entries.map((x) => buildStandard(state, x, base))
      edit = {
        says: folder.says,
        add: built.filter((x) => !base.standards.some((y) => y.id === x.id)),
        replace: built.filter((x) => base.standards.some((y) => y.id === x.id && !read.sameWords(y, x))).map((x) => [x.id, x]),
        remove: base.standards.filter((y) => !built.some((x) => x.id === y.id)).map((y) => y.id),
      }
    }
    const draft = state.engine.Direction.revise(existing, { ...edit, answers: [], by, when: event.at, source })
    draft.of.id = id
    draft.of.source = { repo: source.repo, path: source.path }
    if (!base) state.newDirections[id] = draft.of
    draft.label = name(state, draft, 'd')
  },

  'task.split'(state, event) {
    const { data } = event
    const task = lookup(state, data.task, ['t'])
    const review = data.review ? (state.groups.get(data.review) ?? [lookup(state, data.review, ['v'])]) : undefined
    const base = task.aiDescription.context
    const parts = state.engine.Task.split(task, {
      by: byOf(state, event, task), when: event.at, review,
      into: data.parts.map((p) => ({
        name: p.name, humanDescription: p.text, after: p.after,
        aiDescription: {
          text: p.text,
          context: { ...base, ...(p.context ?? {}) },
          ...(p.from !== undefined ? { from: lookup(state, String(p.from), ['r']) } : {}),
          ...(p.workspace ? { workspace: p.workspace } : {}),
          ...(p.references ? { references: p.references } : {}),
        },
      })),
    })
    for (const part of parts) part.id = name(state, part)
  },

  'task.close'(state, event) {
    const task = lookup(state, event.data.task, ['t'])
    if (!event.data.reason?.trim()) throw new Error('a close needs a reason')
    state.engine.Task.close(task, byOf(state, event, task), event.at, event.data.reason)
  },

  // An executive act: the person, or an agent, gives a role one act for a time.
  grant(state, event) {
    const { data } = event
    const to = state.roles[data.to]
    if (!to) throw new Error(`there is no role "${data.to}"`)
    const act = data.act === 'change'
      ? { act: 'Change', changesOf: data.on.map((id) => state.directions[id] ?? lookup(state, id, ['t'])) }
      : { act: data.act === 'approve' ? 'Approve' : 'Review', resultsOf: data.on.map((n) => {
        if (!state.roles[n]) throw new Error(`there is no role "${n}"`)
        return state.roles[n]
      }) }
    const executive = state.engine.Executive.grant({ act, to, by: byOf(state, event), until: data.until, when: event.at })
    name(state, executive, 'x')
  },

  revoke(state, event) {
    state.engine.Executive.revoke(lookup(state, event.data.x, ['x']), { by: byOf(state, event), when: event.at })
  },

  waive(state, event) {
    const { data } = event
    const result = lookup(state, data.result, ['r'])
    const note = state.engine.Note.add({
      kind: 'Finding', about: result, notChecked: data.rules.map((id) => findRule(state, id)),
      by: byOf(state, event, result.task), reason: data.reason, until: data.until, text: data.reason,
    }, event.at)
    name(state, note, 'n')
  },

  // An evaluation answers one stop: the last try of a maker that ended on a fault (ex<n>), or a
  // Reject of the person (a point v<n>.<m>, or v<n>).
  evaluate(state, event) {
    const { data } = event
    const stop = state.groups.get(data.stop)?.[0] ?? lookup(state, data.stop, ['ex', 'v'])
    const task = stop[kind] === 'Exhaustion' ? stop.maker.task : taskOf(stop.of)
    const e = state.engine.Evaluation.write(stop, {
      by: byOf(state, event, task), when: event.at, wrong: data.wrong, why: data.why, improve: data.improve, level: data.level,
    })
    name(state, e)
  },

  finish(state, { data, at }) {
    state.engine.Assignment.finish(lookup(state, data.a, ['a']), at)
    state.meta.get(lookup(state, data.a, ['a'])).claim = null
  },

  source(state, { data }) {
    state.sources[data.source] = data.revision
  },

  checkpoint(state, { data, at }) {
    const task = lookup(state, data.task, ['t'])
    const seenOutside = Object.entries(state.sources).map(([source, revision]) => ({ source, revision }))
    const checkpoint = state.engine.Checkpoint.save(task, { seenOutside, next: data.next, when: at })
    name(state, checkpoint, 'k')
  },

  // A question from the person to an agent, and a comment from the person (both relayed).
  'person.ask'(state, event) {
    const a = lookup(state, event.data.a, ['a'])
    if (!event.data.text?.trim()) throw new Error('a question needs its text')
    const question = state.engine.Note.add({
      kind: 'Question', text: event.data.text, stops: [a.task], answerBy: a, from: event.who,
    }, event.at)
    name(state, question, 'q')
  },

  'person.note'(state, event) {
    const task = lookup(state, event.data.task, ['t'])
    if (!event.data.text?.trim()) throw new Error('a comment needs its text')
    const note = state.engine.Note.add({
      kind: 'Message', text: event.data.text, about: task, by: personBy(state, event.who, task, event.channel),
    }, event.at)
    name(state, note, 'n')
  },

  // A person's act relayed by the top agent. An act that only stops work counts at once;
  // an act that moves work forward or gives power waits for the person's ratify.
  relay(state, event) {
    const { data } = event
    const inner = { ...data.inner, who: data.person, channel: `relay:${data.channel}` }
    if (RELAY_AT_ONCE.has(data.act)) {
      handlers[inner.type](state, { ...event, ...inner })
    } else {
      state.pending.set(`e${event.id}`, { event, inner, at: event.at })
    }
  },

  ratify(state, event) {
    const pending = state.pending.get(event.data.event)
    if (!pending) throw new Error(`${event.data.event} is not a relayed act that waits for ratify`)
    if (pending.inner.who !== event.who) throw new Error(`${event.data.event} is ${pending.inner.who}'s to ratify`)
    handlers[pending.inner.type](state, { ...event, ...pending.inner, channel: 'ratified', at: event.at })
    state.pending.delete(event.data.event)
  },
}

// A relayed act that only stops work or informs counts at once, at the time of the relay; one
// that moves work forward (an accept, an answer) waits for the person's ratify, and counts at
// the time of the ratify.
export const RELAY_AT_ONCE = new Set(['reject', 'ask', 'comment'])

// A low agent's claim ends with its one unit; a medium or high claim lasts until finish.
function endUnit(state, a) {
  if (a.role.tier === 'low' || !a.role.tier) state.meta.get(a).claim = null
}
