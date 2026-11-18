// The marker of an actor that runs `work wait` (BUILD.md 10.1): a small file next to the store,
// never an event. The wait process keeps it fresh while it blocks; the watcher reads it, so that
// an agent that waits is not taken for a silent one.
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Effect } from 'effect'
import type { WaitMarker } from '../../core/schema/outside.ts'
import { dbPath, sha } from '../../core/services/index.ts'

// The wait renews its marker this often; a marker with an older beat is stale (Claude Code
// kills a command at its limit, and then nothing removes the file).
export const BEAT_MS = 5000
const STALE_MS = 30000

interface Marker {
  // The terminal of the actor, when it has one (the watcher reads markers by session).
  readonly session: string | null
  // The wait process while it blocks; null after it returned.
  readonly pid: number | null
  readonly beat: number
}

export interface WaitPlace {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly cwd: string
  // The actor that waits (host, role:writer, maker:m1).
  readonly actor: string
}

const folderOf = (env: WaitPlace['env']): string => join(dirname(dbPath(env)), 'waiting')
const fileOf = (p: WaitPlace): string =>
  join(folderOf(p.env), `${sha(p.cwd).slice(0, 16)}-${p.actor}.json`)

const read = (path: string): Marker | null => {
  try {
    const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof raw !== 'object' || raw === null) return null
    const m = raw as Record<string, unknown>
    return {
      session: typeof m.session === 'string' ? m.session : null,
      pid: typeof m.pid === 'number' ? m.pid : null,
      beat: typeof m.beat === 'number' ? m.beat : 0,
    }
  } catch {
    return null
  }
}

// A marker that cannot be written only costs the watcher's knowledge: the wait goes on.
const write = (p: WaitPlace, marker: Marker): Effect.Effect<void> =>
  Effect.sync(() => {
    try {
      const path = fileOf(p)
      mkdirSync(dirname(path), { recursive: true })
      // A rename is atomic: the watcher never reads half a file.
      writeFileSync(`${path}.${process.pid}`, JSON.stringify(marker))
      renameSync(`${path}.${process.pid}`, path)
    } catch {
      // nothing to do: see above
    }
  })

export const markWaiting = (p: WaitPlace, session: string | null) =>
  write(p, { session, pid: process.pid, beat: Date.now() })

export const markReturned = (p: WaitPlace, session: string | null) =>
  write(p, { session, pid: null, beat: Date.now() })

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process runs, as another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// The markers of the actors of a dir (P8): each says whether its wait runs now (a fresh beat of a
// live process) and when it last beat or returned. Every process reads them with this one reader.
export const readMarkers = (
  env: WaitPlace['env'],
  cwd: string,
  now: number = Date.now(),
): ReadonlyArray<WaitMarker> => {
  const folder = folderOf(env)
  const prefix = `${sha(cwd).slice(0, 16)}-`
  let names: ReadonlyArray<string>
  try {
    names = readdirSync(folder).filter((n) => n.startsWith(prefix) && n.endsWith('.json'))
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const m = read(join(folder, name))
    if (m === null) return []
    const waits = m.pid !== null && now - m.beat < STALE_MS && alive(m.pid)
    const actor = name.slice(prefix.length, -'.json'.length)
    return [{ actor, session: m.session, waits, beat: m.beat }]
  })
}
