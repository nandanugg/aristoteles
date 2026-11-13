// The next steps of a medium or high agent (package P5a). nextSteps decides the steps: one member
// of NextStep per kind of step, with the ids that it names and no words. nextLines writes the old
// words of each step, line for line (golden text). stepKey has only the tags and the ids, so the
// watcher (P9) wakes a quiet agent when its steps change, and not when a word or a claim time
// changes (bug 13).
import { join } from 'node:path'
import { Effect } from 'effect'
import { answererOf, officialDirections, sourceStateOf } from '../domain/derived.ts'
import type {
  AssignmentId,
  DirectionId,
  EscalationId,
  EvaluationId,
  PointId,
  QuestionId,
  RejectId,
  ResultId,
  RevisionId,
  RoleName,
  SuggestionId,
  TaskId,
  Time,
} from '../domain/ids.ts'
import type {
  Assignment,
  Blocker,
  DeciderLeaf,
  NonEmpty,
  Standard,
  Stop,
  Suggestion,
  Task,
} from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import { leafName } from '../engine/deciders.ts'
import {
  answered,
  blockerItems,
  current,
  decidesNow,
  decidesResults,
  decisionWaitsOn,
  directionsOf,
  draftWaitsFor,
  evaluationCounts,
  evaluationDecision,
  exhaustionResult,
  isDo,
  madeBy,
  mayChange,
  openDo,
  openEscalations,
  reviewsOf,
  stopAnswered,
  stopKey,
  stopsOf,
  stopTask,
  taskAccepted,
  vetoOf,
  within,
  workStop,
} from '../engine/queries.ts'
import { taskState } from '../engine/status.ts'
import { type Item, itemAt } from '../engine/view.ts'
import { Spawn } from '../services/outside.ts'
import { an, clock, latestResult, short, taskStateWord, who } from './common.ts'
import {
  assignmentOf,
  attemptWords,
  claimedSince,
  fileTurn,
  finishedAssignment,
  type Idle,
  idleOf,
  idleWords,
  isAbove,
  lowerRoles,
  outsideFor,
  outsideNow,
  outsideSourceHours,
  parentId,
  RANK,
  tierOfAssignment,
  waitersOf,
} from './reads.ts'
import {
  aboutId,
  draftWaitsText,
  followsDirection,
  openDrafts,
  stopIdOf,
  suggestionsToDraft,
  waitsForNewDraft,
} from './show.ts'

// One step that is ready for an agent: what it acts on, by id. A field that is not an id only
// picks words (a flag, a file, a revision, a time); stepKey leaves those out. The members follow
// the order in which nextSteps finds them.
export type NextStep =
  // An outside source that work of the tree was made from expired: read it again (new: the
  // owner's ruling, 2026-11-12). revision and seenAt: what an agent read, and when.
  | {
      readonly _tag: 'ReadSource'
      readonly source: string
      readonly revision: string
      readonly seenAt: Time
      readonly hours: number
    }
  // A question or an escalation that waits for this assignment's answer.
  | { readonly _tag: 'Answer'; readonly question: QuestionId }
  | { readonly _tag: 'Resolve'; readonly escalation: EscalationId; readonly result: ResultId }
  // A result made from an old input: a revision of an outside source, or old work of a need.
  | {
      readonly _tag: 'RecheckStaleSource'
      readonly result: ResultId
      readonly source: string
      readonly was: string
      readonly now: string
    }
  | {
      readonly _tag: 'RecheckOldNeed'
      readonly result: ResultId
      readonly need: TaskId
      readonly newer: ResultId
    }
  // A child whose task is closed or replaced; this assignment's own task closed; a child maker
  // that makes no more results while other makers wait for its file.
  | {
      readonly _tag: 'FinishChildOfClosedTask'
      readonly child: AssignmentId
      readonly task: TaskId
      readonly replacedBy: TaskId | null
    }
  | { readonly _tag: 'FinishInClosedTask'; readonly task: TaskId }
  | {
      readonly _tag: 'FinishIdleChild'
      readonly child: AssignmentId
      readonly idle: Idle
      readonly waiters: NonEmpty<AssignmentId>
      readonly file: string
    }
  // Drafts of directions that this assignment reviews or revises, and suggestions it answers.
  | { readonly _tag: 'ReviewDraft'; readonly draft: RevisionId }
  | { readonly _tag: 'ReviseRejectedDraft'; readonly draft: RevisionId; readonly reject: RejectId }
  | {
      readonly _tag: 'AnswerSuggestion'
      readonly suggestion: SuggestionId
      readonly direction: DirectionId
    }
  // This assignment's task is accepted: put its commit on the base, finish the children, finish.
  | {
      readonly _tag: 'PutOnBase'
      readonly task: TaskId
      readonly result: ResultId
      readonly repo: string
      readonly base: string
      readonly commit: string
    }
  | { readonly _tag: 'FinishChild'; readonly child: AssignmentId }
  | { readonly _tag: 'FinishAcceptedTask'; readonly task: TaskId }
  // A task of the tree that waits for an evaluation of a stop, or for the change that its
  // evaluation asks for.
  | {
      readonly _tag: 'EvaluationWaitsForOwner'
      readonly evaluation: EvaluationId
      readonly task: TaskId
    }
  | { readonly _tag: 'Evaluate'; readonly task: TaskId; readonly stop: Stop }
  | {
      readonly _tag: 'WaitsForEvaluationBy'
      readonly task: TaskId
      readonly stop: Stop
      readonly evaluator: AssignmentId
    }
  | { readonly _tag: 'WaitsForEvaluationNoHigh'; readonly task: TaskId; readonly stop: Stop }
  // evaluation: the latest one that counts; null: none counts (the words say "the evaluation").
  | {
      readonly _tag: 'WaitsForParts'
      readonly task: TaskId
      readonly evaluation: EvaluationId | null
    }
  | {
      readonly _tag: 'DraftOfEvaluationWaits'
      readonly task: TaskId
      readonly draft: RevisionId
      readonly evaluation: EvaluationId | null
    }
  | {
      readonly _tag: 'WaitsForChangeOfEvaluation'
      readonly task: TaskId
      readonly evaluation: EvaluationId | null
    }
  // oneUnit: the task has a section, so it is remade, not split.
  | {
      readonly _tag: 'RemakeAsEvaluated'
      readonly task: TaskId
      readonly evaluation: EvaluationId | null
      readonly oneUnit: boolean
    }
  | {
      readonly _tag: 'EscalateForRemake'
      readonly task: TaskId
      readonly evaluation: EvaluationId | null
      readonly oneUnit: boolean
    }
  | {
      readonly _tag: 'ReviseAsEvaluated'
      readonly task: TaskId
      readonly evaluation: EvaluationId | null
      readonly directions: ReadonlyArray<DirectionId>
    }
  // A Reject of a task of the tree itself: a high role revises, a medium escalates.
  | {
      readonly _tag: 'ReviseForReturnedTask'
      readonly point: PointId
      readonly task: TaskId
      readonly directions: ReadonlyArray<DirectionId>
    }
  | { readonly _tag: 'EscalateForReturnedTask'; readonly point: PointId; readonly task: TaskId }
  // The tasks that it needs: outside the tree, or a part that runs after another part.
  | { readonly _tag: 'WaitsForOutsideNeed'; readonly task: TaskId; readonly need: TaskId }
  | { readonly _tag: 'RunsAfter'; readonly task: TaskId; readonly need: TaskId }
  // Who runs it: a medium that runs it already, a new medium, or a split first.
  | { readonly _tag: 'MediumRuns'; readonly lead: AssignmentId; readonly task: TaskId }
  | {
      readonly _tag: 'RunSectionWithMedium'
      readonly task: TaskId
      readonly roles: NonEmpty<RoleName>
    }
  | { readonly _tag: 'SplitFirst'; readonly task: TaskId }
  | { readonly _tag: 'RunWithMedium'; readonly task: TaskId; readonly roles: NonEmpty<RoleName> }
  // A point that only a direction change answers. first: before the next result is made.
  | {
      readonly _tag: 'ChangeWaitsForDraft'
      readonly point: PointId
      readonly drafts: NonEmpty<RevisionId>
      readonly first: boolean
    }
  | {
      readonly _tag: 'ReviseForPoint'
      readonly point: PointId
      readonly directions: ReadonlyArray<DirectionId>
      readonly first: boolean
    }
  | {
      readonly _tag: 'EscalateForPoint'
      readonly point: PointId
      readonly result: ResultId
      readonly first: boolean
    }
  // A new result is due. redo: the task has a result already; ownChild: the maker is a child of
  // this assignment, so the words say what to do with a lost token.
  | {
      readonly _tag: 'MakerWaitsForFile'
      readonly maker: AssignmentId
      readonly file: string
      readonly before: AssignmentId
    }
  | { readonly _tag: 'MakerWorking'; readonly maker: AssignmentId; readonly task: TaskId }
  | {
      readonly _tag: 'GiveMakerCommand'
      readonly maker: AssignmentId
      readonly task: TaskId
      readonly redo: boolean
      readonly ownChild: boolean
    }
  | { readonly _tag: 'AssignMaker'; readonly task: TaskId; readonly roles: NonEmpty<RoleName> }
  | { readonly _tag: 'NoMakerRole'; readonly task: TaskId }
  // The checks of the latest result, by the checker of each rule.
  | { readonly _tag: 'CheckAgainUnderNewVersion'; readonly result: ResultId }
  | {
      readonly _tag: 'ProgramChecksNextReport'
      readonly role: RoleName
      readonly task: TaskId
      readonly result: ResultId
    }
  | { readonly _tag: 'CheckYourself'; readonly result: ResultId }
  | { readonly _tag: 'CheckerWorking'; readonly checker: AssignmentId; readonly result: ResultId }
  | {
      readonly _tag: 'GiveCheckerCommand'
      readonly checker: AssignmentId
      readonly result: ResultId
      readonly task: TaskId
    }
  | { readonly _tag: 'CheckerOfHigherTier'; readonly result: ResultId; readonly role: RoleName }
  | {
      readonly _tag: 'AssignChecker'
      readonly result: ResultId
      readonly role: RoleName
      readonly task: TaskId
    }
  // The decision of the latest result: this assignment decides, or it waits for a decider.
  | { readonly _tag: 'Decide'; readonly result: ResultId; readonly again: boolean }
  | { readonly _tag: 'WaitsForDecider'; readonly result: ResultId; readonly decider: AssignmentId }
  | {
      readonly _tag: 'AssignDecider'
      readonly result: ResultId
      readonly role: RoleName
      readonly task: TaskId
    }
  | {
      readonly _tag: 'DeciderByPerson'
      readonly result: ResultId
      readonly leaf: DeciderLeaf
      readonly task: TaskId
    }

