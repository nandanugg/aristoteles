// The server of the UI (`work start`, PORT of ui/server.js): one for each dir, on 127.0.0.1 only.
// A terminal in the browser can run any command, and any web page in the same browser can reach a
// port of this machine, so every request needs the key that `work start` puts in the address: the
// first visit turns it into a cookie that the browser sends only to this page (SameSite=Strict),
// and a websocket also needs the page's own origin.
//
// The server reads the store with the replay (cached while the event count stays) and the views
// of src/ui/view.ts; the JSON goes through the Schemas of src/ui/contract.ts. It writes nothing
// itself but the settings and the roles of the dir: the person's acts go through the CLI on the
// ui channel (src/ui/act.ts) or through a method of the watcher (the terminals).
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { Effect, Layer, Schema } from 'effect'
import { CONFIG, DRAFT } from '../config/core.ts'
import { mergeDraft, readSettings, writeSettings } from '../config/settings.ts'
import type { Time } from '../domain/ids.ts'
import type { Work } from '../domain/work.ts'
import { replay } from '../replay/replay.ts'
import { Env } from '../services/io.ts'
import { FilesLive, SpawnLive } from '../services/outside.ts'
import { Store } from '../services/store.ts'
import { dbPath } from '../store/path.ts'
import { StoreLive } from '../store/sqlite.ts'
import { type ActOutcome, personAct } from './act.ts'
import { pageBundle, PAGE_FILES } from './bundle.ts'
import {
  ACTS,
  DiffView,
  DirView,
  PageAct,
  PageMessage,
  ProjectView,
  RolesDraft,
  TaskPanel,
} from './contract.ts'
import type { Pump } from './pump.ts'
import { dirView, fileDiff, projectView, taskPanel, type ViewContext } from './view.ts'
import type { Watcher } from './watcher.ts'

const ROOT = resolve(import.meta.dir, '..', '..')

export interface ServerOptions {
  readonly dir: string
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly port?: number
  readonly key?: string
  // The time of the reads (the tests give the fake clock of the harness).
  readonly clock?: () => string
  // Extra API and websocket handlers (work start passes none today).
  readonly extend?: {
    readonly api?: (req: Request, url: URL, tools: ServerTools) => Promise<Response | undefined>
    readonly open?: (ws: unknown) => void
    readonly message?: (ws: unknown, message: unknown, tools: Pick<ServerTools, 'send'>) => void
    readonly close?: (ws: unknown) => void
  }
  readonly pump?: Pump
  readonly watcher?: Watcher
}

export interface ServerTools {
  readonly readState: () => Work | undefined
  readonly send: (message: unknown) => void
}

export interface ServerHandle extends ServerTools {
  readonly port: number
  readonly key: string
  readonly url: string
  readonly stop: () => void
}

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
  error instanceof Error ? error.message : String(error)

