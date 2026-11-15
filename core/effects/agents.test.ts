// The supervisor and the persistent agents (rulings 7 and 9, onboarding 2026-11-14). Only a
// persistent agent gets a terminal; a disposable role runs as a subagent of the terminal that
// gives it. One agent holds every assignment of its role in its project, in one terminal, from
// its first assignment to the end of the project: silence between assignments is no fault, and
// an end of its process is restarted up to 3 times. The effects run against a fake pump and the
// real dispatch; a refusal fails the test (afterEach).
import { afterEach, describe, expect, test } from 'bun:test'
import type { Time } from '../../src/domain/ids.ts'
import { derive, nextFor, terminalsToStart } from '../derived/index.ts'
import { momentOf } from '../derived/support.test.ts'
import {
  cleanUp,
  clock,
  hosted,
  later,
  PROMPT,
  sendsInto,
  terminalMoves,
  tokenIn,
  withLead,
} from './support.test.ts'
import { cliSession } from './lines.ts'

afterEach(cleanUp)

const derivedNow = (dir: string) => derive(momentOf(dir, new Date(clock.now).toISOString() as Time))
// The AgentState of p1, as plain values to compare with literals.
const agentState = (dir: string): unknown => derivedNow(dir).states.agents.get('p1' as never)
const PARTS =
  '- { name: Part one, text: Write part one., context: { section: introduction } }\n' +
  '- { name: Part two, text: Write part two., context: { section: design } }\n'
const startsOf = (commands: ReadonlyArray<string>, host: string) =>
  commands.filter((c) => c.startsWith('start ') && !c.includes(host))