export type StepTag = NextStep['_tag']
type StepOf<K extends StepTag> = Extract<NextStep, { readonly _tag: K }>

// --- the reads of the steps ----------------------------------------------------------------------

const taskOf = (w: Work, id: TaskId): Task => {
  const t = w.tasks.get(id)
  if (t === undefined) throw new Error(`the work has no task ${id}`)
  return t
}
const isOpenTask = (t: Task): boolean => t.end._tag === 'NotEnded'
const sectionOfTask = (t: Task): string | null =>
  t.descriptionAi.context.section._tag === 'Section' ? t.descriptionAi.context.section.id : null
const servesTask = (t: Task, parent: TaskId): boolean =>
  t.serves._tag === 'Serves' && t.serves.task === parent
const directionIdsOf = (w: Work, task: TaskId): ReadonlyArray<DirectionId> =>
  directionsOf(w, task).map((d) => d.id)
const nonEmpty = <A>(list: ReadonlyArray<A>): NonEmpty<A> | undefined => {
  const [first, ...rest] = list
  return first === undefined ? undefined : [first, ...rest]
}
// One old review record: a point of a Reject, a recheck, an escalation, a resolve.
const itemOf = (w: Work, id: string): Item => {
  const item = itemAt(w, id)
  if (item === undefined) throw new Error(`the work has no review ${id}`)
  return item
}
// The writer of a draft, when it is an assignment of this dir.
const reviserOf = (w: Work, draft: RevisionId): AssignmentId | undefined => {
  const origin = w.drafts.get(draft)?.origin
  return origin?._tag === 'Written' && typeof origin.by === 'string' ? origin.by : undefined
}
// A blocker that only a direction change can close, and that no change has closed yet: the
// point that it names.
const changePoint = (w: Work, item: Blocker): PointId | undefined => {
  if (item._tag === 'Change') return item.ref
  if (item._tag !== 'Reject') return undefined
  return itemOf(w, item.ref).breaks === undefined && !answered(w, item.ref) ? item.ref : undefined
}
const isDeciderItem = (item: Blocker): boolean =>
  item._tag === 'DeciderAcceptedUnderOld' ||
  item._tag === 'DeciderWaits' ||
  item._tag === 'DeciderAnyApprover'
const hasOpenRecheck = (w: Work, result: ResultId): boolean =>
  reviewsOf(w, result).some((v) => v._tag === 'Recheck' && !answered(w, v.id))
// The latest evaluation that counts for a task.
const evaluationOfTask = (w: Work, task: TaskId) =>
  [...w.evaluations.values()]
    .filter((e) => stopTask(w, e.answers) === task && evaluationCounts(w, e))
    .at(-1)
// The open points of the Rejects of a task itself (a split or a change answers each one).
const taskRejects = (w: Work, task: TaskId): ReadonlyArray<PointId> =>
  [...w.reviews.values()].flatMap((v) =>
    v._tag === 'Reject' && v.of._tag === 'Task' && v.of.id === task
      ? v.of.points.map((_, i) => `${v.id}.${i + 1}` as PointId).filter((p) => !answered(w, p))
      : [],
  )

// --- the steps -----------------------------------------------------------------------------------

export interface NextOptions {
  readonly token: string
  readonly at: Time
  readonly cwd: string
}

