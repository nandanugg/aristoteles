// An act of the person from the UI: main() in this process, on the ui channel (a port of
// ui/act.js). The server proves the person with the key of `work start`; its process is the
// person's own, so its environment has no ARISTOTELES_SESSION.
import { randomBytes } from 'node:crypto'
import { main } from '../cli.ts'

export interface ActOutcome {
  readonly code: number
  readonly out: string
  readonly err: string
}

export const tokenSecret = () =>
  [...randomBytes(26)].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')

export async function personAct(
  dir: string,
  env: Readonly<Record<string, string | undefined>> | undefined,
  argv: ReadonlyArray<string>,
  options: { readonly typed?: string; readonly now?: () => string } = {},
): Promise<ActOutcome> {
  const { ARISTOTELES_SESSION: _session, ...clean } = env ?? {}
  const out: string[] = []
  const err: string[] = []
  const code = await main(argv, {
    cwd: dir,
    env: clean,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    isTTY: false,
    channel: 'ui',
    readLine: () => options.typed,
    now: options.now ?? (() => new Date().toISOString()),
    // env: git is found on the PATH of process.env (Spawn in src/services/outside.ts).
    gitUser: () =>
      Bun.spawnSync(['git', '-C', dir, 'config', 'user.name'], { env: process.env })
        .stdout.toString()
        .trim(),
    random: tokenSecret,
  })
  return { code, out: out.join('\n'), err: err.join('\n') }
}
