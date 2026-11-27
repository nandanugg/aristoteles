import { Schema } from 'effect'
import { ApprovedFiles } from './activation.ts'
import { ProposalValue } from './proposal.ts'
import { versionOf } from './version.ts'
import { ReviewFacts } from './review.ts'
import { line, protocol } from './lines.ts'
import { Attempt, CommandOutcomes, RaiseReason, TaskStages, WorkResult, DirectionVersion, type TaskPhase } from './task.ts'
import { Evidence } from './evidence.ts'
import { Fact } from './direction.ts'
import { Answer, AnswerKind, QuestionRecipient } from './question.ts'
import { Human, Pane, Role, Staff, Subscription } from './staff.ts'
import {
  AttemptNumber, EventNumber, Goal, Name, ProposalKey, QuestionKey, Markdown, Rationale,
  RetryLimit, StaffSessionKey, TaskKey, type Of,
} from './values.ts'

const questionOwner = Schema.Union([
  Schema.TaggedStruct('Project', {}),
  Schema.TaggedStruct('Proposal', { key: ProposalKey }),
  Schema.TaggedStruct('Task', { key: TaskKey }),
])

const configuration = Schema.Struct({ owner: Human, host: Role, pipeline: Role, staff: Staff, subscription: Subscription, roles: Schema.Array(Role) })
export const TaskDraft = Schema.Struct({
  name: Name, goal: Goal, reviewer: Role, direction: DirectionVersion,
  stages: TaskStages,
  facts: Schema.Array(Fact).check(Schema.makeFilter((facts) => new Set(facts.map(({ name }) => name)).size === facts.length)),
})
const empty = Schema.Record(Schema.String, Schema.Never)
const staffing = Schema.Struct({ staffedIn: EventNumber })
const why = Schema.Struct({ why: Rationale })
const files = Schema.Struct({ files: ApprovedFiles })
const value = Schema.Struct({ value: ProposalValue, previous: Schema.Union([Schema.TaggedStruct('None', {}), Schema.TaggedStruct('Version', { version: versionOf(ProposalValue) })]) })
const proposalDraft = Schema.Struct({ value: ProposalValue })
const reviewFacts = Schema.Struct({ facts: ReviewFacts })
const reviewReport = Schema.Struct({ ...reviewFacts.fields, queuedIn: EventNumber })
const workProblem = Schema.Struct({
  attempt: AttemptNumber, reason: Schema.Literals(['TooBig', 'WrongTask']), evidence: Schema.NonEmptyArray(Evidence),
})
const taskReviewReport = Schema.Struct({
  ...reviewReport.fields, limit: RetryLimit,
})

export const projectLine = line({
  null: { from: Schema.Null, owes: 'Owner', moves: { open: { to: ['Onboarding'], input: configuration, submission: { move: 'open', input: configuration } } } },
  Onboarding: { from: Schema.Literal('Onboarding'), owes: 'Owner', moves: { next: { to: ['Activating'], input: files, submission: { move: 'next', input: files } } } },
  Activating: { from: Schema.Literal('Activating'), owes: 'Engine', moves: { back: { to: ['RollingBack'], input: why } } },
  RollingBack: { from: Schema.Literal('RollingBack'), owes: 'Engine', moves: { back: { to: ['Onboarding'], input: empty } } },
  Active: { from: Schema.Literal('Active'), owes: 'None', moves: {
    end: { to: ['Ended'], input: empty, owes: 'Owner', submission: { move: 'end', input: empty } },
    start: { to: ['Active'], input: empty, owes: 'Owner', submission: { move: 'start', input: empty } },
  } },
  Ended: { from: Schema.Literal('Ended'), owes: 'None', moves: {} },
})
export const taskLine = line({
  null: { from: Schema.Null, owes: 'Host', moves: { open: { to: ['Sent'], input: TaskDraft, submission: { move: 'open', input: TaskDraft } } } },
  Sent: { from: Schema.Literal('Sent'), owes: 'Assignee', moves: { next: {
    to: ['Working'], input: Schema.Struct({ ...staffing.fields, where: Attempt.fields.where }),
    submission: { move: 'next', input: empty },
  } } },
  Working: { from: Schema.Literal('Working'), owes: 'Assignee', moves: {
    next: { to: ['ReadyToReview'], input: WorkResult, submission: { move: 'next', input: WorkResult } },
    restart: { to: ['Sent'], input: Schema.Struct({ session: StaffSessionKey }), owes: 'Engine' },
    raise: { to: ['Raised'], input: workProblem, submission: { move: 'raise', input: workProblem } },
  } },
  ReadyToReview: { from: Schema.Literal('ReadyToReview'), owes: 'Engine', moves: {
    next: { to: ['Reviewing'], input: Schema.Struct({ outcomes: CommandOutcomes }) },
  } },
  Reviewing: { from: Schema.Literal('Reviewing'), owes: 'Reviewer', moves: {
    assign: { to: ['Reviewing'], input: staffing, owes: 'Engine' },
    next: { to: ['Done'], input: taskReviewReport, submission: { move: 'review', input: reviewFacts } },
    back: { to: ['Working'], input: taskReviewReport },
    raise: { to: ['Raised'], input: Schema.Struct({ ...taskReviewReport.fields, reason: RaiseReason }) },
  } },
  Done: { from: Schema.Literal('Done'), owes: 'None', moves: {} },
  Raised: { from: Schema.Literal('Raised'), owes: 'None', moves: {} },
}) satisfies Readonly<Record<TaskPhase['_tag'], object>>
export const sessionLine = line({
  null: { from: Schema.Null, owes: 'Engine', moves: { open: {
    to: ['Starting'], input: Schema.Struct({ staff: Staff, staffedIn: EventNumber }),
  } } },
  Starting: { from: Schema.Literal('Starting'), owes: 'Engine', moves: {
    next: { to: ['Live'], input: Schema.Struct({ pane: Pane }) },
    cancel: { to: ['Ended'], input: empty },
  } },
  Live: { from: Schema.Literal('Live'), owes: 'Engine', moves: {
    next: { to: ['Paused', 'Ended'], input: Schema.Struct({ observed: Schema.Literals(['Paused', 'Ended']) }) },
  } },
  Paused: { from: Schema.Literal('Paused'), owes: 'Engine', moves: {
    next: { to: ['Live', 'Ended'], input: Schema.Struct({ observed: Schema.Literals(['Live', 'Ended']) }) },
  } },
  Ended: { from: Schema.Literal('Ended'), owes: 'None', moves: {} },
})

