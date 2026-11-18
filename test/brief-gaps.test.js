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
  solToken,
  TASK_WHOLE,
  tokenIn,
  WORK_YAML,
  withWriter,
  HOST,
} from './harness.js'


describe('the brief of an agent that escalated', () => {
})

describe('a review in a brief', () => {
  // A proofreader reviews the work of a linter, so it does not cover the writer of the result.
  // Ruling 7, onboarding 2026-11-14: the role says its persistence and its icon.
  const yaml =
    WORK_YAML.replace('acts: [{ approve: [writer] }, { assign: [writer, linter] }]', 'acts: [{ approve: [writer, proofreader] }, { assign: [writer, linter, proofreader] }]') +
    `  proofreader:
    model: haiku
    description: Reads a section for the lead.
    intro: You read.
    responsibilities:
      - Read it.
    acts: [{ review: [linter] }]
    persistence: { persistent: false, why: It reads one section once. }
    icon: eye
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
    expect(refused.err).toContain('may not review this: a result is reviewed by a role that reviews or approves its maker')
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
})

describe('send to an agent with no terminal', () => {
  test('each way of running names itself: a persistent agent and a subagent are not told the same words', async () => {
    const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
      ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    }
    ok(await p.run('run start', HOST))
    ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
    const host = await solToken(p, ok(await p.ui('task open td1')).out) // ruling 10.1
    ok(await p.agent(`brief ${host}`))
    ok(await p.agent(`assign ${host} t1 --role=section-lead`))
    ok(await p.agent(`assign ${host} t1 --role=writer --max-attempts=3`))
    const agent = await p.agent(`send ${host} a2 --text="yes"`)
    expect(agent.err).toContain('a2 has no terminal yet (it gets one when the UI starts its session)')
    expect(agent.err).not.toContain('subagent')
    const subagent = await p.agent(`send ${host} a3 --text="yes"`)
    expect(subagent.err).toContain('a3 has no terminal (a subagent runs inside the terminal of its parent)')
  }, 30000)
})

