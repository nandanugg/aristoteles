import { expect, test } from 'bun:test'
import { chromium } from 'playwright'
import { dirname, join, resolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { projectActivationOperations } from '../../adapters/live/activation.ts'
import { approvedText, fakeBootstrap, hostKey } from '../../src/store/project-activation.probe.ts'
import { Deferred, Effect, Result, Schedule, Schema } from 'effect'
import { launchNextReview, type Reviews } from '../../adapters/live/proposal.ts'
import { projectActivationApproval, projectEvents, projectSnapshot, projectSubmission } from '../../adapters/web/project.ts'
import { openPageProject, receiveProjectPayload } from '../../adapters/web/app/project-state.ts'
import { ownerProposals } from '../derived/project/review.ts'
import { startSession, create, open, session, staff, startFixtureSession, withJournal } from '../../src/store/project.probe.ts'
import { initialStaffing, sharedStaffing } from '../../src/store/staff-session.probe.ts'
import { cliProposal, direction, evidence } from '../../src/store/proposal.probe.ts'
import { ownerAuthority, staffAuthorityOf } from '../../src/store/question.probe.ts'
import { boundHostSession, FileContents, ProposalValue, Rule, proposalReviewDirection, quoteIn, staffByKey, staffedIn, Projection, ProposalKey, ReadPosition, StaffingPlan, StaffSessionKey, SubagentCount, Summary, type Project, type Submission } from '../schema/project.ts'
import { readPosition } from '../state/project.ts'
import { Authority, type AuthenticatedActor } from './project.ts'
import { observeSession, readOpenProject } from './staff-session.ts'

const first = { line: 'Proposal', key: ProposalKey.make('proposal:first') } as const
const auth = (actor: AuthenticatedActor) => Effect.provideService(Authority, { actor: Effect.succeed(actor) })
const choose = (line = first, choice: 'accept' | 'remove' = 'accept') =>
  ({ ...line, move: choice, input: {} })
const missing = (code: string) => ({ _tag: 'Failure', failure: { code } })
const ask = (key = first.key) => ({ line: 'Proposal', key, move: 'open', input: { previous: { _tag: 'None' }, value: direction } })
const send = (line = first) => ({ ...line, move: 'submit', input: { value: direction } })

test('every built-in proposal rule quotes its shipped skill and requires both example outcomes', () => {
  const { rules } = proposalReviewDirection
  expect([rules.Direction.length, rules.Responsibility.length, rules.Staffing.length]).toEqual([9, 3, 2])
  expect(Schema.is(ProposalValue)(proposalReviewDirection)).toBe(false)
  for (const rule of Object.values(rules).flat()) {
    if (rule.verification._tag !== 'Prompt') throw new Error('Expected a built-in prompt rule')
    const { source } = rule.verification
    const contents = FileContents.make(readFileSync(resolve(import.meta.dir, '../..', source.file), 'utf8'))
    expect(quoteIn(source, contents)).toBe('Found')
    expect(Schema.is(Rule)({ ...rule, examples: { ...rule.examples, holds: [] } })).toBe(false)
    expect(Schema.is(Rule)({ ...rule, examples: { ...rule.examples, breaks: [] } })).toBe(false)
  }
})

test('proposal queue launches the host’s fresh child and retains the reviewed version at acceptance', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const opened = yield* create(journal, [], { ...staff, subagents: SubagentCount.make(1) })
    const live = yield* startFixtureSession(journal, opened.state)
    const drafted = yield* cliProposal(journal, live.state, ask(), staffAuthorityOf())
    const submitted = yield* cliProposal(journal, drafted.state, send(), staffAuthorityOf())
    const other = { line: 'Proposal', key: ProposalKey.make('proposal:other') } as const
    const otherDraft = yield* cliProposal(journal, submitted.state, ask(other.key), staffAuthorityOf())
    const queued = yield* cliProposal(journal, otherDraft.state, send(other), staffAuthorityOf())
    expect(ownerProposals(queued.state)).toEqual([])
    expect(yield* Effect.result(cliProposal(journal, queued.state, choose()))).toMatchObject(missing('WrongMove'))
    const launched: Extract<AuthenticatedActor, { _tag: 'Review' }>[] = []
    const provider: Reviews = {
      reconcile: () => Effect.void,
      open: (proposal, session, review) => Effect.sync(() => { launched.push({ _tag: 'Review', session, line: 'Proposal', key: proposal.key, queuedIn: review }) }),
    }
    const launch = launchNextReview(dirname(path), journal, provider)
    const assignment = yield* launch
    if (!assignment) throw new Error('Review was not started')
    expect(assignment.event).toMatchObject(first)
    expect(launched[0]?.session.staff.key).toBe(staff.key)
    expect(yield* launch).toBeNull()
    expect(launched).toHaveLength(1)
    const run = launched[0]!
    const report = { ...first, move: 'review', input: { facts: evidence('Holds') } }
    expect(yield* Effect.result(cliProposal(journal, assignment.state, report, staffAuthorityOf()))).toMatchObject(missing('WrongActor'))
    const reviewed = yield* cliProposal(journal, assignment.state, report, run)
    expect(ownerProposals(reviewed.state).map(({ key }) => key)).toEqual([first.key])
    expect(yield* Effect.result(cliProposal(journal, submitted.state, choose()))).toMatchObject(missing('Stale'))
    const committed = yield* cliProposal(journal, reviewed.state, choose())
    expect(committed.state.proposals.get(first.key)?.phase).toMatchObject({
      _tag: 'Accepted', version: { value: direction, number: 1 },
    })
    const reopened = yield* open(path, 'Read')
    expect((yield* readOpenProject(reopened)).proposals.get(first.key)).toEqual(committed.state.proposals.get(first.key))
    expect((yield* launch)?.event).toMatchObject(other)
  }))),
))

