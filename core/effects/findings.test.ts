// One edge test for each finding that the effects close (plan/rebuild/PLAN.md), and the ruling
// 10.1 (2026-11-13): C1 (an agent of an ended task is not supervised, and its terminal closes
// because its AssignmentState is Ended), C5 (a send whose owner ended is Irrelevant: never typed),
// B8 (nothing of the supervisor goes into an AI CLI's dialog; no words are asked for an item that
// shows at once), S1 (the host's pane is watched only while its RunState is open), S12 (a
// problem's fix comes from ProblemState, not from a live pane), and 10.1 itself: in a whole
// project the supervisor types nothing; what it typed before is a step of the actor.
import { afterEach, describe, expect, test } from 'bun:test'
import type { Time } from '../../src/domain/ids.ts'
import { derive, nextFor, stepKey } from '../derived/index.ts'
import { momentOf } from '../derived/support.test.ts'
import { fixedProblem } from './index.ts'
import {
  cleanUp,
  clock,
  hosted,
  INTRO_V2,
  later,
  PROMPT,
  quiet,
  sendsInto,
  sendsTo,
  terminalMoves,
  tokenIn,
  withLead,
} from './support.test.ts'

afterEach(cleanUp)

const derivedNow = (dir: string) => derive(momentOf(dir, new Date(clock.now).toISOString() as Time))
// The steps of an agent, the notices of ruling 10.1 among them.
const noticesOf = (dir: string, a: string) =>
  nextFor(derivedNow(dir), { _tag: 'Agent', assignment: a as never })
const tagsOf = (dir: string, a: string) => noticesOf(dir, a).map((n) => n.what._tag)
const REMAKE = 'task remake {host} t1 --file=again.yaml --reason="the text asks for the cost"'
// A change of the direction (dir-wide: the host's explain step is another package's, 10.10).
const COST =
  'add:\n  - { id: cost-first, says: Say what the problem costs., rules: [ { id: names-cost, ' +
  'says: "The introduction names the cost", checkedBy: linter } ] }\n'

// The lead read the brief that its launch command gave it.
const briefedLead = async () => {
  const s = await withLead()
  await s.p.agent(`brief ${s.leadToken}`)
  return s
}

