// The digest of an output: a file, a section of a markdown file (by its heading slug), or a commit
// of a repo; and the snapshots of a first brief. A review, a confirm and every view compare the
// digest of now with the reported one.
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Effect } from 'effect'
import { type Refused, refuse } from '../domain/errors.ts'
import type { Snapshot } from '../domain/files.ts'
import type { Result } from '../domain/model.ts'
import { sha } from '../config/core.ts'
import { Files, Spawn } from '../services/outside.ts'

export interface FileSection {
  readonly slug: string
  readonly start: number
  readonly end: number
  readonly text: string
}

// What digestOf finds (the old words): file and section or commit say which kind of output it is.
export interface Digested {
  readonly digest: string
  readonly size?: number
  readonly file: string
  readonly section?: string
  // The full sha of the commit, for the git commands that need the commit itself.
  readonly commit?: string
  // Not set here: the CLI computes the patch id of a commit when it records a result.
  readonly patch?: string
}

export const slug = (heading: string): string =>
  heading
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ +/g, '-')

// The sections of a markdown text: each heading, from its line to the next heading of the same or
// a higher level. A section holds the sections of its sub-headings.
export const sectionsOf = (text: string): ReadonlyArray<FileSection> => {
  const lines = text.split('\n')
  const heads = lines.flatMap((l, i) =>
    /^#+ /.test(l)
      ? [{ slug: slug(l.replace(/^#+ /, '')), level: (l.match(/^#+/) as RegExpMatchArray)[0].length, start: i }]
      : [],
  )
  return heads.map((h) => {
    const end = heads.find((x) => x.start > h.start && x.level <= h.level)?.start ?? lines.length
    return { slug: h.slug, start: h.start, end, text: lines.slice(h.start, end).join('\n') }
  })
}

// An output never runs as code and never leaves the project.
const SAFE = /^[A-Za-z0-9._/#@-]+$/
const checkOutputOf = (cwd: string, output: string): Refused | null => {
  if (!SAFE.test(output)) {
    return refuse(`the output "${output}" has characters outside A-Z a-z 0-9 . _ / # @ -`)
  }
  const file = output.split(/[#@]/)[0] as string
  if (isAbsolute(file) || relative(resolve(cwd), resolve(cwd, file)).startsWith('..')) {
    return refuse(`${file} is outside the dir; the output is a path inside it`)
  }
  return null
}

// checkOutput(cwd, output): the output names a safe path inside the dir.
export const checkOutput = (cwd: string, output: string): Effect.Effect<void, Refused, Files> =>
  Effect.suspend(() => {
    const problem = checkOutputOf(cwd, output)
    return problem ? Effect.fail(problem) : Effect.void
  })

// digestOf(cwd, output): the digest of the output now.
export const digestOf = (
  cwd: string,
  output: string,
): Effect.Effect<Digested, Refused, Files | Spawn> =>
  Effect.gen(function* () {
    yield* checkOutput(cwd, output)
    // A commit: its digest is its tree, so a new commit with the same files is the same work.
    if (/^[^#]+@[0-9a-f]{7,40}$/.test(output)) {
      const [repo, ref] = output.split('@') as [string, string]
      const spawn = yield* Spawn
      const read = (what: string) =>
        spawn.run(['git', '-C', join(cwd, repo), 'rev-parse', '--verify', `${ref}^{${what}}`])
      const commit = yield* read('commit')
      const tree = yield* read('tree')
      if (commit.code !== 0 || tree.code !== 0) {
        return yield* refuse(`${ref} is not a commit in ${repo}`)
      }
      return { digest: tree.out.trim(), file: repo, commit: commit.out.trim() }
    }
    const [file, section] = output.split('#') as [string, string | undefined]
    const files = yield* Files
    const text = yield* files.read(join(cwd, file))
    if (text === null) {
      return yield* refuse(
        `${file} does not exist; the output is a file, <file>#<heading id>, or <repo>@<commit>`,
      )
    }
    if (!section) return { digest: sha(text), size: text.split('\n').length, file }
    const found = sectionsOf(text).filter((r) => r.slug === section)
    if (found.length === 0) {
      return yield* refuse(
        `${file} has no heading "${section}"; the section is the heading in lower case, with dashes`,
      )
    }
    const first = found[0] as FileSection
    if (found.length > 1) {
      return yield* refuse(`${file} has the heading "${section}" ${found.length} times; make each heading unique`)
    }
    return { digest: sha(first.text), size: first.end - first.start, file, section }
  })

// The slugs of the sections inside an output: every section of a whole file, or the sub-headings
// of a section.
export const sectionsInside = (
  cwd: string,
  output: string,
): Effect.Effect<ReadonlyArray<string>, never, Files> =>
  Effect.gen(function* () {
    const [file, section] = output.split('#') as [string, string | undefined]
    const text = yield* (yield* Files).read(join(cwd, file))
    if (text === null) return []
    const all = sectionsOf(text)
    const own = all.find((r) => r.slug === section)
    if (!section) return all.map((r) => r.slug)
    return own ? all.filter((r) => r.start > own.start && r.start < own.end).map((r) => r.slug) : []
  })

// How a file looked: its digest, and the digest of each section. A report equal to the same output
// in this snapshot is untouched work. Not a file (a repo, a folder): undefined.
export const snapshotOf = (
  cwd: string,
  file: string,
): Effect.Effect<Snapshot | undefined, never, Files> =>
  Effect.gen(function* () {
    const text = yield* (yield* Files).read(join(cwd, file))
    if (text === null) return undefined
    return {
      digest: sha(text),
      sections: Object.fromEntries(sectionsOf(text).map((r) => [r.slug, sha(r.text)])),
    }
  })

// changedSince(cwd, result): its work now differs from its report. A gone output has no digest
// now, so it counts as changed.
export const changedSince = (
  cwd: string,
  result: Result,
): Effect.Effect<boolean, never, Files | Spawn> =>
  Effect.gen(function* () {
    const now = yield* digestOf(cwd, result.output).pipe(
      Effect.map((d) => d.digest),
      Effect.catch(() => Effect.succeed(undefined)),
    )
    return now !== result.work.digest
  })

// Two revisions of one source are the same when git resolves them to one commit (a short and a
// full sha of the same commit are the same); with no repo, one is a prefix of the other.
export const sameRevision = (
  cwd: string,
  path: string,
  a: string,
  b: string,
): Effect.Effect<boolean, never, Spawn> =>
  Effect.gen(function* () {
    if (a === b) return true
    if (path) {
      const spawn = yield* Spawn
      const resolveRev = (rev: string) =>
        spawn.run(['git', '-C', join(cwd, path), 'rev-parse', '--verify', `${rev}^{commit}`]).pipe(
          Effect.map((run) => (run.code === 0 ? run.out.trim() : undefined)),
        )
      const x = yield* resolveRev(a)
      const y = yield* resolveRev(b)
      if (x && y) return x === y
    }
    return String(a).startsWith(String(b)) || String(b).startsWith(String(a))
  })
