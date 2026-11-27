import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, constants } from 'node:fs'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { CommandOutcome } from '../domain/project/task.ts'
import { Rationale, refuse, type Refusal } from '../domain/project/values.ts'
import type { CommandCapture, CommandRecord } from '../services/project.ts'

const io = <A>(operation: () => A): Effect.Effect<A, Refusal> => Effect.try({
  try: operation,
  catch: () => refuse('Unavailable', Rationale.make('The command receipt could not be confirmed.')),
})
const decode = Schema.decodeUnknownSync(Schema.fromJsonString(CommandOutcome), { onExcessProperty: 'error' })
const encode = Schema.encodeSync(Schema.fromJsonString(CommandOutcome))

const directoryAt = (directory: string, create: boolean): string | null => {
  for (const part of ['.work', 'command-receipts']) {
    directory = join(directory, part)
    if (create) {
      try { mkdirSync(directory, { mode: 0o700 }) } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error }
    }
    try {
      if (!lstatSync(directory).isDirectory()) throw new Error('Expected plain receipt directory')
    } catch (error) {
      if (!create && error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  }
  return directory
}
const keyOf = ({ directory, database, reportedIn, slot }: CommandRecord) =>
  createHash('sha256').update(JSON.stringify([directory.href, database.href, reportedIn, slot])).digest('hex')

const durable = (path: string, contents: string) => {
  const fd = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(fd, contents)
    fsyncSync(fd)
  } finally { closeSync(fd) }
}
const syncDirectory = (path: string) => {
  const fd = openSync(path, constants.O_DIRECTORY | constants.O_RDONLY)
  try { fsyncSync(fd) } finally { closeSync(fd) }
}
const read = (path: string): string | null => {
  let fd
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error }
  try { return readFileSync(fd, 'utf8') } finally { closeSync(fd) }
}

export const readCommandCapture = (directory: string, receipt: CommandRecord): Effect.Effect<CommandCapture, Refusal> => io(() => {
  const area = directoryAt(directory, false)
  if (!area) return { _tag: 'NotStarted' }
  const path = join(area, keyOf(receipt))
  if (read(path + '.issued') === null) return { _tag: 'NotStarted' }
  const result = read(path + '.captured')
  return result === null ? { _tag: 'Running' } : { _tag: 'Captured', outcome: decode(result) }
})

export const reserveCommandCapture = (directory: string, receipt: CommandRecord): Effect.Effect<'Reserved' | 'Exists', Refusal> => io(() => {
  const area = directoryAt(directory, true)!
  try { durable(join(area, keyOf(receipt) + '.issued'), '') }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'EEXIST') return 'Exists'; throw error }
  syncDirectory(area)
  return 'Reserved'
})

export const saveCommandCapture = (directory: string, receipt: CommandRecord, outcome: CommandOutcome): Effect.Effect<void, Refusal> => io(() => {
  const area = directoryAt(directory, false)
  if (!area || JSON.stringify(receipt.rule) !== JSON.stringify(outcome.rule)) throw new Error('Missing command reservation')
  const path = join(area, keyOf(receipt))
  if (read(path + '.issued') === null) throw new Error('Missing command reservation')
  const result = encode(outcome)
  const staging = path + '.' + crypto.randomUUID()
  try {
    durable(staging, result)
    try { linkSync(staging, path + '.captured') }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST') || read(path + '.captured') !== result) throw error }
    syncDirectory(area)
  } finally { rmSync(staging, { force: true }) }
})
