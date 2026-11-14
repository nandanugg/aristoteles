// The sessions of the UI (Nanda, 2026-11-11). A project is a session of the host model, so the
// store records each run (a session with no assignment yet) and the session of each real agent,
// so that the UI can show and resume them. The host is the AI CLI that the person triggered
// (Nanda, 2026-11-13): it starts a run in its own tmux pane, or continues one there on the
// person's words. The UI acts as the person on its own channel, and a real agent, whose terminal
// has the person's git user, cannot act as the person.
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { DIRECTION, HOST_PANE, TASK_WHOLE, ok, project, solToken, started, init, tokenIn } from './harness.js'

const dbOf = (p) => new Database(join(p.dir, '.work', 'aristoteles.db'), { readonly: true })

describe('runs and sessions', () => {
  test('the host starts a run in its own pane; one pane holds one open run; continue moves a run; a close ends it', async () => {
    const p = project()
    await init(p)
    const pane = (n) => ({ env: { ...HOST_PANE, TMUX_PANE: `%${n}` } })
    expect(ok(await p.ui('run list')).out).toContain('no run yet')
    expect((await p.run('run start', { env: {} })).err).toContain('the host runs inside tmux, so that the page shows its terminal')
    expect(ok(await p.run('run start', pane(1))).out).toStartWith('h1 started: you are its host, in this terminal (pane %1); the page shows it.')
    expect((await p.run('run start', pane(1))).err).toContain('this pane is the host of h1 already; continue it, or close it')
    expect((await p.run('run start --kind=assess', pane(2))).code).toBe(2)
    ok(await p.run('run start', pane(2)))
    expect(ok(await p.ui('run list')).out).toMatch(/^h1 host · talks · pane %1 · 2026-10-25T09:\d\d:00\.000Z\nh2 host · talks · pane %2/)
    // The person says in another pane which run to continue; the host moves it there with the words.
    expect((await p.run('run continue h1', pane(3))).err).toContain('--quote="<the words of the person>"')
    expect(ok(await p.run('run continue h1 --quote="continue the export project"', pane(3))).out)
      .toContain('h1 continues: you are its host, in this terminal (pane %3); the page shows it.')
    expect(ok(await p.nanda('log --last=1')).out).toMatch(/host run \S+ \(run\) run\.continue$/)
    expect(ok(await p.ui('run list')).out).toContain('h1 host · talks · pane %3')
    expect((await p.run('run continue h1 --quote="here"', pane(2))).err).toContain('this pane is the host of h2 already')
    ok(await p.ui('run close h2'))
    expect(ok(await p.ui('run list')).out).toContain('h2 host · closed')
    expect((await p.ui('run close h2')).err).toContain('h2 is closed')
    expect((await p.run('run continue h2 --quote="go on"', pane(4))).err).toContain('h2 is closed')
    expect(ok(await p.nanda('log --last=1')).out).toContain('Nanda (ui) run.close')
    const db = dbOf(p)
    expect(db.query('SELECT id, kind FROM run ORDER BY id').all()).toEqual([
      { id: 'h1', kind: 'host' }, { id: 'h2', kind: 'host' }])
    expect(db.query('SELECT run FROM run_closed').all()).toEqual([{ run: 'h2' }])
    db.close()
  })

  test('a continue of a run with an open top task gives the new pane the Sol, with a new token', async () => {
    const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    const first = { env: { ...HOST_PANE, TMUX_PANE: '%1' } }
    const second = { env: { ...HOST_PANE, TMUX_PANE: '%2' } }
    ok(await p.run('run start', first))
    ok(await p.run('task draft --file=top.yaml --by=h1', first))
    const old = await solToken(p, ok(await p.ui('task open td1')).out, 'h1', first) // ruling 10.1
    ok(await p.agent(`brief ${old}`))
    const moved = ok(await p.run('run continue h1 --quote="go on with the introduction"', second)).out
    expect(moved).toContain('you are the Sol of its top task t1 (a1); the old token stops working. Your command: work brief a1.')
    const fresh = tokenIn(moved)
    expect((await p.agent(`next ${old}`)).err).toContain('the token of a1 is wrong')
    ok(await p.agent(`brief ${fresh}`))
    // The Sol's terminal is the new pane now: the canvas names it, and the old pane drafts nothing.
    const db = dbOf(p)
    const hosts = db.query("SELECT session FROM run_host WHERE run = 'h1' ORDER BY session").all().map((r) => r.session)
    expect(hosts).toHaveLength(2)
    const latest = db.query("SELECT session FROM assignment_session WHERE assignment = 'a1' ORDER BY at DESC LIMIT 1").get().session
    expect(hosts).toContain(latest)
    db.close()
  })

  test('the UI records the session of a real agent; one session is one agent', async () => {
    const { p } = await started()
    expect(ok(await p.ui('session a1 --id=s-a1')).out).toBe('a1 runs in the session s-a1.')
    ok(await p.ui('session a1 --id=s-a1-again'))
    const db = dbOf(p)
    expect(db.query('SELECT assignment, session FROM assignment_session ORDER BY session').all()).toEqual([
      { assignment: 'a1', session: 's-a1' }, { assignment: 'a1', session: 's-a1-again' }])
    db.close()
    expect((await p.agent('session a1 --id=s-x')).err).toContain('this is a person command')
  })

  test('a real agent cannot act as the person, also at a terminal with the person\'s git user', async () => {
    const { p } = await started()
    const marked = { tty: true, env: { ARISTOTELES_SESSION: 's-a1' } }
    expect((await p.run('waiting', marked)).err).not.toContain('refused')
    expect((await p.run('suggest --says="shorter rules"', marked)).err)
      .toContain('a real agent runs in this terminal (session s-a1); a person command comes from the person')
    expect((await p.run('run start', marked)).err).toContain('a real agent of the UI runs in this terminal (session s-a1)')
    // In a marked terminal, a direction without a token is a model run outside any task.
    p.write('other.yaml', DIRECTION.replaceAll('tsd-writing', 'hld-writing').replace('name: TSD writing', 'name: HLD writing')
      .replaceAll('no-code-proof', 'hld-no-code').replaceAll('no-ticket-ids', 'hld-no-ids').replaceAll('repeatable', 'hld-repeatable'))
    expect((await p.run('direction new --file=other.yaml', marked)).err).toContain('a model run outside any task names itself: --by=')
    ok(await p.run('direction new --file=other.yaml --by=assess', marked))
  })

  test('the UI is the person: a person act needs no terminal on the ui channel', async () => {
    const { p } = await started()
    ok(await p.ui('suggest --says="shorter rules"'))
    expect(ok(await p.nanda('log --last=1')).out).toContain('Nanda (ui) suggest')
    expect((await p.agent('suggest --says="shorter rules"')).err).toContain('this is a person command; a person runs it at a terminal')
  })
})
