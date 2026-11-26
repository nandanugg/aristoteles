import { Effect } from 'effect'
import type { Of, Proposal, ReadPosition, Refusal, ReviewRun } from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { Authority, recordObserved, submit } from './project.ts'

export const submitProposal = (
  journal: Journal, read: Of<typeof ReadPosition>, input: unknown,
): Effect.Effect<Committed, Refusal, Authority> => Effect.gen(function* () {
  const access = yield* Authority
  const actor = yield* access.actor
  return yield* submit(journal, actor._tag === 'Human'
    ? { _tag: 'HumanChoice', read, choice: input }
    : { _tag: 'StaffReport', read, report: input }).pipe(Effect.provideService(Authority, { actor: Effect.succeed(actor) }))
})

export const assignProposalReview = (
  journal: Journal, proposal: Proposal, run: ReviewRun, read: Of<typeof ReadPosition>,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, { _tag: 'Staff', id: run.session.staff.id }, read, {
  line: { _tag: 'Proposal', id: proposal.id }, from: 'Reviewing', move: 'next', input: { run, facts: null },
})
