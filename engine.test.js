import { describe, expect, test } from 'bun:test'
import { And, Or, Order, createWork } from './engine.js'

// Each test states one property of the model (as Part 2 claims it), then tries to break
// it: the plain case, a counterexample that must be refused, and the boundary values.

const nanda = { name: 'Nanda' }
// A model run outside any task (the skill that reads an app): it drafts version 1 of a direction.
const assess = { name: 'assess', run: 'assess-1' }

// Every act takes its time. now() gives increasing times, one second apart; wait() moves on.
const HOUR = 3600 * 1000
let ticks = 0
const now = () => new Date(Date.UTC(2026, 10, 8, 0, 0, ++ticks)).toISOString()
const wait = (ms) => { ticks += ms / 1000 }
const after = (when, ms) => new Date(Date.parse(when) + ms).toISOString()

// A small world: one direction (one standard, one rule), one task, six roles.
const world = ({ rule: ruleFields = {}, context, limits } = {}) => {
  const w = createWork()
  const maker = { role: 'maker', playedBy: 'Terra', acts: [{ act: 'Do', work: 'make it' }] }
  const checker = { role: 'checker', playedBy: 'Luna', acts: [{ act: 'Review', resultsOf: [maker] }] }
  const peer = { role: 'peer', playedBy: 'Terra', acts: [{ act: 'Review', resultsOf: [maker] }] }
  const approver = { role: 'approver', playedBy: 'Sol', acts: [{ act: 'Approve', resultsOf: [maker] }] }
  const owner = { role: 'owner', playedBy: nanda, acts: [{ act: 'Approve', resultsOf: [maker] }] }
  const outsider = { role: 'outsider', playedBy: 'Vega', acts: [{ act: 'Review', resultsOf: [] }] }
  const roles = [maker, checker, peer, approver, owner, outsider]
  w.Workflow.define({ system: 'Runtime', roles, limits, when: now() })
  const rule = { says: 'It works', ...ruleFields }
  const standard = { says: 'It is done well', rules: [rule] }
  const direction = w.Direction.start({
    name: 'Craft', says: 'Do it well', owner: nanda, standards: [standard], by: assess, when: now(),
  })
  const task = w.Task.start({
    id: 't', name: 'Task', owner: nanda, when: now(),
    aiDescription: { text: 'Do it', directions: [direction], context },
  })
  // The person's role is played by the person; a model's role by a new run of its model.
  const as = (role, extra = {}) => w.Assignment.give({
    role, task, ...(role === owner ? { actor: nanda } : {}), ...extra, when: now(),
  })
  return { w, maker, checker, peer, approver, owner, outsider, rule, standard, direction, task, as }
}

const proof = (rule) => [{ says: 'seen', meets: rule, at: 'run 1' }]
// The evidence of an accept of a draft: where it read, and what it saw.
const seen = [{ says: 'it reads well', at: 'the draft' }]
// A run of a model that is not in any role, such as one that only suggests.
const suggester = { name: 'Suggester', run: 'suggester-1' }
const add = (w, direction, says, rules = []) =>
  w.Direction.revise(direction, { add: [{ says, rules }], by: suggester, when: now() })

describe('Actors and workflow', () => {
  test('every act needs its time, and a time before the last act is refused', () => {
    const w = createWork()
    const maker = { role: 'maker', playedBy: 'Terra', acts: [{ act: 'Do', work: 'x' }] }
    w.Workflow.define({ system: 'Docs', roles: [maker], when: '2026-11-08T10:00:00Z' })
    const input = { id: 't', name: 'T', owner: nanda }
    expect(() => w.Task.start({ ...input })).toThrow('needs its time')
    expect(() => w.Task.start({ ...input, when: 'soon' })).toThrow('needs its time')
    expect(() => w.Task.start({ ...input, when: '2026-11-08T09:59:59Z' }))
      .toThrow('comes before the last act, at 2026-11-08T10:00:00Z')
    expect(() => w.Task.start({ ...input, when: '2026-11-08T10:00:00Z' })).not.toThrow()
  })

  test('a person\'s role needs that person: no actor, a run of a model, or another person is refused', () => {
    const { w, task, owner, maker } = world()
    const give = (role, actor) => w.Assignment.give({ role, task, actor, when: now() })
    expect(() => give(owner)).toThrow("is Nanda's")
    expect(() => give(owner, { name: 'Sol', run: 'sol-9' })).toThrow("is Nanda's")
    expect(() => give(owner, { name: 'Kai' })).toThrow("is Nanda's")
    expect(() => give(owner, nanda)).not.toThrow()
    // A model's role needs a run of that model, and never a person.
    expect(() => give(maker, nanda)).toThrow('is played by Terra')
    expect(() => give(maker, { name: 'Sol', run: 'sol-9' })).toThrow('is played by Terra')
  })

  test('two runs of one model are two actors, so they can review each other', () => {
    const { w, task, maker, peer, rule, as } = world()
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    w.Review.decide(r, as(peer), now(), 'Accept', proof(rule))
    expect(w.blockers(r, now())).not.toContain('reviewed by its maker')
  })

  test('one run is one actor: it does not review its own result', () => {
    const { w, task, maker, peer, rule, as } = world()
    const terra = as(maker)
    const r = w.Result.report(task, { by: terra, when: now(), output: 'x' })
    w.Review.decide(r, as(peer, { actor: terra.actor }), now(), 'Accept', proof(rule))
    expect(w.blockers(r, now())).toContain('reviewed by its maker')
  })

  test('a role belongs to one workflow', () => {
    const { w, maker } = world()
    expect(() => w.Workflow.define({ system: 'Docs', roles: [maker], when: now() }))
      .toThrow('already in')
  })

  test('only a role with a Do act reports, and only on the task of its assignment', () => {
    const { w, task, maker, checker, as } = world()
    expect(() => w.Result.report(task, { by: as(checker), when: now(), output: 'x' }))
      .toThrow('has no Do act')
    const other = w.Task.start({ id: 'o', name: 'Other', owner: nanda, when: now() })
    const terra = as(maker)
    expect(() => w.Result.report(other, { by: terra, when: now(), output: 'x' }))
      .toThrow('is assigned to Task')
  })

  test('one open Do assignment on a task at a time', () => {
    const { w, task, maker, as } = world()
    const first = as(maker, { maxAttempts: 1 })
    expect(() => as(maker)).toThrow('already has an open Do assignment')
    w.Result.report(task, { by: first, when: now(), output: 'x' })      // its one attempt is used
    expect(() => as(maker)).not.toThrow()
  })

  test('finish ends a Do assignment early', () => {
    const { w, maker, as } = world()
    const first = as(maker)
    w.Assignment.finish(first, now())
    expect(() => as(maker)).not.toThrow()
  })
})

describe('Executive acts', () => {
  const change = (direction) => ({ act: 'Change', changesOf: [direction] })

  test('an executive act needs an until', () => {
    const { w, approver, direction } = world()
    expect(() => w.Executive.grant({ act: change(direction), to: approver, by: nanda, when: now() }))
      .toThrow('needs an until')
  })

  test('nobody gives more than they may do, a model included', () => {
    const { w, approver, direction, as } = world()
    const until = after(now(), HOUR)
    const theirs = w.Direction.start({
      name: 'Theirs', says: 'x', owner: { name: 'Kai' }, by: assess, when: now(),
    })
    expect(() => w.Executive.grant({ act: change(theirs), to: approver, by: nanda, until, when: now() }))
      .toThrow('may not give')
    // A model has only the acts of its assignment: Approve results, not Change a direction.
    expect(() => w.Executive.grant({ act: change(direction), to: approver, by: as(approver), until, when: now() }))
      .toThrow('may not give')
    const architect = { role: 'architect', playedBy: 'Opus', acts: [change(direction)] }
    w.Workflow.define({ system: 'Architects', roles: [architect], when: now() })
    expect(() => w.Executive.grant({ act: change(direction), to: approver, by: as(architect), until, when: now() }))
      .not.toThrow()
  })

  test('an executive act ends at its until (boundary: exactly until counts), and can be revoked', () => {
    const { w, approver, direction, as } = world()
    const sol = as(approver)
    const grant = (until) => w.Executive.grant({
      act: change(direction), to: approver, by: nanda, until, when: now(),
    })
    const until = after(now(), HOUR)
    grant(until)
    const a = add(w, direction, 'A')
    w.Review.decide(a, sol, until, 'Accept', seen)                  // exactly at until
    expect(w.read.madeBy(a)).toBeDefined()
    wait(2 * HOUR)                                                  // after the until
    const b = add(w, direction, 'B')
    w.Review.decide(b, sol, now(), 'Accept', seen)
    expect(w.read.madeBy(b)).toBeUndefined()
    // A new grant works until its revoke; the acts before the revoke stay.
    const night = grant(after(now(), HOUR))
    const c = add(w, direction, 'C')
    w.Review.decide(c, sol, now(), 'Accept', seen)
    expect(w.read.madeBy(c)).toBeDefined()
    w.Executive.revoke(night, { by: nanda, when: now() })
    const d = add(w, direction, 'D')
    w.Review.decide(d, sol, now(), 'Accept', seen)
    expect(w.read.madeBy(d)).toBeUndefined()
    expect(w.read.madeBy(c)).toBeDefined()
  })

  test('only the giver revokes, and only once', () => {
    const { w, approver, direction } = world()
    const night = w.Executive.grant({
      act: change(direction), to: approver, by: nanda, until: after(now(), HOUR), when: now(),
    })
    expect(() => w.Executive.revoke(night, { by: { name: 'Kai' }, when: now() }))
      .toThrow('only the giver')
    w.Executive.revoke(night, { by: nanda, when: now() })
    expect(() => w.Executive.revoke(night, { by: nanda, when: now() })).toThrow('already revoked')
  })
})

