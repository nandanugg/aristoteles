import {
  currentQuestion, liveSession, proposalLine, questionLine, staffOf, taskLine,
  type Human, type LiveSession, type Project, type Proposal, type Question, type ReadPosition, type Of, type Task,
} from '../../schema/project.ts'

export type Selection =
  | { readonly _tag: 'Awaiting' }
  | {
      readonly _tag: 'Available'
      readonly subject: { readonly _tag: 'Task'; readonly task: Task } | { readonly _tag: 'Question'; readonly question: Question }
        | { readonly _tag: 'Proposal'; readonly proposal: Proposal }
      readonly for: 'Report' | 'Answer' | 'Choose'
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
        return phase._tag === 'Reviewing' && phase.by?.id === current.staff.id
      default:
        return false
    }
  }
  const due: Extract<Selection, { _tag: 'Available' }>[] = []
  if (question) due.push({ _tag: 'Available', subject: { _tag: 'Question', question }, for: 'Answer', read: project.read })
  for (const task of project.tasks.values()) {
    if (owes(task)) due.push({ _tag: 'Available', subject: { _tag: 'Task', task }, for: 'Report', read: project.read })
  }
  const actor = authority._tag === 'Human' ? authority : current?.staff
  for (const proposal of project.proposals.values()) {
    const duty = proposalLine[proposal.phase._tag].owes
    const owner = duty === 'Owner' && actor?._tag === 'Human' && proposal.owner.id === actor.id
    const proposer = duty === 'Proposer' && proposal.proposer._tag === actor?._tag && proposal.proposer.id === actor.id
    if (owner || proposer) due.push({ _tag: 'Available', subject: { _tag: 'Proposal', proposal },
      for: actor?._tag === 'Human' ? 'Choose' : 'Report', read: project.read })
  }
  const since = ({ subject }: typeof due[number]) =>
    (subject._tag === 'Task' ? subject.task : subject._tag === 'Question' ? subject.question : subject.proposal).lastChange
  return due.sort((left, right) => since(left) - since(right))[0] ?? { _tag: 'Awaiting' }
}
