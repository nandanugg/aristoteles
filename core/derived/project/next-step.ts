import {
  currentQuestion, sameActor, liveSession, proposalLine, questionLine, staffOf, taskLine, activeWork,
  taskRole, type Human, type LiveSession, type Project, type Proposal, type Question, type QuestionAddress, type ReadPosition, type Of, type Task, type StoredEvent,
} from '../../schema/project.ts'
import { mayAssignTaskReview } from './review.ts'

export type Selection =
  | { readonly _tag: 'Awaiting' }
  | {
      readonly _tag: 'Available'
      readonly subject: { readonly _tag: 'Task'; readonly task: Task } | { readonly _tag: 'Question'; readonly question: Question; readonly line: Of<typeof QuestionAddress> }
        | { readonly _tag: 'Proposal'; readonly proposal: Proposal }
      readonly for: 'Report' | 'Answer' | 'Choose' | 'Assign' | 'Review'
      readonly read: Of<typeof ReadPosition>
    }

const currentSession = (project: Project, authority: LiveSession): LiveSession | undefined => {
  const session = liveSession(project, authority.key)
  return session?.staff.key === authority.staff.key ? session : undefined
}

export const questionsFor = (project: Project, authority: LiveSession | Of<typeof Human>) => {
  if (project.status._tag === 'Ended') return []
  const actor = authority._tag === 'Human' ? project.owner : currentSession(project, authority)?.staff
  if (!actor) return []
  const due = (owner: Of<typeof QuestionAddress>['owner'], questions: Iterable<Question>) =>
    [...questions].filter((question) =>
      questionLine[question.state._tag].owes === 'Recipient' && sameActor(question.to, actor),
    ).map((question) => ({ question, line: { _tag: 'Question', owner, key: question.key } as const }))
  return [
    ...due({ _tag: 'Project' }, project.questions.values()),
    ...[...project.proposals.values()].flatMap((proposal) => due({ _tag: 'Proposal', key: proposal.key },
      [...proposal.questions.values()].filter((question) => currentQuestion(proposal, question)))),
    ...[...project.tasks.values()].flatMap((task) => due({ _tag: 'Task', key: task.key }, task.questions.values())),
  ].sort((a, b) => a.question.lastChange - b.question.lastChange)
}

export const nextStep = (project: Project, authority: LiveSession | Of<typeof Human>, events: readonly StoredEvent[] = []): Selection => {
  if (project.status._tag === 'Ended') return { _tag: 'Awaiting' }
  const [question] = questionsFor(project, authority)
  const current = authority._tag === 'Live' ? currentSession(project, authority) : undefined
  const owes = (task: Task): boolean => {
    if (!current || !activeWork(project)) return false
    const { phase } = task
    switch (taskLine[phase._tag].owes) {
      case 'Assignee':
        if (phase._tag === 'Working') return phase.attempt.session.key === current.key
        return staffOf(project, taskRole(task))?.key === current.staff.key
      default:
        return false
    }
  }
  const due: Extract<Selection, { _tag: 'Available' }>[] = []
  if (question) due.push({ _tag: 'Available', subject: { _tag: 'Question', ...question }, for: 'Answer', read: project.read })
  for (const task of project.tasks.values()) {
    const subject = { _tag: 'Task', task } as const
    if (owes(task)) due.push({ _tag: 'Available', subject, for: 'Report', read: project.read })
    else if (current && mayAssignTaskReview(project, events, task, current) === 'Allowed')
      due.push({ _tag: 'Available', subject, for: 'Assign', read: project.read })
  }
  const actor = authority._tag === 'Human' ? authority : current?.staff
  for (const proposal of project.proposals.values()) {
    const duty = proposalLine[proposal.phase._tag].owes
    const owner = duty === 'Owner' && actor?._tag === 'Human'
    const proposer = duty === 'Proposer' && actor && sameActor(proposal.proposer, actor)
    if (owner || proposer) due.push({ _tag: 'Available', subject: { _tag: 'Proposal', proposal },
      for: actor?._tag === 'Human' ? 'Choose' : 'Report', read: project.read })
  }
  const since = ({ subject }: typeof due[number]) =>
    (subject._tag === 'Task' ? subject.task : subject._tag === 'Question' ? subject.question : subject.proposal).lastChange
  return due.sort((left, right) => since(left) - since(right))[0] ?? { _tag: 'Awaiting' }
}
