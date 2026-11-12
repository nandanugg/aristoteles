// The probes of REVIEW-3 (plan/types; its scratch probe-1, probe-2, probe-new and probe-states),
// kept so that the typecheck guards them: each illegal value is one line under
// `@ts-expect-error` (a value that compiles again is a TS2578 and fails `bun run typecheck`), and
// each real state at the end must compile. A legal twin beside a line differs by one thing. The
// lines are in the shapes of the owner's later rulings (why, Source, the author of an event);
// a value that no type can refuse is a comment that names the check that refuses it. Nothing
// runs this file: it is types only.
import type { Agent, Author, Human } from './actor.ts'
import type { CountedAct, Event, EventOf, ForwardedAct, Recorded } from './events.ts'
import type {
  AssignmentId,
  DirectionId,
  EscalationId,
  EvaluationId,
  EventRef,
  ExhaustionId,
  PermissionId,
  PointId,
  PositiveInt,
  ProblemId,
  QuestionId,
  RejectId,
  ResultId,
  RevisionId,
  ReviewId,
  RoleName,
  RuleEntry,
  RunId,
  SessionId,
  TaskDraftId,
  TaskId,
  Time,
  VersionId,
} from './ids.ts'
import type {
  Accept,
  Assignment,
  Blocker,
  Deciders,
  Direction,
  Exhaustion,
  OfficialDirection,
  Permission,
  Question,
  Reject,
  Resolve,
  Revision,
  Stop,
  TaskState,
  Under,
  Version,
} from './model.ts'
import {
  answerQuestion,
  finishAssignment,
  type Failed,
  type OpenAssignment,
  type OpenQuestion,
  resumeTerminal,
  runClosed,
  runDone,
} from './moves.ts'
import type { Activity, HostRun, Problem, Send } from './ui-model.ts'
import type { Forward } from './work.ts'
import type { Guard } from '../cli/guard.ts'

declare const t: TaskId, r: ResultId, v: ReviewId, rej: RejectId, esc: EscalationId
declare const a: AssignmentId, a7: AssignmentId, now: Time, rule: RuleEntry, d: RevisionId
declare const ev: EvaluationId, vid: VersionId, did: DirectionId, role: RoleName, linter: RoleName
declare const q1: QuestionId, s1: SessionId, sp1: ProblemId, x1: PermissionId, pos3: PositiveInt
declare const e12: EventRef, ex1: ExhaustionId, p1: PointId, h1: RunId, td1: TaskDraftId
declare const dirY: DirectionId

const agent: Agent = { _tag: 'Agent', name: 'sonnet', run: 'sonnet-1' }
const nanda: Human = { _tag: 'Human', name: 'Nanda' }
const under: Under = new Map([[did, 2 as PositiveInt]])
const base = { under, when: now, at: 1 }
const evidence = { says: 's', meets: rule, at: 'README', uses: [] }
const a3: Author = { _tag: 'Agent', assignment: a }
const to = { _tag: 'Terminal', session: s1, via: { _tag: 'Tmux' } } as const

// --- REVIEW-1's values (probe-1) ----------------------------------------------------------------

export const ok1: Human = nanda
// @ts-expect-error 1: an Agent is no Human
export const p1Agent: Human = agent

const pointOf = { _tag: 'Task', id: t, points: [{ text: 'x' }] } as const
export const ok3: Reject = { ...base, by: a, _tag: 'Reject', id: rej, of: pointOf }
// @ts-expect-error 3a: a point of a task names a rule
export const p3a: Reject = { ...base, by: a, _tag: 'Reject', id: rej, of: { ...pointOf, points: [{ text: 'x', breaks: { _tag: 'Rule', rule } }] } }
// @ts-expect-error 3b: a Reject of a task with no points
export const p3b: Reject = { ...base, by: a, _tag: 'Reject', id: rej, of: { ...pointOf, points: [] } }

