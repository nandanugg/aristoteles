// ITF is the oracle. Only the action and its nondeterministic input go to the driver.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { decode, type Plain, picked } from '../../c16/replay/itf.ts'
import type { ModelAct } from '../../c16/replay/acts.ts'
import { type Cmp, type MStore, canonical, modelCmp, storeOf } from '../../c16/replay/model.ts'

export type Identity = 'Host' | 'Role' | 'Pipe'
export type Session = 'Online' | 'Parked' | 'Exited'
export type JobPhase = 'Owed' | 'Held' | 'AwaitPerson' | 'Closed'
export type Phase = 'NoHelper' | 'Checkpointed' | 'ParkRequested' | 'Parked' | 'Deferred'
  | 'RecheckChild' | 'FreshSession' | 'ResumeParent' | 'ReportReady'
export type Route = 'NoContext' | 'ChildContext' | 'FreshContext'

export interface AdmissionView {
  readonly jobs: Readonly<Record<number, JobPhase>>
  readonly pipe: ReadonlyArray<number>
  readonly lane: ReadonlyArray<number>
  readonly deniedPipe: boolean
  readonly recheckBesideFix: boolean
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
export const admissionOf = (frame: Frame): AdmissionView => {
  const r = frame.values['runtime'] as unknown as Omit<AdmissionView, 'jobs'> & {
    jobs: ReadonlyMap<number, JobPhase>
  }
  return {
    jobs: Object.fromEntries(r.jobs), pipe: r.pipe, lane: r.lane,
    deniedPipe: r.deniedPipe, recheckBesideFix: r.recheckBesideFix,
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
  const background = scenario === 'ChildCase'
  const slots = [...s.tasks.keys()].sort((a, b) => a - b)
  const liveMaker = (slot: number) => {
    const maker = s.tasks.get(slot)!.maker
    return maker !== 'NoOne' && !s.down.includes(maker) && s.makers.get(maker)?.ended === false
  }
  return {
    protocol: canonical(modelCmp(s)), phase, route, target,
    providerSlots: online || phase === 'FreshSession' ? 1 : 0,
    roleAttempts: slots.filter((slot) => ['Working', 'InReview'].includes(s.tasks.get(slot)!.state)),
    roleChildren: slots.filter(liveMaker),
    pipeChildren: phase === 'RecheckChild' ? 1 : 0,
    workerFree: online && !(!background &&
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
