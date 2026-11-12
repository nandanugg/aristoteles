// The closed lists of the page, each one Schema: the files, the stored events and the records
// all take their type from here, so that the lists cannot drift apart.
import { Schema } from 'effect'

// page: Tier. A model class: Opus, Sonnet, Haiku. The person plays no tier.
export const Tier = Schema.Literals(['low', 'medium', 'high'])
export type Tier = typeof Tier.Type

// page: Level. The deepest cause of a mistake.
export const Level = Schema.Literals(['task', 'standard', 'direction', 'principle'])
export type Level = typeof Level.Type

// page: Principle. The eleven of Part 1.
export const PRINCIPLES = [
  'Logos',
  'Pathos',
  'Ethos',
  'Mythos',
  'Oikos',
  'Nomos',
  'Telos',
  'Kairos',
  'Mnēmē',
  'Topoi',
  'Aporia',
] as const
export const Principle = Schema.Literals(PRINCIPLES)
export type Principle = typeof Principle.Type

// page: Revision.why. Why a draft changes its direction.
export const REASONS = [
  'Correct the rule',
  'Correct the standard',
  'Correct the direction',
  'Correct the reviewer',
  'Shorten',
] as const
export const Reason = Schema.Literals(REASONS)
export type Reason = typeof Reason.Type

// A word of a file or of the CLI as one of a closed list: the same letters, in any case, with
// or without the marks of Mnēmē. undefined: no word of the list.
const plain = (word: string) =>
  word
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
export const oneOf = <const W extends string>(
  list: ReadonlyArray<W>,
  word: string,
): W | undefined => list.find((w) => plain(w) === plain(word))
