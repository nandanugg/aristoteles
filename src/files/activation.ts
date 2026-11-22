// Durable startup state. The journal owns the committed binding. This file records intent
// and the steps which can be resumed even if the store does not exist yet.
import { randomUUID } from 'node:crypto'
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { OnboardedDirection } from '../domain/events.ts'
import { Refused } from '../domain/errors.ts'

const AREA = '.work/onboarding/activation'
const id = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{32}$/)))
const hash = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)))
const Pending = Schema.Struct({
  kind: Schema.Literals(['activate', 'rebind']),
  launch: id,
  nonceVerifier: hash,
  expected: Schema.NullOr(id),
  acknowledged: Schema.Boolean,
})
const Revision = Schema.Struct({ path: Schema.String, hash, premarked: Schema.Boolean })
const RecordFile = Schema.Struct({
  generation: Schema.Number.pipe(Schema.check(Schema.isInt(), Schema.isGreaterThan(0))),
  phase: Schema.Literals(['activating', 'rolling back', 'active']),
  owner: Schema.String,
  manifest: Schema.Array(Revision),
  directions: Schema.Array(OnboardedDirection),
  files: Schema.Array(Schema.Struct({
    name: Schema.Literals(['aristoteles.yaml', 'aristoteles.lock']),
    before: Schema.NullOr(Schema.String),
    after: Schema.String,
  })),
  marked: Schema.Array(Schema.String),
  pending: Schema.NullOr(Pending),
  committed: Schema.NullOr(Schema.Struct({ launch: id, nonceVerifier: hash })),
  retired: Schema.Boolean,
})
export type ActivationRecord = typeof RecordFile.Type
export type PendingLaunch = typeof Pending.Type

export const activationId = () => randomUUID().replaceAll('-', '')
const unsafe = (message: string) =>
  new Refused({ message, next: 'check the activation folder, then resume activation' })
export const activationIO = <A>(f: () => A) => Effect.try({
  try: f,
  catch: (error) => error instanceof Refused ? error : unsafe(String(error)),
})

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const activationDir = (dir: string, parts: readonly string[], create: boolean): string | null => {
  let path = dir
  for (const part of [...AREA.split('/'), ...parts]) {
    path = join(path, part)
    try {
      if (!lstatSync(path).isDirectory()) throw unsafe(`${path} is not a plain directory`)
    } catch (error) {
      if (!missing(error)) throw error
      if (!create) return null
      try {
        mkdirSync(path, { mode: 0o700 })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
      if (!lstatSync(path).isDirectory()) throw unsafe(`${path} is not a plain directory`)
    }
  }
  return path
}
const readPrivate = (path: string): string | null => {
  let fd
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  } catch (error) {
    if (missing(error)) return null
    throw error
  }
  try {
    const st = fstatSync(fd)
    if (!st.isFile() || (st.mode & 0o077) !== 0) throw unsafe(`${path} is not a private file`)
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}
const writePrivate = (area: string, name: string, text: string, mode = 0o600) => {
  const tmp = join(area, `.stage-${activationId()}`)
  const fd = openSync(tmp, 'wx', 0o600)
  try {
    try {
      fchmodSync(fd, mode)
      writeFileSync(fd, text)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(tmp, join(area, name))
  } finally {
    rmSync(tmp, { force: true })
  }
}

export const readActivationRecord = (dir: string): ActivationRecord | null => {
  const area = activationDir(dir, [], false)
  const text = area === null ? null : readPrivate(join(area, 'record.json'))
  return text === null ? null : Schema.decodeUnknownSync(RecordFile)(JSON.parse(text))
}
export const writeActivationRecord = (dir: string, record: ActivationRecord): void =>
  writePrivate(activationDir(dir, [], true)!, 'record.json', JSON.stringify(Schema.encodeSync(RecordFile)(record)))
export const removeActivationRecord = (dir: string) => {
  const area = activationDir(dir, [], false)
  if (area !== null) rmSync(join(area, 'record.json'), { force: true })
}
const launchParts = (generation: number, launch: string): readonly string[] => {
  if (!Number.isSafeInteger(generation) || generation < 1 || !Schema.is(id)(launch)) {
    throw unsafe('invalid activation generation or launch ID')
  }
  return [String(generation), `launch-${launch}`]
}
export const writeLaunchFile = (
  dir: string, generation: number, launch: string, name: 'nonce' | 'secret', value: string,
) => writePrivate(activationDir(dir, launchParts(generation, launch), true)!, name, value)
export const readLaunchFile = (
  dir: string, generation: number, launch: string, name: 'nonce' | 'secret',
): string | null => {
  const area = activationDir(dir, launchParts(generation, launch), false)
  return area === null ? null : readPrivate(join(area, name))
}
export const removeLaunch = (dir: string, generation: number, launch: string) => {
  const area = activationDir(dir, launchParts(generation, launch), false)
  if (area !== null) rmSync(area, { recursive: true, force: true })
}
export const removeActivationGeneration = (dir: string, generation: number) => {
  const area = activationDir(dir, [String(generation)], false)
  if (area !== null) rmSync(area, { recursive: true, force: true })
}
export const retireSecret = (dir: string, generation: number, launch: string) => {
  const area = activationDir(dir, launchParts(generation, launch), false)
  if (area !== null) rmSync(join(area, 'secret'), { force: true })
}
export const keptOriginals = (generation: number): string => `${AREA}/${generation}/originals`

// The child inherits the parent's open file description on fd 0. The kernel holds
// its flock until the parent closes that descriptor, including on process death.
export const activationLock = (dir: string) =>
  Effect.gen(function* () {
    const fd = yield* Effect.acquireRelease(
      activationIO(() => openSync(join(activationDir(dir, [], true)!, 'lock'),
        constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600)),
      (fd) => Effect.sync(() => closeSync(fd)),
    )
    for (;;) {
      const result = yield* activationIO(() =>
        Bun.spawnSync(['flock', '-n', '-E', '75', '-x', '0'], { stdin: fd, stdout: 'ignore', stderr: 'ignore' }))
      if (result.exitCode === 0) return
      if (result.exitCode !== 75) return yield* Effect.fail(unsafe('could not acquire the activation lock'))
      yield* Effect.sleep(25)
    }
  })

// Reapply only the bytes the start prepared. A concurrent edit is a refusal.
export const applyStartupFiles = (dir: string, record: ActivationRecord, restore: boolean) => {
  for (const file of record.files) {
    const path = join(dir, file.name)
    let current: string | null
    let mode = 0o644
    try {
      const st = lstatSync(path)
      if (!st.isFile()) throw unsafe(`${file.name} is not a regular file`)
      mode = st.mode & 0o777
      current = readFileSync(path, 'utf8')
    } catch (error) {
      if (!missing(error)) throw error
      current = null
    }
    const next = restore ? file.before : file.after
    if (current === next) continue
    if (current !== (restore ? file.after : file.before)) {
      if (restore) continue
      throw unsafe(`${file.name} changed since approval`)
    }
    if (next === null) rmSync(path)
    else writePrivate(dir, file.name, next, mode)
  }
}