// The steps that are ready in the subtree of a medium or high assignment, in the old order. The
// expired outside sources come first.
export const nextSteps = (
  w: Work,
  id: AssignmentId,
  { at, cwd }: NextOptions,
): ReadonlyArray<NextStep> => {
  const a = assignmentOf(w, id)
  const steps: Array<NextStep> = [...expiredSources(w, a, at, cwd)]

  // The questions and escalations that this assignment answers now.
  for (const q of w.questions.values()) {
    if (q.status._tag === 'Open' && answererOf(w, q.answerBy) === id) {
      steps.push({ _tag: 'Answer', question: q.id })
    }
  }
  const latestOpen = (r: ResultId): boolean => {
    const task = w.results.get(r)?.task
    return (
      task !== undefined &&
      latestResult(w, task)?.id === r &&
      !taskAccepted(w, task, at) &&
      isOpenTask(taskOf(w, task))
    )
  }
  for (const v of w.reviews.values()) {
    if (v._tag !== 'Escalate' || answererOf(w, v.answerBy) !== id || !latestOpen(v.of)) continue
    if (!openEscalations(w, v.of).some((e) => e.id === v.id)) continue
    steps.push({ _tag: 'Resolve', escalation: v.id, result: v.of })
  }
  // A result made from an old revision of an outside source, or before the latest result of a
  // task that it needs: its maker makes it again.
  for (const t of w.tasks.values()) {
    if (!within(w, t.id, a.task) || !isOpenTask(t)) continue
    const result = latestResult(w, t.id)
    if (result === undefined) continue
    const decides = decidesResults(w, id, result.id, at) && !hasOpenRecheck(w, result.id)
    const stale = outsideFor(w, cwd, [result]).stale.get(result.id)
    if (stale && decides) steps.push({ _tag: 'RecheckStaleSource', result: result.id, ...stale })
    const old = blockerItems(w, result.id, at).find((i) => i._tag === 'OldNeed')
    if (old?._tag === 'OldNeed' && decides) {
      steps.push({ _tag: 'RecheckOldNeed', result: result.id, need: old.ref, newer: old.newer })
    }
  }
  // A child whose task closed (or was remade) takes no more work: the parent finishes it.
  const children = [...w.assignments.values()].filter(
    (x) => parentId(x) === id && !finishedAssignment(x),
  )
  for (const child of children) {
    const end = taskOf(w, child.task).end
    if (end._tag === 'NotEnded') continue
    const replacedBy = end._tag === 'Replaced' ? end.next : null
    steps.push({ _tag: 'FinishChildOfClosedTask', child: child.id, task: child.task, replacedBy })
  }
  if (!isOpenTask(taskOf(w, a.task))) {
    steps.push({ _tag: 'FinishInClosedTask', task: a.task })
    return steps
  }
  // One maker writes a file at a time: a child maker that makes no more results, and that another
  // maker waits for, is finished, so that the next maker starts.
  for (const child of children) {
    if (!isOpenTask(taskOf(w, child.task))) continue
    const waiters = nonEmpty(waitersOf(w, child.id, at))
    const idle = idleOf(w, child.id, at)
    if (waiters === undefined || idle === undefined) continue
    const file = fileTurn(w, waiters[0], at)?.file ?? ''
    steps.push({ _tag: 'FinishIdleChild', child: child.id, idle, waiters, file })
  }
  steps.push(...draftSteps(w, a, at))
  if (taskAccepted(w, a.task, at)) {
    steps.push(...acceptedSteps(w, a, cwd))
    return steps
  }
  for (const t of w.tasks.values()) {
    if (!within(w, t.id, a.task) || !isOpenTask(t) || taskAccepted(w, t.id, at)) continue
    steps.push(...taskSteps(w, a, t, at, cwd))
  }
  return steps
}

// Each outside source that is expired now and that the latest result of an open task of the
// tree was made from, once, in the order of the dir's sources (new: the owner's ruling,
// 2026-11-12). A git source never expires; a source that no agent read has no time.
const expiredSources = (
  w: Work,
  a: Assignment,
  at: Time,
  cwd: string,
): ReadonlyArray<NextStep> => {
  if (finishedAssignment(a)) return []
  const used = new Set<string>()
  for (const t of w.tasks.values()) {
    if (!isOpenTask(t) || !within(w, t.id, a.task)) continue
    for (const m of latestResult(w, t.id)?.madeFrom ?? []) {
      if (m._tag === 'Outside') used.add(m.name)
    }
  }
  const sources = [...w.sources.values()].flatMap((s) =>
    s._tag === 'Outside' && used.has(s.name) ? [s] : [],
  )
  if (sources.length === 0) return []
  const hours = outsideSourceHours(cwd)
  return sources.flatMap((s): ReadonlyArray<NextStep> => {
    const seen = sourceStateOf(w, s.name, at, hours)
    if (seen?._tag !== 'Expired') return []
    return [
      { _tag: 'ReadSource', source: s.name, revision: s.revision, seenAt: seen.seenAt, hours },
    ]
  })
}

// The drafts of the directions of this tree: a draft that waits for this role's accept, a draft
// that a decider rejected (its reviser revises again), and the suggestions that wait for a draft.
const draftSteps = (w: Work, a: Assignment, at: Time): ReadonlyArray<NextStep> => {
  const high = tierOfAssignment(w, a) === 'high'
  const steps: Array<NextStep> = []
  // A role that approvedBy names, or, with none, a role with a Change act on the direction. The
  // reviser and the actors below it do not review it.
  const own = officialDirections(w).filter((d) =>
    [...w.tasks.values()].some(
      (t) => within(w, t.id, a.task) && directionIdsOf(w, t.id).includes(d.id),
    ),
  )
  for (const x of own.flatMap((d) => openDrafts(w, d.id))) {
    const reviser = reviserOf(w, x.id)
    const reviserTree = reviser !== undefined && (reviser === a.id || isAbove(w, reviser, a))
    const mine = draftWaitsFor(w, x.id).some((leaf) =>
      leaf._tag === 'Role' ? leaf.role === a.role : mayChange(w, a.id, x.of, at),
    )
    if (!mine || reviewsOf(w, x.id).some((r) => r.by === a.id) || reviserTree) continue
    steps.push({ _tag: 'ReviewDraft', draft: x.id })
  }
  // When the reviser of a rejected draft is finished, a high role of a tree that follows the
  // direction revises the current version again.
  for (const x of w.drafts.values()) {
    const d = w.directions.get(x.of)
    if (x._tag !== 'Change' || d?._tag !== 'Official') continue
    const now = current(w, x.of)
    if (x.base !== `${now.of}@${now.number}` || madeBy(w, x.id) !== undefined) continue
    const veto = vetoOf(w, x.id)
    if (veto === undefined) continue
    const reviser = reviserOf(w, x.id)
    const done = reviser !== undefined && finishedAssignment(assignmentOf(w, reviser))
    const mine = reviser === a.id || (done && followsDirection(w, a.id, x.of))
    if (!mine || !high || !waitsForNewDraft(w, x)) continue
    steps.push({ _tag: 'ReviseRejectedDraft', draft: x.id, reject: veto.id })
  }
  // A high role of a tree that follows the direction answers each open suggestion about it.
  for (const { y, d } of suggestionsToDraft(w)) {
    if (!high || d.source._tag !== 'Local' || !followsDirection(w, a.id, d.id)) continue
    steps.push({ _tag: 'AnswerSuggestion', suggestion: y.id, direction: d.id })
  }
  return steps
}

