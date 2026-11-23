import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import type { DashWorker } from '../contract.ts'
import { Modal } from './modal.ts'

const statuses: Record<DashWorker['status'], string> = {
  starting: 'Starting',
  idle: 'Idle',
  'foreground occupied': 'Foreground occupied',
  parked: 'Parked',
  'waiting for capacity': 'Waiting for capacity',
  resuming: 'Resuming',
  stopping: 'Stopping',
  stopped: 'Stopped',
}

const waits: Record<NonNullable<DashWorker['waits']>[number]['reason'], string> = {
  'provider capacity': 'The provider account has no free session slot.',
  'role attempt capacity': 'The role has no free attempt permit.',
  'child capacity': 'The role has no free child permit.',
  'fix capacity': 'The pipeline has no free fix permit.',
  'recheck lane': 'The recheck lane is occupied.',
  'foreground occupied': 'Foreground work is using the worker.',
}

const count = ({ used, limit }: DashWorker['permits']['provider'] | NonNullable<DashWorker['permits']['fixes']>) =>
  limit === null ? String(used) : `${used} / ${limit}`

const memberOf = (worker: DashWorker, actor: string) =>
  worker.identities.find((identity) => identity.actor === actor)?.label ?? actor

function WorkerCard({ worker, onOpen }: { worker: DashWorker; onOpen: () => void }) {
  const { label, status, turn, permits } = worker
  return html`<article class="card worker-card" aria-label=${`Worker ${label}`}>
    <div class="worker-card-head">
      <h3>${label}</h3>
      <span class="worker-state" data-state=${status}>${statuses[status]}</span>
    </div>
    <div class="worker-card-body">
      <div class="worker-profile">${[worker.account, worker.cli, worker.model].filter(Boolean).join(' · ')}</div>
      <ul class="worker-identities" aria-label="Identities">
        ${worker.identities.map(({ actor, label }) => html`<li key=${actor}>${label}</li>`)}
      </ul>
      <dl class="worker-facts">
        <dt>Selected turn</dt><dd>${turn ? html`<strong>${memberOf(worker, turn.actor)}</strong> · ${turn.step}`
          : html`<span class="muted">None</span>`}</dd>
        <dt>Account sessions</dt><dd>${count(permits.provider)}${permits.provider.charged ? ' · slot held' : ''}</dd>
        ${permits.attempts?.map((permit) => html`<dt key=${`attempt-${permit.actor}`}>${memberOf(worker, permit.actor)} attempts</dt><dd>${count(permit)}</dd>`)}
        ${permits.children?.map((permit) => html`<dt key=${`child-${permit.actor}`}>${memberOf(worker, permit.actor)} children</dt><dd>${count(permit)}</dd>`)}
        ${permits.fixes ? html`<dt>Fix permits</dt><dd>${count(permits.fixes)}</dd>` : ''}
        ${permits.rechecks ? html`<dt>Recheck lane</dt><dd>${count(permits.rechecks)}</dd>` : ''}
      </dl>
      ${worker.waits?.length ? html`<ul class="worker-waits" aria-label="Why work waits">
        ${worker.waits.map(({ actor, step, reason }) => html`<li key=${[actor, step, reason].join('/')}>
          ${actor ? html`<strong>${memberOf(worker, actor)}${step ? ` · ${step}` : ''}</strong> ` : ''}${waits[reason]}
        </li>`)}
      </ul>` : ''}
      ${worker.session?.attach ? html`<button class="btn worker-open" onClick=${onOpen}>Open in local tmux</button>` : ''}
    </div>
  </article>`
}

export function Workers({ workers, onOpen }: {
  workers: ReadonlyArray<DashWorker>
  onOpen: (worker: string) => void
}) {
  if (!workers.length) return null
  return html`<section class="workers" aria-label="Workers">
    <h2 class="col-title">Workers</h2>
    <div class="worker-grid">${workers.map((worker) => html`<${WorkerCard} key=${worker.id}
      worker=${worker} onOpen=${() => onOpen(worker.id)} />`)}</div>
  </section>`
}

export function WorkerTerminal({ worker, onClose }: { worker: DashWorker; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)
  const command = worker.session?.attach ?? null
  const copy = async () => {
    if (command === null) return
    try {
      await navigator.clipboard.writeText(command)
      setCopied(command)
    } catch {
      setCopied(null)
    }
  }
  return html`<${Modal} title=${`Terminal of ${worker.label}`} onClose=${onClose}>
    <p class="worker-terminal-state">${statuses[worker.status]}${worker.generation === null ? ''
      : ` · Generation ${worker.generation}`}</p>
    ${command === null ? html`<p>The local terminal is currently unavailable.</p>` : html`
      <p>Run this on the machine hosting the project to attach and type in the worker’s terminal.</p>
      <pre class="worker-attach"><code>${command}</code></pre>
      ${navigator.clipboard ? html`<div class="modal-foot">
        <button class="btn" onClick=${copy}>${copied === command ? 'Copied' : 'Copy command'}</button>
      </div>` : ''}
    `}
  <//>`
}
