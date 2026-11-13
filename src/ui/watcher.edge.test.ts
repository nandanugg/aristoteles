// The edges of the supervisor of the terminals (package P9; plan/types/PLAN.md bugs 4, 5, 13,
// 14, 15): a Stop holds through a problem retry and a restart; a restart keeps what went up
// (stops, closes, retries, prompts, wakes and their times); a change of words alone wakes
// nobody; the UI never starts, restarts, or stops a host (the AI CLI that the person triggered, in
// its own pane, Nanda 2026-11-13); a Stop and a Resume never get the old first input typed into
// the new process; the end of work closes a terminal once. The new CLI runs on
// a dir in a temp folder, and a fake pump stands for tmux, so no test needs tmux.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { main } from '../cli.ts'
import type { AssignmentId } from '../domain/ids.ts'
import type { Send } from '../domain/ui-model.ts'
import type { Work } from '../domain/work.ts'
import { replay } from '../replay/replay.ts'
import { Env } from '../services/io.ts'
import { Store } from '../services/store.ts'
import { StoreLive } from '../store/sqlite.ts'
import { nextLines, nextSteps, stepKey } from '../words/next.ts'
import type { Pump, TerminalStatus } from './pump.ts'
import { createWatcher } from './watcher.ts'
// @ts-expect-error the harness of the old tests is plain JavaScript with no types
import * as harness from '../../test/harness.js'

const { WORK_YAML, DIRECTION, TASK_WHOLE, FIT } = harness as {
  readonly WORK_YAML: string
  readonly DIRECTION: string
  readonly TASK_WHOLE: string
  readonly FIT: string
}
// Splits a command line like a shell: "double quotes" keep spaces.
const words = (harness as { split: (line: string) => ReadonlyArray<string> }).split

// The sol tier gets its first input as an argument; the terra tier has it typed when it is
// ready, as a tool with no {prompt} in its launch command does.
const SETTINGS = `tiers:
  sol:
    launch: fake start {session} {prompt}
    resume: fake resumed {session} {prompt}
    prompts: ["Do you want to proceed?"]
  terra:
    launch: fake start {session}
    resume: fake resumed {session} {prompt}
    prompts: ["Do you want to proceed?"]
`
const PROMPT = 'Do you want to proceed? (1 yes / 2 no)'
const RUN_NEXT = 'Run work next with your token, and do what it says.'
const NEXT_CHANGED = `Your next step changed while you waited. ${RUN_NEXT}`

// One clock for the CLI, the watcher and the fake pump; the test moves it.
const clock = { now: Date.UTC(2026, 10, 12, 9, 0, 0) }
const later = (ms: number) => {
  clock.now += ms
}

// A fake tmux: each terminal is live or ended, has a screen and a time of its last output, and
// keeps what was typed into it. A resume of a live one fails as tmux's does.
const fakePump = () => {
  const terms = new Map<string, { live: boolean; screen: Array<string>; lastOutput: number }>()
  const typed = new Map<string, string>()
  const calls: Array<string> = []
  let resumeFails = false
  // The host's own pane: the fake shows it as a terminal, and refuses to start or stop it.
  const panes = new Map<string, { readonly socket: string; readonly pane: string }>()
  const ownPane = (sid: string) => {
    throw new Error(`${sid} is the host's own terminal; the UI does not start, restart, or stop it`)
  }
  const pump: Pump = {
    name: 'fake',
    socket: 'fake',
    dir: '',
    start(sid) {
      if (panes.has(sid)) return ownPane(sid)
      if (terms.has(sid)) throw new Error(`the session ${sid} has a terminal already`)
      calls.push(`start ${sid}`)
      terms.set(sid, { live: true, screen: [], lastOutput: 0 })
      return sid
    },
    resume(sid) {
      if (panes.has(sid)) return ownPane(sid)
      if (terms.get(sid)?.live) throw new Error(`the session ${sid} runs`)
      if (resumeFails) throw new Error('tmux: no server running')
      calls.push(`resume ${sid}`)
      terms.set(sid, { live: true, screen: [], lastOutput: 0 })
      return sid
    },
    input(sid, text) {
      if (!terms.get(sid)?.live) throw new Error(`the session ${sid} has no terminal`)
      typed.set(sid, (typed.get(sid) ?? '') + text)
    },
    resize() {},
    stop(sid) {
      if (panes.has(sid)) return ownPane(sid)
      calls.push(`stop ${sid}`)
      terms.delete(sid)
    },
    snapshot: () => new Uint8Array(),
    status: () =>
      Object.fromEntries(
        [...terms].map(([sid, t]): [string, TerminalStatus] => [
          sid,
          { live: t.live, ended: !t.live, exit: t.live ? null : 1, lastOutput: t.lastOutput },
        ]),
      ),
    tail: (sid) => terms.get(sid)?.screen.join('\n') ?? '',
    adopt(sid, socket, pane) {
      if (panes.has(sid)) return
      panes.set(sid, { socket, pane })
      calls.push(`adopt ${sid}`)
      terms.set(sid, { live: true, screen: [], lastOutput: 0 })
    },
    release(sid) {
      panes.delete(sid)
      terms.delete(sid)
    },
    paneOf: (sid) => panes.get(sid),
    close() {},
    killServer() {},
  }
  return {
    pump,
    calls,
    typed: (sid: string) => typed.get(sid) ?? '',
    // The terminal prints a line now.
    show: (sid: string, line: string) => {
      const t = terms.get(sid)
      if (t === undefined) throw new Error(`no fake terminal ${sid}`)
      t.screen.push(line)
      t.lastOutput = clock.now
    },
    // Its tool exits: the pane stays, ended.
    end: (sid: string) => {
      const t = terms.get(sid)
      if (t !== undefined) t.live = false
    },
    failResume: (fails: boolean) => {
      resumeFails = fails
    },
  }
}

