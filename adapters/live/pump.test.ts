// Ruling 2026-11-14 (fixed-size terminals), mostly on the host's own pane: a real tmux server of
// a "person" (a socket of the test), the pump that adopts its pane, and a person's client in a
// pty. The page's control client changes neither the pane's size nor the time of the person's
// last key; a resize sets the window, for the host's pane and for an agent's window alike.
import { afterEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { SessionId } from '../../core/schema/index.ts'
import { Pump } from '../../core/services/index.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harness from '../../test/harness.js'
import { createTmuxPump, pumpLayerOf, type TerminalSize, type TmuxPump } from './pump.ts'

interface PersonPane {
  readonly socket: string
  readonly pane: string
  readonly kill: () => void
}
const { personPane } = harness as { personPane: (command: string) => PersonPane }

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})
const until = async (fn: () => boolean, ms = 8000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return
    await Bun.sleep(50)
  }
  throw new Error('timed out')
}
const { TMUX: _t, TMUX_PANE: _p, TMUX_SOCKET: _s, ...env } = process.env
const tmux = (person: PersonPane, ...args: string[]) =>
  Bun.spawnSync(['tmux', '-f', '/dev/null', '-S', person.socket, ...args], { env })
const paneSize = (person: PersonPane) =>
  tmux(person, 'display-message', '-p', '-t', person.pane, '#{pane_width}x#{pane_height}')
    .stdout.toString()
    .trim()

// The person's pane with the pump on it: host-1 is adopted, and the sizes that tmux reports.
const adopted = () => {
  const person = personPane('exec cat')
  const socket = `aristoteles-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
  const pump: TmuxPump = createTmuxPump({ dir: process.cwd(), socket })
  cleanups.push(() => person.kill())
  cleanups.push(() => pump.killServer())
  const sizes: TerminalSize[] = []
  pump.onSizes = [(sid, size) => sid === 'host-1' && sizes.push(size)]
  pump.adopt('host-1', person.socket, person.pane)
  return { person, pump, sizes }
}
// The person attaches from a terminal of 60 x 15: a real client, in a pty.
const smallPersonClient = (person: PersonPane) => {
  const client = Bun.spawn(['tmux', '-f', '/dev/null', '-S', person.socket, 'attach'], {
    env: { ...env, TERM: 'xterm-256color' },
    terminal: { cols: 60, rows: 15, data() {} },
  })
  cleanups.push(() => client.kill())
}
const clients = (person: PersonPane) =>
  tmux(person, 'list-clients', '-F', '#{client_control_mode}').stdout.toString().trim()

describe('fixed-size terminals (ruling 2026-11-14)', () => {
  test("a person's small terminal does not resize the pane that a page shows", async () => {
    const { person, pump, sizes } = adopted()
    pump.show('host-1')
    await until(() => clients(person) === '1')
    smallPersonClient(person)
    await until(() => clients(person).split('\n').length === 2)
    await Bun.sleep(300)
    expect(paneSize(person)).toBe('160x48')
    expect(pump.size('host-1')).toEqual({ cols: 160, rows: 48 })
    expect(sizes.filter((s) => s.cols !== 160 || s.rows !== 48)).toEqual([])
  }, 30000)

  test("the page's resize sets the window, and tmux reports the size", async () => {
    const { person, pump, sizes } = adopted()
    pump.show('host-1')
    await until(() => clients(person) === '1')
    pump.resize('host-1', 100, 30)
    await until(() => sizes.some((s) => s.cols === 100 && s.rows === 30))
    expect(paneSize(person)).toBe('100x30')
    expect(pump.size('host-1')).toEqual({ cols: 100, rows: 30 })
  }, 30000)

  test("the page's control client is no person: only a person's client counts", async () => {
    const { person, pump } = adopted()
    const keysAt = () =>
      Effect.runSync(
        Effect.gen(function* () {
          return yield* (yield* Pump).keysAt(SessionId.make('host-1'))
        }).pipe(Effect.provide(pumpLayerOf(pump))),
      )
    pump.show('host-1')
    await until(() => clients(person) === '1')
    expect(keysAt()).toBe(0)
    smallPersonClient(person)
    await until(() => keysAt() > 0)
    expect(keysAt()).toBeGreaterThan(Date.now() - 60000)
  }, 30000)

  test("an agent's window: the page's resize sets it, and tmux reports the size", async () => {
    const { pump } = adopted()
    const sizes: TerminalSize[] = []
    pump.onSizes = [(sid, size) => sid === 's-6' && sizes.push(size)]
    pump.start('s-6', 'exec cat')
    expect(pump.size('s-6')).toEqual({ cols: 160, rows: 48 })
    pump.resize('s-6', 100, 30)
    await until(() => sizes.some((s) => s.cols === 100 && s.rows === 30))
    expect(pump.size('s-6')).toEqual({ cols: 100, rows: 30 })
  }, 30000)

  test('no page shows the pane: no client of the pump on the person server', async () => {
    const { person, pump } = adopted()
    pump.show('host-1')
    await until(() => clients(person) === '1')
    pump.hide('host-1')
    await until(() => clients(person) === '')
    pump.show('host-1')
    await until(() => clients(person) === '1')
    pump.close()
    await until(() => clients(person) === '')
  }, 30000)
})
