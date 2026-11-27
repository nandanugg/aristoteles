// Private session material, marker backups and the project directory lock.
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { FilePath, HostCredential, LaunchNonce, LaunchVerifier, Rationale, Refusal, refuse, type EventNumber, type Of, type StaffSessionKey } from '../domain/project/values.ts'

const partition = (directory: URL) => createHash('sha256').update(directory.href).digest('hex')
const AREA = '.work/onboarding/activation'
const SESSIONS = '.work/project-sessions'
const activationKey = () => randomUUID().replaceAll('-', '')
const unsafe = (message: string) =>
  refuse('Unavailable', Rationale.make(message))
const activationIO = <A>(f: () => A) => Effect.try({
  try: f,
  catch: (error) => Schema.is(Refusal)(error) ? error : unsafe(String(error)),
})

const plainDirectory = (dir: string, parts: readonly string[], create: boolean): string | null => {
  let path = dir
  for (const part of parts) {
    path = join(path, part)
    try {
      if (!lstatSync(path).isDirectory()) throw unsafe(`${path} is not a plain directory`)
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      if (!create) return null
      try {
        mkdirSync(path, { mode: 0o700 })
      } catch (e) {
        if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e
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
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
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
const writePrivate = (area: string, name: string, text: string) => {
  const tmp = join(area, `.stage-${activationKey()}`)
  const fd = openSync(tmp, 'wx', 0o600)
  try {
    try {
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

// The child inherits the parent's open file description on fd 0. The kernel holds
// its flock until the parent closes that descriptor, including on process death.
export const activationLock = (dir: string) =>
  Effect.gen(function* () {
    const fd = yield* Effect.acquireRelease(
      activationIO(() => openSync(join(plainDirectory(dir, AREA.split('/'), true)!, 'lock'),
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

const projectSessionArea = (dir: string, project: URL, key: Of<typeof StaffSessionKey>, create: boolean) => {
  const suffix = key.slice('session:'.length)
  if (!/^session:[a-f0-9]{32}$/u.test(key)) throw unsafe('Invalid session key')
  return plainDirectory(dir, [...SESSIONS.split('/'), partition(project), suffix], create)
}

const privateSessionFiles = { nonce: LaunchNonce, secret: HostCredential, verifier: LaunchVerifier }
export const writeProjectSessionFile = <Name extends keyof typeof privateSessionFiles>(
  dir: string, project: URL, key: Of<typeof StaffSessionKey>, name: Name, value: Of<(typeof privateSessionFiles)[Name]>,
): void => writePrivate(projectSessionArea(dir, project, key, true)!, name, value)

export const readProjectSessionFile = (
  dir: string, project: URL, key: Of<typeof StaffSessionKey>, name: keyof typeof privateSessionFiles,
) => {
  const area = projectSessionArea(dir, project, key, false)
  const value = area === null ? null : readPrivate(join(area, name))
  return value === null ? null : Schema.decodeUnknownSync(privateSessionFiles[name])(value)
}

export const retireProjectSessionSecret = (dir: string, project: URL, key: Of<typeof StaffSessionKey>): void => {
  const area = projectSessionArea(dir, project, key, false)
  if (area === null) return
  rmSync(join(area, 'secret'), { force: true })
  const fd = openSync(area, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

export const removeProjectSession = (dir: string, project: URL, key: Of<typeof StaffSessionKey>): void => {
  const area = projectSessionArea(dir, project, key, false)
  if (area !== null) rmSync(area, { recursive: true, force: true })
}

export const projectOriginals = (project: URL, generation: Of<typeof EventNumber>) =>
  FilePath.make(`${AREA}/project/${partition(project)}/${generation}/originals`)
