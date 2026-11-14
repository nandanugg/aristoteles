// The sections of a markdown file (by their heading slugs), the check that an output names a safe
// path inside the dir, and the snapshots of a first brief. The digest of an output now, and
// whether a result changed, are the rule of an output (core/services/outputs.ts).
import { isAbsolute, join, relative, resolve } from 'node:path'
import { Effect } from 'effect'
import { type Refused, refuse } from '../domain/errors.ts'
import type { Snapshot } from '../domain/files.ts'
import { sha } from '../config/core.ts'
import { Files } from '../services/outside.ts'

export interface FileSection {
  readonly slug: string
  readonly start: number
  readonly end: number
  readonly text: string
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
