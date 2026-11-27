import {
  ReadPosition, actorFor, boundHostSession, pipelineStaff, staffByKey, taskReviewStaff, taskRole,
  type LiveSession, type Of, type Project, type StoredEvent,
} from '../../schema/project.ts'

export const lastSessionAct = (session: LiveSession, events: readonly StoredEvent[]): StoredEvent | undefined =>
  events.findLast((event) => event.actor._tag === 'Session' && event.actor.key === session.key &&
    // A review child and an assignment use the session's actor without advancing its read.
    !((event.line === 'Task' || event.line === 'Proposal') && event.from === 'Reviewing'))

export const sessionRead = (
  session: LiveSession, events: readonly StoredEvent[], on?: Of<typeof ReadPosition>,
): Of<typeof ReadPosition> => {
  const reservedIn = events.find((event) =>
    event.line === 'Session' && event.key === session.key && event.from === null)?.number ?? session.startedIn
  return ReadPosition.make(Math.max(reservedIn, on ?? lastSessionAct(session, events)?.read ?? reservedIn))
}

export const sessionUpdates = (
  project: Project, session: LiveSession, events: readonly StoredEvent[], after: Of<typeof ReadPosition>,
): readonly StoredEvent[] => {
  const staff = staffByKey(project, session.staff.key) ?? session.staff
  const addressed = (actor: ReturnType<typeof actorFor>) => actor?._tag === 'Staff' && actor.key === staff.key
  const pipeline = pipelineStaff(project)?.key === staff.key
  const boundHost = boundHostSession(project)?.key === session.key
  return events.filter((event) => {
    if (event.number <= after || event.number > project.read) return false
    switch (event.line) {
      case 'Project': {
        if (event.move === 'apply') {
          const proposal = project.proposals.get(event.input.proposal)
          if (proposal?.phase._tag !== 'Accepted') return false
          const { value } = proposal.phase.version
          return value._tag === 'Responsibility' ? staff.roles.includes(value.role)
            : value._tag === 'Staffing' && (value.staff.has(staff.key) || addressed(actorFor(project, proposal.proposer)))
        }
        if (event.from === 'Activating' && event.move === 'next') return event.input.session === session.key
        return event.from === 'Active' && event.move === 'start' && boundHost
      }
      case 'Session':
        return event.key === session.key && (event.from === 'Starting' && event.move === 'next' || event.from === 'Paused' || event.from === 'Live')
      case 'Question': {
        if (event.from === null) return addressed(event.input.to)
        const { owner, key } = event
        const questions = owner._tag === 'Project' ? project.questions : owner._tag === 'Proposal'
          ? project.proposals.get(owner.key)?.questions : project.tasks.get(owner.key)?.questions
        const question = questions?.get(key)
        return !!question && addressed(actorFor(project, question.from))
      }
      case 'Proposal': {
        const proposal = project.proposals.get(event.key)
        if (!proposal) return false
        if (proposal.subject._tag === 'Fix' && pipeline && (event.move === 'submitFix' || event.move === 'sendBack' ||
            event.move === 'withdrawFix' || event.move === 'accept' || event.move === 'releaseFixReview')) return true
        if (event.from === 'WaitingForOwner' && event.move === 'accept')
          return proposal.phase._tag === 'Accepted' && proposal.phase.version.value._tag === 'Direction'
        if (event.from === 'Reviewing' && event.move === 'assign')
          return event.actor._tag === 'Session' && event.actor.key === session.key
        return (event.move === 'sendBack' || event.move === 'remove') && addressed(actorFor(project, proposal.proposer))
      }
      case 'Task': {
        const task = project.tasks.get(event.key)
        if (!task) return false
        if (event.from === 'Reviewing' && event.move === 'assign')
          return event.actor._tag === 'Session' && event.actor.key === session.key
        const assignee = staff.roles.includes(taskRole(task))
        if (event.from === 'ReadyToReview' || event.move === 'release') return taskReviewStaff(project, task)?.key === staff.key
        if (event.from === 'Raised') return pipeline || assignee || boundHost
        if (event.move === 'raise') return pipeline || assignee || boundHost
        if (event.from === 'Reviewing') return assignee || boundHost
        return assignee && (event.from === null || event.move === 'restart')
      }
    }
  })
}
