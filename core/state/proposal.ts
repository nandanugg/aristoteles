import { Result, Schema } from 'effect'
import {
  FileContents, Rationale, currentQuestion, quoteIn, RetryCount, VersionNumber, edge, liveSession, proposalLine, refuse, staffOf, subagentCapacity,
  validateStaffing, reviewOutcome, roleOf, type Project, type Proposal, type ProposalEvent, type ProposalValue, type Refusal, type StoredActor, type Version,
} from '../schema/project.ts'

const wrongMove = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not apply to the proposal’s phase.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('Use the current proposer, owner or assigned reviewer.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The proposal or its basis has changed.')))

const actorOf = (project: Project, by: StoredActor): Proposal['proposer'] | undefined =>
  by._tag === 'Human' ? project.owner : project.staff.get(by.key)

const effectiveVersion = (project: Project, value: ProposalValue): Version<ProposalValue> | undefined => {
  if (value._tag === 'Staffing') return project.staffing?.version
  if (value._tag !== 'Responsibility') return undefined
  const role = roleOf(project, value.role.key)
  if (!role) return undefined
  const { responsibility } = role
  return { ...responsibility, value: { ...responsibility.value, _tag: 'Responsibility', role } }
}

const latestDirectionVersion = (project: Project, previous: Version<ProposalValue>) => {
  const current = [...project.proposals.values()].some(({ phase, basis }) =>
    phase._tag === 'Accepted' && phase.version.value._tag === 'Direction' &&
    basis._tag === 'Version' && basis.version.acceptedAt === previous.acceptedAt)
  return !current && [...project.proposals.values()].some(({ phase }) =>
    phase._tag === 'Accepted' && JSON.stringify(phase.version) === JSON.stringify(previous))
}

const validateValue = (project: Project, value: ProposalValue): Result.Result<ProposalValue, Refusal> => {
  if (value._tag === 'Staffing') return Result.map(validateStaffing(project, value), (plan) => ({ ...plan, _tag: 'Staffing' }))
  if (value._tag === 'Responsibility') {
    const role = roleOf(project, value.role.key)
    return role ? Result.succeed({ ...value, role }) : wrongMove()
  }
  if (value.owner.name !== project.owner.name || value.stages.some(({ role }) => !roleOf(project, role.key))) return wrongActor()
  return Result.succeed(value)
}

