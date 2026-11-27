import { expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { Effect, Result, Schema } from 'effect'
import { projectBriefCommand, projectReportCommand, projectReviewCommand } from '../../adapters/cli/commands/project.ts'
import { waitOnProject, waitOnTaskReview } from '../../adapters/cli/commands/project.ts'
import { staffSessionOperations, type Sessions } from '../../adapters/live/staff-session.ts'
import { openPageProject, receiveProjectPayload } from '../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot, projectSubmission } from '../../adapters/web/project.ts'
import { open, session, staffInput, withJournal } from '../../src/store/project.probe.ts'
import { ownerAuthority, staffAuthorityOf } from '../../src/store/question.probe.ts'
import { artifactQuote, commandOutcomes, promptDirection, reportReview, resultInput, reviewAs, taskKey, taskLine, toWorking } from '../../src/store/task.probe.ts'
import { CommandOutcome, Direction, Rationale, RetryLimit as RetryLimitValue, refuse, StaffSessionKey, staffingAt } from '../schema/project.ts'
import { readPosition } from '../state/project.ts'
import { Authority, RetryLimit, type AuthenticatedActor } from './project.ts'
import { readOpenProject, startChild } from './staff-session.ts'
import { recordTaskCommands } from './task.ts'

const auth = (actor: AuthenticatedActor) => Effect.provideService(Authority, { actor: Effect.succeed(actor) })
const refused = (code: string) => ({ _tag: 'Failure', failure: { code } })
const rule = promptDirection.standards[0]!.rules[0]!
const report = (tag: 'Holds' | 'Breaks' = 'Holds') => ({
  outcomes: [{ _tag: tag, rule, evidence: artifactQuote }], findings: [],
})
const assigned = (journal: Parameters<typeof toWorking>[0]) => Effect.gen(function* () {
  const working = yield* toWorking(journal, promptDirection)
  const result = yield* staffInput(journal, resultInput(working.state.read))
  const entered = yield* commandOutcomes(journal, result.state.read)
  return yield* startChild(journal, entered.state, taskLine.key, session, 'Review')
})

test('review intake takes only facts from the current fresh child and gives feedback for the same attempt', () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const first = (yield* assigned(journal)).state
    const child = reviewAs(first)
    const yaml = Bun.YAML.stringify(report('Breaks'))
    const intake = (actor: AuthenticatedActor, input = yaml) =>
      projectReviewCommand(journal, taskKey, first.read, input).pipe(auth(actor))
    expect(yield* waitOnProject(journal, Effect.succeed(session.key))).toEqual({ _tag: 'Awaiting' })
    expect(yield* waitOnTaskReview(journal, Effect.succeed(child))).toMatchObject({ _tag: 'Available', for: 'Review' })
    expect(yield* Effect.result(intake(staffAuthorityOf()))).toMatchObject(refused('WrongActor'))
    expect(yield* Effect.result(intake(child, Bun.YAML.stringify({ ...report(), move: 'next' }))))
      .toMatchObject(refused('InvalidInput'))
    expect(yield* Effect.result(intake(child, Bun.YAML.stringify({ ...report(), outcomes: [] }))))
      .toMatchObject(refused('InvalidEvidence'))
    expect(yield* journal.eventsAfter(first.read)).toEqual([])
    const back = yield* intake(child)
    expect(back.event.move).toBe('back')
    expect(back.state.tasks.get(taskKey)?.phase).toMatchObject({
      _tag: 'Working', attempt: { number: 1, retryCount: 1, feedback: { _tag: 'Review', breaks: [{ evidence: artifactQuote }] } },
    })
    expect(yield* projectBriefCommand(journal, taskKey).pipe(auth(staffAuthorityOf()))).toContain('Review feedback for Readable result')
    expect(yield* waitOnProject(journal, Effect.succeed(session.key))).toMatchObject({ _tag: 'Available', for: 'Report' })
    const result = yield* staffInput(journal, resultInput(back.state.read))
    const again = yield* commandOutcomes(journal, result.state.read)
    const second = (yield* startChild(journal, again.state, taskLine.key, session, 'Review')).state
    expect(yield* Effect.result(reportReview(journal, second, 'Holds', taskLine, child)))
      .toMatchObject(refused('RetiredSession'))
    expect(yield* journal.eventsAfter(second.read)).toEqual([])
    const raised = yield* reportReview(journal, second, 'Breaks')
    expect(raised.state.tasks.get(taskKey)?.phase).toMatchObject({ _tag: 'Raised', reason: 'Misses', evidence: artifactQuote })
    expect(yield* waitOnProject(journal, Effect.succeed(session.key))).toEqual({ _tag: 'Awaiting' })
  })))))

