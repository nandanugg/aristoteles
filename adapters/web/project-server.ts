import { join } from 'node:path'
import { Effect, Exit, Schema } from 'effect'
import { Authority } from '../../core/actions/project.ts'
import { readOpenProject } from '../../core/actions/staff-session.ts'
import { runTaskCommands } from '../../core/effects/project-commands.ts'
import { ReadPosition, Refusal, Rationale, TaskKey, refuse } from '../../core/schema/project.ts'
import { withProjectEnv } from '../../core/services/project.ts'
import { openProjectJournal, PROJECT_FORMAT } from '../../core/services/project.ts'
import { activationOwner, liveProjectBootstrap, projectActivationOperations, projectDirectoryAt, resumeProjectActivation } from '../live/activation.ts'
import { projectRuns } from '../live/project-runs.ts'
import { liveTaskCommands } from '../live/task-commands.ts'
import { projectActivationApproval, projectCommandStatus, projectEvents, projectSnapshot, projectSubmission } from './project.ts'

const html = `<!doctype html>
<html lang="en" data-theme="light">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Project · aristoteles</title><link rel="stylesheet" href="/style.css"></head>
<body><header><h1>Project</h1></header><p role="status" aria-live="polite"></p><main></main><script type="module" src="/app.js"></script></body>
</html>`

const failure = (refusal: Refusal) => Response.json(Schema.encodeSync(Refusal)(refusal), {
  status: refusal.code === 'WrongActor' || refusal.code === 'RetiredSession' ? 403 :
    refusal.code === 'Stale' || refusal.code === 'WrongMove' ? 409 : 400,
})
const invalid = () => failure(refuse('InvalidInput', Rationale.make('Use a checked project request.')))
const unavailable = () => failure(refuse('Unavailable', Rationale.make('The project server could not complete that operation.')))
const ownerName = (dir: string) => Effect.sync(() => {
  const git = Bun.spawnSync(['git', 'config', 'user.name'], { cwd: dir })
  return git.exitCode === 0 ? git.stdout.toString().trim() : ''
})

export const startProjectServer = async (dir: string, vars: Readonly<Record<string, string | undefined>>, port: number) => {
  const key = projectDirectoryAt(dir)
  const provideEnv = withProjectEnv(vars)
  const run = <A, E>(effect: Effect.Effect<A, E, Effect.Services<ReturnType<typeof openProjectJournal>>>) =>
    Effect.runPromiseExit(Effect.scoped(provideEnv(effect)))
  const entry = await run(Effect.flatMap(openProjectJournal(key, 'Read'), readOpenProject))
  if (Exit.isFailure(entry)) {
    const options = await Effect.runPromise(Effect.scoped(openProjectJournal(key, 'Read').pipe(
      provideEnv, Effect.result,
    )))
    throw new Error(options._tag === 'Failure' ? options.failure.why : 'Open the project first with work onboard open.')
  }
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, 'app', 'project-main.ts')], target: 'browser' })
  const script = built.outputs[0]
  if (!built.success || !script) throw new Error('Could not build the Project page.')
  const db = vars.ARISTOTELES_DB
  const commands = liveTaskCommands(dir)
  const launch = Effect.scoped(Effect.gen(function* () {
    const journal = yield* openProjectJournal(key, 'Write')
    yield* resumeProjectActivation(journal, projectActivationOperations(dir, journal, liveProjectBootstrap(dir, db, key)), 'resume')
  }))
  const reviews = Effect.scoped(Effect.flatMap(openProjectJournal(key, 'Write'), (journal) => projectRuns(dir, db, journal).review))
  const watched = Effect.gen(function* () {
    const journal = yield* openProjectJournal(key, 'Write')
    const project = yield* readOpenProject(journal)
    const operations = projectRuns(dir, db, journal)
    for (const session of project.sessions.values()) {
      if (session._tag !== 'Ended') yield* Effect.result(operations.sessions.observe(session.key))
    }
    yield* Effect.result(operations.review)
  })
  const server = Bun.serve({
    hostname: '127.0.0.1', port,
    async fetch(request, serving) {
      const url = new URL(request.url)
      if (url.origin !== serving.url.origin) return invalid()
      switch (url.pathname) {
        case '/health': return Response.json({ dir, format: PROJECT_FORMAT })
        case '/': return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
        case '/app.js': return new Response(script, { headers: { 'content-type': 'text/javascript; charset=utf-8' } })
        case '/style.css':
          return new Response(Bun.file(join(import.meta.dir, 'app', url.pathname.slice(1))), { headers: { 'content-type': 'text/css' } })
      }
      if (!url.pathname.startsWith('/api/project/')) return new Response(null, { status: 404 })
      const write = request.method === 'POST' && url.pathname === '/api/project/submissions'
      if (write ? request.headers.get('origin') !== serving.url.origin : request.method !== 'GET') return invalid()
      const task = Effect.gen(function* () {
        const journal = yield* openProjectJournal(key, write ? 'Write' : 'Read')
        const actor = Effect.flatMap(ownerName(dir), (name) => activationOwner(journal, name))
        const provide = Effect.provideService(Authority, { actor })
        yield* actor
        switch (url.pathname) {
          case '/api/project/snapshot': return yield* projectSnapshot(journal)
          case '/api/project/events': {
            const text = url.searchParams.get('after')
            const after = Number(text)
            if (text === null || !/^\d+$/u.test(text) || !Schema.is(ReadPosition)(after)) return invalid()
            return yield* projectEvents(journal, after)
          }
          case '/api/project/activation-files': return yield* projectActivationApproval(journal, dir).pipe(provide)
          case '/api/project/command-status': {
            const key = url.searchParams.get('task')
            return Schema.is(TaskKey)(key) ? yield* projectCommandStatus(journal, key, commands).pipe(provide) : invalid()
          }
          case '/api/project/submissions':
            if (!write) return invalid()
            return yield* projectSubmission(journal, request,
              reviews.pipe(provideEnv), launch.pipe(provideEnv),
              (taskKey) => Effect.scoped(Effect.flatMap(openProjectJournal(key, 'Write'), (current) => runTaskCommands(current, taskKey, commands)))
                .pipe(provideEnv)).pipe(provide)
          default: return new Response(null, { status: 404 })
        }
      }).pipe(Effect.catch((error) => Effect.succeed(failure(error))))
      const result = await run(task)
      return Exit.isSuccess(result) ? result.value : unavailable()
    },
  })
  let checking = false
  const timer = setInterval(async () => {
    if (checking) return
    checking = true
    try { await run(watched) } finally { checking = false }
  }, 250)
  return {
    url: server.url,
    stop: () => { clearInterval(timer); server.stop(true) },
  }
}
