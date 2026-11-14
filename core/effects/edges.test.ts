// The edges of the supervisor of the terminals, ported from the old watcher's edge tests (bugs 4,
// 5, 14) and changed by ruling 10.1 (2026-11-13: no typing into terminals): a first prompt is an
// argument of the launch command; a prompt and a failure are stored once, also through a
// restart, and the host sees them as steps; a retry is a restart with the resume command; an agent
// that waits in `work wait` is not silent; the UI never starts, restarts or stops a host (the AI
// CLI that the person triggered, in its own pane); the end of work closes a terminal once. The
// effects run against a fake pump and the real dispatch; a refusal fails the test (afterEach).
import { afterEach, describe, expect, test } from 'bun:test'
import { create } from '../../src/domain/events.ts'
import type { Time } from '../../src/domain/ids.ts'
import { derive, nextFor } from '../derived/index.ts'
import { momentOf } from '../derived/support.test.ts'
import { fixedProblem, resumeSession, stopSession } from './index.ts'
import {
  cleanUp,
  clock,
  hosted,
  later,
  project,
  PROMPT,
  quiet,
  sendsInto,
  sendsTo,
  sid,
  supervised,
  terminalMoves,
  withLead,
} from './support.test.ts'

afterEach(cleanUp)

const derivedNow = (dir: string) => derive(momentOf(dir, new Date(clock.now).toISOString() as Time))
// The steps of an agent, the notices of ruling 10.1 among them.
const noticesOf = (dir: string, a: string) =>
  nextFor(derivedNow(dir), { _tag: 'Agent', assignment: a as never }).map((n) => n.what)

