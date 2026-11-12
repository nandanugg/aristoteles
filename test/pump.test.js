// The pump of the terminals (plan/ui/BUILD.md part 5): real terminals in tmux, on a socket of
// their own; the output of each comes through the control mode of tmux, into a ring buffer.
// The tests use a fake AI tool (test/fake-agent.js) and a tmux socket of their own.
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPump, unescapeOutput } from './code.js'

const FAKE = join(import.meta.dir, 'fake-agent.js')
const pumps = []
afterEach(() => {
  while (pumps.length) pumps.pop().killServer()
})
const make = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pump-'))
  const seen = new Map()
  const exits = []
  const pump = createPump({
    dir, socket: `aristoteles-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    onOutput: (sid, bytes) => seen.set(sid, (seen.get(sid) ?? '') + new TextDecoder().decode(bytes)),
    onExit: (sid, status) => exits.push([sid, status]),
  })
  pumps.push(pump)
  return { pump, seen, exits }
}
const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (fn()) return true
    await Bun.sleep(50)
  }
  throw new Error('timed out')
}
const text = (bytes) => new TextDecoder().decode(bytes)

describe('the pump', () => {
  test('control mode escapes a byte below 32 and the backslash', () => {
    expect(text(unescapeOutput(new TextEncoder().encode('a\\015\\012b\\134c é')))).toBe('a\r\nb\\c é')
  })

  test('a real agent runs in its own terminal, with its session id; input and output pass through', async () => {
    const { pump, seen } = make()
    pump.start('s-1', `bun ${FAKE} start s-1`)
    await until(() => seen.get('s-1')?.includes('fake agent start s-1 (env s-1)'))
    pump.input('s-1', 'héllo; wörld -y\r')
    await until(() => seen.get('s-1')?.includes('you said: héllo; wörld -y'))
    expect(pump.status()['s-1']).toMatchObject({ live: true, ended: false })
    expect(text(pump.snapshot('s-1'))).toContain('you said: héllo; wörld -y')
    expect(() => pump.start('s-1', 'true')).toThrow('the session s-1 has a terminal already')
  }, 30000)

  test("a terminal gets no variable of the person's own tmux server", async () => {
    // oh-my-tmux in a server sends its theme to $TMUX_SOCKET: that was the person's server.
    const saved = { TMUX: process.env.TMUX, TMUX_SOCKET: process.env.TMUX_SOCKET }
    process.env.TMUX = '/tmp/the-persons-tmux,1,0'
    process.env.TMUX_SOCKET = '/tmp/the-persons-tmux'
    let made
    try {
      made = make()
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
    made.pump.start('s-env', 'echo "socket=[$TMUX_SOCKET] tmux=[$TMUX]"; exec cat')
    await until(() => made.seen.get('s-env')?.includes('socket=['))
    expect(made.seen.get('s-env')).toContain('socket=[]')
    expect(made.seen.get('s-env')).not.toContain('the-persons-tmux')
  }, 30000)

  test('an ended terminal stays to read; a resume runs the resume command in it', async () => {
    const { pump, seen, exits } = make()
    pump.start('s-2', `bun ${FAKE} start s-2`)
    await until(() => seen.get('s-2')?.includes('> '))
    pump.input('s-2', 'fail\r')
    await until(() => exits.length > 0)
    expect(exits).toEqual([['s-2', 1]])
    expect(pump.status()['s-2']).toMatchObject({ live: false, ended: true, exit: 1 })
    expect(pump.tail('s-2')).toContain('connection error')
    pump.resume('s-2', `bun ${FAKE} resumed s-2`)
    await until(() => seen.get('s-2')?.includes('fake agent resumed s-2'))
    expect(pump.status()['s-2'].live).toBe(true)
  }, 30000)

  test('a stop closes the window; a resume makes it again', async () => {
    const { pump, seen } = make()
    pump.start('s-3', `bun ${FAKE} start s-3`)
    await until(() => seen.get('s-3')?.includes('> '))
    pump.stop('s-3')
    expect(pump.status()['s-3']).toBeUndefined()
    pump.resume('s-3', `bun ${FAKE} resumed s-3`)
    await until(() => seen.get('s-3')?.includes('fake agent resumed s-3'))
  }, 30000)

  test('a terminal keeps running when its pump closes; a new pump finds it and shows its screen', async () => {
    const { pump } = make()
    pump.start('s-4', `bun ${FAKE} start s-4`)
    await until(() => pump.tail('s-4').includes('fake agent start s-4'))
    pump.close()
    const again = createPump({ dir: pump.dir, socket: pump.socket })
    pumps.push(again)
    expect(again.status()['s-4']).toMatchObject({ live: true })
    expect(text(again.snapshot('s-4'))).toContain('fake agent start s-4')
  }, 30000)

  test('a tab that opens gets the mouse modes of the pane, so that the wheel reaches the tool', async () => {
    const { pump } = make()
    pump.start('s-5', `printf '\\033[?1003h\\033[?1006h'; echo ready; sleep 30`)
    await until(() => pump.tail('s-5').includes('ready'))
    expect(text(pump.snapshot('s-5'))).toEndWith('\x1b[?1003h\x1b[?1006h')
    // A new pump has no ring for the pane: the screen comes from tmux, and the modes after it.
    pump.close()
    const again = createPump({ dir: pump.dir, socket: pump.socket })
    pumps.push(again)
    const screen = text(again.snapshot('s-5'))
    expect(screen).toContain('ready')
    expect(screen).toEndWith('\r\n\x1b[?1003h\x1b[?1006h')
  }, 30000)
})
