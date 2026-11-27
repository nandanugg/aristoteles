import { Result, Schema } from 'effect'
import { hostRole,
  ProposalValue, Rationale, actorFor, currentQuestion, quoteIn, RetryCount, VersionNumber, edge, liveSession, proposalLine, refuse, sameActor, staffOf, subagentCapacity,
  validateStaffing, reviewOutcome, ruleCoverage, proposalReviewRules, roleOf, type Project, type Proposal, type ProposalEvent, type Refusal, type Version, proposalText, versionOf,
} from '../schema/project.ts'

const wrongMove = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not apply to the proposal’s phase.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('Use the current proposer, owner or assigned reviewer.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The proposal or its basis has changed.')))

const effectiveVersion = (project: Project, value: ProposalValue): Version<ProposalValue> | undefined => {
  if (value._tag === 'Staffing') return project.staffing._tag === 'StaffingAccepted' ? project.staffing.version : undefined
  if (value._tag !== 'Responsibility') return undefined
  const role = roleOf(project, value.role)
  if (!role) return undefined
  const { responsibility } = role
  return { ...responsibility, value: { ...responsibility.value, _tag: 'Responsibility', role: role.key } }
}

const sameVersion = Schema.toEquivalence(versionOf(ProposalValue))
const latestDirectionVersion = (project: Project, previous: Version<ProposalValue>) => {
  const current = [...project.proposals.values()].some(({ phase, basis }) =>
    phase._tag === 'Accepted' && phase.version.value._tag === 'Direction' &&
    basis._tag === 'Version' && basis.version.acceptedIn === previous.acceptedIn)
  return !current && [...project.proposals.values()].some(({ phase }) =>
    phase._tag === 'Accepted' && sameVersion(phase.version, previous))
}

const validateValue = (
  project: Project, value: ProposalValue, move: 'open' | 'submit' | 'accept',
): Result.Result<ProposalValue, Refusal> => {
  if (value._tag === 'Staffing') return Result.map(validateStaffing(project, value, move), (plan) => ({ ...plan, _tag: 'Staffing' }))
  if (value._tag === 'Responsibility') {
    const role = roleOf(project, value.role)
    return role ? Result.succeed(value) : wrongMove()
  }
  if (value.stages.some(({ role }) => !roleOf(project, role))) return wrongActor()
  return Result.succeed(value)
}

