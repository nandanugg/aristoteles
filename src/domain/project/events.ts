import { Schema } from 'effect'
import { ProposalValue } from './proposal.ts'
import { ReviewRun, ReviewFacts } from './review.ts'
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
    next: { to: ['Open'], input: Schema.TaggedStruct('TaskSent', { draft: TaskDraft }) },
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
    next: { to: ['Reviewing', 'WaitingForOwner'], input: Schema.Struct({ run: ReviewRun, facts: Schema.NullOr(ReviewFacts) }) },
    sendBack: { to: ['Drafting'], input: Schema.Struct({ run: ReviewRun, facts: ReviewFacts }) },
  } },
  WaitingForOwner: { owes: 'Owner', moves: {
    sendBack: { to: ['Drafting'], input: Schema.Struct({ why: Rationale }) },
    accept: { to: ['Accepted'], input: Schema.Struct({}) },
    remove: { to: ['Removed'], input: Schema.Struct({}) },
  } },
  Accepted: { owes: 'None', moves: {} },
  Removed: { owes: 'None', moves: {} },
})

const entry = { number: EventNumber, actor: StoredActor, read: ReadPosition, at: Timestamp }
const on = <A extends Schema.Top, F extends Schema.Top, M extends 'next' | 'end' | 'back' | 'answer' | 'submit' | 'sendBack' | 'accept' | 'remove', I extends Schema.Top>(
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

export const StoredEvent = Schema.Union([ProjectEvent, TaskEvent, SessionEvent, QuestionEvent, ProposalEvent])
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
