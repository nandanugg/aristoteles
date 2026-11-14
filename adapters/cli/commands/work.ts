// The commands brief, report, review, resolve, recheck, escalate, ask, answer, note, evaluate,
// checkpoint, resume, source. Each builds the ActionInput of its act, dispatches it, and prints the
// words of the act from the new Work.
import { Effect } from 'effect'
import { nextFor } from '../../../core/derived/index.ts'
import {
  assignmentAt,
  evaluationCounts,
  evaluationWaits,
  resultsOf,
  roleAt,
  stopTask,
  tierOf,
  usedBy,
  within,
  workStop,
} from '../../../core/derived/reads.ts'
import { blockersOf } from '../../../core/derived/index.ts'
import type { AcceptOf, RejectOf } from '../../../core/schema/actions.ts'
import {
  type AssignmentId,
  type CheckpointId,
  type CreatedId,
  type EscalationId,
  type Level,
  lookup,
  type NonBlank,
  type NonEmpty,
  type ProblemId,
  type QuestionId,
  refuse,
  revisionOf,
  type RevisionId,
  type ResultId,
  type RunId,
  type Stop,
  versionIdOf,
  whoOf,
} from '../../../core/schema/index.ts'
import { isNonBlank } from '../../../core/schema/index.ts'
import {
  briefOf,
  draftWaitsText,
  nextLines,
  renderDraft,
  reviseAgainOf,
  stopIdOf,
  taskStateWord,
} from '../../words/index.ts'
import { textOf, wordsOf } from '../args.ts'
import { agentCallerOf, authorOf, callerOf, tokenOfCall } from '../caller.ts'
import type { Call, Command, Commands } from '../command.ts'
import { lookupKind } from '../lookups.ts'
import { runPrograms } from '../programs.ts'
import { followCommit } from '../refresh.ts'
import { act, derivedAfter, firstCreated, peekWork, readWork } from '../runtime.ts'
import { afterVersion, evidenceOf, pointsOf, versionMadeBy } from '../shared.ts'

const upTo = (parent: boolean): string => (parent ? 'your parent' : 'the person')
const maxAttemptsOf = (a: { readonly _tag: string; readonly maxAttempts?: unknown }) => {
  const m = a.maxAttempts as { readonly _tag: string; readonly max?: number } | undefined
  return a._tag === 'Maker' && m?._tag === 'AtMost' ? m.max : undefined
}

// The agent that holds the token, and its author.
const agentOfCall = (call: Call) =>
  Effect.gen(function* () {
    const { work, d } = yield* peekWork
    const caller = yield* agentCallerOf(work, tokenOfCall(call))
    const a = assignmentAt(work, caller.assignment)
    return { work, d, caller, a, by: authorOf(caller) }
  })

// --- brief -------------------------------------------------------------------------------------

// The brief of an agent: its snapshot and its claim. A refusal that the agent must obey is a
// refusal; the words that end an agent's work (no attempts left) are lines.
const brief: Command = (call) =>
  Effect.gen(function* () {
    const { caller, a, by } = yield* agentOfCall(call)
    const done = yield* act(by, {
      _tag: 'Brief',
      target: { assignment: caller.assignment },
      content: {},
    })
    if (done.seq === null) {
      // Ruling 10.9: a brief over its limit stores nothing; its words say that the agent waits.
      const after = yield* derivedAfter(done.work)
      if (after.states.assignments.get(a.id)?._tag === 'BriefOver') {
        return [briefOf(after, a.id, caller.token)]
      }
      // A maker of a task that waits for an evaluation is told so before the count of its tries.
      const stop = workStop(done.work, a.task)
      if (stop) {
        return yield* refuse(
          stop,
          `STOP and tell ${upTo(a.parent._tag === 'Parent')}; work next says when the work goes on`,
        )
      }
      const parent = a.parent._tag === 'Parent'
      return [
        `${a.id} has used its ${maxAttemptsOf(a)} attempts; it makes no new result.`,
        parent
          ? `STOP and tell your parent: it assigns a new ${a.role}.`
          : `STOP: the person assigns a new ${a.role}.`,
      ]
    }
    return [briefOf(yield* derivedAfter(done.work), a.id, caller.token)]
  })

