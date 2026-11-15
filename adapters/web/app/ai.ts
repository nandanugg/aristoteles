// The toast of the dir view (P8, ruling 3): the directions page and the agents page show no task
// and no terminal; this toast says what the AI does now. When the AI needs the person, it is its
// question instead: the question, its choices, and one free answer, which counts at once.
import { html } from 'htm/preact'
import type { DirView } from '../contract.ts'
import { Item } from './item.ts'

type Toast = (typeof DirView.Type)['toast']

export function AiToast({ toast }: { toast: Toast }) {
  if (toast.question) {
    return html`<aside class="ai-toast asks" aria-label="The AI asks you">
      <${Item} key=${toast.question.id} item=${toast.question} /></aside>`
  }
  const s = toast.status
  if (!s) return ''
  return html`<aside class="ai-toast" role="status" aria-label="What the AI does">
    <span class=${`ai-dot ${s.kind}`} aria-hidden="true"></span>
    <div><strong>${s.words}</strong><div class="ai-text">${s.text}</div></div>
  </aside>`
}
