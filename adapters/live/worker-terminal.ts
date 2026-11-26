// Managed workers can print credentials. Their screen and keyboard stay in local tmux.
import { quote } from '../../core/effects/lines.ts'
import { bootstrapSocket, isBootstrapSession } from './bootstrap.ts'

export const isLocalTerminalSession = (id: string): boolean =>
  isBootstrapSession(id) || /^worker-[a-f0-9]{32}$/.test(id)

const attach = (socket: string, target: string): string =>
  `tmux -L ${quote(socket)} attach-session -t ${quote(target)}`

export const bootstrapAttach = (dir: string, session: string): string =>
  attach(bootstrapSocket(dir), `=${session}`)

export const workerAttach = (socket: string, project: string, session: string): string =>
  attach(socket, `${project}:=${session}`)

// Format 16 workers enter through the observed session boundary.
export { staffSessionOperations } from './staff-session.ts'
