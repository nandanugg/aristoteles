import { Schema } from 'effect'
import { ApprovedFiles } from './activation.ts'
import { Partition, StageAttachment, TaskParent } from './task-tree.ts'
import { Assessment } from './fix.ts'
import { ProposalSubject, ProposalValue } from './proposal.ts'
import { versionOf } from './version.ts'
import { ReviewFacts } from './review.ts'
import { line, protocol } from './lines.ts'
import { Attempt, CommandOutcomes, RaiseReason, TaskStages, WorkResult, type TaskPhase } from './task.ts'
import { Evidence } from './evidence.ts'
import { DirectionVersion, Fact } from './direction.ts'
import { Answer, AnswerKind, QuestionRecipient } from './question.ts'
import { Human, Pane, Roles, Staff, Subscription } from './staff.ts'
import {
  AttemptNumber, EventNumber, Goal, Name, ProposalKey, QuestionKey, Markdown, Rationale,
  RetryLimit, RoleKey, StaffSessionKey, StagePosition, TaskKey, type Of,
} from './values.ts'

const questionOwner = Schema.Union([
  Schema.TaggedStruct('Project', {}),
  Schema.TaggedStruct('Proposal', { key: ProposalKey }),
  Schema.TaggedStruct('Task', { key: TaskKey }),
])

