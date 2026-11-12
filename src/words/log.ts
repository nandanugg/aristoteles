// One line for one stored event as work log and the timeline of the
// page print it. Parity: the line is the OLD line,
//   e<seq> HH:MM <who> (<channel>) <old type> <parts> -> <created>
// rendered from the NEW event: oldType maps each group and member back to its old type word,
// and whoOf (domain/actor.ts) the Author back to the old who and channel strings, until the
// renames after parity.
import { whoOf } from '../domain/actor.ts'
import { type Event, kindOf, type Total } from '../domain/events.ts'
import type { Logged } from '../domain/work.ts'
import type { Work } from '../domain/work.ts'
import { clock } from './common.ts'
import { describeInner } from './show.ts'

const cut = (t: string): string => (t.length > 60 ? `${t.slice(0, 57)}...` : t)

// The evidence part of a review: the rule of each line, or the kind of thing it was about.
const evidenceWords = (
  target: string,
  evidence: ReadonlyArray<{ readonly rule: string | null }>,
) => {
  if (evidence.length === 0) return ''
  const prefix = /^[a-z]+/.exec(target)?.[0]
  const thing = prefix === 'd' ? 'draft' : prefix === 'ev' ? 'evaluation' : 'result'
  return ` evidence for ${evidence.map((e) => e.rule ?? `the ${thing}`).join(', ')}`
}

// What the line says after the old type word, ('' when nothing).
const partsOf = (logged: Logged, work: Work | undefined): string => {
  const e = logged.recorded.event
  if (e._tag === 'Assignment') {
    if ('create' in e) return `${e.create.role} on ${e.create.task}`
    return e.move._tag === 'Freed' || e.move._tag === 'Finished' ? e.id : ''
  }
  if (e._tag === 'Result') return e.create.output
  if (e._tag === 'Review') {
    const d = e.create
    switch (d._tag) {
      case 'Accept':
        return `${d.of.id} accept${evidenceWords(d.of.id, d.of.evidence)}`
      case 'Reject': {
        const of = d.of
        const points =
          of._tag === 'Result' || of._tag === 'Task'
            ? `: ${of.points
                .map(
                  (p) =>
                    `"${cut(p.text)}"${'breaks' in p && p.breaks ? ` breaks ${p.breaks}` : ''}`,
                )
                .join('; ')}`
            : ''
        return `${of.id} reject${points}`
      }
      case 'Recheck':
        return `${d.of} recheck`
      case 'Escalate':
        return `on ${d.of} "${cut(d.reason)}"`
      case 'Resolve': {
        const escalated = work?.reviews.get(d.escalation)
        const target = escalated?._tag === 'Escalate' ? escalated.of : d.escalation
        return `${d.escalation} on ${target}${evidenceWords(target, d.evidence)}`
      }
    }
  }
  if (e._tag === 'Question') {
    if ('move' in e) return `${e.id}: "${cut(e.move.text)}"`
    return `"${cut(e.create.text)}"`
  }
  if (e._tag === 'Permission' && 'create' in e) {
    const act = e.create.act
    const on = act._tag === 'Change' ? act.changesOf : act.resultsOf
    return `${act._tag.toLowerCase()} on ${on.join(',')} to ${e.create.to} until ${e.create.until}`
  }
  if (e._tag === 'Forward') {
    if ('move' in e) return e.id
    const d = e.create
    return `${d.person} ${describeInner(d.inner, work)} (${d.channel}) words "${cut(d.quote)}"`
  }
  if (e._tag === 'Revision' && 'create' in e && e.create._tag === 'Revised') {
    const d = e.create
    return `${d.direction}${d.answers.length ? ` answering ${d.answers.join(',')}` : ''}`
  }
  if (e._tag === 'Suggestion') {
    const about = e.create.about
    const name =
      about._tag === 'NewDirection'
        ? 'a new direction'
        : about._tag === 'Direction'
          ? about.direction
          : about.key
    return `${name}: "${cut(e.create.says)}"`
  }
  if (e._tag === 'Evaluation') return `${e.create.stop.id} at the level ${e.create.level}`
  if (e._tag === 'Task' && 'move' in e) {
    if (e.move._tag === 'Split')
      return `${e.id}${e.move.review ? ` answering ${e.move.review}` : ''}`
    if (e.move._tag === 'Closed') return `${e.id} "${cut(e.move.reason)}"`
    return ''
  }
  if (e._tag === 'Source') {
    if ('create' in e) return `${e.create.source.name}@${e.create.source.revision}`
    return `${e.id}@${revisionBefore(logged, work, e.id)}`
  }
  if (e._tag === 'Checkpoint') return `${e.create.task} next "${cut(e.create.next)}"`
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
export const logLine = (logged: Logged, work?: Work): string => {
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
  'Run.HostStarted': 'run.start',
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
  'Permission.Granted': 'grant',
  'Permission.Revoked': 'revoke',
  'Source.Moved': 'source',
  // New: the old CLI stored the same revision again as a source.
  'Source.Checked': 'source',
  'Checkpoint.Checkpoint': 'checkpoint',
  'Forward.Forwarded': 'forward',
  'Forward.Confirmed': 'confirm',
}
export const oldType = (event: Event): string => OLD_TYPE[kindOf(event)]

// The ids that a logged event touches (the panel's timeline of a task keeps these events): who
// wrote it, what its step made, and what it names, as the old data keys task, target, a, result,
// q and stop did.
export const touchedIds = (logged: Logged): ReadonlyArray<string> => {
  const e = logged.recorded.event
  const named: Array<string> = []
  if (e._tag === 'Assignment') named.push('create' in e ? e.create.task : e.id)
  else if (e._tag === 'Review') {
    const d = e.create
    if (d._tag === 'Accept' || d._tag === 'Reject') named.push(d.of.id)
    else if (d._tag === 'Recheck' || d._tag === 'Escalate') named.push(d.of)
  } else if (e._tag === 'Task' && 'move' in e) named.push(e.id)
  else if (e._tag === 'Question' && 'move' in e) named.push(e.id)
  else if (e._tag === 'Evaluation') named.push(e.create.stop.id)
  else if (e._tag === 'Checkpoint') named.push(e.create.task)
  return [whoOf(logged.recorded.author).who, ...logged.created, ...named]
}
