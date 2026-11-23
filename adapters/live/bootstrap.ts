// A bootstrap host has its own managed tmux session, located by the reserved launch ID.
import { readStaffing, sha } from '../../core/services/index.ts'
import { refuse } from '../../core/schema/index.ts'
import { Effect } from 'effect'
import { basename } from 'node:path'
import { fill } from '../../core/effects/lines.ts'
import { launchOpening } from './markers.ts'

export const NONCE_ENV = 'ARISTOTELES_LAUNCH_NONCE'
const socket = (dir: string) => `ar-bootstrap-${sha(dir).slice(0, 20)}`
export const isBootstrapSocket = (dir: string, path: string): boolean => basename(path) === socket(dir)
const tmux = (dir: string, args: readonly string[]) => {
  const env = { ...process.env }
  for (const name of ['TMUX', 'TMUX_PANE', 'TMUX_SOCKET', NONCE_ENV]) delete env[name]
  return Bun.spawnSync(['tmux', '-f', '/dev/null', '-L', socket(dir), ...args], { env })
}
export const bootstrapSession = (launch: string): string => `boot-${launch}`
export const isBootstrapSession = (session: string): boolean => /^boot-[a-f0-9]{32}$/.test(session)
export const bootstrapPane = (dir: string, launch: string) => {
  const result = tmux(dir, [
    'list-panes', '-t', `=${bootstrapSession(launch)}`, '-F', '#{pane_dead} #{pane_id} #{socket_path}',
  ])
  if (result.exitCode !== 0) return null
  const match = /^0 (%\d+) (.+)$/m.exec(result.stdout.toString())
  return match ? { pane: match[1]!, socket: match[2]! } : null
}
export const bootstrapAlive = (dir: string, launch: string): boolean =>
  bootstrapPane(dir, launch) !== null
export const observeBootstrap = (dir: string, launch: string): 'live' | 'ended' | 'unknown' => {
  try {
    const result = tmux(dir, [
      'list-panes', '-t', `=${bootstrapSession(launch)}`, '-F', '#{pane_dead}',
    ])
    if (result.exitCode === 0) return /^0$/m.test(result.stdout.toString()) ? 'live' : 'ended'
    return /can't find session|no server running|No such file or directory/.test(result.stderr.toString())
      ? 'ended' : 'unknown'
  } catch {
    return 'unknown'
  }
}
export const stopBootstrap = (dir: string, launch: string): void => {
  const result = tmux(dir, ['kill-session', '-t', `=boot-${launch}`])
  if (result.exitCode !== 0 && bootstrapAlive(dir, launch)) {
    throw refuse('the pending bootstrap pane could not be stopped')
  }
}
export const bootstrapTemplate = (dir: string, host: string) =>
  Effect.gen(function* () {
    const staffing = yield* readStaffing(dir)
    const binding = staffing?.roles[host]
    if (!binding?.persistent) return yield* refuse('the bootstrap host needs a persistent staffing binding')
    return binding
  })
export const spawnBootstrap = (
  dir: string, launch: string, nonce: string, db: string | undefined,
  binding: { readonly launch: string; readonly model: string },
): void => {
  const prompt = [
    launchOpening('host'),
    'You are starting in bootstrap mode.',
    `Run work activation ack ${launch}, then work wait --launch ${launch}.`,
    'Work starts after the person opens the top. Use the token that wait gives you.',
  ].join(' ')
  const args = [
    'new-session', '-d', '-s', `boot-${launch}`, '-c', dir,
    '-e', `${NONCE_ENV}=${nonce}`,
    ...(db === undefined ? [] : ['-e', `ARISTOTELES_DB=${db}`]),
    '--', 'sh', '-c', fill(binding.launch, { session: launch, model: binding.model, prompt }),
  ]
  const result = tmux(dir, args)
  if (result.exitCode !== 0) throw refuse('the bootstrap host could not be launched')
}
