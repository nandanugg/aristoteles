// Project comparable scheduling checkpoints from the actual event stream. The finite
// permits instance has one session slot. A live account can also host a fresh helper
// beside an online parent, which must not be projected as a confirmed parent park.
import { join } from 'node:path'
import type { Recorded } from '../../../schema/index.ts'
import { foldRechecks, routeSettled } from '../../../state/rechecks.ts'
import { foldRuntime } from '../../../state/worker-runtime.ts'
import { permitsOf, type Phase, type Route, readWitness } from './model.ts'

type Scenario = 'child' | 'park' | 'defer'
type PhaseView = { phase: Phase; route: Route }

const phases = (scenario: Scenario) =>
  readWitness(join(import.meta.dir, 'traces', `permits-${scenario}.itf.json.gz`)).frames.map(permitsOf)

export const recheckCheckpoints = (scenario: Scenario) => {
  const model = phases(scenario)
  let cursor = 0
  return (events: ReadonlyArray<Recorded>, id: string, phase: Phase, options: { parentOnline?: boolean } = {}) => {
    const runtime = foldRuntime(events)
    const job = foldRechecks(events).get(id)
    if (!job) throw new Error('recheck was not queued in the live journal')
    const parent = runtime.workers.get(job.queued.worker)
    const parentOnline = Boolean(parent?.binding && !parent.fenced && !parent.ended && !parent.parking)
    if (options.parentOnline !== undefined && parentOnline !== options.parentOnline) {
      throw new Error(`live recheck parent online: expected ${options.parentOnline}, got ${parentOnline}`)
    }
    const helperHeld = !routeSettled(job, runtime)
    const route = job.route?.kind === 'child' ? 'ChildContext' : job.route?.kind === 'session' ? 'FreshContext' : 'NoContext'
    const observed: PhaseView = {
      route: job.taken ? 'NoContext' : route,
      phase: job.taken ? 'NoHelper'
        : job.report && !helperHeld ? parentOnline ? 'ReportReady' : 'ResumeParent'
        : helperHeld ? route === 'ChildContext' ? 'RecheckChild' : 'FreshSession'
        : job.park?._tag === 'WorkerParkConfirmed' ? 'Parked'
        : job.park?._tag === 'WorkerParkRequested' ? 'ParkRequested'
        : job.deferred ? 'Deferred' : 'Checkpointed',
    }
    const next = model.findIndex((state, index) => index >= cursor && state.phase === phase && state.route === observed.route)
    if (observed.phase !== phase || next === -1) {
      throw new Error(`live permits checkpoint ${scenario}: expected ${phase}, got ${observed.phase} / ${observed.route}`)
    }
    cursor = next + 1

    const records = events.filter(({ event }) => event._tag === 'Runtime' && 'job' in event.create && event.create.job === id)
    const reported = records.find(({ event }) => event._tag === 'Runtime' && event.create._tag === 'RecheckReported')
    if (job.report && (!reported || job.report.on !== job.queued.on ||
      !Bun.deepEquals([...job.report.items].sort(), [...job.queued.items].sort()))) {
      throw new Error('live recheck report changed the immutable basis or item versions')
    }
    if (job.taken) {
      const verdicts = events.filter(({ event }) =>
        event._tag === 'Work' && event.create._tag === 'Acted' && event.create.recheck?.job === id)
      const [verdict] = verdicts
      if (verdicts.length !== 1 || !verdict || !reported || verdict.seq <= reported.seq || helperHeld ||
        verdict.event._tag !== 'Work' || verdict.event.create._tag !== 'Acted' ||
        verdict.event.create.recheck?.report !== job.report?.report) {
        throw new Error('live verdict did not consume its durable settled report exactly once')
      }
    }
  }
}
