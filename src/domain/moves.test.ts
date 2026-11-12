// The moves of the records with a lifecycle: each one leaves only the state that it may leave.
// A move back does not compile (the @ts-expect-error lines fail the typecheck if it ever does);
// the fold's table (src/replay STEPS) finds the record, narrows it, and calls the move.
import { describe, expect, test } from 'bun:test'
import { human } from './actor.ts'
import { StoreDamaged } from './errors.ts'
import type { Recorded } from './events.ts'
import type { ConfigFile } from './files.ts'
import type {
  AssignmentId,
  EscalationId,
  PermissionId,
  ProblemId,
  QuestionId,
  RoleName,
  RunId,
  SessionId,
  TaskId,
  Time,
} from './ids.ts'
import type { Permission, Question } from './model.ts'
import {
  answerQuestion,
  closeTerminal,
  finishAssignment,
  MOVES,
  type OpenAssignment,
  promptTerminal,
  startTerminal,
  recoverTerminal,
  resumeTerminal,
  revokePermission,
  runClosed,
  runDone,
  stopTerminal,
  tick,
} from './moves.ts'
import { answererOf, sourceStateOf } from './derived.ts'
import type { HostRun, TerminalState } from './ui-model.ts'
import type { Work } from './work.ts'
import { STEPS, stepOf } from '../replay/replay.ts'

const at = (minute: number) => `2026-11-12T09:${String(minute).padStart(2, '0')}:00.000Z` as Time
const nanda = human('Nanda')
const q1 = 'q1' as QuestionId
const open: Question & { readonly status: { readonly _tag: 'Open' } } = {
  _tag: 'Question',
  id: q1,
  text: 'which merchant?',
  stops: 't1' as TaskId,
  answerBy: nanda,
  from: 'a2' as AssignmentId,
  status: { _tag: 'Open' },
  when: at(1),
}

describe('a question', () => {
  test('is answered once, and keeps who answered and when (bug 2)', () => {
    const answered = answerQuestion(open, 'merchant m1', nanda, at(2))
    const status = { _tag: 'Answered', answer: 'merchant m1', by: nanda, when: at(2) }
    expect<unknown>(answered.status).toEqual(status)
    // @ts-expect-error an answered question is not answered again
    answerQuestion(answered, 'merchant m2', nanda, at(3))
  })
})

describe('an assignment', () => {
  test('is finished once', () => {
    const open: OpenAssignment = {
      _tag: 'Reviewer',
      id: 'a3' as AssignmentId,
      actor: nanda,
      role: 'linter' as RoleName,
      task: 't1' as TaskId,
      under: new Map(),
      parent: { _tag: 'GivenByPerson' },
      when: at(1),
      end: { _tag: 'NotEnded' },
    }
    const finished = finishAssignment(open, at(2))
    expect(finished.end).toEqual({ _tag: 'Finished', when: at(2) })
    // @ts-expect-error a finished assignment is not finished again
    finishAssignment(finished, at(3))
  })
})

describe('the words of roles', () => {
  test('change their words only, and every move kind has its function, or none', () => {
    const role = { kind: 'agent', tier: 'low', description: 'old', intro: 'i', acts: [] }
    const config = { roles: { writer: role } } as unknown as ConfigFile
    const changed = MOVES['Workflow.RoleWordsChanged'](config, { writer: { description: 'new' } })
    expect<unknown>(changed.roles.writer).toEqual({ ...role, description: 'new' })
    expect(MOVES['Task.Split']).toBeNull()
  })
})

describe('a permission', () => {
  test('is revoked once', () => {
    const x: Permission & { readonly revoked: { readonly _tag: 'NotRevoked' } } = {
      id: 'x1' as PermissionId,
      act: { _tag: 'Approve', resultsOf: ['writer' as RoleName] },
      to: 'architect' as RoleName,
      by: nanda,
      until: at(30),
      revoked: { _tag: 'NotRevoked' },
      when: at(1),
      at: 1,
    }
    const revoked = revokePermission(x, at(5))
    expect(revoked.revoked).toEqual({ _tag: 'Revoked', at: at(5) })
    // @ts-expect-error a revoked permission is not revoked again
    revokePermission(revoked, at(6))
  })
})

