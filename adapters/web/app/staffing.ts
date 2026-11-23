import { html } from 'htm/preact'
import { useEffect, useState } from 'preact/hooks'
import {
  MarkerApproval, type OnboardingView, type StaffingPost, StaffingPreview, StaffingState,
  type StaffingView,
} from '../contract.ts'
import { api, postActivation, postStaffing } from './api.ts'
import { Modal } from './modal.ts'

type View = typeof StaffingView.Type
type State = NonNullable<typeof StaffingState.Type>
type Edit = NonNullable<Extract<typeof StaffingPost.Encoded, { action: 'preview' }>['edit']>
type Role = View['arrangement'][number]

const words = (error: unknown) => error instanceof Error ? error.message : String(error)
const joined = (items: ReadonlyArray<string>) => items.join(', ') || 'None'
const editRole = (item: Role): Extract<Edit, { kind: 'role' }> => ({
  kind: 'role', role: item.role, account: item.account, cli: item.cli, model: item.model,
  persistent: item.persistent, concurrency: item.concurrency, subagentAllowance: item.subagentAllowance,
  workerGroup: item.workerGroup,
})

function StaffingDetails({ view, onEdit }: { view: View; onEdit?: ((edit: Edit) => void) | undefined }) {
  return html`<div class="staffing-details">
    <section><h3>Accounts</h3>
      ${view.accounts.length ? view.accounts.map(({ account, limits, roles, sessionLimit }) => html`
        <div class="staffing-account"><strong>${account}</strong><span class="muted">${joined(roles)}</span>
          <p>Session cap: ${sessionLimit === null ? html`<span class="muted">no limit given</span>` : `${sessionLimit} at once (this project only)`}
            ${onEdit ? html`<button class="btn" aria-label=${`Edit ${account} session cap`}
              onClick=${() => onEdit({ kind: 'sessions', account, sessionLimit })}>Edit</button>` : ''}</p>
          ${limits.length ? html`<dl>${limits.map(({ limit, typed }) => html`
            <div><dt>${limit}</dt><dd><span class="staffing-typed">${typed}</span>
              ${onEdit ? html`<button class="btn" aria-label=${`Edit ${account} ${limit}`}
                onClick=${() => onEdit({ kind: 'limit', account, limit, typed })}>Edit</button>` : ''}</dd></div>`)}</dl>`
            : html`<p class="muted">No limits entered.</p>`}</div>`)
        : html`<p class="muted">No accounts configured.</p>`}
    </section>
    <section><h3>Arrangement</h3><div class="staffing-arrangement">
      ${view.arrangement.map((item) => html`<article class="staffing-role">
        <div class="review-card-top"><h4>${item.role}</h4>
          ${onEdit ? html`<button class="btn" aria-label=${`Edit ${item.role}`} onClick=${() => onEdit(editRole(item))}>Edit</button>` : ''}</div>
        <dl class="staffing-fields">
          <dt>Account</dt><dd>${item.account}</dd><dt>CLI</dt><dd>${item.cli}</dd>
          <dt>Effective model</dt><dd>${item.model}</dd><dt>Alternatives</dt><dd>${joined(item.alternatives)}</dd>
          <dt>Session</dt><dd>${item.persistent ? 'Persistent' : 'Disposable'}</dd>
          <dt>Worker</dt><dd>${item.worker === null ? html`<span class="muted">a subagent of its role</span>`
            : (() => { const w = view.workers.find((x) => x.worker === item.worker)
              const others = (w?.roles ?? []).filter((r) => r !== item.role)
              return item.workerGroup === null ? 'its own'
                : others.length ? `group ${item.workerGroup} (with ${others.join(', ')})` : `group ${item.workerGroup}` })()}</dd>
          <dt>Concurrency</dt><dd>${item.concurrency} <span class="muted">(not enforced yet)</span></dd>
          <dt>Subagent allowance</dt><dd>${item.subagentAllowance} <span class="muted">(not enforced yet)</span></dd>
          <dt>Review mode</dt><dd>${item.review}</dd><dt>Context fit</dt><dd>Unknown. ${item.fit.why}.</dd>
        </dl></article>`)}
    </div></section>
    <section><h3>Consequences per limit</h3>
      ${view.consequences.length ? html`<div class="staffing-table-scroll"><table class="staffing-table">
        <thead><tr><th>Account</th><th>Limit</th><th>As entered</th><th>Roles counted</th><th title="one per worker: the engine runs no more">Sessions</th><th>Workload</th></tr></thead>
        <tbody>${view.consequences.map((row) => html`<tr>
          <td>${row.account}</td><th scope="row">${row.limit}</th><td class="staffing-typed">${row.typed}</td>
          <td>${joined(row.roles)}</td><td>${row.peakSessions}</td><td>Unknown. ${row.workload.why}.</td>
        </tr>`)}</tbody></table></div>` : html`<p class="muted">No limits to compare.</p>`}
    </section>
    ${view.warnings.length ? html`<section><h3>Warnings</h3><ul class="staffing-warnings">
      ${view.warnings.map((warning) => html`<li><strong>${warning.role}</strong> · ${warning.says}</li>`)}</ul></section>` : ''}
  </div>`
}

