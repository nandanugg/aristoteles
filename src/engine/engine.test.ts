// The engine through its contract: newWork, checkAct (the old words of each refusal) and
// applyAct. The cases of engine.test.js (which stays a test of the old engine) that the stored
// events can say, each refusal of the owner's page, and the owner's rulings (R1, the second
// resolve, the attempts of a reviewer). A case of the old file that the events cannot say (a
// role played by a person, an act with no time, two workflows) is left out; its rule is typed.
import { describe, expect, test } from 'bun:test'
import { Effect, Result } from 'effect'
import { type Agent, human } from '../domain/actor.ts'
import { create, type Event, type ForwardedAct, move } from '../domain/events.ts'
import type { ConfigFile, DirectionFile, RoleFile } from '../domain/files.ts'
import type {
  AssignmentId,
  EvaluationId,
  ExhaustionId,
  PermissionId,
  QuestionId,
  ResultId,
  RevisionId,
  RuleEntry,
  TaskId,
  Time,
} from '../domain/ids.ts'
import type { Assignment, By } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import { type Act, applyAct, checkAct, newWork } from './acts.ts'
import { And, decidersProblem, Or, Order } from './deciders.ts'
import {
  answered,
  draftWaitsFor,
  evaluationWaits,
  findNotes,
  madeBy,
  openEscalations,
  resultsOf,
  rulesOf,
  workStop,
} from './queries.ts'
import { blockerItems, taskAccepted, taskState, used } from './status.ts'

// --- the world ----------------------------------------------------------------------------------

const nanda = human('Nanda')
const kai = human('Kai')
// A model run outside any task (the skill that reads an app) drafts a new direction; another
// one only revises.
const assess: Agent = { _tag: 'Agent', name: 'assess', run: 'assess-1' }
const suggester: Agent = { _tag: 'Agent', name: 'Suggester', run: 'suggester-1' }

const role = (tier: 'low' | 'medium' | 'high', acts: RoleFile['acts']): RoleFile => ({
  kind: 'agent',
  tier,
  description: 'd',
  intro: 'i',
  responsibilities: [],
  acts,
  checks: [],
})
const ROLES: Readonly<Record<string, RoleFile>> = {
  maker: role('medium', [{ do: 'make it' }]),
  checker: role('low', [{ review: ['maker'] as never }]),
  peer: role('medium', [{ review: ['maker'] as never }]),
  approver: role('high', [{ approve: ['maker'] as never }]),
  outsider: role('low', [{ review: [] }]),
  // A role that makes and reviews its own kind: one run is one actor.
  solo: role('medium', [{ do: 'make it' }, { review: ['solo'] as never }]),
  // A high role that reviews the maker, and decides nothing.
  architect: role('high', [{ review: ['maker'] as never }]),
}

interface Options {
  readonly roles?: Readonly<Record<string, RoleFile>>
  readonly limits?: ConfigFile['limits']
  readonly decide?: ConfigFile['decide']
  readonly rule?: Partial<DirectionFile['standards'][number]['rules'][number]>
  readonly context?: Readonly<Record<string, string>>
  readonly maxStandards?: number
}

let ticks = 0
const T0 = Date.UTC(2026, 10, 8)
const HOUR = 3600 * 1000

// One dir: its Work, its clock, and each act through the check and the apply.
class World {
  work: Work
  seq = 1
  measure = 0
  constructor(options: Options = {}) {
    const config = {
      project: 'runtime',
      people: ['Nanda'],
      limits: options.limits ?? { low: {}, medium: {}, high: {} },
      roles: options.roles ?? ROLES,
      decide: options.decide ?? {},
    } as ConfigFile
    const defined = create('Workflow', { _tag: 'Defined', config, hashes: {}, texts: {} })
    const at = this.now()
    const work = newWork(defined as never, 'Nanda', at)
    const author = { _tag: 'Person', name: 'Nanda', channel: 'terminal' } as const
    this.work = {
      ...work,
      events: [{ recorded: { seq: 1, at, author, event: defined } as never, created: [] }],
    }
  }
  now(): Time {
    return new Date(T0 + ++ticks * 1000).toISOString() as Time
  }
  wait(ms: number): void {
    ticks += ms / 1000
  }
  // The act, checked and applied; a refusal throws its words.
  act(by: By, event: Event | ForwardedAct, when: Time = this.now()): ReadonlyArray<string> {
    const seq = ++this.seq
    const act: Act = { event: event as Act['event'], by, when, seq }
    const ctx = {
      now: when,
      cwd: '/work',
      changed: () => Effect.succeed(false),
      measure: () => this.measure,
    }
    const checked = Effect.runSync(Effect.result(checkAct(this.work, act, ctx)))
    if (Result.isFailure(checked)) throw new Error(checked.failure.message)
    const stepped = applyAct(this.work, act)
    const recorded = { seq, at: when, author: { _tag: 'System' }, event } as never
    this.work = {
      ...stepped.work,
      events: [...this.work.events, { recorded, created: stepped.created }],
    }
    return stepped.created
  }
  first(by: By, event: Event | ForwardedAct): string {
    return this.act(by, event)[0] ?? ''
  }
}

const NONE = { _tag: 'NoneGiven' } as const
const directionFile = (o: Options): DirectionFile => ({
  id: 'craft' as never,
  name: 'Craft',
  owner: 'Nanda',
  from: [],
  says: 'Do it well',
  ...(o.maxStandards === undefined ? {} : { maxStandards: o.maxStandards }),
  standards: [
    {
      id: 'well',
      says: 'It is done well',
      rules: [{ id: 'works', says: 'It works', supersedes: [], ...o.rule }],
    },
  ],
})
const drafted = (direction: DirectionFile, answers: ReadonlyArray<string> = []) =>
  create('Revision', { _tag: 'Drafted', direction, answers: answers as never, why: NONE })
const revised = (direction: string, edit: object, answers: ReadonlyArray<string> = []) =>
  create('Revision', {
    _tag: 'Revised',
    direction: direction as never,
    edit,
    answers: answers as never,
    why: NONE,
  })
const add = (
  says: string,
  rules: ReadonlyArray<object> = [],
  id = says.toLowerCase().replace(/\W+/g, '-'),
) => revised('craft', { add: [{ id, says, rules: rules.map((r) => ({ supersedes: [], ...r })) }] })
const acceptDraft = (id: string, evidence: ReadonlyArray<object> = []) =>
  create('Review', {
    _tag: 'Accept',
    of: { _tag: 'Revision', id: id as RevisionId, evidence: evidence as never },
    reason: null,
  })
const rejectDraft = (id: string, reason: string) =>
  create('Review', {
    _tag: 'Reject',
    of: { _tag: 'Revision', id: id as RevisionId, reason: reason as never },
  })
const seen = [{ rule: null, where: 'the draft', what: 'it reads well' }]
const proof = (rule = 'works', where = 'run 1') => [{ rule, where, what: 'seen' }]

const opened = (task: object = {}) =>
  create('Task', {
    _tag: 'Opened',
    task: {
      name: 'Task',
      text: 'Do it',
      directions: ['craft' as never],
      context: {},
      needs: [],
      from: null,
      workspace: [],
      references: [],
      ...task,
    },
  })
const given = (w: World, role: string, task: string, max: number | null = null) =>
  w.work.workflow.roles.get(role as never)?.acts.some((a) => a._tag === 'Do')
    ? create('Assignment', {
        _tag: 'GivenMaker',
        task: task as TaskId,
        role: role as never,
        secret: 's',
        maxAttempts: max as never,
      })
    : create('Assignment', {
        _tag: 'GivenReviewer',
        task: task as TaskId,
        role: role as never,
        secret: 's',
      })
const report = (size = 1, digest = `d${ticks}`) =>
  create('Result', {
    _tag: 'Result',
    output: 'x',
    madeFrom: [],
    work: { _tag: 'File', digest, size },
    files: [],
    after: null,
  })
const accept = (r: string, evidence: ReadonlyArray<object> = proof()) =>
  create('Review', {
    _tag: 'Accept',
    of: { _tag: 'Result', id: r as ResultId, evidence: evidence as never },
    reason: null,
  })
const reject = (r: string, ...points: ReadonlyArray<readonly [string, string?]>) =>
  create('Review', {
    _tag: 'Reject',
    of: {
      _tag: 'Result',
      id: r as ResultId,
      points: points.map(([text, breaks]) => ({ text, breaks: breaks ?? null })) as never,
    },
  })
const rejectTask = (t: string, text: string) =>
  create('Review', {
    _tag: 'Reject',
    of: { _tag: 'Task', id: t as TaskId, points: [{ text }] as never },
  })
const recheck = (r: string, reason: string) =>
  create('Review', { _tag: 'Recheck', of: r as ResultId, reason: reason as never })
const escalate = (r: string, reason: string) =>
  create('Review', { _tag: 'Escalate', of: r as ResultId, reason: reason as never })
const resolve = (escalation: string, resolution: string, evidence: ReadonlyArray<object> = []) =>
  create('Review', {
    _tag: 'Resolve',
    escalation: escalation as never,
    resolution: resolution as never,
    evidence: evidence as never,
  })
const brief = (a: string) => move('Assignment', a as AssignmentId, { _tag: 'Briefed' })
const finish = (a: string) => move('Assignment', a as AssignmentId, { _tag: 'Finished' })
const grant = (act: object, to: string, until: Time) =>
  create('Permission', { _tag: 'Granted', act: act as never, to: to as never, until })