// The top assignment puts accepted code on its base (the project does it its own way: a merge, or
// a pull request); then it finishes its children and itself.
const acceptedSteps = (w: Work, a: Assignment, cwd: string): ReadonlyArray<NextStep> => {
  const steps: Array<NextStep> = []
  const accepted = latestResult(w, a.task)
  const [repo = '', commit = ''] = accepted?.output.split('@') ?? []
  const space = taskOf(w, a.task).descriptionAi.workspace.find((x) => x.path === repo)
  if (
    accepted &&
    a.parent._tag === 'GivenByPerson' &&
    space?._tag === 'Repo' &&
    /^[0-9a-f]{7,40}$/.test(commit) &&
    !onBase(cwd, repo, commit, space.base)
  ) {
    const base = space.base
    steps.push({ _tag: 'PutOnBase', task: a.task, result: accepted.id, repo, base, commit })
  }
  for (const child of w.assignments.values()) {
    if (parentId(child) === a.id && !finishedAssignment(child)) {
      steps.push({ _tag: 'FinishChild', child: child.id })
    }
  }
  steps.push({ _tag: 'FinishAcceptedTask', task: a.task })
  return steps
}
// The commit is on the base already (git merge-base --is-ancestor).
const onBase = (cwd: string, repo: string, commit: string, base: string): boolean =>
  outsideNow(
    Effect.gen(function* () {
      const git = ['git', '-C', join(cwd || '.', repo), 'merge-base', '--is-ancestor']
      const run = yield* (yield* Spawn).run([...git, commit, base])
      return run.code === 0
    }),
  )

// The steps of one open task of the tree that is not accepted.
const taskSteps = (
  w: Work,
  a: Assignment,
  t: Task,
  at: Time,
  cwd: string,
): ReadonlyArray<NextStep> => {
  const tier = tierOfAssignment(w, a)
  const high = tier === 'high'
  const result = latestResult(w, t.id)
  const items = result ? blockerItems(w, result.id, at) : []
  // A mistake is evaluated before anything else moves the task (Nanda, 2026-11-08).
  if (workStop(w, t.id, at)) return evaluationSteps(w, a, t, at)
  const steps: Array<NextStep> = []
  // A Reject of the task itself waits for a change, also while its parts are open.
  for (const point of taskRejects(w, t.id)) {
    if (items.some((i) => 'ref' in i && i.ref === point)) continue
    steps.push(
      high
        ? { _tag: 'ReviseForReturnedTask', point, task: t.id, directions: directionIdsOf(w, t.id) }
        : { _tag: 'EscalateForReturnedTask', point, task: t.id },
    )
  }
  // The tasks it needs come first. One outside this tree is another tree's work.
  const waitsFor = (n: TaskId) => isOpenTask(taskOf(w, n)) && !taskAccepted(w, n, at)
  for (const n of t.needs) {
    if (waitsFor(n) && !within(w, n, a.task)) {
      steps.push({ _tag: 'WaitsForOutsideNeed', task: t.id, need: n })
    }
  }
  // A part that runs after other parts waits for them; the parts that need nothing open run at
  // the same time.
  for (const n of t.needs) {
    if (waitsFor(n) && within(w, n, a.task) && !servesTask(taskOf(w, n), t.id)) {
      steps.push({ _tag: 'RunsAfter', task: t.id, need: n })
    }
  }
  if (t.needs.some(waitsFor)) return steps
  // An open medium whose task holds this one runs it: first one that this assignment gave the
  // work to, at any depth; else one that another parent gave it.
  const running = [...w.assignments.values()].filter(
    (x) =>
      !finishedAssignment(x) &&
      tierOfAssignment(w, x) === 'medium' &&
      tier !== undefined &&
      RANK[tier] > RANK.medium &&
      within(w, t.id, x.task),
  )
  const lead = running.find((x) => isAbove(w, a.id, x)) ?? running[0]
  if (lead) {
    // A medium runs it; only the change points and this assignment's own turn to decide come
    // up to here.
    steps.push({ _tag: 'MediumRuns', lead: lead.id, task: t.id })
    if (result) {
      steps.push(...changeSteps(w, a, t, result.id, items, false))
      steps.push(...deciderSteps(w, a, result.id, items, at))
    }
    return steps
  }
  const lower = lowerRoles(w, a)
  const mediums = nonEmpty(lower.filter((r) => r.tier === 'medium').map((r) => r.role))
  // A task with a section is one unit of work: a medium role runs it; a task with no section is
  // split first.
  if (high && t.id === a.task && !result && t.needs.length === 0 && mediums) {
    if (sectionOfTask(t) !== null) {
      return [...steps, { _tag: 'RunSectionWithMedium', task: t.id, roles: mediums }]
    }
    if (mayChange(w, a.id, t.id, at)) return [...steps, { _tag: 'SplitFirst', task: t.id }]
  }
  if (t.id !== a.task && mediums) {
    return [...steps, { _tag: 'RunWithMedium', task: t.id, roles: mediums }]
  }
  const changed = result !== undefined && outsideFor(w, cwd, [result]).changed.has(result.id)
  const fix = items.some(
    (i) =>
      (i._tag === 'Reject' &&
        (itemOf(w, i.ref).breaks !== undefined || answered(w, i.ref))) ||
      i._tag === 'Unchanged' ||
      i._tag === 'Recheck',
  )
  if (!result || changed || fix) {
    if (result) steps.push(...changePointSteps(w, a, t, result.id, items, true))
    const makers = lower
      .filter((r) => r.tier === 'low' && r.acts.some((x) => x._tag === 'Do'))
      .map((r) => r.role)
    steps.push(makerStep(w, a, t, result !== undefined, makers, at))
    return steps
  }
  // The work is unchanged after a direction change: the rules of the changed standards are
  // checked again by their own checkers, not made again.
  const again = items.flatMap((i) => (i._tag === 'OldVersion' ? i.rules : []))
  if (items.some((i) => i._tag === 'OldVersion')) {
    steps.push({ _tag: 'CheckAgainUnderNewVersion', result: result.id })
  }
  const rules = [...items.flatMap((i) => (i._tag === 'Evidence' ? [i.ref] : [])), ...again]
  const roles = rules.flatMap((e) => {
    const checkedBy = w.rules.get(e)?.checkedBy
    return checkedBy?._tag === 'Role' ? [checkedBy.role] : []
  })
  steps.push(...checkerSteps(w, a, t, result.id, [...new Set(roles)]))
  steps.push(...changeSteps(w, a, t, result.id, items, false))
  steps.push(...deciderSteps(w, a, result.id, items, at))
  return steps
}

