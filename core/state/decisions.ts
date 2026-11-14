// The status computations that the old apply code reads to decide what a step makes, kept here
// so that the Work stays the same value (BUILD.md 3.3). Each one decides a fact that the fold
// stores: an exhaustion record (a fault on the last try), a new version (the deciders of a draft
// met), the `after` of an evaluation. In core/derived the same rules are states:
//   usedBy, isFault, decided  -> AssignmentState / Attempt (S4, S9)
//   decidersOfDraft, metAt    -> RevisionState (S2, S6)
//   evaluationDecision        -> EvaluationState
// They cannot leave the fold while it must make the old records with the old ids.
import {
  type Act as RoleAct,
  type AssignmentId,
  type By,
  type DeciderLeaf,
  type Deciders,
  type DirectionFile,
  type DirectionId,
  type Evaluation,
  type Exhaustion,
  type NonEmpty,
  type Permission,
  pointId,
  type RejectId,
  type Result,
  type ResultId,
  type Review,
  type RevisionId,
  type RoleName,
  type Stop,
  type TaskId,
  type Time,
  type Work,
} from '../schema/index.ts'
import {
  hasEvidence,
  isAcceptItem,
  isRejectItem,
  type Item,
  itemAt,
  itemsOf,
  taskOfTarget,
} from './items.ts'
import {
  actorOf,
  assignmentAt,
  atOrBefore,
  directionAt,
  draftAt,
  isAssignment,
  isPerson,
  maxOf,
  officialAt,
  resultAt,
  roleNameOf,
  roleOf,
  tierOf,
} from './records.ts'
import { contentAt, contentNow, directionIdsOf, sameFor, underNow } from './versions.ts'

// --- the acts of an actor ------------------------------------------------------------------------

// A grant covers an act from its own time to its until, and before its revoke.
const covers = (x: Permission, when: Time): boolean =>
  atOrBefore(x.when, when) &&
  atOrBefore(when, x.until) &&
  (x.revoked._tag === 'NotRevoked' || Date.parse(when) < Date.parse(x.revoked.at))
// The standing acts of the actor's role, and the permissions given to that role at that time.
export const actsOf = (w: Work, by: By, when: Time): ReadonlyArray<RoleAct> => {
  const role = roleOf(w, by)
  if (role === undefined) return []
  const granted = [...w.permissions.values()].filter((x) => x.to === role.role && covers(x, when))
  return [...role.acts, ...granted.map((x) => x.act)]
}
const targetsOf = (act: RoleAct): ReadonlyArray<string> =>
  act._tag === 'Do' ? [] : act._tag === 'Change' ? act.changesOf : act.resultsOf
// An act names a target; a direction counts only when it is official.
const names = (w: Work, act: RoleAct, target: string): boolean =>
  targetsOf(act).includes(target) &&
  (act._tag !== 'Change' ||
    !w.directions.has(target as DirectionId) ||
    officialAt(w, target as DirectionId) !== undefined)
const can = (
  w: Work,
  by: By,
  act: 'Review' | 'Approve' | 'Change',
  target: string,
  when: Time,
): boolean => actsOf(w, by, when).some((a) => a._tag === act && names(w, a, target))

// --- the deciders (page: Deciders) ---------------------------------------------------------------

interface Acting {
  readonly by: By
  readonly when: Time
}
interface Accept extends Acting {
  readonly at: number
}
type Matches = (leaf: DeciderLeaf, act: Acting) => boolean

const isLeaf = (who: Deciders): who is DeciderLeaf => who._tag === 'Role' || who._tag === 'Human'
const leavesOf = (who: Deciders): ReadonlyArray<DeciderLeaf> =>
  isLeaf(who) ? [who] : who.items.flatMap(leavesOf)
