import {
  liveSession, staffOf, taskLine, type LiveSession, type Project, type ReadPosition, type Of, type Task,
} from '../../schema/project.ts'

export type Selection =
  | { readonly _tag: 'Awaiting' }
  | {
      readonly _tag: 'Available'
      readonly subject: { readonly _tag: 'Task'; readonly task: Task }
      readonly for: 'Report'
      readonly read: Of<typeof ReadPosition>
    }

export const nextStep = (project: Project, authority: LiveSession): Selection => {
  if (project.status._tag === 'Ended' || liveSession(project, authority.id)?.staff.id !== authority.staff.id)
    return { _tag: 'Awaiting' }
  const owes = (task: Task): boolean => {
    const { phase } = task
    switch (taskLine[phase._tag].owes) {
      case 'Assignee':
        if (phase._tag === 'Working') return phase.attempt.session.id === authority.id
        return staffOf(project, task.role)?.id === authority.staff.id
      case 'Reviewer':
        return phase._tag === 'Reviewing' && phase.review._tag === 'By' && phase.review.session.id === authority.id
      default:
        return false
    }
  }
  const task = [...project.tasks.values()].filter(owes).sort((left, right) => left.lastChange - right.lastChange)[0]
  return task
    ? { _tag: 'Available', subject: { _tag: 'Task', task }, for: 'Report', read: project.read }
    : { _tag: 'Awaiting' }
}
