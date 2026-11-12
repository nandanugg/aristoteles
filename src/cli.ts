// The work CLI: main(argv, io) runs one command (the entry point that test/code.js loads). io
// holds everything outside the process; main turns it into the layers of the call once, runs the
// command, and returns its exit code. A defect (a bug) prints "bug: ..." and exits 70.
import { Cause, Effect, Exit, Layer } from 'effect'
import { runCli } from './cli/main.ts'
import { layerOfIo, type WorkIo } from './services/io.ts'
import { FilesLive, SpawnLive } from './services/outside.ts'
import { StoreLive } from './store/sqlite.ts'

export type { WorkIo } from './services/io.ts'

const layerOf = (io: WorkIo) => {
  const ioLayer = layerOfIo(io)
  return Layer.mergeAll(ioLayer, FilesLive, SpawnLive, StoreLive.pipe(Layer.provide(ioLayer)))
}

export async function main(argv: ReadonlyArray<string>, io: WorkIo): Promise<number> {
  const exit = await Effect.runPromiseExit(runCli(argv).pipe(Effect.provide(layerOf(io))))
  if (Exit.isSuccess(exit)) return exit.value
  io.err(`bug: ${Cause.pretty(exit.cause)}`)
  return 70
}
