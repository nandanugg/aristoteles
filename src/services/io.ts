// The outside of one CLI call, as services. main(argv, io) gets io from its caller (the bin, the
// server, a test) and turns it into these layers once; no other code reads io. Each service is
// one thing that the command may touch, so its effects show in its type.
import { Context, Effect, Layer } from 'effect'
import type { Time } from '../domain/ids.ts'

// The io of main, as test/harness.js, ui/act.js and bin/work.js build it. Its shape is the
// parity contract: the tests call main(argv, io) with exactly these members.
export interface WorkIo {
  readonly cwd: string
  readonly out: (text: string) => void
  readonly err: (text: string) => void
  readonly isTTY: boolean
  // 'ui': the person on the page of `work start`; absent: a terminal or an agent's shell.
  readonly channel?: string | undefined
  // The person's typed confirmation (accept, confirm...); undefined when nothing is typed.
  readonly readLine: (prompt?: string) => string | null | undefined
  // One reading of the clock. The fake clock of the tests moves one minute per reading, so a
  // command reads it exactly as often as the old CLI did (BUILD.md, parity notes).
  readonly now: () => string
  readonly gitUser: () => string
  readonly env?: Readonly<Record<string, string | undefined>> | undefined
  // The secret part of a new token. The fake one counts: k0001, k0002...
  readonly random: () => string
}

// The terminal of the caller: what it prints, and whether a person is there to confirm.
export class Terminal extends Context.Service<
  Terminal,
  {
    readonly out: (text: string) => Effect.Effect<void>
    readonly err: (text: string) => Effect.Effect<void>
    readonly isTTY: boolean
    readonly onPage: boolean
    readonly readLine: (prompt: string) => Effect.Effect<string | null>
  }
>()('aristoteles/Terminal') {}

// The dir of the call (the folder with aristoteles.yaml).
export class Dir extends Context.Service<Dir, { readonly cwd: string }>()('aristoteles/Dir') {}

export class Env extends Context.Service<
  Env,
  { readonly vars: Readonly<Record<string, string | undefined>> }
>()('aristoteles/Env') {}

// The clock. Each read is one reading of io.now().
export class Now extends Context.Service<Now, { readonly read: Effect.Effect<Time> }>()(
  'aristoteles/Now',
) {}

// The person at this machine: git user.name.
export class GitUser extends Context.Service<GitUser, { readonly name: Effect.Effect<string> }>()(
  'aristoteles/GitUser',
) {}

// The secret part of a new token.
export class Tokens extends Context.Service<Tokens, { readonly random: Effect.Effect<string> }>()(
  'aristoteles/Tokens',
) {}

export type IoServices = Terminal | Dir | Env | Now | GitUser | Tokens

// The services of one call, from its io.
export const layerOfIo = (io: WorkIo): Layer.Layer<IoServices> =>
  Layer.mergeAll(
    Layer.succeed(Terminal, {
      out: (text) => Effect.sync(() => io.out(text)),
      err: (text) => Effect.sync(() => io.err(text)),
      isTTY: io.isTTY,
      onPage: io.channel === 'ui',
      readLine: (prompt) => Effect.sync(() => io.readLine(prompt) ?? null),
    }),
    Layer.succeed(Dir, { cwd: io.cwd }),
    Layer.succeed(Env, { vars: io.env ?? {} }),
    Layer.succeed(Now, { read: Effect.sync(() => io.now() as Time) }),
    Layer.succeed(GitUser, { name: Effect.sync(() => io.gitUser()) }),
    Layer.succeed(Tokens, { random: Effect.sync(() => io.random()) }),
  )
