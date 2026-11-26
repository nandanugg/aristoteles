import { Schema } from 'effect'
import { ApprovedFiles } from './activation.ts'
import { ProposalValue } from './proposal.ts'
import { ReviewFacts } from './review.ts'
import { line } from './lines.ts'
import { TaskDraft, type TaskPhase } from './records.ts'
import { Answer, QuestionForm, questionAbout } from './question.ts'
import { Human, LiveSession, Pane, Role, Staff } from './staff.ts'
import {
  AttemptNumber, EventNumber, FileContents, FilePath, ProjectId, ProposalId, QuestionId, QuestionText, Rationale, ReadPosition,
  ResultSummary, SessionId, StaffId, StoredActor, TaskId, Timestamp, type Of,
} from './values.ts'

export const ProjectAddress = Schema.TaggedStruct('Project', { id: ProjectId })
export const TaskAddress = Schema.TaggedStruct('Task', { id: TaskId })
export const SessionAddress = Schema.TaggedStruct('Session', { id: SessionId })
export const ActivationAddress = Schema.TaggedStruct('Activation', { id: ProjectId })
export const ProposalAddress = Schema.TaggedStruct('Proposal', { id: ProposalId })
export const QuestionAddress = Schema.TaggedStruct('Question', { id: QuestionId })

const configuration = { owner: Human, host: Role, pipeline: Role, staff: Staff, roles: Schema.Array(Role) }
const result = Schema.Struct({
  attempt: AttemptNumber, summary: ResultSummary,
  files: Schema.Array(Schema.Struct({ path: FilePath, contents: FileContents })),
})
const projectOpen = { to: 'Open', input: Schema.Struct(configuration) } as const
const sessionOpen = { to: 'Live', input: Schema.Struct({ staff: StaffId, pane: Pane, staffing: EventNumber }) } as const

export const projectLine = line({
  Open: { owes: 'Owner', moves: {
    next: { to: ['Open'], input: Schema.Union([Schema.TaggedStruct('TaskSent', { draft: TaskDraft }), Schema.TaggedStruct('StartWork', {})]) },
    end: { to: ['Ended'], input: Schema.Struct({}) },
  } },
  Ended: { owes: 'None', moves: {} },
})
export const taskLine = line({
  Sent: { owes: 'Assignee', moves: { next: {
    to: ['Working'], input: Schema.Struct({ session: LiveSession, staffing: EventNumber, place: Schema.Literals(['Main', 'Child']) }),
  } } },
  Working: { owes: 'Assignee', moves: {
    next: { to: ['ReadyToReview'], input: result },
    restart: { to: ['Sent'], input: Schema.Struct({ session: SessionId }) },
  } },
  ReadyToReview: { owes: 'Engine', moves: {
    next: { to: ['Reviewing'], input: Schema.Struct({ outcomes: Schema.Tuple([]) }) },
  } },
  Reviewing: { owes: 'Reviewer', moves: {
    next: { to: ['Reviewing'], input: Schema.Struct({ session: LiveSession, staffing: EventNumber }) },
    back: { to: ['Working'], input: Schema.Struct({ why: Rationale }) },
  } },
}) satisfies Readonly<Record<TaskPhase['_tag'], object>>
export const sessionLine = line({
  Live: { owes: 'Engine', moves: {
    next: { to: ['Paused', 'Ended'], input: Schema.Struct({ observed: Schema.Literals(['Paused', 'Ended']) }) },
  } },
  Paused: { owes: 'Engine', moves: {
    next: { to: ['Live'], input: Schema.Struct({ id: SessionId, pane: Pane, staffing: EventNumber }) },
  } },
  Ended: { owes: 'None', moves: {} },
})

const questionOpen = { to: 'Open', input: Schema.Struct({
  to: StoredActor, text: QuestionText, form: QuestionForm,
  about: Schema.Union([...questionAbout, Schema.TaggedStruct('Task', { task: TaskId })]),
}) } as const

export const questionLine = line({
  Open: { owes: 'Recipient', moves: { answer: { to: ['Answered'], input: Schema.Struct({ answer: Answer }) } } },
  Answered: { owes: 'None', moves: {} },
})