// A dir with its directions accepted and its roles fitted, the new CLI on it, and its store.
const project = async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'work-watcher-')), 'report-export')
  const files: Record<string, string> = {
    'aristoteles.yaml': SETTINGS + WORK_YAML,
    'directions/tsd-writing.yaml': DIRECTION,
    'top.yaml': `${TASK_WHOLE}role: architect\n`,
    'fit.yaml': FIT,
    'docs/tsd.md': '# TSD\n\n## Introduction\n\nTODO\n',
    'docs/facts.md': '# Facts\n\n## Dedupe\n\nThe export ran twice for one merchant.\n',
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  const env = { ARISTOTELES_DB: join(dir, '.work', 'aristoteles.db') }
  let tokens = 0
  const run = async (
    argv: ReadonlyArray<string>,
    o: { tty?: boolean; channel?: string; typed?: string; session?: string; pane?: string } = {},
  ) => {
    const out: Array<string> = []
    const err: Array<string> = []
    const code = await main(argv, {
      cwd: dir,
      out: (t) => out.push(t),
      err: (t) => err.push(t),
      isTTY: o.tty ?? false,
      channel: o.channel,
      readLine: () => o.typed,
      now: () => new Date(clock.now).toISOString(),
      gitUser: () => 'Nanda',
      env: o.session
        ? { ...env, ARISTOTELES_SESSION: o.session }
        : o.pane
          ? { ...env, TMUX: '/tmp/ar-test-person.sock,1,0', TMUX_PANE: o.pane }
          : env,
      random: () => `k${String(++tokens).padStart(4, '0')}`,
    })
    return { code, out: out.join('\n'), err: err.join('\n') }
  }
  const ok = async (r: Promise<{ code: number; out: string; err: string }>) => {
    const done = await r
    if (done.code !== 0) throw new Error(done.err)
    return done.out
  }
  const nanda = (line: string, typed?: string) => ok(run(words(line), { tty: true, typed }))
  const ui = (line: string) => ok(run(words(line), { channel: 'ui' }))
  const agent = (line: string) => ok(run(words(line)))
  const inSession = (session: string, line: string) => ok(run(words(line), { tty: true, session }))
  // The host: the AI CLI that the person triggered, in a pane of the person's tmux server.
  const inPane = (line: string, pane = '%9') => ok(run(words(line), { pane }))
  const readState = (): Work | undefined =>
    Effect.runSync(
      Effect.gen(function* () {
        const store = yield* Store
        const opened = yield* store.open(dir, { create: false })
        return yield* replay(yield* opened.events)
      }).pipe(
        Effect.scoped,
        Effect.provide(StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env })))),
      ),
    )
  await nanda('init')
  const drafted = await agent('direction new --file=directions/tsd-writing.yaml --by=assess')
  const draft = drafted.match(/^(d\d+) drafted/)?.[1]
  await nanda(`review ${draft} accept --evidence="the fixture | the whole direction"`, 'accept')
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    await nanda(`role fit ${role} --answers=fit.yaml`)
  }
  return { dir, env, run, nanda, ui, agent, inSession, inPane, readState }
}

