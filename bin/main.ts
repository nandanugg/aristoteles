// One process of `work`: `work start` serves the page of the dir (adapters/web), and any other
// command is one call of the CLI on the real terminal (adapters/cli). The dir is WORK_DIR, or the
// nearest folder above the current one with an aristoteles.yaml. bin/work.js runs this file as a
// CommonJS bundle (for its bytecode), so nothing here awaits at the top level.
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { runOnTerminal } from '../adapters/cli/bin.ts'

const dirOf = (start: string): string => {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'aristoteles.yaml'))) return dir
    if (dirname(dir) === dir) return start
  }
}

const run = async (argv: ReadonlyArray<string>, dir: string): Promise<number> => {
  if (argv[0] !== 'start') return runOnTerminal(argv, dir)
  // The page's code loads only for `work start`.
  const { startCommand } = await import('../adapters/web/start.ts')
  return startCommand(dir, argv, process.env)
}

run(process.argv.slice(2), process.env.WORK_DIR ?? dirOf(process.cwd())).then((code) => {
  process.exitCode = code
})