describe('Direction', () => {
  test('a model drafts a new direction; a person gives direction in words', () => {
    const w = createWork()
    expect(() => w.Direction.start({
      name: 'D', says: 's', owner: nanda, by: { name: 'Kai' }, when: now(),
    })).toThrow('the person gives direction in words, as a suggestion; a model drafts D')
  })

  test('a suggestion is words about a direction, a standard, or a rule; with no target it asks for a new direction', () => {
    const { w, direction, rule, maker, approver, as } = world()
    const s =w.Suggestion.make({ about: rule, says: 'cannot be met', by: as(maker), when: now() })
    expect(w.read.suggestions).toEqual([s])
    expect(() => w.Suggestion.make({ says: ' ', by: suggester, when: now() })).toThrow('says something')
    const ask = w.Suggestion.make({ says: 'we need a direction for reels', by: suggester, when: now() })
    expect(() => w.Direction.revise(direction, {
      add: [{ says: 'Reels' }], answers: [ask], by: suggester, when: now(),
    })).toThrow('asks for a new direction')
    const draft = w.Direction.revise(undefined, {
      name: 'Reels', says: 'Good reels', owner: nanda, answers: [ask], by: suggester, when: now(),
    })
    w.Review.decide(draft, as(approver), now(), 'Accept', seen)
    expect(w.read.madeBy(draft)).toBeUndefined()                  // a new direction needs its owner
    w.Review.decide(draft, nanda, now(), 'Accept', seen)
    expect(w.read.madeBy(draft).number).toBe(1)
  })

  test('a draft changes nothing until it is official', () => {
    const { w, task, maker, direction, as } = world()
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    add(w, direction, 'New', [{ says: 'New rule' }])
    expect(w.blockers(r, now()))
      .toEqual(['no evidence for "It works"', 'no accept yet by a role that decides it'])
  })

  test('only the accept of the owner, or of a role with a Change act on it, makes a draft official', () => {
    const { w, approver, owner, direction, as } = world()
    const v2 = add(w, direction, 'More')
    w.Review.decide(v2, as(approver), now(), 'Accept', seen)      // it reviews, but does not decide
    expect(w.read.madeBy(v2)).toBeUndefined()
    expect(w.read.draftWaitsFor(v2)).toEqual([nanda])
    w.Review.decide(v2, as(owner), now(), 'Accept', seen)
    expect(w.read.madeBy(v2).number).toBe(2)
    // The same accept by a role with a Change act counts, while its grant lasts.
    w.Executive.grant({
      act: { act: 'Change', changesOf: [direction] }, to: approver, by: nanda,
      until: after(now(), HOUR), when: now(),
    })
    const v3 = add(w, direction, 'Even more')
    w.Review.decide(v3, as(approver), now(), 'Accept', seen)
    expect(w.read.madeBy(v3).number).toBe(3)
  })

  test('the spirit changes only with the accept of a person, even with an executive act', () => {
    const { w, approver, owner, direction, as } = world()
    w.Executive.grant({
      act: { act: 'Change', changesOf: [direction] }, to: approver, by: nanda,
      until: after(now(), HOUR), when: now(),
    })
    const spirit = w.Direction.revise(direction, { says: 'Do it fast', by: suggester, when: now() })
    expect(() => w.Review.decide(spirit, as(approver), now(), 'Accept', seen))
      .toThrow('a new spirit needs the accept of Nanda')
    w.Review.decide(spirit, as(owner), now(), 'Accept', seen)
    expect(w.read.madeBy(spirit).says).toBe('Do it fast')
  })

  test('no lost update: a draft built on an old version, or accepted twice, is refused', () => {
    const { w, owner, direction, as } = world()
    const a = add(w, direction, 'A')
    const b = add(w, direction, 'B')
    w.Review.decide(a, as(owner), now(), 'Accept', seen)
    expect(() => w.Review.decide(b, as(owner), now(), 'Accept', seen)).toThrow('old version')
    expect(() => w.Review.decide(a, as(owner), now(), 'Accept', seen))
      .toThrow('is official: it made Craft v2')
  })

  test('a draft names only standards that exist, and adds no second standard with the same text', () => {
    const { w, direction } = world()
    expect(() => w.Direction.revise(direction, {
      remove: ['No such standard'], by: suggester, when: now(),
    })).toThrow('no standard')
    expect(() => add(w, direction, 'It is done well')).toThrow('already has')
  })

  test('a direction with a size limit refuses one more standard (boundary: exactly the limit)', () => {
    const w = createWork()
    const d = w.Direction.start({
      name: 'Small', says: 'x', owner: nanda, maxStandards: 2, by: assess, when: now(),
      standards: [{ says: 'one', rules: [] }],
    })
    const two = add(w, d, 'two')
    w.Review.decide(two, nanda, now(), 'Accept', seen)
    expect(() => add(w, d, 'three')).toThrow('the limit is 2')
  })

  test('a newer rule that supersedes an older one removes it (the newer rule wins)', () => {
    const { w, task, maker, owner, direction, rule, as } = world()
    const newer = { says: 'It works on the local stack', supersedes: [rule] }
    w.Review.decide(add(w, direction, 'Local', [newer]), as(owner), now(), 'Accept', seen)
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    expect(w.blockers(r, now())).toEqual([
      'no evidence for "It works on the local stack"', 'no accept yet by a role that decides it',
    ])
  })

  test('a suggestion is answered at its level: a rule with its standard, the direction with what it says', () => {
    const suggest = (about, wd) => wd.w.Suggestion.make({
      about, says: 'cannot be met', by: wd.as(wd.maker), when: now(),
    })
    const keep = world()
    const s1 = suggest(keep.rule, keep)
    expect(() => keep.w.Direction.revise(keep.direction, {
      add: [{ says: 'Other' }], answers: [s1], by: suggester, when: now(),
    })).toThrow('answered by a change of its standard')
    const replace = world()
    const s2 = suggest(replace.rule, replace)
    const replaced = replace.w.Direction.revise(replace.direction, {
      replace: [['It is done well', { says: 'It is done well', rules: [{ says: 'It works locally' }] }]],
      answers: [s2], by: suggester, when: now(),
    })
    replace.w.Review.decide(replaced, replace.as(replace.owner), now(), 'Accept', seen)
    expect(replace.w.read.madeBy(replaced).number).toBe(2)
    const spirit = world()
    const s3 = suggest(spirit.direction, spirit)
    expect(() => spirit.w.Direction.revise(spirit.direction, {
      add: [{ says: 'X' }], answers: [s3], by: suggester, when: now(),
    })).toThrow('what it says')
    expect(() => spirit.w.Direction.revise(spirit.direction, {
      says: 'Do it slowly', answers: [s3], by: suggester, when: now(),
    })).not.toThrow()
  })

  test('a rule, a standard, or a direction gets a suggestion, not a review', () => {
    const { w, maker, rule, as } = world()
    expect(() => w.Review.decide(rule, as(maker), now(), 'Reject', [], 'no'))
      .toThrow('gets a Suggestion')
  })

  test('a Reject of a result is answered only by a real change in a direction of its task', () => {
    const { w, task, maker, owner, direction, as } = world()
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    const no = w.Review.decide(r, as(owner), now(), 'Reject', [], 'wrong')
    const other = w.Direction.start({ name: 'Other', says: 'x', owner: nanda, by: assess, when: now() })
    expect(() => w.Direction.revise(other, {
      add: [{ says: 'Y' }], answers: [no], by: suggester, when: now(),
    })).toThrow('not a direction of Task')
    expect(() => w.Direction.revise(direction, { answers: [no], by: suggester, when: now() }))
      .toThrow('says the same to t as before')
    const change = w.Direction.revise(direction, {
      add: [{ says: 'Y' }], answers: [no], by: suggester, when: now(),
    })
    expect(w.read.answered(no)).toBe(false)                       // a draft answers when it is official
    w.Review.decide(change, as(owner), now(), 'Accept', seen)
    expect(w.read.answered(no)).toBe(true)
  })

  test('a change that applies only to another region does not answer the Reject of a task', () => {
    const { w, task, maker, owner, direction, as } = world({ context: { region: 'A' } })
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    const no = w.Review.decide(r, as(owner), now(), 'Reject', [], 'wrong')
    expect(() => w.Direction.revise(direction, {
      add: [{ says: 'Only C', where: { region: 'C' }, rules: [] }],
      answers: [no], by: suggester, when: now(),
    })).toThrow('says the same to t as before')
  })

  test('a change for another region does not make a result old; a change that applies does', () => {
    const { w, task, maker, owner, direction, rule, as } = world({ context: { region: 'A' } })
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    w.Review.decide(r, as(owner), now(), 'Accept', proof(rule))
    const elsewhere = w.Direction.revise(direction, {
      add: [{ says: 'Only C', where: { region: 'C' }, rules: [] }], by: suggester, when: now(),
    })
    w.Review.decide(elsewhere, as(owner), now(), 'Accept', seen)
    expect(w.blockers(r, now())).toEqual([])
    // A standard with no rules that now applies: nothing to check again, but the decider
    // accepts it again under the new version.
    w.Review.decide(add(w, direction, 'Everywhere'), as(owner), now(), 'Accept', seen)
    expect(w.blockers(r, now()))
      .toEqual(['accepted by its decider under an old version; the decider accepts it again'])
  })

  test('a lesson stays official while its text is in the current version; find hides replaced ones', () => {
    const { w, owner, direction, as } = world()
    w.Review.decide(add(w, direction, 'Pin first'), as(owner), now(), 'Accept', seen)
    const removal = w.Direction.revise(direction, {
      remove: ['Pin first'], by: suggester, when: now(),
    })
    w.Review.decide(removal, as(owner), now(), 'Accept', seen)
    expect(w.Note.find('pin first')).toEqual([])
    expect(w.Note.find('pin first', { all: true }).map((f) => f.status)).toEqual(['Replaced'])
  })

  test('a standard applies where its "where" matches the task context', () => {
    const cases = [
      [undefined, { region: 'A' }, true],
      [{ region: 'A' }, { region: 'A', system: 'Docs' }, true],
      [{ region: 'A', system: 'Runtime' }, { region: 'A', system: 'Docs' }, false],
      [{ region: 'A' }, undefined, false],
    ]
    for (const [where, context, applies] of cases) {
      const { w, task, maker, as } = world({ context })
      task.aiDescription.directions[0].versions[0].standards[0].where = where
      const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
      expect(w.blockers(r, now()).some((b) => b.startsWith('no evidence'))).toBe(applies)
    }
  })
})

