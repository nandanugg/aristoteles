// The directions of the sidebar: a card for each, the modal with its standards and rules as a
// timeline, and the editor, which sends AskEdit (the items the person wrote).
import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import type { Dash } from '../contract.ts'
import type { ActView } from './api.ts'
import { useSubmission } from './submission.ts'
import type { Act } from './board.ts'
import { Modal } from './modal.ts'

type Direction = Dash['directions'][number]
type Standard = Direction['standards'][number]
type Rec = Direction['rec']

interface CardProps {
  d: Direction
  onOpen: (edit: boolean) => void
}
export function DirectionCard({ d, onOpen }: CardProps) {
  const more = d.standards.length > d.first.length
  return html`<section class="card direction-card" aria-label=${`Direction ${d.name}`}
    tabindex="0" onClick=${() => onOpen(false)}
    onKeyDown=${(e: KeyboardEvent) => e.key === 'Enter' && onOpen(false)}>
    <div class="card-head"><span class="dname">${d.name}</span>
      <span class="tags">v${d.version}</span></div>
    <div class="card-body">
      <div class="principles">${d.principles.map((p) => html`<span class="uses-tag">${p}</span>`)}
      </div>
      <p class="desc">${d.summary}</p>
      <ul class="firsts">${d.first.map((n) => html`<li>${n}</li>`)}</ul>
      ${more ? html`<span class="muted">more...</span>` : ''}
      <button class="btn small" aria-label=${`Edit ${d.name}`}
        onClick=${(e: Event) => {
          e.stopPropagation()
          onOpen(true)
        }}>Edit</button>
    </div>
  </section>`
}

function StandardView({ s }: { s: Standard }) {
  const [rules, setRules] = useState(false)
  return html`<section class="standard" aria-label=${`Standard ${s.name}`}>
    <div class="change-title">${s.name} <span class="muted">v${s.version}</span></div>
    <p class="desc">${s.summary}</p>
    <button class="btn small" aria-expanded=${rules}
      onClick=${() => setRules(!rules)}>${rules ? 'hide rules' : 'show rules'}</button>
    ${rules ? html`<ol class="rule-line">${s.rules.map((r) => html`<li key=${r.key}>
      <strong>${r.name}</strong> <span class="muted">v${r.version} · evidence ${r.form}</span>
      <div>${r.says}</div></li>`)}</ol>` : ''}
  </section>`
}

// The words the person edits, by item key. An item left as it is is not sent.
type Edited = Record<string, Partial<Pick<NonNullable<Rec>, 'says' | 'test' | 'ref'>>>

const edit = (rec: Rec, e: Edited[string] | undefined): Rec => ({ ...rec, ...e })

const Field = (p: {
  label: string
  value: string
  area?: boolean
  onInput: (v: string) => void
}) => html`<div class="field"><label>${p.label}
  ${p.area
    ? html`<textarea value=${p.value}
        onInput=${(e: Event) => p.onInput((e.target as HTMLTextAreaElement).value)}></textarea>`
    : html`<input value=${p.value}
        onInput=${(e: Event) => p.onInput((e.target as HTMLInputElement).value)} />`}</label></div>`

interface EditorProps {
  d: Direction
  onAct: Act
  view: ActView
  onClose: () => void
}
function Editor({ d, onAct, view, onClose }: EditorProps) {
  const [edited, setEdited] = useState<Edited>({})
  const { submit, busy, words } = useSubmission(onAct, view)
  const set = (key: string, field: 'says' | 'test' | 'ref', v: string) =>
    setEdited({
      ...edited,
      [key]: { ...edited[key], [field]: field === 'says' || v !== '' ? v : null },
    })
  const items: ReadonlyArray<readonly [string, Rec]> = [
    [d.key, d.rec],
    ...d.standards.flatMap((s) => [
      [s.key, s.rec] as const,
      ...s.rules.map((r) => [r.key, r.rec] as const),
    ]),
  ]
  const draft = items.flatMap(([key, rec]) => {
    const next = edit(rec, edited[key])
    return JSON.stringify(next) === JSON.stringify(rec) ? [] : [[key, next] as const]
  })
  const send = async () => {
    const items = draft.some(([key]) => key === d.key) ? draft : [[d.key, d.rec] as const, ...draft]
    if (await submit({ _tag: 'AskEdit', draft: items })) onClose()
  }
  const says = (key: string, rec: Rec) => edited[key]?.says ?? rec.says
  return html`<div class="editor">
    <p class="muted">Your edit goes into the task pipeline: it takes effect after the pipeline
      and your review, not at once.</p>
    <${Field} label="Direction says" area=${true} value=${says(d.key, d.rec)}
      onInput=${(v: string) => set(d.key, 'says', v)} />
    ${d.standards.map((s) => html`<section class="standard" key=${s.key}>
      <${Field} label=${`Standard ${s.name} says`} area=${true} value=${says(s.key, s.rec)}
        onInput=${(v: string) => set(s.key, 'says', v)} />
      ${s.rules.map((r) => html`<div class="rule-edit" key=${r.key}>
        <${Field} label=${`Rule ${r.name} says`} area=${true} value=${says(r.key, r.rec)}
          onInput=${(v: string) => set(r.key, 'says', v)} />
        <${Field} label=${`Rule ${r.name} test`} value=${edited[r.key]?.test ?? r.rec.test ?? ''}
          onInput=${(v: string) => set(r.key, 'test', v)} />
        <${Field} label=${`Rule ${r.name} ref`} value=${edited[r.key]?.ref ?? r.rec.ref ?? ''}
          onInput=${(v: string) => set(r.key, 'ref', v)} /></div>`)}
    </section>`)}
    ${words ? html`<div class="error" role="alert">${words}</div>` : ''}
    <div class="modal-foot"><button class="btn primary" disabled=${busy || draft.length === 0}
      onClick=${send}>Send the edit to the pipeline</button></div>
  </div>`
}

interface ModalProps {
  d: Direction
  editing: boolean
  onAct: Act
  view: ActView
  onClose: () => void
}
export function DirectionModal({ d, editing, onAct, view, onClose }: ModalProps) {
  const [edit, setEdit] = useState(editing)
  return html`<${Modal} title=${`${d.name} v${d.version}`} kind="wide" onClose=${onClose}>
    <div class="principles">${d.principles.map((p) => html`<span class="uses-tag">${p}</span>`)}
    </div>
    <p class="direction-summary">${d.summary}</p>
    ${edit
      ? html`<${Editor} d=${d} onAct=${onAct} view=${view} onClose=${onClose} />`
      : html`<button class="btn small" onClick=${() => setEdit(true)}>Edit</button>
        ${d.examples.length ? html`<div class="section-title">Examples</div>
          <ul class="examples">${d.examples.map((x) => html`<li class=${`example ${x.fits}`}>
            <span class=${`fit-tag ${x.fits}`}>${x.fits}</span> ${x.sample}</li>`)}</ul>` : ''}
        <div class="section-title">Standards</div>
        ${d.standards.map((s) => html`<${StandardView} key=${s.key} s=${s} />`)}`}
  <//>`
}
