import { describe, expect, test } from 'bun:test'
import { INTRO_V2, changeDirection, ok, started, tokenIn } from './harness.js'

// Findings of the live runs of 2026-11-07 (Tests 2 and 5, proofs.md section 5).

describe('what the live runs found', () => {
  test('the printed prompt says to do what the brief says', async () => {
    const { p, lead } = await started()
    expect(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out).toContain(', and do what the brief says.')
  })

  // Two makers of one document file: test/file-queue.test.js (one maker for each file at a time).

  test('a finish prints no worktree line when the maker had no worktree', async () => {
    const { p, lead } = await started()
    ok(await p.agent(`assign ${lead} t1 --role=writer`))
    expect(ok(await p.agent(`finish ${lead} a2`)).out).not.toContain('worktree')
  })

  test('a report made under an old version says that it uses no attempt', async () => {
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    await changeDirection(p, 'add:\n  - { id: short, says: Keep it short. }\n', { flags: '--why="Correct the standard"' })
    p.write('docs/tsd.md', INTRO_V2)
    expect(ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)).out)
      .toContain('it was made under an old version of a direction, so it uses no attempt')
  })

  test('direction show prints the reason of each review of a draft', async () => {
    const { p } = await started()
    await changeDirection(p, 'add:\n  - { id: units, says: Numbers have units. }\n', { accept: false })
    ok(await p.nanda('review d2 reject --reason="it does not say which numbers"'))
    expect(ok(await p.agent('direction show d2')).out).toContain('review: v2 Reject by')
    expect(ok(await p.agent('direction show d2')).out).toContain('it does not say which numbers')
  })
})
