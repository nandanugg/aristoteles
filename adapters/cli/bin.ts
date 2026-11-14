// The CLI on a real terminal: main (main.ts) with the real files, clock, git user and random
// tokens. bin/main.ts runs it for every command but `work start`.
import { tokenSecret } from '../live/index.ts'
import { main } from './main.ts'

export const runOnTerminal = (argv: ReadonlyArray<string>, cwd: string): Promise<number> =>
  main(argv, {
    cwd,
    env: process.env,
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    readLine: (prompt) => globalThis.prompt(prompt),
    now: () => new Date().toISOString(),
    gitUser: () => Bun.spawnSync(['git', 'config', 'user.name']).stdout.toString().trim(),
    random: tokenSecret,
  })