const evaluate = (stop: object, level = 'task') =>
  create('Evaluation', {
    _tag: 'Evaluation',
    stop: stop as never,
    wrong: 'wrong',
    why: 'why',
    improve: ['improve'],
    level: level as never,
  })
const after = (when: Time, ms: number) => new Date(Date.parse(when) + ms).toISOString() as Time

// A small world: one direction (one standard, one rule) that its owner made official, one task.
const world = (options: Options = {}) => {
  const w = new World(options)
  w.act(assess, drafted(directionFile(options)))
  w.act(nanda, acceptDraft('d1'))
  const context = options.context ?? {}
  w.act(nanda, opened({ context }))
  const as = (role: string, by: By = nanda, max: number | null = null) =>
    w.first(by, given(w, role, 't1', max)) as AssignmentId
  return { w, as, task: 't1' as TaskId }
}
const RULE = 'd1/well/works' as RuleEntry
const blocks = (w: World, r: string) =>
  blockerItems(w.work, r as ResultId, w.now()).map((b) => b._tag)

// --- the cases -----------------------------------------------------------------------------------

describe('actors and workflow', () => {
  test('a time before the last act of the engine is refused; the same time passes', () => {
    const { w } = world()
    const last = w.now()
    w.act(nanda, opened({ name: 'Two' }), last)
    expect(() => w.act(nanda, opened({ name: 'Three' }), after(last, -1000))).toThrow(
      `comes before the last act, at ${last}`,
    )
    expect(() => w.act(nanda, opened({ name: 'Four' }), last)).not.toThrow()
  })

  test('two runs of one model are two actors, so they can review each other', () => {
    const { w, as } = world()
    const terra = as('maker')
    const r = w.first(terra, report())
    w.act(as('peer'), accept(r))
    expect<unknown>(blocks(w, r)).not.toContain('Maker')
  })

  test('one run is one actor: it does not review its own result', () => {
    const w = new World()
    w.act(assess, drafted(directionFile({})))
    w.act(nanda, acceptDraft('d1'))
    w.act(nanda, opened())
    const solo = w.first(nanda, given(w, 'solo', 't1')) as AssignmentId
    const r = w.first(solo, report())
    w.act(solo, accept(r))
    expect<unknown>(blocks(w, r)).toContain('Maker')
  })

  test('only a role with a Do act reports, and only on the task of its assignment', () => {
    const { w, as } = world()
    const c = as('checker')
    expect(() => w.act(c, report())).toThrow(`${c} (checker) has no Do act`)
  })

  test('one open Do assignment on a task at a time', () => {
    const { w, as } = world()
    const first = as('maker', nanda, 1)
    expect(() => as('maker')).toThrow('Task already has an open Do assignment')
    w.act(first, report()) // its one attempt is used
    expect(() => as('maker')).not.toThrow()
  })

  test('finish ends a Do assignment early', () => {
    const { w, as } = world()
    const first = as('maker')
    w.act(nanda, finish(first))
    expect(() => as('maker')).not.toThrow()
  })
})

describe('permissions (the CLI words: grant and revoke)', () => {
  const change = (d: string) => ({ _tag: 'Change', changesOf: [d] })

  test('nobody gives more than they may do, a model included', () => {
    const { w, as } = world()
    const until = after(w.now(), HOUR)
    // A model has only the acts of its assignment: Approve results, not Change a direction.
    const sol = as('approver')
    expect(() => w.act(sol, grant(change('craft'), 'approver', until))).toThrow(
      `${sol} (approver) may not give this act`,
    )
    expect(() => w.act(kai, grant(change('craft'), 'approver', until))).toThrow(
      'Kai may not give this act',
    )
    expect(() => w.act(nanda, grant(change('craft'), 'approver', until))).not.toThrow()
    expect(() => w.act(nanda, grant(change('nothing'), 'approver', until))).toThrow(
      '"nothing" is not a task id (t..)',
    )
    expect(() =>
      w.act(nanda, grant({ _tag: 'Approve', resultsOf: ['ghost'] }, 'approver', until)),
    ).toThrow('there is no role "ghost"')
  })

  test(
    'a permission ends at its until (boundary: exactly until counts), and can be ' + 'revoked',
    () => {
      const { w, as } = world()
      const sol = as('approver')
      const until = after(w.now(), HOUR)
      w.act(nanda, grant(change('craft'), 'approver', until))
      w.act(suggester, add('A'))
      w.act(sol, acceptDraft('d2', seen), until) // exactly at its until
      expect<unknown>(madeBy(w.work, 'd2' as RevisionId)).toBeDefined()
      w.wait(2 * HOUR)
      w.act(suggester, add('B'))
      w.act(sol, acceptDraft('d3', seen))
      expect<unknown>(madeBy(w.work, 'd3' as RevisionId)).toBeUndefined()
      // A new grant works until its revoke; the acts before the revoke stay.
      const night = w.first(nanda, grant(change('craft'), 'approver', after(w.now(), HOUR)))
      w.act(suggester, add('C'))
      w.act(sol, acceptDraft('d4', seen))
      expect<unknown>(madeBy(w.work, 'd4' as RevisionId)).toBeDefined()
      w.act(nanda, move('Permission', night as PermissionId, { _tag: 'Revoked' }))
      w.act(suggester, add('D'))
      w.act(sol, acceptDraft('d5', seen))
      expect<unknown>(madeBy(w.work, 'd5' as RevisionId)).toBeUndefined()
    },
  )

  test('only the giver revokes, and only once', () => {
    const { w } = world()
    const x = w.first(
      nanda,
      grant(change('craft'), 'approver', after(w.now(), HOUR)),
    ) as PermissionId
    const revoke = move('Permission', x, { _tag: 'Revoked' })
    expect(() => w.act(kai, revoke)).toThrow('only the giver revokes a permission')
    const at = w.now()
    w.act(nanda, revoke, at)
    expect(() => w.act(nanda, revoke)).toThrow(`this permission is already revoked, at ${at}`)
  })
})

