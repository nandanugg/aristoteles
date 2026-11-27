import { Schema } from 'effect'
import { ApprovedFiles } from './activation.ts'
import { ProposalValue } from './proposal.ts'
import { versionOf } from './version.ts'
import { ReviewFacts } from './review.ts'
import { line, protocol } from './lines.ts'
import { Attempt, CommandOutcomes, RaiseReason, TaskStages, WorkResult, DirectionVersion, type TaskPhase } from './task.ts'
import { Evidence } from './evidence.ts'
import { Fact } from './direction.ts'
import { Answer, QuestionForm } from './question.ts'
import { Human, LiveSession, Pane, Role, Staff } from './staff.ts'
import {
  AttemptNumber, EventNumber, Goal, Name, ProposalKey, QuestionKey, QuestionText, Rationale,
  RetryLimit, StaffSessionKey, StoredActor, TaskKey, type Of,
} from './values.ts'

export const ProjectAddress = Schema.TaggedStruct('Project', {})
export const TaskAddress = Schema.TaggedStruct('Task', { key: TaskKey })
export const SessionAddress = Schema.TaggedStruct('Session', { key: StaffSessionKey })
export const ActivationAddress = Schema.TaggedStruct('Activation', {})
export const ProposalAddress = Schema.TaggedStruct('Proposal', { key: ProposalKey })
export const QuestionAddress = Schema.TaggedStruct('Question', {
  owner: Schema.Union([ProjectAddress, ProposalAddress, TaskAddress]), key: QuestionKey,
})

const configuration = Schema.Struct({ owner: Human, host: Role, pipeline: Role, staff: Staff, roles: Schema.Array(Role) })
export const TaskDraft = Schema.Struct({
  name: Name, goal: Goal, reviewer: Role, direction: DirectionVersion,
  stages: TaskStages,
  facts: Schema.Array(Fact).check(Schema.makeFilter((facts) => new Set(facts.map(({ name }) => name)).size === facts.length)),
})
const empty = Schema.Struct({}).check(Schema.makeFilter((input) => Object.keys(input).length === 0))
const session = Schema.Struct({ session: LiveSession, staffing: EventNumber })
const why = Schema.Struct({ why: Rationale })
const files = Schema.Struct({ files: ApprovedFiles })
const value = Schema.Struct({ value: ProposalValue, previous: Schema.Union([Schema.TaggedStruct('None', {}), Schema.TaggedStruct('Version', { version: versionOf(ProposalValue) })]) })
const proposalDraft = Schema.Struct({ value: ProposalValue })
const reviewFacts = Schema.Struct({ facts: ReviewFacts })
const reviewReport = Schema.Struct({ ...reviewFacts.fields, session: LiveSession, review: EventNumber })
const workProblem = Schema.Struct({
  attempt: AttemptNumber, reason: Schema.Literals(['TooBig', 'WrongTask']), evidence: Evidence,
})
const taskReviewReport = Schema.Struct({
  ...reviewFacts.fields, session: StaffSessionKey, review: EventNumber, limit: RetryLimit,
})

export const projectLine = line({
  null: { owes: 'Owner', moves: { open: { to: ['Open'], input: configuration, submission: { input: configuration } } } },
  Open: { owes: 'Owner', moves: { end: { to: ['Ended'], input: empty, submission: { input: empty } } } },
  Ended: { owes: 'None', moves: {} },
})
export const taskLine = line({
  null: { owes: 'Host', moves: { open: { to: ['Sent'], input: TaskDraft, submission: { input: TaskDraft } } } },
  Sent: { owes: 'Assignee', moves: { next: {
    to: ['Working'], input: Schema.Struct({ ...session.fields, where: Attempt.fields.where }),
    submission: { input: empty },
  } } },
  Working: { owes: 'Assignee', moves: {
    next: { to: ['ReadyToReview'], input: Schema.Struct({ ...WorkResult.fields, session: StaffSessionKey }), submission: { input: WorkResult } },
    restart: { to: ['Sent'], input: Schema.Struct({ session: StaffSessionKey }), owes: 'Engine' },
    raise: { to: ['Raised'], input: Schema.Struct({ ...workProblem.fields, session: StaffSessionKey }), submission: { input: workProblem } },
  } },
  ReadyToReview: { owes: 'Engine', moves: {
    next: { to: ['Reviewing'], input: Schema.Struct({ outcomes: CommandOutcomes }) },
  } },
  Reviewing: { owes: 'Reviewer', moves: {
    assign: { to: ['Reviewing'], input: session, owes: 'Engine' },
    next: { to: ['Done'], input: taskReviewReport, submission: { move: 'review', input: reviewFacts } },
    back: { to: ['Working'], input: taskReviewReport },
    raise: { to: ['Raised'], input: Schema.Struct({ ...taskReviewReport.fields, reason: RaiseReason }) },
  } },
  Done: { owes: 'None', moves: {} },
  Raised: { owes: 'None', moves: {} },
}) satisfies Readonly<Record<TaskPhase['_tag'], object>>
export const sessionLine = line({
  null: { owes: 'Engine', moves: { open: {
    to: ['Starting'], input: Schema.Struct({ staff: Staff, staffing: EventNumber, previous: Schema.Union([Schema.TaggedStruct('None', {}), SessionAddress]) }),
  } } },
  Starting: { owes: 'Engine', moves: {
    next: { to: ['Live'], input: Schema.Struct({ pane: Pane }) },
    cancel: { to: ['Ended'], input: empty },
  } },
  Live: { owes: 'Engine', moves: {
    next: { to: ['Paused', 'Ended'], input: Schema.Struct({ observed: Schema.Literals(['Paused', 'Ended']) }) },
  } },
  Paused: { owes: 'Engine', moves: {
    next: { to: ['Ended'], input: empty },
  } },
  Ended: { owes: 'None', moves: {} },
})

