import {
  ReadPosition, actorFor, currentQuestion, sameActor, liveSession, proposalLine, questionLine, staffOf, taskLine, activeWork,
  taskRole, type Human, type LiveSession, type Project, type Proposal, type Question, type QuestionEvent, type Of, type Task, type StoredEvent,
} from '../../schema/project.ts'
import { mayAssignTaskReview } from './review.ts'

export type Selection =
  | { readonly _tag: 'Awaiting' }
  | { readonly _tag: 'Introduction'; readonly subject: Project; readonly read: Of<typeof ReadPosition> }
  | {
      readonly _tag: 'Available'
      readonly subject: { readonly _tag: 'Task'; readonly task: Task } | { readonly _tag: 'Question'; readonly question: Question; readonly owner: QuestionEvent['owner'] }
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
  const current = authority._tag === 'Live' ? currentSession(project, authority) : undefined
  const actor = authority._tag === 'Human' ? { _tag: 'Human' } as const : current && actorFor(project, { _tag: 'Session', key: current.key })
  if (!actor) return []
  const due = (owner: QuestionEvent['owner'], questions: Iterable<Question>) =>
    [...questions].filter((question) =>
      questionLine[question.state._tag].owes === 'Recipient' && sameActor(question.to, actor),
    ).map((question) => ({ question, owner }))
  return [
    ...due({ _tag: 'Project' }, project.questions.values()),
    ...[...project.proposals.values()].flatMap((proposal) => due({ _tag: 'Proposal', key: proposal.key },
      [...proposal.questions.values()].filter((question) => currentQuestion(proposal, question)))),
    ...[...project.tasks.values()].flatMap((task) => due({ _tag: 'Task', key: task.key }, task.questions.values())),
  ].sort((a, b) => a.question.changedIn - b.question.changedIn)
}

export const acceptedDirections = (project: Project) => {
  const accepted = [...project.proposals.values()].flatMap(({ phase, basis }) =>
    phase._tag === 'Accepted' && phase.version.value._tag === 'Direction'
      ? [{ version: { ...phase.version, value: phase.version.value }, basis }] : [],
  )
  const superseded = new Set(accepted.flatMap(({ basis }) => basis._tag === 'Version' ? [basis.version.acceptedIn] : []))
  return accepted.map(({ version }) => version).filter(({ acceptedIn }) => !superseded.has(acceptedIn))
}

export const nextStep = (
  project: Project, authority: LiveSession | Of<typeof Human>, events: readonly StoredEvent[], on?: Of<typeof ReadPosition>,
): Selection => {
  if (project.status._tag === 'Ended') return { _tag: 'Awaiting' }
  const current = authority._tag === 'Live' ? currentSession(project, authority) : undefined
  // Starting up and opening a review can produce engine events under the session's key.
  if (current && on !== Number(current.startedIn) && !events.some(({ actor, move, line }) =>
    actor._tag === 'Session' && actor.key === current.key && move !== 'assign' && !(line === 'Activation' && move === 'use'),
  )) return { _tag: 'Introduction', subject: project, read: ReadPosition.make(current.startedIn) }
  const [question] = questionsFor(project, authority)
  const owes = (task: Task): boolean => {
    if (!current || !activeWork(project)) return false
    const { phase } = task
    switch (taskLine[phase._tag].owes) {
      case 'Assignee':
        if (phase._tag === 'Working') return phase.attempt.actor.key === current.key
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
  const actor = authority._tag === 'Human' ? { _tag: 'Human' } as const : current && actorFor(project, { _tag: 'Session', key: current.key })
  for (const proposal of project.proposals.values()) {
    const duty = proposalLine[proposal.phase._tag].owes
    const owner = duty === 'Owner' && actor?._tag === 'Human'
    const proposer = actorFor(project, proposal.proposer)
    const proposing = duty === 'Proposer' && actor && proposer && sameActor(proposer, actor)
    if (owner || proposing) due.push({ _tag: 'Available', subject: { _tag: 'Proposal', proposal },
      for: actor?._tag === 'Human' ? 'Choose' : 'Report', read: project.read })
  }
  const since = ({ subject }: typeof due[number]) =>
    (subject._tag === 'Task' ? subject.task : subject._tag === 'Question' ? subject.question : subject.proposal).changedIn
  return due.sort((left, right) => since(left) - since(right))[0] ?? { _tag: 'Awaiting' }
}
