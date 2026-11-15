// P5 T3 (2026-11-15): an act whose content depends on its target is one union, so a mismatched
// pair does not compile. Each illegal value is one line under `@ts-expect-error` (a value that
// compiles again fails `bun run typecheck`); the legal twins must compile. Types only.
import type { ProblemId, ResultId, RevisionId, SessionId } from '../../src/domain/ids.ts'
import type { ActionInput } from './actions.ts'

declare const d1: RevisionId, r1: ResultId, sp1: ProblemId, s1: SessionId
const to = { _tag: 'Terminal', session: s1, via: { _tag: 'Tmux' } } as const
const start = { _tag: 'Start', to, via: { _tag: 'Typed' } } as const
const wake = { _tag: 'Wake', to, cause: { _tag: 'NextChanged' } } as const
const line = { _tag: 'Line', text: 'go' } as never as { readonly _tag: 'Line'; readonly text: never }

// A start sends only its start words; a wake sends a line.
// @ts-expect-error a start with a plain line
export const startLine: ActionInput = { _tag: 'SupervisorSend', target: { reason: start }, content: { keys: line } }
// @ts-expect-error a wake with the start words
export const wakeStart: ActionInput = { _tag: 'SupervisorSend', target: { reason: wake }, content: { keys: { _tag: 'StartPrompt' } } }
export const startOk: ActionInput = { _tag: 'SupervisorSend', target: { reason: start }, content: { keys: { _tag: 'StartPrompt' } } }
export const wakeOk: ActionInput = { _tag: 'SupervisorSend', target: { reason: wake }, content: { keys: line } }

// A reject of a draft gives a reason; a reject of a result names points.
const ofDraft = { of: { _tag: 'Revision', id: d1 } } as const
const ofResult = { of: { _tag: 'Result', id: r1 } } as const
// @ts-expect-error points on a draft
export const draftPoints: ActionInput = { _tag: 'Reject', target: ofDraft, content: { points: [] } }
// @ts-expect-error a reason on a result
export const resultReason: ActionInput = { _tag: 'Reject', target: ofResult, content: { reason: 'r' } }
export const draftOk: ActionInput = { _tag: 'Reject', target: ofDraft, content: { reason: 'r' } }
export const resultOk: ActionInput = { _tag: 'Reject', target: ofResult, content: { points: [] } }

// A hope only on the words of a draft; the target names its kind.
const onProblem = { on: { _tag: 'Problem', id: sp1 } } as const
// @ts-expect-error a hope on a problem
export const problemHope: ActionInput = { _tag: 'WriteHostWords', target: onProblem, content: { text: 't', hope: 'h' } }
// @ts-expect-error a bare id names no kind
export const bareOn: ActionInput = { _tag: 'WriteHostWords', target: { on: sp1 }, content: { text: 't' } }
export const problemOk: ActionInput = { _tag: 'WriteHostWords', target: onProblem, content: { text: 't' } }
export const draftWords: ActionInput = {
  _tag: 'WriteHostWords',
  target: { on: { _tag: 'Draft', id: d1 } },
  content: { text: 't', hope: 'h' },
}
