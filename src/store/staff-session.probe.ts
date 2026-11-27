import { Effect, Schema } from 'effect'
import { acceptStaffing } from './proposal.probe.ts'
import { readOpenProject } from '../../core/actions/staff-session.ts'
import { staffingAt, SessionCount, StaffSessionKey, Staff, SubagentCount, type Project, type StaffingPlan } from '../../core/schema/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { startSession, create, role, session, staff } from './project.probe.ts'

export const maker = role('maker')
export const initialStaffing = (limit: 1 | 2 = 2): StaffingPlan => {
  const subscription = { ...staff.subscription, sessions: { _tag: 'Limited', max: SessionCount.make(limit) } } as const
  return {
    staff: [
      { ...staff, subscription, subagents: SubagentCount.make(1) },
      Schema.decodeUnknownSync(Staff)({ ...staff, key: 'staff:other', roles: [maker], subscription, subagents: 1 }),
    ],
    subscriptions: [subscription],
  }
}
export const sharedStaffing = (journal: Journal) => Effect.gen(function* () {
  yield* create(journal, [maker])
  const project = yield* readOpenProject(journal)
  yield* acceptStaffing(journal, project, initialStaffing())
  return yield* readOpenProject(journal)
})
export const launchStaff = (journal: Journal, project: Project, index: 0 | 1, lifetime: 1 | 2) =>
  startSession(journal, project, {
    key: StaffSessionKey.make('session:' + lifetime), staff: initialStaffing().staff[index]!.key,
    staffing: staffingAt(project), pane: session.pane,
  })
