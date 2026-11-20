import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import { pipeTargetOf } from '../live/pump.ts'
import { createSocket, type Heard } from './app/pipe-socket.ts'
import { pipeOutbox, inputChunks } from './app/pipe-outbox.ts'
import { PageMessage, type KeyReceipt, type TermKey } from './contract.ts'
import { pipeMarks, pipeQueue } from './pipe-keys.ts'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'pipe-keys-'))
  dirs.push(dir)
  return dir
}
const key = (seq: number, instance = 'tab', target = 'pane'): TermKey =>
  Schema.decodeUnknownSync(PageMessage)({
    type: 'term.key', seq, instance, target, session: 's-1', data: String(seq),
  }) as TermKey

test('F3.1–3 restart replays queued keys and retires marked keys', () => {
  const dir = folder()
  const db = join(dir, 'work.db')
  let marks = pipeMarks(db, dir)
  const applied: number[] = []
  const receipt: KeyReceipt[] = []
  const append = (r: KeyReceipt) => receipt.push(r)
  const fail = () => { throw new Error('unexpected resync') }
  let queue = pipeQueue(marks, (k) => ({
    state: 'ready', prepare: () => ({ run() {
      if (k.seq === 2) throw new Error('interrupted after committing mark')
      applied.push(k.seq)
      return 'applied'
    } }),
  }))
  queue.enqueue(key(1), () => {}, fail)
  queue.enqueue(key(2), () => {}, fail)
  queue.enqueue(key(4), () => {}, fail)
  marks.close()
  marks = pipeMarks(db, dir)
  queue = pipeQueue(marks, (k) => ({ state: 'ready', prepare: () => ({ run() {
    applied.push(k.seq)
    return 'applied'
  } }) }))
  for (const seq of [1, 2, 3, 4]) queue.enqueue(key(seq), append, fail)
  expect(applied).toEqual([1, 3, 4])
  expect(receipt.map((r) => r.status)).toEqual(['doNotResend', 'uncertain', 'applied', 'applied'])
  marks.close()
})

test('a transient probe and a preparation failure cannot consume a key', () => {
  const dir = folder()
  const marks = pipeMarks(join(dir, 'work.db'), dir)
  const receipts: KeyReceipt[] = []
  let probe = { code: 1, out: '' }
  let loaded = false
  const queue = pipeQueue(marks, () => {
    // The failed display-message is followed by a successful inventory with the pane present.
    const target = pipeTargetOf(probe, () => false)
    if (target.state !== 'ready') return target
    return {
      state: 'ready', prepare: () => {
        expect(marks.next(marks.stream(key(1)))).toBe(1)
        return loaded ? { run: () => 'target' } : undefined
      },
    }
  })
  const push = () => queue.enqueue(key(1), (r) => receipts.push(r),
    () => { throw new Error('unexpected resync') })
  try {
    push()
    expect(receipts).toEqual([])
    expect(marks.next(marks.stream(key(1)))).toBe(1)
    probe = { code: 0, out: '12 34 %5 56 0' }
    queue.drain()
    expect(receipts).toEqual([])
    expect(marks.next(marks.stream(key(1)))).toBe(1)
    loaded = true
    queue.drain()
    push()
    expect(receipts.map(({ status, reason }) => [status, reason])).toEqual([
      ['refused', 'target'], ['refused', 'target'],
    ])
  } finally {
    marks.close()
  }
})

test('a throwing preparation leaves its key pending and lets another stream dispatch', () => {
  const dir = folder()
  const marks = pipeMarks(join(dir, 'work.db'), dir)
  const blocked = key(1, 'blocked')
  const independent = key(1, 'independent')
  const written: string[] = []
  const receipts: KeyReceipt[] = []
  let canPrepare = false
  const queue = pipeQueue(marks, (k) => ({
    state: 'ready',
    prepare() {
      if (k.instance === blocked.instance && !canPrepare) throw new Error('prepare failed')
      return { run() {
        written.push(k.instance)
        return 'applied'
      } }
    },
  }))
  const enqueue = (k: TermKey) => queue.enqueue(k, (r) => receipts.push(r),
    () => { throw new Error('unexpected resync') })
  try {
    enqueue(blocked)
    enqueue(independent)
    expect(marks.next(marks.stream(blocked))).toBe(1)
    expect(written).toEqual(['independent'])
    expect(receipts.map((receipt) => receipt.instance)).toEqual(['independent'])
    canPrepare = true
    queue.drain()
    expect(marks.next(marks.stream(blocked))).toBe(2)
    expect(written).toEqual(['independent', 'blocked'])
    expect(receipts.map((receipt) => receipt.status)).toEqual(['applied', 'applied'])
  } finally {
    marks.close()
  }
})

