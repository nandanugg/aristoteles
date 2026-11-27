import { Result, Schema } from 'effect'
import { rolesOf, roleOf, staffingAt } from './roles.ts'
import { versionOf } from './version.ts'
import type { Project } from './records.ts'
import {
  AccountName, DutyText, Introduction, Summary, EventNumber, LaunchText, ModelName, Name, PaneAddress, PlanName, ProviderName, Rationale,
  SessionCount, StaffSessionKey, StaffKey, SubagentCount, SubscriptionKey, WindowMinutes, WindowShare,
  refuse, type Of, type Refusal, RoleKey,
} from './values.ts'

export const Human = Schema.TaggedStruct('Human', { name: Name })
export const Responsibility = Schema.Struct({
  summary: Summary, introduction: Introduction, duties: Schema.NonEmptyArray(DutyText),
})
export const Role = Schema.Struct({ key: RoleKey, name: Name, responsibility: versionOf(Responsibility) })
export type Role = Of<typeof Role>
export const Subscription = Schema.Struct({
  key: SubscriptionKey,
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
  key: StaffKey, name: Name, model: ModelName, launch: LaunchText, subagents: SubagentCount,
  roles: Schema.NonEmptyArray(Role), subscription: Subscription, why: Rationale,
})
export type Staff = Of<typeof Staff>
export type Subscription = Of<typeof Subscription>
export const Pane = Schema.Struct({ address: PaneAddress })
const sessionFields = { key: StaffSessionKey, staff: Staff, startedAt: EventNumber }
const Paused = Schema.TaggedStruct('Paused', sessionFields)
export const Starting = Schema.TaggedStruct('Starting', {
  ...sessionFields, previous: Schema.Union([Schema.TaggedStruct('None', {}), Paused]),
})
export const LiveSession = Schema.TaggedStruct('Live', { ...sessionFields, pane: Pane })
export type LiveSession = Of<typeof LiveSession>
export const StaffSession = Schema.Union([
  Starting, LiveSession,
  Paused,
  Schema.TaggedStruct('Ended', sessionFields),
])
export type StaffSession = Of<typeof StaffSession>
export const StaffingPlan = Schema.Struct({
  staff: Schema.NonEmptyArray(Staff), subscriptions: Schema.NonEmptyArray(Subscription),
})
export type StaffingPlan = Of<typeof StaffingPlan>



export const staffOf = (project: Project, role: Role): Staff | undefined =>
  [...project.staff.values()].find((staff) => staff.roles.some(({ key }) => key === role.key))

export const liveSession = (project: Project, key: Of<typeof StaffSessionKey>): LiveSession | undefined => {
  const session = project.sessions.get(key)
  return session?._tag === 'Live' ? session : undefined
}

export const latestSession = (project: Project, staff: Staff): StaffSession | undefined => {
  let latest: StaffSession | undefined
  for (const session of project.sessions.values()) {
    if (session.staff.key === staff.key && (!latest || session.startedAt > latest.startedAt)) latest = session
  }
  return latest
}

export const providerCapacity = (project: Project, subscription: Subscription) => ({
  liveSessions: SubagentCount.make([...project.sessions.values()].filter((session) =>
    session._tag === 'Live' && session.staff.subscription.key === subscription.key,
  ).length),
  sessionLimit: subscription.sessions,
})

const occupiedProviderSlots = (project: Project, subscription: Subscription) => SubagentCount.make(
  [...project.sessions.values()].filter((session) =>
    (session._tag === 'Live' || session._tag === 'Starting') && session.staff.subscription.key === subscription.key,
  ).length,
)

export const subagentCapacity = (project: Project, staff: Staff) => {
  const used = [...project.tasks.values()].filter(({ phase }) => {
    if (phase._tag === 'Working') {
      const { attempt } = phase
      return attempt.where === 'Subagent' && liveSession(project, attempt.session.key)?.staff.key === staff.key
    }
    return phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && phase.assignment.by.key === staff.key
  }).length
  const proposals = [...project.proposals.values()].filter(({ phase }) =>
    phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && phase.assignment.by.key === staff.key,
  ).length
  const occupied = used + proposals
  return { usedSubagents: SubagentCount.make(occupied), freeSubagents: SubagentCount.make(Math.max(0, staff.subagents - occupied)) }
}

