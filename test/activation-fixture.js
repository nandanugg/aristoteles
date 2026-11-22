// Exercise the real bootstrap command and store on a disposable tmux socket.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ok } from './harness.js'

const area = '.work/onboarding/activation'
export const recordOf = (p) => JSON.parse(readFileSync(join(p.dir, area, 'record.json'), 'utf8'))
export const launchDir = (p, record, launch = record.pending.launch) =>
  join(p.dir, area, String(record.generation), `launch-${launch}`)
export const launchEnv = (p, record, launch = record.pending.launch) => ({
  ARISTOTELES_LAUNCH_NONCE: readFileSync(join(launchDir(p, record, launch), 'nonce'), 'utf8'),
})
export const aLiveHost = (p, command = 'sleep 60 # {session}') => {
  const staffing = Bun.YAML.parse(readFileSync(join(p.dir, '.work/staffing.yaml'), 'utf8'))
  staffing.roles.architect.launch = command
  p.write('.work/staffing.yaml', Bun.YAML.stringify(staffing, null, 2))
}
export const bootstrapTmux = (p, ...args) => {
  const hash = createHash('sha256').update(p.dir).digest('hex').slice(0, 20)
  return Bun.spawnSync(['tmux', '-f', '/dev/null', '-L', `ar-bootstrap-${hash}`, ...args])
}
export const killBootstrap = (p) => bootstrapTmux(p, 'kill-server')
export const acknowledge = async (p, record = recordOf(p)) => {
  const id = record.pending.launch
  ok(await p.run(`activation ack ${id}`, { env: launchEnv(p, record) }))
  return record
}
export const finishActivation = async (p) => {
  const record = await acknowledge(p)
  ok(await p.nanda('activation resume'))
  return record
}
