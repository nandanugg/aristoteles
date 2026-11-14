// The test support of core/actions (no tests here): the scenario stores of the integrated
// harness (the CLI writes them), the fold of a store, a Derived at a time, and a run of one
// action or of dispatch with the live files and a fixed clock and secret. Temp dirs only.
import { join } from 'node:path'
import { Effect, Exit, Layer } from 'effect'
import { derive, type Derived } from '../derived/index.ts'
import type { Outside } from '../schema/outside.ts'
import type { Author, Event, Recorded, Time, Work } from '../schema/index.ts'
import {
  Dir,
  Env,
  FilesLive,
  Now,
  Readings,
  SpawnLive,
  Store,
  StoreLive,
  Tokens,
} from '../services/index.ts'
import { fold } from '../state/index.ts'
import { ACTIONS, dispatch } from './index.ts'
import {
  type ActionCall,
  type ActionInput,
  type Action,
  type ActionTag,
  Current,
  type Dispatched,
  type Refusal,
} from './types.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harnessJs from '../../test/harness.js'

export interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}
type Run = (line: string, typed?: string) => Promise<Ran>
export interface Project {
  readonly dir: string
  readonly nanda: Run
  readonly agent: Run
  readonly ui: Run
  readonly run: (line: string, options?: object) => Promise<Ran>
  readonly write: (path: string, text: string) => void
  readonly now: () => string
  readonly wait: (minutes: number) => void
}
export interface Harness {
  readonly ok: (r: Ran) => Ran
  readonly tokenIn: (text: string) => string
  readonly solToken: (p: Project, opened: string, run?: string, where?: object) => Promise<string>
  readonly init: (p: Project) => Promise<void>
  readonly project: (files?: Record<string, string>, name?: string) => Project
  readonly started: () => Promise<{ readonly p: Project; readonly lead: string }>
  readonly withWriter: () => Promise<{
    readonly p: Project
    readonly lead: string
    readonly writer: string
  }>
  readonly reported: () => Promise<{
    readonly p: Project
    readonly lead: string
    readonly writer: string
    readonly linter: string
  }>
  readonly codeStarted: () => Promise<{
    readonly p: Project
    readonly app: string
    readonly lead: string
    readonly impl: string
  }>
  readonly changeDirection: (
    p: Project,
    yaml: string,
    opts?: Record<string, unknown>,
  ) => Promise<{ readonly draft: string; readonly arch: string; readonly out: string }>
  readonly git: (dir: string, ...args: ReadonlyArray<string>) => string
  readonly INTRO_V1: string
  readonly HOST: object
  readonly INTRO_V2: string
  readonly DIRECTION: string
  readonly TASK_WHOLE: string
}
export const h = harnessJs as unknown as Harness
export const { ok, tokenIn, solToken } = h

// --- the store of a dir --------------------------------------------------------------------------

const storeLayer = (dir: string) =>
  StoreLive.pipe(
    Layer.provide(
      Layer.succeed(Env, { vars: { ARISTOTELES_DB: join(dir, '.work', 'aristoteles.db') } }),
    ),
  )
export const eventsOf = (dir: string): ReadonlyArray<Recorded> =>
  Effect.runSync(
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* (yield* Store).open(dir, { create: false })
        return yield* opened.events
      }),
    ).pipe(Effect.provide(storeLayer(dir))),
  )
export const workOf = (dir: string): Work => fold(eventsOf(dir))

// The outside of a test: nothing changed, nothing stale, the brief measures 0 (no limit bites).
export const quietOutside = (dir: string, more: Partial<Outside> = {}): Outside => ({
  cwd: dir,
  settings: { hostWaitMinutes: 10, retryMinutes: 5, outsideSourceHours: 24 },
  changed: new Set(),
  stale: new Map(),
  onBase: new Set(),
  terminals: {},
  measure: () => 0,
  ...more,
})
export const derivedOf = (
  work: Work,
  at: Time,
  dir: string,
  more: Partial<Outside> = {},
): Derived => derive({ work, at, outside: quietOutside(dir, more) })
// The Derived of a dir now (its last act's time), as dispatch would see it.
export const derivedIn = (p: Project, more: Partial<Outside> = {}): Derived =>
  derivedOf(workOf(p.dir), p.now() as Time, p.dir, more)

// --- running an action ---------------------------------------------------------------------------

export const SECRET = 'k9999'
const services = (at: Time) =>
  Layer.mergeAll(
    FilesLive,
    SpawnLive,
    Layer.succeed(Now, { read: Effect.succeed(at) }),
    Layer.succeed(Tokens, { random: Effect.succeed(SECRET) }),
  )

export type Outcome =
  | { readonly _tag: 'Events'; readonly events: ReadonlyArray<Event> }
  | { readonly _tag: 'Refused'; readonly refusal: Refusal }
// One action against a Derived, with no store write (step 1..4 of BUILD.md 3.6).
export const act = (d: Derived, by: Author, input: ActionInput): Outcome => {
  const action = ACTIONS[input._tag] as Action<ActionTag>
  const call: ActionCall<ActionTag> = { by, input } as never
  const exit = Effect.runSyncExit(
    action(call).pipe(
      Effect.provideService(Current, { derived: d }),
      Effect.provide(services(d.moment.at)),
    ),
  )
  if (Exit.isSuccess(exit)) return { _tag: 'Events', events: exit.value }
  const failure = exit.cause.reasons.find((r) => r._tag === 'Fail')
  if (failure?._tag === 'Fail' && failure.error._tag === 'Refusal') {
    return { _tag: 'Refused', refusal: failure.error }
  }
  throw new Error(`the action failed with no refusal: ${String(exit.cause)}`)
}
export const events = (o: Outcome): ReadonlyArray<Event> => {
  if (o._tag === 'Refused') throw new Error(`refused: ${o.refusal.message}`)
  return o.events
}
export const refused = (o: Outcome): Refusal => {
  if (o._tag !== 'Refused') throw new Error(`not refused: ${JSON.stringify(o.events)}`)
  return o.refusal
}

// One dispatch in a dir: the store write, with the live store and files, at a fixed time.
export const dispatchIn = (
  dir: string,
  by: Author,
  input: ActionInput,
  at: Time,
  more: Partial<Outside> = {},
): Exit.Exit<Dispatched, unknown> =>
  Effect.runSyncExit(
    Effect.scoped(dispatch({ by, input } as never)).pipe(
      Effect.provide(
        Layer.mergeAll(
          services(at),
          storeLayer(dir),
          Layer.succeed(Dir, { cwd: dir }),
          Layer.succeed(Readings, { read: () => Effect.succeed(quietOutside(dir, more)) }),
        ),
      ),
    ),
  )

// The authors of the harness.
export const NANDA: Author = { _tag: 'Person', name: 'Nanda', channel: 'terminal' }
export const agent = (token: string): Author => ({
  _tag: 'Agent',
  assignment: token.split('.')[0] as never,
})
