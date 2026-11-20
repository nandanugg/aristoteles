import { Schema } from 'effect'
import { DashMessage, type PageMessage, ServerMessage, type TermKey } from '../contract.ts'
import type { pipeOutbox } from './pipe-outbox.ts'

// What the page hears: a server message, or its own "open" when the socket connects.
export type Heard =
  | typeof ServerMessage.Type
  | typeof DashMessage.Type
  | { readonly type: 'open' }
  | { readonly type: 'term.pending'; readonly session: TermKey['session']; readonly count: number }
const decodeMessage = Schema.decodeUnknownOption(Schema.Union([ServerMessage, DashMessage]))
type Listener = (message: Heard) => void

// A socket becomes usable after hello. The outbox owns all key retries.
interface Transport {
  readonly connect: () => Pick<WebSocket,
    'readyState' | 'send' | 'close' | 'onmessage' | 'onclose'>
  readonly retry: (fn: () => void) => void
  readonly reload: () => void
  readonly notice?: (words: string) => void
  readonly outbox?: ReturnType<typeof pipeOutbox>
}

export const createSocket = (transport: Transport) => {
  type Session = TermKey['session']
  const listeners = new Set<Listener>()
  const opened = new Set<Session>()
  const targets = new Map<Session, string>()
  const sent = new Set<string>()
  let ws: ReturnType<Transport['connect']>
  let usable = false
  let build: string | null = null
  let reloading = false
  let drainingBuild = false
  let warnedRecovery = false
  const notices = new Set<string>()
  const outbox = transport.outbox
  let storageReady = false
  const notify = (message: Heard) => { for (const fn of listeners) fn(message) }
  const issue = (session: Session, error: string) => notify({ type: 'term.error', session, error })
  const storageIssue = (session: Session) =>
    issue(session, 'Terminal input paused: outbox unavailable')
  void outbox?.ready.then(() => { storageReady = true }, () => {})
  const noticeOnce = (key: string, words: string) => {
    if (notices.has(key)) return
    notices.add(key)
    transport.notice?.(words)
  }
  const reloadWhenDrained = () => {
    if (!drainingBuild || outbox?.sessions().size) return
    reloading = true
    usable = false
    transport.reload()
  }

  const wire = (message: typeof PageMessage.Type) => {
    if (usable && ws.readyState === 1) ws.send(JSON.stringify(message))
  }
  const count = (session: Session) =>
    notify({ type: 'term.pending', session, count: outbox?.count(session) ?? 0 })
  const flush = () => {
    if (!usable || !storageReady || !outbox) return
    for (const key of outbox.pending()) {
      const id = JSON.stringify([key.target, key.seq])
      if (!sent.has(id)) {
        wire(key)
        sent.add(id)
      }
    }
  }
  const hello = async (current: ReturnType<Transport['connect']>, next: string) => {
    try { await outbox?.ready } catch {}
    if (ws !== current || current.readyState !== 1 || reloading) return
    if (build !== null && build !== next && !drainingBuild) {
      usable = false
      reloading = true
      try {
        if (outbox?.sessions().size) await outbox.prepareReload()
        transport.reload()
        return
      } catch {
        if (ws !== current) return
        reloading = false
        drainingBuild = true
        for (const session of opened) {
          issue(session, 'Terminal input paused while pending keys drain before reload')
        }
        noticeOnce('drain', 'Terminal input paused while pending keys drain before reload')
        if (current.readyState !== 1) {
          transport.retry(() => { if (ws === current) connect() })
          return
        }
        // The new socket can replay the shared terminal protocol. Reload as soon as it drains.
      }
    }
    if (outbox?.recoveryWarning() && !warnedRecovery) {
      warnedRecovery = true
      noticeOnce('handoff', 'Terminal input could not be recovered from the previous page')
    }
    build = next
    usable = true
    sent.clear()
    notify({ type: 'open' })
    for (const session of new Set([...opened, ...(outbox?.sessions() ?? [])])) {
      wire({ type: 'term.open', session })
      count(session)
    }
    flush()
  }
  const connect = () => {
    const current = transport.connect()
    ws = current
    current.onmessage = (m) => {
      if (ws !== current || reloading) return
      let message: ReturnType<typeof decodeMessage>
      try { message = decodeMessage(JSON.parse(String(m.data))) } catch { return }
      if (message._tag === 'None') return
      const v = message.value
      if (v.type === 'hello') {
        void hello(current, v.build)
        return
      }
      if ('session' in v && v.type.startsWith('term.') && !usable) return
      if (v.type === 'term.bound') {
        targets.set(v.session, v.target)
        try {
          if (storageReady) outbox?.bind(v.session, v.target)
          count(v.session)
          flush()
        } catch {
          storageIssue(v.session)
        }
        return
      }
      if (v.type === 'term.receipt') {
        try {
          if (outbox?.retire(v)) {
            sent.delete(JSON.stringify([v.target, v.seq]))
            count(v.session)
            if (!opened.has(v.session) && !outbox.count(v.session)) {
              wire({ type: 'term.close', session: v.session })
            }
            if (v.status === 'refused' || v.status === 'uncertain') {
              const words = v.status === 'refused'
                ? 'Terminal target changed; pending input could not be delivered'
                : 'Terminal write was interrupted; some input may not have arrived'
              issue(v.session, words)
              noticeOnce(JSON.stringify([v.target, v.status]), words)
            }
            reloadWhenDrained()
          }
        } catch {
          storageIssue(v.session)
          current.close()
        }
        return
      }
      notify(v)
    }
    current.onclose = () => {
      if (ws !== current) return
      usable = false
      if (!reloading) transport.retry(() => { if (ws === current) connect() })
    }
  }
  connect()
  return {
    listen(fn: Listener): () => void {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    send(message: typeof PageMessage.Type): void {
      if (message.type === 'term.open') opened.add(message.session)
      if (message.type === 'term.close') {
        opened.delete(message.session)
        if (outbox?.count(message.session)) return
      }
      wire(message)
    },
    input(session: Session, data: string) {
      if (drainingBuild) {
        issue(session, 'Terminal input paused while pending keys drain before reload')
        return
      }
      if (!storageReady || !outbox || reloading) {
        storageIssue(session)
        return
      }
      try {
        if (!outbox.capture(session, targets.get(session), data)) {
          issue(session, 'Terminal input paused: waiting for a pane to bind')
          return
        }
        if (!targets.has(session)) issue(session, 'Waiting for the terminal pane to bind')
        count(session)
        flush()
      } catch {
        storageIssue(session)
      }
    },
  }
}