test('proposal findings have evidence from the pending draft', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const opened = yield* create(journal)
    const live = yield* startFixtureSession(journal, opened.state)
    const drafted = yield* cliProposal(journal, live.state, ask())
    const submitted = yield* cliProposal(journal, drafted.state, send())
    const child = yield* launchNextReview(dirname(path), journal, { reconcile: () => Effect.void, open: () => Effect.void })
    if (!child) throw new Error('Missing assignment')
    const phase = child.state.proposals.get(first.key)?.phase
    if (phase?._tag !== 'Reviewing' || phase.assignment._tag !== 'Assigned') throw new Error('Missing fresh child')
    const actor = { _tag: 'Review', session, ...first, queuedIn: phase.assignment.queuedIn } as const
    const report = (evidence: unknown) => cliProposal(journal, child.state, {
      ...first, move: 'review', input: { facts: {
        ...evidenceForDraft, findings: [{ text: 'Explain this direction.', evidence }],
      } },
    }, actor)
    const evidenceForDraft = evidence('Holds')
    expect(yield* Effect.result(report(undefined))).toMatchObject(missing('InvalidInput'))
    const quote = { _tag: 'Quote', file: 'proposal.json', lines: { first: 2, last: 2 }, text: '"_tag": "Direction"' }
    expect(yield* Effect.result(report({ ...quote, text: 'missing' }))).toMatchObject(missing('InvalidEvidence'))
    const [firstOutcome, ...otherOutcomes] = evidenceForDraft.outcomes
    if (!firstOutcome) throw new Error('Direction has built-in rules')
    const reportOutcomes = (outcomes: readonly object[]) => cliProposal(journal, child.state, {
      ...first, move: 'review', input: { facts: { outcomes, findings: [] } },
    }, actor)
    expect(yield* Effect.result(reportOutcomes(otherOutcomes))).toMatchObject(missing('InvalidEvidence'))
    expect(yield* Effect.result(reportOutcomes([otherOutcomes[0]!, ...otherOutcomes]))).toMatchObject(missing('InvalidEvidence'))
    expect(yield* Effect.result(reportOutcomes(evidence('Holds', 'Staffing').outcomes))).toMatchObject(missing('InvalidEvidence'))
    expect(yield* Effect.result(reportOutcomes([
      { ...firstOutcome, evidence: { ...quote, text: 'not in draft' } }, ...otherOutcomes,
    ]))).toMatchObject(missing('InvalidEvidence'))
    expect(yield* journal.eventsAfter(child.state.read)).toEqual([])
    const returned = yield* report(quote)
    expect(returned.state.proposals.get(first.key)?.phase).toMatchObject({ _tag: 'Drafting', feedback: {
      _tag: 'Review', facts: { findings: [{ evidence: quote }] },
    } })
    expect(submitted.event.move).toBe('submit')
  }))),
))

