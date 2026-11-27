import { activeWork, liveSession, taskReviewStaff, type Task, latestSession, staffOf, subagentCapacity, type LiveSession, type Project, type Proposal, type StoredEvent } from '../../schema/project.ts'

export const hostQueue = (project: Project, events: readonly StoredEvent[]): readonly Proposal[] => {
  const entries = new Map<Proposal['key'], StoredEvent['number']>()
  for (const event of events) {
    if (event.line === 'Proposal' && event.from === 'Drafting' && event.move === 'submit')
      entries.set(event.key, event.number)
  }
  return [...project.proposals.values()].filter(({ phase }) => phase._tag === 'Reviewing' &&
    phase.assignment._tag === 'Waiting' && project.status._tag === 'Open')
    .sort((a, b) => (entries.get(a.key) ?? a.changedIn) - (entries.get(b.key) ?? b.changedIn))
}

export const nextProposalReview = (
  project: Project, events: readonly StoredEvent[],
): Readonly<{ proposal: Proposal; session: LiveSession }> | null => {
  const host = staffOf(project, project.roles.host)
  if (!host || !subagentCapacity(project, host).freeSubagents) return null
  const session = latestSession(project, host)
  if (session?._tag !== 'Live') return null
  const proposal = hostQueue(project, events)[0]
  return proposal ? { proposal, session } : null
}

export const ownerProposals = (project: Project): readonly Proposal[] =>
  [...project.proposals.values()].filter(({ phase }) =>
    phase._tag === 'WaitingForOwner')

const waiting = (task: Task) => task.phase._tag === 'Reviewing' && task.phase.assignment._tag === 'Waiting'

export const hostTaskQueue = (project: Project, events: readonly StoredEvent[]): readonly Task[] => {
  const entries = new Map<Task['key'], Task>()
  for (const event of events) {
    if (event.line !== 'Task' || event.from !== 'ReadyToReview' || event.move !== 'next') continue
    const task = project.tasks.get(event.key)
    if (!task || !waiting(task) || staffOf(project, task.reviewer)?.subagents !== 0) continue
    // Reinserting moves a later review of this task behind entries already waiting.
    entries.delete(task.key)
    entries.set(task.key, task)
  }
  return [...entries.values()]
}

export const mayAssignTaskReview = (project: Project, events: readonly StoredEvent[], task: Task, session: LiveSession) => {
  if (!activeWork(project) || !waiting(task)) return 'WrongMove'
  const current = liveSession(project, session.key)
  if (current?.staff.key !== session.staff.key) return 'RetiredSession'
  const staff = taskReviewStaff(project, task)
  if (!staff || staff.key !== current.staff.key) return 'WrongActor'
  if (!subagentCapacity(project, staff).freeSubagents) return 'NoCapacity'
  if (staffOf(project, task.reviewer)?.subagents === 0 && hostTaskQueue(project, events)[0]?.key !== task.key)
    return 'NoCapacity'
  return 'Allowed'
}