// --- report ------------------------------------------------------------------------------------

const report: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const output = args.one('output')
    if (!output || output === true) {
      return yield* refuse('a report needs --output=<what you made, and where>')
    }
    const { caller, a, by } = yield* agentOfCall(call)
    const madeFrom = args.all('made-from').map(String)
    const done = yield* act(by, {
      _tag: 'Report',
      target: { assignment: caller.assignment },
      content: { output, madeFrom },
    })
    const result = done.work.results.get(firstCreated(done.created) as ResultId)
    if (!result) return yield* Effect.die(`${firstCreated(done.created)} is no result`)
    const tries = usedBy(done.work, a.id)
    const max = maxAttemptsOf(a)
    const lines = [
      tries > 0
        ? `${result.id} reported on ${result.task} (attempt ${tries}${max !== undefined ? ` of ${max}` : ''}).`
        : `${result.id} reported on ${result.task}; it was made under an old version of a direction, so it uses no attempt (the next attempt reads a new brief first).`,
    ]
    yield* runPrograms(done.work, result, (l) => lines.push(l))
    lines.push(
      tierOf(roleAt(done.work, a.role)) === 'low'
        ? 'STOP: your parent continues.'
        : `next: work next ${caller.token}`,
    )
    return lines
  })

// --- review ------------------------------------------------------------------------------------

const review: Command = (call) =>
  Effect.gen(function* () {
    const { args, token } = call
    const [targetWord, decisionWord] = args.positional
    if (decisionWord !== 'accept' && decisionWord !== 'reject') {
      return yield* refuse('a review is accept or reject; to escalate, use work escalate')
    }
    const targetId = String(targetWord)
    const { work, d } = yield* peekWork
    const isDraft = /^d\d+$/.test(targetId)
    const found = yield* lookup(work, targetId, /^(d|ev)\d+$/.test(targetId) ? ['d', 'ev'] : ['r', 't'])
    const confirm =
      token === null && isDraft && decisionWord === 'accept' && found._tag === 'Revision'
        ? { word: 'accept', show: `accept ${targetId}:\n${renderDraft(d, found.revision.id)}` }
        : undefined
    const caller = yield* callerOf(work, token, confirm)
    const by = authorOf(caller)
    const reason = textOf(args.one('reason'))
    let input
    if (decisionWord === 'accept') {
      const evidence = yield* evidenceOf(args.all('evidence'))
      const of: AcceptOf | undefined =
        found._tag === 'Result'
          ? { _tag: 'Result', id: found.result.id }
          : found._tag === 'Revision'
            ? { _tag: 'Revision', id: found.revision.id }
            : found._tag === 'Evaluation'
              ? { _tag: 'Evaluation', id: found.evaluation.id }
              : undefined
      if (of === undefined) {
        return yield* refuse('a task takes only a Reject; an Accept goes on a result of the task')
      }
      input = {
        _tag: 'Accept',
        target: { of },
        content: { evidence, reason: reason ?? null },
      } as const
    } else {
      const of: RejectOf | undefined =
        found._tag === 'Result'
          ? { _tag: 'Result', id: found.result.id }
          : found._tag === 'Task'
            ? { _tag: 'Task', id: found.task.id }
            : found._tag === 'Revision'
              ? { _tag: 'Revision', id: found.revision.id }
              : found._tag === 'Evaluation'
                ? { _tag: 'Evaluation', id: found.evaluation.id }
                : undefined
      if (of === undefined) return yield* Effect.die(`a review of ${targetId} with no target`)
      const person = of._tag === 'Revision' || of._tag === 'Evaluation'
      input = {
        _tag: 'Reject',
        target: { of },
        content: {
          points: person ? [] : pointsOf(args.flags),
          reason: person ? wordsOf(args.one('reason')) : null,
        },
      } as const
    }
    const done = yield* act(by, input)
    const after = yield* derivedAfter(done.work)
    const vid = firstCreated(done.created)
    const w = done.work
    if (found._tag === 'Evaluation') {
      const tid = stopTask(w, found.evaluation.answers)
      return [
        decisionWord === 'accept'
          ? `${vid}: ${targetId} is accepted; it counts for ${tid}.`
          : `${vid}: ${targetId} is rejected; ${tid} waits for a new evaluation.`,
      ]
    }
    if (found._tag === 'Revision') {
      const draft = found.revision.id
      const version = versionMadeBy(after, draft)
      if (version) {
        return [
          `${vid}: accept of ${targetId}. ${targetId} is official: ${versionIdOf(version)}.`,
          ...(yield* followCommit(w, version)),
          ...afterVersion(after, version),
          'next: running agents keep their snapshot; each new work brief follows it.',
        ]
      }
      if (decisionWord === 'reject') {
        if (after.states.revisions.get(draft)?._tag !== 'Vetoed') {
          const direction = w.directions.get(found.revision.of)
          return [
            `${vid}: reject of ${targetId}.`,
            `${targetId} stays open; after this Reject, only the accept of ${direction?.owner.name} makes it official.`,
          ]
        }
        const again = reviseAgainOf(after, draft)
        return [
          `${vid}: reject of ${targetId}.`,
          `${targetId} is ended; ${again.text}.`,
          ...(again.step === null ? [] : [`next: ${again.step}`]),
        ]
      }
      return [
        `${vid}: accept of ${targetId}; it waits for the accept of ${draftWaitsText(after, draft)}.`,
      ]
    }
    const pointCount = input._tag === 'Reject' ? input.content.points.length : 0
    const what =
      input._tag === 'Reject'
        ? `reject of ${targetId} with ${pointCount} point(s): ${Array.from({ length: pointCount }, (_, i) => `${vid}.${i + 1}`).join(', ')}`
        : `accept of ${targetId}`
    // A low checker's unit ends here; the state of the result is its parent's to read.
    if (caller._tag === 'Agent' && tierOf(roleAt(w, assignmentAt(w, caller.assignment).role)) === 'low') {
      const parent = assignmentAt(w, caller.assignment).parent._tag === 'Parent'
      return [`${vid}: your review of ${targetId} is recorded.`, `STOP: ${upTo(parent)} continues.`]
    }
    const lines = [`${vid}: ${what}.`]
    if (found._tag === 'Result') {
      const items = blockersOf(after.moment, found.result.id)
      lines.push(
        items.length
          ? `${targetId} still has ${items.length} blocker(s): work blockers ${targetId}`
          : `${targetId} has no blockers; ${found.result.task} is ${taskStateWord(after.states.tasks.get(found.result.task) as never)}.`,
      )
    }
    return lines
  })

