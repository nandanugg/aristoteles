import { ownerProposals } from '../../core/derived/project/review.ts'
import type { Project } from '../../core/schema/project.ts'

export const proposalsForOwner = (project: Project) => ownerProposals(project)
