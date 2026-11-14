// bin/work.js runs the CLI as one bundle in .cache/cli/<key>/, built by the first call after a
// change. The test runs it on a copy of the code, so that it can change a source file and break a
// build there: the words of a call are the words of the sources, the bundle is built once and
// again after a change, a build that fails still gives the same words, and calls that start at
// once share one bundle.
import { describe, expect, test } from 'bun:test'
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reported } from './harness.js'

const ROOT = join(import.meta.dir, '..')

// The code of aristoteles in a temp folder, with the installed packages of this one.
const copy = () => {
  const dir = mkdtempSync(join(tmpdir(), 'work-code-'))
  for (const part of ['bin', 'core', 'adapters', 'src', 'guides', 'skills']) {
    cpSync(join(ROOT, part), join(dir, part), { recursive: true })
  }
  for (const file of ['package.json', 'bun.lock', 'tsconfig.json']) {
    cpSync(join(ROOT, file), join(dir, file))
  }
  symlinkSync(realpathSync(join(ROOT, 'node_modules')), join(dir, 'node_modules'))
  return dir
}

describe('bin/work.js', () => {
  test('the words of the sources; a new bundle after a change; none if a build fails', async () => {
    const code = copy()
    const { p } = await reported()
    const db = join(p.dir, '.work', 'aristoteles.db')
    const env = { ...process.env, WORK_DIR: p.dir, ARISTOTELES_DB: db }
    for (const key of ['TMUX', 'TMUX_PANE', 'TMUX_SOCKET']) delete env[key]
    const run = (entry, ...argv) => {
      const r = Bun.spawnSync(['bun', join(code, entry), ...argv], { env, cwd: p.dir })
      return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }
    }
    const cache = join(code, '.cache', 'cli')
    const bundles = () => (existsSync(cache) ? readdirSync(cache) : [])
    // The words of the sources (bin/main.ts, the entry of the bundle) and of bin/work.js.
    const calls = [['status'], ['waiting'], ['guide', 'limits']]
    const sources = calls.map((argv) => run('bin/main.ts', ...argv))
    const same = () => expect(calls.map((argv) => run('bin/work.js', ...argv))).toEqual(sources)
    expect(sources.map((r) => r.code)).toEqual([0, 0, 0])
    expect(bundles()).toEqual([])

    // The first call builds the bundle; the calls after it load it.
    same()
    const [first] = bundles()
    expect(bundles()).toHaveLength(1)
    expect(existsSync(join(cache, first, 'main.js'))).toBe(true)
    same()
    expect(bundles()).toEqual([first])

    // One source file changes: the next call builds again, and the old bundle goes.
    appendFileSync(join(code, 'core', 'derived', 'steps.ts'), '// a change after the build\n')
    same()
    const [second] = bundles()
    expect(bundles()).toHaveLength(1)
    expect(second).not.toBe(first)

    // The build fails (the cache cannot be made): the call runs the sources with the same words,
    // and leaves no bundle; the next call tries again.
    rmSync(join(code, '.cache'), { recursive: true })
    writeFileSync(join(code, '.cache'), 'a file where the cache folder goes\n')
    same()
    expect(existsSync(cache)).toBe(false)
    rmSync(join(code, '.cache'))
    same()
    expect(bundles()).toEqual([second])

    // Calls that start at once with no bundle each build one; one is renamed into place, and the
    // others leave no trace.
    rmSync(join(code, '.cache'), { recursive: true })
    const at = (argv) =>
      Bun.spawn(['bun', join(code, 'bin', 'work.js'), ...argv], { env, cwd: p.dir, stdout: 'pipe' })
    const started = [0, 1, 2, 3].map(() => at(['status']))
    const words = await Promise.all(started.map((s) => new Response(s.stdout).text()))
    expect(words).toEqual(started.map(() => sources[0].out))
    expect(bundles()).toEqual([second])
    rmSync(code, { recursive: true, force: true })
  }, 30000)
})