const ofResult = { _tag: 'Result', id: r, evidence: [evidence] } as const
export const ok4: Accept = { ...base, by: a, id: v, _tag: 'Accept', of: ofResult, reason: null }
// @ts-expect-error 4: an Accept of a result with no evidence
export const p4: Accept = { ...base, by: a, id: v, _tag: 'Accept', of: { ...ofResult, evidence: [] }, reason: null }

const asg = { id: a, actor: agent, task: t, under, parent: { _tag: 'GivenByPerson' }, when: now, end: { _tag: 'NotEnded' } } as const
export const ok5: Assignment = { ...asg, role: linter, _tag: 'Reviewer' }
// @ts-expect-error 5a: the record: a Reviewer with maxAttempts
export const p5a: Assignment = { ...asg, role: linter, _tag: 'Reviewer', maxAttempts: { _tag: 'AtMost', max: pos3 } }
const reviewer = { _tag: 'GivenReviewer', task: t, role: linter, secret: 's' } as const
export const ok5b: Event = { _tag: 'Assignment', create: reviewer }
// @ts-expect-error 5b: the stored event: a reviewer's assignment with a limit
export const p5b: Event = { _tag: 'Assignment', create: { ...reviewer, maxAttempts: pos3 } }

export const ok6: Assignment = { ...asg, role, _tag: 'Maker', maxAttempts: { _tag: 'AtMost', max: pos3 } }
// @ts-expect-error 6: a limit that is no positive whole number
export const p6: Assignment = { ...asg, role, _tag: 'Maker', maxAttempts: { _tag: 'AtMost', max: -2.5 } }

const qBase = { _tag: 'Question', id: q1, text: 'which section?', stops: t, answerBy: a, from: a, status: { _tag: 'Open' }, when: now } as const
export const ok7: Question = qBase
// @ts-expect-error 7a: answerBy an agent run
export const p7a: Question = { ...qBase, answerBy: agent }
// @ts-expect-error 7b: stops nothing
export const p7b: Question = { ...qBase, stops: [] }
const asked = { _tag: 'Asked', text: 'which section?', to: { _tag: 'Above' } } as const
export const ok7c: Event = { _tag: 'Question', create: asked }
// @ts-expect-error 7c: a blank question
export const p7c: Event = { _tag: 'Question', create: { ...asked, text: '' } }

const why = { _tag: 'Given', reason: 'Shorten', words: null } as const
const revBase = { _tag: 'New', id: d, of: did, answers: [rej], when: now, at: 1, says: 's', standards: [] } as const
export const ok8: Revision<Direction> = { ...revBase, origin: { _tag: 'Written', by: a }, why }
// @ts-expect-error 8a: a person as the reviser
export const p8a: Revision<Direction> = { ...revBase, origin: { _tag: 'Written', by: nanda }, why }
// @ts-expect-error 8b: a reason that is no reason
export const p8b: Revision<Direction> = { ...revBase, origin: { _tag: 'Written', by: a }, why: { ...why, reason: 'typo' } }

const dirBase = { id: did, name: 'x', owner: nanda, maxStandards: { _tag: 'Unlimited' }, approvedBy: { _tag: 'Owner' }, source: { _tag: 'Local' } } as const
const version1: Version<Direction> = { of: did, number: 1 as PositiveInt, revision: d, when: now, says: 's', standards: [] }
export const ok10: Direction = { ...dirBase, from: ['Logos'], _tag: 'Official', versions: [version1] }
// @ts-expect-error 10a: a principle that does not exist
export const p10a: Direction = { ...dirBase, from: ['Logoss'], _tag: 'Official', versions: [version1] }
// @ts-expect-error 10b: an official direction with no version
export const p10b: Direction = { ...dirBase, from: ['Logos'], _tag: 'Official', versions: [] }
// @ts-expect-error 11a: version number 0
export const p11a: Version<Direction> = { ...version1, number: 0 }

export const ok12: Deciders = { _tag: 'Or', items: [nanda] }
// @ts-expect-error 12: an Or with no items
export const p12: Deciders = { _tag: 'Or', items: [] }
// @ts-expect-error 13: a model run decides
export const p13: Deciders = agent

