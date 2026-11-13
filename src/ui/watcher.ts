// The supervisor of the terminals (package P9; replaces ui/watcher.js, plan/ui/BUILD.md part 6).
// Each tick it reads the store and the pump, and:
//   - starts the terminal of each new real agent (a Sol or a Terra of a UI project), with a new
//     token that it gets from a person act (work session --token);
//   - types into a child terminal each input that its host sent (work send);
//   - wakes a real agent that waits while its children act (an AI tool ends its turn and waits);
//   - retries a terminal that failed (it ended, shows error words, or was silent) up to 3 times,
//     then tells the host; a failure of the host itself becomes a system problem;
//   - tells the host of a new decision for the person, so that the host writes its words;
//   - closes a terminal once when its work ended.
// The person's acts (Open, Close, Stop, Resume, Fixed) are methods that the server calls. The
// host is the AI CLI that the person triggered (Nanda, 2026-11-13): its run names its own pane on
// the person's tmux server, and the pump copies that pane; the UI never starts, restarts, or
// stops it.
//
// What a restart must keep is in the store, never in this closure: the terminal moves (a Stop
// holds until the person's Resume; a failure goes up once; a close happens once) and every text
// typed into a terminal as a Send (ui-model.ts): a wake and its time, a word to a host, a retry,
// the last try of a problem. The state of each terminal (TerminalState) is folded from them
// (terminals.ts); only what the pump shows now (busy, or quiet with its next steps) is memory.
// A wake compares the keys of the next steps (tags and ids), never their words (bug 13).
import { randomUUID } from 'node:crypto'
import { Effect, Layer, Schema } from 'effect'
import { checkContext } from '../cli/run.ts'
import { DEFAULT_RETRY, readSettings } from '../config/settings.ts'
import {
  CountedAct,
  create,
  type Draft,
  type Event,
  kindOf,
  move,
  type StartReason,
  type Total,
} from '../domain/events.ts'
import {
  type AssignmentId,
  type EventRef,
  isNonBlank,
  type ProblemId,
  type SessionId,
  type TaskId,
  type Time,
} from '../domain/ids.ts'
import type { Assignment } from '../domain/model.ts'
import { tick as observe } from '../domain/moves.ts'
import type {
  Activity,
  DropReason,
  Failure,
  Problem,
  Run,
  Send,
  SupervisorReason,
  TerminalState,
} from '../domain/ui-model.ts'
import type { Logged, Work } from '../domain/work.ts'
import { within } from '../engine/queries.ts'
import { rootOf, runOf } from '../engine/runs.ts'
import { replay, stepNew } from '../replay/replay.ts'
import { Env } from '../services/io.ts'
import { type Files, FilesLive, type Spawn, SpawnLive } from '../services/outside.ts'
import { Store } from '../services/store.ts'
import { rowsOf } from '../store/rows.ts'
import { StoreLive } from '../store/sqlite.ts'
import { nextSteps, stepKey } from '../words/next.ts'
import { personAct } from './act.ts'
import type { Pump, TerminalStatus } from './pump.ts'
import {
  actRead,
  type Cause,
  closedOnce,
  decisionSessions,
  destinationOf,
  foldTerminals,
  hostSessionOf,
  lastActOf,
  lastProblemTry,
  lastWakeAt,
  neederTasks,
  questionWaits,
  realAgentOf,
  refOf,
  retriesOf,
  reviewRead,
  sameCause,
  staleFor,
  type TerminalTier,
  tierOf,
  SYSTEM,
  topNow,
  wakeLine,
} from './terminals.ts'
import { linkSkills } from './skills.ts'
import { decisionsOf } from './view.ts'

export interface WatcherOptions {
  readonly dir: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly pump: Pump
  // The state now (the server's cached replay); undefined before work init.
  readonly readState: () => Work | undefined
  readonly log?: (line: string) => void
  // Date.now(); a test moves a fake one, and gives the same one to the pump.
  readonly clock?: () => number
  // The real pauses of TIMING; a test gives short ones. The windows and gaps follow the clock.
  readonly timing?: Partial<Pick<WatcherTiming, 'enterPause' | 'readyPause'>>
  // The CLI on the ui channel; the default runs main() in this process (src/ui/act.ts).
  readonly doAct?: (
    argv: ReadonlyArray<string>,
    options?: { readonly typed?: string },
  ) => Promise<{ readonly code: number; readonly out: string; readonly err: string }>
}

export interface Watcher {
  readonly tick: () => Promise<void>
  readonly stop: () => void
  // Open: the person opens a proposal; returns the CLI's words.
  readonly open: (proposal: string) => Promise<string>
  readonly stopSession: (session: string) => Promise<void>
  readonly resumeSession: (session: string, tier: string) => Promise<void>
  // Fixed: tries the problem at once; throws with the old words when it cannot.
  readonly fixed: (problem: string) => Promise<string>
  readonly close: (run: string, reason: string) => Promise<void>
}

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
// The values of a command: {session} and {token} as they are, {prompt} quoted for the shell.
export const fill = (
  template: string,
  values: { readonly session?: string; readonly token?: string; readonly prompt?: string },
): string =>
  template.replace(/\{(session|token|prompt)\}/g, (m, k: 'session' | 'token' | 'prompt') =>
    k === 'prompt' ? quote(values.prompt ?? '') : (values[k] ?? m),
  )
const tokenOf = (text: string) => text.match(/work brief (a\d+\.[a-z0-9]+)/)?.[1]

// The times of the supervisor, in ms. The windows and gaps are read on the clock; the pauses
// are real waits.
export interface WatcherTiming {
  // A wake is a new turn of an AI model, so a session hears of its children at most each 90 s.
  readonly wakeGap: number
  // A terminal with output within this window is busy: a wake and a close wait for it.
  readonly outputWindow: number
  // The first input waits this long at most for its terminal to be ready.
  readonly ready: number
  // The tries of a failed terminal are at least this far apart.
  readonly retryGap: number
  // The timer of the ticks.
  readonly tick: number
  // The pause between the text of a line and its Enter.
  readonly enterPause: number
  // The pause between two looks of a first input at its terminal.
  readonly readyPause: number
}
export const TIMING: WatcherTiming = {
  wakeGap: 90000,
  outputWindow: 8000,
  ready: 90000,
  retryGap: 30000,
  tick: 2000,
  enterPause: 250,
  readyPause: 300,
}
// An act or a send this much older than the start of the supervisor was handled before it.
const RESTART_SKEW_MS = 5000

