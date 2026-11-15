// The terminals of the canvas follow the persistent agents (rulings 7 and 9, onboarding
// 2026-11-14): two tasks of one agent show its one terminal, the host's task shows the host's
// pane, and a subagent's work shows the terminal above it.
import { afterEach, expect, test } from 'bun:test'
import type { Time } from '../../core/schema/index.ts'
import { derive } from '../../core/derived/index.ts'
import { momentOf } from '../../core/derived/support.test.ts'
import { cleanUp, clock, hosted } from '../../core/effects/support.test.ts'
import { readSettingsOf } from '../../core/services/index.ts'
import { projectView } from './view.ts'

afterEach(cleanUp)

// The canvas of the host's project h1, at the clock of the supervisor.
const canvasOf = (dir: string) => {
  const d = derive(momentOf(dir, new Date(clock.now).toISOString() as Time))
  const ctx = { dir, settings: readSettingsOf({}), terminals: {}, person: 'Nanda' }
  return projectView(d, 'h1', ctx)
}
const PARTS =
  '- { name: Part one, text: Write part one., context: { section: introduction } }\n' +
  '- { name: Part two, text: Write part two., context: { section: design } }\n'

test('two tasks of one persistent agent show its one terminal', async () => {
  const { p, w, host, hostToken } = await hosted()
  p.write('docs/tsd.md', '# TSD\n\n## Introduction\n\n## Design\n')
  p.write('parts.yaml', PARTS)
  await p.agent(`task split ${hostToken} t1 --file=parts.yaml`)
  await p.agent(`assign ${hostToken} t2 --role=section-lead`)
  await p.agent(`assign ${hostToken} t3 --role=section-lead`)
  await w.tick()
  await w.tick()
  const terminal = p.work().agents.get('p1' as never)?.terminal
  const session = terminal?._tag === 'Started' ? terminal.session : 'none'
  const view = canvasOf(p.dir)
  const owners = view?.rows.map(({ task }): ReadonlyArray<string | null | undefined> => [
    task.id,
    task.owner?.a,
    task.owner?.agent,
    task.owner?.terminal._tag === 'None' ? null : task.owner?.terminal.session,
  ])
  expect(owners).toEqual([
    ['t1', 'a1', null, host],
    ['t2', 'a2', 'p1', session],
    ['t3', 'a3', 'p1', session],
  ])
})

test('a disposable role runs as a subagent: its work shows the terminal above it', async () => {
  const { p, host, hostToken } = await hosted()
  await p.agent(`assign ${hostToken} t1 --role=writer`)
  const writer = canvasOf(p.dir)?.rows[0]?.work.find((c) => c.role === 'writer')
  expect(writer).toMatchObject({ a: 'a2', model: 'haiku', terminal: { session: host }, inside: 'a1' })
})
