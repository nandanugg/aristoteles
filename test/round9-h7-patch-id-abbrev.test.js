// Round 9, attacker H: "the work of a commit is its patch with white space as it is, read in one
// fixed diff form" whatever the repo sets (DESIGN section 11, round 8), and "an amend of rejected
// work with the same files is not new work (the digest of a commit is its git tree)" (section 8).
// The diff form is not fixed for a binary file: its "index" line carries object ids abbreviated
// to the repo's core.abbrev (with "auto", a length that grows with the repo), and git patch-id
// hashes that line for a binary change. When both results have a patch-id, the CLI compares only
// the patch-ids, so the same tree, committed again after the abbreviation changed, is new work.
// The test expects the CORRECT behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { codeStarted, git, ok } from
  './harness.js'

// The same change to the binary logo.bin, as a new commit on a new branch from main.
const logoCommit = (app, branch) => {
  git(app, 'checkout', '-q', '-b', branch, 'main')
  writeFileSync(`${app}/logo.bin`, 'a\0c\n')
  git(app, 'commit', '-q', '-am', `new logo (${branch})`)
  const sha = git(app, 'rev-parse', 'HEAD').slice(0, 12)
  git(app, 'checkout', '-q', 'main')
  return sha
}

describe('H7 the patch-id of a binary change depends on core.abbrev', () => {
  test('r1 (a new logo) is rejected; the same tree, committed again after core.abbrev changed, is stored as new work', async () => {
    const { p, app, lead, impl } = await codeStarted({ 'app/logo.bin': 'a\0b\n' })
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'logo')
    ok(await p.agent(`report ${impl} --output=app@${logoCommit(app, 'one')}`))
    ok(await p.agent(`review ${lead} r1 reject --point="the logo has the wrong colour" --breaks=suite-passes`))
    ok(await p.agent(`brief ${impl}`))
    // Control: the same tree as a new commit is the same work, and is refused.
    expect((await p.agent(`report ${impl} --output=app@${logoCommit(app, 'two')}`)).err).toContain('nothing changed since r1')
    // The repo's abbreviation of object ids changes (with core.abbrev=auto it grows with the repo).
    git(app, 'config', 'core.abbrev', '12')
    const r = await p.agent(`report ${impl} --output=app@${logoCommit(app, 'three')}`)
    // Correct: refused like the control; the files are the files of the rejected r1.
    expect(r.code).toBe(1)
    expect(r.err).toContain('r1')
  }, 30000)
})
