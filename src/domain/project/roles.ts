import type { Project } from './records.ts'
import type { Of, RoleKey } from './values.ts'

export const rolesOf = ({ roles }: Project) => [...roles.values()]
export const roleOf = ({ roles }: Project, key: Of<typeof RoleKey>) => roles.get(key)
export const hostRole = ({ roles }: Project) => [...roles.values()].find((role) => role._tag === 'Host')!
export const staffedIn = (project: Project) => project.staffing._tag === 'StaffingAccepted' ? project.staffing.version.acceptedIn : project.openedIn