describe('a run', () => {
  const host: HostRun & { readonly end: { readonly _tag: 'NotEnded' } } = {
    _tag: 'Host',
    id: 'h1' as RunId,
    session: 's-host' as SessionId,
    startedAt: at(0),
    end: { _tag: 'NotEnded' },
  }
  test('a host run is done once, and a done run is not closed', () => {
    const done = runDone(host, at(9))
    expect(done.end).toEqual({ _tag: 'Done', at: at(9) })
    // @ts-expect-error a done project stays done
    runClosed(done, at(10))
  })
  test('a closed host run is not done', () => {
    const closed = runClosed(host, at(4))
    expect(closed.end).toEqual({ _tag: 'Closed', at: at(4) })
    // @ts-expect-error a closed run stays closed
    runDone(closed, at(5))
  })
})

describe('a terminal', () => {
  const live: TerminalState & { readonly _tag: 'Live' } = {
    _tag: 'Live',
    activity: { _tag: 'Busy', lastOutput: at(1) },
  }
  test('only the person resumes a stopped one; no automatic move takes it', () => {
    const stopped = stopTerminal(live, at(2))
    expect(resumeTerminal(stopped, nanda, at(3))).toEqual({
      _tag: 'Live',
      activity: { _tag: 'Starting', since: at(3) },
    })
    // @ts-expect-error the pump's tick does not touch a stopped terminal
    tick(stopped, { _tag: 'Quiet', stepKey: 'k' })
    // @ts-expect-error the end of work does not close a terminal that the person stopped
    closeTerminal(stopped, at(4))
  })
  test("a failed one comes back with its agent's next act, with no person", () => {
    const failed = { _tag: 'Failed', why: 'silent', at: at(5) } as const
    expect(recoverTerminal(failed, at(6))._tag).toBe('Live')
    // @ts-expect-error a live terminal is not resumed: it runs
    resumeTerminal(live, nanda, at(7))
  })
  test('a new one starts, and a live one at a prompt shows its line', () => {
    const started = { _tag: 'Live', activity: { _tag: 'Starting', since: at(1) } } as const
    expect(startTerminal(at(1))).toEqual(started)
    const asked = promptTerminal(live, 'Do you want to proceed?')
    expect(asked.activity).toEqual({ _tag: 'AtPrompt', line: 'Do you want to proceed?' })
    // @ts-expect-error a stopped terminal shows no prompt: no automatic move takes it
    promptTerminal(stopTerminal(live, at(2)), 'x')
  })
  test('the person resumes a failed one, and its failure is cleared', () => {
    const failed = { _tag: 'Failed', why: 'error', at: at(5) } as const
    expect(resumeTerminal(failed, nanda, at(8))).toEqual({
      _tag: 'Live',
      activity: { _tag: 'Starting', since: at(8) },
    })
  })
})

// The old finish moved the answerer of each open question and escalation; it is derived now.
describe('who answers a question or an escalation now', () => {
  const a1 = 'a1' as AssignmentId
  const a2 = 'a2' as AssignmentId
  const assignment = (id: AssignmentId, ended: boolean, parent: AssignmentId | null) => ({
    id,
    task: 't1',
    parent: parent ? { _tag: 'Parent', id: parent } : { _tag: 'GivenByPerson' },
    end: ended ? { _tag: 'Finished', when: at(9) } : { _tag: 'NotEnded' },
  })
  const workOf = (ended1: boolean, ended2: boolean) =>
    ({
      assignments: new Map([
        [a1, assignment(a1, ended1, null)],
        [a2, assignment(a2, ended2, a1)],
      ]),
      tasks: new Map([['t1', { owner: nanda }]]),
    }) as unknown as Work
  test('the first one while it is open, else its nearest open parent, else the owner', () => {
    expect<unknown>(answererOf(workOf(false, false), a2)).toBe(a2)
    expect<unknown>(answererOf(workOf(false, true), a2)).toBe(a1)
    expect<unknown>(answererOf(workOf(true, true), a2)).toEqual(nanda)
    expect<unknown>(answererOf(workOf(true, true), nanda)).toEqual(nanda)
  })
})