test('departure retires the old child and releases the first proposal back into journal order', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const opened = yield* create(journal)
    const live = yield* startFixtureSession(journal, opened.state)
    const drafted = yield* cliProposal(journal, live.state, ask())
    yield* cliProposal(journal, drafted.state, send())
    let child: Extract<AuthenticatedActor, { _tag: 'Review' }> | null = null
    const provider: Reviews = { reconcile: () => Effect.void, open: (proposal, session, review) => Effect.sync(() => { child = { _tag: 'Review', session, line: 'Proposal', key: proposal.key, queuedIn: review } }) }
    const launch = launchNextReview(dirname(path), journal, provider)
    const old = yield* launch
    const oldRun = child as Extract<AuthenticatedActor, { _tag: 'Review' }> | null
    if (!old || !oldRun) throw new Error('Missing first review')
    const ended = yield* observeSession(journal, old.state, session.key, 'Ended')
    expect(ended.state.proposals.get(first.key)?.phase).toMatchObject({ _tag: 'Reviewing', assignment: { _tag: 'Waiting' } })
    const nextKey = StaffSessionKey.make('session:replacement')
    yield* startSession(journal, ended.state, { key: nextKey, staff: staff.key, pane: session.pane, staffedIn: staffedIn(ended.state) })
    const replacement = yield* launch
    const run = child as Extract<AuthenticatedActor, { _tag: 'Review' }> | null
    if (!replacement || !run) throw new Error('Missing replacement review')
    expect(run.queuedIn).not.toBe(oldRun.queuedIn)
    const facts = { ...first, move: 'review', input: { facts: evidence('Holds') } }
    expect(yield* Effect.result(cliProposal(journal, replacement.state, facts, oldRun)))
      .toMatchObject(missing('RetiredSession'))
    const returned = yield* cliProposal(journal, replacement.state, { ...facts, input: { facts: evidence('Breaks') } },
      run)
    expect(returned.state.proposals.get(first.key)?.phase._tag).toBe('Drafting')
    const revised = { ...direction, summary: Summary.make('Show the revised evidence') }
    const resubmitted = yield* cliProposal(journal, returned.state, { ...send(), input: { value: revised } })
    expect(resubmitted.state.proposals.get(first.key)?.value).toEqual(revised)
    expect(ownerProposals(resubmitted.state)).toEqual([])
  }))),
))

