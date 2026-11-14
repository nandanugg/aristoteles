// dispatch (BUILD.md 3.1, 3.6): one action in one store write. Read the events, fold, read the
// outside, derive, run the action with Current, append its event (zero or one, D11) with the
// rows of the reader tables, and fold the new event. The clock is read twice, as the old write
// did: once for the check (the Moment), once for the time of the event.
import { Effect } from 'effect'
import { derive } from '../derived/index.ts'
import {
  type Draft,
  type Event,
  kindOf,
  OutsideFailed,
  type Recorded,
  StoreDamaged,
  type Time,
  type Work,
  writtenBy,
} from '../schema/index.ts'
import { Dir, Files, Now, Readings, rowsOf, Spawn, Store, Tokens } from '../services/index.ts'
import { fold, foldStep, momentOf } from '../state/index.ts'
import { defineWorkflow } from './config.ts'
import { no } from './support.ts'
import {
  type Action,
  type ActionCall,
  type Actions,
  type ActionTag,
  Current,
  type Dispatch,
  type Dispatched,
} from './types.ts'

export const STORE = {
  // A dir with no store: the person makes one (BUILD.md D10, the wrap of the old Refused).
  noStore: (message: string, dir: string) =>
    no(message, 'Pick', `act in a dir with a store, or make one in ${dir} (work init)`),
} as const

// A fold that throws StoreDamaged becomes a typed failure; any other throw is a bug.
const folding = <A>(run: () => A): Effect.Effect<A, StoreDamaged> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(run())
    } catch (error) {
      return error instanceof StoreDamaged ? Effect.fail(error) : Effect.die(error)
    }
  })
// The time of the last act of the work (an engine act or a forward): no act comes before it.
const lastActAt = (w: Work): Time | undefined =>
  w.events.findLast(({ recorded }) => {
    const g = recorded.event._tag
    return ![
      'Workflow',
      'Role',
      'Run',
      'TaskDraft',
      'Problem',
      'Terminal',
      'Send',
      'HostWords',
    ].includes(g)
  })?.recorded.at

// N6 (I4): a model run that names itself as a person of the work is that person (the CLI word:
// the person's own name in --by).
export const personByName = <C extends ActionCall>(w: Work, call: C): C =>
  call.by._tag === 'ModelRun' && w.config.people.includes(call.by.name)
    ? { ...call, by: { _tag: 'Person', name: call.by.name, channel: 'terminal' } }
    : call

export const dispatchWith =
  (actions: Actions): Dispatch =>
  (given) =>
    Effect.gen(function* () {
      const store = yield* Store
      const { cwd } = yield* Dir
      const clock = yield* Now
      const readings = yield* Readings
      // The store runs its build with no requirements, so the services go in here.
      const services = yield* Effect.context<Files | Spawn | Now | Tokens>()
      const create = given.input._tag === 'DefineWorkflow'
      const opened = yield* store
        .open(cwd, { create })
        .pipe(Effect.catchTag('Refused', (e) => Effect.fail(STORE.noStore(e.message, cwd))))
      let done: Dispatched | undefined
      const seq = yield* opened.write((events) =>
        Effect.gen(function* () {
          // work init: the first event of an empty store, from aristoteles.yaml.
          if (events.length === 0) {
            if (!create) return yield* Effect.fail(STORE.noStore(`no work store in ${cwd}`, cwd))
            const [event] = yield* defineWorkflow(given.by, cwd)
            if (event === undefined) return yield* Effect.die('work init made no event')
            const draft: Draft = { at: yield* clock.read, author: given.by, event }
            const work = fold([{ ...draft, seq: 1 } as Recorded])
            done = { seq: 1, work, created: [] }
            return { draft, rows: [] }
          }
          const work = yield* folding(() => fold(events))
          const call = personByName(work, given)
          const at = yield* clock.read
          const moment = yield* momentOf(work, at).pipe(Effect.provideService(Readings, readings))
          const action = actions[call.input._tag] as Action<ActionTag>
          const made: ReadonlyArray<Event> = yield* action(call as ActionCall<ActionTag>).pipe(
            Effect.provideService(Current, { derived: derive(moment) }),
          )
          if (made.length === 0) {
            done = { seq: null, work, created: [] }
            return null
          }
          const [event, ...more] = made
          if (event === undefined || more.length > 0) {
            return yield* Effect.die(`${call.input._tag} made ${made.length} events; one at most`)
          }
          if (!writtenBy(call.by, event)) {
            return yield* Effect.die(`${call.by._tag} does not write ${kindOf(event)}`)
          }
          const when = yield* clock.read
          const last = lastActAt(work)
          if (last !== undefined && Date.parse(when) < Date.parse(last)) {
            return yield* Effect.fail(
              new OutsideFailed({
                system: 'store',
                message: `an act at ${when} comes before the last act, at ${last}`,
                next: null,
              }),
            )
          }
          const draft: Draft = { at: when, author: call.by, event }
          const next = (events.at(-1)?.seq ?? 0) + 1
          // A new event that does not fold is a bug of its action.
          const stepped = foldStep(work, { ...draft, seq: next } as Recorded)
          done = { seq: next, work: stepped.work, created: stepped.created }
          return { draft, rows: rowsOf(stepped.work, opened.dir) }
        }).pipe(Effect.provideContext(services)),
      )
      if (done === undefined) return yield* Effect.die('dispatch: the store built no act')
      return { ...done, seq: done.seq === null ? null : seq }
    })
