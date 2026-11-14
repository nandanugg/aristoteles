// The derived catalog (plan/rebuild/BUILD.md 3.4): one function per state, in the order of
// derive(). A dependent takes the state of its dependency as a parameter (R1: no cascade event):
// an ended task ends its assignments, makes its questions and problems irrelevant, and moves the
// placement of its decisions, here and nowhere else.
import { leavesOf } from './deciders.ts'
import {
  assignmentAt,
  blockersOfResult,
  currentTask,
  decidersOfDraft,
  directionAt,
  draftAcceptItems,
  draftAt,
  draftWaitsFor,
  evaluationDecision,
  evaluationCounts,
  evaluationWaits,
  evaluationWaitsRef,
  isPerson,
  actorOf,
  latestResultOf,
  madeBy,
  maxOf,
  openedTopOf,
  openQuestions,
  openTaskReject,
  problemTask,
  refOf,
  resultAt,
  roleAt,
  rootOf,
  ruleAt,
  runOfTree,
  taskAt,
  usedBy,
  vetoItem,
  within,
  versionAt,
  versionNumberOf,
} from './reads.ts'
import {
  type AssignmentStateOf,
  type AttemptOf,
  type AnswererNow,
  type BlockersOf,
  type Derive,
  type DirectionStateOf,
  type DraftLeaf,
  type EscalationStateOf,
  type EvaluationStateOf,
  type ForwardStateOf,
  type ForwardTarget,
  type HostOf,
  isEndedTask,
  type LatestResult,
  type PermissionStateOf,
  type PlacementOf,
  type ProblemStateOf,
  type QuestionStateOf,
  type ResultStateOf,
  type RevisionStateOf,
  type RunStateOf,
  type RunTop,
  type SendAbout,
  type SendStateOf,
  type SessionOwner,
  type SendTarget,
  type SourceSeen,
  type SourceStatesOf,
  type States,
  type TaskDraftStateOf,
  type TaskStateOf,
  type AssignmentState,
  type DirectionState,
  type EscalationState,
  type ForwardState,
  type ProblemState,
  type QuestionState,
  type ResultState,
  type RevisionState,
  type SendState,
} from './types.ts'
import {
  type Answerer,
  type AssignmentId,
  type Direction,
  type EscalationId,
  type EvaluationId,
  type EvaluationState,
  type EventRef,
  type NonEmpty,
  type PermissionId,
  type PermissionState,
  type ProblemId,
  type QuestionId,
  type RejectId,
  type ResultId,
  type Revision,
  type RevisionId,
  type RunId,
  type RunState,
  type Send,
  type SessionId,
  type Task,
  type TaskDraftId,
  type TaskDraftState,
  type TaskId,
  type TaskState,
  versionIdOf,
  type VersionId,
  type Work,
} from '../schema/index.ts'
import type { Moment } from '../state/index.ts'
import { roleWordsStates } from './role-words.ts'

const need = <K, V>(value: V | undefined, what: string, key: K): V => {
  if (value === undefined) throw new Error(`the work has no ${what} ${String(key)}`)
  return value
}

// --- 1. PermissionState --------------------------------------------------------------------------
export const permissionStateOf: PermissionStateOf = (x, at) => {
  const t = Date.parse(at)
  if (x.revoked._tag === 'Revoked' && t >= Date.parse(x.revoked.at)) return { _tag: 'Revoked' }
  if (t < Date.parse(x.when)) return { _tag: 'NotYet' }
  if (t > Date.parse(x.until)) return { _tag: 'Ended' }
  return { _tag: 'Covers' }
}

// --- 2. DirectionState ---------------------------------------------------------------------------
export const directionStateOf: DirectionStateOf = (m, id) => {
  const d = directionAt(m.work, id)
  if (d._tag === 'NewDirection') return { _tag: 'Drafted' }
  const current = d.versions[d.versions.length - 1] ?? d.versions[0]
  return { _tag: 'Official', current: versionIdOf(current) }
}

// --- 3. RevisionState (S2, S6, S7) ---------------------------------------------------------------