const proposalOpen = { to: 'Drafting', input: Schema.Struct({ value: ProposalValue }) } as const
export const proposalLine = line({
  Drafting: { owes: 'Proposer', moves: {
    submit: { to: ['Reviewing'], input: Schema.Struct({ value: ProposalValue, question: Schema.NullOr(QuestionAddress) }) },
  } },
  Reviewing: { owes: 'Reviewer', moves: {
    next: { to: ['Reviewing', 'WaitingForOwner'], input: Schema.Struct({ session: LiveSession, review: EventNumber, facts: Schema.NullOr(ReviewFacts) }) },
    sendBack: { to: ['Drafting'], input: Schema.Struct({ session: LiveSession, review: EventNumber, facts: ReviewFacts }) },
  } },
  WaitingForOwner: { owes: 'Owner', moves: {
    sendBack: { to: ['Drafting'], input: Schema.Struct({ why: Rationale }) },
    accept: { to: ['Accepted'], input: Schema.Struct({}) },
    remove: { to: ['Removed'], input: Schema.Struct({}) },
  } },
  Accepted: { owes: 'None', moves: {} },
  Removed: { owes: 'None', moves: {} },
})

const launchId = Schema.Struct({ id: SessionId })
const launchPane = Schema.Struct({ id: SessionId, pane: Pane })
export const activationLine = line({
  Onboarding: { owes: 'Owner', moves: { next: { to: ['Activating'], input: Schema.Struct({ files: ApprovedFiles }) } } },
  Activating: { owes: 'Engine', moves: {
    reserve: { to: ['Activating'], input: launchId },
    acknowledge: { to: ['Activating'], input: launchPane },
    next: { to: ['Active'], input: launchPane },
    back: { to: ['RollingBack'], input: Schema.Struct({ why: Rationale }) },
  } },
  RollingBack: { owes: 'Engine', moves: { back: { to: ['Onboarding'], input: Schema.Struct({}) } } },
  Active: { owes: 'None', moves: {
    reserve: { to: ['Active'], input: launchId },
    acknowledge: { to: ['Active'], input: launchPane },
    bind: { to: ['Active'], input: launchPane },
    settle: { to: ['Active'], input: launchId },
    use: { to: ['Active'], input: launchId },
  } },
})

const entry = { number: EventNumber, actor: StoredActor, read: ReadPosition, at: Timestamp }
const on = <A extends Schema.Top, F extends Schema.Top, M extends 'next' | 'end' | 'back' | 'answer' | 'submit' | 'sendBack' | 'accept' | 'remove' | 'reserve' | 'acknowledge' | 'bind' | 'settle' | 'use', I extends Schema.Top>(
  address: A, from: F, move: M, definition: { readonly input: I },
) => Schema.Struct({ ...entry, line: address, from, move: Schema.Literal(move), input: definition.input })

export const ProjectEvent = Schema.Union([
  on(ProjectAddress, Schema.Null, 'next', projectOpen),
  on(ProjectAddress, Schema.Literal('Open'), 'next', projectLine.Open.moves.next),
  on(ProjectAddress, Schema.Literal('Open'), 'end', projectLine.Open.moves.end),
])
export type ProjectEvent = Of<typeof ProjectEvent>
export const TaskEvent = Schema.Union([
  on(TaskAddress, Schema.Literal('Sent'), 'next', taskLine.Sent.moves.next),
  on(TaskAddress, Schema.Literal('Working'), 'next', taskLine.Working.moves.next),
  on(TaskAddress, Schema.Literal('ReadyToReview'), 'next', taskLine.ReadyToReview.moves.next),
  on(TaskAddress, Schema.Literal('Reviewing'), 'next', taskLine.Reviewing.moves.next),
  on(TaskAddress, Schema.Literal('Reviewing'), 'back', taskLine.Reviewing.moves.back),
])
export type TaskEvent = Of<typeof TaskEvent>
export const SessionEvent = Schema.Union([
  on(SessionAddress, Schema.Null, 'next', sessionOpen),
  on(SessionAddress, Schema.Literal('Live'), 'next', sessionLine.Live.moves.next),
  on(SessionAddress, Schema.Literal('Paused'), 'next', sessionLine.Paused.moves.next),
])
export type SessionEvent = Of<typeof SessionEvent>

export const QuestionEvent = Schema.Union([
  on(QuestionAddress, Schema.Null, 'next', questionOpen),
  on(QuestionAddress, Schema.Literal('Open'), 'answer', questionLine.Open.moves.answer),
])
export type QuestionEvent = Of<typeof QuestionEvent>

