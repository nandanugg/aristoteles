import { html } from 'htm/preact'
import { useEffect, useState } from 'preact/hooks'
import { type DirView, OnboardingView } from '../contract.ts'
import { AiToast } from './ai.ts'
import { api, attempt, postOnboarding } from './api.ts'
import { Modal } from './modal.ts'
import { directionLabel, DirectionModal, ReviewInput } from './onboarding-review.ts'
import { Roles } from './onboarding-roles.ts'
import { Staffing } from './staffing.ts'

type View = typeof OnboardingView.Type
type Dir = typeof DirView.Type
type Step = 'directions' | 'roles' | 'staffing'

function AddDirection({ onDone }: { onDone: () => void }) {
  const [company, setCompany] = useState(false)
  const [repo, setRepo] = useState('')
  const [path, setPath] = useState('')
  const [saving, setSaving] = useState(false)
  const addPrompt = attempt(async (principle: string) => {
    const response = await postOnboarding({ act: 'add-direction', principle })
    onDone()
    return response
  })
  const addCompany = attempt(async () => {
    setSaving(true)
    try {
      const response = await postOnboarding({ act: 'add-company-direction', repo: repo.trim(), path: path.trim() })
      onDone()
      return response
    } finally { setSaving(false) }
  })
  return html`<div class="review-detail">
    <div class="review-add-types" aria-label="Direction source">
      <button class="btn" aria-pressed=${!company} onClick=${() => setCompany(false)}>Write a prompt</button>
      <button class="btn" aria-pressed=${company} onClick=${() => setCompany(true)}>Use a repository URL</button>
    </div>
    ${company ? html`<form class="review-detail" onSubmit=${(event: Event) => { event.preventDefault(); void addCompany() }}>
      <label class="field"><span>Repository URL</span><input type="url" required value=${repo}
        onInput=${(e: Event) => setRepo((e.currentTarget as HTMLInputElement).value)} /></label>
      <label class="field"><span>Direction folder in the repository</span><input required value=${path}
        onInput=${(e: Event) => setPath((e.currentTarget as HTMLInputElement).value)} /></label>
      <button class="btn primary" disabled=${saving || !repo.trim() || !path.trim()}>Add direction</button>
    </form>` : html`<${ReviewInput} label="What direction should the project follow?"
      action="Add direction" onSubmit=${addPrompt} />`}
  </div>`
}

