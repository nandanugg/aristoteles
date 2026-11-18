// The pure parts of the dashboard page: words and classes drawn from a Dash, no DOM.
import type { Dash } from '../contract.ts'

export type Escalation = Dash['row'][number]
export type Change = Escalation['changes'][number]
type Rec = Change['before']

// A summary as a Minto pyramid: the first line is the conclusion, the lines after it support it
// (a leading bullet or number is dropped).
export const minto = (summary: string): { conclusion: string; supports: string[] } => {
  const [conclusion = '', ...rest] = summary
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')
  return { conclusion, supports: rest.map((l) => l.replace(/^(?:[-*]|\d+[.)])\s+/, '')) }
}

// The class of a terminal status: the page shows it with its word too.
export const statusClass = (status: Dash['pipe']['status']): string =>
  `st-${status.toLowerCase()}`

// The class of an escalation card, by its status.
export const escalationClass = (status: Escalation['status']): string =>
  `esc-${status.toLowerCase().replaceAll('_', '-')}`

export interface DiffLine {
  readonly kind: 'add' | 'del' | 'same'
  readonly text: string
}

// One field: unchanged, or the old line and the new one.
const fieldLines = (
  name: string,
  before: string | null | undefined,
  after: string | null | undefined,
): DiffLine[] => {
  const line = (v: string) => `${name}: ${v}`
  if (before === after) return after == null ? [] : [{ kind: 'same', text: line(after) }]
  return [
    ...(before == null ? [] : [{ kind: 'del' as const, text: line(before) }]),
    ...(after == null ? [] : [{ kind: 'add' as const, text: line(after) }]),
  ]
}

const examplesOf = (r: Rec): string[] => (r?.examples ?? []).map((e) => `${e.fits}: ${e.sample}`)

// The lines of an item's change: before and after, field by field, then its examples.
export const changeLines = (c: Change): DiffLine[] => {
  const { before: b, after: a } = c
  const where = (r: Rec) => (r?.where == null ? null : r.where.join(', '))
  const old = new Set(examplesOf(b))
  const now = new Set(examplesOf(a))
  return [
    ...fieldLines('name', b?.name, a?.name),
    ...fieldLines('says', b?.says, a?.says),
    ...fieldLines('where', where(b), where(a)),
    ...fieldLines('test', b?.test, a?.test),
    ...fieldLines('ref', b?.ref, a?.ref),
    ...fieldLines('form', b?.form, a?.form),
    ...[...old].filter((x) => !now.has(x)).map((text) => ({ kind: 'del' as const, text })),
    ...[...now].map((text) => ({
      kind: old.has(text) ? ('same' as const) : ('add' as const),
      text,
    })),
  ]
}

// The lines of the role card a change carries.
export const cardLines = (card: NonNullable<Escalation['card']>): DiffLine[] => [
  ...fieldLines('words', card.before?.words, card.after.words),
  ...fieldLines('model', card.before?.model, card.after.model),
]

// How a change reads in its title.
export const changeKind = (c: Change): 'added' | 'removed' | 'changed' =>
  c.before === null ? 'added' : c.after === null ? 'removed' : 'changed'