// A tree of deciders over any leaf: the domain Deciders, or the leaves of a draft (A1-1).
interface Gate<L> {
  readonly _tag: 'Or' | 'And' | 'Order'
  readonly items: ReadonlyArray<Tree<L>>
}
type Tree<L> = L | Gate<L>
const isGate = <L>(who: Tree<L>): who is Gate<L> => {
  const tag = (who as { readonly _tag: string })._tag
  return tag === 'Or' || tag === 'And' || tag === 'Order'
}
// The at of the accept that met the deciders; only accepts after `after` count. For Order, an
// item counts only after the item before it was met.
export const metAt = <L>(
  who: Tree<L>,
  accepts: ReadonlyArray<Accept>,
  matches: (leaf: L, act: Acting) => boolean,
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
  }
}
// The roles or persons whose accept the deciders wait for now.
export const nextLeaves = (
  who: Deciders,
  accepts: ReadonlyArray<Accept>,
  matches: Matches,
  after = 0,
): ReadonlyArray<DeciderLeaf> => {
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
// The deciders of a config file: a name is a role of the workflow, else a person.
type DeciderFile = NonNullable<DirectionFile['approvedBy']>
export const decidersOf = (file: DeciderFile, roles: ReadonlyArray<RoleName>): Deciders => {
  if (typeof file === 'string') {
    return roles.includes(file as RoleName)
      ? { _tag: 'Role', role: file as RoleName }
      : { _tag: 'Human', name: file }
  }
  const items = (list: ReadonlyArray<DeciderFile>) =>
    list.map((x) => decidersOf(x, roles)) as unknown as NonEmpty<Deciders>
  if ('or' in file) return { _tag: 'Or', items: items(file.or) }
  if ('and' in file) return { _tag: 'And', items: items(file.and) }
  return { _tag: 'Order', items: items(file.order) }
}

// --- who decides a result ------------------------------------------------------------------------

const makerRole = (w: Work, result: ResultId): RoleName =>
  assignmentAt(w, resultAt(w, result).by).role
// The workflow's decide entry for the maker's role; none: any role with an Approve act on it.
export const deciderOf = (w: Work, result: ResultId): Deciders | undefined =>
  w.workflow.decide.get(makerRole(w, result))
export const sameRole =
  (w: Work): Matches =>
  (leaf, act) =>
    leaf._tag === 'Role' && roleNameOf(w, act.by) === leaf.role
const isLeafOf = (w: Work, by: By) => (leaf: DeciderLeaf) =>
  leaf._tag === 'Role' && leaf.role === roleNameOf(w, by)

export const coversMaker = (w: Work, by: By, r: ResultId, when: Time): boolean =>
  can(w, by, 'Review', makerRole(w, r), when) || can(w, by, 'Approve', makerRole(w, r), when)
export const decidesResults = (w: Work, by: By, r: ResultId, when: Time): boolean => {
  const who = deciderOf(w, r)
  return who ? leavesOf(who).some(isLeafOf(w, by)) : can(w, by, 'Approve', makerRole(w, r), when)
}
// A decider's accept says where it read the result; it counts with the acts of its time.
export const decides = (w: Work, a: Item, r: ResultId): boolean =>
  decidesResults(w, a.by, r, a.when) && hasEvidence(a.evidence)
// The at of the latest Reject of a task: a criticism asks its deciders to look again.
const lastTaskReject = (w: Work, task: TaskId): number =>
  itemsOf(w, task).filter(isRejectItem).at(-1)?.at ?? 0
// The accepts of deciders that count now: after the latest Reject of the task, under versions
// that say the same to the task as the current ones.
export const decidingNow = (w: Work, r: ResultId): ReadonlyArray<Item> => {
  const task = resultAt(w, r).task
  return itemsOf(w, r).filter(
    (a) =>
      isAcceptItem(a) &&
      decides(w, a, r) &&
      a.at > lastTaskReject(w, task) &&
      directionIdsOf(w, task).every((d) => {
        const n = a.under.get(d)
        return n !== undefined && sameFor(w, contentAt(w, d, n), contentNow(w, d), task)
      }),
  )
}
export const decisionMet = (w: Work, r: ResultId, accepts: ReadonlyArray<Accept>): boolean => {
  const who = deciderOf(w, r)
  return who ? metAt<DeciderLeaf>(who, accepts, sameRole(w)) !== undefined : accepts.length > 0
}

// --- the tries of a maker (derived: AssignmentState, Attempt) -----------------------------------

// The person criticises as the owner: a person in a role that reviews or decides the maker is a
// reviewer like any other.
export const isCriticism = (w: Work, r: Item): boolean =>
  isPerson(w, r.by) && !(r.of._tag === 'Result' && coversMaker(w, r.by, r.of.id, r.when))
// Only a fault uses a try: a Reject of a reviewer or a decider; a recheck, the person's criticism
// and a Resolve use none.
export const isFault = (w: Work, r: Item): boolean =>
  isRejectItem(r) && !r.redo && !isCriticism(w, r)
const decided = (w: Work, r: ResultId): boolean =>
  decisionMet(
    w,
    r,
    itemsOf(w, r).filter((a) => isAcceptItem(a) && decides(w, a, r)),
  ) || itemsOf(w, r).some((v) => isRejectItem(v) && !isFault(w, v))
const decidedBefore = (w: Work, r: ResultId, at: number): boolean =>
  decisionMet(
    w,
    r,
    itemsOf(w, r).filter((a) => isAcceptItem(a) && decides(w, a, r) && a.at < at),
  )
// The tries that count against a maker: a result under versions that still say the same, with a
// fault before its deciders decided it, or not decided yet.
export const usedBy = (w: Work, a: AssignmentId): number =>
  [...w.results.values()].filter(
    (r) =>
      r.by === a &&
      underNow(w, r) &&
      (itemsOf(w, r.id).some((v) => isFault(w, v) && !decidedBefore(w, r.id, v.at)) ||
        !decided(w, r.id)),
  ).length
export const maxTriesOf = (w: Work, a: AssignmentId): number | undefined => {
  const maker = assignmentAt(w, a)
  return maker._tag === 'Maker' ? maxOf(maker.maxAttempts) : undefined
}

// --- stops and evaluations (derived: EvaluationState) -------------------------------------------

// The result whose fault made an exhaustion.
export const exhaustionResult = (w: Work, x: Exhaustion): Result => {
  const fault = itemAt(w, x.fault)
  if (fault?.of._tag !== 'Result') throw new Error(`${x.id} names ${x.fault}, no fault of a result`)
  return resultAt(w, fault.of.id)
}
// A stop as the engine reads it: an exhaustion, or the first point of a person's Reject.
type StopRef =
  | { readonly _tag: 'Exhaustion'; readonly exhaustion: Exhaustion; readonly at: number }
  | { readonly _tag: 'Item'; readonly item: Item; readonly at: number }
const stopRefOf = (w: Work, stop: Stop): StopRef | undefined => {
  if (stop._tag === 'Exhaustion') {
    const x = w.exhaustions.get(stop.id)
    return x ? { _tag: 'Exhaustion', exhaustion: x, at: x.at } : undefined
  }
  const id = stop.id as string
  const item = itemAt(w, id) ?? itemAt(w, pointId(id as RejectId, 1))
  if (item === undefined) return undefined
  const first = item.first === undefined ? item : (itemAt(w, item.first) ?? item)
  return { _tag: 'Item', item: first, at: first.at }
}
export const stopRefTask = (w: Work, s: StopRef): TaskId => {
  if (s._tag === 'Exhaustion') return exhaustionResult(w, s.exhaustion).task
  const task = taskOfTarget(w, s.item.of)
  if (task === undefined) throw new Error(`the stop ${s.item.id} has no task`)
  return task
}
export const stopRefOrThrow = (w: Work, stop: Stop): StopRef => {
  const ref = stopRefOf(w, stop)
  if (ref === undefined) throw new Error(`there is no stop ${stop.id}`)
  return ref
}
// The review of the owner that decides an evaluation, if any.
export const evaluationDecision = (w: Work, e: Evaluation): Review | undefined =>
  itemsOf(w, e.id).find((r) => r.decision === 'Accept' || r.decision === 'Reject')?.review

// --- the deciders of a draft (derived: RevisionState) -------------------------------------------

// Who accepts a draft by the direction's file: approvedBy, or the owner. The first version has
// only its owner.
const approvedByOfDraft = (w: Work, draft: RevisionId): Deciders => {
  const x = draftAt(w, draft)
  const d = directionAt(w, x.of)
  if (x._tag === 'New' || d.approvedBy._tag === 'Owner') return d.owner
  return d.approvedBy.deciders
}
// S2 (A1-1): the owner's own accept as the person is a leaf too, when a change says something
// new or comes after a Reject. The same rule as core/derived (reads.ts decidersOfDraft).
type DraftLeaf = DeciderLeaf | { readonly _tag: 'OwnerAccept'; readonly owner: string }
const ownerRule = (w: Work, draft: RevisionId): boolean => {
  const x = draftAt(w, draft)
  if (x._tag !== 'Change') return false
  const base = contentAt(w, x.of, Number(x.base.slice(x.base.lastIndexOf('@') + 1)))
  return base.says !== x.says || itemsOf(w, x.id).some(isRejectItem)
}
export const decidersOfDraft = (w: Work, draft: RevisionId): Tree<DraftLeaf> => {
  const base = approvedByOfDraft(w, draft)
  if (!ownerRule(w, draft)) return base
  const owner = directionAt(w, draftAt(w, draft).of).owner.name
  return { _tag: 'And', items: [base, { _tag: 'OwnerAccept', owner }] }
}
// The owner's leaf also matches a high role with a Change act on the direction at its time.
const standsInForOwner = (w: Work, by: By, direction: DirectionId, when: Time): boolean => {
  const tier = tierOf(roleOf(w, by))
  return (tier === undefined || tier === 'high') && can(w, by, 'Change', direction, when)
}
// The OwnerAccept leaf matches only the owner as the person: a stand-in does not count (S2).
export const draftMatches =
  (w: Work, direction: DirectionId) =>
  (leaf: DraftLeaf, act: Acting): boolean => {
    switch (leaf._tag) {
      case 'Role':
        return roleNameOf(w, act.by) === leaf.role
      case 'OwnerAccept':
        return isPerson(w, act.by) && actorOf(w, act.by).name === leaf.owner
      default:
        return (
          actorOf(w, act.by).name === leaf.name ||
          standsInForOwner(w, act.by, direction, act.when)
        )
    }
  }
// The person, not a model: their accept of a draft counts with no evidence.
const byPerson = (w: Work, by: By): boolean => !isAssignment(by) && isPerson(w, by)
export const draftAcceptItems = (w: Work, draft: RevisionId): ReadonlyArray<Item> =>
  itemsOf(w, draft).filter((r) => isAcceptItem(r) && (hasEvidence(r.evidence) || byPerson(w, r.by)))
