import type { AdmissionPolicy } from '../schema/index.ts'
import { pipeStage } from './c16/reads.ts'
import type { WorkState } from './c16/state.ts'
import { keyOf, type Act } from './c16/types.ts'

export interface Permits {
  readonly roles: ReadonlyMap<string, string>
  readonly fixes: ReadonlySet<string>
}

export const emptyPermits = (): Permits => ({ roles: new Map(), fixes: new Set() })

export const takePermits = (permits: Permits, policy: ReadonlyMap<string, AdmissionPolicy>,
  act: Act, next: WorkState): Permits => {
  if (policy.size === 0) return permits
  const roles = new Map(permits.roles)
  const fixes = new Set(permits.fixes)
  const body = act.body
  if (body._tag === 'Open' && body.open._tag === 'OpenMake' && policy.has(keyOf(act.who))) {
    roles.set(body.open.task, keyOf(act.who))
  }
  if (act.who._tag === 'Pipe' && 'fix' in body) fixes.add(body.fix)

  for (const id of roles.keys()) {
    const task = next.tasks.get(id)
    if (next.top.ended || !task || task.state === 'Done' || task.state === 'Raised' ||
      task.state === 'Split' || (body._tag === 'Reassign' && task.state === 'Sent')) roles.delete(id)
  }
  for (const id of fixes) {
    const fix = next.fixes.get(id)
    if (next.top.ended || !fix || !pipeStage(fix.stage)) fixes.delete(id)
  }
  return { roles, fixes }
}

// A confirmed child loss ends its claim. An existing Execute remains owed and the role
// can resume it with a fresh allocation. A Check already sent can still be reviewed.
export const childDown = (state: WorkState, actor: string): WorkState => {
  const id = actor.slice('maker:'.length)
  const maker = state.makers.get(id)
  if (!maker || maker.ended || state.tasks.get(maker.task)?.state !== 'Working') return state
  return {
    ...state,
    makers: new Map(state.makers).set(id, { ...maker, claimed: false }),
    down: new Set([...state.down, actor]),
  }
}
