import { expect, test } from 'bun:test'
import { chromium } from 'playwright'
import { Database } from 'bun:sqlite'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Deferred, Effect, Fiber, Result, Schema } from 'effect'
import { projectBriefCommand, projectReportCommand, projectSendCommand } from '../../adapters/cli/commands/acts.ts'
import { boundHostAuthority } from '../../adapters/live/activation.ts'
import { liveTaskCommands } from '../../adapters/live/task-commands.ts'
import { projectCommandStatus, projectEvents, projectSnapshot, projectSubmission } from '../../adapters/web/project.ts'
import { agree, readyActivation, startWork } from '../../src/store/project-activation.probe.ts'
import { create, host, open, ownerInput, session, staff, staffInput, startFixtureSession, withJournal } from '../../src/store/project.probe.ts'
import { direction } from '../../src/store/proposal.probe.ts'
import { ownerAuthority, staffAuthorityOf } from '../../src/store/question.probe.ts'
import { acceptDirection, activateTasks, boundHost, draftFor, resultInput, send, taskId, taskLine, toWorking } from '../../src/store/task.probe.ts'
import { recoverTaskCommand, runTaskCommands, taskCommandBlock } from '../effects/project-commands.ts'
import { Command, CommandOutcome, CommandText, Direction, EventNumber, Goal, ReadPosition, SessionId, StageId, TaskId, taskRole, taskRules } from '../schema/project.ts'
import { Authority, type AuthenticatedActor } from './project.ts'
import { readOpenProject } from './staff-session.ts'

const auth = (actor: AuthenticatedActor) => Effect.provideService(Authority, { actor: Effect.succeed(actor) })
const refused = (code: string) => ({ _tag: 'Failure', failure: { code } })
const hostAuth = { _tag: 'Host', staff, id: boundHost } as const
const sendDraft = (journal: Parameters<typeof projectSendCommand>[0], project: Parameters<typeof draftFor>[0], draft = draftFor(project)) =>
  projectSendCommand(journal, project.read, Bun.YAML.stringify(draft)).pipe(auth(hostAuth))
const withCommand = (text: string): Direction => Schema.decodeUnknownSync(Direction)({
  ...direction, standards: direction.standards.map((standard) => ({
    ...standard, rules: standard.rules.map((rule) => ({ ...rule, verification: { _tag: 'Command', text } })),
  })),
})
const body = (input: unknown) => new Request('http://localhost/submissions', {
  method: 'POST', body: JSON.stringify(input),
})

test('the host sends a checked stage slice only after work starts and its basis stays pinned', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const created = yield* create(journal)
    const active = yield* activateTasks(journal, created.state)
    expect(yield* Effect.result(sendDraft(journal, active))).toMatchObject(refused('WrongMove'))
    const { state: started } = yield* startWork(journal, active)
    const draft = draftFor(started)
    expect(yield* Effect.result(projectSendCommand(journal, started.read, Bun.YAML.stringify(draft)).pipe(auth(ownerAuthority))))
      .toMatchObject(refused('WrongActor'))
    expect(yield* Effect.result(projectSendCommand(journal, started.read, Bun.YAML.stringify(draft)).pipe(auth({
      ...hostAuth, id: SessionId.make('session:previous-host'),
    })))).toMatchObject(refused('RetiredSession'))
    expect(yield* Effect.result(sendDraft(journal, started, { ...draft, stages: [{ ...draft.stages[0], id: StageId.make('stage:missing') }] })))
      .toMatchObject(refused('InvalidInput'))
    expect(yield* Effect.result(sendDraft(journal, started, { ...draft, stages: [draft.stages[0], ...draft.stages] })))
      .toMatchObject(refused('InvalidInput'))
    const pipelineStage = [...started.proposals.values()].flatMap(({ phase }) =>
      phase._tag === 'Accepted' && phase.version.value._tag === 'Direction' ? phase.version.value.stages : [],
    ).find(({ role }) => role.id === started.roles.pipeline.id)!
    expect(yield* Effect.result(sendDraft(journal, started, { ...draft, stages: [draft.stages[0], pipelineStage] })))
      .toMatchObject(refused('InvalidInput'))
    const sent = yield* sendDraft(journal, started)
    expect(sent.event).toMatchObject({ line: { _tag: 'Task', id: draft.id }, from: null, move: 'open' })
    expect(sent.event.input).not.toHaveProperty('role')
    const task = sent.state.tasks.get(draft.id)!
    expect(task.direction.acceptedAt).toBe(draft.direction.acceptedAt)
    expect(taskRole(task).responsibility).toEqual(host.responsibility)
    const revised = yield* acceptDirection(journal, sent.state, {
      ...task.direction.value,
      stages: [{ ...task.stages[0], work: Goal.make('A changed assignment.') }],
    })
    expect(revised.tasks.get(draft.id)).toEqual(task)
    expect(yield* Effect.result(sendDraft(journal, revised, { ...draft, id: TaskId.make('task:new') })))
      .toMatchObject(refused('Stale'))
    const before = yield* readOpenProject(journal)
    const words = yield* projectBriefCommand(journal, taskId).pipe(auth(hostAuth))
    expect(words).toContain('Phase: Sent')
    expect(words).not.toContain('A changed assignment.')
    expect((yield* readOpenProject(journal)).read).toBe(before.read)
  }))),
))

