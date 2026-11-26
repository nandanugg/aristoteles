import { Result, Schema } from 'effect'
import {
  Rationale, RetryCount, VersionNumber, edge, liveSession, proposalLine, refuse, staffOf, subagentCapacity,
  validateStaffing, reviewOutcome, type Project, type Proposal, type ProposalEvent, type ProposalValue, type Refusal, type StoredActor,
} from '../schema/project.ts'

const wrongMove = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not apply to the proposal’s phase.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('Use the current proposer, owner or assigned reviewer.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The proposal or its basis has changed.')))

const actorOf = (project: Project, by: StoredActor): Proposal['proposer'] | undefined =>
  by._tag === 'Human' ? (by.id === project.owner.id ? project.owner : undefined) : project.staff.get(by.id)

const effectiveVersion = (project: Project, value: ProposalValue) => {
  if (value._tag === 'Staffing') return project.staffing?.version
  const versions = [...project.proposals.values()].flatMap((proposal) =>
    proposal.phase._tag === 'Accepted' && proposal.value._tag === value._tag && proposal.value.id === value.id
      ? [proposal.phase.version] : [])
  return versions.sort((left, right) => right.acceptedAt - left.acceptedAt)[0] ??
    (value._tag === 'Responsibility' ? project.roles.get(value.role.id)?.responsibility : undefined)
}

const validateValue = (project: Project, value: ProposalValue): Result.Result<ProposalValue, Refusal> => {
  if (value._tag === 'Staffing') return Result.map(validateStaffing(project, value), (plan) => ({ ...plan, _tag: 'Staffing' }))
  if (value._tag === 'Responsibility') {
    const role = project.roles.get(value.role.id)
    return role?.responsibility.value.id === value.id ? Result.succeed({ ...value, role }) : wrongMove()
  }
  if (value.owner.id !== project.owner.id || value.stages.some(({ role }) => !project.roles.has(role.id))) return wrongActor()
  return Result.succeed(value)
}

