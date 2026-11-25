import { html } from 'htm/preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { launchExecutable, type StaffArrangement } from '../../../src/domain/staffing-sketch.ts'
import { MarkerApproval, type OnboardingView, StaffingState } from '../contract.ts'
import { api, postActivation, postStaffing } from './api.ts'
import { Modal } from './modal.ts'

type State = typeof StaffingState.Type
type Staff = StaffArrangement['staff'][number]
type Plan = State['plans'][number]

const value = (event: Event) => (event.currentTarget as HTMLInputElement).value
const words = (error: unknown) => error instanceof Error ? error.message : String(error)
const labelOf = (plan: Plan) => `${plan.provider} ${plan.name}`

const accountsOf = (state: State, draft: StaffArrangement) =>
  [...state.accounts, ...draft.subscriptions.map((s) => ({ ...s, clis: [] }))].map((account) => {
    const plan = state.plans.find(({ id }) => id === account.plan)
    return { ...account, clis: plan ? [plan.cli] : account.clis, plan }
  })

function placement(state: State, accounts: ReturnType<typeof accountsOf>, staff: Staff) {
  const cli = state.launchClis.find(({ command }) => command === launchExecutable(staff.launch))?.cli
  const options = cli ? accounts.filter(({ clis }) => clis.includes(cli)) : []
  const account = options.length === 1 ? options[0] : options.find((a) => a.account === staff.account)
  return { cli, options, account }
}

function projectShare(state: State, models: readonly string[], active: number, plan: Plan): number | null {
  const usage = state.usage
  if (!usage || active === 0) return null
  const factor = (name: string) => state.modelCosts.find(({ model }) => name === model)?.factor
  const base = factor(usage.model)
  let relative = 0
  for (const model of models) {
    if (!model.trim()) return null
    const cost = factor(model)
    if (model === usage.model) relative += 1
    else if (base && cost) relative += cost / base
    else return null
  }
  return 100 * (usage.tokens / active) * relative / (plan.monthlyTokens / state.estimate.windows)
}

function Cost({ state, draft, onAdd }: { state: State; draft: StaffArrangement; onAdd: () => void }) {
  const accounts = accountsOf(state, draft)
  const active = draft.staff.filter(({ id }) => draft.assignments.some(({ staff }) => staff === id))
  const allocated = active.map((staff) => ({ model: staff.model, account: placement(state, accounts, staff).account?.account }))
  const subscribed = accounts.filter(({ plan }) => plan !== undefined)
  return html`<section class="staffing-cost" aria-label="Cost per one project">
    <div class="staffing-cost-head"><h3>Cost per one project</h3>
      <button class="btn" onClick=${onAdd}>Add subscription</button>
    </div>
    ${subscribed.length ? subscribed.map(({ account, plan }) => {
      if (!plan) return ''
      const models = allocated.filter((staff) => staff.account === account).map(({ model }) => model)
      const share = projectShare(state, models, active.length, plan)
      const caption = !state.usage ? 'unknown until the first project is measured'
        : allocated.some(({ account }) => account === undefined) ? 'unknown until staff have subscriptions'
        : models.length === 0 ? 'No staff assigned'
        : share === null ? 'unknown for the models on this subscription'
        : `${share > 0 && share < 0.1 ? '<0.1' : Number(share.toFixed(1))}%`
      return html`<div class="staffing-cost-row" key=${account}>
        <div><strong>${labelOf(plan)}</strong> <span class="muted">$${plan.price} · 5-hour limit</span>
          ${account === plan.id ? '' : html`<small class="staffing-cost-account">${account}</small>`}</div>
        <div class="staffing-cost-share">
          <div class="staffing-meter" aria-hidden="true"><span style=${{ width: `${Math.min(100, share ?? 0)}%` }}></span></div>
          <small>${caption}</small>
        </div>
      </div>`
    }) : html`<p class="muted">No subscriptions added.</p>`}
    ${subscribed.length ? html`<small class="staffing-estimate muted">
      ${state.estimate.windows} five-hour windows per 30-day month. The estimate splits measured project tokens equally
      across assigned staff and scales each share by model cost.
      <span class="staffing-sources"><a href=${state.estimate.source} target="_blank" rel="noreferrer">Plan volumes</a>
      · <a href="https://artificialanalysis.ai/models" target="_blank" rel="noreferrer">Model costs</a></span>
    </small>` : ''}
  </section>`
}

