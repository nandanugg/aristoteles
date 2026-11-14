// The test support of core/effects (no tests here). A dir in a temp folder set up by the CLI
// (ruling 10.1: the host gets its token from `work wait`), a fake pump service (no tmux) that
// keeps every command it ran and every key typed into it, and the real Dispatcher (core/actions)
// that records each act: the effects are level-triggered, so the next derive must see what an act
// did. One clock for all; the test moves it. A supervisor is one ManagedRuntime: a restart is a
// new one (a new memory and start time).
import { expect } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Effect, Layer, ManagedRuntime, Ref } from 'effect'
import { main } from '../../adapters/cli/main.ts'
import type { Event } from '../../src/domain/events.ts'
import type { Time } from '../../src/domain/ids.ts'
import type { Send } from '../../src/domain/ui-model.ts'
import type { Work } from '../../src/domain/work.ts'
import { Dir, Env, Now, Tokens } from '../../src/services/io.ts'
import { FilesLive, SpawnLive } from '../../src/services/outside.ts'
import { Store } from '../../src/services/store.ts'
import { StoreLive } from '../../src/store/sqlite.ts'
import type { ActionCall } from '../actions/types.ts'
import { outsideNow, workOf } from '../derived/support.test.ts'
import { OutsideFailed, type Author, type SessionId } from '../schema/index.ts'
import { Pump, Readings } from '../services/index.ts'
import { workCacheLayer } from '../state/index.ts'
import {
  Dispatcher,
  DispatcherLive,
  EFFECTS,
  EffectLog,
  latest,
  NO_MEMORY,
  openDraft,
  reconcile,
  Supervision,
  SupervisorMemory,
  TIMING,
} from './index.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harness from '../../test/harness.js'

const h = harness as {
  readonly WORK_YAML: string
  readonly DIRECTION: string
  readonly TASK_WHOLE: string
  readonly FIT: string
  readonly INTRO_V2: string
  readonly split: (line: string) => ReadonlyArray<string>
}
export const { DIRECTION, INTRO_V2 } = h

// The sol tier names {prompt} in its launch command; the terra tier does not, so its first prompt
// goes in as the last argument (ruling 10.1: a first prompt is never typed).
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
export const PROMPT = 'Do you want to proceed? (1 yes / 2 no)'

// One clock for the CLI, the supervisor and the fake pump; the test moves it.
export const clock = { now: Date.UTC(2026, 10, 12, 9, 0, 0) }
export const later = (ms: number): void => {
  clock.now += ms
}
// Past the output window of a terminal.
export const quiet = (): void => later(10_000)
const timeNow = () => new Date(clock.now).toISOString() as Time

// --- the fake pump -------------------------------------------------------------------------------

