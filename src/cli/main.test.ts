// runCli on one argv and io: its exit code, its words on out and err, and its readings of the
// clock. Every line here ends before a command runs
// (the commands that need the store, the engine or the replay are other packages), or in the
// refusal of a dir that has no store.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { makeDir, runNew, runReal, words, type Options } from './fixture.ts'

const same = async (line: string, options?: Options) => {
  const dir = makeDir()
    const after = await runNew(dir, words(line), options)
  return after
}

describe('help', () => {
  test.each(['', 'help', 'help status'])('"%s" prints the usage', async (line) => {
    const r = await same(line)
    expect(r.code).toBe(0)
    expect(r.out).toStartWith('work - code and document work under review.')
  })
})

describe('the mistakes of the command line, in their order', () => {
  test('an unknown command, for a person and for an agent', async () => {
    const person = await same('frobnicate', { tty: true })
    expect(person.err).toBe(
      'refused: there is no command "frobnicate"; work help lists them\nnext: work waiting shows what waits for you',
    )
    const agent = await same('frobnicate')
    expect(agent.err).toEndWith('next: check the ids with work status or work log; an agent passes its token first')
    // A mistake in the command line exits 2 (card 8).
    expect([person.code, agent.code]).toEqual([2, 2])
  })

  test('a person inside an agent session is not the person', async () => {
    const r = await same('frobnicate', { tty: true, env: { ARISTOTELES_SESSION: 's-1' } })
    expect(r.err).toEndWith('check the ids with work status or work log; an agent passes its token first')
  })

  test.each([
    ['a token that is not right after the command', 'status extra a1.k0001'],
    ['a token that is not after the act word', 'task a1.k0001 show t1'],
    ['a token for a command that has no act word', 'assign t1 a1.k0001'],
  ])('%s', async (_name, line) => {
    const r = await same(line)
    expect(r.err).toContain('a token goes right after work')
    expect(r.err).toEndWith('next: run the command again with the token there')
    expect(r.code).toBe(2)
  })

  test('a word that looks like a flag', async () => {
    const r = await same('assign t1 --max_attempts=1 --role=writer')
    expect(r.err).toContain('--max_attempts=1 is not a flag')
  })

  test.each([
    ['a flag that a list does not have', 'assign t1 --nope=1'],
    ['a flag that an act does not have', 'task open --nope=1'],
    ['a flag of another act', 'review r1 accept --point=x'],
    ['a flag where an act reads none', 'task show t1 --file=x'],
    ['a flag where the command reads none', 'status --x=1'],
    ['a flag where a list is empty', 'search words --x=1'],
    ['a flag of a forwarded act', 'forward a1.k0001 e1 ask --point=x'],
    // --settles is gone: a resolve is its own command (the owner's ruling, 2026-11-12).
    ['the old settle on an accept', 'review r1 accept --settles=v2 --reason=x'],
    ['the old settle on a forwarded accept', 'forward a1.k0001 Nanda accept r1 --settles=v2'],
    ['a reason on a resolve (it reads --resolution)', 'resolve v2 --reason=x'],
    ['a resolution on a forwarded resolve (the quote is its words)', 'forward a1.k0001 Nanda resolve v2 --resolution=x'],
  ])('%s', async (_name, line) => {
    const r = await same(line)
    expect(r.err).toContain('has no flag --')
    expect(r.err).toContain('next: run the command again without that flag')
    expect(r.code).toBe(2)
  })

  test('a flag with no value, unless it is a switch', async () => {
    const r = await same('assign t1 --role')
    expect(r.err).toContain('--role needs a value: --role="<...>"')
    expect(r.err).toContain('next: run the command again with the value')
    expect(r.code).toBe(2)
  })

  test('the first mistake wins', async () => {
    // A misplaced token, a broken word, an unknown flag and a bare flag, in their order.
    const r = await same('assign t1 a1.k0001 --max_attempts=1 --nope=2 --role')
    expect(r.err).toContain('a token goes right after work assign')
  })
})

describe('a dir with no store', () => {
  test('a read refuses with the next line of the old store', async () => {
    const r = await same('status', { tty: true })
    expect(r.err).toStartWith('refused: no work store in <project>\nnext: run work in the dir that your parent named')
    expect(r.clock).toBe(0)
    // No store is a refusal (1), not an outside failure.
    expect(r.code).toBe(1)
  })

  test('a file that is not a store is an outside failure: exit 3', async () => {
    const dir = makeDir()
    mkdirSync(join(dir, '.work'), { recursive: true })
    writeFileSync(join(dir, '.work', 'aristoteles.db'), 'not a database at all, only words\n')
    const r = await runReal(dir, ['status'], { tty: true })
    expect(r.err).toStartWith('refused: the file <project>/.work/aristoteles.db is not a store of this work')
    expect(r.code).toBe(3)
  })

  test('a store that does not open ends in the advice to check the token, with no clock reading', async () => {
    // The refusal has no next line, so nextFor reads the dir to tell a low agent from another.
    const r = await same('frobnicate a1.k0001')
    expect(r.err).toEndWith('next: check the token that your parent gave you; if it is wrong, tell your parent')
    expect(r.clock).toBe(0)
  })

  test('a store that refuses with its own next line keeps it', async () => {
    const r = await same('next a1.k0001')
    expect(r.err).toContain('next: run work in the dir that your parent named')
  })

  test('init refuses a call that is not a person, before it reads anything', async () => {
    const agent = await same('init')
    expect(agent.code).toBe(1)
    expect(agent.err).toStartWith('refused: this is a person command; a person runs it at a terminal')
    expect(agent.err).toEndWith('next: an agent passes its token first: work <command> <token> ...')
    expect(agent.clock).toBe(0)
  })
})

describe('the commands that refuse before they read the store', () => {
  test.each([
    'guide',
    'guide writing',
    'guide direction-review',
    'guide decision-words',
    'guide nope',
    'search',
    'config frob',
    'session a1',
    'session x --id=s-1',
    'run frob',
    'run done',
    'run close',
    'question x',
    'result x',
    'assignment x',
    'evaluation x',
  ])('work %s', async (line) => {
    const r = await same(line, { tty: true })
    expect(r.clock).toBe(0)
  })

  test('a person command in the words of its refusal', async () => {
    const r = await same('run frob', { tty: true })
    expect(r.err).toStartWith('refused: use work run start|done|close|list')
  })
})
