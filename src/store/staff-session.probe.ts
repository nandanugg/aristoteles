import { Effect, Schema } from 'effect'
import { acceptStaffing, readOpenProject, startSession } from '../../core/actions/staff-session.ts'
import { SessionCount, SessionId, Staff, StaffingId, SubagentCount, type Project, type StaffingPlan } from '../../core/schema/project.ts'
import type { ProjectJournal } from '../../core/services/project.ts'
import { create, role, session, staff } from './project.probe.ts'

export const maker = role('maker')
export const initialStaffing = (limit: 1 | 2 = 2): StaffingPlan => {
  const subscription = { ...staff.subscription, sessions: { _tag: 'Limited', max: SessionCount.make(limit) } } as const
  return {
    id: StaffingId.make('staffing:initial'),
    staff: [
      { ...staff, subscription, subagents: SubagentCount.make(1) },
      Schema.decodeUnknownSync(Staff)({ ...staff, id: 'staff:other', roles: [maker], subscription, subagents: 1 }),
    ],
    subscriptions: [subscription],
  }
}
export const sharedStaffing = (journal: ProjectJournal) => Effect.gen(function* () {
  yield* create(journal, [maker])
  const project = yield* readOpenProject(journal)
  yield* acceptStaffing(journal, project, initialStaffing())
  return yield* readOpenProject(journal)
})
export const launchStaff = (journal: ProjectJournal, project: Project, index: 0 | 1, lifetime: 1 | 2) =>
  startSession(journal, project, {
    id: SessionId.make('session:' + lifetime), staff: initialStaffing().staff[index]!.id,
    staffing: project.staffingAt, pane: session.pane,
  })
