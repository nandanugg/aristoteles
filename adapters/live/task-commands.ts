import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import type { TaskCommands } from '../../core/effects/project-commands.ts'
import { CommandOutput, Rationale, refuse } from '../../core/schema/project.ts'
import { readCommandCapture, reserveCommandCapture, saveCommandCapture } from '../../core/services/project.ts'
import { safeEntry } from './markers.ts'

const failure = () => refuse('Unavailable', Rationale.make('The command’s completion could not be confirmed.'))
const readOutput = Schema.decodeUnknownSync(CommandOutput, { onExcessProperty: 'error' })

export const liveTaskCommands = (directory: string): TaskCommands => ({
  files: (files) => Effect.try({
    try: () => {
      for (const { path, image } of files) {
        if (safeEntry(directory, { path, hash: '0'.repeat(64), premarked: false }) !== null)
          throw new Error('Unsafe result path')
        let contents: string | null
        try { contents = readFileSync(join(directory, path), 'utf8') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; contents = null }
        if (image._tag === 'Present' ? contents !== image.contents : contents !== null) throw new Error('Result changed')
      }
    },
    catch: () => refuse('Stale', Rationale.make('The workspace differs from the whole files in the committed result.')),
  }),
  read: (receipt) => readCommandCapture(directory, receipt),
  reserve: (receipt) => reserveCommandCapture(directory, receipt),
  save: (receipt, outcome) => saveCommandCapture(directory, receipt, outcome),
  run: (command) => Effect.tryPromise({
    try: async (signal) => {
      const { PATH, LANG, LC_ALL, HOME } = process.env
      const processHandle = Bun.spawn(['sh', '-c', command.text], {
        cwd: directory, env: { PATH, LANG, LC_ALL, HOME }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
        signal, timeout: 120000,
      })
      const [exit, stdout, stderr] = await Promise.all([
        processHandle.exited, new Response(processHandle.stdout).text(), new Response(processHandle.stderr).text(),
      ])
      if (processHandle.signalCode !== null) throw new Error('Command did not exit normally')
      return readOutput({ _tag: 'CommandOutput', command, exit, stdout, stderr })
    },
    catch: failure,
  }),
})