test('a replacement dispatcher waits through the prior mark-to-write interval', () => {
  const dir = folder()
  const path = join(dir, 'work.db')
  const first = pipeMarks(path, dir)
  const next = pipeMarks(path, dir)
  const order: number[] = []
  const fail = () => { throw new Error('unexpected resync') }
  const replacement = pipeQueue(next, (k) => ({
    state: 'ready', prepare: () => ({ run() {
      order.push(k.seq)
      return 'applied'
    } }),
  }))
  const receipts: string[] = []
  const receipt = (r: KeyReceipt) => receipts.push(r.status)
  const original = pipeQueue(first, () => ({
    state: 'ready', prepare: () => ({ run() {
      // The mark is already visible but the dispatch lock is still held.
      replacement.enqueue(key(1), receipt, fail)
      replacement.enqueue(key(2), receipt, fail)
      expect(order).toEqual([])
      expect(receipts).toEqual([])
      order.push(1)
      return 'applied'
    } }),
  }))
  try {
    original.enqueue(key(1), () => {}, fail)
    replacement.drain()
    expect(order).toEqual([1, 2])
    expect(receipts).toEqual(['doNotResend', 'applied'])
  } finally {
    first.close()
    next.close()
  }
})

test('F3.7–8 and F3.11 hold gaps, resync without retiring, and isolate targets and tabs', () => {
  const dir = folder()
  const marks = pipeMarks(join(dir, 'work.db'), dir)
  const applied: TermKey[] = []
  const receipts: KeyReceipt[] = []
  const queue = pipeQueue(marks, (k) => k.target === 'vanished'
    ? { state: 'gone' }
    : { state: 'ready', prepare: () => ({ run() {
      applied.push(k)
      return 'applied'
    } }) })
  const resync = () => { reconnects += 1 }
  let reconnects = 0
  const enqueue = (k: TermKey) => queue.enqueue(k, (r) => receipts.push(r), resync)
  for (let seq = 2; seq <= 66; seq++) enqueue(key(seq))
  expect(reconnects).toBe(1)
  expect(receipts).toEqual([])
  enqueue(key(1, 'other-tab'))
  enqueue(key(1, 'tab', 'other-pane'))
  enqueue(key(2, 'tab', 'vanished'))
  expect(receipts.at(-1)?.status).toBe('refused')
  enqueue(key(1))
  enqueue(key(66))
  expect(applied.slice(2).map((k) => k.seq)).toEqual(Array.from({ length: 66 }, (_, i) => i + 1))
  expect(reconnects).toBe(1)
  marks.close()
})

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(k: string) { return this.values.get(k) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(k: string) { this.values.delete(k) }
  setItem(k: string, v: string) { this.values.set(k, v) }
  copy() {
    const other = new MemoryStorage()
    for (const [k, v] of this.values) other.setItem(k, v)
    return other
  }
}

test('F3.4–6 persist early input and exclusively adopt the reload handoff', async () => {
  const store = new MemoryStorage()
  const openTickets = new Set<string>()
  const ticket = async (id: string, create: boolean) => {
    if (create) {
      openTickets.add(id)
      return true
    }
    return openTickets.delete(id)
  }
  const outbox = pipeOutbox(store, false, ticket)
  await outbox.ready
  const { session } = key(1)
  outbox.capture(session, undefined, 'early')
  expect(outbox.pending()).toEqual([])
  outbox.bind(session, 'pane')
  const [first] = outbox.pending() as [TermKey]
  expect(first?.data).toBe('early')
  await outbox.prepareReload()
  const duplicate = pipeOutbox(store.copy(), false, ticket)
  const reload = pipeOutbox(store, true, ticket)
  // Its navigation type alone is insufficient to adopt a ticket already taken.
  const secondReload = pipeOutbox(store.copy(), true, ticket)
  await Promise.all([duplicate.ready, reload.ready, secondReload.ready])
  expect(duplicate.pending()).toEqual([])
  expect(secondReload.pending()).toEqual([])
  expect(reload.pending()).toEqual([first])
  reload.capture(session, 'pane', 'next')
  expect(reload.pending()[1]?.seq).toBe(2)
})

