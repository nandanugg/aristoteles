// digest.ts and company.ts on files and git repos. A case table pins what each case gives (or the
// words of its refusal) in __snapshots__; a commit id is written as <full> or <short>.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Effect, Layer } from 'effect'
import { runNew } from '../config/outcome.ts'
import { FilesLive, SpawnLive } from '../services/outside.ts'
import * as company from './company.ts'
import * as digest from './digest.ts'

// biome-ignore lint/suspicious/noExplicitAny: loose values of a test
type Obj = any

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix))
const put = (dir: string, files: Record<string, string>) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
}
const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', '-C', cwd, ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
  })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return run.stdout.toString().trim()
}
const live = Layer.mergeAll(FilesLive, SpawnLive)
const provide = <A, E>(e: Effect.Effect<A, E, never | Obj>) =>
  Effect.runPromise(e.pipe(Effect.provide(live)) as Effect.Effect<A, E>)

const MD = '# Title\n\nintro\n\n## Part One\n\ntext one\n\n### Deep\n\ndeep text\n\n## Part Two\n\ntext two\n\n## Part One\n\nagain\n'

describe('slug and sectionsOf', () => {
  const headings = ['Hello World', '  Padded  ', 'Dots. And, Commas!', 'Under_score & More', 'a  b', 'UPPER-case', '']
  for (const h of headings) {
    test(`slug of "${h}"`, () => expect(digest.slug(h)).toMatchSnapshot())
  }
  const texts = ['', 'no heads', MD, '#nospace\n# a\n## b\n# c', '## first\n# second\n### third\n## fourth']
  for (const t of texts) {
    test(`sections of ${JSON.stringify(t.slice(0, 20))}`, () => {
      expect(digest.sectionsOf(t)).toMatchSnapshot()
    })
  }
})

describe('checkOutput', () => {
  const dir = tmp('dg-')
  const outputs = ['a.md', 'a b.md', 'sub/a.md#part-one', 'repo@abcdef1', '/abs/a.md', '../a.md', 'a/../../b.md', 'a/../b.md', '$(x)', 'a;b', '', '#x', '@x', 'a\nb']
  for (const o of outputs) {
    test(`output ${JSON.stringify(o)}`, async () => {
      expect(await runNew(digest.checkOutput(dir, o))).toMatchSnapshot()
    })
  }
})

describe('digestOf, sectionsInside, snapshotOf', () => {
  const dir = tmp('dg-')
  put(dir, { 'a.md': MD, 'b.txt': 'one\ntwo\n', 'sub/c.md': '# C\nx', 'empty.md': '' })
  mkdirSync(join(dir, 'folder'))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  put(repo, { 'f.txt': 'hello' })
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'one')
  const full = git(repo, 'rev-parse', 'HEAD')
  // A value with the commit ids of this run written as words.
  const words = (text: string) => text.replaceAll(full, '<full>').replaceAll(full.slice(0, 7), '<short>')
  const hiding = (value: unknown): unknown => JSON.parse(words(JSON.stringify(value ?? null)))
  const label = (output: string) => words(output)
  const outputs = [
    'a.md', 'b.txt', 'sub/c.md', 'empty.md', 'a.md#title', 'a.md#part-two', 'a.md#deep', 'a.md#part-one',
    'a.md#nothing', 'missing.md', 'folder', 'sub/c.md#c', `repo@${full}`, `repo@${full.slice(0, 7)}`,
    'repo@abcdef0', 'ghost@abcdef0', '../x.md', '/etc/passwd', 'bad;name',
  ]
  for (const o of outputs) {
    test(`digestOf ${label(o)}`, async () => {
      expect(hiding(await runNew(digest.digestOf(dir, o)))).toMatchSnapshot()
    })
    test(`sectionsInside ${label(o)}`, async () => {
      expect(hiding(await provide(digest.sectionsInside(dir, o)))).toMatchSnapshot()
    })
  }
  for (const f of ['a.md', 'b.txt', 'folder', 'repo', 'missing.md', 'empty.md']) {
    test(`snapshotOf ${f}`, async () => {
      expect(hiding(await provide(digest.snapshotOf(dir, f)))).toMatchSnapshot()
    })
  }
  test('the good outputs of the list digest', async () => {
    expect(await runNew(digest.digestOf(dir, 'a.md#title'))).toHaveProperty('ok')
    expect(await runNew(digest.digestOf(dir, `repo@${full}`))).toHaveProperty('ok')
  })

  describe('changedSince', () => {
    // Every result has its digest, in the work of the result.
    const resultOf = (r: Obj): Obj => ({ output: r.output, work: { _tag: 'File', digest: r.digest, size: 1 } })
    const digestOf = async (output: string): Promise<string> =>
      ((await runNew(digest.digestOf(dir, output))) as Obj).ok.digest
    const section = async () => ({ output: 'a.md#title', digest: await digestOf('a.md#title') })
    const results: Array<[string, () => Promise<Obj>, boolean]> = [
      ['the same digest', async () => ({ output: 'a.md', digest: await digestOf('a.md') }), false],
      ['another digest', async () => ({ output: 'a.md', digest: 'x' }), true],
      ['an output that is gone', async () => ({ output: 'missing.md', digest: 'x' }), true],
      ['a section', section, false],
      ['a bad output', async () => ({ output: '../x', digest: 'x' }), true],
    ]
    for (const [name, make, changed] of results) {
      test(name, async () => {
        const now = await provide(digest.changedSince(dir, resultOf(await make()) as never))
        expect(now).toBe(changed)
      })
    }
    test('a file that changes after the report', async () => {
      const d = tmp('dg-')
      put(d, { 'x.md': 'one' })
      const first = (await runNew(digest.digestOf(d, 'x.md'))) as Obj
      const was: Obj = { output: 'x.md', digest: first.ok.digest }
      const r = resultOf(was) as never
      expect(await provide(digest.changedSince(d, r))).toBe(false)
      put(d, { 'x.md': 'two' })
      expect(await provide(digest.changedSince(d, r))).toBe(true)
    })
  })

  describe('sameRevision', () => {
    put(repo, { 'g.txt': 'more' })
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'two')
    const second = git(repo, 'rev-parse', 'HEAD')
    const cases: Array<[string, string, string, string]> = [
      ['the same text', 'repo', 'abc', 'abc'],
      ['a short and a full sha', 'repo', full.slice(0, 7), full],
      ['two commits', 'repo', full, second],
      ['a prefix with no repo', '', 'abcdef1', 'abcdef123'],
      ['two others with no repo', '', 'abc', 'xyz'],
      ['a repo that is not there', 'ghost', 'abcdef1', 'abcdef123'],
      ['a ref that git cannot find', 'repo', 'abcdef1', 'abcdef123'],
      ['HEAD and a sha', 'repo', 'HEAD', second],
    ]
    for (const [name, path, a, b] of cases) {
      test(name, async () => {
        expect(await provide(digest.sameRevision(dir, path, a, b))).toMatchSnapshot()
      })
    }
  })
})

