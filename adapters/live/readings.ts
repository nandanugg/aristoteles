// ReadingsLive (package P7a): git, the files of the dir and the settings, read for one Work at
// one time (the ports of the old outsideOf and onBase). The CLI has no terminals; the server
// gives the pump's status through `terminals`. Core imports no words, so the measure of a brief
// is 0 here; each adapter puts it in (adapters/words withBriefMeasure).
//
// The changed results, the stale sources and the commits on their base are the rule of an output
// (core/services/outputs.ts), which the report of a new output reads too.
import { Effect, Layer } from 'effect'
import type { TerminalReading } from '../../core/schema/outside.ts'
import {
  Dir,
  FilesLive,
  outputsOf,
  readSettings,
  readSettingsOf,
  Readings,
  SpawnLive,
} from '../../core/services/index.ts'

export interface ReadingsOptions {
  // The pump's terminals now; the server gives them, the CLI leaves it out.
  readonly terminals?: () => Readonly<Record<string, TerminalReading>>
}

export const readingsLive = (options: ReadingsOptions): Layer.Layer<Readings, never, Dir> =>
  Layer.effect(
    Readings,
    Effect.gen(function* () {
      const { cwd: dirCwd } = yield* Dir
      const cwd = dirCwd || '.'
      return {
        read: (work) =>
          Effect.gen(function* () {
            const { changed, stale, onBase } = yield* outputsOf(work, cwd)
            // A file the settings refuse is the UI's to report: the defaults hold here.
            const settings = yield* readSettings(cwd).pipe(
              Effect.catch(() => Effect.succeed(readSettingsOf({}))),
            )
            return {
              cwd,
              settings: {
                hostWaitMinutes: settings.hostWaitMinutes,
                retryMinutes: settings.retryMinutes,
                outsideSourceHours: settings.outsideSourceHours,
              },
              changed,
              stale,
              onBase,
              terminals: options.terminals?.() ?? {},
              measure: () => 0,
            }
          }).pipe(Effect.provide(Layer.mergeAll(FilesLive, SpawnLive))),
      }
    }),
  )

export const ReadingsLive: Layer.Layer<Readings, never, Dir> = readingsLive({})