// A task that waits for an evaluation, or for the change that its evaluation asks for. The high
// role of its tree writes the evaluation; everyone else is told whom the task waits for.
const evaluationSteps = (
  w: Work,
  a: Assignment,
  t: Task,
  at: Time,
): ReadonlyArray<NextStep> => {
  const high = tierOfAssignment(w, a) === 'high'
  const steps: Array<NextStep> = []
  // Each stop gets its own evaluation, so each stop that waits gets its own step.
  const stops = stopsOf(w, t.id).filter((s) => !stopAnswered(w, s))
  for (const stop of stops) {
    const key = stopKey(w, stop)
    const pending = [...w.evaluations.values()]
      .filter(
        (e) =>
          stopKey(w, e.answers) === key &&
          evaluationDecision(w, e) === undefined &&
          !evaluationCounts(w, e),
      )
      .at(-1)
    if (pending) {
      steps.push({ _tag: 'EvaluationWaitsForOwner', evaluation: pending.id, task: t.id })
      continue
    }
    if (high) {
      steps.push({ _tag: 'Evaluate', task: t.id, stop })
      continue
    }
    const evaluator = [...w.assignments.values()].find(
      (x) =>
        !finishedAssignment(x) && tierOfAssignment(w, x) === 'high' && within(w, t.id, x.task),
    )
    steps.push(
      evaluator
        ? { _tag: 'WaitsForEvaluationBy', task: t.id, stop, evaluator: evaluator.id }
        : { _tag: 'WaitsForEvaluationNoHigh', task: t.id, stop },
    )
  }
  if (stops.length > 0) return steps
  // Evaluated; the next maker starts only on inputs that differ from those that failed.
  const e = evaluationOfTask(w, t.id)
  const evaluation = e?.id ?? null
  // The change is made: a split gives the task parts, and a draft waits for its deciders.
  if ([...w.tasks.values()].some((p) => servesTask(p, t.id) && isOpenTask(p))) {
    return [{ _tag: 'WaitsForParts', task: t.id, evaluation }]
  }
  const pending = directionIdsOf(w, t.id).flatMap((d) => openDrafts(w, d))[0]
  if (pending) {
    return [{ _tag: 'DraftOfEvaluationWaits', task: t.id, draft: pending.id, evaluation }]
  }
  if (!high) return [{ _tag: 'WaitsForChangeOfEvaluation', task: t.id, evaluation }]
  // A task with no direction gets its change through a remake; so does a change of the task.
  if (e?.level === 'task' || directionIdsOf(w, t.id).length === 0) {
    const oneUnit = sectionOfTask(t) !== null
    return [
      mayChange(w, a.id, t.id, at)
        ? { _tag: 'RemakeAsEvaluated', task: t.id, evaluation, oneUnit }
        : { _tag: 'EscalateForRemake', task: t.id, evaluation, oneUnit },
    ]
  }
  return [
    { _tag: 'ReviseAsEvaluated', task: t.id, evaluation, directions: directionIdsOf(w, t.id) },
  ]
}

// The change points of a result, unless this assignment escalated the result already.
const changeSteps = (
  w: Work,
  a: Assignment,
  t: Task,
  result: ResultId,
  items: ReadonlyArray<Blocker>,
  first: boolean,
): ReadonlyArray<NextStep> =>
  openEscalations(w, result).some((e) => e.by === a.id)
    ? []
    : changePointSteps(w, a, t, result, items, first)
// One step for each point that needs a direction change. An open draft for a direction of the
// task waits for its deciders; a second revise would only make another draft.
const changePointSteps = (
  w: Work,
  a: Assignment,
  t: Task,
  result: ResultId,
  items: ReadonlyArray<Blocker>,
  first: boolean,
): ReadonlyArray<NextStep> =>
  items.flatMap((item): ReadonlyArray<NextStep> => {
    const point = changePoint(w, item)
    if (point === undefined) return []
    const pending = directionIdsOf(w, t.id).flatMap((d) => openDrafts(w, d).map((x) => x.id))
    const drafts = nonEmpty(pending)
    if (drafts) return [{ _tag: 'ChangeWaitsForDraft', point, drafts, first }]
    return [
      tierOfAssignment(w, a) === 'high'
        ? { _tag: 'ReviseForPoint', point, directions: directionIdsOf(w, t.id), first }
        : { _tag: 'EscalateForPoint', point, result, first },
    ]
  })

// Who makes the next result of a task: the open maker that waits for its file, works, or waits
// for a subagent; else a new maker, or an escalation when no lower role makes it.
const makerStep = (
  w: Work,
  a: Assignment,
  t: Task,
  redo: boolean,
  makers: ReadonlyArray<RoleName>,
  at: Time,
): NextStep => {
  const maker = [...w.assignments.values()].find(
    (x) => x.task === t.id && !finishedAssignment(x) && openDo(w, x.id),
  )
  const waits = maker && fileTurn(w, maker.id, at)
  if (maker && waits) return { _tag: 'MakerWaitsForFile', maker: maker.id, ...waits }
  if (maker && claimedSince(w, maker.id) !== undefined) {
    return { _tag: 'MakerWorking', maker: maker.id, task: t.id }
  }
  if (maker) {
    const ownChild = parentId(maker) === a.id
    return { _tag: 'GiveMakerCommand', maker: maker.id, task: t.id, redo, ownChild }
  }
  const roles = nonEmpty(makers)
  return roles ? { _tag: 'AssignMaker', task: t.id, roles } : { _tag: 'NoMakerRole', task: t.id }
}

// The checker of each role that checks a rule of the result: a program runs on a report; this
// assignment checks itself; a child checks; or a new checker is assigned (a role of the same or
// a higher tier: by a higher tier).
const checkerSteps = (
  w: Work,
  a: Assignment,
  t: Task,
  result: ResultId,
  roles: ReadonlyArray<RoleName>,
): ReadonlyArray<NextStep> =>
  roles.map((role): NextStep => {
    const r = w.workflow.roles.get(role)
    if (r?._tag === 'Program') return { _tag: 'ProgramChecksNextReport', role, task: t.id, result }
    // Only a child of this assignment is this assignment's to start or free.
    const checker = [...w.assignments.values()].find(
      (x) =>
        x.task === t.id && !finishedAssignment(x) && x.role === role && parentId(x) === a.id,
    )
    if (role === a.role) return { _tag: 'CheckYourself', result }
    if (checker && claimedSince(w, checker.id) !== undefined) {
      return { _tag: 'CheckerWorking', checker: checker.id, result }
    }
    if (checker) return { _tag: 'GiveCheckerCommand', checker: checker.id, result, task: t.id }
    const own = tierOfAssignment(w, a)
    if (r?._tag === 'Model' && own !== undefined && RANK[r.tier] >= RANK[own]) {
      return { _tag: 'CheckerOfHigherTier', result, role }
    }
    return { _tag: 'AssignChecker', result, role, task: t.id }
  })

// The decider decides when only its accept is left; it may Reject instead. Otherwise the step
// says whose accept the decision waits for, so that the work does not look finished.
const deciderSteps = (
  w: Work,
  a: Assignment,
  result: ResultId,
  items: ReadonlyArray<Blocker>,
  at: Time,
): ReadonlyArray<NextStep> => {
  const decider = items.find(isDeciderItem)
  if (!decider || !items.every(isDeciderItem)) return []
  if (decidesNow(w, a.id, result, at)) {
    return [{ _tag: 'Decide', result, again: decider._tag === 'DeciderAcceptedUnderOld' }]
  }
  const task = w.results.get(result)?.task
  if (task === undefined) throw new Error(`the work has no result ${result}`)
  const lower = lowerRoles(w, a).map((r) => r.role)
  return decisionWaitsOn(w, result).map((leaf): NextStep => {
    const open =
      leaf._tag === 'Role'
        ? [...w.assignments.values()].find(
            (x) => !finishedAssignment(x) && x.role === leaf.role && within(w, task, x.task),
          )
        : undefined
    if (open) return { _tag: 'WaitsForDecider', result, decider: open.id }
    // A role of a lower tier is this assignment's to give; a higher one is the person's.
    if (leaf._tag === 'Role' && lower.includes(leaf.role)) {
      return { _tag: 'AssignDecider', result, role: leaf.role, task }
    }
    return { _tag: 'DeciderByPerson', result, leaf, task }
  })
}