const permBase = { id: x1, to: role, by: a, until: now, revoked: { _tag: 'NotRevoked' }, when: now, at: 1 } as const
export const ok14: Permission = { ...permBase, act: { _tag: 'Review', resultsOf: [role] } }
// @ts-expect-error 14: a permission of Do
export const p14: Permission = { ...permBase, act: { _tag: 'Do', work: 'w' } }

const rejectR = { _tag: 'Review', create: { _tag: 'Reject', of: { _tag: 'Result', id: r, points: [{ text: 'x', breaks: null }] } } } as const
const acceptR = { _tag: 'Review', create: { _tag: 'Accept', of: { _tag: 'Result', id: r, evidence: [{ rule: null, where: 'w', what: 'x' }] }, reason: null } } as const
export const ok16: Forward = { event: e12, _tag: 'Counted', inner: rejectR }
export const ok16a: Forward = { event: e12, _tag: 'Confirmable', state: { _tag: 'Waiting' }, inner: acceptR }
// @ts-expect-error 16a: an accept counted at once
export const p16a: Forward = { event: e12, _tag: 'Counted', inner: acceptR }
// @ts-expect-error 16b: a reject that waits for the person's confirm
export const p16b: Forward = { event: e12, _tag: 'Confirmable', state: { _tag: 'Waiting' }, inner: rejectR }

const ofDraft = { _tag: 'Revision', id: d, reason: 'too long' } as const
export const ok17: Event = { _tag: 'Review', create: { _tag: 'Reject', of: ofDraft } }
// @ts-expect-error 17a: the reject of a draft with no reason
export const p17a: Event = { _tag: 'Review', create: { _tag: 'Reject', of: { ...ofDraft, reason: null } } }
// @ts-expect-error 17b: a blank reason
export const p17b: Event = { _tag: 'Review', create: { _tag: 'Reject', of: { ...ofDraft, reason: '' } } }

export const ok18: Event = { _tag: 'Assignment', id: a, move: { _tag: 'BriefedToCheck', result: r } }
// @ts-expect-error 18: a checker's brief that is also a first brief
export const p18: Event = { _tag: 'Assignment', id: a, move: { _tag: 'BriefedToCheck', result: r, untouched: {}, before: { _tag: 'NotInPlace' } } }
export const ok19: Event = { _tag: 'Terminal', id: s1, move: { _tag: 'Stopped' } }
// @ts-expect-error 19: a Stop with tries
export const p19: Event = { _tag: 'Terminal', id: s1, move: { _tag: 'Stopped', tries: 7 } }

const grant = { _tag: 'Granted', act: { _tag: 'Approve', resultsOf: [role] }, to: role, until: now } as const
export const ok20: Event = { _tag: 'Permission', create: grant }
// @ts-expect-error 20: an approve grant on a task id
export const p20: Event = { _tag: 'Permission', create: { ...grant, act: { _tag: 'Approve', resultsOf: [t] } } }

const evalOk = { _tag: 'Evaluation', stop: { _tag: 'Exhaustion', id: ex1 }, wrong: 'w', why: 'y', improve: ['i'], level: 'task' } as const
export const ok21: Event = { _tag: 'Evaluation', create: evalOk }
// @ts-expect-error 21a: nothing to improve
export const p21a: Event = { _tag: 'Evaluation', create: { ...evalOk, improve: [] } }
// @ts-expect-error 21b: the stop is any review id
export const p21b: Event = { _tag: 'Evaluation', create: { ...evalOk, stop: v } }
// @ts-expect-error 21c: a blank wrong
export const p21c: Event = { _tag: 'Evaluation', create: { ...evalOk, wrong: '' } }

export const ok22: Event = { _tag: 'HostWords', create: { _tag: 'ProblemWords', on: sp1, text: 'x' } }
// @ts-expect-error 22: a hope on the words of a problem
export const p22: Event = { _tag: 'HostWords', create: { _tag: 'ProblemWords', on: sp1, text: 'x', hope: 'h' } }