// S7: a rule id that this draft adds and that the current version of another direction has, or
// that an earlier pending draft of another direction adds (the earlier one keeps it); or an id
// that the draft names twice.
const conflictOf = (
  w: Work,
  x: Revision<Direction>,
): { readonly rule: string; readonly with: RevisionId | VersionId } | undefined => {
  const base = x._tag === 'Change' ? versionAt(w, x.of, versionNumberOf(x.base)) : undefined
  const before = new Set((base?.standards ?? []).flatMap((e) => w.standards.get(e)?.rules ?? []))
  const rulesOf = (standards: ReadonlyArray<string>) =>
    standards.flatMap((e) => w.standards.get(e as never)?.rules ?? [])
  const added = rulesOf(x.standards)
    .filter((r) => !before.has(r))
    .map((r) => ruleAt(w, r).id)
  for (const d of w.directions.values()) {
    if (d._tag !== 'Official' || d.id === x.of) continue
    const now = d.versions[d.versions.length - 1] ?? d.versions[0]
    const ids = new Set(rulesOf(now.standards).map((r) => ruleAt(w, r).id))
    const twin = added.find((id) => ids.has(id))
    if (twin !== undefined) return { rule: twin, with: versionIdOf(now) }
  }
  for (const y of w.drafts.values()) {
    if (y.of === x.of || y.at >= x.at || !pending(w, y)) continue
    const ids = new Set(rulesOf(y.standards).map((r) => ruleAt(w, r).id))
    const twin = added.find((id) => ids.has(id))
    if (twin !== undefined) return { rule: twin, with: y.id }
  }
  const all = rulesOf(x.standards).map((r) => ruleAt(w, r).id)
  const repeated = all.find((id, i) => all.indexOf(id) !== i)
  return repeated === undefined ? undefined : { rule: repeated, with: x.id }
}
// A draft that may still become official: not official, not vetoed, built on the current version.
const pending = (w: Work, y: Revision<Direction>): boolean => {
  if (madeBy(w, y.id) !== undefined || vetoItem(w, y.id) !== undefined) return false
  const d = w.directions.get(y.of)
  if (d?._tag !== 'Official') return y._tag === 'New'
  const now = d.versions[d.versions.length - 1] ?? d.versions[0]
  return y._tag === 'Change' && y.base === versionIdOf(now)
}
export const revisionStateOf: RevisionStateOf = (m, id, { direction }) => {
  const w = m.work
  const x = draftAt(w, id)
  const made = madeBy(w, id)
  if (made !== undefined) return { _tag: 'Official', version: versionIdOf(made) }
  // S6: Outdated before Vetoed: a draft on an old base is not revised again.
  if (direction._tag === 'Official' && (x._tag === 'New' || x.base !== direction.current)) {
    return { _tag: 'Outdated', current: direction.current }
  }
  const conflict = conflictOf(w, x)
  if (conflict !== undefined) return { _tag: 'Conflicted', ...conflict }
  const veto = vetoItem(w, id)
  if (veto !== undefined) return { _tag: 'Vetoed', by: veto.review.id as RejectId }
  // A draft that every decider accepted and that is not official waits for its deciders again.
  const next = draftWaitsFor(w, id)
  const leaves = next.length > 0 ? next : leavesOf(decidersOfDraft(w, id))
  // The owner's own leaf stands for the owner's name: one accept of the person meets both.
  const ownerLeaf = leaves.some((l) => l._tag === 'OwnerAccept')
  const owner = directionAt(w, x.of).owner.name
  const waitsFor = leaves.filter((l) => !(ownerLeaf && l._tag === 'Human' && l.name === owner))
  return { _tag: 'Waiting', waitsFor: waitsFor as unknown as NonEmpty<DraftLeaf> }
}

// --- 4. ResultState (S5): the latest of its task, read once --------------------------------------
export const resultStateOf: ResultStateOf = (m, id) => {
  const w = m.work
  const latest = latestResultOf(w, resultAt(w, id).task)
  if (latest !== undefined && latest.id !== id) return { _tag: 'Superseded', by: latest.id }
  const items = blockersOfResult(w, id)
  if (items.length === 0) return { _tag: 'Accepted' }
  return items.some((i) => i._tag === 'Reject') ? { _tag: 'Rejected' } : { _tag: 'InReview' }
}

// --- 5. The blockers of a result -----------------------------------------------------------------
export const blockersOf: BlockersOf = (m, id) => blockersOfResult(m.work, id)

// --- 6. TaskState (C4) ---------------------------------------------------------------------------
// An open question and a stop that waits are facts here (their own states come later in 3.4).
export const taskStateOf: TaskStateOf = (m, id, { latest, needs }) => {
  const w = m.work
  const t = taskAt(w, id)
  if (t.end._tag === 'Closed') return { _tag: 'Closed' }
  if (t.end._tag === 'Replaced') return { _tag: 'Replaced', next: t.end.next }
  const reject = openTaskReject(w, id)
  if (reject !== undefined) {
    const stop = evaluationWaits(w, id)
    if (stop !== undefined) return { _tag: 'WaitsForEvaluation', stop }
    return { _tag: 'Returned', reject: reject.id as never }
  }
  const accepted =
    openQuestions(w, id).length === 0 &&
    evaluationWaitsRef(w, id) === undefined &&
    latest._tag === 'Latest' &&
    latest.state._tag === 'Accepted' &&
    needs.every((n) => n._tag === 'Accepted')
  if (accepted) return { _tag: 'Accepted' }
  return latest._tag === 'Latest' ? { _tag: 'InReview' } : { _tag: 'Open' }
}

