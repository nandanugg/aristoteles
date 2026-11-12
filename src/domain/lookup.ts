// A record by the id that a person or an agent typed. The refusal words are
// golden text: '"x9" is not a task id (t..)' and 'there is no task t9'.
import { Effect } from 'effect'
import { pointOf, type RejectPoint } from './derived.ts'
import { refuse, type Refused } from './errors.ts'
import { isPrefix, NOUN, type PointId, prefixOf } from './ids.ts'
import type {
  Assignment,
  Checkpoint,
  Direction,
  Evaluation,
  Exhaustion,
  Note,
  Permission,
  Question,
  Result,
  Review,
  Revision,
  Suggestion,
  Task,
} from './model.ts'
import type { Problem, Run, TaskDraft } from './ui-model.ts'
import type { Work } from './work.ts'

// What an id names. v4 is a Review (a Reject holds its points); v4.1 is one point of it.
export type Found =
  | { readonly _tag: 'Task'; readonly task: Task }
  | { readonly _tag: 'Assignment'; readonly assignment: Assignment }
  | { readonly _tag: 'Result'; readonly result: Result }
  | { readonly _tag: 'Review'; readonly review: Review }
  | ({ readonly _tag: 'Point' } & RejectPoint)
  | { readonly _tag: 'Permission'; readonly permission: Permission }
  | { readonly _tag: 'Checkpoint'; readonly checkpoint: Checkpoint }
  | { readonly _tag: 'Question'; readonly question: Question }
  | { readonly _tag: 'Note'; readonly note: Exclude<Note, Question> }
  | { readonly _tag: 'Suggestion'; readonly suggestion: Suggestion }
  | { readonly _tag: 'Revision'; readonly revision: Revision<Direction> }
  | { readonly _tag: 'Exhaustion'; readonly exhaustion: Exhaustion }
  | { readonly _tag: 'Evaluation'; readonly evaluation: Evaluation }
  | { readonly _tag: 'Run'; readonly run: Run }
  | { readonly _tag: 'TaskDraft'; readonly taskDraft: TaskDraft }
  | { readonly _tag: 'Problem'; readonly problem: Problem }

const get = <K, V>(map: ReadonlyMap<K, V>, id: string): V | undefined => map.get(id as K)
const wrap = <V, F>(v: V | undefined, f: (v: V) => F): F | undefined =>
  v === undefined ? undefined : f(v)

// The record of an id, or undefined.
export const find = (work: Work, id: string): Found | undefined => {
  switch (prefixOf(id)) {
    case 't':
      return wrap(get(work.tasks, id), (task) => ({ _tag: 'Task', task }))
    case 'a':
      return wrap(get(work.assignments, id), (assignment) => ({ _tag: 'Assignment', assignment }))
    case 'r':
      return wrap(get(work.results, id), (result) => ({ _tag: 'Result', result }))
    case 'v':
      return /\.\d+$/.test(id)
        ? wrap(pointOf(work, id as PointId), (p) => ({ _tag: 'Point', ...p }))
        : wrap(get(work.reviews, id), (review) => ({ _tag: 'Review', review }))
    case 'x':
      return wrap(get(work.permissions, id), (permission) => ({ _tag: 'Permission', permission }))
    case 'k':
      return wrap(get(work.checkpoints, id), (checkpoint) => ({ _tag: 'Checkpoint', checkpoint }))
    case 'q':
      return wrap(get(work.questions, id), (question) => ({ _tag: 'Question', question }))
    case 'n':
      return wrap(get(work.notes, id), (note) => ({ _tag: 'Note', note }))
    case 's':
      return wrap(get(work.suggestions, id), (suggestion) => ({ _tag: 'Suggestion', suggestion }))
    case 'd':
      return wrap(get(work.drafts, id), (revision) => ({ _tag: 'Revision', revision }))
    case 'ex':
      return wrap(get(work.exhaustions, id), (exhaustion) => ({ _tag: 'Exhaustion', exhaustion }))
    case 'ev':
      return wrap(get(work.evaluations, id), (evaluation) => ({ _tag: 'Evaluation', evaluation }))
    case 'h':
      return wrap(get(work.runs, id), (run) => ({ _tag: 'Run', run }))
    case 'td':
      return wrap(get(work.taskDrafts, id), (taskDraft) => ({ _tag: 'TaskDraft', taskDraft }))
    case 'sp':
      return wrap(get(work.problems, id), (problem) => ({ _tag: 'Problem', problem }))
    default:
      return undefined
  }
}

const nounOf = (prefix: string) =>
  isPrefix(prefix) ? NOUN[prefix] : `record with the prefix ${prefix}`

// The record of a typed id, of one of the expected prefixes, or a refusal.
export const lookup = (
  work: Work,
  id: string,
  expected: ReadonlyArray<string>,
): Effect.Effect<Found, Refused> => {
  const prefix = prefixOf(id) ?? ''
  if (expected.length && !expected.includes(prefix)) {
    const kinds = expected.map((p) => `a ${nounOf(p)} id (${p}..)`).join(' or ')
    return Effect.fail(refuse(`"${id}" is not ${kinds}`))
  }
  const found = find(work, id)
  return found ? Effect.succeed(found) : Effect.fail(refuse(`there is no ${nounOf(prefix)} ${id}`))
}

type Of<K extends Found['_tag']> = Extract<Found, { readonly _tag: K }>

export const lookupTask = (work: Work, id: string): Effect.Effect<Task, Refused> =>
  lookup(work, id, ['t']).pipe(Effect.map((f) => (f as Of<'Task'>).task))
export const lookupAssignment = (work: Work, id: string): Effect.Effect<Assignment, Refused> =>
  lookup(work, id, ['a']).pipe(Effect.map((f) => (f as Of<'Assignment'>).assignment))
export const lookupResult = (work: Work, id: string): Effect.Effect<Result, Refused> =>
  lookup(work, id, ['r']).pipe(Effect.map((f) => (f as Of<'Result'>).result))
