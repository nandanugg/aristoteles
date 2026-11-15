// F4: a state that the clock alone changes (a hold for the host's words ends) reaches an open
// page: the server sends `changed` at the next clock edge, with no new event in the store.
import { afterAll, expect, test } from 'bun:test'
import { join } from 'node:path'
import { h, ok, solToken } from '../../core/actions/fixture.test.ts'
import { startServer } from './server.ts'

const stops: Array<() => void> = []
afterAll(() => {
  for (const stop of stops) stop()
})

test('a held draft passes its time: the page hears `changed` and reads it', async () => {
  const p = h.project({ 'top.yaml': `${h.TASK_WHOLE}role: architect\n` })
  await h.init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
  ok(await p.run('run start', h.HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out)
  ok(await p.agent(`brief ${host}`))
  // A model run (no host) drafts a change that answers nothing: held for the active host.
  p.write('change.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
  ok(await p.agent('direction revise tsd-writing --file=change.yaml --by=assess --why="Shorten"'))
  // The person of the page: git user.name of the dir.
  for (const args of [['init', '-q'], ['config', 'user.name', 'Nanda']]) {
    Bun.spawnSync(['git', '-C', p.dir, ...args])
  }

  let at = p.now()
  const env = { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') }
  const s = startServer({ dir: p.dir, env, clock: () => at })
  stops.push(() => s.stop())
  const get = async (path: string) => (await fetch(`http://127.0.0.1:${s.port}${path}`)).json()
  const decisions = async () =>
    (await get('/api/task/t1')).decisions.map((x: { id: string }) => x.id)

  const messages: Array<string> = []
  const origin = `http://127.0.0.1:${s.port}`
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`, { headers: { origin } } as never)
  await new Promise((done, fail) => {
    ws.onopen = done
    ws.onerror = fail
  })
  ws.onmessage = (e) => messages.push(String(e.data))
  // The page reads: the draft is held.
  expect(await decisions()).toEqual([])
  await Bun.sleep(300)
  messages.length = 0
  // The clock passes hostWaitMinutes (10); nothing is written to the store.
  at = new Date(Date.parse(at) + 11 * 60000).toISOString()
  await Bun.sleep(3500)
  ws.close()
  expect(messages.filter((m) => m.includes('changed')).length).toBeGreaterThan(0)
  expect(await decisions()).toEqual(['d2'])
}, 40000)
