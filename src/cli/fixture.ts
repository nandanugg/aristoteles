// What the unit tests of the CLI core share: a dir in a temp folder, an io with the fake clock of
// test/harness.js, and runCli on the same io with a store that holds nothing (the engine, the
// replay and the store are other packages).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import { refuse } from '../domain/errors.ts'
import type { Work } from '../domain/work.ts'
import { type WorkIo, layerOfIo } from '../services/io.ts'
import { FilesLive, SpawnLive } from '../services/outside.ts'
import { Store } from '../services/store.ts'
import { main } from '../cli.ts'
import { runCli } from './main.ts'
// The fixture of the integrated tests is plain JavaScript. A static import: a top-level await
// breaks the tests under bun test --parallel (bun 1.3.14).
// @ts-expect-error test/harness.js has no types
import * as harnessJs from '../../test/harness.js'

const harness = harnessJs as { readonly WORK_YAML: string }
export const WORK_YAML = harness.WORK_YAML

export interface Options {
  readonly tty?: boolean
  readonly typed?: string
  readonly channel?: string
  readonly env?: Readonly<Record<string, string>>
  readonly git?: string
}

export interface Result {
  readonly code: number
  readonly out: string
  readonly err: string
  // How often the call read the clock and the random secret, and what it asked the person.
  readonly clock: number
  readonly random: number
  readonly prompts: ReadonlyArray<string>
}

export const makeDir = (name = 'report-export'): string => {
  const dir = join(mkdtempSync(join(tmpdir(), 'work-cli-')), name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'aristoteles.yaml'), WORK_YAML)
  return dir
}

// The io of one call, and what the call did with it.
export const ioOf = (dir: string, options: Options = {}) => {
  const out: Array<string> = []
  const err: Array<string> = []
  const prompts: Array<string> = []
  const seen = { clock: 0, random: 0 }
  const io: WorkIo = {
    cwd: dir,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    isTTY: options.tty ?? false,
    channel: options.channel,
    readLine: (prompt) => {
      prompts.push(prompt ?? '')
      return options.typed
    },
    now: () => new Date(Date.UTC(2026, 9, 25, 9, seen.clock++)).toISOString(),
    gitUser: () => options.git ?? 'Nanda',
    env: { ARISTOTELES_DB: join(dir, '.work', 'aristoteles.db'), ...options.env },
    random: () => `k${String(++seen.random).padStart(4, '0')}`,
  }
  const result = (code: number): Result => ({
    code,
    out: out.join('\n').replaceAll(dir, '<project>'),
    err: err.join('\n').replaceAll(dir, '<project>'),
    clock: seen.clock,
    random: seen.random,
    prompts,
  })
  return { io, result }
}

// The store of a dir that was never made, as the store refuses it.
export const NO_STORE_NEXT =
  'run work in the dir that your parent named; a new dir starts with the person running work init next to its aristoteles.yaml'
const NoStore = Layer.succeed(Store, {
  path: '',
  open: (dir) => Effect.fail(refuse(`no work store in ${dir}`, NO_STORE_NEXT)),
})

// The whole CLI (main), on a real store file in the dir.
export const runReal = async (dir: string, argv: ReadonlyArray<string>, options?: Options) => {
  const { io, result } = ioOf(dir, options)
  return result(await main(argv, io))
}

export const layersOf = (io: WorkIo) =>
  Layer.mergeAll(layerOfIo(io), FilesLive, SpawnLive, NoStore)

export const runNew = async (dir: string, argv: ReadonlyArray<string>, options?: Options) => {
  const { io, result } = ioOf(dir, options)
  return result(await Effect.runPromise(runCli(argv).pipe(Effect.provide(layersOf(io)))))
}

// The words of a command line, split like a shell: "double quotes" keep spaces.
export const words = (line: string): ReadonlyArray<string> =>
  [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? '')

// A Work with only what the checks of the caller read; the engine and the replay build real ones.
export const fakeWork = (parts: Record<string, unknown>): Work =>
  ({
    config: { people: ['Nanda'] },
    workflow: { roles: new Map() },
    assignments: new Map(),
    meta: new Map(),
    results: new Map(),
    reviews: new Map(),
    ...parts,
  }) as unknown as Work

// One effect of the CLI core on the io of a call: what it gave or how it failed, and what the
// call printed and asked.
export const runEffect = async <A, E>(
  effect: Effect.Effect<A, E, import('../services/io.ts').IoServices>,
  dir: string,
  options?: Options,
) => {
  const { io, result } = ioOf(dir, options)
  const exit = await Effect.runPromiseExit(effect.pipe(Effect.provide(layerOfIo(io))))
  return { exit, io: result(0) }
}

// The error of a failed effect: its message and its next line.
export const failureOf = <A, E>(exit: import('effect').Exit.Exit<A, E>) => {
  if (exit._tag !== 'Failure') throw new Error(`expected a failure, got ${JSON.stringify(exit.value)}`)
  const error = exit.cause.reasons.find((r) => r._tag === 'Fail')?.error as
    | { readonly message: string; readonly next: string | null }
    | undefined
  if (!error) throw new Error(`expected a Fail, got ${String(exit.cause)}`)
  return { message: error.message, next: error.next }
}