// --- the words -----------------------------------------------------------------------------------

export interface LineOptions {
  readonly token: string
  readonly at: Time
}

// The lines that work next prints (the old nextSteps text, line for line): what to do, then the
// command, indented by two.
export const nextLines = (
  w: Work,
  steps: ReadonlyArray<NextStep>,
  options: LineOptions,
): ReadonlyArray<string> => steps.flatMap((s) => linesOf(w, s, options))

// A step: its words, and its command when it has one.
const step = (what: string, command?: string): ReadonlyArray<string> =>
  command === undefined ? [what] : [what, `  ${command}`]

const nameOf = (w: Work, task: TaskId): string => w.tasks.get(task)?.name ?? task
const stateWord = (w: Work, task: TaskId, at: Time): string =>
  taskStateWord(taskState(w, task, at))
const roleOfId = (w: Work, a: AssignmentId): string => w.assignments.get(a)?.role ?? a
const evaluationWord = (e: EvaluationId | null): string => e ?? 'the evaluation'
const asksWords = (w: Work, e: EvaluationId | null): string => {
  const improve = e === null ? '' : (w.evaluations.get(e)?.improve.join('; ') ?? '')
  return `${evaluationWord(e)} asks for: "${short(improve, 160)}"`
}
const reasonOf = (w: Work, review: string): string => itemOf(w, review).reason ?? ''
// The standard of a direction's current version that a suggestion is about (itself, or the one
// that holds its rule).
const holderStandard = (
  w: Work,
  d: DirectionId,
  about: Suggestion['about'],
): Standard | undefined =>
  current(w, d)
    .standards.map((e) => w.standards.get(e))
    .find(
      (s) =>
        s !== undefined &&
        (about._tag === 'Standard'
          ? s.entry === about.standard
          : about._tag === 'Rule' && s.rules.includes(about.rule)),
    )

// The token is shown only at assign; a parent that lost it ends the child and assigns again.
const lostToken = (w: Work, child: AssignmentId, task: TaskId, token: string): string => {
  const role = roleOfId(w, child)
  return (
    `  the token is the one that work assign printed for ${child}; give the same command to a ` +
    `new subagent. Only if you lost that token: work finish ${token} ${child}, then work assign ` +
    `${token} ${task} --role=${role}` +
    (isDo(w, role)
      ? ' (a new maker; when its latest try has a fault, the task waits for an evaluation first)'
      : '')
  )
}

// What stopped a task, as an evaluation step names it.
const stopWords = (w: Work, stop: Stop): string => {
  const sid = stopIdOf(w, stop)
  if (stop._tag === 'Exhaustion') {
    const x = w.exhaustions.get(stop.id)
    if (x === undefined) throw new Error(`the work has no exhaustion ${stop.id}`)
    const result = exhaustionResult(w, x)
    const reason = short(reasonOf(w, x.fault), 100)
    return `${result.by} used its last try on a fault (${sid}: ${result.id}, ${reason})`
  }
  // The person's Reject is one act: its first point speaks for it.
  const first = itemOf(w, `${stop.id}.1`)
  return `${who(w, first.by)} rejected ${first.of.id} (${sid}): "${short(first.reason ?? '', 100)}"`
}