test('competing starts admit one attempt and a whole-file report uses the checked public form', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const other = yield* open(path)
    const created = yield* create(journal)
    const { state: started } = yield* startWork(journal, yield* activateTasks(journal, created.state))
    const live = yield* startFixtureSession(journal, started)
    const sent = yield* send(journal, live.state.read)
    const begin = (target: typeof journal) => projectReportCommand(target, taskId, sent.state.read, '{}')
      .pipe(auth(staffAuthorityOf()))
    const began = yield* Effect.all([Effect.result(begin(journal)), Effect.result(begin(other))], { concurrency: 'unbounded' })
    expect(began.filter(Result.isSuccess)).toHaveLength(1)
    expect(began.find(Result.isFailure)).toMatchObject(refused('Stale'))
    const project = yield* readOpenProject(other)
    expect(yield* Effect.result(staffInput(other, resultInput(project.read, 7, 2)))).toMatchObject(refused('Stale'))
    const contents = 'unchanged\nShe said "hello".\n'
    const work = { summary: 'Finished', attempt: 1,
      files: [{ path: 'notes.md', image: { _tag: 'Present', contents }, changed: [{ first: 2, last: 2 }] }] }
    const invalid = { ...work, files: [{ ...work.files[0], changed: [{ first: 2, last: 3 }] }] }
    expect(yield* Effect.result(projectReportCommand(other, taskId, project.read, Bun.YAML.stringify(invalid))
      .pipe(auth(staffAuthorityOf())))).toMatchObject(refused('InvalidInput'))
    const recorded = yield* projectReportCommand(other, taskId, project.read, Bun.YAML.stringify(work)).pipe(auth(staffAuthorityOf()))
    expect(recorded.state.tasks.get(taskId)?.phase).toMatchObject({ _tag: 'ReadyToReview', result: { files: work.files } })
    expect(yield* projectBriefCommand(other, taskId).pipe(auth(hostAuth))).toContain('Phase: ReadyToReview')
  }))),
))

test('a lost command append reuses the exact captured output from disk', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const directory = dirname(path)
    writeFileSync(join(directory, 'artifact'), '7')
    const journal = yield* open(path)
    const working = yield* toWorking(journal, withCommand("printf 'invoked\\n' >> call-count; printf 'quote: \"yes\"'; printf 'broken' >&2; exit 4"))
    const ready = yield* staffInput(journal, resultInput(working.state.read))
    const db = new Database(path)
    try {
      db.exec("CREATE TRIGGER interrupted BEFORE INSERT ON project_event BEGIN SELECT RAISE(ABORT, 'lost write'); END")
      expect(yield* Effect.result(runTaskCommands(journal, taskLine, liveTaskCommands(directory)))).toMatchObject(refused('Unavailable'))
      expect((yield* readOpenProject(journal)).tasks.get(taskId)?.phase._tag).toBe('ReadyToReview')
      db.exec('DROP TRIGGER interrupted')
      const reopened = yield* open(path)
      const reviewing = yield* runTaskCommands(reopened, taskLine, liveTaskCommands(directory))
      expect(reviewing.state.tasks.get(taskId)?.phase).toMatchObject({
        _tag: 'Reviewing', outcomes: [{ _tag: 'Breaks', evidence: { exit: 4, stdout: 'quote: "yes"', stderr: 'broken' } }],
      })
      expect(yield* journal.eventsAfter(ready.state.read)).toHaveLength(1)
      expect(readFileSync(join(directory, 'call-count'), 'utf8')).toBe('invoked\n')
    } finally { db.close() }
  }))),
))