// --- 7. EvaluationState --------------------------------------------------------------------------
export const evaluationStateOf: EvaluationStateOf = (m, id) => {
  const w = m.work
  const x = need(w.evaluations.get(id), 'evaluation', id)
  const decision = evaluationDecision(w, x)
  if (decision?._tag === 'Reject') return { _tag: 'Rejected', by: decision.id as RejectId }
  return evaluationCounts(w, x) ? { _tag: 'Counts' } : { _tag: 'WaitsForOwner' }
}

// --- 8. AssignmentState (C1, S4, S9, B5, I2) -----------------------------------------------------
export const assignmentStateOf: AssignmentStateOf = (m, id, { task, parent }) => {
  const x = assignmentAt(m.work, id)
  if (x.end._tag === 'Finished') {
    return { _tag: 'Ended', why: { _tag: 'Finished', when: x.end.when } }
  }
  // C1: the task's end ends it; no cascade event.
  if (isEndedTask(task)) {
    return { _tag: 'Ended', why: { _tag: 'TaskEnded', task: x.task, state: task } }
  }
  if (task._tag === 'Accepted') {
    if (parent._tag === 'Parent' && parent.state._tag === 'Ended') {
      return { _tag: 'Ended', why: { _tag: 'ParentEnded', parent: parent.parent } }
    }
    return { _tag: 'Settled', task: x.task }
  }
  // S9: one rule for a stop, read only while the task is open.
  const used = x._tag === 'Maker' ? usedBy(m.work, id) : 0
  if (x._tag === 'Maker' && x.maxAttempts._tag === 'AtMost' && used >= x.maxAttempts.max) {
    return { _tag: 'OutOfTries', used, max: x.maxAttempts.max }
  }
  // Ruling 10.9: a brief over the limit of its tier waits (the adapter measures the brief).
  const role = roleAt(m.work, x.role)
  const limit = role._tag === 'Model' ? maxOf(role.limits.Assignment.briefChars) : undefined
  const size = limit === undefined ? 0 : m.outside.measure(m.work, id)
  if (limit !== undefined && size > limit) return { _tag: 'BriefOver', size, limit }
  if (x._tag !== 'Maker') return { _tag: 'Working', tries: { _tag: 'Reviews' } }
  return { _tag: 'Working', tries: { _tag: 'Makes', attempt: attemptOf(m, id) } }
}

// --- 9. Attempt (S4): one count, never above the limit -------------------------------------------
export const attemptOf: AttemptOf = (m, id) => {
  const x = assignmentAt(m.work, id)
  const max = x._tag === 'Maker' ? x.maxAttempts : ({ _tag: 'Unlimited' } as const)
  const cap = max._tag === 'AtMost' ? max.max : Number.POSITIVE_INFINITY
  return { number: Math.min(usedBy(m.work, id) + 1, cap), max }
}

// --- 10. Who answers now (C1: past an ended agent, up to the owner) ------------------------------
export const answererNow: AnswererNow = (m, first, assignments) => {
  if (typeof first !== 'string') return first
  const w = m.work
  const start = w.assignments.get(first)
  if (start === undefined) return first
  for (let a = start; ;) {
    if (assignments.get(a.id)?._tag !== 'Ended') return a.id
    const up = a.parent._tag === 'Parent' ? w.assignments.get(a.parent.id) : undefined
    if (up === undefined) break
    a = up
  }
  return w.tasks.get(start.task)?.owner ?? first
}

// --- 11. QuestionState (C2) ----------------------------------------------------------------------
export const questionStateOf: QuestionStateOf = (m, id, { stops, answerer }) => {
  const q = need(m.work.questions.get(id), 'question', id)
  if (q.status._tag === 'Answered') {
    const { answer, by, when } = q.status
    return { _tag: 'Answered', answer, by, when }
  }
  if (isEndedTask(stops)) return { _tag: 'Irrelevant', task: q.stops }
  return { _tag: 'Open', answerer }
}

