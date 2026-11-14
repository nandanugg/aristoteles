// The pump of the terminals (package P6; the behavior of the old pump): tmux on its own socket,
// one tmux session per dir, one window per real agent; the output comes through tmux control mode.
// The host's pane is the person's own (Nanda, 2026-11-13): the pump streams it to a page and types
// into it, and never starts, stops or restarts it.
//
// Each terminal has a fixed size (ruling 2026-11-14): tmux holds it, the page shows exactly the
// pane's size, and only the page's resize button changes it (resize-window). That holds for the
// host's pane too: its window then keeps the page's size, whatever the person's terminal is.
//
// One engine, two views. createTmuxPump is the sync facade that the frozen createPump of
// adapters/web returns; pumpLayerOf makes the Pump service of core/services from any facade (a
// test's fake too). The frozen WatcherOptions.pump is a facade, so the watcher needs this way.
import { createHash } from 'node:crypto'
import { Effect, Layer } from 'effect'
import { OutsideFailed } from '../../core/schema/index.ts'
import type { TerminalReading } from '../../core/schema/outside.ts'
import { type PaneRef, pathOf, Pump, Spawn, SpawnLive } from '../../core/services/index.ts'

export interface TmuxPumpOptions {
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

export interface TerminalSize {
  readonly cols: number
  readonly rows: number
}

// The sync facade (adapters/web/frozen.ts Pump has this shape); a refusal is a thrown Error.
export interface TmuxPump {
  readonly name: string
  readonly socket: string
  readonly dir: string
  // Listeners that the server adds; each gets every output.
  onOutputs: ReadonlyArray<(session: string, bytes: Uint8Array) => void>
  readonly start: (session: string, command: string, options?: StartOptions) => string
  readonly resume: (session: string, command: string, options?: StartOptions) => string
  readonly input: (session: string, text: string) => void
  readonly resize: (session: string, cols: number, rows: number) => void
  readonly stop: (session: string) => void
  readonly snapshot: (session: string) => Uint8Array
  readonly status: () => Readonly<Record<string, TerminalStatus>>
  readonly tail: (session: string, lines?: number) => string
  readonly adopt: (session: string, socket: string, pane: string) => void
  readonly release: (session: string) => void
  readonly paneOf: (
    session: string,
  ) => { readonly socket: string; readonly pane: string } | undefined
  readonly close: () => void
  readonly killServer: () => void
  // The size of a terminal, as tmux has it; undefined when tmux has no pane for it.
  readonly size: (session: string) => TerminalSize | undefined
  // Listeners that the server adds; each gets every size that tmux reports after a resize.
  onSizes: ReadonlyArray<(session: string, size: TerminalSize) => void>
  // A page shows the terminal now (its first tab), or no page shows it any more (its last).
  readonly show: (session: string) => void
  readonly hide: (session: string) => void
}

const RING = 256 * 1024

const isOctal = (x: number | undefined): x is number => x !== undefined && x >= 0x30 && x <= 0x37
// tmux escapes a byte below 32 and the backslash as \ooo in a line of control mode.
export const unescapeOutput = (bytes: Uint8Array): Uint8Array => {
  const out: number[] = []
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0
    const [d1, d2, d3] = [bytes[i + 1], bytes[i + 2], bytes[i + 3]]
    if (b === 0x5c && i + 3 < bytes.length && isOctal(d1) && isOctal(d2) && isOctal(d3)) {
      out.push(((d1 - 0x30) << 6) | ((d2 - 0x30) << 3) | (d3 - 0x30))
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
  readonly size: TerminalSize
}

interface Ring {
  readonly chunks: Uint8Array[]
  size: number
  last: number
}

type ControlClient = Bun.Subprocess<'pipe', 'pipe', 'ignore'>

// The host's own pane on the person's tmux server.
interface Adopted {
  readonly socket: string
  readonly pane: string
  // The clock time when the look of each second last saw new output: #{window_activity} (the
  // seconds of tmux) grew past `activity`.
  last: number
  activity: number
  ended: boolean
  // The control client that streams the pane, while a page shows it.
  client: ControlClient | undefined
}

// The mouse modes that a pane has on now: tmux's flag and the private mode of each.
const MOUSE = [
  ['mouse_standard_flag', 1000],
  ['mouse_button_flag', 1002],
  ['mouse_all_flag', 1003],
  ['mouse_utf8_flag', 1005],
  ['mouse_sgr_flag', 1006],
] as const
const MOUSE_FLAGS = MOUSE.map(([flag]) => `#{${flag}}`).join(' ')
// The private modes to turn on for the flags of MOUSE_FLAGS, as tmux printed them.
const mouseModesOf = (flags: ReadonlyArray<string>): string =>
  flags.map((on, i) => (on === '1' ? `\x1b[?${MOUSE[i]?.[1]}h` : '')).join('')

// No variable of a tmux call names the person's own tmux server (oh-my-tmux sends its theme to
// $TMUX_SOCKET); the server copies its env from the first client, and the agents' panes inherit it.
const tmuxEnv = (): Record<string, string | undefined> => {
  const { TMUX: _t, TMUX_PANE: _p, TMUX_SOCKET: _s, ...rest } = process.env
  return rest
}

// The person's tmux server, by its socket file (-S); -f /dev/null keeps the person's config out.
const onPersonServer = (socket: string, args: ReadonlyArray<string>) =>
  Bun.spawnSync([pathOf('tmux'), '-f', '/dev/null', '-S', socket, ...args], { env: tmuxEnv() })

// --- control mode ------------------------------------------------------------------------------

// A tmux client in control mode (-C), on the server that the args name: each line of its output
// goes to onLine, and onEnd runs when the output ends (tmux detached it, or the server ended).
// Its stdin stays open, because tmux ends a control client at the end of its input. The client
// does not keep the process alive: the server, or a test, decides when it ends.
const controlClient = (
  args: ReadonlyArray<string>,
  onLine: (line: Uint8Array) => void,
  onEnd: () => void,
): ControlClient => {
  const spawned = Bun.spawn([pathOf('tmux'), '-f', '/dev/null', ...args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
    env: tmuxEnv(),
  })
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
        onLine(all.subarray(start, i))
        start = i + 1
      }
      rest = all.slice(start)
    }
    onEnd()
  })()
  return spawned
}
const detach = (client: ControlClient | undefined) => {
  try {
    client?.stdin.end()
    client?.kill()
  } catch {}
}