describe('Review of a draft', () => {
  test('a draft takes an Accept with evidence or a Reject with a reason, and nothing else', () => {
    const { w, approver, direction, as } = world()
    const v = add(w, direction, 'More')
    const sol = as(approver)
    expect(() => w.Review.decide(v, sol, now(), 'Raise', [], 'unsure')).toThrow('an Accept or a Reject')
    expect(() => w.Review.decide(v, sol, now(), 'Reject', [], ' ')).toThrow('needs a reason')
    expect(() => w.Review.decide(v, sol, now(), 'Accept', [], 'fine')).toThrow('give evidence')
    expect(() => w.Review.decide(v, sol, now(), 'Accept', [{ says: 'fine' }])).toThrow('give evidence')
    expect(() => w.Review.decide(v, sol, now(), 'Accept', seen)).not.toThrow()
  })

  test('a review is an Accept or a Reject: another decision is refused', () => {
    const { w, approver, direction, as } = world()
    const v = add(w, direction, 'More')
    expect(() => w.Review.decide(v, as(approver), now(), 'Maybe', seen, 'x')).toThrow()
  })

  test('the reviser reviews its own draft never, and nobody reviews twice', () => {
    const { w, task, direction } = world()
    const techlead = { role: 'techlead', playedBy: 'Sol', acts: [] }
    w.Workflow.define({ system: 'Docs', roles: [techlead], when: now() })
    const sol = w.Assignment.give({ role: techlead, task, when: now() })
    const v = w.Direction.revise(direction, { add: [{ says: 'More' }], by: sol, when: now() })
    expect(() => w.Review.decide(v, sol, now(), 'Accept', seen)).toThrow('your own draft')
    const luna = w.Assignment.give({ role: techlead, task, when: now() })
    w.Review.decide(v, luna, now(), 'Accept', seen)
    expect(() => w.Review.decide(v, luna, now(), 'Reject', [], 'changed my mind'))
      .toThrow('already reviewed')
  })

  test('a Reject by a decider ends the draft; its reviser revises the current version again', () => {
    const { w, approver, owner, direction, as } = world()
    const v = add(w, direction, 'More')
    w.Review.decide(v, as(owner), now(), 'Reject', [], 'too long')
    expect(() => w.Review.decide(v, as(approver), now(), 'Accept', seen))
      .toThrow('is ended by the Reject of Nanda')
    const again = add(w, direction, 'Less')
    w.Review.decide(again, as(owner), now(), 'Accept', seen)
    expect(w.read.madeBy(again).number).toBe(2)
  })

  test('approvedBy: a draft waits for the accepts in its order', () => {
    const w = createWork()
    const techlead = { role: 'techlead', tier: 'high', playedBy: 'Sol', acts: [] }
    w.Workflow.define({ system: 'Docs', roles: [techlead], when: now() })
    const tsd = w.Direction.start({
      name: 'TSD writing', says: 'Clear TSDs', owner: nanda, by: assess, when: now(),
      approvedBy: Order([techlead, nanda]),
    })
    const task = w.Task.start({
      id: 't1', name: 'Introduction', owner: nanda, when: now(),
      aiDescription: { text: 'Write it', directions: [tsd] },
    })
    const v2 = w.Direction.revise(tsd, {
      add: [{ says: 'Numbers have units' }], by: suggester, when: now(),
    })
    expect(() => w.Review.decide(v2, nanda, now(), 'Accept', seen))
      .toThrow('after the accept of techlead')
    expect(w.read.draftWaitsFor(v2)).toEqual([techlead])
    w.Review.decide(v2, w.Assignment.give({ role: techlead, task, when: now() }), now(), 'Accept', seen)
    expect(w.read.madeBy(v2)).toBeUndefined()
    expect(w.read.draftWaitsFor(v2)).toEqual([nanda])
    w.Review.decide(v2, nanda, now(), 'Accept', seen)
    expect(w.read.madeBy(v2).number).toBe(2)
  })
})

describe('Snapshot (no race between a change and an attempt)', () => {
  test('a result follows the versions of the last brief; a change during the attempt makes it old', () => {
    const { w, task, maker, owner, direction, as } = world()
    const terra = as(maker)                                      // reads version 1
    const change = add(w, direction, 'New', [{ says: 'New rule' }])
    w.Review.decide(change, as(owner), now(), 'Accept', seen)
    const during = w.Result.report(task, { by: terra, when: now(), output: 'made from version 1' })
    expect(w.blockers(during, now())).toContain('made under an old version of Craft')
    expect(w.Assignment.brief(terra, now()).versions).toEqual(['Craft v2'])   // a new snapshot
    const after = w.Result.report(task, { by: terra, when: now(), output: 'made from version 2' })
    expect(w.blockers(after, now())).not.toContain('made under an old version of Craft')
  })

  test('a review decides from its own snapshot: an Accept from an old brief keeps nothing', () => {
    const { w, task, maker, owner, direction, rule, as } = world()
    const nandaBefore = as(owner)                                // reads version 1
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    w.Review.decide(add(w, direction, 'Doc'), nandaBefore, now(), 'Accept', seen)
    w.Review.decide(r, nandaBefore, now(), 'Accept', proof(rule))
    expect(w.blockers(r, now()))
      .toEqual(['accepted by its decider under an old version; the decider accepts it again'])
    w.Assignment.brief(nandaBefore, now())                       // reads version 2
    w.Review.decide(r, nandaBefore, now(), 'Accept', proof(rule))
    expect(w.blockers(r, now())).toEqual([])
  })
})

describe('Task', () => {
  test('a split needs the owner, and each smaller task needs its own text', () => {
    const { w, task, approver, owner, as } = world()
    const part = (id) => ({ id, name: id, aiDescription: { text: 'Only ' + id } })
    expect(() => w.Task.split(task, { by: as(approver), into: [part('a')], when: now() }))
      .toThrow('has no change act on Task')
    expect(() => w.Task.split(task, { by: as(owner), into: [], when: now() })).toThrow('at least one')
    expect(() => w.Task.split(task, { by: as(owner), into: [{ id: 'b', name: 'B' }], when: now() }))
      .toThrow('its own text')
    const [a] = w.Task.split(task, { by: as(owner), into: [part('a')], when: now() })
    expect([a.serves, a.aiDescription.text, a.aiDescription.partOf]).toEqual([task, 'Only a', 'Do it'])
  })

  test('close needs the owner or a Change act on the task', () => {
    const { w, task, maker, owner, as } = world()
    expect(() => w.Task.close(task, as(maker), now(), 'stuck')).toThrow('has no change act on Task')
    w.Task.close(task, as(owner), now(), 'not needed')
    expect(w.Task.state(task, now())).toBe('Closed')
  })

  test('a closed, a returned, or an accepted task takes no new result', () => {
    const { w, task, maker, owner, direction, rule, as } = world()
    const terra = as(maker)
    const report = (output) => w.Result.report(task, { by: terra, when: now(), output })
    const r = report('x')
    w.Review.decide(r, as(owner), now(), 'Accept', proof(rule))
    expect(() => report('y')).toThrow('is accepted')
    const back = w.Review.decide(task, as(owner), now(), 'Reject', [], 'not ready')
    expect(() => report('y')).toThrow('waits for an evaluation')
    w.Evaluation.write(back, {
      by: nanda, when: now(), wrong: 'the task is not ready',
      why: 'the direction says nothing of it', improve: ['say when a task is ready'], level: 'standard',
    })
    expect(() => report('y')).toThrow('is returned')
    const ready = w.Direction.revise(direction, {
      add: [{ says: 'Ready' }], answers: [back], by: suggester, when: now(),
    })
    w.Review.decide(ready, as(owner), now(), 'Accept', seen)
    w.Task.close(task, as(owner), now(), 'not needed')
    expect(() => report('y')).toThrow('is closed')
  })

  test('a big task needs its own accepted result and its open smaller tasks accepted', () => {
    const { w, task, maker, owner, rule, as } = world()
    const part = (id) => ({ id, name: id, aiDescription: { text: id } })
    const [a] = w.Task.split(task, { by: as(owner), into: [part('a')], when: now() })
    const accept = (t) => {
      const by = w.Assignment.give({ role: maker, task: t, when: now() })
      const r = w.Result.report(t, { by, when: now(), output: 'x' })
      const decider = w.Assignment.give({ role: owner, task: t, actor: nanda, when: now() })
      w.Review.decide(r, decider, now(), 'Accept', proof(rule))
    }
    accept(a)
    expect(w.Task.state(task, now())).toBe('Open')
    accept(task)
    expect(w.Task.state(task, now())).toBe('Accepted')
  })

  test('a task with no rules needs an approval from someone who decides', () => {
    const w = createWork()
    const maker = { role: 'maker', playedBy: 'Terra', acts: [{ act: 'Do', work: 'x' }] }
    const checker = { role: 'checker', playedBy: 'Luna', acts: [{ act: 'Review', resultsOf: [maker] }] }
    w.Workflow.define({ system: 'Runtime', roles: [maker, checker], when: now() })
    const t = w.Task.start({ id: 't', name: 'T', owner: nanda, when: now() })
    const by = w.Assignment.give({ role: maker, task: t, when: now() })
    const r = w.Result.report(t, { by, when: now(), output: 'x' })
    expect(w.accepted(r, now())).toBe(false)
    w.Review.decide(r, w.Assignment.give({ role: checker, task: t, when: now() }), now(), 'Accept', [])
    expect(w.blockers(r, now())).toEqual(['no accept yet by a role that decides it'])
  })

  // Evaluation (Nanda, 2026-11-08): a mistake is evaluated, not tried again with the same inputs.
  test('a fault on the last try stops the task: no new maker before an evaluation, and none on the same inputs', () => {
    const { w, task, maker, checker, direction, as } = world()
    const terra = as(maker, { maxAttempts: 1 })
    const r = w.Result.report(task, { by: terra, when: now(), output: 'x' })
    expect(w.read.workStop(task, now())).toBeUndefined()
    w.Review.decide(r, as(checker), now(), 'Reject', [], 'it fails')
    expect(w.read.workStop(task, now())).toContain('waits for an evaluation of the last try of')
    expect(() => w.Assignment.give({ role: maker, task, when: now() }))
      .toThrow('waits for an evaluation')
    const [stop] = w.read.exhaustions
    expect(stop.maker).toBe(terra)
    w.Evaluation.write(stop, {
      by: nanda, when: now(), wrong: 'r fails', why: 'the rule does not name the input',
      improve: ['name the input'], level: 'standard',
    })
    expect(w.read.evaluationWaits(task)).toBeUndefined()
    expect(() => w.Assignment.give({ role: maker, task, when: now() }))
      .toThrow('has the inputs that failed')
    // The change says something new to the task: the attempts start again, and the maker works.
    w.Review.decide(add(w, direction, 'The input is named'), nanda, now(), 'Accept', seen)
    expect(w.read.workStop(task, now())).toBeUndefined()
    expect(() => w.Result.report(task, { by: terra, when: now(), output: 'y' })).not.toThrow()
  })
})

