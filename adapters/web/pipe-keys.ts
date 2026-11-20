import { Database } from 'bun:sqlite'
import { mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import type { PreparedTerminalWrite } from '../live/pump.ts'
import type { KeyReceipt, TermKey } from './contract.ts'

type Reply = (receipt: KeyReceipt) => void
type Destination =
  | { readonly state: 'waiting' }
  | { readonly state: 'gone' }
  | { readonly state: 'ready'; readonly prepare: () => PreparedTerminalWrite | undefined }

interface Entry {
  readonly key: TermKey
  readonly reply: Reply
}

// Both connections are local to the sidecar. The lock DB serializes mark-to-write across
// processes while the marks DB commits independently. Process death releases the lock.
export function pipeMarks(store: string, project: string) {
  const dir = dirname(resolve(store))
  mkdirSync(dir, { recursive: true })
  const scope = JSON.stringify([basename(store), realpathSync(project)])
  const db = new Database(join(dir, 'pipe-marks.db'))
  const lock = new Database(join(dir, 'pipe-dispatch.db'))
  db.exec('PRAGMA busy_timeout = 1000; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL')
  db.exec('CREATE TABLE IF NOT EXISTS mark (stream TEXT PRIMARY KEY, next INTEGER NOT NULL)')
  const read = db.query<{ next: number }, [string]>('SELECT next FROM mark WHERE stream = ?')
  const write = db.query(
    'INSERT INTO mark (stream, next) VALUES (?, ?) ' +
      'ON CONFLICT(stream) DO UPDATE SET next=excluded.next',
  )
  // These rows outlive any replay. A pending attempt remains uncertain after a server crash.
  db.exec(`CREATE TABLE IF NOT EXISTS write_issue (
    stream TEXT NOT NULL, seq INTEGER NOT NULL, status TEXT NOT NULL, PRIMARY KEY(stream, seq)
  )`)
  const lookupIssue = db.query<{ status: 'uncertain' | 'refused' }, [string, number]>(
    'SELECT status FROM write_issue WHERE stream = ? AND seq = ?',
  )
  const setIssue = db.query('INSERT OR REPLACE INTO write_issue VALUES (?, ?, ?)')
  const clearIssue = db.query('DELETE FROM write_issue WHERE stream = ? AND seq = ?')
  const mark = db.transaction((stream: string, seq: number) => {
    write.run(stream, seq + 1)
    setIssue.run(stream, seq, 'uncertain')
  })
  const next = (stream: string) => read.get(stream)?.next ?? 1
  return {
    next,
    stream: (key: TermKey) => JSON.stringify([scope, key.instance, key.target]),
    dispatch(
      stream: string, key: TermKey, prepare?: () => PreparedTerminalWrite | undefined,
    ): KeyReceipt['status'] | undefined {
      try {
        lock.exec('BEGIN IMMEDIATE')
      } catch (error) {
        if ((error as { code?: string }).code?.startsWith('SQLITE_BUSY')) return undefined
        throw error
      }
      try {
        const expected = next(stream)
        if (key.seq < expected) return lookupIssue.get(stream, key.seq)?.status ?? 'doNotResend'
        if (key.seq > expected || !prepare) return undefined
        let prepared: PreparedTerminalWrite | undefined
        try {
          prepared = prepare()
        } catch {
          // Preparation writes no input. Retry this key without blocking other streams.
          return undefined
        }
        if (!prepared) return undefined
        try {
          mark(stream, key.seq)
          let outcome: ReturnType<PreparedTerminalWrite['run']>
          try {
            outcome = prepared.run()
          } catch {
            return 'uncertain'
          }
          if (outcome === 'target') {
            setIssue.run(stream, key.seq, 'refused')
            return 'refused'
          }
          clearIssue.run(stream, key.seq)
          return 'applied'
        } finally {
          try { prepared.cleanup?.() } catch {}
        }
      } finally {
        lock.exec('ROLLBACK')
      }
    },
    close() {
      lock.close()
      db.close()
    },
  }
}

export function pipeQueue(
  marks: ReturnType<typeof pipeMarks>,
  destination: (key: TermKey) => Destination,
) {
  const pending = new Map<string, Map<number, Entry>>()
  const respond = ({ key: { instance, session, target, seq }, reply }: Entry,
    status: KeyReceipt['status']) =>
    reply({
      type: 'term.receipt', instance, session, target, seq, status,
      ...(status === 'refused' ? { reason: 'target' as const } : {}),
    })
  const drain = () => {
    for (const [stream, entries] of pending) {
      for (const [seq, entry] of entries) {
        // Even duplicate receipts go through the dispatch lock before retiring the key.
        if (seq >= marks.next(stream)) continue
        const status = marks.dispatch(stream, entry.key)
        if (status) {
          entries.delete(seq)
          respond(entry, status)
        }
      }
      for (;;) {
        const expected = marks.next(stream)
        const entry = entries.get(expected)
        const first = entry ?? [...entries.values()].find(({ key }) => key.seq >= expected)
        if (!first) break
        const target = destination(first.key)
        if (target.state === 'waiting') break
        if (target.state === 'gone') {
          pending.delete(stream)
          for (const item of entries.values()) respond(item, 'refused')
          break
        }
        if (!entry) break
        const status = marks.dispatch(stream, entry.key, target.prepare)
        if (!status) break
        entries.delete(entry.key.seq)
        respond(entry, status)
      }
      if (!entries.size) pending.delete(stream)
    }
  }
  return {
    drain,
    enqueue(key: TermKey, reply: Reply, resync: () => void) {
      const stream = marks.stream(key)
      const entries = pending.get(stream) ?? new Map<number, Entry>()
      const previous = entries.get(key.seq)?.key
      if (previous && (key.data !== previous.data || key.session !== previous.session)) {
        resync()
        return
      }
      const expected = marks.next(stream)
      const ahead = entries.size - Number(entries.has(expected))
      if (!previous && key.seq > expected && ahead >= 64) {
        resync()
        return
      }
      entries.set(key.seq, { key, reply })
      pending.set(stream, entries)
      drain()
    },
  }
}
