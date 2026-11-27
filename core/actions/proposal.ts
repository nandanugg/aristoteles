import type { Effect } from 'effect'
import type { LiveSession, Of, Proposal, ReadPosition, Refusal } from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { recordObserved } from './project.ts'

export const assignProposalReview = (
  journal: Journal, proposal: Proposal, session: LiveSession, read: Of<typeof ReadPosition>,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, { _tag: 'Staff', id: session.staff.id }, read, {
  line: { _tag: 'Proposal', id: proposal.id }, from: 'Reviewing', move: 'assign', input: { session },
})