// A fake tmux: each terminal is live or ended, has a screen and a time of its last output, and
// keeps what was typed into it. The host's own pane is adopted: start, resume and stop refuse it.
// commands: each start or resume with its command; waiting: the sessions whose agent blocks in
// `work wait` (the markers that the watcher reads, Outside.waiting).
export const fakePump = () => {
  const terms = new Map<string, { live: boolean; screen: Array<string>; lastOutput: number }>()
  const typed = new Map<string, string>()
  const calls: Array<string> = []
  const commands: Array<string> = []
  const waiting = new Set<string>()
  const panes = new Map<string, { readonly socket: string; readonly pane: string }>()
  const keys = new Map<string, number>()
  const failed = (message: string) =>
    Effect.fail(new OutsideFailed({ system: 'tmux', message, next: null }))
  const ownPane = (sid: string) =>
    failed(`${sid} is the host's own terminal; the UI does not start, restart, or stop it`)
  const live = (sid: string) => {
    terms.set(sid, { live: true, screen: [], lastOutput: 0 })
  }
  const type = (sid: string, text: string) =>
    terms.get(sid)?.live
      ? Effect.sync(() => {
          typed.set(sid, (typed.get(sid) ?? '') + text)
        })
      : failed(`the session ${sid} has no terminal`)
  const layer = Layer.succeed(Pump, {
    start: (sid, s) => {
      if (panes.has(sid)) return ownPane(sid)
      if (terms.has(sid)) return failed(`the session ${sid} has a terminal already`)
      return Effect.sync(() => {
        calls.push(`start ${sid}`)
        commands.push(`start ${sid}: ${s.command}`)
        live(sid)
      })
    },
    resume: (sid, s) => {
      if (panes.has(sid)) return ownPane(sid)
      if (terms.get(sid)?.live) return failed(`the session ${sid} runs`)
      return Effect.sync(() => {
        calls.push(`resume ${sid}`)
        commands.push(`resume ${sid}: ${s.command}`)
        live(sid)
      })
    },
    input: type,
    enter: (sid) => type(sid, '\r'),
    stop: (sid) => {
      if (panes.has(sid)) return ownPane(sid)
      return Effect.sync(() => {
        calls.push(`stop ${sid}`)
        terms.delete(sid)
      })
    },
    status: Effect.sync(() =>
      Object.fromEntries(
        [...terms].map(([sid, t]) => [
          sid,
          { live: t.live, ended: !t.live, exit: t.live ? null : 1, lastOutput: t.lastOutput },
        ]),
      ),
    ),
    tail: (sid) => Effect.sync(() => terms.get(sid)?.screen.join('\n') ?? ''),
    adopt: (sid, socket, pane) =>
      Effect.sync(() => {
        if (panes.has(sid)) return
        panes.set(sid, { socket, pane })
        calls.push(`adopt ${sid}`)
        live(sid)
      }),
    release: (sid) =>
      Effect.sync(() => {
        if (panes.delete(sid)) calls.push(`release ${sid}`)
        terms.delete(sid)
      }),
    paneOf: (sid) =>
      Effect.sync(() => {
        const p = panes.get(sid)
        return p === undefined ? { _tag: 'OwnWindow' as const } : { _tag: 'PersonPane', ...p }
      }),
    keysAt: (sid) => Effect.sync(() => keys.get(sid) ?? 0),
  })
  return {
    layer,
    calls,
    commands,
    waiting,
    typed: (sid: string) => typed.get(sid) ?? '',
    // Every key typed into any terminal, by session.
    allTyped: () => Object.fromEntries(typed),
    status: () =>
      Object.fromEntries(
        [...terms].map(([sid, t]) => [
          sid,
          { live: t.live, ended: !t.live, exit: t.live ? null : 1, lastOutput: t.lastOutput },
        ]),
      ),
    adopted: (sid: string) => panes.has(sid),
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
    // The person presses a key in their own pane now.
    key: (sid: string) => {
      keys.set(sid, clock.now)
    },
    // A window that the pump made before this test's supervisor (an older host's).
    open: (sid: string) => {
      calls.push(`start ${sid}`)
      live(sid)
    },
  }
}
export type FakePump = ReturnType<typeof fakePump>

// --- the dir -------------------------------------------------------------------------------------

export interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}