// --- resolve, recheck, escalate, ask, answer, note ----------------------------------------------

const resolve: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const escalationWord = String(args.positional[0])
    const { work } = yield* peekWork
    const caller = yield* callerOf(work, call.token)
    const found = yield* lookup(work, escalationWord, ['v'])
    if (found._tag !== 'Review' || found.review._tag !== 'Escalate') {
      return yield* refuse(
        `${escalationWord} is not an escalation; a resolve ends an escalation`,
        'work waiting lists the escalations that wait for you',
      )
    }
    const evidence = yield* evidenceOf(args.all('evidence'))
    const done = yield* act(authorOf(caller), {
      _tag: 'Resolve',
      target: { escalation: found.review.id as EscalationId },
      content: { resolution: wordsOf(args.one('resolution')), evidence },
    })
    const result = done.work.results.get(found.review.of)
    if (!result) return yield* Effect.die('resolve: the escalation names no result')
    const after = yield* derivedAfter(done.work)
    const items = blockersOf(after.moment, result.id)
    const state = taskStateWord(after.states.tasks.get(result.task) as never)
    return [
      `${firstCreated(done.created)}: resolves ${found.review.id} on ${result.id}.`,
      items.length
        ? `${result.id} still has ${items.length} blocker(s): work blockers ${result.id}`
        : `${result.id} has no blockers; ${result.task} is ${state}.`,
    ]
  })

