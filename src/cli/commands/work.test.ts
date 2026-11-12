// The commands of tasks.ts and work.ts on one argv and io: the exit code, words, readings of the
// clock and of the random secret, for every line that ends
// before the engine (an argument check, a refusal before the store, or a dir with no store).
import { describe, expect, test } from 'bun:test'
import { makeDir, runNew, type Options, words } from '../fixture.ts'

const same = async (line: string, options?: Options) => {
  const dir = makeDir()
    const after = await runNew(dir, words(line), options)
  return after
}

describe('refusals before the store opens', () => {
  test.each([
    ['task frob', 'use work task open|show|tree|split|close|remake'],
    ['task draft --file=t.yaml', 'the person tells the host in words'],
    ['report a1.k0001', 'a report needs --output='],
    ['review a1.k0001 r1 maybe', 'a review is accept or reject'],
    ['review r1', 'a review is accept or reject'],
    ['note a1.k0001 frob', 'a note is a finding, a message'],
    ['note a1.k0001 words', 'words --on=<the decision'],
    ['note a1.k0001 finding --text=x --hope=y', '--hope is only for'],
    ['source a1.k0001 npm', 'use work source <token> <source>@<revision>'],
    ['evaluate', 'use work evaluate'],
  ])('work %s', async (line, text) => {
    const r = await same(line, { tty: true })
    if (text) expect(r.err).toContain(text)
    expect(r.code).toBe(1)
  })
})

describe('the clock and the random secret before the store', () => {
  test('assign reads the random secret once, before the store opens', async () => {
    const r = await same('assign t1 --role=writer', { tty: true })
    expect(r.random).toBe(1)
    expect(r.err).toContain('no work store')
  })
  test('a dry run reads it too', async () => {
    const r = await same('assign t1 --role=writer --dry-run', { tty: true })
    expect(r.random).toBe(1)
  })
})

describe('a dir with no store', () => {
  test.each([
    'task show t1',
    'task tree t1',
    'task close t1 --reason=x',
    'free a1',
    'finish a1',
    'brief a1.k0001',
    'review r1 accept --evidence="x | y"',
    'review d1 reject --reason=x',
    'recheck a1.k0001 r1',
    'escalate a1.k0001 --reason=x',
    'resolve v2 --resolution=x',
    'resolve a1.k0001 v2 --resolution=x',
    'ask a1.k0001 --text=x',
    'answer q1 --text=x',
    'checkpoint a1.k0001 t1 --next=x',
    'resume a1.k0001 t1',
    'source a1.k0001 npm@1',
  ])('work %s', async (line) => {
    const r = await same(line, { tty: true })
    expect(r.err).toStartWith('refused: no work store in <project>')
  })
})

test('task open with no file prints the template, as before', async () => {
  const r = await same('task open', { tty: true })
  expect(r.code).toBe(0)
  expect(r.out).toContain('Save it as a file, then: work task open --file=<file>')
})
