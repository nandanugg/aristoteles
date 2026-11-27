import { html } from 'htm/preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { cliOfProvider, launchExecutable, type StaffArrangement, type Subscription, type SubscriptionProvider } from '../../../src/domain/staffing-sketch.ts'
import { type OnboardingView, StaffingState } from '../contract.ts'
import { api, postStaffing } from './api.ts'
import { Modal } from './modal.ts'

type State = typeof StaffingState.Type
type Staff = StaffArrangement['staff'][number]
const value = (event: Event) => (event.currentTarget as HTMLInputElement).value
const words = (error: unknown) => error instanceof Error ? error.message : String(error)
const labelOf = (subscription: Subscription) => `${subscription.provider} ${subscription.plan} · ${subscription.account}`

function placement(subscriptions: StaffArrangement['subscriptions'], staff: Staff) {
  const cli = launchExecutable(staff.launch)
  const options = subscriptions.filter(({ provider }) => cliOfProvider(provider) === cli)
  const account = options.length === 1 ? options[0] : options.find((a) => a.account === staff.account)
  return { options, account }
}

function Cost({ draft, onAdd }: { draft: StaffArrangement; onAdd: () => void }) {
  return html`<section class="staffing-cost" aria-label="Cost per one project">
    <div class="staffing-cost-head"><h3>Cost per one project</h3>
      <button class="btn" onClick=${onAdd}>Add subscription</button>
    </div>
    ${draft.subscriptions.length ? draft.subscriptions.map((subscription) => {
      const { account, estimate } = subscription
      const percent = estimate === undefined ? 0 : estimate.share * 100
      return html`<div class="staffing-cost-row" key=${account} data-subscription=${account}>
        <strong>${labelOf(subscription)}</strong>
        ${estimate === undefined ? html`<small class="muted">No estimate</small>` : html`
          <div class="staffing-cost-share">
            <div class="staffing-meter" role="meter" aria-label=${labelOf(subscription)}
              aria-valuemin="0" aria-valuemax="100" aria-valuenow=${Math.min(100, percent)}
              aria-valuetext=${`${percent.toLocaleString(undefined, { maximumFractionDigits: 2 })}% of one 5-hour window`}>
              <span style=${{ width: `${Math.min(100, percent)}%` }}></span>
            </div>
            <small><strong>${percent.toLocaleString(undefined, { maximumFractionDigits: 2 })}% of one 5-hour window</strong>
              · ${estimate.basis}</small>
          </div>`}
      </div>`
    }) : html`<p class="muted">No subscriptions added.</p>`}
  </section>`
}

function SubscriptionForm({ onAdd, onClose }: {
  onAdd: (provider: SubscriptionProvider, plan: string) => void; onClose: () => void
}) {
  const [provider, setProvider] = useState<SubscriptionProvider>('Claude')
  const [plan, setPlan] = useState('')
  return html`<${Modal} title="Add subscription" onClose=${onClose}>
    <form onSubmit=${(event: Event) => { event.preventDefault(); if (plan.trim()) onAdd(provider, plan.trim()) }}>
      <label class="field"><span>Provider</span><select value=${provider}
        onChange=${(event: Event) => setProvider(value(event) === 'Claude' ? 'Claude' : 'ChatGPT')}>
        <option>Claude</option><option>ChatGPT</option>
      </select></label>
      <label class="field"><span>Plan</span><input required value=${plan} onInput=${(event: Event) => setPlan(value(event))} /></label>
      <div class="modal-foot"><button type="button" class="btn" onClick=${onClose}>Cancel</button>
        <button class="btn primary" disabled=${!plan.trim()}>Add subscription</button></div>
    </form>
  <//>`
}

