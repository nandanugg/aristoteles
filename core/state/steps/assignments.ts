// The steps of an assignment and its result: give (with the session of a host), the three
// briefs, free, finish, and the report. The end of a maker's assignment may make an exhaustion.
import {
  type AssignmentId,
  type EventOf,
  Moves,
  playedBy,
  type PointId,
  type Result,
  type Stepped,
  type Time,
  type Work,
} from '../../schema/index.ts'
import { type Act, Build, built, damaged, put, unchanged } from '../act.ts'
import { exhaustionResult, isFault } from '../decisions.ts'
import { itemsOf } from '../items.ts'
import {
  assignmentAt,
  assignmentBy,
  finished,
  isAssignment,
  isDo,
  isOpen,
  roleAt,
  runOf,
  taskAt,
  tierOf,
  underNowOf,
} from '../records.ts'
import { underNow } from '../versions.ts'

type Seq = { readonly seq: number }

// An assignment ends. A maker that ends while its latest try (under versions that still say the
// same) has a fault ended on that fault: the task waits for an evaluation, so the fold records
// an exhaustion of that result once. (derived: AssignmentState OutOfTries owns the stop, S9.)
const endAssignment = (b: Build, id: AssignmentId, when: Time): void => {
  const a = assignmentAt(b.work, id)
  if (a.end._tag === 'NotEnded') {
    const ended = Moves.finishAssignment({ ...a, end: a.end }, when)
    b.work = { ...b.work, assignments: put(b.work.assignments, id, ended) }
  }
  const w = b.work
  if (!isDo(w, a.role) || !isOpen(taskAt(w, a.task))) return
  const last = [...w.results.values()].filter((r) => r.by === id).at(-1)
  if (last === undefined || !underNow(w, last)) return
  const fault = itemsOf(w, last.id)
    .filter((v) => isFault(w, v))
    .at(-1)
  if (fault === undefined) return
  if ([...w.exhaustions.values()].some((x) => exhaustionResult(w, x).id === last.id)) return
  const x = b.name('exhaustion')
  const exhaustion = { id: x, fault: fault.id as PointId, when, at: b.tick() }
  b.work = { ...b.work, exhaustions: put(b.work.exhaustions, x, exhaustion) }
}
// A low agent's claim ends with its one unit; a medium or high claim lasts until finish.
export const endUnit = (b: Build, id: AssignmentId): void => {
  const tier = tierOf(roleAt(b.work, assignmentAt(b.work, id).role))
  if (tier !== 'low' && tier !== undefined) return
  const meta = b.work.meta.get(id)
  if (meta !== undefined) {
    b.work = { ...b.work, meta: put(b.work.meta, id, Moves.freeClaim(meta)) }
  }
}

// A parent's give (or the person's): the assignment, its token, and, for a maker, the end of
// the makers before it on the task (what waited for them goes up).
const give = (
  work: Work,
  e: EventOf<'Assignment.GivenMaker'> | EventOf<'Assignment.GivenReviewer'>,
  act: Act,
): Stepped =>
  built(work, (b) => {
    const d = e.create
    const task = taskAt(work, d.task)
    const role = roleAt(work, d.role)
    const id = b.name('assignment')
    const player = playedBy(role)
    const base = {
      id,
      actor: { _tag: 'Agent' as const, name: player, run: `${player}-${id.slice(1)}` },
      role: role.role,
      task: task.id,
      under: underNowOf(work, task),
      parent: isAssignment(act.by)
        ? ({ _tag: 'Parent', id: act.by } as const)
        : ({ _tag: 'GivenByPerson' } as const),
      when: act.when,
    }
    const assignment =
      d._tag === 'GivenMaker'
        ? Moves.giveAssignment({
            ...base,
            _tag: 'Maker',
            maxAttempts:
              d.maxAttempts === null
                ? role.limits.Assignment.attempts
                : { _tag: 'AtMost', max: d.maxAttempts },
          })
        : Moves.giveAssignment({ ...base, _tag: 'Reviewer' })
    if (d._tag === 'GivenMaker') {
      for (const x of [...b.work.assignments.values()]) {
        if (x.task === task.id && isDo(b.work, x.role) && !finished(x)) {
          endAssignment(b, x.id, act.when)
        }
      }
    }
    b.work = {
      ...b.work,
      assignments: put(b.work.assignments, id, assignment),
      meta: put(b.work.meta, id, Moves.newMeta(d.secret)),
    }
  })