describe('a direction', () => {
  test('a model drafts a new direction; a person gives direction in words', () => {
    const w = new World()
    expect(() => w.act(kai, drafted(directionFile({})))).toThrow(
      'the person gives direction in words, as a suggestion about Craft: work suggest <direction, ' +
        'standard, or rule> --says="<the change>"; a high role writes the draft',
    )
    expect(() => w.act(assess, drafted(directionFile({})))).not.toThrow()
  })

  test('a suggestion is about a direction, a standard or a rule of an official version', () => {
    const { w } = world()
    const about = (a: object) =>
      create('Suggestion', { _tag: 'Suggestion', about: a as never, says: 'cannot be met' })
    expect<unknown>(w.act(nanda, about({ _tag: 'Rule', key: 'works' }))).toEqual(['s1'])
    expect(() => w.act(nanda, about({ _tag: 'Rule', key: 'none' }))).toThrow(
      'there is no rule "none" in an official version',
    )
    expect<unknown>(w.work.suggestions.get('s1' as never)?.about).toEqual({
      _tag: 'Rule',
      rule: RULE,
    })
    // One about nothing asks for a new direction; a draft of another direction does not answer it.
    w.act(suggester, about({ _tag: 'NewDirection' }))
    expect(() =>
      w.act(
        suggester,
        revised('craft', { add: [{ id: 'reels', says: 'Reels', rules: [] }] }, ['s2']),
      ),
    ).toThrow('"cannot be met" asks for a new direction; a draft of Craft does not answer it')
    const reels = { ...directionFile({}), id: 'reels' as never, name: 'Reels', standards: [] }
    w.act(suggester, drafted(reels, ['s2']))
    w.act(as(w, 'approver'), acceptDraft('d2', seen))
    // A new direction needs its owner.
    expect<unknown>(madeBy(w.work, 'd2' as RevisionId)).toBeUndefined()
    w.act(nanda, acceptDraft('d2'))
    expect<unknown>(madeBy(w.work, 'd2' as RevisionId)?.number).toBe(1)
  })

  test('a draft changes nothing until it is official', () => {
    const { w, as } = world()
    const r = w.first(as('maker'), report())
    w.act(suggester, add('New', [{ id: 'new', says: 'New rule' }]))
    expect<unknown>(blocks(w, r)).toEqual(['Evidence', 'DeciderAnyApprover'])
  })

  test(
    'only the accept of the owner, or of a role with a Change act on it, makes a draft ' +
      'official',
    () => {
      const { w, as } = world()
      const sol = as('approver')
      w.act(suggester, add('More'))
      w.act(sol, acceptDraft('d2', seen)) // it reviews, but does not decide
      expect<unknown>(madeBy(w.work, 'd2' as RevisionId)).toBeUndefined()
      expect<unknown>(draftWaitsFor(w.work, 'd2' as RevisionId)).toEqual([nanda])
      w.act(nanda, acceptDraft('d2'))
      expect<unknown>(madeBy(w.work, 'd2' as RevisionId)?.number).toBe(2)
      w.act(
        nanda,
        grant({ _tag: 'Change', changesOf: ['craft'] }, 'approver', after(w.now(), HOUR)),
      )
      w.act(suggester, add('Even more'))
      w.act(sol, acceptDraft('d3', seen))
      expect<unknown>(madeBy(w.work, 'd3' as RevisionId)?.number).toBe(3)
    },
  )

  test('the spirit changes only with the accept of a person, even with a permission', () => {
    const { w, as } = world()
    const sol = as('approver')
    w.act(nanda, grant({ _tag: 'Change', changesOf: ['craft'] }, 'approver', after(w.now(), HOUR)))
    w.act(suggester, revised('craft', { says: 'Do it fast' }))
    expect(() => w.act(sol, acceptDraft('d2', seen))).toThrow(
      'd2 changes what Craft says; a new spirit needs the accept of Nanda',
    )
    w.act(nanda, acceptDraft('d2'))
    expect<unknown>(madeBy(w.work, 'd2' as RevisionId)?.says).toBe('Do it fast')
  })

  test('no lost update: a draft built on an old version, or accepted twice, is refused', () => {
    const { w } = world()
    w.act(suggester, add('A'))
    w.act(suggester, add('B'))
    w.act(nanda, acceptDraft('d2'))
    expect(() => w.act(nanda, acceptDraft('d3'))).toThrow(
      'd3 is built on Craft v1, an old version; its reviser revises the current one',
    )
    expect(() => w.act(kai, acceptDraft('d2'))).toThrow('d2 is official: it made Craft v2')
  })

  test(
    'a draft names only standards that exist, and adds no second standard with the same ' + 'id',
    () => {
      const { w } = world()
      expect(() => w.act(suggester, revised('craft', { remove: ['none'] }))).toThrow(
        'Craft has no standard "none"',
      )
      expect(() => w.act(suggester, add('It is done well', [], 'well'))).toThrow(
        'Craft already has the standard "well"',
      )
      expect(() => w.act(suggester, revised('ghost', { says: 'x' }))).toThrow(
        'there is no direction "ghost"',
      )
    },
  )

  test(
    'a direction with a size limit refuses one more standard (boundary: exactly the ' + 'limit)',
    () => {
      const { w } = world({ maxStandards: 2 })
      w.act(suggester, add('two'))
      w.act(nanda, acceptDraft('d2'))
      expect(() => w.act(suggester, add('three'))).toThrow(
        'Craft would have 3 standards; the limit is 2: remove or merge one',
      )
    },
  )

  test('a newer rule that supersedes an older one removes it (the newer rule wins)', () => {
    const { w, as } = world()
    w.act(
      suggester,
      add('Local', [{ id: 'local', says: 'It works locally', supersedes: ['works'] }]),
    )
    w.act(nanda, acceptDraft('d2'))
    expect<unknown>(rulesOf(w.work, 't1' as TaskId).map((r) => r.id)).toEqual(['local'])
    expect(() =>
      w.act(suggester, add('Self', [{ id: 'self', says: 's', supersedes: ['self'] }])),
    ).toThrow('rule self supersedes itself')
    expect(() =>
      w.act(suggester, add('Gone', [{ id: 'g', says: 's', supersedes: ['nothing'] }])),
    ).toThrow('rule g supersedes "nothing", which is not in the current version')
    void as
  })

  test(
    'a suggestion is answered at its level: a rule with its standard, the direction with what ' +
      'it says',
    () => {
      const { w } = world()
      const about = (a: object) =>
        create('Suggestion', { _tag: 'Suggestion', about: a as never, says: 'cannot be met' })
      w.act(nanda, about({ _tag: 'Rule', key: 'works' }))
      expect(() =>
        w.act(
          suggester,
          revised('craft', { add: [{ id: 'other', says: 'Other', rules: [] }] }, ['s1']),
        ),
      ).toThrow('a suggestion about the rule "It works" is answered by a change of its standard')
      const replaced = {
        replace: [
          {
            id: 'well',
            with: {
              id: 'well',
              says: 'It is done well',
              rules: [{ id: 'works', says: 'It works locally', supersedes: [] }],
            },
          },
        ],
      }
      expect(() => w.act(suggester, revised('craft', replaced, ['s1']))).not.toThrow()
      w.act(nanda, about({ _tag: 'Direction', direction: 'craft' }))
      expect(() =>
        w.act(suggester, revised('craft', { add: [{ id: 'x', says: 'X', rules: [] }] }, ['s2'])),
      ).toThrow('"cannot be met" is about Craft itself; a change of what it says answers it')
      expect(() =>
        w.act(suggester, revised('craft', { says: 'Do it slowly' }, ['s2'])),
      ).not.toThrow()
    },
  )

  test('a Reject of a result is answered only by a real change in a direction of its task', () => {
    const { w, as } = world()
    const r = w.first(as('maker'), report())
    w.act(as('approver'), reject(r, ['wrong']))
    const other = { ...directionFile({}), id: 'other' as never, name: 'Other', standards: [] }
    w.act(assess, drafted(other))
    w.act(nanda, acceptDraft('d2'))
    expect(() =>
      w.act(suggester, revised('other', { add: [{ id: 'y', says: 'Y', rules: [] }] }, ['v2'])),
    ).toThrow('Other is not a direction of Task, so it cannot answer "wrong"')
    expect(() => w.act(suggester, revised('craft', {}, ['v2']))).toThrow(
      'this change of Craft says the same to t1 as before, so it cannot answer "wrong"',
    )
    w.act(suggester, revised('craft', { add: [{ id: 'y', says: 'Y', rules: [] }] }, ['v2']))
    // A draft answers when it is official.
    expect<unknown>(answered(w.work, 'v2.1' as never)).toBe(false)
    w.act(nanda, acceptDraft('d3'))
    expect<unknown>(answered(w.work, 'v2.1' as never)).toBe(true)
  })

  test(
    'a change for another section does not answer the Reject of a task, nor make a result ' + 'old',
    () => {
      const onlyC = { add: [{ id: 'only-c', says: 'Only C', where: { section: 'C' }, rules: [] }] }
      const rejected = world({ context: { section: 'A' } })
      const no = rejected.w.first(nanda, rejectTask('t1', 'wrong'))
      rejected.w.act(nanda, evaluate({ _tag: 'PersonReject', id: no }))
      expect(() => rejected.w.act(suggester, revised('craft', onlyC, [no]))).toThrow(
        'this change of Craft says the same to t1 as before, so it cannot answer "wrong"',
      )
      const { w, as } = world({ context: { section: 'A' } })
      const sol = as('approver')
      const r = w.first(as('maker'), report())
      w.act(sol, accept(r))
      w.act(suggester, revised('craft', onlyC))
      w.act(nanda, acceptDraft('d2'))
      expect<unknown>(blocks(w, r)).toEqual([])
      // A standard that now applies: nothing to check again, but the decider accepts again.
      w.act(suggester, add('Everywhere'))
      w.act(nanda, acceptDraft('d3'))
      expect<unknown>(blocks(w, r)).toEqual(['DeciderAcceptedUnderOld'])
    },
  )

  test(
    'a lesson stays official while its text is in the current version; find hides replaced ' +
      'ones',
    () => {
      const { w } = world()
      w.act(suggester, add('Pin first'))
      w.act(nanda, acceptDraft('d2'))
      expect<unknown>(findNotes(w.work, 'pin first', false).map((f) => f.status)).toEqual([
        'Official',
      ])
      w.act(suggester, revised('craft', { remove: ['pin-first'] }))
      w.act(nanda, acceptDraft('d3'))
      expect<unknown>(findNotes(w.work, 'pin first', false)).toEqual([])
      expect<unknown>(findNotes(w.work, 'pin first', true).map((f) => f.status)).toEqual([
        'Replaced',
      ])
    },
  )

  test('a standard applies where its where matches the task context', () => {
    const cases: ReadonlyArray<readonly [object | undefined, Record<string, string>, boolean]> = [
      [undefined, { section: 'A' }, true],
      [{ section: 'A' }, { section: 'A', system: 'Docs' }, true],
      [{ section: 'A', system: 'Runtime' }, { section: 'A', system: 'Docs' }, false],
      [{ section: 'A' }, {}, false],
    ]
    for (const [where, context, applies] of cases) {
      const w = new World()
      const file = directionFile({})
      const standard = { ...file.standards[0], ...(where ? { where } : {}) }
      w.act(assess, drafted({ ...file, standards: [standard as never] }))
      w.act(nanda, acceptDraft('d1'))
      w.act(nanda, opened({ context }))
      expect<unknown>(rulesOf(w.work, 't1' as TaskId).length > 0).toBe(applies)
    }
  })
})

const as = (w: World, role: string, by: By = nanda) =>
  w.first(by, given(w, role, 't1')) as AssignmentId

