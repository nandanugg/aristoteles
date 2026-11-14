// `work start`: the UI of a dir, in the browser (Nanda, 2026-11-11). One server for each dir: a
// second start in the same dir opens the page of the server that runs. The record of a running
// server (its port, process and key) lives beside the store, outside the dir, because the agents
// work in the dir.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dbPath } from '../../core/services/index.ts'
import type { DetachedOptions, Env, Pump } from './frozen.ts'
import { excludeFromGit } from './git-exclude.ts'
import { createPump } from './pump.ts'
import { type ServerHandle, startServer } from './server.ts'
import { linkSkills } from './skills.ts'
import { createWatcher } from './watcher.ts'

// The file that records the running server of a dir (port, pid, key).
export const recordOf = (dir: string, env: Env): string =>
  join(
    dirname(dbPath(env)),
    'ui',
    `${createHash('sha256').update(dir).digest('hex').slice(0, 16)}.json`,
  )

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const openBrowser = (url: string) =>
  Bun.spawn([process.platform === 'darwin' ? 'open' : 'xdg-open', url], {
    stdout: 'ignore',
    stderr: 'ignore',
  })

// The address of the server of the dir that runs now, from its record; undefined: none runs.
const runningUrl = async (dir: string, record: string): Promise<string | undefined> => {
  if (!existsSync(record)) return undefined
  const running = JSON.parse(readFileSync(record, 'utf8')) as {
    readonly port: number
    readonly pid: number
    readonly key: string
  }
  if (!alive(running.pid)) return undefined
  try {
    const health = (await (await fetch(`http://127.0.0.1:${running.port}/health`)).json()) as {
      readonly dir?: string
    }
    return health.dir === dir ? `http://127.0.0.1:${running.port}/?key=${running.key}` : undefined
  } catch {
    // The process is not our server (or it does not answer): start a new one.
    return undefined
  }
}

// work start --detach (Nanda, 2026-11-13): the host starts the UI from its own shell, and the UI
// must outlive that shell. The server runs as its own process group, and its words go to a log
// beside its record; this waits until the server writes its record, and says its address.
export const workStartDetached = async (
  dir: string,
  options: DetachedOptions = {},
): Promise<boolean> => {
  const env = options.env ?? process.env
  const out = options.out ?? console.log
  const record = recordOf(dir, env)
  const already = await runningUrl(dir, record)
  if (already) {
    out(`the UI of ${dir} runs already: ${already}`)
    return true
  }
  const log = record.replace(/\.json$/, '.log')
  mkdirSync(dirname(record), { recursive: true })
  const words = openSync(log, 'a')
  // The CLI of this copy of aristoteles, whatever process calls this.
  const cli = join(import.meta.dir, '..', '..', 'bin', 'work.js')
  const child = spawn(process.execPath, [cli, 'start'], {
    cwd: dir,
    env: { ...env, WORK_DIR: dir },
    detached: true,
    stdio: ['ignore', words, words],
  })
  child.unref()
  for (let waited = 0; waited < 20000; waited += 100) {
    await Bun.sleep(100)
    const url = await runningUrl(dir, record)
    if (url) {
      out(`the UI of ${dir}: ${url}`)
      out(`it runs on its own (process ${child.pid}); its words go to ${log}`)
      return true
    }
    if (child.exitCode !== null) break
  }
  out(`the UI of ${dir} did not start; its words are in ${log}`)
  return false
}

// `work start [--detach]` from a shell, with its exit code. The page acts as the person, so the
// terminal of a real agent does not start it. The host that the person triggered starts it with
// --detach, so that it outlives the host's shell.
export const startCommand = async (
  dir: string,
  argv: ReadonlyArray<string>,
  env: Env,
): Promise<number> => {
  const session = env.ARISTOTELES_SESSION
  if (session) {
    process.stderr.write(
      `refused: a real agent runs in this terminal (session ${session}); the host starts the UI\n`,
    )
    return 1
  }
  if (argv.includes('--detach')) return (await workStartDetached(dir, { env })) ? 0 : 3
  await workStart(dir, { env })
  return 0
}

export const workStart = async (
  dir: string,
  options: {
    readonly env?: Env
    readonly out?: (line: string) => void
    readonly open?: boolean
    readonly port?: number
  } = {},
): Promise<ServerHandle | undefined> => {
  const env = options.env ?? process.env
  const out = options.out ?? console.log
  const open = options.open ?? !env.WORK_NO_OPEN
  const port = options.port ?? Number(env.WORK_PORT ?? 0)
  const record = recordOf(dir, env)
  const running = await runningUrl(dir, record)
  if (running) {
    out(`the UI of ${dir} runs already: ${running}`)
    if (open) openBrowser(running)
    return undefined
  }
  for (const line of linkSkills(dir)) out(line)
  // The worktrees and the logs of the agents belong to this machine (git-exclude.ts).
  const excluded = excludeFromGit(dir, ['.work/'])
  if (excluded.length) out(`git of the dir excludes ${excluded.join(', ')}`)
  // The terminals need tmux; without it the page still shows the record.
  let pump: Pump | undefined
  try {
    pump = createPump({ dir })
  } catch (error) {
    out(`no terminals: ${error instanceof Error ? error.message : String(error)}`)
  }
  const watcher = pump
    ? createWatcher({ dir, env, pump, log: (line) => out(`watcher: ${line}`) })
    : undefined
  const server = startServer({
    dir,
    env,
    port,
    ...(pump ? { pump } : {}),
    ...(watcher ? { watcher } : {}),
  })
  mkdirSync(dirname(record), { recursive: true })
  writeFileSync(
    record,
    JSON.stringify({ dir, port: server.port, pid: process.pid, key: server.key }),
    { mode: 0o600 },
  )
  const stop = () => {
    server.stop()
    rmSync(record, { force: true })
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  out(`the UI of ${dir}: ${server.url}`)
  out('stop it with Ctrl-C; the terminals of the agents keep running in tmux.')
  if (open) openBrowser(server.url)
  return server
}
