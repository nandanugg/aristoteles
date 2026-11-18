// The words that more than one renderer prints: whose accept a draft waits for, and who drafted it.
import { directionAt, draftAt } from '../../core/derived/reads.ts'
import type {
  Direction,
  Revision,
  RevisionId,
  Work,
} from '../../core/schema/index.ts'
import { who } from './common.ts'

// draftWaitsText(draft): "Nanda": the owner of the direction accepts its draft.
export const draftWaitsText = (work: Work, draft: RevisionId): string =>
  directionAt(work, draftAt(work, draft).of).owner.name

// Who wrote a draft: a model run, or the refresh that brought in a commit of a company direction.
export const drafterOf = (work: Work, x: Revision<Direction>): string => {
  if (x.origin._tag === 'Written') return who(x.origin.by)
  if (x.origin._tag === 'Onboarded') return `the store start of onboarding (${x.origin.event})`
  const source = directionAt(work, x.of).source
  const where = source._tag === 'External' ? `${source.repo} (${source.path})` : ''
  const tag = x.origin.ref._tag === 'Tag' ? ` (tag ${x.origin.ref.tag})` : ''
  return `the refresh: commit ${x.origin.commit.slice(0, 7)}${tag} of ${where}`
}
