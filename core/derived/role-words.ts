// The drafts of new words of a role (ruling 2026-11-14). The log holds each draft
// (Role.WordsDrafted) and each reject of the person (Role.WordsRejected); the person's accept is
// the change of the role's words that stores the drafted words (Workflow.RoleWordsChanged). No
// state is stored: this reads it from the log, in its order.
import type {
  Author,
  EventOf,
  EventRef,
  NonBlank,
  RoleName,
  Time,
  Work,
} from '../schema/index.ts'
import { refOf } from './reads.ts'

export type RoleWords = EventOf<'Role.WordsDrafted'>['move']['words']
export interface RoleWordsDraft {
  readonly ref: EventRef
  readonly role: RoleName
  readonly words: RoleWords
  readonly by: Author
  readonly at: Time
}
// Waiting: for the person's accept or reject. Accepted: a change of the role's words stored them.
// Rejected: the person's reject, with its reason. Replaced: a newer draft of the role came while
// it waited.
export type RoleWordsState =
  | { readonly _tag: 'Waiting' }
  | { readonly _tag: 'Accepted'; readonly by: EventRef }
  | { readonly _tag: 'Rejected'; readonly by: EventRef; readonly reason: NonBlank }
  | { readonly _tag: 'Replaced'; readonly by: EventRef }

// Every draft of new words, in the order of the log.
export const roleWordsDrafts = (w: Work): ReadonlyArray<RoleWordsDraft> =>
  w.events.flatMap(({ recorded: r }) => {
    const e = r.event
    if (e._tag !== 'Role' || e.move._tag !== 'WordsDrafted') return []
    return [{ ref: refOf(r.seq), role: e.id, words: e.move.words, by: r.author, at: r.at }]
  })
export const roleWordsDraftAt = (w: Work, ref: EventRef): RoleWordsDraft | undefined =>
  roleWordsDrafts(w).find((x) => x.ref === ref)

// The stored words of a change hold each drafted word as drafted.
const stores = (stored: RoleWords, drafted: RoleWords): boolean =>
  Object.entries(drafted).every(
    ([k, v]) => JSON.stringify(stored[k as keyof RoleWords]) === JSON.stringify(v),
  )

export const roleWordsStates = (w: Work): ReadonlyMap<EventRef, RoleWordsState> => {
  const states = new Map<EventRef, RoleWordsState>()
  const waiting = new Map<RoleName, RoleWordsDraft>()
  const drafts = new Map(roleWordsDrafts(w).map((x) => [x.ref, x]))
  for (const { recorded: r } of w.events) {
    const e = r.event
    const ref = refOf(r.seq)
    if (e._tag === 'Role' && e.move._tag === 'WordsDrafted') {
      const before = waiting.get(e.id)
      if (before !== undefined) states.set(before.ref, { _tag: 'Replaced', by: ref })
      const draft = drafts.get(ref)
      if (draft !== undefined) waiting.set(e.id, draft)
      states.set(ref, { _tag: 'Waiting' })
    } else if (e._tag === 'Role' && e.move._tag === 'WordsRejected') {
      states.set(e.move.draft, { _tag: 'Rejected', by: ref, reason: e.move.reason })
      if (waiting.get(e.id)?.ref === e.move.draft) waiting.delete(e.id)
    } else if (e._tag === 'Workflow' && 'move' in e) {
      for (const [role, stored] of Object.entries(e.move.roles)) {
        const draft = waiting.get(role as RoleName)
        if (draft === undefined || !stores(stored, draft.words)) continue
        states.set(draft.ref, { _tag: 'Accepted', by: ref })
        waiting.delete(draft.role)
      }
    }
  }
  return states
}
