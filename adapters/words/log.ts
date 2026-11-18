// One line for one stored event as work log and the timeline of the
// page print it. Parity: the line is the OLD line,
//   e<seq> HH:MM <who> (<channel>) <old type> <parts> -> <created>
// rendered from the NEW event: oldType maps each group and member back to its old type word,
// and whoOf (domain/actor.ts) the Author back to the old who and channel strings, until the
// renames after parity.
import {
  type Event,
  kindOf,
  type Logged,
  type Total,
  whoOf,
  type Work,
} from '../../core/schema/index.ts'
import { clock } from './common.ts'

const cut = (t: string): string => (t.length > 60 ? `${t.slice(0, 57)}...` : t)

// What the line says after the old type word, ('' when nothing).
const partsOf = (logged: Logged, work: Work | undefined): string => {
  const e = logged.recorded.event
  if (e._tag === 'Revision' && 'create' in e && e.create._tag === 'Revised') {
    const d = e.create
    return `${d.direction}${d.answers.length ? ` answering ${d.answers.join(',')}` : ''}`
  }
  if (e._tag === 'Suggestion') {
    const about = e.create.about
    const name =
      about._tag === 'NewDirection'
        ? 'a new direction'
        : about._tag === 'Roles'
          ? 'the roles'
          : about._tag === 'Direction'
            ? about.direction
            : about.key
    return `${name}: "${cut(e.create.says)}"`
  }
  if (e._tag === 'Source') {
    if ('create' in e) return `${e.create.source.name}@${e.create.source.revision}`
    return `${e.id}@${revisionBefore(logged, work, e.id)}`
  }
  return ''
}

// The revision that an agent read again: the one of the latest move of the source before it.
const revisionBefore = (logged: Logged, work: Work | undefined, name: string): string => {
  const before = work?.events.filter((l) => l.recorded.seq < logged.recorded.seq) ?? []
  for (const l of before.reverse()) {
    const e = l.recorded.event
    if (e._tag === 'Source' && 'create' in e && e.create.source.name === name) {
      return e.create.source.revision
    }
  }
  return ''
}

// One line for one stored event. Work: a resolve and a re-read source name what the event only
// names by its id; without it they print that id.
export const logLine = (work: Work, logged: Logged): string => {
  const { seq, at, author, event } = logged.recorded
  const { who, channel } = whoOf(author)
  const parts = partsOf(logged, work)
  const made = logged.created.length ? ` -> ${logged.created.join(', ')}` : ''
  return (
    `e${seq} ${clock(at)} ${who} (${channel}) ` +
    `${oldType(event)}${parts ? ` ${parts}` : ''}${made}`
  )
}

// The old type word of each kind of event: a table with one row per kind, so a new kind fails
// the compile here until it has its word.
const OLD_TYPE: Total<string> = {
  'Workflow.Defined': 'config',
  'Workflow.RoleWordsChanged': 'config.text',
  'Role.Fitted': 'role.fit',
  'Role.WordsDrafted': 'role.draft',
  'Role.WordsRejected': 'role.reject',
  // New (onboarding): the start of an agent's terminal, and the adjustments.
  'Agent.Started': 'agent.start',
  'Adjustment.Drafted': 'adjust',
  'Adjustment.Accepted': 'adjust.accept',
  'Adjustment.Rejected': 'adjust.reject',
  'Run.HostJoined': 'run.start',
  'Run.HostStarted': 'run.start',
  'Run.HostMoved': 'run.continue',
  'Run.Done': 'run.done',
  'Run.Closed': 'run.close',
  'TaskDraft.Drafted': 'task.draft',
  'Problem.Recorded': 'problem',
  'Problem.Fixed': 'problem',
  'Terminal.Started': 'session',
  'Terminal.Failed': 'terminal.event',
  'Terminal.Prompted': 'terminal.event',
  'Terminal.Stopped': 'terminal.event',
  'Terminal.Resumed': 'terminal.event',
  'Terminal.Closed': 'terminal.event',
  'Send.Sent': 'send',
  // New: the old supervisor kept the fate of a send in memory.
  'Send.Delivered': 'send.delivered',
  'Send.Dropped': 'send.dropped',
  'HostWords.ProblemWords': 'note',
  'HostWords.DraftWords': 'note',
  'HostWords.EndWords': 'note',
  'Task.Opened': 'task.open',
  'Task.OpenedFromDraft': 'task.open',
  'Task.Remade': 'task.remake',
  'Task.Split': 'task.split',
  'Task.Closed': 'task.close',
  'Task.Described': 'task.describe', // new: the person's description of a task
  'Assignment.GivenMaker': 'assign',
  'Assignment.GivenReviewer': 'assign',
  'Assignment.Briefed': 'brief',
  'Assignment.BriefedToCheck': 'brief',
  'Assignment.BriefedFirst': 'brief',
  'Assignment.Freed': 'free',
  'Assignment.Finished': 'finish',
  'Result.Result': 'report',
  'Review.Accept': 'review',
  'Review.Reject': 'review',
  'Review.Recheck': 'review',
  'Review.Escalate': 'escalate',
  'Review.Resolve': 'resolve',
  // Inside a forward, the person's question to an agent was person.ask.
  'Question.Asked': 'ask',
  'Question.Escalated': 'escalate',
  'Question.Answered': 'answer',
  'Note.Message': 'note',
  'Note.Finding': 'note',
  'Evaluation.Evaluation': 'evaluate',
  'Suggestion.Suggestion': 'suggest',
  'Revision.Drafted': 'direction.new',
  'Revision.Revised': 'direction.revise',
  'Revision.Imported': 'company.import',
  'Revision.ExamplesAdded': 'direction.examples',
  'Permission.Granted': 'grant',
  'Permission.Revoked': 'revoke',
  'Source.Moved': 'source',
  // New: the old CLI stored the same revision again as a source.
  'Source.Checked': 'source',
  'Checkpoint.Checkpoint': 'checkpoint',
  'Forward.Forwarded': 'forward',
  'Forward.Confirmed': 'confirm',
  'Work.Opened': 'work.open',
  'Work.Acted': 'work.act',
  'Work.HostPane': 'work.host-pane',
  'Work.Forwarded': 'work.forwarded',
  'Work.ForwardDropped': 'work.forward-dropped',
}
export const oldType = (event: Event): string => OLD_TYPE[kindOf(event)]