const startsWith = (bytes: Uint8Array, prefix: Uint8Array) =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b)
const OUTPUT = new TextEncoder().encode('%output %')
// tmux resized a window of the client's session (`%layout-change @<window> <layout> ...`).
const LAYOUT_CHANGE = new TextEncoder().encode('%layout-change ')
// A line `%output %<pane number> <bytes>`: the pane id, and its bytes still escaped (a client of
// a whole session gets every pane, so each caller unescapes only the panes it keeps).
const outputOf = (line: Uint8Array) => {
  if (!startsWith(line, OUTPUT)) return undefined
  const space = line.indexOf(0x20, OUTPUT.length)
  if (space === -1) return undefined
  const pane = `%${new TextDecoder().decode(line.subarray(OUTPUT.length, space))}`
  return { pane, escaped: line.subarray(space + 1) }
}

// Throws 'tmux is not on this machine; the terminals of the UI need tmux' without tmux.
export const createTmuxPump = (options: TmuxPumpOptions): TmuxPump => {
  const { dir, socket = 'aristoteles', clock = () => Date.now() } = options
  const onOutput = options.onOutput ?? (() => {})
  const onExit = options.onExit ?? (() => {})
  const name = `ar-${createHash('sha256').update(dir).digest('hex').slice(0, 10)}`
  const env = tmuxEnv()

  // One tmux call on the pump's own server (-f /dev/null: no tmux.conf of the person). The exit
  // code is data; each caller says what a failure means.
  const tmux = (...args: string[]) =>
    Effect.gen(function* () {
      const spawn = yield* Spawn
      return yield* spawn.run([pathOf('tmux'), '-f', '/dev/null', '-L', socket, ...args], { env })
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
      ...['new-session', '-d', '-s', name, '-n', '_home', '-x', '160', '-y', '48', '-c', dir],
      ...['--', 'sh', '-c', 'exec cat'],
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
    while (ring.size > RING && ring.chunks.length > 1) {
      ring.size -= ring.chunks.shift()?.length ?? 0
    }
  }

  const list = (): PaneRow[] => {
    const fields =
      '#{pane_id}|#{window_name}|#{pane_dead}|#{pane_dead_status}|#{pane_width}x#{pane_height}'
    const r = tmuxNow('list-panes', '-s', '-t', name, '-F', fields)
    if (r.code !== 0) return []
    return r.out
      .split('\n')
      .filter(Boolean)
      .map((row) => {
        const [pane = '', sid = '', dead = '', status = '', size = ''] = row.split('|')
        const [cols = 0, rows = 0] = size.split('x').map(Number)
        const exit = status === '' ? null : Number(status)
        return { pane, sid, dead: dead === '1', status: exit, size: { cols, rows } }
      })
      .filter((p) => p.sid !== '_home')
  }
  const refreshPanes = () => {
    panes.clear()
    for (const p of list()) panes.set(p.pane, p.sid)
  }
  refreshPanes()

  // Each output and each new size of a terminal, to the listeners.
  const emit = (sid: string, bytes: Uint8Array) => {
    onOutput(sid, bytes)
    for (const fn of pump.onOutputs) fn(sid, bytes)
  }
  const emitSize = (sid: string, size: TerminalSize) => {
    for (const fn of pump.onSizes) fn(sid, size)
  }

  // The control client of the pump's own session: %output lines carry the bytes of each pane;
  // after a %layout-change each terminal says its size again (a page that has it already keeps it).
  let client: ControlClient | undefined
  let closed = false
  const ownLine = (line: Uint8Array) => {
    if (startsWith(line, LAYOUT_CHANGE)) {
      for (const p of list()) emitSize(p.sid, p.size)
      return
    }
    const output = outputOf(line)
    if (!output) return
    if (!panes.has(output.pane)) refreshPanes()
    const sid = panes.get(output.pane)
    if (!sid) return
    const data = unescapeOutput(output.escaped)
    keep(sid, data)
    emit(sid, data)
  }
  const attach = () => {
    // The session can be gone (its server was killed): make it again before the client attaches.
    if (tmuxNow('has-session', '-t', name).code !== 0) makeSession()
    client = controlClient(['-L', socket, '-C', 'attach-session', '-t', name], ownLine, () => {
      if (!closed) setTimeout(attach, 500)
    })
  }
  attach()

  // The host's own pane (ruling 2026-11-14): while a page shows it, one control client on the
  // person's server streams it to every tab that shows it; ignore-size keeps that client out of
  // the window's size. The pump types into it with send-keys.
  const adopted = new Map<string, Adopted>()
  const hostSize = (a: Adopted): TerminalSize | undefined => {
    const format = '#{pane_width} #{pane_height}'
    const r = onPersonServer(a.socket, ['display-message', '-p', '-t', a.pane, format])
    if (r.exitCode !== 0) return undefined
    const [cols = 0, rows = 0] = r.stdout.toString().trim().split(' ').map(Number)
    return { cols, rows }
  }
  // The first bytes for a tab that opens the host's pane: its screen now (capture-pane -e), the
  // cursor, and the mouse modes on now; after them the tab gets only the %output of the pane. The
  // first client can attach a moment after this capture: output of that moment shows on the page
  // when the tool draws again.
  const hostFrame = (a: Adopted): Uint8Array => {
    const format = `#{cursor_x} #{cursor_y} ${MOUSE_FLAGS}`
    const info = onPersonServer(a.socket, ['display-message', '-p', '-t', a.pane, format])
    const screen = onPersonServer(a.socket, ['capture-pane', '-p', '-e', '-t', a.pane])
    if (info.exitCode !== 0 || screen.exitCode !== 0) return new Uint8Array()
    const [x = '0', y = '0', ...flags] = info.stdout.toString().trim().split(' ')
    const rows = screen.stdout.toString().replace(/\n$/, '').replaceAll('\n', '\r\n')
    const cursor = `\x1b[${Number(y) + 1};${Number(x) + 1}H`
    return new TextEncoder().encode(`\x1b[H\x1b[2J${rows}${cursor}${mouseModesOf(flags)}`)
  }
  const streamHost = (sid: string, a: Adopted) => {
    // Not read-only (-r): tmux refuses a send-keys from outside the session when its newest
    // client is read-only, and this client is the newest. It is sent no command.
    const args = ['-S', a.socket, '-C', 'attach-session', '-f', 'ignore-size', '-t', a.pane]
    const hostLine = (line: Uint8Array) => {
      if (startsWith(line, LAYOUT_CHANGE)) {
        const size = hostSize(a)
        if (size) emitSize(sid, size)
        return
      }
      const output = outputOf(line)
      if (output?.pane === a.pane) emit(sid, unescapeOutput(output.escaped))
    }
    // The person's tmux can detach the client (an attach -d detaches every other client): while
    // a page shows the pane, a new client streams it, after a whole frame of what the page missed.
    const detached = () => {
      if (a.client !== hostClient) return
      setTimeout(() => {
        if (adopted.get(sid) !== a || a.client !== hostClient) return
        a.client = undefined
        if (hostSize(a) === undefined) return
        streamHost(sid, a)
        emit(sid, hostFrame(a))
      }, 500)
    }
    const hostClient = controlClient(args, hostLine, detached)
    a.client = hostClient
  }

  // Each second: which panes ended since the last look, and whether the host's pane wrote (tmux
  // keeps the time of the last output for a whole window only). This look needs no client on the
  // person's server, so the watcher reads the host's pane while no page shows it too.
  const known = new Map<string, PaneRow>()
  const poll = setInterval(() => {
    for (const p of list()) {
      const was = known.get(p.sid)
      if (p.dead && !was?.dead) onExit(p.sid, p.status)
      known.set(p.sid, p)
    }
    for (const [sid, a] of adopted) {
      const format = '#{pane_dead} #{window_activity}'
      const r = onPersonServer(a.socket, ['display-message', '-p', '-t', a.pane, format])
      const [dead = '1', activity = '0'] = r.stdout.toString().trim().split(' ')
      const ended = r.exitCode !== 0 || dead === '1'
      if (ended && !a.ended) onExit(sid, null)
      a.ended = ended
      if (Number(activity) > a.activity) {
        a.activity = Number(activity)
        a.last = clock()
      }
    }
  }, 1000)
  poll.unref()
  const ownPane = (sid: string): never =>
    refuse(
      `${sid} is the host's own terminal (pane ${adopted.get(sid)?.pane}); ` +
        'the UI does not start, restart, or stop it',
    )

  const target = (sid: string) => `${name}:=${sid}`
  const exists = (sid: string) => list().some((p) => p.sid === sid)
  const mouseModes = (sid: string) => {
    const r = tmuxNow('display-message', '-p', '-t', target(sid), MOUSE_FLAGS)
    return r.code === 0 ? mouseModesOf(r.out.trim().split(' ')) : ''
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
          onFailure: (e) => ({ failed: e.message }) as const,
          onSuccess: (value) => ({ value }) as const,
        }),
      ),
    )
    if ('failed' in done) return refuse(done.failed)
    return done.value
  }

  const pump: TmuxPump = {
    name,
    socket,
    dir,
    onOutputs: [],
    onSizes: [],
    // Starts a real agent: its command runs in a new window, with ARISTOTELES_SESSION set, so
    // that the CLI refuses a person command from it.
    start(sid, command, { env: vars = {}, cols = 160, rows = 48 } = {}) {
      if (adopted.has(sid)) return ownPane(sid)
      if (!/^[A-Za-z0-9._-]+$/.test(sid)) return refuse(`"${sid}" is not a session id`)
      if (exists(sid)) return refuse(`the session ${sid} has a terminal already`)
      const envArgs = Object.entries({ ARISTOTELES_SESSION: sid, ...vars }).flatMap(([k, v]) => [
        '-e',
        `${k}=${v}`,
      ])
      const r = runOrThrow(
        mustTmux(`start ${sid}`, [
          ...['new-window', '-d', '-t', `${name}:`, '-n', sid, '-c', dir, ...envArgs],
          ...['-P', '-F', '#{pane_id}', '--', 'sh', '-c', command],
        ]),
      )
      panes.set(r.out.trim(), sid)
      tmuxNow('resize-window', '-t', target(sid), '-x', String(cols), '-y', String(rows))
      known.delete(sid)
      return r.out.trim()
    },
    // A resume: a dead pane runs the resume command; a closed window is made again.
    resume(sid, command, startOptions = {}) {
      if (adopted.has(sid)) return ownPane(sid)
      const p = list().find((x) => x.sid === sid)
      if (p && !p.dead) return refuse(`the session ${sid} runs`)
      if (p) {
        // The new process keeps ARISTOTELES_SESSION, as a start gives it.
        const env = ['-e', `ARISTOTELES_SESSION=${sid}`]
        const respawn = ['respawn-pane', '-k', ...env, '-t', p.pane, '--', 'sh', '-c', command]
        runOrThrow(mustTmux(`resume ${sid}`, respawn))
        known.delete(sid)
        return p.pane
      }
      return pump.start(sid, command, startOptions)
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
          if (r.exitCode !== 0) {
            refuse(`tmux could not type into ${sid}: ${r.stderr.toString().trim()}`)
          }
          continue
        }
        runOrThrow(mustTmux(`type into ${sid}`, ['send-keys', '-t', target(sid), '-H', ...hex]))
      }
    },
    // The page's resize button: tmux sets the window to the size (and window-size to manual);
    // the %layout-change then tells each page the size that tmux gave the pane. The host's window
    // gets it too: the person's own terminal then shows a part of it, or empty space around it.
    resize(sid, cols, rows) {
      const size = ['-x', String(cols), '-y', String(rows)]
      const a = adopted.get(sid)
      if (a) onPersonServer(a.socket, ['resize-window', '-t', a.pane, ...size])
      else if (exists(sid)) tmuxNow('resize-window', '-t', target(sid), ...size)
    },
    // A stop of the person: the window goes, and the watcher does not retry it.
    stop(sid) {
      if (adopted.has(sid)) ownPane(sid)
      tmuxNow('kill-window', '-t', target(sid))
      known.delete(sid)
    },
    // The bytes to show a tab that opens: the ring buffer, or the screen of the pane after a
    // restart of the server; then the mouse modes of the pane now. A tool that turned them on
    // before the ring started (Claude scrolls its own view with the wheel) needs them in the
    // page too, else the wheel scrolls the page's own history, which is empty.
    snapshot(sid) {
      const a = adopted.get(sid)
      if (a) return hostFrame(a)
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
      const own = list().map((p): [string, TerminalStatus] => [
        p.sid,
        { live: !p.dead, ended: p.dead, exit: p.status, lastOutput: rings.get(p.sid)?.last ?? 0 },
      ])
      const persons = [...adopted].map(([sid, a]): [string, TerminalStatus] => [
        sid,
        { live: !a.ended, ended: a.ended, exit: null, lastOutput: a.last },
      ])
      return Object.fromEntries([...own, ...persons])
    },
    // The last lines of a terminal, for the words of an event.
    tail(sid, lines = 12) {
      const a = adopted.get(sid)
      const capture = ['capture-pane', '-p', '-J', '-S', '-500', '-t']
      const r = a
        ? (({ exitCode, stdout }) => ({ code: exitCode, out: stdout.toString() }))(
            onPersonServer(a.socket, [...capture, a.pane]),
          )
        : tmuxNow(...capture, target(sid))
      if (r.code !== 0) return ''
      return r.out
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('Pane is dead'))
        .slice(-lines)
        .join('\n')
    },
    adopt(sid, on, pane) {
      const a = adopted.get(sid)
      if (a?.socket === on && a.pane === pane) return
      detach(a?.client)
      const b: Adopted = {
        socket: on,
        pane,
        last: clock(),
        activity: 0,
        ended: false,
        client: undefined,
      }
      adopted.set(sid, b)
      // A page that showed the old pane goes on with the new one.
      if (a?.client) {
        pump.show(sid)
        emit(sid, hostFrame(b))
      }
    },
    release(sid) {
      detach(adopted.get(sid)?.client)
      adopted.delete(sid)
    },
    paneOf(sid) {
      const a = adopted.get(sid)
      return a ? { socket: a.socket, pane: a.pane } : undefined
    },
    close() {
      closed = true
      clearInterval(poll)
      detach(client)
      for (const a of adopted.values()) {
        detach(a.client)
        a.client = undefined
      }
    },
    // For the tests: ends the tmux server of the socket.
    killServer() {
      pump.close()
      tmuxNow('kill-server')
    },
    size(sid) {
      const a = adopted.get(sid)
      return a ? hostSize(a) : list().find((p) => p.sid === sid)?.size
    },
    // The pump's own control client streams its sessions always; the host's pane streams only
    // while a page shows it. From the first show its window keeps its size (window-size manual),
    // so the person's terminal no longer resizes it: only the page's resize button does.
    show(sid) {
      const a = adopted.get(sid)
      if (!a || a.client) return
      onPersonServer(a.socket, ['set-option', '-w', '-t', a.pane, 'window-size', 'manual'])
      streamHost(sid, a)
    },
    hide(sid) {
      const a = adopted.get(sid)
      if (!a) return
      detach(a.client)
      a.client = undefined
    },
  }
  return pump
}

