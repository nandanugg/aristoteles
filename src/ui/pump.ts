// STUB (package P8, PORT of ui/pump.js). The pump of the terminals: tmux on its own socket, one
// tmux session per dir, one window per real agent; the output comes through tmux control mode.
// The facade is sync, as the tests and the server call it: inside, each method is an Effect run
// with Effect.runSync over the Spawn service; a refusal is thrown as an Error with the old words.
import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import { OutsideFailed } from '../domain/errors.ts'
import { Spawn, SpawnLive } from '../services/outside.ts'

export interface PumpOptions {
  readonly dir: string
  // The tmux socket (-L); the tests give each run its own.
  readonly socket?: string
  readonly onOutput?: (session: string, bytes: Uint8Array) => void
  readonly onExit?: (session: string, status: number | null) => void
  // Date.now(); a test gives the fake clock of its watcher.
  readonly clock?: () => number
}

export interface TerminalStatus {
  readonly live: boolean
  readonly ended: boolean
  readonly exit: number | null
  // The clock time of the last output; 0 when none.
  readonly lastOutput: number
}

export interface StartOptions {
  readonly env?: Readonly<Record<string, string>>
  readonly cols?: number
  readonly rows?: number
}

export interface Pump {
  readonly name: string
  readonly socket: string
  readonly dir: string
  // Listeners that the server adds; each gets every output.
  onOutputs?: ReadonlyArray<(session: string, bytes: Uint8Array) => void>
  // Throws: '"x" is not a session id', 'the session s-1 has a terminal already'.
  readonly start: (session: string, command: string, options?: StartOptions) => string
  readonly resume: (session: string, command: string, options?: StartOptions) => string
  readonly input: (session: string, text: string) => void
  readonly resize: (session: string, cols: number, rows: number) => void
  readonly stop: (session: string) => void
  readonly snapshot: (session: string) => Uint8Array
  readonly status: () => Readonly<Record<string, TerminalStatus>>
  readonly tail: (session: string, lines?: number) => string
  // The host's own pane on the person's tmux server (Nanda, 2026-11-13): the pump copies its
  // screen and types into it; start, resume and stop refuse it, and a resize only fits the copy.
  readonly adopt: (session: string, socket: string, pane: string) => void
  readonly release: (session: string) => void
  readonly paneOf: (session: string) => { readonly socket: string; readonly pane: string } | undefined
  readonly close: () => void
  readonly killServer: () => void
}

const RING = 256 * 1024

// tmux escapes a byte below 32 and the backslash as \ooo in a line of control mode.
export const unescapeOutput = (bytes: Uint8Array): Uint8Array => {
  const out: number[] = []
  const octal = (x: number | undefined) => x !== undefined && x >= 0x30 && x <= 0x37
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    const [d1, d2, d3] = [bytes[i + 1], bytes[i + 2], bytes[i + 3]]
    if (b === 0x5c && i + 3 < bytes.length && octal(d1) && octal(d2) && octal(d3)) {
      out.push(((d1! - 0x30) << 6) | ((d2! - 0x30) << 3) | (d3! - 0x30))
      i += 3
    } else {
      out.push(b)
    }
  }
  return Uint8Array.from(out)
}

interface PaneRow {
  readonly pane: string
  readonly sid: string
  readonly dead: boolean
  readonly status: number | null
}

interface Ring {
  readonly chunks: Uint8Array[]
  size: number
  last: number
}

// The mouse modes that a pane has on now: tmux's flag and the private mode of each.
const MOUSE = [
  ['mouse_standard_flag', 1000],
  ['mouse_button_flag', 1002],
  ['mouse_all_flag', 1003],
  ['mouse_utf8_flag', 1005],
  ['mouse_sgr_flag', 1006],
] as const