export const ProposalEvent = Schema.Union([
  on(ProposalAddress, Schema.Null, 'next', proposalOpen),
  on(ProposalAddress, Schema.Literal('Drafting'), 'submit', proposalLine.Drafting.moves.submit),
  on(ProposalAddress, Schema.Literal('Reviewing'), 'next', proposalLine.Reviewing.moves.next),
  on(ProposalAddress, Schema.Literal('Reviewing'), 'sendBack', proposalLine.Reviewing.moves.sendBack),
  on(ProposalAddress, Schema.Literal('WaitingForOwner'), 'sendBack', proposalLine.WaitingForOwner.moves.sendBack),
  on(ProposalAddress, Schema.Literal('WaitingForOwner'), 'accept', proposalLine.WaitingForOwner.moves.accept),
  on(ProposalAddress, Schema.Literal('WaitingForOwner'), 'remove', proposalLine.WaitingForOwner.moves.remove),
])
export type ProposalEvent = Of<typeof ProposalEvent>

export const ActivationEvent = Schema.Union([
  on(ActivationAddress, Schema.Literal('Onboarding'), 'next', activationLine.Onboarding.moves.next),
  on(ActivationAddress, Schema.Literal('Activating'), 'reserve', activationLine.Activating.moves.reserve),
  on(ActivationAddress, Schema.Literal('Activating'), 'acknowledge', activationLine.Activating.moves.acknowledge),
  on(ActivationAddress, Schema.Literal('Activating'), 'next', activationLine.Activating.moves.next),
  on(ActivationAddress, Schema.Literal('Activating'), 'back', activationLine.Activating.moves.back),
  on(ActivationAddress, Schema.Literal('RollingBack'), 'back', activationLine.RollingBack.moves.back),
  on(ActivationAddress, Schema.Literal('Active'), 'reserve', activationLine.Active.moves.reserve),
  on(ActivationAddress, Schema.Literal('Active'), 'acknowledge', activationLine.Active.moves.acknowledge),
  on(ActivationAddress, Schema.Literal('Active'), 'bind', activationLine.Active.moves.bind),
  on(ActivationAddress, Schema.Literal('Active'), 'settle', activationLine.Active.moves.settle),
  on(ActivationAddress, Schema.Literal('Active'), 'use', activationLine.Active.moves.use),
])
export type ActivationEvent = Of<typeof ActivationEvent>

export const StoredEvent = Schema.Union([ProjectEvent, TaskEvent, SessionEvent, QuestionEvent, ProposalEvent, ActivationEvent])
  .check(Schema.makeFilter((event) => event.read < event.number))
export type StoredEvent = Of<typeof StoredEvent>
export const StoredEvents = Schema.Array(StoredEvent)

const openQuestion = Schema.TaggedStruct('Question', { question: Schema.Struct({ id: QuestionId, ...questionOpen.input.fields }) })
const answerQuestion = Schema.TaggedStruct('Answer', { line: QuestionAddress, answer: Answer })

const openProposal = Schema.TaggedStruct('Proposal', { id: ProposalId, ...proposalOpen.input.fields })
const submitProposal = Schema.TaggedStruct('SubmitProposal', {
  line: ProposalAddress, ...proposalLine.Drafting.moves.submit.input.fields,
})

export const Submission = Schema.Union([
  Schema.TaggedStruct('StaffReport', {
    read: ReadPosition,
    report: Schema.Union([
      Schema.TaggedStruct('Work', { line: TaskAddress, report: Schema.NullOr(result) }),
      openQuestion, answerQuestion, openProposal, submitProposal,
      Schema.TaggedStruct('Review', { line: ProposalAddress, facts: ReviewFacts }),
    ]),
  }),
  Schema.TaggedStruct('HumanChoice', {
    read: ReadPosition,
    choice: Schema.Union([
      Schema.TaggedStruct('NewProject', { project: ProjectAddress, ...configuration }),
      Schema.TaggedStruct('EndProject', { line: ProjectAddress }),
      Schema.TaggedStruct('Activate', { line: ActivationAddress, ...activationLine.Onboarding.moves.next.input.fields }),
      Schema.TaggedStruct('StartWork', { line: ProjectAddress }),
      openQuestion, answerQuestion, openProposal, submitProposal,
      Schema.TaggedStruct('ChooseProposal', {
        line: ProposalAddress,
        choice: Schema.Union([
          Schema.TaggedStruct('accept', {}),
          Schema.TaggedStruct('remove', {}),
          Schema.TaggedStruct('sendBack', proposalLine.WaitingForOwner.moves.sendBack.input.fields),
        ]),
      }),
    ]),
  }),
])
export type Submission = Of<typeof Submission>
