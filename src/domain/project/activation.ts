import { Schema } from 'effect'
import { ProposalValue } from './proposal.ts'
import { versionOf } from './version.ts'
import type { Project } from './records.ts'
import { latestSession, staffOf } from './staff.ts'
import { EventNumber, FilePath, Rationale, type Of } from './values.ts'

const FileHash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)).pipe(Schema.brand('FileHash'))
export const ApprovedFile = Schema.Struct({
  path: FilePath, hash: FileHash, before: Schema.Literals(['Marked', 'Unmarked']),
})
export type ApprovedFile = Of<typeof ApprovedFile>
export const ApprovedFiles = Schema.NonEmptyArray(ApprovedFile).check(
  Schema.makeFilter((files) => new Set(files.map(({ path }) => path)).size === files.length),
)
const work = Schema.Union([
  Schema.TaggedStruct('NotStarted', {}),
  Schema.TaggedStruct('Started', { startedIn: EventNumber }),
])
const approved = {
  approvedIn: EventNumber, files: ApprovedFiles, proposals: Schema.NonEmptyArray(versionOf(ProposalValue)),
}
export const ProjectPhase = Schema.Union([
  Schema.TaggedStruct('Onboarding', {}),
  Schema.TaggedStruct('Activating', approved),
  Schema.TaggedStruct('RollingBack', { ...approved, why: Rationale }),
  Schema.TaggedStruct('Active', { ...approved, work }),
  Schema.TaggedStruct('Ended', { endedIn: EventNumber }),
])
export type ProjectPhase = Of<typeof ProjectPhase>

export const approvedProposals = (project: Project) => {
  const proposals = [...project.proposals.values()].filter(({ phase }) => phase._tag !== 'Removed')
  if (project.staffing._tag !== 'StaffingAccepted' || !proposals.some(({ value }) => value._tag === 'Direction') ||
      proposals.some(({ phase }) => phase._tag !== 'Accepted')) return null
  const [first, ...rest] = proposals.flatMap(({ phase }) => phase._tag === 'Accepted' ? [phase.version] : [])
  return first ? [first, ...rest] as const : null
}

export const hostSession = (project: Project) => {
  if (project.phase._tag === 'Onboarding' || project.phase._tag === 'Ended') return undefined
  const staff = staffOf(project, project.roles.host)
  return staff && latestSession(project, staff)
}

export const boundHostSession = (project: Project) => {
  const session = hostSession(project)
  return project.phase._tag === 'Active' && session?._tag === 'Live' ? session : undefined
}

export const hostReplacement = (project: Project) => {
  const session = hostSession(project)
  return session?._tag === 'Starting' ? session : { _tag: 'None' } as const
}
