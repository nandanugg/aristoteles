import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import { ReviewEvidence } from './project-evidence.ts'
import { ReviewInput } from './review-input.ts'
import { Result } from 'effect'
import { Rationale, roleOf, type Of, type Project, type Proposal as ProjectProposal, type ReadPosition, type Refusal as ProjectRefusal, type Submission } from '../../../core/schema/project.ts'
import { StaffingView } from './project-staffing.ts'
import type { ProposalReply } from './project-api.ts'

export function ProposalCard({ proposal, project, read, submit }: {
  readonly proposal: ProjectProposal
  readonly project: Project
  readonly read: Of<typeof ReadPosition>
  readonly submit: (submission: Submission) => Promise<ProposalReply>
}): ReturnType<typeof html> | null {
  const { phase, value } = proposal
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<ProjectRefusal | null>(null)
  if (phase._tag !== 'WaitingForOwner' && phase._tag !== 'Accepted') return null
  type OwnerMove = Extract<Submission, { line: 'Proposal'; move: 'accept' | 'remove' | 'sendBack' }>
  type Choice<M> = M extends OwnerMove ? Pick<M, 'move' | 'input'> : never
  const choose = async (choice: Choice<OwnerMove>) => {
    if (busy) return
    setBusy(true)
    const result = await submit({ ...choice, read, line: 'Proposal', key: proposal.key })
    setFailure(Result.isFailure(result) ? result.failure : null)
    setBusy(false)
  }
  return html`<article class="review-stage">
    <h3>${value._tag === 'Staffing' ? 'Staffing' : value._tag === 'Direction' ? value.name : roleOf(project, value.role)?.name ?? value.role}</h3>
    ${value._tag === 'Staffing' ? html`<${StaffingView} plan=${value} project=${project} />` :
      value._tag === 'Direction' ? html`<p>${value.summary}</p><p>${value.text}</p>
        ${value.source._tag === 'Company' ? html`<p>${value.source.repository} · ${value.source.commit}</p>` : null}
        <ol>${value.stages.map((stage, index) => html`<li key=${index}>${stage.name} · ${roleOf(project, stage.role)?.name ?? stage.role} · ${stage.work}</li>`)}</ol>
        ${value.standards.map((standard, index) => html`<section key=${index}><h4>${standard.name}</h4><p>${standard.text}</p>
          ${standard.scope._tag === 'Where' ? html`<ul>${standard.scope.facts.map((fact) =>
            html`<li>${fact.name} · ${fact.value}</li>`)}</ul>` : null}
          <ul>${standard.rules.map((rule, index) => html`<li key=${index}>
            <strong>${rule.name}</strong><p>${rule.text}</p>
            ${rule.examples.holds.map((example) => html`<blockquote>${example.text}<footer>Holds</footer></blockquote>`)}
            ${rule.examples.breaks.map((example) => html`<blockquote>${example.text}<footer>Breaks</footer></blockquote>`)}
          </li>`)}</ul>
        </section>`)}`
        : html`<p>${value.summary}</p><p>${value.introduction}</p><ul>${value.duties.map((duty) => html`<li>${duty}</li>`)}</ul>`}
    ${phase._tag === 'WaitingForOwner' ? html`
      <ul>${phase.facts.outcomes.map((outcome) => html`<li><strong>${outcome.rule.name} · ${outcome._tag}</strong><${ReviewEvidence} evidence=${outcome.evidence} /></li>`)}</ul>
      <button class="btn primary" disabled=${busy} onClick=${() => void choose({ move: 'accept', input: {} })}>Accept</button>
      <button class="btn" disabled=${busy} onClick=${() => void choose({ move: 'remove', input: {} })}>Remove</button>
      <${ReviewInput} label="What should change?" action="Send back" onSubmit=${(why: string) =>
        choose({ move: 'sendBack', input: { why: Rationale.make(why) } })} />
    ` : html`<p>Accepted · version ${phase.version.number}</p>`}
    ${failure ? html`<p role="alert">${failure.why}</p>` : null}
  </article>`
}
