// The types of the web entry points (plan/rebuild/BUILD.md D15): the pump, the watcher, the
// server and work start, which test/code.js gives to the integrated tests.
import type { Work } from '../../core/schema/index.ts'

export type Env = Readonly<Record<string, string | undefined>>

// --- the pump ------------------------------------------------------------------------------------

export interface PumpOptions {
  readonly dir: string
  readonly socket?: string
  readonly onOutput?: (session: string, bytes: Uint8Array) => void
  readonly onExit?: (session: string, status: number | null) => void
  readonly clock?: () => number
}

export interface TerminalStatus {
  readonly live: boolean
  readonly ended: boolean
  readonly exit: number | null
  readonly lastOutput: number
}

export interface StartOptions {
  readonly env?: Readonly<Record<string, string>>
  readonly cols?: number
  readonly rows?: number
}

export interface TerminalSize {
  readonly cols: number
  readonly rows: number
}

export interface Pump {
  readonly name: string
  readonly socket: string
  readonly dir: string
  // The listeners that the server adds; each gets every output.
  onOutputs: ReadonlyArray<(session: string, bytes: Uint8Array) => void>
  readonly start: (session: string, command: string, options?: StartOptions) => string
  readonly resume: (session: string, command: string, options?: StartOptions) => string
  readonly input: (session: string, text: string) => void
  readonly resize: (session: string, cols: number, rows: number) => void
  readonly stop: (session: string) => void
  readonly snapshot: (session: string) => Uint8Array
  readonly status: () => Readonly<Record<string, TerminalStatus>>
  readonly tail: (session: string, lines?: number) => string
  readonly adopt: (session: string, socket: string, pane: string) => void
  readonly release: (session: string) => void
  readonly paneOf: (session: string) => { readonly socket: string; readonly pane: string } | undefined
  readonly close: () => void
  readonly killServer: () => void
  // Fixed-size terminals (ruling 2026-11-14): the size of a terminal as tmux has it, the
  // listeners of each new size, and whether a page shows it now (its first tab, its last).
  readonly size: (session: string) => TerminalSize | undefined
  onSizes: ReadonlyArray<(session: string, size: TerminalSize) => void>
  readonly show: (session: string) => void
  readonly hide: (session: string) => void
}

// --- the watcher ---------------------------------------------------------------------------------

export interface WatcherTiming {
  readonly wakeGap: number
  readonly outputWindow: number
  readonly ready: number
  readonly retryGap: number
  readonly tick: number
  readonly enterPause: number
  readonly readyPause: number
}

export interface WatcherOptions {
  readonly dir: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly pump: Pump
  readonly log?: (line: string) => void
  readonly clock?: () => number
  readonly timing?: Partial<Pick<WatcherTiming, 'enterPause' | 'readyPause'>>
}

export interface Watcher {
  readonly tick: () => Promise<void>
  readonly stop: () => void
  readonly open: (proposal: string) => Promise<string>
  readonly stopSession: (session: string) => Promise<void>
  readonly resumeSession: (session: string, tier: string) => Promise<void>
  readonly fixed: (problem: string) => Promise<string>
  readonly close: (run: string, reason: string) => Promise<void>
}

// --- the server ----------------------------------------------------------------------------------

export interface ServerTools {
  readonly readState: () => Work | undefined
  readonly send: (message: unknown) => void
}

export interface ServerOptions {
  readonly dir: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly port?: number
  readonly key?: string
  readonly clock?: () => string
  readonly extend?: {
    readonly api?: (req: Request, url: URL, tools: ServerTools) => Promise<Response | undefined>
    readonly open?: (ws: unknown) => void
    readonly message?: (ws: unknown, message: unknown, tools: Pick<ServerTools, 'send'>) => void
    readonly close?: (ws: unknown) => void
  }
  readonly pump?: Pump
  readonly watcher?: Watcher
}

export interface ServerHandle extends ServerTools {
  readonly port: number
  readonly key: string
  readonly url: string
  readonly stop: () => void
}

// --- work start ----------------------------------------------------------------------------------

export interface DetachedOptions {
  readonly env?: Env
  readonly out?: (line: string) => void
}
