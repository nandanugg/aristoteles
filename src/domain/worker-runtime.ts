import { Schema } from 'effect'

const Text = Schema.String
const Number = Schema.Int
const Nullable = Schema.NullOr(Text)
export const WorkerPlacement = Schema.Struct({
  worker: Text, account: Text, cli: Text, model: Text, launch: Text,
  members: Schema.NonEmptyArray(Text),
  sessionLimit: Schema.NullOr(Number),
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

export const RuntimeEvent = Schema.Union([
  Schema.TaggedStruct('WorkerReserved', {
    ...Launch, expectedGeneration: Number, purpose: Schema.Literal('work'),
    placement: WorkerPlacement, members: Schema.NonEmptyArray(Text), slot: Text,
  }),
  Schema.TaggedStruct('WorkerBound', {
    ...Launch, session: Text, waitVerifier: Text, members: Schema.Array(WorkerMember),
  }),
  Schema.TaggedStruct('WorkerFenced', { ...Launch, reason: Text }),
  Schema.TaggedStruct('WorkerEnded', { ...Launch, session: Nullable, reason: Text, observation: Text }),
  Schema.TaggedStruct('TurnOffered', Turn.fields),
  Schema.TaggedStruct('TurnClosed', {
    ...Binding, turn: Text, reason: Schema.Literals(['abandoned', 'withdrawn', 'refused']),
  }),
])
export type RuntimeEvent = typeof RuntimeEvent.Type