class FakeSocket {
  readyState: WebSocket['readyState'] = 1
  onmessage: WebSocket['onmessage'] = null
  onclose: WebSocket['onclose'] = null
  readonly sent: unknown[] = []
  send(message: string) { this.sent.push(JSON.parse(message)) }
  receive(message: unknown) {
    this.onmessage?.call(this as unknown as WebSocket,
      new MessageEvent('message', { data: JSON.stringify(message) }))
  }
  close() {
    this.readyState = 3
    this.onclose?.call(this as unknown as WebSocket, new CloseEvent('close'))
  }
}

test('F3.4/F3.9 hello gates input and a retired socket cannot publish or retire it', async () => {
  const storage = new MemoryStorage()
  const outbox = pipeOutbox(storage, false)
  const sockets: FakeSocket[] = []
  const retry: Array<() => void> = []
  const pipe = createSocket({
    outbox, retry: (fn) => retry.push(fn), reload: () => { throw new Error('unexpected reload') },
    connect() {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  const messages: Heard[] = []
  pipe.listen((message) => messages.push(message))
  await outbox.ready
  const { session } = key(1)
  const [old] = sockets as [FakeSocket]
  pipe.send({ type: 'term.open', session })
  pipe.input(session, 'before hello')
  expect(old.sent).toEqual([])
  old.receive({ type: 'hello', build: 'one' })
  await Promise.resolve()
  expect(old.sent).toEqual([{ type: 'term.open', session }])
  old.receive({ type: 'term.bound', session, target: 'pane' })
  const [pending] = outbox.pending() as [TermKey]
  expect(old.sent.at(-1)).toEqual(pending)
  old.close()
  retry.shift()?.()
  const current = sockets[1]!
  current.receive({ type: 'hello', build: 'one' })
  await Promise.resolve()
  expect(current.sent).toEqual([{ type: 'term.open', session }, pending])
  old.receive({ type: 'term.data', session, data: 'Ynll', attach: 99, reset: true })
  old.receive({ ...pending, type: 'term.receipt', status: 'applied' })
  expect(outbox.pending()).toEqual([pending])
  expect(messages.filter((m) => m.type === 'term.data')).toEqual([])
  current.receive({ type: 'term.data', session, data: 'bmV3', attach: 1, reset: true })
  current.receive({ ...pending, type: 'term.receipt', status: 'doNotResend' })
  expect(outbox.pending()).toEqual([])
  expect(messages.filter((m) => m.type === 'term.data')).toHaveLength(1)
})

test('unavailable IndexedDB drains the pending outbox and reloads once', async () => {
  const outbox = pipeOutbox(new MemoryStorage(), false, async () => {
    throw new Error('IndexedDB unavailable')
  })
  const sockets: FakeSocket[] = []
  const retries: Array<() => void> = []
  const notices: string[] = []
  let reloads = 0
  const pipe = createSocket({
    outbox, retry: (fn) => retries.push(fn), reload: () => { reloads++ },
    notice: (words) => notices.push(words),
    connect() {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  await outbox.ready
  const { session } = key(1)
  pipe.send({ type: 'term.open', session })
  const first = sockets[0]!
  first.receive({ type: 'hello', build: 'one' })
  await Promise.resolve()
  first.receive({ type: 'term.bound', session, target: 'pane' })
  pipe.input(session, 'pending')
  const pending = outbox.pending()[0]!
  first.close()
  retries.shift()?.()
  const next = sockets[1]!
  next.receive({ type: 'hello', build: 'two' })
  await Bun.sleep(0)
  expect(next.sent).toEqual([{ type: 'term.open', session }, pending])
  pipe.input(session, 'must pause')
  expect(outbox.pending()).toEqual([pending])
  expect(notices).toHaveLength(1)
  next.receive({ ...pending, type: 'term.receipt', status: 'uncertain' })
  expect(notices).toHaveLength(2)
  next.receive({ ...pending, type: 'term.receipt', status: 'uncertain' })
  expect(notices).toHaveLength(2)
  expect(reloads).toBe(1)
  expect(retries).toEqual([])
  expect(outbox.pending()).toEqual([])
})

test('a failed reload ticket claim reports loss and permits new terminal input', async () => {
  const storage = new MemoryStorage()
  const first = pipeOutbox(storage, false, async () => true)
  await first.ready
  const { session } = key(1)
  first.capture(session, 'old', 'old key')
  await first.prepareReload()
  const reloaded = pipeOutbox(storage, true, async () => {
    throw new Error('IndexedDB is unavailable on reload')
  })
  await reloaded.ready
  expect(reloaded.recoveryWarning()).toBe(true)
  expect(reloaded.pending()).toEqual([])
  expect(reloaded.capture(session, 'new', 'new key')).toBe(true)
  expect(reloaded.pending()[0]?.data).toBe('new key')
})

test('early input is bounded without evicting keys already accepted', async () => {
  const outbox = pipeOutbox(new MemoryStorage(), false)
  await outbox.ready
  const { session } = key(1)
  for (let i = 0; i < 64; i++) expect(outbox.capture(session, undefined, String(i))).toBe(true)
  expect(outbox.capture(session, undefined, 'overflow')).toBe(false)
  expect(outbox.count(session)).toBe(64)
  outbox.bind(session, 'pane')
  expect(outbox.pending().map(({ data }) => data)).toEqual(
    Array.from({ length: 64 }, (_, i) => String(i)),
  )
})

test('F3.10 chunks UTF-8 without splitting astral characters or changing control bytes', () => {
  const paste = '\x1b[200~' + 'a'.repeat(4089) + '🙂\x00\r\x1b[201~'
  const chunks = inputChunks(paste)
  expect(chunks).toHaveLength(2)
  expect(chunks.join('')).toBe(paste)
  expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 4096)).toBe(true)
})

test('F3.9–10, F3.12 the private tmux applies exact bytes and redraws after reattach', async () => {
  const { createTmuxPump } = await import('../live/pump.ts')
  const dir = folder()
  const socket = `ar-c16-${crypto.randomUUID().slice(0, 8)}`
  const pump = createTmuxPump({ dir, socket })
  const marks = pipeMarks(join(dir, 'work.db'), dir)
  const check = async (condition: () => boolean) => {
    for (let i = 0; i < 120 && !condition(); i++) await Bun.sleep(25)
    expect(condition()).toBe(true)
  }
  try {
    let attaches = 0
    pump.onAttach = [(session) => { if (session === undefined) attaches++ }]
    pump.start('s-1', 'stty raw -echo; exec cat > bytes')
    pump.start('screen', 'printf "baseline\\n"; exec cat')
    const bytes = () => Bun.file(join(dir, 'bytes'))
    await check(() => pump.inputTarget('s-1').state === 'ready' &&
      pump.inputTarget('screen').state === 'ready' && pump.tail('screen').includes('baseline'))
    const observed: string[] = []
    pump.onOutputs = [(session, data) => {
      if (session === 'screen') observed.push(new TextDecoder().decode(data))
    }]
    const redraw = () => new Promise<string>((resolve) =>
      pump.redraw('screen', (bytes) => resolve(new TextDecoder().decode(bytes))))
    expect(await redraw()).toContain('baseline')
    pump.input('screen', 'before-detach\r')
    await check(() => observed.join('').includes('before-detach'))
    const prior = attaches
    const detach = Bun.spawnSync(['tmux', '-f', '/dev/null', '-L', socket, 'detach-client', '-s',
      pump.name], { env: { PATH: process.env.PATH } })
    expect(detach.exitCode).toBe(0)
    await check(() => pump.inputTarget('screen').state === 'waiting')
    pump.input('screen', 'during-detach\r')
    await check(() => attaches > prior)
    expect(await redraw()).toContain('during-detach')
    pump.input('screen', 'after-baseline\r')
    await check(() => observed.join('').includes('after-baseline'))

    const target = pump.inputTarget('s-1')
    if (target.state !== 'ready') throw new Error('terminal went away')
    const queue = pipeQueue(marks, (k) => ({
      state: 'ready', prepare: () => target.prepare(k.data, k.instance, k.seq),
    }))
    const type = (seq: number, data: string, tab = 'bench') => {
      let receipt: KeyReceipt | undefined
      queue.enqueue({ ...key(seq, tab, target.id), data }, (r) => { receipt = r },
        () => { throw new Error('unexpected resync') })
      expect(receipt?.status).toBe('applied')
    }
    const elapsed = (fn: () => void) => {
      const start = performance.now()
      fn()
      return (performance.now() - start).toFixed(1)
    }
    const plain = 'p'.repeat(4096)
    const paste = '\x1b[200~' + 'a'.repeat(4080) + '🙂\x00\r\x1b[201~'
    const baselineTyping = elapsed(() => { for (let i = 0; i < 10; i++) pump.input('s-1', 'x') })
    const durableTyping = elapsed(() => { for (let i = 1; i <= 10; i++) type(i, 'y') })
    const baselinePaste = elapsed(() => {
      for (let i = 0; i < plain.length; i += 128) pump.input('s-1', plain.slice(i, i + 128))
    })
    const durablePaste = elapsed(() => inputChunks(paste).forEach((part, i) => type(11 + i, part)))
    const baselineTabs = elapsed(() => {
      for (let i = 0; i < 5; i++) {
        pump.input('s-1', 'u')
        pump.input('s-1', 'v')
      }
    })
    const durableTabs = elapsed(() => {
      for (let i = 1; i <= 5; i++) {
        type(i, 'a', 'first-tab')
        type(i, 'b', 'second-tab')
      }
    })
    expect(target.prepare('late-old-key', 'bench', 1)?.run()).toBe('target')
    const expected = 'x'.repeat(10) + 'y'.repeat(10) + plain + paste + 'uv'.repeat(5) +
      'ab'.repeat(5)
    await check(() => bytes().size >= Buffer.byteLength(expected))
    expect(Buffer.from(await bytes().arrayBuffer())).toEqual(Buffer.from(expected))
    console.info('pipe timings ms, direct / durable',
      { typing: [baselineTyping, durableTyping], paste: [baselinePaste, durablePaste],
        alternatingTabs: [baselineTabs, durableTabs] })
  } finally {
    marks.close()
    pump.killServer()
  }
}, 15000)

test('live websocket encodes the binding, snapshot and durable replay receipt', async () => {
  const { startServer } = await import('./server.ts')
  const { createTmuxPump } = await import('../live/pump.ts')
  const dir = folder()
  const pump = createTmuxPump({ dir, socket: `ar-c16-${crypto.randomUUID().slice(0, 8)}` })
  const env = { ARISTOTELES_DB: join(dir, 'work.db') }
  const start = () => startServer({ dir, env, pump })
  let server = start()
  let ws: WebSocket | undefined
  const read = (type: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const current = ws!
    const timer = setTimeout(() => reject(new Error(`missing ${type}`)), 4000)
    const message = (event: MessageEvent) => {
      const value = JSON.parse(String(event.data))
      if (value.type !== type) return
      current.removeEventListener('message', message)
      clearTimeout(timer)
      resolve(value)
    }
    current.addEventListener('message', message)
  })
  const connect = async () => {
    ws = new WebSocket(server.url.replace('http:', 'ws:') + 'ws', {
      headers: { origin: new URL(server.url).origin },
    } as never)
    await read('hello')
    const binding = read('term.bound')
    const snapshot = read('term.data')
    ws.send(JSON.stringify({ type: 'term.open', session: 's-1' }))
    const [bound, frame] = await Promise.all([binding, snapshot])
    expect(frame.reset).toBe(true)
    return String(bound.target)
  }
  try {
    pump.start('s-1', 'stty raw -echo; exec cat > socket-bytes')
    const bytes = () => Bun.file(join(dir, 'socket-bytes'))
    for (let i = 0; i < 100 && !await bytes().exists(); i++) await Bun.sleep(20)
    expect(await bytes().exists()).toBe(true)
    const target = await connect()
    const first = { ...key(1, 'socket-test', target), data: 'once' }
    const applied = read('term.receipt')
    ws!.send(JSON.stringify(first))
    expect((await applied).status).toBe('applied')
    ws?.close()
    server.stop()
    server = start()
    expect(await connect()).toBe(target)
    const retired = read('term.receipt')
    ws!.send(JSON.stringify(first))
    expect((await retired).status).toBe('doNotResend')
    const next = read('term.receipt')
    ws!.send(JSON.stringify({ ...first, seq: 2, data: ' twice?' }))
    expect((await next).status).toBe('applied')
    for (let i = 0; i < 100 && bytes().size < 11; i++) await Bun.sleep(20)
    expect(await bytes().text()).toBe('once twice?')
  } finally {
    ws?.close()
    server.stop()
    pump.killServer()
  }
}, 12000)