const question = Schema.Struct({
  to: QuestionRecipient, text: Markdown, expects: AnswerKind,
})
const answer = Schema.Struct({ answer: Answer })
export const questionLine = line({
  null: { from: Schema.Null, owes: 'Anyone', moves: { open: { to: ['Open'], input: question, submission: { move: 'open', input: question } } } },
  Open: { from: Schema.Literal('Open'), owes: 'Recipient', moves: { answer: { to: ['Answered'], input: answer, submission: { move: 'answer', input: answer } } } },
  Answered: { from: Schema.Literal('Answered'), owes: 'None', moves: {} },
})

export const proposalLine = line({
  null: { from: Schema.Null, owes: 'Anyone', moves: { open: { to: ['Drafting'], input: value, submission: { move: 'open', input: value } } } },
  Drafting: { from: Schema.Literal('Drafting'), owes: 'Proposer', moves: {
    submit: { to: ['Reviewing'], input: proposalDraft, submission: { move: 'submit', input: proposalDraft } },
  } },
  Reviewing: { from: Schema.Literal('Reviewing'), owes: 'Reviewer', moves: {
    assign: { to: ['Reviewing'], input: empty, owes: 'Engine' },
    next: { to: ['WaitingForOwner'], input: reviewReport, submission: { move: 'review', input: reviewFacts } },
    sendBack: { to: ['Drafting'], input: reviewReport },
  } },
  WaitingForOwner: { from: Schema.Literal('WaitingForOwner'), owes: 'Owner', moves: {
    sendBack: { to: ['Drafting'], input: why, submission: { move: 'sendBack', input: why } },
    accept: { to: ['Accepted'], input: empty, submission: { move: 'accept', input: empty } },
    remove: { to: ['Removed'], input: empty, submission: { move: 'remove', input: empty } },
  } },
  Accepted: { from: Schema.Literal('Accepted'), owes: 'None', moves: {} },
  Removed: { from: Schema.Literal('Removed'), owes: 'None', moves: {} },
})

