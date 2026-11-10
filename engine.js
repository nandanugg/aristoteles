// The engine of the work CLI: a copy of the engine of the design page, extended
// with tiers, parent assignments, drafts of directions, and the evaluation of a mistake.

export const kind = Symbol('kind')
const record = (type, fields) => Object.defineProperty(fields, kind, { value: type })

// A person is { name: 'Nanda' }; one run of an AI model or a check program is { name, run }.
// A role names who plays it (playedBy): a model or a check program by a plain name, or a person.
const actorName = (actor) => actor?.name ?? actor
const isHuman = (actor) => typeof actor === 'object' && actor !== null && actor.run === undefined
const sameName = (a, b) => actorName(a) === actorName(b)
// How a refusal names an actor: the CLI sets a label ("a2 (architect)"); else its name.
const label = (by) => by?.label ?? actorName(by?.actor)
// An assignment is below another when the other is its parent, at any depth.
const below = (a, root) => {
  for (let x = a?.parent; x; x = x.parent) if (x === root) return true
  return false
}
// The person approves directions and standards, not results: no rule is checked by a person.
const noPersonRules = (standards) => {
  const rule = standards.flatMap((s) => s.rules ?? []).find((r) => r.checkedBy === 'Human')
  if (rule) throw new Error(`"${rule.says}" is checked by a person; the person approves directions and standards, not results: name the role that reviews it`)
}

// A tier assigns only the tiers below it. A role with no tier (an old test world, or a
// program) is outside this order.
const tierRank = { low: 1, medium: 2, high: 3, person: 4 }

// Who decides, when more than one may: Or (any one of the items), And (each item, in any
// order), Order (each item, in this order: an item decides only after the items before it
// accepted). An item is a role, an actor, or another Or, And, or Order.
const combine = Symbol('combine')
export const Or = (items) => ({ [combine]: 'Or', items })
export const And = (items) => ({ [combine]: 'And', items })
export const Order = (items) => ({ [combine]: 'Order', items })
const leavesOf = (who) => (who[combine] ? who.items.flatMap(leavesOf) : [who])
const whoName = (leaf) => leaf.role ?? actorName(leaf)
// Each item needs its own accept, so an expression names each role or person once. A person
// makes no version review: the approve is the last accept, so a person comes last in an Order.
const decidersProblem = (who) => {
  const names = leavesOf(who).map(whoName)
  const twice = names.find((n, i) => names.indexOf(n) !== i)
  if (twice) return `names ${twice} two times; each item needs its own accept, so name it once`
  const persons = (x) => leavesOf(x).filter((leaf) => !leaf.acts)
  if (persons(who).length > 1) return 'names more than one person; one approve is the last accept'
  const personLast = (x) => !x[combine] ||
    (x[combine] === 'Order' ? x.items.slice(0, -1).every((y) => persons(y).length === 0) && personLast(x.items.at(-1)) : x.items.every(personLast))
  if (!personLast(who)) return `names ${actorName(persons(who)[0])} before another item of an order; the person approves last`
  return undefined
}
// Two standards are the same when they say the same: the same id, words, "where", and rules (a
// revise keeps a rule object when its id, its words, and its checker stay). The order of the
// rules and of the keys of "where" says nothing.
const sameWhere = (a = {}, b = {}) => Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([k, v]) => JSON.stringify(v) === JSON.stringify(b[k]))
const sameStandard = (x, y) => x === y || (x.id === y.id && x.says === y.says && sameWhere(x.where, y.where) &&
  (x.rules ?? []).length === (y.rules ?? []).length && (x.rules ?? []).every((r) => (y.rules ?? []).includes(r)))
// Two rules are the same when they have the same id, words, and checker.
const sameRule = (x, y) => x === y || (x.id === y.id && x.says === y.says && x.checkedBy === y.checkedBy)
// Two drafts propose the same when they say the same and their standards have the same words,
// rule by rule: each draft makes its own objects, so the objects say nothing.
const sameWords = (x, y) => x.id === y.id && x.says === y.says && sameWhere(x.where, y.where) &&
  (x.rules ?? []).length === (y.rules ?? []).length && (x.rules ?? []).every((r) => (y.rules ?? []).some((q) => sameRule(r, q)))
const sameProposal = (x, y) => x.says === y.says && x.standards.length === y.standards.length &&
  x.standards.every((s) => y.standards.some((t) => sameWords(s, t)))
// The time of the accept that meets `who`, or undefined. An accept counts for one item only
// when it comes after `after`: for Order, after the item before it was met. matches(item, act)
// reads an act: who acted (by) and when.
const metAt = (who, accepts, matches, after = 0) => {
  switch (who[combine]) {
    case 'Or': {
      const times = who.items.map((x) => metAt(x, accepts, matches, after)).filter((t) => t !== undefined)
      return times.length > 0 ? Math.min(...times) : undefined
    }
    case 'And': {
      const times = who.items.map((x) => metAt(x, accepts, matches, after))
      return times.includes(undefined) ? undefined : Math.max(...times)
    }
    case 'Order': {
      let t = after
      for (const x of who.items) {
        t = metAt(x, accepts, matches, t)
        if (t === undefined) return undefined
      }
      return t
    }
    default:
      return accepts.find((a) => a.at > after && matches(who, a))?.at
  }
}
// The items that `who` still waits for, as text, such as "lead" or "lead and techlead".
const waitsFor = (who, accepts, matches, after = 0) => {
  if (metAt(who, accepts, matches, after) !== undefined) return undefined
  switch (who[combine]) {
    case 'Or':
      return who.items.map((x) => waitsFor(x, accepts, matches, after)).join(' or ')
    case 'And':
      return who.items.map((x) => waitsFor(x, accepts, matches, after)).filter(Boolean).join(' and ')
    case 'Order': {
      let t = after
      for (const x of who.items) {
        const at = metAt(x, accepts, matches, t)
        if (at === undefined) return waitsFor(x, accepts, matches, t)
        t = at
      }
      return undefined
    }
    default:
      return whoName(who)
  }
}
// The roles or actors whose accept `who` still waits for now: the work next steps of a decider.
const nextLeaves = (who, accepts, matches, after = 0) => {
  if (metAt(who, accepts, matches, after) !== undefined) return []
  if (who[combine] !== 'Order') return who[combine] ? who.items.flatMap((x) => nextLeaves(x, accepts, matches, after)) : [who]
  let t = after
  for (const x of who.items) {
    const at = metAt(x, accepts, matches, t)
    if (at === undefined) return nextLeaves(x, accepts, matches, t)
    t = at
  }
  return []
}
// Whether the act (who acts, and when) may decide now: in an Order, only after the items before
// its own were met.
const turnOf = (who, act, accepts, matches, after = 0) => {
  switch (who[combine]) {
    case 'Or':
    case 'And':
      return who.items.some((x) => turnOf(x, act, accepts, matches, after))
    case 'Order': {
      let t = after
      for (const x of who.items) {
        if (turnOf(x, act, accepts, matches, t)) return true
        t = metAt(x, accepts, matches, t)
        if (t === undefined) return false
      }
      return false
    }
    default:
      return matches(who, act)
  }
}

