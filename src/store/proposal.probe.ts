import { Effect, Schema } from 'effect'
import { projectOnboard } from '../../adapters/cli/commands/onboard.ts'
import { Authority, type AuthenticatedActor } from '../../core/actions/project.ts'
import { assignProposalReview } from '../../core/actions/proposal.ts'
import { observeSession, readOpenProject, startSession } from '../../core/actions/staff-session.ts'
import {
  Direction, ProposalId, Rationale, SessionId, type Of, type Project, type Refusal, type ReviewFacts, type StaffingPlan,
} from '../../core/schema/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { host, owner, session, staff } from './project.probe.ts'
import { ownerAuthority } from './question.probe.ts'

export const direction = Schema.decodeUnknownSync(Direction)({
  _tag: 'Direction', id: 'direction:sample', owner, name: 'Write a document',
  summary: 'Show the evidence', text: 'A direction with a scoped rule.',
  source: { _tag: 'Company', repository: 'https://example.test/directions', commit: 'a'.repeat(40), folder: 'docs' },
  stages: [{ id: 'stage:write', name: 'Write', role: host, work: 'Write the document.', where: { _tag: 'Project' } }],
  standards: [{
    _tag: 'Standard', id: 'standard:evidence', name: 'Evidence', text: 'Report what the tests show.', scope: { _tag: 'Everywhere' },
    rules: [{
      _tag: 'Rule', id: 'rule:test', name: 'Tests pass', text: 'Run the tests.',
      verification: { _tag: 'Command', text: 'bun test' },
      examples: [{ example: { _tag: 'MadeUp', text: 'All tests pass.' }, result: 'Holds' }],
    }],
  }],
})
export const evidence = (verdict: 'Holds' | 'Breaks'): ReviewFacts => ({
  outcomes: [{ _tag: verdict, evidence: Rationale.make('A fresh review checked the draft.') }], findings: [],
})
export const cliProposal = (
  journal: Journal, project: Project, input: unknown, auth: AuthenticatedActor = ownerAuthority,
  review?: Effect.Effect<unknown, Refusal>,
) => projectOnboard(journal, project.read, Bun.YAML.stringify(input), review).pipe(
  Effect.provideService(Authority, { actor: Effect.succeed(auth) }),
)
export const proposeStaffing = (
  journal: Journal, project: Project, plan: StaffingPlan, id: Of<typeof ProposalId>,
) => cliProposal(journal, project, { _tag: 'Proposal', id, value: { ...plan, _tag: 'Staffing' } })

// Earlier capacity fixtures now install staffing through the same reviewed proposal flow.
export const acceptStaffing = (journal: Journal, project: Project, plan: StaffingPlan) => Effect.gen(function* () {
  const id = ProposalId.make('proposal:staffing-' + project.read)
  const proposed = yield* proposeStaffing(journal, project, plan, id)
  const existing = [...proposed.state.sessions.values()].find((item) => item._tag === 'Live' && item.staff.id === staff.id)
  const started = existing?._tag === 'Live' ? proposed.state : (yield* startSession(journal, proposed.state, {
    id: SessionId.make('session:bootstrap-' + project.read), staff: staff.id, pane: session.pane, staffing: project.staffingAt,
  })).state
  const live = existing?._tag === 'Live' ? existing : [...started.sessions.values()].find((item) => item._tag === 'Live')
  if (live?._tag !== 'Live') throw new Error('Missing onboarding session')
  const line = { _tag: 'Proposal', id } as const
  const staged = yield* cliProposal(journal, started, {
    _tag: 'SubmitProposal', line, question: null, value: { ...plan, _tag: 'Staffing' },
  })
  const proposal = staged.state.proposals.get(id)
  if (!proposal) throw new Error('Missing staffing proposal')
  const assigned = yield* assignProposalReview(journal, proposal, live, staged.state.read)
  const reviewed = yield* cliProposal(journal, assigned.state, { _tag: 'Review', line, facts: evidence('Holds') }, {
    _tag: 'Review', session: live, review: proposal.lastChange,
  })
  const accepted = yield* cliProposal(journal, reviewed.state, { _tag: 'ChooseProposal', line, choice: { _tag: 'accept' } })
  if (!existing) yield* observeSession(journal, accepted.state, { _tag: 'Session', id: live.id }, 'Ended')
  return yield* readOpenProject(journal)
})
