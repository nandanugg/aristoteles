// The shape of a command, shared by the command packages (P6a, P6b, P6c). A command gets the
// decoded call and returns the lines that main prints, or fails with an expected error.
import type { Effect, Scope } from 'effect'
import type { Expected } from '../domain/errors.ts'
import type { IoServices } from '../services/io.ts'
import type { Files, Spawn } from '../services/outside.ts'
import type { Store } from '../services/store.ts'
import type { Args } from './args.ts'

export type CliServices = IoServices | Files | Spawn | Store

// Every command, so that a name with no command yet is "not built", and any other is unknown.
export const COMMAND_NAMES = [
  'init',
  'config',
  'role',
  'run',
  'problem',
  'event',
  'send',
  'session',
  'status',
  'waiting',
  'blockers',
  'next',
  'log',
  'search',
  'guide',
  'question',
  'result',
  'assignment',
  'evaluation',
  'task',
  'assign',
  'free',
  'finish',
  'brief',
  'report',
  'review',
  'recheck',
  'escalate',
  'resolve',
  'ask',
  'answer',
  'note',
  'evaluate',
  'checkpoint',
  'resume',
  'source',
  'direction',
  'suggest',
  'grant',
  'revoke',
  'forward',
  'confirm',
] as const
export type CommandName = (typeof COMMAND_NAMES)[number]
export const isCommandName = (word: string): word is CommandName =>
  (COMMAND_NAMES as ReadonlyArray<string>).includes(word)

// One call, decoded once (bug 8: the token is read from one place, and every check reads it).
export interface Call {
  readonly argv: ReadonlyArray<string>
  readonly args: Args
  readonly name: CommandName
  // The act word of a command with several acts (task open, review accept), or null.
  readonly act: string | null
  // The token right after the command and its act word, or null.
  readonly token: string | null
}

export type Command = (
  call: Call,
) => Effect.Effect<ReadonlyArray<string>, Expected, CliServices | Scope.Scope>
export type Commands = { readonly [K in CommandName]?: Command }