describe('Attempts (boundary values)', () => {
  const reports = (max, count) => {
    const { w, task, maker, as } = world()
    const terra = as(maker, max === undefined ? {} : { maxAttempts: max })
    for (let i = 0; i < count; i++) {
      w.Result.report(task, { by: terra, when: now(), output: String(i) })
    }
  }
  test('no maximum: any number', () => expect(() => reports(undefined, 5)).not.toThrow())
  test('maximum 3: exactly three; the fourth is refused', () => {
    expect(() => reports(3, 3)).not.toThrow()
    expect(() => reports(3, 4)).toThrow('has used its 3 attempts')
  })
  test('below 1, or not a whole number, is refused', () => {
    for (const max of [0, -1, 2.5]) {
      const { w, task, maker } = world()
      expect(() => w.Assignment.give({ role: maker, task, maxAttempts: max, when: now() }))
        .toThrow('maxAttempts')
    }
  })
  test('the high role of the tree, or the person, evaluates; at the level of a direction it counts after the person accepts it', () => {
    const { w, task, maker, checker, as } = world()
    const sol = { role: 'architect', playedBy: 'Sol', tier: 'high', acts: [{ act: 'Approve', resultsOf: [maker] }] }
    const lead = { role: 'lead', playedBy: 'Terra', tier: 'medium', acts: [{ act: 'Approve', resultsOf: [maker] }] }
    w.Workflow.define({ system: 'Leads', roles: [sol, lead], when: now() })
    const architect = w.Assignment.give({ role: sol, task, when: now() })
    const r = w.Result.report(task, { by: as(maker, { maxAttempts: 1 }), when: now(), output: 'x' })
    const fields = {
      wrong: 'r fails', why: 'the direction asks for two things that conflict',
      improve: ['say which comes first'],
    }
    const write = (stop, by, level) => w.Evaluation.write(stop, { by, when: now(), ...fields, level })
    expect(() => write(r, architect, 'direction')).toThrow('an evaluation answers a stop')
    w.Review.decide(r, as(checker), now(), 'Reject', [], 'it fails')
    const [stop] = w.read.exhaustions
    expect(() => write(stop, w.Assignment.give({ role: lead, task, when: now() }), 'direction'))
      .toThrow('a high role evaluates a mistake')
    expect(() => write(stop, architect, 'a hunch')).toThrow('the level of the deepest cause')
    const e = write(stop, architect, 'direction')
    expect(e.answers).toBe(stop)
    expect(w.read.evaluationWaits(task)).toBeDefined()
    expect(() => w.Review.decide(e, architect, now(), 'Accept', seen, 'yes'))
      .toThrow('the person evaluates')
    expect(() => w.Review.decide(e, nanda, now(), 'Accept', [], 'yes')).toThrow('give evidence')
    expect(() => w.Review.decide(e, nanda, now(), 'Raise', [], 'unsure')).toThrow('nobody raises')
    w.Review.decide(e, nanda, now(), 'Accept', seen, 'the order is right')
    expect(w.read.evaluationDecision(e).decision).toBe('Accept')
    expect(w.read.evaluationWaits(task)).toBeUndefined()
    expect(() => w.Review.decide(e, nanda, now(), 'Reject', [], 'no')).toThrow('already accepted')
  })

  test('each stop has its own evaluation: two stops, two evaluations', () => {
    const { w, task, maker, checker, as } = world()
    const fields = { wrong: 'r fails', why: 'no rule names it', improve: ['name it'], level: 'standard' }
    const fail = () => {
      const terra = as(maker, { maxAttempts: 1 })
      const r = w.Result.report(task, { by: terra, when: now(), output: 'x' })
      w.Review.decide(r, as(checker), now(), 'Reject', [], 'it fails')
    }
    fail()
    const [first] = w.read.exhaustions
    w.Evaluation.write(first, { by: nanda, when: now(), ...fields })
    expect(() => w.Evaluation.write(first, { by: nanda, when: now(), ...fields }))
      .toThrow('already has an evaluation that counts')
    w.Assignment.finish(first.maker, now())
    // The evaluation asks for a change first; with the same inputs the next maker is refused.
    expect(w.read.workStop(task, now())).toContain('has the inputs that failed')
  })

  test('the person\'s Reject waits for an evaluation before a change answers it', () => {
    const { w, task, maker, owner, direction, rule, as } = world()
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    w.Review.decide(r, as(owner), now(), 'Accept', proof(rule))
    const back = w.Review.decide(task, as(owner), now(), 'Reject', [], 'not what I meant')
    const ready = (revise) => revise(direction, {
      add: [{ says: 'Ready' }], answers: [back], by: suggester, when: now(),
    })
    expect(() => ready(w.Direction.revise)).toThrow('waits for an evaluation of t first')
    w.Evaluation.write(back, {
      by: nanda, when: now(), wrong: 'the task', why: 'the direction says nothing of readiness',
      improve: ['add Ready'], level: 'standard',
    })
    const draft = ready(w.Direction.revise)
    expect(w.read.answered(back)).toBe(false)
    w.Review.decide(draft, nanda, now(), 'Accept', seen)
    expect(w.read.answered(back)).toBe(true)
  })
})

describe('Limits of the workflow (what one AI can hold)', () => {
  test('a review assignment checks at most Review.rules rules (boundary: exactly the limit)', () => {
    const rules = [1, 2, 3].map((n) => ({ says: 'rule ' + n }))
    const w = createWork()
    const maker = { role: 'maker', playedBy: 'Terra', acts: [{ act: 'Do', work: 'x' }] }
    const checker = { role: 'checker', playedBy: 'Luna', acts: [{ act: 'Review', resultsOf: [maker] }] }
    w.Workflow.define({
      system: 'Docs', roles: [maker, checker], limits: { Review: { rules: 2 } }, when: now(),
    })
    for (const r of rules) r.checkedBy = checker
    const d = w.Direction.start({
      name: 'D', says: 'x', owner: nanda, by: assess, when: now(), standards: [{ says: 's', rules }],
    })
    const t = w.Task.start({
      id: 't', name: 'T', owner: nanda, when: now(), aiDescription: { text: 'x', directions: [d] },
    })
    expect(() => w.Assignment.give({ role: checker, task: t, when: now() }))
      .toThrow('would check 3 rules; the limit is 2: split the task')
    rules[2].checkedBy = undefined
    expect(() => w.Assignment.give({ role: checker, task: t, when: now() })).not.toThrow()
  })

  test('a brief over Assignment.briefChars is refused', () => {
    const { w, task, maker } = world({ limits: { Assignment: { briefChars: 50 } } })
    expect(() => w.Assignment.give({ role: maker, task, when: now() })).toThrow('the limit is 50')
  })

  test('Assignment.attempts is the default and the ceiling of maxAttempts (boundary: exactly the limit)', () => {
    const { w, task, maker, as } = world({ limits: { Assignment: { attempts: 3 } } })
    expect(() => as(maker, { maxAttempts: 4 })).toThrow('maxAttempts 4 is over the maker limit of 3')
    const first = as(maker, { maxAttempts: 3 })
    expect(first.maxAttempts).toBe(3)
    w.Assignment.finish(first, now())
    const terra = as(maker)
    expect(terra.maxAttempts).toBe(3)
    for (let i = 0; i < 3; i++) w.Result.report(task, { by: terra, when: now(), output: String(i) })
    expect(() => w.Result.report(task, { by: terra, when: now(), output: 'x' }))
      .toThrow('has used its 3 attempts')
  })

  test('a result over Result.size is refused (boundary: exactly the size)', () => {
    const { w, task, maker } = world({ limits: { Result: { size: 400 } } })
    const terra = w.Assignment.give({ role: maker, task, when: now() })
    expect(() => w.Result.report(task, { by: terra, when: now(), output: 'x', size: 401 }))
      .toThrow('split the task')
    expect(() => w.Result.report(task, { by: terra, when: now(), output: 'x', size: 400 }))
      .not.toThrow()
  })

  test('a waiver lasts at most Note.waiverHours (boundary: under the limit passes)', () => {
    const { w, task, maker, approver, rule, as } = world({ limits: { Note: { waiverHours: 24 } } })
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    const sol = as(approver)
    const waiver = (hours) => ({
      kind: 'Finding', about: r, text: 'nobody checked', notChecked: [rule], by: sol,
      reason: 'incident', until: after(now(), hours * HOUR),
    })
    expect(() => w.Note.add(waiver(25), now())).toThrow('a waiver lasts at most 24 hours')
    expect(() => w.Note.add(waiver(23), now())).not.toThrow()
  })
})