// --- 12. EscalationState (B6) --------------------------------------------------------------------
export const escalationStateOf: EscalationStateOf = (m, id, { result, task, answerer }) => {
  const w = m.work
  const x = w.reviews.get(id)
  if (x?._tag !== 'Escalate') throw new Error(`the work has no escalation ${id}`)
  for (const r of w.reviews.values()) {
    if (r._tag === 'Resolve' && r.escalation === id) return { _tag: 'Resolved', by: r.id }
  }
  if (result._tag === 'Superseded') {
    return { _tag: 'Irrelevant', why: { _tag: 'ResultSuperseded', by: result.by } }
  }
  if (isEndedTask(task)) {
    return { _tag: 'Irrelevant', why: { _tag: 'TaskEnded', task: resultAt(w, x.of).task } }
  }
  return { _tag: 'Open', answerer }
}

// --- 13. Placement (d15, C3, S11) --------------------------------------------------------------
// Follow Replaced.next; a Closed task gives its nearest open parent (the old openTaskFor, which
// the page reads today); no open task of the tree: the whole dir.
export const placementOf: PlacementOf = (m, from, { tasks }) => {
  for (let t: TaskId | undefined = from; t !== undefined;) {
    let state = tasks.get(t)
    while (state?._tag === 'Replaced') {
      t = state.next
      state = tasks.get(t)
    }
    if (state === undefined) return { _tag: 'DirWide' }
    if (!isEndedTask(state)) return { _tag: 'OnTask', task: t }
    const serves: Task['serves'] | undefined = m.work.tasks.get(t)?.serves
    t = serves?._tag === 'Serves' ? serves.task : undefined
  }
  return { _tag: 'DirWide' }
}

// --- 14. ProblemState (C3, S12) ----------------------------------------------------------------
export const problemStateOf: ProblemStateOf = (m, id, { stopped }) => {
  const w = m.work
  const p = need(w.problems.get(id), 'problem', id)
  if (p.fixed._tag === 'Fixed') return { _tag: 'Fixed', by: p.fixed.by, at: p.fixed.at }
  if (isEndedTask(stopped)) return { _tag: 'Irrelevant', task: p.stopped }
  if (p.recordedBy._tag === 'Host') return { _tag: 'Open' }
  // S12: the work goes on when an agent of the stopped task's tree acts after the record.
  const made = w.events.findIndex((l) => l.created.includes(id))
  for (const l of w.events.slice(made + 1)) {
    const author = l.recorded.author
    if (author._tag !== 'Agent') continue
    const a = w.assignments.get(author.assignment)
    if (a !== undefined && within(w, a.task, p.stopped)) {
      return { _tag: 'Recovered', by: refOf(l.recorded.seq) }
    }
  }
  return { _tag: 'Open' }
}

// --- 15. RunState (S1): Closed when its current top task ended ---------------------------------
export const runStateOf: RunStateOf = (m, id, { top }) => {
  const run = need(m.work.runs.get(id), 'run', id)
  if (run.end._tag === 'Closed') return { _tag: 'Closed', at: run.end.at }
  if (run.end._tag === 'Done') return { _tag: 'Done', at: run.end.at }
  if (top._tag === 'NoTopTask') return { _tag: 'Talking' }
  if (isEndedTask(top.state)) {
    const end = taskAt(m.work, top.task).end
    return { _tag: 'Closed', at: end._tag === 'NotEnded' ? m.at : end.when }
  }
  // The Sol of the top task accepted it: the end of the project waits for the person.
  return top.state._tag === 'Accepted'
    ? { _tag: 'AwaitingEndAccept', top: top.task }
    : { _tag: 'Working', top: top.task }
}

// --- 16. TaskDraftState (S3) -------------------------------------------------------------------
export const taskDraftStateOf: TaskDraftStateOf = (m, id, { run }) => {
  const x = need(m.work.taskDrafts.get(id), 'task draft', id)
  if (x.opened._tag === 'Opened') return { _tag: 'Opened', task: x.opened.task }
  return run._tag === 'Talking' ? { _tag: 'Waiting' } : { _tag: 'Dropped' }
}

