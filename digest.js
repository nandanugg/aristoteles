// The digest and the size of a reported output: a file, a section of a file, or a git
// commit. A review, a ratify, and every view compare the digest of now with the reported one.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { sha } from './config.js'

const refuse = (message, next) => Object.assign(new Error(message), { next })

// An output never runs as code and never leaves the project.
const SAFE = /^[A-Za-z0-9._/#@-]+$/
export function checkOutput(cwd, output) {
  if (!SAFE.test(output)) throw refuse(`the output "${output}" has characters outside A-Z a-z 0-9 . _ / # @ -`)
  const file = output.split(/[#@]/)[0]
  if (isAbsolute(file) || relative(resolve(cwd), resolve(cwd, file)).startsWith('..')) {
    throw refuse(`${file} is outside the project; the output is a path inside it`)
  }
}

export const slug = (heading) => heading.toLowerCase().trim().replace(/[^a-z0-9 -]/g, '').replace(/ +/g, '-')

export function digestOf(cwd, output) {
  checkOutput(cwd, output)
  // A commit: its digest is its tree, so a new commit with the same files is the same work.
  // commit is the full sha, for the git commands that need the commit itself.
  if (/^[^#]+@[0-9a-f]{7,40}$/.test(output)) {
    const [repo, ref] = output.split('@')
    const read = (what) => Bun.spawnSync(['git', '-C', join(cwd, repo), 'rev-parse', '--verify', `${ref}^{${what}}`])
    const [commit, tree] = [read('commit'), read('tree')]
    if (commit.exitCode !== 0 || tree.exitCode !== 0) throw refuse(`${ref} is not a commit in ${repo}`)
    return { digest: tree.stdout.toString().trim(), size: undefined, file: repo, commit: commit.stdout.toString().trim() }
  }
  const [file, region] = output.split('#')
  const path = join(cwd, file)
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw refuse(`${file} does not exist; the output is a file, <file>#<heading id>, or <repo>@<commit>`)
  }
  const text = readFileSync(path, 'utf8')
  if (!region) return { digest: sha(text), size: text.split('\n').length, file, region }
  const found = regionsOf(text).filter((r) => r.slug === region)
  if (found.length === 0) {
    throw refuse(`${file} has no heading "${region}"; the region is the heading in lower case, with dashes`)
  }
  if (found.length > 1) throw refuse(`${file} has the heading "${region}" ${found.length} times; make each heading unique`)
  return { digest: sha(found[0].text), size: found[0].end - found[0].start, file, region }
}

// The regions of a markdown text: each heading, from its line to the next heading of the
// same or a higher level. A region holds the regions of its sub-headings.
export function regionsOf(text) {
  const lines = text.split('\n')
  const heads = lines.flatMap((l, i) =>
    /^#+ /.test(l) ? [{ slug: slug(l.replace(/^#+ /, '')), level: l.match(/^#+/)[0].length, start: i }] : [])
  return heads.map((h) => {
    const end = heads.find((x) => x.start > h.start && x.level <= h.level)?.start ?? lines.length
    return { slug: h.slug, start: h.start, end, text: lines.slice(h.start, end).join('\n') }
  })
}

// The slugs of the regions inside an output: every region of a whole file, or the
// sub-headings of a region.
export function regionsInside(cwd, output) {
  const [file, region] = output.split('#')
  const path = join(cwd, file)
  if (!existsSync(path) || !statSync(path).isFile()) return []
  const all = regionsOf(readFileSync(path, 'utf8'))
  const own = all.find((r) => r.slug === region)
  if (!region) return all.map((r) => r.slug)
  return own ? all.filter((r) => r.start > own.start && r.start < own.end).map((r) => r.slug) : []
}

// How a file looked: its digest, and the digest of each region. A report equal to the same
// output in this snapshot is untouched work. Not a file (a repo, a folder): undefined.
export function snapshotOf(cwd, file) {
  const path = join(cwd, file)
  if (!existsSync(path) || !statSync(path).isFile()) return undefined
  const text = readFileSync(path, 'utf8')
  return { digest: sha(text), regions: Object.fromEntries(regionsOf(text).map((r) => [r.slug, sha(r.text)])) }
}

// The digest of a result now, or undefined when the output is gone.
export function digestNow(cwd, result) {
  try {
    return digestOf(cwd, result.output).digest
  } catch {
    return undefined
  }
}
export const changedSince = (cwd, result) => Boolean(result.digest) && digestNow(cwd, result) !== result.digest

// Two revisions of one source are the same when git resolves them to one commit (a short
// and a full sha of the same commit are the same); with no repo, one is a prefix of the other.
export function sameRevision(cwd, path, a, b) {
  if (a === b) return true
  if (path) {
    const resolve = (rev) => {
      const run = Bun.spawnSync(['git', '-C', join(cwd, path), 'rev-parse', '--verify', `${rev}^{commit}`])
      return run.exitCode === 0 ? run.stdout.toString().trim() : undefined
    }
    const [x, y] = [resolve(a), resolve(b)]
    if (x && y) return x === y
  }
  return String(a).startsWith(String(b)) || String(b).startsWith(String(a))
}