describe('the review of a draft', () => {
  test('a model accepts a draft with evidence; the person needs none', () => {
    const { w } = world()
    const sol = as(w, 'approver')
    w.act(suggester, add('More'))
    expect(() => w.act(sol, acceptDraft('d2', [{ rule: null, where: '', what: 'fine' }]))).toThrow(
      'an accept of d2 says where it read in the draft and what it saw: give evidence',
    )
    expect(() => w.act(sol, acceptDraft('d2', seen))).not.toThrow()
  })

  test('the reviser reviews its own draft never, and nobody reviews twice', () => {
    const { w } = world()
    w.act(suggester, add('More'))
    expect(() => w.act(suggester, acceptDraft('d2', seen))).toThrow(
      'd2 is your own draft, or a draft from above you; another actor reviews it',
    )
    const sol = as(w, 'approver')
    w.act(sol, acceptDraft('d2', seen))
    expect(() => w.act(sol, acceptDraft('d2', seen))).toThrow(
      `${sol} (approver) already reviewed d2`,
    )
  })

  test(
    'a Reject by a decider ends the draft; its reviser revises the current version ' + 'again',
    () => {
      const { w } = world()
      w.act(suggester, add('More'))
      w.act(nanda, rejectDraft('d2', 'not this'))
      expect(() => w.act(as(w, 'approver'), acceptDraft('d2', seen))).toThrow(
        'd2 is ended by the Reject of Nanda: not this; ' +
          'its reviser revises the current version again',
      )
    },
  )

  test('after a Reject by a reviewer, only the accept of the owner makes a draft official', () => {
    const { w } = world()
    w.act(nanda, grant({ _tag: 'Change', changesOf: ['craft'] }, 'approver', after(w.now(), HOUR)))
    w.act(suggester, add('More'))
    const checker = as(w, 'checker')
    w.act(checker, rejectDraft('d2', 'unclear'))
    expect(() => w.act(as(w, 'approver'), acceptDraft('d2', seen))).toThrow(
      `d2 has the Reject of ${checker} (checker); after it, only the accept of Nanda makes it ` +
        `official`,
    )
    w.act(nanda, acceptDraft('d2'))
    expect<unknown>(madeBy(w.work, 'd2' as RevisionId)?.number).toBe(2)
  })

  test('approvedBy: a draft waits for the accepts in its order', () => {
    const w = new World()
    const file = { ...directionFile({}), approvedBy: { order: ['approver', 'Nanda'] } }
    w.act(assess, drafted(file))
    w.act(nanda, acceptDraft('d1'))
    w.act(nanda, opened())
    w.act(suggester, add('More'))
    expect(() => w.act(nanda, acceptDraft('d2'))).toThrow(
      'Nanda reviews d2 after the accept of approver',
    )
    w.act(as(w, 'approver'), acceptDraft('d2', seen))
    expect<unknown>(draftWaitsFor(w.work, 'd2' as RevisionId)).toEqual([nanda])
    w.act(nanda, acceptDraft('d2'))
    expect<unknown>(madeBy(w.work, 'd2' as RevisionId)?.number).toBe(2)
    expect(() =>
      w.act(
        assess,
        drafted({ ...file, id: 'two' as never, approvedBy: { order: ['Nanda', 'approver'] } }),
      ),
    ).toThrow(
      'approvedBy of Craft names Nanda before another item of an order; the person approves last',
    )
    expect(() =>
      w.act(assess, drafted({ ...file, id: 'three' as never, approvedBy: 'Kai' })),
    ).toThrow('approvedBy of Craft names Kai, who is not its owner; the owner approves')
  })

  test('a reviewer below the reviser counts as the reviser', () => {
    const { w } = world()
    w.act(nanda, grant({ _tag: 'Change', changesOf: ['craft'] }, 'approver', after(w.now(), HOUR)))
    const sol = as(w, 'approver')
    w.act(sol, add('More'))
    const below = w.first(sol, given(w, 'checker', 't1')) as AssignmentId
    expect(() => w.act(below, acceptDraft('d2', seen))).toThrow(
      'd2 is your own draft, or a draft from above you',
    )
    expect(() => w.act(nanda, add('Mine'))).toThrow('the person gives direction in words')
  })

  test('a revise refuses a rule id that another rule has', () => {
    const { w } = world()
    expect(() => w.act(suggester, add('Again', [{ id: 'works', says: 'Another' }]))).toThrow(
      'the rule id "works" is already used; a new rule needs a new id',
    )
  })

  test('no rule is checked by a person: the person approves directions and standards', () => {
    const { w } = world()
    expect(() =>
      w.act(suggester, add('Human', [{ id: 'h', says: 'h', checkedBy: 'Human' }])),
    ).toThrow(
      'rule h is checked by Human; the person approves directions and standards, not results',
    )
  })
})

describe('the snapshot of a brief', () => {
  test(
    'a result follows the versions of the last brief; a change during the attempt makes it ' +
      'old',
    () => {
      const { w, as: give } = world()
      const terra = give('maker')
      w.act(terra, brief(terra))
      w.act(suggester, add('New', [{ id: 'new', says: 'New rule' }]))
      w.act(nanda, acceptDraft('d2'))
      const r = w.first(terra, report())
      expect<unknown>(blocks(w, r)[0]).toBe('OldVersion')
      w.act(terra, brief(terra))
      const r2 = w.first(terra, report())
      expect<unknown>(blocks(w, r2)).not.toContain('OldVersion')
    },
  )
})

describe('a task', () => {
  test('a split needs the owner or a change act, and each part its own text', () => {
    const { w, as: give } = world()
    const split = (parts: ReadonlyArray<object>) =>
      move('Task', 't1' as TaskId, { _tag: 'Split', parts: parts as never, review: null })
    const c = give('checker')
    expect(() => w.act(c, split([{ name: 'A', text: 'a' }]))).toThrow(
      `${c} (checker) has no change act on Task`,
    )
    expect(() => w.act(nanda, split([{ name: 'A', text: '' }]))).toThrow(
      'each smaller task needs its own text',
    )
    expect(() =>
      w.act(
        nanda,
        split([
          { name: 'A', text: 'a' },
          { name: 'A', text: 'b' },
        ]),
      ),
    ).toThrow('two parts are named A; each part needs its own name')
    expect(() => w.act(nanda, split([{ name: 'A', text: 'a', after: ['B'] }]))).toThrow(
      'part A: after names "B", which is not a part above it in this split',
    )
    expect<unknown>(
      w.act(
        nanda,
        split([
          { name: 'A', text: 'a' },
          { name: 'B', text: 'b', after: ['A'] },
        ]),
      ),
    ).toEqual(['t2', 't3'])
    expect<unknown>(w.work.tasks.get('t3' as TaskId)?.needs).toEqual(['t2'])
    expect<unknown>(w.work.tasks.get('t1' as TaskId)?.needs).toEqual(['t2', 't3'])
    expect(() => w.act(nanda, split([{ name: 'C', text: 'c' }]))).toThrow(
      't1 already has parts; split a part, or remake t1',
    )
  })

  test('close needs the owner or a change act; a needed task is not closed', () => {
    const { w, as: give } = world()
    const close = (t: string) => move('Task', t as TaskId, { _tag: 'Closed', reason: 'done' })
    const c = give('checker')
    expect(() => w.act(c, close('t1'))).toThrow(`${c} (checker) has no change act on Task`)
    w.act(nanda, opened({ name: 'Needer', needs: ['t1'] }))
    expect(() => w.act(nanda, close('t1'))).toThrow(
      't2 needs t1; without it the scope of t2 changes: remake t2',
    )
    expect(() => w.act(nanda, opened({ name: 'Bad', needs: ['t9'] }))).toThrow(
      'there is no task t9',
    )
    w.act(nanda, close('t2'))
    expect(() => w.act(nanda, opened({ name: 'Bad', needs: ['t2'] }))).toThrow(
      't2 is closed; a task does not need a closed task',
    )
    w.act(nanda, close('t1'))
    expect<unknown>(taskState(w.work, 't1' as TaskId, w.now())).toEqual({ _tag: 'Closed' })
  })

  test('a closed, a returned, or an accepted task takes no new result', () => {
    const { w, as: give } = world()
    const terra = give('maker')
    const sol = give('approver')
    const r = w.first(terra, report())
    w.act(sol, accept(r))
    expect(() => w.act(terra, report())).toThrow(
      'Task is accepted; a Reject or a change reopens it',
    )
    const no = w.first(nanda, rejectTask('t1', 'not what I asked'))
    expect(() => w.act(terra, report())).toThrow(
      't1 waits for an evaluation of the person\'s Reject "not what I asked"',
    )
    w.act(nanda, evaluate({ _tag: 'PersonReject', id: no }))
    expect(() => w.act(terra, report())).toThrow('Task is returned until a change answers it')
    w.act(nanda, move('Task', 't1' as TaskId, { _tag: 'Closed', reason: 'no longer needed' }))
    expect(() => w.act(terra, report())).toThrow('Task is closed')
  })

  test('a task with no rules needs an approval from a role that decides', () => {
    const { w, as: give } = world({ rule: { checkedBy: 'checker' as never } })
    const r = w.first(give('maker'), report())
    w.act(give('checker'), accept(r))
    expect<unknown>(blocks(w, r)).toEqual(['DeciderAnyApprover'])
    w.act(give('approver'), accept(r, [{ rule: null, where: 'the result', what: 'fine' }]))
    expect<unknown>(blocks(w, r)).toEqual([])
    expect<unknown>(taskAccepted(w.work, 't1' as TaskId, w.now())).toBe(true)
  })

  test(
    'a fault on the last try stops the task: no new maker before an evaluation, and none on ' +
      'the same inputs',
    () => {
      const { w, as: give } = world()
      const terra = give('maker', nanda, 1)
      const r = w.first(terra, report())
      expect<unknown>(w.act(give('approver'), reject(r, ['broken', 'works']))).toEqual([
        'v2',
        'ex1',
      ])
      expect(() => give('maker')).toThrow(
        `t1 waits for an evaluation of the last try of ${terra} (maker), which ended on a fault: ` +
          `what is wrong, why, and what to improve; the high role of its tree writes it, or the ` +
          `person`,
      )
      w.act(nanda, evaluate({ _tag: 'Exhaustion', id: 'ex1' }))
      expect(() => give('maker')).toThrow(
        `t1 has the inputs that failed in the last try of ${terra} (maker)`,
      )
      // The change says something new to the task: the attempts start again, and the maker works.
      w.act(suggester, add('New'))
      w.act(nanda, acceptDraft('d2'))
      expect<unknown>(workStop(w.work, 't1' as TaskId, w.now())).toBeUndefined()
      expect(() => w.act(terra, report())).not.toThrow()
    },
  )
})