declare const open: OpenQuestion
const answered = answerQuestion(open, 'Design', a, now)
// @ts-expect-error 23a: the move: an answered question is answered again
export const p23a = answerQuestion(answered, 'again', a, now)
// 23b, a record literal that writes Open over Answered, compiles: a record is a plain object. The
// architecture test (architecture.test.ts) refuses any state written outside moves.ts.

// --- design-review-2's values (probe-2) ---------------------------------------------------------

export const okA1: Event = { _tag: 'Note', create: { _tag: 'Message', about: t, text: 'x' } }
// @ts-expect-error A1: a Question as a Note creation
export const pA1: Event = { _tag: 'Note', create: { _tag: 'Question', text: 'which section?', stops: t, answerBy: a, from: a7, status: { _tag: 'Answered', answer: 'Design', by: a, when: now } } }
// @ts-expect-error A1b: a Lesson as a Note creation
export const pA1b: Event = { _tag: 'Note', create: { _tag: 'Lesson', text: 'x', rule: vid } }

export const okA3x: Exhaustion = { id: ex1, fault: p1, when: now, at: 1 }
// @ts-expect-error A3x: an Accept's id as a fault
export const pA3x: Exhaustion = { id: ex1, fault: v, when: now, at: 1 }
const resolved = { resolution: 'the date is not needed', evidence: [] } as const
export const okA3r: Resolve = {
  ...base, by: a, _tag: 'Resolve', id: v, escalation: esc, ...resolved,
}
// @ts-expect-error A3r: an Accept's id as the escalation of a Resolve
export const pA3r: Resolve = { ...base, by: a, _tag: 'Resolve', id: v, escalation: v, ...resolved }

const ofPoints = { _tag: 'Result', id: r, points: [{ text: 'x', breaks: { _tag: 'NoRule' } }] } as const
export const okA4: Reject = { ...base, by: a, _tag: 'Reject', id: rej, of: ofPoints }
// @ts-expect-error A4: a point that names its own id
export const pA4: Reject = { ...base, by: a, _tag: 'Reject', id: rej, of: { ...ofPoints, points: [{ id: p1, text: 'x', breaks: { _tag: 'NoRule' } }] } }


const config = { project: 'p', people: ['Nanda'], limits: { low: {}, medium: {}, high: {} }, roles: {} }
export const okA7: Event = { _tag: 'Workflow', create: { _tag: 'Defined', config: { ...config, decide: { [role]: 'a' } }, hashes: {}, texts: {} } }
// @ts-expect-error A7: the stored config holds a list of entries, so two for one maker
export const pA7: Event = { _tag: 'Workflow', create: { _tag: 'Defined', config: { ...config, decide: [{ resultsOf: role, by: 'a' }, { resultsOf: role, by: 'b' }] }, hashes: {}, texts: {} } }

// A8 (a version of another direction inside an official one) is open with the owner (card 1).
const dirX = { ...dirBase, _tag: 'Official' } as const
const versionY: Version<Direction> = { ...version1, of: dirY, number: 2 as PositiveInt }
export const openA8: OfficialDirection = { ...dirX, from: [], versions: [versionY, version1] }

// A9 (agent a3's brief of a7) is one event of the ruled form { id, move }, so no type tells the
// two ids apart: events.ts writtenBy refuses it at the write and at the decode of the store.

const supervisorTell = { _tag: 'Supervisor', reason: { _tag: 'AgentAtPrompt', prompt: e12 } } as const
export const okA10: Send = { id: e12, from: supervisorTell, keys: { _tag: 'Enter' }, state: { _tag: 'Pending' }, at: now }
// @ts-expect-error A10a: Pending with its own since
export const pA10a: Send = { id: e12, from: supervisorTell, keys: { _tag: 'Enter' }, state: { _tag: 'Pending', since: now }, at: now }
// @ts-expect-error A10b: a tell about a prompt with its own destination
export const pA10b: Send = { id: e12, from: { ...supervisorTell, reason: { _tag: 'AgentAtPrompt', prompt: e12, to } }, keys: { _tag: 'Enter' }, state: { _tag: 'Pending' }, at: now }

