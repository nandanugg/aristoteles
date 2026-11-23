// main(argv, io) (frozen; package P7): one call of the work CLI (plan/rebuild/BUILD.md 3.1). It
// builds the Layers from io, decodes argv (a UsageError ends there), finds the token wherever it
// stands (N3), and then either reads (fold, read the outside, derive, render) or acts (dispatch,
// then render the words of the act from the new Work). No streams, no effects. Exit codes: 1 a
// refusal, 2 a usage mistake, 3 an outside failure or a damaged store, 70 a defect.
import { Cause, Effect, Exit } from 'effect'
import { UsageError } from '../../core/schema/index.ts'
import { Dir, Terminal, type WorkIo } from '../../core/services/index.ts'
import { loadWork } from '../../core/state/index.ts'
import { refusalLines } from '../words/index.ts'
import {
  ACT_OF,
  FLAGS,
  isCommandName,
  isToken,
  knownFlags,
  parseArgs,
  SWITCHES,
  takeToken,
  USAGE,
} from './args.ts'
import { isPerson } from './caller.ts'
import type { Call, Command, Commands } from './command.ts'
import { commands as activation } from './commands/activation.ts'
import { commands as acts } from './commands/acts.ts'
import { commands as directions } from './commands/directions.ts'
import { commands as onboard } from './commands/onboard.ts'
import { commands as rechecks } from './commands/recheck.ts'
import { commands as reads } from './commands/reads.ts'
import { commands as setup } from './commands/setup.ts'
import { commands as waits } from './commands/wait.ts'
import { refresh } from './refresh.ts'
import { layerOf } from './runtime.ts'

export type { WorkIo } from '../../core/services/index.ts'

const COMMANDS: Commands = {
  ...activation,
  ...setup,
  ...reads,
  ...directions,
  ...waits,
  ...rechecks,
  ...onboard,
  ...acts,
}

const usage = (message: string, next: string | null = null) =>
  Effect.fail(new UsageError({ message, next }))

// The mistakes of the command line itself, before any command runs.
const checkLine = (call: Call) =>
  Effect.gen(function* () {
    const { args, name, act } = call
    const first = args.broken[0]
    if (first !== undefined) {
      return yield* usage(
        `${first} is not a flag; a flag is --<lower-case words with dashes>=<value>, such as --max-attempts=2`,
        'run the command again with the flag written so',
      )
    }
    const known = knownFlags(name, act ?? undefined)
    const unknown = known && args.flags.map(([key]) => key).find((key) => !known.includes(key))
    if (known && unknown !== undefined) {
      return yield* usage(
        `work ${name}${act ? ` ${act}` : ''} has no flag --${unknown}; it reads ${known.length ? known.map((k) => `--${k}`).join(', ') : 'no flags'}`,
        'run the command again without that flag',
      )
    }
    const firstFlag = args.flags[0]
    if (!known && !Object.hasOwn(FLAGS, name) && firstFlag !== undefined) {
      return yield* usage(
        `work ${name} has no flag --${firstFlag[0]}; it reads no flags`,
        'run the command again without that flag',
      )
    }
    // Only a switch stands alone; every other flag carries a value.
    const bare = args.flags.find(([key, value]) => value === true && !SWITCHES.includes(key))
    if (bare) {
      return yield* usage(
        `--${bare[0]} needs a value: --${bare[0]}="<...>"`,
        'run the command again with the value',
      )
    }
  })

const attempt = (argv: ReadonlyArray<string>, commands: Commands) =>
  Effect.gen(function* () {
    const terminal = yield* Terminal
    const parsed = parseArgs(argv)
    const name = parsed.positional[0]
    if (!name || name === 'help') {
      yield* terminal.out(USAGE.join('\n'))
      return 0
    }
    if (!isCommandName(name)) {
      return yield* usage(`there is no command "${name}"; work help lists them`)
    }
    // N3: the token stands anywhere among the words; the command reads its words without it.
    const { token, rest } = takeToken(parsed.positional.slice(1))
    const args = { ...parsed, positional: rest }
    const call: Call = { argv, args, name, act: ACT_OF[name]?.(rest) ?? null, token }
    yield* checkLine(call)
    yield* refresh(name)
    const command: Command | undefined = commands[name]
    if (!command) return yield* Effect.die(`cli command ${name} is not built`)
    const lines = yield* command(call)
    yield* terminal.out(lines.join('\n'))
    return 0
  })

// A refusal of the adapter or a lookup ends with one next line that fits the caller.
const nextFor = (argv: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const token = argv.find((a) => isToken(a))
    if (token === undefined) {
      // Before the store, the onboarding status is what the person and the host read (O3).
      const { cwd } = yield* Dir
      const store = yield* Effect.result(Effect.scoped(loadWork(cwd)))
      if (store._tag === 'Success' && store.success._tag === 'NoStore') {
        return 'next: work onboard status shows what waits'
      }
      return (yield* isPerson)
        ? 'next: the page shows what waits for you'
        : 'next: an agent passes its token first, then runs work wait <token>'
    }
    return `next: run work wait ${token} and do the step it prints`
  })

const runCli = (argv: ReadonlyArray<string>, commands: Commands) => {
  const fail = (code: 1 | 2 | 3, message: string, next: string | null) =>
    Effect.gen(function* () {
      const terminal = yield* Terminal
      yield* terminal.err(`refused: ${message}`)
      const line = next ? `next: ${next}` : yield* nextFor(argv)
      if (line) yield* terminal.err(line)
      return code
    })
  return Effect.scoped(attempt(argv, commands)).pipe(
    Effect.catchTags({
      Refusal: (e) =>
        Effect.gen(function* () {
          const terminal = yield* Terminal
          for (const line of refusalLines(e)) yield* terminal.err(line)
          return 1
        }),
      Refused: (e) => fail(1, e.message, e.next),
      UsageError: (e) => fail(2, e.message, e.next),
      OutsideFailed: (e) => fail(3, e.message, e.next),
      StoreDamaged: (e) =>
        fail(
          3,
          `the store is damaged at e${e.seq}: ${e.issue}; the person restores the store from a copy`,
          null,
        ),
    }),
  )
}

export async function main(argv: ReadonlyArray<string>, io: WorkIo, overrides?: Commands): Promise<number> {
  const exit = await Effect.runPromiseExit(runCli(argv, overrides ? { ...COMMANDS, ...overrides } : COMMANDS).pipe(Effect.provide(layerOf(io))))
  if (Exit.isSuccess(exit)) return exit.value
  io.err(`bug: ${Cause.pretty(exit.cause)}`)
  return 70
}