describe('attempts (boundary values)', () => {
  test('maximum 3: exactly three; the fourth is refused; no maximum: any number', () => {
    const { w, as: give } = world()
    const terra = give('maker', nanda, 3)
    for (let i = 0; i < 3; i++) w.act(terra, report())
    expect<unknown>(used(w.work, terra)).toBe(3)
    expect(() => w.act(terra, report())).toThrow(`${terra} (maker) has used its 3 attempts`)
    const free = world()
    const any = free.as('maker')
    for (let i = 0; i < 5; i++) expect(() => free.w.act(any, report())).not.toThrow()
  })

  test(
    'the role limit is the default and the ceiling of maxAttempts (boundary: exactly the ' +
      'limit)',
    () => {
      const limits = { low: {}, medium: { Assignment: { attempts: 2 } }, high: {} }
      const { w, as: give } = world({ limits })
      expect(() => give('maker', nanda, 3)).toThrow('maxAttempts 3 is over the medium limit of 2')
      const terra = give('maker', nanda, 2)
      expect<unknown>(
        (w.work.assignments.get(terra) as Assignment & { maxAttempts: unknown }).maxAttempts,
      ).toEqual({ _tag: 'AtMost', max: 2 })
    },
  )

  test('a reviewer has no attempts: its role fixes the kind of its assignment', () => {
    const { w } = world()
    const maker = create('Assignment', {
      _tag: 'GivenMaker',
      task: 't1' as TaskId,
      role: 'checker' as never,
      secret: 's',
      maxAttempts: 2 as never,
    })
    expect(() => w.act(nanda, maker)).toThrow(
      'checker makes no result, so it has no attempts; a limit of attempts is for a role that ' +
        'makes',
    )
    const reviewer = create('Assignment', {
      _tag: 'GivenReviewer',
      task: 't1' as TaskId,
      role: 'maker' as never,
      secret: 's',
    })
    expect(() => w.act(nanda, reviewer)).toThrow('maker makes results: it has attempts')
    const a = w.first(nanda, given(w, 'checker', 't1')) as AssignmentId
    expect<unknown>(w.work.assignments.get(a)?._tag).toBe('Reviewer')
  })
})

describe('evaluations', () => {
  test(
    'the high role of the tree, or the person, evaluates; a direction level counts after the ' +
      'person accepts it',
    () => {
      const { w, as: give } = world()
      const terra = give('maker', nanda, 1)
      const sol = give('approver')
      w.act(sol, reject(w.first(terra, report()), ['broken']))
      const checker = give('checker')
      expect(() => w.act(checker, evaluate({ _tag: 'Exhaustion', id: 'ex1' }))).toThrow(
        `${checker} (checker) is low; only a high role evaluates a stop: escalate it to your parent`,
      )
      expect(() => w.act(kai, evaluate({ _tag: 'Exhaustion', id: 'ex1' }))).toThrow(
        'Kai is not the owner of t1; Nanda evaluates its mistakes',
      )
      const ev = w.first(
        sol,
        evaluate({ _tag: 'Exhaustion', id: 'ex1' }, 'direction'),
      ) as EvaluationId
      expect<unknown>(evaluationWaits(w.work, 't1' as TaskId)?._tag).toBe('Exhaustion')
      expect(() => w.act(sol, evaluate({ _tag: 'Exhaustion', id: 'ex1' }))).toThrow(
        "an evaluation of t1 at the level direction waits for Nanda's accept; a new one comes " +
          'after that answer',
      )
      const review = (decision: 'Accept' | 'Reject', evidence: ReadonlyArray<object> = []) =>
        create(
          'Review',
          decision === 'Accept'
            ? {
                _tag: 'Accept',
                of: { _tag: 'Evaluation', id: ev, evidence: evidence as never },
                reason: null,
              }
            : { _tag: 'Reject', of: { _tag: 'Evaluation', id: ev, reason: 'not deep enough' } },
        )
      expect(() => w.act(sol, review('Accept', seen))).toThrow(
        'the person evaluates a change of a direction or a principle',
      )
      expect(() => w.act(kai, review('Accept', seen))).toThrow(
        'Kai is not the owner of t1; Nanda accepts its evaluations',
      )
      w.act(nanda, review('Accept', seen))
      expect<unknown>(evaluationWaits(w.work, 't1' as TaskId)).toBeUndefined()
      expect(() => w.act(nanda, review('Reject'))).toThrow('the evaluation is already accepted')
      expect(() => w.act(sol, evaluate({ _tag: 'Exhaustion', id: 'ex1' }))).toThrow(
        `the last try of ${terra} (maker), which ended on a fault already has an evaluation that ` +
          `counts`,
      )
    },
  )

  test('each stop has its own evaluation: two stops, two evaluations', () => {
    const { w, as: give } = world()
    const terra = give('maker')
    const sol = give('approver')
    const r = w.first(terra, report())
    w.act(sol, accept(r))
    const first = w.first(nanda, reject(r, ['too long']))
    const second = w.first(nanda, rejectTask('t1', 'not the point'))
    expect<unknown>(evaluationWaits(w.work, 't1' as TaskId)).toEqual({
      _tag: 'PersonReject',
      id: first,
    })
    w.act(nanda, evaluate({ _tag: 'PersonReject', id: `${first}.1` }))
    expect<unknown>(evaluationWaits(w.work, 't1' as TaskId)).toEqual({
      _tag: 'PersonReject',
      id: second,
    })
    w.act(nanda, evaluate({ _tag: 'PersonReject', id: second }))
    expect<unknown>(evaluationWaits(w.work, 't1' as TaskId)).toBeUndefined()
  })

  test("the person's Reject waits for an evaluation before a change answers it", () => {
    const { w } = world()
    const no = w.first(nanda, rejectTask('t1', 'wrong'))
    expect(() => w.act(suggester, add('Y', [], 'y'))).not.toThrow()
    expect(() =>
      w.act(suggester, revised('craft', { add: [{ id: 'z', says: 'Z', rules: [] }] }, [no])),
    ).toThrow(
      '"wrong" waits for an evaluation of t1 first: what is wrong, why, and what to improve',
    )
  })
})

describe('limits of the workflow (what one AI can hold)', () => {
  test(
    'a review assignment checks at most Review.rules rules (boundary: exactly the ' + 'limit)',
    () => {
      const limits = { low: { Review: { rules: 1 } }, medium: {}, high: {} }
      const { w, as: give } = world({ limits, rule: { checkedBy: 'checker' as never } })
      expect(() => give('checker')).not.toThrow()
      w.act(suggester, add('Two', [{ id: 'two', says: 'Two', checkedBy: 'checker' }]))
      w.act(nanda, acceptDraft('d2'))
      expect(() => give('checker')).toThrow(
        'haiku (checker) would check 2 rules; the limit is 1: split the task',
      )
    },
  )

  test('a brief over Assignment.briefChars is refused; the CLI measures it', () => {
    const limits = { low: {}, medium: { Assignment: { briefChars: 100 } }, high: {} }
    const { w, as: give } = world({ limits })
    w.measure = 101
    expect(() => give('maker')).toThrow(
      'the brief of Task has 101 characters; the limit is 100: shorten its directions, or split the task',
    )
    w.measure = 100
    expect(() => give('maker')).not.toThrow()
  })

  test('a result over Result.size is refused (boundary: exactly the size)', () => {
    const limits = { low: {}, medium: { Result: { size: 10 } }, high: {} }
    const { w, as: give } = world({ limits })
    const terra = give('maker')
    expect(() => w.act(terra, report(11))).toThrow(
      'the result has size 11; the limit is 10: do not report it; escalate it',
    )
    expect(() => w.act(terra, report(10))).not.toThrow()
  })
})