const linesOf = (w: Work, s: NextStep, { token, at }: LineOptions): ReadonlyArray<string> => {
  switch (s._tag) {
    case 'ReadSource':
      return step(
        `read ${s.source} again: ${s.source}@${s.revision} was read at ${s.seenAt}, more than ` +
          `${s.hours} hours ago; then run work source ${token} ${s.source}@<its revision now>`,
      )
    case 'Answer':
      return step(
        `answer ${s.question}: ${short(w.questions.get(s.question)?.text ?? '', 200)}`,
        `work answer ${token} ${s.question} --text="<the answer>"`,
      )
    case 'Resolve':
      return step(
        `resolve ${s.escalation} on ${s.result}: ${reasonOf(w, s.escalation)}`,
        `work resolve ${token} ${s.escalation} ` +
          '--resolution="<the agreement, or the direction, in words>"',
      )
    case 'RecheckStaleSource':
      return step(
        `${s.result} was built on ${s.source}@${s.was}; ${s.source} is now at ${s.now}`,
        `work recheck ${token} ${s.result} --reason="${s.source} is now at ${s.now}"`,
      )
    case 'RecheckOldNeed': {
      const newer = `${s.newer} of ${s.need}`
      return step(
        `${s.result} was made before ${newer}; its maker reports again with that work`,
        `work recheck ${token} ${s.result} --reason="${newer} is newer; use it"`,
      )
    }
    case 'FinishChildOfClosedTask':
      return step(
        `finish ${s.child}: its task ${s.task} is closed` +
          `${s.replacedBy === null ? '' : `, and ${s.replacedBy} replaces it`}`,
        `work finish ${token} ${s.child}`,
      )
    case 'FinishInClosedTask':
      return step(
        `${s.task} is closed: finish your children, then yourself`,
        `work finish ${token}`,
      )
    case 'FinishIdleChild':
      return step(
        `finish ${s.child}: ${idleWords(w, s.idle)}, and ${s.waiters.join(', ')} ` +
          `${s.waiters.length > 1 ? 'wait' : 'waits'} for ${s.file}`,
        `work finish ${token} ${s.child}`,
      )
    case 'ReviewDraft': {
      const of = w.drafts.get(s.draft)?.of
      const name = of === undefined ? '' : (w.directions.get(of)?.name ?? of)
      return step(
        `review ${s.draft}: a draft of ${name} waits for your accept; read it, and ask each ` +
          'question of work guide direction-review',
        `work direction show ${s.draft}, then work review ${token} ${s.draft} accept ` +
          `--evidence="<where you read in ${s.draft}> | <what you saw>", ` +
          'or reject --reason="<why>"',
      )
    }
    case 'ReviseRejectedDraft': {
      const veto = itemOf(w, s.reject)
      const of = w.drafts.get(s.draft)?.of ?? ''
      return step(
        `${s.draft} is rejected by ${who(w, veto.by)}: "${short(veto.reason ?? '', 120)}"; ` +
          'revise the current version again',
        `work direction revise ${token} ${of} --file=<edit.yaml> --answers=${s.reject}`,
      )
    }
    case 'AnswerSuggestion': {
      const y = w.suggestions.get(s.suggestion)
      if (y === undefined) throw new Error(`the work has no suggestion ${s.suggestion}`)
      const needs =
        y.about._tag === 'Direction'
          ? `a draft that changes what ${s.direction} says`
          : `a draft that changes the standard ${holderStandard(w, s.direction, y.about)?.id}`
      return step(
        `${s.suggestion} suggests about ${aboutId(w, y.about)}: "${short(y.says, 120)}" ` +
          `(${who(w, y.by)}); answer it with ${needs}`,
        `work direction revise ${token} ${s.direction} --file=<edit.yaml> ` +
          `--answers=${s.suggestion}`,
      )
    }
    case 'PutOnBase': {
      const output = `${s.repo}@${s.commit}`
      return step(
        `put ${output} on ${s.base}: ${s.task} is accepted, and its commit is not on ${s.base} ` +
          'yet. When the repo has a rule for merges (a pull request), follow it; else run the ' +
          'example below. When the merge fails, or the base is protected, escalate with the error',
        `for example: git -C ${s.repo} checkout ${s.base} && git -C ${s.repo} merge ${s.commit}`,
      )
    }
    case 'FinishChild':
      return step(`finish ${s.child}`, `work finish ${token} ${s.child}`)
    case 'FinishAcceptedTask':
      return step(`${s.task} is accepted: finish yourself`, `work finish ${token}`)
    case 'EvaluationWaitsForOwner':
      return step(
        `${s.evaluation} evaluates ${s.task} at the level ` +
          `${w.evaluations.get(s.evaluation)?.level}, and waits for ` +
          `${taskOf(w, s.task).owner.name}'s accept`,
      )
    case 'Evaluate':
      return step(
        `evaluate ${s.task}: ${stopWords(w, s.stop)}. Say what is wrong, why it cannot be ` +
          'done as asked, and what to improve; the level is that of the deepest cause',
        `work evaluate ${token} ${stopIdOf(w, s.stop)} --wrong="<what is wrong, with the results ` +
          'and the rules>" --why="<why it cannot be done as asked>" --improve="<one change; one ' +
          '--improve for each change>" --level=task|standard|direction|principle',
      )
    case 'WaitsForEvaluationBy':
      return step(
        `${s.task} waits for an evaluation by ${s.evaluator} (${roleOfId(w, s.evaluator)}): ` +
          stopWords(w, s.stop),
      )
    case 'WaitsForEvaluationNoHigh':
      return step(
        `${s.task} waits for an evaluation: ${stopWords(w, s.stop)}; no high role works on it, ` +
          'so the person assigns one',
      )
    case 'WaitsForParts':
      return step(`${s.task} waits for its parts, as ${evaluationWord(s.evaluation)} asks`)
    case 'DraftOfEvaluationWaits':
      return step(
        `${s.task}: ${s.draft} waits for the accept of ${draftWaitsText(w, s.draft)}; it is the ` +
          `change that ${evaluationWord(s.evaluation)} asks for (work direction show ${s.draft})`,
      )
    case 'WaitsForChangeOfEvaluation':
      return step(`${s.task} waits for the change that ${asksWords(w, s.evaluation)}`)
    case 'RemakeAsEvaluated':
    case 'EscalateForRemake': {
      const what = s.oneUnit
        ? 'remake it (its section is one unit, so it is not split)'
        : 'remake or split it'
      const eid = evaluationWord(s.evaluation)
      return step(
        `${s.task}: ${asksWords(w, s.evaluation)}; ${what}, then a new maker starts`,
        s._tag === 'RemakeAsEvaluated'
          ? `work task remake ${token} ${s.task} --file=<task.yaml> --reason="as ${eid} says"` +
              (s.oneUnit ? '' : `, or work task split ${token} ${s.task} --file=<parts.yaml>`)
          : `work escalate ${token} --reason="${s.task} needs the remake that ${eid} asks for"`,
      )
    }
    case 'ReviseAsEvaluated':
      return step(
        `${s.task}: ${asksWords(w, s.evaluation)}; draft that change, then a new maker starts ` +
          'when its deciders accept it',
        `work direction revise ${token} ${s.directions.join('|')} --file=<edit.yaml>`,
      )
    case 'ReviseForReturnedTask':
    case 'EscalateForReturnedTask':
      // The owner's own split or remake answers too (the old words name the owner for every
      // Reject of a task).
      return step(
        `${s.point} returns ${s.task}: "${reasonOf(w, s.point)}"; a direction change, or ` +
          `${taskOf(w, s.task).owner.name}'s own split or remake, answers it`,
        s._tag === 'ReviseForReturnedTask'
          ? `work direction revise ${token} ${s.directions.join('|')} --file=<edit.yaml>`
          : `work escalate ${token} --reason="${s.point} needs a direction change or a split ` +
            `of ${s.task}"`,
      )
    case 'WaitsForOutsideNeed':
      return step(
        `${s.task} waits for ${s.need} ${nameOf(w, s.need)} (${stateWord(w, s.need, at)}), which ` +
          'is outside your task tree; wait until it is accepted, or escalate if it must change',
      )
    case 'RunsAfter':
      return step(
        `${s.task} ${nameOf(w, s.task)} runs after ${s.need} ${nameOf(w, s.need)} ` +
          `(${stateWord(w, s.need, at)}); its maker starts when ${s.need} is accepted`,
      )
    case 'MediumRuns':
      return step(`${s.lead} (${roleOfId(w, s.lead)}) runs ${s.task} ${nameOf(w, s.task)}`)
    case 'RunSectionWithMedium':
      return step(
        `run ${s.task} with a medium role (its section ${sectionOfTask(taskOf(w, s.task))} is one ` +
          'unit, so it is not split)',
        `work assign ${token} ${s.task} --role=${s.roles.join('|')}`,
      )
    case 'SplitFirst':
      return step(
        `split ${s.task} first, then give each part to a medium role`,
        `work task split ${token} ${s.task} --file=<parts.yaml>`,
      )
    case 'RunWithMedium':
      return step(
        `run ${s.task} ${nameOf(w, s.task)} with a medium role`,
        `work assign ${token} ${s.task} --role=${s.roles.join('|')}`,
      )
    case 'ChangeWaitsForDraft':
      return step(
        `${s.point} needs a direction change${s.first ? ' first' : ''}; ${s.drafts.join(', ')} ` +
          `waits for the accept of ${draftWaitsText(w, s.drafts[0])} ` +
          `(work direction show ${s.drafts[0]})`,
      )
    case 'ReviseForPoint':
    case 'EscalateForPoint':
      return step(
        `${s.point} needs a direction change${s.first ? ' first' : ''}: "${reasonOf(w, s.point)}"`,
        s._tag === 'ReviseForPoint'
          ? `work direction revise ${token} ${s.directions.join('|')} --file=<edit.yaml> ` +
              `--answers=${s.point}`
          : `work escalate ${token} --result=${s.result} ` +
            `--reason="${s.point} needs a direction change"`,
      )
    case 'MakerWaitsForFile': {
      const task = w.assignments.get(s.before)?.task
      return step(
        `${s.maker} waits for ${s.file}: ${s.before} (${task} ${task ? nameOf(w, task) : ''}) ` +
          'writes it first, and one maker writes a file at a time; ' +
          `start ${s.maker} when ${s.before} finishes`,
      )
    }
    case 'MakerWorking':
      return step(
        `${s.maker} is working on ${s.task} (claimed since ${clock(claimedSince(w, s.maker))}); ` +
          'if its subagent stopped:',
        `work free ${token} ${s.maker}`,
      )
    case 'GiveMakerCommand':
      return [
        ...step(
          `${s.redo ? 'redo' : 'make'} ${s.task}: give a new subagent the command of ${s.maker} ` +
            `(${attemptWords(w, s.maker)})`,
          `work brief ${s.maker}.<the token that assign printed>`,
        ),
        ...(s.ownChild ? [lostToken(w, s.maker, s.task, token)] : []),
      ]
    case 'AssignMaker':
      return step(
        `make ${s.task} ${nameOf(w, s.task)}`,
        `work assign ${token} ${s.task} --role=${s.roles.join('|')}`,
      )
    case 'NoMakerRole':
      return step(
        `${s.task} needs a new result, and no lower role makes it`,
        `work escalate ${token} --reason="no role makes ${s.task}"`,
      )
    case 'CheckAgainUnderNewVersion':
      return step(`check ${s.result} again under the new version`)
    case 'ProgramChecksNextReport':
      return step(
        `${s.role} runs on the next report of ${s.task}; a recheck asks for one`,
        `work recheck ${token} ${s.result} --reason="check again under the new version"`,
      )
    case 'CheckYourself':
      return step(
        `check ${s.result} yourself`,
        `work review ${token} ${s.result} accept --evidence="<rule id> | <where> | <what>"`,
      )
    case 'CheckerWorking':
      return step(
        `${s.checker} is checking ${s.result} (claimed since ` +
          `${clock(claimedSince(w, s.checker))}); if its subagent stopped:`,
        `work free ${token} ${s.checker}`,
      )
    case 'GiveCheckerCommand':
      return [
        ...step(
          `check ${s.result}: give a new subagent the command of ${s.checker}; the same ` +
            'assignment checks each new result, with the token that work assign printed for it',
          `work brief ${s.checker}.<the token that assign printed>`,
        ),
        lostToken(w, s.checker, s.task, token),
      ]
    case 'CheckerOfHigherTier':
      return step(
        `${s.result} needs ${s.role}, which only a higher tier assigns`,
        `work escalate ${token} --result=${s.result} --reason="${s.result} needs ${s.role}"`,
      )
    case 'AssignChecker':
      return step(
        `check ${s.result} with ${s.role}`,
        `work assign ${token} ${s.task} --role=${s.role}`,
      )
    case 'Decide': {
      const output = w.results.get(s.result)?.output ?? ''
      return step(
        s.again ? `decide ${s.result} again under the new version` : `decide ${s.result}`,
        `work review ${token} ${s.result} accept --evidence="<the place in ${output} where you ` +
          'read it> | <what you saw there>", or reject it with --point',
      )
    }
    case 'WaitsForDecider':
      return step(`${s.result} waits for the accept of ${s.decider} (${roleOfId(w, s.decider)})`)
    case 'AssignDecider':
      return step(
        `${s.result} waits for the accept of ${an(s.role)}, and no ${s.role} works on ${s.task}`,
        `work assign ${token} ${s.task} --role=${s.role}`,
      )
    case 'DeciderByPerson': {
      const name = leafName(s.leaf)
      return step(
        `${s.result} waits for the accept of ${an(name)}, and no ${name} works on ${s.task}; ` +
          'the person assigns one',
      )
    }
  }
}

