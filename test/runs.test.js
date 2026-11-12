// The sessions of the UI (Nanda, 2026-11-11). A project is a session of the host model, so the
// store records each run (a session with no assignment yet) and the session of each real agent,
// so that the UI can show and resume them. The UI acts as the person on its own channel, and a
// real agent, whose terminal has the person's git user, cannot act as the person.
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { DIRECTION, ok, project, started, init } from './harness.js'

const dbOf = (p) => new Database(join(p.dir, '.work', 'aristoteles.db'), { readonly: true })

describe('runs and sessions', () => {
  test('the UI starts a host run as the person; the list shows its state; a close ends it', async () => {
    const p = project()
    await init(p)
    expect(ok(await p.ui('run list')).out).toContain('no run yet')
    expect(ok(await p.ui('run start --session=s-1111')).out).toBe('h1 started: a host session (s-1111).')
    expect((await p.ui('run start --session=s-1111')).err).toContain('the session s-1111 is in use')
    // Each run is a host: the assess skill runs in the person's own AI CLI (Nanda, 2026-11-13).
    expect((await p.ui('run start --kind=assess --session=s-2222')).code).toBe(2)
    expect(ok(await p.ui('run start --session=s-2222')).out).toBe('h2 started: a host session (s-2222).')
    expect(ok(await p.ui('run list')).out).toMatch(/^h1 host · talks · session s-1111 · 2026-10-25T09:\d\d:00\.000Z\nh2 host · talks · session s-2222/)
    ok(await p.ui('run close h2'))
    expect(ok(await p.ui('run list')).out).toContain('h2 host · closed')
    expect((await p.ui('run close h2')).err).toContain('h2 is closed')
    expect(ok(await p.nanda('log --last=1')).out).toContain('Nanda (ui) run.close')
    const db = dbOf(p)
    expect(db.query('SELECT id, kind, session FROM run ORDER BY id').all()).toEqual([
      { id: 'h1', kind: 'host', session: 's-1111' }, { id: 'h2', kind: 'host', session: 's-2222' }])
    expect(db.query('SELECT run FROM run_closed').all()).toEqual([{ run: 'h2' }])
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
    expect((await p.ui('run start --session=s-a1-again')).err).toContain('the session s-a1-again is in use')
    expect((await p.agent('session a1 --id=s-x')).err).toContain('this is a person command')
  })

  test('a real agent cannot act as the person, also at a terminal with the person\'s git user', async () => {
    const { p } = await started()
    const marked = { tty: true, env: { ARISTOTELES_SESSION: 's-a1' } }
    expect((await p.run('waiting', marked)).err).not.toContain('refused')
    expect((await p.run('suggest --says="shorter rules"', marked)).err)
      .toContain('a real agent runs in this terminal (session s-a1); a person command comes from the person')
    expect((await p.run('run start --session=s-9', marked)).err).toContain('a real agent runs in this terminal')
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
