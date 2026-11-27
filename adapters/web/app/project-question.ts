import { Schema } from 'effect'
import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import {
  Answer, Rationale, answerFor, refuse, type AnswerKind,
  type Of, type Question as ProjectQuestion, type QuestionEvent, type ReadPosition, type Refusal, type Submission,
} from '../../../core/schema/project.ts'

export const answerFromForm = (expects: AnswerKind, data: FormData): Answer | null => {
  const index = (value: FormDataEntryValue | null) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : -1
  const field = (i: number) => data.get('answer-' + i)
  const value = (() => {
    switch (expects._tag) {
      case 'ShortAnswer':
      case 'Markdown': return { _tag: expects._tag, text: field(0) }
      case 'OneChoice': return { _tag: 'OneChoice', picked: index(field(0)) }
      case 'ManyChoices': return { _tag: 'ManyChoices', picked: data.getAll('answer-0').map(index).sort((a, b) => a - b) }
      case 'Matrix': return { _tag: 'Matrix', cells: expects.rows.map((_, i) => index(field(i))) }
    }
  })()
  return Schema.is(Answer)(value) ? answerFor(expects, value) : null
}

const fieldsFor = (expects: AnswerKind) => {
  switch (expects._tag) {
    case 'ShortAnswer': return html`<input name="answer-0" aria-label="Answer" required />`
    case 'Markdown': return html`<textarea name="answer-0" aria-label="Answer" required></textarea>`
    case 'OneChoice':
    case 'ManyChoices':
      return expects.options.map((option, i) => html`<label key=${i} class="question-choice">
        <input type=${expects._tag === 'OneChoice' ? 'radio' : 'checkbox'} name="answer-0" value=${i}
          required=${expects._tag === 'OneChoice'} /> ${option}</label>`)
    case 'Matrix':
      return expects.rows.map((row, i) => html`<label key=${i} class="field">${row}
        <select name=${'answer-' + i} required>
          <option value="" selected disabled>Select a column</option>
          ${expects.columns.map((column, j) => html`<option key=${j} value=${j}>${column}</option>`)}
        </select></label>`)
  }
}

export const questionAnswerSubmission = (
  { owner, key }: Pick<QuestionEvent, 'owner' | 'key'>, read: Of<typeof ReadPosition>, answer: Answer,
): Submission => ({
  read, line: 'Question', owner, key, move: 'answer', input: { answer },
})

export function QuestionCard({
  question, owner, read, submit,
}: {
  readonly question: ProjectQuestion
  readonly owner: QuestionEvent['owner']
  readonly read: Of<typeof ReadPosition>
  readonly submit: (submission: Submission) => Promise<Refusal | null>
}): ReturnType<typeof html> | null {
  const [failure, setFailure] = useState<Refusal | null>(null)
  const [busy, setBusy] = useState(false)
  if (question.state._tag !== 'Open') return null
  return html`<form aria-label=${question.text} onSubmit=${async (event: SubmitEvent) => {
    event.preventDefault()
    const element = event.currentTarget
    if (!(element instanceof HTMLFormElement) || busy) return
    const answer = answerFromForm(question.expects, new FormData(element))
    if (!answer) {
      setFailure(refuse('InvalidInput', Rationale.make('Complete the question’s answer form.')))
      return
    }
    setBusy(true)
    try {
      setFailure(await submit(questionAnswerSubmission({ owner, key: question.key }, read, answer)))
    } catch {
      setFailure(refuse('Unavailable', Rationale.make('The page could not send the answer.')))
    } finally {
      setBusy(false)
    }
  }}>
    ${owner._tag === 'Project' ? null : html`<p>${owner._tag} ${owner.key}</p>`}
    <fieldset disabled=${busy}><legend>${question.text}</legend>${fieldsFor(question.expects)}</fieldset>
    <button class="btn primary" type="submit" disabled=${busy}>Answer</button>
    ${failure ? html`<p class="error" role="alert">${failure.why}</p>` : null}
  </form>`
}