// --- the Pump service over a facade --------------------------------------------------------------

// What the service needs of a facade: the frozen Pump and a test's fake both have it.
export type PumpFacade = Pick<
  TmuxPump,
  'start' | 'resume' | 'input' | 'stop' | 'status' | 'tail' | 'adopt' | 'release' | 'paneOf'
>

// The time (ms) of the person's last key in the tmux session of their own pane: the newest
// activity of a client attached there. The pump's send-keys moves no client, and the control
// client of a page that shows the pane is no person, so only the person's keys (and an attach)
// count. 0: no client, or no server.
const personKeysAt = (pane: { readonly socket: string; readonly pane: string }): number => {
  const args = ['list-clients', '-t', pane.pane, '-F', '#{client_control_mode} #{client_activity}']
  const r = onPersonServer(pane.socket, args)
  if (r.exitCode !== 0) return 0
  const seconds = r.stdout
    .toString()
    .split('\n')
    .map((row) => row.split(' '))
    .filter(([control]) => control === '0')
    .map(([, activity]) => Number(activity))
    .filter((n) => Number.isFinite(n) && n > 0)
  return seconds.length === 0 ? 0 : Math.max(...seconds) * 1000
}

// A thrown refusal of the facade becomes an OutsideFailed with its words.
const attempt = <A>(what: () => A): Effect.Effect<A, OutsideFailed> =>
  Effect.try({
    try: what,
    catch: (e) => {
      const message = e instanceof Error ? e.message : String(e)
      return new OutsideFailed({ system: 'tmux', message, next: null })
    },
  })

