import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { runProjectCli } from '../adapters/cli/project.ts'

const dirOf = (start: string): string => {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'aristoteles.yaml'))) return dir
    if (dirname(dir) === dir) return start
  }
}

const run = async (argv: readonly string[], dir: string) => {
  const db = process.env.ARISTOTELES_DB
  const env = db === undefined ? process.env : { ...process.env, ARISTOTELES_DB: resolve(dir, db) }
  if (argv[0] === 'start') {
    const { startProjectCommand } = await import('../adapters/web/project-start.ts')
    return startProjectCommand(dir, argv, env)
  }
  return runProjectCli(argv, {
    cwd: dir, env,
    out: (line) => process.stdout.write(line + '\n'),
    err: (line) => process.stderr.write(line + '\n'),
    isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    gitUser: () => Bun.spawnSync(['git', 'config', 'user.name'], { cwd: dir }).stdout.toString().trim(),
  })
}

run(process.argv.slice(2), resolve(process.env.WORK_DIR ?? dirOf(process.cwd()))).then((code) => {
  process.exitCode = code
})