function Subscription({ state, onAdd, onClose }: {
  state: State; onAdd: (plan: Plan) => void; onClose: () => void
}) {
  const providers = [...new Set(state.plans.map(({ provider }) => provider))]
  const [provider, setProvider] = useState(providers[0] ?? '')
  const [choice, setChoice] = useState('')
  const plans = state.plans.filter((p) => p.provider === provider)
  const selected = plans.find(({ id }) => id === choice) ?? plans[0]
  return html`<${Modal} title="Add subscription" onClose=${onClose}>
    <form onSubmit=${(event: Event) => { event.preventDefault(); if (selected) onAdd(selected) }}>
      <label class="field"><span>Provider</span><select value=${provider} onChange=${(event: Event) => setProvider(value(event))}>
        ${providers.map((name) => html`<option value=${name} key=${name}>${name}</option>`)}
      </select></label>
      <label class="field"><span>Plan</span><select value=${selected?.id ?? ''} onChange=${(event: Event) => setChoice(value(event))}>
        ${plans.map((plan) => html`<option value=${plan.id} key=${plan.id}>${plan.name} · $${plan.price}/month</option>`)}
      </select></label>
      <div class="modal-foot"><button type="button" class="btn" onClick=${onClose}>Cancel</button>
        <button class="btn primary" disabled=${!selected}>Add subscription</button></div>
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
  const [lines, setLines] = useState<readonly { role: string; d: string }[]>([])
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
        return [{ role, d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}` }]
      })
      setLines(next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(graph)
    for (const box of graph.querySelectorAll('[data-staff-role], [data-staff-card]')) observer.observe(box)
    return () => observer.disconnect()
  }, [draft, state.roles])
  const accounts = accountsOf(state, draft)
  return html`<div class="staffing-graph" ref=${root}>
    <svg class="staffing-arrows" aria-hidden="true">
      <defs><marker id="staffing-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
        <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
      </marker></defs>
      ${lines.map(({ role, d }) => html`<path key=${role} data-arrow-role=${role} d=${d}
        fill="none" stroke="currentColor" stroke-width="1.5" marker-end="url(#staffing-arrow)" />`)}
    </svg>
    ${draft.staff.map((staff) => {
      const roles = draft.assignments.filter((assignment) => assignment.staff === staff.id)
      const assigns = new Set(roles.flatMap(({ role }) => state.roles.find((r) => r.role === role)?.assigns ?? []))
      const makers = state.roles.filter((role) => !role.persistent && assigns.has(role.role))
      const { cli, options, account } = placement(state, accounts, staff)
      return html`<div class="staffing-pair" key=${staff.id}>
        <div class="staffing-roles">
          ${roles.map(({ role }) => html`<div class="staffing-role-box" key=${role} data-staff-role=${role}>
            <strong>${role}</strong>
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
              ${option.plan ? `${labelOf(option.plan)} · ${option.account}` : option.account}</option>`)}
          </select></label>` : account ? html`<small class="muted">${account.plan ? labelOf(account.plan) : account.account}</small>`
            : cli ? html`<small class="muted">Add a subscription for ${cli}.</small>` : ''}
          <div class="staffing-allowance">
            <button class="btn" aria-label=${`Decrease allowed subagents for ${staff.id}`} disabled=${busy || staff.allowance === 0}
              onClick=${() => edit(staff.id, { allowance: staff.allowance - 1 })}>−</button>
            <output aria-label=${`Allowed subagents for ${staff.id}`}>${staff.allowance}</output>
            <button class="btn" aria-label=${`Increase allowed subagents for ${staff.id}`} disabled=${busy}
              onClick=${() => edit(staff.id, { allowance: staff.allowance + 1 })}>+</button>
            <span>allowed subagents</span>
          </div>
          ${makers.length ? html`<ul class="staffing-makers">
            ${makers.map(({ role }) => html`<li key=${role}>${role} <small class="muted">· Subagent</small></li>`)}
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
  const [manifest, setManifest] = useState<typeof MarkerApproval.Type | null>(null)
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
  const addSubscription = (plan: Plan) => {
    change((draft, state) => {
      const accounts = accountsOf(state, draft)
      let account = plan.id
      for (let i = 2; accounts.some((entry) => entry.account === account); i++) account = `${plan.id}-${i}`
      return { ...draft, subscriptions: [...draft.subscriptions, { account, plan: plan.id }] }
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
  const begin = () => run(async () => setManifest(await api('/api/activation/approval', MarkerApproval)))
  const activate = () => run(async () => {
    if (!manifest) return
    await postActivation({ action: 'start', entries: manifest.entries })
    setManifest(null)
  })
  const alert = () => error ? html`<p class="error" role="alert">${error}</p>` : ''
  const state = review?.state
  const draft = review?.draft
  const confirmed = Boolean(state?.confirmed && state.arrangement === draft)
  const consultWaiting = state?.consult?.reply === null
  return html`<section class="review-stage staffing-stage" aria-label="Staffing">
    <header class="review-heading"><h2>Staffing</h2></header>
    ${!state || !draft ? error ? '' : html`<p role="status">Reading staffing…</p>` : html`
      <${Cost} state=${state} draft=${draft} onAdd=${() => setSubscription(true)} />
      ${state.source === 'proposal' ? html`<p class="staffing-proposal muted">Host’s proposed arrangement</p>` : ''}
      <${Graph} state=${state} draft=${draft} busy=${busy} move=${move} edit=${edit} remove=${setRemoving} />
      <div class="staffing-new"><button class="btn" disabled=${busy} onClick=${addStaff}>New staff</button></div>
      ${state.consult ? html`<div class="staffing-consult-status" role="status">
        <p><strong>Consult</strong> ${state.consult.words}</p>
        <p>${state.consult.reply ?? 'Waiting for the host to reply.'}</p>
      </div>` : ''}
      ${!manifest ? error ? alert() : state.source === 'saved' && start.state === 'blocked'
        ? html`<p class="error" role="status">${start.says}</p>` : '' : ''}
      <div class="staffing-actions">
        <textarea rows="2" aria-label="Staffing question" placeholder="Ask the host about staffing" value=${question}
          disabled=${busy || consultWaiting} onInput=${(event: Event) => setQuestion(value(event))}></textarea>
        <button class="btn" disabled=${busy || consultWaiting || !question.trim()} onClick=${consult}>Consult</button>
        ${confirmed ? html`<button class="btn primary" disabled=${busy || start.state !== 'open'}
           onClick=${begin}>Review activation</button>` : html`
          <button class="btn primary" disabled=${busy} onClick=${accept}>Accept all</button>`}
      </div>
      ${confirmed ? html`<p class="staffing-saved muted" role="status">Staffing confirmed
        ${saved ? html` · Saved to <code>.work/staffing.yaml</code>` : ''}</p>` : ''}
    `}
    ${state && draft && subscription ? html`<${Subscription} state=${state}
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
    ${manifest ? html`<${Modal} title="Review activation" onClose=${() => { if (!busy) setManifest(null) }}>
      ${alert()}<p>Instruction files to mark</p>
      ${manifest.entries.length ? html`<ul>${manifest.entries.map(({ path }) => html`<li><code>${path}</code></li>`)}</ul>`
        : html`<p class="muted">No instruction files found.</p>`}
      ${manifest.reported.length ? html`<p>Other instruction sources: ${manifest.reported.join(', ')}.</p>` : ''}
      <div class="modal-foot"><button class="btn" disabled=${busy} onClick=${() => setManifest(null)}>Cancel</button>
        <button class="btn primary" disabled=${busy} onClick=${activate}>Start activation</button></div>
    <//>` : ''}
    ${error && !state ? alert() : ''}
  </section>`
}