// A decider asks for a new result after a change outside, or to reopen accepted work.
const recheck: Command = (call) =>
  Effect.gen(function* () {
    const { work, caller, by } = yield* agentOfCall(call)
    const found = yield* lookup(work, String(call.args.positional[0]), ['r'])
    if (found._tag !== 'Result') return yield* Effect.die(`lookup gave a ${found._tag}`)
    const done = yield* act(by, {
      _tag: 'Recheck',
      target: { result: found.result.id },
      content: { reason: wordsOf(call.args.one('reason')) },
    })
    return [
      `${firstCreated(done.created)} asks for a new result of ${found.result.task}; the gates run on the next report.`,
      `next: work next ${caller.token}`,
    ]
  })

const escalate: Command = (call) =>
  Effect.gen(function* () {
    const { work, caller, a, by } = yield* agentOfCall(call)
    const result = textOf(call.args.one('result'))
    const reason = wordsOf(call.args.one('reason'))
    const done = result
      ? yield* act(by, {
          _tag: 'EscalateResult',
          target: { result: (yield* lookupKind('Result', ['r'], work, result)).result.id },
          content: { reason },
        })
      : yield* act(by, { _tag: 'EscalateTask', target: { task: a.task }, content: { reason } })
    const owner = done.work.tasks.get(a.task)?.owner.name
    const to = a.parent._tag === 'Parent' ? a.parent.id : owner
    return [
      `${firstCreated(done.created)} escalated to ${to}.`,
      tierOf(roleAt(done.work, a.role)) === 'low'
        ? 'STOP: your parent continues.'
        : a.parent._tag === 'Parent'
          ? `next: work next ${caller.token}`
          : `next: ${to} answers it; work waiting --for=${to} shows it`,
    ]
  })

const ask: Command = (call) =>
  Effect.gen(function* () {
    const { by } = yield* agentOfCall(call)
    const to = textOf(call.args.one('to')) === 'owner' ? 'Owner' : 'Above'
    const done = yield* act(by, {
      _tag: 'Ask',
      target: { to },
      content: { text: wordsOf(call.args.one('text')) },
    })
    return [`${firstCreated(done.created)} asked; the task waits for the answer.`]
  })

const answer: Command = (call) =>
  Effect.gen(function* () {
    const { work } = yield* peekWork
    const caller = yield* callerOf(work, call.token)
    const word = String(call.args.positional[0])
    const { question } = yield* lookupKind('Question', ['q'], work, word)
    yield* act(authorOf(caller), {
      _tag: 'Answer',
      target: { question: question.id as QuestionId },
      content: { text: wordsOf(call.args.one('text')) },
    })
    return [`${word} answered; the asker's next brief shows the answer.`]
  })

const NOTE_KINDS = { finding: 'Finding', message: 'Message', words: 'Words' } as const

const note: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const which = args.positional[0]
    const kind =
      which !== undefined && Object.hasOwn(NOTE_KINDS, which)
        ? NOTE_KINDS[which as keyof typeof NOTE_KINDS]
        : undefined
    if (!kind) {
      return yield* refuse(
        'a note is a finding, a message, or (the host) words --on=<decision>; a question is work ask',
        'work note <token> finding --text="..." | message --text="..." | words --on=<decision> --text="..."',
      )
    }
    const on = textOf(args.one('on'))
    const hope = textOf(args.one('hope'))
    if (kind === 'Words' && !on) {
      return yield* refuse(
        `work note <token> words --on=<the decision: sp.., d.., h..> --text="<the words>" (work guide decision-words)`,
      )
    }
    // A --hope belongs only to the words of a draft of a direction (--on=d..).
    const direction = kind === 'Words' && /^d\d+$/.test(on ?? '')
    if (!direction && hope) {
      return yield* refuse('--hope is only for the words of a direction problem (--on=d..)')
    }
    const { work, a, by } = yield* agentOfCall(call)
    const text = wordsOf(args.one('text'))
    if (kind === 'Words') {
      const found = yield* lookup(work, String(on), ['sp', 'd', 'h'])
      const target =
        found._tag === 'Problem'
          ? (found.problem.id as ProblemId)
          : found._tag === 'Revision'
            ? (found.revision.id as RevisionId)
            : found._tag === 'Run'
              ? (found.run.id as RunId)
              : undefined
      if (target === undefined) return yield* Effect.die(`lookup of ${String(on)} gave a ${found._tag}`)
      yield* act(by, {
        _tag: 'WriteHostWords',
        target: { on: target },
        content: { text, hope: hope ?? null },
      })
      return [`the words of ${on} are written; the UI shows them on the decision.`]
    }
    const done = yield* act(by, {
      _tag: 'Note',
      target: { task: a.task },
      content: { kind, text },
    })
    return [`${firstCreated(done.created)} noted.`]
  })

