// Company directions (Nanda, 2026-11-10): a company direction lives in a git repo (GitHub; here a
// local repo), as a folder with one markdown file for each entry. aristoteles.lock names it; the
// first command of a day fetches it; a changed folder comes in as a draft that its owner accepts,
// and the lockfile follows the accepted commit.
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git, initiated, ok } from './harness.js'

// A company repo with the direction feature-flags in directions/feature-flags.
function companyRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'company-'))
  const write = (path, text) => Bun.write(join(dir, path), text)
  git(dir, 'init', '-q', '-b', 'main')
  return {
    dir,
    async commit(files, message = 'change') {
      for (const [path, text] of Object.entries(files)) await write(path, text)
      git(dir, 'add', '-A')
      git(dir, 'commit', '-q', '-m', message)
      return git(dir, 'rev-parse', 'HEAD')
    },
  }
}
const FLAGS = {
  'directions/feature-flags/direction.md': '# Feature flags\n\nEach critical change is under a feature flag that a person or an AI can remove safely.\n',
  'directions/feature-flags/naming/standard.md': 'The flag name tells the project and the feature.\n',
  'directions/feature-flags/naming/upper-snake.md': 'The flag is FF_<PROJECT>_<FEATURE>.\n',
  'directions/feature-flags/removable/standard.md': 'The flag is read in one place, so that its removal is one change.\n',
  'directions/feature-flags/removable/one-read.md': 'Each flag is read in one if.\n\n## Example\n\n```go\nif flags.Enabled("FF_REPORTS_FAST_EXPORT") {\n\treturn fastExport(ctx, batch)\n}\n```\n',
}
const lockOf = (repo) => `feature-flags:\n  repo: ${repo}\n  path: directions/feature-flags\n  owner: Nanda\n  checkedBy: linter\n`
const readLock = (p) => Bun.YAML.parse(readFileSync(join(p.dir, 'aristoteles.lock'), 'utf8'))
// P10 rejected, onboarding 2026-11-14: a model gives the company draft of a new direction its flow
// in this project and its examples before the owner accepts it, with work direction examples.
const FLAGS_EXAMPLES = `flow:
  - from: writer
    to: docs/tsd.md
    says: adds the flag
    uses: [feature-flags, upper-snake]
    examples:
      - { fit: Follows, output: { file: docs/tsd.md, line: 3, excerpt: "## Introduction" } }
      - { fit: Breaks, output: { written: "const fast = process.env.FAST_EXPORT" } }
`
const addExamples = async (p, draft) => {
  p.write('examples.yaml', FLAGS_EXAMPLES)
  ok(await p.agent(`direction examples ${draft} --file=examples.yaml --by=host`))
}

async function following() {
  const company = companyRepo()
  const first = await company.commit(FLAGS, 'feature flags')
  const s = await initiated()
  s.p.write('aristoteles.lock', lockOf(company.dir))
  return { ...s, company, first }
}