const tokenIn = (text: string) => text.match(/work brief (a\d+\.[a-z0-9]+)/)?.[1] ?? ''
const until = async (fn: () => boolean, what: string) => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return
    await Bun.sleep(50)
  }
  throw new Error(`timed out: ${what}`)
}

// A project of the UI: the host's run with its terminal, the top task opened from its draft,
// the host briefed; the supervisor with no timer (the test ticks it).
const hosted = async () => {
  const p = await project()
  // The setup of the dir is old news for the supervisor that starts a minute later.
  later(60_000)
  const fake = fakePump()
  const lines: Array<string> = []
  const watcher = () => {
    const w = createWatcher({
      dir: p.dir,
      env: p.env,
      pump: fake.pump,
      readState: p.readState,
      clock: () => clock.now,
      // The fake pump reads an Enter at once; the real pauses only slow the test.
      timing: { enterPause: 5, readyPause: 5 },
      log: (l) => lines.push(l),
      doAct: (argv, o) => p.run(argv, { channel: 'ui', typed: o?.typed }),
    })
    w.stop()
    return w
  }
  const w = watcher()
  await p.inPane('run start')
  await w.tick()
  const host = p.readState()?.runs.get('h1' as never)?.session ?? ''
  fake.show(host, 'fake agent start')
  await p.inPane('task draft --file=top.yaml --by=h1')
  const hostToken = tokenIn(await w.open('td1'))
  // The host's prompt is typed when its terminal is quiet.
  later(1000)
  await until(() => fake.typed(host).includes(`work brief ${hostToken}`), 'the host prompt')
  await p.agent(`brief ${hostToken}`)
  return { p, fake, w, watcher, host, hostToken, lines }
}
// ... and the host gives t1 to a section lead (a Terra), whose terminal the supervisor starts.
const withLead = async () => {
  const h = await hosted()
  await h.p.agent(`assign ${h.hostToken} t1 --role=section-lead`)
  await h.w.tick()
  const lead = h.fake.calls.find((c) => c.startsWith('start ') && !c.endsWith(h.host))?.slice(6)
  if (lead === undefined) throw new Error(`no terminal for the lead: ${h.lines.join('\n')}`)
  return { ...h, lead }
}

const sendsTo = (work: Work | undefined, tag: string): ReadonlyArray<Send> =>
  (work?.sends ?? []).filter((s) => s.from._tag === 'Supervisor' && s.from.reason._tag === tag)
const sendsInto = (work: Work | undefined, tag: string, sid: string) =>
  sendsTo(work, tag).filter((s) => {
    const reason = s.from._tag === 'Supervisor' ? s.from.reason : undefined
    return reason !== undefined && 'to' in reason && reason.to.session === sid
  })
const terminalMoves = (work: Work | undefined, sid: string, tag: string) =>
  (work?.terminalEvents ?? []).filter((t) => t.session === sid && t.report._tag === tag)
const quiet = () => later(10_000)