export const capacity = (project: Project, staff: Staff) => ({
  ...providerCapacity(project, staff.subscription), ...subagentCapacity(project, staff),
})

export const validateStaffing = (project: Project, plan: StaffingPlan): Result.Result<StaffingPlan, Refusal> => {
  const subscriptions = new Map(plan.subscriptions.map((subscription) => [subscription.key, subscription]))
  const assigned = new Set<Of<typeof RoleKey>>()
  const staffKeys = new Set<Of<typeof StaffKey>>()
  const canonical: Staff[] = []
  const invalid = (why: Of<typeof Rationale>) => Result.fail(refuse('InvalidInput', why))
  if (subscriptions.size !== plan.subscriptions.length) return invalid(Rationale.make('Give each subscription its own identity.'))
  for (const staff of plan.staff) {
    const subscription = subscriptions.get(staff.subscription.key)
    if (!subscription || staffKeys.has(staff.key)) return invalid(Rationale.make('Use the listed subscriptions and distinct staff.'))
    staffKeys.add(staff.key)
    const roles: Role[] = []
    for (const candidate of staff.roles) {
      const role = roleOf(project, candidate.key)
      if (!role || assigned.has(role.key)) return invalid(Rationale.make('Assign each project role exactly once.'))
      assigned.add(role.key)
      roles.push(role)
    }
    const [first, ...rest] = roles
    if (!first) return invalid(Rationale.make('Assign at least one role to each staff.'))
    if (staff.subagents === 0 && roles.some(({ key }) => key === project.roles.host.key || key === project.roles.pipeline.key)) {
      return Result.fail(refuse('StaffingMinimum', Rationale.make('Host and pipeline each need access to a subagent.')))
    }
    const current = project.staff.get(staff.key)
    const session = current && latestSession(project, current)
    if (session && session._tag !== 'Ended' &&
        (session.staff.subscription.key !== subscription.key ||
         session.staff.roles.some(({ key }) => !roles.some((role) => role.key === key)))) {
      return invalid(Rationale.make('Retire the staff session before changing its subscription or assigned roles.'))
    }
    if (subagentCapacity(project, staff).usedSubagents > staff.subagents) {
      return Result.fail(refuse('NoCapacity', Rationale.make('The staffing plan would remove a subagent slot still in use.')))
    }
    canonical.push({ ...staff, roles: [first, ...rest], subscription })
  }
  for (const prior of project.staff.values()) {
    const session = latestSession(project, prior)
    if (!staffKeys.has(prior.key) && session && session._tag !== 'Ended')
      return invalid(Rationale.make('Retire the staff session before removing its staff.'))
  }
  for (const subscription of plan.subscriptions) {
    const { sessions: limit } = subscription
    if (limit._tag === 'Limited' && occupiedProviderSlots(project, subscription) > limit.max) {
      return Result.fail(refuse('NoCapacity', Rationale.make('The staffing plan would remove a provider slot still in use.')))
    }
  }
  const [first, ...rest] = canonical
  if (!first || assigned.size !== rolesOf(project).length) return invalid(Rationale.make('Cover every project role.'))
  return Result.succeed({ ...plan, staff: [first, ...rest] })
}

export const sessionMayStart = (
  project: Project, key: Of<typeof StaffKey>, staffing: Of<typeof EventNumber>, previous: StaffSession | null,
): Result.Result<Staff, Refusal> => {
  if (staffing !== staffingAt(project)) return Result.fail(refuse('Stale', Rationale.make('Staffing changed before launch.')))
  const staff = project.staff.get(key)
  if (!staff) return Result.fail(refuse('WrongActor', Rationale.make('Staffing does not include that staff.')))
  const latest = latestSession(project, staff)
  if (previous ? latest?.key !== previous.key || latest._tag !== 'Paused' : latest && latest._tag !== 'Ended')
    return Result.fail(refuse('WrongMove', Rationale.make('Finish or resume the current staff session before launching another.')))
  const { sessions: limit } = staff.subscription
  if (limit._tag === 'Limited' && occupiedProviderSlots(project, staff.subscription) >= limit.max)
    return Result.fail(refuse('NoCapacity', Rationale.make('The subscription has no free provider slot.')))
  return Result.succeed(staff)
}