export const applyProposalMove = (project: Project, event: ProposalEvent): Result.Result<Project, Refusal> => {
  const { key, actor, read, number } = event
  const stage = project.proposals.get(key)
  const store = (proposal: Proposal, state = project): Result.Result<Project, Refusal> => {
    const proposals = new Map(state.proposals)
    proposals.set(key, proposal)
    return Result.succeed({ ...state, proposals })
  }
  if (event.from === null) {
    if (stage) return stale()
    const proposer = actorOf(project, actor)
    if (!proposer || (event.input.value._tag === 'Responsibility' && proposer._tag !== 'Human')) return wrongActor()
    if (actor._tag === 'Staff' && ![...project.sessions.values()].some(({ _tag, staff, startedAt }) =>
        _tag === 'Live' && staff.key === actor.key && startedAt <= read)) return wrongActor()
    const previous = event.input.previous._tag === 'Version' ? event.input.previous.version : undefined
    if (previous && (event.input.value._tag !== 'Direction' || previous.value._tag !== 'Direction' ||
        previous.acceptedAt > read || !latestDirectionVersion(project, previous))) return stale()
    if (event.input.value._tag === 'Responsibility' &&
        JSON.stringify(roleOf(project, event.input.value.role.key)) !== JSON.stringify(event.input.value.role)) return stale()
    return Result.flatMap(validateValue(project, event.input.value), (value) => {
      const version = previous ?? effectiveVersion(project, value)
      if (version && version.acceptedAt > read) return stale()
      return store({
        key, value, basis: version ? { _tag: 'Version', version } : { _tag: 'None' }, questions: new Map(),
        proposer, owner: project.owner, reviewer: project.roles.host, retryCount: RetryCount.make(0),
        phase: { _tag: 'Drafting', feedback: { _tag: 'None' } }, lastChange: number,
      })
    })
  }
  if (!stage) return wrongMove()
  if (stage.lastChange > read) return stale()
  const { phase } = stage
  if (phase._tag !== event.from) return wrongMove()
  const move = (phase: Proposal['phase'], fields: Partial<Pick<Proposal, 'value' | 'retryCount'>> = {}) =>
    edge(proposalLine, event.from, event.move, phase._tag) === 'Allowed'
      ? store({ ...stage, ...fields, phase, lastChange: number }) : wrongMove()

  if (event.from === 'Drafting') {
    if (actor._tag !== stage.proposer._tag || (actor._tag === 'Staff' &&
        (stage.proposer._tag !== 'Staff' || actor.key !== stage.proposer.key))) return wrongActor()
    const { value } = event.input
    if (stage.value._tag !== value._tag || (stage.value._tag === 'Responsibility' &&
        (value._tag !== 'Responsibility' || JSON.stringify(stage.value.role) !== JSON.stringify(value.role)))) return wrongMove()
    if (actor._tag === 'Staff' && ![...project.sessions.values()].some(({ _tag, staff, startedAt }) =>
        _tag === 'Live' && staff.key === actor.key && startedAt <= read)) return wrongActor()
    for (const question of stage.questions.values()) {
      if (currentQuestion(stage, question) &&
          (question.state._tag !== 'Answered' || question.lastChange > read)) return stale()
    }
    return Result.flatMap(validateValue(project, value), (checked) =>
      move({ _tag: 'Reviewing', assignment: { _tag: 'Waiting' } }, { value: checked }))
  }
  if (event.from === 'Reviewing' && phase._tag === 'Reviewing') {
    const { session: claimed } = event.input
    const session = liveSession(project, claimed.key)
    const reviewer = staffOf(project, stage.reviewer)
    if (!session || !reviewer || actor._tag !== 'Staff' || actor.key !== reviewer.key || actor.key !== session.staff.key)
      return Result.fail(refuse('RetiredSession', Rationale.make('Review from the assigned host’s live session.')))
    if (event.move === 'assign') {
      if (phase.assignment._tag !== 'Waiting') return wrongMove()
      if (!subagentCapacity(project, reviewer).freeSubagents)
        return Result.fail(refuse('NoCapacity', Rationale.make('The onboarding host has no free subagent slot.')))
      return move({ _tag: 'Reviewing', assignment: { _tag: 'Assigned', by: session.staff, review: stage.lastChange } })
    }
    const { review, facts } = event.input
    if (phase.assignment._tag !== 'Assigned' || phase.assignment.by.key !== session.staff.key || phase.assignment.review !== review)
      return Result.fail(refuse('RetiredSession', Rationale.make('Review from the proposal’s fresh child.')))
    const draft = FileContents.make(JSON.stringify(stage.value, null, 2))
    if (facts.outcomes.length === 0 || facts.outcomes.some((outcome) => 'rule' in outcome) ||
        facts.findings.some(({ evidence }) => evidence._tag !== 'Quote' || evidence.file !== 'proposal.json' ||
          quoteIn(evidence, draft) !== 'Found'))
      return Result.fail(refuse('InvalidEvidence', Rationale.make('Review the draft and cite any finding in proposal.json.')))
    if (reviewOutcome(facts) === 'Holds') {
      if (event.move !== 'next') return wrongMove()
      return move({ _tag: 'WaitingForOwner', by: phase.assignment.by, review, facts })
    }
    if (event.move !== 'sendBack') return wrongMove()
    const retries = stage.retryCount + 1
    if (!Schema.is(RetryCount)(retries)) return wrongMove()
    return move({ _tag: 'Drafting', feedback: { _tag: 'Review', facts } }, { retryCount: retries })
  }
  if (event.from !== 'WaitingForOwner' || actor._tag !== 'Human') return wrongActor()
  if (event.move === 'remove') return move({ _tag: 'Removed' })
  if (event.move === 'sendBack') return move({ _tag: 'Drafting', feedback: { _tag: 'Owner', why: event.input.why } })
  const previous = stage.basis._tag === 'Version' ? stage.basis.version : undefined
  if (stage.value._tag === 'Direction' ? previous && !latestDirectionVersion(project, previous)
    : effectiveVersion(project, stage.value)?.acceptedAt !== previous?.acceptedAt) return stale()
  const versionNumber = (previous?.number ?? 0) + 1
  if (!Schema.is(VersionNumber)(versionNumber)) return wrongMove()
  return Result.flatMap(validateValue(project, stage.value), (value) => {
    // Keep the exact reviewed payload in the version. Derived runtime assignments use checked records.
    const version = { number: versionNumber, value: stage.value, acceptedAt: number }
    let state = project
    if (value._tag === 'Staffing' && stage.value._tag === 'Staffing') {
      state = { ...project, staffing: {
        _tag: 'StaffingAccepted', version: { ...version, value: stage.value },
      }, staff: new Map(value.staff.map((staff) => [staff.key, staff])),
      subscriptions: new Map(value.subscriptions.map((subscription) => [subscription.key, subscription])) }
    } else if (value._tag === 'Responsibility') {
      const { summary, introduction, duties } = value
      const role = { ...value.role, responsibility: {
        number: versionNumber, value: { summary, introduction, duties }, acceptedAt: number,
      } }
      const { roles } = project
      const updatedRoles = roles.host.key === role.key ? { ...roles, host: role }
        : roles.pipeline.key === role.key ? { ...roles, pipeline: role }
        : { ...roles, work: new Map(roles.work).set(role.key, role) }
      const staff = new Map([...project.staff].map(([key, staff]) => {
        const [first, ...rest] = staff.roles
        const updated = (assigned: typeof first) => assigned.key === role.key ? role : assigned
        return [key, { ...staff, roles: [updated(first), ...rest.map(updated)] as const }]
      }))
      state = { ...project, roles: updatedRoles, staff }
    }
    return store({ ...stage, phase: { _tag: 'Accepted', version }, lastChange: number }, state)
  })
}
