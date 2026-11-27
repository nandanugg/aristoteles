// The modal of an escalation: the diff of its changes, and, while it waits for review, the
// person's Accept and Send back.
import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import type { ActView } from './api.ts'
import { useSubmission } from './submission.ts'
import { Pyramid, type Act } from './board.ts'
import { Modal } from './modal.ts'
import { type DiffLine, type Escalation, cardLines, changeKind, changeLines } from './pure.ts'

export const Lines = ({ lines }: { lines: ReadonlyArray<DiffLine> }) =>
  html`<pre class="diff">${lines.map((l) => html`<div class=${l.kind}>${
    l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}${l.text}</div>`)}</pre>`

interface ReviewProps {
  e: Escalation
  onAct: Act
  view: ActView
  onClose: () => void
}
export function Review({ e, onAct, view, onClose }: ReviewProps) {
  const [points, setPoints] = useState('')
  const { submit, busy, words } = useSubmission(onAct, view)
  const list = points.split('\n').map((p) => p.trim()).filter((p) => p !== '')
  const run = async (reply: Escalation['reply'][number]) => {
    if (e.ask !== null && await submit({
      _tag: 'Respond', ask: e.ask, reply, ...(reply === 'SendItBack' ? { points: list } : {}),
    })) onClose()
  }
  const labels = {
    AcceptIt: 'Accept', SendItBack: 'Send back', TakeAsIs: 'Take it as is',
    EvaluateAgain: 'Evaluate again',
  }
  return html`<${Modal} title=${`Escalation ${e.id}: ${e.task}`} kind="wide" onClose=${onClose}>
    <${Pyramid} summary=${e.summary} />
    ${e.reviewMode ? html`<p>Reviewed by: ${e.reviewMode} (as the pipeline role reports)</p>` : ''}
    <div class="section-title">Changes</div>
    ${e.changes.map((c) => html`<section class="change" key=${c.key} aria-label=${c.key}>
      <div class="change-title"><code>${c.key}</code> <span class="muted">version ${c.version}
        · ${changeKind(c)}</span></div>
      <${Lines} lines=${changeLines(c)} />
    </section>`)}
    ${e.card ? html`<section class="change" aria-label="Role card">
      <div class="change-title">Card of the role <code>${e.card.role}</code></div>
      <${Lines} lines=${cardLines(e.card)} /></section>` : ''}
    ${e.changes.length || e.card ? '' : html`<p class="muted">No change yet.</p>`}
    ${e.ask !== null
      ? html`<div class="section-title">Your review</div>
        ${e.reply.includes('SendItBack') ? html`<label class="field">
          Points to send back (one on each line)
          <textarea value=${points} disabled=${busy}
            onInput=${(ev: Event) => setPoints((ev.currentTarget as HTMLTextAreaElement).value)}>
          </textarea></label>` : ''}
        ${words ? html`<div class="error" role="alert">${words}</div>` : ''}
        <div class="modal-foot">${e.reply.map((reply) => html`<button key=${reply}
          class=${reply === 'AcceptIt' ? 'btn primary' : 'btn'}
          disabled=${busy || (reply === 'SendItBack' && !list.length)}
          onClick=${() => run(reply)}>${labels[reply]}</button>`)}</div>`
      : ''}
  <//>`
}
