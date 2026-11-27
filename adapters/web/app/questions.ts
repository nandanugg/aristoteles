import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import { type AnswerBody, answers } from '../../../core/state/c16/types.ts'
import type { Dash } from '../contract.ts'
import type { ActView, WorkSender } from './api.ts'
import { useSubmission } from './submission.ts'

type Question = Extract<Dash['person']['owed'][number], { readonly _tag: 'Question' }>
const textOf = (e: Event): string => (e.currentTarget as HTMLTextAreaElement).value

export function QuestionForm({
  act, onAct, view,
}: { act: Question; onAct: WorkSender; view: ActView }) {
  const { form, title } = act.question
  const [answer, setAnswer] = useState<AnswerBody>(() => {
    switch (form._tag) {
      case 'Single': return { _tag: 'Single', text: '' }
      case 'Multiple': return { _tag: 'Multiple', texts: form.questions.map(() => '') }
      case 'Choice': return { _tag: 'Choice', picked: [] }
      case 'Matrix': return { _tag: 'Matrix', cells: form.rows.map(() => -1) }
    }
  })
  const { submit, busy, words } = useSubmission(onAct, view)
  const fields = (() => {
    if (form._tag === 'Single' && answer._tag === 'Single') {
      return html`<textarea aria-label="Your answer" value=${answer.text}
        onInput=${(e: Event) => setAnswer({ _tag: 'Single', text: textOf(e) })}></textarea>`
    }
    if (form._tag === 'Multiple' && answer._tag === 'Multiple') {
      return form.questions.map((q, i) => html`<label key=${i} class="field">${q.description}
        <textarea placeholder=${q.placeholder} value=${answer.texts[i]}
          onInput=${(e: Event) => setAnswer({
            _tag: 'Multiple', texts: answer.texts.map((v, n) => n === i ? textOf(e) : v),
          })}></textarea></label>`)
    }
    if (form._tag === 'Choice' && answer._tag === 'Choice') {
      return form.options.map((option, i) => html`<label key=${i} class="question-choice">
        <input type=${form.multi ? 'checkbox' : 'radio'} name=${`choice-${act.ask}`}
          checked=${answer.picked.includes(i)}
          onChange=${(e: Event) => {
            const checked = (e.currentTarget as HTMLInputElement).checked
            const picks = new Set(form.multi ? answer.picked : [])
            if (checked) picks.add(i)
            else picks.delete(i)
            setAnswer({ _tag: 'Choice', picked: [...picks].sort((a, b) => a - b) })
          }} />
        ${option}</label>`)
    }
    if (form._tag === 'Matrix' && answer._tag === 'Matrix') {
      return form.rows.map((row, i) => html`<label key=${i} class="field">${row}
        <select value=${String(answer.cells[i] ?? -1)} onChange=${(e: Event) => {
          const column = Number((e.currentTarget as HTMLSelectElement).value)
          setAnswer({ _tag: 'Matrix', cells: answer.cells.map((v, n) => i === n ? column : v) })
        }}>
          <option value="-1" disabled>Select a column</option>
          ${form.columns.map((column, j) => html`<option key=${j} value=${j}>${column}</option>`)}
        </select></label>`)
    }
    return ''
  })()
  return html`<li class="owed"><form aria-label=${title} onSubmit=${(e: Event) => {
    e.preventDefault()
    if (answers(form, answer)) void submit({ _tag: 'AnswerQuestion', ask: act.ask, answer })
  }}>
    <div class="muted">${act.role ?? act.from}</div>
    <fieldset disabled=${busy}><legend>${title}</legend>${fields}</fieldset>
    <button class="btn primary" type="submit" disabled=${busy || !answers(form, answer)}>
      Answer</button>
    ${words ? html`<div class="error" role="alert">${words}</div>` : ''}
  </form></li>`
}


export { QuestionCard, answerFromForm, questionAnswerSubmission } from './project-question.ts'
