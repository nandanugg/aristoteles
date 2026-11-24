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
type Edit = Extract<typeof StaffingPost.Encoded, { action: 'arrange' }>['edits'][number]
type Role = View['arrangement'][number]

const words = (error: unknown) => error instanceof Error ? error.message : String(error)
const joined = (items: ReadonlyArray<string>) => items.join(', ') || 'None'
const editRole = (item: Role): Extract<Edit, { kind: 'role' }> => ({
  kind: 'role', role: item.role, account: item.account, cli: item.cli, model: item.model,
  persistent: item.persistent, concurrency: item.concurrency, subagentAllowance: item.subagentAllowance,
  workerGroup: item.workerGroup, launch: item.launch,
  allowedModels: item.model ? [item.model, ...item.alternatives] : [],
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
        ${item.account ? html`<dl class="staffing-fields">
          <dt>Account</dt><dd>${item.account}</dd><dt>CLI</dt><dd>${item.cli}</dd>
          <dt>Effective model</dt><dd>${item.model}</dd><dt>Alternatives</dt><dd>${joined(item.alternatives)}</dd>
          <dt>Session</dt><dd>${item.persistent ? 'Persistent' : 'Disposable'}</dd>
          <dt>Worker</dt><dd>${item.worker === null ? html`<span class="muted">a subagent of its role</span>`
            : (() => { const w = view.workers.find((x) => x.worker === item.worker)
              const others = (w?.roles ?? []).filter((r) => r !== item.role)
              return item.workerGroup === null ? 'its own'
                : others.length ? `group ${item.workerGroup} (with ${others.join(', ')})` : `group ${item.workerGroup}` })()}</dd>
          <dt>Concurrency</dt><dd>${item.concurrency}</dd>
          <dt>Subagent allowance</dt><dd>${item.subagentAllowance}</dd>
          <dt>Launch command</dt><dd><code>${item.launch}</code></dd>
          <dt>Review mode</dt><dd>${item.review}</dd><dt>Context fit</dt><dd>Unknown. ${item.fit.why}.</dd>
        </dl>` : html`<p class="muted">Unassigned</p>`}</article>`)}
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

function WorkerPlacement({ title, workers }: { title: string; workers: View['workers'] }) {
  return html`<section class="staffing-placement" aria-label=${title}>
    <h3>${title}</h3>
    ${workers.length ? html`<ul>${workers.map(({ worker, roles, account, shared }) => html`
      <li key=${worker}>
        <strong>${worker.replace(/^(?:group|role):/, '')}</strong>
        <span>${shared ? 'Group' : 'Private'} · ${account}</span>
        <span>${joined(roles)}</span>
      </li>`
    )}</ul>` : html`<p class="muted">No persistent workers.</p>`}
  </section>`
}

const editTitle = (edit: Edit) => {
  switch (edit.kind) {
    case 'add-account': return 'Add account'
    case 'add-cli': return 'Add CLI'
    case 'add-model': return 'Add model'
    case 'role': return `Edit ${edit.role}`
    case 'sessions': return `Edit ${edit.account} · session cap`
    case 'limit': return `Edit ${edit.account} · ${edit.limit}`
  }
}

const value = (event: Event) => (event.currentTarget as HTMLInputElement).value
const checked = (event: Event) => (event.currentTarget as HTMLInputElement).checked
const capOf = (event: Event) => value(event) === '' ? null : Number(value(event))

function StaffingEditor({ edit, state, busy, onChange, onSubmit }: {
  edit: Edit; state: State; busy: boolean; onChange: (next: Edit) => void; onSubmit: () => void
}) {
  const sessionCap = (cap: number | null, change: (cap: number | null) => void) => html`
    <label class="field"><span>Session cap (empty means no limit)</span>
      <input type="number" min="1" value=${cap ?? ''} onInput=${(event: Event) => change(capOf(event))} /></label>`
  const body = () => {
    switch (edit.kind) {
      case 'limit':
        return html`<label class="field"><span>Limit as entered</span>
          <textarea required rows="2" value=${edit.typed} onInput=${(event: Event) => onChange({ ...edit, typed: value(event) })} /></label>`
      case 'sessions':
        return sessionCap(edit.sessionLimit, (sessionLimit) => onChange({ ...edit, sessionLimit }))
      case 'add-account':
        return html`<label class="field"><span>Account name</span><input required value=${edit.account}
          onInput=${(event: Event) => onChange({ ...edit, account: value(event) })} /></label>
          ${sessionCap(edit.sessionLimit, (sessionLimit) => onChange({ ...edit, sessionLimit }))}
          ${edit.limits.map((row, index) => {
            const update = (part: Partial<typeof row>) => onChange({ ...edit,
              limits: edit.limits.map((item, i) => i === index ? { ...item, ...part } : item) })
            return html`<div class="staffing-limit-entry">
              <label class="field"><span>Limit name</span><input required value=${row.limit}
                onInput=${(event: Event) => update({ limit: value(event) })} /></label>
              <label class="field"><span>Limit as entered</span><input required value=${row.typed}
                onInput=${(event: Event) => update({ typed: value(event) })} /></label>
              <button type="button" class="btn" onClick=${() => onChange({ ...edit,
                limits: edit.limits.filter((_, i) => i !== index) })}>Remove limit</button>
            </div>`
          })}
          <div><button type="button" class="btn" onClick=${() => onChange({ ...edit,
            limits: [...edit.limits, { limit: '', typed: '' }] })}>Add limit</button></div>`
      case 'add-cli':
        return html`<label class="field"><span>CLI name</span><input required value=${edit.cli}
          onInput=${(event: Event) => onChange({ ...edit, cli: value(event) })} /></label>
          <label><input type="checkbox" checked=${edit.backgroundChildren}
            onChange=${(event: Event) => onChange({ ...edit, backgroundChildren: checked(event) })} /> Background children</label>
          <label><input type="checkbox" checked=${edit.canPark}
            onChange=${(event: Event) => onChange({ ...edit, canPark: checked(event) })} /> Can park and resume sessions</label>`
      case 'add-model':
        return html`<label class="field"><span>Model name</span><input required value=${edit.model}
          onInput=${(event: Event) => onChange({ ...edit, model: value(event) })} /></label>
          <label class="field"><span>Launch command</span><input required value=${edit.launch}
            onInput=${(event: Event) => onChange({ ...edit, launch: value(event) })} /></label>
          <label class="field"><span>Resume command (optional)</span><input value=${edit.resume ?? ''}
            onInput=${(event: Event) => onChange({ ...edit, resume: value(event) || null })} /></label>`
      case 'role': {
        const allowed = edit.allowedModels ?? []
        const setModel = (model: string) => {
          const defaultLaunch = (name: string) => state.models.find((item) => item.model === name)?.launch
          const launch = !edit.launch || edit.launch === defaultLaunch(edit.model) ? defaultLaunch(model) ?? '' : edit.launch
          onChange({ ...edit, model, launch, allowedModels: allowed.length ? allowed : [model] })
        }
        return html`
          <label class="field"><span>Account</span><select aria-label="Account" required value=${edit.account}
            onChange=${(event: Event) => onChange({ ...edit, account: value(event) })}>
            <option value="">Choose an account</option>
            ${state.view.accounts.map(({ account }) => html`<option value=${account}>${account}</option>`)}</select></label>
          <label class="field"><span>CLI</span><select aria-label="CLI" required value=${edit.cli}
            onChange=${(event: Event) => onChange({ ...edit, cli: value(event) })}>
            <option value="">Choose a CLI</option>
            ${state.clis.map((cli) => html`<option value=${cli}>${cli}</option>`)}</select></label>
          <fieldset class="staffing-model-options"><legend>Allowed models</legend>
            ${state.models.map(({ model }) => html`<label><input type="checkbox" checked=${allowed.includes(model)}
              onChange=${(event: Event) => {
                const next = checked(event) ? [...allowed, model] : allowed.filter((name) => name !== model)
                onChange({ ...edit, allowedModels: next, model: next.includes(edit.model) ? edit.model : '' })
              }} /> ${model}</label>`)}
          </fieldset>
          <label class="field"><span>Effective model</span><select required value=${edit.model}
            onChange=${(event: Event) => setModel(value(event))}>
            <option value="">Choose a model</option>
            ${(allowed.length ? allowed : state.models.map(({ model }) => model)).map((model) => html`<option value=${model}>${model}</option>`)}
          </select></label>
          <label class="field"><span>Launch command</span><input required value=${edit.launch ?? ''}
            onInput=${(event: Event) => onChange({ ...edit, launch: value(event) })} /></label>
          <label><input type="checkbox" checked=${edit.persistent}
            onChange=${(event: Event) => {
              const persistent = checked(event)
              onChange({ ...edit, persistent, ...(persistent ? {} : { workerGroup: null }) })
            }} /> Persistent session</label>
          <label class="field"><span>Concurrency</span><input type="number" min="1" required value=${edit.concurrency}
            onInput=${(event: Event) => onChange({ ...edit, concurrency: Number(value(event)) })} /></label>
          <label class="field"><span>Subagent allowance</span><input type="number" min="0" required value=${edit.subagentAllowance}
            onInput=${(event: Event) => onChange({ ...edit, subagentAllowance: Number(value(event)) })} /></label>
          ${edit.persistent ? html`<div><label class="field"><span>Worker group</span>
            <input value=${edit.workerGroup ?? ''}
              onInput=${(event: Event) => onChange({ ...edit, workerGroup: value(event).trim() || null })} />
            </label><small>Roles in a group share an account, CLI, model and launch command.</small></div>` : ''}`
      }
    }
  }
  return html`<form class="review-detail staffing-editor" onSubmit=${(event: Event) => { event.preventDefault(); onSubmit() }}>
    ${body()}
    <div class="modal-foot"><button class="btn primary" disabled=${busy}>
      ${state.source === 'saved' ? 'Preview changes' : 'Keep in draft'}</button></div>
  </form>`
}

function StaffingCatalog({ state, onEdit }: { state: State; onEdit: (edit: Edit) => void }) {
  return html`<div class="staffing-catalog">
    <div><button class="btn" onClick=${() => onEdit({ kind: 'add-account', account: '', limits: [], sessionLimit: null })}>Add account</button></div>
    <div><button class="btn" onClick=${() => onEdit({ kind: 'add-cli', cli: '', backgroundChildren: false, canPark: false })}>Add CLI</button>
      <span class="muted">${state.clis.length ? state.clis.join(', ') : ''}</span></div>
    <div><button class="btn" onClick=${() => onEdit({ kind: 'add-model', model: '', launch: '', resume: null })}>Add model</button>
      <span class="muted">${state.models.map(({ model }) => model).join(', ')}</span></div>
  </div>`
}

export function Staffing({ start, version, onApplied }: {
  start: (typeof OnboardingView.Type)['start']; version: number; onApplied: () => void
}) {
  const [{ state, edits, replaced }, setReview] = useState<{
    state: State | null | undefined; edits: readonly Edit[]; replaced: boolean
  }>({ state: undefined, edits: [], replaced: false })
  const [saved, setSaved] = useState(false)
  const [edit, setEdit] = useState<Edit | null>(null)
  const [preview, setPreview] = useState<typeof StaffingPreview.Type | null>(null)
  const [manifest, setManifest] = useState<typeof MarkerApproval.Type | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let current = true
    api('/api/staffing', StaffingState).then((value) => {
      if (!current) return
      setReview((latest) => {
        if (latest.state?.revision === value.revision) {
          return latest.edits.length ? latest : { ...latest, state: value }
        }
        return { state: value, edits: [], replaced: latest.edits.length > 0 }
      })
    }, (err: unknown) => {
      if (!current) return
      setReview((latest) => latest.state === undefined ? { ...latest, state: null } : latest)
      setError(words(err))
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
      action: 'preview', revision: state.revision, edits: edit ? [edit] : edits,
    }, StaffingPreview))
    setEdit(null)
  })
  const editStaffing = (next: Edit) => {
    setError('')
    setReview((latest) => ({ ...latest, replaced: false }))
    setEdit(next)
  }
  const stageEdit = (next: Edit) => run(async () => {
    if (!state) return
    const staged = [...edits, next]
    const candidate = await postStaffing({ action: 'arrange', revision: state.revision, edits: staged }, StaffingState)
    setReview((latest) => latest.state?.revision === candidate.revision
      ? { state: candidate, edits: staged, replaced: false } : latest)
    setEdit(null)
  })
  const apply = () => run(async () => {
    if (!preview) return
    const applied = await postStaffing({ action: 'apply', ticket: preview.ticket }, StaffingState)
    setReview({ state: applied, edits: [], replaced: false })
    setPreview(null)
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
  return html`<section class="review-stage" aria-label="Staffing">
    <header class="review-heading"><h2>Staffing</h2></header>
    ${state === undefined ? html`<p role="status">Reading staffing…</p>` : state ? html`
      ${state.source === 'proposal' ? html`<p role="status">Review the host’s proposed arrangement.</p>`
        : state.source === 'empty' ? html`<p role="status">Add an account, CLI and model, then arrange each agent role.</p>`
          : start.state === 'blocked' ? html`<p role="status">${start.says}</p>` : ''}
      <${StaffingCatalog} state=${state} onEdit=${editStaffing} />
      <${StaffingDetails} view=${state.view} onEdit=${editStaffing} />` : ''}
    ${replaced ? html`<p role="alert">Staffing changed. Review the latest arrangement before continuing.</p>` : ''}
    ${!edit && !preview && !manifest ? alert() : ''}
    ${state ? html`<footer class="review-footer">
      ${state.confirmed ? html`<span class="muted" role="status">Staffing confirmed</span>
        ${saved ? html`<small>Saved to <code>.work/staffing.yaml</code></small>` : ''}
        <button class="btn primary" disabled=${busy || start.state !== 'open'} onClick=${begin}>Review activation</button>`
        : html`<button class="btn primary" disabled=${busy || state.view.arrangement.some((row) => !row.account)}
          onClick=${() => showPreview()}>${state.source === 'saved' ? 'Preview current staffing' : 'Preview staffing'}</button>`}
    </footer>` : ''}
    ${state && edit ? html`<${Modal} title=${editTitle(edit)} onClose=${() => { if (!busy) setEdit(null) }}>
      ${alert()}<${StaffingEditor} edit=${edit} state=${state} busy=${busy} onChange=${setEdit}
        onSubmit=${() => state.source === 'saved' ? showPreview(edit) : stageEdit(edit)} />
    <//>` : ''}
    ${preview ? html`<${Modal} title="Staffing preview" kind="wide staffing-preview"
      onClose=${() => { if (!busy) setPreview(null) }}>
      ${alert()}
      ${preview.blocked ? html`<p class="error" role="status">${preview.blocked}</p>` : ''}
      ${preview.changed.length ? html`<ul>${preview.changed.map((line) => html`<li class="staffing-typed">${line}</li>`)}</ul>`
        : html`<p>No changes to the arrangement or limits.</p>`}
      <div class="staffing-placement-comparison">
        <${WorkerPlacement} title="Current worker placement" workers=${preview.before.workers} />
        <${WorkerPlacement} title="Proposed worker placement" workers=${preview.after.workers} />
      </div>
      <div class="staffing-comparison">
        <section aria-label="Before"><h3>Before</h3><${StaffingDetails} view=${preview.before} /></section>
        <section aria-label="After"><h3>After</h3><${StaffingDetails} view=${preview.after} /></section>
      </div>
      <div class="modal-foot"><button class="btn" disabled=${busy} onClick=${() => setPreview(null)}>Cancel</button>
        <button class="btn primary" disabled=${busy || Boolean(preview.blocked)} onClick=${apply}>${preview.changed.length ? 'Apply and confirm' : 'Confirm staffing'}</button></div>
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
