// The wait loop of `work wait` (ruling 10.1), on a real store: the end that needs no steps. A host
// whose Sol ended by a remake of the top task gets the new Sol of the run (the CLI gives it a new
// token); a Sol with no new Sol has ended; ready work that the last wait printed does not end it.
import { afterEach, describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { Env, Now, Readings, StoreLive } from '../services/index.ts'
import { workCacheLayer } from '../state/index.ts'
import { outsideNow } from '../derived/support.test.ts'
import { cleanUp, clock, hosted, type Project } from './support.test.ts'
import { look, stepsOf, waitFor, type Waiter, type WaitEnd } from './wait.ts'

afterEach(cleanUp)

const services = (p: Project) => {
  const store = StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: p.env })))
  return Layer.mergeAll(
    workCacheLayer(p.dir).pipe(Layer.provide(store)),
    Layer.succeed(Readings, {
      read: (work) => Effect.sync(() => outsideNow(work, p.dir)),
    }),
    Layer.succeed(Now, { read: Effect.sync(() => new Date(clock.now).toISOString() as never) }),
  )
}
const waited = (p: Project, waiter: Waiter, seen: string | null = null): Promise<WaitEnd> =>
  Effect.runPromise(
    waitFor(waiter, {
      seen,
      ms: 300,
      pollMs: 50,
      deriveMs: 100,
      settleMs: 10,
      lastSeq: Effect.succeed(0),
      blocking: Effect.void,
    }).pipe(Effect.provide(services(p))),
  )
const a = (id: string): Waiter => ({ _tag: 'Agent', assignment: id as never })

describe('the wait loop', () => {
  test("a remake of the top task hands the run's terminal to its new Sol", async () => {
    const { p } = await hosted()
    await p.nanda('task remake t1 --file=again.yaml --reason="the text asks for the cost"')
    // The old Sol a1 ended with t1, and no Sol is on t2 yet: a1 has ended.
    expect(await waited(p, a('a1'))).toMatchObject({ _tag: 'Ended' })
    await p.nanda('assign t2 --role=architect')
    expect(await waited(p, a('a1'))).toMatchObject({ _tag: 'Opened', run: 'h1', sol: 'a2' })
    expect(await waited(p, { _tag: 'Host', run: 'h1' as never })).toMatchObject({
      _tag: 'Opened',
      sol: 'a2',
    })
  })

  test('ready work that the last wait printed does not end it: the time does', async () => {
    const { p } = await hosted()
    const first = await waited(p, a('a1'))
    expect(first._tag).toBe('Ready')
    const seen = first._tag === 'Ready' ? first.steps.key : null
    const d = await Effect.runPromise(look.pipe(Effect.provide(services(p))))
    expect(d === null ? null : stepsOf(d, a('a1')).key).toBe(seen)
    expect(await waited(p, a('a1'), seen)).toMatchObject({ _tag: 'Quiet' })
  })
})
