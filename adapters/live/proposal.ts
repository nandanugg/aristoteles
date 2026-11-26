import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { assignProposalReview } from '../../core/actions/proposal.ts'
import { readOpenProject } from '../../core/actions/staff-session.ts'
import { nextProposalReview } from '../../core/derived/project/review.ts'
import { Rationale, ReadPosition, ReviewId, refuse, type Project, type Proposal, type Refusal, type ReviewRun } from '../../core/schema/project.ts'
import { activationLock } from '../../core/services/index.ts'
import type { Committed, Journal } from '../../core/services/project.ts'

export interface Reviews {
  readonly reconcile: (project: Project) => Effect.Effect<void, Refusal>
  // The provider privately binds the child's credential to this run and the assignment event.
  readonly open: (proposal: Proposal, run: ReviewRun) => Effect.Effect<void, Refusal>
}

export const launchNextReview = (
  directory: string, journal: Journal, provider: Reviews,
): Effect.Effect<Committed | null, Refusal> => Effect.scoped(Effect.gen(function* () {
  yield* Effect.mapError(activationLock(directory), () =>
    refuse('Unavailable', Rationale.make('Could not acquire the onboarding review lock.')))
  const project = yield* readOpenProject(journal)
  yield* provider.reconcile(project)
  const events = yield* journal.eventsAfter(ReadPosition.make(0))
  const next = nextProposalReview(project, events)
  if (!next) return null
  const run = { id: ReviewId.make('review:' + randomUUID()), session: next.session }
  const start = Effect.andThen(provider.open(next.proposal, run), assignProposalReview(journal, next.proposal, run, project.read))
  return yield* Effect.uninterruptible(Effect.catch(start, (failure) =>
    Effect.andThen(Effect.flatMap(readOpenProject(journal), provider.reconcile), Effect.fail(failure)),
  ))
}))