// The start of aristoteles in a dir: the person pastes these words into the AI CLI that they use,
// in the dir. That session is the host (Nanda, 2026-11-13): it sets up a new dir (it knows its own
// commands, so it writes the tiers of the draft), starts the page, and starts or continues a
// project.
const startPrompt = (dir: string) =>
  `Use aristoteles in the folder ${dir}: read ` +
  `${join(ROOT, 'skills', 'aristoteles', 'SKILL.md')} and do what it says; you are the host. ` +
  `When work is not on the PATH, use bun ${join(ROOT, 'bin', 'work.js')} in its place.`

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

  // --- the store -------------------------------------------------------------------------------

  const services = Layer.mergeAll(
    FilesLive,
    SpawnLive,
    StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env }))),
  )
  // The replay is kept while the store has the same acts; a new act replays again.
  let cache: { readonly count: number; readonly work: Work } | undefined
  const readWork = Effect.scoped(
    Effect.gen(function* () {
      const store = yield* Store
      const opened = yield* store.open(dir, { create: false })
      const events = yield* opened.events
      if (cache === undefined || cache.count !== events.length) {
        cache = { count: events.length, work: yield* replay(events) }
      }
      return cache.work
    }),
  ).pipe(
    // A dir with no store yet is not an error: the sidebar says so.
    Effect.catchTag('Refused', (e) =>
      /^no work store/.test(e.message) ? Effect.succeed(undefined) : Effect.fail(e),
    ),
  )
  // Runs an Effect to the end; an expected failure becomes an Error with its words.
  const runSync = <A>(
    effect: Effect.Effect<
      A,
      { readonly message: string } | { readonly seq: number; readonly issue: string },
      Layer.Success<typeof services>
    >,
  ): A => {
    const done = Effect.runSync(
      effect.pipe(
        Effect.provide(services),
        Effect.match({
          onFailure: (e) => ({ failed: e }),
          onSuccess: (value) => ({ value }),
        }),
      ),
    )
    if ('failed' in done) {
      const e = done.failed
      throw new Error('message' in e ? e.message : `the store is damaged at e${e.seq}: ${e.issue}`)
    }
    return done.value
  }
  const readState = (): Work | undefined => runSync(readWork)
  const settingsNow = () => runSync(readSettings(dir))
  const context = (): ViewContext => ({
    at: clock() as Time,
    dir,
    settings: settingsNow(),
    terminals: pump?.status() ?? {},
  })

  // --- the websocket and the terminals ---------------------------------------------------------

  const sockets = new Set<Bun.ServerWebSocket<undefined>>()
  const send = (message: unknown) => {
    const text = JSON.stringify(message)
    for (const ws of sockets) ws.send(text)
  }
  // The terminals (part 5): a tab subscribes to the sessions that it shows; the pump's output
  // goes to each tab that shows its session.
  const watching = new Map<Bun.ServerWebSocket<undefined>, Set<string>>()
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
  if (pump) {
    pump.onOutputs = [
      ...(pump.onOutputs ?? []),
      (session, bytes) => {
        const text = JSON.stringify({ type: 'term.data', session, data: b64(bytes) })
        for (const [ws, set] of watching) if (set.has(session)) ws.send(text)
      },
    ]
  }
  const terminalMessage = (
    ws: Bun.ServerWebSocket<undefined>,
    m: typeof PageMessage.Type,
  ) => {
    if (!pump) {
      ws.send(
        JSON.stringify({
          type: 'term.error',
          session: m.session,
          error: 'tmux is not on this machine',
        }),
      )
      return
    }
    const set = watching.get(ws) ?? new Set<string>()
    watching.set(ws, set)
    try {
      switch (m.type) {
        case 'term.open':
          set.add(m.session)
          ws.send(
            JSON.stringify({
              type: 'term.data',
              session: m.session,
              data: b64(pump.snapshot(m.session)),
              reset: true,
            }),
          )
          break
        case 'term.close':
          set.delete(m.session)
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

  const run = (argv: ReadonlyArray<string>, opts?: { readonly typed?: string }) =>
    personAct(dir, env, argv, opts)
  const done = (r: ActOutcome) =>
    r.code ? json({ error: r.err.replace(/^refused: /, '') }, 400) : json({ out: r.out })

  // The first start of a dir: the person accepts the people and the roles that assess drafted.
  const acceptRoles = async (): Promise<Response> => {
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
    const r = await run(['init'])
    // A refused init leaves the file as it was, so a second click does not add the roles twice.
    if (r.code) {
      writeFileSync(config, settings)
      return done(r)
    }
    rmSync(draft)
    return json({ out: r.out })
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
      // Fixed: the UI tries the problem at once (the decision of 2026-11-11); with no terminals,
      // the person's word ends it.
      case 'fixed':
        return watcher
          ? json({ out: await watcher.fixed(b.problem) })
          : done(await run(['problem', b.problem, '--fixed']))
      // The person's accept of a draft needs no evidence; their comment is optional.
      case 'accept-draft':
        return done(
          await run(
            [
              'review',
              b.draft,
              'accept',
              ...(b.comment?.trim() ? [`--reason=${b.comment}`] : []),
            ],
            { typed: 'accept' },
          ),
        )
      case 'reject-draft':
        return done(await run(['review', b.draft, 'reject', `--reason=${b.reason}`]))
      case 'confirm':
        return done(await run(['confirm', b.forward], { typed: 'confirm' }))
      case 'end':
        return done(await run(['run', 'done', b.run]))
      case 'reject-task':
        return done(await run(['review', b.task, 'reject', `--reason=${b.reason}`]))
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
    const res = await act(decoded)
    send({ type: 'changed' })
    return res
  }

  // --- the reads (GET /api/...) ----------------------------------------------------------------

  const api = (path: string, url: URL): Response | undefined => {
    const work = readState()
    const ctx = context()
    if (path === '/api/dir') {
      return answer(
        DirView,
        dirView(
          work,
          {
            name: basename(dir),
            path: dir,
            settings: ctx.settings,
            rolesDraft: existsSync(join(dir, DRAFT)),
            hasConfig: existsSync(join(dir, CONFIG)),
            startPrompt: startPrompt(dir),
          },
          ctx,
        ),
      )
    }
    if (!work) return json({ error: `no work store in ${dir}` }, 404)
    let m = path.match(/^\/api\/project\/([a-z]+\d+)$/)
    if (m) {
      const view = projectView(work, m[1] as string, ctx)
      return view ? answer(ProjectView, view) : json({ error: `no project ${m[1]}` }, 404)
    }
    m = path.match(/^\/api\/task\/(t\d+)$/)
    if (m) {
      const panel = taskPanel(work, m[1] as string, ctx)
      return panel ? answer(TaskPanel, panel) : json({ error: `no task ${m[1]}` }, 404)
    }
    if (path === '/api/roles-draft') {
      const draft = join(dir, DRAFT)
      return answer(RolesDraft, { text: existsSync(draft) ? readFileSync(draft, 'utf8') : null })
    }
    m = path.match(/^\/api\/diff\/(t\d+)$/)
    if (m) {
      const file = url.searchParams.get('file')
      return answer(DiffView, {
        file,
        diff: fileDiff(work, m[1] as string, file ?? '', ctx) ?? '',
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
      if (url.pathname === '/app.js') {
        try {
          return new Response(await pageBundle(), {
            headers: { 'content-type': 'text/javascript', ...frameless },
          })
        } catch (error) {
          return new Response(`${messageOf(error)}\n`, { status: 500 })
        }
      }
      const file = PAGE_FILES[url.pathname]
      if (file) {
        return new Response(readFileSync(join(ROOT, file[0])), {
          headers: { 'content-type': file[1], ...frameless },
        })
      }
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
          return api(url.pathname, url) ?? json({ error: 'no such address' }, 404)
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
        watching.delete(ws)
        extend.close?.(ws)
      },
    },
  })

  // A new act: the store file changes. A short wait groups the writes of one command; a check
  // every few seconds catches a change that the watch missed.
  const db = dbPath(env)
  let last = readState()?.events.length ?? 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const now = readState()?.events.length ?? 0
      if (now !== last) {
        last = now
        send({ type: 'changed' })
      }
    }, 150)
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
    },
  }
}
