// The steps of questions, notes, evaluations and permissions.
import {
  type Answerer,
  type Assignment,
  type CountedAct,
  type Evaluation,
  type EventOf,
  Moves,
  type NonBlank,
  type QuestionId,
  type RejectId,
  type Stepped,
  type Work,
} from '../../schema/index.ts'
import { type Act, built, damaged, put, unchanged } from '../act.ts'
import { evaluationDecision, stopRefOrThrow, stopRefTask } from '../decisions.ts'
import {
  answererBy,
  assignmentAt,
  assignmentBy,
  hostOf,
  isPerson,
  openAncestorOf,
  personOf,
  taskAt,
} from '../records.ts'
import { endUnit } from './assignments.ts'

type Seq = { readonly seq: number }

// An agent's question (to the nearest open assignment above, or to the owner), or the person's
// question to an agent (only in a forward).
export type Asked =
  | EventOf<'Question.Asked'>['create']
  | Extract<CountedAct, { readonly _tag: 'Question' }>['create']

// Who an agent's question goes to first: the nearest open assignment above, else the owner; in
// a project of the page, the host in the owner's place (never the host itself). (derived: the
// answerer now and HostOfTree own this; the record keeps the first one.)
const firstAnswerer = (w: Work, a: Assignment, to: 'Above' | 'Owner'): Answerer => {
  const owner = taskAt(w, a.task).owner
  const first: Answerer = to === 'Owner' ? owner : (openAncestorOf(w, a.id) ?? owner)
  const host = hostOf(w, a.task)
  if (host === undefined || typeof first === 'string' || host === a.id) return first
  return host
}
export const asked = (work: Work, d: Asked, act: Act): Stepped =>
  built(work, (b) => {
    const id = b.name('question')
    const to = d.to
    const question =
      to._tag === 'Agent'
        ? Moves.askQuestion({
            _tag: 'Question',
            id,
            text: d.text,
            stops: assignmentAt(work, to.assignment).task,
            answerBy: to.assignment,
            from: personOf(work, act.by),
            when: act.when,
          })
        : Moves.askQuestion({
            _tag: 'Question',
            id,
            text: d.text,
            stops: assignmentAt(work, assignmentBy(act.by)).task,
            answerBy: firstAnswerer(work, assignmentAt(work, assignmentBy(act.by)), to._tag),
            from: assignmentBy(act.by),
            when: act.when,
          })
    b.work = { ...b.work, questions: put(b.work.questions, id, question) }
  })

// An escalation with no result: a maker sends its blocked task up; it ends the maker's unit.
export const escalated = (work: Work, e: EventOf<'Question.Escalated'>, act: Act): Stepped =>
  built(work, (b) => {
    const a = assignmentAt(work, assignmentBy(act.by))
    const id = b.name('question')
    const answerBy: Answerer = openAncestorOf(work, a.id) ?? taskAt(work, a.task).owner
    const question = Moves.askQuestion({
      _tag: 'Question',
      id,
      text: e.create.text,
      stops: a.task,
      answerBy,
      from: a.id,
      when: act.when,
    })
    b.work = { ...b.work, questions: put(b.work.questions, id, question) }
    endUnit(b, a.id)
  })

// Only an open question is answered, once.
export const answered = (
  work: Work,
  id: QuestionId,
  text: NonBlank,
  by: Answerer,
  act: Act,
  r: Seq,
): Stepped => {
  const q = work.questions.get(id)
  if (q?.status._tag !== 'Open') return damaged(r, `${id} is no open question`)
  const done = Moves.MOVES['Question.Answered']({ ...q, status: q.status }, text, by, act.when)
  return unchanged({ ...work, questions: put(work.questions, id, done) })
}

export const noted = (
  work: Work,
  d: EventOf<'Note.Message'>['create'] | EventOf<'Note.Finding'>['create'],
  act: Act,
): Stepped =>
  built(work, (b) => {
    const id = b.name('note')
    const note =
      d._tag === 'Message'
        ? { _tag: 'Message' as const, id, about: d.about, text: d.text, by: act.by, when: act.when }
        : { _tag: 'Finding' as const, id, about: d.about, text: d.text, when: act.when }
    b.work = { ...b.work, notes: put(b.work.notes, id, note) }
  })

// The high role of the task's tree, or the person, says what is wrong, why, and what to improve.
// After the owner rejected an evaluation of the task, the next one of an agent waits too.
// (derived: EvaluationState owns the owner's decision; the record keeps `after` as a fact.)
export const evaluated = (work: Work, e: EventOf<'Evaluation.Evaluation'>, act: Act): Stepped =>
  built(work, (b) => {
    const d = e.create
    const ref = stopRefOrThrow(work, d.stop)
    const task = stopRefTask(work, ref)
    const sameTask = (x: Evaluation) => stopRefTask(work, stopRefOrThrow(work, x.answers)) === task
    const rejected = isPerson(work, act.by)
      ? undefined
      : [...work.evaluations.values()]
          .filter((x) => sameTask(x) && x.at > ref.at)
          .map((x) => evaluationDecision(work, x))
          .find((v) => v?._tag === 'Reject')
    const id = b.name('evaluation')
    const evaluation = {
      id,
      answers: d.stop,
      by: answererBy(work, act.by),
      wrong: d.wrong,
      why: d.why,
      improve: d.improve,
      level: d.level,
      after:
        rejected === undefined
          ? ({ _tag: 'FirstTry' } as const)
          : ({ _tag: 'OwnerRejected', reject: rejected.id as RejectId } as const),
      when: act.when,
      at: b.tick(),
    }
    b.work = { ...b.work, evaluations: put(b.work.evaluations, id, evaluation) }
  })

export const granted = (work: Work, e: EventOf<'Permission.Granted'>, act: Act): Stepped =>
  built(work, (b) => {
    const d = e.create
    const id = b.name('permission')
    const permission = Moves.grantPermission({
      id,
      act: d.act,
      to: d.to,
      by: act.by,
      until: d.until,
      when: act.when,
      at: b.tick(),
    })
    b.work = { ...b.work, permissions: put(b.work.permissions, id, permission) }
  })
// The giver ends a permission early, once; the acts before the revoke stay.
export const revoked = (
  work: Work,
  e: EventOf<'Permission.Revoked'>,
  act: Act,
  r: Seq,
): Stepped => {
  const x = work.permissions.get(e.id)
  if (x?.revoked._tag !== 'NotRevoked') return damaged(r, `${e.id} is no permission in force`)
  const done = Moves.MOVES['Permission.Revoked']({ ...x, revoked: x.revoked }, act.when)
  return unchanged({ ...work, permissions: put(work.permissions, e.id, done) })
}
