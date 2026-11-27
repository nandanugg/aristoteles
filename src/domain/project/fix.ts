import { Schema } from 'effect'
import { rolesOf } from './roles.ts'
import { staffOf } from './staff.ts'
import type { Task, TaskPhase } from './task.ts'
import type { Project } from './records.ts'
import { ProposalKey, Rationale, type Of } from './values.ts'

export const Assessment = Schema.Struct({
  missed: Schema.Literals(['Staff', 'Guidance', 'MovingTarget']), why: Rationale,
})
export type Assessment = Of<typeof Assessment>
export const Fix = Schema.Union([
  Schema.TaggedStruct('Unassessed', {}),
  Schema.TaggedStruct('Assessed', { assessment: Assessment }),
  Schema.TaggedStruct('Proposed', { assessment: Assessment, proposal: ProposalKey }),
])
export type Fix = Of<typeof Fix>

export const pipelineStaff = (project: Project) => {
  const role = rolesOf(project).find(({ _tag }) => _tag === 'Pipeline')
  return role && staffOf(project, role.key)
}

export const assessmentEligibility = ({ reason, retained }: Extract<TaskPhase, { _tag: 'Raised' }>) =>
  retained._tag === 'Retained' && (reason === 'Tries' || reason === 'Misses' || reason === 'NoRule') ? 'Allowed' : 'WrongMove'

export const takeAsIsEligibility = ({ reason, retained }: Extract<TaskPhase, { _tag: 'Raised' }>) =>
  retained._tag === 'Retained' && (reason === 'Tries' || reason === 'Misses' || reason === 'NoRule' || reason === 'ContractWrong') ? 'Allowed' : 'WrongMove'

export const fixDuty = (project: Project, task: Task) => {
  const { phase } = task
  if (phase._tag !== 'Raised' || assessmentEligibility(phase) !== 'Allowed') return undefined
  if (phase.fix._tag === 'Unassessed') return 'Assess'
  if (phase.fix._tag === 'Proposed') {
    const proposal = project.proposals.get(phase.fix.proposal)
    if (proposal?.phase._tag !== 'Drafting') return undefined
    return proposal.phase.feedback._tag === 'Owner' && proposal.changedIn > task.changedIn ? 'Assess' : 'DraftFix'
  }
  switch (phase.fix.assessment.missed) {
    case 'Staff': return task.automaticRetry === 'Available' ? 'TryAgain' : 'DraftFix'
    case 'Guidance': return 'DraftFix'
    case 'MovingTarget': return undefined
  }
}