describe('a company direction', () => {
  test('the first command brings the folder in; the owner accepts it; the lockfile follows', async () => {
    const { p, company, first } = await following()
    const r = ok(await p.nanda('log'))
    expect(r.err).toContain(`refresh: feature-flags at ${first.slice(0, 7)} came in as d2; it waits for the accept of Nanda (work direction show d2)`)
    expect(ok(await p.nanda('direction show d2')).out).toContain(`drafted by the refresh: commit ${first.slice(0, 7)} of ${company.dir} (directions/feature-flags)`)
    expect(readLock(p)['feature-flags']).toEqual({ repo: company.dir, path: 'directions/feature-flags', owner: 'Nanda', checkedBy: 'linter',
      newest: first, refreshed: '2026-10-25' })
    const show = ok(await p.nanda('direction show d2')).out
    expect(show).toContain('says:\n  # Feature flags\n\n  Each critical change is under a feature flag')
    expect(show).toContain('upper-snake: The flag is FF_<PROJECT>_<FEATURE>. (linter)')
    expect(show).toContain('\n    one-read (linter):\n        Each flag is read in one if.\n\n        ## Example')
    expect(ok(await p.nanda('direction show d2#one-read#example')).out).toContain('d2 · rule one-read · Example\n## Example')
    await addExamples(p, 'd2')
    // P10 rejected, onboarding 2026-11-14: the draft shows its examples, each with its state.
    // Nanda, 2026-11-15: by the marked step of the flow, real or written by the host.
    expect(ok(await p.nanda('direction show d2')).out).toContain(
      'examples:\n  step 1 · writer -> docs/tsd.md\n    Follows\n      output · docs/tsd.md:3 "## Introduction"\n' +
        '    Breaks\n      output · written by the host: "const fast = process.env.FAST_EXPORT"',
    )
    const accept = ok(await p.nanda('direction accept d2', 'accept')).out
    expect(accept).toContain('d2 is official: feature-flags@1.')
    expect(accept).toContain(`feature-flags follows ${first.slice(0, 7)} of ${company.dir} now (aristoteles.lock).`)
    expect(readLock(p)['feature-flags'].commit).toBe(first)
    expect(ok(await p.agent('direction show feature-flags#one-read#example')).out).toContain('if flags.Enabled("FF_REPORTS_FAST_EXPORT") {')
    // Ruling 4, onboarding 2026-11-14: an example is stale when its excerpt is no longer in its
    // file.
    p.write('docs/tsd.md', '# TSD\n\nTODO\n')
    expect(ok(await p.agent('direction show feature-flags')).out).toContain(
      '    Follows\n      output · docs/tsd.md:3 "## Introduction" · stale\n',
    )
    const db = new Database(join(p.dir, '.work', 'aristoteles.db'), { readonly: true })
    expect(db.query("SELECT source FROM version WHERE id = 'feature-flags@1'").get().source).toBe(`${company.dir} directions/feature-flags@${first}`)
    db.close()
  })

  test('the next day a new commit comes in; the same day nothing is fetched; other files make no draft', async () => {
    const { p, company, first } = await following()
    ok(await p.nanda('log'))
    await addExamples(p, 'd2')
    ok(await p.nanda('direction accept d2', 'accept'))
    const second = await company.commit({ 'directions/feature-flags/naming/upper-snake.md': 'The flag is FF_<PROJECT>_<FEATURE>, in capitals.\n' })
    expect(ok(await p.nanda('log')).err).not.toContain('refresh:')
    p.wait(24 * 60)
    expect(ok(await p.nanda('log')).err).toContain(`refresh: feature-flags at ${second.slice(0, 7)} came in as d3`)
    const show = ok(await p.nanda('direction show d3')).out
    expect(show).toContain('built on feature-flags@1')
    expect(show).toContain('~ naming: The flag name tells the project and the feature.')
    expect(ok(await p.nanda('direction accept d3', 'accept')).out).toContain('d3 is official: feature-flags@2.')
    expect(readLock(p)['feature-flags'].commit).toBe(second)
    const other = await company.commit({ 'README.md': 'The company directions.\n' })
    p.wait(24 * 60)
    expect(ok(await p.nanda('log')).err).not.toContain('came in')
    expect(readLock(p)['feature-flags']).toMatchObject({ commit: second, newest: second, refreshed: '2026-10-27' })
    expect(other).not.toBe(second)
    expect(first).not.toBe(second)
  })

  test('a failed fetch stops no command, and the next command tries again', async () => {
    const { p } = await following()
    p.write('aristoteles.lock', lockOf(join(tmpdir(), 'no-such-company-repo')))
    const r = ok(await p.nanda('log'))
    expect(r.err).toContain('refresh: feature-flags failed (')
    expect(r.err).toContain('still on no commit')
    expect(readLock(p)['feature-flags'].refreshed).toBeUndefined()
  })

  test('a company direction changes in its repo: a revise is refused, and a suggestion names the repo', async () => {
    const { p, company } = await following()
    ok(await p.nanda('log'))
    await addExamples(p, 'd2')
    ok(await p.nanda('direction accept d2', 'accept'))
    p.write('edit.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
    expect((await p.agent('direction revise feature-flags --file=edit.yaml --by=host')).err)
      .toContain(`feature-flags is a company direction from ${company.dir} (directions/feature-flags); it changes there, with a pull request`)
    ok(await p.nanda('suggest naming --says="name the owner team in the flag"'))
  })
})
