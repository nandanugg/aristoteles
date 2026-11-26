import { dirname, join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { Effect } from 'effect'
import { projectActivationFiles, projectActivationOperations, type ProjectBootstrap } from '../../adapters/live/project-activation.ts'
import { assignProposalReview } from '../../core/actions/proposal.ts'
import { observeSession } from '../../core/actions/staff-session.ts'
import {
  PaneAddress, ProposalId, SessionId, StaffingId, type LaunchNonce, type Of, type Project, type Submission,
} from '../../core/schema/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { create, open, ownerInput, session, staff, startFixtureSession } from './project.probe.ts'
import { acceptStaffing, cliProposal, direction, evidence } from './proposal.probe.ts'

export const approvedText = 'Read the approved project instructions.\n'
export const newerText = 'The owner edited the instructions.\n'
export const hostId = (number: number) => SessionId.make('session:' + number.toString(16).padStart(32, '0'))

export const agree = (journal: Journal, project: Project, files: Extract<
  Extract<Submission, { _tag: 'HumanChoice' }>['choice'], { _tag: 'Activate' }
>['files']) => ownerInput(journal, {
  _tag: 'HumanChoice', read: project.read, choice: { _tag: 'Activate', line: { _tag: 'Activation', id: project.id }, files },
})

export const startWork = (journal: Journal, project: Project) => ownerInput(journal, {
  _tag: 'HumanChoice', read: project.read, choice: { _tag: 'StartWork', line: { _tag: 'Project', id: project.id } },
})

export const readyProject = (path: string, host = staff) => Effect.gen(function* () {
  const directory = dirname(path)
  const file = join(directory, 'AGENTS.md')
  writeFileSync(file, approvedText)
  const journal = yield* open(path)
  const project = (yield* create(journal, [], host)).state
  const staffed = yield* acceptStaffing(journal, project, {
    id: StaffingId.make('staffing:activation'), staff: [host], subscriptions: [host.subscription],
  })
  const live = yield* startFixtureSession(journal, staffed)
  const proposalId = ProposalId.make('proposal:activation-direction')
  const line = { _tag: 'Proposal', id: proposalId } as const
  const drafted = yield* cliProposal(journal, live.state, { _tag: 'Proposal', id: proposalId, value: direction })
  const submitted = yield* cliProposal(journal, drafted.state, { _tag: 'SubmitProposal', line, value: direction, question: null })
  const proposal = submitted.state.proposals.get(proposalId)
  if (!proposal) throw new Error('Missing activation direction')
  const reviewing = yield* assignProposalReview(journal, proposal, session, submitted.state.read)
  const reviewed = yield* cliProposal(journal, reviewing.state, { _tag: 'Review', line, facts: evidence('Holds') },
    { _tag: 'Review', session, review: proposal.lastChange })
  const accepted = yield* cliProposal(journal, reviewed.state, { _tag: 'ChooseProposal', line, choice: { _tag: 'accept' } })
  const ready = yield* observeSession(journal, accepted.state, { _tag: 'Session', id: session.id }, 'Ended')
  const files = yield* projectActivationFiles(directory)
  return { journal, project: ready.state, files, file, directory }
})

export const fakeBootstrap = () => {
  const running = new Set<Of<typeof SessionId>>()
  const nonces = new Map<Of<typeof SessionId>, Of<typeof LaunchNonce>>()
  const provider: ProjectBootstrap = {
    observe: (id) => Effect.sync(() => running.has(id) ? 'Running' : 'Ended'),
    pane: (id) => Effect.sync(() => running.has(id) ? { address: PaneAddress.make('%' + Number.parseInt(id.slice(8), 16)) } : null),
    spawn: (id, nonce) => Effect.sync(() => { nonces.set(id, nonce); running.add(id) }),
    stop: (id) => Effect.sync(() => { running.delete(id) }),
  }
  return { provider, running, nonces }
}

export const readyActivation = (path: string) => Effect.gen(function* () {
  const fixture = yield* readyProject(path)
  const bootstrap = fakeBootstrap()
  const operations = projectActivationOperations(fixture.directory, fixture.journal, bootstrap.provider)
  return { ...fixture, ...bootstrap, operations }
})