describe('the steps of the fold', () => {
  const recorded = (seq: number, event: unknown): Recorded =>
    ({
      seq,
      at: at(seq),
      author: { _tag: 'Person', name: 'Nanda', channel: 'terminal' },
      event,
    }) as Recorded
  const work = {
    questions: new Map([[q1, open]]),
    reviews: new Map([['v4', { _tag: 'Reject', id: 'v4' }]]),
  } as unknown as Work

  test('an answer moves its open question through answerQuestion', () => {
    const event = { _tag: 'Question', id: 'q1', move: { _tag: 'Answered', text: 'm1' } }
    const next = stepOf(work, recorded(5, event))
    expect(next.questions.get(q1)).toMatchObject({
      status: { _tag: 'Answered', answer: 'm1', by: nanda, when: at(5) },
    })
    // A second answer of the same question is a damaged store, not a new answer.
    expect(() => stepOf(next, recorded(6, event))).toThrow(StoreDamaged)
  })

  test('a resolve names an escalation: another review is a damaged store', () => {
    const resolve = {
      _tag: 'Review',
      create: {
        _tag: 'Resolve',
        escalation: 'v4' as EscalationId,
        resolution: 'the date is not needed',
        evidence: [],
      },
    }
    const damage = (() => {
      try {
        stepOf(work, recorded(7, resolve))
      } catch (error) {
        return error
      }
    })()
    expect(damage).toBeInstanceOf(StoreDamaged)
    expect(damage).toMatchObject({ seq: 7, issue: 'v4 is no escalation' })
  })

  // The issue of the damage that a step throws, or undefined when it applies.
  const issueOf = (w: Work, r: Recorded): unknown => {
    try {
      stepOf(w, r)
    } catch (error) {
      return error instanceof StoreDamaged ? error.issue : error
    }
    return undefined
  }

  test('a resolved escalation has no move back to open: a second resolve is damage', () => {
    const escalate = { _tag: 'Escalate', id: 'v5' }
    const resolved = { _tag: 'Resolve', id: 'v6', escalation: 'v5' }
    const reviews = new Map([
      ['v5', escalate],
      ['v6', resolved],
    ])
    const w = { ...work, reviews } as unknown as Work
    const again = {
      _tag: 'Review',
      create: { _tag: 'Resolve', escalation: 'v5', resolution: 'no', evidence: [] },
    }
    expect(issueOf(w, recorded(9, again))).toBe('v5 is resolved already')
  })

  test("an evaluation answers only the person's reject; a resolve is no stop", () => {
    const reviews = new Map<string, object>([
      ['v6', { _tag: 'Resolve', id: 'v6', by: nanda, escalation: 'v5' }],
      ['v8', { _tag: 'Reject', id: 'v8', by: 'a2', of: { _tag: 'Revision' } }],
    ])
    const w = { ...work, reviews } as unknown as Work
    const evaluation = (stop: object) => ({
      _tag: 'Evaluation',
      create: { _tag: 'Evaluation', stop, wrong: 'w', why: 'y', improve: ['i'], level: 'task' },
    })
    const issue = (stop: object) => issueOf(w, recorded(9, evaluation(stop)))
    expect(issue({ _tag: 'PersonReject', id: 'v6' })).toBe('v6 is no reject')
    expect(issue({ _tag: 'PersonReject', id: 'v8' })).toBe('v8 is no reject of the person')
  })

  test('a move of a record in the wrong state is a damaged store', () => {
    const runs = new Map([['h1', { _tag: 'Host', id: 'h1', end: { _tag: 'Done', at: at(1) } }]])
    const permissions = new Map([['x1', { id: 'x1', revoked: { _tag: 'Revoked', at: at(1) } }]])
    const sends = [{ id: 'e3', state: { _tag: 'Delivered', at: at(1) } }]
    const w = { ...work, runs, permissions, sends } as unknown as Work
    const run = (id: string) => ({ _tag: 'Run', id, move: { _tag: 'Done' } })
    expect(() => stepOf(w, recorded(8, run('h1')))).toThrow(StoreDamaged)
    const revoke = { _tag: 'Permission', id: 'x1', move: { _tag: 'Revoked' } }
    expect(() => stepOf(w, recorded(8, revoke))).toThrow(StoreDamaged)
    const deliver = { _tag: 'Send', id: 'e3', move: { _tag: 'Delivered' } }
    expect(() => stepOf(w, recorded(8, deliver))).toThrow(StoreDamaged)
  })

  test('the supervisor fixes a problem, and the record keeps that it did', () => {
    const problems = new Map([['sp1', { id: 'sp1', fixed: { _tag: 'NotFixed' } }]])
    const w = { ...work, problems } as unknown as Work
    const fix = { _tag: 'Problem', id: 'sp1', move: { _tag: 'Fixed' } }
    const bySupervisor = {
      ...recorded(9, fix),
      author: { _tag: 'Supervisor', name: 'Nanda' },
    } as Recorded
    expect(stepOf(w, bySupervisor).problems.get('sp1' as ProblemId)?.fixed).toEqual({
      _tag: 'Fixed',
      by: { _tag: 'Supervisor', name: 'Nanda' },
      at: at(9),
    })
  })

  test('an assignment is given as a maker only for a role that makes', () => {
    const roles = new Map([
      ['writer', { acts: [{ _tag: 'Do', work: 'w' }] }],
      ['linter', { acts: [{ _tag: 'Review', resultsOf: ['writer'] }] }],
    ])
    const w = { ...work, workflow: { roles } } as unknown as Work
    const limit = (tag: string) => (tag === 'GivenMaker' ? { maxAttempts: null } : {})
    const given = (tag: string, role: string) => ({
      _tag: 'Assignment',
      create: { _tag: tag, task: 't1', role, secret: 's', ...limit(tag) },
    })
    expect(issueOf(w, recorded(9, given('GivenMaker', 'linter')))).toBe('linter makes no result')
    expect(issueOf(w, recorded(9, given('GivenReviewer', 'writer')))).toBe(
      'writer makes results: it has attempts',
    )
  })

  test('a check keeps its outside source; a check of no outside source is damage', () => {
    const page = { _tag: 'Outside', name: 'page', revision: 'v4' } as const
    const w = { ...work, sources: new Map([['page', page]]) } as unknown as Work
    const check = (name: string) =>
      recorded(9, { _tag: 'Source', id: name, move: { _tag: 'Checked' } })
    expect(stepOf(w, check('page')).sources.get('page')).toEqual(page)
    expect(issueOf(w, check('npm'))).toBe('npm is no outside source')
  })

  test('the table has a step for every kind', () => {
    // The compiler checks the same: the table's type is total over the kinds.
    expect(Object.keys(STEPS).length).toBeGreaterThan(50)
    expect(STEPS['Forward.Confirmed']).toBeInstanceOf(Function)
  })
})