describe('Evidence and review', () => {
  test('evidence must say where it looked', () => {
    const { w, task, maker, owner, rule, as } = world()
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    w.Review.decide(r, as(owner), now(), 'Accept', [{ says: 'it works', meets: rule }])
    // With no place, the line is not evidence: not for the rule, and not for the decider.
    expect(w.blockers(r, now()))
      .toEqual(['no evidence for "It works"', 'no accept yet by a role that decides it'])
  })

  test('evidence covers only the result that it reviewed', () => {
    const { w, task, maker, owner, rule, as } = world()
    const terra = as(maker)
    const first = w.Result.report(task, { by: terra, when: now(), output: 'x' })
    const second = w.Result.report(task, { by: terra, when: now(), output: 'y' })
    w.Review.decide(first, as(owner), now(), 'Accept', proof(rule))
    expect(w.blockers(second, now()))
      .toEqual(['no evidence for "It works"', 'no accept yet by a role that decides it'])
  })

  test('a rule checked by a role: only that role, on results that its act covers', () => {
    const { w, task, maker, checker, owner, rule, as } = world()
    rule.checkedBy = checker
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    w.Review.decide(r, as(owner), now(), 'Accept', proof(rule))
    expect(w.blockers(r, now())).toEqual(['no evidence for "It works"'])
    w.Review.decide(r, as(checker), now(), 'Accept', proof(rule))
    expect(w.blockers(r, now())).toEqual([])
  })

  test('a rule with no checker: the owner, or a role that approves the maker\'s results', () => {
    for (const [role, counts] of [['approver', true], ['owner', true], ['checker', false]]) {
      const all = world()
      const r = all.w.Result.report(all.task, { by: all.as(all.maker), when: now(), output: 'x' })
      all.w.Review.decide(r, all.as(all[role]), now(), 'Accept', proof(all.rule))
      expect([role, all.w.blockers(r, now()).length === 0]).toEqual([role, counts])
    }
    // A role whose acts do not cover the maker cannot review at all.
    const all = world()
    const r = all.w.Result.report(all.task, { by: all.as(all.maker), when: now(), output: 'x' })
    expect(() => all.w.Review.decide(r, all.as(all.outsider), now(), 'Accept', proof(all.rule)))
      .toThrow('Vega (outsider) may not review this')
  })

  test('a person who is not the owner and has no Approve act does not decide', () => {
    const { w, task, maker, rule, as } = world()
    const kai = { role: 'teammate', playedBy: { name: 'Kai' }, acts: [{ act: 'Review', resultsOf: [] }] }
    w.Workflow.define({ system: 'GitHub', roles: [kai], when: now() })
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    const by = w.Assignment.give({ role: kai, task, actor: { name: 'Kai' }, when: now() })
    expect(() => w.Review.decide(r, by, now(), 'Accept', proof(rule)))
      .toThrow('Kai (teammate) may not review this')
    w.Review.decide(r, by, now(), 'Raise', [], 'I have a doubt')    // anyone may raise
    expect(w.blockers(r, now())).toContain('no evidence for "It works"')
  })

  test('a Reject and a Raise need a reason (boundary: empty and blank)', () => {
    const { w, task, maker, owner, as } = world()
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    for (const decision of ['Reject', 'Raise']) {
      for (const reason of [undefined, '', '   ']) {
        expect(() => w.Review.decide(r, as(owner), now(), decision, [], reason))
          .toThrow('needs a reason')
      }
    }
  })

  test('a Reject that names a rule is answered by later evidence for that rule', () => {
    const { w, task, maker, owner, rule, as } = world()
    const terra = as(maker)
    const first = w.Result.report(task, { by: terra, when: now(), output: 'x' })
    w.Review.decide(first, as(owner), now(), 'Reject', [], 'it fails', { breaks: rule })
    const second = w.Result.report(task, { by: terra, when: now(), output: 'y' })
    // no "no instruction change"
    expect(w.blockers(second, now()))
      .toEqual(['no evidence for "It works"', 'no accept yet by a role that decides it'])
    w.Review.decide(second, as(owner), now(), 'Accept', proof(rule))
    expect(w.blockers(second, now())).toEqual([])
  })

  test('a Reject that names no rule still needs an instruction change', () => {
    const { w, task, maker, owner, as } = world()
    const terra = as(maker)
    const first = w.Result.report(task, { by: terra, when: now(), output: 'x' })
    w.Review.decide(first, as(owner), now(), 'Reject', [], 'nothing covers this')
    const second = w.Result.report(task, { by: terra, when: now(), output: 'y' })
    expect(w.blockers(second, now())).toContain('no instruction change answers "nothing covers this"')
  })

  test('a Raise waits for its answerer; a review that does not settle it does not lift it', () => {
    const { w, task, maker, checker, approver, owner, rule, as } = world()
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    const raise = w.Review.decide(r, as(checker), now(), 'Raise', [], 'cannot decide')
    w.Review.decide(r, as(approver), now(), 'Accept', proof(rule))      // does not name the Raise
    expect(w.blockers(r, now())).toContain('raised: cannot decide')
    expect(() => w.Review.decide(r, as(checker), now(), 'Accept', [], undefined, { settles: raise }))
      .toThrow('may not settle')
    w.Review.decide(r, as(owner), now(), 'Accept', proof(rule), undefined, { settles: raise })
    expect(w.blockers(r, now())).toEqual([])
  })

  test('urgent work: a waiver needs a decider (not the maker), a reason, and an until; it leaves the task open', () => {
    const { w, task, maker, checker, approver, rule, as } = world()
    const terra = as(maker)
    const r = w.Result.report(task, { by: terra, when: now(), output: 'x' })
    const sol = as(approver)
    const until = after(now(), 2 * HOUR)
    const waiver = { kind: 'Finding', about: r, text: 'nobody checked', notChecked: [rule] }
    expect(() => w.Note.add(waiver, now())).toThrow('needs by, a reason, and an until')
    expect(() => w.Note.add({ ...waiver, by: terra, reason: 'urgent', until }, now()))
      .toThrow('never from the maker')
    expect(() => w.Note.add({ ...waiver, by: as(checker), reason: 'urgent', until }, now()))
      .toThrow('never from the maker')
    w.Note.add({ ...waiver, by: sol, reason: 'incident', until }, now())
    w.Review.decide(r, sol, now(), 'Accept', [{ says: 'the fix stops the incident', at: 'the reported code' }])
    expect(w.accepted(r, now())).toBe(true)
    expect(w.taskAccepted(task, now())).toBe(false)
    expect(w.accepted(r, until)).toBe(true)                             // exactly until still counts
    wait(3 * HOUR)                                                      // the waiver ended
    expect(w.accepted(r, now())).toBe(false)
  })
})

describe('Note and Checkpoint', () => {
  test('a question needs answerBy, and only that actor answers it', () => {
    const { w, task, maker, approver, owner, as } = world()
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'a' })
    expect(() => w.Note.add({ kind: 'Question', text: 'Which?', stops: [r] }, now()))
      .toThrow('needs answerBy')
    const q = w.Note.add({ kind: 'Question', text: 'Which?', stops: [r], answerBy: nanda }, now())
    expect(() => w.Note.answer(q, 'this', as(approver), now())).toThrow('Nanda answers this question')
    w.Note.answer(q, 'this', as(owner), now())
    expect(w.blockers(r, now())).not.toContain('waits for an answer: Which?')
  })

  test('a checkpoint lists the wait for the owner, and the open parts of the task tree', () => {
    const { w, task, maker, owner, as } = world()
    const nandaHere = as(owner)
    w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    const [part] = w.Task.split(task, {
      by: nandaHere, into: [{ id: 'p', name: 'P', aiDescription: { text: 'p' } }], when: now(),
    })
    const cp = w.Checkpoint.save(task, { next: 'ask', when: now() })
    expect(cp.open.pendingApprovals).toEqual([nandaHere])
    expect(cp.open.blockers)
      .toEqual(['no evidence for "It works"', 'no accept yet by a role that decides it'])
    expect(cp.parts.map((p) => p.task)).toEqual([part])
  })

  test('resume compares revisions from each system', () => {
    const { w, task, maker, owner, rule, as } = world()
    const main = { source: 'report_service main', revision: '4ad615b' }
    const done = w.Result.report(task, { by: as(maker), when: now(), output: 'x', madeFrom: [main] })
    w.Review.decide(done, as(owner), now(), 'Accept', proof(rule))
    const cp = w.Checkpoint.save(task, { seenOutside: [main], next: 'go on', when: now() })
    expect(w.Checkpoint.resume(cp, as(owner), now(), [main]).recheck).toEqual([])
    const moved = { source: 'report_service main', revision: '9f8e7d6' }
    expect(w.Checkpoint.resume(cp, as(owner), now(), [moved]).recheck).toEqual([done])
  })
})

