import { Schema } from 'effect'
import { Human, Staff } from './staff.ts'
import type { Proposal } from './proposal.ts'
import {
  AnswerText, EventNumber, OptionIndex, OptionText, Placeholder, QuestionKey, QuestionText,
  type Of,
} from './values.ts'

const QuestionPrompt = Schema.Struct({ text: QuestionText, placeholder: Schema.NullOr(Placeholder) })
export const QuestionForm = Schema.Union([
  Schema.TaggedStruct('Single', { prompt: QuestionPrompt }),
  Schema.TaggedStruct('Multiple', { prompts: Schema.NonEmptyArray(QuestionPrompt) }),
  Schema.TaggedStruct('OneChoice', { options: Schema.NonEmptyArray(OptionText) }),
  Schema.TaggedStruct('ManyChoices', { options: Schema.NonEmptyArray(OptionText) }),
  Schema.TaggedStruct('Matrix', { rows: Schema.NonEmptyArray(OptionText), columns: Schema.NonEmptyArray(OptionText) }),
])
export type QuestionForm = Of<typeof QuestionForm>

export const Answer = Schema.Union([
  Schema.TaggedStruct('Single', { text: AnswerText }),
  Schema.TaggedStruct('Multiple', { texts: Schema.NonEmptyArray(Schema.NullOr(AnswerText)) }),
  Schema.TaggedStruct('OneChoice', { picked: OptionIndex }),
  Schema.TaggedStruct('ManyChoices', { picked: Schema.NonEmptyArray(OptionIndex) }),
  Schema.TaggedStruct('Matrix', { cells: Schema.NonEmptyArray(OptionIndex) }),
])
export type Answer = Of<typeof Answer>

export const answerFor = (form: QuestionForm, value: unknown): Answer | null => {
  if (!Schema.is(Answer)(value)) return null
  const fits = (() => {
    switch (form._tag) {
      case 'Single': return value._tag === 'Single'
      case 'Multiple': return value._tag === 'Multiple' && value.texts.length === form.prompts.length
      case 'OneChoice': return value._tag === 'OneChoice' && value.picked < form.options.length
      case 'ManyChoices': return value._tag === 'ManyChoices' &&
        value.picked.every((choice, i) => choice < form.options.length && (i === 0 || choice > value.picked[i - 1]!))
      case 'Matrix': return value._tag === 'Matrix' &&
        value.cells.length === form.rows.length && value.cells.every((cell) => cell < form.columns.length)
    }
  })()
  return fits ? value : null
}

const Actor = Schema.Union([Human, Staff])
const QuestionState = Schema.Union([
  Schema.TaggedStruct('Open', {}),
  Schema.TaggedStruct('Answered', { by: Actor, answer: Answer }),
])
export const Question = Schema.Struct({
  key: QuestionKey, from: Actor, to: Actor, text: QuestionText, form: QuestionForm, state: QuestionState,
  lastChange: EventNumber,
})
export type Question = Of<typeof Question>

export const currentQuestion = (proposal: Proposal, question: Question) =>
  proposal.phase._tag === 'Drafting' && question.lastChange > proposal.lastChange ? question : undefined

export const sameActor = (left: Question['from'], right: Question['from']) =>
  (left._tag === 'Human' ? right._tag === 'Human' : right._tag === 'Staff' && left.key === right.key) ? left : undefined