function StaffingEditor({ edit, state, busy, onChange, onPreview }: {
  edit: Edit; state: State; busy: boolean; onChange: (next: Edit) => void; onPreview: () => void
}) {
  const val = (event: Event) => (event.currentTarget as HTMLInputElement).value
  const role = edit.kind === 'role' ? state.view.arrangement.find((row) => row.role === edit.role) : undefined
  const body = () => {
    if (edit.kind === 'limit') {
      return html`<label class="field"><span>Limit as entered</span>
        <textarea required rows="2" value=${edit.typed} onInput=${(event: Event) => onChange({ ...edit, typed: val(event) })} /></label>`
    }
    if (edit.kind === 'sessions') {
      return html`<label class="field"><span>Session cap on ${edit.account}: sessions at once (this project only; empty: no limit)</span>
        <input type="number" min="1" value=${edit.sessionLimit ?? ''}
          onInput=${(event: Event) => onChange({ ...edit, sessionLimit: val(event) === '' ? null : Number(val(event)) })} /></label>`
    }
    return html`
        <label class="field"><span>Account</span><select value=${edit.account}
          onChange=${(event: Event) => onChange({ ...edit, account: val(event) })}>
          ${state.view.accounts.map(({ account }) => html`<option value=${account}>${account}</option>`)}</select></label>
        <label class="field"><span>CLI</span><select value=${edit.cli}
          onChange=${(event: Event) => onChange({ ...edit, cli: val(event) })}>
          ${state.clis.map((cli) => html`<option value=${cli}>${cli}</option>`)}</select></label>
        <label class="field"><span>Effective model</span><select value=${edit.model}
          onChange=${(event: Event) => onChange({ ...edit, model: val(event) })}>
          ${role ? [role.model, ...role.alternatives].map((model) => html`<option value=${model}>${model}</option>`) : ''}
        </select></label>
        <label><input type="checkbox" checked=${edit.persistent}
          onChange=${(event: Event) => {
            const persistent = (event.currentTarget as HTMLInputElement).checked
            // a disposable role runs on no worker: its group goes with it (44b finding 2)
            onChange({ ...edit, persistent, ...(persistent ? {} : { workerGroup: null }) })
          }} />
          Persistent session</label>
        <label class="field"><span>Concurrency (not enforced yet)</span><input type="number" min="1" required value=${edit.concurrency}
          onInput=${(event: Event) => onChange({ ...edit, concurrency: Number(val(event)) })} /></label>
        <label class="field"><span>Subagent allowance (not enforced yet)</span><input type="number" min="0" required value=${edit.subagentAllowance}
          onInput=${(event: Event) => onChange({ ...edit, subagentAllowance: Number(val(event)) })} /></label>
        ${edit.persistent ? html`<label class="field"><span>Worker group (empty: its own worker; the roles of one group share its account, CLI, model and launch)</span>
          <input value=${edit.workerGroup ?? ''}
            onInput=${(event: Event) => onChange({ ...edit, workerGroup: val(event).trim() === '' ? null : val(event).trim() })} /></label>` : ''}`
  }
  return html`<form class="review-detail" onSubmit=${(event: Event) => { event.preventDefault(); onPreview() }}>
    ${body()}
    <div class="modal-foot"><button class="btn primary" disabled=${busy}>Preview changes</button></div>
  </form>`
}

