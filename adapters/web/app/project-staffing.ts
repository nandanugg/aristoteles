import { html } from 'htm/preact'
import type { StaffingPlan as ProjectStaffing } from '../../../core/schema/project.ts'

function renderStaffing({ plan }: { readonly plan: ProjectStaffing }): ReturnType<typeof html> {
  return html`<section aria-label="Staffing arrangement">
    <ul>${plan.staff.map((staff) => html`<li key=${staff.id}>
      <strong>${staff.name}</strong> · ${staff.model} · ${staff.subagents} subagents
      <ul>${staff.roles.map((role) => html`<li key=${role.id}>${role.name}</li>`)}</ul>
    </li>`)}</ul>
    <h4>Subscriptions</h4>
    <ul>${plan.subscriptions.map((sub) => html`<li key=${sub.id}>
      ${sub.provider} · ${sub.account} · ${sub.plan}
      ${sub.estimate._tag === 'Estimated' ? html`<p>${sub.estimate.share * 100}% · ${sub.estimate.why}</p>` : ' · No estimate'}
    </li>`)}</ul>
  </section>`
}

export { renderStaffing as StaffingView }
