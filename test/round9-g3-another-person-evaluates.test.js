// Round 9, attacker G. Rule (DESIGN section 8, "Evaluation"): "An evaluation at the level
// direction or principle counts only after the person accepts it"; the CLI names that person as
// the owner ("It counts after Nanda accepts it", waiting: "waits for Nanda's accept"). Every other
// act of a person on a task is the owner's (Review.decide: "Bob (person) may not review this").
// Evaluation.write and Evaluation.review check only that the actor is a person, so any name in
// `people` writes an evaluation that counts at once, or accepts the evaluation that waits for the
// owner.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { main } from './code.js'
import { DIRECTION, FIT, init, INTRO_V1, ok, split, TASK, tokenIn, WORK_YAML } from
  './harness.js'

// The harness project, with Bob in people too; bob() is Bob at his own terminal.
function twoPeople() {
  const dir = mkdtempSync(join(tmpdir(), 'work-g3-'))
  const files = {
    'aristoteles.yaml': WORK_YAML.replace('  - name: Nanda\n', '  - name: Nanda\n  - name: Bob\n'),
    'directions/tsd-writing.yaml': DIRECTION, 'task.yaml': TASK, 'fit.yaml': FIT,
    'docs/tsd.md': '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nTODO\n',
    'docs/facts.md': '# Facts\n\n## Dedupe\n\nThe export ran twice for one merchant.\n',
  }
  const write = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  for (const [path, text] of Object.entries(files)) write(path, text)
  let minute = 0
  let tokens = 0
  const run = (line, { tty = false, typed, user = 'Nanda' } = {}) => {
    const out = []
    const err = []
    const io = {
      cwd: dir, out: (t) => out.push(t), err: (t) => err.push(t), isTTY: tty, readLine: () => typed,
      now: () => new Date(Date.UTC(2026, 9, 25, 9, minute++)).toISOString(), gitUser: () => user, env: { ARISTOTELES_DB: join(dir, '.work', 'aristoteles.db') },
      random: () => `k${String(++tokens).padStart(4, '0')}`,
    }
    return main(split(line), io).then((code) => ({ code, out: out.join('\n'), err: err.join('\n') }))
  }
  return {
    dir, write, agent: (line) => run(line),
    nanda: (line, typed) => run(line, { tty: true, typed }),
    bob: (line, typed) => run(line, { tty: true, typed, user: 'Bob' }),
  }
}

// Nanda opens t1; the writer a2 uses its one try on a fault, so t1 waits for an evaluation.
async function waitsForEvaluation() {
  const p = twoPeople()
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  const lead = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
  ok(await p.agent(`brief ${lead}`))
  const w = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
  ok(await p.agent(`brief ${w}`))
  p.write('docs/tsd.md', INTRO_V1)
  ok(await p.agent(`report ${w} --output=docs/tsd.md#introduction`))
  const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
  // Bob is a person of the project, but not the owner of t1: he may not criticise it.
  expect((await p.bob('review t1 reject --point="Bob does not like it"')).err).toContain('Bob (person) may not review this')
  return { p, lead }
}

describe('G3 a person who is not the owner acts on the owner\'s evaluation', () => {
  test('the architect\'s evaluation at the level principle waits for Nanda; Bob accepts it, and it counts', async () => {
    const { p } = await waitsForEvaluation()
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    expect(ok(await p.agent(`evaluate ${arch} t1 --wrong="r1 cites the ticket" --why="the spirit counts ids as facts" ` +
      '--improve="the spirit says that ids are not facts" --level=principle')).out).toContain('It counts after Nanda accepts it')
    // Correct: only Nanda accepts it. Today: "ev1 is accepted; it counts for t1."
    const accept = await p.bob('evaluation accept ev1 --reason="fine by me"')
    expect(accept.code).not.toBe(0)
    expect(ok(await p.nanda('evaluation show ev1')).out).toContain('waits for the person')
  }, 20000)

  test('Bob writes an evaluation of Nanda\'s t1 at the level principle; it counts at once, though the CLI says it waits for Nanda', async () => {
    const { p, lead } = await waitsForEvaluation()
    await p.bob('evaluate t1 --wrong="r1 cites the ticket" --why="the spirit counts ids as facts" ' +
      '--improve="the spirit says that ids are not facts" --level=principle')
    // Correct: t1 still waits for the owner (Bob's evaluation is refused, or waits for Nanda's
    // accept). Today: the CLI prints "It counts after Nanda accepts it", but ev1 shows "accepted:
    // written by the person", and the lead's next says that t1 waits for the change that ev1 asks for.
    expect((await p.nanda('evaluation show ev1')).out).not.toContain('accepted: written by the person')
    expect(ok(await p.agent(`next ${lead}`)).out).not.toContain('t1 waits for the change that ev1 asks for')
  }, 20000)
})
