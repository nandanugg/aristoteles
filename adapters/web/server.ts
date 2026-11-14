// startServer (frozen; package P9): the page of a dir, one on 127.0.0.1 only. A terminal in the
// browser can run any command, and any web page in the same browser can reach a port of this
// machine, so every request needs the key that `work start` puts in the address: the first visit
// turns it into a cookie that the browser sends only to this page (SameSite=Strict), and a
// websocket also needs the page's own origin.
//
// The server holds the WorkCache (a SubscriptionRef of the folded Work, renewed from the store,
// which other processes write) and sends `changed` on each value of its changes. A read derives
// the Work and renders the views of view.ts; a person's act dispatches its action as the person
// of git user.name (acts.ts) or goes to the watcher (the terminals).
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { Cause, Effect, Exit, Layer, ManagedRuntime, Schema, Stream, SubscriptionRef } from 'effect'
import { dispatch } from '../../core/actions/index.ts'
import { type Derived, derive } from '../../core/derived/index.ts'
import { type Author, StoreDamaged, type Time, type Work } from '../../core/schema/index.ts'
import {
  CONFIG,
  DRAFT,
  dbPath,
  Dir,
  Env,
  FilesLive,
  mergeDraft,
  Now,
  pathOf,
  Readings,
  readSettings,
  SpawnLive,
  StoreLive,
  Tokens,
  writeSettings,
} from '../../core/services/index.ts'
import { momentOf, WorkCache, workCacheLayer } from '../../core/state/index.ts'
import { readingsLive } from '../live/readings.ts'
import { tokenSecret } from '../live/tokens.ts'
import { withBriefMeasure } from '../words/index.ts'
import { type ActionAct, callOf, wordsOf } from './acts.ts'
import { PAGE_FILES, pageBundle } from './bundle.ts'
import {
  ACTS,
  DiffView,
  DirView,
  PageAct,
  PageMessage,
  ProjectView,
  PersonView,
  RolesDraft,
  TaskPanel,
} from './contract.ts'
import type { ServerHandle, ServerOptions, Watcher } from './frozen.ts'
import {
  dirView,
  fileDiff,
  personView,
  projectView,
  taskPanel,
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

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null

const messageOf = (error: unknown): string =>
  error instanceof StoreDamaged
    ? `the store is damaged at e${error.seq}: ${error.issue}`
    : error instanceof Error
      ? error.message
      : String(error)

// The words that the person pastes into the AI CLI that they use, in the dir. That session is
// the host (Nanda, 2026-11-13): it sets up a new dir, starts the page, and starts or continues
// a project.
const startPrompt = (dir: string) =>
  `Use aristoteles in the folder ${dir}: read ` +
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

const NO_PERSON = 'the page acts as the person of git user.name; set it: git config user.name <you>'

export function startServer(options: ServerOptions): ServerHandle {
  const {
    dir,
    env = process.env,
    port = 0,
    key = randomBytes(24).toString('hex'),
    clock = () => new Date().toISOString(),
    extend = {},
    pump,
    watcher,
  } = options

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
    // The readings of the outside, with the terminals of the pump and the measure of a brief
    // (ruling 10.9, as the CLI measures it).
    Layer.effect(
      Readings,
      Readings.useSync((base) => ({
        read: (work: Work, at: Time) =>
          Effect.map(base.read(work, at), (o) => withBriefMeasure(o, at)),
      })),
    ).pipe(
      Layer.provide(readingsLive({ terminals: () => pump?.status() ?? {} })),
      Layer.provide(dirLayer),
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
  // The terminals of a read are those that its derive read (one `tmux list-panes`, not two).
  const context = (d: Derived | undefined, person: string): ViewContext => ({
    dir,
    settings: runSync(readSettings(dir)),
    terminals: d?.moment.outside.terminals ?? pump?.status() ?? {},
    person,
  })

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
        Stream.runForEach(() => Effect.sync(() => send({ type: 'changed' }))),
      )
    }),
  )
  // The terminals (part 5): a tab subscribes to the sessions that it shows; the pump's output
  // and each size that tmux reports go to each tab that shows its session.
  const watching = new Map<Bun.ServerWebSocket<undefined>, Set<string>>()
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
  const toWatchers = (session: string, message: unknown) => {
    const text = JSON.stringify(message)
    for (const [ws, set] of watching) if (set.has(session)) ws.send(text)
  }
  const shown = (session: string) => [...watching.values()].some((set) => set.has(session))
  if (pump) {
    pump.onOutputs = [
      ...pump.onOutputs,
      (session, bytes) => toWatchers(session, { type: 'term.data', session, data: b64(bytes) }),
    ]
    pump.onSizes = [
      ...pump.onSizes,
      (session, size) => toWatchers(session, { type: 'term.size', session, ...size }),
    ]
  }
  const terminalMessage = (ws: Bun.ServerWebSocket<undefined>, m: typeof PageMessage.Type) => {
    if (!pump) {
      const error = 'tmux is not on this machine'
      ws.send(JSON.stringify({ type: 'term.error', session: m.session, error }))
      return
    }
    const set = watching.get(ws) ?? new Set<string>()
    watching.set(ws, set)
    try {
      switch (m.type) {
        case 'term.open': {
          // The first tab that shows a terminal starts its stream; the size goes before the
          // first bytes, so that they draw at the pane's own width.
          if (!shown(m.session)) pump.show(m.session)
          set.add(m.session)
          const size = pump.size(m.session)
          if (size) ws.send(JSON.stringify({ type: 'term.size', session: m.session, ...size }))
          ws.send(
            JSON.stringify({
              type: 'term.data',
              session: m.session,
              data: b64(pump.snapshot(m.session)),
              reset: true,
            }),
          )
          break
        }
        case 'term.close':
          set.delete(m.session)
          if (!shown(m.session)) pump.hide(m.session)
          break
        case 'term.input':
          pump.input(m.session, m.data)
          break
        case 'term.resize':
          pump.resize(m.session, Math.max(40, m.cols | 0), Math.max(10, m.rows | 0))
          break
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'term.error', session: m.session, error: messageOf(error) }))
    }
  }

  // --- the key ---------------------------------------------------------------------------------

  // A cookie does not depend on the port, so each server has its own cookie name.
  const cookieName = (srv: Bun.Server<undefined>) => `aristoteles-${srv.port}`
  const hasKey = (req: Request, srv: Bun.Server<undefined>) =>
    (req.headers.get('cookie') ?? '')
      .split(';')
      .some((c) => c.trim() === `${cookieName(srv)}=${key}`)
  const sameOrigin = (req: Request, srv: Bun.Server<undefined>) =>
    [`http://127.0.0.1:${srv.port}`, `http://localhost:${srv.port}`].includes(
      req.headers.get('origin') ?? '',
    )

  // --- the person's acts (POST /api/act) -------------------------------------------------------

  type Person = Extract<Author, { readonly _tag: 'Person' }>
  const asPerson = async (): Promise<Person | undefined> => {
    const name = await gitName(dir)
    return name === '' ? undefined : { _tag: 'Person', name, channel: 'ui' }
  }
  // One action in one store write; then the cache renews.
  const dispatched = async (call: Parameters<typeof dispatch>[0]) => {
    const exit = await runtime.runPromiseExit(Effect.scoped(dispatch(call)))
    runSync(refresh)
    if (Exit.isSuccess(exit)) return exit.value
    throw new Error(messageOf(Cause.squash(exit.cause)))
  }
  const failed = (error: unknown) => json({ error: messageOf(error) }, 400)
  const actAs = async (act: ActionAct): Promise<Response> => {
    const by = await asPerson()
    if (!by) return json({ error: NO_PERSON }, 400)
    // Whoever git names must be a person of this work, as at the CLI.
    const people = readState()?.config.people ?? []
    if (!people.includes(by.name)) {
      return json({ error: `${by.name} (git user.name) is not in the people of ${CONFIG}` }, 400)
    }
    try {
      const done = await dispatched(callOf(act, by))
      return json({ out: wordsOf(act, done.created) })
    } catch (error) {
      return failed(error)
    }
  }

  // The first start of a dir: the person accepts the people and the roles that assess drafted.
  const acceptRoles = async (): Promise<Response> => {
    const by = await asPerson()
    if (!by) return json({ error: NO_PERSON }, 400)
    const draft = join(dir, DRAFT)
    if (!existsSync(draft)) return json({ error: `there is no ${DRAFT}` }, 400)
    const config = join(dir, CONFIG)
    const settings = existsSync(config) ? readFileSync(config, 'utf8') : ''
    // work config check reads the same merge, so the host checks its draft before this click.
    let merged: string
    try {
      merged = mergeDraft(settings, readFileSync(draft, 'utf8'))
    } catch (error) {
      return json({ error: `${DRAFT}: ${messageOf(error)}` }, 400)
    }
    writeFileSync(config, merged)
    try {
      const done = await dispatched({
        by,
        input: { _tag: 'DefineWorkflow', target: {}, content: {} },
      })
      rmSync(draft)
      const { project, roles } = done.work.config
      return json({
        out:
          `store made for ${project} in aristoteles: ${Object.keys(roles).length} roles, ` +
          'and no direction yet.',
      })
    } catch (error) {
      // A refused define leaves the file as it was: a second click does not add the roles twice.
      writeFileSync(config, settings)
      return failed(error)
    }
  }

  // The watcher runs the acts of the terminals; without tmux there is none.
  const terminals = (use: (w: Watcher) => Promise<Response>) =>
    watcher ? use(watcher) : json({ error: 'the terminals need tmux' }, 400)
  const act = async (b: PageAct): Promise<Response> => {
    switch (b.act) {
      case 'open':
        return terminals(async (w) => json({ out: await w.open(b.draft) }))
      case 'close':
        return terminals(async (w) => {
          await w.close(b.run, b.reason || 'closed by the person in the UI')
          return json({ out: `${b.run} is closed.` })
        })
      case 'stop':
        return terminals(async (w) => {
          await w.stopSession(b.session)
          return json({ out: `${b.session} stopped.` })
        })
      case 'resume':
        return terminals(async (w) => {
          await w.resumeSession(b.session, b.tier)
          return json({ out: `${b.session} resumed.` })
        })
      // Fixed: the UI tries the problem at once (the decision of 2026-11-11); the watcher holds
      // the words of the try.
      case 'fixed':
        return terminals(async (w) => json({ out: await w.fixed(b.problem) }))
      case 'accept-draft':
      case 'reject-draft':
      case 'confirm':
      case 'end':
      case 'reject-task':
      case 'accept-words':
      case 'reject-words':
        return actAs(b)
      case 'settings':
        runSync(writeSettings(dir, b.settings))
        send({ type: 'changed' })
        return json({ out: 'the settings are saved.' })
      case 'accept-roles':
        return acceptRoles()
    }
  }
  const postAct = async (req: Request, srv: Bun.Server<undefined>) => {
    if (!sameOrigin(req, srv)) {
      return json({ error: 'an act comes only from the page of this server' }, 403)
    }
    const body: unknown = await req.json()
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

  const api = async (path: string, url: URL): Promise<Response | undefined> => {
    // The person and the draft of the roles read no derived state, so they derive nothing (a
    // derive with its readings costs about 35 ms on a store of 2,000 events).
    if (path === '/api/roles-draft') {
      if (!readState()) return json({ error: `no work store in ${dir}` }, 404)
      const draft = join(dir, DRAFT)
      return answer(RolesDraft, { text: existsSync(draft) ? readFileSync(draft, 'utf8') : null })
    }
    if (path === '/api/person') {
      const work = readState()
      if (!work) return json({ error: `no work store in ${dir}` }, 404)
      return answer(PersonView, personView(work.config.people, await gitName(dir)))
    }
    // The git process of the person's name runs while the request derives.
    const [d, person] = await Promise.all([Promise.resolve().then(readDerived), gitName(dir)])
    const ctx = context(d, person)
    if (path === '/api/dir') {
      const view = dirView(
        d,
        {
          name: basename(dir),
          path: dir,
          settings: ctx.settings,
          rolesDraft: existsSync(join(dir, DRAFT)),
          hasConfig: existsSync(join(dir, CONFIG)),
          startPrompt: startPrompt(dir),
        },
        ctx,
      )
      return answer(DirView, view)
    }
    if (!d) return json({ error: `no work store in ${dir}` }, 404)
    let m = path.match(/^\/api\/project\/([a-z]+\d+)$/)
    if (m) {
      const view = projectView(d, m[1] as string, ctx)
      return view ? answer(ProjectView, view) : json({ error: `no project ${m[1]}` }, 404)
    }
    m = path.match(/^\/api\/task\/(t\d+)$/)
    if (m) {
      const panel = taskPanel(d, m[1] as string, ctx)
      return panel ? answer(TaskPanel, panel) : json({ error: `no task ${m[1]}` }, 404)
    }
    m = path.match(/^\/api\/diff\/(t\d+)$/)
    if (m) {
      const file = url.searchParams.get('file')
      return answer(DiffView, {
        file,
        diff: fileDiff(d, m[1] as string, file ?? '', ctx) ?? '',
      })
    }
    return undefined
  }

  const server = Bun.serve<undefined>({
    hostname: '127.0.0.1',
    port,
    async fetch(req, srv) {
      const url = new URL(req.url)
      // A running server says which dir it serves, so that a second `work start` finds it.
      if (url.pathname === '/health') return json({ dir })
      if (url.pathname === '/' && url.searchParams.get('key') === key) {
        return new Response(null, {
          status: 302,
          headers: {
            location: '/',
            'set-cookie': `${cookieName(srv)}=${key}; HttpOnly; SameSite=Strict; Path=/`,
          },
        })
      }
      if (!hasKey(req, srv)) {
        return new Response('Open the address that work start printed.\n', { status: 403 })
      }
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
      const file = PAGE_FILES[url.pathname]
      if (file) return pageFile(await Bun.file(join(ROOT, file[0])).bytes(), file[1])
      if (url.pathname === '/api/act' && req.method === 'POST') {
        try {
          return await postAct(req, srv)
        } catch (error) {
          return json({ error: messageOf(error) }, 500)
        }
      }
      if (url.pathname.startsWith('/api/')) {
        try {
          const own = await extend.api?.(req, url, { readState, send })
          if (own) return own
          return (await api(url.pathname, url)) ?? json({ error: 'no such address' }, 404)
        } catch (error) {
          return json({ error: messageOf(error) }, 500)
        }
      }
      return new Response('Not found.\n', { status: 404 })
    },
    websocket: {
      open(ws) {
        sockets.add(ws)
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
  const poll = setInterval(check, 3000)

  return {
    port: server.port ?? 0,
    key,
    url: `http://127.0.0.1:${server.port}/?key=${key}`,
    send,
    readState,
    stop() {
      watcher?.stop()
      clearInterval(poll)
      clearTimeout(timer)
      fileWatch?.close()
      void server.stop(true)
      void runtime.dispose()
    },
  }
}
