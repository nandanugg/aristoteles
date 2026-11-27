import { Result } from 'effect'
import {
  Rationale, activationLine, approvedProposals, boundHostSession, edge, refuse, staffOf,
  type Activation, type ActivationEvent, type Project, type Refusal,
} from '../schema/project.ts'

const wrong = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the activation phase.')))
const retired = () => Result.fail(refuse('RetiredSession', Rationale.make('Use the current activation host.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The approved activation basis has changed.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('Use the project owner’s activation authority.')))

export const applyActivationMove = (project: Project, event: ActivationEvent): Result.Result<Project, Refusal> => {
  const { actor, from, move, read, number } = event
  const phase = project.activation
  if (phase._tag !== from) return wrong()
  if (move !== 'use' && (actor._tag !== 'Human')) return wrongActor()
  const commit = (activation: Activation) => edge(activationLine, from, move, activation._tag) === 'Allowed'
    ? Result.succeed({ ...project, activation, lastChange: number }) : wrong()
  if (phase._tag === 'Onboarding' && from === 'Onboarding') {
    const proposals = approvedProposals(project)
    const staff = staffOf(project, project.roles.host)
    if (!proposals || !staff) return wrong()
    if (project.lastChange > read || proposals.some(({ acceptedAt }) => acceptedAt > read)) return stale()
    return commit({ _tag: 'Activating', at: number, files: event.input.files, proposals, staff })
  }
  if (phase._tag === 'Activating' && from === 'Activating')
    return commit({ ...phase, _tag: 'RollingBack', why: event.input.why })
  if (phase._tag === 'RollingBack' && from === 'RollingBack') return commit({ _tag: 'Onboarding' })
  if (phase._tag !== 'Active' || from !== 'Active') return wrong()
  if (event.move === 'use') {
    return actor._tag === 'Staff' && actor.key === phase.staff.key && event.input.session.key === boundHostSession(project)?.key &&
      phase.work._tag === 'Started' ? commit({ ...phase, work: { _tag: 'Used', at: phase.work.at, usedAt: number } }) : retired()
  }
  if (project.lastChange > read) return stale()
  return phase.work._tag === 'NotStarted' && (boundHostSession(project) || [...project.sessions.values()].some((session) =>
    session.staff.key === phase.staff.key && session._tag === 'Ended' && session.startedAt > phase.at)) ? commit({ ...phase, work: { _tag: 'Started', at: number } }) : wrong()
}
