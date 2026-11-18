// ReadingsLive (package P7a): the markers of work wait, read at one time. The CLI has no
// terminals; the server gives the pump's status through `terminals`.
import { Effect, Layer } from 'effect'
import type { TerminalReading } from '../../core/schema/outside.ts'
import { Dir, Env, Readings } from '../../core/services/index.ts'
import { readMarkers } from './waiting.ts'

export interface ReadingsOptions {
  // The pump's terminals now; the server gives them, the CLI leaves it out.
  readonly terminals?: () => Readonly<Record<string, TerminalReading>>
}

export const readingsLive = (
  options: ReadingsOptions,
): Layer.Layer<Readings, never, Dir | Env> =>
  Layer.effect(
    Readings,
    Effect.gen(function* () {
      const { cwd: dirCwd } = yield* Dir
      const { vars } = yield* Env
      const cwd = dirCwd || '.'
      return {
        read: () =>
          Effect.succeed({
            cwd,
            terminals: options.terminals?.() ?? {},
            markers: readMarkers(vars, cwd),
          }),
      }
    }),
  )

export const ReadingsLive: Layer.Layer<Readings, never, Dir | Env> = readingsLive({})