describe('evidence and reviews', () => {
  test('evidence must say where it looked, and counts only for its own result', () => {
    const { w, as: give } = world()
    const terra = give('maker')
    const sol = give('approver')
    const r = w.first(terra, report())
    w.act(sol, accept(r, proof('works', '')))
    expect<unknown>(blocks(w, r)).toContain('Evidence')
    w.act(sol, reject(r, ['again']))
    const r2 = w.first(terra, report())
    expect<unknown>(blocks(w, r2)).toContain('Evidence')
    expect(() => w.act(sol, accept(r2, proof('nothing')))).toThrow(
      'there is no rule "nothing" in an official version',
    )
  })

  test('a rule checked by a role: only that role, on results that its act covers', () => {
    const { w, as: give } = world({ rule: { checkedBy: 'checker' as never } })
    const r = w.first(give('maker'), report())
    w.act(give('peer'), accept(r))
    expect<unknown>(blocks(w, r)).toContain('Evidence')
    w.act(give('checker'), accept(r))
    expect<unknown>(blocks(w, r)).not.toContain('Evidence')
    const outsider = give('outsider')
    expect(() => w.act(outsider, accept(r))).toThrow(`${outsider} (outsider) may not review this`)
  })

  test(
    'the person does not accept a result, and criticises it only after its deciders accepted ' +
      'it',
    () => {
      const { w, as: give } = world()
      const r = w.first(give('maker'), report())
      expect(() => w.act(nanda, accept(r))).toThrow(
        'Nanda approves directions and standards; the accept of a role that decides it decides a ' +
          'result',
      )
      expect(() => w.act(nanda, reject(r, ['no']))).toThrow(
        'this result waits for the accept of a role that decides it; criticise it after its ' +
          'deciders accept it',
      )
      expect(() => w.act(kai, reject(r, ['no']))).toThrow('Kai (person) may not review this')
    },
  )

  test(
    'a Reject that names a rule is answered by later changed work with evidence; the same ' +
      'work is not',
    () => {
      const { w, as: give } = world()
      const terra = give('maker')
      const sol = give('approver')
      const r = w.first(terra, report(1, 'same'))
      w.act(sol, reject(r, ['broken', 'works']))
      const again = w.first(terra, report(1, 'same'))
      w.act(sol, accept(again))
      expect<unknown>(blocks(w, again)).toContain('Unchanged')
      const changed = w.first(terra, report(1, 'new'))
      w.act(sol, accept(changed))
      expect<unknown>(answered(w.work, 'v2.1' as never)).toBe(true)
      expect<unknown>(blocks(w, changed)).toEqual([])
      expect(() => w.act(sol, reject(changed, ['x', 'nothing']))).toThrow(
        'there is no rule "nothing" in an official version',
      )
    },
  )

  test('a Reject that names no rule still needs an instruction change', () => {
    const { w, as: give } = world()
    const terra = give('maker')
    const sol = give('approver')
    w.act(sol, reject(w.first(terra, report()), ['wrong']))
    const r2 = w.first(terra, report())
    w.act(sol, accept(r2))
    expect<unknown>(blocks(w, r2)).toEqual(['Change'])
  })

  test('a recheck uses no attempt and stops nothing; any later result answers it', () => {
    const { w, as: give } = world()
    const terra = give('maker', nanda, 1)
    const sol = give('approver')
    const r = w.first(terra, report())
    const again = w.first(sol, recheck(r, 'look again'))
    expect<unknown>(used(w.work, terra)).toBe(0)
    expect<unknown>(answered(w.work, again as never)).toBe(false)
    w.act(terra, report())
    expect<unknown>(answered(w.work, again as never)).toBe(true)
  })

  test('a recheck of a closed task is refused', () => {
    const { w, as: give } = world()
    const sol = give('approver')
    const r = w.first(give('maker'), report())
    w.act(nanda, move('Task', 't1' as TaskId, { _tag: 'Closed', reason: 'stop' }))
    expect(() => w.act(sol, recheck(r, 'again'))).toThrow(
      't1 is closed; it takes no new result, so a recheck cannot be answered',
    )
  })

  test('a point names a rule of its task; one of another part says where it is', () => {
    const { w, as: give } = world({ context: { section: 'a' } })
    const sol = give('approver')
    const r = w.first(give('maker'), report())
    const onlyB = {
      id: 'b-only',
      says: 'B only',
      where: { section: 'b' },
      rules: [{ id: 'b-rule', says: 'B', supersedes: [] }],
    }
    w.act(suggester, revised('craft', { add: [onlyB] }))
    w.act(nanda, acceptDraft('d2'))
    expect(() => w.act(sol, reject(r, ['x', 'b-rule']))).toThrow('t1 is not checked by b-rule')
  })
})

describe('escalations and resolves', () => {
  test('an escalation waits for its answerer; a review that is no resolve does not lift it', () => {
    const { w, as: give } = world()
    const terra = give('maker')
    const checker = give('checker')
    const r = w.first(terra, report())
    w.act(checker, escalate(r, 'unsure'))
    expect<unknown>(blocks(w, r)).toContain('Escalation')
    w.act(give('approver'), accept(r))
    expect<unknown>(openEscalations(w.work, r as ResultId).length).toBe(1)
  })

  test(
    'an escalation to the person is resolved only by that person; nobody resolves their own ' +
      'escalation',
    () => {
      const { w, as: give } = world()
      const sol = give('approver')
      const r = w.first(give('maker'), report())
      const up = w.first(sol, escalate(r, 'only Nanda decides'))
      expect(() => w.act(sol, resolve(up, 'go on'))).toThrow(
        `${sol} (approver) may not resolve "only Nanda decides"`,
      )
      w.act(nanda, resolve(up, 'go on'))
      expect<unknown>(openEscalations(w.work, r as ResultId)).toEqual([])
      // A resolve is never an accept of the work, and the person's resolve is no stop.
      expect<unknown>(blocks(w, r)).toContain('DeciderAnyApprover')
      expect<unknown>(evaluationWaits(w.work, 't1' as TaskId)).toBeUndefined()
    },
  )

  test('a resolve ends only an escalation, and an escalation is resolved once', () => {
    const { w, as: give } = world()
    const sol = give('approver')
    const r = w.first(give('maker'), report())
    const ok = w.first(sol, accept(r))
    expect(() => w.act(nanda, resolve(ok, 'go on'))).toThrow(
      'a resolve ends an escalation; this review is not an escalation',
    )
    const up = w.first(give('checker'), escalate(r, 'unsure'))
    w.act(nanda, resolve(up, 'go on'))
    expect(() => w.act(nanda, resolve(up, 'stop'))).toThrow(`${up} is resolved already`)
  })

  test("R1: after a Resolve, the decider's Reject of the result is a fault of the maker", () => {
    const { w, as: give } = world()
    const terra = give('maker', nanda, 1)
    const sol = give('approver')
    const r = w.first(terra, report())
    const below = w.first(sol, given(w, 'checker', 't1')) as AssignmentId
    const up = w.first(below, escalate(r, 'is the date needed?'))
    // The Resolve ends the escalation; it neither accepts nor rejects the result.
    const resolved = w.act(sol, resolve(up, 'the date is not needed'))
    expect<unknown>(resolved).toEqual([resolved[0]])
    expect<unknown>(openEscalations(w.work, r as ResultId)).toEqual([])
    expect<unknown>(blocks(w, r)).not.toContain('Reject')
    // The decider reviews the result as usual: its Reject uses the maker's last attempt.
    const no = w.act(sol, reject(r, ['the date is still there']))
    expect<unknown>(no).toEqual([no[0], 'ex1'])
    expect<unknown>(used(w.work, terra)).toBe(1)
    expect<unknown>(w.work.exhaustions.get('ex1' as ExhaustionId)?.fault).toBe(`${no[0]}.1`)
  })
})

describe('questions and checkpoints', () => {
  test(
    'a question goes to the nearest open assignment above, and only that one answers it, ' + 'once',
    () => {
      const { w, as: give } = world()
      const sol = give('approver')
      const terra = w.first(sol, given(w, 'maker', 't1')) as AssignmentId
      const q = w.first(
        terra,
        create('Question', { _tag: 'Asked', text: 'which one?', to: { _tag: 'Above' } }),
      ) as QuestionId
      expect<unknown>(w.work.questions.get(q)?.answerBy).toBe(sol)
      const answer = (text: string) =>
        move('Question', q, { _tag: 'Answered', text: text as never })
      expect(() => w.act(nanda, answer('m1'))).toThrow(
        'a1 (approver) answers this question, not Nanda',
      )
      w.act(sol, finish(sol))
      // What waited for a finished assignment goes up: the owner answers now.
      w.act(nanda, answer('m1'))
      expect(() => w.act(nanda, answer('m2'))).toThrow('the question is answered already: "m1"')
    },
  )

  test('the person asks an open agent only', () => {
    const { w, as: give } = world()
    const terra = give('maker')
    w.act(nanda, finish(terra))
    const asked = create('Question', {
      _tag: 'Asked',
      text: 'why?',
      to: { _tag: 'Agent', assignment: terra },
    } as never)
    expect(() => w.act(nanda, asked)).toThrow(
      'a1 (maker) is finished, so it answers no question; ask an open assignment',
    )
  })

  test('a checkpoint lists what is open, and the open parts of the task', () => {
    const { w, as: give } = world()
    const r = w.first(give('maker'), report())
    w.act(
      nanda,
      move('Task', 't1' as TaskId, {
        _tag: 'Split',
        parts: [{ name: 'A', text: 'a' }] as never,
        review: null,
      }),
    )
    const k = w.first(
      give('approver'),
      create('Checkpoint', { _tag: 'Checkpoint', task: 't1' as TaskId, next: 'go on' }),
    )
    const saved = w.work.checkpoints.get(k as never)
    expect<unknown>(saved?.open.blockers.map((b) => b._tag)).toEqual([
      'Evidence',
      'DeciderAnyApprover',
    ])
    expect<unknown>(saved?.parts.map((p) => p.task)).toEqual(['t2'])
    void r
  })
})

