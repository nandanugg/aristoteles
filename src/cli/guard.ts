// The checks that hold for every act of an agent, in one place: its assignment is open, it has a
// claim where the act needs one, and each target is inside its task tree. The table is keyed by the
// kind of an act (its record and its member), and total over the acts that an agent may write, so a
// new kind fails the compile until it has a row.
import { Effect } from 'effect'
import { refuse, type Refused } from '../domain/errors.ts'
import { type AgentKind, type Event, type EventOf, kindOf } from '../domain/events.ts'
import type { TaskId } from '../domain/ids.ts'
import { lookup, type Found } from '../domain/lookup.ts'
import type { Work } from '../domain/work.ts'
import { within } from '../engine/queries.ts'
import type { Call } from './command.ts'
import { agentOf, needClaim, needOpen } from './caller.ts'

// One row: whether the act needs a claim, and the ids that must be in the caller's task tree,
// read from the act itself (a typed read, so a renamed field fails the compile).
export interface Guard<K extends AgentKind = AgentKind> {
  readonly claim: boolean
  readonly targets: (event: EventOf<K>) => ReadonlyArray<string>
}

const open = { claim: false, targets: () => [] } as const
const claimed = { claim: true, targets: () => [] } as const
// The record that a move names, by its id.
const onRecord = (claim: boolean) => ({ claim, targets: (e: { readonly id: string }) => [e.id] })

// One row per kind that an agent writes (events.ts WRITTEN_BY): a new kind fails the compile
// here until it has a row. null: the old table had no row, so the command checks for itself (a
// brief is the claim, a send and a problem check their own words); giving them a row would add a
// refusal that the old code never gave. The rows of a review are the old one row: its target is
// in the tree (a resolve's target is its escalation's result).
export const GUARD: { readonly [K in AgentKind]: Guard<K> | null } = {
  'Role.Fitted': open,
  'Problem.Recorded': null,
  'Problem.Fixed': null,
  'Send.Sent': null,
  'HostWords.ProblemWords': open,
  'HostWords.DraftWords': open,
  'HostWords.EndWords': open,
  'Task.Remade': onRecord(true),
  'Task.Split': onRecord(true),
  'Task.Closed': onRecord(true),
  'Assignment.GivenMaker': { claim: true, targets: (e) => [e.create.task] },
  'Assignment.GivenReviewer': { claim: true, targets: (e) => [e.create.task] },
  'Assignment.Briefed': null,
  'Assignment.BriefedToCheck': null,
  'Assignment.BriefedFirst': null,
  'Assignment.Freed': onRecord(false),
  'Assignment.Finished': onRecord(false),
  'Result.Result': claimed,
  'Review.Accept': { claim: true, targets: (e) => [e.create.of.id] },
  'Review.Reject': { claim: true, targets: (e) => [e.create.of.id] },
  'Review.Recheck': { claim: true, targets: (e) => [e.create.of] },
  'Review.Resolve': { claim: true, targets: (e) => [e.create.escalation] },
  // The CLI word: escalate --result; escalate with no result is Question.Escalated.
  'Review.Escalate': { claim: false, targets: (e) => [e.create.of] },
  'Question.Asked': open,
  'Question.Escalated': open,
  'Question.Answered': onRecord(false),
  'Note.Message': open,
  'Note.Finding': open,
  'Evaluation.Evaluation': claimed,
  'Suggestion.Suggestion': open,
  'Revision.Drafted': claimed,
  'Revision.Revised': claimed,
  'Permission.Granted': open,
  'Permission.Revoked': open,
  'Source.Moved': open,
  'Source.Checked': open,
  'Checkpoint.Checkpoint': { claim: false, targets: (e) => [e.create.task] },
  'Forward.Forwarded': claimed,
}

// The row of an event, and its targets; undefined: an agent never writes it.
const rowOf = (
  event: Event,
): { readonly claim: boolean; readonly targets: ReadonlyArray<string> } | null | undefined => {
  const rows: Readonly<Record<string, Guard<never> | null>> = GUARD
  const row = rows[kindOf(event)]
  if (!row) return row
  // The row of the event's own kind reads it.
  const targets = row.targets as (e: Event) => ReadonlyArray<string>
  return { claim: row.claim, targets: targets(event) }
}

