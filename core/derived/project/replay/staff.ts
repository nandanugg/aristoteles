import { picked, type Plain } from '../../c16/replay/itf.ts'
import { integer, record, type readTrace } from './driver.ts'

type Trace = ReturnType<typeof readTrace>
type Kind = 'success' | 'fault' | 'mutant'
type Snapshot = {
  readonly sessions: readonly number[]
  readonly children: readonly number[]
  readonly limit: number
  readonly allowance: readonly number[]
  readonly assignments: readonly number[]
}

export interface StaffCapacityPort {
  readonly startSession: (staff: number, version: number) => Promise<'Committed' | 'Refused' | 'Stale'>
  readonly startChild: (role: number) => Promise<boolean>
  readonly finishChild: (role: number) => Promise<void>
  readonly changePlan: () => Promise<void>
  readonly observe: () => Promise<Snapshot>
}

const array = (value: Plain | undefined): readonly Plain[] => {
  if (Array.isArray(value)) return value
  throw new Error('Expected an ITF array')
}
const ordered = (items: number[]) => items.sort((a, b) => a - b)
const lookup = (table: Plain | undefined, key: number) => {
  if (!(table instanceof Map)) throw new Error('Expected an ITF map')
  return integer(table.get(key))
}

const model = (state: Readonly<Record<string, Plain>>): Snapshot => {
  const plan = record(state.plan!)
  return {
    sessions: ordered(array(state.sessions).map((item) => integer(record(record(item).value!).staff))),
    children: ordered(array(state.children).map((item) => integer(array(item)[0]))),
    limit: lookup(plan.subscriptionLimit, 0),
    allowance: [lookup(plan.allowance, 0), lookup(plan.allowance, 1)],
    assignments: [0, 1, 2].map((role) => lookup(plan.assignments, role)),
  }
}

const compare = (actual: Snapshot, expected: Snapshot): void => {
  for (const field of ['sessions', 'children', 'limit', 'allowance', 'assignments'] as const) {
    if (JSON.stringify(actual[field]) !== JSON.stringify(expected[field]))
      throw new Error('Staffing replay differs for ' + field + ': ' + JSON.stringify({ actual, expected }))
  }
}

export const replayStaffCapacity = async (trace: Trace, kind: Kind, port: StaffCapacityPort): Promise<void> => {
  let previous = model(trace.states[0]!.state)
  let deniedChild = false
  let deniedSession = false
  let stale = false
  let tryAgain = false
  compare(await port.observe(), previous)
  for (const step of trace.states.slice(1)) {
    const expected = model(step.state)
    switch (step.action) {
      case '': break
      case 'startSession': {
        const staff = integer(picked(step.picks.staff))
        const status = await port.startSession(staff, integer(picked(step.picks.version)))
        deniedSession ||= status !== 'Committed'
        stale ||= staff === 1 && status === 'Stale'
        break
      }
      case 'startChild': {
        const began = await port.startChild(integer(picked(step.picks.role)))
        if (kind === 'mutant' && expected.children.length > 1) {
          if (began) throw new Error('The second role bypassed the shared-staff limit')
          compare(await port.observe(), previous)
          return
        }
        tryAgain ||= began && deniedChild
        deniedChild ||= !began
        break
      }
      case 'finishChild':
        await port.finishChild(integer(array(picked(step.picks.child) ?? undefined)[0]))
        break
      case 'changePlan': await port.changePlan(); break
      default: throw new Error('Unknown capacity action: ' + step.action)
    }
    compare(await port.observe(), expected)
    if (deniedChild !== step.state.deniedChild || deniedSession !== step.state.deniedSession ||
        stale !== step.state.stale || tryAgain !== step.state.tryAgain)
      throw new Error('Staffing replay differs on refusals')
    previous = expected
  }
  if (kind === 'mutant') throw new Error('Missing duplicate child launch in mutant')
}

export interface StaffReplacementPort {
  readonly retire: (checkpoint: boolean) => Promise<void>
  readonly replace: (checkpoint: boolean) => Promise<void>
  readonly observe: () => Promise<readonly [phase: 'Live' | 'Paused' | 'Ended', lifetime: number]>
}

export const replayStaffReplacementObservations = async (trace: Trace, port: StaffReplacementPort): Promise<void> => {
  for (const step of trace.states.slice(1)) {
    switch (step.action) {
      case '': continue
      case 'retire': {
        const checkpoint = picked(step.picks.withCheckpoint)
        if (typeof checkpoint !== 'boolean') throw new Error('Expected a checkpoint observation')
        await port.retire(checkpoint)
        break
      }
      case 'replace': await port.replace(false); break
      case 'resumeCheckpoint': await port.replace(true); break
      // The full work, review, proposal and question comparison lands in U7.
      case 'startAgain':
      case 'finishWork': return
      default: throw new Error('Unknown replacement action: ' + step.action)
    }
    const session = record(step.state.session!)
    const lifetime = session.tag === 'Ended' ? integer(session.value) : integer(record(session.value!).lifetime)
    const [actualPhase, actualLifetime] = await port.observe()
    if (actualPhase !== session.tag || actualLifetime !== lifetime) throw new Error('Session observation differs')
  }
}
