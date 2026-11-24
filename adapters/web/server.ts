import { startStateOf } from '../../core/actions/index.ts'
import { startRefusal } from '../words/index.ts'
import { activationEvents, markerApproval, prepareActivation, runActivation } from '../live/activation.ts'
import { bootstrapAlive, bootstrapPane, isBootstrapSession, isBootstrapSocket } from '../live/bootstrap.ts'
import { initState } from '../../core/state/c16/state.ts'
import { ACTIVATION, activationOf, gate, isInactive } from '../../core/actions/activation.ts'
// startServer (frozen; package P9): the page of a dir. A terminal in the browser can run any
// command. The server listens on every interface of the machine, with no key (Nanda, 2026-11-15:
// a personal project), so anyone on its network can open the page and type into the terminals.
// Two locks stay:
// - each request must name this machine in its Host header (127.0.0.1, localhost or an address
//   of its own network interfaces, with the server's port), so a page of another name that
//   points to the machine (DNS rebinding) reads nothing;
// - an act and the websocket must come from the page's own origin, so another page in the same
//   browser can neither act nor read a terminal.
//
// The server holds the WorkCache (a SubscriptionRef of the folded Work, renewed from the store,
// which other processes write) and sends `changed` on each value of its changes. A read derives
// the Work and renders the views of view.ts; a person's act dispatches its action as the person
// of git user.name (acts.ts).
import { existsSync, type FSWatcher, readdirSync, statSync, watch } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema, Stream, SubscriptionRef } from 'effect'
import { Refusal } from '../../core/actions/types.ts'
import {
  confirmForward,
  dispatchAct,
  dropForward,
  pageActId,
} from '../../core/actions/work.ts'
import { type Derived, derive } from '../../core/derived/index.ts'
import { checkHost, tmuxPaneExists } from '../../core/effects/host-check.ts'
import {
  type Author,
  OnboardingAct,
  RefusalSchema,
  StoreDamaged,
  type Time,
  type Work,
} from '../../core/schema/index.ts'
import {
  ASSESS,
  CONFIG,
  DRAFT,
  dbPath,
  Dir,
  Env,
  FilesLive,
  Now,
  onboardingExists,
  GitUser,
  readActivationRecord,
  activationLock,
  applyStaffingReview,
  previewStaffingReview,
  readStaffingReview,
  type Staffing,
  pathOf,
  personAct,
  readOnboarding,
  readSettings,
  SpawnLive,
  Store,
  StoreLive,
  Tokens,
  writeSettings,
} from '../../core/services/index.ts'
import { fold, momentOf, WorkCache, workCacheLayer } from '../../core/state/index.ts'
import { foldWork } from '../../core/state/c16/fold.ts'
import { workerSession } from '../../core/actions/worker.ts'
import { sessionAt } from '../../core/effects/engine.ts'
import { foldRechecks } from '../../core/state/rechecks.ts'
import { foldRuntime } from '../../core/state/worker-runtime.ts'
import { keyOf } from '../../core/state/c16/types.ts'
import { buildOf } from '../live/build.ts'
import { readPane } from '../live/host-pane.ts'
import { readingsLive } from '../live/readings.ts'
import { readStatus, statusStamp } from '../live/status.ts'
import { tokenSecret } from '../live/tokens.ts'
import { readMarkers } from '../live/waiting.ts'
import { bootstrapAttach, isLocalTerminalSession, workerAttach } from '../live/worker-terminal.ts'
import {
  forwardedPageBody, pageBodyOf, pagePointsOk, type WorkPost, workPostOf,
} from './acts.ts'
import { PAGE_FILES, pageBundle } from './bundle.ts'
import {
  ACTS,
  type ActResponse,
  Dash,
  DashMessage,
  ActivationPost,
  StaffingPost, StaffingPreview, StaffingState,
  MarkerApproval,
  DirView,
  OnboardingView,
  PageAct,
  PageMessage,
  PersonView,
} from './contract.ts'
import { dashOf } from './dash.ts'
import type { ServerHandle, ServerOptions } from './frozen.ts'
import { pipeMarks, pipeQueue } from './pipe-keys.ts'
import { onboardingWords } from './onboard.ts'
import {
  dirView,
  onboardingFilesView,
  onboardingStoreView,
  personView,
  type ViewContext,
} from './view.ts'

export type { ServerHandle, ServerOptions, ServerTools } from './frozen.ts'

const ROOT = resolve(import.meta.dir, '..', '..')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
// An answer of the API, encoded with its Schema: the wire is the contract.
const answer = <A, I>(schema: Schema.Codec<A, I>, value: A) =>
  json(Schema.encodeSync(schema)(value))