// Text from a terminal or the store goes into the host's input as data: no token, no control
// byte, short, and quoted, so that a child cannot type instructions into its host.
const clean = (text: string, max = 160) => {
  const one = text
    .replace(/a\d+\.[a-z0-9]{10,}/g, (m) => `${m.split('.')[0]}.<token>`)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `«${one.length > max ? `${one.slice(0, max)}…` : one}»`
}
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// A session that the supervisor watches: the terminal of an open run (its host too), or of an
// open real agent.
type Watched =
  | { readonly sid: SessionId; readonly host: true; readonly run: Run }
  | { readonly sid: SessionId; readonly host: false; readonly a: Assignment }
const watchedOf = (work: Work): ReadonlyArray<Watched> => {
  const runs = [...work.runs.values()]
  const out: Array<Watched> = runs
    .filter((r) => r.end._tag === 'NotEnded')
    .map((run) => ({ sid: run.session, host: true, run }))
  for (const s of work.sessions.values()) {
    const a = work.assignments.get(s.assignment)
    if (a === undefined || a.end._tag !== 'NotEnded') continue
    if (runs.some((r) => r.session === s.session)) continue
    out.push({ sid: s.session, host: false, a })
  }
  return out
}

const to = (session: SessionId) => ({ _tag: 'Terminal', session, via: { _tag: 'Tmux' } }) as const
const keysOf = (text: string) =>
  isNonBlank(text) ? ({ _tag: 'Line', text } as const) : ({ _tag: 'Enter' } as const)
const textOfKeys = (send: Send) => (send.keys._tag === 'Line' ? send.keys.text : '')
const wakeTo = (send: Send): SessionId | undefined =>
  send.from._tag === 'Supervisor' && send.from.reason._tag === 'Wake'
    ? send.from.reason.to.session
    : undefined
// The cause of a wake: the acts that it names, or the next steps that changed.
const wakeCause = (causes: ReadonlyArray<Cause>) => {
  const [one, ...more] = causes
  return one === undefined
    ? ({ _tag: 'NextChanged' } as const)
    : ({ _tag: 'Acted', by: [one, ...more] } as const)
}
const wakeCauses = (send: Send): ReadonlyArray<Cause> =>
  send.from._tag === 'Supervisor' &&
  send.from.reason._tag === 'Wake' &&
  send.from.reason.cause._tag === 'Acted'
    ? send.from.reason.cause.by
    : []

