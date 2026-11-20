import type { KeyReceipt, TermKey } from '../contract.ts'

type Session = TermKey['session']
type Key = Omit<TermKey, 'type' | 'instance'>
interface Stream {
  readonly next: number
  readonly outbox: ReadonlyArray<Key>
}
interface State {
  readonly instance: string
  readonly streams: Readonly<Record<string, Stream>>
  readonly unbound: ReadonlyArray<{ readonly session: Session; readonly data: string }>
  readonly handoff?: string
}
const storageKey = 'aristoteles.term.v1'
const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
  n.toString(16).padStart(2, '0')).join('')

const encoder = new TextEncoder()
export const inputChunks = (text: string): ReadonlyArray<string> => {
  const chunks: string[] = []
  let chunk = ''
  let size = 0
  for (const char of text) {
    const bytes = encoder.encode(char).length
    if (size + bytes > 4096) {
      chunks.push(chunk)
      chunk = ''
      size = 0
    }
    chunk += char
    size += bytes
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

// A shared, single-use ticket makes adoption exclusive even if sessionStorage was copied.
function reloadTicket(ticket: string, create: boolean): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('aristoteles-terminal', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('reload')
    open.onerror = () => reject(open.error)
    open.onsuccess = () => {
      const db = open.result
      const tx = db.transaction('reload', 'readwrite')
      const store = tx.objectStore('reload')
      let accepted = create
      if (create) store.add(true, ticket)
      else {
        const get = store.get(ticket)
        get.onsuccess = () => {
          accepted = get.result === true
          if (accepted) store.delete(ticket)
        }
      }
      tx.oncomplete = () => { db.close(); resolve(accepted) }
      tx.onabort = () => { db.close(); reject(tx.error) }
    }
  })
}

export function pipeOutbox(
  storage: Storage,
  isReload: boolean,
  ticket = reloadTicket,
) {
  let state: State = { instance: id(), streams: {}, unbound: [] }
  const save = (next: State) => {
    storage.setItem(storageKey, JSON.stringify(next))
    state = next
  }
  let recoveryWarning = false
  const ready = (async () => {
    const saved = storage.getItem(storageKey)
    if (isReload && saved) {
      const { handoff, ...previous } = JSON.parse(saved) as State
      if (handoff) {
        try {
          if (await ticket(handoff, false)) {
            save(previous)
            return
          }
        } catch {
          recoveryWarning = previous.unbound.length > 0 ||
            Object.values(previous.streams).some(({ outbox }) => outbox.length > 0)
        }
      }
    }
    save(state)
  })()

  const append = (
    current: State, session: Session, target: string, chunks: ReadonlyArray<string>,
  ) => {
    const stream = current.streams[target] ?? { next: 1, outbox: [] }
    const added = chunks.map((data, index) => ({ session, target, seq: stream.next + index, data }))
    return {
      ...current,
      streams: {
        ...current.streams,
        [target]: { next: stream.next + added.length, outbox: [...stream.outbox, ...added] },
      },
    }
  }
  return {
    ready,
    recoveryWarning: () => recoveryWarning,
    capture(session: Session, target: string | undefined, text: string) {
      const chunks = inputChunks(text)
      if (target) save(append(state, session, target, chunks))
      else {
        if (state.unbound.length + chunks.length > 64) return false
        save({
          ...state,
          unbound: [...state.unbound, ...chunks.map((data) => ({ session, data }))],
        })
      }
      return true
    },
    bind(session: Session, target: string) {
      const chunks = state.unbound.filter((key) => key.session === session).map((key) => key.data)
      if (chunks.length) save(append({
        ...state, unbound: state.unbound.filter((key) => key.session !== session),
      }, session, target, chunks))
    },
    pending(): ReadonlyArray<TermKey> {
      return Object.values(state.streams).flatMap(({ outbox }) =>
        outbox.map((key) => ({ ...key, type: 'term.key', instance: state.instance })))
    },
    count(session: Session) {
      return this.pending().filter((key) => key.session === session).length +
        state.unbound.filter((key) => key.session === session).length
    },
    sessions() {
      return new Set([...this.pending(), ...state.unbound].map(({ session }) => session))
    },
    retire(receipt: KeyReceipt) {
      const stream = state.streams[receipt.target]
      if (receipt.instance !== state.instance || !stream?.outbox.some(
        (key) => key.seq === receipt.seq && key.session === receipt.session,
      )) return false
      save({
        ...state,
        streams: {
          ...state.streams,
          [receipt.target]: { ...stream, outbox: stream.outbox.filter(
            (key) => key.seq !== receipt.seq,
          ) },
        },
      })
      return true
    },
    async prepareReload() {
      const handoff = id()
      await ticket(handoff, true)
      save({ ...state, handoff })
    },
  }
}