// --- evaluate, checkpoint, source, resume ------------------------------------------------------

const LEVELS = ['task', 'standard', 'direction', 'principle'] as const

// An evaluation of a mistake (Nanda, 2026-11-08): it answers one stop; a task id names its first
// stop that waits.
const evaluate: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const [stopId] = args.positional
    if (!stopId) {
      return yield* refuse(
        'use work evaluate [<token>] <stop> --wrong="..." --why="..." --improve="..." --level=task|standard|direction|principle ' +
          '(a stop is ex<n>, the last try of a maker, or v<n>, a Reject of the person; a task id names its first stop)',
      )
    }
    const { work } = yield* peekWork
    const caller = yield* callerOf(work, call.token)
    let stop: Stop
    let stopWord = stopId
    if (/^t\d+$/.test(stopId)) {
      const { task } = yield* lookupKind('Task', ['t'], work, stopId)
      const waits = evaluationWaits(work, task.id)
      if (!waits) return yield* refuse(`${stopId} waits for no evaluation`)
      stop = waits
      stopWord = stopIdOf(waits)
    } else {
      const found = yield* lookup(work, stopId, ['ex', 'v'])
      const reviewed = found._tag === 'Review' ? found.review : undefined
      if (found._tag === 'Exhaustion') stop = { _tag: 'Exhaustion', id: found.exhaustion.id }
      else if (found._tag === 'Point') stop = { _tag: 'PersonReject', id: found.id }
      else if (reviewed?._tag === 'Reject') stop = { _tag: 'PersonReject', id: reviewed.id } as Stop
      else {
        return yield* refuse(
          'an evaluation answers a stop: the last try of a maker that ended on a fault, or a Reject of the person',
        )
      }
    }
    const improves = args.all('improve').map(String)
    const kept = improves.filter(isNonBlank) as Array<NonBlank>
    const [first, ...more] = kept
    if (first === undefined || kept.length < improves.length) {
      return yield* refuse('an evaluation says what to improve, so that the task can continue')
    }
    const level = LEVELS.find((l) => l === args.one('level')) as Level | undefined
    if (level === undefined) {
      return yield* refuse(`the level of the deepest cause is one of: ${LEVELS.join(', ')}`)
    }
    const done = yield* act(authorOf(caller), {
      _tag: 'Evaluate',
      target: { stop },
      content: {
        wrong: wordsOf(args.one('wrong')),
        why: wordsOf(args.one('why')),
        improve: [first, ...more] as unknown as NonEmpty<string>,
        level,
      },
    })
    const w = done.work
    const e = w.evaluations.get(firstCreated(done.created) as never)
    if (!e) return yield* Effect.die('the evaluation was not made')
    const task = stopTask(w, e.answers)
    const next = evaluationWaits(w, task)
    const owner = w.tasks.get(task)?.owner.name
    return [
      `${e.id} evaluates ${task} at the level ${e.level}; it answers ${String(stopWord)}.`,
      !evaluationCounts(w, e)
        ? `It counts after ${owner} accepts it: work review ${e.id} accept --evidence="<where you read> | <what you saw>"`
        : next
          ? `${task} also waits for an evaluation of ${stopIdOf(next)}: work evaluate ${stopIdOf(next)} ...`
          : workStop(w, task)
            ? 'The next maker starts after a change that its improvements ask for: a direction version that says something new to the task, a newer accepted result of a task that it needs, or a remake or a split.'
            : `${task} goes on: work next prints its steps.`,
      call.token ? `next: work next ${call.token}` : 'next: work waiting',
    ]
  })

