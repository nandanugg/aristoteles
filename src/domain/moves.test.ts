// The moves of the records with a lifecycle: each one leaves only the state that it may leave.
// A move back does not compile (the @ts-expect-error lines fail the typecheck if it ever does);
// the fold's table (core/state) finds the record, narrows it, and calls the move.
import { describe, expect, test } from 'bun:test'
import { human } from './actor.ts'
import type { ConfigFile } from './files.ts'
import type {
  AssignmentId,
  PermissionId,
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
import type { HostRun, TerminalState } from './ui-model.ts'

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
    terminal: { _tag: 'Window' },
    formerSessions: [],
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
