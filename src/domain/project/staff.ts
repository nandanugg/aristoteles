import { Result, Schema } from 'effect'
import type { Project } from './records.ts'
import {
  AccountName, DutyText, Introduction, ResponsibilityId, Summary, VersionNumber, EventNumber, LaunchText, ModelName, Name, PaneAddress, PlanName, ProviderName, Rationale,
  SessionCount, SessionId, StaffId, StaffingId, SubagentCount, SubscriptionId, WindowMinutes, WindowShare,
  refuse, type Of, type Refusal, RoleId,
} from './values.ts'

export const Responsibility = Schema.Struct({
  id: ResponsibilityId, summary: Summary, introduction: Introduction, duties: Schema.NonEmptyArray(DutyText),
})
const ResponsibilityVersion = Schema.Struct({
  id: Schema.Struct({ subject: ResponsibilityId, number: VersionNumber }),
  value: Responsibility,
  acceptedAt: EventNumber,
}).check(Schema.makeFilter((version) => version.id.subject === version.value.id))
export const Role = Schema.Struct({ id: RoleId, name: Name, responsibility: ResponsibilityVersion })
export type Role = Of<typeof Role>
export const Subscription = Schema.Struct({
  id: SubscriptionId,
  provider: ProviderName,
  account: AccountName,
  plan: PlanName,
  usageWindow: WindowMinutes,
  sessions: Schema.Union([Schema.TaggedStruct('Unlimited', {}), Schema.TaggedStruct('Limited', { max: SessionCount })]),
  estimate: Schema.Union([
    Schema.TaggedStruct('NoEstimate', {}),
    Schema.TaggedStruct('Estimated', { share: WindowShare, why: Rationale }),
  ]),
})
export const Staff = Schema.TaggedStruct('Staff', {
  id: StaffId, name: Name, model: ModelName, launch: LaunchText, subagents: SubagentCount,
  roles: Schema.NonEmptyArray(Role), subscription: Subscription, why: Rationale,
})
export type Staff = Of<typeof Staff>
export type Subscription = Of<typeof Subscription>
export const Pane = Schema.Struct({ address: PaneAddress })
const sessionFields = { id: SessionId, staff: Staff, startedAt: EventNumber }
export const LiveSession = Schema.TaggedStruct('Live', { ...sessionFields, pane: Pane })
export type LiveSession = Of<typeof LiveSession>
export const StaffSession = Schema.Union([
  LiveSession,
  Schema.TaggedStruct('Paused', sessionFields),
  Schema.TaggedStruct('Ended', sessionFields),
])
export type StaffSession = Of<typeof StaffSession>
export const StaffingPlan = Schema.Struct({
  id: StaffingId, staff: Schema.NonEmptyArray(Staff), subscriptions: Schema.NonEmptyArray(Subscription),
})
export type StaffingPlan = Of<typeof StaffingPlan>



export const staffOf = (project: Project, role: Role): Staff | undefined =>
  [...project.staff.values()].find((staff) => staff.roles.some(({ id }) => id === role.id))

export const liveSession = (project: Project, id: Of<typeof SessionId>): LiveSession | undefined => {
  const session = project.sessions.get(id)
  return session?._tag === 'Live' ? session : undefined
}

export const latestSession = (project: Project, staff: Staff): StaffSession | undefined => {
  let latest: StaffSession | undefined
  for (const session of project.sessions.values()) {
    if (session.staff.id === staff.id && (!latest || session.startedAt > latest.startedAt)) latest = session
  }
  return latest
}

export const providerCapacity = (project: Project, subscription: Subscription) => ({
  liveSessions: SubagentCount.make([...project.sessions.values()].filter((session) =>
    session._tag === 'Live' && session.staff.subscription.id === subscription.id,
  ).length),
  sessionLimit: subscription.sessions,
})

export const subagentCapacity = (project: Project, staff: Staff) => {
  const used = [...project.tasks.values()].filter(({ phase }) => {
    if (phase._tag === 'Working') {
      const { attempt } = phase
      return attempt.place === 'Child' && liveSession(project, attempt.session.id)?.staff.id === staff.id
    }
    return phase._tag === 'Reviewing' && phase.review._tag === 'By' &&
      liveSession(project, phase.review.session.id)?.staff.id === staff.id
  }).length
  return { usedSubagents: SubagentCount.make(used), freeSubagents: SubagentCount.make(Math.max(0, staff.subagents - used)) }
}

