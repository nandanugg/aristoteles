// A decision of the person (the panel of a task, and the adjustments of the gear): its words,
// its change, and its buttons.
import { Schema } from 'effect'
import { html } from 'htm/preact'
import { useRef, useState } from 'preact/hooks'
import {
  EventRef,
  ProblemId,
  QuestionId,
  RevisionId,
  RunId,
  TaskId,
} from '../../../src/domain/ids.ts'
import type { Decision } from '../contract.ts'
import type { ActOut } from './api.ts'
import { post, toast } from './api.ts'
import { Change } from './change.ts'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// A decision that needs the person: the host's words (or the raw text), and its buttons. A
// direction problem reads in three parts: the problem, the change, the hope. A relayed act shows
// the person's own words under it.
const KIND = {
  system: 'A system problem',
  direction: 'A direction problem',
  end: 'The end of the project',
  confirm: 'Your words, relayed',
  roleWords: 'New words of a role',
  adjustment: 'An adjustment',
  question: 'A question for you',
}
const kindOf = (item: Decision): keyof typeof KIND => {
  switch (item._tag) {
    case 'System':
      return 'system'
    case 'Direction':
      return 'direction'
    case 'End':
      return 'end'
    case 'Confirm':
      return 'confirm'
    case 'RoleWords':
      return 'roleWords'
    case 'Adjustment':
      return 'adjustment'
    case 'Question':
      return 'question'
  }
}
export function Item({ item }: { item: Decision }) {
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  // A refused act keeps the person's comment, and its reason stays in the decision (a toast goes
  // after 5 seconds, and the decision looked as if nothing happened).
  const run = (fn: () => Promise<ActOut>) => async () => {
    if (busy.current) return
    busy.current = true
    setError(null)
    try {
      const out = await fn()
      if (out.out) toast(out.out.split('\n')[0] ?? '')
      setComment('')
    } catch (e) {
      setError(errorText(e))
    } finally {
      busy.current = false
    }
  }
  const kind = kindOf(item)
  // Each act decodes the id of the decision into its branded type; a bad id is shown as a refusal.
  const fixed = () => post({ act: 'fixed', problem: Schema.decodeUnknownSync(ProblemId)(item.id) })
  const acceptDraft = () =>
    post({ act: 'accept-draft', draft: Schema.decodeUnknownSync(RevisionId)(item.id), comment })
  const rejectDraft = () =>
    post({
      act: 'reject-draft',
      draft: Schema.decodeUnknownSync(RevisionId)(item.id),
      reason: comment,
    })
  const confirm = () =>
    post({ act: 'confirm', forward: Schema.decodeUnknownSync(EventRef)(item.id) })
  const acceptEnd = () => post({ act: 'end', run: Schema.decodeUnknownSync(RunId)(item.id) })
  const rejectTask = () =>
    post({ act: 'reject-task', task: Schema.decodeUnknownSync(TaskId)(item.task), reason: comment })
  const words = Schema.decodeUnknownSync(EventRef)
  const acceptWords = () => post({ act: 'accept-words', draft: words(item.id) })
  const rejectWords = () => post({ act: 'reject-words', draft: words(item.id), reason: comment })
  const acceptAdjustment = () => post({ act: 'accept-adjustment', draft: words(item.id) })
  const rejectAdjustment = () =>
    post({ act: 'reject-adjustment', draft: words(item.id), reason: comment })
  // The person's answer counts at once: an option's words, or their own.
  const answer = (text: string) => () =>
    post({ act: 'answer', question: Schema.decodeUnknownSync(QuestionId)(item.id), text })
  // A decision takes one comment: a reject needs it, an accept does not.
  const decides =
    kind === 'direction' || kind === 'end' || kind === 'roleWords' || kind === 'adjustment'
  const noComment = !comment.trim()
  // New words of a role read as a change too: each word of now, then its drafted word.
  const change =
    item._tag === 'Direction'
      ? item.change
      : item._tag === 'RoleWords'
        ? { direction: item.role, lines: item.lines }
        : null
  const hope = item._tag === 'Direction' ? item.hope : null
  const quote = item._tag === 'Confirm' ? item.quote : null
  const asked = item._tag === 'Question' ? item : null
  const own = asked?.options.length ? 'Or your own answer' : 'Your answer'
  return html`<div class=${`item ${kind}`} role="region" aria-label=${KIND[kind]}>
    <div class="item-head"><span class="badge" aria-hidden="true">${asked ? '?' : '!'}</span>
      <strong>${KIND[kind]}</strong></div>
    ${asked ? html`<div class="item-raw">${asked.asker} asks:</div>` : ''}
    <div class="prose">${item.words ?? item.text}</div>
    ${change ? html`<${Change} change=${change} />` : ''}
    ${hope ? html`<div class="prose">${hope}</div>` : ''}
    ${quote ? html`<blockquote class="prose">${quote}</blockquote>` : ''}
    ${item.words ? html`<div class="item-raw">${item.text}</div>` : ''}
    ${decides ? html`<label class="field"><span>Your comment (a reject needs one)</span>
      <textarea rows="2" value=${comment}
        onInput=${(e: Event) => setComment((e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea></label>` : ''}
    ${asked ? html`
      ${asked.options.length ? html`<div class="item-options">
        ${asked.options.map((o) => html`<button class="btn"
          onClick=${run(answer(o))}>${o}</button>`)}</div>` : ''}
      <label class="field"><span>${own}</span>
        <textarea rows="2" value=${comment}
          onInput=${(e: Event) => setComment((e.currentTarget as HTMLTextAreaElement).value)}
        ></textarea></label>` : ''}
    ${error ? html`<div class="error" role="alert">Refused: ${error}</div>` : ''}
    <div class="item-actions">
      ${kind === 'system' ? html`<button class="btn primary"
        onClick=${run(fixed)}>Fixed</button>` : ''}
      ${kind === 'direction' ? html`
        <button class="btn primary" onClick=${run(acceptDraft)}>Accept the change</button>
        <button class="btn" disabled=${noComment}
          onClick=${run(rejectDraft)}>Reject the change</button>` : ''}
      ${kind === 'confirm' ? html`<button class="btn primary"
        onClick=${run(confirm)}>Confirm</button>` : ''}
      ${kind === 'end' ? html`
        <button class="btn primary" onClick=${run(acceptEnd)}>Accept the end</button>
        <button class="btn" disabled=${noComment}
          onClick=${run(rejectTask)}>Reject the result</button>` : ''}
      ${kind === 'roleWords' ? html`
        <button class="btn primary" onClick=${run(acceptWords)}>Accept the words</button>
        <button class="btn" disabled=${noComment}
          onClick=${run(rejectWords)}>Reject the words</button>` : ''}
      ${asked ? html`<button class="btn primary" disabled=${noComment}
        onClick=${run(answer(comment))}>Answer</button>` : ''}
      ${kind === 'adjustment' ? html`
        <button class="btn primary" onClick=${run(acceptAdjustment)}>Accept</button>
        <button class="btn" disabled=${noComment}
          onClick=${run(rejectAdjustment)}>Reject</button>` : ''}
    </div>
  </div>`
}