// --- 17. ForwardState (C6) ---------------------------------------------------------------------
export const forwardStateOf: ForwardStateOf = (m, id, { target }) => {
  const w = m.work
  const f = need(w.forwards.get(id), 'forward', id)
  if (f._tag === 'Counted') return { _tag: 'Counted' }
  if (f.state._tag === 'Confirmed') return { _tag: 'Confirmed', event: f.state.event }
  switch (target._tag) {
    case 'Counted':
      return { _tag: 'Waiting' }
    case 'Question': {
      const s = target.state._tag
      const question = target.question
      if (s === 'Answered') return irrelevant({ _tag: 'QuestionAnswered', question })
      if (s === 'Irrelevant') return irrelevant({ _tag: 'QuestionIrrelevant', question })
      return { _tag: 'Waiting' }
    }
    case 'Revision': {
      if (target.state._tag !== 'Waiting') {
        return irrelevant({ _tag: 'DraftDecided', draft: target.draft })
      }
      const person = personOfForward(w, id)
      const accepted = draftAcceptItems(w, target.draft).some(
        (a) => isPerson(w, a.by) && actorOf(w, a.by).name === person,
      )
      return accepted
        ? irrelevant({ _tag: 'PersonAccepted', draft: target.draft })
        : { _tag: 'Waiting' }
    }
    case 'Result': {
      if (target.state._tag === 'Superseded' || isEndedTask(target.task)) {
        return irrelevant({ _tag: 'ResultNotCurrent', result: target.result })
      }
      if (target.state._tag === 'Accepted' || target.task._tag === 'Accepted') {
        return irrelevant({ _tag: 'ResultAccepted', result: target.result })
      }
      return { _tag: 'Waiting' }
    }
    case 'Escalation':
      return target.state._tag === 'Open'
        ? { _tag: 'Waiting' }
        : irrelevant({ _tag: 'EscalationClosed', escalation: target.escalation })
  }
}
const irrelevant = (why: Extract<ForwardState, { _tag: 'Irrelevant' }>['why']): ForwardState => ({
  _tag: 'Irrelevant',
  why,
})
// The person whose act a forward relays (its Forwarded event).
export const personOfForward = (w: Work, ref: EventRef): string | undefined => {
  const e = w.events.find((l) => refOf(l.recorded.seq) === ref)?.recorded.event
  return e?._tag === 'Forward' && 'create' in e ? e.create.person : undefined
}

// --- 18. HostOfTree (S11): from the placement, never from the raw task -------------------------
export const hostOf: HostOf = (m, placement, { runs, assignments }) => {
  if (placement._tag === 'DirWide') return { _tag: 'NoHost' }
  const w = m.work
  const top = rootOf(w, placement.task)
  const run = runOfTree(w, top)
  const state = run === undefined ? undefined : runs.get(run.id)
  // S1: a run that is Done or Closed holds no host (RunState, not run.end).
  if (run === undefined || state === undefined || state._tag === 'Done' || state._tag === 'Closed')
    return { _tag: 'NoHost' }
  for (const s of w.sessions.values()) {
    const a = w.assignments.get(s.assignment)
    const open = assignments.get(s.assignment)?._tag !== 'Ended'
    if (a?.task === top && open && s.session === run.session) {
      return { _tag: 'Host', run: run.id, session: s.session, assignment: a.id }
    }
  }
  return { _tag: 'NoHost' }
}

// --- 19. SendState (C5) ------------------------------------------------------------------------
export const sendStateOf: SendStateOf = (m, id, { target }) => {
  const send = need(
    m.work.sends.find((s) => s.id === id),
    'send',
    id,
  )
  if (send.state._tag === 'Delivered') return { _tag: 'Delivered', at: send.state.at }
  if (send.state._tag === 'Dropped') {
    return { _tag: 'Dropped', at: send.state.at, why: send.state.why }
  }
  const { owner, about } = target
  if (owner._tag === 'Agent' && owner.state._tag === 'Ended') {
    return { _tag: 'Irrelevant', why: { _tag: 'OwnerEnded', assignment: owner.assignment } }
  }
  if (owner._tag === 'Host' && (owner.state._tag === 'Done' || owner.state._tag === 'Closed')) {
    return { _tag: 'Irrelevant', why: { _tag: 'RunEnded', run: owner.run } }
  }
  const words = send.from._tag === 'Supervisor' && send.from.reason._tag === 'DecisionNeedsWords'
  switch (about._tag) {
    case 'Nothing':
      return { _tag: 'Pending' }
    case 'Problem':
      if (about.state._tag === 'Open') return { _tag: 'Pending' }
      return words
        ? { _tag: 'Irrelevant', why: { _tag: 'DecisionGone', decision: about.problem } }
        : { _tag: 'Irrelevant', why: { _tag: 'ProblemNotOpen', problem: about.problem } }
    case 'Revision':
      return about.state._tag === 'Waiting' && personLeaf(about.state)
        ? { _tag: 'Pending' }
        : { _tag: 'Irrelevant', why: { _tag: 'DecisionGone', decision: about.draft } }
    case 'Run':
      return about.state._tag === 'AwaitingEndAccept'
        ? { _tag: 'Pending' }
        : { _tag: 'Irrelevant', why: { _tag: 'DecisionGone', decision: about.run } }
    case 'TaskDraft':
      return about.state._tag === 'Opened'
        ? { _tag: 'Pending' }
        : { _tag: 'Irrelevant', why: { _tag: 'DraftNotOpened', draft: about.draft } }
  }
}
// A draft that waits for a person: a person decider, or the owner's accept (S2).
export const personLeaf = (state: Extract<RevisionState, { _tag: 'Waiting' }>): boolean =>
  state.waitsFor.some((l) => l._tag !== 'Role')

