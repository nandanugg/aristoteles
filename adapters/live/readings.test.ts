// ReadingsLive on the harness scenario stores: the terminals
// that the caller gives, and the markers of work wait.
import { describe, expect, test } from 'bun:test'
import { Effect, Layer, Schema } from 'effect'
import { Time, type Work } from '../../core/schema/index.ts'
import { Dir, Env, Readings, StoreLive } from '../../core/services/index.ts'
import { loadWork } from '../../core/state/index.ts'
import { readingsLive, ReadingsLive } from './index.ts'
import { markReturned, markWaiting } from './waiting.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harness from '../../test/harness.js'

interface Project {
  readonly dir: string
  readonly now: () => string
  readonly write: (path: string, text: string) => void
}
const { started } = harness as { started: () => Promise<{ p: Project }> }

const workOf = (dir: string): Promise<Work> => {
  const env = { ARISTOTELES_DB: `${dir}/.work/aristoteles.db` }
  return Effect.runPromise(
    loadWork(dir).pipe(
      Effect.scoped,
      Effect.provide(StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env })))),
      Effect.map((c) => {
        if (c._tag === 'NoStore') throw new Error(`no store in ${dir}`)
        return c.work
      }),
    ),
  )
}

const placeOf = (dir: string) =>
  Layer.mergeAll(
    Layer.succeed(Dir, { cwd: dir }),
    Layer.succeed(Env, { vars: { ARISTOTELES_DB: `${dir}/.work/aristoteles.db` } }),
  )
describe('ReadingsLive', () => {
  test('the caller gives the terminals', async () => {
    const { p } = await started()
    const work = await workOf(p.dir)
    const terminal = { _tag: 'Live', lastOutput: 5 } as const
    const layer = readingsLive({ terminals: () => ({ s1: terminal }) }).pipe(
      Layer.provide(placeOf(p.dir)),
    )
    const at = Schema.decodeUnknownSync(Time)(p.now())
    const outside = await Effect.runPromise(
      Readings.use((r) => r.read(work, at)).pipe(Effect.provide(layer)),
    )
    expect(outside.terminals).toEqual({ s1: terminal })
  }, 30000)

  // P8, ruling 2: one reader of the markers of work wait for the CLI, the server and the watcher.
  test('the CLI and the server read the same markers', async () => {
    const { p } = await started()
    const work = await workOf(p.dir)
    const env = { ARISTOTELES_DB: `${p.dir}/.work/aristoteles.db` }
    const place = (actor: string) => ({ env, cwd: p.dir, actor })
    await Effect.runPromise(markWaiting(place('a1'), 's-a1'))
    await Effect.runPromise(markReturned(place('h1'), 's-h1'))
    // Another dir's marker is not this dir's.
    await Effect.runPromise(markReturned({ env, cwd: '/elsewhere', actor: 'a9' }, 's-a9'))
    const at = Schema.decodeUnknownSync(Time)(p.now())
    const read = (layer: Layer.Layer<Readings>) =>
      Effect.runPromise(Readings.use((r) => r.read(work, at)).pipe(Effect.provide(layer)))
    const cli = await read(ReadingsLive.pipe(Layer.provide(placeOf(p.dir))))
    const server = await read(
      readingsLive({ terminals: () => ({}) }).pipe(Layer.provide(placeOf(p.dir))),
    )
    expect(cli.markers.map((m) => [m.actor, m.session, m.waits]).sort()).toEqual([
      ['a1', 's-a1', true],
      ['h1', 's-h1', false],
    ])
    expect(server.markers).toEqual(cli.markers)
  }, 30000)
})
