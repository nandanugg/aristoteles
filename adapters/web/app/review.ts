// The modal of an escalation: the diff of its changes, and, while it waits for review, the
// person's Accept and Send back.
import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import type { WhatJson } from './api.ts'
import { Pyramid, type Act } from './board.ts'
import { Modal } from './modal.ts'
import { type DiffLine, type Escalation, cardLines, changeKind, changeLines } from './pure.ts'

export const Lines = ({ lines }: { lines: ReadonlyArray<DiffLine> }) =>
  html`<pre class="diff">${lines.map((l) => html`<div class=${l.kind}>${
    l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  '}${l.text}</div>`)}</pre>`

interface ReviewProps {
  e: Escalation
  onAct: Act
  onClose: () => void
}
export function Review({ e, onAct, onClose }: ReviewProps) {
  const [points, setPoints] = useState('')
  const [refused, setRefused] = useState<string | null>(null)
  const list = points.split('\n').map((p) => p.trim()).filter((p) => p !== '')
  const run = (what: WhatJson) =>
    onAct(what).then((out) => {
      if ('refused' in out) setRefused(out.words)
      else onClose()
    })
  return html`<${Modal} title=${`Escalation ${e.id}: ${e.task}`} kind="wide" onClose=${onClose}>
    <${Pyramid} summary=${e.summary} />
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
    ${e.status === 'WAIT_FOR_REVIEW'
      ? html`<div class="section-title">Your review</div>
        <div class="field"><label for="points">Points to send back (one on each line)</label>
          <textarea id="points" value=${points}
            onInput=${(ev: Event) => setPoints((ev.target as HTMLTextAreaElement).value)}>
          </textarea></div>
        ${refused ? html`<div class="error" role="alert">${refused}</div>` : ''}
        <div class="modal-foot">
          <button class="btn" disabled=${list.length === 0}
            onClick=${() => run({ _tag: 'SendBack', fix: e.id, points: list })}>Send back</button>
          <button class="btn primary"
            onClick=${() => run({ _tag: 'Accept', fix: e.id })}>Accept</button></div>`
      : ''}
  <//>`
}