// An outside source holds for the limit from the last read (a move, or a check of the same
// revision): the time is the log's, so no record keeps it (the owner's ruling, 2026-11-12).
describe('an outside source', () => {
  const logged = (seq: number, event: object) => ({
    recorded: { seq, at: at(seq), author: { _tag: 'Agent', assignment: 'a1' }, event },
    created: [],
  })
  const moved = (name: string, revision: string) => ({
    _tag: 'Source',
    create: { _tag: 'Moved', source: { _tag: 'Outside', name, revision } },
  })
  const work = {
    events: [
      logged(1, moved('page', 'v4')),
      logged(2, moved('npm', '1.2')),
      logged(5, { _tag: 'Source', id: 'page', move: { _tag: 'Checked' } }),
    ],
  } as unknown as Work
  const hour = 60 * 60 * 1000
  const later = (minute: number, hours: number) =>
    new Date(Date.parse(at(minute)) + hours * hour).toISOString() as Time

  test('is fresh within the limit from its last read, then expired', () => {
    expect(sourceStateOf(work, 'page', later(5, 72), 72)).toEqual({ _tag: 'Fresh', seenAt: at(5) })
    const expired = { _tag: 'Expired', seenAt: at(5) } as const
    expect(sourceStateOf(work, 'page', later(6, 72), 72)).toEqual(expired)
    expect(sourceStateOf(work, 'npm', later(2, 24), 12)).toEqual({ _tag: 'Expired', seenAt: at(2) })
  })

  test('that no agent read has no state', () => {
    expect(sourceStateOf(work, 'figma', at(9), 72)).toBeUndefined()
  })
})
