import { Result } from 'effect'
import {
  Rationale, activationLine, approvedProposals, edge, refuse, staffOf,
  type Activation, type ActivationEvent, type Project, type Refusal,
} from '../schema/project.ts'

const wrong = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the activation phase.')))
const retired = () => Result.fail(refuse('RetiredSession', Rationale.make('Use the current activation host.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The approved activation basis has changed.')))

export const applyActivationMove = (project: Project, event: ActivationEvent): Result.Result<Project, Refusal> => {
  const { actor, from, move, read, number } = event
  const phase = project.activation
  if (event.line.id !== project.id || phase._tag !== from) return wrong()
  if (move !== 'use' && (actor._tag !== 'Human' || actor.id !== project.owner.id))
    return Result.fail(refuse('WrongActor', Rationale.make('Use the project owner’s activation authority.')))
  const commit = (activation: Activation) => edge(activationLine, from, move, activation._tag) === 'Allowed'
    ? Result.succeed({ ...project, activation, lastChange: number }) : wrong()
  if (phase._tag === 'Onboarding' && from === 'Onboarding') {
    const proposals = approvedProposals(project)
    const staff = staffOf(project, project.host)
    if (!proposals || !staff) return wrong()
    if (project.lastChange > read || proposals.some(({ acceptedAt }) => acceptedAt > read)) return stale()
    return commit({ _tag: 'Activating', at: number, files: event.input.files, proposals, staff, launches: [] })
  }
  if (phase._tag === 'RollingBack' && from === 'RollingBack') return commit({ _tag: 'Onboarding' })
  if (phase._tag === 'Activating' && from === 'Activating') {
    if (event.move === 'reserve') {
      if (phase.launches.some(({ id }) => id === event.input.id)) return stale()
      return commit({ ...phase, launches: [...phase.launches, { id: event.input.id, pane: null }] })
    }
    if (event.move === 'back') return commit({ ...phase, _tag: 'RollingBack', why: event.input.why })
    const launch = phase.launches.at(-1)
    if (!launch || launch.id !== event.input.id) return retired()
    if (event.move === 'acknowledge') {
      if (launch.pane) return stale()
      return commit({ ...phase, launches: [...phase.launches.slice(0, -1), event.input] })
    }
    if (launch.pane?.address !== event.input.pane.address) return retired()
    const proposals = approvedProposals(project)
    if (!proposals || JSON.stringify(proposals) !== JSON.stringify(phase.proposals)) return stale()
    const { files, at, staff, launches } = phase
    return commit({ _tag: 'Active', files, at, staff, proposals, launches, binding: event.input, replacement: null, work: { _tag: 'NotStarted' } })
  }
  if (phase._tag !== 'Active' || from !== 'Active') return wrong()
  if (event.move === 'use') {
    return actor._tag === 'Staff' && actor.id === phase.staff.id && event.input.id === phase.binding.id &&
      phase.work._tag === 'Started' ? commit({ ...phase, work: { _tag: 'Used', at: phase.work.at, usedAt: number } }) : retired()
  }
  if (event.move === 'start') {
    if (project.lastChange > read) return stale()
    return phase.work._tag === 'NotStarted' ? commit({ ...phase, work: { _tag: 'Started', at: number } }) : wrong()
  }
  if (event.move === 'reserve') {
    if (phase.work._tag !== 'NotStarted' || phase.replacement || phase.launches.some(({ id }) => id === event.input.id)) return wrong()
    return commit({ ...phase, replacement: { id: event.input.id, pane: null }, launches: [...phase.launches, { id: event.input.id, pane: null }] })
  }
  if (phase.replacement?.id !== event.input.id) return retired()
  if (event.move === 'cancel') return commit({ ...phase, replacement: null })
  if (phase.work._tag !== 'NotStarted') return wrong()
  if (event.move === 'acknowledge') {
    if (phase.replacement.pane) return stale()
    return commit({ ...phase, replacement: { id: event.input.id, pane: event.input.pane } })
  }
  if (phase.replacement.pane?.address !== event.input.pane.address) return retired()
  return commit({ ...phase, binding: event.input })
}
