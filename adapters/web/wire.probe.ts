// P5 T4-T6 (2026-11-15): the terminal, the decisions and the views on the wire are tagged
// unions. Each illegal value is one line under `@ts-expect-error` (a value that compiles again
// fails `bun run typecheck`); the legal twins must compile. Types only.
import type { TerminalReading } from '../../core/schema/outside.ts'
import type {
  Decision,
  DirectionCard,
  Owner,
  ProjectSummary,
  TaskPanel,
  TerminalRef,
  WorkCard,
} from '../../core/schema/index.ts'
import type { AssignmentId, ProblemId, RevisionId, SessionId, TaskId, Time } from '../../core/schema/index.ts'

declare const a1: AssignmentId, s1: SessionId, sp1: ProblemId, d1: RevisionId, t1: TaskId, at: Time
const owner = { a: a1, role: 'r', model: 'opus', agent: null, inside: null, resumable: true } as const

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

// T6: a view's state says what it has; the page reads no state from a null.
declare const words: Extract<DirectionCard, { readonly state: 'ready' }>['draft']
const head = { id: 'x', name: 'n', origin: 'o', principle: null, example: null } as const
// @ts-expect-error a ready direction with no draft
export const readyBare: DirectionCard = { ...head, state: 'ready' }
// @ts-expect-error a question with no open question
export const noOpen: DirectionCard = { ...head, state: 'question', draft: words, open: [] }
// @ts-expect-error a first draft that waits with a Revise's words
export const draftWords: DirectionCard = { ...head, state: 'loading', why: 'drafting', words: 'w' }
export const ready: DirectionCard = { ...head, state: 'ready', draft: words }
export const drafting: DirectionCard = { ...head, state: 'loading', why: 'drafting' }
const task = { kind: 'task', id: t1, at, title: 't', badge: false } as const
// @ts-expect-error a project of a task with a run's state
export const taskTalks: ProjectSummary = { ...task, state: 'talks', top: t1 }
// @ts-expect-error a project of a task with no top task
export const noTop: ProjectSummary = { ...task, state: 'works', top: null }
export const taskWorks: ProjectSummary = { ...task, state: 'works', top: t1 }
declare const card: Omit<WorkCard, 'now'>
// @ts-expect-error work in review with no result
export const reviewBare: WorkCard = { ...card, now: { state: 'in review' } }
// @ts-expect-error an accepted work card: the canvas shows only what runs
export const accepted: WorkCard = { ...card, now: { state: 'accepted' } }
export const works: WorkCard = { ...card, now: { state: 'works' } }
declare const panel: Omit<TaskPanel, 'top'>
// @ts-expect-error a part of a task with directions
export const partDirections: TaskPanel = { ...panel, top: false, directions: [] }
export const part: TaskPanel = { ...panel, top: null }
