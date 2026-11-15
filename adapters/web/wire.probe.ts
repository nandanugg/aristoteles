// P5 T4, T5 (2026-11-15): the terminal and the decisions on the wire are tagged unions. Each
// illegal value is one line under `@ts-expect-error` (a value that compiles again fails `bun run
// typecheck`); the legal twins must compile. Types only.
import type { TerminalReading } from '../../core/schema/outside.ts'
import type { Decision, Owner, TerminalRef } from '../../core/schema/index.ts'
import type { AssignmentId, ProblemId, RevisionId, SessionId, TaskId, Time } from '../../core/schema/index.ts'

declare const a1: AssignmentId, s1: SessionId, sp1: ProblemId, d1: RevisionId, t1: TaskId, at: Time
const owner = { a: a1, role: 'r', tier: 'sol', agent: null, inside: null, resumable: true } as const

// T4: a terminal is in one state, and its session lives in that state.
// @ts-expect-error a reading that runs and ended
export const both: TerminalReading = { _tag: 'Live', ended: true, exit: 1, lastOutput: 0 }
// @ts-expect-error the exit of a pane that runs
export const liveExit: TerminalReading = { _tag: 'Live', exit: 1, lastOutput: 0 }
export const ended: TerminalReading = { _tag: 'Ended', exit: 1, lastOutput: 0 }
// @ts-expect-error a card with no terminal that runs
export const noneLive: Owner = { ...owner, terminal: { _tag: 'None', session: s1 } }
// @ts-expect-error the old pair of booleans
export const pair: Owner = { ...owner, terminal: { _tag: 'None' }, live: true, ended: true }
export const unknown: Owner = { ...owner, terminal: { _tag: 'Unknown', session: s1 } }
export const closed: TerminalRef = { a: 'h1', terminal: { _tag: 'Closed', session: s1 } }

// T5: each kind has the id of its own record, a hope only on a draft, and no held state.
const base = { task: t1, text: 'x', words: null, at, acts: [], waits: null } as const
// @ts-expect-error a system problem whose id is a draft's
export const draftId: Decision = { ...base, _tag: 'System', id: d1, stopped: t1 }
// @ts-expect-error a hope on a system problem
export const hope: Decision = { ...base, _tag: 'System', id: sp1, stopped: t1, hope: 'h' }
// @ts-expect-error a held decision on the wire
export const held: Decision = { ...base, _tag: 'System', id: sp1, stopped: t1, shown: { _tag: 'Shown' } }
export const problem: Decision = { ...base, _tag: 'System', id: sp1, stopped: t1 }
