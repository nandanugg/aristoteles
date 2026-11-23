import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const workerLaunchFile = (dir: string, launch: string, name: 'secret' | 'ack' | 'host') =>
  join(dir, '.work', 'runtime', 'launch-' + launch, name)

export const readWorkerLaunch = (dir: string, launch: string, name: 'secret' | 'ack' | 'host'): string | null => {
  if (!/^[a-f0-9]{32}$/.test(launch)) return null
  try {
    return readFileSync(workerLaunchFile(dir, launch, name), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

// One exclusive, private staging file per launch; the caller owns the worker launch lock.
export const stageWorkerLaunch = (dir: string, launch: string, name: 'secret' | 'ack' | 'host', value: string) => {
  if (!/^[a-f0-9]{32}$/.test(launch)) throw new Error('Invalid worker launch ID')
  const area = join(dir, '.work', 'runtime')
  mkdirSync(area, { recursive: true, mode: 0o700 })
  mkdirSync(join(area, 'launch-' + launch), { recursive: true, mode: 0o700 })
  const path = workerLaunchFile(dir, launch, name)
  try {
    const fd = openSync(path, 'wx', 0o600)
    try { writeFileSync(fd, value) } finally { closeSync(fd) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || readWorkerLaunch(dir, launch, name) !== value) {
      throw error
    }
  }
}
