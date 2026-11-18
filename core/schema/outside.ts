// What the outside says at one time: the terminals, the markers
// (plan/rebuild/BUILD.md D4). A derived function reads no file and runs no process: the Readings
// service (core/services/readings.ts) fills this record before the derive, and the derive reads
// only its arguments. The CLI has no terminals: an empty record.

// The pump's view of one terminal: its pane runs, or it exited with its status (null: unknown).
// lastOutput is the clock time (ms) of the last output; 0 when none.
export type TerminalReading =
  | { readonly _tag: 'Live'; readonly lastOutput: number }
  | { readonly _tag: 'Ended'; readonly exit: number | null; readonly lastOutput: number }

// The marker of an actor's `work wait`: waits is a live wait process with a fresh beat; beat is
// the time (ms) of its last beat, or of its return.
export interface WaitMarker {
  readonly actor: string
  readonly session: string | null
  readonly waits: boolean
  readonly beat: number
}

export interface Outside {
  readonly cwd: string
  // The terminals of the pump by session; {} in the CLI.
  readonly terminals: Readonly<Record<string, TerminalReading>>
  // The markers of `work wait` in this dir (adapters/live/waiting.ts), read alike by the CLI, the
  // server and the watcher (P8).
  readonly markers: ReadonlyArray<WaitMarker>
}