export const pumpLayerOf = (facade: PumpFacade): Layer.Layer<Pump> =>
  Layer.succeed(Pump, {
    start: (session, s) =>
      attempt(() => facade.start(session, s.command, { env: s.env, cols: s.cols, rows: s.rows })),
    resume: (session, s) =>
      attempt(() => facade.resume(session, s.command, { env: s.env, cols: s.cols, rows: s.rows })),
    input: (session, text) => attempt(() => facade.input(session, text)),
    enter: (session) => attempt(() => facade.input(session, '\r')),
    stop: (session) => attempt(() => facade.stop(session)),
    status: Effect.sync((): Readonly<Record<string, TerminalReading>> => facade.status()),
    tail: (session, lines) =>
      attempt(() => facade.tail(session, lines)).pipe(Effect.orElseSucceed(() => '')),
    adopt: (session, socket, pane) =>
      attempt(() => facade.adopt(session, socket, pane)).pipe(Effect.ignore),
    release: (session) => attempt(() => facade.release(session)).pipe(Effect.ignore),
    paneOf: (session) =>
      Effect.sync((): PaneRef => {
        const p = facade.paneOf(session)
        return p === undefined ? { _tag: 'OwnWindow' } : { _tag: 'PersonPane', ...p }
      }),
    keysAt: (session) =>
      Effect.sync(() => {
        const p = facade.paneOf(session)
        return p === undefined ? 0 : personKeysAt(p)
      }),
  })

// The live Pump of a dir; it closes its control client when its scope ends. A test gives a fake.
export const PumpLive = (options: TmuxPumpOptions): Layer.Layer<Pump> =>
  Layer.unwrap(
    Effect.acquireRelease(
      Effect.sync(() => createTmuxPump(options)),
      (pump) => Effect.sync(() => pump.close()),
    ).pipe(Effect.map(pumpLayerOf)),
  )
