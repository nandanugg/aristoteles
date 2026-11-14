// The rule of an output (S14): has the output of a result changed since its report, is a source
// that it recorded stale, is its commit on its base. Two readers use it: the readings of a Work
// (adapters/live/readings.ts) and the report of a new output (core/actions/report.ts). It gives
// what the old engine's digest of an output gave, and what `git merge-base --is-ancestor` gives,
// on each result (outputs.test.ts pins both).
//
// git runs once per repo, not once per result (B1, ruling 10.14): one `git cat-file
// --batch-check` resolves every commit and tree that a read needs, and one `git rev-list` per
// base names the commits that the base does not hold; a file is read and parsed once per read.
import { join } from 'node:path'
import { Effect } from 'effect'
import { sha } from '../../src/config/core.ts'
import { checkOutput, type FileSection, sectionsOf } from '../../src/files/digest.ts'
import { Files, Spawn } from '../../src/services/outside.ts'
import { type Refused, refuse, type Result, type ResultId, type Work } from '../schema/index.ts'
import type { Outside, StaleSource } from '../schema/outside.ts'
import { pathOf } from './paths.ts'

// The digest of an output now; a file output has its size in lines, a commit output the full sha
// of its commit (the git commands of a report need the commit itself).
export interface Digest {
  readonly digest: string
  readonly size?: number
  readonly commit?: string
}

// A commit output, as told from a file output; and a commit of an output.
const COMMIT_OUTPUT = /^[^#]+@[0-9a-f]{7,40}$/
const HEX = /^[0-9a-f]{7,40}$/

// What a safe output names: a commit of a repo, or a file or one section of it.
type Named =
  | { readonly _tag: 'Commit'; readonly repo: string; readonly ref: string }
  | { readonly _tag: 'File'; readonly file: string; readonly section: string | undefined }

// An output never runs as code and never leaves the dir: checkOutput refuses an unsafe one.
const namedOf = (cwd: string, output: string): Effect.Effect<Named, Refused, Files> =>
  Effect.gen(function* () {
    yield* checkOutput(cwd, output)
    if (COMMIT_OUTPUT.test(output)) {
      const [repo = '', ref = ''] = output.split('@')
      return { _tag: 'Commit', repo, ref } as const
    }
    const [file = '', section] = output.split('#')
    return { _tag: 'File', file, section } as const
  })

// A name (`<rev>^{commit}`, `<rev>^{tree}`) that a read asks git in a repo folder.
interface GitName {
  readonly repo: string
  readonly name: string
}

// The digest of a commit output is its tree, and its commit is the full sha; a file asks none.
const digestNames = (named: Named): ReadonlyArray<GitName> =>
  named._tag === 'Commit'
    ? [
        { repo: named.repo, name: `${named.ref}^{commit}` },
        { repo: named.repo, name: `${named.ref}^{tree}` },
      ]
    : []

// The object of each name in one repo, as `git rev-parse --verify <name>` gives it; a name that
// does not resolve, and every name of a folder that git cannot read, has none.
const resolveIn = (
  dir: string,
  names: ReadonlySet<string>,
): Effect.Effect<ReadonlyMap<string, string>, never, Spawn> =>
  Effect.gen(function* () {
    const found = new Map<string, string>()
    // One name per line: a name with a space or a line break resolves to nothing.
    const asked = [...names].filter((n) => /^\S+$/.test(n))
    if (asked.length === 0) return found
    const run = yield* (yield* Spawn).run(
      [pathOf('git'), '-C', dir, 'cat-file', '--batch-check=%(objectname)'],
      { stdin: `${asked.join('\n')}\n` },
    )
    if (run.code !== 0) return found
    // A line for each name in order: its object, or "<name> missing" (or "ambiguous").
    const lines = run.out.split('\n')
    asked.forEach((name, i) => {
      const line = lines[i] ?? ''
      if (/^[0-9a-f]{40,64}$/.test(line)) found.set(name, line)
    })
    return found
  })

type Resolved = (repo: string, name: string) => string | undefined

// git and the files of the dir at one time: the names resolve in one `git cat-file` per repo
// folder, and each file is read and parsed once. A reading serves one call only, so a report
// sees the files as they are when it runs.
interface Reading {
  readonly resolved: Resolved
  readonly text: (file: string) => Effect.Effect<string | null, never, Files>
  readonly sections: (file: string, text: string) => ReadonlyArray<FileSection>
}

const readingOf = (
  cwd: string,
  names: ReadonlyArray<GitName>,
): Effect.Effect<Reading, never, Spawn> =>
  Effect.gen(function* () {
    const byDir = new Map<string, Set<string>>()
    for (const { repo, name } of names) {
      const dir = join(cwd, repo)
      byDir.set(dir, (byDir.get(dir) ?? new Set<string>()).add(name))
    }
    const oids = new Map<string, ReadonlyMap<string, string>>()
    for (const [dir, set] of byDir) oids.set(dir, yield* resolveIn(dir, set))
    // On a store of 2,000 events, 178 results named one file.
    const texts = new Map<string, string | null>()
    const parsed = new Map<string, ReadonlyArray<FileSection>>()
    return {
      resolved: (repo, name) => oids.get(join(cwd, repo))?.get(name),
      text: (file) =>
        Effect.gen(function* () {
          if (!texts.has(file)) texts.set(file, yield* (yield* Files).read(join(cwd, file)))
          return texts.get(file) ?? null
        }),
      sections: (file, text) => {
        const found = parsed.get(file) ?? sectionsOf(text)
        parsed.set(file, found)
        return found
      },
    }
  })

// The digest of an output now: the tree of a commit, so a new commit with the same files is the
// same work; the sha of a whole file, or of its one section with that heading.
const digestIn = (reading: Reading, named: Named): Effect.Effect<Digest, Refused, Files> =>
  Effect.gen(function* () {
    if (named._tag === 'Commit') {
      const { repo, ref } = named
      const commit = reading.resolved(repo, `${ref}^{commit}`)
      const tree = reading.resolved(repo, `${ref}^{tree}`)
      if (commit === undefined || tree === undefined) {
        return yield* refuse(`${ref} is not a commit in ${repo}`)
      }
      return { digest: tree, commit }
    }
    const { file, section } = named
    const text = yield* reading.text(file)
    if (text === null) {
      return yield* refuse(
        `${file} does not exist; the output is a file, <file>#<heading id>, or <repo>@<commit>`,
      )
    }
    if (!section) return { digest: sha(text), size: text.split('\n').length }
    const found = reading.sections(file, text).filter((r) => r.slug === section)
    const first = found[0]
    if (first === undefined) {
      return yield* refuse(
        `${file} has no heading "${section}"; ` +
          'the section is the heading in lower case, with dashes',
      )
    }
    if (found.length > 1) {
      return yield* refuse(
        `${file} has the heading "${section}" ${found.length} times; make each heading unique`,
      )
    }
    return { digest: sha(first.text), size: first.end - first.start }
  })

// The work of a result changed since its report: its digest now is another. An output with no
// digest now (unsafe, gone, a commit that git does not know) counts as changed.
const changedFrom = (result: Result, now: Digest | undefined): boolean =>
  now?.digest !== result.work.digest

// digestNow(cwd, output): the digest of one output now, or the words of why it has none.
// report.ts reads a new output with it.
export const digestNow = (
  cwd: string,
  output: string,
): Effect.Effect<Digest, Refused, Files | Spawn> =>
  Effect.gen(function* () {
    const named = yield* namedOf(cwd, output)
    const reading = yield* readingOf(cwd, digestNames(named))
    return yield* digestIn(reading, named)
  })

// outputChanged(cwd, result): the work of one result changed since its report.
export const outputChanged = (
  cwd: string,
  result: Result,
): Effect.Effect<boolean, never, Files | Spawn> =>
  digestNow(cwd, result.output).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
    Effect.map((now) => changedFrom(result, now)),
  )

