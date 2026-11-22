// Who calls: the person checks and the work token checks, each with its words.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Exit } from 'effect'
import type { Work } from '../../core/schema/index.ts'
import { type IoServices, layerOfIo, sha, type WorkIo } from '../../core/services/index.ts'
import type { WorkFolded } from '../../core/state/c16/fold.ts'
import { isToken } from './args.ts'
import { personAuthor, personOf, verifyWork, workTokenOf } from './caller.ts'
import { main } from './main.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harnessJs from '../../test/harness.js'

// @ts-expect-error fixture helpers are JavaScript
import { staffedFixture } from '../../test/staffing-fixture.js'

const harness = harnessJs as { readonly WORK_YAML: string }

interface Options {
  readonly tty?: boolean
  readonly typed?: string
  readonly channel?: string
  readonly env?: Readonly<Record<string, string>>
  readonly git?: string
}

// A dir with the aristoteles.yaml of the harness, and no store.
const makeDir = (): string => {
  const dir = join(mkdtempSync(join(tmpdir(), 'work-cli-')), 'report-export')
  mkdirSync(dir, { recursive: true })
  const pair = staffedFixture(harness.WORK_YAML)
  writeFileSync(join(dir, 'aristoteles.yaml'), pair.config)
  mkdirSync(join(dir, '.work'))
  writeFileSync(join(dir, '.work/staffing.yaml'), pair.staffing)
  return dir
}

// The io of one call, and what the call did with it: its words, its clock readings, its prompts.
const ioOf = (dir: string, options: Options = {}) => {
  const out: Array<string> = []
  const err: Array<string> = []
  const prompts: Array<string> = []
  let clock = 0
  const io: WorkIo = {
    cwd: dir,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    isTTY: options.tty ?? false,
    channel: options.channel,
    readLine: (prompt) => {
      prompts.push(prompt ?? '')
      return options.typed
    },
    now: () => new Date(Date.UTC(2026, 9, 25, 9, clock++)).toISOString(),
    gitUser: () => options.git ?? 'Nanda',
    env: { ARISTOTELES_DB: join(dir, '.work', 'aristoteles.db'), ...options.env },
    random: () => 'k0001',
  }
  const seen = () => ({ out: out.join('\n'), err: err.join('\n'), clock, prompts })
  return { io, seen }
}
const runCli = async (dir: string, argv: ReadonlyArray<string>, options?: Options) => {
  const { io, seen } = ioOf(dir, options)
  const code = await main(argv, io)
  return { code, ...seen() }
}
const runEffect = async <A, E>(
  effect: Effect.Effect<A, E, IoServices>,
  dir: string,
  options?: Options,
) => {
  const { io, seen } = ioOf(dir, options)
  const exit = await Effect.runPromiseExit(Effect.provide(effect, layerOfIo(io)))
  return { exit, io: seen() }
}
// The refusal of a failed effect: its message and its next line.
const failureOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isSuccess(exit)) throw new Error(`expected a failure, got ${JSON.stringify(exit.value)}`)
  const error = exit.cause.reasons.find((r) => r._tag === 'Fail')?.error as
    | { readonly message: string; readonly next: string | null }
    | undefined
  if (!error) throw new Error('expected a Fail')
  return { message: error.message, next: error.next }
}
// A Work with only what the checks of the caller read.
const fakeWork = (parts: Record<string, unknown>): Work =>
  ({
    config: { people: ['Nanda'] },
    workflow: { roles: new Map() },
    assignments: new Map(),
    meta: new Map(),
    ...parts,
  }) as unknown as Work
// The refusal of the CLI as one pair: its message and its next line.
const refusalOf = (err: string) => {
  const [first = '', second] = err.split('\n')
  return { message: first.replace(/^refused: /, ''), next: second?.replace(/^next: /, '') ?? null }
}

const AN_AGENT = 'an agent passes its token first: work <command> <token> ...'

describe('the person, as init checks it', () => {
  test.each<[string, Options, string]>([
    [
      'a real agent runs in this terminal',
      { tty: true, env: { ARISTOTELES_SESSION: 's-host' } },
      'a real agent runs in this terminal (session s-host); a person command comes from the person',
    ],
    [
      'a call that is not at a terminal',
      {},
      'this is a person command; a person runs it at a terminal',
    ],
    [
      'GIT_CONFIG variables are set',
      { tty: true, env: { GIT_CONFIG_COUNT: '1' } },
      'GIT_CONFIG variables are set; a person command reads user.name from the git config ' +
        'files only',
    ],
  ])('%s', async (_name, options, message) => {
    const after = await runCli(makeDir(), ['init'], options)
    expect(after.code).toBe(1)
    expect(refusalOf(after.err).message).toBe(message)
    expect(after.clock).toBe(0)
  })

  test('the session is checked first, then the terminal, then GIT_CONFIG', async () => {
    const options: Options = { env: { ARISTOTELES_SESSION: 's', GIT_CONFIG_COUNT: '1' } }
    const after = await runCli(makeDir(), ['init'], options)
    expect(refusalOf(after.err)).toEqual({
      message:
        'a real agent runs in this terminal (session s); a person command comes from the person',
      next: AN_AGENT,
    })
  })

  test('a git user outside the people, in the words of init', async () => {
    const before = await runCli(makeDir(), ['init'], { tty: true, git: 'Mallory' })
    // switch 2026-11-14: the next line is the choice of the refusal (D10); the old one said
    // "work waiting shows what waits for you".
    expect(refusalOf(before.err)).toEqual({
      message: 'Mallory (git user.name) is not in the people of aristoteles.yaml',
      next: 'add Mallory to the people of aristoteles.yaml',
    })
    const options = { tty: true, git: 'Mallory' }
    const { exit } = await runEffect(personOf(fakeWork({})), makeDir(), options)
    expect(failureOf(exit).message).toBe(refusalOf(before.err).message)
  })

  test('the page is the person too, and a terminal with a name of the people passes', async () => {
    const ui = await runEffect(personAuthor(fakeWork({})), makeDir(), { channel: 'ui' })
    expect(Exit.isSuccess(ui.exit) && ui.exit.value).toEqual({
      _tag: 'Person',
      name: 'Nanda',
      channel: 'ui',
    })
    const tty = await runEffect(personAuthor(fakeWork({})), makeDir(), { tty: true })
    expect(Exit.isSuccess(tty.exit) && tty.exit.value).toEqual({
      _tag: 'Person',
      name: 'Nanda',
      channel: 'terminal',
    })
  })

  test('the people list is not read when there is no work yet (init)', async () => {
    const { exit } = await runEffect(personOf(undefined), makeDir(), { tty: true, git: 'Mallory' })
    expect(Exit.isSuccess(exit) && exit.value).toBe('Mallory')
  })
})

