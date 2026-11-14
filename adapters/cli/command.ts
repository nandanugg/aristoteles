// The shape of a command. A command gets the decoded call and returns the lines that main prints,
// or fails with an expected error: a Refusal of an action, or a Refused / UsageError /
// OutsideFailed / StoreDamaged of the adapter or the services.
import type { Effect, Scope } from 'effect'
import type { Refusal } from '../../core/schema/errors.ts'
import type { Expected } from '../../core/schema/index.ts'
import type {
  Files,
  IoServices,
  Readings,
  Spawn,
  Store,
} from '../../core/services/index.ts'
import type { Args, CommandName } from './args.ts'

export type CliServices = IoServices | Files | Spawn | Store | Readings

// One call, decoded once. The token is taken out of the words wherever it stood (N3).
export interface Call {
  readonly argv: ReadonlyArray<string>
  // The words and flags after the command name, with no token.
  readonly args: Args
  readonly name: CommandName
  // The act word of a command with several acts (task open, review accept), or null.
  readonly act: string | null
  readonly token: string | null
}

export type Command = (
  call: Call,
) => Effect.Effect<ReadonlyArray<string>, Expected | Refusal, CliServices | Scope.Scope>
export type Commands = { readonly [K in CommandName]?: Command }
