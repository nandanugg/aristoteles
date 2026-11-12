// What follows from one fact of a record: each one was a second field that could disagree with
// the first (plan/types REVIEW-1 section 3). Small and pure; the engine's reads that need the
// rules of the work stay in src/engine.
import type {
  Answerer,
  Assignment,
  Direction,
  Escalate,
  OfficialDirection,
  Point,
  Reject,
  Review,
  Role,
  Source,
  SourceState,
  Task,
  TaskPoint,
  Version,
} from './model.ts'
import type { RoleFile } from './files.ts'
import type {
  DirectionId,
  EscalationId,
  PointId,
  RejectId,
  RoleName,
  RunId,
  TaskId,
  Time,
  VersionId,
} from './ids.ts'
import type { Problem } from './ui-model.ts'
import { pointId, rejectOf, versionId } from './ids.ts'
import type { Work } from './work.ts'

// The model that plays each tier.
const MODEL = { high: 'opus', medium: 'sonnet', low: 'haiku' } as const

// page: Role.playedBy. The tier's model, or the program by its name; a person plays no role.
export const playedBy = (role: Role): string =>
  role._tag === 'Model' ? MODEL[role.tier] : `program:${role.role}`

// The words of a role as aristoteles.yaml wrote them: the Work's config keeps them once (a
// Role keeps no copy). Every role of the workflow is in the config.
export const roleFileOf = (work: Work, role: RoleName): RoleFile => {
  const file = work.config.roles[role]
  if (file === undefined) throw new Error(`the config of the work has no role ${role}`)
  return file
}

// The id of a version, as the CLI prints it: tsd-writing@2.
export const versionIdOf = (v: Version<Direction>): VersionId => versionId(v.of, v.number)

// The current version of an official direction: its last.
export const currentVersion = (d: OfficialDirection): Version<Direction> =>
  d.versions[d.versions.length - 1] ?? d.versions[0]

// The official directions of the dir, in their order.
export const officialDirections = (work: Work): ReadonlyArray<OfficialDirection> =>
  [...work.directions.values()].flatMap((d) => (d._tag === 'Official' ? [d] : []))

export const officialOf = (work: Work, id: DirectionId): OfficialDirection | undefined => {
  const d = work.directions.get(id)
  return d?._tag === 'Official' ? d : undefined
}

// The decision of a review in words (the reader table review.decision): a recheck is a Reject.
export const decisionOf = (review: Review): 'Accept' | 'Reject' | 'Escalate' | 'Resolve' => {
  switch (review._tag) {
    case 'Accept':
      return 'Accept'
    case 'Reject':
    case 'Recheck':
      return 'Reject'
    case 'Escalate':
      return 'Escalate'
    case 'Resolve':
      return 'Resolve'
  }
}

// The id of what a review is about: its result, task, draft or evaluation; a Resolve is about
// its escalation's result (none here: it names the escalation only).
export const targetOf = (review: Review): string | undefined => {
  switch (review._tag) {
    case 'Accept':
    case 'Reject':
      return review.of.id
    case 'Recheck':
    case 'Escalate':
      return review.of
    case 'Resolve':
      return undefined
  }
}

// The old task that a remake replaced: the task whose end names this one as next.
export const replacesOf = (work: Work, task: TaskId): TaskId | null => {
  for (const t of work.tasks.values()) {
    if (t.end._tag === 'Replaced' && t.end.next === task) return t.id
  }
  return null
}

// The parts above a part that it runs after: its needs that serve the same task (a split makes the
// after of a part into needs on the earlier parts).
export const afterOf = (work: Work, task: Task): ReadonlyArray<TaskId> => {
  const serves = task.serves
  if (serves._tag === 'TopTask') return []
  return task.needs.filter((n) => {
    const other = work.tasks.get(n)?.serves
    return other?._tag === 'Serves' && other.task === serves.task
  })
}

// One point of a Reject, with the Reject that holds it.
export interface RejectPoint {
  readonly reject: Reject
  readonly id: PointId
  readonly point: Point | TaskPoint
}

