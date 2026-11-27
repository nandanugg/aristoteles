import { Result, Schema } from 'effect'
import { hostRole,
  ProposalValue, Rationale, projectLine, approvedProposals, boundHostSession, edge, hostSession, refuse, roleOf, staffOf, versionOf,
  type ProjectPhase, type ProjectEvent, type Project, type Refusal,
} from '../schema/project.ts'

const sameApprovedProposals = Schema.toEquivalence(Schema.NonEmptyArray(versionOf(ProposalValue)))

const wrong = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the activation phase.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The approved activation basis has changed.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('Use the project owner’s activation authority.')))

export const applyProjectPhase = (project: Project, event: Exclude<ProjectEvent, { from: null }>): Result.Result<Project, Refusal> => {
  const { actor, from, move, read, number } = event
  const phase = project.phase
  if (phase._tag !== from) return wrong()
  if (actor._tag !== 'Human') return wrongActor()
  const commit = (next: ProjectPhase) => edge(projectLine, from, move, next._tag) === 'Allowed'
    ? Result.succeed({ ...project, phase: next, changedIn: number }) : wrong()
  if (move === 'apply') {
    const accepted = project.proposals.get(event.input.proposal)?.phase
    if (read !== project.read || accepted?._tag !== 'Accepted' || accepted.version.acceptedIn !== Number(read))
      return stale()
    if (edge(projectLine, from, move, from) !== 'Allowed') return wrong()
    const { value, number: version, acceptedIn } = accepted.version
    if (value._tag === 'Staffing') return Result.succeed({
      ...project, changedIn: number,
      staffing: { _tag: 'StaffingAccepted', version: { number: version, value, acceptedIn } },
    })
    if (value._tag !== 'Responsibility') return wrong()
    const role = roleOf(project, value.role)
    if (!role) return wrong()
    const { summary, introduction, duties } = value
    const updated = { ...role, responsibility: { number: version, value: { summary, introduction, duties }, acceptedIn } }
    return Result.succeed({ ...project, changedIn: number, roles: new Map(project.roles).set(role.key, updated) })
  }
  if (phase._tag === 'Onboarding' && from === 'Onboarding') {
    const proposals = approvedProposals(project)
    const staff = staffOf(project, hostRole(project).key)
    if (!proposals || !staff) return wrong()
    if (project.changedIn > read || proposals.some(({ acceptedIn }) => acceptedIn > read)) return stale()
    return commit({ _tag: 'Activating', approvedIn: number, files: event.input.files, proposals })
  }
  if (phase._tag === 'Activating' && from === 'Activating') {
    if (move === 'back') return commit({ ...phase, _tag: 'RollingBack', why: event.input.why })
    const host = hostSession(project)
    if (host?._tag !== 'Live' || host.key !== event.input.session || host.startedIn <= phase.approvedIn)
      return wrong()
    if (read !== project.read || host.startedIn !== Number(read)) return stale()
    const proposals = approvedProposals(project)
    if (!proposals || !sameApprovedProposals(proposals, phase.proposals)) return stale()
    return commit({ ...phase, _tag: 'Active', work: { _tag: 'NotStarted' } })
  }
  if (phase._tag === 'RollingBack' && from === 'RollingBack') return commit({ _tag: 'Onboarding' })
  if (phase._tag !== 'Active' || from !== 'Active') return wrong()
  if (project.changedIn > read) return stale()
  if (event.move === 'end')
    return [...project.sessions.values()].every((session) => session._tag === 'Ended')
      ? commit({ _tag: 'Ended', endedIn: number }) : wrong()
  const host = staffOf(project, hostRole(project).key)
  return phase.work._tag === 'NotStarted' && (boundHostSession(project) || [...project.sessions.values()].some((session) =>
    session.staff.key === host?.key && session._tag === 'Ended' && session.startedIn > phase.approvedIn)) ? commit({ ...phase, work: { _tag: 'Started', startedIn: number } }) : wrong()
}
