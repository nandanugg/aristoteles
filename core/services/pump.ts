// The pump of the terminals, as a service (plan/rebuild/BUILD.md 3.7). It stays an IO service: tmux
// on its own socket, one window per real agent, the output by control mode. The host's pane is the
// person's: the pump streams it to a page and types into it; it never starts, stops or restarts
// it, and only the page's resize button sets its size (ruling 2026-11-14). The live Layer is in
// adapters/live (the old pump's behavior); a test gives a fake.
import { Context, type Effect } from 'effect'
import type { OutsideFailed, SessionId } from '../schema/index.ts'
import type { TerminalReading } from '../schema/outside.ts'

export interface PumpStart {
  readonly command: string
  readonly env: Readonly<Record<string, string>>
  readonly cols: number
  readonly rows: number
}

// A pane of the person's tmux server that the pump streams.
export type PaneRef =
  | { readonly _tag: 'OwnWindow' } // a window that the pump made
  | { readonly _tag: 'PersonPane'; readonly socket: string; readonly pane: string }

export class Pump extends Context.Service<
  Pump,
  {
    // A refusal of tmux (a bad session id, a session with a terminal, the person's own pane) is
    // an OutsideFailed with the old words.
    readonly start: (session: SessionId, start: PumpStart) => Effect.Effect<void, OutsideFailed>
    readonly resume: (session: SessionId, start: PumpStart) => Effect.Effect<void, OutsideFailed>
    readonly input: (session: SessionId, text: string) => Effect.Effect<void, OutsideFailed>
    readonly enter: (session: SessionId) => Effect.Effect<void, OutsideFailed>
    readonly stop: (session: SessionId) => Effect.Effect<void, OutsideFailed>
    readonly status: Effect.Effect<Readonly<Record<string, TerminalReading>>>
    readonly tail: (session: SessionId, lines: number) => Effect.Effect<string>
    readonly adopt: (session: SessionId, socket: string, pane: string) => Effect.Effect<void>
    readonly release: (session: SessionId) => Effect.Effect<void>
    readonly paneOf: (session: SessionId) => Effect.Effect<PaneRef>
    // The clock time (ms) of the person's last key in their own pane's tmux session (a client's
    // activity; the pump's own typing moves none); 0 for a window of the pump, or no client.
    readonly keysAt: (session: SessionId) => Effect.Effect<number>
  }
>()('aristoteles/Pump') {}