export const applyProposalMove = (project: Project, event: ProposalEvent): Result.Result<Project, Refusal> => {
  const { line, actor, read, number } = event
  const stage = project.proposals.get(line.id)
  const store = (proposal: Proposal, state = project): Result.Result<Project, Refusal> => {
    const proposals = new Map(state.proposals)
    proposals.set(line.id, proposal)
    return Result.succeed({ ...state, proposals })
  }
  if (event.from === null) {
    if (stage) return stale()
    const proposer = actorOf(project, actor)
    if (!proposer || (event.input.value._tag === 'Responsibility' && proposer._tag !== 'Human')) return wrongActor()
    if (actor._tag === 'Staff' && ![...project.sessions.values()].some(({ _tag, staff, startedAt }) =>
        _tag === 'Live' && staff.id === actor.id && startedAt <= read)) return wrongActor()
    return Result.flatMap(validateValue(project, event.input.value), (value) => store({
      id: line.id, value, basis: effectiveVersion(project, value)?.acceptedAt ?? null,
      proposer, owner: project.owner, reviewer: project.host, retryCount: RetryCount.make(0),
      phase: { _tag: 'Drafting', feedback: null }, lastChange: number,
    }))
  }
  if (!stage) return wrongMove()
  if (stage.lastChange > read) return stale()
  const { phase } = stage
  if (phase._tag !== event.from) return wrongMove()
  const move = (phase: Proposal['phase'], fields: Partial<Pick<Proposal, 'value' | 'retryCount'>> = {}) =>
    edge(proposalLine, event.from, event.move, phase._tag) === 'Allowed'
      ? store({ ...stage, ...fields, phase, lastChange: number }) : wrongMove()

  if (event.from === 'Drafting') {
    if (actor.id !== stage.proposer.id || actor._tag !== stage.proposer._tag) return wrongActor()
    const { value, question } = event.input
    if (stage.value.id !== value.id || stage.value._tag !== value._tag) return wrongMove()
    if (actor._tag === 'Staff' && ![...project.sessions.values()].some(({ _tag, staff, startedAt }) =>
        _tag === 'Live' && staff.id === actor.id && startedAt <= read)) return wrongActor()
    const consult = [...project.questions.values()].find((item) => item.about._tag === 'Staffing' &&
      item.about.proposal.id === stage.id && item.about.proposal.basis === stage.lastChange)
    if (consult ? question?.id !== consult.id || consult.state._tag !== 'Answered' : question !== null) return stale()
    return Result.flatMap(validateValue(project, value), (checked) =>
      move({ _tag: 'Reviewing', review: { _tag: 'Waiting' } }, { value: checked }))
  }
  if (event.from === 'Reviewing' && phase._tag === 'Reviewing') {
    const { run, facts } = event.input
    const session = liveSession(project, run.session.id)
    const reviewer = staffOf(project, stage.reviewer)
    if (!session || !reviewer || actor._tag !== 'Staff' || actor.id !== reviewer.id || actor.id !== session.staff.id)
      return Result.fail(refuse('RetiredSession', Rationale.make('Review from the assigned host’s live session.')))
    if (facts === null) {
      if (event.move !== 'next' || phase.review._tag !== 'Waiting') return wrongMove()
      if (!subagentCapacity(project, reviewer).freeSubagents)
        return Result.fail(refuse('NoCapacity', Rationale.make('The onboarding host has no free subagent slot.')))
      return move({ _tag: 'Reviewing', review: { _tag: 'By', run: { id: run.id, session } } })
    }
    if (phase.review._tag !== 'By' || phase.review.run.id !== run.id || phase.review.run.session.id !== session.id)
      return Result.fail(refuse('RetiredSession', Rationale.make('Review from the proposal’s fresh child.')))
    if (reviewOutcome(facts) === 'Holds') {
      if (event.move !== 'next') return wrongMove()
      return move({ _tag: 'WaitingForOwner', review: phase.review.run, facts })
    }
    if (event.move !== 'sendBack') return wrongMove()
    const retries = stage.retryCount + 1
    if (!Schema.is(RetryCount)(retries)) return wrongMove()
    return move({ _tag: 'Drafting', feedback: facts }, { retryCount: retries })
  }
  if (event.from !== 'WaitingForOwner' || actor._tag !== 'Human' || actor.id !== project.owner.id) return wrongActor()
  if (event.move === 'remove') return move({ _tag: 'Removed' })
  if (event.move === 'sendBack') return move({ _tag: 'Drafting', feedback: event.input.why })
  const previous = effectiveVersion(project, stage.value)
  const basis = previous?.acceptedAt ?? null
  if (basis !== stage.basis) return stale()
  const versionNumber = (previous ? 'number' in previous ? previous.number : previous.id.number : 0) + 1
  if (!Schema.is(VersionNumber)(versionNumber)) return wrongMove()
  return Result.flatMap(validateValue(project, stage.value), (value) => {
    // Keep the exact reviewed payload in the version. Derived runtime assignments use checked records.
    const version = { number: versionNumber, value: stage.value, acceptedAt: number }
    let state = project
    if (value._tag === 'Staffing' && stage.value._tag === 'Staffing') {
      state = { ...project, staffingAt: number, staffing: {
        _tag: 'StaffingAccepted', version: { ...version, value: stage.value },
      }, staff: new Map(value.staff.map((staff) => [staff.id, staff])),
      subscriptions: new Map(value.subscriptions.map((subscription) => [subscription.id, subscription])) }
    } else if (value._tag === 'Responsibility') {
      const { id, summary, introduction, duties } = value
      const role = { ...value.role, responsibility: {
        id: { subject: id, number: versionNumber }, value: { id, summary, introduction, duties }, acceptedAt: number,
      } }
      const roles = new Map(project.roles)
      roles.set(role.id, role)
      const staff = new Map([...project.staff].map(([id, staff]) => {
        const [first, ...rest] = staff.roles
        const updated = (assigned: typeof first) => assigned.id === role.id ? role : assigned
        return [id, { ...staff, roles: [updated(first), ...rest.map(updated)] as const }]
      }))
      state = { ...project, roles, staff, host: project.host.id === role.id ? role : project.host,
        pipeline: project.pipeline.id === role.id ? role : project.pipeline }
    }
    return store({ ...stage, phase: { _tag: 'Accepted', version }, lastChange: number }, state)
  })
}