describe('the findings that the effects close', () => {
  test('C1: the remake of t1 ends its lead; no retry, and its terminal closes once', async () => {
    const { p, fake, w, hostToken, lead } = await briefedLead()
    // The host remakes t1: no finish of a2, and no cascade event; a2 is Ended by its task.
    await p.agent(REMAKE.replace('{host}', hostToken))
    expect(derivedNow(p.dir).states.assignments.get('a2' as never)).toMatchObject({
      _tag: 'Ended',
      why: { _tag: 'TaskEnded', task: 't1' },
    })
    // Its tool exits: an agent of an ended task is not supervised, so nothing is tried again.
    fake.end(lead)
    later(31_000)
    await w.tick()
    later(31_000)
    await w.tick()
    expect(sendsInto(p.work(), 'Retry', lead)).toEqual([])
    expect(fake.calls).not.toContain(`resume ${lead}`)
    expect(terminalMoves(p.work(), lead, 'Failed')).toEqual([])
    // Its terminal closes because its AssignmentState is Ended, once.
    expect(fake.calls.filter((c) => c === `stop ${lead}`)).toHaveLength(1)
    expect(terminalMoves(p.work(), lead, 'Closed')).toHaveLength(1)
  })

  test('C5: a send to an agent that ended is irrelevant: it is never typed', async () => {
    const { p, fake, w, hostToken, lead } = await briefedLead()
    // The host answers a prompt of the lead; before the next tick, t1 is remade.
    await p.agent(`send ${hostToken} a2 --text=1`)
    await p.agent(REMAKE.replace('{host}', hostToken))
    quiet()
    await w.tick()
    expect(fake.typed(lead)).toBe('')
    expect(fake.calls).toContain(`stop ${lead}`)
    // No drop reason says "its owner ended": the store keeps it Pending, Derived: Irrelevant.
    const sent = p.work().sends.find((s) => s.from._tag === 'Agent')
    expect(sent?.state._tag).toBe('Pending')
    expect(derivedNow(p.dir).states.sends.get(sent?.id ?? ('e0' as never))).toMatchObject({
      _tag: 'Irrelevant',
      why: { _tag: 'OwnerEnded', assignment: 'a2' },
    })
  })

  test("B8: nothing of the supervisor goes into an AI CLI's dialog; work send does", async () => {
    const { p, fake, w, hostToken, lead, leadToken } = await briefedLead()
    await p.agent(`ask ${leadToken} --text="is the cost in the facts?" --to=owner`)
    expect(tagsOf(p.dir, 'a2')).toContain('WaitsForAnswer')
    // The lead's AI CLI asks: the prompt is stored, and the host sees it as a step.
    fake.show(lead, PROMPT)
    await w.tick()
    expect(terminalMoves(p.work(), lead, 'Prompted')).toHaveLength(1)
    expect(tagsOf(p.dir, 'a1')).toContain('AnswerPrompt')
    // The question of the lead is answered: a step of the lead, and nothing typed into it.
    await p.agent(`answer ${hostToken} q1 --text="No: the cost is a task of its own."`)
    quiet()
    await w.tick()
    expect(tagsOf(p.dir, 'a2')).toContain('Answered')
    expect(fake.typed(lead)).toBe('')
    // The host's own answer to the dialog is typed at once.
    await p.agent(`send ${hostToken} a2 --text=1`)
    await w.tick()
    expect(fake.typed(lead)).toBe('1\r')
    expect(tagsOf(p.dir, 'a1')).not.toContain('AnswerPrompt')
  })

  test('B8: no words are asked for a problem that the UI recorded: it shows at once', async () => {
    const { p, w } = await hosted()
    await p.ui('problem t1 --says="the lint server is down"')
    quiet()
    await w.tick()
    later(10 * 60_000)
    await w.tick()
    expect(tagsOf(p.dir, 'a1')).not.toContain('WriteEndWords')
    expect(sendsTo(p.work(), 'DecisionNeedsWords')).toEqual([])
  })

  test('S11: the end of a project waits for its host\'s words: a step, until written', async () => {
    const { p, fake, w, host, hostToken } = await hosted()
    // The host's Luna writes t1, a linter checks it, and the host accepts it: the end waits.
    const writer = tokenIn(await p.agent(`assign ${hostToken} t1 --role=writer`))
    await p.agent(`brief ${writer}`)
    p.write('docs/tsd.md', INTRO_V2)
    await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)
    const linter = tokenIn(await p.agent(`assign ${hostToken} t1 --role=linter`))
    await p.agent(`brief ${linter}`)
    await p.agent(
      `review ${linter} r1 accept --evidence="no-code-proof | the introduction | no paths there" ` +
        '--evidence="no-ticket-ids | the introduction | no ticket ids there"',
    )
    await p.agent(
      `review ${hostToken} r1 accept --evidence="docs/tsd.md, the introduction | it says it"`,
    )
    quiet()
    await w.tick()
    expect(noticesOf(p.dir, 'a1').map((n) => n.what)).toContainEqual({
      _tag: 'WriteEndWords',
      run: 'h1' as never,
    })
    expect(fake.typed(host)).toBe('')
    await p.agent(`note ${hostToken} words --on=h1 --text="The TSD is whole."`)
    expect(tagsOf(p.dir, 'a1')).not.toContain('WriteEndWords')
  })

  test("S12: the host's problem waits; the person's Fixed is an ask; its fix ends it", async () => {
    const { p, fake, w, host, hostToken } = await hosted()
    await p.agent(`problem ${hostToken} t1 --says="the lint server is down"`)
    const waits = () => noticesOf(p.dir, 'a1').filter((n) => n.what._tag === 'TestProblem')
    // A Wait step: work wait does not return on it at once while the outside is broken.
    expect(waits().map((n) => n._tag)).toEqual(['Wait'])
    const before = stepKey(waits())
    expect(await w.person(fixedProblem('sp1' as never))).toBe(
      'sp1: the host tries it again now; the decision goes when the host records the fix.',
    )
    // The ask is stored (its key changes, so the host's wait returns), and never typed.
    expect(stepKey(waits())).not.toBe(before)
    quiet()
    await w.tick()
    expect(fake.typed(host)).toBe('')
    expect(sendsTo(p.work(), 'ProblemRetry').map((s) => s.state._tag)).toEqual(['Pending'])
    await p.agent(`problem ${hostToken} sp1 --fixed`)
    expect(waits()).toEqual([])
  })

  test('S1: a run whose top task closed is Closed: its pane is released, not retried', async () => {
    const { p, fake, w, host } = await hosted()
    // The person closes the top task at a terminal; no `run close` (run.end stays NotEnded).
    await p.nanda('task close t1 --reason="not needed any more"', 'close')
    expect(p.work().runs.get('h1' as never)?.end._tag).toBe('NotEnded')
    expect(derivedNow(p.dir).states.runs.get('h1' as never)?._tag).toBe('Closed')
    await w.tick()
    expect(fake.calls).toContain(`release ${host}`)
    // Silence or an end in the person's pane is not the supervisor's any more.
    for (const _ of [1, 2, 3, 4]) {
      later(11 * 60_000)
      await w.tick()
    }
    expect(fake.calls.filter((c) => c === `adopt ${host}`)).toHaveLength(1)
    expect(sendsTo(p.work(), 'Retry')).toEqual([])
    expect([...p.work().problems.values()]).toEqual([])
  })

  test('S12: a live host pane fixes no problem; an act of its tree recovers it', async () => {
    const { p, w, hostToken, rec } = await hosted()
    await p.ui('problem t1 --says="the host terminal failed 3 times"')
    for (const _ of [1, 2]) {
      later(6 * 60_000)
      await w.tick()
    }
    expect(p.work().problems.get('sp1' as never)?.fixed._tag).toBe('NotFixed')
    expect(rec.calls.filter((c) => c.input._tag === 'FixProblem')).toEqual([])
    // The host acts in t1's tree: the work goes on, and the problem is Recovered, not Fixed.
    await p.agent(`note ${hostToken} message --text="the lint server runs again"`)
    expect(derivedNow(p.dir).states.problems.get('sp1' as never)?._tag).toBe('Recovered')
    expect(await w.person(fixedProblem('sp1' as never)).catch((e: Error) => e.message)).toBe(
      'sp1 is no open system problem',
    )
  })

  test('10.1: in a whole project the supervisor types nothing; only work send does', async () => {
    const { p, fake, w, host, hostToken, lead, leadToken } = await briefedLead()
    const tick = async () => {
      quiet()
      await w.tick()
    }
    // A question and its answer, a direction change and its words, a prompt and its answer.
    await p.agent(`ask ${leadToken} --text="is the cost in the facts?" --to=owner`)
    await tick()
    await p.agent(`answer ${hostToken} q1 --text="No: the cost is a task of its own."`)
    await tick()
    p.write('cost.yaml', COST)
    await p.agent(`direction revise ${hostToken} tsd-writing --file=cost.yaml`)
    await tick()
    later(11 * 60_000)
    await tick()
    fake.show(lead, PROMPT)
    await tick()
    await p.agent(`send ${hostToken} a2 --text=1`)
    await tick()
    // A problem of the host, the person's Fixed, the host's fix; then the lead finishes.
    await p.agent(`problem ${hostToken} t1 --says="the lint server is down"`)
    await w.person(fixedProblem('sp1' as never))
    await tick()
    await p.agent(`problem ${hostToken} sp1 --fixed`)
    await p.agent(`finish ${hostToken} a2`)
    await tick()
    await tick()
    expect(fake.allTyped()).toEqual({ [lead]: '1\r' })
    expect(fake.typed(host)).toBe('')
    // No supervisor line was stored to be typed: only the starts and the person's ask.
    const supervisor = p.work().sends.flatMap((s) =>
      s.from._tag === 'Supervisor' ? [s.from.reason._tag] : [],
    )
    expect([...new Set(supervisor)].sort()).toEqual(['ProblemRetry', 'Start'])
  })
})
