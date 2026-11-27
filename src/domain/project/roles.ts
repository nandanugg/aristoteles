import type { Project } from './records.ts'
import type { Of, RoleKey } from './values.ts'

export const rolesOf = ({ roles }: Project) => [roles.host, roles.pipeline, ...roles.work.values()]
export const roleOf = ({ roles }: Project, key: Of<typeof RoleKey>) =>
  roles.host.key === key ? roles.host : roles.pipeline.key === key ? roles.pipeline : roles.work.get(key)
export const staffedIn = (project: Project) => project.staffing._tag === 'StaffingAccepted' ? project.staffing.version.acceptedIn : project.openedIn