describe('CLI extensions: tiers, parents, draft reviews, joins', () => {
  const tiered = () => {
    const all = world()
    const { w, maker } = all
    const high = { role: 'architect', playedBy: 'Opus', tier: 'high', acts: [{ act: 'Approve', resultsOf: [maker] }] }
    const medium = { role: 'lead', playedBy: 'Sonnet', tier: 'medium', acts: [{ act: 'Approve', resultsOf: [maker] }] }
    const medium2 = { role: 'lead2', playedBy: 'Sonnet', tier: 'medium', acts: [{ act: 'Review', resultsOf: [maker] }] }
    maker.tier = 'low'
    w.Workflow.define({ system: 'Tiers', roles: [high, medium, medium2], when: now() })
    return { ...all, high, medium, medium2 }
  }
  const give = (w, role, task, extra = {}) => w.Assignment.give({ role, task, ...extra, when: now() })

  test('a parent assigns only lower tiers (boundary: the same tier is refused)', () => {
    const { w, task, maker, high, medium, medium2 } = tiered()
    const top = give(w, high, task)
    const lead = give(w, medium, task, { parent: top })
    expect(() => give(w, medium2, task, { parent: lead })).toThrow('assigns only lower tiers')
    expect(() => give(w, high, task, { parent: lead })).toThrow('assigns only lower tiers')
    expect(() => give(w, maker, task, { parent: lead })).not.toThrow()
  })

  test('a parent assigns only in its own task tree, and not after it is finished', () => {
    const { w, task, maker, medium, owner } = tiered()
    const lead = give(w, medium, task)
    const other = w.Task.start({ id: 'o', name: 'Other', owner: nanda, when: now() })
    expect(() => give(w, maker, other, { parent: lead })).toThrow('outside the task tree')
    const [part] = w.Task.split(task, {
      into: [{ name: 'Part', aiDescription: { text: 'p' } }],
      by: give(w, owner, task, { actor: nanda }), when: now(),
    })
    expect(() => give(w, maker, part, { parent: lead })).not.toThrow()
    w.Assignment.finish(lead, now())
    expect(() => give(w, maker, task, { parent: lead })).toThrow('parent assignment is finished')
  })

  test('the maker\'s own Raise is not a review by its maker', () => {
    const { w, task, maker, rule, as } = world()
    const terra = as(maker)
    const r = w.Result.report(task, { by: terra, when: now(), output: 'x' })
    w.Review.decide(r, terra, now(), 'Raise', [], 'the brief does not name the region')
    expect(w.blockers(r, now())).not.toContain('reviewed by its maker')
    expect(w.blockers(r, now())).toContain('raised: the brief does not name the region')
    expect(() => w.Review.decide(r, terra, now(), 'Accept', proof(rule))).toThrow('may not review this')
  })

  test('a finished assignment reports nothing more', () => {
    const { w, task, maker, as } = world()
    const terra = as(maker)
    w.Assignment.finish(terra, now())
    expect(() => w.Result.report(task, { by: terra, when: now(), output: 'x' })).toThrow('is finished')
  })

  test('a model does not make its own draft official alone; another actor with a Change act accepts it', () => {
    const { w, task, direction, medium } = tiered()
    const change = [{ act: 'Change', changesOf: [direction] }]
    const changer = { role: 'changer', playedBy: 'Opus', tier: 'high', acts: change }
    const second = { role: 'second changer', playedBy: 'Opus', tier: 'high', acts: change }
    const midChanger = { role: 'medium changer', playedBy: 'Sonnet', tier: 'medium', acts: change }
    w.Workflow.define({ system: 'Change', roles: [changer, second, midChanger], when: now() })
    const me = give(w, changer, task)
    const v = w.Direction.revise(direction, { add: [{ says: 'Short' }], by: me, when: now() })
    expect(() => w.Review.decide(v, me, now(), 'Accept', seen)).toThrow('your own draft')
    // A role with no Change act reviews, but its accept does not make the draft official.
    w.Review.decide(v, give(w, medium, task), now(), 'Accept', seen)
    expect(w.read.madeBy(v)).toBeUndefined()
    // A medium role changes no direction: its Change act does not stand in for the owner.
    w.Review.decide(v, give(w, midChanger, task), now(), 'Accept', seen)
    expect(w.read.madeBy(v)).toBeUndefined()
    w.Review.decide(v, give(w, second, task), now(), 'Accept', seen)
    expect(w.read.madeBy(v).number).toBe(2)
  })

  test('after a Reject by a reviewer, only the accept of the owner makes a draft official', () => {
    const { w, task, direction, medium } = tiered()
    const change = [{ act: 'Change', changesOf: [direction] }]
    const changer = { role: 'changer', playedBy: 'Opus', tier: 'high', acts: change }
    const second = { role: 'second changer', playedBy: 'Opus', tier: 'high', acts: change }
    w.Workflow.define({ system: 'Change', roles: [changer, second], when: now() })
    const me = give(w, changer, task)
    const v = w.Direction.revise(direction, { add: [{ says: 'Short' }], by: me, when: now() })
    w.Review.decide(v, give(w, medium, task), now(), 'Accept', seen)
    w.Review.decide(v, give(w, medium, task), now(), 'Reject', [], 'too vague')
    expect(() => w.Review.decide(v, give(w, second, task), now(), 'Accept', seen))
      .toThrow('only the accept of Nanda makes it official')
    w.Review.decide(v, nanda, now(), 'Accept', seen)
    expect(w.read.madeBy(v).number).toBe(2)
  })

  test('an official draft takes no more reviews', () => {
    const { w, direction, task, medium } = tiered()
    const v = w.Direction.revise(direction, { add: [{ says: 'Short' }], by: suggester, when: now() })
    w.Review.decide(v, nanda, now(), 'Accept', seen)
    expect(() => w.Review.decide(v, give(w, medium, task), now(), 'Accept', seen))
      .toThrow('is official: it made')
  })

  test('a split task needs its parts: its maker starts only when every part is accepted', () => {
    const { w, task, maker, approver, owner, rule, as } = world()
    const [part] = w.Task.split(task, {
      into: [{ name: 'Part', aiDescription: { text: 'p' } }], by: as(owner), when: now(),
    })
    expect(() => as(maker))
      .toThrow('t needs Part (Part), which is not accepted; its maker starts after that')
    const by = w.Assignment.give({ role: maker, task: part, when: now() })
    const p = w.Result.report(part, { by, when: now(), output: 'part' })
    w.Review.decide(p, as(approver), now(), 'Accept', proof(rule))
    expect(w.Task.state(part, now())).toBe('Accepted')
    expect(() => w.Result.report(task, { by: as(maker), when: now(), output: 'whole' })).not.toThrow()
  })

  test('a task that needs another, reopened after its maker started, takes no result', () => {
    const { w, task, maker, approver, owner, rule, as } = world()
    const [part] = w.Task.split(task, {
      into: [{ name: 'Part', aiDescription: { text: 'p' } }], by: as(owner), when: now(),
    })
    const by = w.Assignment.give({ role: maker, task: part, when: now() })
    const p = w.Result.report(part, { by, when: now(), output: 'part' })
    w.Review.decide(p, as(approver), now(), 'Accept', proof(rule))
    const joiner = as(maker)
    w.Review.decide(p, as(approver), now(), 'Reject', [], 'the part misses a case')
    expect(() => w.Result.report(task, { by: joiner, when: now(), output: 'whole' }))
      .toThrow('t needs Part (Part), which is not accepted')
  })

  test('a role can lower its workflow limits (the tier limits of the CLI)', () => {
    const w = createWork()
    const maker = {
      role: 'maker', playedBy: 'Terra', acts: [{ act: 'Do', work: 'x' }], limits: { Result: { size: 10 } },
    }
    w.Workflow.define({ system: 'S', roles: [maker], limits: { Result: { size: 100 } }, when: now() })
    const task = w.Task.start({ id: 't', name: 'T', owner: nanda, when: now() })
    const by = w.Assignment.give({ role: maker, task, when: now() })
    expect(() => w.Result.report(task, { by, when: now(), output: 'x', size: 11 }))
      .toThrow('the limit is 10')
    expect(() => w.Result.report(task, { by, when: now(), output: 'x', size: 10 })).not.toThrow()
  })

  test('the workflow can measure the brief its own way (the printed brief)', () => {
    const w = createWork()
    const maker = { role: 'maker', playedBy: 'Terra', acts: [{ act: 'Do', work: 'x' }] }
    w.Workflow.define({
      system: 'S', roles: [maker], limits: { Assignment: { briefChars: 50 } }, measure: () => 51,
      when: now(),
    })
    const task = w.Task.start({ id: 't', name: 'T', owner: nanda, when: now() })
    expect(() => w.Assignment.give({ role: maker, task, when: now() }))
      .toThrow('has 51 characters; the limit is 50')
  })

  test('the old limit keys at the top of a tier mean nothing to the engine', () => {
    // The limits sit under the part that checks them; a key at the top is not read.
    const { w, task, maker } = world({ limits: { briefChars: 50 } })
    expect(() => w.Assignment.give({ role: maker, task, when: now() })).not.toThrow()
  })

  test('a model writes each draft: the revise of a person is refused', () => {
    const w = createWork()
    const d = w.Direction.start({ name: 'D', says: 's', owner: nanda, by: assess, when: now(), standards: [{ id: 'short', says: 'Be short' }] })
    expect(() => w.Direction.revise(d, { add: [{ id: 'long', says: 'Be long' }], by: nanda, when: now() }))
      .toThrow('the person gives direction in words, as a suggestion about D; a high role writes the draft')
  })

  test('revise names a standard by its id when it has one', () => {
    const w = createWork()
    const d = w.Direction.start({
      name: 'D', says: 's', owner: nanda, by: assess, when: now(),
      standards: [{ id: 'short', says: 'Be short' }],
    })
    const by = suggester
    expect(() => w.Direction.revise(d, { remove: ['Be short'], by, when: now() }))
      .toThrow('has no standard "Be short"')
    expect(() => w.Direction.revise(d, { add: [{ id: 'short', says: 'Other' }], by, when: now() }))
      .toThrow('already has')
    const v = w.Direction.revise(d, {
      replace: [['short', { id: 'short2', says: 'Be very short' }]], by, when: now(),
    })
    expect(v.standards.map((s) => s.id)).toEqual(['short2'])
  })
})

describe('CLI extensions: a Change act on a task', () => {
  test('by may be a plain person: a split, a close, and a remake take it as the owner', () => {
    const { w, task } = world()
    const [part] = w.Task.split(task, {
      into: [{ name: 'Part', aiDescription: { text: 'p' } }], by: nanda, when: now(),
    })
    expect(part.serves).toBe(task)
    const other = w.Task.start({ id: 'o', name: 'Other', owner: nanda, when: now() })
    w.Task.close(other, nanda, now(), 'not needed')
    expect(other.closed.reason).toBe('not needed')
    const again = w.Task.remake(task, {
      input: { id: 't2', name: 'Task again', aiDescription: { text: 'Do less' } },
      by: nanda, when: now(), reason: 'less',
    })
    expect(again.replaces).toBe(task)
  })

  test('covers its parts, and not a task outside its tree', () => {
    const { w, task } = world()
    const architect = { role: 'architect', playedBy: 'Opus', acts: [{ act: 'Change', changesOf: [task] }] }
    w.Workflow.define({ system: 'A', roles: [architect], when: now() })
    const by = w.Assignment.give({ role: architect, task, when: now() })
    const [part] = w.Task.split(task, {
      into: [{ name: 'Part', aiDescription: { text: 'p' } }], by, when: now(),
    })
    expect(() => w.Task.split(part, {
      into: [{ name: 'Sub', aiDescription: { text: 's' } }], by, when: now(),
    })).not.toThrow()
    const other = w.Task.start({ id: 'o', name: 'Other', owner: nanda, when: now() })
    expect(() => w.Task.close(other, by, now(), 'not needed')).toThrow('has no change act on Other')
  })
})