describe('parents, tiers and trees', () => {
  test(
    'a parent assigns only lower tiers (boundary: the same tier is refused), in its own tree, ' +
      'while open',
    () => {
      const { w, as: give } = world()
      const sol = give('approver')
      expect(() => w.act(sol, given(w, 'approver', 't1'))).toThrow(
        'a high role assigns only lower tiers; "approver" is high',
      )
      w.act(nanda, opened({ name: 'Other' }))
      expect(() => w.act(sol, given(w, 'maker', 't2'))).toThrow('t2 is outside the task tree of t1')
      const arch = give('architect')
      expect(() => w.act(arch, given(w, 'maker', 't1'))).toThrow(
        `${arch} (architect) decides no maker results, and no assignment above it does; a role ` +
          `that approves maker assigns it`,
      )
      w.act(nanda, finish(sol))
      expect(() => w.act(sol, given(w, 'maker', 't1'))).toThrow('the parent assignment is finished')
    },
  )

  test('a finished assignment reports nothing more', () => {
    const { w, as: give } = world()
    const terra = give('maker')
    w.act(nanda, finish(terra))
    expect(() => w.act(terra, report())).toThrow('a1 (maker) is finished')
  })

  test('a split task needs its parts: its maker starts only when every part is accepted', () => {
    const { w, as: give } = world()
    w.act(
      nanda,
      move('Task', 't1' as TaskId, {
        _tag: 'Split',
        parts: [{ name: 'A', text: 'a' }] as never,
        review: null,
      }),
    )
    expect(() => give('maker')).toThrow(
      't1 needs t2 (A), which is not accepted; its maker starts after that',
    )
  })

  test('a change act on a task covers its parts, and not a task outside its tree', () => {
    const { w, as: give } = world()
    w.act(
      nanda,
      move('Task', 't1' as TaskId, {
        _tag: 'Split',
        parts: [{ name: 'A', text: 'a' }] as never,
        review: null,
      }),
    )
    w.act(nanda, opened({ name: 'Other' }))
    w.act(nanda, grant({ _tag: 'Change', changesOf: ['t1'] }, 'peer', after(w.now(), HOUR)))
    const peer = give('peer')
    const close = (t: string) => move('Task', t as TaskId, { _tag: 'Closed', reason: 'no' })
    const split = (t: string) =>
      move('Task', t as TaskId, {
        _tag: 'Split',
        parts: [{ name: 'Sub', text: 's' }] as never,
        review: null,
      })
    expect(() => w.act(peer, close('t3'))).toThrow(`${peer} (peer) has no change act on Other`)
    expect(() => w.act(peer, split('t2'))).not.toThrow()
  })
})

describe('a remake', () => {
  const remake = (task: string, file: object, reason = 'the scope changed') =>
    move('Task', task as TaskId, {
      _tag: 'Remade',
      file: {
        name: 'Task',
        text: 'Do it',
        references: [],
        from: null,
        directions: { _tag: 'Keep' },
        context: { _tag: 'Keep' },
        needs: { _tag: 'Keep' },
        workspace: { _tag: 'Keep' },
        ...file,
      } as never,
      reason: reason as never,
      review: null,
    })

  test('a remake changes the scope, and moves the needs of other tasks to the new task', () => {
    const { w } = world()
    w.act(nanda, opened({ name: 'Needer', needs: ['t1'] }))
    expect(() => w.act(nanda, remake('t1', {}))).toThrow(
      'the remake of t1 says what t1 says; a remake changes its scope',
    )
    expect<unknown>(w.act(nanda, remake('t1', { text: 'Do it better' }))).toEqual(['t3'])
    expect<unknown>(w.work.tasks.get('t2' as TaskId)?.needs).toEqual(['t3'])
    expect<unknown>(taskState(w.work, 't1' as TaskId, w.now())).toEqual({
      _tag: 'Replaced',
      next: 't3',
    })
    expect(() => w.act(nanda, remake('t1', { text: 'x' }))).toThrow(
      't1 is closed; a closed task is not remade',
    )
  })

  test("an agent's remake keeps the frame of the task, and drops no person's Reject", () => {
    const { w } = world()
    w.act(nanda, grant({ _tag: 'Change', changesOf: ['t1'] }, 'approver', after(w.now(), HOUR)))
    const sol = as(w, 'approver')
    expect(() =>
      w.act(sol, remake('t1', { text: 'x', context: { _tag: 'Set', value: { section: 'b' } } })),
    ).toThrow("an agent's remake keeps the directions, the context, and the workspace of t1")
    const no = w.first(nanda, rejectTask('t1', 'not this'))
    w.act(nanda, evaluate({ _tag: 'PersonReject', id: no }))
    expect(() => w.act(sol, remake('t1', { text: 'x' }))).toThrow(
      '"not this" is the person\'s open point on t1; only that person\'s own remake answers it',
    )
  })

  test(
    'a cycle of needs is refused, and so is a task outside the tree that needs a part of ' + 'it',
    () => {
      const { w } = world()
      w.act(nanda, opened({ name: 'Two', needs: ['t1'] }))
      expect(() =>
        w.act(nanda, remake('t1', { text: 'x', needs: { _tag: 'Set', value: ['t2'] } })),
      ).toThrow('a cycle of needs: the new Task would need itself through t2')
      w.act(
        nanda,
        move('Task', 't1' as TaskId, {
          _tag: 'Split',
          parts: [{ name: 'A', text: 'a' }] as never,
          review: null,
        }),
      )
      w.act(nanda, opened({ name: 'Four', needs: ['t3'] }))
      expect(() => w.act(nanda, remake('t1', { text: 'y' }))).toThrow(
        't4 needs a part of t1; remake t4 first',
      )
    },
  )
})

describe('who decides (the rulings of 2026-11-07)', () => {
  const ROLES2 = {
    ...ROLES,
    lead: role('high', [{ approve: ['maker'] as never }]),
    techlead: role('high', [{ approve: ['maker'] as never }]),
  }
  const decided = (by: object) => {
    const { w } = world({ roles: ROLES2, decide: { maker: by } as never })
    const r = w.first(as(w, 'maker'), report())
    return { w, r }
  }

  test('with no decide entry, any one role with an Approve act decides', () => {
    const { w } = world({ roles: ROLES2 })
    const r = w.first(as(w, 'maker'), report())
    w.act(as(w, 'lead'), accept(r))
    expect<unknown>(blocks(w, r)).toEqual([])
  })

  test('Or: any one of the deciders accepts', () => {
    const { w, r } = decided({ or: ['lead', 'techlead'] })
    w.act(as(w, 'techlead'), accept(r))
    expect<unknown>(blocks(w, r)).toEqual([])
  })

  test('And: each decider accepts, in any order', () => {
    const { w, r } = decided({ and: ['lead', 'techlead'] })
    w.act(as(w, 'techlead'), accept(r))
    expect<unknown>(blockerItems(w.work, r as ResultId, w.now())).toEqual([
      { _tag: 'DeciderWaits', leaves: [{ _tag: 'Role', role: 'lead' }] },
    ])
    w.act(as(w, 'lead'), accept(r))
    expect<unknown>(blocks(w, r)).toEqual([])
  })

  test('Order: a later decider decides only after the accept of the one before it', () => {
    const { w, r } = decided({ order: ['lead', 'techlead'] })
    expect(() =>
      w.act(as(w, 'techlead'), accept(r, [{ rule: null, where: 'r1', what: 'ok' }])),
    ).toThrow('techlead decides this result after the accept of lead')
    w.act(as(w, 'lead'), accept(r))
    w.act(as(w, 'techlead'), accept(r, [{ rule: null, where: 'r1', what: 'ok' }]))
    expect<unknown>(blocks(w, r)).toEqual([])
  })

  test('deciders name each role once, and the person last in an order', () => {
    expect<unknown>(
      decidersProblem(
        Or([
          { _tag: 'Role', role: 'lead' as never },
          { _tag: 'Role', role: 'lead' as never },
        ]),
      ),
    ).toBe('names lead two times; each item needs its own accept, so name it once')
    expect<unknown>(decidersProblem(And([nanda, kai]))).toBe(
      'names more than one person; one approve is the last accept',
    )
    expect<unknown>(decidersProblem(Order([nanda, { _tag: 'Role', role: 'lead' as never }]))).toBe(
      'names Nanda before another item of an order; the person approves last',
    )
  })

  test(
    'only a fault uses an attempt: an accepted result, a recheck, and the criticism of the ' +
      'person use none',
    () => {
      const { w, as: give } = world()
      const terra = give('maker', nanda, 2)
      const sol = give('approver')
      const r = w.first(terra, report())
      w.act(sol, accept(r))
      expect<unknown>(used(w.work, terra)).toBe(0)
      w.act(nanda, reject(r, ['I see it otherwise']))
      expect<unknown>(used(w.work, terra)).toBe(0)
      expect<unknown>(workStop(w.work, 't1' as TaskId, w.now())).toContain(
        'waits for an evaluation',
      )
    },
  )

  test('an approved change resets the attempts', () => {
    const { w, as: give } = world()
    const terra = give('maker', nanda, 2)
    const sol = give('approver')
    w.act(sol, reject(w.first(terra, report()), ['no']))
    expect<unknown>(used(w.work, terra)).toBe(1)
    w.act(suggester, add('New', [], 'new'))
    w.act(nanda, acceptDraft('d2'))
    expect<unknown>(used(w.work, terra)).toBe(0)
    expect<unknown>(resultsOf(w.work, 't1' as TaskId).length).toBe(1)
  })
})

