import { Result, Schema } from 'effect'
import { rolesOf, roleOf, staffingAt } from './roles.ts'
import { versionOf } from './version.ts'
import type { Project } from './records.ts'
import {
  AccountName, DutyText, Introduction, Summary, EventNumber, LaunchText, ModelName, Name, PaneAddress, PlanName, ProviderName, Rationale,
  SessionCount, StaffSessionKey, StaffKey, SubagentCount, SubscriptionKey, WindowMinutes, WindowShare,
  recordsByKey, refuse, type Of, type Refusal, RoleKey,
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
  staff: recordsByKey(Staff, StaffKey).check(Schema.makeFilter((staff) => staff.size > 0)),
  subscriptions: Schema.NonEmptyArray(Subscription),
})
export type StaffingPlan = Of<typeof StaffingPlan>


const withCurrentRoles = (project: Project, staff: Staff): Staff => {
  const [first, ...rest] = staff.roles
  const current = (role: Role) => roleOf(project, role.key) ?? role
  return { ...staff, roles: [current(first), ...rest.map(current)] }
}

const staffMap = ({ staffing }: Project) =>
  (staffing._tag === 'StaffingAccepted' ? staffing.version.value : staffing).staff

export const projectStaff = (project: Project): readonly Staff[] =>
  [...staffMap(project).values()].map((staff) => withCurrentRoles(project, staff))

export const staffByKey = (project: Project, key: Of<typeof StaffKey>): Staff | undefined => {
  const staff = staffMap(project).get(key)
  return staff && withCurrentRoles(project, staff)
}

export const staffOf = (project: Project, role: Role): Staff | undefined =>
  projectStaff(project).find((staff) => staff.roles.some(({ key }) => key === role.key))

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
  const canonical = new Map<Of<typeof StaffKey>, Staff>()
  const invalid = (why: Of<typeof Rationale>) => Result.fail(refuse('InvalidInput', why))
  if (subscriptions.size !== plan.subscriptions.length) return invalid(Rationale.make('Give each subscription its own identity.'))
  for (const staff of plan.staff.values()) {
    const subscription = subscriptions.get(staff.subscription.key)
    if (!subscription || canonical.has(staff.key)) return invalid(Rationale.make('Use the listed subscriptions and distinct staff.'))
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
    const current = staffByKey(project, staff.key)
    const session = current && latestSession(project, current)
    if (session && session._tag !== 'Ended' &&
        (session.staff.subscription.key !== subscription.key ||
         session.staff.roles.some(({ key }) => !roles.some((role) => role.key === key)))) {
      return invalid(Rationale.make('Retire the staff session before changing its subscription or assigned roles.'))
    }
    if (subagentCapacity(project, staff).usedSubagents > staff.subagents) {
      return Result.fail(refuse('NoCapacity', Rationale.make('The staffing plan would remove a subagent slot still in use.')))
    }
    canonical.set(staff.key, { ...staff, roles: [first, ...rest], subscription })
  }
  for (const prior of projectStaff(project)) {
    const session = latestSession(project, prior)
    if (!canonical.has(prior.key) && session && session._tag !== 'Ended')
      return invalid(Rationale.make('Retire the staff session before removing its staff.'))
  }
  for (const subscription of plan.subscriptions) {
    const { sessions: limit } = subscription
    if (limit._tag === 'Limited' && occupiedProviderSlots(project, subscription) > limit.max) {
      return Result.fail(refuse('NoCapacity', Rationale.make('The staffing plan would remove a provider slot still in use.')))
    }
  }
  if (canonical.size === 0 || assigned.size !== rolesOf(project).length) return invalid(Rationale.make('Cover every project role.'))
  return Result.succeed({ ...plan, staff: canonical })
}

export const sessionMayStart = (
  project: Project, key: Of<typeof StaffKey>, staffing: Of<typeof EventNumber>, previous: StaffSession | null,
): Result.Result<Staff, Refusal> => {
  if (staffing !== staffingAt(project)) return Result.fail(refuse('Stale', Rationale.make('Staffing changed before launch.')))
  const staff = staffByKey(project, key)
  if (!staff) return Result.fail(refuse('WrongActor', Rationale.make('Staffing does not include that staff.')))
  const latest = latestSession(project, staff)
  if (previous ? latest?.key !== previous.key || latest._tag !== 'Paused' : latest && latest._tag !== 'Ended')
    return Result.fail(refuse('WrongMove', Rationale.make('Finish or resume the current staff session before launching another.')))
  const { sessions: limit } = staff.subscription
  if (limit._tag === 'Limited' && occupiedProviderSlots(project, staff.subscription) >= limit.max)
    return Result.fail(refuse('NoCapacity', Rationale.make('The subscription has no free provider slot.')))
  return Result.succeed(staff)
}