describe('Round 2 fixes', () => {
  const tiered = () => {
    const all = world()
    const { w, direction, maker } = all
    const high = { role: 'architect', playedBy: 'Opus', tier: 'high', acts: [{ act: 'Change', changesOf: [direction] }] }
    const lead = { role: 'lead', playedBy: 'Sonnet', tier: 'medium', acts: [{ act: 'Approve', resultsOf: [maker] }] }
    w.Workflow.define({ system: 'T', roles: [high, lead], when: now() })
    return { ...all, high, lead }
  }

  test('an accept from below the reviser does not count as another actor', () => {
    const { w, task, direction, high, lead } = tiered()
    const me = w.Assignment.give({ role: high, task, when: now() })
    const v = w.Direction.revise(direction, { add: [{ says: 'Short' }], by: me, when: now() })
    const child = w.Assignment.give({ role: lead, task, parent: me, when: now() })
    expect(() => w.Review.decide(v, child, now(), 'Accept', seen)).toThrow('a draft from above you')
    const other = w.Assignment.give({ role: lead, task, when: now() })
    w.Review.decide(v, other, now(), 'Accept', seen)
    expect(w.read.madeBy(v)).toBeUndefined()                       // it needs the owner, or a Change act
    w.Review.decide(v, nanda, now(), 'Accept', seen)
    expect(w.read.madeBy(v).number).toBe(2)
  })

  test('no rule is checked by a person: the person approves directions and standards, not results', () => {
    const w = createWork()
    const rule = { says: 'repeatable', checkedBy: 'Human' }
    expect(() => w.Direction.start({
      name: 'D', says: 's', owner: nanda, by: assess, when: now(),
      standards: [{ says: 'Story', rules: [rule] }],
    })).toThrow('the person approves directions and standards, not results')
  })

  test('a Raise to a person is settled only by that person; a decider never settles its own Raise', () => {
    const { w, task, maker, approver, as } = world()
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    const sol = as(approver)
    const toNanda = w.Review.decide(r, sol, now(), 'Raise', [], 'only Nanda decides', { answerBy: nanda })
    expect(() => w.Review.decide(r, sol, now(), 'Accept', [], 'I decided', { settles: toNanda }))
      .toThrow('may not settle')
    expect(() => w.Review.decide(r, as(approver), now(), 'Accept', [], 'other', { settles: toNanda }))
      .toThrow('may not settle')
    expect(() => w.Review.decide(r, nanda, now(), 'Accept', [], 'ok', { settles: toNanda })).not.toThrow()
    const lead = as(approver)
    const own = w.Review.decide(r, lead, now(), 'Raise', [], 'unsure', { answerBy: lead })
    expect(() => w.Review.decide(r, lead, now(), 'Accept', [], 'mine', { settles: own }))
      .toThrow('may not settle')
  })

  test('an unchanged result does not answer a Reject; a changed one with evidence does', () => {
    const { w, task, maker, approver, rule, as } = world()
    const terra = as(maker)
    const report = (digest) => w.Result.report(task, { by: terra, when: now(), output: 'x', digest })
    const r1 = report('d1')
    const reject = w.Review.decide(r1, as(approver), now(), 'Reject', [], 'bad', { breaks: rule })
    const r2 = report('d1')
    w.Review.decide(r2, as(approver), now(), 'Accept', proof(rule))
    expect(w.read.answered(reject)).toBe(false)
    expect(w.blockers(r2, now())).toEqual(['the same work was rejected: "bad"'])
    const r3 = report('d2')
    w.Review.decide(r3, as(approver), now(), 'Accept', proof(rule))
    expect(w.read.answered(reject)).toBe(true)
  })

  test('a redo Reject (a recheck) is answered by any later result of its task', () => {
    const { w, task, maker, approver, as } = world()
    const terra = as(maker)
    const report = () => w.Result.report(task, { by: terra, when: now(), output: 'x', digest: 'd1' })
    const r1 = report()
    const redo = w.Review.decide(r1, as(approver), now(), 'Reject', [], 'main moved; check again', { redo: true })
    expect(w.read.answered(redo)).toBe(false)
    report()
    expect(w.read.answered(redo)).toBe(true)
  })
})

describe('Round 3 fixes', () => {
  test('a settle decides only a Raise, and never counts as an accept', () => {
    const { w, task, maker, approver, checker, rule, as } = world()
    const r = w.Result.report(task, { by: as(maker), when: now(), output: 'x' })
    const reject = w.Review.decide(r, as(checker), now(), 'Reject', [], 'bad', { breaks: rule })
    expect(() => w.Review.decide(r, as(approver), now(), 'Accept', [], 'ok', { settles: reject }))
      .toThrow('a settle decides a Raise')
    const sol = as(approver)
    const raise = w.Review.decide(r, as(checker), now(), 'Raise', [], 'unsure', { answerBy: sol })
    w.Review.decide(r, sol, now(), 'Accept', proof(rule), 'decided', { settles: raise })
    expect(w.blockers(r, now())).toContain('no evidence for "It works"')   // the settle's evidence does not count
  })

  test('a reviewer below the reviser counts as the reviser', () => {
    const { w, task, direction } = world()
    const high = { role: 'architect', playedBy: 'Opus', tier: 'high', acts: [{ act: 'Change', changesOf: [direction] }] }
    const mid = { role: 'lead', playedBy: 'Sonnet', tier: 'medium', acts: [{ act: 'Change', changesOf: [direction] }] }
    w.Workflow.define({ system: 'T', roles: [high, mid], when: now() })
    const me = w.Assignment.give({ role: high, task, when: now() })
    const v = w.Direction.revise(direction, { add: [{ says: 'Short' }], by: me, when: now() })
    const child = w.Assignment.give({ role: mid, task, parent: me, when: now() })
    expect(() => w.Review.decide(v, child, now(), 'Accept', seen)).toThrow('your own draft')
  })

  test('a revise refuses a rule id that another rule has', () => {
    const w = createWork()
    const start = (name, id, ruleId, says) => w.Direction.start({
      name, says: 's', owner: nanda, by: assess, when: now(),
      standards: [{ id, says: name, rules: [{ id: ruleId, says }] }],
    })
    const a = start('A', 'sa', 'r1', 'one')
    start('B', 'sb', 'r2', 'two')
    const revise = (ruleId, says) => w.Direction.revise(a, {
      add: [{ id: 'new', says: 'N', rules: [{ id: ruleId, says }] }], by: suggester, when: now(),
    })
    expect(() => revise('r2', 'twin')).toThrow('"r2" is already used')
    expect(() => revise('r1', 'twin')).toThrow('"r1" is already used')
    expect(() => revise('r3', 'fresh')).not.toThrow()
  })

  test('a recheck uses no attempt and stops nothing; a fault on the last try still stops the task', () => {
    const { w, task, maker, approver, as } = world()
    const first = as(maker, { maxAttempts: 1 })
    const r = w.Result.report(task, { by: first, when: now(), output: 'x' })
    w.Review.decide(r, as(approver), now(), 'Reject', [], 'main moved', { redo: true })
    expect(w.read.used(first)).toBe(0)                             // a recheck uses no attempt
    expect(w.read.exhaustions).toEqual([])
    expect(w.read.workStop(task, now())).toBeUndefined()
    w.Assignment.finish(first, now())
    expect(w.read.exhaustions).toEqual([])                         // it ended on no fault
    // The next maker works; a later fault on the first maker's result is its last try's fault.
    as(maker, { maxAttempts: 1 })
    w.Review.decide(r, as(approver), now(), 'Reject', [], 'still wrong')
    expect(w.read.exhaustions).toHaveLength(1)
    expect(w.read.workStop(task, now())).toContain('waits for an evaluation')
  })

  test('a needed task is not closed: the needing task is remade, and closed rules move nowhere', () => {
    const { w, task, rule, owner, as } = world()
    const own = { id: 'own', says: 'Own' }
    const d2 = w.Direction.start({
      name: 'Part rules', says: 's', owner: nanda, by: assess, when: now(),
      standards: [{ says: 'P', where: { part: 'x' }, rules: [own] }],
    })
    const [part] = w.Task.split(task, {
      by: as(owner), when: now(),
      into: [{ name: 'Part', aiDescription: { text: 'p', directions: [d2], context: { part: 'x' } } }],
    })
    expect(() => w.Task.close(part, as(owner), now(), 'not needed'))
      .toThrow('t needs Part; without it the scope of t changes: remake t')
    const again = w.Task.remake(task, {
      input: { id: 't2', name: 'Task again', aiDescription: { text: 'Do less' } },
      by: as(owner), when: now(), reason: 'less',
    })
    expect(again.replaces).toBe(task)
    expect([task.closed?.replacedBy, part.closed?.replacedBy]).toEqual([again, again])
    // its own direction stays; the part's rule moves nowhere
    expect(w.read.rulesOf(again)).toEqual([rule])
  })

  test('a raise goes to the nearest open assignment above', () => {
    const { w, task, maker } = world()
    const lead = { role: 'lead', playedBy: 'Sonnet', tier: 'medium', acts: [{ act: 'Approve', resultsOf: [maker] }] }
    const top = { role: 'top', playedBy: 'Opus', tier: 'high', acts: [] }
    w.Workflow.define({ system: 'T', roles: [lead, top], when: now() })
    const give = (role, parent) => w.Assignment.give({ role, task, parent, when: now() })
    const a1 = give(top)
    const a2 = give(lead, a1)
    const a3 = give(maker, a2)
    const r = w.Result.report(task, { by: a3, when: now(), output: 'x' })
    w.Assignment.finish(a2, now())
    expect(w.Review.decide(r, a3, now(), 'Raise', [], 'help').answerBy).toBe(a1)
  })
})

