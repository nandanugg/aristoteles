import { nextStep } from '../../../core/derived/project/next-step.ts'
import { capacity, latestSession } from '../../../core/derived/project/staff.ts'
import type { Projection } from '../../../core/schema/project.ts'

export const staffCards = (state: Projection) => {
  if (state._tag === 'BeforeProject') return []
  const project = state.value
  return [...project.staff.values()].map((staff) => ({
    staff,
    capacity: capacity(project, staff),
    sessions: [...project.sessions.values()].filter((session) => session.staff.id === staff.id),
    selection: (() => {
      const live = latestSession(project, staff)
      return live?._tag === 'Live' ? nextStep(project, live) : { _tag: 'Awaiting' } as const
    })(),
  }))
}