// An answer of more than one packet, gzipped when the browser takes it: the canvas of a big project
// is about 10 KB of JSON, on the Wi-Fi of a phone (the page budget, plan/rebuild/BENCH.md).
const gzipped = async (req: Request, res: Response): Promise<Response> => {
  const text = await res.text()
  const headers = new Headers(res.headers)
  headers.set('vary', 'accept-encoding')
  if (text.length < 1400 || !/\bgzip\b/.test(req.headers.get('accept-encoding') ?? '')) {
    return new Response(text, { status: res.status, headers })
  }
  headers.set('content-encoding', 'gzip')
  return new Response(Bun.gzipSync(text), { status: res.status, headers })
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

// The body of a refused request: the message, and its next line when the error has one (Nanda,
// 2026-11-15: the page shows it, as the terminal does).
const refusalOf = (error: unknown): { error: string; next?: string } => {
  const next = isRecord(error) && typeof error.next === 'string' ? error.next : undefined
  return next === undefined ? { error: messageOf(error) } : { error: messageOf(error), next }
}

const messageOf = (error: unknown): string =>
  error instanceof StoreDamaged
    ? `the store is damaged at e${error.seq}: ${error.issue}`
    : error instanceof Error
      ? error.message
      : String(error)

// The words that the person pastes into the AI CLI that they use, in the dir. That session is
// the host (Nanda, 2026-11-13): it sets up a new dir, starts the page, and starts or continues
// a project. The steps of the README prompt (ruling 12): the skill install first, then the skill.
const startPrompt = (dir: string) =>
  `Use aristoteles in the folder ${dir}: run work skill install there, then read ` +
  `${join(ROOT, 'skills', 'aristoteles', 'SKILL.md')} and do what it says; you are the host. ` +
  `When work is not on the PATH, use bun ${join(ROOT, 'bin', 'work.js')} in its place.`

// The person of the page: git user.name of the dir (B7), read at each request, so that a new
// name counts at once. A git process (about 15 ms by its path, 80 ms by name on a long PATH)
// that runs while the request derives.
const gitName = async (dir: string): Promise<string> => {
  const argv = [pathOf('git'), '-C', dir, 'config', 'user.name']
  const git = Bun.spawn(argv, { env: process.env, stdout: 'pipe', stderr: 'ignore' })
  return (await new Response(git.stdout).text()).trim()
}

// The paths of the places of the page: one to three names, none of them the API, the websocket,
// the health check or a vendor file (each file of the page has a dot in its name).
const PAGE_PATH = /^\/(?!(?:api|ws|health|vendor)(?:\/|$))[\w-]+(?:\/[\w-]+){0,2}\/?$/

// The addresses of this machine's network interfaces (IPv4, not loopback): another machine opens
// the page at one of them. Read on each call, since an address can change.
export const networkAddresses = (): ReadonlyArray<string> =>
  Object.values(networkInterfaces()).flatMap((list) =>
    (list ?? []).filter((a) => a.family === 'IPv4' && !a.internal).map((a) => a.address),
  )
// The names that a request may give this server in its Host header and its Origin.
const ownNames = (): ReadonlyArray<string> => ['127.0.0.1', 'localhost', ...networkAddresses()]

const NO_PERSON = 'the page acts as the person of git user.name; set it: git config user.name <you>'

export function startServer(options: ServerOptions): ServerHandle {
  const {
    dir,
    env = process.env,
    port = 0,
    clock = () => new Date().toISOString(),
    extend = {},
    pump,
    watcher,
    restart,
    readBuild = () => buildOf(env),
    buildMs = 5000,
  } = options

  // P8: the build of the code that this server runs: a page of another build reloads.
  const build = readBuild()

  // --- the store and the cache -----------------------------------------------------------------

  const store = StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env })))
  const dirLayer = Layer.succeed(Dir, { cwd: dir })
  const services = Layer.mergeAll(
    store,
    FilesLive,
    SpawnLive,
    dirLayer,
    Layer.succeed(Env, { vars: env }),
    Layer.succeed(Now, { read: Effect.sync(() => clock() as Time) }),
    Layer.succeed(Tokens, { random: Effect.sync(tokenSecret) }),
    // The readings of the outside, with the terminals of the pump.
    readingsLive({ terminals: () => pump?.status() ?? {} }).pipe(
      Layer.provide(Layer.mergeAll(dirLayer, Layer.succeed(Env, { vars: env }))),
    ),
  )
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(services, workCacheLayer(dir).pipe(Layer.provide(store))),
  )
  // Runs an Effect to the end, in this call; a failure is an Error with its words.
  const runSync = <A, E>(
    effect: Effect.Effect<A, E, ManagedRuntime.ManagedRuntime.Services<typeof runtime>>,
  ): A => {
    const exit = runtime.runSyncExit(effect)
    if (Exit.isSuccess(exit)) return exit.value
    throw new Error(messageOf(Cause.squash(exit.cause)))
  }

  // The host's pane is gone: its end is recorded (a failure here never stops the server).
  const checkManagedHost = () => checkHost(tmuxPaneExists,
    (session) => Effect.sync(() => bootstrapAlive(dir, session.slice('boot-'.length))))
  runSync(Effect.asVoid(Effect.exit(checkManagedHost())))

  // The Work now: the cache renews itself from the store, and folds only on a new last seq.
  const refresh = Effect.gen(function* () {
    const cached = yield* (yield* WorkCache).refresh
    return cached._tag === 'Folded' ? cached.work : undefined
  })
  const readState = (): Work | undefined => runSync(refresh)
  // The Work derived at the clock of the server, with the readings of the outside.
  const derivedNow = Effect.gen(function* () {
    const work = yield* refresh
    if (work === undefined) return undefined
    const at = yield* (yield* Now).read
    return derive(yield* momentOf(work, at))
  })
  const readDerived = (): Derived | undefined => runSync(derivedNow)
  const context = (): ViewContext => ({ dir, settings: runSync(readSettings(dir)) })

  // --- the dashboard (DESIGN 10): built whole from the store and the terminals -----------------

  const storeEvents = () =>
    runSync(
      Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* (yield* Store).open(dir, { create: false })
          return yield* opened.events
        }).pipe(Effect.catchTag('Refused', () => Effect.succeed([]))),
      ),
    )
  // The DIR / PROJECT picker (DESIGN 10.1): this dir with its top task, when it has one.
  const picksNow = (): typeof DirView.Type['picks'] => [
    { dir: basename(dir), project: foldWork(storeEvents())?.state.top.name ?? null, path: '/' },
  ]
  // Include recorded binding IDs as well as the reserved tmux names. Past generations
  // stay local even if their pane has stopped or the browser has a queued key.
  const localSessions = new Set<string>()
  const localOnly = (session: string): boolean =>
    isLocalTerminalSession(session) || localSessions.has(session) || pump?.localOnly?.(session) === true
  const dashNow = (): typeof Dash.Type | undefined => {
    const events = storeEvents()
    const folded = foldWork(events)
    if (folded === null) {
      const record = readActivationRecord(dir)
      if (!record) return undefined
      const state = activationOf(events)
      const binding = state?.binding
      const relaunching = record.pending?.kind === 'rebind' && record.pending.launch !== binding?.launch
      const hostLost = state?.active === true && binding !== null && binding !== undefined &&
        !bootstrapAlive(dir, binding.launch)
      const phase = record.phase === 'rolling back' ? 'rolling back'
        : relaunching ? 'relaunching'
        : hostLost ? 'host lost'
        : state?.active ? 'active' : 'activating'
      return {
        ...dashOf({
          dir: basename(dir), build, now: Date.parse(clock()),
          state: initState({ name: '', goal: '', sections: [], facts: {}, directions: [] }, new Map(), new Map(), 3),
          host: { model: '', reading: null }, hostSession: null, pipe: null,
          terminals: {}, tails: {}, forwards: [], markers: [], principles: {},
        }),
        header: { dir: basename(dir), project: '', seq: events.at(-1)?.seq ?? 0, build },
        activation: {
          phase,
          step: phase === 'active' ? 'Open the top to begin work.'
            : record.pending?.acknowledged ? 'The host acknowledged its launch.'
            : record.pending ? 'Waiting for the host to acknowledge.'
            : 'Preparing the project.',
          next: phase === 'active' ? null : phase === 'host lost' ? 'relaunch'
            : phase === 'rolling back' ? 'roll back' : 'resume',
        },
      }
    }
    const { state, forwards, hostSession } = folded
    const runtimeWorkers = foldRuntime(events)
    const managedActors = new Set(runtimeWorkers.placements.flatMap(({ members }) => members))
    for (const { event } of events) {
      if (event._tag !== 'Runtime') continue
      if (event.create._tag === 'WorkerBound') localSessions.add(event.create.session)
      if (event.create._tag === 'WorkerReserved') localSessions.add(workerSession(event.create.launch))
    }
    const binding = activationOf(events)?.binding
    const managed = !managedActors.has('host') && binding && (state.ep.get('host') ?? 0) === 0 && hostSession !== null
      ? bootstrapPane(dir, binding.launch) : null
    const hostPane = managedActors.has('host') ? null : folded.hostPane ?? managed
    const now = Date.parse(clock())
    const terminals = pump?.status() ?? {}
    const persistent = [
      keyOf({ _tag: 'Host' }), keyOf({ _tag: 'Pipe' }),
      ...[...state.cards.keys()].map((name) => keyOf({ _tag: 'Role', name })),
    ]
    const tails = Object.fromEntries(
      persistent.flatMap((k) => {
        if (managedActors.has(k)) return []
        const sid = sessionAt(hostSession, k, state.ep.get(k) ?? 0)
        return !localOnly(sid) && sid in terminals ? [[sid, pump?.tail(sid, 40) ?? '']] : []
      }),
    )
    const old = readState()
    const roles = Object.entries(fold(events).config.roles)
    const pipe = roles.find(([, r]) => r.kind === 'agent' && r.pipeline === true)
    return dashOf({
      dir: basename(dir),
      build,
      now,
      state,
      hostSession,
      runtime: runtimeWorkers,
      recheckJobs: foldRechecks(events),
      admission: { policy: folded.policy, permits: folded.permits },
      localAttach: (session) => isBootstrapSession(session)
        ? bootstrapAlive(dir, session.slice('boot-'.length)) ? bootstrapAttach(dir, session) : null
        : pump && terminals[session]?._tag === 'Live' ? workerAttach(pump.socket, pump.name, session) : null,
      host: {
        model: '',
        reading: hostPane === null ? null : readPane(
          hostPane.socket, hostPane.pane,
          isBootstrapSocket(dir, hostPane.socket) || localOnly(sessionAt(hostSession, 'host', state.ep.get('host') ?? 0))
            ? 0 : undefined,
        ),
      },
      pipe: pipe === undefined || pipe[1].kind !== 'agent'
        ? null
        : { name: pipe[0], model: pipe[1].model },
      terminals,
      tails,
      forwards: forwards.map(({ id, act, quote }) => ({ id, quote, body: act })),
      markers: readMarkers(env, dir, now),
      principles: Object.fromEntries(
        [...(old?.directions ?? [])].map(([id, d]) => [`dir:${id}`, d.from]),
      ),
    })
  }
  // The whole Dash goes to every tab when it differs from the last one sent (never a diff:
  // browser.qnt, the page draws from a whole copy).
  let lastDash = ''
  const dashText = (): string | undefined => {
    const dash = dashNow()
    return dash === undefined
      ? undefined
      : JSON.stringify(Schema.encodeSync(DashMessage)({ type: 'dash', dash }))
  }
  const pushDash = () => {
    if (sockets.size === 0) return
    try {
      const text = dashText()
      if (text === undefined || text === lastDash) return
      lastDash = text
      for (const ws of sockets) ws.send(text)
    } catch {
      // A damaged store shows on the next read of the page, with its words.
    }
  }

  // --- the websocket and the terminals ---------------------------------------------------------

  const sockets = new Set<Bun.ServerWebSocket<undefined>>()
  const send = (message: unknown) => {
    const text = JSON.stringify(message)
    for (const ws of sockets) ws.send(text)
  }
  // `changed` on each value of the cache: a new last seq of the store.
  runtime.runFork(
    Effect.gen(function* () {
      const { ref } = yield* WorkCache
      yield* SubscriptionRef.changes(ref).pipe(
        Stream.runForEach(() =>
          Effect.sync(() => {
            send({ type: 'changed' })
            pushDash()
          })
        ),
      )
    }),
  )
  // The terminals (part 5): a tab subscribes to the sessions that it shows; the pump's output
  // and each size that tmux reports go to each tab that shows its session.
  const watching = new Map<Bun.ServerWebSocket<undefined>, Set<string>>()
  const attachments = new Map<string, number>()
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
  const toWatchers = (session: string, message: unknown) => {
    if (localOnly(session)) return
    const text = JSON.stringify(message)
    for (const [ws, set] of watching) {
      if (set.has(session) && ws.send(text) === 0) ws.close(1013, 'redraw terminal')
    }
  }
  const shown = (session: string) => [...watching.values()].some((set) => set.has(session))
  let marks: ReturnType<typeof pipeMarks> | undefined
  let keys: ReturnType<typeof pipeQueue> | undefined
  const queue = () => {
    if (keys) return keys
    marks = pipeMarks(dbPath(env), dir)
    keys = pipeQueue(marks, (key) => {
      if (localOnly(key.session)) return { state: 'gone' }
      const target = pump?.inputTarget(key.session)
      if (!target || target.state === 'gone') return { state: 'gone' }
      if (target.state !== 'ready') return { state: 'waiting' }
      return target.id === key.target
        ? { state: 'ready', prepare: () => target.prepare(key.data, key.instance, key.seq) }
        : { state: 'gone' }
    })
    return keys
  }
  const waitingBindings = new Set<string>()
  const bind = (session: string) => {
    if (localOnly(session)) {
      waitingBindings.delete(session)
      return false
    }
    const target = pump?.inputTarget(session)
    if (target?.state !== 'ready') {
      if (!waitingBindings.has(session)) {
        toWatchers(session, {
          type: 'term.error', session, error: 'Waiting for the terminal pane to bind',
        })
      }
      waitingBindings.add(session)
      return false
    }
    waitingBindings.delete(session)
    toWatchers(session, { type: 'term.bound', session, target: target.id })
    return true
  }
  const redraw = (session: string) => {
    if (!pump || localOnly(session) || !shown(session)) return
    pump.redraw(session, (frame) => {
      if (localOnly(session) || !shown(session)) return
      const attach = (attachments.get(session) ?? 0) + 1
      attachments.set(session, attach)
      const size = pump.size(session)
      if (size) toWatchers(session, { type: 'term.size', session, ...size, attach })
      toWatchers(session, {
        type: 'term.data', session, data: b64(frame), reset: true, attach,
      })
      bind(session)
    })
  }
  const onOutput = (session: string, bytes: Uint8Array) => {
    const attach = attachments.get(session)
    if (attach !== undefined) {
      toWatchers(session, { type: 'term.data', session, data: b64(bytes), attach })
    }
  }
  const onSize = (session: string, size: { cols: number; rows: number }) => {
    const attach = attachments.get(session)
    if (attach !== undefined) toWatchers(session, { type: 'term.size', session, ...size, attach })
  }
  const onAttach = (session?: string) => {
    if (session !== undefined) redraw(session)
    else for (const sid of new Set([...watching.values()].flatMap((set) => [...set]))) redraw(sid)
  }
  if (pump) {
    pump.onOutputs = [...pump.onOutputs, onOutput]
    pump.onSizes = [...pump.onSizes, onSize]
    pump.onAttach = [...pump.onAttach, onAttach]
  }
  const drain = setInterval(() => {
    try {
      keys?.drain()
    } catch {
      // Leave keys pending when storage is temporarily unavailable.
    }
  }, 100)
  drain.unref()
  const retryBindings = setInterval(() => {
    for (const session of waitingBindings) {
      if (!shown(session)) waitingBindings.delete(session)
      else if (bind(session)) redraw(session)
    }
  }, 1000)
  retryBindings.unref()
  const terminalMessage = (ws: Bun.ServerWebSocket<undefined>, m: typeof PageMessage.Type) => {
    const error = (words: string) =>
      ws.send(JSON.stringify({ type: 'term.error', session: m.session, error: words }))
    // These panes receive raw turn or activation credentials. Keep their screens local.
    if (localOnly(m.session)) {
      if (m.type === 'term.open') error('The managed terminal is available in local tmux.')
      return
    }
    if (!pump) {
      error('tmux is not on this machine')
      return
    }
    const set = watching.get(ws) ?? new Set<string>()
    watching.set(ws, set)
    try {
      switch (m.type) {
        case 'term.open':
          if (!shown(m.session)) pump.show(m.session)
          set.add(m.session)
          redraw(m.session)
          break
        case 'term.redraw':
          if (set.has(m.session)) redraw(m.session)
          break
        case 'term.close':
          set.delete(m.session)
          if (!shown(m.session)) pump.hide(m.session)
          break
        case 'term.key':
          if (!set.has(m.session)) {
            ws.close(1013, 'reopen terminal and replay input')
            return
          }
          if (!m.data || Buffer.byteLength(m.data) > 4096) {
            error('Terminal input must be between 1 and 4096 bytes')
            return
          }
          queue().enqueue(m, (receipt) => {
            if (sockets.has(ws) && ws.send(JSON.stringify(receipt)) === 0) {
              ws.close(1013, 'replay terminal input')
            }
          }, () => ws.close(1013, 'resynchronize terminal input'))
          break
        case 'term.resize':
          pump.resize(m.session, Math.max(40, m.cols | 0), Math.max(10, m.rows | 0))
          break
      }
    } catch (cause) {
      error(messageOf(cause))
      if (m.type === 'term.key') ws.close(1013, 'retry terminal input')
    }
  }

  // --- the locks -------------------------------------------------------------------------------

  const ownHost = (req: Request, srv: Bun.Server<undefined>) =>
    ownNames().some((name) => req.headers.get('host') === `${name}:${srv.port}`)
  const sameOrigin = (req: Request, srv: Bun.Server<undefined>) =>
    ownNames().some((name) => req.headers.get('origin') === `http://${name}:${srv.port}`)

  // --- the person's acts (POST /api/act) -------------------------------------------------------

  type Person = Extract<Author, { readonly _tag: 'Person' }>
  const asPerson = async (): Promise<Person | undefined> => {
    const name = await gitName(dir)
    return name === '' ? undefined : { _tag: 'Person', name, channel: 'ui' }
  }
  const failed = (error: unknown) => json(refusalOf(error), 400)
  // Whoever git names must be a person of this work, as at the CLI.
  const member = async (): Promise<Person | Response> => {
    const by = await asPerson()
    if (!by) return json({ error: NO_PERSON }, 400)
    const people = readState()?.config.people ?? []
    if (!people.includes(by.name)) {
      return json({ error: `${by.name} (git user.name) is not in the people of ${CONFIG}` }, 400)
    }
    return by
  }
  const workActed = async (post: WorkPost): Promise<Response> => {
    const by = await member()
    if (by instanceof Response) {
      send({ type: 'changed' })
      return by
    }
    if (isInactive(storeEvents())) return json({
      refused: 'inactive', words: ACTIVATION.inactive().message, next: ACTIVATION.inactive().next,
    }, 400)
    const forward = 'confirm' in post
      ? foldWork(storeEvents())?.forwards.find((entry) => entry.id === post.confirm)
      : undefined
    const pageBody = 'act' in post ? post.act : forward && forwardedPageBody(forward.act)
    if ((forward && !pageBody) || (pageBody && !pagePointsOk(pageBody))) {
      send({ type: 'changed' })
      return json({
        refused: 'legal',
        words: pageBody ? 'Add at least one point.' : 'This act cannot be posted.',
      }, 400)
    }
    const success = ({ seq, again }: { seq: number; again: boolean }): ActResponse =>
      again ? { ok: true, seq, duplicate: true } : { ok: true, seq }
    const run = 'act' in post
      ? dispatchAct({
        by,
        act: {
          id: post.id ?? pageActId(pageBodyOf(post.act), post.on),
          who: { _tag: 'Human' }, ep: 0, body: pageBodyOf(post.act),
        },
        on: post.on,
        build: post.build,
        current: build,
      }).pipe(Effect.map(success))
      : 'confirm' in post
      ? confirmForward(by, post.confirm, post.build, build).pipe(Effect.map(success))
      : dropForward(by, post.drop).pipe(Effect.as({ ok: true, seq: null } as const))
    const exit = await runtime.runPromiseExit(Effect.scoped(run))
    runSync(refresh)
    send({ type: 'changed' })
    if (Exit.isSuccess(exit)) return json(exit.value)
    const error = Cause.squash(exit.cause)
    const c16 = Schema.decodeUnknownOption(RefusalSchema)(error)
    if (c16._tag === 'Some') return json(c16.value, 400)
    if (error instanceof Refusal) {
      return json({ error: error.message, next: error.choice.words }, 400)
    }
    return failed(error)
  }

  // --- onboarding (POST /api/onboarding): each act writes the files and stores nothing -------

  // The acts of the two pages, as the person of git user.name. After the store starts, a change is
  // an adjustment (ruling 14), as work onboard says.
  const onboardingAct = async (act: OnboardingAct): Promise<Response> => {
    const name = await gitName(dir)
    if (name === '') return json({ error: NO_PERSON }, 400)
    if (isInactive(storeEvents())) return failed(ACTIVATION.inactive())
    if (readState()) {
      const over =
        'the store of this dir has started, so onboarding is over; a change now is an adjustment'
      return json({ error: over }, 400)
    }
    if (act.act === 'approve-all-directions' && act.reviewed === undefined) {
      return json({ error: 'Send the reviewed revisions before accepting the directions.' }, 400)
    }
    if (act.act === 'approve-all-roles') {
      return json({ error: 'approve the instruction manifest before starting' }, 400)
    }
    const exit = await runtime.runPromiseExit(Effect.scoped(Effect.gen(function* () {
      yield* activationLock(dir)
      yield* gate(yield* activationEvents(dir))
      const made = yield* personAct(dir, name, act)
      return onboardingWords(act, made, yield* readOnboarding(dir))
    })))
    runSync(refresh)
    return Exit.isSuccess(exit) ? json({ out: exit.value }) : failed(Cause.squash(exit.cause))
  }
  // The candidate belongs to the served project and the person who previewed it.
  let staffingCandidate: { owner: string; revision: string; staffing: Staffing; ticket: string } | undefined
  const staffingRequest = async (req: Request, srv: Bun.Server<undefined>) => {
    const write = req.method === 'POST'
    if (write && !sameOrigin(req, srv)) return json({ error: 'an act comes only from this page' }, 403)
    const name = await gitName(dir)
    if (name === '') return json({ error: NO_PERSON }, 400)
    try {
      const input = write ? Schema.decodeUnknownSync(StaffingPost)(await req.json()) : null
      return await runtime.runPromise(Effect.scoped(Effect.gen(function* () {
        if (input !== null) yield* activationLock(dir)
        if (readActivationRecord(dir) !== null || (yield* activationEvents(dir)).length !== 0) {
          return json({ error: 'Staffing review ends when activation begins.' }, 400)
        }
        const files = yield* readOnboarding(dir)
        if (!files.config?.people.includes(name)) return json({ error: 'Only a person of this project can review its staffing.' }, 403)
        if (input === null) return answer(StaffingState, yield* readStaffingReview(dir, name))
        if (files.roles.length === 0 || files.roleRequests?.length ||
          files.directions.some(({ stage }) => stage._tag !== 'Accepted' && stage._tag !== 'Removed') ||
          files.roles.some(({ decision, questions }) => decision._tag !== 'Accepted' || questions?.length)) {
          return json({ error: 'Accept the directions and roles before confirming staffing.' }, 400)
        }
        if (input.action === 'preview') {
          const { preview, after } = yield* previewStaffingReview(dir, input.revision, input.edit)
          const ticket = crypto.randomUUID()
          staffingCandidate = { owner: name, revision: input.revision, staffing: after, ticket }
          return answer(StaffingPreview, { ...preview, ticket })
        }
        const candidate = staffingCandidate
        if (candidate?.owner !== name || candidate.ticket !== input.ticket) {
          return json({ error: 'Preview staffing before applying it.' }, 400)
        }
        yield* applyStaffingReview(dir, name, candidate.revision, candidate.staffing)
        staffingCandidate = undefined
        send({ type: 'changed' })
        return answer(StaffingState, yield* readStaffingReview(dir, name))
      })))
    } catch (error) {
      return failed(error)
    }
  }
  const postOnboarding = async (req: Request, srv: Bun.Server<undefined>) => {
    if (!sameOrigin(req, srv)) {
      return json({ error: 'an act comes only from the page of this server' }, 403)
    }
    let decoded: OnboardingAct
    try {
      decoded = Schema.decodeUnknownSync(OnboardingAct)(await req.json())
    } catch (error) {
      return json({ error: messageOf(error) }, 400)
    }
    const res = await onboardingAct(decoded).catch(failed)
    send({ type: 'changed' })
    return res
  }

  const act = async (b: PageAct): Promise<Response> => {
    switch (b.act) {
      case 'settings':
        runSync(writeSettings(dir, b.settings))
        send({ type: 'changed' })
        return json({ out: 'the settings are saved.' })
    }
  }
  const postAct = async (req: Request, srv: Bun.Server<undefined>) => {
    if (!sameOrigin(req, srv)) {
      return json({ error: 'an act comes only from the page of this server' }, 403)
    }
    const body: unknown = await req.json()
    const work = workPostOf(body)
    if (work) return workActed(work)
    if (isRecord(body) && isRecord(body.act) &&
      (body.act._tag === 'MoveHost' || body.act._tag === 'Revive')) {
      const by = await member()
      if (by instanceof Response) return by
      send({ type: 'changed' })
      return json({ refused: 'terminal', words: 'Run work run continue in a terminal.' }, 400)
    }
    const name = isRecord(body) ? body.act : undefined
    if (!ACTS.some((a) => a === name)) return json({ error: `there is no act "${name}"` }, 400)
    let decoded: PageAct
    try {
      decoded = Schema.decodeUnknownSync(PageAct)(body)
    } catch (error) {
      return json({ error: messageOf(error) }, 400)
    }
    // A failed act is an error in the answer of the page, whatever way it failed.
    const res = await act(decoded).catch(failed)
    send({ type: 'changed' })
    return res
  }

  // --- the reads (GET /api/...) ----------------------------------------------------------------

  const api = async (path: string): Promise<Response | undefined> => {
    // The person reads no derived state, so it derives nothing (a derive with its readings costs
    // about 35 ms on a store of 2,000 events).
    if (path === '/api/person') {
      const work = readState()
      if (!work) return json({ error: `no work store in ${dir}` }, 404)
      return answer(PersonView, personView(work.config.people, await gitName(dir)))
    }
    if (path === '/api/activation/approval') {
      return answer(MarkerApproval, await runtime.runPromise(markerApproval(dir)))
    }
    if (path === '/api/dash') {
      const dash = dashNow()
      return dash === undefined
        ? json({ error: `no work store in ${dir}` }, 404)
        : answer(Dash, dash)
    }
    if (path === '/api/dir') {
      const view = dirView(readState() !== undefined, {
        name: basename(dir),
        path: dir,
        settings: context().settings,
        onboarding: runSync(onboardingExists(dir)),
        hasConfig: existsSync(join(dir, CONFIG)),
        startPrompt: startPrompt(dir),
        status: readStatus(env, dir),
        now: Date.parse(clock()),
        picks: picksNow(),
      })
      return answer(DirView, view)
    }
    // One view before and after the store: the onboarding files, then the store (the gear). A
    // file that does not read is the page's error, with its words.
    if (path === '/api/onboarding') {
      const d = readDerived()
      if (d) return answer(OnboardingView, onboardingStoreView(d, context()))
      try {
        const files = runSync(readOnboarding(dir))
        return answer(OnboardingView, onboardingFilesView(files, context().settings, dir))
      } catch (error) {
        return json({ error: messageOf(error) }, 400)
      }
    }
    return undefined
  }

  const server = Bun.serve<undefined>({
    hostname: '0.0.0.0',
    port,
    async fetch(req, srv) {
      const url = new URL(req.url)
      if (!ownHost(req, srv)) {
        return new Response('Open the address that work start printed.\n', { status: 403 })
      }
      // A running server says which dir it serves, so that a second `work start` finds it.
      if (url.pathname === '/health') return json({ dir })
      if (url.pathname === '/ws') {
        if (!sameOrigin(req, srv)) {
          return new Response('A websocket comes only from the page of this server.\n', {
            status: 403,
          })
        }
        return srv.upgrade(req) ? undefined : new Response('Not a websocket.\n', { status: 400 })
      }
      // No other page may frame this one (a frame could trick a click).
      const frameless = {
        'content-security-policy': "frame-ancestors 'none'",
        'x-frame-options': 'DENY',
      }
      // A file of the page, gzipped when the browser takes it (the page script: 380 KB, or
      // 120 KB gzipped, over the Wi-Fi of a phone).
      const pageFile = (body: string | Uint8Array<ArrayBuffer>, type: string) => {
        const gzip = /\bgzip\b/.test(req.headers.get('accept-encoding') ?? '')
        return new Response(gzip ? Bun.gzipSync(body) : body, {
          headers: {
            'content-type': type,
            vary: 'accept-encoding',
            ...(gzip ? { 'content-encoding': 'gzip' } : {}),
            ...frameless,
          },
        })
      }
      if (url.pathname === '/app.js') {
        try {
          return pageFile(await pageBundle(), 'text/javascript')
        } catch (error) {
          return new Response(`${messageOf(error)}\n`, { status: 500 })
        }
      }
      // A place of the page (/, /h1, /h1/t1) is the page, which reads its own path, so
      // a reload or a bookmark opens the same place (Nanda, 2026-11-15).
      const place = req.method === 'GET' && PAGE_PATH.test(url.pathname)
      const file = PAGE_FILES[place ? '/' : url.pathname]
      if (file) return pageFile(await Bun.file(join(ROOT, file[0])).bytes(), file[1])
      if (url.pathname === '/api/act' && req.method === 'POST') {
        try {
          return await postAct(req, srv)
        } catch (error) {
          return json({ error: messageOf(error) }, 500)
        }
      }
      if (url.pathname === '/api/staffing' && (req.method === 'GET' || req.method === 'POST')) {
        return staffingRequest(req, srv)
      }
      if (url.pathname === '/api/activation' && req.method === 'POST') {
        if (!sameOrigin(req, srv)) return json({ error: 'an act comes only from this page' }, 403)
        try {
          const input = Schema.decodeUnknownSync(ActivationPost)(await req.json())
          const name = await gitName(dir)
          if (name === '') return json({ error: NO_PERSON }, 400)
          const by = { _tag: 'Person' as const, name, channel: 'ui' as const }
          const task = Effect.gen(function* () {
            if (input.action === 'start') {
              yield* prepareActivation(dir, by, input.entries, (files) => startRefusal(startStateOf(files)), true)
            }
            return yield* runActivation(dir, by, input.action === 'start' ? 'resume' : input.action)
          })
          const out = await runtime.runPromise(task.pipe(Effect.provideService(GitUser, { name: Effect.succeed(name) })))
          send({ type: 'changed' })
          return json({ out })
        } catch (error) {
          return failed(error)
        }
      }
      if (url.pathname === '/api/onboarding' && req.method === 'POST') {
        try {
          return await postOnboarding(req, srv)
        } catch (error) {
          return json({ error: messageOf(error) }, 500)
        }
      }
      if (url.pathname.startsWith('/api/')) {
        try {
          const own = await extend.api?.(req, url, { readState, send })
          if (own) return own
          const res = (await api(url.pathname)) ?? json({ error: 'no such address' }, 404)
          return gzipped(req, res)
        } catch (error) {
          return json({ error: messageOf(error) }, 500)
        }
      }
      return new Response('Not found.\n', { status: 404 })
    },
    websocket: {
      open(ws) {
        sockets.add(ws)
        ws.send(JSON.stringify({ type: 'hello', build }))
        try {
          const text = dashText()
          if (text !== undefined) ws.send(text)
        } catch {
          // as pushDash
        }
        extend.open?.(ws)
      },
      message(ws, text) {
        let m: unknown
        try {
          m = JSON.parse(String(text))
        } catch {
          return
        }
        const type = isRecord(m) ? m.type : undefined
        if (String(type).startsWith('term.')) {
          const decoded = Schema.decodeUnknownOption(PageMessage)(m)
          if (decoded._tag === 'Some') terminalMessage(ws, decoded.value)
          return
        }
        extend.message?.(ws, m, { send })
      },
      close(ws) {
        sockets.delete(ws)
        const sessions = watching.get(ws) ?? []
        watching.delete(ws)
        for (const session of sessions) if (!shown(session)) pump?.hide(session)
        extend.close?.(ws)
      },
    },
  })

  // A new act of another process: the store file changes. One refresh 25 ms after the first
  // change groups the writes of one commit (the file and its log), and a later change asks for
  // another; a wait that each change put off again held a page 150 ms after the last write of a
  // command. A check every few seconds catches a change that the watch missed. A refresh that
  // finds a new seq sets the cache, and its changes send `changed`.
  const db = dbPath(env)
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = () => {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      try {
        runSync(refresh)
      } catch {
        // A damaged store shows on the next read of the page, with its words.
      }
    }, 25)
  }
  const fileWatch = existsSync(dirname(db))
    ? watch(dirname(db), (_event, name) => {
        if (name?.startsWith(basename(db))) check()
      })
    : undefined
  // The onboarding files change in other processes too (the host's work onboard): a watch of the
  // dir sees aristoteles.draft.yaml, and a watch of .work/assess/ its files while the folder is
  // there (the host makes it; the store start deletes it). The check every 3 seconds arms the
  // watch of a new folder and compares the names and times of the files, for a missed change.
  let assessWatch: FSWatcher | undefined
  let onboardTimer: ReturnType<typeof setTimeout> | undefined
  const onboardingChanged = () => {
    if (onboardTimer !== undefined) return
    onboardTimer = setTimeout(() => {
      onboardTimer = undefined
      send({ type: 'changed' })
    }, 25)
  }
  const assess = join(dir, ASSESS)
  const armAssess = () => {
    if (assessWatch !== undefined || !existsSync(assess)) return
    try {
      assessWatch = watch(assess, onboardingChanged)
      assessWatch.on('error', () => {
        assessWatch?.close()
        assessWatch = undefined
      })
    } catch {
      assessWatch = undefined
    }
  }
  const dirWatch = watch(dir, (_event, name) => {
    if (name !== DRAFT && name !== '.work') return
    armAssess()
    onboardingChanged()
  })
  dirWatch.on('error', () => dirWatch.close())
  // The names, times and sizes of the files; the store start may delete the folder meanwhile.
  const onboardingStamp = (): string => {
    try {
      const names = existsSync(assess) ? readdirSync(assess).map((n) => join(assess, n)) : []
      return [join(dir, DRAFT), join(dir, '.work/onboarding/activation/record.json'), ...names]
        .filter((path) => existsSync(path))
        .map((path) => `${path} ${statSync(path).mtimeMs} ${statSync(path).size}`)
        .join('\n')
    } catch {
      return ''
    }
  }
  // The status of the AI (P8: the toast) is a file of another process too.
  const stamp = () => `${onboardingStamp()}\n${statusStamp(env, dir)}`
  let seen = stamp()
  armAssess()
  const poll = setInterval(() => {
    check()
    void runtime.runPromiseExit(checkManagedHost())
    armAssess()
    const now = stamp()
    if (now !== seen) onboardingChanged()
    seen = now
    pushDash()
  }, 3000)

  const ownPort = server.port ?? 0
  const stop = () => {
    watcher?.stop()
    clearInterval(drain)
    clearInterval(retryBindings)
    marks?.close()
    if (pump) {
      pump.onOutputs = pump.onOutputs.filter((fn) => fn !== onOutput)
      pump.onSizes = pump.onSizes.filter((fn) => fn !== onSize)
      pump.onAttach = pump.onAttach.filter((fn) => fn !== onAttach)
    }
    clearInterval(poll)
    clearInterval(rebuild)
    clearTimeout(timer)
    clearTimeout(onboardTimer)
    fileWatch?.close()
    dirWatch.close()
    assessWatch?.close()
    void server.stop(true)
    void runtime.dispose()
  }
  // P8 (live 2026-11-16): a server of an old build decodes a newer store with its old schemas
  // and calls it damaged. When the build changes, it frees its port, lets its requests end
  // (30 s at most), stops, and restarts on the new code.
  let restarting = false
  const rebuild =
    restart === undefined
      ? undefined
      : setInterval(() => {
          if (restarting || readBuild() === build) return
          restarting = true
          void (async () => {
            void server.stop(false)
            for (let w = 0; server.pendingRequests > 0 && w < 30000; w += 50) await Bun.sleep(50)
            stop()
            await restart(ownPort)
          })()
        }, buildMs)

  return {
    port: ownPort,
    url: `http://127.0.0.1:${ownPort}/`,
    send,
    readState,
    stop,
  }
}