const configuration = Schema.Struct({ owner: Human, roles: Roles, staff: Staff, subscription: Subscription })
export const TaskDraft = Schema.Struct({
  name: Name, goal: Goal, reviewer: RoleKey, direction: DirectionVersion,
  stages: TaskStages,
  facts: Schema.Array(Fact).check(Schema.makeFilter((facts) => new Set(facts.map(({ name }) => name)).size === facts.length)),
})
const openTask = Schema.Union([
  Schema.TaggedStruct('Root', TaskDraft.fields),
  TaskParent.members[1],
])
const wideTask = Schema.Struct({ ...TaskDraft.fields, role: RoleKey, attachments: Schema.Array(StageAttachment) })
const splitInput = Schema.Union([
  Schema.TaggedStruct('New', { draft: wideTask, partition: Partition }),
  Schema.TaggedStruct('Existing', { partition: Partition }),
])
const beforeWorkProblem = Schema.Struct({ reason: Schema.Literal('TooBig'), why: Rationale })
const correction = Schema.Struct({ goal: Goal, why: Rationale })
const stageDropFields = { stage: StagePosition, evidence: Schema.NonEmptyArray(Evidence) }
const dropStage = Schema.Union([
  Schema.TaggedStruct('Working', { ...stageDropFields, attempt: AttemptNumber }),
  Schema.TaggedStruct('Split', { ...stageDropFields, partition: Partition }),
])
const empty = Schema.Record(Schema.String, Schema.Never)
const staffing = Schema.Struct({ staffedIn: EventNumber })
const session = Schema.Struct({ session: StaffSessionKey })
const acceptedProposal = Schema.Struct({ proposal: ProposalKey })
const why = Schema.Struct({ why: Rationale })
const files = Schema.Struct({ files: ApprovedFiles })
const value = Schema.Struct({ value: ProposalValue, previous: Schema.Union([Schema.TaggedStruct('None', {}), Schema.TaggedStruct('Version', { version: versionOf(ProposalValue) })]) })
const proposalDraft = Schema.Struct({ value: ProposalValue })
const firstFix = Schema.Struct({ subject: ProposalSubject.members[1], value: ProposalValue })
const fixProposal = Schema.Struct({ proposal: ProposalKey })
const reviewRelease = Schema.Union([
  Schema.TaggedStruct('SessionEnded', session.fields),
  Schema.TaggedStruct('ReviewStopped', { queuedIn: EventNumber }),
])
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
  Onboarding: { from: Schema.Literal('Onboarding'), owes: 'Owner', moves: {
    next: { to: ['Activating'], input: files, submission: { move: 'next', input: files } },
    apply: { to: ['Onboarding'], input: acceptedProposal, owes: 'Engine' },
  } },
  Activating: { from: Schema.Literal('Activating'), owes: 'Engine', moves: {
    next: { to: ['Active'], input: session },
    back: { to: ['RollingBack'], input: why },
    apply: { to: ['Activating'], input: acceptedProposal },
  } },
  RollingBack: { from: Schema.Literal('RollingBack'), owes: 'Engine', moves: {
    back: { to: ['Onboarding'], input: empty },
    apply: { to: ['RollingBack'], input: acceptedProposal },
  } },
  Active: { from: Schema.Literal('Active'), owes: 'None', moves: {
    apply: { to: ['Active'], input: acceptedProposal, owes: 'Engine' },
    end: { to: ['Ended'], input: empty, owes: 'Owner', submission: { move: 'end', input: empty } },
    start: { to: ['Active'], input: empty, owes: 'Owner', submission: { move: 'start', input: empty } },
  } },
  Ended: { from: Schema.Literal('Ended'), owes: 'None', moves: {} },
})
export const taskLine = line({
  null: { from: Schema.Null, owes: 'Host', moves: {
    open: { to: ['Sent'], input: openTask, submission: { move: 'open', input: TaskDraft } },
    split: { to: ['Split'], input: splitInput.members[0], owes: 'Sender', submission: { move: 'split', input: splitInput } },
  } },
  Sent: { from: Schema.Literal('Sent'), owes: 'Assignee', moves: {
    next: { to: ['Working'], input: Schema.Struct({ ...staffing.fields, where: Attempt.fields.where }),
      submission: { move: 'next', input: empty } },
    split: { to: ['Split'], input: splitInput.members[1], owes: 'Sender' },
    raise: { to: ['Raised'], input: beforeWorkProblem, submission: { move: 'tooBig', input: beforeWorkProblem } },
  } },
  Working: { from: Schema.Literal('Working'), owes: 'Assignee', moves: {
    next: { to: ['ReadyToReview'], input: WorkResult, submission: { move: 'next', input: WorkResult } },
    restart: { to: ['Sent'], input: session, owes: 'Engine' },
    dropStage: { to: ['Working'], input: dropStage.members[0], submission: { move: 'dropStage', input: dropStage } },
    raise: { to: ['Raised'], input: workProblem, submission: { move: 'raise', input: workProblem } },
  } },
  ReadyToReview: { from: Schema.Literal('ReadyToReview'), owes: 'Engine', moves: {
    next: { to: ['Reviewing'], input: Schema.Struct({ outcomes: CommandOutcomes }) },
  } },
  Reviewing: { from: Schema.Literal('Reviewing'), owes: 'Reviewer', moves: {
    assign: { to: ['Reviewing'], input: staffing, owes: 'Engine' },
    release: { to: ['Reviewing'], input: session, owes: 'Engine' },
    next: { to: ['Done'], input: taskReviewReport, submission: { move: 'review', input: reviewFacts } },
    back: { to: ['Working'], input: taskReviewReport },
    raise: { to: ['Raised'], input: Schema.Struct({ ...taskReviewReport.fields, reason: RaiseReason }) },
  } },
  Done: { from: Schema.Literal('Done'), owes: 'None', moves: {} },
  Split: { from: Schema.Literal('Split'), owes: 'Sender', moves: {
    split: { to: ['Split'], input: splitInput.members[1] },
    joinParts: { to: ['Split'], input: Partition, submission: { move: 'joinParts', input: Partition } },
    redistribute: { to: ['Split'], input: Partition, submission: { move: 'redistribute', input: Partition } },
    dropStage: { to: ['Split'], input: dropStage.members[1] },
  } },
  Raised: { from: Schema.Literal('Raised'), owes: 'None', moves: {
    split: { to: ['Split'], input: splitInput.members[1], owes: 'Sender' },
    back: { to: ['Sent'], input: correction, owes: 'Sender', submission: { move: 'back', input: correction } },
    assess: { to: ['Raised'], input: Assessment, owes: 'Pipeline', submission: { move: 'assess', input: Assessment } },
    tryAgain: { to: ['Sent'], input: empty, owes: 'Pipeline', submission: { move: 'tryAgain', input: empty } },
    applyFix: { to: ['Sent'], input: fixProposal, owes: 'Engine' },
    takeAsIs: { to: ['Done'], input: why, owes: 'Owner', submission: { move: 'takeAsIs', input: why } },
    drop: { to: ['Dropped'], input: why, owes: 'Sender', submission: { move: 'drop', input: why } },
  } },
  Dropped: { from: Schema.Literal('Dropped'), owes: 'None', moves: {} },
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
  null: { from: Schema.Null, owes: 'Anyone', moves: {
    open: { to: ['Drafting'], input: value, submission: { move: 'open', input: value } },
    submit: { to: ['Reviewing'], input: firstFix, owes: 'Pipeline', submission: { move: 'submit', input: firstFix } },
  } },
  Drafting: { from: Schema.Literal('Drafting'), owes: 'Proposer', moves: {
    submit: { to: ['Reviewing'], input: proposalDraft, submission: { move: 'submit', input: proposalDraft } },
    remove: { to: ['Removed'], input: ProposalSubject.members[1], owes: 'Engine' },
  } },
  Reviewing: { from: Schema.Literal('Reviewing'), owes: 'Reviewer', moves: {
    assign: { to: ['Reviewing'], input: empty, owes: 'Engine' },
    release: { to: ['Reviewing'], input: reviewRelease, owes: 'Engine' },
    remove: { to: ['Removed'], input: ProposalSubject.members[1], owes: 'Engine' },
    next: { to: ['WaitingForOwner'], input: reviewReport, submission: { move: 'review', input: reviewFacts } },
    sendBack: { to: ['Drafting'], input: reviewReport },
  } },
  WaitingForOwner: { from: Schema.Literal('WaitingForOwner'), owes: 'Owner', moves: {
    sendBack: { to: ['Drafting'], input: why, submission: { move: 'sendBack', input: why } },
    accept: { to: ['Accepted'], input: empty, submission: { move: 'accept', input: empty } },
    remove: { to: ['Removed'], input: ProposalSubject, submission: { move: 'remove', input: empty } },
  } },
  Accepted: { from: Schema.Literal('Accepted'), owes: 'None', moves: {} },
  Removed: { from: Schema.Literal('Removed'), owes: 'None', moves: {} },
})

