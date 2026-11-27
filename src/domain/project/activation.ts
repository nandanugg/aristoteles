import { Schema } from 'effect'
import type { Project } from './records.ts'
import { Pane, Staff } from './staff.ts'
import { EventNumber, FilePath, ProposalId, Rationale, SessionId, type Of } from './values.ts'

const FileHash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)).pipe(Schema.brand('FileHash'))
export const ApprovedFile = Schema.Struct({
  path: FilePath, hash: FileHash, before: Schema.Literals(['Marked', 'Unmarked']),
})
export type ApprovedFile = Of<typeof ApprovedFile>
export const ApprovedFiles = Schema.NonEmptyArray(ApprovedFile).check(
  Schema.makeFilter((files) => new Set(files.map(({ path }) => path)).size === files.length),
)
const launch = <T extends 'Reserved' | 'Acknowledged' | 'Bound' | 'Cancelled', const Fields extends Schema.Struct.Fields>(
  tag: T, fields: Fields,
) => Schema.TaggedStruct(tag, { ...fields, id: SessionId })
export const HostLaunch = Schema.Union([
  launch('Reserved', {}),
  launch('Acknowledged', { pane: Pane }),
  launch('Bound', { pane: Pane }),
  launch('Cancelled', {}),
])
export type HostLaunch = Of<typeof HostLaunch>
const pinned = Schema.Struct({ id: ProposalId, acceptedAt: EventNumber })
const work = Schema.Union([
  Schema.TaggedStruct('NotStarted', {}),
  Schema.TaggedStruct('Started', { at: EventNumber }),
  Schema.TaggedStruct('Used', { at: EventNumber, usedAt: EventNumber }),
])
const approved = {
  launches: Schema.Array(HostLaunch),
  at: EventNumber, files: ApprovedFiles, proposals: Schema.NonEmptyArray(pinned), staff: Staff,
}
export const Activation = Schema.Union([
  Schema.TaggedStruct('Onboarding', {}),
  Schema.TaggedStruct('Activating', approved),
  Schema.TaggedStruct('RollingBack', { ...approved, why: Rationale }),
  Schema.TaggedStruct('Active', {
    ...approved, binding: Schema.Struct({ id: SessionId, pane: Pane }), replacement: Schema.NullOr(HostLaunch), work,
  }),
])
export type Activation = Of<typeof Activation>

export const approvedProposals = (project: Project) => {
  const proposals = [...project.proposals.values()].filter(({ phase }) => phase._tag !== 'Removed')
  if (!project.staffing || !proposals.some(({ value }) => value._tag === 'Direction') ||
      proposals.some(({ phase }) => phase._tag !== 'Accepted')) return null
  const [first, ...rest] = proposals.flatMap(({ id, phase }) =>
    phase._tag === 'Accepted' ? [{ id, acceptedAt: phase.version.acceptedAt }] : [])
  return first ? [first, ...rest] as const : null
}
