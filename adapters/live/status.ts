// P8, ruling 3: what the AI does now on the dir view (the directions page, the agents page), as the
// toast of the page shows it. It is a small file next to the store, one for each actor, never an
// event: the status changes often, it is no part of the work's history, and it must work before
// any store (onboarding). Every process reads it with this reader; an old one is stale.
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dbPath, sha } from '../../core/services/index.ts'

export const STATUS_KINDS = ['working', 'thinking', 'applied', 'feedback', 'waiting'] as const
export type StatusKind = (typeof STATUS_KINDS)[number]
export const isStatusKind = (word: string): word is StatusKind =>
  (STATUS_KINDS as ReadonlyArray<string>).includes(word)

// The words of each kind, as the page shows them.
export const STATUS_WORDS: Readonly<Record<StatusKind, string>> = {
  working: 'Working',
  thinking: 'Thinking',
  applied: 'Applied',
  feedback: 'Wants to apply your feedback',
  waiting: 'Waits for you',
}

// A status older than this shows no more.
export const STATUS_MS = 10 * 60000

export interface AiStatus {
  // The run (h1) or the assignment (a3) that set it; "host" before the store.
  readonly by: string
  readonly kind: StatusKind
  readonly text: string
  // The time (ms) when it was set.
  readonly at: number
}

type Env = Readonly<Record<string, string | undefined>>
const folderOf = (env: Env): string => join(dirname(dbPath(env)), 'status')
const prefixOf = (cwd: string): string => `${sha(cwd).slice(0, 16)}-`

export const writeStatus = (env: Env, cwd: string, status: AiStatus): void => {
  const path = join(folderOf(env), `${prefixOf(cwd)}${status.by}.json`)
  mkdirSync(dirname(path), { recursive: true })
  // A rename is atomic: a reader never reads half a file.
  writeFileSync(`${path}.${process.pid}`, JSON.stringify(status))
  renameSync(`${path}.${process.pid}`, path)
}

const read = (path: string): AiStatus | null => {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    const { by, kind, text, at } = raw
    if (typeof by !== 'string' || typeof text !== 'string' || typeof at !== 'number') return null
    return typeof kind === 'string' && isStatusKind(kind) ? { by, kind, text, at } : null
  } catch {
    return null
  }
}

const filesOf = (env: Env, cwd: string): ReadonlyArray<string> => {
  try {
    const prefix = prefixOf(cwd)
    return readdirSync(folderOf(env))
      .filter((n) => n.startsWith(prefix) && n.endsWith('.json'))
      .map((n) => join(folderOf(env), n))
  } catch {
    return []
  }
}

// The newest status of the dir, fresh or not (the page shows only a fresh one).
export const readStatus = (env: Env, cwd: string): AiStatus | null =>
  filesOf(env, cwd)
    .map(read)
    .reduce<AiStatus | null>((a, b) => (b !== null && (a === null || b.at > a.at) ? b : a), null)

// The names and times of the files, for the server to see a change.
export const statusStamp = (env: Env, cwd: string): string =>
  filesOf(env, cwd)
    .map((path) => {
      try {
        return `${path} ${statSync(path).mtimeMs}`
      } catch {
        return ''
      }
    })
    .join('\n')