const question = Schema.Struct({
  to: StoredActor, text: QuestionText, form: QuestionForm,
})
const answer = Schema.Struct({ answer: Answer })
export const questionLine = line({
  null: { owes: 'Actor', moves: { open: { to: ['Open'], input: question, submission: { input: question } } } },
  Open: { owes: 'Recipient', moves: { answer: { to: ['Answered'], input: answer, submission: { input: answer } } } },
  Answered: { owes: 'None', moves: {} },
})

export const proposalLine = line({
  null: { owes: 'Actor', moves: { open: { to: ['Drafting'], input: value, submission: { input: value } } } },
  Drafting: { owes: 'Proposer', moves: {
    submit: { to: ['Reviewing'], input: proposalDraft, submission: { input: proposalDraft } },
  } },
  Reviewing: { owes: 'Reviewer', moves: {
    assign: { to: ['Reviewing'], input: Schema.Struct({ session: LiveSession }), owes: 'Engine' },
    next: { to: ['WaitingForOwner'], input: reviewReport, submission: { move: 'review', input: reviewFacts } },
    sendBack: { to: ['Drafting'], input: reviewReport },
  } },
  WaitingForOwner: { owes: 'Owner', moves: {
    sendBack: { to: ['Drafting'], input: why, submission: { input: why } },
    accept: { to: ['Accepted'], input: empty, submission: { input: empty } },
    remove: { to: ['Removed'], input: empty, submission: { input: empty } },
  } },
  Accepted: { owes: 'None', moves: {} },
  Removed: { owes: 'None', moves: {} },
})

export const activationLine = line({
  Onboarding: { owes: 'Owner', moves: { next: { to: ['Activating'], input: files, submission: { input: files } } } },
  Activating: { owes: 'Engine', moves: { back: { to: ['RollingBack'], input: why } } },
  RollingBack: { owes: 'Engine', moves: { back: { to: ['Onboarding'], input: empty } } },
  Active: { owes: 'None', moves: {
    start: { to: ['Active'], input: empty, owes: 'Owner', submission: { input: empty } },
    use: { to: ['Active'], input: Schema.Struct({ session: SessionAddress }), owes: 'Host' },
  } },
})
const project = protocol(ProjectAddress, projectLine)
const task = protocol(TaskAddress, taskLine)
const sessions = protocol(SessionAddress, sessionLine)
const questions = protocol(QuestionAddress, questionLine)
const proposals = protocol(ProposalAddress, proposalLine)
const activation = protocol(ActivationAddress, activationLine)

export const ProjectEvent = project.event
export type ProjectEvent = Of<typeof ProjectEvent>
export const TaskEvent = task.event
export type TaskEvent = Of<typeof TaskEvent>
export const SessionEvent = sessions.event
export type SessionEvent = Of<typeof SessionEvent>
export const QuestionEvent = questions.event
export type QuestionEvent = Of<typeof QuestionEvent>
export const ProposalEvent = proposals.event
export type ProposalEvent = Of<typeof ProposalEvent>
export const ActivationEvent = activation.event
export type ActivationEvent = Of<typeof ActivationEvent>
export const StoredEvent = Schema.Union([ProjectEvent, TaskEvent, SessionEvent, QuestionEvent, ProposalEvent, ActivationEvent])
  .check(Schema.makeFilter((event) => event.read < event.number))
export type StoredEvent = Of<typeof StoredEvent>
export const StoredEvents = Schema.Array(StoredEvent)

const ProjectSubmission = project.submission
export const TaskSubmission = task.submission
export const ProposalSubmission = proposals.submission
export const QuestionSubmission = questions.submission
export const ActivationSubmission = activation.submission
export const Submission = Schema.Union([ProjectSubmission, TaskSubmission, QuestionSubmission, ProposalSubmission, ActivationSubmission])
export type Submission = Of<typeof Submission>
export const submissionParty = (request: Submission) => {
  if (Schema.is(ProjectSubmission)(request)) return project.party(request)
  if (Schema.is(TaskSubmission)(request)) return task.party(request)
  if (Schema.is(QuestionSubmission)(request)) return questions.party(request)
  if (Schema.is(ProposalSubmission)(request)) return proposals.party(request)
  if (Schema.is(ActivationSubmission)(request)) return activation.party(request)
}
