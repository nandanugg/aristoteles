// Unit 2's decoded SQLite events contain verifiers. Copy only the fields compared by replay.
import type { Recorded, Turn as RuntimeTurn } from '../../../schema/index.ts'
import type { JournalRow } from './journal.ts'
import type { Identity } from './model.ts'
import type { Turn } from './project.ts'

export const replayIdentity = (actor: string): Identity => {
  if (actor === 'host') return 'Host'
  if (actor === 'pipe') return 'Pipe'
  if (actor.startsWith('role:')) return 'Role'
  throw new Error('journal actor outside the worker witness')
}

export const stepKey = ({ act, task, fix, ask, maker, actor }: RuntimeTurn['step']): string =>
  JSON.stringify([act, task, fix, ask, maker, actor])

export const replayTurn = ({ worker, generation, actor, epoch, turn, obligation, on, step }:
  Omit<RuntimeTurn, 'receiptVerifier'>): Turn => ({
  worker, generation, actor: replayIdentity(actor), epoch, turn, obligation, on, step: stepKey(step),
})

export const unit2Journal = (events: ReadonlyArray<Recorded>): ReadonlyArray<JournalRow> => {
  const rows: JournalRow[] = []
  for (const { seq, event } of events) {
    if (event._tag === 'Runtime') {
      const row = event.create
      switch (row._tag) {
        case 'WorkerReserved': {
          const { _tag: kind, worker, generation, launch, slot } = row
          rows.push({ seq, event: { kind, worker, generation, launch, slot } })
          break
        }
        case 'WorkerBound':
        case 'WorkerFenced':
        case 'WorkerEnded': {
          const { _tag: kind, worker, generation, launch } = row
          rows.push({ seq, event: { kind, worker, generation, launch } })
          break
        }
        case 'TurnOffered':
          rows.push({ seq, event: { kind: row._tag, scope: replayTurn(row) } })
          break
        case 'TurnClosed': {
          const { _tag: kind, worker, generation, turn } = row
          rows.push({ seq, event: { kind, worker, generation, turn } })
          break
        }
      }
    } else if (event._tag === 'Work' && event.create._tag === 'Acted') {
      const delivery = event.create.delivery
      rows.push({ seq, event: { kind: 'Work.Acted',
        delivery: delivery && !('kind' in delivery) ? replayTurn(delivery) : null } })
    }
  }
  return rows
}