test('only the owner changes a responsibility, which takes effect after review and acceptance', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const staffed = yield* sharedStaffing(journal)
    const live = yield* startFixtureSession(journal, staffed)
    const previous = live.state.roles.host.responsibility
    const value = { _tag: 'Responsibility', ...previous.value, role: live.state.roles.host, summary: Summary.make('New owner wording') }
    expect(yield* Effect.result(cliProposal(journal, live.state, { ...ask(), input: { value, previous: { _tag: 'None' } } }, staffAuthorityOf())))
      .toMatchObject(missing('WrongActor'))
    const draft = yield* cliProposal(journal, live.state, { ...ask(), input: { value, previous: { _tag: 'None' } } })
    yield* cliProposal(journal, draft.state, { ...send(), input: { value } })
    const child = yield* launchNextReview(dirname(path), journal, { reconcile: () => Effect.void, open: () => Effect.void })
    if (!child) throw new Error('Missing review')
    const proposal = child.state.proposals.get(first.key)
    if (proposal?.phase._tag !== 'Reviewing' || proposal.phase.assignment._tag !== 'Assigned') throw new Error('No assigned child')
    const reviewed = yield* cliProposal(journal, child.state, { ...first, move: 'review', input: { facts: evidence('Holds', 'Responsibility') } },
      { _tag: 'Review', session, ...first, queuedIn: proposal.phase.assignment.queuedIn })
    expect(reviewed.state.roles.host.responsibility).toEqual(previous)
    const accepted = yield* cliProposal(journal, reviewed.state, choose())
    expect(accepted.state.roles.host.responsibility.value.summary).toBe(value.summary)
    expect(Number(accepted.state.roles.host.responsibility.number)).toBe(2)
    expect(accepted.state.staffing).toEqual(staffed.staffing)
    expect(staffByKey(accepted.state, staff.key)?.roles).toContainEqual({ key: accepted.state.roles.host.key })
    expect(accepted.state.sessions.get(session.key)?.staff.roles).toContainEqual({ key: live.state.roles.host.key })
    const projected = Schema.encodeSync(Projection)(accepted.state)
    expect(projected).not.toHaveProperty('staff')
    expect(projected).not.toHaveProperty('subscriptions')
  }))),
))

test('the page receives the committed review assignment dispatched by a submission', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    const timings: number[] = []
    let launching = 0
    let ready = 0
    let submitted = 0
    let committed = 0
    const childReady = yield* Deferred.make<void>()
    const token = 'provider-private-token'
    const provider: Reviews = { reconcile: () => Effect.void, open: () => Effect.gen(function* () {
      launching = performance.now()
      yield* Effect.sleep('25 millis')
      void token
      ready = performance.now()
      yield* Deferred.succeed(childReady, undefined)
    }) }
    const launch = launchNextReview(dirname(path), journal, provider)
    const catchUp = () => Effect.gen(function* () {
      const response = yield* projectEvents(journal, readPosition(page.current()))
      const text = yield* Effect.promise(() => response.text())
      expect(text.includes(token)).toBe(false)
      return Result.getOrThrow(receiveProjectPayload(page, JSON.parse(text)))
    })
    const seen = (start: number) => Effect.gen(function* () {
      const state = yield* catchUp()
      timings.push(performance.now() - start)
      return state
    })
    const openStart = performance.now()
    const opened = yield* create(journal)
    yield* seen(openStart)
    const liveStart = performance.now()
    const live = yield* startFixtureSession(journal, opened.state)
    yield* seen(liveStart)
    const draftStart = performance.now()
    const drafted = yield* cliProposal(journal, live.state, ask())
    yield* seen(draftStart)
    const body: Submission = { read: drafted.state.read, ...first, move: 'submit', input: { value: direction } }
    submitted = performance.now()
    const response = yield* projectSubmission(journal, new Request('http://localhost/project', {
      method: 'POST', body: JSON.stringify(body),
    }), Effect.andThen(Effect.sync(() => { committed = performance.now() }), launch)).pipe(auth(ownerAuthority))
    expect(response.status).toBe(200)
    Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => response.json())))
    timings.push(performance.now() - submitted)
    yield* Deferred.await(childReady).pipe(Effect.timeout('1 second'))
    const assigned = yield* Effect.gen(function* () {
      const current = yield* catchUp()
      const phase = current?.proposals.get(first.key)?.phase
      return phase?._tag === 'Reviewing' && phase.assignment._tag === 'Assigned'
        ? current : yield* Effect.fail('AssignmentPending' as const)
    }).pipe(Effect.retry({ times: 50, schedule: Schedule.spaced('10 millis') }))
    timings.push(performance.now() - ready)
    const proposal = assigned?.proposals.get(first.key)
    if (!assigned || proposal?.phase._tag !== 'Reviewing' || proposal.phase.assignment._tag !== 'Assigned') throw new Error('Missing assignment')
    const reportStart = performance.now()
    const reviewed = yield* cliProposal(journal, assigned, { ...first, move: 'review', input: { facts: evidence('Holds') } },
      { _tag: 'Review', session, ...first, queuedIn: proposal.phase.assignment.queuedIn })
    yield* seen(reportStart)
    const acceptStart = performance.now()
    yield* cliProposal(journal, reviewed.state, choose())
    yield* seen(acceptStart)
    const max = Math.max(...timings)
    const dispatch = launching - committed
    const startup = ready - launching
    expect(max).toBeLessThan(1000)
    expect(dispatch).toBeGreaterThanOrEqual(0)
    expect(dispatch).toBeLessThan(100)
    expect(startup).toBeGreaterThanOrEqual(20)
    console.log(`Proposal feedback: max page ${max.toFixed(1)} ms, submit-to-launch ${(launching - submitted).toFixed(1)} ms, commit-to-launch ${dispatch.toFixed(1)} ms, test child startup ${startup.toFixed(1)} ms`)
  }))),
))