// A dir with its directions accepted and its roles fitted, the CLI on it, and its store.
export const project = async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'work-effects-')), 'report-export')
  const files: Record<string, string> = {
    'aristoteles.yaml': SETTINGS + h.WORK_YAML,
    'directions/tsd-writing.yaml': h.DIRECTION,
    'top.yaml': `${h.TASK_WHOLE}role: architect\n`,
    'again.yaml': `${h.TASK_WHOLE.replace('facts.', 'facts, with the cost.')}role: architect\n`,
    'fit.yaml': h.FIT,
    'docs/tsd.md': '# TSD\n\n## Introduction\n\nTODO\n',
    'docs/facts.md': '# Facts\n\n## Dedupe\n\nThe export ran twice for one merchant.\n',
  }
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  for (const [path, text] of Object.entries(files)) write(path, text)
  const env = { ARISTOTELES_DB: join(dir, '.work', 'aristoteles.db') }
  let tokens = 0
  const run = async (
    argv: ReadonlyArray<string>,
    o: { tty?: boolean; channel?: string; typed?: string; pane?: string } = {},
  ): Promise<Ran> => {
    const out: Array<string> = []
    const err: Array<string> = []
    const code = await main(argv, {
      cwd: dir,
      out: (t) => out.push(t),
      err: (t) => err.push(t),
      isTTY: o.tty ?? false,
      channel: o.channel,
      readLine: () => o.typed,
      now: timeNow,
      gitUser: () => 'Nanda',
      env: o.pane ? { ...env, TMUX: '/tmp/ar-test-person.sock,1,0', TMUX_PANE: o.pane } : env,
      random: () => `k${String(++tokens).padStart(4, '0')}`,
    })
    return { code, out: out.join('\n'), err: err.join('\n') }
  }
  const ok = async (r: Promise<Ran>) => {
    const done = await r
    if (done.code !== 0) throw new Error(done.err)
    return done.out
  }
  const words = h.split
  const nanda = (line: string, typed?: string) => ok(run(words(line), { tty: true, typed }))
  const ui = (line: string, typed?: string) => ok(run(words(line), { channel: 'ui', typed }))
  const agent = (line: string) => ok(run(words(line)))
  // The host: the AI CLI that the person triggered, in a pane of the person's tmux server.
  const inPane = (line: string, pane = '%9') => ok(run(words(line), { pane }))
  const work = (): Work => workOf(dir)
  // An event written as an older store has it, with no check (a run of an older UI).
  const writeRaw = (author: Author, event: Event) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const opened = yield* (yield* Store).open(dir, { create: false })
        const draft = { at: timeNow(), author, event }
        yield* opened.write(() => Effect.succeed({ draft, rows: [] }))
      }).pipe(Effect.scoped, Effect.provide(storeOf(env))),
    )
  await nanda('init')
  const drafted = await agent('direction new --file=directions/tsd-writing.yaml --by=assess')
  const draft = drafted.match(/^(d\d+) drafted/)?.[1]
  await nanda(`review ${draft} accept --evidence="the fixture | the whole direction"`, 'accept')
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    await nanda(`role fit ${role} --answers=fit.yaml`)
  }
  return { dir, env, run, nanda, ui, agent, inPane, work, write, writeRaw }
}
export type Project = Awaited<ReturnType<typeof project>>

export const tokenIn = (text: string): string =>
  text.match(/work brief (a\d+\.[a-z0-9]+)/)?.[1] ?? ''
export const until = async (fn: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 100; i++) {
    if (fn()) return
    await Bun.sleep(50)
  }
  throw new Error(`timed out: ${what}`)
}

// --- the dispatch ------------------------------------------------------------------------------

const storeOf = (env: Record<string, string>) =>
  StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env })))

export interface Recorder {
  readonly calls: Array<ActionCall>
  readonly refused: Array<string>
}

// The real dispatch of core/actions, recorded: each act, and each refusal (a bug of a selector).
const recordingDispatcher = (rec: Recorder) =>
  Layer.effect(
    Dispatcher,
    Effect.gen(function* () {
      const live = yield* Dispatcher
      return {
        dispatch: (call: ActionCall) => {
          rec.calls.push(call)
          return live.dispatch(call).pipe(
            Effect.tapError((e) => Effect.sync(() => rec.refused.push(e.message))),
          )
        },
      }
    }),
  ).pipe(Layer.provide(DispatcherLive))

// --- a supervisor --------------------------------------------------------------------------------

export const supervisorOf = (p: Project, fake: FakePump, rec: Recorder) => {
  const lines: Array<string> = []
  let secrets = 0
  const store = storeOf(p.env)
  const services = Layer.mergeAll(
    store,
    Layer.succeed(Readings, {
      read: (work) =>
        Effect.sync(() => ({
          ...outsideNow(work, p.dir),
          terminals: fake.status(),
          waiting: new Set(fake.waiting),
        })),
    }),
    Layer.succeed(Dir, { cwd: p.dir }),
    Layer.succeed(Env, { vars: p.env }),
    Layer.succeed(Now, { read: Effect.sync(timeNow) }),
    Layer.succeed(Tokens, { random: Effect.sync(() => `t${String(++secrets).padStart(4, '0')}`) }),
    FilesLive,
    SpawnLive,
  )
  const layer = Layer.mergeAll(
    services,
    fake.layer,
    Layer.effect(
      SupervisorMemory,
      Effect.map(Ref.make(NO_MEMORY), (ref) => ({ ref })),
    ),
    Layer.succeed(EffectLog, { line: (text) => Effect.sync(() => lines.push(text)) }),
    recordingDispatcher(rec).pipe(Layer.provide(services)),
    // The fake pump reads an Enter at once; the real pause only slows the test.
    Layer.succeed(Supervision, {
      timing: { ...TIMING, enterPause: 5 },
      person: 'Nanda',
      startedAt: clock.now,
    }),
    workCacheLayer(p.dir).pipe(Layer.provide(store)),
  )
  const runtime = ManagedRuntime.make(layer)
  const tick = () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const d = yield* latest
        if (d !== null) yield* reconcile(EFFECTS, d)
      }),
    )
  // The person's act on the page: its refusal is thrown with its words, as the page shows it.
  const person = <A, E extends { readonly message: string }>(
    act: Effect.Effect<A, E, Layer.Success<typeof layer>>,
  ): Promise<A> =>
    runtime.runPromise(
      act.pipe(Effect.catch((e: E) => Effect.die(new Error(e.message)))),
    )
  return { tick, person, lines, dispose: () => runtime.dispose() }
}