describe("the other refusals of the owner's page", () => {
  const split = (task: string, review: string | null = null) =>
    move('Task', task as TaskId, {
      _tag: 'Split',
      parts: [{ name: 'A', text: 'a' }] as never,
      review: review as never,
    })
  const close = (task: string) =>
    move('Task', task as TaskId, { _tag: 'Closed', reason: 'not needed' })

  test(
    "a split answers only a Reject of its own task, with no rule, and the person's only by " +
      'that person',
    () => {
      const { w, as: give } = world()
      w.act(nanda, grant({ _tag: 'Change', changesOf: ['t1'] }, 'approver', after(w.now(), HOUR)))
      const sol = give('approver')
      const r = w.first(give('maker'), report())
      const ruled = w.first(sol, reject(r, ['broken', 'works']))
      expect(() => w.act(sol, split('t1', ruled))).toThrow(
        '"broken" names the rule works; changed work with evidence answers it, not a split',
      )
      w.act(nanda, opened({ name: 'Other' }))
      const elsewhere = w.first(nanda, rejectTask('t2', 'wrong place'))
      expect(() => w.act(nanda, split('t1', elsewhere))).toThrow(
        '"wrong place" is not about t1; a split answers only a Reject of its own task',
      )
      const mine = w.first(nanda, rejectTask('t1', 'too big'))
      expect(() => w.act(sol, split('t1', mine))).toThrow(
        't1 waits for an evaluation of the person\'s Reject "too big"; a split comes after it',
      )
      w.act(nanda, evaluate({ _tag: 'PersonReject', id: mine }))
      expect(() => w.act(sol, split('t1', mine))).toThrow(
        '"too big" is the person\'s Reject; only that person\'s own split answers it, or a ' +
          'direction change',
      )
      expect(() => w.act(sol, split('t1'))).toThrow(
        '"too big" is the person\'s open point on t1; only that person\'s own split answers it',
      )
      expect(() => w.act(nanda, split('t1', mine))).not.toThrow()
    },
  )

  test("an agent's close drops no person's Reject, and waits for an evaluation", () => {
    const { w, as: give } = world()
    w.act(nanda, grant({ _tag: 'Change', changesOf: ['t1'] }, 'approver', after(w.now(), HOUR)))
    const sol = give('approver')
    const no = w.first(nanda, rejectTask('t1', 'not this'))
    expect(() => w.act(sol, close('t1'))).toThrow(
      '"not this" is the person\'s open Reject in t1; a close would drop it',
    )
    w.act(nanda, evaluate({ _tag: 'PersonReject', id: no }))
    expect(() => w.act(sol, close('t1'))).toThrow('"not this" is the person\'s open Reject in t1')
    expect(() => w.act(nanda, close('t1'))).not.toThrow()
  })

  test("an agent's remake keeps the needs, and waits for an evaluation of its tree", () => {
    const { w, as: give } = world()
    w.act(nanda, opened({ name: 'Need', directions: [] }))
    w.act(nanda, opened({ name: 'Needer', needs: ['t2'] }))
    w.act(nanda, grant({ _tag: 'Change', changesOf: ['t3'] }, 'approver', after(w.now(), HOUR)))
    const sol = w.first(nanda, given(w, 'approver', 't3')) as AssignmentId
    const remade = (needs: ReadonlyArray<string>) =>
      move('Task', 't3' as TaskId, {
        _tag: 'Remade',
        file: {
          name: 'Needer',
          text: 'Do it again',
          references: [],
          from: null,
          directions: { _tag: 'Keep' },
          context: { _tag: 'Keep' },
          needs: { _tag: 'Set', value: needs },
          workspace: { _tag: 'Keep' },
        } as never,
        reason: 'smaller' as never,
        review: null,
      })
    expect(() => w.act(sol, remade([]))).toThrow(
      "an agent's remake keeps the needs of t3; it may add a need, but only the person drops t2",
    )
    void give
  })

  test('an evaluation of the task level counts when it is written: it takes no review', () => {
    const { w, as: give } = world()
    const terra = give('maker', nanda, 1)
    const sol = give('approver')
    w.act(sol, reject(w.first(terra, report()), ['broken']))
    const ev = w.first(sol, evaluate({ _tag: 'Exhaustion', id: 'ex1' }, 'task')) as EvaluationId
    const review = create('Review', {
      _tag: 'Accept',
      of: { _tag: 'Evaluation', id: ev, evidence: seen as never },
      reason: null,
    })
    expect(() => w.act(nanda, review)).toThrow(
      'an evaluation at the level task counts when it is written',
    )
  })

  test('an evaluation answers a stop of an open task, by an open high role of its tree', () => {
    const { w, as: give } = world()
    const terra = give('maker', nanda, 1)
    const sol = give('approver')
    const r = w.first(terra, report())
    const fault = w.first(sol, reject(r, ['broken']))
    expect(() => w.act(sol, evaluate({ _tag: 'PersonReject', id: fault }))).toThrow(
      'an evaluation answers a stop: the last try of a maker that ended on a fault, or a Reject ' +
        'of the person',
    )
    w.act(nanda, opened({ name: 'Other' }))
    const far = w.first(nanda, given(w, 'approver', 't2')) as AssignmentId
    expect(() => w.act(far, evaluate({ _tag: 'Exhaustion', id: 'ex1' }))).toThrow(
      `t1 is outside the task tree of ${far} (approver)`,
    )
    w.act(nanda, finish(sol))
    expect(() => w.act(sol, evaluate({ _tag: 'Exhaustion', id: 'ex1' }))).toThrow(
      `${sol} (approver) is finished`,
    )
    w.act(nanda, close('t1'))
    expect(() => w.act(nanda, evaluate({ _tag: 'Exhaustion', id: 'ex1' }))).toThrow('t1 is closed')
  })

  test('a new direction drafted again: the draft that came second is no longer new', () => {
    const { w } = world()
    const reels = { ...directionFile({}), id: 'reels' as never, name: 'Reels', standards: [] }
    w.act(assess, drafted(reels))
    w.act(assess, drafted({ ...reels, says: 'Good reels' }))
    w.act(nanda, acceptDraft('d2'))
    expect(() => w.act(nanda, acceptDraft('d3'))).toThrow(
      'd3 drafts Reels anew, and Reels has v1 now; its reviser revises the current version',
    )
    expect(() => w.act(assess, drafted(reels))).toThrow(
      'reels has a version; a high role revises it: work direction revise <token> reels ' +
        '--file=<edit.yaml>',
    )
  })

  test('a task that needs another, reopened after its maker started, takes no result', () => {
    const { w, as: give } = world()
    const sol = give('approver')
    w.act(sol, accept(w.first(give('maker'), report())))
    w.act(nanda, opened({ name: 'Needer', needs: ['t1'] }))
    const terra = w.first(nanda, given(w, 'maker', 't2')) as AssignmentId
    w.act(nanda, rejectTask('t1', 'reopen'))
    expect(() => w.act(terra, report())).toThrow('t2 needs t1 (Task), which is not accepted')
  })
})

describe("the last refusals of the owner's page", () => {
  test('a rule id names one rule in the project: at the accept, and within one draft', () => {
    const { w } = world()
    const other = {
      ...directionFile({}),
      id: 'other' as never,
      name: 'Other',
      standards: [
        { id: 'own', says: 'Own', rules: [{ id: 'shared', says: 'Shared', supersedes: [] }] },
      ],
    }
    w.act(assess, drafted(other))
    w.act(suggester, add('Also', [{ id: 'shared', says: 'Also shared' }]))
    w.act(nanda, acceptDraft('d3'))
    expect(() => w.act(nanda, acceptDraft('d2'))).toThrow(
      'the rule id "shared" is already used by another direction; revise with a new id',
    )
    // The same rule again in a second standard: it is one rule, named twice.
    w.act(suggester, add('Twice', [{ id: 'works', says: 'It works' }]))
    expect(() => w.act(nanda, acceptDraft('d4'))).toThrow(
      'd4 has the rule id "works" twice; revise with a new id',
    )
  })

  test('a closed task takes no parts', () => {
    const { w } = world()
    w.act(nanda, move('Task', 't1' as TaskId, { _tag: 'Closed', reason: 'done' }))
    const split = move('Task', 't1' as TaskId, {
      _tag: 'Split',
      parts: [{ name: 'A', text: 'a' }] as never,
      review: null,
    })
    expect(() => w.act(nanda, split)).toThrow('t1 is closed; a closed task takes no parts')
  })

  test("an agent's remake comes after the evaluation that a task of its tree waits for", () => {
    const { w, as: give } = world()
    w.act(nanda, grant({ _tag: 'Change', changesOf: ['t1'] }, 'approver', after(w.now(), HOUR)))
    const terra = give('maker', nanda, 1)
    const sol = give('approver')
    w.act(sol, reject(w.first(terra, report()), ['broken']))
    const remade = move('Task', 't1' as TaskId, {
      _tag: 'Remade',
      file: {
        name: 'Task',
        text: 'Do it again',
        references: [],
        from: null,
        directions: { _tag: 'Keep' },
        context: { _tag: 'Keep' },
        needs: { _tag: 'Keep' },
        workspace: { _tag: 'Keep' },
      } as never,
      reason: 'smaller' as never,
      review: null,
    })
    expect(() => w.act(sol, remade)).toThrow(
      `t1 waits for an evaluation of the last try of ${terra} (maker), which ended on a fault; a ` +
        `remake comes after it`,
    )
    expect(() => w.act(nanda, remade)).not.toThrow()
  })
})
