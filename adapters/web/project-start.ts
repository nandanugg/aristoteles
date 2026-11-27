import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Effect, Schema } from 'effect'
import { readOpenProject } from '../../core/actions/staff-session.ts'
import { dbPath, digest, projectLock, withProjectEnv } from '../../core/services/project.ts'
import { openProjectJournal, PROJECT_FORMAT } from '../../core/services/project.ts'
import { projectDirectoryAt } from '../live/activation.ts'
import { excludeFromGit } from '../live/git-exclude.ts'
import { startProjectServer } from './project-server.ts'
import { linkProjectSkills } from './project-skills.ts'

const ServerPid = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand('ServerPid'))
const ServerPort = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })).pipe(Schema.brand('ServerPort'))
const launchFile = Schema.Struct({ pid: ServerPid, port: ServerPort })

export const startProjectCommand = async (
  dir: string, argv: readonly string[], env: Readonly<Record<string, string | undefined>>,
): Promise<0 | 1 | 3> => {
  if (env.ARISTOTELES_SESSION || env.ARISTOTELES_TOKEN || argv.slice(1).some((flag) => flag !== '--detach') || argv.length > 2) {
    process.stderr.write('Start the Project page from the owner’s terminal.\n')
    return 1
  }
  const ready = await Effect.runPromise(Effect.scoped(openProjectJournal(projectDirectoryAt(dir), 'Read').pipe(
    Effect.flatMap(readOpenProject),
    withProjectEnv(env),
    Effect.result,
  )))
  if (ready._tag === 'Failure') {
    process.stderr.write(`${ready.failure.code} · ${ready.failure.why}\n`)
    return 1
  }
  const database = resolve(dir, dbPath(env))
  const record = join(dirname(database), 'project-ui', digest(dir + '\0' + database) + '.json')
  const running = async () => {
    try {
      const saved = Schema.decodeUnknownSync(launchFile)(JSON.parse(readFileSync(record, 'utf8')))
      process.kill(saved.pid, 0)
      const url = new URL(`http://127.0.0.1:${saved.port}/`)
      const response = await fetch(new URL('health', url), { signal: AbortSignal.timeout(500) })
      const health = Schema.decodeUnknownSync(Schema.Struct({ dir: Schema.String, format: Schema.Literal(PROJECT_FORMAT) }))(await response.json())
      return response.ok && health.dir === dir ? url : null
    } catch { return null }
  }
  const report = (url: URL) => process.stdout.write(`Project page ${url.href}\n`)
  const previous = await running()
  if (previous) { report(previous); return 0 }
  mkdirSync(dirname(record), { recursive: true, mode: 0o700 })
  if (argv.includes('--detach')) {
    const log = openSync(record + '.log', 'a', 0o600)
    const child = spawn(process.execPath, [join(import.meta.dir, '..', '..', 'bin', 'work.js'), 'start'], {
      cwd: dir, env: { ...env, WORK_DIR: dir, WORK_NO_OPEN: '1' }, detached: true, stdio: ['ignore', log, log],
    })
    closeSync(log)
    child.unref()
    for (let i = 0; i < 100; i++) {
      await Bun.sleep(100)
      const url = await running()
      if (url) { report(url); return 0 }
      if (child.exitCode !== null) break
    }
    process.stderr.write('The Project page could not start.\n')
    return 3
  }
  const started = await Effect.runPromise(Effect.scoped(Effect.andThen(projectLock(dir), Effect.tryPromise(async () => {
    const existing = await running()
    if (existing) { report(existing); return 0 as const }
    linkProjectSkills(dir)
    excludeFromGit(dir, ['.work/'])
    const server = await startProjectServer(dir, env, Number(env.WORK_PORT ?? 0))
    writeFileSync(record, JSON.stringify({ pid: process.pid, port: Number(server.url.port) }), { mode: 0o600 })
    const stop = () => {
      server.stop()
      try {
        const owned = Schema.decodeUnknownSync(launchFile)(JSON.parse(readFileSync(record, 'utf8')))
        if (owned.pid === process.pid) unlinkSync(record)
      } catch {}
    }
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
    report(server.url)
    if (!env.WORK_NO_OPEN) {
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
      if (Bun.which(opener)) Bun.spawn([opener, server.url.href], { stdout: 'ignore', stderr: 'ignore' })
    }
    return 0 as const
  }))).pipe(Effect.result))
  if (started._tag === 'Success') return started.success
  process.stderr.write('The Project page could not start.\n')
  return 3
}
