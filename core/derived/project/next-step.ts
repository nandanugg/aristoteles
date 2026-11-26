import {
  currentQuestion, liveSession, questionLine, staffOf, taskLine,
  type Human, type LiveSession, type Project, type Question, type ReadPosition, type Of, type Task,
} from '../../schema/project.ts'

export type Selection =
  | { readonly _tag: 'Awaiting' }
  | {
      readonly _tag: 'Available'
      readonly subject: { readonly _tag: 'Task'; readonly task: Task } | { readonly _tag: 'Question'; readonly question: Question }
      readonly for: 'Report' | 'Answer'
      readonly read: Of<typeof ReadPosition>
    }

const currentSession = (project: Project, authority: LiveSession): LiveSession | undefined => {
  const session = liveSession(project, authority.id)
  return session?.staff.id === authority.staff.id ? session : undefined
}

export const questionsFor = (project: Project, authority: LiveSession | Of<typeof Human>): readonly Question[] => {
  if (project.status._tag === 'Ended') return []
  const actor = authority._tag === 'Human' ? (project.owner.id === authority.id ? project.owner : undefined)
    : currentSession(project, authority)?.staff
  if (!actor) return []
  return [...project.questions.values()].filter((question) =>
    questionLine[question.state._tag].owes === 'Recipient' && currentQuestion(project, question) !== null &&
    question.to._tag === actor._tag && question.to.id === actor.id,
  ).sort((a, b) => a.lastChange - b.lastChange)
}

export const nextStep = (project: Project, authority: LiveSession | Of<typeof Human>): Selection => {
  if (project.status._tag === 'Ended') return { _tag: 'Awaiting' }
  const [question] = questionsFor(project, authority)
  const current = authority._tag === 'Live' ? currentSession(project, authority) : undefined
  const owes = (task: Task): boolean => {
    if (!current) return false
    const { phase } = task
    switch (taskLine[phase._tag].owes) {
      case 'Assignee':
        if (phase._tag === 'Working') return phase.attempt.session.id === current.id
        return staffOf(project, task.role)?.id === current.staff.id
      case 'Reviewer':
        return phase._tag === 'Reviewing' && phase.review._tag === 'By' && phase.review.session.id === current.id
      default:
        return false
    }
  }
  const task = [...project.tasks.values()].filter(owes).sort((left, right) => left.lastChange - right.lastChange)[0]
  if (question && (!task || question.lastChange < task.lastChange))
    return { _tag: 'Available', subject: { _tag: 'Question', question }, for: 'Answer', read: project.read }
  return task
    ? { _tag: 'Available', subject: { _tag: 'Task', task }, for: 'Report', read: project.read }
    : { _tag: 'Awaiting' }
}
