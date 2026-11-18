// The replies of two acts that the flows of the design page use: an agent's remake of a top task
// names who assigns the new task, and the person's confirm of a forwarded accept of a draft says that
// the draft is official, as the accept at a terminal does.
import { describe, expect, test } from 'bun:test'
import { ok, started, tokenIn } from './harness.js'

describe('the reply of an agent\'s remake of a top task', () => {
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
