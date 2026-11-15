// What the outside says at one time: git, the files of the dir, the settings, the terminals
// (plan/rebuild/BUILD.md D4). A derived function reads no file and runs no process: the Readings
// service (core/services/readings.ts) fills this record before the derive, and the derive reads
// only its arguments. The CLI has no terminals: an empty record.
import type { AssignmentId, ResultId } from '../../src/domain/ids.ts'
import type { Work } from '../../src/domain/work.ts'

// The settings that a state reads (aristoteles.yaml; the defaults of src/config/settings.ts).
export interface OutsideSettings {
  readonly hostWaitMinutes: number
  readonly retryMinutes: number
  readonly outsideSourceHours: number
}

// A result made from a revision of a source that is no longer the one an agent recorded.
export interface StaleSource {
  readonly source: string
  readonly was: string
  readonly now: string
}

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
  readonly settings: OutsideSettings
  // The work of a result changed after its report (its digest now differs).
  readonly changed: ReadonlySet<ResultId>
  // A result made from an old revision of a source.
  readonly stale: ReadonlyMap<ResultId, StaleSource>
  // An accepted repo result whose commit is on its base already (git merge-base --is-ancestor).
  readonly onBase: ReadonlySet<ResultId>
  // The terminals of the pump by session; {} in the CLI.
  readonly terminals: Readonly<Record<string, TerminalReading>>
  // The markers of `work wait` in this dir (adapters/live/waiting.ts), read alike by the CLI, the
  // server and the watcher (P8): core/derived/liveness.ts says from them who is there.
  readonly markers: ReadonlyArray<WaitMarker>
  // The length of an assignment's brief as the CLI prints it (the page's Workflow.measure). The
  // adapter gives it, so that core imports no words.
  readonly measure: (work: Work, assignment: AssignmentId) => number
}
