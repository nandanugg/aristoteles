// Company directions (Nanda, 2026-11-10): a company direction lives in a git repo and changes
// there. aristoteles.lock names a folder of a repo for each one; the daily refresh fetches it and
// reads the folder at a commit.
import { dirname, join } from 'node:path'
import { Effect } from 'effect'
import { parseYaml } from '../config/core.ts'
import { OutsideFailed, type Refused, refuse } from '../domain/errors.ts'
import type { CompanyFolder } from '../domain/files.ts'
import { Files, Spawn } from '../services/outside.ts'
import { dbPath } from '../store/path.ts'

export const LOCK = 'aristoteles.lock'
const WRITTEN = ['commit', 'newest', 'refreshed']

// One entry of the lock file; commit, newest and refreshed are written by work.
export interface LockEntry {
  readonly repo: string
  readonly path: string
  readonly owner: string
  readonly tag?: string
  readonly checkedBy?: string
  readonly rules?: Readonly<Record<string, string>>
  readonly commit?: string
  readonly newest?: string
  readonly refreshed?: string
}
export type Lock = Readonly<Record<string, LockEntry>>

// The date of a time on this machine (a refresh is due when the last one was on an earlier date).
export const localDate = (iso: string): string => new Date(iso).toLocaleDateString('en-CA')

export const readLock = (dir: string): Effect.Effect<Lock | undefined, Refused, Files> =>
  Effect.gen(function* () {
    const text = yield* (yield* Files).read(join(dir, LOCK))
    if (text === null) return undefined
    const lock = yield* Effect.try({
      try: () => parseYaml(text) as Record<string, Record<string, unknown> | undefined>,
      catch: (e) => e as Refused,
    })
    for (const [id, e] of Object.entries(lock)) {
      for (const key of ['repo', 'path', 'owner']) {
        const value = e?.[key]
        if (typeof value !== 'string' || !value.trim()) {
          return yield* refuse(`${LOCK} ${id}: ${key} is required`)
        }
      }
    }
    return lock as unknown as Lock
  })

// The keys that the person writes come first, then the three that work writes.
export const writeLock = (dir: string, lock: Lock): Effect.Effect<void, OutsideFailed, Files> =>
  Effect.gen(function* () {
    const order = (e: LockEntry) => {
      const own = Object.entries(e)
      return Object.fromEntries([
        ...own.filter(([k]) => !WRITTEN.includes(k)),
        ...own.filter(([k, v]) => WRITTEN.includes(k) && v !== undefined).sort(
          ([a], [b]) => WRITTEN.indexOf(a) - WRITTEN.indexOf(b),
        ),
      ])
    }
    const text = Bun.YAML.stringify(
      Object.fromEntries(Object.entries(lock).map(([id, e]) => [id, order(e)])),
      null,
      2,
    )
    yield* (yield* Files).write(join(dir, LOCK), text)
  })

// The copy of a repo on this machine: ~/.aristoteles/sources/<repo, as a folder name>.
const cacheOf = (env: Readonly<Record<string, string | undefined>>, repo: string): string =>
  join(
    env.ARISTOTELES_SOURCES ?? join(dirname(dbPath(env)), 'sources'),
    repo.replace(/^[a-z]+:\/\//, '').replace(/[^A-Za-z0-9._-]+/g, '_'),
  )

// Fetches the repo, and reads the folder at the newest commit that changed it. It fails when the
// fetch fails; the caller keeps the accepted commit.
export const fetchFolder = (
  env: Readonly<Record<string, string | undefined>>,
  entry: LockEntry,
): Effect.Effect<
  { readonly commit: string; readonly folder: CompanyFolder },
  OutsideFailed,
  Spawn | Files
> =>
  Effect.gen(function* () {
    const spawn = yield* Spawn
    const files = yield* Files
    const git = (args: string[], cwd?: string) =>
      spawn.run(['git', ...args], cwd ? { cwd } : {}).pipe(
        Effect.flatMap((run) =>
          run.code === 0
            ? Effect.succeed(run.out)
            : Effect.fail(
                new OutsideFailed({
                  system: 'git',
                  message: run.err.trim() || `git ${args.join(' ')} failed`,
                  next: null,
                }),
              ),
        ),
      )
    const cache = cacheOf(env, entry.repo)
    // git clone makes the parent folders of the cache itself.
    if ((yield* files.kind(cache)) === null) {
      yield* git(['clone', '--quiet', '--bare', entry.repo, cache])
    } else {
      yield* git(['fetch', '--quiet', '--prune', '--tags', 'origin', '+refs/heads/*:refs/heads/*'], cache)
    }
    const target = entry.tag ? `${entry.tag}^{commit}` : 'HEAD'
    const tip = (yield* git(['rev-parse', '--verify', target], cache)).trim()
    const commit = (yield* git(['log', '-1', '--format=%H', tip, '--', entry.path], cache)).trim()
    if (!commit) {
      return yield* new OutsideFailed({
        system: 'git',
        message: `${entry.repo} has no folder ${entry.path} at ${entry.tag ?? 'its default branch'}`,
        next: null,
      })
    }
    const listed = yield* git(['ls-tree', '-r', '--name-only', commit, '--', entry.path], cache)
    const names = listed.split('\n').filter(Boolean)
    // readFolder is plain code, so the markdown files are read first, then it reads from a map.
    const texts = new Map<string, string>()
    for (const file of names.filter((f) => f.endsWith('.md'))) {
      texts.set(file, yield* git(['show', `${commit}:${file}`], cache))
    }
    const folder = yield* Effect.try({
      try: () => readFolder(entry.path, names, (file) => texts.get(file) ?? ''),
      catch: (e) => e as OutsideFailed,
    })
    return { commit, folder }
  })

// The entries of a folder: the direction, its standards, and their rules, each with its words.
// It throws OutsideFailed when the folder has no direction.md.
export const readFolder = (
  path: string,
  files: ReadonlyArray<string>,
  text: (file: string) => string,
): CompanyFolder => {
  const inside = (f: string) => f.slice(path.replace(/\/$/, '').length + 1)
  const main = files.find((f) => inside(f) === 'direction.md')
  if (!main) throw new OutsideFailed({ system: 'fetch', message: `${path} has no direction.md`, next: null })
  const says = text(main)
  const name = says.match(/^#\s+(.+?)\s*$/m)?.[1] ?? (path.split('/').at(-1) as string)
  const standards = files
    .filter((f) => /^[^/]+\/standard\.md$/.test(inside(f)))
    .sort()
    .map((f) => {
      const id = inside(f).split('/')[0] as string
      const rules = files
        .filter((r) => inside(r).startsWith(`${id}/`) && /\.md$/.test(r) && !r.endsWith('/standard.md'))
        .sort()
        .map((r) => ({
          id: (inside(r).split('/')[1] as string).replace(/\.md$/, ''),
          says: text(r).trimEnd(),
        }))
      return { id, says: text(f).trimEnd(), rules }
    })
  return { name, says: says.trimEnd(), standards } as CompanyFolder
}
