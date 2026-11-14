// One rule, one reader (S14): report.ts reads the digest of a new output with digestNow, a
// covered result with outputChanged, and a new commit on its base with commitOnBase, on the code
// of the readings. On each case they give what the old digestOf and changedSince gave (pinned at
// the switch, 2026-11-14): the digest, the size and the commit, or the words of the refusal; and
// what `git merge-base --is-ancestor` gives.
import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Effect, Layer } from 'effect'
import type { Refused, Result } from '../schema/index.ts'
import {
  commitOnBase,
  digestNow,
  Files,
  FilesLive,
  outputChanged,
  Spawn,
  SpawnLive,
} from './index.ts'
import type { Digest } from './outputs.ts'

const live = Layer.mergeAll(FilesLive, SpawnLive)
const run = <A>(e: Effect.Effect<A, never, Files | Spawn>): Promise<A> =>
  Effect.runPromise(e.pipe(Effect.provide(live)))

// The digest, the size and the commit of an output, or the words of its refusal.
interface Outcome {
  readonly digest?: string
  readonly size?: number
  readonly commit?: string
  readonly refused?: string
}
const outcomeOf = (e: Effect.Effect<Digest, Refused, Files | Spawn>): Promise<Outcome> =>
  run(
    e.pipe(
      Effect.map(({ digest, size, commit }): Outcome => ({ digest, size, commit })),
      Effect.catch((r) => Effect.succeed<Outcome>({ refused: r.message })),
    ),
  )

