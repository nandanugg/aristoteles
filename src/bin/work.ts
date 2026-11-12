#!/usr/bin/env bun
// The work CLI on a real terminal: real files, clock, git user and random tokens. The dir is
// WORK_DIR, or the nearest folder above the current one with an aristoteles.yaml.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { main } from '../cli.ts'
import { tokenSecret } from '../ui/act.ts'

const project = (start: string): string => {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'aristoteles.yaml'))) return dir
    if (dirname(dir) === dir) return start
  }
}

const cwd = process.env.WORK_DIR ?? project(process.cwd())
if (process.argv[2] === 'start') {
  // The UI acts as the person: a real agent's terminal does not start it.
  if (process.env.ARISTOTELES_SESSION) {
    process.stderr.write(
      `refused: a real agent runs in this terminal (session ${process.env.ARISTOTELES_SESSION}); the person starts the UI\n`,
    )
    process.exit(1)
  }
  const { workStart } = await import('../ui/start.ts')
  await workStart(cwd, { env: process.env })
} else {
  process.exitCode = await main(process.argv.slice(2), {
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
}
