import { dirname, join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { Effect } from 'effect'
import { projectActivationFiles, projectActivationOperations, type ProjectBootstrap } from '../../adapters/live/activation.ts'
import { assignProposalReview } from '../../core/actions/proposal.ts'
import { observeSession } from '../../core/actions/staff-session.ts'
import {
  ApprovedFiles, PaneAddress, ProposalKey, StaffSessionKey, type LaunchNonce, type Of, type Project,
} from '../../core/schema/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { create, open, ownerInput, session, staff, subscription, startFixtureSession } from './project.probe.ts'
import { acceptStaffing, cliProposal, direction, evidence } from './proposal.probe.ts'

export const approvedText = 'Read the approved project instructions.\n'
export const newerText = 'The owner edited the instructions.\n'
export const hostKey = (number: number) => StaffSessionKey.make('session:' + number.toString(16).padStart(32, '0'))

export const agree = (journal: Journal, project: Project, files: Of<typeof ApprovedFiles>) => ownerInput(journal, { read: project.read, line: 'Activation', move: 'next', input: { files } })

export const startWork = (journal: Journal, project: Project) => ownerInput(journal, { read: project.read, line: 'Activation', move: 'start', input: {} })

export const readyProject = (path: string, host = staff, projectDirectory?: Journal['directory']) => Effect.gen(function* () {
  const directory = dirname(path)
  const file = join(directory, 'AGENTS.md')
  writeFileSync(file, approvedText)
  const journal = yield* open(path, 'Create', projectDirectory)
  const project = (yield* create(journal, [], host)).state
  const staffed = yield* acceptStaffing(journal, project, {
    staff: new Map([[host.key, host]]), subscriptions: new Map([[subscription.key, subscription]]),
  })
  const onboarding = { ...session, key: StaffSessionKey.make('session:onboarding') }
  const live = yield* startFixtureSession(journal, staffed, onboarding)
  const proposalKey = ProposalKey.make('proposal:activation-direction')
  const line = { line: 'Proposal', key: proposalKey } as const
  const drafted = yield* cliProposal(journal, live.state, { line: 'Proposal', key: proposalKey, move: 'open', input: { previous: { _tag: 'None' }, value: direction } })
  const submitted = yield* cliProposal(journal, drafted.state, { ...line, move: 'submit', input: { value: direction } })
  const proposal = submitted.state.proposals.get(proposalKey)
  if (!proposal) throw new Error('Missing activation direction')
  const reviewing = yield* assignProposalReview(journal, proposal, onboarding, submitted.state.read)
  const reviewed = yield* cliProposal(journal, reviewing.state, { ...line, move: 'review', input: { facts: evidence('Holds') } },
    { _tag: 'Review', session: onboarding, ...line, queuedIn: proposal.changedIn })
  const accepted = yield* cliProposal(journal, reviewed.state, { ...line, move: 'accept', input: {} })
  const ready = yield* observeSession(journal, accepted.state, onboarding.key, 'Ended')
  const files = yield* projectActivationFiles(directory)
  return { journal, project: ready.state, files, file, directory }
})

export const fakeBootstrap = () => {
  const running = new Set<Of<typeof StaffSessionKey>>()
  const nonces = new Map<Of<typeof StaffSessionKey>, Of<typeof LaunchNonce>>()
  const provider: ProjectBootstrap = {
    observe: (key) => Effect.sync(() => running.has(key) ? 'Running' : 'Ended'),
    pane: (key) => Effect.sync(() => running.has(key) ? { address: PaneAddress.make('%' + Number.parseInt(key.slice(8), 16)) } : null),
    spawn: (key, nonce) => Effect.sync(() => { nonces.set(key, nonce); running.add(key) }),
    stop: (key) => Effect.sync(() => { running.delete(key) }),
  }
  return { provider, running, nonces }
}

export const readyActivation = (path: string) => Effect.gen(function* () {
  const fixture = yield* readyProject(path)
  const bootstrap = fakeBootstrap()
  const operations = projectActivationOperations(fixture.directory, fixture.journal, bootstrap.provider)
  return { ...fixture, ...bootstrap, operations }
})
