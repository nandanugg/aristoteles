// The daily refresh up to the store: which entries it fetches, what a failed fetch says, and what
// it leaves in the lock. A dir with a lock but
// no store has nothing to refresh into, so the engine and the replay are not needed here; what
// writes a draft is covered by test/company.test.js once they are built.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import type { Direction, Version } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import { localDate } from '../files/company.ts'
import { layersOf, ioOf, makeDir, runNew, words, type Options } from './fixture.ts'
import { followCommit } from './refresh.ts'

const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix))
const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(['git', '-C', cwd, ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  })
  if (run.exitCode !== 0) throw new Error(run.stderr.toString())
  return run.stdout.toString().trim()
}

// A company repo with the direction flags in directions/flags.
const companyRepo = () => {
  const dir = tmp('refresh-company-')
  git(dir, 'init', '-q', '-b', 'main')
  mkdirSync(join(dir, 'directions', 'flags'), { recursive: true })
  writeFileSync(join(dir, 'directions', 'flags', 'direction.md'), '# Flags\n\nUse a flag.\n')
  git(dir, 'add', '-A')
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'flags')
  return dir
}

const lockOf = (repo: string, extra = '') =>
  `flags:\n  repo: ${repo}\n  path: directions/flags\n  owner: Nanda\n${extra}`

// runCli on a dir with a lock and sources; returns the lock that it leaves.
const same = async (line: string, lock: string, options: Options = {}) => {
  const dir = makeDir()
  const env = { ARISTOTELES_SOURCES: tmp('refresh-sources-'), ...options.env }
  writeFileSync(join(dir, 'aristoteles.lock'), lock)
  const after = await runNew(dir, words(line), { tty: true, ...options, env })
  return { after, lock: readFileSync(join(dir, 'aristoteles.lock'), 'utf8') }
}

// The date that the fake clock gives the refresh (it reads the clock first, at 09:00).
const TODAY = localDate(new Date(Date.UTC(2026, 9, 25, 9, 0)).toISOString())

describe('which entries the refresh fetches', () => {
  test('an entry refreshed today is not fetched: a repo that is not there makes no note', async () => {
    const lock = lockOf('/no/such/repo', `  refreshed: '${TODAY}'\n`)
    const { after } = await same('status', lock)
    expect(after.err).not.toContain('refresh:')
    // The refresh read the clock once for the date, and status found no store.
    expect(after.clock).toBe(1)
  })

  test('an entry refreshed on another day is fetched again', async () => {
    const { after } = await same('status', lockOf('/no/such/repo', "  refreshed: '2020-01-01'\n"))
    expect(after.err).toContain('refresh: flags failed (')
  })

  test('a failed fetch says why, on its first line, and where the project stays', async () => {
    const { after } = await same('status', lockOf('/no/such/repo', '  commit: 0123456789abcdef\n'))
    const note = after.err.split('\n')[0] as string
    expect(note).toStartWith('refresh: flags failed (')
    expect(note).toEndWith('); still on 0123456')
    expect(after.err).toContain('refused: no work store in <project>')
  })

  test('a failed fetch of an entry with no accepted commit says so', async () => {
    const { after } = await same('status', lockOf('/no/such/repo'))
    expect(after.err.split('\n')[0]).toEndWith('); still on no commit')
  })

  test('a repo with no such folder is a failed fetch too', async () => {
    const repo = companyRepo()
    const lock = `flags:\n  repo: ${repo}\n  path: directions/nothing\n  owner: Nanda\n`
    const { after } = await same('status', lock)
    expect(after.err).toContain(`refresh: flags failed (${repo} has no folder directions/nothing at its default branch)`)
  })
})

