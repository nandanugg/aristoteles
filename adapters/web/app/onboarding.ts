// The onboarding pages (rulings 2, 3, 5, 6, 11): before any store, the host drafts into the files
// with work onboard, and the person checks each direction, then each role, here. Each act writes
// the files and stores nothing (ruling 1); approve all roles starts the store with the result.
import { html } from 'htm/preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { type DirView, OnboardingView } from '../contract.ts'
import { RoleGrid } from './agents.ts'
import { api, attempt, type OnboardingActJson, postOnboarding } from './api.ts'
import { DirectionReview, ExampleBlock } from './direction.ts'
import { Inline } from './markdown.ts'

type DirData = typeof DirView.Type
type ViewData = typeof OnboardingView.Type
type Card = ViewData['directions'][number]

// The public example of a company direction (ruling 6): one direction, one standard, one rule.
const EXAMPLE_REPO = 'https://github.com/nandanugg/aristoteles-example-direction'
const STATE_LABEL: Record<Card['state'], string> = {
  loading: 'Loading',
  question: 'Question',
  ready: 'Ready',
  accepted: 'Accepted',
  current: 'Current',
}
const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const text = (e: Event) => (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value

// The confirmation of an approve all: it counts for every item that it names.
interface ConfirmProps {
  readonly title: string
  readonly words: string
  readonly onYes: () => void
  readonly onNo: () => void
}
function Confirm({ title, words, onYes, onNo }: ConfirmProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const back = (e: Event) => e.target === e.currentTarget && onNo()
  return html`<div class="modal-back" onClick=${back}>
    <div class="modal confirm" role="alertdialog" aria-modal="true" aria-label=${title}
      tabindex="-1" ref=${ref}>
      <h2>${title}</h2><p class="prose">${words}</p>
      <div class="modal-foot"><button class="btn" onClick=${onNo}>Cancel</button>
        <button class="btn primary" onClick=${onYes}>Approve</button></div>
    </div>
  </div>`
}

// The next direction that waits for the person, after `id` in the list order and from the top
// again (Nanda, 2026-11-15); none when every other one is accepted.
const nextAfter = (list: ReadonlyArray<Card>, id: string): string | undefined => {
  const at = list.findIndex((d) => d.id === id)
  return [...list.slice(at + 1), ...list.slice(0, Math.max(at, 0))].find(
    (d) => d.state !== 'accepted',
  )?.id
}

// The right column: the direction for its review (its summary, its marked flow, what its words
// changed since the last draft, each rule with the role that the AI proposes to check it, and its
// examples), the questions, and the acts. More examples are a Revise in words. An accept or a remove opens the next direction (onDone).
function Direction({ card, onDone }: { card: Card; onDone: () => void }) {
  const [words, setWords] = useState('')
  // The questions wait for the answers only while the direction shows Question (O4).
  const open = card.state === 'question' ? card.questions : []
  const [chosen, setChosen] = useState<ReadonlyArray<'A' | 'B' | undefined>>([])
  const act = (fn: () => OnboardingActJson, done = false) =>
    attempt(async () => {
      const out = await postOnboarding(fn())
      setWords('')
      if (done) onDone()
      return out
    })
  const submit = act(() => {
    const options = open.map((_, i) => chosen[i] ?? 'A')
    const [first, ...rest] = options
    return { act: 'answer', direction: card.id, options: [first ?? 'A', ...rest] }
  })
  const empty = !words.trim()
  const drafted = card.says !== null
  const questions = card.questions.map((q, i) => {
    const n = open.indexOf(q)
    return html`<fieldset class="question" aria-label=${`question ${i + 1}`}>
      <legend><${Inline} text=${q.says} /></legend>
      <ul class="examples"><${ExampleBlock} e=${q.example} /></ul>
      ${(['A', 'B'] as const).map((o, k) => html`<label class="option">
        <input type="radio" name=${`${card.id}-q${i}`} disabled=${n < 0}
          checked=${n < 0 ? q.answer === o : chosen[n] === o}
          onChange=${() => setChosen((c) => Object.assign([...c], { [n]: o }))} />
        <span>${o}: ${q.options[k]}</span></label>`)}
    </fieldset>`
  })
  return html`<article class="direction-page" aria-label=${card.name}>
    <div class="direction-head"><h2>${card.name}</h2>
      <span class=${`chip ${card.state}`}>${STATE_LABEL[card.state]}</span></div>
    <div class="muted"><code>${card.id}</code> · ${card.origin}</div>
    ${card.principle ? html`<p><strong>The principle:</strong> ${card.principle}</p>` : ''}
    ${card.example ? html`<p><strong>An example:</strong> ${card.example}</p>` : ''}
    ${card.state === 'loading' ? html`<p class="waits">${card.reset
      ? `${card.id} is not in the current shape: the host drafts it again`
      : `The host drafts it${card.request ? `, from your words: "${card.request}"` : ''}`}.</p>`
      : ''}
    <div class="direction-body">
      <${DirectionReview} card=${card} />
      ${questions.length ? html`<div class="section-title">Questions of the AI</div>` : ''}
      ${questions}
      ${open.length ? html`<button class="btn primary"
        disabled=${open.some((_, n) => !chosen[n])} onClick=${submit}>Submit the answers</button>`
        : ''}
    </div>
    <label class="field"><span>What to change (Revise needs words; Accept needs none)</span>
      <textarea rows="3" value=${words} onInput=${(e: Event) => setWords(text(e))}></textarea>
    </label>
    <div class="item-actions">
      <button class="btn primary" disabled=${card.state !== 'ready' || !empty}
        onClick=${act(() => ({ act: 'accept', direction: card.id }), true)}>Accept</button>
      <button class="btn" disabled=${!drafted || empty}
        onClick=${act(() => ({ act: 'revise', direction: card.id, words }))}>Revise</button>
      <button class="btn" onClick=${act(() => ({ act: 'remove', direction: card.id }), true)}>
        Remove</button>
    </div>
  </article>`
}

// Add new direction (ruling 5): the principle is required, an example is not.
function AddNew({ onAdded }: { onAdded: (id: string) => void }) {
  const [principle, setPrinciple] = useState('')
  const [example, setExample] = useState('')
  const add = attempt(async () => {
    const out = await postOnboarding({
      act: 'add-direction',
      principle,
      ...(example.trim() ? { example } : {}),
    })
    onAdded(out.out?.split(':')[0] ?? '')
    return out
  })
  return html`<form class="add-form" aria-label="Add new direction"
    onSubmit=${(e: Event) => e.preventDefault()}>
    <h2>Add new direction</h2>
    <p class="muted">Say the idea of the direction in your words. The AI drafts it with examples
      from the project; it shows Loading until then.</p>
    <label class="field"><span>The principle (required)</span>
      <textarea rows="2" value=${principle} onInput=${(e: Event) => setPrinciple(text(e))}>
      </textarea></label>
    <label class="field"><span>An example (optional)</span>
      <textarea rows="2" value=${example} onInput=${(e: Event) => setExample(text(e))}>
      </textarea></label>
    <button class="btn primary" disabled=${!principle.trim()} onClick=${add}>Add</button>
  </form>`
}

// Add a company direction (ruling 6): a git repo and the folder of one direction in it.
function AddCompany({ onAdded }: { onAdded: (id: string) => void }) {
  const [repo, setRepo] = useState('')
  const [path, setPath] = useState('')
  const add = attempt(async () => {
    const out = await postOnboarding({ act: 'add-company-direction', repo, path })
    onAdded(out.out?.split(':')[0] ?? '')
    return out
  })
  return html`<form class="add-form" aria-label="Add a company direction"
    onSubmit=${(e: Event) => e.preventDefault()}>
    <h2>Add a company direction</h2>
    <p class="muted">A company keeps its directions in a git repo, one folder each. See the
      example: <a href=${EXAMPLE_REPO} target="_blank" rel="noreferrer">${EXAMPLE_REPO}</a>
      (one direction, one standard, one rule).</p>
    <label class="field"><span>The git repo</span>
      <input value=${repo} onInput=${(e: Event) => setRepo(text(e))} /></label>
    <label class="field"><span>The folder of the direction in the repo</span>
      <input value=${path} onInput=${(e: Event) => setPath(text(e))} /></label>
    <button class="btn primary" disabled=${!repo.trim() || !path.trim()} onClick=${add}>Add</button>
  </form>`
}

type Open = { readonly _tag: 'Direction'; readonly id: string | null } | { readonly _tag: 'Add' }
  | { readonly _tag: 'Company' }

// The directions page: the list with a state each at the left, the open one at the right. The
// AI drafts in parallel, so the person opens any ready one (ruling 3).
function Directions({ view, onAgents }: { view: ViewData; onAgents: () => void }) {
  const [open, setOpen] = useState<Open>({ _tag: 'Direction', id: null })
  const [confirm, setConfirm] = useState(false)
  const ready = view.directions.filter((d) => d.state === 'ready')
  const card =
    open._tag === 'Direction'
      ? (view.directions.find((d) => d.id === open.id) ?? view.directions[0])
      : undefined
  const added = (id: string) => setOpen({ _tag: 'Direction', id })
  const approve = attempt(async () => {
    setConfirm(false)
    return postOnboarding({ act: 'approve-all-directions' })
  })
  const done = view.directions.every((d) => d.state === 'accepted')
  return html`<div class="onboarding-cols">
    <nav class="direction-list" aria-label="Directions">
      ${view.directions.map((d) => html`<button class="direction-item"
        aria-current=${d.id === card?.id ? 'true' : undefined}
        onClick=${() => setOpen({ _tag: 'Direction', id: d.id })}>
        <span class="title">${d.name}</span>
        <span class=${`chip ${d.state}`}>${STATE_LABEL[d.state]}</span></button>`)}
      <button class="btn wide" onClick=${() => setOpen({ _tag: 'Add' })}>Add new direction</button>
      <button class="btn wide" onClick=${() => setOpen({ _tag: 'Company' })}>
        Add a company direction</button>
      <button class="btn primary wide" disabled=${ready.length === 0}
        onClick=${() => setConfirm(true)}>Approve all</button>
    </nav>
    <section class="direction-open">
      ${done && view.directions.length ? html`<div class="next-step"><span>Every direction is
        accepted or removed.</span><button class="btn primary" onClick=${onAgents}>Next: the
        agents</button></div>` : ''}
      ${open._tag === 'Add' ? html`<${AddNew} onAdded=${added} />`
        : open._tag === 'Company' ? html`<${AddCompany} onAdded=${added} />`
        : card ? html`<${Direction} key=${card.id} card=${card} onDone=${() => {
            const next = nextAfter(view.directions, card.id)
            if (next) setOpen({ _tag: 'Direction', id: next })
          }} />`
        : html`<p class="muted">The host reads the project and drafts its directions; each one
          shows here when it starts.</p>`}
    </section>
    ${confirm ? html`<${Confirm} title="Approve all directions"
      words=${`Approve all accepts each ready direction: ${ready.map((d) => d.name).join(', ')}.`}
      onYes=${approve} onNo=${() => setConfirm(false)} />` : ''}
  </div>`
}

// The agents page (ruling 11): a card for each role, the roles that the project has first. A
// persistent role gets a terminal of its own; a disposable role runs as a subagent of a terminal.
function Agents({ view }: { view: ViewData }) {
  const [confirm, setConfirm] = useState(false)
  const toggle = attempt((role: string, persistent: boolean) =>
    postOnboarding({ act: 'persistence', role, persistent }),
  )
  const acts = {
    accept: (role: string) => attempt(() => postOnboarding({ act: 'accept-role', role }))(),
    revise: (role: string, words: string) =>
      attempt(() => postOnboarding({ act: 'revise-role', role, words }))(),
    remove: (role: string) => attempt(() => postOnboarding({ act: 'remove-role', role }))(),
  }
  const start = attempt(async () => {
    setConfirm(false)
    return postOnboarding({ act: 'approve-all-roles' })
  })
  const directions = view.directions.map((d) => d.name).join(', ') || 'none'
  const roles = view.roles.map((r) => r.role).join(', ')
  return html`<div class="agents-page">
    <p class="muted">A persistent role gets a terminal of its own, for the whole project; a
      disposable role runs as a subagent of a terminal. The role of the top task stays persistent.
      Open a card to accept, revise, or remove the role.</p>
    ${view.roles.length ? html`<${RoleGrid} roles=${view.roles} onToggle=${toggle} acts=${acts} />`
      : html`<p class="muted">The host has not drafted the roles yet.</p>`}
    <div class="item-actions"><button class="btn primary" disabled=${view.start.state !== 'open'}
      onClick=${() => setConfirm(true)}>Approve all</button></div>
    ${confirm ? html`<${Confirm} title="Approve all roles and start the store"
      words=${`The store starts with the directions ${directions}, and the roles ${roles}; ` +
        'the onboarding files go. Each role must be accepted first.'}
      onYes=${start} onNo=${() => setConfirm(false)} />` : ''}
  </div>`
}

// What blocks the store start, and who fixes it (O1): the line of work onboard status.
function StartBlocked({ start }: { start: ViewData['start'] }) {
  if (start.state !== 'blocked') return html``
  return html`<div class="start-blocked" role="status">
    <strong>The store cannot start:</strong> ${start.says}. Next: ${start.fix}.</div>`
}

type Step = 'directions' | 'agents'
export function Onboarding({ dir, version }: { dir: DirData; version: number }) {
  const [view, setView] = useState<ViewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('directions')
  useEffect(() => {
    api('/api/onboarding', OnboardingView)
      .then((v) => {
        setView(v)
        setError(null)
      })
      .catch((e) => setError(errorText(e)))
  }, [version])
  if (error) {
    return html`<div class="empty"><h2>The onboarding files do not read</h2>
      <p class="error">${error}</p></div>`
  }
  if (!view) return html`<div></div>`
  // The agents page opens when every direction is accepted or removed (ruling 3).
  const agentsOpen = view.directions.every((d) => d.state === 'accepted')
  const now: Step = step === 'agents' && agentsOpen ? 'agents' : 'directions'
  const stepTab = (s: Step, label: string, disabled = false) => html`<button class="tab"
    role="tab" aria-selected=${s === now} disabled=${disabled} onClick=${() => setStep(s)}>
    ${label}</button>`
  return html`<div class="onboarding">
    <div class="canvas-head"><h1>Onboarding of ${dir.name}</h1></div>
    <div class="tabs steps" role="tablist">
      ${stepTab('directions', '1. Directions')}${stepTab('agents', '2. Agents', !agentsOpen)}
    </div>
    <${StartBlocked} start=${view.start} />
    ${now === 'agents' ? html`<${Agents} view=${view} />`
      : html`<${Directions} view=${view} onAgents=${() => setStep('agents')} />`}
  </div>`
}
