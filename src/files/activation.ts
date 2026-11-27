// Private launch materials, marker backups and the directory lock for journal activation.
import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { FilePath, HostCredential, LaunchNonce, LaunchVerifier, Rationale, Refusal, refuse, type EventNumber, type Of } from '../domain/project/values.ts'

const partition = (directory: URL) => createHash('sha256').update(directory.href).digest('hex')
const AREA = '.work/onboarding/activation'
const activationKey = () => randomUUID().replaceAll('-', '')
const unsafe = (message: string) =>
  refuse('Unavailable', Rationale.make(message))
const activationIO = <A>(f: () => A) => Effect.try({
  try: f,
  catch: (error) => Schema.is(Refusal)(error) ? error : unsafe(String(error)),
})

const activationDir = (dir: string, parts: readonly string[], create: boolean): string | null => {
  let path = dir
  for (const part of [...AREA.split('/'), ...parts]) {
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

const launchParts = (generation: number, launch: string): readonly string[] => {
  if (!Number.isSafeInteger(generation) || generation < 1 || !/^[a-f0-9]{32}$/u.test(launch)) {
    throw unsafe('invalid activation generation or launch key')
  }
  return [String(generation), `launch-${launch}`]
}
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

const projectLaunchArea = (
  dir: string, project: URL, generation: Of<typeof EventNumber>, launch: string, create: boolean,
) => activationDir(dir, ['project', partition(project), ...launchParts(generation, launch)], create)

const privateLaunchFiles = { nonce: LaunchNonce, secret: HostCredential, verifier: LaunchVerifier }
export const writeProjectLaunchFile = (
  dir: string, project: URL, generation: Of<typeof EventNumber>, launch: string,
  name: 'nonce' | 'secret' | 'verifier', value: Of<typeof LaunchNonce> | Of<typeof HostCredential> | Of<typeof LaunchVerifier>,
): void => writePrivate(projectLaunchArea(dir, project, generation, launch, true)!, name, value)

export const readProjectLaunchFile = (
  dir: string, project: URL, generation: Of<typeof EventNumber>, launch: string,
  name: 'nonce' | 'secret' | 'verifier',
) => {
  const area = projectLaunchArea(dir, project, generation, launch, false)
  const value = area === null ? null : readPrivate(join(area, name))
  return value === null ? null : Schema.decodeUnknownSync(privateLaunchFiles[name])(value)
}

export const retireProjectLaunchSecret = (
  dir: string, project: URL, generation: Of<typeof EventNumber>, launch: string,
): void => {
  const area = projectLaunchArea(dir, project, generation, launch, false)
  if (area !== null) rmSync(join(area, 'secret'), { force: true })
}

export const removeProjectLaunch = (
  dir: string, project: URL, generation: Of<typeof EventNumber>, launch: string,
): void => {
  const area = projectLaunchArea(dir, project, generation, launch, false)
  if (area !== null) rmSync(area, { recursive: true, force: true })
}

export const projectOriginals = (project: URL, generation: Of<typeof EventNumber>) =>
  FilePath.make(`${AREA}/project/${partition(project)}/${generation}/originals`)
