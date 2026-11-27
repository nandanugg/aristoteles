import { Effect } from 'effect'
import type { Of, Project, Refusal, StaffSessionKey } from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { recordObserved } from './project.ts'

type Move = Extract<Parameters<typeof recordObserved>[3], { line: 'Activation' }>

export const observeActivation = (
  journal: Journal, project: Project, move: Move,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, { _tag: 'Human' }, project.read, move)

export const recordHostUse = (
  journal: Journal, project: Project, key: Of<typeof StaffSessionKey>,
): Effect.Effect<Committed, Refusal> => recordObserved(
  journal, project.activation._tag === 'Active' ? { _tag: 'Staff', key: project.activation.staff.key } : { _tag: 'Human' }, project.read,
  { line: 'Activation', from: 'Active', move: 'use', input: { session: key } },
)
