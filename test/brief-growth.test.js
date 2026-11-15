// The brief carries what bears on the work now (owner, 2026-11-15: one fact, one reader). A
// checker reads the result it reviews, the rules it checks, and the points that are still open
// on that result; a maker on a redo reads the open points of the latest reject. The points of a
// result that its reviewer reviewed again on a newer result, and the resolutions of escalations
// on an older result, stay in the record (work blockers), not in the brief: a haiku judge's brief
// grew past its limit of 6000 with each round of review on one task (6117, then 6637).
import { describe, expect, test } from 'bun:test'
import { INTRO_V2, ok, project, WORK_YAML, init, tokenIn } from './harness.js'

// Haiku makers get enough attempts for the rounds of this test.
const ROUNDS = 5
const YAML = WORK_YAML.replace('attempts: 3 }', `attempts: ${ROUNDS + 1} }`)
const LONG = 'the paragraph names the export, the merchant, the day and the file twice over, ' +
  'and a reader cannot tell which run sent which file; say it once with the run id'

// The size of each block of a brief: its head word, and its characters with its lines below.
const blocks = (brief) => {
  const sizes = {}
  let head = 'HEAD'
  for (const line of brief.split('\n')) {
    const m = /^([A-Z][A-Z ]*[A-Z])(?= {2,}|$| [a-z])/.exec(line)
    if (m && !line.startsWith(' ') && /^(YOU ARE|ROLE|TASK|WORK IN|READ|RULES|CHECKS|REVIEW|ANSWERS|NOTES|OPEN|READY|YOUR TURN)$/.test(m[1])) head = m[1]
    sizes[head] = (sizes[head] ?? 0) + line.length + 1
  }
  return sizes
}

// N rounds: the writer reports, the linter rejects with a long point and escalates once; the
// lead resolves; the writer reports a changed section again.
async function rounds(n) {
  const p = project({ 'aristoteles.yaml': YAML })
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  const lead = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
  ok(await p.agent(`brief ${lead}`))
  const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=${n + 1}`)).out)
  const checker = []
  const maker = []
  let linter
  for (let i = 1; i <= n + 1; i++) {
    maker.push(ok(await p.agent(`brief ${writer}`)).out)
    p.write('docs/tsd.md', INTRO_V2.replace('two files', `two files (draft ${i})`))
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    if (linter === undefined) linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    checker.push(ok(await p.agent(`brief ${linter}`)).out)
    if (i > n) break
    const esc = ok(await p.agent(`escalate ${linter} --result=r${i} --reason="is the run id a ticket id? ${LONG}"`)).out
    const v = esc.match(/\b(v\d+)\b/)[1]
    ok(await p.agent(`resolve ${lead} ${v} --resolution="a run id is not a ticket id; ${LONG}"`))
    // The resolution on the result under review is in the brief of the one that escalated.
    expect(ok(await p.agent(`brief ${linter}`)).out).toContain(`escalated on r${i}:`)
    ok(await p.agent(`review ${linter} r${i} reject --point="round ${i}: ${LONG}" --breaks=no-ticket-ids ` +
      `--point="round ${i}, second: ${LONG}" --breaks=no-code-proof`))
  }
  return { p, checker, maker }
}

describe('the brief does not grow with closed rounds of review', () => {
  test('a checker reads the points of the latest round; a maker the points it must answer', async () => {
    const { checker, maker } = await rounds(ROUNDS)
    const open = (b) => blocks(b).OPEN ?? 0
    // Round 1 has no points; from round 2 on, the OPEN of each brief holds one round of points.
    for (const b of [...checker.slice(2), ...maker.slice(2)]) {
      expect(Math.abs(open(b) - open(checker[1]))).toBeLessThan(10)
    }
    expect(Math.abs(checker.at(-1).length - checker[1].length)).toBeLessThan(10)
    expect(Math.abs(maker.at(-1).length - maker[1].length)).toBeLessThan(10)
    // The checker of r6 reads the open points of r5, not those of r1 to r4, nor the resolutions
    // of its escalations on older results.
    const last = checker.at(-1)
    expect(last).toContain(`round ${ROUNDS}: ${LONG}`)
    expect(last).toContain(`round ${ROUNDS}, second: ${LONG}`)
    expect(last).not.toContain('round 1')
    expect(last).not.toContain('resolution (')
    // The maker of the last redo reads the points of the latest reject, each one.
    const redo = maker.at(-1)
    expect(redo).toContain(`round ${ROUNDS}: ${LONG}`)
    expect(redo).toContain(`round ${ROUNDS}, second: ${LONG}`)
    expect(redo).not.toContain(`round ${ROUNDS - 1}`)
  }, 60000)
})