test('interrupted execution stays blocked until the provider recovers its observed output', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const directory = dirname(path)
    writeFileSync(join(directory, 'artifact'), '7')
    const journal = yield* open(path)
    const working = yield* toWorking(journal, withCommand('printf observed'))
    const ready = yield* staffInput(journal, resultInput(working.state.read))
    const task = ready.state.tasks.get(taskId)!
    const commands = liveTaskCommands(directory)
    const running = yield* Deferred.make<void>()
    const fake = { ...commands, run: () => Effect.andThen(Deferred.succeed(running, undefined), Effect.never) }
    const fiber = yield* Effect.forkScoped(runTaskCommands(journal, taskLine, fake))
    yield* Deferred.await(running)
    const contender = yield* Effect.result(runTaskCommands(journal, taskLine, commands))
    expect(contender).toMatchObject(refused('Unavailable'))
    yield* Fiber.interrupt(fiber)
    expect(yield* taskCommandBlock(journal, taskLine, commands)).toContain('unconfirmed')
    const status = yield* projectCommandStatus(journal, taskLine, commands).pipe(auth(hostAuth))
    expect(yield* Effect.promise(() => status.json())).toContain('unconfirmed')
    expect(yield* projectBriefCommand(journal, taskId, commands).pipe(auth(hostAuth))).toContain('unconfirmed')
    expect(yield* journal.eventsAfter(ready.state.read)).toEqual([])
    const rule = taskRules(task)[0]!
    const outcome = Schema.decodeUnknownSync(CommandOutcome)({
      _tag: 'Holds', rule, evidence: {
        _tag: 'CommandOutput', command: Command.make({ _tag: 'Command', text: CommandText.make('printf observed') }),
        exit: 0, stdout: 'observed', stderr: '',
      },
    })
    if (task.phase._tag !== 'ReadyToReview') throw new Error('Missing result')
    expect(yield* Effect.result(recoverTaskCommand(journal, taskLine, EventNumber.make(1), outcome, commands)))
      .toMatchObject(refused('Stale'))
    yield* recoverTaskCommand(journal, taskLine, task.phase.result.at, outcome, commands)
    const review = yield* runTaskCommands(journal, taskLine, commands)
    expect(review.state.tasks.get(taskId)?.phase).toMatchObject({ _tag: 'Reviewing', outcomes: [outcome] })
  }))),
))

test('HTTP records a result before running its pinned command and journals a success', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const directory = dirname(path)
    writeFileSync(join(directory, 'artifact'), '7')
    const journal = yield* open(path)
    const working = yield* toWorking(journal, withCommand('cat artifact'))
    const appended = yield* Deferred.make<void>()
    const run = () => runTaskCommands(journal, taskLine, liveTaskCommands(directory)).pipe(
      Effect.tap(() => Deferred.succeed(appended, undefined)),
    )
    const response = yield* projectSubmission(journal, body(resultInput(working.state.read)), undefined, undefined, run)
      .pipe(auth(staffAuthorityOf(session)))
    expect(response.status).toBe(200)
    expect(yield* Effect.promise(() => response.json())).toEqual([expect.objectContaining({ from: 'Working', move: 'next' })])
    yield* Deferred.await(appended).pipe(Effect.timeout('5 seconds'))
    const project = yield* readOpenProject(journal)
    expect(project.tasks.get(taskId)?.phase).toMatchObject({
      _tag: 'Reviewing', outcomes: [{ _tag: 'Holds', evidence: { exit: 0, stdout: '7' } }],
    })
    expect(yield* Effect.result(ownerInput(journal, { read: project.read, line: { _tag: 'Activation', id: journal.id }, move: 'start', input: {} }))).toMatchObject(refused('WrongMove'))
  }))),
))

