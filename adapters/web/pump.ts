// createPump and unescapeOutput (frozen; package P6): the sync facade of the pump for the tests and
// the server. The engine is adapters/live/pump.ts (tmux on its own socket, the old pump's
// behavior); a refusal of tmux is thrown as an Error with the old words ('the session s-1 has a
// terminal already'). The Pump service of the effects is made from this facade (pumpLayerOf).
import { createTmuxPump, unescapeOutput as unescape } from '../live/pump.ts'
import type { Pump, PumpOptions } from './frozen.ts'

export type { Pump, PumpOptions, StartOptions, TerminalStatus } from './frozen.ts'

// tmux escapes a byte below 32 and the backslash as \ooo in a line of control mode.
export const unescapeOutput = (bytes: Uint8Array): Uint8Array => unescape(bytes)

// Throws 'tmux is not on this machine; the terminals of the UI need tmux' without tmux.
export const createPump = (options: PumpOptions): Pump => createTmuxPump(options)
