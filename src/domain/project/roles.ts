import type { Project } from './records.ts'
import type { Of, RoleId } from './values.ts'

export const rolesOf = ({ roles }: Project) => [roles.host, roles.pipeline, ...roles.work.values()]
export const roleOf = ({ roles }: Project, id: Of<typeof RoleId>) =>
  roles.host.id === id ? roles.host : roles.pipeline.id === id ? roles.pipeline : roles.work.get(id)
export const staffingAt = (project: Project) => project.staffing?.version.acceptedAt ?? project.openedAt
