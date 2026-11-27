import { expect, test } from 'bun:test'
import { dirname, join, resolve } from 'node:path'
import { Effect, Result } from 'effect'
import { launchNextReview, type Reviews } from '../../../../adapters/live/proposal.ts'
import { openPageProject, receiveProjectPayload } from '../../../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot } from '../../../../adapters/web/project.ts'
import { startSession, create, open, session, staff, startFixtureSession, withJournal } from '../../../../src/store/project.probe.ts'
import { cliProposal, direction, evidence } from '../../../../src/store/proposal.probe.ts'
import { ownerAuthority, staffAuthorityOf } from '../../../../src/store/question.probe.ts'
import { observeSession, readOpenProject } from '../../../actions/staff-session.ts'
import { ownerProposals } from '../review.ts'
import { staffingAt, EventNumber, ProposalKey, StaffSessionKey, type Of, type LiveSession } from '../../../schema/project.ts'
import { readPosition } from '../../../state/project.ts'
import { readTrace, registeredChecks } from './driver.ts'
import { replayOnboardingReview } from './proposal.ts'

const check = 'onboardingReview'
const kinds = ['success', 'fault', 'mutant'] as const
const fixtures = join(import.meta.dir, 'traces')
const key = ProposalKey.make('proposal:document')
const line = { _tag: 'Proposal', key } as const
const second = { ...session, key: StaffSessionKey.make('session:2') }

test('onboarding review is registered with all three witness fixtures', () => {
  expect(registeredChecks(resolve(import.meta.dir, '../../../..'))).toContain(check)
  expect(new Set(kinds.map((kind) => readTrace(join(fixtures, check + '-' + kind + '.itf.json.gz'), check, kind).modelRevision)).size).toBe(1)
})

for (const kind of kinds) test('onboarding review — ' + kind, () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const opened = yield* create(journal)
    const live = yield* startFixtureSession(journal, opened.state)
    yield* cliProposal(journal, live.state, { line: { _tag: 'Proposal', key: key }, move: 'open', input: { previous: { _tag: 'None' }, value: direction } }, staffAuthorityOf())
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    const trace = readTrace(join(fixtures, check + '-' + kind + '.itf.json.gz'), check, kind)
    const runs = new Map<number, { session: LiveSession; review: Of<typeof EventNumber> }>()
    const observed = new Map<Of<typeof EventNumber>, number>()
    let lifetime = 1
    const project = () => Effect.runPromise(readOpenProject(journal))
    const provider: Reviews = { reconcile: () => Effect.void, open: () => Effect.void }
    const launch = launchNextReview(dirname(path), journal, provider)
    yield* Effect.promise(() => replayOnboardingReview(trace, kind, {
      submit: async () => {
        const view = await project()
        await Effect.runPromise(cliProposal(journal, view, { line, move: 'submit', input: { value: direction } },
          staffAuthorityOf(lifetime === 1 ? session : second)))
      },
      launch: async (expected) => {
        const assigned = await Effect.runPromise(launch)
        const phase = assigned?.state.proposals.get(key)?.phase
        if (!assigned || phase?._tag !== 'Reviewing' || phase.assignment._tag !== 'Assigned') throw new Error('Missing fresh review')
        const current = assigned.state.sessions.get(expected === 1 ? session.key : second.key)
        if (current?._tag !== 'Live') throw new Error('Missing live review session')
        runs.set(expected + 1, { session: current, review: phase.assignment.review })
        observed.set(phase.assignment.review, expected + 1)
      },
      exit: async () => {
        await Effect.runPromise(observeSession(journal, await project(), { _tag: 'Session', key: session.key }, 'Ended'))
      },
      recover: async () => {
        const view = await project()
        await Effect.runPromise(startSession(journal, view, { key: second.key, staff: staff.key, pane: second.pane, staffing: staffingAt(view) }))
        lifetime = 2
      },
      report: async (source, child, holds) => {
        const view = await project()
        const entry = runs.get(child) ?? { session: source === 1 ? session : second, review: EventNumber.make(1) }
        const outcome = await Effect.runPromise(Effect.result(cliProposal(journal, view, { line, move: 'review', input: { facts: evidence(holds ? 'Holds' : 'Breaks') } }, { _tag: 'Review', line, ...entry })))
        if (Result.isSuccess(outcome)) return 'Committed'
        expect(outcome.failure.code).toBe('RetiredSession')
        expect((await project()).read).toBe(view.read)
        return 'RetiredSession'
      },
      accept: async (actor) => {
        const view = await project()
        const outcome = await Effect.runPromise(Effect.result(cliProposal(journal, view, { line, move: 'accept', input: {} }, actor === 9 ? ownerAuthority : staffAuthorityOf(lifetime === 1 ? session : second))))
        if (Result.isFailure(outcome)) {
          expect(['WrongActor', 'WrongMove']).toContain(outcome.failure.code)
          expect((await project()).read).toBe(view.read)
        }
      },
      observe: async () => {
        const view = await project()
        const response = await Effect.runPromise(projectEvents(journal, readPosition(page.current())))
        expect(Result.getOrThrow(receiveProjectPayload(page, await response.json()))).toEqual(view)
        const phase = view.proposals.get(key)?.phase
        if (!phase || phase._tag === 'Removed') throw new Error('Missing replay proposal')
        const sessionPhase = view.sessions.get(lifetime === 1 ? session.key : second.key)?._tag
        if (sessionPhase !== 'Live' && sessionPhase !== 'Ended') throw new Error('Missing replay lifetime')
        return {
          phase: phase._tag, lifetime, session: sessionPhase,
          child: phase._tag === 'Reviewing' && phase.assignment._tag === 'Assigned' ? observed.get(phase.assignment.review)! : 0,
          visible: phase._tag === 'Accepted' || ownerProposals(view).some((proposal) => proposal.key === key),
        }
      },
    }))
  }))),
))