// --- 20. SourceState ---------------------------------------------------------------------------
// When an agent last read a source: the last Source event that named it (a fact of the log).
export const sourceStatesOf: SourceStatesOf = (m) => {
  const w = m.work
  const hours = m.outside.settings.outsideSourceHours
  return [...w.sources.values()].flatMap((s): ReadonlyArray<SourceSeen> => {
    if (s._tag !== 'Outside') return []
    const seen = w.events.findLast(({ recorded: { event: e } }) => {
      if (e._tag !== 'Source') return false
      return 'create' in e ? e.create.source.name === s.name : e.id === s.name
    })
    if (seen === undefined) return []
    const seenAt = seen.recorded.at
    const expired = Date.parse(m.at) - Date.parse(seenAt) > hours * 60 * 60 * 1000
    return [
      {
        name: s.name,
        revision: s.revision,
        state: expired ? { _tag: 'Expired', seenAt } : { _tag: 'Fresh', seenAt },
      },
    ]
  })
}

// =================================================================================================
// derive: each state once, in the order of the edges
// =================================================================================================

// The terminal that a send goes into: its destination, or the host of a decision's placement.
export const sendSessionOf = (
  m: Moment,
  send: Send,
  states: Pick<States, 'tasks' | 'runs' | 'assignments'>,
): SessionId | undefined => {
  const w = m.work
  if (send.from._tag === 'Agent') return send.from.to.session
  const reason = send.from.reason
  const hostOfTask = (task: TaskId): SessionId | undefined => {
    const host = hostOf(m, placementOf(m, task, states), states)
    return host._tag === 'Host' ? host.session : undefined
  }
  switch (reason._tag) {
    case 'Start':
    case 'Wake':
    case 'Retry':
      return reason.to.session
    case 'AgentAtPrompt':
    case 'AgentFailed': {
      const ref = reason._tag === 'AgentAtPrompt' ? reason.prompt : reason.failure
      const e = w.events.find((l) => refOf(l.recorded.seq) === ref)?.recorded.event
      const sid = e?._tag === 'Terminal' ? e.id : undefined
      const a = [...w.sessions.values()].find((s) => s.session === sid)?.assignment
      const task = a === undefined ? undefined : w.assignments.get(a)?.task
      return task === undefined ? undefined : hostOfTask(task)
    }
    case 'DecisionNeedsWords': {
      // A decision of the whole dir goes to the host of the newest live run, where
      // decisionsWithoutWords asked it (P6: else a dir-wide line that waited was never typed).
      const task = decisionTaskOf(w, reason.decision) ?? newestLiveTop(w, states.runs)
      return task === undefined ? undefined : hostOfTask(task)
    }
    case 'ProblemRetry': {
      const p = w.problems.get(reason.problem)
      if (p === undefined) return undefined
      return hostOfTask(problemTask(w, p)) ?? runOfTree(w, p.stopped)?.session
    }
    case 'DraftOpened': {
      const draft = w.taskDrafts.get(reason.draft)
      return draft === undefined ? undefined : w.runs.get(draft.run)?.session
    }
  }
}
// The top task now of the newest run that is Talking, Working or AwaitingEndAccept.
const newestLiveTop = (w: Work, runs: ReadonlyMap<RunId, RunState>): TaskId | undefined => {
  const live = ['Talking', 'Working', 'AwaitingEndAccept']
  const isLive = (r: { readonly id: RunId }) => live.includes(runs.get(r.id)?._tag ?? '')
  const newest = [...w.runs.values()].filter(isLive).at(-1)
  const opened = newest === undefined ? undefined : openedTopOf(w, newest.id)
  return opened === undefined ? undefined : currentTask(w, opened)
}
// The task where a decision of the page sits: a problem's, a draft's answered task, a run's top.
export const decisionTaskOf = (w: Work, decision: string): TaskId | undefined => {
  const p = w.problems.get(decision as ProblemId)
  if (p !== undefined) return problemTask(w, p)
  const run = w.runs.get(decision as RunId)
  if (run !== undefined) {
    const opened = openedTopOf(w, run.id)
    return opened === undefined ? undefined : currentTask(w, opened)
  }
  const draft = w.drafts.get(decision as RevisionId)
  return draft?.answers.map((a) => taskOfAnswer(w, a)).find((t) => t !== undefined)
}
// The task of a Reject (or one of its points) that a draft answers; a suggestion has none.
export const taskOfAnswer = (w: Work, answer: string): TaskId | undefined => {
  const reject = w.reviews.get(answer.replace(/\.\d+$/, '') as RejectId)
  if (reject?._tag !== 'Reject') return undefined
  if (reject.of._tag === 'Result') return w.results.get(reject.of.id)?.task
  return reject.of._tag === 'Task' ? reject.of.id : undefined
}

