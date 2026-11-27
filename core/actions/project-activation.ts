import { Effect } from 'effect'
import type { Project, Refusal } from '../schema/project.ts'
import type { Committed, Journal } from '../services/project.ts'
import { recordObserved } from './project.ts'

type Move = Extract<Parameters<typeof recordObserved>[3], { line: 'Project'; move: 'back' }>

export const observeActivation = (
  journal: Journal, project: Project, move: Move,
): Effect.Effect<Committed, Refusal> => recordObserved(journal, { _tag: 'Human' }, project.read, move)
