// The two ways a command meets the store.
// A read replays and reads the clock once. A write, in one transaction: replay, read the clock
// (the time of the check), guard the agent, build the new act, read the clock again for its time
// unless the act has one, guard it, check it (the engine), apply it, and append it with the rows
// of the reader tables. Parity: each path reads the clock as often as the old one (BUILD.md).
import { join } from 'node:path'
import { type Context, Effect, type Scope } from 'effect'
import type { Author } from '../domain/actor.ts'
import { refuse, type OutsideFailed, type Refused, type StoreDamaged } from '../domain/errors.ts'
import { type Draft, type Event, kindOf, writtenBy } from '../domain/events.ts'
import type { Time } from '../domain/ids.ts'
import type { Assignment } from '../domain/model.ts'
import type { CheckContext, CreatedId, Work } from '../domain/work.ts'
import { changedSince } from '../files/digest.ts'
import { replay, stepNew } from '../replay/replay.ts'
import { Dir, type Env, type GitUser, Now, type Terminal } from '../services/io.ts'
import { Files, Spawn } from '../services/outside.ts'
import { Store } from '../services/store.ts'
import { rowsOf } from '../store/rows.ts'
import { MEASURE_TOKEN, renderBrief } from '../words/brief.ts'
import type { Call } from './command.ts'
import { authorOf, type Caller, type Confirm, personChannel, personOf } from './caller.ts'
import { guard, guardCall } from './guard.ts'

export interface Read {
  readonly work: Work
  // The time of the read: a status is computed at it, so an until that passed has ended.
  readonly at: Time
  readonly dir: string
}

export const readWork: Effect.Effect<
  Read,
  Refused | StoreDamaged | OutsideFailed,
  Store | Dir | Now | Scope.Scope
> = Effect.gen(function* () {
  const store = yield* Store
  const { cwd } = yield* Dir
  const opened = yield* store.open(cwd, { create: false })
  const work = yield* replay(yield* opened.events)
  const at = yield* (yield* Now).read
  return { work, at, dir: cwd }
})

// What a command builds: who wrote the act (its author), the act, and its own time only when the
// act has one. token: the agent's token when the call does not carry it after the command (work
// role fit --as=<token>).
export interface NewAct {
  readonly author: Author
  readonly event: Event
  readonly at?: Time
  readonly token?: string
}

export interface Done {
  // The state after the act (the state before it, when nothing was written).
  readonly work: Work
  readonly written: Draft | null
  readonly seq: number | null
  readonly created: ReadonlyArray<CreatedId>
  // The time of the check: a view of the state after the act is read at it (old state.now).
  readonly at: Time
}

export const writeAct = <E, R>(
  call: Call,
  build: (work: Work, at: Time) => Effect.Effect<NewAct | null, E, R>,
): Effect.Effect<
  Done,
  E | Refused | StoreDamaged | OutsideFailed,
  R | Store | Dir | Now | Files | Spawn | Scope.Scope
> =>
  Effect.gen(function* () {
    const store = yield* Store
    const { cwd } = yield* Dir
    const clock = yield* Now
    // The store runs build with no requirements, so the services that it needs go in here.
    const services = yield* Effect.context<R | Now | Files | Spawn>()
    const opened = yield* store.open(cwd, { create: false })
    let done: Done | undefined
    const seq = yield* opened.write((events) =>
      Effect.gen(function* () {
        const work = yield* replay(events)
        const at = yield* clock.read
        yield* guardCall(work, call)
        const act = yield* build(work, at)
        if (act === null) {
          done = { work, written: null, seq: null, created: [], at }
          return null
        }
        const draft: Draft = {
          at: act.at ?? (yield* clock.read),
          author: act.author,
          event: act.event,
        }
        // The store keeps only a pair of an author and a kind that the table holds: any other is
        // a bug of the command that built it.
        if (!writtenBy(act.author, act.event)) {
          return yield* Effect.die(`${act.author._tag} does not write ${kindOf(act.event)}`)
        }
        // An agent act always has a token; a host's task draft has a run as its author.
        const token = act.token ?? call.token
        if (act.author._tag === 'Agent' && token !== null) yield* guard(work, act.event, token)
        const next = (events.at(-1)?.seq ?? 0) + 1
        const stepped = yield* stepNew(work, draft, next, checkContext(cwd, at, services))
        done = { work: stepped.work, written: draft, seq: next, created: stepped.created, at }
        return { draft, rows: rowsOf(stepped.work, opened.dir) }
      }).pipe(Effect.provideContext(services)),
    )
    if (done === undefined) return yield* Effect.die('writeAct: the store built no act')
    return { ...done, seq }
  })

// What the engine needs besides the state: the time of the check, the files, the brief length.
export const checkContext = (
  cwd: string,
  at: Time,
  services: Context.Context<Files | Spawn>,
): CheckContext => ({
  now: at,
  cwd,
  changed: (result) => Effect.provideContext(changedSince(cwd, result), services),
  measure: (w: Work, a: Assignment) =>
    renderBrief(w, a.id, { token: MEASURE_TOKEN, at, cwd }).length,
})

// The file that a --file or --answers flag names, read from the dir.
export const readArgFile = (file: string): Effect.Effect<string, Refused, Dir | Files> =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const files = yield* Files
    const path = join(cwd, file)
    const text = (yield* files.kind(path)) === 'file' ? yield* files.read(path) : null
    return text ?? (yield* refuse(`there is no file ${file} in ${cwd}`))
  })

// An act of a caller: an agent by its token, or the person. The store keeps its author.
export const actOf = (caller: Caller, event: Event): NewAct =>
  caller._tag === 'Agent'
    ? { author: authorOf(caller), event, token: caller.token }
    : { author: authorOf(caller), event }

// The person who acts (a terminal, or the page), after the person checks: the author.
export const personAuthor = (
  work: Work,
  confirm?: Confirm,
): Effect.Effect<{ readonly author: Author }, Refused, Terminal | GitUser | Env> =>
  Effect.gen(function* () {
    const name = yield* personOf(work, confirm)
    const author: Author = { _tag: 'Person', name, channel: yield* personChannel }
    return { author }
  })
