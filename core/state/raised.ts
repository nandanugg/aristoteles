import { Result } from 'effect'
import {
  Rationale, RetryCount, assessmentEligibility, takeAsIsEligibility, liveSession, pendingFix, pipelineStaff, refuse, staffedIn, taskRole,
  type Project, type ProposalValue, type Refusal, type Task, type TaskEvent, type TaskPhase,
} from '../schema/project.ts'

type RaisedMove = Extract<TaskEvent, { from: 'Raised' }>

export const applyRaisedMove = (
  project: Project, task: Task, event: RaisedMove,
  enter: (phase: TaskPhase, fields?: Partial<Pick<Task, 'direction' | 'automaticRetry' | 'retryCount'>>) => Result.Result<Task, Refusal>,
): Result.Result<Task, Refusal> => {
  const raised = task.phase
  const wrong = () => Result.fail(refuse('WrongMove', Rationale.make('That choice does not follow the current Raised case.')))
  const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('Use the pipeline’s live session or the owner’s choice for this move.')))
  const { actor, move, read } = event
  if (raised._tag !== 'Raised') return wrong()
  const { fix, retained } = raised
  const pending = pendingFix(project, task.key)
  if (pending && pending.changedIn > read)
    return Result.fail(refuse('Stale', Rationale.make('Read the current fix proposal before acting on the task.')))
  if (move === 'drop') return actor._tag === 'Human' ? enter({ _tag: 'Dropped', why: event.input.why }) : wrongActor()
  if (move === 'takeAsIs') {
    if (actor._tag !== 'Human') return wrongActor()
    if (retained._tag !== 'Retained' || takeAsIsEligibility(raised) !== 'Allowed') return wrong()
    return enter({
      _tag: 'Done', result: retained.result, outcomes: retained.outcomes, accepted: { _tag: 'Owner', why: event.input.why },
    })
  }
  if (move === 'applyFix') {
    if (actor._tag !== 'Human') return wrongActor()
    const proposal = project.proposals.get(event.input.proposal)
    if (!proposal || proposal.subject._tag !== 'Fix' || proposal.subject.task !== task.key) return wrong()
    if (fix._tag !== 'Assessed' || proposal.phase._tag !== 'Accepted' ||
        proposal.changedIn <= task.changedIn || proposal.changedIn > read) return wrong()
    const { version } = proposal.phase
    if (version.value._tag === 'Direction') {
      if (proposal.changedIn !== Number(read)) return wrong()
      return enter({ _tag: 'Sent', feedback: { _tag: 'None' } }, {
        direction: { ...version, value: version.value }, retryCount: RetryCount.make(0),
      })
    }
    if (version.value._tag !== 'Staffing' || read !== version.acceptedIn + 1 || staffedIn(project) !== version.acceptedIn ||
        retained._tag !== 'Retained') return wrong()
    return enter({ _tag: 'Sent', feedback: retained.feedback }, { retryCount: RetryCount.make(0) })
  }
  const session = actor._tag === 'Session' ? liveSession(project, actor.key) : undefined
  if (!session || session.staff.key !== pipelineStaff(project)?.key) return wrongActor()
  if (read < session.startedIn) return Result.fail(refuse('Stale', Rationale.make('Read this case from the live pipeline session.')))
  if (move === 'tryAgain') {
    if (fix._tag !== 'Assessed' || fix.assessment.missed === 'Guidance' || task.automaticRetry !== 'Available' ||
        retained._tag !== 'Retained' || pending) return wrong()
    return enter({ _tag: 'Sent', feedback: retained.feedback }, { automaticRetry: 'Used', retryCount: RetryCount.make(0) })
  }
  if (assessmentEligibility(raised) !== 'Allowed') return wrong()
  const { missed } = event.input
  if (missed === 'Staff' && (retained._tag !== 'Retained' || retained.feedback._tag !== 'Review')) return wrong()
  if (pending && (pending.phase._tag !== 'Drafting' || pending.phase.feedback._tag !== 'Owner' ||
      pending.changedIn <= task.changedIn)) return wrong()
  return enter({ ...raised, fix: { _tag: 'Assessed', assessment: event.input } })
}

// The first submission and revised drafts use the same leaf-scoped check.
export const fixKind = (task: Task) => {
  if (task.phase._tag !== 'Raised' || task.phase.fix._tag === 'Unassessed') return undefined
  switch (task.phase.fix.assessment.missed) {
    case 'Guidance': return 'Direction'
    case 'Staff':
    case 'MovingTarget': return task.automaticRetry === 'Used' ? 'Staffing' : undefined
  }
}

export const staffForFix = (task: Task, value: Extract<ProposalValue, { _tag: 'Staffing' }>) =>
  [...value.staff.values()].find(({ roles }) => roles.includes(taskRole(task)))
