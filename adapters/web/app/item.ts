// A decision of the person (the panel of a task, the inbox of the dir, and the adjustments of the
// gear): its words, its change, and its buttons. The buttons are the decision's acts only: each
// one passed canAct, so the page offers nothing that is refused (P1).
import { Schema } from 'effect'
import { html } from 'htm/preact'
import { useRef, useState } from 'preact/hooks'
import { NonBlank, type QuestionId } from '../../../src/domain/ids.ts'
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
  evaluation: 'An evaluation for you',
  step: 'Waits for you',
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
    case 'Evaluation':
      return 'evaluation'
    case 'Step':
      return 'step'
  }
}
type Act = Decision['acts'][number]
const actsOf = <T extends Act['_tag']>(item: Decision, tag: T) =>
  item.acts.filter((a): a is Extract<Act, { readonly _tag: T }> => a._tag === tag)

// inbox: the decision shows in the inbox of the dir, so it names its task.
export function Item({ item, inbox = false }: { item: Decision; inbox?: boolean }) {
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
  const has = (tag: Act['_tag']) => item.acts.some((a) => a._tag === tag)
  // A reject needs words: its button is off while the comment is blank.
  const reason = () => Schema.decodeUnknownSync(NonBlank)(comment)
  // The acts of any other item: an assign, a suggestion in words, a resolve.
  const gives = actsOf(item, 'Give')
  const suggests = actsOf(item, 'Suggest')
  const resolves = actsOf(item, 'Resolve')
  const terminal = actsOf(item, 'AtTerminal')
  const assign = (a: (typeof gives)[number]) => () =>
    post({ act: 'assign', task: a.task, role: a.role })
  const suggest = (a: (typeof suggests)[number]) => () =>
    post({ act: 'suggest', about: a.about, says: Schema.decodeUnknownSync(NonBlank)(comment) })
  const resolve = (a: (typeof resolves)[number]) => () =>
    post({ act: 'resolve', escalation: a.escalation, text: comment })
  // A decision takes one comment: a reject needs it, an accept does not.
  const decides =
    (kind === 'direction' || kind === 'end' || kind === 'roleWords' || kind === 'adjustment') &&
    (has('Accept') || has('Reject'))
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
  const evaluated = item._tag === 'Evaluation' ? item : null
  const own = asked?.options.length ? 'Or your own answer' : 'Your answer'
  // The words of the one text box: what it is for, by the acts that read it.
  const field = asked
    ? own
    : evaluated
      ? 'What you read in it (an accept and a reject need it)'
      : decides
        ? 'Your comment (a reject needs one)'
        : resolves.length
          ? 'Your resolution'
          : suggests.length
            ? 'What you want, in your words'
            : null
  const title = item._tag === 'Step' ? item.title : KIND[kind]
  // The person's answer counts at once: an option's words, or their own.
  const answerOf = (question: QuestionId, text: string) => () =>
    post({ act: 'answer', question, text })
  // An accept and a reject of the decision's own record; a reject needs the comment.
  type Post = () => Promise<ActOut>
  const pair = (yes: string, accept: Post, no: string, reject: Post, needs = false) => html`
    ${has('Accept') ? html`<button class="btn primary" disabled=${needs && noComment}
      onClick=${run(accept)}>${yes}</button>` : ''}
    ${has('Reject') ? html`<button class="btn" disabled=${noComment}
      onClick=${run(reject)}>${no}</button>` : ''}`
  // The acts on the decision's own record, by its kind: each id is typed on the wire.
  const ownActs = () => {
    switch (item._tag) {
      case 'System': {
        const problem = item.id
        return has('FixProblem')
          ? html`<button class="btn primary"
              onClick=${run(() => post({ act: 'fixed', problem }))}>Fixed</button>`
          : ''
      }
      case 'Direction': {
        const draft = item.id
        return pair(
          'Accept the change',
          () => post({ act: 'accept-draft', draft, comment }),
          'Reject the change',
          () => post({ act: 'reject-draft', draft, reason: reason() }),
        )
      }
      case 'Confirm': {
        const forward = item.id
        return has('Confirm')
          ? html`<button class="btn primary"
              onClick=${run(() => post({ act: 'confirm', forward }))}>Confirm</button>`
          : ''
      }
      case 'End': {
        const { id: run, top: task } = item
        return pair(
          'Accept the end',
          () => post({ act: 'end', run }),
          'Reject the result',
          () => post({ act: 'reject-task', task, reason: reason() }),
        )
      }
      case 'RoleWords': {
        const draft = item.id
        return pair(
          'Accept the words',
          () => post({ act: 'accept-words', draft }),
          'Reject the words',
          () => post({ act: 'reject-words', draft, reason: reason() }),
        )
      }
      case 'Question': {
        return has('Answer')
          ? html`<button class="btn primary" disabled=${noComment}
              onClick=${run(answerOf(item.id, comment))}>Answer</button>`
          : ''
      }
      case 'Adjustment': {
        const draft = item.id
        return pair(
          'Accept',
          () => post({ act: 'accept-adjustment', draft }),
          'Reject',
          () => post({ act: 'reject-adjustment', draft, reason: reason() }),
        )
      }
      case 'Evaluation': {
        const evaluation = item.id
        return pair(
          'Accept the evaluation',
          () => post({ act: 'accept-evaluation', evaluation, text: comment }),
          'Reject the evaluation',
          () => post({ act: 'reject-evaluation', evaluation, reason: reason() }),
          true,
        )
      }
      case 'Step':
        return ''
    }
  }
  return html`<div class=${`item ${kind}`} role="region" aria-label=${title}>
    <div class="item-head"><span class="badge" aria-hidden="true">${asked ? '?' : '!'}</span>
      <strong>${title}</strong>
      ${inbox && item.task ? html`<span class="item-task">${item.task}</span>` : ''}</div>
    ${asked ? html`<div class="item-raw">${asked.asker} asks:</div>` : ''}
    <div class="prose">${item.words ?? item.text}</div>
    ${change ? html`<${Change} change=${change} />` : ''}
    ${hope ? html`<div class="prose">${hope}</div>` : ''}
    ${quote ? html`<blockquote class="prose">${quote}</blockquote>` : ''}
    ${evaluated ? html`<dl class="item-evaluation">
      <dt>What is wrong</dt><dd>${evaluated.wrong}</dd>
      <dt>Why</dt><dd>${evaluated.why}</dd>
      <dt>What to change</dt>${evaluated.improve.map((x) => html`<dd>${x}</dd>`)}
    </dl>` : ''}
    ${item.words ? html`<div class="item-raw">${item.text}</div>` : ''}
    ${item.waits ? html`<div class="item-waits">${item.waits}</div>` : ''}
    ${asked?.options.length ? html`<div class="item-options">
      ${asked.options.map((o) => html`<button class="btn"
        onClick=${run(answerOf(asked.id, o))}>${o}</button>`)}</div>` : ''}
    ${field ? html`<label class="field"><span>${field}</span>
      <textarea rows="2" value=${comment}
        onInput=${(e: Event) => setComment((e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea></label>` : ''}
    ${error ? html`<div class="error" role="alert">Refused: ${error}</div>` : ''}
    <div class="item-actions">
      ${ownActs()}
      ${resolves.map((a) => html`<button class="btn primary" disabled=${noComment}
        onClick=${run(resolve(a))}>Resolve</button>`)}
      ${suggests.map((a) => html`<button class="btn" disabled=${noComment}
        onClick=${run(suggest(a))}>Suggest for ${a.name}</button>`)}
      ${gives.map((a) => html`<button class="btn primary"
        onClick=${run(assign(a))}>Assign ${a.role} to ${a.task}</button>`)}
    </div>
    ${terminal.map((a) => html`<div class="item-raw">Or at a terminal: <code>${a.line}</code></div>`)}
  </div>`
}
