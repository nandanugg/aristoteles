// Five gaps of the CLI that a walk found: the resolution of an escalation in the brief of the
// agent that escalated, a review offered only when the engine allows it, an id that keeps its
// case at the start of a reply, the words of a send to an agent with no terminal, and a --hope
// only for an open draft.
import { describe, expect, test } from 'bun:test'
import {
  INTRO_V2,
  init,
  ok,
  project,
  reported,
  started,
  TASK_WHOLE,
  tokenIn,
  WORK_YAML,
  withWriter,
} from './harness.js'

const HOST = { tty: true, env: { ARISTOTELES_SESSION: 's-host' } }

describe('the brief of an agent that escalated', () => {
  test('a resolved escalation shows who resolved it and the words, in OPEN', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`escalate ${linter} --result=r1 --reason="is the date needed?"`))
    const waiting = ok(await p.agent('assignment show a3')).out
    expect(waiting).not.toContain('resolution (')
    ok(await p.agent(`resolve ${lead} v2 --resolution="the date is not needed"`))
    const brief = ok(await p.agent('assignment show a3')).out
    expect(brief).toContain('OPEN')
    expect(brief).toContain('v2 escalated on r1: "is the date needed?" (resolved by a1)')
    expect(brief).toContain('resolution (v3): the date is not needed')
  }, 30000)

  test('the answer of a question escalated with no result is shown as an answer', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`escalate ${writer} --reason="the facts file names no merchant"`))
    ok(await p.agent(`answer ${lead} q1 --text="use merchant m-17"`))
    const brief = ok(await p.agent(`brief ${writer}`)).out
    expect(brief).toContain('q1 asked by a2: the facts file names no merchant')
    expect(brief).toContain('answer (a1): use merchant m-17')
  }, 30000)
})

describe('a review in a brief', () => {
  // A proofreader reviews the work of a linter, so it does not cover the writer of the result.
  const yaml =
    WORK_YAML.replace('acts: [{ approve: [writer] }]', 'acts: [{ approve: [writer, proofreader] }]') +
    `  proofreader:
    tier: low
    description: Reads a section for the lead.
    intro: You read.
    responsibilities:
      - Read it.
    acts: [{ review: [linter] }]
`
  test('a role that does not cover the maker gets no accept line, and the engine refuses it', async () => {
    const { p, lead } = await started({ 'aristoteles.yaml': yaml })
    ok(await p.nanda('role fit proofreader --answers=fit.yaml'))
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=3`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const proof = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=proofreader`)).out)
    const brief = ok(await p.agent(`brief ${proof}`)).out
    expect(brief).not.toContain('work review')
    expect(brief).toContain('your role may not review it')
    expect(brief).toContain('escalate')
    const refused = await p.agent(`review ${proof} r1 reject --point="no"`)
    expect(refused.err).toContain('may not review this')
  }, 30000)

  test('a role that covers the maker gets the accept line, and the engine takes it', async () => {
    const { p, linter } = await reported()
    const brief = ok(await p.agent('assignment show a3')).out
    expect(brief).toContain('work review a3.<token> r1 accept')
    const seen = '| docs/tsd.md#introduction | nothing of the kind'
    const evidence = ['no-code-proof', 'no-ticket-ids'].map((r) => `--evidence="${r} ${seen}"`)
    ok(await p.agent(`review ${linter} r1 accept ${evidence.join(' ')}`))
  }, 30000)
})

describe('the first word of a reply', () => {
  test('an id keeps its case at the start of a reply', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    const escalated = ok(await p.agent(`escalate ${writer} --reason="no merchant"`)).out
    expect(escalated).toStartWith('q1 escalated to a1.')
    const answered = ok(await p.agent(`answer ${lead} q1 --text="m-17"`)).out
    expect(answered).toStartWith('q1 answered;')
  }, 30000)
})

describe('send to an agent with no terminal', () => {
  test('each tier names itself: a Terra and a Luna are not told the same words', async () => {
    const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
      ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    }
    ok(await p.ui('run start --kind=host --session=s-host'))
    ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
    const host = tokenIn(ok(await p.ui('task open td1')).out)
    ok(await p.agent(`brief ${host}`))
    ok(await p.agent(`assign ${host} t1 --role=section-lead`))
    ok(await p.agent(`assign ${host} t1 --role=writer --max-attempts=3`))
    const terra = await p.agent(`send ${host} a2 --text="yes"`)
    expect(terra.err).toContain('a2 has no terminal yet (a Terra gets one')
    expect(terra.err).not.toContain('Luna')
    const luna = await p.agent(`send ${host} a3 --text="yes"`)
    expect(luna.err).toContain('a3 has no terminal (a Luna runs inside the terminal of its parent)')
  }, 30000)
})