const change = { _tag: 'Change', base: vid, id: d, of: did, answers: [], why: { _tag: 'NoneGiven' }, when: now, at: 1, says: 's', standards: [] } as const
export const okA11: Revision<Direction> = { ...change, origin: { _tag: 'Imported', commit: '9f2c1ab', ref: { _tag: 'DefaultBranch' } } }
// @ts-expect-error A11: an import with a reviser
export const pA11: Revision<Direction> = { ...change, origin: { _tag: 'Imported', commit: '9f2c1ab', ref: { _tag: 'DefaultBranch' }, by: agent } }

export const okA12: Event = { _tag: 'Terminal', id: s1, move: { _tag: 'Failed', why: 'silent', lastLines: 'x' } }
// @ts-expect-error A12a: words on a Stop
export const pA12a: Event = { _tag: 'Terminal', id: s1, move: { _tag: 'Stopped', text: 'words on a Stop' } }
// @ts-expect-error A12b: a failure after 7 tries
export const pA12b: Event = { _tag: 'Terminal', id: s1, move: { _tag: 'Failed', why: 'silent', lastLines: 'x', tries: 7 } }

const problem = { id: sp1, stopped: t, says: 'x', at: now, fixed: { _tag: 'NotFixed' } } as const
export const okA13: Problem = { ...problem, recordedBy: { _tag: 'Host', assignment: a } }
// @ts-expect-error A13a: the record: a problem recorded by a model run
export const pA13a: Problem = { ...problem, recordedBy: agent }
const recorded = { _tag: 'Problem', create: { _tag: 'Recorded', stopped: t, says: 'x' } } as const
export const okA13b: Recorded = { seq: 1, at: now, author: { _tag: 'Supervisor', name: 'Nanda' }, event: recorded }
// @ts-expect-error A13b: the stored event: a model run records a problem
export const pA13b: Recorded = { seq: 1, at: now, author: { _tag: 'ModelRun', name: 'opus', at: now }, event: recorded }

// --- REVIEW-3's new values (probe-new) ----------------------------------------------------------

declare const openA: OpenAssignment
const finished = finishAssignment(openA, now)
// @ts-expect-error N1: a finished assignment is finished again
export const n1 = finishAssignment(finished, now)
declare const openHost: HostRun & { readonly end: { readonly _tag: 'NotEnded' } }
export const okN2 = runDone(openHost, now)
// @ts-expect-error N2: a closed host run is made done
export const n2 = runDone(runClosed(openHost, now), now)
// @ts-expect-error N3: the end of a finished assignment passes as a task id
export const n3: TaskId = finished.end

declare const rw: EventOf<'Workflow.RoleWordsChanged'>
// @ts-expect-error N4: the move of the one workflow has no id
export const n4: number = rw.id

// The owner's ruling (2026-11-12): a Resolve has no verdict. It is no fault and no stop; the
// decider's Reject after it is.
declare const resolve: Resolve
export const okN5: Exhaustion = { id: ex1, fault: p1, when: now, at: 1 }
// @ts-expect-error N5a: a Resolve is a fault of the maker
export const n5a: Exhaustion = { id: ex1, fault: resolve.id, when: now, at: 1 }
export const okN5b: Stop = { _tag: 'PersonReject', id: rej }
// @ts-expect-error N5b: a Resolve stops the task
export const n5b: Stop = { _tag: 'PersonReject', id: resolve.id }
// @ts-expect-error N5c: a Resolve with a blank resolution
export const n5c: Resolve = { ...okA3r, resolution: '' }
// @ts-expect-error N5d: a Resolve with a verdict
export const n5d: Resolve = { ...okA3r, verdict: { _tag: 'Reject', reason: 'wrong' } }
const forwardedResolve = {
  _tag: 'Resolve', escalation: esc, resolution: 'go on', evidence: [],
} as const
export const okN5e: ForwardedAct = { _tag: 'Review', create: forwardedResolve }
// @ts-expect-error N5e: the person's forwarded Resolve counts at once (it waits for the confirm)
export const n5e: CountedAct = { _tag: 'Review', create: forwardedResolve }