export const createWatcher = (options: WatcherOptions): Watcher => {
  const { dir, pump, readState, log = () => {}, clock = () => Date.now() } = options
  const time = { ...TIMING, ...options.timing }
  const env = options.env ?? process.env
  const act = options.doAct ?? ((argv, o) => personAct(dir, env, argv, o))
  const startedAt = clock()
  const timeAt = (ms: number) => new Date(ms).toISOString() as Time
  const settings = () => Effect.runSync(readSettings(dir).pipe(Effect.provide(FilesLive)))
  const tierSettings = (tier: string) => settings().tiers[tier as TerminalTier]
  const promptOf = (tier: TerminalTier, token: string) =>
    fill(tierSettings(tier)?.start ?? '', { token })

  // --- the store ---------------------------------------------------------------------------

  // The person on whose page the supervisor runs: the author name of its own writes, as the CLI
  // writes them (work event, work session).
  let person: string | undefined
  const supervisor = () => {
    // env: git is found on the PATH of process.env (Spawn in src/services/outside.ts).
    person ??= Bun.spawnSync(['git', '-C', dir, 'config', 'user.name'], { env: process.env })
      .stdout.toString()
      .trim()
    return { _tag: 'Supervisor', name: person } as const
  }
  const services = Layer.mergeAll(
    FilesLive,
    SpawnLive,
    StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env }))),
  )
  // One event of the supervisor (a Send, and its fate) into the store, checked and applied as a
  // CLI write is; no command of the CLI writes these. It gives the ref of the new event. The fate
  // of a send is written once, in the same transaction as its check: a Stop that dropped a send
  // while it was typed leaves the typing's own fate unwritten (seq 0).
  const write = async (event: Event): Promise<EventRef> => {
    const program = Effect.scoped(
      Effect.gen(function* () {
        const store = yield* Store
        const outside = yield* Effect.context<Files | Spawn>()
        const opened = yield* store.open(dir, { create: false })
        const seq = yield* opened.write((events) =>
          Effect.gen(function* () {
            const work = yield* replay(events)
            if (event._tag === 'Send' && 'move' in event) {
              const send = work.sends.find((s) => s.id === event.id)
              if (send?.state._tag !== 'Pending') return null
            }
            const at = timeAt(clock())
            const draft: Draft = { at, author: supervisor(), event }
            const next = (events.at(-1)?.seq ?? 0) + 1
            const stepped = yield* stepNew(work, draft, next, checkContext(dir, at, outside))
            return { draft, rows: rowsOf(stepped.work, opened.dir) }
          }),
        )
        return seq ?? 0
      }),
    )
    const done = await Effect.runPromise(
      program.pipe(
        Effect.provide(services),
        Effect.match({
          onFailure: (e) => ({ failed: e }) as const,
          onSuccess: (seq) => ({ seq }) as const,
        }),
      ),
    )
    if ('failed' in done) {
      const e = done.failed
      throw new Error(
        e._tag === 'StoreDamaged' ? `the store is damaged at e${e.seq}: ${e.issue}` : e.message,
      )
    }
    return refOf(done.seq)
  }
  const sendLine = (reason: SupervisorReason, text: string) =>
    write(
      create('Send', { _tag: 'Sent', from: { _tag: 'Supervisor', reason }, keys: keysOf(text) }),
    )
  const sendStart = (reason: typeof StartReason.Type) =>
    write(
      create('Send', {
        _tag: 'Sent',
        from: { _tag: 'Supervisor', reason },
        keys: { _tag: 'StartPrompt' },
      }),
    )
  const delivered = (ref: EventRef) => write(move('Send', ref, { _tag: 'Delivered' }))
  const dropped = (ref: EventRef, why: DropReason) =>
    write(move('Send', ref, { _tag: 'Dropped', why }))

  // A CLI act on the ui channel (the person's page); a failure is an Error with its words.
  const must = async (argv: ReadonlyArray<string>, o?: { readonly typed?: string }) => {
    const r = await act(argv, o)
    if (r.code) throw new Error(r.err)
    return r.out
  }

  // --- the state of each terminal ----------------------------------------------------------

  // Folded from the store (terminals.ts foldTerminals), then refined by what the pump shows.
  const terminals = new Map<SessionId, TerminalState>()
  let folded = 0
  // The latest Work, with its new stored events folded into the states of the terminals.
  const current = (): Work | undefined => {
    const work = readState()
    if (work === undefined) return undefined
    foldTerminals(
      terminals,
      work,
      work.events.filter((l) => l.recorded.seq > folded),
    )
    folded = work.events.at(-1)?.recorded.seq ?? folded
    return work
  }
  const stateOf = (sid: SessionId) => terminals.get(sid)
  // A live terminal shows something new: its activity changes (nothing stores it).
  const see = (sid: SessionId, activity: Activity) => {
    const state = terminals.get(sid)
    if (state?._tag === 'Live') terminals.set(sid, observe(state, activity))
  }
  const quietFor = (st: TerminalStatus | undefined) => clock() - (st?.lastOutput || 0)

  // --- typing --------------------------------------------------------------------------------

  // A line for an AI tool: the text, then Enter as its own key a moment later. In one read, an
  // interactive tool takes the Enter as part of a paste, and the line stays unsent.
  const typeLine = async (sid: SessionId, text: string) => {
    if (text) pump.input(sid, text)
    await Bun.sleep(time.enterPause)
    pump.input(sid, '\r')
  }
  // Types a stored send now, and stores its fate: Delivered, or Dropped when the pump fails.
  const deliver = async (ref: EventRef, sid: SessionId, text: string) => {
    try {
      await typeLine(sid, text)
    } catch (error) {
      log(`${sid}: ${messageOf(error)}`)
      await dropped(ref, { _tag: 'TypingFailed' })
      return
    }
    await delivered(ref)
  }
  // A word from the supervisor to a terminal (a host, about a child or a decision): stored, then
  // typed at once when the terminal runs, else dropped. With no terminal, nothing is stored.
  const tell = async (reason: SupervisorReason, sid: SessionId | undefined, text: string) => {
    if (sid === undefined) return
    const ref = await sendLine(reason, text)
    if (stateOf(sid)?._tag === 'Stopped') await dropped(ref, { _tag: 'StoppedByPerson' })
    else if (!pump.status()[sid]?.live) await dropped(ref, { _tag: 'TerminalNotLive' })
    else await deliver(ref, sid, text)
  }

  // The first input of a terminal, typed when the terminal is ready: it has shown output, and
  // it was quiet a moment. The send is stored as Pending, so that a Stop drops it, and each try
  // reads the store again, so a Stop and a Resume never get the old input typed into the new
  // process (bug 15). The words hold a token, so only this loop keeps them, never the store.
  const typing = new Map<EventRef, Promise<void>>()
  const typeWhenReady = (ref: EventRef, sid: SessionId, words: string, quiet: number) => {
    const end = clock() + time.ready
    const once = async (): Promise<'done' | 'wait'> => {
      const work = current()
      const send = work?.sends.find((s) => s.id === ref)
      if (work === undefined || send?.state._tag !== 'Pending') return 'done'
      if (stateOf(sid)?._tag === 'Stopped' || staleFor(work, send, sid)) {
        await dropped(ref, { _tag: 'StoppedByPerson' })
        return 'done'
      }
      const st = pump.status()[sid]
      if (!st?.live || !st.lastOutput || quietFor(st) < quiet) return 'wait'
      await deliver(ref, sid, words)
      return 'done'
    }
    const loop = async () => {
      try {
        while (clock() < end) {
          if ((await once()) === 'done') return
          await Bun.sleep(time.readyPause)
        }
        log(`${sid}: not ready for its input after ${time.ready / 1000} s`)
        await dropped(ref, { _tag: 'NotReadyInTime' })
      } catch (error) {
        log(`${sid}: ${messageOf(error)}`)
      } finally {
        typing.delete(ref)
      }
    }
    typing.set(ref, loop())
  }

  // The launch command of a tier, with the skills linked first: the tiers can change after work
  // start (the settings on the page, or the roles that the person accepts).
  const launchOf = (tier: TerminalTier): string => {
    const launch = tierSettings(tier)?.launch
    if (!launch) {
      throw new Error(
        `${tier} has no launch command; ` +
          `set it in the settings (aristoteles.yaml tiers.${tier}.launch)`,
      )
    }
    for (const line of linkSkills(dir)) log(line)
    return launch
  }
  // Starts a terminal: the launch command of the tier, with the first input as {prompt}, or typed
  // when the tool is ready.
  const launch = async (tier: TerminalTier, sid: SessionId, words: string) => {
    const command = launchOf(tier)
    const asArgument = command.includes('{prompt}')
    const via = asArgument ? ({ _tag: 'LaunchArgument' } as const) : ({ _tag: 'Typed' } as const)
    const ref = await sendStart({ _tag: 'Start', to: to(sid), via })
    try {
      pump.start(sid, fill(command, { session: sid, prompt: words }))
    } catch (error) {
      await dropped(ref, { _tag: 'TypingFailed' })
      throw error
    }
    if (asArgument) await delivered(ref)
    else typeWhenReady(ref, sid, words, 1500)
  }

  // A real agent with no terminal yet: a new session, a new token, and its terminal.
  const startAgent = async (work: Work, a: Assignment, again?: SessionId) => {
    const tier = tierOf(work, a)
    if (tier === undefined) return
    if (!tierSettings(tier)?.launch) return log(`${a.id}: ${tier} has no launch command`)
    const sid = again ?? (randomUUID() as SessionId)
    const r = await act(['session', a.id, `--id=${sid}`, '--token'])
    if (r.code) return log(`${a.id}: ${r.err}`)
    current()
    await launch(tier, sid, promptOf(tier, tokenOf(r.out) ?? ''))
    log(`${a.id}: started in ${sid}`)
  }

  // A Stop, a Resume or a close goes in the store as a terminal move of the run or the agent that
  // the session stands for.
  const record = async (sid: string, kind: 'stopped' | 'resumed' | 'closed') => {
    const work = readState()
    const r = work && [...work.runs.values()].find((x) => x.session === sid)
    const a = work && [...work.sessions.values()].find((x) => x.session === sid)?.assignment
    const on = r?.id ?? a
    if (on === undefined) return log(`${sid}: no run or agent to record "${kind}" on`)
    const done = await act(['event', on, `--kind=${kind}`])
    if (done.code) log(`${on}: ${done.err}`)
  }
  // The ref of the last stored move of a terminal of a kind (the CLI that wrote it prints none).
  const lastMoveRef = (work: Work, sid: SessionId, tag: 'Prompted' | 'Failed') => {
    const logged = work.events.findLast(
      (l) =>
        l.recorded.event._tag === 'Terminal' &&
        l.recorded.event.id === sid &&
        l.recorded.event.move._tag === tag,
    )
    return logged === undefined ? undefined : refOf(logged.recorded.seq)
  }

  // --- wakes -------------------------------------------------------------------------------

  // A wake that waits for its terminal: stored as Pending, with each cause once. A next step that
  // changed adds nothing to a wake that waits already.
  const addWake = async (sid: SessionId, cause: Cause | 'next') => {
    const work = current()
    if (work === undefined) return
    const waiting = work.sends.filter((s) => wakeTo(s) === sid && s.state._tag === 'Pending')
    const known =
      cause === 'next'
        ? waiting.length > 0
        : waiting.some((s) => wakeCauses(s).some((c) => sameCause(c, cause)))
    if (known) return
    const causes = cause === 'next' ? [] : [cause]
    await sendLine({ _tag: 'Wake', to: to(sid), cause: wakeCause(causes) }, wakeLine(work, causes))
  }

  // Whom a new act wakes (the WAKES table), as the terminal and the cause of each wake.
  const wakesFor = (work: Work, logged: Logged) => {
    const out: Array<readonly [SessionId, Cause]> = []
    const read = actRead(work, logged)
    const ref = refOf(logged.recorded.seq)
    const e = read.event
    const review = e._tag === 'Review' && 'create' in e ? reviewRead(work, e.create) : undefined
    // A decision from above wakes the agent that waits for it at its prompt, because the wake of
    // a parent does not go down.
    const waiting = (a: AssignmentId | undefined, cause: Cause) => {
      const agent = realAgentOf(work, a)
      const sid =
        agent !== undefined && agent.id !== read.agent
          ? work.sessions.get(agent.id)?.session
          : undefined
      if (sid !== undefined) out.push([sid, cause])
    }
    for (const rule of wakesOf(work, logged.recorded.event)) {
      switch (rule) {
        // An answer wakes the agent that asked.
        case 'Asker': {
          const q = e._tag === 'Question' && 'move' in e ? work.questions.get(e.id) : undefined
          if (q !== undefined && typeof q.from === 'string') {
            waiting(q.from, { _tag: 'QuestionAnswered', question: q.id })
          }
          break
        }
        // A review of a result wakes each agent that escalated on it.
        case 'Escalators':
          for (const v of work.reviews.values()) {
            if (v._tag !== 'Escalate' || review?.result === undefined) continue
            if (v.of !== review.result) continue
            waiting(v.by, { _tag: 'EscalationReviewed', review: ref, escalation: v.id })
          }
          break
        // The accept of a task wakes the agents of each task that needs it, when all its needs
        // are accepted now (only an accept accepts a need).
        case 'Needers': {
          const accept = e._tag === 'Review' && 'create' in e && e.create._tag === 'Accept'
          const done = review?.result === undefined ? undefined : work.results.get(review.result)
          if (!accept || done === undefined) break
          for (const t of neederTasks(work, done.task, logged.recorded.at)) {
            for (const a of work.assignments.values()) {
              if (a.task !== t.id || a.end._tag !== 'NotEnded') continue
              waiting(a.id, { _tag: 'NeedAccepted', review: ref, needer: t.id })
            }
          }
          break
        }
        // An act of a child (an agent or a program) wakes its parent.
        case 'Parent': {
          const self = read.agent === undefined ? undefined : work.assignments.get(read.agent)
          if (self === undefined || self.parent._tag !== 'Parent') break
          const parent = realAgentOf(work, self.parent.id)
          const sid = parent === undefined ? undefined : work.sessions.get(parent.id)?.session
          if (sid !== undefined) out.push([sid, { _tag: 'ChildActed', child: self.id }])
          break
        }
        // A decision of the person wakes the sessions that it concerns.
        case 'Concerned':
          if (!read.person || review === undefined) break
          for (const sid of decisionSessions(work, review.target)) {
            out.push([sid, { _tag: 'PersonDecided', review: ref }])
          }
          break
      }
    }
    return out
  }

  // The wakes that wait for one terminal go out as one line, when it is quiet and its last wake
  // is 90 s old; the others are dropped into that one.
  const deliverWakes = async (work: Work, sid: SessionId, waiting: ReadonlyArray<Send>) => {
    const state = stateOf(sid)
    const st = pump.status()[sid]
    if (state?._tag === 'Stopped' || !st?.live) {
      const why = state?._tag === 'Stopped' ? 'StoppedByPerson' : 'TerminalNotLive'
      for (const w of waiting) await dropped(w.id, { _tag: why })
      return
    }
    // An agent at a prompt waits for its host's answer, not for a wake.
    if (state?._tag === 'Live' && state.activity._tag === 'AtPrompt') return
    if (clock() - lastWakeAt(work, sid) < time.wakeGap || quietFor(st) < time.outputWindow) return
    const [only, ...others] = waiting
    if (only === undefined) return
    if (others.length === 0) return deliver(only.id, sid, textOfKeys(only))
    const causes: Array<Cause> = []
    for (const c of waiting.flatMap(wakeCauses)) {
      if (!causes.some((x) => sameCause(x, c))) causes.push(c)
    }
    const text = wakeLine(work, causes)
    const merged = await sendLine({ _tag: 'Wake', to: to(sid), cause: wakeCause(causes) }, text)
    for (const w of waiting) await dropped(w.id, { _tag: 'Merged', into: merged })
    await deliver(merged, sid, text)
  }

  // --- one terminal: its prompt, its failure, its silence ----------------------------------

  const watch = async (x: Watched, items: ReturnType<typeof decisionsOf>) => {
    const status = pump.status()
    const st = status[x.sid]
    const work = current()
    const state = stateOf(x.sid)
    if (work === undefined || st === undefined || state === undefined) return
    // The person's Stop holds, and a closed terminal stays closed.
    if (state._tag === 'Stopped' || state._tag === 'Closed') return
    const tier: TerminalTier | undefined = x.host ? 'sol' : tierOf(work, x.a)
    const t = tier === undefined ? undefined : tierSettings(tier)
    const id = x.host ? x.run.id : x.a.id
    const lastAct = lastActOf(work, x.sid).at
    const { tries, lastTry } = retriesOf(work, x.sid)
    const tail = pump.tail(x.sid, 12)
    // A prompt of an AI tool shows its question above its options: the last lines tell.
    const recent = tail.split('\n').slice(-8)
    const asked = recent.findLast((l) => (t?.prompts ?? []).some((w) => l.includes(w)))
    if (asked === undefined && state._tag === 'Live' && state.activity._tag === 'AtPrompt') {
      see(x.sid, { _tag: 'Busy', lastOutput: timeAt(st.lastOutput || clock()) })
    }
    const quiet = (ms: number) => clock() - Math.max(ms || startedAt, lastAct)
    const silentMs = (t?.silentMinutes ?? 10) * 60000
    const top: TaskId | undefined = x.host ? topNow(work, x.run) : x.a.task
    let kind: Failure | 'prompt' | undefined
    if (st.ended) kind = 'ended'
    else if (asked !== undefined) kind = 'prompt'
    // An error shows on the screen until it scrolls away: it counts only when the tool is quiet.
    else if (
      (t?.errors ?? []).some((w) => recent.join('\n').includes(w)) &&
      quiet(st.lastOutput) > 60000
    ) {
      kind = 'error'
    } else if (quiet(st.lastOutput) > silentMs) {
      // A session waits, and is not silent, when the person must act in its tree (a talk, a
      // decision, the end of the project), or while a terminal of its tree works.
      const root = top === undefined ? undefined : rootOf(work, top)
      const inTree = (task: TaskId) => root !== undefined && within(work, task, root)
      const waits =
        (x.host && top === undefined) ||
        items.some((i) => (i.task !== null ? inTree(i.task) : root !== undefined)) ||
        watchedOf(work).some(
          (y) =>
            y.sid !== x.sid &&
            !y.host &&
            top !== undefined &&
            within(work, y.a.task, top) &&
            status[y.sid]?.live === true &&
            quietFor(status[y.sid]) < silentMs,
        )
      if (!waits) kind = 'silent'
    }
    if (kind === undefined) return
    // A host that ended (the person closed the AI CLI) is not restarted: the person triggers a
    // host again and continues the run there (Nanda, 2026-11-13).
    if (kind === 'ended' && x.host) return
    if (kind === 'prompt') {
      // A prompt is told once while it shows; the host of a failed terminal heard of it already.
      const line = clean(asked ?? '')
      if (state._tag !== 'Live') return
      if (state.activity._tag === 'AtPrompt' && state.activity.line === line) return
      await must(['event', id, '--kind=prompt', `--text=${line}`, '--tries=0'])
      // Told once while it shows: only a stored prompt counts (a failed write tries again).
      see(x.sid, { _tag: 'AtPrompt', line })
      if (x.host) {
        if (top === undefined) return
        const says =
          `Your AI CLI waits for your answer: ${line}. Answer it in the terminal of your AI ` +
          'CLI. The project goes on after that.'
        await must(['problem', top, `--says=${says}`])
        return
      }
      const after = current()
      const prompt = after === undefined ? undefined : lastMoveRef(after, x.sid, 'Prompted')
      if (after === undefined || prompt === undefined) return
      await tell(
        { _tag: 'AgentAtPrompt', prompt },
        hostSessionOf(after, x.a.task),
        `${SYSTEM} ${id} waits at a prompt. Its screen shows ${line}. Answer it with ` +
          `work send <your token> ${id} --text="<input>". When the prompt shows a failure of a ` +
          `system, run work problem <your token> ${x.a.task} --says="<what happened, and how ` +
          'to fix it>".',
      )
      return
    }
    if (clock() - lastTry < time.retryGap) return
    if (tries < 3) {
      const attempt = (tries + 1) as 1 | 2 | 3
      const input = t?.retryInput ?? DEFAULT_RETRY
      const ended = kind === 'ended'
      const via = ended ? ({ _tag: 'ResumeArgument' } as const) : ({ _tag: 'Typed' } as const)
      log(`${id}: ${kind}, try ${attempt} of 3`)
      const ref = await sendLine({ _tag: 'Retry', to: to(x.sid), attempt, via }, input)
      see(x.sid, { _tag: 'Retrying', why: kind, tries: attempt, lastTry: timeAt(clock()) })
      if (!ended) return deliver(ref, x.sid, input)
      try {
        pump.resume(x.sid, fill(t?.resume ?? t?.launch ?? '', { session: x.sid, prompt: input }))
      } catch (error) {
        await dropped(ref, { _tag: 'TypingFailed' })
        throw error
      }
      await delivered(ref)
      return
    }
    // A failure goes up once; a new act of the agent, or the person's Resume, brings it back.
    if (state._tag === 'Failed') return
    await must(['event', id, `--kind=${kind}`, `--text=${clean(tail, 600)}`, '--tries=3'])
    const last = clean(tail.split('\n').slice(-3).join(' / '))
    if (x.host) {
      if (top === undefined) return
      const says = `The host session failed 3 times (${kind}). Its last lines: ${last}`
      await must(['problem', top, `--says=${says}`])
      return
    }
    const after = current()
    const failure = after === undefined ? undefined : lastMoveRef(after, x.sid, 'Failed')
    if (after === undefined || failure === undefined) return
    await tell(
      { _tag: 'AgentFailed', failure },
      hostSessionOf(after, x.a.task),
      `${SYSTEM} ${id} failed 3 times (${kind}). Its last lines: ${last} You cannot restart ` +
        `it. Run work problem <your token> ${x.a.task} ` +
        '--says="<what happened, and how to fix it>"; the person then resumes it.',
    )
  }

  // --- system problems -----------------------------------------------------------------------

  // A try of a system problem, and what it did:
  //   'told'     the host recorded it, and the host runs: the host tries the work again, and
  //              records the fix itself;
  //   'no host'  no host runs to try it;
  //   'stopped'  the person stopped the host: a try never undoes the person's Stop (bug 4);
  //   'runs'     the UI recorded it, and the host runs again (the person triggered it again).
  // A try that tells is a ProblemRetry send, so its time keeps through a restart. The UI never
  // restarts a host itself (Nanda, 2026-11-13).
  const tryProblem = async (work: Work, sp: Problem) => {
    if (sp.recordedBy._tag === 'Host') {
      const sid = hostSessionOf(work, sp.stopped)
      if (sid === undefined || !pump.status()[sid]?.live) return 'no host' as const
      const text =
        `${SYSTEM} ${sp.id} is not fixed: ${clean(sp.says, 300)} Test it once, when your ` +
        `current step ends. When it works, run work problem <your token> ${sp.id} --fixed. ` +
        'When it still fails, do nothing: the UI tells you again later.'
      await tell({ _tag: 'ProblemRetry', problem: sp.id }, sid, text)
      return 'told' as const
    }
    const r = runOf(work, sp.stopped)
    if (r === undefined) return 'no host' as const
    if (stateOf(r.session)?._tag === 'Stopped') return 'stopped' as const
    // The UI starts no host and restarts none: the person triggers a host again.
    return pump.status()[r.session]?.live ? ('runs' as const) : ('no host' as const)
  }

  // --- the tick ------------------------------------------------------------------------------

  let seen = 0 // the seq of the last act whose wakes are stored
  const step = async (what: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
    } catch (error) {
      log(`${what}: ${messageOf(error)}`)
    }
  }

  // New real agents of the UI projects; an agent whose terminal never started (no brief yet, no
  // window) starts again with a new token.
  const startAgents = async (work: Work) => {
    const status = pump.status()
    const runs = [...work.runs.values()]
    for (const a of work.assignments.values()) {
      if (a.end._tag !== 'NotEnded' || tierOf(work, a) === undefined) continue
      const inRun = runs.some((r) => {
        const top = r.end._tag === 'Closed' ? undefined : topNow(work, r)
        return top !== undefined && within(work, a.task, top)
      })
      if (!inRun) continue
      const sid = work.sessions.get(a.id)?.session
      const tag = sid === undefined ? undefined : stateOf(sid)?._tag
      if (sid === undefined) await step(a.id, () => startAgent(work, a))
      else if (
        !status[sid] &&
        tag !== 'Stopped' &&
        tag !== 'Closed' &&
        (work.meta.get(a.id)?.briefs ?? 0) === 0 &&
        !runs.some((r) => r.session === sid)
      ) {
        await step(a.id, () => startAgent(work, a, sid))
      }
    }
  }

  // The sends that wait: a host's input for its child is typed at once when its terminal runs;
  // a send from before this supervisor started is not typed late; a wake waits (wakes below).
  const sendWaiting = async (work: Work) => {
    for (const send of work.sends) {
      if (send.state._tag !== 'Pending' || wakeTo(send) !== undefined) continue
      if (typing.has(send.id)) continue
      const old = Date.parse(send.at) < startedAt - RESTART_SKEW_MS
      if (send.from._tag !== 'Agent') {
        if (old) await step('send', () => dropped(send.id, { _tag: 'BeforeRestart' }))
        continue
      }
      const sid = send.from.to.session
      await step('send', async () => {
        if (old) await dropped(send.id, { _tag: 'BeforeRestart' })
        else if (stateOf(sid)?._tag === 'Stopped') {
          await dropped(send.id, { _tag: 'StoppedByPerson' })
        } else if (!pump.status()[sid]?.live) await dropped(send.id, { _tag: 'TerminalNotLive' })
        else await deliver(send.id, sid, textOfKeys(send))
      })
    }
  }

  // The wakes of the new acts since this start, of the open questions, and of the next steps of
  // quiet agents; then the wakes that wait go out.
  const wake = async () => {
    const acting = current()
    for (const logged of acting?.events ?? []) {
      if (acting === undefined || logged.recorded.seq <= seen) continue
      seen = logged.recorded.seq
      if (Date.parse(logged.recorded.at) < startedAt - RESTART_SKEW_MS) continue
      for (const [sid, cause] of wakesFor(acting, logged)) {
        await step('wake', () => addWake(sid, cause))
      }
    }
    // An open question to a real agent wakes it once (its stored wake keeps through a restart).
    const asking = current()
    for (const q of asking === undefined ? [] : questionWaits(asking)) {
      const cause = { _tag: 'QuestionWaits', question: q.question } as const
      if (asking?.sends.some((x) => wakeCauses(x).some((c) => sameCause(c, cause)))) continue
      await step(q.question, () => addWake(q.session, cause))
    }
    // The general wake: the next steps of a quiet agent changed while it waited. Each wait of the
    // engine ends here, also one that no act above names (a file that a maker of another task
    // held became free). Only the tags and ids count: a change of words wakes nobody (bug 13).
    const nexting = current()
    for (const s of nexting?.sessions.values() ?? []) {
      const a = nexting?.assignments.get(s.assignment)
      const st = pump.status()[s.session]
      const state = stateOf(s.session)
      if (nexting === undefined || a === undefined || a.end._tag !== 'NotEnded') continue
      if (!st?.live || state?._tag !== 'Live' || state.activity._tag === 'AtPrompt') continue
      if (quietFor(st) < time.outputWindow) {
        see(s.session, { _tag: 'Busy', lastOutput: timeAt(st.lastOutput) })
        continue
      }
      let key: string
      try {
        const at = timeAt(clock())
        key = stepKey(nextSteps(nexting, a.id, { token: '<token>', at, cwd: dir }))
      } catch (error) {
        log(`${a.id}: work next: ${messageOf(error)}`)
        continue
      }
      const before = state.activity._tag === 'Quiet' ? state.activity.stepKey : undefined
      see(s.session, { _tag: 'Quiet', stepKey: key })
      if (before !== undefined && before !== key) {
        await step('wake', () => addWake(s.session, 'next'))
      }
    }
    const waking = current()
    const bySession = new Map<SessionId, Array<Send>>()
    for (const w of waking?.sends ?? []) {
      const sid = wakeTo(w)
      if (sid === undefined || w.state._tag !== 'Pending') continue
      bySession.set(sid, [...(bySession.get(sid) ?? []), w])
    }
    for (const [sid, waiting] of bySession) {
      if (waking !== undefined) await step('wake', () => deliverWakes(waking, sid, waiting))
    }
  }

  // The end of work closes its terminal (Nanda, 2026-11-11): a real agent's when its assignment
  // finishes, and every terminal of a project when the project is done (the host keeps its own
  // assignment open). A session that an open run or other live work holds stays. Each closes
  // once, when it is quiet, so a terminal that the person resumes stays open.
  const closeEnded = async (work: Work) => {
    const runs = [...work.runs.values()]
    const inDone = (a: Assignment) =>
      runs.some((r) => {
        const top = r.end._tag === 'Done' ? topNow(work, r) : undefined
        return top !== undefined && within(work, a.task, top)
      })
    const sessions = [...work.sessions.values()].flatMap((s) => {
      const a = work.assignments.get(s.assignment)
      return a === undefined ? [] : [{ sid: s.session, a }]
    })
    const keeps = new Set([
      ...runs.filter((r) => r.end._tag === 'NotEnded').map((r) => r.session),
      ...sessions.filter((s) => s.a.end._tag === 'NotEnded' && !inDone(s.a)).map((s) => s.sid),
    ])
    const over = new Map<SessionId, string>([
      ...sessions
        .filter((s) => s.a.end._tag !== 'NotEnded' || inDone(s.a))
        .map((s) => [s.sid, s.a.id] as const),
      ...runs.filter((r) => r.end._tag === 'Done').map((r) => [r.session, r.id] as const),
    ])
    for (const [sid, id] of over) {
      const st = pump.status()[sid]
      if (keeps.has(sid) || closedOnce(work, sid) || st === undefined) continue
      if (stateOf(sid)?._tag === 'Stopped' || quietFor(st) < time.outputWindow) continue
      pump.stop(sid)
      log(`${id}: its work ended, so its terminal closed`)
      await step(id, () => record(sid, 'closed'))
    }
  }

  // A new decision for the person: the host writes its words first (told once: its send).
  const askForWords = async (work: Work) => {
    const ctx = { at: timeAt(clock()), dir, settings: settings(), terminals: pump.status() }
    for (const item of decisionsOf(work, ctx)) {
      const told = work.sends.some(
        (x) =>
          x.from._tag === 'Supervisor' &&
          x.from.reason._tag === 'DecisionNeedsWords' &&
          x.from.reason.decision === item.id,
      )
      if (item.words !== null || told) continue
      const sid = item.task === null ? undefined : hostSessionOf(work, item.task)
      const form =
        item._tag === 'Direction'
          ? '--text="<the problem>" --hope="<what you hope by this change>"'
          : '--text="<the words>"'
      const text =
        `The decision ${item.id} waits for the person: ${clean(item.text, 300)} ` +
        'Read work guide decision-words, then write its words for the person: ' +
        `work note <your token> words --on=${item.id} ${form}.`
      const decision = item.id as ProblemId
      await step(item.id, () => tell({ _tag: 'DecisionNeedsWords', decision }, sid, text))
    }
  }

  // The host of each open run that runs in the person's own pane: the pump copies that pane, and
  // stops copying a pane that no open run names. A window of an older host of a run (before a
  // continue moved the run) closes, once.
  const syncHosts = (work: Work) => {
    const panes = new Set<string>()
    for (const r of work.runs.values()) {
      if (r.end._tag !== 'NotEnded' || r.terminal._tag !== 'Pane') continue
      pump.adopt(r.session, r.terminal.socket, r.terminal.pane)
      panes.add(r.session)
    }
    const status = pump.status()
    for (const sid of Object.keys(status)) if (!panes.has(sid) && pump.paneOf(sid)) pump.release(sid)
    for (const r of work.runs.values()) {
      for (const old of r.formerSessions) {
        if (status[old] === undefined || pump.paneOf(old)) continue
        pump.stop(old)
        log(`${r.id}: its host continues in another terminal, so the window of its old host closed`)
      }
    }
  }
  const tickNow = async () => {
    const first = current()
    if (first === undefined) return
    syncHosts(first)
    await startAgents(first)
    const sending = current()
    if (sending !== undefined) await sendWaiting(sending)
    await wake()
    const ending = current()
    if (ending !== undefined) await closeEnded(ending)

    // Failures: an end, error words, a prompt, or silence; up to 3 retries, then up.
    const failing = current()
    if (failing !== undefined) {
      const ctx = { at: timeAt(clock()), dir, settings: settings(), terminals: pump.status() }
      const items = decisionsOf(failing, ctx)
      for (const x of watchedOf(failing)) await step(`session ${x.sid}`, () => watch(x, items))
    }

    // A system problem: the host tries it again each retryMinutes.
    const trying = current()
    const retryMs = settings().retryMinutes * 60000
    for (const sp of trying?.problems.values() ?? []) {
      if (trying === undefined || sp.fixed._tag !== 'NotFixed') continue
      if (clock() - lastProblemTry(trying, sp.id) < retryMs) continue
      await step(sp.id, async () => {
        // A try that finds the host running again fixes a problem of the host.
        const how = await tryProblem(trying, sp)
        if (how === 'runs') await must(['problem', sp.id, '--fixed'])
      })
    }

    const deciding = current()
    if (deciding !== undefined) await askForWords(deciding)
  }

  // One act at a time: the tick and the person's acts on the terminals run in turn, so a Fixed
  // and a tick never try one problem together (bug 14).
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <A>(fn: () => Promise<A>): Promise<A> => {
    const run = queue.then(fn, fn)
    queue = run.catch(() => undefined)
    return run
  }
  let ticking = false
  const tick = async () => {
    if (ticking) return
    ticking = true
    try {
      await serial(async () => {
        try {
          await tickNow()
        } catch (error) {
          log(`the watcher: ${messageOf(error)}`)
        }
      })
    } finally {
      ticking = false
    }
  }

  // The person's Stop: the terminal goes, the Stop is stored (no retry, no restart, no input
  // until the person's Resume), and each send that waits for it is dropped.
  const stopNow = async (sid: SessionId) => {
    pump.stop(sid)
    await record(sid, 'stopped')
    const work = current()
    for (const send of work?.sends ?? []) {
      if (work === undefined || send.state._tag !== 'Pending') continue
      if (destinationOf(work, send) === sid) await dropped(send.id, { _tag: 'StoppedByPerson' })
    }
  }

  const timer = setInterval(tick, time.tick)
  timer.unref?.()

  return {
    tick,
    stop: () => clearInterval(timer),
    // Open: the person opens the drafted top task; the host continues as its Sol: the start words
    // of a Sol with its new token, typed when its terminal is ready.
    open: (draft) =>
      serial(async () => {
        const out = await must(['task', 'open', draft])
        const work = current()
        const d = work?.taskDrafts.get(draft as never)
        const sid = d === undefined ? undefined : work?.runs.get(d.run)?.session
        if (sid !== undefined) {
          const ref = await sendStart({ _tag: 'Start', to: to(sid), via: { _tag: 'Typed' } })
          typeWhenReady(ref, sid, promptOf('sol', tokenOf(out) ?? ''), 500)
        }
        return out
      }),
    stopSession: (sid) =>
      serial(async () => {
        current()
        await stopNow(sid as SessionId)
      }),
    // The person's Resume, also of a failed terminal: its tries start again.
    resumeSession: (sid, tier) =>
      serial(async () => {
        const t = tierSettings(tier)
        const input = t?.retryInput ?? DEFAULT_RETRY
        pump.resume(sid, fill(t?.resume ?? t?.launch ?? '', { session: sid, prompt: input }))
        await record(sid, 'resumed')
        current()
      }),
    // Fixed (the person): the UI tries the problem at once. A problem of the host itself ends
    // when the host runs again; any other ends when the host records its fix.
    fixed: (spId) =>
      serial(async () => {
        const work = current()
        const sp = work?.problems.get(spId as ProblemId)
        if (work === undefined || sp === undefined || sp.fixed._tag === 'Fixed') {
          throw new Error(`${spId} is no open system problem`)
        }
        const how = await tryProblem(work, sp)
        if (how === 'stopped') {
          throw new Error(`${spId}: you stopped the host; Resume it, then click Fixed`)
        }
        if (how === 'no host') {
          throw new Error(
            `${spId}: no host runs to try it; trigger the host in your AI CLI again, then click Fixed`,
          )
        }
        if (how === 'told') {
          return (
            `${spId}: the host tries it again now; ` +
            'the decision goes when the host records the fix.'
          )
        }
        await must(['problem', spId, '--fixed'])
        return `${spId}: the host runs, and the problem is fixed.`
      }),
    // Close: every terminal of the project stops, and its tasks close.
    close: (runId, reason) =>
      serial(async () => {
        const work = current()
        const r = work?.runs.get(runId as never)
        if (work === undefined || r === undefined) throw new Error(`there is no run ${runId}`)
        const top = topNow(work, r)
        // The host's own pane is the person's (also as the Sol of the top task): the page stops
        // showing it, and it keeps running.
        const ownPane = (sid: SessionId) => pump.paneOf(sid) !== undefined
        for (const s of work.sessions.values()) {
          const a = work.assignments.get(s.assignment)
          if (top === undefined || a === undefined || !within(work, a.task, top)) continue
          if (!ownPane(s.session)) await stopNow(s.session)
        }
        if (ownPane(r.session)) pump.release(r.session)
        else await stopNow(r.session)
        const task = top === undefined ? undefined : work.tasks.get(top)
        if (task !== undefined && task.end._tag === 'NotEnded') {
          await must(['task', 'close', task.id, `--reason=${reason}`], { typed: 'close' })
        }
        await must(['run', 'close', runId])
      }),
  }
}