export function Staffing({ start, version, onApplied }: {
  start: (typeof OnboardingView.Type)['start']; version: number; onApplied: () => void
}) {
  const [state, setState] = useState<State | null | undefined>(undefined)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [preview, setPreview] = useState<typeof StaffingPreview.Type | null>(null)
  const [manifest, setManifest] = useState<typeof MarkerApproval.Type | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let current = true
    api('/api/staffing', StaffingState).then((value) => {
      if (current) setState(value)
    }, (err: unknown) => {
      if (current) { setState(null); setError(words(err)) }
    })
    return () => { current = false }
  }, [version])
  const run = async (work: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try { await work() } catch (err) { setError(words(err)) } finally { setBusy(false) }
  }
  const showPreview = (edit?: Edit) => run(async () => {
    if (!state) return
    setPreview(await postStaffing({
      action: 'preview', revision: state.revision, ...(edit ? { edit } : {}),
    }, StaffingPreview))
    setEdit(null)
  })
  const apply = () => run(async () => {
    if (!preview) return
    setState(await postStaffing({ action: 'apply', ticket: preview.ticket }, StaffingState))
    setPreview(null)
    onApplied()
  })
  const begin = () => run(async () => setManifest(await api('/api/activation/approval', MarkerApproval)))
  const activate = () => run(async () => {
    if (!manifest) return
    await postActivation({ action: 'start', entries: manifest.entries })
    setManifest(null)
  })
  const alert = () => error ? html`<p class="error" role="alert">${error}</p>` : ''
  return html`<section class="review-stage" aria-label="Staffing">
    <header class="review-heading"><h2>Staffing</h2></header>
    ${state === undefined ? html`<p role="status">Reading staffing…</p>` : state
      ? html`<${StaffingDetails} view=${state.view} onEdit=${(next: Edit) => { setError(''); setEdit(next) }} />`
      : html`<p>Set up the project’s accounts and role bindings in <code>.work/staffing.yaml</code>.</p>`}
    ${start.state === 'blocked' ? html`<p role="status">${start.says}. ${start.fix}.</p>` : ''}
    ${!edit && !preview && !manifest ? alert() : ''}
    ${state ? html`<footer class="review-footer">
      ${state.confirmed ? html`<span class="muted" role="status">Staffing confirmed</span>
        <button class="btn primary" disabled=${busy || start.state !== 'open'} onClick=${begin}>Review activation</button>`
        : html`<button class="btn primary" disabled=${busy} onClick=${() => showPreview()}>Preview current staffing</button>`}
    </footer>` : ''}
    ${state && edit ? html`<${Modal} title=${edit.kind === 'role' ? `Edit ${edit.role}` : edit.kind === 'sessions' ? `Edit ${edit.account} · session cap` : `Edit ${edit.account} · ${edit.limit}`}
      onClose=${() => { if (!busy) setEdit(null) }}>
      ${alert()}<${StaffingEditor} edit=${edit} state=${state} busy=${busy} onChange=${setEdit}
        onPreview=${() => showPreview(edit)} />
    <//>` : ''}
    ${preview ? html`<${Modal} title="Staffing preview" kind="wide staffing-preview"
      onClose=${() => { if (!busy) setPreview(null) }}>
      ${alert()}
      ${preview.changed.length ? html`<ul>${preview.changed.map((line) => html`<li class="staffing-typed">${line}</li>`)}</ul>`
        : html`<p>No changes to the arrangement or limits.</p>`}
      <div class="staffing-comparison">
        <section aria-label="Before"><h3>Before</h3><${StaffingDetails} view=${preview.before} /></section>
        <section aria-label="After"><h3>After</h3><${StaffingDetails} view=${preview.after} /></section>
      </div>
      <div class="modal-foot"><button class="btn" disabled=${busy} onClick=${() => setPreview(null)}>Cancel</button>
        <button class="btn primary" disabled=${busy} onClick=${apply}>${preview.changed.length ? 'Apply and confirm' : 'Confirm staffing'}</button></div>
    <//>` : ''}
    ${manifest ? html`<${Modal} title="Review activation" onClose=${() => { if (!busy) setManifest(null) }}>
      ${alert()}<p>Instruction files to mark</p>
      ${manifest.entries.length ? html`<ul>${manifest.entries.map(({ path }) => html`<li><code>${path}</code></li>`)}</ul>`
        : html`<p class="muted">No instruction files found.</p>`}
      ${manifest.reported.length ? html`<p>Other instruction sources: ${manifest.reported.join(', ')}.</p>` : ''}
      <div class="modal-foot"><button class="btn" disabled=${busy} onClick=${() => setManifest(null)}>Cancel</button>
        <button class="btn primary" disabled=${busy} onClick=${activate}>Start activation</button></div>
    <//>` : ''}
  </section>`
}