export const applyProposalMove = (project: Project, event: ProposalEvent): Result.Result<Project, Refusal> => {
  const { key, actor, read, number } = event
  const stage = project.proposals.get(key)
  const session = actor._tag === 'Session' ? liveSession(project, actor.key) : undefined
  const acting = actorFor(project, actor)
  const store = (proposal: Proposal): Result.Result<Project, Refusal> =>
    Result.succeed({ ...project, proposals: new Map(project.proposals).set(key, proposal) })
  if (event.from === null) {
    if (stage) return stale()
    if (!acting || (event.input.value._tag === 'Responsibility' && actor._tag !== 'Human')) return wrongActor()
    const previous = event.input.previous._tag === 'Version' ? event.input.previous.version : undefined
    if (previous && (event.input.value._tag !== 'Direction' || previous.value._tag !== 'Direction' ||
        previous.acceptedIn > read || !latestDirectionVersion(project, previous))) return stale()
    return Result.flatMap(validateValue(project, event.input.value, event.move), (value) => {
      const version = previous ?? effectiveVersion(project, value)
      if (version && version.acceptedIn > read) return stale()
      return store({
        key, value, basis: version ? { _tag: 'Version', version } : { _tag: 'None' }, questions: new Map(),
        proposer: actor, retryCount: RetryCount.make(0),
        phase: { _tag: 'Drafting', feedback: { _tag: 'None' } }, changedIn: number,
      })
    })
  }
  if (!stage) return wrongMove()
  if (stage.changedIn > read) return stale()
  const { phase } = stage
  if (phase._tag !== event.from) return wrongMove()
  const move = (phase: Proposal['phase'], fields: Partial<Pick<Proposal, 'value' | 'retryCount'>> = {}) =>
    edge(proposalLine, event.from, event.move, phase._tag) === 'Allowed'
      ? store({ ...stage, ...fields, phase, changedIn: number }) : wrongMove()

  if (event.from === 'Drafting') {
    const proposer = actorFor(project, stage.proposer)
    if (!acting || !proposer || !sameActor(proposer, acting)) return wrongActor()
    const { value } = event.input
    if (stage.value._tag !== value._tag || (stage.value._tag === 'Responsibility' &&
        (value._tag !== 'Responsibility' || stage.value.role !== value.role))) return wrongMove()
    for (const question of stage.questions.values()) {
      if (currentQuestion(stage, question) &&
          (question.state._tag !== 'Answered' || question.changedIn > read)) return stale()
    }
    return Result.flatMap(validateValue(project, value, event.move), (checked) =>
      move({ _tag: 'Reviewing', assignment: { _tag: 'Waiting' } }, { value: checked }))
  }
  if (event.from === 'Reviewing' && phase._tag === 'Reviewing') {
    if (event.move === 'release') {
      if (actor._tag !== 'Human') return wrongActor()
      const ended = project.sessions.get(event.input.session)
      if (phase.assignment._tag !== 'Assigned' || phase.assignment.actor.key !== event.input.session || ended?._tag !== 'Ended')
        return wrongMove()
      if (ended.changedIn > read) return stale()
      return move({ _tag: 'Reviewing', assignment: { _tag: 'Waiting' } })
    }
    const reviewer = staffOf(project, hostRole(project).key)
    if (!session || actor._tag !== 'Session' || !reviewer || reviewer.key !== session.staff.key)
      return Result.fail(refuse('RetiredSession', Rationale.make('Review from the assigned host’s live session.')))
    if (event.move === 'assign') {
      if (phase.assignment._tag !== 'Waiting') return wrongMove()
      if (!subagentCapacity(project, reviewer).freeSubagents)
        return Result.fail(refuse('NoCapacity', Rationale.make('The onboarding host has no free subagent slot.')))
      return move({ _tag: 'Reviewing', assignment: { _tag: 'Assigned', actor, queuedIn: stage.changedIn } })
    }
    const { queuedIn, facts } = event.input
    if (phase.assignment._tag !== 'Assigned' || phase.assignment.actor.key !== session.key || phase.assignment.queuedIn !== queuedIn)
      return Result.fail(refuse('RetiredSession', Rationale.make('Review from the proposal’s fresh child.')))
    const draft = proposalText(stage.value)
    if (ruleCoverage(proposalReviewRules(stage.value._tag), facts.outcomes) !== 'Complete')
      return Result.fail(refuse('InvalidEvidence', Rationale.make('Supply one outcome per built-in rule for this proposal kind.')))
    if ([...facts.outcomes, ...facts.findings].some(({ evidence }) =>
        evidence._tag !== 'Quote' || evidence.file !== 'proposal.json' || quoteIn(evidence, draft) !== 'Found'))
      return Result.fail(refuse('InvalidEvidence', Rationale.make('Cite the submitted draft in proposal.json for each outcome and finding.')))
    if (reviewOutcome(facts) === 'Holds') {
      if (event.move !== 'next') return wrongMove()
      return move({ _tag: 'WaitingForOwner', queuedIn, facts })
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
    : effectiveVersion(project, stage.value)?.acceptedIn !== previous?.acceptedIn) return stale()
  const versionNumber = (previous?.number ?? 0) + 1
  if (!Schema.is(VersionNumber)(versionNumber)) return wrongMove()
  return Result.flatMap(validateValue(project, stage.value, event.move), () =>
    move({ _tag: 'Accepted', version: { number: versionNumber, value: stage.value, acceptedIn: number } }))
}