describe('a fetch that works, in a dir with no store', () => {
  test('there is nothing to refresh into: no note, the lock stays, the command refuses the store', async () => {
    const repo = companyRepo()
    const { after } = await same('status', lockOf(repo))
    expect(after.err).toBe(
      'refused: no work store in <project>\nnext: run work in the dir that your parent named; a new dir starts with the person running work init next to its aristoteles.yaml',
    )
    // The date, then the fetch; the write never reached its readings.
    expect(after.clock).toBe(1)
  })

  test('the notes of an earlier failed entry are dropped with it, as the old main did', async () => {
    const repo = companyRepo()
    const lock = `${lockOf('/no/such/repo').replace('flags:', 'gone:')}${lockOf(repo)}`
    const { after } = await same('status', lock)
    expect(after.err).not.toContain('refresh:')
  })
})

describe('a lock that is not right', () => {
  test.each([
    ['a missing owner', 'flags:\n  repo: x\n  path: p\n'],
    ['a blank repo', "flags:\n  repo: ' '\n  path: p\n  owner: Nanda\n"],
  ])('%s refuses the command, not only the refresh', async (_name, lock) => {
    const { after } = await same('status', lock)
    expect(after.err).toStartWith('refused: aristoteles.lock flags: ')
  })

  test('init does not refresh', async () => {
    const dir = makeDir()
    writeFileSync(join(dir, 'aristoteles.lock'), 'flags:\n  repo: x\n')
    const r = await runNew(dir, ['init'], { tty: false })
    expect(r.err).toStartWith('refused: this is a person command')
  })
})

describe('followCommit', () => {
  // A version of a company commit, or (with no commit) one of this dir, and its direction
  // (the repo and the folder are the direction's).
  const version = (source?: { repo: string; path: string; commit: string }) => {
    const v = { of: 'flags', number: 1, revision: 'd1' } as unknown as Version<Direction>
    const origin = source
      ? { _tag: 'External', repo: source.repo, path: source.path }
      : { _tag: 'Local' }
    const made = source
      ? { _tag: 'Imported', commit: source.commit, ref: { _tag: 'DefaultBranch' } }
      : { _tag: 'Written', by: 'a1' }
    const work = {
      directions: new Map([['flags', { id: 'flags', source: origin }]]),
      drafts: new Map([['d1', { id: 'd1', origin: made }]]),
    }
    return { v, work: work as unknown as Work }
  }

  const run = async (dir: string, { v, work }: ReturnType<typeof version>) => {
    const { io, result } = ioOf(dir)
    const follow = followCommit(work, v)
    const lines = await Effect.runPromise(follow.pipe(Effect.provide(layersOf(io))))
    return { lines, io: result(0) }
  }

  test('the lock follows the accepted commit, and says so', async () => {
    const dir = makeDir()
    writeFileSync(
      join(dir, 'aristoteles.lock'),
      lockOf('/the/repo', `  refreshed: '2026-10-25'\n  newest: abc\n`),
    )
    const full = 'f'.repeat(40)
    const at = { repo: '/the/repo', path: 'directions/flags', commit: full }
    const { lines } = await run(dir, version(at))
    expect(lines).toEqual([`flags follows fffffff of /the/repo now (aristoteles.lock).`])
    expect(Bun.YAML.parse(readFileSync(join(dir, 'aristoteles.lock'), 'utf8'))).toEqual({
      flags: {
        repo: '/the/repo',
        path: 'directions/flags',
        owner: 'Nanda',
        commit: full,
        newest: 'abc',
        refreshed: '2026-10-25',
      },
    })
  })

  test('a version of this dir, a dir with no lock and a direction not in the lock follow nothing', async () => {
    const dir = makeDir()
    expect((await run(dir, version())).lines).toEqual([])
    const source = { repo: 'r', path: 'p', commit: 'c'.repeat(40) }
    expect((await run(dir, version(source))).lines).toEqual([])
    writeFileSync(join(dir, 'aristoteles.lock'), lockOf('/the/repo').replace('flags:', 'other:'))
    const before = readFileSync(join(dir, 'aristoteles.lock'), 'utf8')
    expect((await run(dir, version(source))).lines).toEqual([])
    expect(readFileSync(join(dir, 'aristoteles.lock'), 'utf8')).toBe(before)
  })
})
