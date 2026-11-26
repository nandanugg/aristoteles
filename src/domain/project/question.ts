import { Schema } from 'effect'
import type { Project, Question } from './records.ts'
import {
  AnswerText, EventNumber, OptionIndex, OptionText, Placeholder, ProposalId, QuestionText,
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

// Staffing proposals acquire their full record in U4. A question already pins the proposal and its basis.
export const StaffingSubject = Schema.TaggedStruct('Staffing', {
  proposal: Schema.Struct({ id: ProposalId, basis: EventNumber }),
})
// An older staffing question stays in history when another draft asks for input.
export const currentQuestion = (project: Project, question: Question): Question | null => {
  if (question.about._tag !== 'Staffing') return question
  const { proposal } = question.about
  return project.staffingAt > proposal.basis || [...project.questions.values()].some((other) =>
    other.about._tag === 'Staffing' && other.about.proposal.id === proposal.id && other.about.proposal.basis > proposal.basis,
  ) ? null : question
}