export const capacity = (project: Project, staff: Staff) => ({
  ...providerCapacity(project, staff.subscription), ...subagentCapacity(project, staff),
})

export const validateStaffing = (project: Project, plan: StaffingPlan): Result.Result<StaffingPlan, Refusal> => {
  const subscriptions = new Map(plan.subscriptions.map((subscription) => [subscription.id, subscription]))
  const assigned = new Set<Of<typeof RoleId>>()
  const staffIds = new Set<Of<typeof StaffId>>()
  const canonical: Staff[] = []
  const invalid = (why: Of<typeof Rationale>) => Result.fail(refuse('InvalidInput', why))
  if (subscriptions.size !== plan.subscriptions.length) return invalid(Rationale.make('Give each subscription its own identity.'))
  for (const staff of plan.staff) {
    const subscription = subscriptions.get(staff.subscription.id)
    if (!subscription || staffIds.has(staff.id)) return invalid(Rationale.make('Use the listed subscriptions and distinct staff.'))
    staffIds.add(staff.id)
    const roles: Role[] = []
    for (const candidate of staff.roles) {
      const role = project.roles.get(candidate.id)
      if (!role || assigned.has(role.id)) return invalid(Rationale.make('Assign each project role exactly once.'))
      assigned.add(role.id)
      roles.push(role)
    }
    const [first, ...rest] = roles
    if (!first) return invalid(Rationale.make('Assign at least one role to each staff.'))
    if (staff.subagents === 0 && roles.some(({ id }) => id === project.host.id || id === project.pipeline.id)) {
      return Result.fail(refuse('StaffingMinimum', Rationale.make('Host and pipeline each need access to a subagent.')))
    }
    const current = project.staff.get(staff.id)
    const session = current && latestSession(project, current)
    if (session && session._tag !== 'Ended' &&
        (session.staff.subscription.id !== subscription.id ||
         session.staff.roles.some(({ id }) => !roles.some((role) => role.id === id)))) {
      return invalid(Rationale.make('Retire the staff session before changing its subscription or assigned roles.'))
    }
    if (subagentCapacity(project, staff).usedSubagents > staff.subagents) {
      return Result.fail(refuse('NoCapacity', Rationale.make('The staffing plan would remove a subagent slot still in use.')))
    }
    canonical.push({ ...staff, roles: [first, ...rest], subscription })
  }
  for (const prior of project.staff.values()) {
    const session = latestSession(project, prior)
    if (!staffIds.has(prior.id) && session && session._tag !== 'Ended')
      return invalid(Rationale.make('Retire the staff session before removing its staff.'))
  }
  for (const subscription of plan.subscriptions) {
    const { liveSessions, sessionLimit } = providerCapacity(project, subscription)
    if (sessionLimit._tag === 'Limited' && liveSessions > sessionLimit.max) {
      return Result.fail(refuse('NoCapacity', Rationale.make('The staffing plan would remove a provider slot still in use.')))
    }
  }
  const [first, ...rest] = canonical
  if (!first || assigned.size !== project.roles.size) return invalid(Rationale.make('Cover every project role.'))
  return Result.succeed({ ...plan, staff: [first, ...rest] })
}

export const sessionMayStart = (
  project: Project, id: Of<typeof StaffId>, staffing: Of<typeof EventNumber>, previous: StaffSession | null,
): Result.Result<Staff, Refusal> => {
  if (staffing !== project.staffingAt) return Result.fail(refuse('Stale', Rationale.make('Staffing changed before launch.')))
  const staff = project.staff.get(id)
  if (!staff) return Result.fail(refuse('WrongActor', Rationale.make('Staffing does not include that staff.')))
  const latest = latestSession(project, staff)
  if (previous ? latest?.id !== previous.id || latest._tag !== 'Paused' : latest && latest._tag !== 'Ended')
    return Result.fail(refuse('WrongMove', Rationale.make('Finish or resume the current staff session before launching another.')))
  const { liveSessions, sessionLimit } = providerCapacity(project, staff.subscription)
  if (sessionLimit._tag === 'Limited' && liveSessions >= sessionLimit.max)
    return Result.fail(refuse('NoCapacity', Rationale.make('The subscription has no free provider slot.')))
  return Result.succeed(staff)
}
