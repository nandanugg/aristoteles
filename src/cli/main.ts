// One call: decode the command line, refresh the company directions, run the command, and print.
// main and nextFor. Every expected failure ends here: "refused: <message>", then "next: <next>"
// (or the next line that fits the caller, nextFor), and its exit code (card 8):
//   1 a refusal (Refused), 2 a mistake in the command line (UsageError),
//   3 an outside failure or a damaged store (OutsideFailed, StoreDamaged).
//   A defect is not caught here: src/cli.ts prints "bug: ..." and exits 70.
import { join } from 'node:path'
import { Effect } from 'effect'
import { UsageError } from '../domain/errors.ts'
import { notBuilt } from '../domain/stub.ts'
import { LOCK } from '../files/company.ts'
import { Dir, Terminal } from '../services/io.ts'
import { Files } from '../services/outside.ts'
import {
  ACT_OF,
  FLAGS,
  knownFlags,
  parseArgs,
  SWITCHES,
  TOKEN_AFTER_ACT,
  USAGE,
  withoutName,
} from './args.ts'
import { agentOf, isPerson, isToken, tierOf } from './caller.ts'
import { type Call, type CliServices, type Commands, isCommandName } from './command.ts'
import { commands as directions } from './commands/directions.ts'
import { commands as reads } from './commands/reads.ts'
import { commands as setup } from './commands/setup.ts'
import { commands as tasks } from './commands/tasks.ts'
import { commands as ui } from './commands/ui.ts'
import { commands as work } from './commands/work.ts'
import { refreshCompany } from './refresh.ts'
import { readWork } from './run.ts'

// The registry: each command package fills its own file; nobody edits this list.
export const COMMANDS: Commands = { ...setup, ...ui, ...reads, ...tasks, ...work, ...directions }

const usage = (message: string, next: string | null = null) =>
  Effect.fail(new UsageError({ message, next }))

// The mistakes of the command line itself, in the old order, before any command runs.
const checkLine = (call: Call, tokenAt: number) =>
  Effect.gen(function* () {
    const { args, name, act } = call
    if (args.positional.some((word, i) => i !== tokenAt && isToken(word))) {
      return yield* usage(
        `a token goes right after work ${name}${tokenAt ? ` ${args.positional[0]}` : ''}, before the other words`,
        'run the command again with the token there',
      )
    }
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
    // Only a switch stands alone; every other flag carries a value (a bare --reason was read as
    // true, and the command failed on it as if it were a refusal).
    const bare = args.flags.find(([key, value]) => value === true && !SWITCHES.includes(key))
    if (bare) {
      return yield* usage(`--${bare[0]} needs a value: --${bare[0]}="<...>"`, 'run the command again with the value')
    }
  })

// The first command of a day refreshes the company directions, after init made a store.
const refresh = (name: string) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    if (name === 'init' || (yield* (yield* Files).kind(join(cwd, LOCK))) === null) return
    const terminal = yield* Terminal
    for (const note of yield* refreshCompany) yield* terminal.err(note)
  })

const attempt = (argv: ReadonlyArray<string>) =>
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
    const args = withoutName(parsed)
    // The token goes right after the command and its act word, where each command reads it; the
    // checks of every act read it from the same place, so both agree on who acts.
    const tokenAt = TOKEN_AFTER_ACT.includes(name) ? 1 : 0
    const word = args.positional[tokenAt]
    const call: Call = {
      argv,
      args,
      name,
      act: ACT_OF[name]?.(args.positional) ?? null,
      token: isToken(word) ? word : null,
    }
    yield* checkLine(call, tokenAt)
    yield* refresh(name)
    const command = COMMANDS[name]
    if (!command) return yield* notBuilt(`cli command ${name}`)
    const lines = yield* command(call)
    yield* terminal.out(lines.join('\n'))
    return 0
  })

// A refusal ends with one next line that fits the caller. A failed read of the token (or a store
// that does not open) says to check the token.
const nextFor = (argv: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const token = argv.find((a) => /^a\d+\.[a-z0-9]+$/.test(a))
    if (token === undefined) {
      return (yield* isPerson)
        ? 'next: work waiting shows what waits for you'
        : 'next: check the ids with work status or work log; an agent passes its token first'
    }
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const { work: now } = yield* readWork
        const a = yield* agentOf(now, token)
        return tierOf(now, a) === 'low'
          ? `next: do not try other commands; run work escalate ${token} --reason="<the refusal, and what you tried>"`
          : `next: work next ${token} lists the steps that are ready`
      }),
    ).pipe(
      Effect.catch(() =>
        Effect.succeed('next: check the token that your parent gave you; if it is wrong, tell your parent'),
      ),
    )
  })

export const runCli = (argv: ReadonlyArray<string>): Effect.Effect<number, never, CliServices> => {
  const fail = (code: 1 | 2 | 3, message: string, next: string | null) =>
    Effect.gen(function* () {
      const terminal = yield* Terminal
      yield* terminal.err(`refused: ${message}`)
      const line = next ? `next: ${next}` : yield* nextFor(argv)
      if (line) yield* terminal.err(line)
      return code
    })
  return Effect.scoped(attempt(argv)).pipe(
    Effect.catchTags({
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
