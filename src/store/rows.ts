// Every row of the reader tables for a Work, as [table, row]; the store adds the rows that it does
// not have. The tests (test/aristoteles.test.js, acts, reading, runs) read them. Each Standard and
// Rule carries its entry (d1/facts-not-proof), made by the engine.
import type { Actor } from '../domain/actor.ts'
import { whereRecord } from '../domain/context.ts'
import { decisionOf, pointsOf, problemTaskOf, topOfRun, versionIdOf } from '../domain/derived.ts'
import type { By, Direction, Evidence, Review, Stop, SuggestionAbout } from '../domain/model.ts'
import {
  type PointId,
  pointId,
  type RejectId,
  rejectOf,
  type SessionId,
  versionId,
} from '../domain/ids.ts'
import type { ProblemActor, TerminalReport } from '../domain/ui-model.ts'
import type { Work } from '../domain/work.ts'
import type { ReaderRow } from '../services/store.ts'

type Value = string | number | null

// Who did an act: an assignment by its id, a person by name, a model run outside any task by
// its name and run.
const actorText = (actor: Actor) => ('run' in actor ? `${actor.name} run ${actor.run}` : actor.name)
const byText = (by: By) => (typeof by === 'string' ? by : actorText(by))
const problemActorText = (by: ProblemActor) => (by._tag === 'Host' ? by.assignment : by.name)

// The id that a suggestion is about; null: it asks for a new direction.
const aboutId = (about: SuggestionAbout): string | null => {
  switch (about._tag) {
    case 'NewDirection':
      return null
    case 'Direction':
      return about.direction
    case 'Standard':
      return about.standard
    case 'Rule':
      return about.rule
  }
}

// The kind, text and tries of a terminal event, as the old row kept them: a failure is after
// three tries; no other event has a try.
const terminalColumns = (
  report: TerminalReport,
): { kind: string; text: string; tries: number } => {
  switch (report._tag) {
    case 'Failed':
      return { kind: report.why, text: report.lastLines, tries: 3 }
    case 'Prompted':
      return { kind: 'prompt', text: report.line, tries: 0 }
    case 'Stopped':
      return { kind: 'stopped', text: '', tries: 0 }
    case 'Resumed':
      return { kind: 'resumed', text: '', tries: 0 }
    case 'Closed':
      return { kind: 'closed', text: '', tries: 0 }
  }
}

// What a terminal stands for, as the old row named it: the run of its session (its host too),
// else the agent of its session.
const terminalOf = (work: Work, session: SessionId): string => {
  for (const r of work.runs.values()) if (r.session === session) return r.id
  for (const s of work.sessions.values()) if (s.session === session) return s.assignment
  throw new Error(`rowsOf: no run or agent has the session ${session}`)
}

// The rows of the review table for one Review, as the old engine kept them: one Review per
// point of a Reject of a result or a task (v4.1, v4.2), and one for any other review.
const reviewRows = (
  work: Work,
  v: Review,
): ReadonlyArray<{ id: string; of: string; reason: string | null; breaks: string | null }> => {
  switch (v._tag) {
    case 'Accept':
      return [{ id: v.id, of: v.of.id, reason: v.reason, breaks: null }]
    case 'Reject': {
      const of = v.of
      if (of._tag === 'Result' || of._tag === 'Task') {
        return pointsOf(v).map(({ id, point }) => ({
          id,
          of: of.id,
          reason: point.text,
          breaks: 'breaks' in point && point.breaks._tag === 'Rule' ? point.breaks.rule : null,
        }))
      }
      return [{ id: v.id, of: of.id, reason: of.reason, breaks: null }]
    }
    case 'Recheck':
    case 'Escalate':
      return [{ id: v.id, of: v.of, reason: v.reason, breaks: null }]
    // A resolve's row is about the escalation's result, with its resolution.
    case 'Resolve': {
      const escalated = work.reviews.get(v.escalation)
      const of = escalated?._tag === 'Escalate' ? escalated.of : ''
      return [{ id: v.id, of, reason: v.resolution, breaks: null }]
    }
  }
}

