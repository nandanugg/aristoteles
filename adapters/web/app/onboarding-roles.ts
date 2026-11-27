import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import type { OnboardingView } from '../contract.ts'
import { attempt, postOnboarding } from './api.ts'
import { Modal } from './modal.ts'
import { DirectionModal, ReviewInput } from './onboarding-review.ts'

type View = typeof OnboardingView.Type
type Role = View['roles'][number]
const QUESTIONS: Readonly<Record<string, string>> = {
  Logos: 'Can we explain the requirement and its reasoning?',
  Pathos: 'Can the human understand the work, the result, and the trade-offs?',
  Ethos: 'Which tests and checks support this result?',
  Mythos: 'Do our code patterns still fit the company direction?',
  Oikos: 'How does the team work, review, and argue together?',
  Nomos: 'Which policies and ways of working control the action?',
  Telos: 'Which purpose has the human accepted, and should it change?',
  Kairos: 'Can the work pause and continue in another session or model?',
  'Mnēmē': 'Which past attempts and lessons must we keep, with their evidence?',
  Topoi: 'How can a later task find past lessons, and see if they changed?',
  Aporia: 'Which questions are not answered, and which decisions need the answers?',
}

function Tags({ role, interactive = false }: { role: Role; interactive?: boolean }) {
  if (!role.principles?.length) return null
  return html`<div class="review-tags">${role.principles.map((name) => interactive
    ? html`<details class="principle-tag"><summary class="chip" title=${QUESTIONS[name]}>${name}</summary>
      <p>${QUESTIONS[name]}</p></details>`
    : html`<span class="chip" title=${QUESTIONS[name]}>${name}</span>`)}</div>`
}

const roleLabel = (role: Role) => role.builtIn === 'host' ? 'Host'
  : role.builtIn === 'pipeline' ? 'Pipeline role' : role.role

function RoleModal({ role, directions, onClose }: {
  role: Role; directions: View['directions']; onClose: () => void
}) {
  const [direction, setDirection] = useState<string | null>(null)
  const card = directions.find((d) => d.id === direction)
  const open = role.request === null ? role.questions ?? [] : []
  const revise = attempt(async (words: string) => {
    const response = await postOnboarding({ act: 'revise-role', role: role.role, words })
    onClose()
    return response
  })
  if (card) return html`<${DirectionModal} key=${card.id} card=${card} readOnly
    onClose=${() => setDirection(null)} />`
  const links = directions.filter((d) => role.directions?.includes(d.id) ||
    ('draft' in d && d.draft?.standards.some((s) => s.rules.some((r) => r.checkedBy === role.role))))
  return html`<${Modal} title=${roleLabel(role)} kind="onboarding-modal" onClose=${onClose}>
    <div class="review-detail">
      <p class="role-responsibility">${role.description || role.summary}</p>
      ${role.subagentAllowance === undefined ? '' : html`<p class="muted">Allowed subagents · ${role.subagentAllowance}</p>`}
      <${Tags} role=${role} interactive />
      ${links.length ? html`<section><h3>Directions</h3><div class="review-tags">
        ${links.map((d) => html`<button class="btn" onClick=${() => setDirection(d.id)}>${d.name}</button>`)}
      </div></section>` : ''}
      ${role.request !== null ? html`<p class="muted" role="status">The host is revising this role.</p>`
        : open.length ? html`<section class="review-questions"><h3>Questions</h3>
          ${open.map((q) => html`<fieldset class="review-question"><legend>${q.says}</legend>
            ${q.choices.map((choice) => html`<button class="btn" onClick=${() => revise(`${q.says}\n${choice}`)}>${choice}</button>`)}
          </fieldset>`)}
          <${ReviewInput} label="Answer in your own words" action="Send words" onSubmit=${revise} />
        </section>` : html`<${ReviewInput} label="What should change?" action="Revise" onSubmit=${revise} />`}
    </div>
  <//>`
}

