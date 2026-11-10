// Round 9, attacker H: an evaluation at the level of a direction or a principle "counts only after
// the person accepts it" (DESIGN section 8), and work next says it "waits for Nanda's accept" (the
// owner of the task). With two people in work.yaml, the other person accepts it for the owner, or
// writes an evaluation at the level of a principle that counts at once, on a task that is not
// theirs. The same person may not make the owner's direction official or reject the owner's task. Each
// test expects the CORRECT behaviour, so it fails while the fault is there.
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { main } from '../cli.js'
import { INTRO_V1, WORK_YAML, ok, split, started, tokenIn } from
  './harness.js'

// Budi at a terminal (git user.name Budi), on the day after every command of the harness.
let minute = 0
const budi = async (p, line, typed) => {
  const out = []
  const err = []
  const io = {
    cwd: p.dir, out: (t) => out.push(t), err: (t) => err.push(t), isTTY: true, readLine: () => typed,
    now: () => new Date(Date.UTC(2026, 9, 26, 9, minute++)).toISOString(), gitUser: () => 'Budi', env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') },
    random: () => `b${String(minute).padStart(4, '0')}`,
  }
  const code = await main(split(line), io)
  return { code, out: out.join('\n'), err: err.join('\n') }
}

// t1 is Nanda's; its writer (one try) used it on a fault, so t1 waits for an evaluation; the
// architect (a4) has read its brief.
async function exhausted() {
  const yaml = WORK_YAML.replace('  - name: Nanda\n', '  - name: Nanda\n  - name: Budi\n')
  const { p, lead } = await started({ 'work.yaml': yaml })
  const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', INTRO_V1)
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
  const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  return { p, lead, arch }
}

describe('H3 another person accepts or writes an evaluation for the owner', () => {
  test('the architect evaluates Nanda\'s t1 at the level principle; next says it waits for Nanda, and Budi accepts it', async () => {
    const { p, lead, arch } = await exhausted()
    ok(await p.agent(`evaluate ${arch} t1 --wrong="r1 cites the ticket" --why="the direction counts a ticket id as a fact" ` +
      '--improve="the spirit says that ids are not facts" --level=principle'))
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('ev1 evaluates t1 at the level principle, and waits for Nanda\'s accept')
    // Budi's accept of Nanda's draft does not make it official (control: the owner's accept is needed).
    p.write('edit.yaml', 'add:\n  - { id: units, says: Numbers have units. }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    const bd = await budi(p, 'review d2 accept --evidence="edit.yaml | looks right"', 'accept')
    expect(bd.out).toContain('v3: accept of d2; it waits for the accept of Nanda.')
    const r = await budi(p, 'review ev1 accept --evidence="work evaluation show ev1 | looks right to me"', 'accept')
    expect(r.err).toContain('Budi is not the owner of t1; Nanda accepts its evaluations')
    // Correct: refused; ev1 waits for Nanda's accept, as work next said.
    expect(r.code).toBe(1)
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('waits for Nanda\'s accept')
  }, 20000)

  test('Budi writes an evaluation of Nanda\'s t1 at the level principle, and it counts at once', async () => {
    const { p, lead } = await exhausted()
    const r = await budi(p, 'evaluate t1 --wrong="r1 cites the ticket" --why="ids are facts" --improve="ids are not facts" --level=principle')
    // Correct: an evaluation of a principle counts only with the owner's accept (Nanda's own
    // evaluation counts at once): either Budi's is refused, or it waits for Nanda.
    if (r.code === 0) expect(ok(await p.agent(`next ${lead}`)).out).toContain('waits for Nanda\'s accept')
    else expect(r.err).toContain('Nanda')
  }, 20000)
})
