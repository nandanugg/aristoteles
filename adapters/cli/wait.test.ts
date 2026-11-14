// work wait (ruling 10.1, 2026-11-13): an agent or a host blocks on this command until it has
// work. It returns at once with ready work that its last wait did not print, when a step appears
// because another process acted, or with "nothing changed" when the time passes. A host waits by
// its run in its own pane, and the open of its top task gives it the token of its Sol. While it
// blocks, its marker tells the watcher that it waits.
import { afterEach, describe, expect, test } from 'bun:test'
import { readWaiting } from '../live/waiting.ts'
import { cleanUp, project, tokenIn } from '../../core/effects/support.test.ts'

afterEach(cleanUp)

// A section lead (a1) of t1 that read its brief, in a dir with no UI.
const lead = async () => {
  const p = await project()
  await p.nanda('task open --file=top.yaml')
  const token = tokenIn(await p.nanda('assign t1 --role=section-lead'))
  await p.agent(`brief ${token}`)
  return { p, token }
}
const timed = async <A>(run: () => Promise<A>) => {
  const start = Date.now()
  const value = await run()
  return { value, ms: Date.now() - start }
}

describe('work wait', () => {
  test('returns at once with ready work; the same work again waits until the time', async () => {
    const { p, token } = await lead()
    const first = await timed(() => p.agent(`wait ${token} --seconds=2`))
    expect(first.ms).toBeLessThan(1000)
    expect(first.value).toBe(
      [
        'make t1 The Introduction',
        `  work assign ${token} t1 --role=writer`,
        `When you have nothing to do, run work wait ${token} again.`,
      ].join('\n'),
    )
    // The lead printed this work already: the next wait blocks, then says that nothing changed.
    const second = await timed(() => p.agent(`wait ${token} --seconds=1`))
    expect(second.ms).toBeGreaterThanOrEqual(1000)
    expect(second.value.split('\n')[0]).toBe(`nothing changed; run work wait ${token} again.`)
    expect(second.value).toContain(`work assign ${token} t1 --role=writer`)
  }, 30000)

  test('returns when a step appears because another process acts', async () => {
    const { p, token } = await lead()
    await p.agent(`ask ${token} --text="Is the retry part of the export?" --to=owner`)
    expect(await p.agent(`wait ${token} --seconds=2`)).toContain(
      'your question q1 waits for its answer.',
    )
    const waiting = timed(() => p.agent(`wait ${token} --seconds=20`))
    await Bun.sleep(700)
    await p.nanda('answer q1 --text="No: the retry is a task of its own."')
    const { value, ms } = await waiting
    expect(ms).toBeLessThan(10000)
    expect(value.split('\n')[0]).toBe('your next steps changed.')
    expect(value).toContain(`your question q1 has its answer.\n  work question show q1`)
    expect(value).not.toContain('waits for its answer')
  }, 30000)

  test('a host waits by its run in its own pane; the open gives it its Sol token', async () => {
    const p = await project()
    await p.inPane('run start')
    const session = String(p.work().runs.get('h1' as never)?.session)
    await p.inPane('task draft --file=top.yaml --by=h1')
    // Only the terminal of the host waits as its run.
    const other = await p.run(['wait', '--by=h1', '--seconds=1'], { pane: '%3' })
    expect(other.code).toBe(1)
    expect(other.err).toContain('work wait --by=h1 runs only in the terminal of its host (pane %9)')
    // The host blocks: its marker says so, until the person opens its draft.
    const waiting = p.inPane('wait --by=h1 --seconds=20', '%9')
    await Bun.sleep(1200)
    expect([...readWaiting(p.env)]).toEqual([session])
    await p.ui('task open td1')
    const out = await waiting
    expect(readWaiting(p.env).size).toBe(0)
    const sol = tokenIn(out)
    expect(out).toBe(
      [
        'h1: its top task t1 The Introduction is open, and you are its Sol (a1); an older token ' +
          `stops working. Your command: work brief ${sol}`,
        `When you have nothing to do, run work wait ${sol}.`,
      ].join('\n'),
    )
    expect(await p.agent(`brief ${sol}`)).toContain('a1')
  }, 30000)

  test('a low role, a finished agent, and a wrong time', async () => {
    const { p, token } = await lead()
    const writer = tokenIn(await p.agent(`assign ${token} t1 --role=writer`))
    expect(await p.agent(`wait ${writer}`)).toBe(
      `a low role has one unit: work brief ${writer} shows it.`,
    )
    const zero = await p.run(['wait', token, '--seconds=0'])
    expect(zero.code).toBe(1)
    expect(zero.err).toContain('--seconds is a number of seconds above 0')
    await p.nanda('finish a2')
    await p.nanda('finish a1')
    expect(await p.agent(`wait ${token} --seconds=1`)).toBe(
      'a1 is finished; there is nothing more for it.',
    )
  }, 30000)
})
