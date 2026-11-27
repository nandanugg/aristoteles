import { Result } from 'effect'
import {
  Rationale, activationLine, approvedProposals, edge, hostLaunchLine, refuse, staffOf,
  type Activation, type ActivationEvent, type HostLaunch, type HostLaunchEvent, type Project, type Refusal,
} from '../schema/project.ts'

const wrong = () => Result.fail(refuse('WrongMove', Rationale.make('That move does not follow the activation phase.')))
const retired = () => Result.fail(refuse('RetiredSession', Rationale.make('Use the current activation host.')))
const stale = () => Result.fail(refuse('Stale', Rationale.make('The approved activation basis has changed.')))
const wrongActor = () => Result.fail(refuse('WrongActor', Rationale.make('Use the project owner’s activation authority.')))

export const applyActivationMove = (project: Project, event: ActivationEvent): Result.Result<Project, Refusal> => {
  const { actor, from, move, read, number } = event
  const phase = project.activation
  if (event.line.id !== project.id || phase._tag !== from) return wrong()
  if (move !== 'use' && (actor._tag !== 'Human' || actor.id !== project.owner.id)) return wrongActor()
  const commit = (activation: Activation) => edge(activationLine, from, move, activation._tag) === 'Allowed'
    ? Result.succeed({ ...project, activation, lastChange: number }) : wrong()
  if (phase._tag === 'Onboarding' && from === 'Onboarding') {
    const proposals = approvedProposals(project)
    const staff = staffOf(project, project.roles.host)
    if (!proposals || !staff) return wrong()
    if (project.lastChange > read || proposals.some(({ acceptedAt }) => acceptedAt > read)) return stale()
    return commit({ _tag: 'Activating', at: number, files: event.input.files, proposals, staff, launches: [] })
  }
  if (phase._tag === 'Activating' && from === 'Activating')
    return commit({ ...phase, _tag: 'RollingBack', why: event.input.why })
  if (phase._tag === 'RollingBack' && from === 'RollingBack') return commit({ _tag: 'Onboarding' })
  if (phase._tag !== 'Active' || from !== 'Active') return wrong()
  if (event.move === 'use') {
    return actor._tag === 'Staff' && actor.id === phase.staff.id && event.input.id === phase.binding.id &&
      phase.work._tag === 'Started' ? commit({ ...phase, work: { _tag: 'Used', at: phase.work.at, usedAt: number } }) : retired()
  }
  if (event.move === 'clearReplacement') {
    return phase.replacement?._tag === 'Bound' && phase.replacement.id === event.input.id
      ? commit({ ...phase, launches: [...phase.launches, phase.replacement], replacement: null }) : retired()
  }
  if (project.lastChange > read) return stale()
  return phase.work._tag === 'NotStarted' ? commit({ ...phase, work: { _tag: 'Started', at: number } }) : wrong()
}

const moveLaunch = (current: HostLaunch | null, event: HostLaunchEvent): Result.Result<HostLaunch, Refusal> => {
  const { line: { id }, from, move } = event
  if ((current?._tag ?? null) !== from || (current && current.id !== id)) return retired()
  const enters = (launch: HostLaunch) =>
    edge(hostLaunchLine, from ?? 'null', move, launch._tag) === 'Allowed' ? Result.succeed(launch) : wrong()
  switch (move) {
    case 'reserve': return enters({ _tag: 'Reserved', id })
    case 'acknowledge': return enters({ _tag: 'Acknowledged', id, pane: event.input.pane })
    case 'cancel': return enters({ _tag: 'Cancelled', id })
    case 'bind':
      return current?._tag === 'Acknowledged' && current.pane.address === event.input.pane.address
        ? enters({ _tag: 'Bound', id, pane: current.pane }) : retired()
  }
}

export const applyHostLaunchMove = (project: Project, event: HostLaunchEvent): Result.Result<Project, Refusal> => {
  const { actor, read, number } = event
  const phase = project.activation
  if (actor._tag !== 'Human' || actor.id !== project.owner.id) return wrongActor()
  if (phase._tag === 'Onboarding') return wrong()
  if (project.lastChange > read) return stale()
  const current = phase._tag === 'Active' ? phase.replacement : phase.launches.at(-1) ?? null
  if (event.move === 'reserve') {
    if (phase._tag === 'RollingBack' || (phase._tag === 'Active' && phase.work._tag !== 'NotStarted') ||
        (current && current._tag !== 'Cancelled')) return wrong()
    if (phase.launches.some(({ id }) => id === event.line.id)) return stale()
  } else if ((phase._tag === 'RollingBack' || (phase._tag === 'Active' && phase.work._tag !== 'NotStarted')) &&
      event.move !== 'cancel') return wrong()
  return Result.flatMap(moveLaunch(event.move === 'reserve' ? null : current, event), (launch) => {
    const commit = (activation: Activation) => Result.succeed({ ...project, activation, lastChange: number })
    if (phase._tag === 'Active') {
      if (launch._tag === 'Cancelled') return commit({ ...phase, launches: [...phase.launches, launch], replacement: null })
      const binding = launch._tag === 'Bound' ? { id: launch.id, pane: launch.pane } : phase.binding
      return commit({ ...phase, binding, replacement: launch })
    }
    const launches = event.move === 'reserve' ? [...phase.launches, launch] : [...phase.launches.slice(0, -1), launch]
    if (phase._tag !== 'Activating' || launch._tag !== 'Bound') return commit({ ...phase, launches })
    const proposals = approvedProposals(project)
    if (!proposals || JSON.stringify(proposals) !== JSON.stringify(phase.proposals)) return stale()
    const { files, at, staff } = phase
    return commit({
      _tag: 'Active', files, at, staff, proposals, launches,
      binding: { id: launch.id, pane: launch.pane }, replacement: null, work: { _tag: 'NotStarted' },
    })
  })
}
