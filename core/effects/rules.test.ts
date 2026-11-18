import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import { CLOSED, initState, tk } from '../state/work/reads.ts'
import type { Example, Form, ItemRec, Task, WorkState } from '../state/work/types.ts'
import { Dir, FilesLive, Spawn, SpawnLive } from '../services/index.ts'
import type { Files } from '../services/index.ts'
import { caughtOn, pendingHold, refExists, RuleRunFailed, runOn, runTest } from './rules.ts'

const proj = mkdtempSync(join(tmpdir(), 'rules-'))
const layer = Layer.mergeAll(FilesLive, SpawnLive, Layer.succeed(Dir, { cwd: proj }))
const run = <A>(e: Effect.Effect<A, RuleRunFailed, Dir | Spawn | Files>): Promise<A> =>
  Effect.runPromise(e.pipe(Effect.provide(layer)))

const file = (name: string, text: string): string => {
  const p = join(proj, name)
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, text)
  return p
}

const rec = (
  kind: ItemRec['kind'],
  parent: string | null,
  form: Form = 'none',
  test: string | null = null,
  examples: ReadonlyArray<Example> = [],
): ItemRec => ({ kind, parent, name: 'n', says: 's', where: null, test, ref: null, form, examples })
const ex = (fits: Example['fits'], sample: string): Example => ({ fits, sample })

const TODO = "grep -n 'TODO' \"$@\""
const base = (): WorkState => {
  const s = initState(
    { name: 'top', goal: 'g', sections: ['a'], directions: ['d1'] },
    new Map<string, ItemRec>([
      ['dir:d1', rec('dir', null)],
      ['std:s1', rec('std', 'dir:d1')],
      ['rule:old', rec('rule', 'std:s1', 'mech', TODO, [ex('follows', 'a TODO here')])],
      ['rule:ref', rec('rule', 'std:s1', 'ref')],
    ]),
    new Map(),
    2,
  )
  const t = {
    id: 't1',
    name: 'n',
    goal: 'g',
    role: 'dev',
    parent: null,
    sections: ['a'],
    directions: ['d1'],
    gen: 0,
    st: 'Done',
    tries: 0,
    maker: null,
    rid: 1,
    checked: new Map(),
    pend: new Set(['rule:old']),
    caught: new Set(),
    taken: false,
    floor: 'Split',
    at: 0,
  } satisfies Task
  return { ...s, tasks: new Map([['t1', t]]) }
}
const withDraft = (s: WorkState, r: ItemRec): WorkState => ({
  ...s,
  fixes: new Map([['t1', { ...CLOSED, draft: new Map([['rule:new', r]]) }]]),
})

describe('runOn', () => {
  test('the non-empty lines it prints are the points', async () => {
    const f = file('a.txt', 'ok\nTODO x\n\nTODO y\n')
    expect(await run(runOn(TODO, [f]))).toEqual(['2:TODO x', '4:TODO y'])
    expect(await run(runOn(TODO, [file('b.txt', 'fine\n')]))).toEqual([])
  })
  test('a command that cannot start or times out is a failure, not holds', async () => {
    const bad = Layer.mergeAll(
      Layer.succeed(Dir, { cwd: join(proj, 'missing') }),
      SpawnLive,
    )
    const e = await Effect.runPromise(
      Effect.flip(runOn('true', [])).pipe(Effect.provide(bad)),
    )
    expect(e).toBeInstanceOf(RuleRunFailed)
    const slow = Layer.mergeAll(
      Layer.succeed(Dir, { cwd: proj }),
      Layer.succeed(Spawn, {
        run: () => Effect.succeed({ code: 0, out: '', err: '', timedOut: true }),
      }),
    )
    const t = await Effect.runPromise(Effect.flip(runOn('sleep 99', [])).pipe(Effect.provide(slow)))
    expect(t.message).toContain('timed out')
  })
})

