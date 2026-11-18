// The acts of the person on the page: the suggestion (one action of core/actions) and the acts of
// the work model, with the words of their answers.
import { Schema } from 'effect'
import { WORK } from '../../core/actions/work.ts'
import type { ActionCall, Refusal } from '../../core/actions/types.ts'
import type { Refusal as Check } from '../../core/derived/work/accept.ts'
import { type Author, type CreatedId, WhatSchema } from '../../core/schema/index.ts'
import { PERSON } from '../../core/state/work/types.ts'
import type { PageAct } from './contract.ts'

// The one act of the page that is an action of core/actions: a suggestion of the gear (the
// settings the server writes itself).
export type SuggestAct = Extract<PageAct, { readonly act: 'suggest' }>

export const callOf = (act: SuggestAct, by: Author): ActionCall => ({
  by,
  input: { _tag: 'Suggest', target: { about: act.about }, content: { says: act.says } },
})

// The words of the answer, after the act stored its event (the ids that it made); as work
// suggest says it: what answers the suggestion.
export const wordsOf = (act: SuggestAct, created: ReadonlyArray<CreatedId>): string =>
  act.about._tag === 'Roles'
    ? `${created.join(', ')}: a suggestion about the roles; an adjustment of a role answers it.`
    : `${created.join(', ')}: a suggestion; a draft of a direction answers it.`

// --- the person's acts of the work model (POST /api/act) -----------------------------------------

// What the page posts: an act of the person with the view's seq (`on`) and the page's build, the
// confirm of a forward of the host (with the build), or its drop.
export const WorkPost = Schema.Union([
  Schema.Struct({ act: WhatSchema, on: Schema.NullOr(Schema.Int), build: Schema.String }),
  Schema.Struct({ confirm: Schema.String, build: Schema.String }),
  Schema.Struct({ drop: Schema.String }),
])
export type WorkPost = typeof WorkPost.Type

export const workPostOf = (body: unknown): WorkPost | undefined => {
  const decoded = Schema.decodeUnknownOption(WorkPost)(body)
  return decoded._tag === 'Some' ? decoded.value : undefined
}

const CHECKS: ReadonlyArray<Check> = ['ended', 'authority', 'epoch', 'legal', 'basis', 'build']

// The words of a check have its act's tag in them: a message fits the check whose words, with
// any tag, make it.
const checkOf = (message: string): string => {
  const fits = (c: Check) => {
    const [head = '', tail = ''] = WORK.checks(c, PERSON, '\0').message.split('\0')
    return message.startsWith(head) && message.endsWith(tail)
  }
  return CHECKS.find(fits) ?? 'refused'
}

// The answer of a refused act: the check that refused it (or 'refused' for a refusal before the
// checks: no top, no forward, a basis that is missing), its words, and what to do next.
export const refusedOf = (r: Refusal) => ({
  refused: checkOf(r.message),
  words: r.message,
  next: r.choice.words,
})
