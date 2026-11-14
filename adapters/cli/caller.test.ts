// Who calls: the person checks and the agent checks, each with its words. The words are the ones
// that the old caller gave (pinned at the switch, 2026-11-14); a next line that changed says why.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Exit } from 'effect'
import type { Work } from '../../core/schema/index.ts'
import { type IoServices, layerOfIo, sha, type WorkIo } from '../../core/services/index.ts'
import { callerOf, isToken, personOf, verify } from './caller.ts'
import { main } from './main.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harnessJs from '../../test/harness.js'

interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}
interface Agent {
  readonly agent: (line: string) => Promise<Ran>
  readonly nanda: (line: string) => Promise<Ran>
  readonly write: (path: string, text: string) => void
}
const harness = harnessJs as {
  readonly WORK_YAML: string
  readonly INTRO_V2: string
  readonly ok: (r: Ran) => Ran
  readonly tokenIn: (text: string) => string
  readonly started: () => Promise<{ readonly p: Agent; readonly lead: string }>
  readonly withWriter: () => Promise<{ readonly p: Agent; readonly lead: string; writer: string }>
}
const { ok, tokenIn } = harness

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
  writeFileSync(join(dir, 'aristoteles.yaml'), harness.WORK_YAML)
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
    const ui = await runEffect(callerOf(fakeWork({}), null), makeDir(), { channel: 'ui' })
    expect(Exit.isSuccess(ui.exit) && ui.exit.value).toEqual({
      _tag: 'Person',
      name: 'Nanda',
      channel: 'ui',
    })
    const tty = await runEffect(callerOf(fakeWork({}), null), makeDir(), { tty: true })
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
      'refused: not confirmed; nothing was stored\nnext: work waiting shows what waits for you',
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

describe('the agent, as its token is checked', () => {
  const work: Work = fakeWork({
    assignments: new Map([['a1', { id: 'a1', role: 'architect', task: 't1' }]]),
    meta: new Map([['a1', { id: 'a1', secret: sha('k0001'), claim: { _tag: 'Free' } }]]),
  })

  test.each<[string, string | null, string]>([
    [
      'no token',
      null,
      'this command needs your assignment token (a7.<secret>), from the command that your ' +
        'parent gave you',
    ],
    ['a word', 'x', '"x" is not an assignment token (a7.<secret>)'],
    ['an id', 'a1', 'a1 is an id; the command needs the token that assign printed (a1.<secret>)'],
    ['a wrong secret', 'a1.wrong', 'the token of a1 is wrong'],
    ['an assignment that does not exist', 'a9.k0001', 'there is no assignment a9'],
  ])('%s', async (_name, token, message) => {
    const { exit } = await runEffect(verify(work, token), makeDir())
    expect(failureOf(exit).message).toBe(message)
  })

  test('the right token gives the assignment', async () => {
    const { exit } = await runEffect(verify(work, 'a1.k0001'), makeDir())
    expect<unknown>(Exit.isSuccess(exit) && exit.value.assignment).toBe('a1')
  })

  test('a token is a7. and then the secret', () => {
    expect(isToken('a7.k0001')).toBe(true)
    expect(isToken('a7')).toBe(false)
    expect(isToken('b7.k0001')).toBe(false)
    expect(isToken(undefined)).toBe(false)
  })
})

// The claim of a brief and the end of an assignment, in the words of the CLI. switch 2026-11-14:
// these are refusals of canAct now, and the next line of each is its choice (D10).
describe('the claim, as canAct refuses an agent act', () => {
  test('a writer that did not read its brief, in the words of report', async () => {
    const { p, writer } = await harness.withWriter()
    const line = `report ${writer} --output=docs/tsd.md#introduction`
    // The old next line: "work brief a2.k0002; it takes the snapshot that your work follows".
    expect(refusalOf((await p.agent(line)).err)).toEqual({
      message: 'you have no brief in this attempt',
      next: 'read your brief first; your work follows it',
    })
  }, 30000)

  test('a low agent whose one unit is done is told to stop', async () => {
    const { p, writer } = await harness.withWriter()
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', harness.INTRO_V2)
    const line = `report ${writer} --output=docs/tsd.md#introduction`
    ok(await p.agent(line))
    // The old next line: "STOP: your parent continues. Run work brief a2.k0002 only if your
    // parent gives you this token again".
    expect(refusalOf((await p.agent(line)).err)).toEqual({
      message: 'your unit is done; this assignment has no open brief',
      next: 'STOP: your parent continues, and gives you this token again if there is more',
    })
  }, 30000)

  test('a review is a unit too; a medium agent has no unit, so it only has no brief', async () => {
    const { p, lead, writer } = await harness.withWriter()
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', harness.INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    const point = '--point="ABC-2964 is a ticket id" --breaks=no-ticket-ids'
    const reject = `review ${linter} r1 reject ${point}`
    ok(await p.agent(reject))
    expect(refusalOf((await p.agent(reject)).err)).toEqual({
      message: 'your unit is done; this assignment has no open brief',
      next: 'STOP: your parent continues, and gives you this token again if there is more',
    })
    const second = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
    expect(refusalOf((await p.agent(`assign ${second} t1 --role=writer`)).err).message).toBe(
      'you have no brief in this attempt',
    )
  }, 30000)

  test('a finished assignment is refused, and the agent tells its parent', async () => {
    const { p, lead, writer } = await harness.withWriter()
    ok(await p.agent(`finish ${lead} a2`))
    expect(refusalOf((await p.agent(`brief ${writer}`)).err)).toEqual({
      message: 'a2 is finished',
      next: 'do no more work for it; tell your parent',
    })
  }, 30000)

  test('an assignment that the person gave tells the person', async () => {
    const { p } = await harness.started()
    const lead = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
    ok(await p.nanda('finish a2'))
    expect(refusalOf((await p.agent(`brief ${lead}`)).err)).toEqual({
      message: 'a2 is finished',
      next: 'do no more work for it; tell the person',
    })
  }, 30000)
})