// The Reject that a point belongs to, and the point itself: v4.1 is the first point of v4.
export const pointOf = (work: Work, id: PointId): RejectPoint | undefined => {
  const reject = work.reviews.get(rejectOf(id))
  if (reject?._tag !== 'Reject' || !('points' in reject.of)) return undefined
  const points: ReadonlyArray<Point | TaskPoint> = reject.of.points
  const point = points[Number(id.slice(id.lastIndexOf('.') + 1)) - 1]
  return point === undefined ? undefined : { reject, id, point }
}

// The points of a Reject with their ids.
export const pointsOf = (
  reject: Reject,
): ReadonlyArray<{ readonly id: PointId; readonly point: Point | TaskPoint }> =>
  'points' in reject.of
    ? (reject.of.points as ReadonlyArray<Point | TaskPoint>).map((point, i) => ({
        id: pointId(reject.id, i + 1),
        point,
      }))
    : []

// An escalation that no Resolve closed yet: a resolved one has no move back to open, so a
// second Resolve of it is refused (new: the old engine let it fold).
export const openEscalationOf = (work: Work, id: EscalationId): Escalate | undefined => {
  const escalation = work.reviews.get(id)
  if (escalation?._tag !== 'Escalate') return undefined
  for (const r of work.reviews.values()) {
    if (r._tag === 'Resolve' && r.escalation === id) return undefined
  }
  return escalation
}

// The stored id of a Reject (all its points) or of one point: the record is a Reject.
export const isRejectRef = (work: Work, id: RejectId | PointId): boolean =>
  id.includes('.')
    ? pointOf(work, id as PointId) !== undefined
    : work.reviews.get(id as RejectId)?._tag === 'Reject'

// Who answers a question or an escalation now: the first one that it went to while it is open,
// else the nearest open assignment above it, else the owner of its task. A finish never goes
// back, and the tree of parents never changes.
export const answererOf = (work: Work, first: Answerer): Answerer => {
  if (typeof first !== 'string') return first
  const start = work.assignments.get(first)
  if (start === undefined) return first
  for (let a: Assignment | undefined = start; a !== undefined; ) {
    if (a.end._tag === 'NotEnded') return a.id
    a = a.parent._tag === 'Parent' ? work.assignments.get(a.parent.id) : undefined
  }
  return work.tasks.get(start.task)?.owner ?? first
}

// The top task of a host run: the task opened from one of its drafts.
export const topOfRun = (work: Work, run: RunId): TaskId | undefined => {
  for (const d of work.taskDrafts.values()) {
    if (d.run === run && d.opened._tag === 'Opened') return d.opened.task
  }
  return undefined
}

// Two answerers are the same: one assignment, or one person.
export const sameAnswerer = (a: Answerer, b: Answerer): boolean =>
  typeof a === 'string' || typeof b === 'string' ? a === b : a.name === b.name

// Where a system problem shows: the parent of the task that it stops, else that task, so that
// one cause shows once.
export const problemTaskOf = (work: Work, problem: Problem): TaskId => {
  const serves = work.tasks.get(problem.stopped)?.serves
  return serves?._tag === 'Serves' ? serves.task : problem.stopped
}

// The revision of a source: a commit of a git source, the revision of an outside one.
export const revisionOf = (source: Source): string =>
  source._tag === 'Git' ? source.commit : source.revision

// When an outside source was last seen, and whether that is within the limit at a time: the time
// of the last stored act that named it (Source.Moved) or checked it (Source.Checked). One fact,
// in the log, so no source keeps a time. undefined: no agent has read it. A git source never
// expires (the CLI reads git itself), so it has no state.
export const sourceStateOf = (
  work: Work,
  name: string,
  at: Time,
  hours: number,
): SourceState | undefined => {
  const seen = work.events.findLast(({ recorded: { event: e } }) =>
    e._tag !== 'Source' ? false : 'create' in e ? e.create.source.name === name : e.id === name,
  )
  if (seen === undefined) return undefined
  const seenAt = seen.recorded.at
  const expired = Date.parse(at) - Date.parse(seenAt) > hours * 60 * 60 * 1000
  return expired ? { _tag: 'Expired', seenAt } : { _tag: 'Fresh', seenAt }
}