const projectProtocol = protocol({ line: Schema.Literal('Project') }, projectLine)
export const ProjectEvent = Schema.Union([
  projectProtocol.event('null', 'open'),
  projectProtocol.event('Onboarding', 'next'),
  projectProtocol.event('Activating', 'back'),
  projectProtocol.event('RollingBack', 'back'),
  projectProtocol.event('Active', 'end'),
  projectProtocol.event('Active', 'start'),
])
export type ProjectEvent = Of<typeof ProjectEvent>
const projectRequests = [
  projectProtocol.request('null', projectLine.null.moves.open),
  projectProtocol.request('Onboarding', projectLine.Onboarding.moves.next),
  projectProtocol.request('Active', projectLine.Active.moves.end),
  projectProtocol.request('Active', projectLine.Active.moves.start),
]
const taskProtocol = protocol({ line: Schema.Literal('Task'), key: TaskKey }, taskLine)
export const TaskEvent = Schema.Union([
  taskProtocol.event('null', 'open'),
  taskProtocol.event('Sent', 'next'),
  taskProtocol.event('Working', 'next'),
  taskProtocol.event('Working', 'restart'),
  taskProtocol.event('Working', 'raise'),
  taskProtocol.event('ReadyToReview', 'next'),
  taskProtocol.event('Reviewing', 'assign'),
  taskProtocol.event('Reviewing', 'next'),
  taskProtocol.event('Reviewing', 'back'),
  taskProtocol.event('Reviewing', 'raise'),
])
export type TaskEvent = Of<typeof TaskEvent>
const taskRequests = [
  taskProtocol.request('null', taskLine.null.moves.open),
  taskProtocol.request('Sent', taskLine.Sent.moves.next),
  taskProtocol.request('Working', taskLine.Working.moves.next),
  taskProtocol.request('Working', taskLine.Working.moves.raise),
  taskProtocol.request('Reviewing', taskLine.Reviewing.moves.next),
]
const sessionProtocol = protocol({ line: Schema.Literal('Session'), key: StaffSessionKey }, sessionLine)
export const SessionEvent = Schema.Union([
  sessionProtocol.event('null', 'open'),
  sessionProtocol.event('Starting', 'next'),
  sessionProtocol.event('Starting', 'cancel'),
  sessionProtocol.event('Live', 'next'),
  sessionProtocol.event('Paused', 'next'),
])
export type SessionEvent = Of<typeof SessionEvent>
const questionProtocol = protocol({ line: Schema.Literal('Question'), owner: questionOwner, key: QuestionKey }, questionLine)
export const QuestionEvent = Schema.Union([
  questionProtocol.event('null', 'open'),
  questionProtocol.event('Open', 'answer'),
])
export type QuestionEvent = Of<typeof QuestionEvent>
const questionRequests = [
  questionProtocol.request('null', questionLine.null.moves.open),
  questionProtocol.request('Open', questionLine.Open.moves.answer),
]
const proposalProtocol = protocol({ line: Schema.Literal('Proposal'), key: ProposalKey }, proposalLine)
export const ProposalEvent = Schema.Union([
  proposalProtocol.event('null', 'open'),
  proposalProtocol.event('Drafting', 'submit'),
  proposalProtocol.event('Reviewing', 'assign'),
  proposalProtocol.event('Reviewing', 'next'),
  proposalProtocol.event('Reviewing', 'sendBack'),
  proposalProtocol.event('WaitingForOwner', 'sendBack'),
  proposalProtocol.event('WaitingForOwner', 'accept'),
  proposalProtocol.event('WaitingForOwner', 'remove'),
])
export type ProposalEvent = Of<typeof ProposalEvent>
const proposalRequests = [
  proposalProtocol.request('null', proposalLine.null.moves.open),
  proposalProtocol.request('Drafting', proposalLine.Drafting.moves.submit),
  proposalProtocol.request('Reviewing', proposalLine.Reviewing.moves.next),
  proposalProtocol.request('WaitingForOwner', proposalLine.WaitingForOwner.moves.sendBack),
  proposalProtocol.request('WaitingForOwner', proposalLine.WaitingForOwner.moves.accept),
  proposalProtocol.request('WaitingForOwner', proposalLine.WaitingForOwner.moves.remove),
]
export const StoredEvent = Schema.Union([ProjectEvent, TaskEvent, SessionEvent, QuestionEvent, ProposalEvent])
  .check(Schema.makeFilter((event) => event.read < event.number))
export type StoredEvent = Of<typeof StoredEvent>
export const StoredEvents = Schema.Array(StoredEvent)

export const ProjectSubmission = Schema.Union(projectRequests.map(({ schema }) => schema))
export const TaskSubmission = Schema.Union(taskRequests.map(({ schema }) => schema))
export const ProposalSubmission = Schema.Union(proposalRequests.map(({ schema }) => schema))
export const QuestionSubmission = Schema.Union(questionRequests.map(({ schema }) => schema))
export const Submission = Schema.Union([ProjectSubmission, TaskSubmission, QuestionSubmission, ProposalSubmission])
export type Submission = Of<typeof Submission>
const requests = [...projectRequests, ...taskRequests, ...questionRequests, ...proposalRequests]
export const submissionParty = (request: Submission) =>
  requests.find(({ schema }) => Schema.is(schema)(request))?.party