export function createWork() {
  const tasks = []
  const results = []
  // Reviews of results, tasks, drafts, and evaluations: one list, each review points to its target.
  const reviews = []
  const changes = []
  const directions = []
  // Feedback in words, and the drafts of directions that answer it.
  const suggestions = []
  const drafts = []
  const notes = []
  // The last tries of makers that ended on a fault, and the evaluations of tasks.
  const exhaustions = []
  const evaluations = []
  const assignments = []
  const executives = []
  let clock = 0 // orders every record, so "before" has a meaning
  let runCount = 0

  // Each act has its time (when): the tool gives it, as it proves the actor. The order of the
  // acts stays the order of the records (at); when only checks an until. An act with a time
  // before the last act is refused.
  let lastWhen
  const stamp = (when) => {
    if (when === undefined || Number.isNaN(Date.parse(when))) throw new Error('each act needs its time (when), from the tool')
    if (lastWhen !== undefined && Date.parse(when) < Date.parse(lastWhen)) {
      throw new Error(`an act at ${when} comes before the last act, at ${lastWhen}`)
    }
    lastWhen = when
    return when
  }
  const atOrBefore = (a, b) => Date.parse(a) <= Date.parse(b)

  // The tool passes who acts: an assignment, or an actor outside any task.
  const asBy = (x) => (x?.actor !== undefined ? x : { actor: x, role: { role: actorName(x), acts: [] }, under: [] })
  // Two actors are the same when they are one person, or one run.
  const sameActor = (a, b) =>
    isHuman(a.actor) || isHuman(b.actor) ? sameName(a.actor, b.actor) : a.actor?.run === b.actor?.run
  // A question or a Raise waits for a person by name, or for one assignment (a parent).
  const isAnswerer = (by, answerBy) =>
    answerBy?.[kind] === 'Assignment' ? by === answerBy : sameName(by.actor, answerBy)
  // Each limit sits under the part that checks it. A role can lower the limits of its workflow
  // (the CLI sets them from the role's tier).
  const LIMIT_PARTS = ['Assignment', 'Review', 'Result', 'Note']
  const limitsOf = (role) => Object.fromEntries(LIMIT_PARTS.map((part) =>
    [part, { ...role.workflow?.limits?.[part], ...role.limits?.[part] }]))

  // Each system brings its own workflow: its roles, who plays each one, the acts of each
  // role, and the limits that keep the work small enough for an AI. decide says how the
  // deciders of a maker's results combine (Or, And, Order); with no entry, any one role with
  // an Approve act on the maker decides alone.
  const Workflow = {
    define({ system, roles, limits = {}, measure, decide = [], when }) {
      stamp(when)
      for (const { resultsOf, by } of decide) {
        const problem = decidersProblem(by)
        if (problem) throw new Error(`decide for the results of ${resultsOf.role} ${problem}`)
        if (!roles.includes(resultsOf) || !resultsOf.acts.some((a) => a.act === 'Do')) {
          throw new Error(`decide names the results of "${resultsOf.role}", which is not a role of ${system} that does work`)
        }
        const missing = leavesOf(by).find((r) => !roles.includes(r) ||
          !r.acts.some((a) => a.act === 'Approve' && (a.resultsOf ?? []).includes(resultsOf)))
        if (missing) {
          throw new Error(`decide names ${whoName(missing)} for the results of ${resultsOf.role}, but ${whoName(missing)} has no Approve act on ${resultsOf.role}`)
        }
      }
      const workflow = record('Workflow', { system, roles, limits, measure, decide })
      for (const role of roles) {
        if (role.workflow) throw new Error(`the role "${role.role}" is already in ${role.workflow.system}`)
        role.workflow = workflow
      }
      return workflow
    },
  }

  // A grant covers an act from its own time to its until, and before its revoke, if any.
  const covers = (executive, when) => atOrBefore(executive.when, when) && atOrBefore(when, executive.until) &&
    (executive.revoked === undefined || Date.parse(when) < Date.parse(executive.revoked))
  // The acts of an assignment at a time: the standing acts of its role, and the executive acts
  // given to that role that cover that time.
  const actsOf = (by, when) => [
    ...by.role.acts,
    ...executives.filter((e) => e.to === by.role && covers(e, when)).map((e) => e.act),
  ]
  const can = (by, act, key, target, when) =>
    actsOf(by, when).some((a) => a.act === act && (a[key] ?? []).includes(target))

  // Nobody gives more than they may do: the giver owns each target, or has that act on it. A
  // person has the acts of their own roles; a model has the acts of its assignment.
  const mayGive = (by, act, when) => {
    const key = act.changesOf ? 'changesOf' : 'resultsOf'
    const own = isHuman(by.actor)
      ? assignments.filter((a) => sameName(a.actor, by.actor)).flatMap((a) => a.role.acts)
      : actsOf(by, when)
    return (act[key] ?? []).every((t) =>
      (t.owner && sameName(t.owner, by.actor)) || own.some((x) => x.act === act.act && (x[key] ?? []).includes(t)))
  }

  const Executive = {
    // One act that an actor gives a role for a time. It needs an end.
    grant({ act, to, by, until, when }) {
      stamp(when)
      by = asBy(by)
      if (until === undefined) throw new Error('an executive act needs an until')
      if (!mayGive(by, act, when)) throw new Error(`${label(by)} may not give this act`)
      const executive = record('Executive', { act, to, by, until, when, at: ++clock })
      executives.push(executive)
      return executive
    },
    // The giver ends it early. The acts before the revoke stay.
    revoke(executive, { by, when }) {
      stamp(when)
      by = asBy(by)
      if (!sameActor(by, executive.by)) throw new Error('only the giver revokes an executive act')
      if (executive.revoked !== undefined) throw new Error(`this executive act is already revoked, at ${executive.revoked}`)
      executive.revoked = when
    },
  }

  // A direction keeps its official versions in order: the last one is current, and each one
  // before it has replacedBy. Every version comes from a draft (its revision), version 1 too.
  const current = (target) => target.versions.at(-1)
  const draftName = (draft) => draft.label ?? `the draft of ${label(draft.by)} for ${draft.of.name}`
  // A draft is official when a version has it as its revision.
  const madeBy = (draft) => draft.of.versions.find((v) => v.revision === draft)
  // Who accepts a draft: approvedBy, or the owner. An item is a role, or a person by name. The
  // owner's item also matches a high role with a Change act on the direction at the time of the
  // act (a medium or a low role changes no direction; a role with no tier is outside the tiers).
  // The first version of a direction has only its owner: no task follows the direction yet, so
  // no role of approvedBy can work on it.
  const decidersOfDraft = (draft) => (draft.base ? draft.of.approvedBy ?? draft.of.owner : draft.of.owner)
  const standsInForOwner = (by, direction, when) =>
    (by.role.tier === undefined || by.role.tier === 'high') && can(by, 'Change', 'changesOf', direction, when)
  const draftMatches = (direction) => (leaf, act) => (leaf.acts
    ? act.by.role === leaf
    : sameName(act.by.actor, leaf) || standsInForOwner(act.by, direction, act.when))
  const hasEvidence = (review) => (review.evidence ?? []).some((e) => e.at && e.says)
  const draftAccepts = (draft) => reviewsOf(draft).filter((r) => isAccept(r) && hasEvidence(r))
  // A Reject by an item of the deciders ends the draft: its reviser revises again.
  const vetoOf = (draft) => {
    const matches = draftMatches(draft.of)
    return reviewsOf(draft).find((r) => isReject(r) && leavesOf(decidersOfDraft(draft)).some((leaf) => matches(leaf, r)))
  }
  // The roles or people whose accept a draft still waits for.
  const draftWaitsFor = (draft) => nextLeaves(decidersOfDraft(draft), draftAccepts(draft), draftMatches(draft.of))

  // The standards of a draft: the base, with the edit. A rule changes only with its standard:
  // replace the standard. A new rule can supersede older rules: they leave the draft (the
  // newer rule wins). A standard is named by its id, or by its text when it has no id.
  const draftStandards = (direction, base, { add, remove, replace }) => {
    noPersonRules([...add, ...replace.map(([, s]) => s)])
    const keyOf = (s) => s.id ?? s.says
    const keys = base.map(keyOf)
    for (const key of [...remove, ...replace.map(([old]) => old)]) {
      if (!keys.includes(key)) throw new Error(`${direction.name} has no standard "${key}"`)
    }
    for (const standard of add) {
      if (keys.includes(keyOf(standard))) throw new Error(`${direction.name} already has the standard "${keyOf(standard)}"`)
    }
    const replacement = new Map(replace)
    let standards = [...base.filter((s) => !remove.includes(keyOf(s))).map((s) => replacement.get(keyOf(s)) ?? s), ...add]
    // A rule id names one rule in the project: a new rule takes no id that another rule has,
    // also not the id of an old rule that a replaced standard keeps.
    const oldRules = base.flatMap((s) => s.rules ?? [])
    const all = standards.flatMap((s) => s.rules ?? [])
    const kept = all.filter((r) => oldRules.includes(r))
    const others = directions.filter((d) => d !== direction).flatMap((d) => current(d).standards.flatMap((s) => s.rules ?? []))
    const seenIds = new Set([...kept, ...others].map((r) => r.id).filter(Boolean))
    for (const rule of all) {
      if (!rule.id || oldRules.includes(rule)) continue
      if (seenIds.has(rule.id)) throw new Error(`the rule id "${rule.id}" is already used; a new rule needs a new id`)
      seenIds.add(rule.id)
    }
    const superseded = standards.flatMap((s) => (s.rules ?? []).flatMap((r) => r.supersedes ?? []))
    if (superseded.length > 0) {
      standards = standards.map((s) => ((s.rules ?? []).some((r) => superseded.includes(r))
        ? { ...s, rules: s.rules.filter((r) => !superseded.includes(r)) } : s))
    }
    if (direction.maxStandards !== undefined && standards.length > direction.maxStandards) {
      throw new Error(`${direction.name} would have ${standards.length} standards; the limit is ${direction.maxStandards}: remove or merge one`)
    }
    return standards
  }

  // Feedback in words, from anyone: about a direction, a standard, or a rule; about nothing, it
  // asks for a new direction. A challenge is a suggestion that says that something is wrong.
  const Suggestion = {
    make({ about, says, by, when }) {
      stamp(when)
      if (!says?.trim()) throw new Error('a suggestion says something: give its words')
      const suggestion = record('Suggestion', { about, says, by: asBy(by), when, at: ++clock })
      suggestions.push(suggestion)
      return suggestion
    },
  }

  // A direction holds standards, and each standard holds the rules that check it. A change goes
  // in three steps: a suggestion in words, a draft that answers it (revise), and the reviews of
  // the deciders (Review.decide on the draft). The accept that meets approvedBy (none: the
  // owner) makes the draft the next version.
  // A draft, built on the current version; with no direction, a new direction. The answers
  // are Rejects and suggestions that the draft answers, each at its level.
  // A draft of a company direction carries its source: the repo, the folder, and the commit.
  const writeDraft = (direction, { says, add = [], remove = [], replace = [], answers = [], why, by, when, source, ...fresh }) => {
    stamp(when)
    if (!by) throw new Error(`a draft for ${direction?.name ?? fresh.name} needs its reviser`)
    by = asBy(by)
    const wrong = answers.find((x) => x[kind] !== 'Suggestion' && !(x[kind] === 'Review' && isReject(x)))
    if (wrong) throw new Error('a draft answers Rejects and suggestions only')
    // A new direction, or another draft of a direction that has no version yet (after a Reject):
    // the whole direction, with no base.
    if (!direction || !current(direction)) {
      const { name, owner, from = [], maxStandards, approvedBy } = fresh
      if (direction && !sameName(direction.owner, owner)) {
        throw new Error(`${direction.name} is ${actorName(direction.owner)}'s; another draft of it keeps its owner`)
      }
      const problem = approvedBy && decidersProblem(approvedBy)
      if (problem) throw new Error(`approvedBy of ${name} ${problem}`)
      const stranger = approvedBy && leavesOf(approvedBy).find((leaf) => !leaf.acts && !sameName(leaf, owner))
      if (stranger) throw new Error(`approvedBy of ${name} names ${actorName(stranger)}, who is not its owner; the owner approves`)
      const made = direction ?? record('Direction', { name, owner, from, maxStandards, approvedBy, versions: [] })
      if (direction) Object.assign(made, { name, from, maxStandards, approvedBy })
      const standards = draftStandards(made, [], { add, remove: [], replace: [] })
      for (const answer of answers) {
        if (answer[kind] === 'Suggestion') {
          if (answer.about) throw new Error(`"${answer.says}" is about something that exists; a new direction answers only suggestions that ask for a new direction`)
          continue
        }
        const rejected = answer.of
        if (rejected[kind] !== 'Revision' || rejected.of !== made) {
          throw new Error(`"${answer.reason}" is not a Reject of a draft of ${made.name}; a new direction answers suggestions for a new direction, and the Rejects of its own drafts`)
        }
        if (sameProposal({ says, standards }, rejected)) {
          throw new Error(`this draft proposes the same as ${draftName(rejected)}, so it cannot answer "${answer.reason}"`)
        }
      }
      const draft = record('Revision', { of: made, base: undefined, says, standards, by, answers, why, source, when, at: ++clock })
      drafts.push(draft)
      return draft
    }
    const base = current(direction)
    const standards = draftStandards(direction, base.standards, { add, remove, replace })
    const to = { of: direction, says: says ?? base.says, standards }
    for (const answer of answers) {
      const problem = answer[kind] === 'Suggestion' ? suggestionAnswered(answer, base, to)
        : answer.of[kind] === 'Revision' ? draftRejectAnswered(answer, base, to)
        : rejectAnswered(answer, base, to)
      if (problem) throw new Error(problem)
    }
    const draft = record('Revision', { of: direction, base, says: to.says, standards, by, answers, why, source, when, at: ++clock })
    drafts.push(draft)
    return draft
  }
  const Direction = {
    // A short form for examples and tests: a model's draft of a new direction and its owner's
    // accept, in one call. The CLI records the two acts (work direction new, then the owner's
    // review).
    start({ by, when, standards = [], ...input }) {
      by = asBy(by)
      if (isHuman(by.actor)) {
        throw new Error(`the person gives direction in words, as a suggestion; a model drafts ${input.name}, and its owner accepts it`)
      }
      const draft = writeDraft(undefined, { ...input, add: standards, by, when })
      makeVersion(draft, when)
      return draft.of
    },
    // A model writes each draft: the person gives direction in words (a suggestion), and accepts
    // or rejects the draft.
    revise(direction, edit) {
      if (edit.by && isHuman(asBy(edit.by).actor)) {
        throw new Error(`the person gives direction in words, as a suggestion about ${direction?.name ?? edit.name}; a high role writes the draft`)
      }
      return writeDraft(direction, edit)
    },
  }

  // Why the accept that would make a draft official is refused, or undefined.
  const officialProblem = (draft, accepts) => {
    const name = draftName(draft)
    const direction = draft.of
    if (!draft.base && current(direction)) {
      return `${name} drafts ${direction.name} anew, and ${direction.name} has v${current(direction).number} now; its reviser revises the current version`
    }
    if (draft.base && draft.base !== current(direction)) {
      return `${name} is built on ${direction.name} v${draft.base.number}, an old version; its reviser revises the current one`
    }
    const person = accepts.some((a) => isHuman(a.by.actor) && sameName(a.by.actor, direction.owner))
    if (!draft.base && !person) return `${name} makes a new direction; ${actorName(direction.owner)} accepts it`
    if (draft.says !== draft.base?.says && draft.base && !person) {
      return `${name} changes what ${direction.name} says; a new spirit needs the accept of ${actorName(direction.owner)}`
    }
    const reject = reviewsOf(draft).find(isReject)
    if (reject && !person) return `${name} has the Reject of ${label(reject.by)}; after it, only the accept of ${actorName(direction.owner)} makes it official`
    const elsewhere = directions.filter((d) => d !== direction)
      .flatMap((d) => current(d).standards.flatMap((s) => s.rules ?? [])).map((r) => r.id).filter(Boolean)
    const before = draft.base?.standards ?? []
    const fresh = draft.standards.flatMap((s) => s.rules ?? []).filter((r) => r.id && !before.some((s) => (s.rules ?? []).includes(r)))
    const twin = fresh.find((r) => elsewhere.includes(r.id))
    if (twin) {
      return draft.source
        ? `the rule id "${twin.id}" of this company direction is used by another direction of the project; give one of them a new id (a company rule changes in its repo)`
        : `the rule id "${twin.id}" is already used by another direction; revise with a new id`
    }
    const ids = draft.standards.flatMap((s) => s.rules ?? []).map((r) => r.id).filter(Boolean)
    const repeated = ids.find((id, i) => ids.indexOf(id) !== i)
    if (repeated) return `${name} has the rule id "${repeated}" twice; revise with a new id`
    return undefined
  }

  // The draft becomes the next version (version 1 of a new direction).
  const makeVersion = (draft, when) => {
    const direction = draft.of
    const from = current(direction)
    if (!from) directions.push(direction)
    const to = record('Version', {
      of: direction, number: (from?.number ?? 0) + 1, says: draft.says, standards: draft.standards, revision: draft, source: draft.source, when,
    })
    direction.versions.push(to)
    if (!from) return to
    from.replacedBy = to
    // Running assignments keep their snapshot; their actors read a new brief to follow this.
    // Each new standard or rule becomes a lesson that later tasks can find.
    const oldRules = from.standards.flatMap((s) => s.rules ?? [])
    const newStandards = to.standards.filter((s) => !from.standards.includes(s))
    const newRules = newStandards.flatMap((s) => (s.rules ?? []).filter((r) => !oldRules.includes(r)))
    const added = [...(to.says !== from.says ? [to.says] : []), ...newStandards.map((s) => s.says), ...newRules.map((r) => r.says)]
    for (const text of added.length > 0 ? added : [`${direction.name} changed`]) {
      notes.push(record('Note', { kind: 'Lesson', from: draft.answers, text, rule: to, when }))
    }
    return to
  }

  // A review of a draft. The reviser and the actors below it do not review it. The accept
  // (with evidence) that meets the deciders makes the draft official.
  const decideDraft = (draft, by, when, decision, evidence, reason) => {
    const name = draftName(draft)
    if (decision !== 'Accept' && decision !== 'Reject') throw new Error(`a draft takes an Accept or a Reject; ask about ${name} with a question`)
    const made = madeBy(draft)
    if (made) throw new Error(`${name} is official: it made ${draft.of.name} v${made.number}`)
    const vetoed = vetoOf(draft)
    if (vetoed) throw new Error(`${name} is ended by the Reject of ${label(vetoed.by)}: ${vetoed.reason}; its reviser revises the current version again`)
    if (sameActor(by, draft.by) || below(by, draft.by)) throw new Error(`${name} is your own draft, or a draft from above you; another actor reviews it`)
    if (reviewsOf(draft).some((r) => sameActor(r.by, by))) throw new Error(`${label(by)} already reviewed ${name}`)
    if (decision === 'Accept' && !hasEvidence({ evidence })) {
      throw new Error(`an accept of ${name} says where it read in the draft and what it saw: give evidence`)
    }
    const who = decidersOfDraft(draft)
    const matches = draftMatches(draft.of)
    const accepts = draftAccepts(draft)
    const act = { by, when }
    if (leavesOf(who).some((leaf) => matches(leaf, act)) && !turnOf(who, act, accepts, matches)) {
      throw new Error(`${label(by)} reviews ${name} after the accept of ${waitsFor(who, accepts, matches)}`)
    }
    if (decision === 'Accept') {
      const after = [...accepts, { by, when, evidence, at: clock + 1 }]
      if (metAt(who, after, matches) !== undefined) {
        const problem = officialProblem(draft, after)
        if (problem) throw new Error(problem)
      }
    }
    const review = record('Review', { of: draft, by, decision, reason, evidence, under: [...(by.under ?? [])], when, at: ++clock })
    reviews.push(review)
    if (decision === 'Accept' && metAt(who, draftAccepts(draft), matches) !== undefined) makeVersion(draft, when)
    return review
  }

  // A suggestion is answered at its level: one about a rule by a change of its standard, one
  // about a standard by a change of that standard, one about a direction by a change of what
  // it says. One about nothing asks for a new direction.
  const suggestionAnswered = (suggestion, from, to) => {
    const about = suggestion.about
    const words = `"${suggestion.says}"`
    if (!about) return `${words} asks for a new direction; a draft of ${from.of.name} does not answer it`
    if (about[kind] === 'Direction') {
      if (about !== from.of) return `${words} is about ${about.name}, not ${from.of.name}`
      return to.says === from.says ? `${words} is about ${from.of.name} itself; a change of what it says answers it` : undefined
    }
    const holder = from.standards.find((s) => s === about || (s.rules ?? []).includes(about))
    if (!holder) return `${words} is about "${about.says}", which is not in ${from.of.name} v${from.number}`
    if (to.standards.includes(holder)) {
      return holder === about
        ? `a suggestion about the standard "${about.says}" is answered by a change of that standard`
        : `a suggestion about the rule "${about.says}" is answered by a change of its standard`
    }
    return undefined
  }
  // A Reject of a result or a task is answered only by a real change in a direction that
  // its task follows.
  // A point that names a rule is answered by changed work with evidence; only a change that
  // takes that rule off the task leaves nothing to check, and so answers it.
  const rejectAnswered = (reject, from, to) => {
    const task = reject.of[kind] === 'Task' ? reject.of : reject.of.task
    if (!task) return `"${reject.reason}" is not a Reject of a result or a task`
    if (isPersonStop(reject) && !stopAnswered(reject)) {
      return `"${reject.reason}" waits for an evaluation of ${idName(task)} first: what is wrong, why, and what to improve`
    }
    if (reject.breaks && rulesUnder(task, from, to).some((r) => sameRule(r, reject.breaks))) {
      return `"${reject.reason}" names the rule ${reject.breaks.id ?? reject.breaks.says}; changed work with evidence answers it, not a direction change`
    }
    if (!directionsOf(task).includes(from.of)) {
      return `${from.of.name} is not a direction of ${task.name}, so it cannot answer "${reject.reason}"`
    }
    // The change must say something new to this task: a standard that applies elsewhere only
    // leaves the task as it was.
    if (sameFor(to, from, task)) {
      return `this change of ${from.of.name} says the same to ${idName(task)} as before, so it cannot answer "${reject.reason}"`
    }
    return undefined
  }
  // A Reject of an earlier draft of this direction is answered by a draft that proposes
  // something else.
  const draftRejectAnswered = (reject, from, to) => {
    const rejected = reject.of
    if (rejected.of !== from.of) return `"${reject.reason}" rejects a draft of ${rejected.of.name}, not of ${from.of.name}`
    if (sameProposal(to, rejected)) return `this draft proposes the same as ${draftName(rejected)}, so it cannot answer "${reject.reason}"`
    return undefined
  }
  // The versions made from drafts that answer a Reject.
  const answeredByVersion = (reject) => drafts.some((d) => d.answers.includes(reject) && madeBy(d))

  const directionsOf = (task) => task.aiDescription.directions
  // A standard applies where its "where" matches the context of the task; none means everywhere.
  const applies = (standard, task) =>
    Object.entries(standard.where ?? {}).every(([key, value]) => task.aiDescription.context[key] === value)
  const applicable = (version, task) => version.standards.filter((s) => applies(s, task))
  // The rules of a task are those of its directions that apply to it. A closed task is not
  // needed, so its rules move nowhere.
  const rulesOf = (task) => [...new Set(
    directionsOf(task).flatMap((d) => applicable(current(d), task).flatMap((s) => s.rules ?? [])))]
  // The rules of a task if the version `to` replaced `from`.
  const rulesUnder = (task, from, to) =>
    directionsOf(task).flatMap((d) => applicable(d === from.of ? to : current(d), task).flatMap((s) => s.rules ?? []))

  // A Change act on a task covers the parts of that task too.
  const mayChange = (by, target, when) =>
    sameName(by.actor, target.owner) ||
    can(by, 'Change', 'changesOf', target, when) ||
    (target[kind] === 'Task' &&
      actsOf(by, when).some((a) => a.act === 'Change' && (a.changesOf ?? []).some((t) => within(target, t))))

  const Task = {
    start({ id, name, owner, humanDescription, aiDescription = {}, serves, replaces, needs = [], when }) {
      stamp(when)
      const task = record('Task', {
        id,
        name,
        owner,
        humanDescription,
        aiDescription: {
          text: '',
          directions: [],
          references: [],
          notes: [],
          ...aiDescription,
          context: aiDescription.context ?? {},
        },
        serves,
        replaces,
        needs,
        when,
      })
      tasks.push(task)
      return task
    },
    // A big task becomes smaller tasks that serve it, and the task needs them: its own result
    // comes after they are accepted. Each part has its own text; the parent text stays beside
    // it as "part of". A split can answer the review that asked. A part that uses the work of
    // other parts, or changes the same files, runs after them: after names those parts, above
    // it in the same split. The parts that need nothing open run at the same time.
    split(task, { into, by, when, review }) {
      stamp(when)
      by = asBy(by)
      if (!mayChange(by, task, when)) throw new Error(`${label(by)} has no change act on ${task.name}`)
      if (into.length === 0) throw new Error('a split makes at least one smaller task')
      if (into.some((input) => !input.aiDescription?.text)) throw new Error('each smaller task needs its own text')
      const name = idName(task)
      if (task.closed) throw new Error(`${name} is closed; a closed task takes no parts`)
      if (tasks.some((t) => t.serves === task && !t.closed)) throw new Error(`${name} already has parts; split a part, or remake ${name}`)
      // An agent's split of a task that waits for an evaluation comes from that evaluation.
      const unevaluated = !isHuman(by.actor) && evaluationWaits(task)
      if (unevaluated) throw new Error(`${name} waits for an evaluation of ${stopText(unevaluated)}; a split comes after it`)
      into.forEach(({ name: partName, after = [] }, i) => {
        if (into.findIndex((x) => x.name === partName) !== i) throw new Error(`two parts are named ${partName}; each part needs its own name`)
        const above = into.slice(0, i).map((x) => x.name)
        const unknown = after.find((n) => !above.includes(n))
        if (unknown) throw new Error(`part ${partName}: after names "${unknown}", which is not a part above it in this split`)
      })
      const answers = answersOf(task, by, review, 'split')
      changes.push(record('Split', { task, answers, by, when, at: ++clock }))
      // Each part waits for what its task waits for, and for the parts that it runs after.
      const parts = []
      const waits = [...task.needs]
      for (const { after = [], ...input } of into) {
        parts.push(Task.start({
          owner: task.owner,
          ...input,
          aiDescription: { ...task.aiDescription, ...input.aiDescription, partOf: task.aiDescription.text },
          serves: task,
          needs: [...waits, ...after.map((n) => parts.find((p) => p.name === n))],
          when,
        }))
      }
      task.needs = [...task.needs, ...parts]
      return parts
    },
    // A task that another open task needs is not closed: without it, the scope of the other
    // task changes, and that task is remade. A close closes the open parts of the task too.
    // An agent's close never drops the person's open Reject anywhere in the tree.
    close(task, by, when, reason) {
      stamp(when)
      by = asBy(by)
      if (!mayChange(by, task, when)) throw new Error(`${label(by)} has no change act on ${task.name}`)
      const name = idName(task)
      const needer = neederOf(task)
      if (needer) {
        const need = needer.needs.find((n) => within(n, task))
        throw new Error(`${idName(needer)} needs ${idName(need)}; without it the scope of ${idName(needer)} changes: remake ${idName(needer)}`)
      }
      const tree = tasks.filter((t) => !t.closed && within(t, task))
      const point = !isHuman(by.actor) && personRejects(task, { tree: true })[0]
      if (point) throw new Error(`"${point.reason}" is the person's open Reject in ${name}; a close would drop it`)
      // A mistake is evaluated, not decided: an agent's close waits for the evaluation too.
      const unevaluated = !isHuman(by.actor) && tree.find((t) => evaluationWaits(t))
      if (unevaluated) throw new Error(`${idName(unevaluated)} waits for an evaluation of ${stopText(evaluationWaits(unevaluated))}; a close comes after it`)
      for (const t of tree) t.closed = { by, reason, when }
    },
    // A change of scope: a new task replaces the old one, and the old task and its open parts
    // close as replaced. Each open task that needed the old task needs the new one. The work is
    // not thrown away: a task of the new tree may report accepted work of the old tree again,
    // and its checkers check it again under the new text.
    remake(old, { input, by, when, reason, review }) {
      stamp(when)
      by = asBy(by)
      if (!mayChange(by, old, when)) throw new Error(`${label(by)} has no change act on ${old.name}`)
      const name = idName(old)
      if (old.closed) throw new Error(`${name} is closed; a closed task is not remade`)
      if (!reason?.trim()) throw new Error('a remake needs a reason')
      const tree = tasks.filter((t) => !t.closed && within(t, old))
      // An agent's remake does not skip an evaluation that a task of the tree waits for.
      const unevaluated = !isHuman(by.actor) && tree.find((t) => evaluationWaits(t))
      if (unevaluated) throw new Error(`${idName(unevaluated)} waits for an evaluation of ${stopText(evaluationWaits(unevaluated))}; a remake comes after it`)
      const inner = tasks.find((t) => !t.closed && !within(t, old) && t.needs.some((n) => n !== old && tree.includes(n)))
      if (inner) throw new Error(`${idName(inner)} needs a part of ${name}; remake ${idName(inner)} first`)
      const answers = answersOf(old, by, review, 'remake')
      const point = !isHuman(by.actor) && personRejects(old, { tree: true }).find((r) => !answers.includes(r))
      if (point) throw new Error(`"${point.reason}" is the person's open Reject in ${name}; a remake would drop it`)
      // The new task keeps what the input does not name: the needs of the old task (but not its
      // parts, which close), its directions, its context, and its workspace. An agent's remake
      // keeps the rules and the frame of the task, as a split does: it may add a need, but only
      // the person drops a need or changes the directions, the context, or the workspace.
      const kept = old.needs.filter((n) => !tree.includes(n))
      const needs = input.needs ?? kept
      const ai = input.aiDescription ?? {}
      const directionsNow = ai.directions ?? directionsOf(old)
      const contextNow = ai.context ?? old.aiDescription.context
      const workspaceNow = ai.workspace ?? old.aiDescription.workspace
      if (!isHuman(by.actor)) {
        const was = old.aiDescription.context
        const sameDirections = directionsNow.length === directionsOf(old).length && directionsNow.every((d) => directionsOf(old).includes(d))
        const keys = new Set([...Object.keys(was), ...Object.keys(contextNow)])
        const spaceKey = (list) => JSON.stringify((list ?? []).map((w) => [w.source, w.path, w.base ?? null, w.verify ?? null]).sort())
        if (!sameDirections || [...keys].some((k) => was[k] !== contextNow[k]) || spaceKey(workspaceNow) !== spaceKey(old.aiDescription.workspace)) {
          throw new Error(`an agent's remake keeps the directions, the context, and the workspace of ${name}; only the person changes them (leave them out of the file, and the remake keeps them)`)
        }
        const dropped = kept.find((n) => !needs.includes(n))
        if (dropped) throw new Error(`an agent's remake keeps the needs of ${name}; it may add a need, but only the person drops ${idName(dropped)}`)
      }
      // A remake changes the scope: one that says what the old task says changes nothing for the
      // maker, so it does not reopen work that waits for a change.
      const sameSet = (x, y) => x.length === y.length && x.every((v) => y.includes(v))
      const spaceOf = (list) => JSON.stringify((list ?? []).map((w) => [w.source, w.path, w.base ?? null, w.verify ?? null]).sort())
      const contextOf = (c) => JSON.stringify(Object.entries(c ?? {}).sort())
      if ((ai.text ?? input.humanDescription) === old.aiDescription.text && sameSet(directionsNow, directionsOf(old)) &&
        contextOf(contextNow) === contextOf(old.aiDescription.context) && spaceOf(workspaceNow) === spaceOf(old.aiDescription.workspace) &&
        sameSet(needs, kept) && sameSet(ai.references ?? [], old.aiDescription.references ?? []) && (ai.from ?? old.aiDescription.from) === old.aiDescription.from) {
        throw new Error(`the remake of ${name} says what ${name} says; a remake changes its scope: the text, the needs, the directions, the context, the workspace, or the references`)
      }
      const reaches = (list, seen = new Set()) =>
        list.some((n) => tree.includes(n) || (!seen.has(n) && seen.add(n) && reaches(n.needs, seen)))
      if (reaches(needs)) throw new Error(`a cycle of needs: the new ${input.name ?? name} would need itself through ${needs.map(idName).join(', ')}`)
      const task = Task.start({ ...input, aiDescription: { ...ai, directions: directionsNow, context: contextNow, workspace: workspaceNow },
        owner: old.owner, serves: old.serves, replaces: old, needs, when })
      for (const t of tasks) if (!t.closed && t !== task) t.needs = t.needs.map((n) => (n === old ? task : n))
      for (const t of tree) t.closed = { by, reason, replacedBy: task, when }
      changes.push(record('Remake', { task: old, by, answers, when, at: ++clock }))
      return task
    },
    // A waiver can end, so the state needs a time too.
    state(task, when) {
      if (task.closed) return 'Closed'
      if (reviews.some((r) => r.of === task && isReject(r) && !answered(r))) return 'Returned'
      if (taskAccepted(task, when)) return 'Accepted'
      if (results.some((r) => r.task === task)) return 'In review'
      return 'Open'
    },
  }

  const resultsOf = (task) => results.filter((r) => r.task === task)
  // Only a fault uses an attempt: a result that a reviewer or a decider rejected, or that waits
  // for its first review. A recheck, the person's criticism, and a result made under versions
  // that no longer say the same to the task use none, so an approved change resets the attempts.
  // The person criticises as the owner: a person in a role that reviews or decides the maker is
  // a reviewer or a decider like any other.
  const isCriticism = (review) => isHuman(review.by.actor) && !coversMaker(review.by, review.of, review.when)
  const isFault = (review) => isReject(review) && !review.redo && !isCriticism(review)
  const underNow = (result) => directionsOf(result.task).every((d) => {
    const v = result.under.find((x) => x.of === d)
    return !v || sameFor(v, current(d), result.task)
  })
  // A result that its deciders have not decided is an attempt in flight (a check program's or a
  // reviewer's accept is not a decision, nor is a settle); a recheck or a criticism ends it with
  // no fault, and its deciders' accept ends it as done.
  // A result stops being an attempt once its deciders decided it, also when a later criticism
  // or change makes them look again: the criticism is not a fault of the maker.
  const settled = (r) => decisionMet(r, reviewsOf(r).filter((a) => isAccept(a) && decides(a, r))) ||
    reviewsOf(r).some((v) => isReject(v) && !isFault(v))
  const decidedBefore = (r, at) => decisionMet(r, reviewsOf(r).filter((a) => isAccept(a) && decides(a, r) && a.at < at))
  const used = (by) => results.filter((r) => r.by === by && underNow(r) &&
    (reviewsOf(r).some((v) => isFault(v) && !decidedBefore(r, v.at)) || !settled(r))).length
  const isDo = (role) => role.acts.some((a) => a.act === 'Do')
  const openDo = (a) => isDo(a.role) && !a.finished && (a.maxAttempts === undefined || used(a) < a.maxAttempts)
  // The rules that one review assignment checks: every rule of its task that names its role.
  const checksOf = (a) => rulesOf(a.task).filter((r) => r.checkedBy === a.role)

  // A task is in the tree of another when it is that task or serves it, at any depth.
  const within = (task, root) => {
    for (let t = task; t; t = t.serves) if (t === root) return true
    return false
  }

  const Assignment = {
    // A parent assignment gives work only to a lower tier, and only in its own task tree.
    // actor: the person of the role, or a run that the tool started; none: a new run of the
    // role's model.
    give({ role, task, actor, maxAttempts, parent, when }) {
      stamp(when)
      if (!role.workflow) throw new Error(`the role "${role.role}" is in no workflow`)
      if (parent) {
        const own = tierRank[parent.role.tier]
        const theirs = tierRank[role.tier]
        if (own !== undefined && theirs !== undefined && theirs >= own) {
          throw new Error(`a ${parent.role.tier} role assigns only lower tiers; "${role.role}" is ${role.tier}`)
        }
        if (!within(task, parent.task)) {
          throw new Error(`${task.id ?? task.name} is outside the task tree of ${parent.task.id ?? parent.task.name}`)
        }
        if (parent.finished) throw new Error(`the parent assignment is finished`)
        // A maker's results need a decider: the parent, or an assignment above it, approves the
        // maker's role, so the work is not left to the person alone.
        let decider = parent
        while (decider && !can(decider, 'Approve', 'resultsOf', role, when)) decider = decider.parent
        if (isDo(role) && !decider) {
          throw new Error(`${label(parent)} decides no ${role.role} results, and no assignment above it does; a role that approves ${role.role} assigns it`)
        }
      }
      // A person's role works only for that person; a model's role, only for a run of its model.
      if (isHuman(role.playedBy)) {
        if (!isHuman(actor) || !sameName(actor, role.playedBy)) {
          throw new Error(`the role "${role.role}" is ${actorName(role.playedBy)}'s; the tool proves that ${actorName(role.playedBy)} acts`)
        }
      } else if (actor !== undefined && (isHuman(actor) || actor.name !== role.playedBy)) {
        throw new Error(`the role "${role.role}" is played by ${role.playedBy}; ${isHuman(actor) ? actorName(actor) : `a run of ${actor.name}`} does not play it`)
      }
      const player = actor ?? { name: role.playedBy, run: `${role.playedBy}-${++runCount}` }
      const limits = limitsOf(role)
      if (maxAttempts !== undefined && !(Number.isInteger(maxAttempts) && maxAttempts >= 1)) {
        throw new Error('maxAttempts must be a whole number of 1 or more')
      }
      // Limits.Assignment.attempts is the default and the ceiling of a Do assignment.
      const ceiling = limits.Assignment.attempts
      if (isDo(role) && ceiling !== undefined && maxAttempts > ceiling) {
        throw new Error(`maxAttempts ${maxAttempts} is over the ${role.tier ?? role.role} limit of ${ceiling}`)
      }
      if (isDo(role)) {
        if (assignments.some((a) => a.task === task && openDo(a))) {
          throw new Error(`${task.name} already has an open Do assignment`)
        }
        // Work that waits for other work runs after it: a maker starts on the accepted work of
        // each task that its task needs. Only tasks that need nothing open run at the same time.
        const need = task.needs.find((n) => !taskAccepted(n, when))
        if (need) {
          throw new Error(`${idName(task)} needs ${idName(need)} (${need.name}), which is not accepted; its maker starts after that`)
        }
        // A mistake is evaluated before new work: a new maker with the same inputs would make it again.
        const stop = workStop(task, when)
        if (stop) throw new Error(stop)
      }
      const assignment = record('Assignment', {
        actor: player,
        role,
        task,
        under: directionsOf(task).map(current),
        maxAttempts: maxAttempts ?? (isDo(role) ? ceiling : undefined),
        parent,
        when,
      })
      const rulesLimit = limits.Review.rules
      if (rulesLimit !== undefined && role.acts.some((a) => a.act === 'Review')) {
        const count = checksOf(assignment).length
        if (count > rulesLimit) {
          throw new Error(
            `${actorName(player)} (${role.role}) would check ${count} rules; the limit is ` +
              `${rulesLimit}: split the task, so that each part has fewer rules`,
          )
        }
      }
      // The CLI measures the brief as it prints it; the default measures its data.
      const briefLimit = limits.Assignment.briefChars
      if (briefLimit !== undefined) {
        const measure = role.workflow.measure ?? ((a) => JSON.stringify(briefOf(a, when)).length)
        const size = measure(assignment)
        if (size > briefLimit) {
          throw new Error(`the brief of ${task.name} has ${size} characters; the limit is ${briefLimit}: split the task`)
        }
      }
      // A new maker of a task ends the makers before it (none is open, or this give is refused),
      // so a later reset of their attempts does not open a second maker. It is a finish: what
      // waits for them goes up.
      if (isDo(role)) for (const x of assignments) if (x.task === task && isDo(x.role) && !x.finished) endAssignment(x, when)
      assignments.push(assignment)
      return assignment
    },
    // What the actor reads (see briefOf). Reading it takes a snapshot: the exact versions that
    // the next results and reviews follow.
    brief(a, when) {
      stamp(when)
      a.under = directionsOf(a.task).map(current)
      return briefOf(a, when)
    },
    finish(a, when) {
      stamp(when)
      endAssignment(a, when)
    },
  }

  // An assignment ends. What waits for it goes up.
  const endAssignment = (a, when) => {
    a.finished = true
    // A maker that ends while its latest try has a fault ended on that fault: a new maker would
    // get the inputs that failed, so the task waits for an evaluation.
    const last = isDo(a.role) && !a.task.closed && results.filter((r) => r.by === a).at(-1)
    const fault = last && underNow(last) && reviewsOf(last).filter(isFault).at(-1)
    if (fault && !exhaustions.some((x) => x.result === last)) {
      exhaustions.push(record('Exhaustion', { maker: a, result: last, fault, when, at: ++clock }))
    }
    // What waits for it goes up, so nothing waits for an assignment that cannot act: an open
    // question or Raise to it goes to the nearest open assignment above, else to the owner.
    const up = openAncestor(a) ?? a.task.owner
    for (const n of notes) if (n.kind === 'Question' && n.answer === undefined && n.answerBy === a) n.answerBy = up
    for (const r of reviews) {
      if (r.decision === 'Raise' && r.answerBy === a && !reviews.some((x) => x.settles === r)) r.answerBy = up
    }
  }

  // What the actor reads: the task text, the spirit of each direction, the standards that
  // apply here with their rules, the open blockers, the references, and three short blocks:
  // the answers to its questions, the person's comments, and the tasks that it needs. Each is
  // one line, cut short, with the record to read in full, so a small model gets a small brief.
  // `name` gives the id of a record (the CLI passes its own ids); with no id, an assignment
  // is named by its actor and role, and a note by its kind.
  const nameOf = (x) => x?.id ?? x?.label ??
    (x?.[kind] === 'Assignment' ? `${actorName(x.actor)} (${x.role.role})`
      : x?.[kind] === 'Note' ? x.kind.toLowerCase()
        : x?.[kind] ? x[kind].toLowerCase() : actorName(x?.actor ?? x))
  const briefOf = (a, when, name = nameOf) => {
    const latest = resultsOf(a.task).at(-1)
    const cut = (text, n) => (text.length > n ? `${text.slice(0, n - 3)}...` : text)
    const checker = a.role.tier === 'low' && !isDo(a.role)
    // A low maker reads the answers to its own questions, and to the questions that a lead (a
    // medium or high assignment) asked about its task, such as the person's answer to its lead.
    const askedAbove = (q) => q.from?.[kind] === 'Assignment' && q.from.role.tier !== 'low' && q.stops?.includes(a.task)
    const questions = notes.filter((q) => q.kind === 'Question' && q.answer !== undefined &&
      (a.role.tier === 'low' ? q.from === a || askedAbove(q) : q.stops?.includes(a.task)))
    return {
      versions: directionsOf(a.task).map((d) => `${d.name} v${(a.under?.find((v) => v.of === d) ?? current(d)).number}`),
      task: a.task.aiDescription.text,
      partOf: a.task.aiDescription.partOf,
      directions: directionsOf(a.task).map((d) => ({
        name: d.name,
        says: current(d).says,
        standards: applicable(current(d), a.task).map((s) => ({
          says: s.says,
          rules: (s.rules ?? []).map((r) => r.says),
        })),
      })),
      open: latest ? blockers(latest, when) : [],
      references: a.task.aiDescription.references,
      answers: checker ? [] : questions.slice(-3).reverse().flatMap((q) => [
        `${name(q)} asked by ${name(q.from) ?? 'someone'}: ${cut(q.text, 100)}`,
        `  answer (${name(q.answerBy)}): ${cut(q.answer, 200)}${q.answer.length > 200 ? ` (in full: work question show ${name(q)})` : ''}`,
      ]),
      notes: checker ? [] : notes.filter((n) => n.kind === 'Message' && n.about === a.task && isHuman(n.by?.actor))
        .slice(-2).reverse().map((n) => `${name(n)} ${name(n.by)}: "${cut(n.text, 160)}"`),
      needs: a.task.needs.map((n) => {
        const r = resultsOf(n).at(-1)
        return `${name(n)} ${n.name} · ${Task.state(n, when)}${r ? ` (${name(r)} ${r.output})` : ''}`
      }),
      // The latest evaluation of the task: what went wrong before, and what changed for it.
      evaluation: (() => {
        const e = evaluations.filter((x) => stopTask(x.answers) === a.task && evaluationCounts(x)).at(-1)
        return e ? [`${name(e)} (${e.level}, ${name(e.by)}) wrong: ${cut(e.wrong, 160)}`, `  why: ${cut(e.why, 160)}`,
          ...e.improve.map((x) => `  improve: ${cut(x, 160)}`)] : []
      })(),
    }
  }

  const Result = {
    // One attempt of an assignment. The tool gives its time; the assignment counts.
    report(task, { by, when, output, madeFrom = [], size, digest, patch }) {
      stamp(when)
      const name = label(by) === actorName(by.actor) ? `${actorName(by.actor)} (${by.role.role})` : label(by)
      if (by.task !== task) throw new Error(`${name} is assigned to ${by.task.name}, not to ${task.name}`)
      if (!actsOf(by, when).some((a) => a.act === 'Do')) throw new Error(`${name} has no Do act`)
      if (by.finished) throw new Error(`${name} is finished`)
      if (task.closed) throw new Error(`${task.name} is closed`)
      const stop = workStop(task, when)
      if (stop) throw new Error(stop)
      const state = Task.state(task, when)
      if (state === 'Returned') throw new Error(`${task.name} is returned until a change answers it`)
      if (state === 'Accepted') throw new Error(`${task.name} is accepted; a Reject or a change reopens it`)
      // A task takes its result only after each task that it needs is accepted.
      const need = task.needs.find((n) => !taskAccepted(n, when))
      if (need) throw new Error(`${idName(task)} needs ${idName(need)} (${need.name}), which is not accepted`)
      const limit = limitsOf(by.role).Result.size
      if (limit !== undefined && size > limit) {
        throw new Error(`the result has size ${size}; the limit is ${limit}: split the task`)
      }
      if (by.maxAttempts !== undefined && used(by) >= by.maxAttempts) {
        throw new Error(`${name} has used its ${by.maxAttempts} attempts`)
      }
      const result = record('Result', {
        task, by, output, madeFrom, size, digest, patch, under: [...by.under], when, at: ++clock,
      })
      results.push(result)
      return result
    },
  }

  // Who decides the results of a maker: the workflow's decide entry for the maker's role; with
  // none, any one role with an Approve act on it. The owner of the task decides only as such a role.
  const deciderOf = (result) => result.by.role.workflow?.decide.find((d) => d.resultsOf === result.by.role)?.by
  const sameRole = (leaf, act) => act.by.role === leaf
  const decidesResults = (by, result, when) => {
    const who = deciderOf(result)
    return who ? leavesOf(who).includes(by.role) : can(by, 'Approve', 'resultsOf', result.by.role, when)
  }
  // The accepts of deciders that count now: made after the latest Reject of the task (a
  // criticism of the task asks its deciders to look again), under versions that say the same to
  // the task as the current ones. A result is decided when they meet its deciders.
  const lastTaskReject = (task) => reviews.filter((r) => r.of === task && isReject(r)).at(-1)?.at ?? 0
  const decidingNow = (result) => reviewsOf(result).filter((a) => isAccept(a) && decides(a, result) &&
    a.at > lastTaskReject(result.task) &&
    directionsOf(result.task).every((d) => {
      const v = a.under.find((x) => x.of === d)
      return v && sameFor(v, current(d), result.task)
    }))
  const decisionMet = (result, accepts) => {
    const who = deciderOf(result)
    return who ? metAt(who, accepts, sameRole) !== undefined : accepts.length > 0
  }
  // Whether the decision of a result waits for the accept of `by` at a time (with no decide
  // entry, for any role that decides it).
  const decidesNow = (by, result, when) => {
    const who = deciderOf(result)
    return who ? nextLeaves(who, decidingNow(result), sameRole).includes(by.role) : decidesResults(by, result, when)
  }
  // The roles whose accept the decision of a result waits for now (with a decide entry).
  const decisionWaitsOn = (result) => {
    const who = deciderOf(result)
    return who ? nextLeaves(who, decidingNow(result), sameRole) : []
  }
  const decisionWaitsFor = (result, accepts) => {
    const who = deciderOf(result)
    return who ? waitsFor(who, accepts, sameRole) : 'a role that decides it'
  }
  const coversMaker = (by, result, when) =>
    can(by, 'Review', 'resultsOf', result.by.role, when) || can(by, 'Approve', 'resultsOf', result.by.role, when)
  // A recorded review counts with the acts that its reviewer had at its own time.
  const rightChecker = (rule, review, result) => {
    if (rule.checkedBy) return review.by.role === rule.checkedBy && coversMaker(review.by, result, review.when)
    return decidesResults(review.by, result, review.when)
  }

  const Review = {
    // The target is a result, a task, a draft, or an evaluation. Raise: the review is
    // finished, but the reviewer cannot decide. A Reject can name the rule that the result
    // breaks. Anyone raises. An Accept or a Reject of work comes from a role that covers the
    // maker, a role that decides, or the owner.
    decide(target, by, when, decision, evidence = [], reason, { breaks, settles, answerBy, redo } = {}) {
      stamp(when)
      by = asBy(by)
      if (decision !== 'Accept' && !reason?.trim()) throw new Error(`a ${decision} needs a reason`)
      if (target?.[kind] === 'Revision') return decideDraft(target, by, when, decision, evidence, reason)
      if (target?.[kind] === 'Evaluation') return decideEvaluation(target, by, when, decision, evidence, reason)
      if (target?.[kind] !== 'Result' && target?.[kind] !== 'Task') {
        throw new Error('a review is of a result, a task, a draft, or an evaluation; a rule, a standard, or a direction gets a Suggestion')
      }
      const task = target[kind] === 'Task' ? target : target.task
      if (redo && task.closed) throw new Error(`${task.id ?? task.name} is closed; it takes no new result, so a recheck cannot be answered`)
      // A point names a rule that the reviewed work is checked by. A Reject of a task asks
      // for a split or a direction change, so it names no rule.
      if (breaks && target[kind] === 'Task') {
        throw new Error(`a Reject of a task names no rule; reject a result for ${breaks.id ?? breaks.says}, or give the point with no rule`)
      }
      if (breaks && !rulesOf(task).includes(breaks)) {
        let top = task
        while (top.serves) top = top.serves
        const holder = tasks.find((t) => !t.closed && t !== task && within(t, top) && rulesOf(t).includes(breaks))
        throw new Error(`${task.id ?? task.name} is not checked by ${breaks.id ?? breaks.says}` +
          (holder ? `; it is a rule of ${holder.id ?? holder.name}: reject the result of ${holder.id ?? holder.name}` : ''))
      }
      if (decision !== 'Raise' && !mayDecide(by, target, task, when)) {
        throw new Error(`${label(by) === actorName(by.actor) ? `${label(by)} (${by.role?.role ?? 'no role'})` : label(by)} may not review this`)
      }
      // The deciders in an Order decide one after the other. The person may read a result at
      // any time, and criticises it only after its deciders accepted it. A settle decides only
      // a Raise, so it is not such an act.
      if (target[kind] === 'Result' && decision !== 'Raise' && !settles) {
        const who = deciderOf(target)
        const now = decidingNow(target)
        // A decider that also checks a rule of the task may check it before its turn: an accept with
        // that evidence, or a Reject that breaks that rule. It is kept, and the role decides again
        // at its turn (metAt counts only accepts in order). A Reject for any other reason is a
        // decision, so it waits for the turn.
        const ownChecks = () => rulesOf(task).filter((r) => r.checkedBy === by.role)
        const asChecker = () => ownChecks().length > 0 && (decision === 'Accept' || ownChecks().includes(breaks))
        if (who && decidesResults(by, target, when) && !turnOf(who, { by, when }, now, sameRole) && !asChecker()) {
          throw new Error(`${by.role.role} decides this result after the accept of ${waitsFor(who, now, sameRole)}`)
        }
        if (isCriticism({ by, of: target, when })) {
          if (decision === 'Accept') {
            throw new Error(`${actorName(by.actor)} approves directions and standards; the accept of ${decisionWaitsFor(target, [])} decides a result`)
          }
          if (!decisionMet(target, now)) {
            throw new Error(`this result waits for the accept of ${decisionWaitsFor(target, now)}; criticise it after its deciders accept it`)
          }
        }
      }
      // Nobody settles their own Raise. A Raise to a person is settled only by that person;
      // a Raise to an assignment by that assignment, or by a decider.
      if (settles) {
        if (settles.decision !== 'Raise') throw new Error('a settle decides a Raise; this review is not a Raise')
        const toPerson = settles.answerBy?.[kind] !== 'Assignment'
        const allowed = !sameActor(by, settles.by) && (isAnswerer(by, settles.answerBy) ||
          (!toPerson && target[kind] === 'Result' && decidesResults(by, target, when)))
        if (settles.of !== target || !allowed) {
          throw new Error(`${label(by)} may not settle "${settles.reason}"`)
        }
      }
      const review = record('Review', {
        of: target,
        by,
        decision,
        reason,
        evidence,
        breaks,
        settles,
        redo,
        answerBy: decision === 'Raise' ? (answerBy ?? openAncestor(by) ?? task.owner) : undefined,
        under: [...by.under],
        when,
        at: ++clock,
      })
      reviews.push(review)
      // A fault that uses the last try of a maker stops the task until it is evaluated (Nanda,
      // 2026-11-08): a new maker with the same brief would make the same mistake.
      // Also when a new maker was given before this review: it has the inputs that failed.
      const maker = target[kind] === 'Result' ? target.by : undefined
      const fault = maker && isFault(review) && underNow(target)
      if (fault && maker.maxAttempts !== undefined && used(maker) >= maker.maxAttempts &&
        !exhaustions.some((x) => x.maker === maker && x.result === target)) {
        exhaustions.push(record('Exhaustion', { maker, result: target, fault: review, when, at: review.at }))
      }
      return review
    },
  }

  const mayDecide = (by, target, task, when) => {
    if (sameName(by.actor, task.owner) || mayChange(by, task, when)) return true
    if (target[kind] === 'Result') {
      return coversMaker(by, target, when) || decidesResults(by, target, when)
    }
    const makers = assignments.filter((a) => a.task === task && isDo(a.role)).map((a) => a.role)
    return makers.some((role) => can(by, 'Review', 'resultsOf', role, when) || can(by, 'Approve', 'resultsOf', role, when))
  }

  // The owner of the task reviews an evaluation that waits for the person: one Accept or one
  // Reject. Its Accept says where the owner read. Nobody raises an evaluation.
  const decideEvaluation = (e, by, when, decision, evidence, reason) => {
    const task = stopTask(e.answers)
    if (decision === 'Raise') throw new Error('nobody raises an evaluation: the owner of its task is already its reviewer')
    if (decision !== 'Accept' && decision !== 'Reject') throw new Error('an evaluation takes an Accept or a Reject')
    if (!isHuman(by.actor)) throw new Error('the person evaluates a change of a direction or a principle')
    if (!sameName(by.actor, task.owner)) throw new Error(`${actorName(by.actor)} is not the owner of ${idName(task)}; ${actorName(task.owner)} accepts its evaluations`)
    if (countsWhenWritten(e)) throw new Error(`an evaluation at the level ${e.level} counts when it is written`)
    const decided = evaluationDecision(e)
    if (decided) throw new Error(`the evaluation is already ${decided.decision === 'Accept' ? 'accepted' : 'rejected'}`)
    if (decision === 'Accept' && !hasEvidence({ evidence })) {
      throw new Error('an accept of an evaluation says where the owner read, such as the results and the Rejects that it names: give evidence')
    }
    const review = record('Review', { of: e, by, decision, reason, evidence, under: [...(by.under ?? [])], when, at: ++clock })
    reviews.push(review)
    return review
  }

  // A lesson stays official while the current version still holds its text.
  const lessonStatus = (note) => {
    const now = current(note.rule.of)
    if (now === note.rule) return 'Official'
    const texts = [
      now.says,
      ...now.standards.map((s) => s.says),
      ...now.standards.flatMap((s) => (s.rules ?? []).map((r) => r.says)),
    ]
    return texts.includes(note.text) ? 'Official' : 'Replaced'
  }

  const Note = {
    add(note, when) {
      stamp(when)
      if (note.kind === 'Question' && !note.answerBy) throw new Error('a question needs answerBy')
      if (note.kind === 'Question' && note.answerBy?.[kind] === 'Assignment' && note.answerBy.finished) {
        throw new Error(`${label(note.answerBy)} is finished, so it answers no question; ask an open assignment`)
      }
      if (note.notChecked) {
        const result = note.about
        if (!note.by || !note.reason?.trim() || !note.until) {
          throw new Error('a Finding that waives checks needs by, a reason, and an until')
        }
        // A waiver is a decider's accept with less evidence; the person accepts no result.
        if (isCriticism({ by: note.by, of: result, when })) {
          throw new Error(`${actorName(note.by.actor)} accepts no result, so gives no waiver; a role that decides the results waives a check`)
        }
        if (sameActor(note.by, result.by) || !decidesResults(note.by, result, when)) {
          throw new Error('a waiver comes from a role that decides the results, never from the maker')
        }
        if (!atOrBefore(when, note.until)) throw new Error(`a waiver until ${note.until} ends before it starts, at ${when}`)
        const hours = limitsOf(note.by.role).Note.waiverHours
        if (hours !== undefined && Date.parse(note.until) - Date.parse(when) > hours * 3600000) {
          throw new Error(`a waiver lasts at most ${hours} hours for a ${note.by.role.tier ?? note.by.role.role} role`)
        }
      }
      const saved = record('Note', { ...note, when })
      notes.push(saved)
      return saved
    },
    answer(question, answer, by, when) {
      stamp(when)
      by = asBy(by)
      if (!isAnswerer(by, question.answerBy)) {
        const who = question.answerBy?.[kind] === 'Assignment' ? label(question.answerBy) : actorName(question.answerBy)
        throw new Error(`${who} answers this question, not ${label(by)}`)
      }
      question.answer = answer
    },
    // Official lessons and seen notes; { all: true } also returns replaced lessons.
    find(topic, { all = false } = {}) {
      const words = topic.toLowerCase()
      return notes
        .filter((n) => n.text.toLowerCase().includes(words))
        .map((note) => ({ note, status: note.rule ? lessonStatus(note) : 'Seen' }))
        .filter((found) => all || found.status !== 'Replaced')
    },
  }

  const reviewsOf = (target) => reviews.filter((r) => r.of === target)
  // A settle decides a Raise; it never counts as an accept of the work.
  const isAccept = (r) => r.decision === 'Accept' && !r.settles
  // A question or a Raise goes to the nearest open assignment above; else to the owner.
  const openAncestor = (a) => {
    for (let x = a?.parent; x; x = x.parent) if (!x.finished) return x
    return undefined
  }
  const isReject = (r) => r.decision === 'Reject'
  // An official draft, a split, or a remake answers a Reject. A Reject that names a rule is also
  // answered by a later, changed result of its task with evidence for that rule; a redo
  // Reject (a recheck) by any later result of its task.
  const answered = (reject) => {
    if (changes.some((c) => c.answers.includes(reject)) || answeredByVersion(reject)) return true
    const task = reject.of.task ?? reject.of
    const later = results.filter((r) => r.task === task && r.at > reject.at)
    if (reject.redo) return later.length > 0
    // The same work again: the same change (patch, for a commit), else the same digest.
    const same = (x, y) => (x.patch && y.patch ? x.patch === y.patch : Boolean(x.digest) && x.digest === y.digest)
    const changed = (r) => !(reject.of[kind] === 'Result' && same(r, reject.of))
    return (
      reject.breaks !== undefined &&
      later.some(
        (r) => changed(r) && evidenceFor(reject.breaks, r, reviewsOf(r).filter(isAccept)).length > 0,
      )
    )
  }
  const openQuestions = (target) =>
    notes.filter((n) => n.kind === 'Question' && n.answer === undefined && n.stops.includes(target))
  const idName = (task) => task.id ?? task.name
  // An open task outside the tree of a task that needs the task or one of its open parts.
  const neederOf = (task) => tasks.find((t) => !t.closed && !within(t, task) &&
    t.needs.some((n) => !n.closed && within(n, task)))
  // The Rejects that a split or a remake answers. A split answers a Reject of its own task or of
  // its results; a remake, one anywhere in the tree that it replaces. Only a point with no rule,
  // and the person's Reject only by that person's own act. An agent does not act past the
  // person's open point with no rule: the person decides whether the act answers it.
  const answersOf = (task, by, review, act) => {
    const list = review ? [review].flat() : []
    const about = (r) => (act === 'split' ? r.of === task || r.of.task === task : within(r.of.task ?? r.of, task))
    for (const r of list) {
      if (isHuman(r.by?.actor) && !sameName(by.actor, r.by.actor)) {
        throw new Error(`"${r.reason}" is the person's Reject; only that person's own ${act} answers it, or a direction change`)
      }
      if (!about(r)) throw new Error(`"${r.reason}" is not about ${idName(task)}; a ${act} answers only a Reject of its own task`)
      const of = r.of.task ?? r.of
      if (isPersonStop(r) && !stopAnswered(r)) throw new Error(`"${r.reason}" waits for an evaluation of ${idName(of)} first: what is wrong, why, and what to improve`)
      if (r.breaks) throw new Error(`"${r.reason}" names the rule ${r.breaks.id ?? r.breaks.says}; changed work with evidence answers it, not a ${act}`)
    }
    const point = !isHuman(by.actor) && personRejects(task).find((r) => !r.breaks && !r.redo && !list.includes(r))
    if (point) throw new Error(`"${point.reason}" is the person's open point on ${idName(task)}; only that person's own ${act} answers it`)
    return list
  }
  // Evaluation (Nanda, 2026-11-08): a mistake is evaluated, not decided. Two stops make a task
  // wait: an Exhaustion (the last try of a maker ended on a fault), and the person's Reject of
  // the task or of one of its results. Each stop gets its own evaluation, which names it.
  const LEVELS = ['task', 'standard', 'direction', 'principle']
  const isPersonStop = (r) => isReject(r) && !r.redo && !r.settles &&
    (r.of[kind] === 'Task' ? isHuman(r.by?.actor) : r.of[kind] === 'Result' && isCriticism(r))
  // The task of a stop: the task of the maker, or the task of the rejected work.
  const stopTask = (stop) => (stop[kind] === 'Exhaustion' ? stop.maker.task : stop.of[kind] === 'Task' ? stop.of : stop.of.task)
  // The points of one Reject (the CLI sets points) are one act, so they are one stop: its first point.
  const stopOf = (x) => x.points?.[0] ?? x
  const stopsOf = (task) => [...exhaustions.filter((x) => x.maker.task === task),
    ...reviews.filter((r) => (r.of === task || r.of.task === task) && isPersonStop(r) && stopOf(r) === r)].sort((x, y) => x.at - y.at)
  // The review of the owner that decides an evaluation, if any.
  const evaluationDecision = (e) => reviewsOf(e).find((r) => r.decision === 'Accept' || r.decision === 'Reject')
  // At the level of a task or a standard an evaluation counts when it is written; at the level of
  // a direction or a principle, after the owner accepts it. The person's own evaluation counts
  // when it is written.
  const countsWhenWritten = (e) => isHuman(e.by.actor) || (!e.needsPerson && (e.level === 'task' || e.level === 'standard'))
  const evaluationCounts = (e) => countsWhenWritten(e) || evaluationDecision(e)?.decision === 'Accept'
  const stopAnswered = (stop) => evaluations.some((e) => e.answers === stopOf(stop) && evaluationCounts(e))
  // The first stop of a task that no counted evaluation answers, or undefined.
  const evaluationWaits = (task) => stopsOf(task).find((x) => !stopAnswered(x))
  // After a maker's last try, the next try works only on inputs that differ from the ones that
  // failed: a direction version that says something new to the task, or a newer accepted result
  // of a task that it needs. (A remake makes a new task; a split gives the task new needs.)
  const sameInputs = (x, when) => {
    const task = x.maker.task
    const sameVersions = directionsOf(task).every((d) => {
      const v = x.result.under.find((u) => u.of === d)
      return v && sameFor(v, current(d), task)
    })
    const needChanged = task.needs.some((n) => {
      const usedThen = resultsOf(n).filter((r) => r.at < x.result.at).at(-1)
      const now = resultsOf(n).filter((r) => accepted(r, when)).at(-1)
      return now && (!usedThen || !sameWork(now, usedThen))
    })
    return sameVersions && !needChanged
  }
  // Two results are the same work: the same change (patch, for a commit), else the same digest.
  const sameWork = (x, y) => (x.patch && y.patch ? x.patch === y.patch : Boolean(x.digest) && x.digest === y.digest)
  const stopText = (x) => (x[kind] === 'Exhaustion' ? `the last try of ${label(x.maker)}, which ended on a fault` : `the person's Reject "${x.reason}"`)
  // Why no maker works on the task at a time, or undefined.
  const workStop = (task, when) => {
    const waits = evaluationWaits(task)
    if (waits) {
      return `${idName(task)} waits for an evaluation of ${stopText(waits)}: what is wrong, why, and what to improve; ` +
        'the high role of its tree writes it, or the person'
    }
    const last = exhaustions.filter((x) => x.maker.task === task).at(-1)
    if (last && sameInputs(last, when)) {
      return `${idName(task)} has the inputs that failed in the last try of ${label(last.maker)}; its evaluation asks for a change first: ` +
        'a direction version that says something new to it, a newer accepted result of a task that it needs, or a remake or a split'
    }
    return undefined
  }

  const Evaluation = {
    // The high role of the task's tree, or the person, says what is wrong, why the task cannot be
    // done as asked, and what to improve, at the level of the deepest cause. It answers one stop.
    write(stop, { by, when, wrong, why, improve = [], level }) {
      stamp(when)
      by = asBy(by)
      const isStop = stop?.[kind] === 'Exhaustion' || (stop?.[kind] === 'Review' && isPersonStop(stop))
      if (!isStop) throw new Error('an evaluation answers a stop: the last try of a maker that ended on a fault, or a Reject of the person')
      stop = stopOf(stop)
      const task = stopTask(stop)
      if (task.closed) throw new Error(`${idName(task)} is closed`)
      const human = isHuman(by.actor)
      if (human && !sameName(by.actor, task.owner)) {
        throw new Error(`${actorName(by.actor)} is not the owner of ${idName(task)}; ${actorName(task.owner)} evaluates its mistakes`)
      }
      if (!human) {
        if (by.finished) throw new Error(`${label(by)} is finished`)
        if (by.role.tier !== 'high') throw new Error(`${label(by)} is ${by.role.tier}; a high role evaluates a mistake, or the person`)
        if (!within(task, by.task)) throw new Error(`${idName(task)} is outside the task tree of ${label(by)}`)
      }
      if (stopAnswered(stop)) throw new Error(`${stopText(stop)} already has an evaluation that counts`)
      // An agent does not pass the person's look: while an evaluation of this stop waits for the
      // owner, a new one waits too; after the owner rejected an evaluation of the task, the next
      // one also needs the owner's accept.
      const pending = !human && evaluations.find((e) => e.answers === stop && !evaluationDecision(e) && !evaluationCounts(e))
      if (pending) throw new Error(`an evaluation of ${idName(task)} at the level ${pending.level} waits for ${actorName(task.owner)}'s accept; a new one comes after that answer`)
      const needsPerson = !human && evaluations.some((e) => stopTask(e.answers) === task && e.at > stop.at &&
        evaluationDecision(e)?.decision === 'Reject')
      if (!wrong?.trim() || !why?.trim()) throw new Error('an evaluation says what is wrong and why the task cannot be done as asked')
      if (improve.length === 0 || improve.some((x) => !x?.trim())) throw new Error('an evaluation says what to improve, so that the task can continue')
      if (!LEVELS.includes(level)) throw new Error(`the level of the deepest cause is one of: ${LEVELS.join(', ')}`)
      const e = record('Evaluation', { answers: stop, by, wrong, why, improve, level, needsPerson, when, at: ++clock })
      evaluations.push(e)
      return e
    },
  }

  // The person's open Rejects of a task or its results; with tree, anywhere under the task.
  const personRejects = (task, { tree = false } = {}) => reviews.filter((r) => isReject(r) && isHuman(r.by?.actor) &&
    !answered(r) && (tree ? within(r.of.task ?? r.of, task) : r.of === task || r.of.task === task))

  // Rejects of the task, or of earlier attempts, saved before this result.
  const rejectsBefore = (result) =>
    reviews.filter(
      (r) =>
        isReject(r) &&
        r.at < result.at &&
        (r.of === result.task || (r.of.task === result.task && r.of !== result)),
    )

  // A result is old for a direction only when the standards that apply to its task changed
  // since it was made: each rule of a new or replaced standard needs evidence again, from an
  // accept made while that standard was in force, by its own checker. Any change also needs the
  // decider's accept under the new version (the decider item of blockerItems).
  const recheck = (result, d, when) => {
    const now = current(d)
    const then = result.under.find((v) => v.of === d)
    if (!then || result.under.includes(now)) return []
    const accepts = reviewsOf(result).filter(isAccept)
    const before = applicable(then, result.task)
    const fresh = applicable(now, result.task).filter((s) => !before.some((t) => sameStandard(s, t)))
    const inForce = (s) => accepts.filter((a) => a.under.some((v) => v.of === d && v.standards.some((t) => sameStandard(t, s))))
    return fresh.flatMap((s) => (s.rules ?? []).filter((rule) =>
      evidenceFor(rule, result, inForce(s)).length === 0 && !waived(rule, result, accepts, when)))
  }
  const followed = (result, d, when) => recheck(result, d, when).length === 0
  // Two versions say the same to a task when the spirit and the standards that apply to it
  // are the same.
  const sameFor = (v, now, task) => {
    const [a, b] = [applicable(v, task), applicable(now, task)]
    return v === now || (v.says === now.says && a.length === b.length && a.every((s) => b.some((t) => sameStandard(s, t))))
  }

  // A result of another task that has a newer attempt is old.
  const isOld = (usedResult) => resultsOf(usedResult.task).at(-1) !== usedResult

  // Evidence counts when it says where it looked, comes from the right checker, and belongs
  // to the result that its review is of.
  const evidenceFor = (rule, result, accepts) =>
    accepts
      .filter((a) => rightChecker(rule, a, result))
      .flatMap((a) => a.evidence)
      .filter((e) => e.meets === rule && e.at)

  // Urgent work can pass with less evidence: a role that decides the results accepted it,
  // and a waiver Finding from such a role says that nobody checked this rule, until a time.
  // A read at a time sees the waivers that cover that time.
  const waivers = (result, when) =>
    notes.filter((n) => n.kind === 'Finding' && n.about === result && n.notChecked &&
      atOrBefore(n.when, when) && atOrBefore(when, n.until))
  const waived = (rule, result, accepts, when) =>
    accepts.some((a) => decides(a, result)) && waivers(result, when).some((n) => n.notChecked.includes(rule))
  // A decider's accept is a Review like any other: it says where it read the result, and what
  // it saw there (with or without a rule). An accept with only a reason decides nothing. It
  // counts with the acts that the decider had at the time of the accept.
  const decides = (accept, result) => decidesResults(accept.by, result, accept.when) && hasEvidence(accept)

  // A Raise waits until its answerer, or a role that decides the results, settles it.
  const openRaises = (result) =>
    reviewsOf(result).filter((raise) => raise.decision === 'Raise' && !reviews.some((r) => r.settles === raise))

  // What still stops a result at a time, as items: the text, its kind, and the record it is
  // about. A result is accepted when nothing does. The CLI prints the ids of these records; the
  // page prints only the text.
  const blockerItems = (result, when) => {
    const reviews = reviewsOf(result)
    const accepts = reviews.filter(isAccept)
    const rules = rulesOf(result.task)
    const unanswered = rejectsBefore(result).filter((r) => !answered(r))
    const missing = (rule) => {
      const found = evidenceFor(rule, result, accepts)
      if (found.length === 0 && waived(rule, result, accepts, when)) return []
      const rejects = unanswered.filter((r) => r.breaks === rule)
      if (found.length === 0) return [{ kind: 'evidence', text: `no evidence for "${rule.says}"`, ref: rule, rejects }]
      if (found.every((e) => (e.uses ?? []).some(isOld))) {
        return [{ kind: 'old-evidence', text: `the evidence for "${rule.says}" uses an old result`, ref: rule }]
      }
      return []
    }
    return [
      ...directionsOf(result.task)
        .filter((d) => !followed(result, d, when))
        .map((d) => ({ kind: 'old-version', text: `made under an old version of ${d.name}`, ref: d, rules: recheck(result, d, when) })),
      ...rules.flatMap(missing),
      // Every result needs the accept of its deciders, under a version of each direction that
      // says the same to the task as the current one; a decider may Reject instead.
      ...(decisionMet(result, decidingNow(result))
        ? []
        : decisionMet(result, accepts.filter((a) => decides(a, result)))
          ? [{ kind: 'decider', old: true, text: 'accepted by its decider under an old version; the decider accepts it again' }]
          : [{ kind: 'decider', text: `no accept yet by ${decisionWaitsFor(result, decidingNow(result))}`,
            waits: deciderOf(result) && waitsFor(deciderOf(result), decidingNow(result), sameRole) }]),
      // A result uses the work of each task that its task needs, as that work was when the
      // result was made. A later result of a need, with other work, makes the result old.
      ...result.task.needs.flatMap((n) => {
        const latest = resultsOf(n).at(-1)
        const used = resultsOf(n).filter((r) => r.at < result.at).at(-1)
        const same = used && latest?.digest !== undefined && latest.digest === used.digest
        return !latest || latest === used || same
          ? [] : [{ kind: 'old-need', text: `made before the latest result of ${n.name}`, ref: n, newer: latest }]
      }),
      // The maker's own Raise asks for help; it is not a review.
      ...reviews
        .filter((r) => r.decision !== 'Raise' && sameActor(r.by, result.by))
        .map((r) => ({ kind: 'maker', text: 'reviewed by its maker', ref: r })),
      // The person's criticism that a direction version answered is checked, not made again (Nanda,
      // 2026-10-29): the checks of the new version decide this result, and only a fault remakes it.
      ...reviews.filter((r) => isReject(r) && !(isPersonStop(r) && answeredByVersion(r))).map((r) => (r.redo
        ? { kind: 'redo', text: `check again: "${r.reason}"`, ref: r }
        : { kind: 'reject', text: `rejected: ${r.reason}`, ref: r })),
      // A Reject that names a rule of the task waits for evidence of that rule (shown above),
      // on changed work: evidence on the same work that was rejected does not answer it.
      ...unanswered
        .filter((r) => r.breaks && rules.includes(r.breaks) && evidenceFor(r.breaks, result, accepts).length > 0)
        .map((r) => ({ kind: 'unchanged', text: `the same work was rejected: "${r.reason}"`, ref: r })),
      ...unanswered
        .filter((r) => r.redo)
        .map((r) => ({ kind: 'redo', text: `check again: "${r.reason}"`, ref: r })),
      ...unanswered
        .filter((r) => !r.redo && !(r.breaks && rules.includes(r.breaks)))
        .map((r) => ({ kind: 'change', text: `no instruction change answers "${r.reason}"`, ref: r })),
      ...openRaises(result).map((r) => ({ kind: 'raise', text: `raised: ${r.reason}`, ref: r })),
      ...openQuestions(result).map((q) => ({ kind: 'question', text: `waits for an answer: ${q.text}`, ref: q })),
    ]
  }
  const blockers = (result, when) => blockerItems(result, when).map((item) => item.text)

  const accepted = (result, when) => blockers(result, when).length === 0

  // The latest result is the work as it is now; an older accepted result does not count.
  // A result that passed with a waiver leaves its task open until later evidence comes.
  const taskAccepted = (task, when) => {
    const latest = resultsOf(task).at(-1)
    return (
      openQuestions(task).length === 0 &&
      !evaluationWaits(task) &&
      !reviews.some((r) => r.of === task && isReject(r) && !answered(r)) &&
      latest !== undefined &&
      accepted(latest, when) &&
      waivers(latest, when).length === 0 &&
      task.needs.every((n) => taskAccepted(n, when))
    )
  }

  const Checkpoint = {
    save(task, { seenOutside = [], next, when }) {
      stamp(when)
      const own = [task, ...resultsOf(task)]
      const latest = resultsOf(task).at(-1)
      const decided = (a) => latest && reviewsOf(latest).some((r) => r.by === a)
      return record('Checkpoint', {
        task,
        open: {
          blockers: latest ? blockers(latest, when) : [],
          rejects: reviews.filter((r) => isReject(r) && own.includes(r.of) && !answered(r)),
          raises: latest ? openRaises(latest) : [],
          unfinishedReviews: assignments.filter(
            (a) => a.task === task && actsOf(a, when).some((x) => x.act === 'Review') && !decided(a),
          ),
          pendingApprovals: latest
            ? assignments.filter((a) => a.task === task && decidesResults(a, latest, when) && !decided(a))
            : [],
          questions: own.flatMap(openQuestions),
        },
        parts: tasks
          .filter((t) => t.serves === task && !t.closed)
          .map((t) => Checkpoint.save(t, { seenOutside, next, when })),
        seenOutside,
        next,
        when,
      })
    },
    // The engine compares the revisions that each system gives, and lists the results to
    // check again: accepted ones, and the latest one, made from a source that changed.
    resume(checkpoint, by, when, outsideNow) {
      stamp(when)
      const changedOutside = outsideNow.filter(
        (now) =>
          !checkpoint.seenOutside.some((seen) => seen.source === now.source && seen.revision === now.revision),
      )
      const latest = resultsOf(checkpoint.task).at(-1)
      return {
        changedOutside,
        recheck: resultsOf(checkpoint.task).filter(
          (r) =>
            (accepted(r, when) || r === latest) &&
            r.madeFrom.some((m) => changedOutside.some((c) => c.source === m.source)),
        ),
      }
    },
  }

  return {
    Workflow,
    Executive,
    Suggestion,
    Direction,
    Task,
    Assignment,
    Result,
    Review,
    Checkpoint,
    Note,
    Evaluation,
    Or,
    And,
    Order,
    accepted,
    blockers,
    blockerItems,
    taskAccepted,
    // A read-only window for the CLI: it prints ids and briefs from these.
    read: {
      tasks, results, reviews, notes, assignments, suggestions, drafts, changes, executives,
      current, rulesOf, applicable, resultsOf, reviewsOf, checksOf, openQuestions, openRaises,
      answered, used, actsOf, decidesResults, decidesNow, decisionWaitsOn, coversMaker, mayChange, within, isDo, openDo,
      directionsOf, openAncestor, isAccept, directions, personRejects, neederOf, briefOf,
      madeBy, vetoOf, draftWaitsFor, draftAccepts, decidersOfDraft, sameWords, sameRule,
      evaluations, exhaustions, evaluationCounts, evaluationDecision, countsWhenWritten, evaluationWaits, stopsOf,
      stopAnswered, stopTask, workStop, covers,
    },
  }
}
