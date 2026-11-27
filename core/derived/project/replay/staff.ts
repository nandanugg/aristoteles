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

type WorkObservation = {
  readonly phase: 'Sent' | 'Working' | 'ReadyToReview'
  readonly attempt: number
  readonly lifetime: number
  readonly retries: number
  readonly artifact: number | null
  readonly pointedOut: number
}
export interface StaffReplacementPort {
  readonly retire: (checkpoint: boolean) => Promise<void>
  readonly replace: (checkpoint: boolean) => Promise<void>
  readonly begin: () => Promise<void>
  readonly report: (lifetime: number) => Promise<boolean>
  readonly observe: () => Promise<readonly [phase: 'Live' | 'Paused' | 'Ended', lifetime: number]>
  readonly work: () => Promise<WorkObservation>
  readonly companions: () => Promise<{
    readonly review: 'Waiting' | 'Assigned'
    readonly artifact: number
    readonly commandHolds: boolean
    readonly proposal: 'Waiting' | 'Assigned'
    readonly answer: number
  }>
}

const replacementWork = (value: Plain): WorkObservation => {
  const { tag, value: raw } = record(value)
  const data = record(raw!)
  if (tag === 'Sent') return {
    phase: tag, attempt: integer(data.last), retries: integer(data.retries), lifetime: 0, artifact: null, pointedOut: array(data.pointedOut).length,
  }
  if (tag !== 'Working' && tag !== 'ReadyToReview') throw new Error('Unexpected work phase')
  const attempt = tag === 'ReadyToReview' ? record(data.attempt!) : data
  return {
    phase: tag, attempt: integer(attempt.number), lifetime: integer(attempt.session),
    retries: integer(attempt.retries), pointedOut: array(attempt.pointedOut).length, artifact: tag === 'ReadyToReview' ? integer(data.artifact) : null,
  }
}

export const replayStaffReplacementObservations = async (
  trace: Trace, kind: Kind, port: StaffReplacementPort,
): Promise<void> => {
  const compareWork = async (expected: WorkObservation) => {
    const actual = await port.work()
    if (actual.phase !== expected.phase || actual.attempt !== expected.attempt || actual.lifetime !== expected.lifetime ||
        actual.retries !== expected.retries || actual.artifact !== expected.artifact || actual.pointedOut !== expected.pointedOut)
      throw new Error('Replacement work differs: ' + JSON.stringify({ expected, actual }))
  }
  const compareCompanions = async (state: Trace['states'][number]['state']) => {
    const review = record(record(state.review!).value!)
    const proposal = record(record(state.proposal!).value!)
    const answer = record(record(state.question!).value!)
    const expected = {
      review: review.review === 'Waiting' ? 'Waiting' : 'Assigned',
      artifact: integer(record(review.result!).artifact),
      commandHolds: array(review.commands).every((outcome) => record(outcome).breaks === false),
      proposal: proposal.review === 'Waiting' ? 'Waiting' : 'Assigned',
      answer: integer(answer.text),
    }
    const actual = await port.companions()
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error('Replacement companions differ: ' + JSON.stringify({ expected, actual }))
  }
  let previous = replacementWork(trace.states[0]!.state.work!)
  await compareWork(previous)
  await compareCompanions(trace.states[0]!.state)
  for (const step of trace.states.slice(1)) {
    switch (step.action) {
      case '': break
      case 'retire': {
        const checkpoint = picked(step.picks.withCheckpoint)
        if (typeof checkpoint !== 'boolean') throw new Error('Expected a checkpoint observation')
        await port.retire(checkpoint)
        break
      }
      case 'replace': await port.replace(false); break
      case 'resumeCheckpoint': await port.replace(true); break
      case 'startAgain': await port.begin(); break
      case 'finishWork': {
        const source = integer(picked(step.picks.lifetime))
        const committed = await port.report(source)
        if (committed !== (source === previous.lifetime)) throw new Error('A stale replacement report changed the work')
        if (kind === 'mutant' && step.state.staleApplied === true) {
          await compareWork(previous)
          await compareCompanions(step.state)
          return
        }
        break
      }
      default: throw new Error('Unknown replacement action: ' + step.action)
    }
    const session = record(step.state.session!)
    const lifetime = session.tag === 'Ended' ? integer(session.value) : integer(record(session.value!).lifetime)
    const [actualPhase, actualLifetime] = await port.observe()
    if (actualPhase !== session.tag || actualLifetime !== lifetime) throw new Error('Session observation differs')
    const expected = replacementWork(step.state.work!)
    await compareWork(expected)
    await compareCompanions(step.state)
    previous = expected
  }
  if (kind === 'mutant') throw new Error('The mutant never offered a stale report')
}