const projectProtocol = protocol({ line: Schema.Literal('Project') }, projectLine)
export const ProjectEvent = Schema.Union([
  projectProtocol.event('null', 'open'),
  projectProtocol.event('Onboarding', 'next'),
  projectProtocol.event('Onboarding', 'apply'),
  projectProtocol.event('Activating', 'next'),
  projectProtocol.event('Activating', 'apply'),
  projectProtocol.event('RollingBack', 'apply'),
  projectProtocol.event('Active', 'apply'),
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
  taskProtocol.event('null', 'split'),
  taskProtocol.event('Sent', 'split'),
  taskProtocol.event('Sent', 'raise'),
  taskProtocol.event('Working', 'dropStage'),
  taskProtocol.event('Raised', 'split'),
  taskProtocol.event('Raised', 'back'),
  taskProtocol.event('Split', 'split'),
  taskProtocol.event('Split', 'joinParts'),
  taskProtocol.event('Split', 'redistribute'),
  taskProtocol.event('Split', 'dropStage'),
  taskProtocol.event('Sent', 'next'),
  taskProtocol.event('Working', 'next'),
  taskProtocol.event('Working', 'restart'),
  taskProtocol.event('Working', 'raise'),
  taskProtocol.event('ReadyToReview', 'next'),
  taskProtocol.event('Reviewing', 'assign'),
  taskProtocol.event('Reviewing', 'release'),
  taskProtocol.event('Reviewing', 'next'),
  taskProtocol.event('Reviewing', 'back'),
  taskProtocol.event('Reviewing', 'raise'),
  taskProtocol.event('Raised', 'assess'),
  taskProtocol.event('Raised', 'tryAgain'),
  taskProtocol.event('Raised', 'applyFix'),
  taskProtocol.event('Raised', 'takeAsIs'),
  taskProtocol.event('Raised', 'drop'),
])
export type TaskEvent = Of<typeof TaskEvent>
const taskRequests = [
  taskProtocol.request('null', taskLine.null.moves.open),
  taskProtocol.request('null', taskLine.null.moves.split),
  taskProtocol.request('Sent', taskLine.Sent.moves.raise),
  taskProtocol.request('Working', taskLine.Working.moves.dropStage),
  taskProtocol.request('Raised', taskLine.Raised.moves.back),
  taskProtocol.request('Split', taskLine.Split.moves.joinParts),
  taskProtocol.request('Split', taskLine.Split.moves.redistribute),
  taskProtocol.request('Sent', taskLine.Sent.moves.next),
  taskProtocol.request('Working', taskLine.Working.moves.next),
  taskProtocol.request('Working', taskLine.Working.moves.raise),
  taskProtocol.request('Reviewing', taskLine.Reviewing.moves.next),
  taskProtocol.request('Raised', taskLine.Raised.moves.assess),
  taskProtocol.request('Raised', taskLine.Raised.moves.tryAgain),
  taskProtocol.request('Raised', taskLine.Raised.moves.takeAsIs),
  taskProtocol.request('Raised', taskLine.Raised.moves.drop),
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
  proposalProtocol.event('null', 'submit'),
  proposalProtocol.event('Drafting', 'remove'),
  proposalProtocol.event('Reviewing', 'remove'),
  proposalProtocol.event('Drafting', 'submit'),
  proposalProtocol.event('Reviewing', 'assign'),
  proposalProtocol.event('Reviewing', 'release'),
  proposalProtocol.event('Reviewing', 'next'),
  proposalProtocol.event('Reviewing', 'sendBack'),
  proposalProtocol.event('WaitingForOwner', 'sendBack'),
  proposalProtocol.event('WaitingForOwner', 'accept'),
  proposalProtocol.event('WaitingForOwner', 'remove'),
])
export type ProposalEvent = Of<typeof ProposalEvent>
const proposalRequests = [
  proposalProtocol.request('null', proposalLine.null.moves.open),
  proposalProtocol.request('null', proposalLine.null.moves.submit),
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
