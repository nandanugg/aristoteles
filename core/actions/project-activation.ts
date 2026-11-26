import { Effect } from 'effect'
import type { ActivationEvent, Of, Project, Refusal, SessionId } from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { recordObserved } from './project.ts'

type Input = {
  [Event in ActivationEvent as `${Event['from']}:${Event['move']}`]:
    Pick<Event, 'line' | 'from' | 'move' | 'input'>
}
type Move = Input[keyof Input]

export const observeActivation = (
  journal: Journal, project: Project, move: Move,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, project.owner, project.read, move)

export const recordHostUse = (
  journal: Journal, project: Project, id: Of<typeof SessionId>,
): Effect.Effect<Committed, Refusal> => recordObserved(
  journal, project.activation._tag === 'Active' ? project.activation.staff : project.owner, project.read,
  { line: { _tag: 'Activation', id: project.id }, from: 'Active', move: 'use', input: { id } },
)