// A commit of a repo, and the base of its workspace.
interface CommitOnBase {
  readonly repo: string
  readonly commit: string
  readonly base: string
}

// The name that resolves the commit of a question on its base.
const commitName = (b: CommitOnBase): GitName => ({ repo: b.repo, name: `${b.commit}^{commit}` })

// The questions whose commit is on its base: per repo and base, `git rev-list` lists the commits
// that the base does not hold; a commit that does not resolve, or a base that does not, is on no
// base (merge-base --is-ancestor fails for it).
const onBaseOf = (
  asks: ReadonlyArray<CommitOnBase>,
  cwd: string,
  resolved: Resolved,
): Effect.Effect<ReadonlySet<CommitOnBase>, never, Spawn> =>
  Effect.gen(function* () {
    const groups = new Map<string, Array<{ readonly ask: CommitOnBase; readonly oid: string }>>()
    for (const b of asks) {
      const { repo, name } = commitName(b)
      const oid = resolved(repo, name)
      if (oid === undefined || !/^\S+$/.test(b.base)) continue
      const key = JSON.stringify([b.repo, b.base])
      groups.set(key, [...(groups.get(key) ?? []), { ask: b, oid }])
    }
    const found = new Set<CommitOnBase>()
    for (const [key, group] of groups) {
      const [repo, base] = JSON.parse(key) as [string, string]
      const lines = [...new Set(group.map((g) => g.oid)), `^${base}`]
      const run = yield* (yield* Spawn).run(
        [pathOf('git'), '-C', join(cwd, repo), 'rev-list', '--stdin'],
        { stdin: `${lines.join('\n')}\n` },
      )
      if (run.code !== 0) continue
      const off = new Set(run.out.split('\n'))
      for (const g of group) if (!off.has(g.oid)) found.add(g.ask)
    }
    return found
  })