test('a recorded command failure still returns work when every prompt holds', () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const commandRule = Schema.decodeUnknownSync(CommandOutcome)({
      _tag: 'Breaks', rule: { ...rule, verification: { _tag: 'Command', text: 'test -f artifact' } },
      evidence: { _tag: 'CommandOutput', command: { _tag: 'Command', text: 'test -f artifact' }, exit: 1, stdout: '', stderr: 'missing' },
    })
    const direction = Schema.decodeUnknownSync(Direction)({
      ...promptDirection,
      standards: promptDirection.standards.map((standard) => ({ ...standard, rules: [commandRule.rule, rule] })),
    })
    const working = yield* toWorking(journal, direction)
    const result = yield* staffInput(journal, resultInput(working.state.read))
    const entered = yield* recordTaskCommands(journal, taskLine.key, result.state.read, [commandRule])
    const child = yield* startChild(journal, entered.state, taskLine.key, session, 'Review')
    const back = yield* reportReview(journal, child.state, 'Holds')
    expect(back.state.tasks.get(taskKey)?.phase).toMatchObject({
      _tag: 'Working', attempt: { feedback: { _tag: 'Review', breaks: [commandRule] } },
    })
  })))))

for (const sample of ['known', 'changed', 'new'] as const) test('breaks in the reviewed file — ' + sample, () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const pinned = {
      ...rule, knownBreaks: sample === 'new' ? [] : [artifactQuote],
    }
    const direction = Schema.decodeUnknownSync(Direction)({
      ...promptDirection, standards: promptDirection.standards.map((standard) => ({ ...standard, rules: [pinned] })),
    })
    const working = yield* toWorking(journal, direction)
    const result = yield* staffInput(journal, { read: working.state.read, ...taskLine, move: 'next', input: {
      attempt: 1, summary: 'Result', files: [{
        path: 'artifact', image: { _tag: 'Present', contents: '7\n8' },
        changed: [{ first: sample === 'changed' ? 1 : 2, last: sample === 'changed' ? 1 : 2 }],
      }],
    } })
    const entered = yield* commandOutcomes(journal, result.state.read)
    const child = (yield* startChild(journal, entered.state, taskLine.key, session, 'Review')).state
    const facts = { outcomes: [{ _tag: 'Breaks', rule: pinned, evidence: artifactQuote }], findings: [] }
    const final = yield* projectReviewCommand(journal, taskKey, child.read, Bun.YAML.stringify(facts)).pipe(auth(reviewAs(child)))
    const phase = final.state.tasks.get(taskKey)?.phase
    if (sample === 'known') expect(phase).toMatchObject({ _tag: 'Done', outcomes: facts.outcomes })
    else expect(phase).toMatchObject({ _tag: 'Working', attempt: { feedback: { _tag: 'Review', breaks: facts.outcomes } } })
  })))))

for (const reason of ['Tries', 'NoRule'] as const) test('review may raise ' + reason + ' with checked evidence', () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = (yield* assigned(journal)).state
    const facts = { ...report('Breaks'),
      findings: reason === 'NoRule' ? [{ text: 'The material is missing context.', evidence: artifactQuote }] : [],
    }
    const result = yield* projectReviewCommand(journal, taskKey, project.read, Bun.YAML.stringify(facts))
      .pipe(auth(reviewAs(project)), Effect.provideService(RetryLimit, RetryLimitValue.make(0)))
    expect(result.state.tasks.get(taskKey)?.phase).toMatchObject({ _tag: 'Raised', reason, evidence: artifactQuote })
  })))))