// --- the key -------------------------------------------------------------------------------------

// The ids that a step names, by its tag: what the watcher compares. No words, no times, no
// revisions, no flags. A new member fails the compile here until it has its key.
const IDS: { readonly [K in StepTag]: (s: StepOf<K>) => ReadonlyArray<string> } = {
  ReadSource: (s) => [s.source],
  Answer: (s) => [s.question],
  Resolve: (s) => [s.escalation, s.result],
  RecheckStaleSource: (s) => [s.result, s.source],
  RecheckOldNeed: (s) => [s.result, s.need, s.newer],
  FinishChildOfClosedTask: (s) => [s.child, s.task, ...(s.replacedBy ? [s.replacedBy] : [])],
  FinishInClosedTask: (s) => [s.task],
  FinishIdleChild: (s) => [s.child, ...s.waiters],
  ReviewDraft: (s) => [s.draft],
  ReviseRejectedDraft: (s) => [s.draft, s.reject],
  AnswerSuggestion: (s) => [s.suggestion, s.direction],
  PutOnBase: (s) => [s.task, s.result],
  FinishChild: (s) => [s.child],
  FinishAcceptedTask: (s) => [s.task],
  EvaluationWaitsForOwner: (s) => [s.evaluation, s.task],
  Evaluate: (s) => [s.task, s.stop.id],
  WaitsForEvaluationBy: (s) => [s.task, s.stop.id, s.evaluator],
  WaitsForEvaluationNoHigh: (s) => [s.task, s.stop.id],
  WaitsForParts: (s) => [s.task, ...(s.evaluation ? [s.evaluation] : [])],
  DraftOfEvaluationWaits: (s) => [s.task, s.draft, ...(s.evaluation ? [s.evaluation] : [])],
  WaitsForChangeOfEvaluation: (s) => [s.task, ...(s.evaluation ? [s.evaluation] : [])],
  RemakeAsEvaluated: (s) => [s.task, ...(s.evaluation ? [s.evaluation] : [])],
  EscalateForRemake: (s) => [s.task, ...(s.evaluation ? [s.evaluation] : [])],
  ReviseAsEvaluated: (s) => [s.task, ...(s.evaluation ? [s.evaluation] : []), ...s.directions],
  ReviseForReturnedTask: (s) => [s.point, s.task, ...s.directions],
  EscalateForReturnedTask: (s) => [s.point, s.task],
  WaitsForOutsideNeed: (s) => [s.task, s.need],
  RunsAfter: (s) => [s.task, s.need],
  MediumRuns: (s) => [s.lead, s.task],
  RunSectionWithMedium: (s) => [s.task, ...s.roles],
  SplitFirst: (s) => [s.task],
  RunWithMedium: (s) => [s.task, ...s.roles],
  ChangeWaitsForDraft: (s) => [s.point, ...s.drafts],
  ReviseForPoint: (s) => [s.point, ...s.directions],
  EscalateForPoint: (s) => [s.point, s.result],
  MakerWaitsForFile: (s) => [s.maker, s.before],
  MakerWorking: (s) => [s.maker, s.task],
  GiveMakerCommand: (s) => [s.maker, s.task],
  AssignMaker: (s) => [s.task, ...s.roles],
  NoMakerRole: (s) => [s.task],
  CheckAgainUnderNewVersion: (s) => [s.result],
  ProgramChecksNextReport: (s) => [s.role, s.task, s.result],
  CheckYourself: (s) => [s.result],
  CheckerWorking: (s) => [s.checker, s.result],
  GiveCheckerCommand: (s) => [s.checker, s.result, s.task],
  CheckerOfHigherTier: (s) => [s.result, s.role],
  AssignChecker: (s) => [s.result, s.role, s.task],
  Decide: (s) => [s.result],
  WaitsForDecider: (s) => [s.result, s.decider],
  AssignDecider: (s) => [s.result, s.role, s.task],
  DeciderByPerson: (s) => [s.result, leafName(s.leaf), s.task],
}
const keyOf = (s: NextStep): string =>
  [s._tag, ...(IDS[s._tag] as (s: NextStep) => ReadonlyArray<string>)(s)].join(' ')

// The words-free key of a list of steps: one line per step, its tag and its ids. Equal keys:
// nothing to wake for.
export const stepKey = (steps: ReadonlyArray<NextStep>): string => steps.map(keyOf).join('\n')
