// The host's pane in the person's tmux, read for the dashboard: whether it lives, when it last
// printed (tmux keeps the time of the last output of a window) and its last lines.
import { pathOf } from '../../core/services/index.ts'

export interface PaneReading {
  readonly alive: boolean
  readonly lastOutput: number
  readonly tail: string
}

const tmux = (socket: string, ...args: ReadonlyArray<string>) =>
  Bun.spawnSync([pathOf('tmux'), '-S', socket, ...args], { stderr: 'ignore' })

export const readPane = (socket: string, pane: string, lines = 40): PaneReading => {
  const info = tmux(socket, 'display-message', '-p', '-t', pane, '#{pane_dead} #{window_activity}')
  const [dead = '1', activity = '0'] = info.stdout.toString().trim().split(' ')
  if (!info.success || dead === '1') return { alive: false, lastOutput: 0, tail: '' }
  if (lines === 0) return { alive: true, lastOutput: Number(activity) * 1000, tail: '' }
  const screen = tmux(socket, 'capture-pane', '-p', '-t', pane, '-S', `-${lines}`)
  return { alive: true, lastOutput: Number(activity) * 1000, tail: screen.stdout.toString() }
}