describe('who decides, the attempts, and the needs (the rulings of 2026-11-07)', () => {
  // A writer and its reviewer, and a lead and a tech lead that may both approve writers.
  // by gives the workflow's decide entry for the writer's results; none: any one of them.
  const team = (by) => {
    const w = createWork()
    const writer = { role: 'writer', tier: 'low', playedBy: 'Luna', acts: [{ act: 'Do', work: 'write' }] }
    const reviewer = { role: 'reviewer', tier: 'low', playedBy: 'Luna', acts: [{ act: 'Review', resultsOf: [writer] }] }
    const lead = { role: 'lead', tier: 'medium', playedBy: 'Terra', acts: [{ act: 'Approve', resultsOf: [writer] }] }
    const techlead = { role: 'techlead', tier: 'high', playedBy: 'Sol', acts: [{ act: 'Approve', resultsOf: [writer] }] }
    const roles = { writer, reviewer, lead, techlead }
    w.Workflow.define({
      system: 'Docs', roles: Object.values(roles), when: now(),
      decide: by ? [{ resultsOf: writer, by: by(roles) }] : [],
    })
    const units = { says: 'Numbers have units', checkedBy: reviewer }
    const tsd = w.Direction.start({
      name: 'TSD writing', says: 'Clear TSDs', owner: nanda, by: assess, when: now(),
      standards: [{ says: 'Numbers are clear', rules: [units] }],
    })
    const task = w.Task.start({
      id: 't1', name: 'Introduction', owner: nanda, when: now(),
      aiDescription: { text: 'Write it', directions: [tsd] },
    })
    const as = (role, extra = {}) => w.Assignment.give({ role, task, ...extra, when: now() })
    const person = nanda
    const report = (by, digest) => w.Result.report(task, { by, when: now(), output: 'Introduction', digest })
    const read = [{ at: 'paragraph 1', says: 'the claims are clear' }]
    const evidence = [{ at: 'paragraph 1', says: 'each number has a unit', meets: units }]
    return { w, ...roles, units, tsd, task, as, person, report, read, evidence }
  }

  test('with no decide entry, any one role with an Approve act decides', () => {
    const { w, writer, reviewer, techlead, as, report, read, evidence } = team()
    const r1 = report(as(writer), 'd1')
    w.Review.decide(r1, as(reviewer), now(), 'Accept', evidence)
    expect(w.blockers(r1, now())).toEqual(['no accept yet by a role that decides it'])
    w.Review.decide(r1, as(techlead), now(), 'Accept', read)
    expect(w.blockers(r1, now())).toEqual([])
  })

  test('Or: any one of the deciders accepts', () => {
    const { w, writer, reviewer, lead, as, report, read, evidence } = team((r) => Or([r.lead, r.techlead]))
    const r1 = report(as(writer), 'd1')
    w.Review.decide(r1, as(reviewer), now(), 'Accept', evidence)
    expect(w.blockers(r1, now())).toEqual(['no accept yet by lead or techlead'])
    w.Review.decide(r1, as(lead), now(), 'Accept', read)
    expect(w.blockers(r1, now())).toEqual([])
  })

  test('And: each decider accepts, in any order', () => {
    const { w, writer, reviewer, lead, techlead, as, report, read, evidence } =
      team((r) => And([r.lead, r.techlead]))
    const r1 = report(as(writer), 'd1')
    w.Review.decide(r1, as(reviewer), now(), 'Accept', evidence)
    w.Review.decide(r1, as(techlead), now(), 'Accept', read)
    expect(w.blockers(r1, now())).toEqual(['no accept yet by lead'])
    w.Review.decide(r1, as(lead), now(), 'Accept', read)
    expect(w.blockers(r1, now())).toEqual([])
  })

  test('Order: a later decider decides only after the accept of the one before it', () => {
    const { w, writer, reviewer, lead, techlead, as, report, read, evidence } =
      team((r) => Order([r.lead, r.techlead]))
    const r1 = report(as(writer), 'd1')
    w.Review.decide(r1, as(reviewer), now(), 'Accept', evidence)
    expect(() => w.Review.decide(r1, as(techlead), now(), 'Accept', read))
      .toThrow('techlead decides this result after the accept of lead')
    expect(() => w.Review.decide(r1, as(techlead), now(), 'Reject', [], 'too long'))
      .toThrow('after the accept of lead')
    expect(w.blockers(r1, now())).toEqual(['no accept yet by lead'])
    w.Review.decide(r1, as(lead), now(), 'Accept', read)
    expect(w.blockers(r1, now())).toEqual(['no accept yet by techlead'])
    w.Review.decide(r1, as(techlead), now(), 'Accept', read)
    expect(w.blockers(r1, now())).toEqual([])
  })

  test('decide names each role once, and approvedBy puts the person last in an order', () => {
    expect(() => team((r) => And([r.lead, r.lead])))
      .toThrow('names lead two times; each item needs its own accept')
    const w = createWork()
    const techlead = { role: 'techlead', tier: 'high', playedBy: 'Sol', acts: [] }
    w.Workflow.define({ system: 'Docs', roles: [techlead], when: now() })
    const start = (approvedBy) => w.Direction.start({
      name: 'TSD writing', says: 's', owner: nanda, approvedBy, by: assess, when: now(),
    })
    expect(() => start(Order([nanda, techlead])))
      .toThrow('names Nanda before another item of an order; the person approves last')
    expect(() => start(And([techlead, nanda]))).not.toThrow()
  })

  test('decide names only roles that may approve the maker', () => {
    expect(() => team((r) => Order([r.lead, r.reviewer])))
      .toThrow('decide names reviewer for the results of writer, but reviewer has no Approve act on writer')
  })

  test('the person does not accept a result, and criticises it only after its deciders accepted it', () => {
    const { w, writer, reviewer, lead, as, person, report, read, evidence } = team()
    const r1 = report(as(writer), 'd1')
    w.Review.decide(r1, as(reviewer), now(), 'Accept', evidence)
    expect(() => w.Review.decide(r1, person, now(), 'Accept', read))
      .toThrow('Nanda approves directions and standards; the accept of a role that decides it decides a result')
    expect(() => w.Review.decide(r1, person, now(), 'Reject', [], 'the reader cannot see the cost'))
      .toThrow('this result waits for the accept of a role that decides it; criticise it after its deciders accept it')
    w.Review.decide(r1, as(lead), now(), 'Accept', read)
    expect(() => w.Review.decide(r1, person, now(), 'Reject', [], 'the reader cannot see the cost'))
      .not.toThrow()
  })

  test('a person in a role that reviews the maker is a reviewer: an Accept counts, and a Reject is a fault', () => {
    const w = createWork()
    const writer = { role: 'writer', playedBy: 'Luna', acts: [{ act: 'Do', work: 'write' }] }
    const teammate = { role: 'team reviewer', playedBy: { name: 'Kai' }, acts: [{ act: 'Review', resultsOf: [writer] }] }
    const lead = { role: 'lead', playedBy: 'Terra', acts: [{ act: 'Approve', resultsOf: [writer] }] }
    w.Workflow.define({ system: 'Runtime', roles: [writer, teammate, lead], when: now() })
    const clear = { says: 'The code is clear', checkedBy: teammate }
    const d = w.Direction.start({
      name: 'Code', says: 'Clear code', owner: nanda, by: assess, when: now(),
      standards: [{ says: 'Clear', rules: [clear] }],
    })
    const task = w.Task.start({
      id: 't1', name: 'Fix', owner: nanda, when: now(),
      aiDescription: { text: 'Fix it', directions: [d] },
    })
    const luna = w.Assignment.give({ role: writer, task, maxAttempts: 2, when: now() })
    const kai = w.Assignment.give({ role: teammate, task, actor: { name: 'Kai' }, when: now() })
    const report = (digest) => w.Result.report(task, { by: luna, when: now(), output: 'fix', digest })
    const r1 = report('d1')
    w.Review.decide(r1, kai, now(), 'Reject', [], 'the name says nothing', { breaks: clear })
    expect(w.read.used(luna)).toBe(1)
    const r2 = report('d2')
    w.Review.decide(r2, kai, now(), 'Accept', [
      { at: 'export.go', says: 'the names say what they hold', meets: clear },
    ])
    expect(w.blockers(r2, now())).toEqual(['no accept yet by a role that decides it'])
  })

  test('only a fault uses an attempt: an accepted result, a recheck, and the person\'s criticism use none', () => {
    const { w, task, writer, reviewer, lead, units, as, person, report, read, evidence } = team()
    const luna = as(writer, { maxAttempts: 2 })
    const r1 = report(luna, 'd1')
    expect(w.read.used(luna)).toBe(1)                               // it waits for its review
    w.Review.decide(r1, as(reviewer), now(), 'Reject', [], 'paragraph 2: 500 has no unit', { breaks: units })
    expect(w.read.used(luna)).toBe(1)                               // a fault
    const r2 = report(luna, 'd2')
    w.Review.decide(r2, as(reviewer), now(), 'Accept', evidence)
    w.Review.decide(r2, as(lead), now(), 'Accept', read)
    expect(w.read.used(luna)).toBe(1)
    const criticism = w.Review.decide(r2, person, now(), 'Reject', [], 'the reader cannot see the cost')
    w.Review.decide(r2, as(lead), now(), 'Reject', [], 'main has a new head', { redo: true })
    expect(w.read.used(luna)).toBe(1)
    expect(w.read.exhaustions).toEqual([])
    // The person's criticism is evaluated first (Nanda, 2026-11-08), then the work goes on.
    expect(() => report(luna, 'd3')).toThrow('waits for an evaluation')
    w.Evaluation.write(criticism, {
      by: person, when: now(), wrong: 'the cost is not shown', why: 'no rule asks for the cost',
      improve: ['a rule for the cost'], level: 'standard',
    })
    expect(w.read.stopTask(criticism)).toBe(task)
    expect(() => report(luna, 'd3')).not.toThrow()
  })

  test('an approved change resets the attempts, and a rule that came after a result is not its fault', () => {
    const { w, writer, reviewer, lead, units, tsd, as, report, read, evidence } = team()
    const luna = as(writer, { maxAttempts: 2 })
    const r1 = report(luna, 'd1')
    w.Review.decide(r1, as(reviewer), now(), 'Reject', [], 'paragraph 2: 500 has no unit', { breaks: units })
    const r2 = report(luna, 'd2')
    w.Review.decide(r2, as(reviewer), now(), 'Accept', evidence)
    w.Review.decide(r2, as(lead), now(), 'Accept', read)
    const dates = { says: 'Dates have a day', checkedBy: reviewer }
    const draft = w.Direction.revise(tsd, {
      add: [{ says: 'Dates are exact', rules: [dates] }], by: suggester, when: now(),
    })
    w.Review.decide(draft, nanda, now(), 'Accept', seen)
    expect(w.read.used(luna)).toBe(0)
    w.Review.decide(r2, as(reviewer), now(), 'Reject', [], 'paragraph 4: the date has no day', { breaks: dates })
    expect(w.read.used(luna)).toBe(0)
    expect(w.read.exhaustions).toEqual([])
    w.Assignment.brief(luna, now())                                 // the next attempt reads the new rule
    const r3 = report(luna, 'd3')
    w.Review.decide(r3, as(reviewer), now(), 'Reject', [], 'paragraph 4: still no day', { breaks: dates })
    const r4 = report(luna, 'd4')
    w.Review.decide(r4, as(reviewer), now(), 'Reject', [], 'paragraph 5: no day', { breaks: dates })
    expect(w.read.exhaustions).toHaveLength(1)                     // two faults under the new version
  })
})
