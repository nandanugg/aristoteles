import { Effect, Schema } from 'effect'
import { projectOnboard } from '../../adapters/cli/commands/project.ts'
import { Authority, type AuthenticatedActor } from '../../core/actions/project.ts'
import { assignProposalReview } from '../../core/actions/proposal.ts'
import { observeSession, readOpenProject } from '../../core/actions/staff-session.ts'
import { staffingAt,
  Direction, ProposalKey, ReviewFacts, StaffSessionKey, type Of, type Project, type Refusal, type StaffingPlan,
} from '../../core/schema/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { startSession, host, owner, session, staff } from './project.probe.ts'
import { ownerAuthority } from './question.probe.ts'

export const direction = Schema.decodeUnknownSync(Direction)({
  _tag: 'Direction', owner, name: 'Write a document',
  summary: 'Show the evidence', text: 'A direction with a scoped rule.',
  source: { _tag: 'Company', repository: 'https://example.test/directions', commit: 'a'.repeat(40), folder: 'docs' },
  stages: [{ name: 'Write', role: host, work: 'Write the document.', where: { _tag: 'Project' } }],
  standards: [{
    _tag: 'Standard', name: 'Evidence', text: 'Report what the tests show.', scope: { _tag: 'Everywhere' },
    rules: [{
      _tag: 'Rule', name: 'Tests pass', text: 'Run the tests.',
      verification: { _tag: 'Command', text: 'bun test' },
      knownBreaks: [], examples: [{ example: { _tag: 'MadeUp', text: 'All tests pass.' }, result: 'Holds' }],
    }],
  }],
})
export const evidence = (verdict: 'Holds' | 'Breaks'): ReviewFacts => Schema.decodeUnknownSync(ReviewFacts)({
  outcomes: [{ _tag: verdict, evidence: {
    _tag: 'Quote', file: 'AGENTS.md', lines: { first: 1, last: 1 }, text: 'A fresh review checked the draft.',
  } }], findings: [],
})
export const cliProposal = (
  journal: Journal, project: Project, input: unknown, auth: AuthenticatedActor = ownerAuthority,
  review?: Effect.Effect<unknown, Refusal>,
) => projectOnboard(journal, project.read, Bun.YAML.stringify(input), review).pipe(
  Effect.provideService(Authority, { actor: Effect.succeed(auth) }),
)
export const proposeStaffing = (
  journal: Journal, project: Project, plan: StaffingPlan, key: Of<typeof ProposalKey>,
) => cliProposal(journal, project, { line: { _tag: 'Proposal', key: key }, move: 'open', input: { previous: { _tag: 'None' }, value: { ...plan, _tag: 'Staffing' } } })

// Earlier capacity fixtures now install staffing through the same reviewed proposal flow.
export const acceptStaffing = (journal: Journal, project: Project, plan: StaffingPlan) => Effect.gen(function* () {
  const key = ProposalKey.make('proposal:staffing-' + project.read)
  const proposed = yield* proposeStaffing(journal, project, plan, key)
  const existing = [...proposed.state.sessions.values()].find((item) => item._tag === 'Live' && item.staff.key === staff.key)
  const started = existing?._tag === 'Live' ? proposed.state : (yield* startSession(journal, proposed.state, {
    key: StaffSessionKey.make('session:bootstrap-' + project.read), staff: staff.key, pane: session.pane, staffing: staffingAt(project),
  })).state
  const live = existing?._tag === 'Live' ? existing : [...started.sessions.values()].find((item) => item._tag === 'Live')
  if (live?._tag !== 'Live') throw new Error('Missing onboarding session')
  const line = { _tag: 'Proposal', key } as const
  const staged = yield* cliProposal(journal, started, { line, move: 'submit', input: { value: { ...plan, _tag: 'Staffing' } } })
  const proposal = staged.state.proposals.get(key)
  if (!proposal) throw new Error('Missing staffing proposal')
  const assigned = yield* assignProposalReview(journal, proposal, live, staged.state.read)
  const reviewed = yield* cliProposal(journal, assigned.state, { line, move: 'review', input: { facts: evidence('Holds') } }, {
    _tag: 'Review', session: live, line, review: proposal.lastChange,
  })
  const accepted = yield* cliProposal(journal, reviewed.state, { line, move: 'accept', input: {} })
  if (!existing) yield* observeSession(journal, accepted.state, { _tag: 'Session', key: live.key }, 'Ended')
  return yield* readOpenProject(journal)
})
