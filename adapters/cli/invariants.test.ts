// checkNextCanAct on a real store (BUILD.md 4.2): it folds, derives, and checks each step of
// nextFor with canAct.
import { describe, expect, test } from 'bun:test'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harness from '../../test/harness.js'
import { checkNextCanAct } from './invariants.ts'

interface Project {
  readonly dir: string
  readonly now: () => string
}
const { started } = harness as { started: () => Promise<{ p: Project }> }

describe('checkNextCanAct', () => {
  test('a started project has no step that canAct refuses', async () => {
    const { p } = await started()
    const env = { ARISTOTELES_DB: `${p.dir}/.work/aristoteles.db` }
    expect(await checkNextCanAct(p.dir, env, p.now())).toEqual([])
  })

  test('a dir with no store has no violations', async () => {
    const env = { ARISTOTELES_DB: '/nonexistent-dir-for-invariants/none.db' }
    const dir = '/nonexistent-dir-for-invariants'
    expect(await checkNextCanAct(dir, env, '2026-10-25T09:00')).toEqual([])
  })
})