test('the browser moves from the reviewed direction to work under its bound host', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const directory = dirname(path)
    writeFileSync(join(directory, 'AGENTS.md'), approvedText)
    const staffed = yield* sharedStaffing(journal)
    const live = yield* startFixtureSession(journal, staffed)
    const bootstrap = fakeBootstrap()
    const activate = projectActivationOperations(directory, journal, bootstrap.provider)
    const host = hostKey(1)
    const runActivation = Effect.gen(function* () {
      yield* activate.mark
      yield* activate.reserve(host)
      yield* activate.spawn
      yield* activate.acknowledge(host, bootstrap.nonces.get(host)!)
      })
    const drafted = yield* cliProposal(journal, live.state, ask(), staffAuthorityOf())
    yield* cliProposal(journal, drafted.state, send(), staffAuthorityOf())
    const provider: Reviews = { reconcile: () => Effect.void, open: () => Effect.void }
    const launch = launchNextReview(dirname(path), journal, provider)
    const assigned = yield* launch
    const phase = assigned?.state.proposals.get(first.key)?.phase
    if (!assigned || phase?._tag !== 'Reviewing' || phase.assignment._tag !== 'Assigned') throw new Error('Missing review')
    const built = yield* Effect.promise(() => Bun.build({
      entrypoints: [resolve(import.meta.dir, '../../test/browser/project-onboarding.page.ts')], target: 'browser',
    }))
    if (!built.success || !built.outputs[0]) throw new Error('Could not bundle the project page')
    const script = built.outputs[0]
    const server = yield* Effect.acquireRelease(Effect.sync(() => Bun.serve({
      hostname: '127.0.0.1', port: 0,
      fetch: (request) => {
        const url = new URL(request.url)
        switch (url.pathname) {
          case '/': return new Response('<!doctype html><main></main><script type="module" src="/app.js"></script>',
            { headers: { 'content-type': 'text/html' } })
          case '/app.js': return new Response(script, { headers: { 'content-type': 'text/javascript' } })
          case '/snapshot': return Effect.runPromise(projectSnapshot(journal))
          case '/events': return Effect.runPromise(projectEvents(journal, ReadPosition.make(Number(url.searchParams.get('after')))))
          case '/submissions': return Effect.runPromise(projectSubmission(journal, request, launch, runActivation).pipe(auth(ownerAuthority)))
          case '/activation-files': return Effect.runPromise(projectActivationApproval(journal, directory).pipe(auth(ownerAuthority)))
          default: return new Response(null, { status: 404 })
        }
      },
    })), (server) => Effect.sync(() => { server.stop(true) }))
    const browser = yield* Effect.acquireRelease(Effect.promise(() => chromium.launch()), (browser) => Effect.promise(() => browser.close()))
    const page = yield* Effect.promise(() => browser.newPage())
    yield* Effect.promise(() => page.goto(server.url.href))
    const title = page.getByRole('heading', { name: direction.name })
    yield* Effect.promise(() => page.getByRole('region', { name: 'Responsibilities' }).waitFor())
    expect(yield* Effect.promise(() => title.count())).toBe(0)
    const reviewStart = performance.now()
    yield* cliProposal(journal, assigned.state, { ...first, move: 'review', input: { facts: evidence('Holds') } },
      { _tag: 'Review', session, ...first, queuedIn: phase.assignment.queuedIn })
    yield* Effect.promise(() => title.waitFor())
    const timeToReveal = performance.now() - reviewStart
    expect(yield* Effect.promise(() => page.getByText('All tests pass.', { exact: false }).count())).toBe(1)
    const acceptStart = performance.now()
    yield* Effect.promise(() => page.getByRole('button', { name: 'Accept', exact: true }).click())
    const directionCard = page.getByRole('article').filter({ has: title })
    yield* Effect.promise(() => directionCard.getByText('Accepted · version 1').waitFor())
    const timeToAccept = performance.now() - acceptStart
    expect(timeToReveal).toBeLessThan(1000)
    expect(timeToAccept).toBeLessThan(1000)
    console.log(`Project browser: review-to-card ${timeToReveal.toFixed(1)} ms, click-to-accepted ${timeToAccept.toFixed(1)} ms`)
    yield* Effect.promise(() => page.getByRole('button', { name: 'Review activation files' }).click())
    yield* Effect.promise(() => page.getByText('AGENTS.md', { exact: true }).waitFor())
    yield* Effect.promise(() => page.getByRole('button', { name: 'Approve and activate' }).click())
    yield* Effect.promise(() => page.getByRole('button', { name: 'Start work' }).click())
    yield* Effect.promise(() => page.getByText('Work is open.').waitFor())
    const afterWork = yield* readOpenProject(journal)
    expect(afterWork.phase).toMatchObject({ _tag: 'Active', work: { _tag: 'Started', startedIn: expect.any(Number) } })
    expect(boundHostSession(afterWork)?.key).toBe(host)
  }))),
), 30_000)