export function Roles({ view, onRefresh, onStaffing }: {
  view: View; onRefresh: () => void; onStaffing: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const role = view.roles.find((item) => item.role === selected)
  const waiting = view.roles.filter((item) => item.state === 'waiting')
  const requests = view.roleRequests ?? []
  const blocked = saving || !waiting.length || requests.length > 0 ||
    view.roles.some((item) => item.request !== null || item.questions?.length || !item.revision)
  const add = attempt(async (words: string) => {
    const response = await postOnboarding({ act: 'add-role', words })
    setAdding(false)
    onRefresh()
    return response
  })
  const approve = attempt(async () => {
    setSaving(true)
    try {
      const response = await postOnboarding({
        act: 'review-all-roles',
        reviewed: waiting.map((item) => ({ id: item.role, revision: item.revision! })),
      })
      onRefresh()
      onStaffing()
      return response
    } finally { setSaving(false) }
  })
  return html`<section class="review-stage" aria-label="Roles">
    <header class="review-heading"><div><h2>Review the roles</h2>
      <p>Check who does the work and who reviews it.</p></div>
      <button class="btn" onClick=${() => setAdding(true)}>Add role</button>
    </header>
    <div class="review-grid">
      ${view.roles.map((item) => {
        const state = item.request !== null ? 'Revising' : item.questions?.length ? 'Question'
          : item.state === 'accepted' ? 'Accepted' : 'Ready'
        return html`<button class="review-card" data-state=${state} onClick=${() => setSelected(item.role)}>
          <span class="review-card-top"><span class="chip review-state" data-state=${state}>${state}</span>
            ${item.builtIn ? html`<span class="muted">Built in</span>` : ''}</span>
          <strong>${roleLabel(item)}</strong><span class="review-description">${item.summary}</span>
          ${item.subagentAllowance === undefined ? '' : html`<span class="muted">Allowed subagents · ${item.subagentAllowance}</span>`}
          <${Tags} role=${item} />
          ${item.request !== null ? html`<div class="review-progress" role="progressbar" aria-label="Revising role"></div>` : ''}
        </button>`
      })}
      ${requests.map((request) => html`<article class="review-card" data-state="Assessing">
        <span class="chip review-state" data-state="Assessing">Assessing</span>
        <strong>Assessing new role…</strong><p>${request.words}</p>
        <div class="review-progress" role="progressbar" aria-label="Assessing role"></div>
      </article>`)}
    </div>
    ${!view.roles.length && !requests.length ? html`<p class="review-empty" role="status">The host is drafting the roles.</p>` : ''}
    <footer class="review-footer">
      ${view.roles.length > 0 && !waiting.length && !requests.length
        ? html`<button class="btn primary" onClick=${onStaffing}>Continue to staffing</button>`
        : html`<button class="btn primary" disabled=${blocked} onClick=${approve}>Accept all</button>`}
    </footer>
    ${role ? html`<${RoleModal} key=${role.role} role=${role} directions=${view.directions}
      onClose=${() => { setSelected(null); onRefresh() }} />` : ''}
    ${adding ? html`<${Modal} title="Add role" onClose=${() => setAdding(false)}>
      <${ReviewInput} label="What should this role be responsible for?" action="Add role" onSubmit=${add} />
    <//>` : ''}
  </section>`
}

import { Result, Schema } from 'effect'
import { ProposalId, ProposalValue, rolesOf, Rationale, refuse, type Project, type Refusal as ProjectRefusal, type Submission } from '../../../core/schema/project.ts'
import type { ProposalReply } from './api.ts'

const decodeProposal = Schema.decodeUnknownResult(ProposalValue, { onExcessProperty: 'error' })

export function RoleCard({ project, submit }: {
  readonly project: Project
  readonly submit: (submission: Submission) => Promise<ProposalReply>
}): ReturnType<typeof html> {
  const [failure, setFailure] = useState<ProjectRefusal | null>(null)
  const [busy, setBusy] = useState(false)
  return html`<section aria-label="Responsibilities">
    ${rolesOf(project).map((role) => {
      const value = role.responsibility.value
      return html`<details key=${role.id}><summary>${role.name}</summary>
        <form onSubmit=${async (event: SubmitEvent) => {
          event.preventDefault()
          const form = event.currentTarget
          if (!(form instanceof HTMLFormElement) || busy) return
          const fields = new FormData(form)
          const proposal = decodeProposal({
            _tag: 'Responsibility', id: value.id, role, summary: fields.get('summary'),
            introduction: fields.get('introduction'), duties: String(fields.get('duties') ?? '').split('\n').map((duty) => duty.trim()).filter(Boolean),
          })
          if (Result.isFailure(proposal)) {
            setFailure(refuse('InvalidInput', Rationale.make('Supply a summary, introduction and at least one duty.')))
            return
          }
          const id = ProposalId.make('proposal:' + crypto.randomUUID())
          setBusy(true)
          try {
            const opened = await submit({ read: project.read, line: { _tag: 'Proposal', id },
              move: 'open', input: { value: proposal.success } })
            if (Result.isFailure(opened)) { setFailure(opened.failure); return }
            const sent = await submit({ read: opened.success.read, line: { _tag: 'Proposal', id },
              move: 'submit', input: { value: proposal.success, question: null } })
            setFailure(Result.isFailure(sent) ? sent.failure : null)
          } finally { setBusy(false) }
        }}>
          <label class="field">Summary<input name="summary" value=${value.summary} required /></label>
          <label class="field">Introduction<textarea name="introduction" required>${value.introduction}</textarea></label>
          <label class="field">Duties<textarea name="duties" required>${value.duties.join('\n')}</textarea></label>
          <button class="btn primary" disabled=${busy}>Send for review</button>
        </form>
      </details>`
    })}
    ${failure ? html`<p role="alert">${failure.why}</p>` : null}
  </section>`
}
