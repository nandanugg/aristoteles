import { latestSession, staffOf, subagentCapacity, type LiveSession, type Project, type Proposal, type StoredEvent } from '../../schema/project.ts'

export const hostQueue = (project: Project, events: readonly StoredEvent[]): readonly Proposal[] => {
  const entries = new Map<Proposal['id'], StoredEvent['number']>()
  for (const event of events) {
    if (event.line._tag === 'Proposal' && event.from === 'Drafting' && event.move === 'submit')
      entries.set(event.line.id, event.number)
  }
  return [...project.proposals.values()].filter(({ phase, reviewer }) => phase._tag === 'Reviewing' &&
    phase.review._tag === 'Waiting' && reviewer.id === project.host.id && project.status._tag === 'Open')
    .sort((a, b) => (entries.get(a.id) ?? a.lastChange) - (entries.get(b.id) ?? b.lastChange))
}

export const nextProposalReview = (
  project: Project, events: readonly StoredEvent[],
): Readonly<{ proposal: Proposal; session: LiveSession }> | null => {
  const host = staffOf(project, project.host)
  if (!host || !subagentCapacity(project, host).freeSubagents) return null
  const session = latestSession(project, host)
  if (session?._tag !== 'Live') return null
  const proposal = hostQueue(project, events)[0]
  return proposal ? { proposal, session } : null
}

export const ownerProposals = (project: Project): readonly Proposal[] =>
  [...project.proposals.values()].filter(({ phase }) =>
    phase._tag === 'WaitingForOwner' || phase._tag === 'Accepted')