test('staffing stays effective while a replacement is reviewed, sent back, or removed', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = yield* sharedStaffing(journal)
    const live = yield* startFixtureSession(journal, project)
    const prior = live.state.staffing
    if (prior._tag !== 'StaffingAccepted') throw new Error('No effective staffing')
    const value = { ...Schema.encodeSync(StaffingPlan)(initialStaffing(1)), _tag: 'Staffing' }
    const draft = yield* cliProposal(journal, live.state, { ...ask(), input: { value, previous: { _tag: 'None' } } })
    expect(draft.state.staffing).toEqual(prior)
    const launch = launchNextReview(dirname(path), journal, { reconcile: () => Effect.void, open: () => Effect.void })
    const review = (draft: Project) => Effect.gen(function* () {
      yield* cliProposal(journal, draft, { ...send(), input: { value } })
      const assigned = yield* launch
      const phase = assigned?.state.proposals.get(first.key)?.phase
      if (!assigned || phase?._tag !== 'Reviewing' || phase.assignment._tag !== 'Assigned') throw new Error('Missing review')
      return yield* cliProposal(journal, assigned.state, { ...first, move: 'review', input: { facts: evidence('Holds', 'Staffing') } },
        { _tag: 'Review', session, ...first, queuedIn: phase.assignment.queuedIn })
    })
    const reviewed = yield* review(draft.state)
    expect(reviewed.state.staffing).toEqual(prior)
    const back = yield* cliProposal(journal, reviewed.state, { ...first, move: 'sendBack', input: { why: 'Explain the lower provider limit.' } })
    expect(back.state.proposals.get(first.key)?.phase._tag).toBe('Drafting')
    const again = yield* review(back.state)
    expect(yield* Effect.result(cliProposal(journal, reviewed.state, choose()))).toMatchObject(missing('Stale'))
    const removed = yield* cliProposal(journal, again.state, choose(first, 'remove'))
    expect(removed.state.proposals.get(first.key)?.phase._tag).toBe('Removed')
    expect(removed.state.staffing).toEqual(prior)
  }))),
))