const evidenceOf = (v: Review): ReadonlyArray<Evidence> =>
  v._tag === 'Accept' ? v.of.evidence : v._tag === 'Resolve' ? v.evidence : []

// The stop that an evaluation answers, as the old row named it: an exhaustion, or the first
// point of a Reject (one Reject is one stop).
const stopRow = (stop: Stop): string => {
  if (stop._tag !== 'PersonReject') return stop.id
  const reject = stop.id.includes('.') ? rejectOf(stop.id as PointId) : (stop.id as RejectId)
  return pointId(reject, 1)
}

export const rowsOf = (work: Work, dir: string): ReadonlyArray<ReaderRow> => {
  const rows: Array<ReaderRow> = []
  const add = (table: string, row: Readonly<Record<string, Value>>) =>
    rows.push([table, { project: dir, ...row }])
  const words = (place: string, kind: string, text: string | null) => {
    if (text) add('words', { place, kind, text })
  }

  // The official directions, then the ones that only a draft names, each once.
  const directions = new Map<string, Direction>()
  const official = [...work.directions.values()].filter((d) => d._tag === 'Official')
  for (const id of [...official.map((d) => d.id), ...[...work.drafts.values()].map((x) => x.of)]) {
    const d = work.directions.get(id)
    if (!d)
      throw new Error(`rowsOf: a draft names the direction ${id}, which the work does not have`)
    if (!directions.has(id)) directions.set(id, d)
  }
  for (const d of directions.values()) {
    add('direction', { id: d.id, name: d.name, owner: d.owner.name, principles: d.from.join(', ') })
  }

  for (const x of work.drafts.values()) {
    add('draft', {
      id: x.id,
      direction: x.of,
      base: x._tag === 'Change' ? x.base : null,
      says: x.says,
      // An import's old author was the refresh as a run of its commit.
      by: x.origin._tag === 'Written' ? byText(x.origin.by) : `refresh run ${x.origin.commit}`,
      // The old column held the reviser's words: its words when given, else its reason.
      why: x.why._tag === 'Given' ? (x.why.words ?? x.why.reason) : null,
      at: x.when,
    })
    words(x.id, 'draft', x.says)
    for (const y of x.answers) add('answer', { draft: x.id, answers: y })
    for (const entry of x.standards) {
      const s = work.standards.get(entry)
      if (!s)
        throw new Error(`rowsOf: the draft ${x.id} names the standard ${entry}, which is missing`)
      add('standard', {
        id: s.entry,
        key: s.id,
        says: s.says,
        where: s.where._tag === 'Where' ? JSON.stringify(whereRecord(s.where)) : null,
      })
      add('draft_standard', { draft: x.id, standard: s.entry })
      words(s.entry, 'standard', s.says)
      for (const ruleEntry of s.rules) {
        const r = work.rules.get(ruleEntry)
        if (!r)
          throw new Error(
            `rowsOf: the standard ${s.entry} names the rule ${ruleEntry}, which is missing`,
          )
        add('rule', {
          id: r.entry,
          key: r.id,
          says: r.says,
          checked_by: r.checkedBy._tag === 'Role' ? r.checkedBy.role : null,
        })
        add('standard_rule', { standard: s.entry, rule: r.entry })
        words(r.entry, 'rule', r.says)
      }
    }
  }

  for (const d of official) {
    if (d._tag !== 'Official') continue
    for (const v of d.versions) {
      const origin = d.source._tag === 'External' ? d.source : null
      const made = work.drafts.get(v.revision)?.origin
      const source =
        made?._tag === 'Imported' && origin ? `${origin.repo} ${origin.path}@${made.commit}` : null
      add('version', {
        id: versionIdOf(v),
        direction: d.id,
        number: v.number,
        draft: v.revision,
        source,
        at: v.when,
      })
    }
  }

  for (const y of work.suggestions.values()) {
    add('suggestion', {
      id: y.id,
      about: aboutId(y.about),
      says: y.says,
      by: byText(y.by),
      at: y.when,
    })
    words(y.id, 'suggestion', y.says)
  }

  for (const v of work.reviews.values()) {
    const row = (id: string, of: string, reason: string | null, breaks: string | null) => {
      add('review', {
        id,
        of,
        decision: decisionOf(v),
        reason,
        breaks,
        by: byText(v.by),
        at: v.when,
      })
      words(id, 'reason', reason)
    }
    for (const r of reviewRows(work, v)) row(r.id, r.of, r.reason, r.breaks)
    evidenceOf(v).forEach((e, n) =>
      add('evidence', { review: v.id, n, rule: e.meets ?? null, place: e.at, says: e.says }),
    )
  }

  for (const t of work.tasks.values()) {
    add('task', {
      id: t.id,
      name: t.name,
      text: t.descriptionAi.text,
      serves: t.serves._tag === 'Serves' ? t.serves.task : null,
      owner: t.owner.name,
    })
    for (const d of t.descriptionAi.directions) add('task_direction', { task: t.id, direction: d })
    if (t.end._tag !== 'NotEnded') {
      add('task_closed', {
        task: t.id,
        reason: t.end.reason,
        replaced_by: t.end._tag === 'Replaced' ? t.end.next : null,
        at: t.end.when,
      })
    }
  }

  for (const a of work.assignments.values()) {
    add('assignment', {
      id: a.id,
      task: a.task,
      role: a.role,
      parent: a.parent._tag === 'Parent' ? a.parent.id : null,
      at: a.when,
    })
    if (a.end._tag !== 'NotEnded') add('assignment_finished', { assignment: a.id })
    for (const [d, n] of a.under) add('brief', { assignment: a.id, version: versionId(d, n) })
  }

  for (const r of work.results.values()) {
    add('result', { id: r.id, task: r.task, assignment: r.by, output: r.output, at: r.when })
    for (const [d, n] of r.under) {
      add('result_version', { result: r.id, version: versionId(d, n) })
    }
  }

  for (const run of work.runs.values()) {
    // Each run is a host now; the column stays, because the run table of an older store file has it.
    add('run', { id: run.id, kind: 'host', session: run.session, at: run.startedAt })
    if (run.end._tag === 'Closed') add('run_closed', { run: run.id, at: run.end.at })
    const top = topOfRun(work, run.id)
    if (top !== undefined) add('run_task', { run: run.id, task: top })
  }

  for (const x of work.taskDrafts.values()) {
    add('task_draft', {
      id: x.id,
      run: x.run,
      name: x.task.name,
      text: x.task.text,
      role: x.role,
      opened_as: x.opened._tag === 'Opened' ? x.opened.task : null,
      at: x.at,
    })
  }

  for (const sp of work.problems.values()) {
    add('problem', {
      id: sp.id,
      task: problemTaskOf(work, sp),
      stopped: sp.stopped,
      says: sp.says,
      by: problemActorText(sp.recordedBy),
      at: sp.at,
    })
    if (sp.fixed._tag === 'Fixed') {
      add('problem_fixed', { problem: sp.id, by: problemActorText(sp.fixed.by), at: sp.fixed.at })
    }
  }

  for (const e of work.terminalEvents) {
    const on = terminalOf(work, e.session)
    add('terminal_event', { on_id: on, ...terminalColumns(e.report), at: e.at })
  }
  for (const s of work.sessions.values()) {
    add('assignment_session', { assignment: s.assignment, session: s.session, at: s.at })
  }
  for (const [r, files] of work.resultFiles) {
    for (const file of files) add('result_file', { result: r, file })
  }
  for (const t of work.tasks.values()) {
    const first = t.untouched
    if (first._tag !== 'AtFirstBrief' || first.inPlace._tag !== 'InPlace') continue
    for (const [file, text] of Object.entries(first.inPlace.texts)) {
      add('task_before', { task: t.id, file, text })
    }
  }

  for (const e of work.evaluations.values()) {
    add('evaluation', {
      id: e.id,
      answers: stopRow(e.answers),
      wrong: e.wrong,
      why: e.why,
      improve: e.improve.join('\n'),
      level: e.level,
      by: byText(e.by),
      at: e.when,
    })
  }
  return rows
}