describe('the typed confirmation', () => {
  const confirm = { word: 'restore', show: 'restore aristoteles.yaml to the stored text' }

  test.each([['nope'], [undefined], ['']])('typed %p is refused', async (typed) => {
    const dir = makeDir()
    expect((await runCli(dir, ['init'], { tty: true })).code).toBe(0)
    const options: Options = { tty: true, ...(typed === undefined ? {} : { typed }) }
    const before = await runCli(dir, ['config', 'restore'], options)
    expect(before.err).toBe(
      'refused: not confirmed; nothing was stored\nnext: the page shows what waits for you',
    )
    expect(before.out).toBe('restore aristoteles.yaml to the stored text')
    expect(before.prompts).toEqual(['Type "restore" to confirm: '])
    // The check alone shows the same line first, and asks the same prompt.
    const after = await runEffect(personOf(fakeWork({}), confirm), dir, options)
    expect(failureOf(after.exit)).toEqual({
      message: 'not confirmed; nothing was stored',
      next: null,
    })
    expect(after.io.out).toBe(before.out)
    expect(after.io.prompts).toEqual(before.prompts)
  })

  test('the typed word is trimmed, and then it passes', async () => {
    const options = { tty: true, typed: '  restore ' }
    const after = await runEffect(personOf(fakeWork({}), confirm), makeDir(), options)
    expect(Exit.isSuccess(after.exit) && after.exit.value).toBe('Nanda')
  })
})

describe('a token', () => {
  test('is w.<actor>.<epoch>.<secret>; a7.<secret> is the old form, named to be refused', () => {
    expect(isToken('w.host.0.k0001')).toBe(true)
    expect(isToken('a7.k0001')).toBe(true)
    expect(isToken('a7')).toBe(false)
    expect(isToken('b7.k0001')).toBe(false)
    expect(isToken(undefined)).toBe(false)
  })
})

describe('the work token, as its epoch is checked', () => {
  const folded: WorkFolded = {
    state: undefined as never,
    ids: new Map(),
    hostSession: null,
    hostPane: null,
    forwards: [],
    tokens: new Map([
      ['host', [{ ep: 0, hash: sha('k0001') }]],
      ['role:dev.v2', [{ ep: 0, hash: sha('old') }, { ep: 1, hash: sha('new') }]],
    ]),
  }
  const check = async (token: string | null) =>
    (await runEffect(verifyWork(folded, token), makeDir())).exit

  test('the right secret gives the actor and the epoch, a role with a dot too', async () => {
    const a = await check('w.host.0.k0001')
    const b = await check(workTokenOf('role:dev.v2', 1, 'new'))
    expect<unknown>(Exit.isSuccess(a) && a.value).toEqual({ who: 'host', ep: 0 })
    expect<unknown>(Exit.isSuccess(b) && b.value).toEqual({ who: 'role:dev.v2', ep: 1 })
  })

  test('an old epoch verifies as that epoch', async () => {
    const exit = await check('w.role:dev.v2.0.old')
    expect<unknown>(Exit.isSuccess(exit) && exit.value).toEqual({ who: 'role:dev.v2', ep: 0 })
  })

  test.each<[string, string | null, string]>([
    [
      'no token',
      null,
      'this command needs your token (w.<actor>.<epoch>.<secret>), from the command that ' +
        'your parent gave you',
    ],
    ['a word', 'x', '"x" is not a work token (w.<actor>.<epoch>.<secret>)'],
    ['a wrong secret', 'w.host.0.nope', 'the token of host is wrong'],
    ['a secret of another epoch', 'w.role:dev.v2.1.old', 'the token of role:dev.v2 is wrong'],
    ['an epoch that was never made', 'w.host.1.k0001', 'the token of host is wrong'],
    ['an actor with no token', 'w.pipe.0.k0001', 'the token of pipe is wrong'],
  ])('%s is refused', async (_name, token, message) => {
    expect(failureOf(await check(token)).message).toBe(message)
  })
})
