import { Schema } from 'effect'
import type { Project } from './records.ts'
import type { Proposal } from './proposal.ts'
import {
  EventNumber, Markdown, OptionIndex, OptionText, QuestionKey, ShortAnswer, StaffKey, StoredActor,
  type Of,
} from './values.ts'

const kinds = {
  ShortAnswer: Schema.TaggedStruct('ShortAnswer', {}),
  Markdown: Schema.TaggedStruct('Markdown', {}),
  OneChoice: Schema.TaggedStruct('OneChoice', { options: Schema.NonEmptyArray(OptionText) }),
  ManyChoices: Schema.TaggedStruct('ManyChoices', { options: Schema.NonEmptyArray(OptionText) }),
  Matrix: Schema.TaggedStruct('Matrix', { rows: Schema.NonEmptyArray(OptionText), columns: Schema.NonEmptyArray(OptionText) }),
}
export const AnswerKind = Schema.Union(Object.values(kinds))
export type AnswerKind = Of<typeof AnswerKind>

const answers = {
  ShortAnswer: Schema.Struct({ text: ShortAnswer }),
  Markdown: Schema.Struct({ text: Markdown }),
  OneChoice: Schema.Struct({ picked: OptionIndex }),
  ManyChoices: Schema.Struct({ picked: Schema.NonEmptyArray(OptionIndex) }),
  Matrix: Schema.Struct({ cells: Schema.NonEmptyArray(OptionIndex) }),
}
export type AnswerTo<K extends AnswerKind> = Of<(typeof answers)[K['_tag']]>

// A submission carries the kind while it is in transit to the addressed question.
export const Answer = Schema.Union([
  Schema.TaggedStruct('ShortAnswer', answers.ShortAnswer.fields),
  Schema.TaggedStruct('Markdown', answers.Markdown.fields),
  Schema.TaggedStruct('OneChoice', answers.OneChoice.fields),
  Schema.TaggedStruct('ManyChoices', answers.ManyChoices.fields),
  Schema.TaggedStruct('Matrix', answers.Matrix.fields),
])
export type Answer = Of<typeof Answer>

export const answerFor = (expects: AnswerKind, answer: Answer): Answer | null => {
  switch (expects._tag) {
    case 'ShortAnswer': return answer._tag === 'ShortAnswer' ? answer : null
    case 'Markdown': return answer._tag === 'Markdown' ? answer : null
    case 'OneChoice': return answer._tag === 'OneChoice' && answer.picked < expects.options.length ? answer : null
    case 'ManyChoices':
      return answer._tag === 'ManyChoices' && answer.picked.every((choice) => choice < expects.options.length) ? answer : null
    case 'Matrix':
      return answer._tag === 'Matrix' && answer.cells.length === expects.rows.length &&
        answer.cells.every((cell) => cell < expects.columns.length) ? answer : null
  }
}

export const QuestionRecipient = Schema.Union([StoredActor.members[0], Schema.TaggedStruct('Staff', { key: StaffKey })])
const open = Schema.TaggedStruct('Open', {})
const questionOf = <K extends keyof typeof kinds>(kind: K) => Schema.Struct({
  key: QuestionKey, from: StoredActor, to: QuestionRecipient, text: Markdown,
  expects: kinds[kind], changedIn: EventNumber,
  state: Schema.Union([open, Schema.TaggedStruct('Answered', { by: StoredActor, answer: answers[kind] })]),
})
export const Question = Schema.Union([
  questionOf('ShortAnswer'), questionOf('Markdown'), questionOf('OneChoice'), questionOf('ManyChoices'), questionOf('Matrix'),
])
export type Question<K extends AnswerKind = AnswerKind> = Extract<Of<typeof Question>, { readonly expects: K }>

export const currentQuestion = (proposal: Proposal, question: Question) =>
  proposal.phase._tag === 'Drafting' && question.changedIn > proposal.changedIn ? question : undefined

export const actorFor = (project: Project, actor: StoredActor): Question['to'] | undefined => {
  if (actor._tag === 'Human') return actor
  const session = project.sessions.get(actor.key)
  return session && { _tag: 'Staff', key: session.staff.key }
}

export const sameActor = (left: Question['to'], right: Question['to']) =>
  (left._tag === 'Human' ? right._tag === 'Human' : right._tag === 'Staff' && left.key === right.key) ? left : undefined
