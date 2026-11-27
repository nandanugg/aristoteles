import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import { Result, Schema } from 'effect'
import { ProposalKey, ProposalValue, rolesOf, Rationale, refuse, type Project, type Refusal as ProjectRefusal, type Submission } from '../../../core/schema/project.ts'
import type { ProposalReply } from './project-api.ts'

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
      return html`<details key=${role.key}><summary>${role.name}</summary>
        <form onSubmit=${async (event: SubmitEvent) => {
          event.preventDefault()
          const form = event.currentTarget
          if (!(form instanceof HTMLFormElement) || busy) return
          const fields = new FormData(form)
          const proposal = decodeProposal({
            _tag: 'Responsibility', role, summary: fields.get('summary'),
            introduction: fields.get('introduction'), duties: String(fields.get('duties') ?? '').split('\n').map((duty) => duty.trim()).filter(Boolean),
          })
          if (Result.isFailure(proposal)) {
            setFailure(refuse('InvalidInput', Rationale.make('Supply a summary, introduction and at least one duty.')))
            return
          }
          const key = ProposalKey.make('proposal:' + crypto.randomUUID())
          setBusy(true)
          try {
            const opened = await submit({ read: project.read, line: { _tag: 'Proposal', key },
              move: 'open', input: { previous: { _tag: 'None' }, value: proposal.success } })
            if (Result.isFailure(opened)) { setFailure(opened.failure); return }
            const sent = await submit({ read: opened.success.read, line: { _tag: 'Proposal', key },
              move: 'submit', input: { value: proposal.success } })
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