describe('the lock', () => {
  const lockCases: Array<[string, string | null]> = [
    ['no lock', null],
    ['an empty lock', ''],
    ['a good lock', 'a:\n  repo: /x\n  path: p\n  owner: N\n  checkedBy: lint\n  rules: { r1: lint }\nb:\n  repo: y\n  path: q\n  owner: M\n  commit: abc\n'],
    ['no repo', 'a:\n  path: p\n  owner: N\n'],
    ['a blank path', 'a:\n  repo: x\n  path: "  "\n  owner: N\n'],
    ['no owner', 'a:\n  repo: x\n  path: p\n'],
    ['an entry that is null', 'a:\n'],
    ['a lock that does not parse', 'a: [1\n'],
  ]
  for (const [name, text] of lockCases) {
    test(`readLock: ${name}`, async () => {
      const dir = tmp('lk-')
      if (text !== null) put(dir, { 'aristoteles.lock': text })
      expect(await runNew(company.readLock(dir))).toMatchSnapshot()
    })
  }
  const writes: Array<[string, Obj]> = [
    ['an entry with the three written keys out of order', { a: { refreshed: '2026-11-10', repo: 'x', newest: 'n', path: 'p', commit: 'c', owner: 'N' } }],
    ['two entries and some keys missing', { a: { repo: 'x', path: 'p', owner: 'N', commit: 'c' }, b: { repo: 'y', path: 'q', owner: 'M', tag: 'v1', rules: { r1: 'lint' }, checkedBy: 'lint', refreshed: 'd' } }],
    ['a written key that is undefined', { a: { repo: 'x', path: 'p', owner: 'N', commit: undefined, newest: 'n' } }],
    ['an empty lock', {}],
  ]
  for (const [name, lock] of writes) {
    test(`writeLock: ${name}`, async () => {
      const dir = tmp('lk-')
      await provide(company.writeLock(dir, lock))
      expect(readFileSync(join(dir, 'aristoteles.lock'), 'utf8')).toMatchSnapshot()
    })
  }
  test('localDate', () => {
    for (const t of ['2026-11-10T01:00:00Z', '2026-11-10T23:30:00Z', '2026-01-01T00:00:00.000Z']) {
      expect(company.localDate(t)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(company.LOCK).toBe('aristoteles.lock')
  })
})

describe('readFolder', () => {
  const files = [
    'dirs/ff/direction.md', 'dirs/ff/naming/standard.md', 'dirs/ff/naming/upper.md', 'dirs/ff/naming/lower.md',
    'dirs/ff/removable/standard.md', 'dirs/ff/readme.txt', 'dirs/ff/loose.md', 'dirs/ff/deep/x/standard.md',
  ]
  const texts: Record<string, string> = {
    'dirs/ff/direction.md': '\n# Feature flags\n\nSays it.\n\n',
    'dirs/ff/naming/standard.md': 'The name tells.\n\n',
    'dirs/ff/naming/upper.md': 'UPPER.\n',
    'dirs/ff/naming/lower.md': 'lower.',
    'dirs/ff/removable/standard.md': 'One read.\n',
  }
  const text = (f: string) => texts[f] ?? ''
  const cases: Array<[string, string, string[], (f: string) => string]> = [
    ['a full folder', 'dirs/ff', files, text],
    ['a path with a trailing slash', 'dirs/ff/', files, text],
    ['a direction with no heading', 'dirs/ff', files, (f) => (f.endsWith('direction.md') ? 'no head\n' : text(f))],
    ['no direction.md', 'dirs/ff', files.slice(1), text],
    ['a direction with no standards', 'dirs/ff', [files[0] as string], text],
  ]
  for (const [name, path, list, read] of cases) {
    test(name, () => {
      let now: unknown
      try {
        now = { ok: company.readFolder(path, list, read) }
      } catch (e) {
        now = { refused: (e as Error).message }
      }
      expect(now).toMatchSnapshot()
    })
  }
})

describe('fetchFolder', () => {
  const sources = (): Record<string, string> => ({ ARISTOTELES_SOURCES: tmp('src-') })
  const FLAGS: Record<string, string> = {
    'directions/ff/direction.md': '# Feature flags\n\nSays it.\n',
    'directions/ff/naming/standard.md': 'The name tells.\n',
    'directions/ff/naming/upper.md': 'UPPER.\n',
    'other/x.md': 'not in the folder\n',
  }
  const origin = tmp('origin-')
  git(origin, 'init', '-q', '-b', 'main')
  put(origin, FLAGS)
  git(origin, 'add', '-A')
  git(origin, 'commit', '-q', '-m', 'first')
  git(origin, 'tag', 'v1')
  const entry = { repo: origin, path: 'directions/ff', owner: 'N' }

  const fetched = (e: Obj, env: Record<string, string>) => runNew(company.fetchFolder(env, e))

  test('a first fetch (a clone)', async () => {
    expect(await fetched(entry, sources())).toHaveProperty('ok')
  })
  test('a fetch with a tag', async () => {
    expect(await fetched({ ...entry, tag: 'v1' }, sources())).toHaveProperty('ok')
  })
  test('a second fetch after a new commit (a fetch into the cache)', async () => {
    const env = sources()
    await fetched(entry, env)
    put(origin, { 'directions/ff/naming/lower.md': 'lower.\n' })
    git(origin, 'add', '-A')
    git(origin, 'commit', '-q', '-m', 'second')
    type Fetched = { ok: { folder: { standards: Array<{ rules: unknown[] }> } } }
    const was = (await fetched(entry, env)) as Fetched
    expect(was.ok.folder.standards[0]?.rules).toHaveLength(2)
  })
  test('a commit that changed another folder keeps the commit of this folder', async () => {
    const env = sources()
    const first = await fetched(entry, env)
    put(origin, { 'other/y.md': 'more\n' })
    git(origin, 'add', '-A')
    git(origin, 'commit', '-q', '-m', 'other')
    const second = await fetched(entry, env)
    expect((second as Obj).ok.commit).not.toBe(git(origin, 'rev-parse', 'HEAD'))
    expect(second).not.toBe(first)
  })
  test('a repo that does not exist', async () => {
    const e = { ...entry, repo: join(tmpdir(), 'no-such-repo-xyz') }
    expect(await fetched(e, sources())).toHaveProperty('refused')
  })
  test('a folder that the repo does not have', async () => {
    const e = { ...entry, path: 'nope' }
    expect(await fetched(e, sources())).toHaveProperty('refused')
  })
  test('a folder with no direction.md', async () => {
    const e = { ...entry, path: 'other' }
    expect(await fetched(e, sources())).toHaveProperty('refused')
  })
  test('a tag that does not exist', async () => {
    const e = { ...entry, tag: 'v9' }
    expect(await fetched(e, sources())).toHaveProperty('refused')
  })
  test('the cache sits beside the store when ARISTOTELES_SOURCES is not set', async () => {
    const home = tmp('home-')
    const env = { ARISTOTELES_DB: join(home, 'a.db') }
    const now = await runNew(company.fetchFolder(env, entry))
    expect(now).toHaveProperty('ok')
    expect(Bun.spawnSync(['ls', join(home, 'sources')]).exitCode).toBe(0)
  })
})