const git = (dir: string, ...args: ReadonlyArray<string>): string => {
  const argv = ['git', '-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]
  return Bun.spawnSync(argv, { env: process.env }).stdout.toString().trim()
}

const MD = '# Title\n\nintro\n\n## Part One\n\none\n\n### Deep\n\ndeep\n\n## Part Two\n\ntwo\n' +
  '\n## Part One\n\nagain\n'

test('the digest of a new output is the one of the old digestOf', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outputs-'))
  const files = {
    'a.md': MD,
    'b.txt': 'one\ntwo\n',
    'empty.md': '',
    'repo/f.txt': 'hello\n',
    'sub/c.md': '# C\nx',
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  mkdirSync(join(dir, 'folder'))
  const repo = join(dir, 'repo')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'one')
  const full = git(repo, 'rev-parse', 'HEAD')
  // The tree of the one commit of repo (its files only, so the same in every run).
  const tree = 'b4ed918248039b78f24383523fa4e51f80994fac'
  const missing = 'does not exist; the output is a file, <file>#<heading id>, or <repo>@<commit>'
  // name, output, then what the old digestOf gave
  const cases: ReadonlyArray<readonly [string, string, Outcome]> = [
    [
      'a whole file with sections',
      'a.md',
      { digest: 'cae1f8e038849b2da6608d95702fb7b2ef31744e7a81881fbbdc71adb6862e51', size: 20 },
    ],
    [
      'a whole file',
      'b.txt',
      { digest: 'c3f9c8c283a2b1f2f1896f27a01cbe3cddc0c9d93f752e4639035a0f5b36f6e8', size: 3 },
    ],
    [
      'an empty file',
      'empty.md',
      { digest: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', size: 1 },
    ],
    [
      'a section',
      'a.md#part-two',
      { digest: '5117144b77784f1249748a0c700d0b74ed10a51169b1df51587e3221449e57db', size: 4 },
    ],
    [
      'a section that holds the others',
      'a.md#title',
      { digest: 'cae1f8e038849b2da6608d95702fb7b2ef31744e7a81881fbbdc71adb6862e51', size: 20 },
    ],
    [
      'a sub-section',
      'a.md#deep',
      { digest: 'd964073869b6ca16c0c93efb0cb4c6f985850271e4b4a273081014980a4d2d28', size: 4 },
    ],
    [
      'a heading twice',
      'a.md#part-one',
      { refused: 'a.md has the heading "part-one" 2 times; make each heading unique' },
    ],
    [
      'a heading that is not there',
      'a.md#nothing',
      {
        refused:
          'a.md has no heading "nothing"; the section is the heading in lower case, with dashes',
      },
    ],
    ['a file that is not there', 'missing.md', { refused: `missing.md ${missing}` }],
    ['a folder', 'folder', { refused: `folder ${missing}` }],
    [
      'a file in a folder',
      'sub/c.md',
      { digest: '7e53ca6fe1ea0b0710ed5fe163b6a7af5a4495a0963c6a711404e71032e21543', size: 2 },
    ],
    [
      'the one section of a file',
      'sub/c.md#c',
      { digest: '7e53ca6fe1ea0b0710ed5fe163b6a7af5a4495a0963c6a711404e71032e21543', size: 2 },
    ],
    ['a commit by its full sha', `repo@${full}`, { digest: tree, commit: full }],
    ['a commit by a short sha', `repo@${full.slice(0, 7)}`, { digest: tree, commit: full }],
    [
      'a commit that git does not know',
      'repo@abcdef0',
      { refused: 'abcdef0 is not a commit in repo' },
    ],
    [
      'a commit of a folder that is not there',
      'ghost@abcdef0',
      { refused: 'abcdef0 is not a commit in ghost' },
    ],
    [
      'an output outside the dir',
      '../x.md',
      { refused: '../x.md is outside the dir; the output is a path inside it' },
    ],
    [
      'an absolute path',
      '/etc/passwd',
      { refused: '/etc/passwd is outside the dir; the output is a path inside it' },
    ],
    [
      'an unsafe output',
      'bad;name',
      { refused: 'the output "bad;name" has characters outside A-Z a-z 0-9 . _ / # @ -' },
    ],
  ]
  for (const [name, output, old] of cases) {
    const now = await outcomeOf(digestNow(dir, output))
    expect({ name, ...now }).toEqual({ name, ...old })
    // A covered result of that output: reported with this digest, and with another one. The
    // old changedSince said changed for another digest, and for an output that it refused.
    for (const digest of [old.digest ?? 'none', 'other']) {
      const result = { output, work: { _tag: 'File', digest, size: 1 } } as unknown as Result
      const changed = old.refused !== undefined || digest === 'other'
      expect({ name, digest, changed: await run(outputChanged(dir, result)) }).toEqual({
        name,
        digest,
        changed,
      })
    }
  }
}, 30000)

test('a commit is on its base as `git merge-base --is-ancestor` says', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outputs-'))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  writeFileSync(join(repo, 'f.txt'), 'one\n')
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'one')
  const one = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'checkout', '-q', '-b', 'side')
  writeFileSync(join(repo, 'f.txt'), 'two\n')
  git(repo, 'commit', '-q', '-am', 'two')
  const two = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'checkout', '-q', 'main')
  // name, commit, base, then: on its base?
  const cases: ReadonlyArray<readonly [string, string, string, boolean]> = [
    ['a commit on its base', one, 'side', true],
    ['a commit by a short sha on its base', one.slice(0, 7), 'side', true],
    ['a commit that is not on its base', two, 'main', false],
    ['the base itself', two, 'side', true],
    ['the base by its sha', one, one, true],
    ['a commit that git does not know', 'abcdef0', 'main', false],
    ['a base that git does not know', one, 'nobranch', false],
  ]
  for (const [name, commit, base, on] of cases) {
    const argv = ['git', '-C', repo, 'merge-base', '--is-ancestor', commit, base]
    const ancestor = Bun.spawnSync(argv, { env: process.env }).exitCode === 0
    const now = await run(commitOnBase(dir, 'repo', commit, base))
    expect({ name, on: now }).toEqual({ name, on: ancestor })
    expect({ name, on: now }).toEqual({ name, on })
  }
}, 30000)
