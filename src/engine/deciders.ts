// The deciders (Or, And, Order, leavesOf, metAt, waitsFor, nextLeaves, turnOf, decidersProblem,
// decidersOf). page: Deciders. An item is a role, a
// person, or another Or, And, or Order; an accept counts for an item through `matches`.
import type { DeciderFile } from '../domain/files.ts'
import type { RoleName, Time } from '../domain/ids.ts'
import type * as M from '../domain/model.ts'
import type { By, DeciderLeaf, Deciders, NonEmpty } from '../domain/model.ts'

// page: Or(items), And(items), Order(items).
export const Or = (items: NonEmpty<Deciders>): M.Or => ({ _tag: 'Or', items })
export const And = (items: NonEmpty<Deciders>): M.And => ({ _tag: 'And', items })
export const Order = (items: NonEmpty<Deciders>): M.Order => ({ _tag: 'Order', items })

// A role or a person: the items that accept.
export type Leaf = DeciderLeaf

// Who acts, and when: what an item reads of an act.
export interface Acting {
  readonly by: By
  readonly when: Time
}
// One accept as the deciders count it (at is the engine's clock).
export interface Accept extends Acting {
  readonly at: number
}
// Whether an act counts for a leaf.
export type Matches = (leaf: Leaf, act: Acting) => boolean

const isLeaf = (who: Deciders): who is Leaf => who._tag === 'Role' || who._tag === 'Human'
// The name of a leaf, as the words and the refusals print it.
export const leafName = (leaf: Leaf): string => (leaf._tag === 'Role' ? leaf.role : leaf.name)

export const leavesOf = (who: Deciders): ReadonlyArray<Leaf> =>
  isLeaf(who) ? [who] : who.items.flatMap(leavesOf)

// The at of the accept that met the deciders; only accepts after `after` count. For Order, an
// item counts only after the item before it was met.
export const metAt = (
  who: Deciders,
  accepts: ReadonlyArray<Accept>,
  matches: Matches,
  after = 0,
): number | undefined => {
  switch (who._tag) {
    case 'Or': {
      const times = who.items
        .map((x) => metAt(x, accepts, matches, after))
        .filter((t): t is number => t !== undefined)
      return times.length > 0 ? Math.min(...times) : undefined
    }
    case 'And': {
      const times = who.items.map((x) => metAt(x, accepts, matches, after))
      return times.some((t) => t === undefined) ? undefined : Math.max(...(times as number[]))
    }
    case 'Order': {
      let t: number | undefined = after
      for (const x of who.items) {
        t = metAt(x, accepts, matches, t)
        if (t === undefined) return undefined
      }
      return t
    }
    default:
      return accepts.find((a) => a.at > after && matches(who, a))?.at
  }
}

// The items that the deciders still wait for, in words: "lead", "lead and techlead".
export const waitsFor = (
  who: Deciders,
  accepts: ReadonlyArray<Accept>,
  matches: Matches,
  after = 0,
): string => {
  if (metAt(who, accepts, matches, after) !== undefined) return ''
  switch (who._tag) {
    case 'Or':
      return who.items.map((x) => waitsFor(x, accepts, matches, after)).join(' or ')
    case 'And':
      return who.items
        .map((x) => waitsFor(x, accepts, matches, after))
        .filter(Boolean)
        .join(' and ')
    case 'Order': {
      let t = after
      for (const x of who.items) {
        const at = metAt(x, accepts, matches, t)
        if (at === undefined) return waitsFor(x, accepts, matches, t)
        t = at
      }
      return ''
    }
    default:
      return leafName(who)
  }
}

// The roles or persons whose accept the deciders wait for now: the next steps of a decider.
export const nextLeaves = (
  who: Deciders,
  accepts: ReadonlyArray<Accept>,
  matches: Matches,
  after = 0,
): ReadonlyArray<Leaf> => {
  if (metAt(who, accepts, matches, after) !== undefined) return []
  if (isLeaf(who)) return [who]
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
export const turnOf = (
  who: Deciders,
  act: Acting,
  accepts: ReadonlyArray<Accept>,
  matches: Matches,
  after = 0,
): boolean => {
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
    default:
      return matches(who, act)
  }
}

// Each item needs its own accept, so an expression names each role or person once. A person
// makes no version review: the approve is the last accept, so a person comes last in an Order.
export const decidersProblem = (who: Deciders): string | undefined => {
  const names = leavesOf(who).map(leafName)
  const twice = names.find((n, i) => names.indexOf(n) !== i)
  if (twice !== undefined) {
    return `names ${twice} two times; each item needs its own accept, so name it once`
  }
  const persons = (x: Deciders) => leavesOf(x).filter((leaf) => leaf._tag === 'Human')
  if (persons(who).length > 1) return 'names more than one person; one approve is the last accept'
  const personLast = (x: Deciders): boolean => {
    if (isLeaf(x)) return true
    if (x._tag !== 'Order') return x.items.every(personLast)
    const last = x.items[x.items.length - 1] ?? x.items[0]
    return x.items.slice(0, -1).every((y) => persons(y).length === 0) && personLast(last)
  }
  const first = persons(who)[0]
  if (!personLast(who) && first !== undefined) {
    return `names ${first.name} before another item of an order; the person approves last`
  }
  return undefined
}

// A name of the file is a role of the workflow, else a person.
export const decidersOf = (file: DeciderFile, roles: ReadonlyArray<RoleName>): Deciders => {
  if (typeof file === 'string') {
    return roles.includes(file as RoleName)
      ? { _tag: 'Role', role: file as RoleName }
      : { _tag: 'Human', name: file }
  }
  const items = (list: ReadonlyArray<DeciderFile>) =>
    list.map((x) => decidersOf(x, roles)) as unknown as NonEmpty<Deciders>
  if ('or' in file) return Or(items(file.or))
  if ('and' in file) return And(items(file.and))
  return Order(items(file.order))
}