export const okN6: Recorded = { seq: 1, at: now, author: a3, event: acceptR }
// @ts-expect-error N6: the daily refresh accepts a result
export const n6: Recorded = { seq: 1, at: now, author: { _tag: 'Refresh' }, event: acceptR }

const sentByAgent = { _tag: 'Sent', from: { _tag: 'Agent', to }, keys: { _tag: 'Enter' } } as const
export const okN7: Recorded = { seq: 1, at: now, author: a3, event: { _tag: 'Send', create: sentByAgent } }
// @ts-expect-error N7: the sender twice (the author is the sender)
export const n7: Recorded = { seq: 1, at: now, author: a3, event: { _tag: 'Send', create: { ...sentByAgent, from: { _tag: 'Agent', assignment: a7, to } } } }
// @ts-expect-error N7b: the supervisor's send by an agent author
export const n7b: Recorded = { seq: 1, at: now, author: a3, event: { _tag: 'Send', create: { _tag: 'Sent', from: supervisorTell, keys: { _tag: 'Enter' } } } }
const start = { _tag: 'Supervisor', reason: { _tag: 'Start', to, via: { _tag: 'Typed' } } } as const
export const okN8: Event = { _tag: 'Send', create: { _tag: 'Sent', from: start, keys: { _tag: 'StartPrompt' } } }
// @ts-expect-error N8: a first input whose words (with the token) are stored as a Line
export const n8: Event = { _tag: 'Send', create: { _tag: 'Sent', from: start, keys: { _tag: 'Line', text: 'start; token=abc' } } }
// @ts-expect-error N9: an agent's send of the start words with a token
export const n9: Event = { _tag: 'Send', create: { ...sentByAgent, keys: { _tag: 'StartPrompt' } } }
// @ts-expect-error N10: a second form of Enter alone (a Line with no words)
export const n10: Event = { _tag: 'Send', create: { ...sentByAgent, keys: { _tag: 'Line', text: '' } } }

export const okN11: Recorded = { seq: 1, at: now, author: a3, event: { _tag: 'Question', create: asked } }
// @ts-expect-error N11: agent a3 asks agent a7 directly (only the person's forward asks an agent)
export const n11: Recorded = { seq: 1, at: now, author: a3, event: { _tag: 'Question', create: { ...asked, to: { _tag: 'Agent', assignment: a7 } } } }

export const okN12: Under = new Map([[did, 2 as PositiveInt]])
// @ts-expect-error N12: a version id (of any direction) under the key of a direction
export const n12: Under = new Map([[did, vid]])

export const okN13: Guard<'Review.Accept'> = { claim: true, targets: (e) => [e.create.of.id] }
// @ts-expect-error N13: a path that names no field
export const n13: Guard<'Review.Accept'> = { claim: true, targets: (e) => [e.create.of.idd] }

const roleFile = { description: 'd', intro: 'i', responsibilities: [], acts: [], checks: [] }
const defined = { project: 'p', people: ['Nanda'], limits: { low: {}, medium: {}, high: {} }, decide: {} }
export const okN14: Event = { _tag: 'Workflow', create: { _tag: 'Defined', config: { ...defined, roles: { writer: { ...roleFile, kind: 'agent', tier: 'high' } } }, hashes: {}, texts: {} } }
// @ts-expect-error N14: an agent role with no tier
export const n14: Event = { _tag: 'Workflow', create: { _tag: 'Defined', config: { ...defined, roles: { writer: { ...roleFile, kind: 'agent' } } }, hashes: {}, texts: {} } }

// N15 (a closed terminal closed again) is part of the UI proposal, open with the owner.

const ofEvaluation = { _tag: 'Evaluation', id: ev, evidence: [evidence] } as const
export const okN16: Accept = { ...base, id: v, by: nanda, _tag: 'Accept', of: ofEvaluation, reason: null }
// @ts-expect-error N16: an agent accepts an evaluation
export const n16: Accept = { ...base, id: v, by: a7, _tag: 'Accept', of: ofEvaluation, reason: null }