const checkpoint: Command = (call) =>
  Effect.gen(function* () {
    const { work, by } = yield* agentOfCall(call)
    const taskWord = String(call.args.positional[0])
    const { task } = yield* lookupKind('Task', ['t'], work, taskWord)
    const done = yield* act(by, {
      _tag: 'Checkpoint',
      target: { task: task.id },
      content: { next: wordsOf(call.args.one('next')) },
    })
    return [`${firstCreated(done.created)} saved for ${taskWord}.`]
  })

const source: Command = (call) =>
  Effect.gen(function* () {
    const ref = call.args.positional[0]
    const [name = '', revision] = String(ref ?? '').split('@')
    if (!revision) return yield* refuse('use work source <token> <source>@<revision>')
    const { by } = yield* agentOfCall(call)
    const done = yield* act(by, { _tag: 'ReadSource', target: { name }, content: { revision } })
    // I4: the revision of a git source comes from git, so the act stores nothing (seq null).
    if (done.seq === null) {
      return [
        `${name} is a git source: the CLI reads the base of each commit from git, and a new ` +
          'commit on it asks for no recheck; nothing is recorded.',
      ]
    }
    const event = done.work.events.at(-1)?.recorded.event
    const checked = event?._tag === 'Source' && 'move' in event
    return [checked ? `${name} is still at ${revision}; seen now.` : `${name} is at ${revision}.`]
  })

const resume: Command = (call) =>
  Effect.gen(function* () {
    const { work, d } = yield* readWork
    const caller = yield* agentCallerOf(work, tokenOfCall(call))
    const a = assignmentAt(work, caller.assignment)
    const taskWord = String(call.args.positional[0])
    const { task } = yield* lookupKind('Task', ['t'], work, taskWord)
    if (!within(work, task.id, a.task)) {
      return yield* refuse(`${taskWord} is outside the task tree of ${a.id}`)
    }
    const saved = [...work.checkpoints.values()].filter((k) => k.task === task.id).at(-1)
    if (!saved?.id) {
      return [`${taskWord} has no checkpoint; work next ${caller.token} shows what is ready.`]
    }
    const savedId = saved.id
    const savedAt = work.events.find((l) => l.created.includes(savedId as CheckpointId as CreatedId))
    const author = savedAt ? whoOf(savedAt.recorded.author).who : undefined
    // The answers that came after the checkpoint, to questions about this tree.
    const answeredSince = work.events
      .filter((l) => l.recorded.seq > (savedAt?.recorded.seq ?? 0))
      .flatMap(({ recorded: { event: e } }) =>
        e._tag === 'Question' && 'move' in e && e.move._tag === 'Answered' ? [e.id] : [],
      )
      .filter((q) => {
        const asked = work.questions.get(q)
        return asked !== undefined && within(work, asked.stops, task.id)
      })
    const revision = (s: { readonly _tag: string }) => revisionOf(s as never)
    const changedOutside = [...work.sources.values()].filter(
      (now) =>
        !saved.seenOutside.some((seen) => seen.name === now.name && revision(seen) === revision(now)),
    )
    // Only a result built on a revision that is no longer current needs a recheck.
    const latest = resultsOf(work, task.id).at(-1)
    const stale = resultsOf(work, task.id).filter(
      (r) => r.id === latest?.id && d.moment.outside.stale.has(r.id),
    )
    const lines = nextLines(
      d,
      nextFor(d, { _tag: 'Agent', assignment: a.id as AssignmentId }),
      caller.token,
    )
    return [
      `resume ${taskWord} from ${savedId} (saved by ${author}): next was "${saved.next}"`,
      `changed outside: ${changedOutside.map((c) => `${c.name}@${revision(c)}`).join(', ') || 'nothing'}`,
      ...(answeredSince.length
        ? [`answered since ${savedId}: ${answeredSince.join(', ')} (work question show <id>)`]
        : []),
      ...(stale.length
        ? stale.map(
            (r) =>
              `check again: work recheck ${caller.token} ${r.id} --reason="${changedOutside.map((c) => c.name).join(', ')} changed"`,
          )
        : ['check again: nothing']),
      ...lines,
    ]
  })

export const commands: Commands = {
  brief,
  report,
  review,
  resolve,
  recheck,
  escalate,
  ask,
  answer,
  note,
  evaluate,
  checkpoint,
  resume,
  source,
}
