// The words that more than one renderer prints: whose accept a draft waits for, who drafted it,
// what it answers, and who answers a suggestion.
import { directionAt, draftAt } from '../../core/derived/reads.ts'
import type { Derived } from '../../core/derived/index.ts'
import type {
  Direction,
  Revision,
  RevisionId,
  SuggestionId,
  Work,
} from '../../core/schema/index.ts'
import { short, who } from './common.ts'

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

// What a draft answers, in words: a suggestion.
export const answerText = (work: Work, id: string): string => {
  const suggestion = work.suggestions.get(id as never)
  return suggestion ? `${id} "${short(suggestion.says, 80)}"` : id
}

// Who answers a suggestion: the host of the project drafts it, or its company repo changes
// with a pull request.
// command is kept for the page's call, which passes false.
export const suggestionMover = (d: Derived, id: SuggestionId, _command = true): string => {
  const about = d.moment.work.suggestions.get(id)?.about
  const target =
    about?._tag === 'Direction' ? d.moment.work.directions.get(about.direction) : undefined
  return target?.source._tag === 'External'
    ? `${target.id} changes in ${target.source.repo}, with a pull request`
    : 'no agent can draft it now; start a project in your AI CLI, and its host drafts it'
}
