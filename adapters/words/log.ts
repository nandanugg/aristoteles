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

// What the line says after the old type word, ('' when nothing).
const partsOf = (logged: Logged, work: Work | undefined): string => {
  const e = logged.recorded.event
  if (e._tag === 'Revision' && 'create' in e && e.create._tag === 'Revised') {
    const d = e.create
    return `${d.direction}${d.answers.length ? ` answering ${d.answers.join(',')}` : ''}`
  }
  if (e._tag === 'Source') {
    if ('create' in e) return `${e.create.source.name}@${e.create.source.revision}`
    return `${e.id}@${revisionBefore(logged, work, e.id)}`
  }
  return ''
}

// The revision that the host read again: the one of the latest move of the source before it.
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

// One line for one stored event. Work: a re-read source names what the event only names by its id.
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
  'Workflow.Activated': 'activated',
  'Workflow.HostRebound': 'host.rebound',
  'Role.Fitted': 'role.fit',
  'Send.Sent': 'send',
  'Send.Delivered': 'send.delivered',
  'Send.Dropped': 'send.dropped',
  'Review.Accept': 'review',
  'Review.Reject': 'review',
  'Revision.Drafted': 'direction.new',
  'Revision.Revised': 'direction.revise',
  'Revision.Imported': 'company.import',
  'Revision.ExamplesAdded': 'direction.examples',
  'Source.Moved': 'source',
  'Source.Checked': 'source',
  'Work.Opened': 'work.open',
  'Work.Acted': 'work.act',
  'Work.HostPane': 'work.host-pane',
  'Work.Forwarded': 'work.forwarded',
  'Runtime.WorkerReserved': 'reserved a worker',
  'Runtime.WorkerBound': 'bound a worker',
  'Runtime.WorkerFenced': 'fenced a worker',
  'Runtime.WorkerEnded': 'ended a worker',
  'Runtime.TurnOffered': 'offered a worker turn',
  'Runtime.TurnClosed': 'closed a worker turn',
  'Work.ForwardDropped': 'work.forward-dropped',
}
export const oldType = (event: Event): string => OLD_TYPE[kindOf(event)]