function Directions({ view, project, refresh, onRoles }: {
  view: View; project: string; refresh: () => void; onRoles: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [reviewed, setReviewed] = useState<ReadonlyArray<{ id: string; revision: string }> | null>(null)
  const [saving, setSaving] = useState(false)
  const selectedCard = view.directions.find((card) => card.id === selected)
  const ready = view.directions.filter((card) => card.state === 'ready')
  const blocked = !ready.length || view.directions.some((card) =>
    card.state !== 'ready' && card.state !== 'accepted' || card.state === 'ready' && !card.revision)
  const complete = view.directions.length > 0 && view.directions.every((card) => card.state === 'accepted')
  const discovery = view.discovery
  const accept = attempt(async () => {
    setSaving(true)
    try {
      if (!reviewed) return
      const response = await postOnboarding({ act: 'approve-all-directions', reviewed })
      setReviewed(null)
      refresh()
      onRoles()
      return response
    } finally { setSaving(false) }
  })
  return html`<section class="review-stage" aria-label="Directions">
    <header class="review-heading"><div><h2>Review the directions</h2>
      ${view.directions.length ? html`<p>Review the draft directions for this repository.</p>` : ''}</div>
      <button class="btn" onClick=${() => setAdding(true)}>Add direction</button>
    </header>
    ${discovery ? html`<section class="review-discovery" aria-label="Project summary">
      <h3>About ${project}</h3><p>${discovery.summary}</p>
      <div class="review-pair"><div><h3>Sources read</h3>
        ${discovery.read.length ? html`<ul>${discovery.read.map((source) => html`<li><code>${source}</code></li>`)}</ul>`
          : html`<p class="muted">No sources reported.</p>`}</div>
        <div><h3>Areas not searched</h3>
        ${discovery.notSearched.length ? html`<ul>${discovery.notSearched.map((area) => html`<li>${area}</li>`)}</ul>`
          : html`<p class="muted">No areas reported.</p>`}</div></div>
      ${discovery.app === false ? html`<p role="status">This repository has no app yet. An intake step will ask what to build.</p>` : ''}
    </section>` : ''}
    ${!view.directions.length ? html`<div class="review-empty" role="status">
      <span>${discovery ? 'Please wait while the host drafts directions for this repository…'
        : 'Analyzing your project directory…'}</span>
      <div class="review-progress" aria-hidden="true"></div></div>` : ''}
    ${view.directions.length ? html`<div class="review-grid">
      ${view.directions.map((card) => {
        const state = directionLabel(card)
        const title = card.state === 'loading' && card.why === 'drafting' ? 'Assessing new direction…' : card.name
        const summary = card.state === 'question' ? card.open[0]?.says : 'draft' in card ? card.draft.summary : card.name
        return html`<button class="review-card" data-state=${state} onClick=${() => setSelected(card.id)}>
          <span class="review-card-top"><span class="chip review-state" data-state=${state}>${state}</span></span>
          <strong>${title}</strong>${summary && summary !== title ? html`<span class="review-description">${summary}</span>` : ''}
          ${card.state === 'loading' ? html`<span class="review-progress" role="progressbar" aria-label=${state}></span>` : ''}
        </button>`
      })}
    </div>` : ''}
    <div hidden data-slot="onboarding-suggestions"></div>
    ${view.directions.length ? html`<footer class="review-footer">
      ${complete ? html`<button class="btn primary" onClick=${onRoles}>Continue to roles</button>`
        : html`<button class="btn primary" disabled=${blocked} onClick=${() => setReviewed(ready.map(({ id, revision }) => ({ id, revision: revision! })))}>Accept all</button>`}
    </footer>` : ''}
    ${selectedCard ? html`<${DirectionModal} key=${`${selectedCard.id}-${selectedCard.revision}`} card=${selectedCard}
      onClose=${() => { setSelected(null); refresh() }} />` : ''}
    ${adding ? html`<${Modal} title="Add direction" onClose=${() => setAdding(false)}>
      <${AddDirection} onDone=${() => { setAdding(false); refresh() }} />
    <//>` : ''}
    ${reviewed ? html`<${Modal} title="Accept all directions" onClose=${() => setReviewed(null)}>
      <p>Accept the reviewed drafts and continue to roles.</p>
      <div class="modal-foot"><button class="btn" onClick=${() => setReviewed(null)}>Cancel</button>
        <button class="btn primary" disabled=${saving || blocked} onClick=${accept}>Accept all</button></div>
    <//>` : ''}
  </section>`
}

export function Onboarding({ dir, version }: { dir: Dir; version: number }) {
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('directions')
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision((n) => n + 1)
  useEffect(() => {
    let current = true
    api('/api/onboarding', OnboardingView).then((data) => {
      if (!current) return
      setView(data)
      setError(null)
    }, (reason: unknown) => {
      if (current) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { current = false }
  }, [version, revision])
  const rolesOpen = view !== null && view.directions.length > 0 &&
    view.directions.every((card) => card.state === 'accepted')
  const staffingOpen = rolesOpen && view.roles.length > 0 && !view.roleRequests?.length &&
    view.roles.every((role) => role.state === 'accepted' && !role.questions?.length && !role.request)
  const active = step === 'staffing' && staffingOpen ? 'staffing' : step !== 'directions' && rolesOpen ? 'roles' : 'directions'
  const tab = (id: Step, label: string, disabled = false) => html`<button class="tab" role="tab"
    aria-selected=${active === id} disabled=${disabled} onClick=${() => setStep(id)}>${label}</button>`
  return html`<div class="onboarding review-shell">
    <header class="canvas-head"><h1>Set up ${dir.name}</h1></header>
    <div class="tabs steps" role="tablist" aria-label="Onboarding steps">
      ${tab('directions', 'Directions')}${tab('roles', 'Roles', !rolesOpen)}${tab('staffing', 'Staffing', !staffingOpen)}
    </div>
    ${error ? html`<p class="error" role="alert">${error}</p>`
      : !view ? html`<p class="muted" role="status">Reading onboarding…</p>`
      : active === 'roles' ? html`<${Roles} view=${view} onRefresh=${refresh} onStaffing=${() => setStep('staffing')} />`
      : active === 'staffing' ? html`<${Staffing} start=${view.start} version=${version} onApplied=${refresh} />`
      : html`<${Directions} view=${view} project=${dir.name} refresh=${refresh} onRoles=${() => setStep('roles')} />`}
    <${AiToast} toast=${dir.toast} />
  </div>`
}