test('the task panel marks changed lines and shows only committed command outcomes', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const directory = dirname(path)
    const contents = 'old\nShe said "hello".\n'
    writeFileSync(join(directory, 'notes.md'), contents)
    const journal = yield* open(path)
    const working = yield* toWorking(journal, withCommand('printf tested'))
    const result = { summary: 'Recorded the notes', attempt: 1,
      files: [{ path: 'notes.md', image: { _tag: 'Present', contents }, changed: [{ first: 2, last: 2 }] }] }
    yield* projectReportCommand(journal, taskId, working.state.read, Bun.YAML.stringify(result)).pipe(auth(staffAuthorityOf()))
    const commands = liveTaskCommands(directory)
    const built = yield* Effect.promise(() => Bun.build({
      entrypoints: [resolve(import.meta.dir, '../../test/browser/project-onboarding.page.ts')], target: 'browser',
    }))
    const script = built.outputs[0]
    if (!built.success || !script) throw new Error('Could not bundle the shared task panel')
    const server = yield* Effect.acquireRelease(Effect.sync(() => Bun.serve({
      hostname: '127.0.0.1', port: 0,
      fetch: (request) => {
        const url = new URL(request.url)
        switch (url.pathname) {
          case '/': return new Response('<main></main><script type="module" src="/app.js"></script>',
            { headers: { 'content-type': 'text/html' } })
          case '/app.js': return new Response(script, { headers: { 'content-type': 'text/javascript' } })
          case '/snapshot': return Effect.runPromise(projectSnapshot(journal))
          case '/events': return Effect.runPromise(projectEvents(journal, ReadPosition.make(Number(url.searchParams.get('after')))))
          case '/command-block': {
            if (url.searchParams.get('task') !== taskId) return new Response(null, { status: 404 })
            return Effect.runPromise(projectCommandStatus(journal, taskLine, commands).pipe(auth(ownerAuthority)))
          }
          default: return new Response(null, { status: 404 })
        }
      },
    })), (server) => Effect.sync(() => { server.stop(true) }))
    const browser = yield* Effect.acquireRelease(Effect.promise(() => chromium.launch()), (browser) => Effect.promise(() => browser.close()))
    const page = yield* Effect.promise(() => browser.newPage())
    yield* Effect.promise(() => page.goto(server.url.href))
    const card = page.getByRole('article', { name: 'First work' })
    yield* Effect.promise(() => card.getByRole('status').getByText('Waiting for committed command outcomes.').waitFor())
    expect(yield* Effect.promise(() => card.getByText('Tests pass · Holds', { exact: false }).count())).toBe(0)
    yield* Effect.promise(() => card.getByText('notes.md').click())
    expect(yield* Effect.promise(() => card.locator('mark').textContent())).toBe('She said "hello".\n')
    yield* runTaskCommands(journal, taskLine, commands)
    yield* Effect.promise(() => card.getByText('Tests pass · Holds · exit 0').waitFor())
  }))),
), 30_000)

test('the first authenticated send keeps the read basis from Start work', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const fixture = yield* readyActivation(path)
    const { journal, operations } = fixture
    yield* agree(journal, fixture.project, fixture.files)
    yield* operations.mark
    yield* operations.reserve(boundHost)
    yield* operations.spawn
    const nonce = fixture.nonces.get(boundHost)!
    yield* operations.acknowledge(boundHost, nonce)
    const committed = yield* operations.commit
    const credential = yield* operations.collect(boundHost, nonce)
    const { state: started } = yield* startWork(journal, committed.state)
    const sent = yield* projectSendCommand(journal, started.read, Bun.YAML.stringify(draftFor(started)))
      .pipe(Effect.provideService(Authority, { actor: boundHostAuthority(operations, boundHost, credential) }))
    expect(sent.state.activation).toMatchObject({ work: { _tag: 'Used', at: started.read } })
    expect(sent.state.tasks.get(taskId)?.phase._tag).toBe('Sent')
    expect(yield* Effect.result(operations.collect(boundHost, nonce))).toMatchObject(refused('RetiredSession'))
  }))),
))
