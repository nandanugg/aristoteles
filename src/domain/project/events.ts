import { Schema } from 'effect'
import { ApprovedFiles } from './activation.ts'
import { ProposalValue } from './proposal.ts'
import { ReviewFacts } from './review.ts'
import { line, protocol } from './lines.ts'
import { Attempt, CommandOutcomes, RaiseReason, TaskStages, TaskReviewFacts, WorkResult, type TaskPhase } from './task.ts'
import { Evidence } from './evidence.ts'
import { Fact } from './direction.ts'
import { Answer, QuestionForm, questionAbout } from './question.ts'
import { Human, LiveSession, Pane, Role, Staff } from './staff.ts'
import {
  AttemptNumber, DirectionId, EventNumber, Goal, Name, ProjectId, ProposalId, QuestionId, QuestionText, Rationale,
  RetryLimit, RoleId, SessionId, StaffId, StoredActor, TaskId, type Of,
} from './values.ts'

export const ProjectAddress = Schema.TaggedStruct('Project', { id: ProjectId })
export const TaskAddress = Schema.TaggedStruct('Task', { id: TaskId })
export const SessionAddress = Schema.TaggedStruct('Session', { id: SessionId })
export const ActivationAddress = Schema.TaggedStruct('Activation', { id: ProjectId })
export const HostLaunchAddress = Schema.TaggedStruct('HostLaunch', { id: SessionId })
export const ProposalAddress = Schema.TaggedStruct('Proposal', { id: ProposalId })
export const QuestionAddress = Schema.TaggedStruct('Question', { id: QuestionId })

const configuration = Schema.Struct({ owner: Human, host: Role, pipeline: Role, staff: Staff, roles: Schema.Array(Role) })
export const TaskDraft = Schema.Struct({
  name: Name, goal: Goal, reviewer: RoleId,
  direction: Schema.Struct({ id: DirectionId, acceptedAt: EventNumber }),
  stages: TaskStages,
  facts: Schema.Array(Fact).check(Schema.makeFilter((facts) => new Set(facts.map(({ name }) => name)).size === facts.length)),
})
const empty = Schema.Struct({}).check(Schema.makeFilter((input) => Object.keys(input).length === 0))
const session = Schema.Struct({ session: LiveSession, staffing: EventNumber })
const why = Schema.Struct({ why: Rationale })
const files = Schema.Struct({ files: ApprovedFiles })
const value = Schema.Struct({ value: ProposalValue })
const proposalDraft = Schema.Struct({ value: ProposalValue, question: Schema.NullOr(QuestionAddress) })
const reviewFacts = Schema.Struct({ facts: ReviewFacts })
const reviewReport = Schema.Struct({ ...reviewFacts.fields, session: LiveSession, review: EventNumber })
const taskReviewFacts = Schema.Struct({ facts: TaskReviewFacts })
const workProblem = Schema.Struct({
  attempt: AttemptNumber, reason: Schema.Literals(['TooBig', 'wrongTask']), evidence: Evidence,
})
const taskReviewReport = Schema.Struct({
  ...taskReviewFacts.fields, session: SessionId, review: EventNumber, limit: RetryLimit,
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
    next: { to: ['ReadyToReview'], input: Schema.Struct({ ...WorkResult.fields, session: SessionId }), submission: { input: WorkResult } },
    restart: { to: ['Sent'], input: Schema.Struct({ session: SessionId }), owes: 'Engine' },
    raise: { to: ['Raised'], input: Schema.Struct({ ...workProblem.fields, session: SessionId }), submission: { input: workProblem } },
  } },
  ReadyToReview: { owes: 'Engine', moves: {
    next: { to: ['Reviewing'], input: Schema.Struct({ outcomes: CommandOutcomes }) },
  } },
  Reviewing: { owes: 'Reviewer', moves: {
    assign: { to: ['Reviewing'], input: session, owes: 'Engine' },
    next: { to: ['Done'], input: taskReviewReport, submission: { move: 'review', input: taskReviewFacts } },
    back: { to: ['Working'], input: taskReviewReport },
    raise: { to: ['Raised'], input: Schema.Struct({ ...taskReviewReport.fields, reason: RaiseReason }) },
  } },
  Done: { owes: 'None', moves: {} },
  Raised: { owes: 'None', moves: {} },
}) satisfies Readonly<Record<TaskPhase['_tag'], object>>
export const sessionLine = line({
  null: { owes: 'Engine', moves: { open: {
    to: ['Live'], input: Schema.Struct({ staff: StaffId, pane: Pane, staffing: EventNumber }),
  } } },
  Live: { owes: 'Engine', moves: {
    next: { to: ['Paused', 'Ended'], input: Schema.Struct({ observed: Schema.Literals(['Paused', 'Ended']) }) },
  } },
  Paused: { owes: 'Engine', moves: {
    next: { to: ['Live'], input: Schema.Struct({ id: SessionId, pane: Pane, staffing: EventNumber }) },
  } },
  Ended: { owes: 'None', moves: {} },
})

const question = Schema.Struct({
  to: StoredActor, text: QuestionText, form: QuestionForm,
  about: Schema.Union([...questionAbout, Schema.TaggedStruct('Task', { task: TaskId })]),
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
    clearReplacement: { to: ['Active'], input: Schema.Struct({ id: SessionId }), owes: 'Engine' },
    start: { to: ['Active'], input: empty, owes: 'Owner', submission: { input: empty } },
    use: { to: ['Active'], input: Schema.Struct({ id: SessionId }), owes: 'Host' },
  } },
})
const launchPane = Schema.Struct({ pane: Pane })
export const hostLaunchLine = line({
  null: { owes: 'Engine', moves: { reserve: { to: ['Reserved'], input: empty } } },
  Reserved: { owes: 'Engine', moves: {
    acknowledge: { to: ['Acknowledged'], input: launchPane },
    cancel: { to: ['Cancelled'], input: empty },
  } },
  Acknowledged: { owes: 'Engine', moves: {
    bind: { to: ['Bound'], input: launchPane },
    cancel: { to: ['Cancelled'], input: empty },
  } },
  Bound: { owes: 'None', moves: {} },
  Cancelled: { owes: 'None', moves: {} },
})

const project = protocol(ProjectAddress, projectLine)
const task = protocol(TaskAddress, taskLine)
const sessions = protocol(SessionAddress, sessionLine)
const questions = protocol(QuestionAddress, questionLine)
const proposals = protocol(ProposalAddress, proposalLine)
const activation = protocol(ActivationAddress, activationLine)
const hostLaunch = protocol(HostLaunchAddress, hostLaunchLine)

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
export const HostLaunchEvent = hostLaunch.event
export type HostLaunchEvent = Of<typeof HostLaunchEvent>
export const StoredEvent = Schema.Union([ProjectEvent, TaskEvent, SessionEvent, QuestionEvent, ProposalEvent, ActivationEvent, HostLaunchEvent])
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
