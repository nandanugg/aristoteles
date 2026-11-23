import type { Body } from './c16/types.ts'
import type { Recorded, RuntimeEvent, Turn, WorkerPlacement } from '../schema/index.ts'

export type Reservation = Extract<RuntimeEvent, { _tag: 'WorkerReserved' }>
export type Binding = Extract<RuntimeEvent, { _tag: 'WorkerBound' }>
export interface WorkerGeneration {
  readonly reservation: Reservation
  readonly binding: Binding | null
  readonly fenced: boolean
  readonly ended: boolean
  readonly offer: Turn | null
}

export const foldRuntime = (events: ReadonlyArray<Recorded>) => {
  const workers = new Map<string, WorkerGeneration>()
  let placements: ReadonlyArray<WorkerPlacement> = []
  for (const { event } of events) {
    if (event._tag === 'Work') {
      if (event.create._tag === 'Opened') placements = event.create.placements ?? []
      if (event.create._tag === 'Acted') {
        const delivery = event.create.delivery
        if (!delivery) continue
        const worker = workers.get(delivery.worker)
        if (worker?.reservation.generation === delivery.generation) {
          const offer = worker.offer
          const taken = offer && ('kind' in delivery
            ? offer.actor === delivery.actor && matchesStep(event.create.act.body, offer.step)
            : offer.turn === delivery.turn)
          if (taken) {
            workers.set(delivery.worker, { ...worker, offer: null })
          }
        }
      }
      continue
    }
    if (event._tag !== 'Runtime') continue
    const e = event.create
    if (e._tag === 'WorkerReserved') {
      workers.set(e.worker, { reservation: e, binding: null, fenced: false, ended: false, offer: null })
      continue
    }
    const current = workers.get(e.worker)
    if (!current || current.reservation.generation !== e.generation) continue
    switch (e._tag) {
      case 'WorkerBound': workers.set(e.worker, { ...current, binding: e }); break
      case 'WorkerFenced': workers.set(e.worker, { ...current, fenced: true, offer: null }); break
      case 'WorkerEnded': workers.set(e.worker, { ...current, ended: true, fenced: true, offer: null }); break
      case 'TurnOffered': workers.set(e.worker, { ...current, offer: e }); break
      case 'TurnClosed':
        if (current.offer?.turn === e.turn) workers.set(e.worker, { ...current, offer: null })
        break
    }
  }
  return { workers, placements }
}

export const matchesStep = (body: Body, step: Turn['step']): boolean => {
  if (step.act !== body._tag) return false
  if (body._tag === 'Open') {
    if (body.open._tag === 'OpenMake') return step.task === body.open.task
    return body.open._tag === 'OpenSend' && step.task !== null && step.ask === null &&
      body.open.spec.sections.length === 1 && body.open.spec.sections[0] === step.task
  }
  if ('ask' in body) return step.ask === body.ask
  if ('fix' in body) return step.fix === body.fix
  if ('task' in body) return step.task === body.task
  if ('maker' in body) return step.maker === body.maker
  return true
}