// Throws 'tmux is not on this machine; the terminals of the UI need tmux' without tmux.
export const createPump = (options: PumpOptions): Pump => {
  const { dir, socket = 'aristoteles', clock = () => Date.now() } = options
  const onOutput = options.onOutput ?? (() => {})
  const onExit = options.onExit ?? (() => {})
  const name = `ar-${createHash('sha256').update(dir).digest('hex').slice(0, 10)}`
  // -f /dev/null: the person's tmux.conf does not apply to the pump's own server. The server
  // copies its environment from the first client, and the agents' panes inherit it, so no
  // variable names the person's own tmux server (a config such as oh-my-tmux sends its theme to
  // $TMUX_SOCKET).
  const { TMUX: _t, TMUX_PANE: _p, TMUX_SOCKET: _s, ...tmuxEnv } = process.env

  // One tmux call. The exit code is data; each caller says what a failure means.
  const tmux = (...args: string[]) =>
    Effect.gen(function* () {
      const spawn = yield* Spawn
      return yield* spawn.run(['tmux', '-f', '/dev/null', '-L', socket, ...args], { env: tmuxEnv })
    })
  const tmuxNow = (...args: string[]) =>
    Effect.runSync(tmux(...args).pipe(Effect.provide(SpawnLive)))
  // A refusal of the pump is an Error with the old words, as the server and the tests expect.
  const refuse = (message: string): never => {
    throw new Error(message)
  }
  const failed = (message: string) => new OutsideFailed({ system: 'tmux', message, next: null })

  if (tmuxNow('-V').code !== 0) {
    refuse('tmux is not on this machine; the terminals of the UI need tmux')
  }

  // The session of the dir, with a home window that keeps it alive when the agents end.
  const makeSession = () => {
    const made = tmuxNow(
      'new-session', '-d', '-s', name, '-n', '_home', '-x', '160', '-y', '48', '-c', dir,
      '--', 'sh', '-c', 'exec cat',
    )
    if (made.code !== 0 && tmuxNow('has-session', '-t', name).code !== 0) {
      const why = made.err.trim() || made.out.trim()
      refuse(`tmux could not start the session of ${dir}: ${why}`)
    }
  }
  if (tmuxNow('has-session', '-t', name).code !== 0) makeSession()
  // The socket is the pump's own, so its global options touch no session of the person.
  tmuxNow('set-option', '-g', '-w', 'remain-on-exit', 'on')
  tmuxNow('set-option', '-g', '-w', 'window-size', 'manual')
  tmuxNow('set-option', '-g', 'history-limit', '20000')

  const rings = new Map<string, Ring>()
  const panes = new Map<string, string>() // pane id -> session id
  const keep = (sid: string, bytes: Uint8Array) => {
    let ring = rings.get(sid)
    if (!ring) {
      ring = { chunks: [], size: 0, last: 0 }
      rings.set(sid, ring)
    }
    ring.chunks.push(bytes)
    ring.size += bytes.length
    ring.last = clock()
    while (ring.size > RING && ring.chunks.length > 1) ring.size -= ring.chunks.shift()!.length
  }

  const list = (): PaneRow[] => {
    const fields = '#{pane_id}|#{window_name}|#{pane_dead}|#{pane_dead_status}'
    const r = tmuxNow('list-panes', '-s', '-t', name, '-F', fields)
    if (r.code !== 0) return []
    return r.out
      .split('\n')
      .filter(Boolean)
      .map((row) => {
        const [pane = '', sid = '', dead = '', status = ''] = row.split('|')
        return { pane, sid, dead: dead === '1', status: status === '' ? null : Number(status) }
      })
      .filter((p) => p.sid !== '_home')
  }
  const refreshPanes = () => {
    panes.clear()
    for (const p of list()) panes.set(p.pane, p.sid)
  }
  refreshPanes()

  // The control client: %output lines carry the bytes of each pane.
  let client: Bun.Subprocess<'pipe', 'pipe', 'ignore'> | undefined
  let closed = false
  const OUTPUT = new TextEncoder().encode('%output %')
  const line = (bytes: Uint8Array) => {
    if (bytes.length < OUTPUT.length || !OUTPUT.every((b, i) => bytes[i] === b)) return
    const space = bytes.indexOf(0x20, OUTPUT.length)
    if (space === -1) return
    const pane = `%${new TextDecoder().decode(bytes.subarray(OUTPUT.length, space))}`
    if (!panes.has(pane)) refreshPanes()
    const sid = panes.get(pane)
    if (!sid) return
    const data = unescapeOutput(bytes.subarray(space + 1))
    keep(sid, data)
    onOutput(sid, data)
    for (const fn of pump.onOutputs ?? []) fn(sid, data)
  }
  const attach = () => {
    // The session can be gone (its server was killed): make it again before the client attaches.
    if (tmuxNow('has-session', '-t', name).code !== 0) makeSession()
    const spawned = Bun.spawn(
      ['tmux', '-f', '/dev/null', '-L', socket, '-C', 'attach-session', '-t', name],
      { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore', env: tmuxEnv },
    )
    client = spawned
    // The pump does not keep its process alive: the server, or a test, decides when it ends.
    spawned.unref()
    void (async () => {
      const reader = spawned.stdout.getReader()
      let rest = new Uint8Array(0)
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const all = new Uint8Array(rest.length + value.length)
        all.set(rest)
        all.set(value, rest.length)
        let start = 0
        for (let i = 0; i < all.length; i++) {
          if (all[i] !== 0x0a) continue
          line(all.subarray(start, i))
          start = i + 1
        }
        rest = all.slice(start)
      }
      if (!closed) setTimeout(attach, 500)
    })()
  }
  attach()

  // Each second: which panes ended since the last look.
  const known = new Map<string, PaneRow>()
  const poll = setInterval(() => {
    for (const p of list()) {
      const was = known.get(p.sid)
      if (p.dead && !was?.dead) onExit(p.sid, p.status)
      known.set(p.sid, p)
    }
  }, 1000)
  poll.unref()

  // The host's own pane on the person's tmux server (Nanda, 2026-11-13). The pump attaches no
  // client there and sets no option: about three times a second it copies the screen of that one
  // pane (capture-pane), and it types with send-keys. The page sees the copy as a frame that
  // redraws its screen: the rows that fit the page, up to the cursor or the last row with text
  // (an AI CLI keeps its input box at the bottom), with no wrap, and the cursor.
  interface Adopted {
    readonly socket: string
    readonly pane: string
    frame: Uint8Array
    last: number
    ended: boolean
    rows: number
  }
  const adopted = new Map<string, Adopted>()
  const onPersonServer = (socket: string, args: ReadonlyArray<string>) =>
    Bun.spawnSync(['tmux', '-f', '/dev/null', '-S', socket, ...args], { env: tmuxEnv })
  const lookAsync = async (socket: string, args: ReadonlyArray<string>) => {
    const p = Bun.spawn(['tmux', '-f', '/dev/null', '-S', socket, ...args], {
      stdout: 'pipe',
      stderr: 'ignore',
      env: tmuxEnv,
    })
    const out = await new Response(p.stdout).text()
    return { code: await p.exited, out }
  }
  const frameOf = (screen: string, cursorX: number, cursorY: number, rows: number) => {
    const lines = screen.replace(/\n$/, '').split('\n')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the escapes of a colored row
    const blank = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, '').trim() === ''
    let end = lines.length
    while (end > 0 && blank(lines[end - 1] ?? '')) end--
    end = Math.min(lines.length, Math.max(end, cursorY + 1))
    const start = Math.max(0, end - rows)
    const row = cursorY - start
    const cursor = row >= 0 && row < rows ? `\x1b[${row + 1};${cursorX + 1}H` : ''
    const shown = lines.slice(start, end).join('\r\n')
    return new TextEncoder().encode(`\x1b[?7l\x1b[H\x1b[2J${shown}${cursor}`)
  }
  const sameBytes = (a: Uint8Array, b: Uint8Array) =>
    a.length === b.length && a.every((x, i) => x === b[i])
  let looking = false
  const lookAtPanes = async () => {
    if (looking) return
    looking = true
    try {
      for (const [sid, a] of adopted) {
        const where = ['-t', a.pane]
        const info = await lookAsync(a.socket, ['display-message', '-p', ...where, '#{pane_dead} #{cursor_x} #{cursor_y}'])
        const [dead = '1', x = '0', y = '0'] = info.out.trim().split(' ')
        const ended = info.code !== 0 || dead === '1'
        if (ended && !a.ended) onExit(sid, null)
        a.ended = ended
        if (ended) continue
        const screen = await lookAsync(a.socket, ['capture-pane', '-p', '-e', ...where])
        if (screen.code !== 0 || adopted.get(sid) !== a) continue
        const frame = frameOf(screen.out, Number(x), Number(y), a.rows)
        if (sameBytes(frame, a.frame)) continue
        a.frame = frame
        a.last = clock()
        onOutput(sid, frame)
        for (const fn of pump.onOutputs ?? []) fn(sid, frame)
      }
    } finally {
      looking = false
    }
  }
  const panePoll = setInterval(() => void lookAtPanes(), 300)
  panePoll.unref()
  const ownPane = (sid: string): string =>
    refuse(`${sid} is the host's own terminal (pane ${adopted.get(sid)?.pane}); the UI does not start, restart, or stop it`)

  const target = (sid: string) => `${name}:=${sid}`
  const exists = (sid: string) => list().some((p) => p.sid === sid)
  const mouseModes = (sid: string) => {
    const format = MOUSE.map(([flag]) => `#{${flag}}`).join(' ')
    const r = tmuxNow('display-message', '-p', '-t', target(sid), format)
    if (r.code !== 0) return ''
    return r.out
      .trim()
      .split(' ')
      .map((on, i) => (on === '1' ? `\x1b[?${MOUSE[i]![1]}h` : ''))
      .join('')
  }

  // The tmux call of a start or resume that must work, as an Effect that fails with the words.
  const mustTmux = (what: string, args: string[]) =>
    Effect.gen(function* () {
      const r = yield* tmux(...args)
      if (r.code !== 0) return yield* Effect.fail(failed(`tmux could not ${what}: ${r.err.trim()}`))
      return r
    })
  const runOrThrow = <A>(effect: Effect.Effect<A, OutsideFailed, Spawn>): A => {
    const done = Effect.runSync(
      effect.pipe(
        Effect.provide(SpawnLive),
        Effect.match({
          onFailure: (e) => ({ failed: e.message }),
          onSuccess: (value) => ({ value }),
        }),
      ),
    )
    if ('failed' in done) return refuse(done.failed)
    return done.value
  }

  const pump: Pump = {
    name,
    socket,
    dir,
    // Starts a real agent: its command runs in a new window, with ARISTOTELES_SESSION set, so
    // that the CLI refuses a person command from it.
    start(sid, command, { env = {}, cols = 160, rows = 48 } = {}) {
      if (adopted.has(sid)) return ownPane(sid)
      if (!/^[A-Za-z0-9._-]+$/.test(sid)) return refuse(`"${sid}" is not a session id`)
      if (exists(sid)) return refuse(`the session ${sid} has a terminal already`)
      const envArgs = Object.entries({ ARISTOTELES_SESSION: sid, ...env }).flatMap(([k, v]) => [
        '-e',
        `${k}=${v}`,
      ])
      const r = runOrThrow(
        mustTmux(`start ${sid}`, [
          'new-window', '-d', '-t', `${name}:`, '-n', sid, '-c', dir, ...envArgs,
          '-P', '-F', '#{pane_id}', '--', 'sh', '-c', command,
        ]),
      )
      panes.set(r.out.trim(), sid)
      tmuxNow('resize-window', '-t', target(sid), '-x', String(cols), '-y', String(rows))
      known.delete(sid)
      return r.out.trim()
    },
    // A resume: a dead pane runs the resume command; a closed window is made again.
    resume(sid, command, options = {}) {
      if (adopted.has(sid)) return ownPane(sid)
      const p = list().find((x) => x.sid === sid)
      if (p && !p.dead) return refuse(`the session ${sid} runs`)
      if (p) {
        const respawn = ['respawn-pane', '-k', '-t', p.pane, '--', 'sh', '-c', command]
        runOrThrow(mustTmux(`resume ${sid}`, respawn))
        known.delete(sid)
        return p.pane
      }
      return pump.start(sid, command, options)
    },
    // The person's input, or the host's: every byte as a hex key, in one call for each piece, so
    // that an escape sequence (an arrow key) reaches the tool in one read, not as an Escape and
    // then text; a ';' or a leading '-' is no tmux syntax this way.
    input(sid, text) {
      const a = adopted.get(sid)
      if (!a && !exists(sid)) return refuse(`the session ${sid} has no terminal`)
      const bytes = new TextEncoder().encode(text)
      for (let i = 0; i < bytes.length; i += 1024) {
        const hex = [...bytes.subarray(i, i + 1024)].map((b) => b.toString(16).padStart(2, '0'))
        if (a) {
          const r = onPersonServer(a.socket, ['send-keys', '-t', a.pane, '-H', ...hex])
          if (r.exitCode !== 0) refuse(`tmux could not type into ${sid}: ${r.stderr.toString().trim()}`)
          continue
        }
        runOrThrow(mustTmux(`type into ${sid}`, ['send-keys', '-t', target(sid), '-H', ...hex]))
      }
    },
    // The host's own pane keeps the size of the person's terminal; the copy shows its bottom rows.
    resize(sid, cols, rows) {
      const a = adopted.get(sid)
      if (a) {
        a.rows = rows
        a.frame = new Uint8Array()
        return
      }
      if (exists(sid)) {
        tmuxNow('resize-window', '-t', target(sid), '-x', String(cols), '-y', String(rows))
      }
    },
    // A stop of the person: the window goes, and the watcher does not retry it.
    stop(sid) {
      if (adopted.has(sid)) return ownPane(sid)
      tmuxNow('kill-window', '-t', target(sid))
      known.delete(sid)
    },
    // The bytes to show a tab that opens: the ring buffer, or the screen of the pane after a
    // restart of the server; then the mouse modes of the pane now. A tool that turned them on
    // before the ring started (Claude scrolls its own view with the wheel) needs them in the
    // page too, else the wheel scrolls the page's own history, which is empty.
    snapshot(sid) {
      const a = adopted.get(sid)
      if (a) return a.frame
      const modes = new TextEncoder().encode(mouseModes(sid))
      const ring = rings.get(sid)
      if (ring?.size) {
        const all = new Uint8Array(ring.size + modes.length)
        let at = 0
        for (const c of [...ring.chunks, modes]) {
          all.set(c, at)
          at += c.length
        }
        return all
      }
      const r = tmuxNow('capture-pane', '-p', '-e', '-J', '-S', '-2000', '-t', target(sid))
      const screen = r.code === 0 ? r.out.replaceAll('\n', '\r\n') : ''
      return new TextEncoder().encode(`${screen}${mouseModes(sid)}`)
    },
    // The state of each terminal: runs, or ended (with its exit status), and its last output.
    status() {
      return Object.fromEntries([
        ...list().map((p) => [
          p.sid,
          { live: !p.dead, ended: p.dead, exit: p.status, lastOutput: rings.get(p.sid)?.last ?? 0 },
        ]),
        ...[...adopted].map(([sid, a]) => [
          sid,
          { live: !a.ended, ended: a.ended, exit: null, lastOutput: a.last },
        ]),
      ])
    },
    // The last lines of a terminal, for the words of an event.
    tail(sid, lines = 12) {
      const a = adopted.get(sid)
      const r = a
        ? (({ exitCode, stdout }) => ({ code: exitCode, out: stdout.toString() }))(
            onPersonServer(a.socket, ['capture-pane', '-p', '-J', '-S', '-500', '-t', a.pane]),
          )
        : tmuxNow('capture-pane', '-p', '-J', '-S', '-500', '-t', target(sid))
      if (r.code !== 0) return ''
      return r.out
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('Pane is dead'))
        .slice(-lines)
        .join('\n')
    },
    adopt(sid, socket, pane) {
      const a = adopted.get(sid)
      if (a?.socket === socket && a.pane === pane) return
      adopted.set(sid, { socket, pane, frame: new Uint8Array(), last: clock(), ended: false, rows: 48 })
      void lookAtPanes()
    },
    release(sid) {
      adopted.delete(sid)
    },
    paneOf(sid) {
      const a = adopted.get(sid)
      return a ? { socket: a.socket, pane: a.pane } : undefined
    },
    close() {
      closed = true
      clearInterval(poll)
      clearInterval(panePoll)
      try {
        client?.stdin?.end()
        client?.kill()
      } catch {}
    },
    // For the tests: ends the tmux server of the socket.
    killServer() {
      pump.close()
      tmuxNow('kill-server')
    },
  }
  return pump
}