describe('the supervisor of the terminals', () => {
  test('bug 15: a Stop and a Resume before the first input never type it again', async () => {
    const { p, fake, w, lead } = await withLead()
    // The lead's tool has shown nothing yet, so its first input (with its token) waits.
    expect(fake.typed(lead)).toBe('')
    await w.stopSession(lead)
    await w.resumeSession(lead, 'terra')
    fake.show(lead, 'fake agent resumed')
    quiet()
    await Bun.sleep(800)
    expect(fake.typed(lead)).not.toContain('work brief')
    const [start] = sendsInto(p.readState(), 'Start', lead)
    expect(start?.state).toMatchObject({ _tag: 'Dropped', why: { _tag: 'StoppedByPerson' } })
  })

  test('the first input is typed when the terminal is ready, and kept with no token', async () => {
    const { p, fake, lead } = await withLead()
    fake.show(lead, 'fake agent start')
    quiet()
    await until(() => fake.typed(lead).includes('work brief a2.'), 'the first input')
    const [start] = sendsInto(p.readState(), 'Start', lead)
    const delivered = () => sendsTo(p.readState(), 'Start').every((s) => s.state._tag !== 'Pending')
    await until(delivered, 'delivered')
    expect(start?.keys).toEqual({ _tag: 'StartPrompt' })
    expect(JSON.stringify(p.readState()?.sends)).not.toContain('a2.k')
  })

  test('the UI never restarts a host: Fixed finds no host until the person triggers one again', async () => {
    const { p, fake, w, host } = await hosted()
    await p.ui('problem t1 --says="the host terminal failed 3 times"')
    fake.end(host)
    later(6 * 60_000)
    const [fixed] = await Promise.all([w.fixed('sp1').catch((e: Error) => e.message), w.tick()])
    expect(fixed).toBe(
      'sp1: no host runs to try it; trigger the host in your AI CLI again, then click Fixed',
    )
    expect(fake.calls.filter((c) => c.startsWith('resume') || c.startsWith('start'))).toEqual([])
    // The person triggers the host again in another pane: the run continues there.
    await p.inPane('run continue h1 --quote="go on with the export"', '%5')
    await w.tick()
    const moved = p.readState()?.runs.get('h1' as never)?.session ?? ''
    expect(moved).not.toBe(host)
    expect(fake.calls).toContain(`adopt ${moved}`)
    // The next try finds the host running, and fixes the problem itself.
    later(6 * 60_000)
    await w.tick()
    expect(p.readState()?.problems.get('sp1' as never)?.fixed._tag).toBe('Fixed')
  })

  test('the page cannot stop or resume the host: it is the person\'s own terminal', async () => {
    const { w, host } = await hosted()
    expect(w.stopSession(host)).rejects.toThrow('the UI does not start, restart, or stop it')
    expect(w.resumeSession(host, 'sol')).rejects.toThrow('the UI does not start, restart, or stop it')
  })

  test('bug 5: a restart tells a prompt once, and keeps the count of the retries', async () => {
    const { p, fake, w, watcher, host, lead } = await withLead()
    fake.show(lead, PROMPT)
    await w.tick()
    const told = () => sendsTo(p.readState(), 'AgentAtPrompt')
    expect(terminalMoves(p.readState(), lead, 'Prompted')).toHaveLength(1)
    expect(told()).toHaveLength(1)
    expect(fake.typed(host)).toContain('a2 waits at a prompt. Its screen shows «' + PROMPT + '»')
    // The server starts again: a new supervisor reads the same store.
    const second = watcher()
    await second.tick()
    expect(terminalMoves(p.readState(), lead, 'Prompted')).toHaveLength(1)
    expect(told()).toHaveLength(1)
    // The lead's tool exits: two tries, a restart, then the third try and the failure go up once.
    const fail = async (on: ReturnType<typeof watcher>) => {
      fake.end(lead)
      later(31_000)
      await on.tick()
    }
    await fail(second)
    await fail(second)
    const third = watcher()
    await fail(third)
    const attempts = sendsTo(p.readState(), 'Retry').map((s) =>
      s.from._tag === 'Supervisor' && s.from.reason._tag === 'Retry' ? s.from.reason.attempt : 0,
    )
    expect(attempts).toEqual([1, 2, 3])
    await fail(third)
    await fail(watcher())
    expect(terminalMoves(p.readState(), lead, 'Failed')).toHaveLength(1)
    expect(sendsTo(p.readState(), 'AgentFailed')).toHaveLength(1)
    expect(sendsTo(p.readState(), 'Retry')).toHaveLength(3)
  })

  test('an ended host raises nothing and is not restarted, also through a restart', async () => {
    const { p, fake, watcher, host } = await hosted()
    for (const on of [watcher(), watcher(), watcher()]) {
      fake.end(host)
      later(31_000)
      await on.tick()
    }
    expect([...(p.readState()?.problems.values() ?? [])]).toEqual([])
    expect(fake.calls.filter((c) => c.startsWith('resume'))).toEqual([])
  })

  test('bug 13: a change of the words of work next wakes nobody; a new step wakes', async () => {
    const { p, fake, w, hostToken, lead } = await withLead()
    fake.show(lead, 'fake agent start')
    quiet()
    await until(() => fake.typed(lead).includes('work brief a2.'), 'the first input')
    await p.agent(`brief ${tokenIn(fake.typed(lead))}`)
    // A writer of the host works on t1, the lead's task: the lead's next steps show its claim,
    // and its acts wake the host (its parent), not the lead.
    const writer = tokenIn(await p.agent(`assign ${hostToken} t1 --role=writer`))
    const a = writer.split('.')[0] ?? ''
    await p.agent(`brief ${writer}`)
    quiet()
    await w.tick()
    const toLead = () => sendsInto(p.readState(), 'Wake', lead)
    const woken = toLead().length
    const nexts = () => {
      const work = p.readState()
      if (work === undefined) throw new Error('no store')
      const o = { token: '<token>', at: new Date(clock.now).toISOString() as never, cwd: p.dir }
      const steps = nextSteps(work, 'a2' as AssignmentId, o)
      return { key: stepKey(steps), lines: nextLines(work, steps, o) }
    }
    const before = nexts()
    expect(before.lines.join('\n')).toContain(`${a} is working on t1 (claimed since`)
    // The writer's claim starts again two minutes later (the person frees it, it reads its brief
    // again): the lead's words change, its key does not.
    later(2 * 60_000)
    await p.nanda(`free ${a}`)
    await p.agent(`brief ${writer}`)
    quiet()
    const after = nexts()
    expect(after.lines).not.toEqual(before.lines)
    expect(after.key).toBe(before.key)
    await w.tick()
    expect(toLead()).toHaveLength(woken)
    // The person frees the writer: a new step of the lead, and one wake that says so.
    await p.nanda(`free ${a}`)
    quiet()
    await w.tick()
    expect(toLead().slice(woken).map((s) => s.keys)).toEqual([{ _tag: 'Line', text: NEXT_CHANGED }])
  })

  test('a restart keeps the wakes that wait, the time of the last wake, the Stops', async () => {
    const { p, fake, w, watcher, host, lead } = await withLead()
    fake.show(lead, 'fake agent start')
    quiet()
    await until(() => fake.typed(lead).includes('work brief a2.'), 'the first input')
    const leadToken = tokenIn(fake.typed(lead))
    // The lead acts while the host is busy: the wake of the host waits, stored.
    fake.show(host, 'thinking')
    await p.agent(`brief ${leadToken}`)
    await w.tick()
    const wakes = () => sendsTo(p.readState(), 'Wake')
    expect(wakes().map((s) => s.state._tag)).toEqual(['Pending'])
    // The server starts again; the host goes quiet; the stored wake goes out.
    const second = watcher()
    quiet()
    await second.tick()
    expect(fake.typed(host)).toContain(`a2 acted. ${RUN_NEXT}`)
    expect(wakes().map((s) => s.state._tag)).toEqual(['Delivered'])
    // A new act of the lead within 90 s of that wake, and another restart: the wake waits.
    await p.agent(`brief ${leadToken}`)
    const third = watcher()
    quiet()
    await third.tick()
    expect(wakes().map((s) => s.state._tag)).toEqual(['Delivered', 'Pending'])
    later(90_000)
    await third.tick()
    expect(wakes().map((s) => s.state._tag)).toEqual(['Delivered', 'Delivered'])
    // The person stops the lead: no restart, no retry, no wake reaches it, also after a restart.
    await w.stopSession(lead)
    const fourth = watcher()
    quiet()
    await fourth.tick()
    expect(fake.calls.filter((c) => c.endsWith(lead))).toEqual([`start ${lead}`, `stop ${lead}`])
  })

  test('the end of work closes a terminal once: a Resume of the person keeps it open', async () => {
    const { p, fake, w, watcher, hostToken, lead } = await withLead()
    fake.show(lead, 'fake agent start')
    await p.agent(`finish ${hostToken} a2`)
    // A busy terminal is not closed; a quiet one is.
    await w.tick()
    expect(fake.calls).not.toContain(`stop ${lead}`)
    quiet()
    await w.tick()
    expect(fake.calls).toContain(`stop ${lead}`)
    expect(terminalMoves(p.readState(), lead, 'Closed')).toHaveLength(1)
    // The person resumes it to read it: it stays, through a restart too.
    await w.resumeSession(lead, 'terra')
    quiet()
    await w.tick()
    await watcher().tick()
    expect(fake.calls.filter((c) => c === `stop ${lead}`)).toHaveLength(1)
    expect(terminalMoves(p.readState(), lead, 'Closed')).toHaveLength(1)
  })
})
