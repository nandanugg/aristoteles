// `work start` (PORT of ui/start.js): the UI of a dir, in the browser (Nanda, 2026-11-11). One
// server for each dir: a second start in the same dir opens the page of the server that runs. The
// record of a running server (its port, process and key) lives beside the store, outside the dir,
// because the agents work in the dir.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dbPath } from '../store/path.ts'
import { excludeFromGit } from './git-exclude.ts'
import { createPump, type Pump } from './pump.ts'
import { type ServerHandle, startServer } from './server.ts'
import { linkSkills } from './skills.ts'
import { createWatcher, type Watcher } from './watcher.ts'

type Env = Readonly<Record<string, string | undefined>>

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
  if (existsSync(record)) {
    const running = JSON.parse(readFileSync(record, 'utf8')) as {
      readonly port: number
      readonly pid: number
      readonly key: string
    }
    if (alive(running.pid)) {
      try {
        const health = (await (await fetch(`http://127.0.0.1:${running.port}/health`)).json()) as {
          readonly dir?: string
        }
        if (health.dir === dir) {
          const url = `http://127.0.0.1:${running.port}/?key=${running.key}`
          out(`the UI of ${dir} runs already: ${url}`)
          if (open) openBrowser(url)
          return undefined
        }
      } catch {
        // The process is not our server (or it does not answer): start a new one.
      }
    }
  }
  for (const line of linkSkills(dir)) out(line)
  // The worktrees and the logs of the agents belong to this machine (git-exclude.ts).
  const excluded = excludeFromGit(dir, ['.work/'])
  if (excluded.length) out(`git of the dir excludes ${excluded.join(', ')}`)
  // The terminals need tmux; without it the page still shows the record.
  let pump: Pump | undefined
  let watcher: Watcher | undefined
  try {
    pump = createPump({ dir })
  } catch (error) {
    out(`no terminals: ${error instanceof Error ? error.message : String(error)}`)
  }
  // The watcher reads the state of the server, which exists only after the server starts.
  let readState: ReturnType<typeof startServer>['readState'] = () => undefined
  if (pump) {
    watcher = createWatcher({
      dir,
      env,
      pump,
      readState: () => readState(),
      log: (line) => out(`watcher: ${line}`),
    })
  }
  const server = startServer({
    dir,
    env,
    port,
    ...(pump ? { pump } : {}),
    ...(watcher ? { watcher } : {}),
  })
  readState = server.readState
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
