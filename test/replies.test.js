// The replies of two acts that the flows of the design page use: an agent's remake of a top task
// names who assigns the new task, and the person's confirm of a forwarded accept of a draft says that
// the draft is official, as the accept at a terminal does.
import { describe, expect, test } from 'bun:test'
import { ok, started, tokenIn } from './harness.js'

describe('the reply of an agent\'s remake of a top task', () => {
  test('the new task is outside the tree of the agent, so the reply names the person who assigns it', async () => {
    const { p } = await started()
    ok(await p.nanda('grant --act=change --on=t1 --to=architect --until=2026-10-25T18:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('again.yaml', 'name: The Introduction\ntext: Write the Introduction for the support team.\n')
    const out = ok(await p.agent(`task remake ${arch} t1 --file=again.yaml --reason="support reads it first"`)).out
    expect(out).toContain('t1 is remade as t2')
    expect(out).toContain('next: t2 is outside your task tree, so Nanda assigns it (work waiting --for=Nanda)')
    // The assign that the old reply offered is refused; the person's assign is the next step.
    expect((await p.agent(`assign ${arch} t2 --role=section-lead`)).err).toContain('t2 is outside the task tree')
    expect(ok(await p.nanda('waiting')).out).toContain('work assign t2 --role=')
  }, 20000)
})

describe('the reply of a confirm', () => {
  test('a confirmed accept of a draft says that the version is official', async () => {
    const { p } = await started()
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('edit.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs. }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    const forwarded = ok(await p.agent(`forward ${arch} Nanda accept d2 --evidence="chat | Nanda says yes" --quote="yes, approve it" --channel=chat`)).out
    const id = forwarded.match(/^(e\d+):/)[1]
    const out = ok(await p.nanda(`confirm ${id}`, 'confirm')).out
    expect(out).toContain('d2 is official: tsd-writing@2.')
  }, 20000)
})