const given = { _tag: 'GivenMaker', task: t, role, secret: 's', maxAttempts: null } as const
export const okN17: Recorded = { seq: 1, at: now, author: a3, event: { _tag: 'Assignment', create: given } }
// @ts-expect-error N17: who gave it, twice (the author is the parent)
export const n17: Recorded = { seq: 1, at: now, author: a3, event: { _tag: 'Assignment', create: { ...given, parent: a7 } } }

// --- real states that must compile (probe-states) -----------------------------------------------

export const s21: Stop = { _tag: 'PersonReject', id: p1 }
export const s22: Recorded = { seq: 1, at: now, author: { _tag: 'Supervisor', name: 'Nanda' }, event: { _tag: 'Terminal', id: s1, move: { _tag: 'Failed', why: 'silent', lastLines: 'x' } } }
export const s23a: Event = { _tag: 'Send', create: { _tag: 'Sent', from: { _tag: 'Supervisor', reason: { _tag: 'Start', to, via: { _tag: 'LaunchArgument' } } }, keys: { _tag: 'StartPrompt' } } }
export const s23b: Event = { _tag: 'Send', create: { _tag: 'Sent', from: { _tag: 'Supervisor', reason: { _tag: 'DraftOpened', draft: td1 } }, keys: { _tag: 'Line', text: 'go' } } }
export const s23c: Event = { _tag: 'Send', create: { _tag: 'Sent', from: { _tag: 'Supervisor', reason: { _tag: 'Retry', to, attempt: 2, via: { _tag: 'Typed' } } }, keys: { _tag: 'Line', text: 'continue' } } }
export const s24a: Event = { _tag: 'Send', id: e12, move: { _tag: 'Dropped', why: { _tag: 'NotReadyInTime' } } }
export const s24b: Event = { _tag: 'Send', id: e12, move: { _tag: 'Dropped', why: { _tag: 'TypingFailed' } } }
export const s24c: Event = { _tag: 'Send', id: e12, move: { _tag: 'Dropped', why: { _tag: 'Merged', into: e12 } } }
export const s25: Event = { _tag: 'Send', create: sentByAgent }
export const s26a: Event = { _tag: 'Question', create: { _tag: 'Escalated', text: 'blocked' } }
export const s26b: Event = { _tag: 'Question', create: { _tag: 'Asked', text: 'x', to: { _tag: 'Owner' } } }
export const s27: Event = { _tag: 'Revision', create: { _tag: 'Drafted', direction: { id: did, name: 'd2 name', owner: 'Nanda', from: ['Logos'], says: 's', standards: [] }, answers: [], why: { _tag: 'NoneGiven' } } }
export const s28: Event = { _tag: 'Role', id: role, move: { _tag: 'Fitted', hash: 'h', answers: [{ id: 1, yes: true, why: 'y' }] } }
export const r21: Resolve = {
  id: v, by: nanda, under, when: now, at: 1,
  _tag: 'Resolve', escalation: esc, resolution: 'drop the date', evidence: [],
}
export const r22: TaskState = { _tag: 'WaitsForEvaluation', stop: s21 }
export const r23a: Blocker = { _tag: 'DeciderAnyApprover' }
export const r23b: Blocker = { _tag: 'DeciderWaits', leaves: [nanda] }
export const r24a: Activity = { _tag: 'Busy', lastOutput: now }
export const r24b: Activity = { _tag: 'Quiet', stepKey: 'Review r3' }
export const r25: Event = { _tag: 'Send', create: { _tag: 'Sent', from: { _tag: 'Supervisor', reason: { _tag: 'ProblemRetry', problem: sp1 } }, keys: { _tag: 'Line', text: 'try again' } } }
declare const failed: Failed
export const na = resumeTerminal(failed, nanda, now)
export const nc: Problem['fixed'] = { _tag: 'Fixed', by: { _tag: 'Supervisor', name: 'Nanda' }, at: now }
