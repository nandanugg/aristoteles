// The tools of one fold step: who did an act and when, the builder that names the records of a
// step in the old order, and the damage of a stored move that cannot apply.
import {
  type Author,
  type By,
  type Counted,
  type CreatedId,
  human,
  type IdByKind,
  nextId,
  type Stepped,
  StoreDamaged,
  type Time,
  type Work,
} from '../schema/index.ts'

// An act as the records keep it: who (an assignment, or a person or a run) and when.
export interface Act {
  readonly by: By
  readonly when: Time
}

// Who did a stored act, from its author (as the old replay said it): an agent or a program by its
// assignment; the person and the supervisor by name; the CLI's own acts as a person named
// system; a host run before its assignment, a model run and the refresh as runs.
const byOf = (author: Author): By => {
  switch (author._tag) {
    case 'Agent':
    case 'Program':
      return author.assignment
    case 'Person':
    case 'Supervisor':
      return human(author.name)
    case 'System':
      return human('system')
    case 'Host':
      return { _tag: 'Agent', name: 'host', run: author.run }
    case 'ModelRun':
      return { _tag: 'Agent', name: author.name, run: author.at }
    case 'Refresh':
      return { _tag: 'Agent', name: 'refresh', run: 'refresh' }
  }
}
export const actOf = (recorded: { readonly author: Author; readonly at: Time }): Act => ({
  by: byOf(recorded.author),
  when: recorded.at,
})

export const put = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> =>
  new Map(map).set(key, value)

// A stored move whose record is not there, or not in the state that its move leaves: the fold
// cannot apply it. The store is trusted otherwise (every event was checked when it was written).
export const damaged = (recorded: { readonly seq: number }, issue: string): never => {
  throw new StoreDamaged({ seq: recorded.seq, issue })
}

export const unchanged = (work: Work): Stepped => ({ work, created: [] })

// One step in parts: the Work so far, and the ids that it made in the old naming order. Each
// record made takes the next tick of the engine's clock; a Reject takes one per point.
export class Build {
  work: Work
  readonly created: Array<CreatedId> = []
  constructor(work: Work) {
    this.work = work
  }
  name<K extends Counted>(kind: K): IdByKind[K] {
    const { id, counters } = nextId(this.work.counters, kind)
    this.work = { ...this.work, counters }
    this.created.push(id as CreatedId)
    return id
  }
  tick(n = 1): number {
    const at = this.work.clock + 1
    this.work = { ...this.work, clock: this.work.clock + n }
    return at
  }
  done(): Stepped {
    return { work: this.work, created: this.created }
  }
}
// A step written on a builder.
export const built = (work: Work, step: (b: Build) => void): Stepped => {
  const b = new Build(work)
  step(b)
  return b.done()
}
