// P1 (2026-11-15): the types that tie who moves an item to its place on the page. Each illegal
// value is one line under `@ts-expect-error` (a value that compiles again fails `bun run
// typecheck`); the legal twins below each must compile. Nothing runs this file: it is types only.
import type { Intent } from '../schema/actions.ts'
import type { Bare, Intents } from './waiting.ts'
import type { PersonKind, Surface } from './types.ts'

type Of<K extends Bare['_tag']> = Extract<Bare, { readonly _tag: K }>
const give: Intent = { _tag: 'Give', target: { task: 't1' as never, role: 'architect' as never } }

// A kind that the person moves has a card on the page.
// @ts-expect-error a person's kind with no page
export const noPage: Surface = { cli: true, mover: 'Person', page: 'None' }
export const card: Surface = { cli: true, mover: 'Person', page: 'Step' }
export const others: Surface = { cli: true, mover: 'Others', page: 'None' }

// Only a kind that the person moves gets intents, so a Do step of a person always has its card.
// @ts-expect-error a maker that waits for a file is a wait of other makers: no intent
export const idleIntents: Intents<Of<'IdleAssignment'>> = [give]
export const idleWait: Intents<Of<'IdleAssignment'>> = []
export const taskIntents: Intents<Of<'IdleTask'>> = [give]

// @ts-expect-error a wait of others is no kind of the person
export const outside: PersonKind = 'OutsideNeed'
export const brief: PersonKind = 'BriefOver'
