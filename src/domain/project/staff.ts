import { Result, Schema } from 'effect'
import { roleOf, staffedIn } from './roles.ts'
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
export const Role = Schema.Struct({
  key: RoleKey, _tag: Schema.Literals(['Host', 'Pipeline', 'Work']), name: Name, responsibility: versionOf(Responsibility),
})
export type Role = Of<typeof Role>
export const Roles = recordsByKey(Role, RoleKey).check(Schema.makeFilter((roles) => {
  const all = [...roles.values()]
  return all.filter((role) => role._tag === 'Host').length === 1 &&
    all.filter((role) => role._tag === 'Pipeline').length === 1
}))
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
  roles: Schema.NonEmptyArray(RoleKey), subscription: Schema.Struct({ key: SubscriptionKey }), why: Rationale,
})
export type Staff = Of<typeof Staff>
export type Subscription = Of<typeof Subscription>
export const Pane = Schema.Struct({ address: PaneAddress })
const sessionFields = { key: StaffSessionKey, staff: Staff, startedIn: EventNumber, changedIn: EventNumber }
const Paused = Schema.TaggedStruct('Paused', { ...sessionFields, pane: Pane })
export const Starting = Schema.TaggedStruct('Starting', sessionFields)
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
  subscriptions: recordsByKey(Subscription, SubscriptionKey).check(Schema.makeFilter((subscriptions) => subscriptions.size > 0)),
})
export type StaffingPlan = Of<typeof StaffingPlan>


const staffingPlan = ({ staffing }: Project) =>
  staffing._tag === 'StaffingAccepted' ? staffing.version.value : staffing

export const projectStaff = (project: Project): readonly Staff[] =>
  [...staffingPlan(project).staff.values()]

export const staffByKey = (project: Project, key: Of<typeof StaffKey>): Staff | undefined =>
  staffingPlan(project).staff.get(key)

export const subscriptionOf = (project: Project, staff: Staff): Subscription | undefined =>
  staffingPlan(project).subscriptions.get(staff.subscription.key)

export const staffOf = (project: Project, role: Of<typeof RoleKey>): Staff | undefined =>
  projectStaff(project).find((staff) => staff.roles.includes(role))

export const liveSession = (project: Project, key: Of<typeof StaffSessionKey>): LiveSession | undefined => {
  const session = project.sessions.get(key)
  return session?._tag === 'Live' ? session : undefined
}

export const latestSession = (project: Project, staff: Staff): StaffSession | undefined => {
  let latest: StaffSession | undefined
  for (const session of project.sessions.values()) {
    if (session.staff.key === staff.key && (!latest || session.startedIn > latest.startedIn)) latest = session
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
    session._tag !== 'Ended' && session.staff.subscription.key === subscription.key,
  ).length,
)

export const subagentCapacity = (project: Project, staff: Staff) => {
  const used = [...project.tasks.values()].filter(({ phase }) => {
    if (phase._tag === 'Working') {
      const { attempt } = phase
      return attempt.where === 'Subagent' && project.sessions.get(attempt.actor.key)?.staff.key === staff.key
    }
    return phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && project.sessions.get(phase.assignment.actor.key)?.staff.key === staff.key
  }).length
  const proposals = [...project.proposals.values()].filter(({ phase }) =>
    phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' && project.sessions.get(phase.assignment.actor.key)?.staff.key === staff.key,
  ).length
  const occupied = used + proposals
  return { usedSubagents: SubagentCount.make(occupied), freeSubagents: SubagentCount.make(Math.max(0, staff.subagents - occupied)) }
}

export const capacity = (project: Project, staff: Staff) => {
  const subscription = subscriptionOf(project, staff)
  return subscription ? { ...providerCapacity(project, subscription), ...subagentCapacity(project, staff) } : null
}

export const validateStaffing = (
  project: Project, plan: StaffingPlan, move: 'open' | 'submit' | 'accept',
): Result.Result<StaffingPlan, Refusal> => {
  const assigned = new Set<Of<typeof RoleKey>>()
  const invalid = (why: Of<typeof Rationale>) => Result.fail(refuse('InvalidInput', why))
  for (const staff of plan.staff.values()) {
    const subscription = plan.subscriptions.get(staff.subscription.key)
    if (!subscription) return invalid(Rationale.make('Use the listed subscriptions.'))
    for (const key of staff.roles) {
      const role = roleOf(project, key)
      if (!role || assigned.has(key)) return invalid(Rationale.make('Assign each project role exactly once.'))
      if (role._tag !== 'Work' && staff.subagents === 0)
        return Result.fail(refuse('StaffingMinimum', Rationale.make('Host and pipeline each need access to a subagent.')))
      assigned.add(key)
    }
    if (move !== 'accept') continue
    const current = staffByKey(project, staff.key)
    const session = current && latestSession(project, current)
    if (current && session && session._tag !== 'Ended') {
      const prior = subscriptionOf(project, current)
      if (prior?.key !== subscription.key || prior.provider !== subscription.provider || prior.account !== subscription.account ||
          current.roles.some((key) => !staff.roles.includes(key)))
        return invalid(Rationale.make('Run work session end before changing the staff’s subscription or assigned roles.'))
    }
    if (subagentCapacity(project, staff).usedSubagents > staff.subagents) {
      return Result.fail(refuse('NoCapacity', Rationale.make('The staffing plan would remove a subagent slot still in use.')))
    }
  }
  if (assigned.size !== project.roles.size) return invalid(Rationale.make('Cover every project role.'))
  if (move !== 'accept') return Result.succeed(plan)
  for (const prior of projectStaff(project)) {
    const session = latestSession(project, prior)
    if (!plan.staff.has(prior.key) && session && session._tag !== 'Ended')
      return invalid(Rationale.make('Run work session end before removing its staff.'))
  }
  for (const subscription of plan.subscriptions.values()) {
    const { sessions: limit } = subscription
    if (limit._tag === 'Limited' && occupiedProviderSlots(project, subscription) > limit.max) {
      return Result.fail(refuse('NoCapacity', Rationale.make('The staffing plan would remove a provider slot still in use.')))
    }
  }
  return Result.succeed(plan)
}

export const sessionMayStart = (
  project: Project, key: Of<typeof StaffKey>, basis: Of<typeof EventNumber>,
): Result.Result<Staff, Refusal> => {
  if (staffedIn(project) !== basis) return Result.fail(refuse('Stale', Rationale.make('Staffing changed before launch.')))
  const staff = staffByKey(project, key)
  if (!staff) return Result.fail(refuse('WrongActor', Rationale.make('Staffing does not include that staff.')))
  const latest = latestSession(project, staff)
  if (latest && latest._tag !== 'Ended')
    return Result.fail(refuse('WrongMove', Rationale.make('End the current staff session before launching another.')))
  const subscription = subscriptionOf(project, staff)
  if (!subscription) return Result.fail(refuse('WrongMove', Rationale.make('The staff needs a subscription from its plan.')))
  const { sessions: limit } = subscription
  if (limit._tag === 'Limited' && occupiedProviderSlots(project, subscription) >= limit.max)
    return Result.fail(refuse('NoCapacity', Rationale.make('The subscription has no free provider slot.')))
  return Result.succeed(staff)
}