describe('the persistent agents', () => {
  test('an agent with no terminal starts once; StartAgent stores its session', async () => {
    const { p, fake, w, host, hostToken } = await hosted()
    await p.agent(`assign ${hostToken} t1 --role=section-lead`)
    expect(p.work().agents.get('p1' as never)?.terminal._tag).toBe('NotStarted')
    await w.tick()
    await w.tick()
    const starts = startsOf(fake.commands, host)
    expect(starts).toHaveLength(1)
    const terminal = p.work().agents.get('p1' as never)?.terminal
    expect(terminal?._tag).toBe('Started')
    const session = terminal?._tag === 'Started' ? terminal.session : ''
    // The command names the session as a UUID (Nanda, 2026-11-15: an AI CLI takes no other id).
    expect(starts[0]).toStartWith(`start ${session}: fake start ${cliSession(session)} `)
  })

  test('two assignments of a role in a run start one terminal; one wait gives both', async () => {
    const { p, fake, w, host, hostToken } = await hosted()
    p.write('parts.yaml', PARTS)
    await p.agent(`task split ${hostToken} t1 --file=parts.yaml`)
    await p.agent(`assign ${hostToken} t2 --role=section-lead`)
    await p.agent(`assign ${hostToken} t3 --role=section-lead`)
    await w.tick()
    await w.tick()
    const starts = startsOf(fake.commands, host)
    expect(starts).toHaveLength(1)
    const lead = starts[0]?.slice(6, starts[0].indexOf(':')) ?? ''
    expect(agentState(p.dir)).toEqual({ _tag: 'OnAssignment', assignments: ['a2', 'a3'] })
    // The agent's wait in its terminal gives it each assignment with a token, in its session.
    const out = await p.inSession('wait --by=p1 --seconds=1', lead)
    const tokens = [...out.matchAll(/work brief (a\d+\.[a-z0-9]+)/g)].map((m) => m[1])
    expect(tokens.map((t) => t?.split('.')[0])).toEqual(['a2', 'a3'])
    expect(p.work().sessions.get('a2' as never)?.session).toBe(lead as never)
    expect(p.work().sessions.get('a3' as never)?.session).toBe(lead as never)
    for (const token of tokens) await p.agent(`brief ${token}`)
    await w.tick()
    expect(startsOf(fake.commands, host)).toHaveLength(1)
    // A prompt in that terminal is one step of the host, not one for each assignment.
    fake.show(lead, PROMPT)
    await w.tick()
    const prompts = nextFor(derivedNow(p.dir), { _tag: 'Agent', assignment: 'a1' as never })
      .map((n) => n.what)
      .filter((n) => n._tag === 'AnswerPrompt')
    expect(prompts).toEqual([expect.objectContaining({ agent: 'a2', session: lead })])
  })

  test('a disposable role runs as a subagent: no terminal starts or retries', async () => {
    const { p, fake, w, hostToken } = await hosted()
    const writer = tokenIn(await p.agent(`assign ${hostToken} t1 --role=writer`))
    expect(p.work().assignments.get('a2' as never)?.runs).toEqual({
      _tag: 'Subagent',
      tier: 'low',
    })
    await p.agent(`brief ${writer}`)
    later(11 * 60_000)
    await w.tick()
    expect(fake.calls.filter((c) => !c.startsWith('adopt'))).toEqual([])
    expect(p.work().agents.size).toBe(0)
  })

  test('an agent keeps its terminal between assignments, and its silence is no fault', async () => {
    const { p, fake, w, host, hostToken, lead, leadToken } = await withLead()
    await p.agent(`brief ${leadToken}`)
    await p.agent(`finish ${hostToken} a2`)
    expect(agentState(p.dir)).toEqual({ _tag: 'Between' })
    // Silent and not in work wait, past its silent minutes: Between, so no restart and no close.
    later(11 * 60_000)
    await w.tick()
    later(31_000)
    await w.tick()
    expect(sendsInto(p.work(), 'Retry', lead)).toEqual([])
    expect(terminalMoves(p.work(), lead, 'Failed')).toEqual([])
    expect(fake.calls.filter((c) => c.endsWith(lead))).toEqual([`start ${lead}`])
    // A new assignment of its role goes to the same agent, in the same terminal.
    await p.agent(`assign ${hostToken} t1 --role=section-lead`)
    await w.tick()
    expect(startsOf(fake.commands, host)).toHaveLength(1)
    const again = await p.inSession('wait --by=p1 --seconds=1', lead)
    expect(again).toContain('a3 is yours: t1 The Introduction, as section-lead.')
  })

  test('an ended agent process restarts up to 3 times, then fails once', async () => {
    const { p, fake, watcher, lead, leadToken } = await withLead()
    await p.agent(`brief ${leadToken}`)
    for (const _ of [1, 2, 3, 4, 5]) {
      fake.end(lead)
      later(31_000)
      await watcher().tick()
    }
    expect(sendsInto(p.work(), 'Retry', lead)).toHaveLength(3)
    const resumes = fake.commands.filter((c) => c.startsWith(`resume ${lead}:`))
    expect(resumes).toHaveLength(3)
    expect(resumes[0]).toContain(
      "'System message, not from the person. Run work wait --by=p1, and do what it prints.'",
    )
    expect(terminalMoves(p.work(), lead, 'Failed')).toHaveLength(1)
  })

  // Nanda, 2026-11-15: the host hears at once of an agent that failed while it waited for work.
  test('an agent that fails between assignments is a step of its host, on the top task', async () => {
    const { p, fake, watcher, lead, leadToken, hostToken } = await withLead()
    await p.agent(`brief ${leadToken}`)
    await p.agent(`finish ${hostToken} a2`)
    expect(agentState(p.dir)).toEqual({ _tag: 'Between' })
    for (const _ of [1, 2, 3, 4, 5]) {
      fake.end(lead)
      later(31_000)
      await watcher().tick()
    }
    expect(terminalMoves(p.work(), lead, 'Failed')).toHaveLength(1)
    const hostSteps = () =>
      nextFor(derivedNow(p.dir), { _tag: 'Agent', assignment: 'a1' as never }).map((n) => n.what)
    expect(hostSteps()).toContainEqual(
      expect.objectContaining({ _tag: 'RecordAgentFailure', agent: 'p1', task: 't1' }),
    )
    await p.agent(`problem ${hostToken} t1 --says="p1 failed 3 times while it waited for work"`)
    expect(hostSteps().map((s) => s._tag)).not.toContain('RecordAgentFailure')
  })

  test('a terminal that the pump lost before its first assignment starts again, once', async () => {
    const { p, w, hostToken } = await hosted()
    await p.agent(`assign ${hostToken} t1 --role=section-lead`)
    await w.tick()
    const terminal = p.work().agents.get('p1' as never)?.terminal
    const session = terminal?._tag === 'Started' ? terminal.session : ''
    // The pump sees no terminal of the agent (its launch failed, or tmux restarted).
    const lost = () => {
      const m = momentOf(p.dir, new Date(clock.now).toISOString() as Time)
      return terminalsToStart(derive({ ...m, outside: { ...m.outside, terminals: {} } }))
    }
    expect(lost() as unknown).toEqual([{ agent: 'p1', session: { _tag: 'Again', session } }])
    // Once its wait took an assignment, the agent has worked there: the person resumes it.
    await p.inSession('wait --by=p1 --seconds=1', session)
    expect(lost()).toEqual([])
  })
})
