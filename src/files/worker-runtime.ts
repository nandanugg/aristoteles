import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const workerLaunchFile = (dir: string, launch: string, name: 'secret' | 'ack' | 'host' | 'checkpoint') =>
  join(dir, '.work', 'runtime', 'launch-' + launch, name)

export const readWorkerLaunch = (dir: string, launch: string, name: 'secret' | 'ack' | 'host' | 'checkpoint'): string | null => {
  if (!/^[a-f0-9]{32}$/.test(launch)) return null
  try {
    return readFileSync(workerLaunchFile(dir, launch, name), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

// One exclusive, private staging file per launch; the caller owns the worker launch lock.
export const stageWorkerLaunch = (dir: string, launch: string, name: 'secret' | 'ack' | 'host' | 'checkpoint', value: string) => {
  if (!/^[a-f0-9]{32}$/.test(launch)) throw new Error('Invalid worker launch ID')
  const area = join(dir, '.work', 'runtime')
  mkdirSync(area, { recursive: true, mode: 0o700 })
  mkdirSync(join(area, 'launch-' + launch), { recursive: true, mode: 0o700 })
  const path = workerLaunchFile(dir, launch, name)
  try {
    const fd = openSync(path, 'wx', 0o600)
    try {
      writeFileSync(fd, value)
      fsyncSync(fd)
    } finally { closeSync(fd) }
    if (name === 'checkpoint') {
      for (const folder of [join(area, 'launch-' + launch), area, join(dir, '.work')]) {
        const directory = openSync(folder, 'r')
        try { fsyncSync(directory) } finally { closeSync(directory) }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || readWorkerLaunch(dir, launch, name) !== value) {
      throw error
    }
  }
}

// The session of a command is a UUID: an AI CLI takes no other session id (Claude Code: "Invalid
// session ID. Must be a valid UUID", Nanda, 2026-11-15). A UUID stays as it is; any other id maps
// to the same UUID each time (the SHA-1 of the id, shaped as a version 5 UUID), so a launch and
// its later resumes name one session.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const cliSession = (session: string): string => {
  if (UUID.test(session)) return session
  const h = createHash('sha1').update(session).digest('hex')
  const variant = ((Number.parseInt(h[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  const tail = `${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${tail}`
}
