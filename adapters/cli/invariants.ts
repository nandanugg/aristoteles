// The hook of invariant 4.2 (plan/rebuild/BUILD.md; package P3): next => canAct. It folds the store
// of a dir, reads the outside (no terminals), derives at the time given, and for every open actor
// (each assignment that is not Ended, and each person of the config) checks canAct for every intent
// of every Do step of nextFor. It returns one line per violation: `<actor> <step tag>: <refusal>`.
// test/harness.js calls it after each run() that exits 0 when WORK_CHECK_NEXT=1.
import { Effect, Layer, Schema } from 'effect'
import { canAct, derive, type Derived, nextFor } from '../../core/derived/index.ts'
import { type Author, Time } from '../../core/schema/index.ts'
import {
  Dir,
  Env,
  FilesLive,
  readConfig,
  StoreLive,
} from '../../core/services/index.ts'
import { loadWork, momentOf } from '../../core/state/index.ts'
import { ReadingsLive } from '../live/index.ts'
import { withBriefMeasure } from '../words/index.ts'

type Vars = Readonly<Record<string, string | undefined>>

const nameOf = (actor: Author): string =>
  actor._tag === 'Agent' ? actor.assignment : actor._tag === 'Person' ? actor.name : actor._tag

// Every actor that may be asked for steps now: the open assignments, and the people of the config.
const openActors = (d: Derived, people: ReadonlyArray<string>): ReadonlyArray<Author> => [
  ...[...d.states.assignments]
    .filter(([, state]) => state._tag !== 'Ended')
    .map(([assignment]): Author => ({ _tag: 'Agent', assignment })),
  ...people.map((name): Author => ({ _tag: 'Person', name, channel: 'terminal' })),
]

// The violations of one derived value: an intent of a Do step that canAct refuses.
export const violationsOf = (
  d: Derived,
  people: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  openActors(d, people).flatMap((actor) =>
    nextFor(d, actor).flatMap((step) =>
      step._tag === 'Wait'
        ? []
        : step.intents.flatMap((intent) => {
            const can = canAct(d, actor, intent)
            return can._tag === 'May'
              ? []
              : [`${nameOf(actor)} ${intent._tag}: ${can.refusal.message}`]
          }),
    ),
  )

const check = (dir: string, at: Time) =>
  Effect.gen(function* () {
    const cached = yield* loadWork(dir)
    if (cached._tag === 'NoStore') return []
    const moment = yield* momentOf(cached.work, at)
    const people = (yield* readConfig(dir)).config.people
    // The measure of a brief as the CLI reads it, so a BriefOver state is checked too (10.9).
    const outside = withBriefMeasure(moment.outside, at)
    return violationsOf(derive({ ...moment, outside }), people)
  }).pipe(Effect.scoped)

export const checkNextCanAct = (
  dir: string,
  env: Vars,
  at: string,
): Promise<ReadonlyArray<string>> => {
  const envLayer = Layer.succeed(Env, { vars: env })
  const layer = Layer.mergeAll(
    FilesLive,
    ReadingsLive.pipe(Layer.provide(Layer.succeed(Dir, { cwd: dir }))),
    StoreLive.pipe(Layer.provide(envLayer)),
  )
  const time = Schema.decodeUnknownSync(Time)(at)
  return Effect.runPromise(check(dir, time).pipe(Effect.provide(layer)))
}
