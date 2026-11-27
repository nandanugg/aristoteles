import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import {
  Rationale, answerFor, refuse, type Answer as ProjectAnswer, type QuestionForm as ProjectForm,
  type Of, type Question as ProjectQuestion, type QuestionAddress, type ReadPosition, type Refusal, type Submission,
} from '../../../core/schema/project.ts'

export const answerFromForm = (form: ProjectForm, data: FormData): ProjectAnswer | null => {
  const index = (value: FormDataEntryValue | null) => typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : -1
  const field = (i: number) => data.get('answer-' + i)
  const value = (() => {
    switch (form._tag) {
      case 'Single': return { _tag: 'Single', text: field(0) }
      case 'Multiple': return { _tag: 'Multiple', texts: form.prompts.map((_, i) => field(i) || null) }
      case 'OneChoice': return { _tag: 'OneChoice', picked: index(field(0)) }
      case 'ManyChoices': return { _tag: 'ManyChoices', picked: data.getAll('answer-0').map(index).sort((a, b) => a - b) }
      case 'Matrix': return { _tag: 'Matrix', cells: form.rows.map((_, i) => index(field(i))) }
    }
  })()
  return answerFor(form, value)
}

const fieldsFor = (form: ProjectForm) => {
  switch (form._tag) {
    case 'Single':
    case 'Multiple':
      return (form._tag === 'Single' ? [form.prompt] : form.prompts).map((prompt, i) => html`
        <label key=${i} class="field">${prompt.text}
          <textarea name=${'answer-' + i} placeholder=${prompt.placeholder ?? undefined}
            required=${form._tag === 'Single'}></textarea>
        </label>`)
    case 'OneChoice':
    case 'ManyChoices':
      return form.options.map((option, i) => html`<label key=${i} class="question-choice">
        <input type=${form._tag === 'OneChoice' ? 'radio' : 'checkbox'} name="answer-0" value=${i}
          required=${form._tag === 'OneChoice'} /> ${option}</label>`)
    case 'Matrix':
      return form.rows.map((row, i) => html`<label key=${i} class="field">${row}
        <select name=${'answer-' + i} required>
          <option value="" selected disabled>Select a column</option>
          ${form.columns.map((column, j) => html`<option key=${j} value=${j}>${column}</option>`)}
        </select></label>`)
  }
}

export const questionAnswerSubmission = (
  line: Of<typeof QuestionAddress>, read: Of<typeof ReadPosition>, answer: ProjectAnswer,
): Submission => ({
  read, line, move: 'answer', input: { answer },
})

export function QuestionCard({
  question, line, read, submit,
}: {
  readonly question: ProjectQuestion
  readonly line: Of<typeof QuestionAddress>
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
    const answer = answerFromForm(question.form, new FormData(element))
    if (!answer) {
      setFailure(refuse('InvalidInput', Rationale.make('Complete the question’s answer form.')))
      return
    }
    setBusy(true)
    try {
      setFailure(await submit(questionAnswerSubmission(line, read, answer)))
    } catch {
      setFailure(refuse('Unavailable', Rationale.make('The page could not send the answer.')))
    } finally {
      setBusy(false)
    }
  }}>
    ${line.owner._tag === 'Project' ? null : html`<p>${line.owner._tag} ${line.owner.key}</p>`}
    <fieldset disabled=${busy}><legend>${question.text}</legend>${fieldsFor(question.form)}</fieldset>
    <button class="btn primary" type="submit" disabled=${busy}>Answer</button>
    ${failure ? html`<p class="error" role="alert">${failure.why}</p>` : null}
  </form>`
}