// commitOnBase(cwd, repo, commit, base): the commit is on the base (`git merge-base
// --is-ancestor`). report.ts refuses a new commit that is on its base already.
export const commitOnBase = (
  cwd: string,
  repo: string,
  commit: string,
  base: string,
): Effect.Effect<boolean, never, Spawn> =>
  Effect.gen(function* () {
    const ask = { repo, commit, base }
    const reading = yield* readingOf(cwd, [commitName(ask)])
    return (yield* onBaseOf([ask], cwd, reading.resolved)).has(ask)
  })

// --- every result of a Work at one time (the readings) -------------------------------------------

// What one read asks, from the Work alone: the outputs (their work changed?), the repo results
// (on their base?) and the sources that moved (the same revision?).
interface OnBase extends CommitOnBase {
  readonly result: ResultId
}
interface SourceMove {
  readonly path: string
  readonly stale: StaleSource
}
interface Asks {
  // Only the safe outputs: an unsafe one has no digest now, so it changed.
  readonly outputs: ReadonlyMap<ResultId, Named>
  readonly onBase: ReadonlyArray<OnBase>
  // The recorded sources of each result, in order: the first that moved makes it stale.
  readonly moves: ReadonlyMap<ResultId, ReadonlyArray<SourceMove>>
}

const asksOf = (work: Work, cwd: string): Effect.Effect<Asks, never, Files> =>
  Effect.gen(function* () {
    const outputs = new Map<ResultId, Named>()
    const onBase: Array<OnBase> = []
    const moves = new Map<ResultId, Array<SourceMove>>()
    for (const r of work.results.values()) {
      const task = work.tasks.get(r.task)
      const named = yield* namedOf(cwd, r.output).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      if (named !== undefined) outputs.set(r.id, named)
      const [repo = '', commit = ''] = r.output.split('@')
      const space = task?.descriptionAi.workspace.find((x) => x.path === repo)
      if (space?._tag === 'Repo' && HEX.test(commit)) {
        onBase.push({ result: r.id, repo, commit, base: space.base })
      }
      const list: Array<SourceMove> = []
      for (const m of r.madeFrom) {
        if (m._tag === 'Result') continue
        const seen = work.sources.get(m.name)
        const was = m._tag === 'Git' ? m.commit : m.revision
        if (seen === undefined || was === '') continue
        const now = seen._tag === 'Git' ? seen.commit : seen.revision
        const path = task?.descriptionAi.workspace.find((w) => w.source === m.name)?.path ?? ''
        list.push({ path, stale: { source: m.name, was, now } })
      }
      moves.set(r.id, list)
    }
    return { outputs, onBase, moves }
  })

// Every name that one read asks git: the digest of each commit output, the commit of each repo
// result, and both revisions of each source that moved in a repo.
const namesOf = (asks: Asks): ReadonlyArray<GitName> => [
  ...[...asks.outputs.values()].flatMap(digestNames),
  ...asks.onBase.map(commitName),
  ...[...asks.moves.values()].flat().flatMap(({ path, stale }) =>
    stale.was !== stale.now && path
      ? [
          { repo: path, name: `${stale.was}^{commit}` },
          { repo: path, name: `${stale.now}^{commit}` },
        ]
      : [],
  ),
]

// Two revisions of one source are the same when git resolves them to one commit; with no repo,
// or a revision that git does not know, one is a prefix of the other.
const sameRevision = (m: SourceMove, resolved: Resolved): boolean => {
  const { was, now } = m.stale
  if (was === now) return true
  if (m.path) {
    const x = resolved(m.path, `${was}^{commit}`)
    const y = resolved(m.path, `${now}^{commit}`)
    if (x && y) return x === y
  }
  return was.startsWith(now) || now.startsWith(was)
}

// outputsOf(work, cwd): the rule on every result of the work, in the order of the results: the
// changed results, the stale sources, and the repo results whose commit is on its base.
export const outputsOf = (
  work: Work,
  cwd: string,
): Effect.Effect<Pick<Outside, 'changed' | 'stale' | 'onBase'>, never, Files | Spawn> =>
  Effect.gen(function* () {
    const asks = yield* asksOf(work, cwd)
    const reading = yield* readingOf(cwd, namesOf(asks))
    const changed = new Set<ResultId>()
    const stale = new Map<ResultId, StaleSource>()
    for (const result of work.results.values()) {
      const named = asks.outputs.get(result.id)
      const now =
        named === undefined
          ? undefined
          : yield* digestIn(reading, named).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (changedFrom(result, now)) changed.add(result.id)
      const moved = asks.moves.get(result.id)?.find((m) => !sameRevision(m, reading.resolved))
      if (moved) stale.set(result.id, moved.stale)
    }
    const found = yield* onBaseOf(asks.onBase, cwd, reading.resolved)
    // In the order of the results, as one merge-base per result found them.
    const onBase = new Set(asks.onBase.filter((b) => found.has(b)).map((b) => b.result))
    return { changed, stale, onBase }
  })
