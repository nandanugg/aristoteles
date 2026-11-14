// The deciders of a result or a draft (page: Deciders = Role | Actor | Or | And | Order): when a
// set of accepts meets them, whose accept they wait for next, and whose turn it is (BUILD.md D2).
// The rules read a tree over any leaf: the domain Deciders, or the leaves of a draft, where the
// owner's own accept is a leaf too (S2, A1-1: DraftLeaf).
import type { By, DeciderLeaf, Time } from '../schema/index.ts'
import type { DraftLeaf } from './types.ts'

// Who acts, and when: what a leaf reads of an act.
export interface Acting {
  readonly by: By
  readonly when: Time
}
// One accept as the deciders count it (at: the engine's clock).
export interface Counted extends Acting {
  readonly at: number
}
// A tree of deciders over the leaf L. The domain Deciders is a Tree<DeciderLeaf>.
export interface Gate<L> {
  readonly _tag: 'Or' | 'And' | 'Order'
  readonly items: ReadonlyArray<Tree<L>>
}
export type Tree<L> = L | Gate<L>
// Whether an act counts for a leaf.
export type Matches<L = DeciderLeaf> = (leaf: L, act: Acting) => boolean

const isGate = <L>(who: Tree<L>): who is Gate<L> => {
  const tag = (who as { readonly _tag: string })._tag
  return tag === 'Or' || tag === 'And' || tag === 'Order'
}

// The name of a leaf, as the words print it.
export const leafName = (leaf: DraftLeaf): string => {
  switch (leaf._tag) {
    case 'Role':
      return leaf.role
    case 'OwnerAccept':
      return leaf.owner.name
    default:
      return leaf.name
  }
}

export const leavesOf = <L>(who: Tree<L>): ReadonlyArray<L> =>
  isGate(who) ? who.items.flatMap((x) => leavesOf(x)) : [who]

// The at of the accept that met the deciders; only accepts after `after` count. In an Order, an
// item counts only after the item before it was met.
export const metAt = <L>(
  who: Tree<L>,
  accepts: ReadonlyArray<Counted>,
  matches: Matches<L>,
  after = 0,
): number | undefined => {
  if (!isGate(who)) return accepts.find((a) => a.at > after && matches(who, a))?.at
  switch (who._tag) {
    case 'Or': {
      const times = who.items
        .map((x) => metAt(x, accepts, matches, after))
        .filter((t): t is number => t !== undefined)
      return times.length > 0 ? Math.min(...times) : undefined
    }
    case 'And': {
      const times = who.items.map((x) => metAt(x, accepts, matches, after))
      return times.every((t): t is number => t !== undefined) ? Math.max(...times) : undefined
    }
    case 'Order': {
      let t: number | undefined = after
      for (const x of who.items) {
        t = metAt(x, accepts, matches, t)
        if (t === undefined) return undefined
      }
      return t
    }
  }
}

// The items that the deciders still wait for, in words: "lead", "lead and techlead".
export const waitsForWords = <L extends DraftLeaf>(
  who: Tree<L>,
  accepts: ReadonlyArray<Counted>,
  matches: Matches<L>,
  after = 0,
): string => {
  if (metAt(who, accepts, matches, after) !== undefined) return ''
  if (!isGate(who)) return leafName(who)
  switch (who._tag) {
    case 'Or':
      return who.items.map((x) => waitsForWords(x, accepts, matches, after)).join(' or ')
    case 'And':
      return who.items
        .map((x) => waitsForWords(x, accepts, matches, after))
        .filter(Boolean)
        .join(' and ')
    case 'Order': {
      let t = after
      for (const x of who.items) {
        const at = metAt(x, accepts, matches, t)
        if (at === undefined) return waitsForWords(x, accepts, matches, t)
        t = at
      }
      return ''
    }
  }
}

// The leaves whose accept the deciders wait for now: the next turn of an Order (B3).
export const nextLeaves = <L>(
  who: Tree<L>,
  accepts: ReadonlyArray<Counted>,
  matches: Matches<L>,
  after = 0,
): ReadonlyArray<L> => {
  if (metAt(who, accepts, matches, after) !== undefined) return []
  if (!isGate(who)) return [who]
  if (who._tag !== 'Order') return who.items.flatMap((x) => nextLeaves(x, accepts, matches, after))
  let t = after
  for (const x of who.items) {
    const at = metAt(x, accepts, matches, t)
    if (at === undefined) return nextLeaves(x, accepts, matches, t)
    t = at
  }
  return []
}

// Whether the act may decide now: in an Order, only after the items before its own were met.
export const turnOf = <L>(
  who: Tree<L>,
  act: Acting,
  accepts: ReadonlyArray<Counted>,
  matches: Matches<L>,
  after = 0,
): boolean => {
  if (!isGate(who)) return matches(who, act)
  switch (who._tag) {
    case 'Or':
    case 'And':
      return who.items.some((x) => turnOf(x, act, accepts, matches, after))
    case 'Order': {
      let t: number | undefined = after
      for (const x of who.items) {
        if (turnOf(x, act, accepts, matches, t)) return true
        t = metAt(x, accepts, matches, t)
        if (t === undefined) return false
      }
      return false
    }
  }
}
