// The files and the processes that a command touches. The live layers are small and real: they
// do what the old code did with node:fs and Bun.spawnSync, as Effects.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Context, Effect, Layer } from 'effect'
import { OutsideFailed } from '../domain/errors.ts'

// Files by absolute path. A missing file is a value (null), not a failure.
export class Files extends Context.Service<
  Files,
  {
    readonly read: (path: string) => Effect.Effect<string | null>
    readonly write: (path: string, text: string) => Effect.Effect<void, OutsideFailed>
    readonly kind: (path: string) => Effect.Effect<'file' | 'folder' | null>
    readonly size: (path: string) => Effect.Effect<number | null>
  }
>()('aristoteles/Files') {}

const kindOf = (path: string): 'file' | 'folder' | null => {
  if (!existsSync(path)) return null
  const s = statSync(path)
  return s.isFile() ? 'file' : s.isDirectory() ? 'folder' : null
}

export const FilesLive = Layer.succeed(Files, {
  read: (path) => Effect.sync(() => (kindOf(path) === 'file' ? readFileSync(path, 'utf8') : null)),
  write: (path, text) =>
    Effect.try({
      try: () => {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, text)
      },
      catch: (e) => new OutsideFailed({ system: 'files', message: String(e), next: null }),
    }),
  kind: (path) => Effect.sync(() => kindOf(path)),
  size: (path) => Effect.sync(() => (kindOf(path) === 'file' ? statSync(path).size : null)),
})

export interface Spawned {
  readonly code: number
  readonly out: string
  readonly err: string
  readonly timedOut: boolean
}

// An outside process with no shell: git, a role's program, tmux, the browser opener. The exit
// code is data; the caller says what a failure means.
export class Spawn extends Context.Service<
  Spawn,
  {
    readonly run: (
      argv: ReadonlyArray<string>,
      options?: {
        readonly cwd?: string
        readonly env?: Readonly<Record<string, string | undefined>>
        readonly timeoutMs?: number
        // Text for the process to read (git patch-id reads a diff).
        readonly stdin?: string
      },
    ) => Effect.Effect<Spawned>
  }
>()('aristoteles/Spawn') {}

export const SpawnLive = Layer.succeed(Spawn, {
  run: (argv, options = {}) =>
    Effect.sync(() => {
      const r = Bun.spawnSync([...argv], {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        // Always an env: with none, bun gives the child the env of its own start, and finds the
        // command on that PATH, so a later change of process.env (test/preload.js) does not count.
        env: { ...(options.env ?? process.env) },
        ...(options.timeoutMs ? { timeout: options.timeoutMs } : {}),
        ...(options.stdin !== undefined ? { stdin: Buffer.from(options.stdin) } : {}),
        stdout: 'pipe',
        stderr: 'pipe',
      })
      return {
        code: r.exitCode ?? -1,
        out: r.stdout.toString(),
        err: r.stderr.toString(),
        timedOut: r.exitedDueToTimeout === true,
      }
    }),
})
