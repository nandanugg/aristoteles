import { Result } from 'effect'
import { hostRole,
  Rationale, projectLine, approvedProposals, boundHostSession, edge, refuse, staffOf,
  type ProjectPhase, type ProjectEvent, type Project, type Refusal,
} from '../schema/project.ts'

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
  if (phase._tag === 'Onboarding' && from === 'Onboarding') {
    const proposals = approvedProposals(project)
    const staff = staffOf(project, hostRole(project).key)
    if (!proposals || !staff) return wrong()
    if (project.changedIn > read || proposals.some(({ acceptedIn }) => acceptedIn > read)) return stale()
    return commit({ _tag: 'Activating', approvedIn: number, files: event.input.files, proposals })
  }
  if (phase._tag === 'Activating' && from === 'Activating')
    return commit({ ...phase, _tag: 'RollingBack', why: event.input.why })
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
