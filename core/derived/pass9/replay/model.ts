// ITF is the oracle. Only the action and its nondeterministic input go to the driver.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { decode, type Plain, picked } from '../../c16/replay/itf.ts'
import type { ModelAct } from '../../c16/replay/acts.ts'
import { type Cmp, type MStore, canonical, modelCmp, storeOf } from '../../c16/replay/model.ts'

export type Identity = 'Host' | 'Role' | 'Pipe'
export type Session = 'Online' | 'Parked' | 'Exited'
export type TaskPhase = 'Queued' | 'Child' | 'Serial' | 'MakerDown' | 'Checking' | 'Finished'
export type JobPhase = 'Owed' | 'Held' | 'AwaitPerson' | 'Closed'
export type Phase = 'NoHelper' | 'Checkpointed' | 'ParkRequested' | 'Parked' | 'Deferred'
  | 'RecheckChild' | 'FreshSession' | 'ResumeParent' | 'ReportReady'
export type Route = 'NoContext' | 'ChildContext' | 'FreshContext'

export interface WorkerView {
  readonly queue: ReadonlyArray<Identity>
  readonly delivery: { readonly actor: Identity; readonly tokenActor: Identity; readonly current: boolean } | null
  readonly session: Session
  readonly heard: ReadonlyArray<Identity>
  readonly yielded: boolean
  readonly refused: boolean
  readonly afterPark: boolean
}

export interface AdmissionView {
  readonly tasks: Readonly<Record<number, TaskPhase>>
  readonly owners: Readonly<Record<number, number>>
  readonly jobs: Readonly<Record<number, JobPhase>>
  readonly children: ReadonlyArray<number>
  readonly role: ReadonlyArray<number>
  readonly pipe: ReadonlyArray<number>
  readonly lane: ReadonlyArray<number>
  readonly deniedPipe: boolean
  readonly recheckBesideFix: boolean
  readonly serialReviewed: boolean
}

export interface PermitsView {
  readonly protocol: Cmp
  readonly phase: Phase
  readonly route: Route
  readonly target: number
  readonly providerSlots: number
  readonly roleAttempts: ReadonlyArray<number>
  readonly roleChildren: ReadonlyArray<number>
  readonly pipeChildren: number
  readonly workerFree: boolean
}

type Fields = Readonly<Record<string, Plain>>
interface Frame { readonly action: string; readonly picks: Fields; readonly values: Fields }
export interface Witness { readonly name: string; readonly frames: ReadonlyArray<Frame> }

export const readWitness = (path: string): Witness => {
  const itf = JSON.parse(gunzipSync(readFileSync(path)).toString()) as {
    readonly vars: ReadonlyArray<string>
    readonly states: ReadonlyArray<Readonly<Record<string, unknown>>>
  }
  const name = path.split('/').at(-1)!.replace('.itf.json.gz', '')
  if (itf.states.length < 2) throw new Error(`${name}: empty witness`)
  return {
    name,
    frames: itf.states.map((row) => ({
      action: String(row['mbt::actionTaken'] ?? ''),
      picks: decode(row['mbt::nondetPicks'] ?? {}) as Fields,
      values: Object.fromEntries(itf.vars.filter((key) => !key.startsWith('mbt::'))
        .map((key) => [key.split('::').at(-1)!, decode(row[key])])),
    })),
  }
}

export const input = (frame: Frame, key: string): Plain => {
  const value = picked(frame.picks[key])
  if (value === null) throw new Error(`${frame.action}: no ${key} pick`)
  return value
}
export const workerOf = (frame: Frame): WorkerView => {
  const w = frame.values['worker'] as unknown as Omit<WorkerView, 'delivery'> & {
    delivery: 'Empty' | { value: { owner: Identity; token: Identity; current: boolean } }
  }
  return {
    session: w.session, queue: w.queue, heard: w.heard,
    yielded: w.yielded, refused: w.refused, afterPark: w.afterPark,
    delivery: w.delivery === 'Empty' ? null : {
      actor: w.delivery.value.owner, tokenActor: w.delivery.value.token, current: w.delivery.value.current,
    },
  }
}
export const admissionOf = (frame: Frame): AdmissionView => {
  const r = frame.values['runtime'] as unknown as Omit<AdmissionView, 'tasks' | 'owners' | 'jobs'> & {
    tasks: ReadonlyMap<number, TaskPhase>; owners: ReadonlyMap<number, number>; jobs: ReadonlyMap<number, JobPhase>
  }
  return {
    tasks: Object.fromEntries(r.tasks), owners: Object.fromEntries(r.owners), jobs: Object.fromEntries(r.jobs),
    children: r.children, role: r.role, pipe: r.pipe, lane: r.lane,
    deniedPipe: r.deniedPipe, recheckBesideFix: r.recheckBesideFix, serialReviewed: r.serialReviewed,
  }
}

const protocolOf = (frame: Frame): MStore => storeOf(frame.values['store']!)
export const permitsOf = (frame: Frame): PermitsView => {
  const s = protocolOf(frame)
  const scheduler = frame.values['scheduling'] as unknown as {
    phase: Phase; source: Route; target: number; scenario: string
  }
  const { phase, source: route, target, scenario } = scheduler
  const online = phase !== 'Parked' && phase !== 'FreshSession' && phase !== 'ResumeParent'
  const serial = scenario === 'SerialCase'
  const background = scenario === 'ChildCase' || scenario === 'AdmissionCase'
  const slots = [...s.tasks.keys()].sort((a, b) => a - b)
  const liveMaker = (slot: number) => {
    const maker = s.tasks.get(slot)!.maker
    return maker !== 'NoOne' && !s.down.includes(maker) && s.makers.get(maker)?.ended === false
  }
  return {
    protocol: canonical(modelCmp(s)), phase, route, target,
    providerSlots: online || phase === 'FreshSession' ? 1 : 0,
    roleAttempts: slots.filter((slot) => ['Working', 'InReview'].includes(s.tasks.get(slot)!.state)),
    roleChildren: serial ? [] : slots.filter(liveMaker),
    pipeChildren: phase === 'RecheckChild' ? 1 : 0,
    workerFree: online && !((serial || !background) &&
      slots.some((slot) => s.tasks.get(slot)!.state === 'Working' && liveMaker(slot))),
  }
}

const modelBody = (raw: Plain): Pick<ModelAct, 'tag' | 'value'> => {
  if (typeof raw === 'string') return { tag: raw, value: {} }
  return raw as unknown as Pick<ModelAct, 'tag' | 'value'>
}

export const protocolAct = (frame: Frame): ModelAct | null => {
  if (frame.action !== 'humanTurn' && frame.action !== 'agentsTurn') return null
  const body = modelBody(input(frame, 'body'))
  // permits.perform fills this specific edit rather than shipping an empty told draft.
  const value = body.tag === 'Ship' ? { ...body.value, items: ['D'], real: ['D'] } : body.value
  return { who: frame.action === 'humanTurn' ? 'Human' : String(input(frame, 'actor')), tag: body.tag, value }
}