// The Sol on the top task of a run continues in the session of the run, so the page starts no
// second terminal for it. (derived: HostOfTree owns which assignment hosts a tree, S11.)
const hostSession = (work: Work, stepped: Stepped, at: Time): Stepped => {
  const a = stepped.created.find((id) => id.startsWith('a')) as AssignmentId | undefined
  const given = a === undefined ? undefined : stepped.work.assignments.get(a)
  if (given === undefined) return stepped
  const task = work.tasks.get(given.task)
  const role = work.workflow.roles.get(given.role)
  const run = task?.serves._tag === 'TopTask' ? runOf(work, task.id) : undefined
  if (run === undefined || role?._tag !== 'Model' || role.tier !== 'high') return stepped
  const taken = [...stepped.work.sessions.values()].some(
    (s) =>
      stepped.work.assignments.get(s.assignment)?.task === given.task && s.session === run.session,
  )
  if (taken) return stepped
  const session = { assignment: given.id, session: run.session, at }
  return {
    ...stepped,
    work: { ...stepped.work, sessions: put(stepped.work.sessions, given.id, session) },
  }
}
export const given = (
  work: Work,
  e: EventOf<'Assignment.GivenMaker'> | EventOf<'Assignment.GivenReviewer'>,
  act: Act,
): Stepped => hostSession(work, give(work, e, act), act.when)

// A brief takes the snapshot of the versions and the claim. The first brief of a task records
// how its output looked before any work (a report equal to it is untouched work).
export const briefed = (
  work: Work,
  e:
    | EventOf<'Assignment.Briefed'>
    | EventOf<'Assignment.BriefedToCheck'>
    | EventOf<'Assignment.BriefedFirst'>,
  act: Act,
): Stepped => {
  const d = e.move
  const a = assignmentAt(work, e.id)
  const under = underNowOf(work, taskAt(work, a.task))
  const brief =
    a.end._tag === 'NotEnded' ? Moves.briefAssignment({ ...a, end: a.end }, under) : { ...a, under }
  const meta = work.meta.get(e.id)
  const result = d._tag === 'BriefedToCheck' ? d.result : null
  const claimed = meta === undefined ? undefined : Moves.claim(meta, act.when, result)
  let next: Work = {
    ...work,
    assignments: put(work.assignments, e.id, brief),
    meta: claimed === undefined ? work.meta : put(work.meta, e.id, claimed),
  }
  const task = taskAt(next, a.task)
  if (d._tag === 'BriefedFirst' && task.untouched._tag === 'NotBriefed') {
    const inPlace =
      d.before._tag === 'InPlace'
        ? ({ _tag: 'InPlace', texts: d.before.texts, at: act.when } as const)
        : ({ _tag: 'NotInPlace' } as const)
    const first = Moves.firstBrief({ ...task, untouched: task.untouched }, d.untouched, inPlace)
    next = { ...next, tasks: put(next.tasks, task.id, first) }
  }
  return unchanged(next)
}

export const freed = (work: Work, e: EventOf<'Assignment.Freed'>, r: Seq): Stepped => {
  const meta = work.meta.get(e.id) ?? damaged(r, `${e.id} has no claim`)
  return unchanged({ ...work, meta: put(work.meta, e.id, Moves.MOVES['Assignment.Freed'](meta)) })
}

// A finish ends the assignment and frees its claim.
export const finish = (work: Work, e: EventOf<'Assignment.Finished'>, act: Act): Stepped =>
  built(work, (b) => {
    endAssignment(b, e.id, act.when)
    const meta = b.work.meta.get(e.id)
    if (meta !== undefined) {
      b.work = { ...b.work, meta: put(b.work.meta, e.id, Moves.freeClaim(meta)) }
    }
  })

// A maker's report: the result under the versions of its brief; a low maker's unit ends.
export const report = (work: Work, e: EventOf<'Result.Result'>, act: Act): Stepped =>
  built(work, (b) => {
    const d = e.create
    const by = assignmentBy(act.by)
    const a = assignmentAt(work, by)
    const id = b.name('result')
    const result: Result = {
      id,
      task: a.task,
      by,
      output: d.output,
      madeFrom: d.madeFrom,
      work: d.work,
      under: a.under,
      when: act.when,
      at: b.tick(),
    }
    b.work = {
      ...b.work,
      results: put(b.work.results, id, result),
      resultFiles: put(b.work.resultFiles, id, d.files),
      after: d.after === null ? b.work.after : put(b.work.after, id, d.after),
    }
    endUnit(b, by)
  })
