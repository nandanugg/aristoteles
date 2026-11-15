// The wait loop of `work wait` (ruling 10.1), on a real store: the end that needs no steps. A host
// whose Sol ended by a remake of the top task gets the new Sol of the run (the CLI gives it a new
// token); a Sol with no new Sol has ended; ready work that the last wait printed does not end it.
import { afterEach, describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { Env, Now, Readings, StoreLive } from '../services/index.ts'
import { workCacheLayer } from '../state/index.ts'
import { nextChangeAt } from '../derived/index.ts'
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
const waited = (
  p: Project,
  waiter: Waiter,
  seen: string | null = null,
  times = { ms: 300, deriveMs: 100 },
): Promise<WaitEnd> =>
  Effect.runPromise(
    waitFor(waiter, {
      seen,
      ...times,
      pollMs: 50,
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
    expect(await waited(p, a('a1'))).toMatchObject({ _tag: 'Opened', run: 'h1', host: 'a2' })
    expect(await waited(p, { _tag: 'Host', run: 'h1' as never })).toMatchObject({
      _tag: 'Opened',
      host: 'a2',
    })
  })

  // Owner, 2026-11-15: the person answers on the page, and the asker's work wait returns.
  test("the person's answer changes the step key of the asker", async () => {
    const { p, hostToken } = await hosted()
    await p.agent(`ask ${hostToken} --to=owner --text="Which merchant?" --option=m-17 --option=m-18`)
    const keyNow = async () => {
      const d = await Effect.runPromise(look.pipe(Effect.provide(services(p))))
      return d === null ? null : stepsOf(d, a('a1')).key
    }
    const before = await keyNow()
    await p.ui('answer q1 --option=2')
    expect(p.work().questions.get('q1' as never)?.status).toMatchObject({ answer: 'm-18' })
    expect(await keyNow()).not.toBe(before)
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

  // Live, 2026-11-15: a lead printed "decide r8", waited again without deciding, and the run
  // waited for it until the wait's time ran out. Ready work comes back after readyAgainMs.
  test('ready work that is still there comes back after readyAgainMs', async () => {
    const { p } = await hosted()
    const first = await waited(p, a('a1'))
    const seen = first._tag === 'Ready' ? first.steps.key : null
    const again = await Effect.runPromise(
      waitFor(a('a1'), {
        seen,
        ms: 5000,
        deriveMs: 50,
        pollMs: 20,
        settleMs: 10,
        readyAgainMs: 200,
        lastSeq: Effect.succeed(0),
        blocking: Effect.void,
      }).pipe(Effect.provide(services(p))),
    )
    expect(again).toMatchObject({ _tag: 'Ready' })
  })

  // P9 (live, 2026-11-15): an event written as the wait starts, before it reads the last seq,
  // is in the steps of its first look, so the wait never misses it.
  test('an event written as the wait starts is not missed', async () => {
    const { p, hostToken } = await hosted()
    const first = await waited(p, a('a1'))
    const seen = first._tag === 'Ready' ? first.steps.key : null
    let written = false
    const lastSeq = Effect.promise(async () => {
      if (!written) {
        written = true
        await p.agent(`ask ${hostToken} --to=owner --text="Which merchant?"`)
      }
      return 1
    })
    const start = Date.now()
    const end = await Effect.runPromise(
      waitFor(a('a1'), {
        seen,
        ms: 3000,
        deriveMs: 3_600_000,
        pollMs: 50,
        settleMs: 10,
        lastSeq,
        blocking: Effect.void,
      }).pipe(Effect.provide(services(p))),
    )
    expect(end._tag).not.toBe('Quiet')
    expect('steps' in end ? end.steps.key : seen).not.toBe(seen)
    expect(Date.now() - start).toBeLessThan(2000)
  }, 20000)

  // F4: the wait derives again when the clock passes the next edge (nextChangeAt), not only
  // each deriveMs: here the end of the 30-day grant of the task open, which changes the steps.
  test('the wait derives again at the next clock edge', async () => {
    const { p } = await hosted()
    const first = await waited(p, a('a1'))
    const seen = first._tag === 'Ready' ? first.steps.key : null
    const d = await Effect.runPromise(look.pipe(Effect.provide(services(p))))
    const edge = Date.parse((d === null ? null : nextChangeAt(d)) ?? '')
    expect(edge).toBeGreaterThan(clock.now)
    const start = Date.now()
    const wait = waited(p, a('a1'), seen, { ms: 8000, deriveMs: 3_600_000 })
    await Bun.sleep(100)
    clock.now = edge
    expect(await wait).toMatchObject({ _tag: 'Changed' })
    expect(Date.now() - start).toBeLessThan(2000)
  }, 20000)
})
