// The words of a draft of new words of a role (ruling 2026-11-14): who drafted it, what waits,
// and each drafted word beside the word of now. `work role show <draft>`, the accept at a
// terminal, `work waiting`, and the page read them.
import { type Derived, type RoleWordsDraft, roleWordsDraftAt } from '../../core/derived/index.ts'
import type { Author, EventRef, Work } from '../../core/schema/index.ts'

export const drafterWords = (by: Author): string => {
  switch (by._tag) {
    case 'ModelRun':
      return `${by.name}, a model run outside any task`
    case 'Agent':
      return by.assignment
    default:
      return 'nobody'
  }
}

// '-' the word of now, '+' the drafted word; a list has one line per item.
export const roleWordsChange = (work: Work, draft: RoleWordsDraft): ReadonlyArray<string> => {
  const now = work.config.roles[draft.role] as Readonly<Record<string, unknown>> | undefined
  const lines = (sign: string, key: string, value: unknown): ReadonlyArray<string> =>
    Array.isArray(value)
      ? [`${sign} ${key}:`, ...value.map((x) => `${sign}   - ${String(x)}`)]
      : [`${sign} ${key}: ${String(value)}`]
  return Object.entries(draft.words).flatMap(([key, value]) => [
    ...(now?.[key] === undefined ? [] : lines('-', key, now[key])),
    ...lines('+', key, value),
  ])
}

// The state of a draft in words.
const stateWords = (d: Derived, ref: EventRef): string => {
  const state = d.states.roleWords.get(ref)
  switch (state?._tag) {
    case 'Waiting':
      return `waits for the accept of ${d.moment.work.workflow.owner.name}`
    case 'Accepted':
      return `accepted (${state.by})`
    case 'Rejected':
      return `rejected (${state.by}): "${state.reason}"`
    case 'Replaced':
      return `replaced by ${state.by}`
    case undefined:
      return 'unknown'
  }
}

// work role show <draft>: its head line, then its change.
export const renderRoleWords = (d: Derived, ref: EventRef): ReadonlyArray<string> | undefined => {
  const draft = roleWordsDraftAt(d.moment.work, ref)
  if (draft === undefined) return undefined
  const by = drafterWords(draft.by)
  return [
    `${ref} new words of ${draft.role}, drafted by ${by} · ${stateWords(d, ref)}`,
    ...roleWordsChange(d.moment.work, draft),
  ]
}