// Whom a new act may wake (ui/watcher.js 304-337), one row per kind of event, so that a new kind
// fails the compile here until the supervisor knows whom it wakes: the agent that asked (an
// answer), the agents that escalated on a result (a review of a result) and those of the tasks
// that need it (only an accept accepts a need), the parent of the agent that acted (any act of
// an agent), and the sessions that a decision of the person concerns (a review by the person).
// Which of them applies depends on the author and the target, so a row lists each one that can.
export type WakeRule = 'Asker' | 'Escalators' | 'Needers' | 'Parent' | 'Concerned'
const ACT_OF_AGENT: ReadonlyArray<WakeRule> = ['Parent']
const ACCEPT: ReadonlyArray<WakeRule> = ['Escalators', 'Needers', 'Parent', 'Concerned']
const REVIEW: ReadonlyArray<WakeRule> = ['Escalators', 'Parent', 'Concerned']
const NONE: ReadonlyArray<WakeRule> = []
export const WAKES: Total<ReadonlyArray<WakeRule>> = {
  'Workflow.Defined': NONE,
  'Workflow.RoleWordsChanged': NONE,
  'Role.Fitted': ACT_OF_AGENT,
  'Run.HostJoined': NONE,
  'Run.HostStarted': NONE,
  'Run.HostMoved': NONE,
  'Run.Done': NONE,
  'Run.Closed': NONE,
  'TaskDraft.Drafted': NONE,
  'Problem.Recorded': ACT_OF_AGENT,
  'Problem.Fixed': ACT_OF_AGENT,
  'Terminal.Started': NONE,
  'Terminal.Failed': NONE,
  'Terminal.Prompted': NONE,
  'Terminal.Stopped': NONE,
  'Terminal.Resumed': NONE,
  'Terminal.Closed': NONE,
  'Send.Sent': ACT_OF_AGENT,
  'Send.Delivered': NONE,
  'Send.Dropped': NONE,
  'HostWords.ProblemWords': ACT_OF_AGENT,
  'HostWords.DraftWords': ACT_OF_AGENT,
  'HostWords.EndWords': ACT_OF_AGENT,
  'Task.Opened': NONE,
  'Task.OpenedFromDraft': NONE,
  'Task.Remade': ACT_OF_AGENT,
  'Task.Split': ACT_OF_AGENT,
  'Task.Closed': ACT_OF_AGENT,
  'Task.Described': NONE,
  'Assignment.GivenMaker': ACT_OF_AGENT,
  'Assignment.GivenReviewer': ACT_OF_AGENT,
  'Assignment.Briefed': ACT_OF_AGENT,
  'Assignment.BriefedToCheck': ACT_OF_AGENT,
  'Assignment.BriefedFirst': ACT_OF_AGENT,
  'Assignment.Freed': ACT_OF_AGENT,
  'Assignment.Finished': ACT_OF_AGENT,
  'Result.Result': ACT_OF_AGENT,
  'Review.Accept': ACCEPT,
  'Review.Reject': REVIEW,
  'Review.Recheck': REVIEW,
  'Review.Escalate': ACT_OF_AGENT,
  'Review.Resolve': REVIEW,
  'Question.Asked': ACT_OF_AGENT,
  'Question.Escalated': ACT_OF_AGENT,
  'Question.Answered': ['Asker', 'Parent'],
  'Note.Message': ACT_OF_AGENT,
  'Note.Finding': ACT_OF_AGENT,
  'Evaluation.Evaluation': ACT_OF_AGENT,
  'Suggestion.Suggestion': ACT_OF_AGENT,
  'Revision.Drafted': ACT_OF_AGENT,
  'Revision.Revised': ACT_OF_AGENT,
  'Revision.Imported': NONE,
  'Permission.Granted': ACT_OF_AGENT,
  'Permission.Revoked': ACT_OF_AGENT,
  'Source.Moved': ACT_OF_AGENT,
  'Source.Checked': ACT_OF_AGENT,
  'Checkpoint.Checkpoint': ACT_OF_AGENT,
  // A forward wakes as its inner act when that act counts (wakesOf); a forward that waits for
  // the confirm is an act of the top agent only.
  'Forward.Forwarded': ACT_OF_AGENT,
  'Forward.Confirmed': NONE,
}

// The row of a new event. A forwarded act counts as the person's act of its own kind: at once,
// or at the confirm (the old watcher read only the outer row, so it woke nobody for it).
export const wakesOf = (work: Work, event: Event): ReadonlyArray<WakeRule> => {
  if (event._tag !== 'Forward') return WAKES[kindOf(event)]
  if ('create' in event) {
    const counted = Schema.is(CountedAct)(event.create.inner)
    return counted ? WAKES[kindOf(event.create.inner)] : WAKES['Forward.Forwarded']
  }
  const confirmed = work.forwards.get(event.id)
  return confirmed === undefined ? NONE : WAKES[kindOf(confirmed.inner)]
}