export const derive: Derive = (m) => {
  const w = m.work
  const permissions = new Map<PermissionId, PermissionState>()
  for (const p of w.permissions.values()) permissions.set(p.id, permissionStateOf(p, m.at))

  const directions = new Map<Direction['id'], DirectionState>()
  for (const d of w.directions.keys()) directions.set(d, directionStateOf(m, d))

  const revisions = new Map<RevisionId, RevisionState>()
  for (const x of w.drafts.values()) {
    const direction = need(directions.get(x.of), 'direction', x.of)
    revisions.set(x.id, revisionStateOf(m, x.id, { direction }))
  }

  const results = new Map<ResultId, ResultState>()
  for (const r of w.results.keys()) results.set(r, resultStateOf(m, r))

  // A task's needs come first; the store has no cycle of needs (the remake check).
  const tasks = new Map<TaskId, TaskState>()
  const visiting = new Set<TaskId>()
  const taskState = (id: TaskId): TaskState => {
    const known = tasks.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) throw new Error(`a cycle of needs through ${id}`)
    visiting.add(id)
    const latestResult = latestResultOf(w, id)
    const latest: LatestResult =
      latestResult === undefined
        ? { _tag: 'NoResult' }
        : {
            _tag: 'Latest',
            result: latestResult.id,
            state: need(results.get(latestResult.id), 'result', latestResult.id),
          }
    const needs = taskAt(w, id).needs.map(taskState)
    const state = taskStateOf(m, id, { latest, needs })
    tasks.set(id, state)
    return state
  }
  for (const t of w.tasks.keys()) taskState(t)

  const evaluations = new Map<EvaluationId, EvaluationState>()
  for (const e of w.evaluations.keys()) evaluations.set(e, evaluationStateOf(m, e))

  // A parent is given before its children (the ids grow), so its state is known first.
  const assignments = new Map<AssignmentId, AssignmentState>()
  for (const a of w.assignments.values()) {
    const task = need(tasks.get(a.task), 'task', a.task)
    const parentState = a.parent._tag === 'Parent' ? assignments.get(a.parent.id) : undefined
    const parent =
      a.parent._tag === 'Parent' && parentState !== undefined
        ? ({ _tag: 'Parent', parent: a.parent.id, state: parentState } as const)
        : ({ _tag: 'GivenByPerson' } as const)
    assignments.set(a.id, assignmentStateOf(m, a.id, { task, parent }))
  }
  const answerer = (first: Answerer): Answerer => answererNow(m, first, assignments)

  const questions = new Map<QuestionId, QuestionState>()
  for (const q of w.questions.values()) {
    const stops = need(tasks.get(q.stops), 'task', q.stops)
    questions.set(q.id, questionStateOf(m, q.id, { stops, answerer: answerer(q.answerBy) }))
  }

  const escalations = new Map<EscalationId, EscalationState>()
  for (const v of w.reviews.values()) {
    if (v._tag !== 'Escalate') continue
    const result = need(results.get(v.of), 'result', v.of)
    const taskId = resultAt(w, v.of).task
    const task = need(tasks.get(taskId), 'task', taskId)
    const deps = { result, task, answerer: answerer(v.answerBy) }
    escalations.set(v.id, escalationStateOf(m, v.id, deps))
  }

  const problems = new Map<ProblemId, ProblemState>()
  for (const p of w.problems.values()) {
    const stopped = need(tasks.get(p.stopped), 'task', p.stopped)
    problems.set(p.id, problemStateOf(m, p.id, { stopped }))
  }

  const runs = new Map<RunId, RunState>()
  for (const r of w.runs.values()) {
    runs.set(r.id, runStateOf(m, r.id, { top: runTopOf(m, r.id, tasks) }))
  }

  const taskDrafts = new Map<TaskDraftId, TaskDraftState>()
  for (const d of w.taskDrafts.values()) {
    const run = need(runs.get(d.run), 'run', d.run)
    taskDrafts.set(d.id, taskDraftStateOf(m, d.id, { run }))
  }

  const forwards = new Map<EventRef, ForwardState>()
  for (const f of w.forwards.values()) {
    const of = { questions, revisions, results, tasks, escalations }
    const target = forwardTargetOf(m, f.event, of)
    forwards.set(f.event, forwardStateOf(m, f.event, { target }))
  }

  const sends = new Map<EventRef, SendState>()
  const partial = { tasks, runs, assignments, problems, revisions, taskDrafts }
  for (const s of w.sends) {
    sends.set(s.id, sendStateOf(m, s.id, { target: sendTargetOf(m, s, partial) }))
  }

  const states: States = {
    permissions,
    directions,
    revisions,
    results,
    tasks,
    evaluations,
    assignments,
    questions,
    escalations,
    problems,
    runs,
    taskDrafts,
    forwards,
    sends,
    sources: sourceStatesOf(m),
    roleWords: roleWordsStates(w),
  }
  return { moment: m, states }
}