describe('runTest', () => {
  test('own holds when breaks print and follows do not', async () => {
    const r = rec('rule', 'std:s1', 'mech', TODO, [ex('breaks', 'TODO: x'), ex('follows', 'done')])
    expect((await run(runTest(withDraft(base(), r), 't1'))).own).toBe(true)
  })
  test('own fails when a breaks example prints nothing or a follows one prints', async () => {
    const miss = rec('rule', 'std:s1', 'mech', TODO, [ex('breaks', 'clean')])
    expect((await run(runTest(withDraft(base(), miss), 't1'))).own).toBe(false)
    const over = rec('rule', 'std:s1', 'mech', TODO, [ex('follows', 'TODO')])
    expect((await run(runTest(withDraft(base(), over), 't1'))).own).toBe(false)
  })
  test('contra: the other rules of the direction whose follows example it flags', async () => {
    const r = rec('rule', 'std:s1', 'mech', TODO, [ex('breaks', 'TODO')])
    expect((await run(runTest(withDraft(base(), r), 't1'))).contra).toEqual(['rule:old'])
    const quiet = rec('rule', 'std:s1', 'mech', "grep -n 'FIXME' \"$@\"", [ex('breaks', 'FIXME')])
    expect((await run(runTest(withDraft(base(), quiet), 't1'))).contra).toEqual([])
  })
})

describe('refExists', () => {
  const doc = file('docs/g.md', '# Guide\n\n## Some Heading\nline four\nuse widget here\n')
  void doc
  const ok = (ref: string) =>
    Effect.runPromise(refExists(proj, ref).pipe(Effect.provide(FilesLive)))
  test('a heading slug or the anchor text, with lines in range', async () => {
    expect(await ok('docs/g.md#some-heading:3')).toBe(true)
    expect(await ok('docs/g.md#widget:4-5')).toBe(true)
  })
  test('missing file, missing anchor, lines out of range, escapes, bad form', async () => {
    expect(await ok('docs/none.md#some-heading:3')).toBe(false)
    expect(await ok('docs/g.md#absent:3')).toBe(false)
    expect(await ok('docs/g.md#some-heading:9')).toBe(false)
    expect(await ok('docs/g.md#some-heading:4-9')).toBe(false)
    expect(await ok('../x.md#a:1')).toBe(false)
    expect(await ok(`${doc}#some-heading:3`)).toBe(false)
    expect(await ok('docs/g.md')).toBe(false)
  })
})

describe('caughtOn and pendingHold', () => {
  test('caughtOn: the applying test rules that print on the paths', async () => {
    const s = base()
    expect(tk(s, 't1').id).toBe('t1')
    expect([...(await run(caughtOn(s, 't1', [file('c.txt', 'TODO\n')])))]).toEqual(['rule:old'])
    expect((await run(caughtOn(s, 't1', [file('d.txt', 'fine\n')]))).size).toBe(0)
  })
  test('only a mech rule blocks a pass: a both rule that prints is not caught', async () => {
    const both = rec('rule', 'std:s1', 'both', TODO)
    const s0 = base()
    const s = { ...s0, items: new Map(s0.items).set('rule:both', both) }
    const caught = await run(caughtOn(s, 't1', [file('g.txt', 'TODO\n')]))
    expect([...caught]).toEqual(['rule:old'])
  })
  test('pendingHold: true when the pending test rules print nothing', async () => {
    const s = base()
    expect(await run(pendingHold(s, 't1', [file('e.txt', 'fine\n')]))).toBe(true)
    expect(await run(pendingHold(s, 't1', [file('f.txt', 'TODO\n')]))).toBe(false)
  })
  test('only the task section is seen; a nested subsection stays inside it', async () => {
    const s = base()
    const doc = (a: string, b: string): string =>
      `# Doc\n\n## A\n\ntext\n\n### Sub\n\n${a}\n\n## Other\n\n${b}\n`
    expect([...(await run(caughtOn(s, 't1', [file('s1.md', doc('fine', 'TODO'))])))]).toEqual([])
    expect([...(await run(caughtOn(s, 't1', [file('s2.md', doc('TODO', 'fine'))])))]).toEqual([
      'rule:old',
    ])
    expect(await run(pendingHold(s, 't1', [file('s3.md', doc('fine', 'TODO'))]))).toBe(true)
  })
  test('a # line in a code fence is no heading: the section goes on past it', async () => {
    const s = base()
    const doc = '# Doc\n\n## A\n\n```\n# not a heading\n```\n\nTODO\n\n## Other\n\nfine\n'
    expect([...(await run(caughtOn(s, 't1', [file('f.md', doc)])))]).toEqual(['rule:old'])
  })
  test('a file with no headings is passed whole', async () => {
    const s = base()
    expect([...(await run(caughtOn(s, 't1', [file('n.md', 'x\nTODO\n')])))]).toEqual(['rule:old'])
  })
})
