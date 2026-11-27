import {
  actorFor, type ReadPosition, currentQuestion, sameActor, liveSession, proposalLine, questionLine, staffOf, taskLine, activeWork,
  fixDuty, pendingFix, pipelineStaff, taskRole, type Human, type LiveSession, type Project, type Proposal, type Question, type QuestionEvent, type Of, type Task, type StoredEvent,
} from '../../schema/project.ts'
import { lastSessionAct } from './session-read.ts'
import { mayAssignTaskReview } from './review.ts'

export type Selection =
  | { readonly _tag: 'Awaiting' }
  | { readonly _tag: 'Introduction'; readonly subject: Project; readonly read: Of<typeof ReadPosition> }
  | {
      readonly _tag: 'Available'
      readonly subject: { readonly _tag: 'Task'; readonly task: Task } | { readonly _tag: 'Question'; readonly question: Question; readonly owner: QuestionEvent['owner'] }
        | { readonly _tag: 'Proposal'; readonly proposal: Proposal }
      readonly for: 'Report' | 'Answer' | 'Choose' | 'Assign' | 'Assess' | 'TryAgain' | 'DraftFix'
      readonly read: Of<typeof ReadPosition>
    }

const currentSession = (project: Project, authority: LiveSession): LiveSession | undefined => {
  const session = liveSession(project, authority.key)
  return session?.staff.key === authority.staff.key ? session : undefined
}

export const questionsFor = (project: Project, authority: LiveSession | Of<typeof Human>) => {
  if (project.phase._tag === 'Ended') return []
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
  if (project.phase._tag === 'Ended') return { _tag: 'Awaiting' }
  const current = authority._tag === 'Live' ? currentSession(project, authority) : undefined
  if (current && (on === undefined || on < current.startedIn) && !lastSessionAct(current, events))
    return { _tag: 'Introduction', subject: project, read: project.read }
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
  const pipeline = current && activeWork(project) && pipelineStaff(project)?.key === current.staff.key
  for (const task of project.tasks.values()) {
    const subject = { _tag: 'Task', task } as const
    const fix = pipeline && fixDuty(project, task)
    if (fix) due.push({ _tag: 'Available', subject, for: fix, read: project.read })
    else if (authority._tag === 'Human' && task.phase._tag === 'Raised' && !pendingFix(project, task.key))
      due.push({ _tag: 'Available', subject, for: 'Choose', read: project.read })
    else if (owes(task)) due.push({ _tag: 'Available', subject, for: 'Report', read: project.read })
    else if (current && mayAssignTaskReview(project, events, task, current) === 'Allowed')
      due.push({ _tag: 'Available', subject, for: 'Assign', read: project.read })
  }
  const actor = authority._tag === 'Human' ? { _tag: 'Human' } as const : current && actorFor(project, { _tag: 'Session', key: current.key })
  for (const proposal of project.proposals.values()) {
    const duty = proposalLine[proposal.phase._tag].owes
    const owner = duty === 'Owner' && actor?._tag === 'Human'
    const proposer = actorFor(project, proposal.proposer)
    const proposing = duty === 'Proposer' && actor && proposer && sameActor(proposer, actor)
    if (owner || (proposing && proposal.subject._tag !== 'Fix')) due.push({ _tag: 'Available', subject: { _tag: 'Proposal', proposal },
      for: actor?._tag === 'Human' ? 'Choose' : 'Report', read: project.read })
  }
  const since = ({ subject }: typeof due[number]) =>
    (subject._tag === 'Task' ? subject.task : subject._tag === 'Question' ? subject.question : subject.proposal).changedIn
  return due.sort((left, right) => since(left) - since(right))[0] ?? { _tag: 'Awaiting' }
}
