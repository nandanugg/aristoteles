import type { WorkFolded } from '../../state/c16/fold.ts'
import type { WorkState } from '../../state/c16/state.ts'
import { pipeStage } from '../../state/c16/reads.ts'
import { keyOf, type Act, type Step } from '../../state/c16/types.ts'
import { childLoad, type Runtime } from '../../state/worker-runtime.ts'

export interface Demand {
  readonly task?: string
  readonly fix?: string
}

export const actDemand = (act: Pick<Act, 'body'>, folded: WorkFolded): Demand => {
  const body = act.body
  if ('fix' in body) return { fix: body.fix }
  if (body._tag === 'Open' && body.open._tag === 'OpenMake') return { task: body.open.task }
  if (body._tag === 'Resume') {
    const task = folded.state.makers.get(body.maker)?.task
    return task === undefined ? {} : { task }
  }
  return {}
}

export const stepDemand = (step: Step): Demand =>
  step.fix !== null ? { fix: step.fix } :
    (step.act === 'Open' || step.act === 'Resume') && step.task !== null ? { task: step.task } : {}

export type Admission =
  | { readonly kind: 'ordinary' | 'child' | 'serial' }
  | { readonly kind: 'waiting'; readonly reason: string }

const waiting = (reason: string): Admission => ({ kind: 'waiting', reason })
const ordinary: Admission = { kind: 'ordinary' }

// The age order is shared by admission and the dashboard's fix lane.
export const pipeFixesByAge = (state: WorkState) =>
  [...state.fixes]
    .filter(([, entry]) => pipeStage(entry.stage))
    .sort(([left, a], [right, b]) => a.at - b.at || left.localeCompare(right))
    .map(([id]) => id)

// The same predicate is used for each offered step and at the commit boundary.
// A permit is owned by the C16 role identity even when its worker hosts other roles.
export const admissionFor = (
  folded: Pick<WorkFolded, 'state' | 'policy' | 'permits'>, runtime: Runtime, actor: string, demand: Demand,
): Admission => {
  const { state, policy, permits } = folded
  const limits = policy.get(actor)
  if (!limits) return ordinary

  if (actor === 'pipe' && demand.fix !== undefined) {
    const fix = demand.fix
    if (permits.fixes.has(fix)) return ordinary
    const waitingFixes = pipeFixesByAge(state).filter((id) => !permits.fixes.has(id))
    const free = limits.concurrency - permits.fixes.size
    const place = waitingFixes.indexOf(fix)
    return place >= 0 && place >= free
      ? waiting(`Fix ${fix} is waiting for a Pipe attempt permit (limit ${limits.concurrency}).`)
      : ordinary
  }
  if (!actor.startsWith('role:') || demand.task === undefined) return ordinary
  const task = state.tasks.get(demand.task)
  if (!task || keyOf({ _tag: 'Role', name: task.role }) !== actor) return ordinary
  const attempts = [...permits.roles.values()].filter((owner) => actor === owner).length
  if (!permits.roles.has(task.id) && attempts >= limits.concurrency) {
    return waiting(`${actor} is waiting for an attempt permit (limit ${limits.concurrency}).`)
  }

  const worker = runtime.placements.find((entry) => entry.members.includes(actor))?.worker
  const serialBusy = [...runtime.serial.values()].some((entry) =>
    entry.worker === worker && entry.attempt !== task.id &&
    permits.roles.get(entry.attempt) === entry.parentActor &&
    ['Working', 'InReview'].includes(state.tasks.get(entry.attempt)?.state ?? '') &&
    state.tasks.get(entry.attempt)?.maker === entry.actor.slice('maker:'.length))
  if (serialBusy) return waiting('This worker still has a serial maker executing another attempt.')

  if (limits.subagentAllowance === 0 || !limits.backgroundChildren) return { kind: 'serial' }
  if (childLoad(runtime, actor) >= limits.subagentAllowance) {
    return waiting(`${actor} is waiting for child capacity (allowance ${limits.subagentAllowance}).`)
  }
  return { kind: 'child' }
}