// The top task of a run now (after its remakes), with its state.
export const runTopOf = (m: Moment, run: RunId, tasks: ReadonlyMap<TaskId, TaskState>): RunTop => {
  const opened = openedTopOf(m.work, run)
  if (opened === undefined) return { _tag: 'NoTopTask' }
  const task = currentTask(m.work, opened)
  return { _tag: 'TopTask', task, state: need(tasks.get(task), 'task', task) }
}

// What the inner act of a forward acts on, with its state.
export const forwardTargetOf = (
  m: Moment,
  ref: EventRef,
  states: Pick<States, 'questions' | 'revisions' | 'results' | 'tasks' | 'escalations'>,
): ForwardTarget => {
  const w = m.work
  const f = need(w.forwards.get(ref), 'forward', ref)
  if (f._tag === 'Counted') return { _tag: 'Counted' }
  const inner = f.inner
  if (inner._tag === 'Question') {
    const state = need(states.questions.get(inner.id), 'question', inner.id)
    return { _tag: 'Question', question: inner.id, state }
  }
  const d = inner.create
  if (d._tag === 'Resolve') {
    const state = need(states.escalations.get(d.escalation), 'escalation', d.escalation)
    return { _tag: 'Escalation', escalation: d.escalation, state }
  }
  if (d.of._tag === 'Revision') {
    const state = need(states.revisions.get(d.of.id), 'draft', d.of.id)
    return { _tag: 'Revision', draft: d.of.id, state }
  }
  const result = d.of.id
  const task = resultAt(w, result).task
  return {
    _tag: 'Result',
    result,
    state: need(states.results.get(result), 'result', result),
    task: need(states.tasks.get(task), 'task', task),
  }
}

// The owner of a send's terminal and what the send is about, each with its state.
export const sendTargetOf = (
  m: Moment,
  send: Send,
  states: Pick<States, 'tasks' | 'runs' | 'assignments' | 'problems' | 'revisions' | 'taskDrafts'>,
): SendTarget => {
  const w = m.work
  const sid = sendSessionOf(m, send, states)
  const run = [...w.runs.values()].find((r) => r.session === sid)
  const agent = [...w.sessions.values()].find((s) => s.session === sid)?.assignment
  const runState = run === undefined ? undefined : states.runs.get(run.id)
  const agentState = agent === undefined ? undefined : states.assignments.get(agent)
  const owner: SessionOwner =
    run !== undefined && runState !== undefined
      ? { _tag: 'Host', run: run.id, state: runState }
      : agent !== undefined && agentState !== undefined
        ? { _tag: 'Agent', assignment: agent, state: agentState }
        : { _tag: 'NoOwner' }
  return { owner, about: aboutOf(send, states) }
}
const aboutOf = (
  send: Send,
  states: Pick<States, 'problems' | 'revisions' | 'runs' | 'taskDrafts'>,
): SendAbout => {
  if (send.from._tag !== 'Supervisor') return { _tag: 'Nothing' }
  const reason = send.from.reason
  const problem = (id: ProblemId): SendAbout => {
    const state = states.problems.get(id)
    return state === undefined ? { _tag: 'Nothing' } : { _tag: 'Problem', problem: id, state }
  }
  switch (reason._tag) {
    case 'DecisionNeedsWords': {
      const id = reason.decision
      const draft = states.revisions.get(id as RevisionId)
      if (draft !== undefined) return { _tag: 'Revision', draft: id as RevisionId, state: draft }
      const run = states.runs.get(id as RunId)
      if (run !== undefined) return { _tag: 'Run', run: id as RunId, state: run }
      return problem(id as ProblemId)
    }
    case 'ProblemRetry':
      return problem(reason.problem)
    case 'DraftOpened': {
      const state = states.taskDrafts.get(reason.draft)
      return state === undefined
        ? { _tag: 'Nothing' }
        : { _tag: 'TaskDraft', draft: reason.draft, state }
    }
    default:
      return { _tag: 'Nothing' }
  }
}
