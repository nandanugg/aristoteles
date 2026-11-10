// Company directions (Nanda, 2026-11-10): a company direction lives in a git repo (GitHub) and
// changes there, with a pull request and its review. A project names each one that it follows in
// aristoteles.lock, beside work.yaml:
//
//   feature-flags:
//     repo: <a git url, or a path>     the person writes these four
//     path: <the folder of the direction in the repo>
//     tag: <optional; the newest commit of the default branch with none>
//     owner: <a person of work.yaml; the owner accepts each new commit>
//     checkedBy: <optional; the role that checks its rules>
//     rules: { <rule id>: <role> }      optional; a role for one rule
//     commit: <hash>                   work writes these three: the accepted commit,
//     newest: <hash>                   the newest commit that changed the folder,
//     refreshed: 2026-11-10            and the date of the last refresh
//
// The folder holds one file for each entry, each in any markdown:
//   direction.md                      the direction (its first "# " line is its name)
//   <standard id>/standard.md         a standard
//   <standard id>/<rule id>.md        a rule of that standard

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dbPath } from './store.js'

export const LOCK = 'aristoteles.lock'
const WRITTEN = ['commit', 'newest', 'refreshed']

export function readLock(dir) {
  const path = join(dir, LOCK)
  if (!existsSync(path)) return undefined
  const lock = Bun.YAML.parse(readFileSync(path, 'utf8')) ?? {}
  for (const [id, e] of Object.entries(lock)) {
    for (const key of ['repo', 'path', 'owner']) {
      if (typeof e?.[key] !== 'string' || !e[key].trim()) throw new Error(`${LOCK} ${id}: ${key} is required`)
    }
  }
  return lock
}
export function writeLock(dir, lock) {
  const order = (e) => Object.fromEntries([...Object.entries(e).filter(([k]) => !WRITTEN.includes(k)),
    ...WRITTEN.filter((k) => e[k] !== undefined).map((k) => [k, e[k]])])
  writeFileSync(join(dir, LOCK), Bun.YAML.stringify(Object.fromEntries(Object.entries(lock).map(([id, e]) => [id, order(e)])), null, 2))
}

// The date of a time on this machine (a refresh is due when the last one was on an earlier date).
export const localDate = (iso) => new Date(iso).toLocaleDateString('en-CA')

const git = (args, cwd) => {
  const run = Bun.spawnSync(['git', ...args], { cwd, stderr: 'pipe' })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString().trim() || `git ${args.join(' ')} failed`)
  return run.stdout.toString()
}
// The copy of a repo on this machine: ~/.aristoteles/sources/<repo, as a folder name>.
const cacheOf = (env, repo) => join(env.ARISTOTELES_SOURCES ?? join(dirname(dbPath(env)), 'sources'),
  repo.replace(/^[a-z]+:\/\//, '').replace(/[^A-Za-z0-9._-]+/g, '_'))

// Fetches the repo, and reads the folder at the newest commit that changed it. Throws when the
// fetch fails; the caller keeps the accepted commit.
export function fetchFolder(env, entry) {
  const cache = cacheOf(env, entry.repo)
  if (!existsSync(cache)) {
    mkdirSync(dirname(cache), { recursive: true })
    git(['clone', '--quiet', '--bare', entry.repo, cache])
  } else {
    git(['fetch', '--quiet', '--prune', '--tags', 'origin', '+refs/heads/*:refs/heads/*'], cache)
  }
  const target = entry.tag ? `${entry.tag}^{commit}` : 'HEAD'
  const tip = git(['rev-parse', '--verify', target], cache).trim()
  const commit = git(['log', '-1', '--format=%H', tip, '--', entry.path], cache).trim()
  if (!commit) throw new Error(`${entry.repo} has no folder ${entry.path} at ${entry.tag ?? 'its default branch'}`)
  const files = git(['ls-tree', '-r', '--name-only', commit, '--', entry.path], cache).split('\n').filter(Boolean)
  const text = (file) => git(['show', `${commit}:${file}`], cache)
  return { commit, folder: readFolder(entry.path, files, text) }
}

// The entries of a folder: the direction, its standards, and their rules, each with its words.
export function readFolder(path, files, text) {
  const inside = (f) => f.slice(path.replace(/\/$/, '').length + 1)
  const main = files.find((f) => inside(f) === 'direction.md')
  if (!main) throw new Error(`${path} has no direction.md`)
  const says = text(main)
  const name = says.match(/^#\s+(.+?)\s*$/m)?.[1] ?? path.split('/').at(-1)
  const standards = files.filter((f) => /^[^/]+\/standard\.md$/.test(inside(f))).sort().map((f) => {
    const id = inside(f).split('/')[0]
    const rules = files.filter((r) => inside(r).startsWith(`${id}/`) && /\.md$/.test(r) && !r.endsWith('/standard.md')).sort()
      .map((r) => ({ id: inside(r).split('/')[1].replace(/\.md$/, ''), says: text(r).trimEnd() }))
    return { id, says: text(f).trimEnd(), rules }
  })
  return { name, says: says.trimEnd(), standards }
}
