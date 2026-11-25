import { Schema } from 'effect'
import { ContextFacts } from './files.ts'
import { NonBlank, PositiveInt } from './ids.ts'

const Text = Schema.String
const Number = Schema.Int
const Nullable = Schema.NullOr(Text)
export const WorkerPlacement = Schema.Struct({
  worker: Text, account: Text, cli: Text, model: Text, launch: Text,
  members: Schema.Array(Text),
  sessionLimit: Schema.NullOr(Number),
  canPark: Schema.optionalKey(Schema.Boolean),
  resume: Schema.optionalKey(Nullable),
})
export type WorkerPlacement = typeof WorkerPlacement.Type
export const WorkerStep = Schema.Struct({
  act: Schema.Literals([
    'Open', 'AskEdit', 'AnswerQuestion', 'Hear', 'AskRaise', 'ReadBrief', 'Resume', 'Report',
    'Review', 'Evaluate', 'Advance', 'WriteRule', 'RunTest', 'Ship', 'LoopReview', 'Respond',
    'Reassign', 'TopDone', 'RecheckDone', 'RunRule', 'Revive', 'Exit', 'EndProject', 'MoveHost',
  ]),
  task: Nullable, fix: Nullable, ask: Nullable, maker: Nullable, actor: Nullable,
})
const Binding = { worker: Text, generation: Number }
const Launch = { ...Binding, launch: Text }
export const WorkerMember = Schema.Struct({ actor: Text, epoch: Number, verifier: Text })
export const Turn = Schema.Struct({
  ...Binding, turn: Text, actor: Text, epoch: Number, obligation: Text, on: Number,
  step: WorkerStep, receiptVerifier: Text,
})
export type Turn = typeof Turn.Type
export const WorkerDelivery = Schema.Union([
  Schema.Struct({
    ...Binding, turn: Text, actor: Text, epoch: Number, obligation: Text, on: Number, step: WorkerStep,
  }),
  Schema.Struct({ ...Binding, actor: Text, epoch: Number, on: Number, kind: Schema.Literal('private') }),
])
export type WorkerDelivery = typeof WorkerDelivery.Type

export const AdmissionPolicy = Schema.Struct({
  actor: Text, concurrency: Number, subagentAllowance: Number, backgroundChildren: Schema.Boolean,
})
export type AdmissionPolicy = typeof AdmissionPolicy.Type

export const ChildReservation = Schema.Struct({
  ...Launch, child: Text, parentActor: Text, parentEpoch: Number, attempt: Text,
  purpose: Schema.Literals(['maker', 'review', 'recheck']), subject: Text, on: Number, execution: Schema.Literal('background'),
  job: Schema.optionalKey(Text),
  reviewBasis: Schema.optionalKey(Number),
  actor: Text, epoch: Number,
})
export type ChildReservation = typeof ChildReservation.Type

export const SerialAssignment = Schema.Struct({
  ...Binding, parentActor: Text, attempt: Text, actor: Text, epoch: Number, verifier: Text,
})
export type SerialAssignment = typeof SerialAssignment.Type

export const ChildRelease = Schema.Struct({
  ...Launch, child: Text, reason: Schema.Literals(['reported', 'exited', 'never launched', 'generation ended']),
  observation: Text,
})
export type ChildRelease = typeof ChildRelease.Type

const Versions = Schema.Array(Schema.Tuple([Text, Number]))
export const RecheckFinding = Schema.Struct({
  item: Text, version: Number, outcome: Schema.Literals(['holds', 'breaks']), evidence: Text,
})
export type RecheckFinding = typeof RecheckFinding.Type
export const RecheckBrief = Schema.Struct({
  goal: Text, sections: Schema.Array(Text), facts: ContextFacts, output: Nullable, files: Schema.Array(Text),
  rules: Schema.Array(Schema.Struct({
    item: Text, version: Number, says: Text, reference: Nullable, test: Nullable,
    knownBreaks: Schema.Array(Text),
  })),
})
export type RecheckBrief = typeof RecheckBrief.Type
export const RecheckUse = Schema.Struct({ job: Text, report: Text })
export type RecheckUse = typeof RecheckUse.Type
const Park = { ...Launch, job: Text, checkpoint: Text }

export const RuntimeEvent = Schema.Union([
  Schema.TaggedStruct('ProjectUsageMeasured', { model: NonBlank, tokens: PositiveInt }),
  Schema.TaggedStruct('WorkerReserved', {
    ...Launch, expectedGeneration: Number, purpose: Schema.Literals(['work', 'recheck', 'resume']),
    placement: WorkerPlacement, members: Schema.Array(Text), slot: Text,
    job: Schema.optionalKey(Text), checkpoint: Schema.optionalKey(Text),
  }),
  Schema.TaggedStruct('WorkerBound', {
    ...Launch, session: Text, waitVerifier: Text, members: Schema.Array(WorkerMember),
  }),
  Schema.TaggedStruct('WorkerFenced', { ...Launch, reason: Text }),
  Schema.TaggedStruct('WorkerEnded', { ...Launch, session: Nullable, reason: Text, observation: Text }),
  Schema.TaggedStruct('ChildReserved', ChildReservation.fields),
  Schema.TaggedStruct('ChildStarted', { ...Launch, child: Text, verifier: Text }),
  Schema.TaggedStruct('ChildBound', { ...Launch, child: Text, handle: Text, verifier: Text }),
  Schema.TaggedStruct('ChildReleased', ChildRelease.fields),
  Schema.TaggedStruct('RecheckQueued', {
    job: Text, pipe: Text, attempt: Text, task: Text, result: Number, items: Versions,
    on: Number, briefDigest: Text, brief: RecheckBrief, worker: Text,
  }),
  Schema.TaggedStruct('CheckpointSaved', { ...Binding, job: Text, attempt: Text, checkpoint: Text, digest: Text }),
  Schema.TaggedStruct('WorkerParkRequested', Park),
  Schema.TaggedStruct('WorkerParkConfirmed', { ...Park, session: Text, observation: Text }),
  Schema.TaggedStruct('WorkerParkCancelled', { ...Park, reason: Text, observation: Text }),
  Schema.TaggedStruct('RecheckDeferred', { ...Binding, job: Text, reason: Text, checkpoint: Schema.optionalKey(Text) }),
  Schema.TaggedStruct('RecheckHelperBound', {
    job: Text, helper: Text, route: Schema.Literals(['child', 'session']), allocation: Text, launch: Text, verifier: Text,
  }),
  Schema.TaggedStruct('RecheckReported', {
    job: Text, helper: Text, report: Text, on: Number, items: Versions, findings: Schema.Array(RecheckFinding),
  }),
  Schema.TaggedStruct('WorkerRecoveryRequested', { ...Binding, job: Text, checkpoint: Text, reason: Text }),
  Schema.TaggedStruct('RecheckCancelled', { job: Text, reason: Text }),
  Schema.TaggedStruct('TurnOffered', Turn.fields),
  Schema.TaggedStruct('TurnClosed', {
    ...Binding, turn: Text, reason: Schema.Literals(['abandoned', 'withdrawn', 'refused']),
  }),
])
export type RuntimeEvent = typeof RuntimeEvent.Type
