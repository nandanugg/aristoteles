// A bootstrap host has its own managed tmux session, located by the reserved launch ID.
import { digest, providerSessionId } from '../../core/services/project.ts'
import { basename } from 'node:path'
import { launchOpening } from './markers.ts'
import type { Of, ProjectId, Staff as ProjectStaff } from '../../core/schema/project.ts'

export const NONCE_ENV = 'ARISTOTELES_LAUNCH_NONCE'
export const PROJECT_ENV = 'ARISTOTELES_BOOTSTRAP_PROJECT'
const SESSION_ENV = 'ARISTOTELES_BOOTSTRAP_SESSION'
export const bootstrapSocket = (dir: string) => `ar-bootstrap-${digest(dir).slice(0, 20)}`
export const isBootstrapSocket = (dir: string, path: string): boolean => basename(path) === bootstrapSocket(dir)
const tmux = (dir: string, args: readonly string[]) => {
  const env = { ...process.env }
  for (const name of ['TMUX', 'TMUX_PANE', 'TMUX_SOCKET', NONCE_ENV, PROJECT_ENV, SESSION_ENV]) delete env[name]
  return Bun.spawnSync(['tmux', '-f', '/dev/null', '-L', bootstrapSocket(dir), ...args], { env })
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
    return /can't find (session|window|pane)|no server running|No such file or directory/.test(result.stderr.toString())
      ? 'ended' : 'unknown'
  } catch {
    return 'unknown'
  }
}
export const stopBootstrap = (dir: string, launch: string): void => {
  const result = tmux(dir, ['kill-session', '-t', `=boot-${launch}`])
  if (result.exitCode !== 0 && bootstrapAlive(dir, launch)) {
    throw new Error('the pending bootstrap pane could not be stopped')
  }
}
const shellWord = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
const commandFor = (staff: ProjectStaff, launch: string, prompt: string) => {
  const values = { session: providerSessionId(launch), model: shellWord(staff.model), prompt: shellWord(prompt) }
  const command = staff.launch.replace(/\{(session|model|prompt)\}/gu, (_, key: keyof typeof values) => values[key])
  return staff.launch.includes('{prompt}') ? command : command + ' ' + values.prompt
}

// The format 16 bootstrap uses the journal's launch identity and the approved staff template.
export const spawnProjectBootstrap = (
  dir: string, launch: string, nonce: string, db: string | undefined, staff: ProjectStaff, project: Of<typeof ProjectId>,
): void => {
  const prompt = [
    launchOpening('host'),
    `Run work activation ack session:${launch} from this pane, then work activation collect session:${launch}.`,
    'Wait for Start work before submitting work.',
  ].join(' ')
  const args = [
    'new-session', '-d', '-s', bootstrapSession(launch), '-c', dir, '-e', `${NONCE_ENV}=${nonce}`,
    '-e', `${PROJECT_ENV}=${project}`, '-e', `${SESSION_ENV}=session:${launch}`, '-e', `WORK_DIR=${dir}`,
    ...(db === undefined ? [] : ['-e', `ARISTOTELES_DB=${db}`]),
    '--', 'sh', '-c', commandFor(staff, launch, prompt),
  ]
  if (tmux(dir, args).exitCode !== 0) throw new Error('the project bootstrap host could not be launched')
}

// Staff sessions and fresh reviews use the same private tmux socket as the host.
export const spawnProjectRun = (
  dir: string, launch: string, db: string | undefined, staff: ProjectStaff, token: string, prompt: string,
): void => {
  const args = [
    'new-session', '-d', '-s', bootstrapSession(launch), '-c', dir,
    '-e', `ARISTOTELES_TOKEN=${token}`, '-e', `ARISTOTELES_SESSION=session:${launch}`, '-e', `WORK_DIR=${dir}`,
    ...(db === undefined ? [] : ['-e', `ARISTOTELES_DB=${db}`]),
    '--', 'sh', '-c', commandFor(staff, launch, prompt),
  ]
  if (tmux(dir, args).exitCode !== 0) throw new Error('The project session could not be launched')
}
