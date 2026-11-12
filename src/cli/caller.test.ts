// Who calls: the person checks and the agent checks, each with its words. Where the CLI reaches
// a check, the words of the whole command are the words of the check on a Work of the fixture.
import { beforeAll, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import type { Work } from '../domain/work.ts'
import { agentOf, callerOf, isToken, needClaim, needOpen, personOf } from './caller.ts'
import { failureOf, fakeWork, makeDir, runEffect, runNew, runReal, type Options } from './fixture.ts'
// A static import: a top-level await breaks the tests under bun test --parallel (bun 1.3.14).
// @ts-expect-error test/harness.js has no types
import * as harnessJs from '../../test/harness.js'

const harness = harnessJs as {
  readonly started: (files?: Record<string, string>) => Promise<{
    readonly p: { readonly agent: (line: string) => Promise<{ code: number; err: string; out: string }> }
    readonly lead: string
  }>
  readonly withWriter: (files?: Record<string, string>) => Promise<{
    readonly p: { readonly agent: (line: string) => Promise<{ code: number; err: string; out: string }> }
    readonly lead: string
    readonly writer: string
  }>
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

// The refusal of the CLI as one pair: its message and its next line.
const refusalOf = (err: string) => {
  const [first = '', second] = err.split('\n')
  return { message: first.replace(/^refused: /, ''), next: second?.replace(/^next: /, '') ?? null }
}

describe('the person, as init checks it', () => {
  test.each<[string, string, Options]>([
    ['a real agent runs in this terminal', 'init', { tty: true, env: { ARISTOTELES_SESSION: 's-host' } }],
    ['a call that is not at a terminal', 'init', {}],
    ['GIT_CONFIG variables are set', 'init', { tty: true, env: { GIT_CONFIG_COUNT: '1' } }],
  ])('%s', async (_name, line, options) => {
    const dir = makeDir()
    const after = await runNew(dir, [line], options)
    expect(after.code).toBe(1)
    expect(after.clock).toBe(0)
  })

  test('the session is checked before the terminal, and the terminal before GIT_CONFIG', async () => {
    const options: Options = { env: { ARISTOTELES_SESSION: 's', GIT_CONFIG_COUNT: '1' } }
    const dir = makeDir()
    expect((await runNew(dir, ['init'], options)).code).toBe(1)
  })

  test('a git user outside the people, in the words of init', async () => {
    const dir = makeDir()
    const before = await runNew(dir, ['init'], { tty: true, git: 'Mallory' })
    const { exit } = await runEffect(personOf(fakeWork({})), dir, { tty: true, git: 'Mallory' })
    expect(`refused: ${failureOf(exit).message}`).toBe(before.err.split('\n')[0] ?? '')
  })

  test('the page is the person too, and a terminal with the name in the people passes', async () => {
    const dir = makeDir()
    const ui = await runEffect(callerOf(fakeWork({}), null), dir, { channel: 'ui' })
    expect(ui.exit._tag === 'Success' && ui.exit.value).toEqual({ _tag: 'Person', name: 'Nanda', channel: 'ui' })
    const tty = await runEffect(callerOf(fakeWork({}), null), dir, { tty: true })
    expect(tty.exit._tag === 'Success' && tty.exit.value).toEqual({ _tag: 'Person', name: 'Nanda', channel: 'terminal' })
  })

  test('the people list is not read when there is no work yet (init)', async () => {
    const dir = makeDir()
    const { exit } = await runEffect(personOf(undefined), dir, { tty: true, git: 'Mallory' })
    expect(exit._tag === 'Success' && exit.value).toBe('Mallory')
  })
})

describe('the typed confirmation', () => {
  const confirm = { word: 'restore', show: 'restore aristoteles.yaml to the stored text' }
  let dir: string
  beforeAll(async () => {
    dir = makeDir()
    expect((await runReal(dir, ['init'], { tty: true })).code).toBe(0)
  })

  test.each([['nope'], [undefined], ['']])('typed %p is refused, as config restore does', async (typed) => {
    const options: Options = { tty: true, ...(typed === undefined ? {} : { typed }) }
    const before = await runReal(dir, ['config', 'restore'], options)
    const after = await runEffect(personOf(fakeWork({}), confirm), dir, options)
    expect(before.err.split('\n')[0]).toBe('refused: not confirmed; nothing was stored')
    expect(failureOf(after.exit).message).toBe('not confirmed; nothing was stored')
    // The same line is shown first, and the same prompt is asked.
    expect(after.io.out).toBe(before.out)
    expect(after.io.prompts).toEqual(before.prompts)
  })

  test('the typed word is trimmed, and then it passes', async () => {
    const after = await runEffect(personOf(fakeWork({}), confirm), dir, { tty: true, typed: '  restore ' })
    expect(after.exit._tag === 'Success' && after.exit.value).toBe('Nanda')
  })
})

describe('the agent, as agent() checks its token', () => {
  const secret = 'k0001'
  const work: Work = fakeWork({
    assignments: new Map([['a1', { id: 'a1', role: 'architect', task: 't1', parent: { _tag: 'GivenByPerson' }, end: { _tag: 'NotEnded' } }]]),
    meta: new Map([['a1', { id: 'a1', secret: sha(secret), claim: { _tag: 'Free' } }]]),
    workflow: { roles: new Map([['architect', { _tag: 'Model', tier: 'high' }]]) },
  })
  let cli: { readonly p: { readonly agent: (line: string) => Promise<{ err: string }> } }
  beforeAll(async () => {
    cli = await harness.started()
  })

  test.each([
    ['no token', undefined, null],
    ['a word', 'x', 'x'],
    ['an id', 'a1', 'a1'],
    ['a wrong secret', 'a1.wrong', 'a1.wrong'],
    ['an assignment that does not exist', 'a9.k0001', 'a9.k0001'],
  ])('%s', async (_name, typed, token) => {
    const line = typed === undefined ? 'next' : `next ${typed}`
    const before = refusalOf((await cli.p.agent(line)).err)
    const dir = makeDir()
    const { exit } = await runEffect(agentOf(work, token) as Effect.Effect<unknown, unknown, never>, dir)
    expect(failureOf(exit)).toEqual({ message: before.message, next: null })
  })

  test('the right token gives the assignment', async () => {
    const dir = makeDir()
    const { exit } = await runEffect(agentOf(work, 'a1.k0001') as Effect.Effect<unknown, unknown, never>, dir)
    expect(exit._tag === 'Success' && (exit.value as { id: string }).id).toBe('a1')
  })

  test('a token is a7. and then the secret', () => {
    expect(isToken('a7.k0001')).toBe(true)
    expect(isToken('a7')).toBe(false)
    expect(isToken('b7.k0001')).toBe(false)
    expect(isToken(undefined)).toBe(false)
  })
})

describe('the claim, as needClaim and needOpen refuse', () => {
  const assignment = { id: 'a2', role: 'writer', task: 't1', parent: { _tag: 'GivenByPerson' }, end: { _tag: 'NotEnded' } }
  const roles = new Map([
    ['writer', { _tag: 'Model', tier: 'low' }],
    ['section-lead', { _tag: 'Model', tier: 'medium' }],
  ])
  const fail = async (effect: Effect.Effect<void, unknown>) => failureOf(await Effect.runPromiseExit(effect))

  test('a writer that did not read its brief, in the words of report', async () => {
    const s = await harness.withWriter()
    const line = `report ${s.writer} --output=docs/tsd.md#introduction`
    const before = refusalOf((await s.p.agent(line)).err)
    const work = fakeWork({ workflow: { roles }, meta: new Map([['a2', { claim: { _tag: 'Free' } }]]) })
    expect(await fail(needClaim(work, assignment as never, s.writer))).toEqual({
      message: before.message,
      next: before.next,
    })
  })

  test('a low agent whose one unit is done is told to stop', async () => {
    const result = fakeWork({
      workflow: { roles },
      meta: new Map([['a2', { claim: { _tag: 'Free' } }]]),
      results: new Map([['r1', { by: 'a2' }]]),
    })
    expect(await fail(needClaim(result, { ...assignment, parent: { _tag: 'Parent', id: 'a1' } } as never, 'a2.k0002'))).toEqual({
      message: 'your unit is done; this assignment has no open brief',
      next: 'STOP: your parent continues. Run work brief a2.k0002 only if your parent gives you this token again',
    })
    // The same scan counts a review; a medium agent has no unit, so it only has no brief.
    const review = fakeWork({
      workflow: { roles },
      meta: new Map([['a2', { claim: { _tag: 'Free' } }]]),
      reviews: new Map([['v1', { by: 'a2' }]]),
    })
    expect((await fail(needClaim(review, assignment as never, 'a2.k0002'))).next).toStartWith('STOP: the person continues.')
    expect((await fail(needClaim(review, { ...assignment, role: 'section-lead' } as never, 'a2.k0002'))).message).toBe(
      'you have no brief in this attempt',
    )
  })

  test('a claim passes, and a finished assignment is refused', async () => {
    const claimed = fakeWork({ meta: new Map([['a2', { claim: { _tag: 'Held', since: 'x' } }]]) })
    await Effect.runPromise(needClaim(claimed, assignment as never, 'a2.k'))
    await Effect.runPromise(needOpen(claimed, assignment as never))
    expect(await fail(needOpen(claimed, { ...assignment, end: { _tag: 'Finished', when: 'x' } } as never))).toEqual({
      message: 'a2 is finished',
      next: 'do no more work for it; tell the person',
    })
    expect((await fail(needOpen(claimed, { ...assignment, end: { _tag: 'Finished', when: 'x' }, parent: { _tag: 'Parent', id: 'a1' } } as never))).next).toBe(
      'do no more work for it; tell your parent',
    )
  })
})
