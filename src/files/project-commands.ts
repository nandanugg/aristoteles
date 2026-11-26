import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, constants } from 'node:fs'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { CommandOutcome } from '../domain/project/task.ts'
import { Rationale, refuse, type Refusal } from '../domain/project/values.ts'
import type { CommandCapture, CommandReceipt } from '../services/project.ts'

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const exists = (error: unknown) => (error as NodeJS.ErrnoException).code === 'EEXIST'
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
      try { mkdirSync(directory, { mode: 0o700 }) } catch (error) { if (!exists(error)) throw error }
    }
    try {
      if (!lstatSync(directory).isDirectory()) throw new Error('Expected plain receipt directory')
    } catch (error) {
      if (!create && missing(error)) return null
      throw error
    }
  }
  return directory
}
const keyOf = ({ project, task, result, rule }: CommandReceipt) =>
  createHash('sha256').update(JSON.stringify([project, task, result, rule])).digest('hex')

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
  catch (error) { if (missing(error)) return null; throw error }
  try { return readFileSync(fd, 'utf8') } finally { closeSync(fd) }
}

export const readCommandCapture = (directory: string, receipt: CommandReceipt): Effect.Effect<CommandCapture, Refusal> => io(() => {
  const area = directoryAt(directory, false)
  if (!area) return { _tag: 'Unstarted' }
  const path = join(area, keyOf(receipt))
  if (read(path + '.issued') === null) return { _tag: 'Unstarted' }
  const result = read(path + '.captured')
  return result === null ? { _tag: 'Unconfirmed' } : { _tag: 'Captured', outcome: decode(result) }
})

export const reserveCommandCapture = (directory: string, receipt: CommandReceipt): Effect.Effect<'Reserved' | 'Exists', Refusal> => io(() => {
  const area = directoryAt(directory, true)!
  try { durable(join(area, keyOf(receipt) + '.issued'), '') }
  catch (error) { if (exists(error)) return 'Exists'; throw error }
  syncDirectory(area)
  return 'Reserved'
})

export const saveCommandCapture = (directory: string, receipt: CommandReceipt, outcome: CommandOutcome): Effect.Effect<void, Refusal> => io(() => {
  const area = directoryAt(directory, false)
  if (!area || receipt.rule !== outcome.rule.id) throw new Error('Missing command reservation')
  const path = join(area, keyOf(receipt))
  if (read(path + '.issued') === null) throw new Error('Missing command reservation')
  const result = encode(outcome)
  const staging = path + '.' + crypto.randomUUID()
  try {
    durable(staging, result)
    try { linkSync(staging, path + '.captured') }
    catch (error) { if (!exists(error) || read(path + '.captured') !== result) throw error }
    syncDirectory(area)
  } finally { rmSync(staging, { force: true }) }
})