describe('the supervisor of the terminals (the old edge tests, under ruling 10.1)', () => {
  test('a first prompt is an argument of the launch command; no token is stored', async () => {
    const { p, fake, lead, leadToken } = await withLead()
    // The terra tier has no {prompt} in its launch command: the prompt is its last argument.
    const prompt = `'Use the work skill. Your command: work brief ${leadToken}'`
    expect(fake.commands).toContain(`start ${lead}: fake start ${lead} ${prompt}`)
    expect(fake.typed(lead)).toBe('')
    const [start] = sendsInto(p.work(), 'Start', lead)
    expect(start?.from).toMatchObject({ reason: { via: { _tag: 'LaunchArgument' } } })
    expect(start?.keys).toEqual({ _tag: 'StartPrompt' })
    expect(start?.state._tag).toBe('Delivered')
    expect(JSON.stringify(p.work().sends)).not.toContain(leadToken.split('.')[1] ?? '?')
    await p.agent(`brief ${leadToken}`)
  })

  test('the UI never restarts a host; S12: a live pane fixes no problem', async () => {
    const { p, fake, w, host } = await hosted()
    await p.ui('problem t1 --says="the host terminal failed 3 times"')
    fake.end(host)
    later(6 * 60_000)
    const [fixed] = await Promise.all([
      w.person(fixedProblem('sp1' as never)).catch((e: Error) => e.message),
      w.tick(),
    ])
    expect(fixed).toBe(
      'sp1: no host runs to try it; trigger the host in your AI CLI again, then click Fixed',
    )
    expect(fake.calls.filter((c) => c.startsWith('resume') || c.startsWith('start'))).toEqual([])
    // The person triggers the host again in another pane: the run continues there.
    await p.inPane('run continue h1 --quote="go on with the export"', '%5')
    await w.tick()
    const moved = p.work().runs.get('h1' as never)?.session ?? ''
    expect(moved).not.toBe(host)
    expect(fake.calls).toContain(`adopt ${moved}`)
    // S12: the next tick finds the host running, and still fixes nothing; the person's Fixed
    // ends the problem now that the host runs.
    later(6 * 60_000)
    await w.tick()
    expect(p.work().problems.get('sp1' as never)?.fixed._tag).toBe('NotFixed')
    expect(await w.person(fixedProblem('sp1' as never))).toBe(
      'sp1: the host runs, and the problem is fixed.',
    )
  })

  test('a continue of a run of an older store closes its old host window, once', async () => {
    const p = await project()
    later(60_000)
    const { fake, watcher } = await supervised(p)
    const w = watcher()
    // A run of an older store: its host ran in a window that the UI made (Run.HostStarted).
    const author = { _tag: 'Person' as const, name: 'Nanda', channel: 'ui' as const }
    await p.writeRaw(author, create('Run', { _tag: 'HostStarted', session: 's-old' as never }))
    fake.open('s-old')
    await w.tick()
    expect(fake.calls).not.toContain('stop s-old')
    await p.inPane('run continue h1 --quote="continue h1"', '%35')
    await w.tick()
    const moved = p.work().runs.get('h1' as never)
    expect(moved?.terminal).toEqual({
      _tag: 'Pane',
      socket: '/tmp/ar-test-person.sock',
      pane: '%35',
    })
    expect(moved?.formerSessions.map(String)).toEqual(['s-old'])
    expect(fake.calls).toContain('stop s-old')
    expect(fake.calls).toContain(`adopt ${moved?.session}`)
    // The same pane continues its own run again: the person started the AI CLI again there.
    await p.inPane('run continue h1 --quote="go on"', '%35')
    await w.tick()
    expect(fake.calls.filter((c) => c === 'stop s-old')).toHaveLength(1)
  })

  test("the page cannot stop or resume the host: it is the person's own terminal", async () => {
    const { fake, w, host } = await hosted()
    const words = 'the UI does not start, restart, or stop it'
    await expect(w.person(stopSession(sid(host)))).rejects.toThrow(words)
    // canAct refuses the Resume before the pump is asked (P5 words).
    await expect(w.person(resumeSession(sid(host), 'sol'))).rejects.toThrow(
      "is the host's own pane, the person's terminal; the page does not resume it",
    )
    expect(fake.calls.filter((c) => c.startsWith('resume'))).toEqual([])
  })

  test('bug 5: a prompt is stored once through a restart; 3 restarts, then 1 failure', async () => {
    const { p, fake, w, watcher, hostToken, lead } = await withLead()
    fake.show(lead, PROMPT)
    await w.tick()
    expect(terminalMoves(p.work(), lead, 'Prompted')).toHaveLength(1)
    // The host sees the prompt as a step; nothing goes into its pane.
    expect(noticesOf(p.dir, 'a1')).toContainEqual(
      expect.objectContaining({ _tag: 'AnswerPrompt', agent: 'a2', line: `«${PROMPT}»` }),
    )
    // The server starts again: a new supervisor reads the same store.
    const second = watcher()
    await second.tick()
    expect(terminalMoves(p.work(), lead, 'Prompted')).toHaveLength(1)
    // The host answers: the prompt is no step any more.
    await p.agent(`send ${hostToken} a2 --text=1`)
    await second.tick()
    expect(fake.typed(lead)).toBe('1\r')
    expect(noticesOf(p.dir, 'a1').map((n) => n._tag)).not.toContain('AnswerPrompt')
    // The lead's tool exits: two restarts, a restart of the server, then the third and the
    // failure, stored once.
    const fail = async (on: ReturnType<typeof watcher>) => {
      fake.end(lead)
      later(31_000)
      await on.tick()
    }
    await fail(second)
    await fail(second)
    const third = watcher()
    await fail(third)
    const attempts = sendsTo(p.work(), 'Retry').map((s) =>
      s.from._tag === 'Supervisor' && s.from.reason._tag === 'Retry' ? s.from.reason.attempt : 0,
    )
    expect(attempts).toEqual([1, 2, 3])
    // Each try is the resume command, with the retry prompt as its argument.
    const resumes = fake.commands.filter((c) => c.startsWith(`resume ${lead}:`))
    expect(resumes).toHaveLength(3)
    expect(resumes[0]).toContain(`fake resumed ${lead} 'System message, not from the person.`)
    await fail(third)
    await fail(watcher())
    expect(terminalMoves(p.work(), lead, 'Failed')).toHaveLength(1)
    expect(sendsTo(p.work(), 'Retry')).toHaveLength(3)
    // The host sees the failure as a step, until it records the problem.
    expect(noticesOf(p.dir, 'a1').map((n) => n._tag)).toContain('RecordFailure')
    await p.agent(`problem ${hostToken} t1 --says="the lead stops; its tool exits at once"`)
    expect(noticesOf(p.dir, 'a1').map((n) => n._tag)).not.toContain('RecordFailure')
    expect(fake.typed(lead)).toBe('1\r')
  })

  test('an agent that waits in work wait is not silent; a quiet one restarts', async () => {
    const { p, fake, w, host, lead, leadToken } = await withLead()
    await p.agent(`brief ${leadToken}`)
    fake.show(lead, 'work wait')
    // The lead and the host block in `work wait` past their silent minutes: no restart.
    fake.waiting.add(host)
    fake.waiting.add(lead)
    later(11 * 60_000)
    await w.tick()
    later(31_000)
    await w.tick()
    expect(sendsInto(p.work(), 'Retry', lead)).toEqual([])
    expect(fake.calls).not.toContain(`stop ${lead}`)
    // Its wait ended, and it does nothing: the live process restarts with its resume command.
    fake.waiting.delete(lead)
    await w.tick()
    expect(sendsInto(p.work(), 'Retry', lead)).toHaveLength(1)
    expect(fake.calls.filter((c) => c.endsWith(lead))).toEqual([
      `start ${lead}`,
      `stop ${lead}`,
      `resume ${lead}`,
    ])
    expect(fake.typed(lead)).toBe('')
  })

  test('a silent host that does not wait is a problem for the person, once', async () => {
    const { p, fake, w, host } = await hosted()
    later(11 * 60_000)
    await w.tick()
    await w.tick()
    expect(terminalMoves(p.work(), host, 'Failed')).toHaveLength(1)
    const says = [...p.work().problems.values()].map((x) => String(x.says))
    expect(says).toEqual([
      'The host is silent, and it does not wait for work. Its last lines: «fake agent start» ' +
        'Tell it in its terminal to go on.',
    ])
    expect(fake.calls.filter((c) => !c.startsWith('adopt'))).toEqual([])
    expect(fake.typed(host)).toBe('')
  })

  test('an ended host raises nothing and is not restarted, also through a restart', async () => {
    const { p, fake, watcher, host } = await hosted()
    for (const on of [watcher(), watcher(), watcher()]) {
      fake.end(host)
      later(31_000)
      await on.tick()
    }
    expect([...p.work().problems.values()]).toEqual([])
    expect(fake.calls.filter((c) => c.startsWith('resume'))).toEqual([])
  })

  test('a Stop holds through a restart: no restart, no retry', async () => {
    const { p, fake, w, watcher, lead, leadToken } = await withLead()
    await p.agent(`brief ${leadToken}`)
    await w.person(stopSession(sid(lead)))
    const second = watcher()
    later(11 * 60_000)
    await second.tick()
    expect(fake.calls.filter((c) => c.endsWith(lead))).toEqual([`start ${lead}`, `stop ${lead}`])
    expect(sendsInto(p.work(), 'Retry', lead)).toEqual([])
  })

  test('the end of work closes a terminal once, also through a restart', async () => {
    const { p, fake, w, watcher, hostToken, lead } = await withLead()
    fake.show(lead, 'fake agent start')
    await p.agent(`finish ${hostToken} a2`)
    // A busy terminal is not closed; a quiet one is.
    await w.tick()
    expect(fake.calls).not.toContain(`stop ${lead}`)
    quiet()
    await w.tick()
    expect(fake.calls).toContain(`stop ${lead}`)
    expect(terminalMoves(p.work(), lead, 'Closed')).toHaveLength(1)
    // A finished agent is not resumed (canAct, P5); a restart closes nothing twice.
    await expect(w.person(resumeSession(sid(lead), 'terra'))).rejects.toThrow('a2 is finished')
    quiet()
    await w.tick()
    await watcher().tick()
    expect(fake.calls.filter((c) => c === `stop ${lead}`)).toHaveLength(1)
    expect(fake.calls).not.toContain(`resume ${lead}`)
    expect(terminalMoves(p.work(), lead, 'Closed')).toHaveLength(1)
  })
})