function Graph({ state, draft, busy, move, edit, remove }: {
  state: State; draft: StaffArrangement; busy: boolean
  move: (role: string, to: string) => void
  edit: (id: string, patch: Partial<Staff>) => void
  remove: (id: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<readonly { role: string; d: string; x: number; y: number }[]>([])
  useLayoutEffect(() => {
    const graph = root.current
    if (!graph) return
    const measure = () => {
      const frame = graph.getBoundingClientRect()
      if (!frame.width) return
      const boxes = new Map([...graph.querySelectorAll<HTMLElement>('[data-staff-role]')]
        .map((box) => [box.dataset.staffRole, box.getBoundingClientRect()]))
      const cards = new Map([...graph.querySelectorAll<HTMLElement>('[data-staff-card]')]
        .map((card) => [card.dataset.staffCard, card.getBoundingClientRect()]))
      const next = draft.assignments.flatMap(({ role, staff }) => {
        const start = boxes.get(role)
        const end = cards.get(staff)
        if (!start || !end || start.right >= end.left) return []
        const x1 = start.right - frame.left
        const y1 = start.top + start.height / 2 - frame.top
        const x2 = end.left - frame.left - 5
        const y2 = Math.min(end.bottom - 16, Math.max(end.top + 16, start.top + start.height / 2)) - frame.top
        const mid = (x1 + x2) / 2
        return [{ role, x: mid, y: (y1 + y2) / 2, d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}` }]
      })
      setLines(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(graph)
    for (const box of graph.querySelectorAll('[data-staff-role], [data-staff-card]')) observer.observe(box)
    return () => observer.disconnect()
  }, [draft, state.roles])
  const routeLabel = new Map(state.roles.map(({ role, program, persistent }) =>
    [role, program ? 'as program' : persistent ? '' : 'as subagent']))
  return html`<div class="staffing-graph" ref=${root}>
    <svg class="staffing-arrows" aria-hidden="true">
      <defs><marker id="staffing-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
      </marker></defs>
      ${lines.map(({ role, d, x, y }) => html`<g key=${role}>
        <path data-arrow-role=${role} d=${d}
          fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#staffing-arrow)" />
        ${routeLabel.get(role) ? html`<text data-arrow-label=${role} x=${x} y=${y - 6} text-anchor="middle">
          ${routeLabel.get(role)}</text>` : ''}
      </g>`)}
    </svg>
    ${draft.staff.map((staff) => {
      const roles = draft.assignments.filter((assignment) => assignment.staff === staff.id)
      const { options, account } = placement(draft.subscriptions, staff)
      return html`<div class="staffing-pair" key=${staff.id}>
        <div class="staffing-roles">
          ${roles.map(({ role }) => html`<div class="staffing-role-box" key=${role} data-staff-role=${role}>
            <strong>${role}</strong>
            ${routeLabel.get(role) ? html`<span class="staffing-route-label">${routeLabel.get(role)}</span>` : ''}
            <label><span>Staff</span><select aria-label=${`Staff for ${role}`} value=${staff.id} disabled=${busy}
              onChange=${(event: Event) => move(role, value(event))}>
              ${draft.staff.map(({ id }) => html`<option value=${id} key=${id}>${id}</option>`)}
            </select></label>
          </div>`)}
        </div>
        <article class="staffing-card" data-staff-card=${staff.id} aria-label=${`Staff ${staff.id}`}>
          <div class="staffing-card-head"><h3>${staff.id}</h3>
            ${roles.length ? '' : html`<button class="btn" disabled=${busy} aria-label=${`Remove ${staff.id}`}
              onClick=${() => remove(staff.id)}>Remove</button>`}
          </div>
          <label class="field"><span>Model</span><input value=${staff.model} placeholder="Model name" disabled=${busy}
            onInput=${(event: Event) => edit(staff.id, { model: value(event) })} /></label>
          <label class="field"><span>Launch command</span><input class="staffing-launch" value=${staff.launch}
            placeholder="Command with {session}" disabled=${busy}
            onInput=${(event: Event) => edit(staff.id, { launch: value(event) })} /></label>
          ${options.length > 1 ? html`<label class="field"><span>Subscription</span><select
            value=${account?.account ?? ''} disabled=${busy} onChange=${(event: Event) => edit(staff.id, { account: value(event) })}>
            <option value="" disabled>Choose a subscription</option>
            ${options.map((option) => html`<option key=${option.account} value=${option.account}>
              ${labelOf(option)}</option>`)}
          </select></label>` : account ? html`<small class="muted">${labelOf(account)}</small>`
            : staff.launch.trim() ? html`<small class="muted">Add a subscription matching this launch command.</small>` : ''}
          <div class="staffing-allowance">
            <button class="btn" aria-label=${`Decrease allowed subagents for ${staff.id}`} disabled=${busy || staff.allowance === 0}
              onClick=${() => edit(staff.id, { allowance: staff.allowance - 1 })}>−</button>
            <output aria-label=${`Allowed subagents for ${staff.id}`}>${staff.allowance}</output>
            <button class="btn" aria-label=${`Increase allowed subagents for ${staff.id}`} disabled=${busy}
              onClick=${() => edit(staff.id, { allowance: staff.allowance + 1 })}>+</button>
            <span>allowed subagents</span>
          </div>
          ${roles.length ? html`<ul class="staffing-card-roles" aria-label="Assigned roles">
            ${roles.map(({ role }) => html`<li key=${role}>${role}</li>`)}
          </ul>` : ''}
        </article>
      </div>`
    })}
  </div>`
}

export function Staffing({ start, version, onApplied }: {
  start: (typeof OnboardingView.Type)['start']; version: number; onApplied: () => void
}) {
  const [review, setReview] = useState<{ state: State; draft: StaffArrangement }>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [question, setQuestion] = useState('')
  const [subscription, setSubscription] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const autoAllowance = useRef(new Set<string>())
  const read = (state: State) => setReview((latest) => {
    if (latest?.state.revision === state.revision) {
      return { state, draft: latest.draft === latest.state.arrangement ? state.arrangement : latest.draft }
    }
    autoAllowance.current.clear()
    return { state, draft: state.consult?.arrangement ?? state.arrangement }
  })
  useEffect(() => {
    let current = true
    api('/api/staffing', StaffingState).then((state) => {
      if (current) {
        read(state)
        setError('')
      }
    }, (err: unknown) => {
      if (current) setError(words(err))
    })
    return () => { current = false }
  }, [version])

  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try { await work() } catch (err) { setError(words(err)) } finally { setBusy(false) }
  }
  const change = (transform: (draft: StaffArrangement, state: State) => StaffArrangement) => {
    setError('')
    setReview((latest) => latest && { ...latest, draft: transform(latest.draft, latest.state) })
  }
  const addStaff = () => change((draft) => {
    let next = 1
    while (draft.staff.some(({ id }) => id === `staff-${next}`)) next++
    const id = `staff-${next}`
    autoAllowance.current.add(id)
    return { ...draft, staff: [...draft.staff, { id, model: '', launch: '', allowance: 0, account: null }] }
  })
  const move = (role: string, target: string) => change((draft, state) => {
    const assignments = draft.assignments.map((row) => row.role === role ? { role, staff: target } : row)
    const staff = draft.staff.map((card) => autoAllowance.current.has(card.id)
      ? { ...card, allowance: Math.max(0, ...assignments.filter((row) => row.staff === card.id)
        .map((row) => state.roles.find((entry) => entry.role === row.role)?.allowance ?? 0)) } : card)
    return { ...draft, assignments, staff }
  })
  const edit = (id: string, patch: Partial<Staff>) => {
    if (patch.allowance !== undefined) autoAllowance.current.delete(id)
    change((draft) => ({ ...draft, staff: draft.staff.map((card) => card.id === id ? { ...card, ...patch } : card) }))
  }
  const addSubscription = (provider: SubscriptionProvider, plan: string) => {
    change((draft) => {
      const base = `${provider}-${plan}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
      let account = base
      for (let i = 2; draft.subscriptions.some((entry) => entry.account === account); i++) account = `${base}-${i}`
      return { ...draft, subscriptions: [...draft.subscriptions, { account, provider, plan }] }
    })
    setSubscription(false)
  }
  const consult = () => run(async () => {
    if (!review || !question.trim()) return
    const { state, draft } = review
    read(await postStaffing({ action: 'consult', revision: state.revision, arrangement: draft, words: question }, StaffingState))
    setQuestion('')
  })
  const accept = () => run(async () => {
    if (!review) return
    const { state, draft } = review
    const applied = await postStaffing({ action: 'accept', revision: state.revision, arrangement: draft }, StaffingState)
    autoAllowance.current.clear()
    setReview({ state: applied, draft: applied.arrangement })
    setSaved(true)
    onApplied()
  })
  const alert = () => error ? html`<p class="error" role="alert">${error}</p>` : ''
  const state = review?.state
  const draft = review?.draft
  const confirmed = Boolean(state?.confirmed && state.explicitAssignments && state.arrangement === draft)
  const consultWaiting = state?.consult?.reply === null
  return html`<section class="review-stage staffing-stage" aria-label="Staffing">
    <header class="review-heading"><h2>Staffing</h2></header>
    ${!state || !draft ? error ? '' : html`<p role="status">Reading staffing…</p>` : html`
      <${Cost} draft=${draft} onAdd=${() => setSubscription(true)} />
      ${state.source === 'proposal' ? html`<p class="staffing-proposal muted">Host’s proposed arrangement</p>` : ''}
      <${Graph} state=${state} draft=${draft} busy=${busy} move=${move} edit=${edit} remove=${setRemoving} />
      <div class="staffing-new"><button class="btn" disabled=${busy} onClick=${addStaff}>New staff</button></div>
      ${state.consult ? html`<div class="staffing-consult-status" role="status">
        <p><strong>Consult</strong> ${state.consult.words}</p>
        <p>${state.consult.reply ?? 'Waiting for the host to reply.'}</p>
      </div>` : ''}
      ${error ? alert() : state.source === 'saved' && start.state === 'blocked'
        ? html`<p class="error" role="status">${start.says}</p>` : ''}
      <div class="staffing-actions">
        <textarea rows="2" aria-label="Staffing question" placeholder="Ask the host about staffing" value=${question}
          disabled=${busy || consultWaiting} onInput=${(event: Event) => setQuestion(value(event))}></textarea>
        <button class="btn" disabled=${busy || consultWaiting || !question.trim()} onClick=${consult}>Consult</button>
        ${!confirmed ? html`<button class="btn primary" disabled=${busy} onClick=${accept}>Accept all</button>` : ''}
      </div>
      ${confirmed ? html`<p class="staffing-saved muted" role="status">Staffing confirmed
        ${saved ? html` · Saved to <code>.work/staffing.yaml</code>` : ''}</p>` : ''}
    `}
    ${state && draft && subscription ? html`<${SubscriptionForm}
      onAdd=${addSubscription} onClose=${() => setSubscription(false)} />` : ''}
    ${removing ? html`<${Modal} title="Remove empty staff?" onClose=${() => setRemoving(null)}>
      <p>${removing} has no assigned roles.</p>
      <div class="modal-foot">
        <button class="btn" onClick=${() => setRemoving(null)}>Cancel</button>
        <button class="btn primary" onClick=${() => {
          change((current) => current.assignments.some(({ staff }) => staff === removing) ? current
            : { ...current, staff: current.staff.filter(({ id }) => id !== removing) })
          autoAllowance.current.delete(removing)
          setRemoving(null)
        }}>Remove staff</button>
      </div>
    <//>` : ''}
    ${error && !state ? alert() : ''}
  </section>`
}

export { StaffingView } from './project-staffing.ts'