// --- the scenarios -------------------------------------------------------------------------------

// Every act that an effect dispatches must pass: a refusal is a bug of its selector (afterEach).
const recorders: Array<Recorder> = []
const disposers: Array<() => Promise<void>> = []
export const cleanUp = async (): Promise<void> => {
  for (const d of disposers.splice(0)) await d()
  for (const r of recorders.splice(0)) expect(r.refused).toEqual([])
}

export const supervised = async (p: Project) => {
  const fake = fakePump()
  const rec: Recorder = { calls: [], refused: [] }
  recorders.push(rec)
  const watcher = () => {
    const s = supervisorOf(p, fake, rec)
    disposers.push(s.dispose)
    return s
  }
  return { fake, rec, watcher }
}

// A project of the UI: the host's run with its pane, the top task opened from its draft, and the
// host briefed with the token that its `work wait --by=h1` gave it (ruling 10.1: nothing is typed
// into its pane); the supervisor with no timer (the test ticks it).
export const hosted = async () => {
  const p = await project()
  // The setup of the dir is old news for the supervisor that starts a minute later.
  later(60_000)
  const { fake, rec, watcher } = await supervised(p)
  const w = watcher()
  await p.inPane('run start')
  await w.tick()
  const host = p.work().runs.get('h1' as never)?.session ?? ''
  fake.show(host, 'fake agent start')
  await p.inPane('task draft --file=top.yaml --by=h1')
  await w.person(openDraft('td1' as never))
  const hostToken = tokenIn(await p.inPane('wait --by=h1 --seconds=1', '%9'))
  await p.agent(`brief ${hostToken}`)
  return { p, fake, w, watcher, host, hostToken, rec }
}
// ... and the host gives t1 to a section lead (a Terra), whose terminal the supervisor starts with
// its first prompt as the last argument of its launch command.
export const withLead = async () => {
  const h = await hosted()
  await h.p.agent(`assign ${h.hostToken} t1 --role=section-lead`)
  await h.w.tick()
  const started = h.fake.commands.find((c) => c.startsWith('start ') && !c.includes(h.host))
  const lead = started?.slice(6, started.indexOf(':'))
  if (lead === undefined) throw new Error(`no terminal for the lead: ${h.w.lines.join('\n')}`)
  const leadToken = tokenIn(started ?? '')
  return { ...h, lead, leadToken }
}

export const sendsTo = (work: Work, tag: string): ReadonlyArray<Send> =>
  work.sends.filter((s) => s.from._tag === 'Supervisor' && s.from.reason._tag === tag)
export const sendsInto = (work: Work, tag: string, session: string) =>
  sendsTo(work, tag).filter((s) => {
    const reason = s.from._tag === 'Supervisor' ? s.from.reason : undefined
    return reason !== undefined && 'to' in reason && reason.to.session === session
  })
export const terminalMoves = (work: Work, session: string, tag: string) =>
  work.terminalEvents.filter((t) => t.session === session && t.report._tag === tag)

// A second direction of the dir, with rule ids of its own: its draft names no task.
export const hld = DIRECTION.replaceAll('tsd-writing', 'hld-writing')
  .replace('name: TSD writing', 'name: HLD writing')
  .replaceAll('no-code-proof', 'hld-no-code')
  .replaceAll('no-ticket-ids', 'hld-no-ids')
  .replaceAll('repeatable', 'hld-repeatable')

// The sessions of the test as plain words.
export const sid = (text: string): SessionId => text as SessionId
