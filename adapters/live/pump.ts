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
import { createHash, randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'
import { Effect, Layer } from 'effect'
import { OutsideFailed, type SessionId } from '../../core/schema/index.ts'
import type { TerminalReading } from '../../core/schema/outside.ts'
import { type PaneRef, pathOf, Pump, Spawn, SpawnLive } from '../../core/services/index.ts'
import { isBootstrapSocket } from './bootstrap.ts'
import { isLocalTerminalSession } from './worker-terminal.ts'

export interface TmuxPumpOptions {
  readonly dir: string
  // The tmux socket (-L); the tests give each run its own.
  readonly socket?: string
  readonly onOutput?: (session: string, bytes: Uint8Array) => void
  readonly onExit?: (session: string, status: number | null) => void
  // Date.now(); a test gives the fake clock of its watcher.
  readonly clock?: () => number
}

export type TerminalStatus = TerminalReading
const readingOf = (ended: boolean, exit: number | null, lastOutput: number): TerminalReading =>
  ended ? { _tag: 'Ended', exit, lastOutput } : { _tag: 'Live', lastOutput }

export interface StartOptions {
  readonly env?: Readonly<Record<string, string>>
  readonly cols?: number
  readonly rows?: number
}

export interface TerminalSize {
  readonly cols: number
  readonly rows: number
}

export interface PreparedTerminalWrite {
  readonly run: () => 'applied' | 'target'
  readonly cleanup?: () => void
}

export type TerminalTarget =
  | { readonly state: 'waiting' | 'gone' }
  | {
    readonly state: 'ready'
    readonly id: string
    readonly prepare: (
      text: string, instance: string, seq: number,
    ) => PreparedTerminalWrite | undefined
  }

// A failed probe only proves disappearance when tmux can still list the relevant panes.
export const pipeTargetOf = (
  read: { readonly code: number; readonly out: string },
  missing: () => boolean,
) => {
  if (read.code !== 0) return missing() ? { state: 'gone' as const } : { state: 'waiting' as const }
  const identity = read.out.trim()
  const match = /^\d+ \d+ (%\d+) \d+ ([01])$/.exec(identity)
  if (!match?.[1]) return { state: 'waiting' as const }
  if (match[2] === '1') return { state: 'gone' as const }
  return { state: 'ready' as const, pane: match[1], identity }
}

// The sync facade (adapters/web/frozen.ts Pump has this shape); a refusal is a thrown Error.
export interface TmuxPump {
  readonly name: string
  readonly socket: string
  readonly dir: string
  // Listeners that the server adds; each gets every output.
  onOutputs: ReadonlyArray<(session: string, bytes: Uint8Array) => void>
  onAttach: ReadonlyArray<(session?: string) => void>
  readonly redraw: (session: string, show: (bytes: Uint8Array) => void) => void
  readonly inputTarget: (session: string) => TerminalTarget
  readonly localOnly: (session: string) => boolean
  readonly start: (session: string, command: string, options?: StartOptions) => string
  readonly resume: (session: string, command: string, options?: StartOptions) => string
  readonly input: (session: string, text: string) => void
  readonly resize: (session: string, cols: number, rows: number) => void
  readonly stop: (session: string) => void
  // A terminal that will not come back (its project ended): the pump drops what it keeps of it.
  readonly forget: (session: string) => void
  readonly snapshot: (session: string) => Uint8Array
  readonly observe: (session: string) => 'live' | 'ended' | 'unknown'
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
  readonly localOnly: boolean
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
  const { TMUX: _t, TMUX_PANE: _p, TMUX_SOCKET: _s, ARISTOTELES_LAUNCH_NONCE: _nonce, ...rest } = process.env
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
const CONTROL_END = new TextEncoder().encode('%end ')
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

  // The panes of the pump's session; undefined when tmux does not answer (no server).
  const rowsNow = (): PaneRow[] | undefined => {
    const fields =
      '#{pane_id}|#{window_name}|#{pane_dead}|#{pane_dead_status}|#{pane_width}x#{pane_height}'
    const r = tmuxNow('list-panes', '-s', '-t', name, '-F', fields)
    if (r.code !== 0) return undefined
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
  const list = (): PaneRow[] => rowsNow() ?? []
  const refreshPanes = () => {
    panes.clear()
    for (const p of list()) panes.set(p.pane, p.sid)
  }
  refreshPanes()

  // Each output and each new size of a terminal, to the listeners.
  const emit = (sid: string, bytes: Uint8Array) => {
    if (localOnly(sid)) return
    onOutput(sid, bytes)
    for (const fn of pump.onOutputs) fn(sid, bytes)
  }
  const emitSize = (sid: string, size: TerminalSize) => {
    if (localOnly(sid)) return
    for (const fn of pump.onSizes) fn(sid, size)
  }

  // The control client of the pump's own session: %output lines carry the bytes of each pane;
  // after a %layout-change each terminal says its size again (a page that has it already keeps it).
  let client: ControlClient | undefined
  let ownReady = false
  let closed = false
  // Which panes ended since the last look, and which windows are gone (killed while the pump was
  // detached, or after): a window that a start or a stop did not take is ended, whatever tmux
  // lists. Each look runs each second, and on every attach (an end while detached shows then).
  const known = new Map<string, PaneRow>()
  const gone = new Set<string>()
  const lookOwn = () => {
    const rows = rowsNow()
    if (!rows) return
    for (const p of rows) {
      const was = known.get(p.sid)
      if (p.dead && !was?.dead) onExit(p.sid, p.status)
      known.set(p.sid, p)
      gone.delete(p.sid)
    }
    for (const sid of known.keys()) {
      if (gone.has(sid) || rows.some((p) => p.sid === sid)) continue
      gone.add(sid)
      onExit(sid, null)
    }
  }
  const ownLine = (line: Uint8Array) => {
    if (startsWith(line, LAYOUT_CHANGE)) {
      for (const p of list()) emitSize(p.sid, p.size)
      return
    }
    const output = outputOf(line)
    if (!output) return
    if (!panes.has(output.pane)) refreshPanes()
    const sid = panes.get(output.pane)
    if (!sid || localOnly(sid)) return
    const data = unescapeOutput(output.escaped)
    keep(sid, data)
    emit(sid, data)
  }
  // Any detach (another client's attach -d, %exit, the server) ends the client's output: the pump
  // attaches again, after a delay that doubles to 5 s and starts over with the first line.
  let delay = 500
  const attached = (sid?: string) => {
    for (const fn of pump.onAttach) fn(sid)
  }
  const attach = () => {
    if (closed) return
    // The session can be gone (its server was killed): make it again before the client attaches.
    if (tmuxNow('has-session', '-t', name).code !== 0) makeSession()
    const args = ['-L', socket, '-C', 'attach-session', '-t', name]
    const next = controlClient(
      args,
      (line) => {
        if (closed || client !== next) return
        if (!ownReady) {
          if (!startsWith(line, CONTROL_END)) return
          ownReady = true
          refreshPanes()
          attached()
          return
        }
        delay = 500
        if (!captureLine(next, line)) ownLine(line)
      },
      () => {
        if (closed || client !== next) return
        ownReady = false
        setTimeout(attach, delay)
        delay = Math.min(delay * 2, 5000)
      },
    )
    client = next
    lookOwn()
  }

  // The host's own pane (ruling 2026-11-14): while a page shows it, one control client on the
  // person's server streams it to every tab that shows it; ignore-size keeps that client out of
  // the window's size. The pump types into it with send-keys.
  const adopted = new Map<string, Adopted>()
  const localOnly = (sid: string) => isLocalTerminalSession(sid) || adopted.get(sid)?.localOnly === true
  const ownSocket = tmuxNow('display-message', '-p', '-t', name, '#{socket_path}').out.trim()
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
  // Whether the host's pane still exists and wrote; it runs each second, when the pane is adopted,
  // and when its client attaches again, with or without a page that shows it.
  const lookHost = (sid: string, a: Adopted) => {
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
  const readyHosts = new Set<string>()
  const streamHost = (sid: string, a: Adopted) => {
    // Not read-only (-r): tmux refuses a send-keys from outside the session when its newest
    // client is read-only, and this client is the newest. It is sent no command.
    const args = ['-S', a.socket, '-C', 'attach-session', '-f', 'ignore-size', '-t', a.pane]
    const hostLine = (line: Uint8Array) => {
      if (adopted.get(sid) !== a || a.client !== hostClient) return
      if (!readyHosts.has(sid)) {
        if (!startsWith(line, CONTROL_END)) return
        readyHosts.add(sid)
        attached(sid)
        return
      }
      if (captureLine(hostClient, line)) return
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
      readyHosts.delete(sid)
      setTimeout(() => {
        if (adopted.get(sid) !== a || a.client !== hostClient) return
        a.client = undefined
        lookHost(sid, a)
        if (a.ended || hostSize(a) === undefined) return
        streamHost(sid, a)
      }, 500)
    }
    const hostClient = controlClient(args, hostLine, detached)
    a.client = hostClient
  }

  // Each second: which panes ended since the last look, and whether the host's pane wrote (tmux
  // keeps the time of the last output for a whole window only). This look needs no client on the
  // person's server, so the watcher reads the host's pane while no page shows it too.
  const poll = setInterval(() => {
    lookOwn()
    for (const [sid, a] of adopted) lookHost(sid, a)
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

  // Capturing through the same control client orders the snapshot between output events.
  // Replies are bracketed by matching %begin and %end/%error lines.
  interface Capture {
    readonly pane: string
    readonly show: (bytes: Uint8Array) => void
    readonly lines: string[]
    marker?: string
  }
  const captures = new WeakMap<ControlClient, Capture[]>()
  const sendCapture = (control: ControlClient, capture: Capture) => {
    control.stdin.write(`capture-pane -p -e -t ${capture.pane}\n`)
    control.stdin.flush()
  }
  const captureLine = (control: ControlClient, bytes: Uint8Array) => {
    const queue = captures.get(control)
    const capture = queue?.[0]
    if (!queue || !capture) return false
    const line = new TextDecoder().decode(bytes)
    if (capture.marker === undefined) {
      if (!line.startsWith('%begin ')) return false
      capture.marker = line.slice(7)
      return true
    }
    if (line === `%end ${capture.marker}` || line === `%error ${capture.marker}`) {
      queue.shift()
      capture.show(new TextEncoder().encode(capture.lines.join('\r\n')))
      if (queue[0]) sendCapture(control, queue[0])
    } else capture.lines.push(line)
    return true
  }

  const pump: TmuxPump = {
    name,
    socket,
    dir,
    onOutputs: [],
    onSizes: [],
    onAttach: [],
    localOnly,
    redraw(sid, show) {
      if (localOnly(sid)) return
      const a = adopted.get(sid)
      const control = a?.client ?? client
      if (!control || (a ? !readyHosts.has(sid) : !ownReady)) return
      const pane = a?.pane ?? list().find((p) => p.sid === sid)?.pane
      if (!pane || !/^%\d+$/.test(pane)) {
        show(new Uint8Array())
        return
      }
      const format = `#{cursor_x} #{cursor_y} ${MOUSE_FLAGS}`
      const args = ['display-message', '-p', '-t', pane, format]
      const info = a ? onPersonServer(a.socket, args).stdout.toString() : tmuxNow(...args).out
      const [x = '0', y = '0', ...flags] = info.trim().split(' ')
      const cursor = new TextEncoder().encode(
        `\x1b[${Number(y) + 1};${Number(x) + 1}H${mouseModesOf(flags)}`,
      )
      const capture: Capture = {
        pane, lines: [], show: (bytes) => {
          if (localOnly(sid) || (a ? adopted.get(sid) !== a || a.client !== control : client !== control)) return
          const frame = new Uint8Array(bytes.length + cursor.length)
          frame.set(bytes)
          frame.set(cursor, bytes.length)
          show(frame)
        },
      }
      const existing = captures.get(control)
      if (existing?.length) existing.push(capture)
      else {
        captures.set(control, [capture])
        sendCapture(control, capture)
      }
    },
    inputTarget(sid) {
      if (localOnly(sid)) return { state: 'gone' }
      const adoptedPane = adopted.get(sid)
      if (adoptedPane ? !readyHosts.has(sid) : !ownReady) return { state: 'waiting' }
      const run = (args: string[]) => {
        if (!adoptedPane) return tmuxNow(...args)
        const result = onPersonServer(adoptedPane.socket, args)
        return {
          code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString(),
        }
      }
      const format = '#{pid} #{start_time} #{pane_id} #{pane_pid} #{pane_dead}'
      const at = adoptedPane?.pane ?? target(sid)
      const found = pipeTargetOf(run(['display-message', '-p', '-t', at, format]), () => {
        if (!adoptedPane) return rowsNow()?.every((row) => row.sid !== sid) === true
        const inventory = run(['list-panes', '-a', '-F', '#{pane_id}'])
        return inventory.code === 0 && !inventory.out.trim().split('\n').includes(at)
      })
      if (found.state !== 'ready') return found
      const { pane, identity } = found
      const id = JSON.stringify([adoptedPane?.socket ?? socket, identity])
      return {
        state: 'ready', id,
        prepare(text, instance, seq) {
          const bytes = new TextEncoder().encode(text)
          const stream = createHash('sha256').update(JSON.stringify([dir, id, instance]))
            .digest('hex').slice(0, 32)
          const option = `@ar-pipe-${stream}`
          const sequence = String(seq).padStart(16, '0')
          const samePane = `#{==:${format},${identity}}`
          const next = `#{>:${sequence},#{${option}}}`
          const check = ['if-shell', '-F', '-t', pane, `#{&&:${samePane},${next}}`]
          // The tmux-side guard also fences a previous server's subprocess if the server
          // died after spawning it and the replacement has already sent a newer key.
          const mark = `set-option -p -t ${pane} ${option} ${sequence}`
          const hexCommand = (chunk: Uint8Array) => {
            const hex = [...chunk].map((byte) => byte.toString(16).padStart(2, '0')).join(' ')
            return `send-keys -t ${pane} -H ${hex}`
          }
          const refused = 'display-message -p target-changed'
          const prepare = (
            args: string[], cleanup?: () => void,
          ): PreparedTerminalWrite => ({
            run() {
              if (localOnly(sid)) return 'target'
              const result = run([...check, ...args])
              if (result.out.includes('target-changed') ||
                /can't find pane:/.test(result.err)) {
                return 'target'
              }
              if (result.code !== 0) refuse(`tmux could not type into ${sid}`)
              return 'applied'
            },
            ...(cleanup ? { cleanup } : {}),
          })
          if (bytes.length <= 128) {
            return prepare([`${mark}; ${hexCommand(bytes)}`, refused])
          }
          // tmux 3.0–3.6a already paste raw bytes with -r. In 3.7, -S opts
          // out of vis escaping. Query the target server for the flags it accepts.
          const commands = run(['list-commands'])
          const paste = commands.out.split('\n').find((line) => line.startsWith('paste-buffer '))
          if (commands.code !== 0 || paste === undefined) return undefined
          const raw = /\[-[^\]]*S/.test(paste) ? ' -S' : ''
          const buffer = `ar-pipe-${randomUUID()}`
          const endpoint = adoptedPane ? ['-S', adoptedPane.socket] : ['-L', socket]
          const child = Bun.spawnSync([
            pathOf('tmux'), '-f', '/dev/null', ...endpoint, 'load-buffer', '-b', buffer, '-',
          ], { env, stdin: bytes })
          const cleanup = () => { run(['delete-buffer', '-b', buffer]) }
          if (child.exitCode !== 0) {
            cleanup()
            return undefined
          }
          return prepare([`${mark}; paste-buffer -d -r${raw} -b ${buffer} -t ${pane}`, refused],
            cleanup)
        },
      }
    },
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
      gone.delete(sid)
      lookOwn()
      attached(sid)
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
        gone.delete(sid)
        lookOwn()
        attached(sid)
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
      const stopped = tmuxNow('kill-window', '-t', target(sid))
      if (stopped.code !== 0) return refuse(`tmux could not stop ${sid}`)
      known.delete(sid)
      gone.delete(sid)
    },
    // The ring of a terminal that the person stopped stays, so that a Resume shows its old output;
    // the end of a project frees it here.
    forget(sid) {
      rings.delete(sid)
      gone.delete(sid)
      known.delete(sid)
    },
    // The bytes to show a tab that opens: the ring buffer, or the screen of the pane after a
    // restart of the server; then the mouse modes of the pane now. A tool that turned them on
    // before the ring started (Claude scrolls its own view with the wheel) needs them in the
    // page too, else the wheel scrolls the page's own history, which is empty.
    snapshot(sid) {
      if (localOnly(sid)) return new Uint8Array()
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
    observe(sid) {
      const rows = rowsNow()
      if (rows === undefined) return 'unknown'
      return rows.some((row) => row.sid === sid && !row.dead) ? 'live' : 'ended'
    },
    status() {
      const own = list().map((p): [string, TerminalStatus] => [
        p.sid,
        readingOf(p.dead, p.status, rings.get(p.sid)?.last ?? 0),
      ])
      const vanished = [...gone]
        .filter((sid) => !own.some(([s]) => s === sid))
        .map((sid): [string, TerminalStatus] => [
          sid,
          readingOf(true, null, rings.get(sid)?.last ?? 0),
        ])
      const persons = [...adopted].map(([sid, a]): [string, TerminalStatus] => [
        sid,
        readingOf(a.ended, null, a.last),
      ])
      return Object.fromEntries([...vanished, ...own, ...persons])
    },
    // The last lines of a terminal, for the words of an event.
    tail(sid, lines = 12) {
      if (localOnly(sid)) return ''
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
      readyHosts.delete(sid)
      const b: Adopted = {
        socket: on,
        pane,
        localOnly: isBootstrapSocket(dir, on) ||
          (on === ownSocket && list().some((row) => row.pane === pane && isLocalTerminalSession(row.sid))),
        last: clock(),
        activity: 0,
        ended: false,
        client: undefined,
      }
      adopted.set(sid, b)
      lookHost(sid, b)
      // A page that showed the old pane goes on with the new one.
      if (a?.client) {
        pump.show(sid)
        attached(sid)
      }
    },
    release(sid) {
      readyHosts.delete(sid)
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
    // For the tests: ends the tmux server of the socket, and removes its socket file (tmux 3.8
    // leaves it, so each test socket would stay in the tmux folder).
    killServer() {
      pump.close()
      const socketFile = tmuxNow('display-message', '-p', '#{socket_path}').out.trim()
      tmuxNow('kill-server')
      if (socketFile !== '') rmSync(socketFile, { force: true })
    },
    size(sid) {
      const a = adopted.get(sid)
      return a ? hostSize(a) : list().find((p) => p.sid === sid)?.size
    },
    // The pump's own control client streams its sessions always; the host's pane streams only
    // while a page shows it. From the first show its window keeps its size (window-size manual),
    // so the person's terminal no longer resizes it: only the page's resize button does.
    show(sid) {
      if (localOnly(sid)) return
      const a = adopted.get(sid)
      if (!a || a.client) return
      onPersonServer(a.socket, ['set-option', '-w', '-t', a.pane, 'window-size', 'manual'])
      streamHost(sid, a)
    },
    hide(sid) {
      const a = adopted.get(sid)
      if (!a) return
      readyHosts.delete(sid)
      detach(a.client)
      a.client = undefined
    },
  }
  attach()
  return pump
}

// --- the Pump service over a facade --------------------------------------------------------------

// What the service needs of a facade: the frozen Pump and a test's fake both have it.
export type PumpFacade = Pick<
  TmuxPump,
  'start' | 'resume' | 'input' | 'stop' | 'forget' | 'status' | 'tail' | 'adopt' | 'release' | 'paneOf'
> & Partial<Pick<TmuxPump, 'observe'>>

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
    forget: (session) => Effect.sync(() => facade.forget(session)),
    ...(facade.observe ? { observe: (session: SessionId) => Effect.sync(() => facade.observe!(session)) } : {}),
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