// The command that writes each act, as the old write() keyed its first check (ctx.type). One
// row stands for the members of a review and the two acts of escalate: their rows are the
// same as the old one row.
const ROW_OF_COMMAND: Readonly<Record<string, Guard | null>> = {
  assign: GUARD['Assignment.GivenMaker'],
  report: GUARD['Result.Result'],
  review: GUARD['Review.Accept'],
  recheck: GUARD['Review.Accept'],
  resolve: GUARD['Review.Resolve'],
  escalate: GUARD['Review.Escalate'],
  ask: GUARD['Question.Asked'],
  answer: GUARD['Question.Answered'],
  note: GUARD['Note.Message'],
  suggest: GUARD['Suggestion.Suggestion'],
  source: GUARD['Source.Moved'],
  checkpoint: GUARD['Checkpoint.Checkpoint'],
  'task split': GUARD['Task.Split'],
  'task close': GUARD['Task.Closed'],
  'task remake': GUARD['Task.Remade'],
  'direction revise': GUARD['Revision.Revised'],
  'direction new': GUARD['Revision.Drafted'],
  forward: GUARD['Forward.Forwarded'],
  free: GUARD['Assignment.Freed'],
  finish: GUARD['Assignment.Finished'],
  role: GUARD['Role.Fitted'],
  evaluate: GUARD['Evaluation.Evaluation'],
  grant: GUARD['Permission.Granted'],
  revoke: GUARD['Permission.Revoked'],
}

// The row of the act that this command writes (old ctx.type); null: the command has none.
const guardOfCall = (call: Call): { readonly claim: boolean } | null => {
  const sub = call.args.positional[0]
  const key = call.name === 'task' || call.name === 'direction' ? `${call.name} ${sub}` : call.name
  return (Object.hasOwn(ROW_OF_COMMAND, key) ? ROW_OF_COMMAND[key] : undefined) ?? null
}

// Before the command builds its act: the agent's assignment is open, and has a claim where the
// act needs one. A refusal of the token itself comes first, as before.
export const guardCall = (work: Work, call: Call): Effect.Effect<void, Refused> =>
  Effect.gen(function* () {
    const rule = guardOfCall(call)
    if (call.token === null || rule === null) return
    const a = yield* agentOf(work, call.token)
    yield* needOpen(work, a)
    if (rule.claim) yield* needClaim(work, a, call.token)
  })

// The task that a record is in. An escalation is in the task of its result (a resolve names the
// escalation).
const taskOf = (work: Work, found: Found): TaskId | undefined => {
  switch (found._tag) {
    case 'Review':
      return found.review._tag === 'Escalate'
        ? work.results.get(found.review.of)?.task
        : undefined
    case 'Point':
      return undefined
    case 'Task':
      return found.task.id
    case 'Result':
      return found.result.task
    case 'Assignment':
      return found.assignment.task
    // A question stops one task: its asker's (every writer sets it).
    case 'Question':
      return found.question.stops
    default:
      // A draft and an evaluation have no task: anyone outside its reviser's tree may review it.
      return undefined
  }
}

// After the command built its act, for an act of an agent: open, claim, and each target inside
// the task tree of the agent's assignment.
export const guard = (work: Work, event: Event, token: string): Effect.Effect<void, Refused> =>
  Effect.gen(function* () {
    const rule = rowOf(event)
    if (!rule) return
    const a = yield* agentOf(work, token)
    yield* needOpen(work, a)
    if (rule.claim) yield* needClaim(work, a, token)
    for (const id of rule.targets) {
      const task = taskOf(work, yield* lookup(work, id, ['t', 'r', 'q', 'a', 'd', 'ev', 'v']))
      if (task === undefined) continue
      if (!within(work, task, a.task)) {
        return yield* refuse(`${id} is outside the task tree of ${a.id} (${a.task})`)
      }
    }
  })