for (const reason of ['WrongTask', 'TooBig'] as const) test('work raises ' + reason + ' with evidence, then stops', () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const start = (yield* toWorking(journal)).state
    const send = (input: unknown, actor = staffAuthorityOf()) =>
      projectReportCommand(journal, taskKey, start.read, Bun.YAML.stringify(input)).pipe(auth(actor))
    expect(yield* Effect.result(send({ attempt: 1, reason }))).toMatchObject(refused('InvalidInput'))
    expect(yield* Effect.result(send({ attempt: 2, reason, evidence: artifactQuote }))).toMatchObject(refused('Stale'))
    expect(yield* Effect.result(send({ attempt: 1, reason, evidence: artifactQuote },
      { _tag: 'Staff', session: { ...session, key: StaffSessionKey.make('session:retired') } }))).toMatchObject(refused('RetiredSession'))
    expect(yield* Effect.result(send({ attempt: 1, reason, evidence: artifactQuote }, ownerAuthority)))
      .toMatchObject(refused('WrongActor'))
    expect(yield* journal.eventsAfter(start.read)).toEqual([])
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    const response = yield* projectSubmission(journal, new Request('http://localhost/project/submissions', {
      method: 'POST', body: JSON.stringify({ read: start.read, ...taskLine, move: 'raise',
        input: { attempt: 1, reason, evidence: artifactQuote } }),
    })).pipe(auth(staffAuthorityOf()))
    expect(response.status).toBe(200)
    const feed = yield* projectEvents(journal, readPosition(page.current()))
    const project = Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => feed.json())))
    expect(project?.tasks.get(taskKey)?.phase).toMatchObject({ _tag: 'Raised', reason, evidence: artifactQuote })
    const words = yield* projectBriefCommand(journal, taskKey).pipe(auth(ownerAuthority))
    expect(words).toContain('Reason: ' + reason)
    expect(words).toContain('artifact:1–1 7')
    expect(yield* Effect.result(send({ attempt: 1, reason, evidence: artifactQuote }))).toMatchObject(refused('Stale'))
  })))))

test('two schedulers open only one fresh child and the waiting phase survives a provider failure', () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const other = yield* open(path)
    const working = yield* toWorking(journal, promptDirection)
    const result = yield* staffInput(journal, resultInput(working.state.read))
    const entered = (yield* commandOutcomes(journal, result.state.read)).state
    let calls = 0
    let cleaned = false
    const provider: Sessions = {
      stop: () => Effect.void,
      reconcile: () => Effect.sync(() => { if (calls === 1) cleaned = true }),
      launch: () => Effect.succeed(session.pane),
      observe: () => Effect.succeed('Running'),
      child: (_live, _line, work) => Effect.gen(function* () {
        calls++
        expect(work._tag).toBe('Review')
        if (calls === 1) return yield* Effect.fail(refuse('Unavailable', Rationale.make('The fresh child failed to open.')))
      }),
    }
    const tryChild = (store: typeof journal) => staffSessionOperations(dirname(path), store, provider)
      .child(session.key, taskLine.key, 'Review', staffingAt(entered))
    expect(yield* Effect.result(tryChild(journal))).toMatchObject(refused('Unavailable'))
    expect(cleaned).toBe(true)
    expect(yield* journal.eventsAfter(entered.read)).toEqual([])
    const contenders = yield* Effect.all([Effect.result(tryChild(journal)), Effect.result(tryChild(other))], { concurrency: 'unbounded' })
    expect(contenders.filter(Result.isSuccess)).toHaveLength(1)
    expect(calls).toBe(2)
    expect((yield* readOpenProject(journal)).tasks.get(taskKey)?.phase).toMatchObject({
      _tag: 'Reviewing', assignment: { _tag: 'Assigned', actor: { key: session.key } },
    })
  })))))
