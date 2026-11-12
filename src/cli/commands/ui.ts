// The commands of the UI: run, problem, event, send, session. A typed event cannot hold a raw value
// that is wrong (a run kind, a session id, empty words), so each command refuses it first, after
// the lookups.
import { Effect } from 'effect'
import { refuse } from '../../domain/errors.ts'
import { create, move } from '../../domain/events.ts'
import {
  type AssignmentId,
  isNonBlank,
  ProblemId,
  type RunId,
  SessionId,
} from '../../domain/ids.ts'
import type { Assignment } from '../../domain/model.ts'
import type { Work } from '../../domain/work.ts'
import { problemTaskOf, topOfRun } from '../../domain/derived.ts'
import { lookup, lookupAssignment } from '../../domain/lookup.ts'
import type { RunState } from '../../domain/ui-model.ts'
import { runState } from '../../replay/runs.ts'
import { sha } from '../../config/config.ts'
import { Tokens } from '../../services/io.ts'
import { textOf } from '../args.ts'
import { agentCallerOf, callerOf, needOpen, tierOf } from '../caller.ts'
import type { Command, Commands } from '../command.ts'
import { lookupKind } from '../lookups.ts'
import { actOf, personAuthor, readWork, writeAct } from '../run.ts'

// The words that run list prints for the state of a run (the old runState words).
const RUN_WORD = {
  Talking: 'talks',
  Working: 'works',
  AwaitingEndAccept: 'ends',
  Done: 'done',
  Closed: 'closed',
} as const satisfies Record<RunState['_tag'], string>

const SESSION_WORDS = /^[A-Za-z0-9._-]+$/

// The sessions of the UI (Nanda, 2026-11-11): a run is a session with no assignment yet, a host
// that talks with the person; the UI records them as the person.
const run: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const sub = args.positional[0]
    if (sub === 'list') {
      const { work, at } = yield* readWork
      if (!work.runs.size) {
        return ['no run yet; the UI starts one with New project, or work run start --session=<id>']
      }
      return [...work.runs.values()].map((r) => {
        const topId = topOfRun(work, r.id)
        const top = topId === undefined ? undefined : work.tasks.get(topId)
        return (
          `${r.id} host · ${RUN_WORD[runState(work, r, at)._tag]} · session ${r.session} · ${r.startedAt}` +
          (top ? ` · ${top.id} ${top.name}` : '')
        )
      })
    }
    if (sub === 'start') {
      const session = args.one('session')
      const done = yield* writeAct(call, (work) =>
        Effect.gen(function* () {
          const by = yield* personAuthor(work)
          if (typeof session !== 'string' || !SESSION_WORDS.test(session)) {
            return yield* refuse('a run needs its session id (letters, digits, dot, dash)')
          }
          const started = { _tag: 'HostStarted' as const, session: SessionId.make(session) }
          return { ...by, event: create('Run', started) }
        }),
      )
      return [`${done.created[0]} started: a host session (${String(session)}).`]
    }
    // The end of a project: its top task is accepted (the Sol of the top task decided it), and the
    // person accepts the end last (Nanda, 2026-11-11: "using sol reviewer and then me").
    if (sub === 'done' || sub === 'close') {
      const id = args.positional[1]
      if (!id) return yield* refuse(`work run ${sub} <run>`)
      yield* writeAct(call, (work) =>
        Effect.gen(function* () {
          const by = yield* personAuthor(work)
          const { run: found } = yield* lookupKind('Run', ['h'], work, id)
          const ended = sub === 'done' ? ('Done' as const) : ('Closed' as const)
          return { ...by, event: move('Run', found.id, { _tag: ended }) }
        }),
      )
      return [sub === 'done' ? `${id} is done.` : `${id} closed.`]
    }
    return yield* refuse('use work run start|done|close|list')
  })

// A system problem: the host records it (or the UI, when the host itself fails); a fix ends it.
const problem: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const rest = call.token === null ? args.positional : args.positional.slice(1)
    const target = rest[0]
    const fix = args.one('fixed') !== undefined
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* callerOf(work, call.token)
        if (caller._tag === 'Agent' && tierOf(work, caller.assignment) !== 'high') {
          return yield* refuse(
            'the host (a Sol) records a system problem; escalate it to your parent',
            `work escalate ${caller.token} --reason="..."`,
          )
        }
        if (fix) {
          if (!/^sp\d+$/.test(String(target ?? ''))) {
            return yield* refuse('work problem [<token>] <sp..> --fixed')
          }
          const problem = ProblemId.make(String(target))
          return actOf(caller, move('Problem', problem, { _tag: 'Fixed' }))
        }
        if (!/^t\d+$/.test(String(target ?? ''))) {
          return yield* refuse(
            'work problem [<token>] <the task that it stops> --says="<what happened, and how to fix it>"',
          )
        }
        const stopped = yield* lookupKind('Task', ['t'], work, String(target))
        const says = textOf(args.one('says'))
        if (!isNonBlank(says)) {
          return yield* refuse('a system problem needs its words: what happened, and how to fix it')
        }
        const recorded = { _tag: 'Recorded' as const, stopped: stopped.task.id, says }
        return actOf(caller, create('Problem', recorded))
      }),
    )
    if (fix) return [`${String(target)} is fixed.`]
    const sp = done.created[0] ?? ''
    const found = yield* lookupKind('Problem', ['sp'], done.work, sp)
    const shows = problemTaskOf(done.work, found.problem)
    const on = done.work.tasks.get(shows)
    return [`${sp} recorded on ${shows} ${on?.name ?? ''}; it shows to the person until a fix.`]
  })

const TERMINAL_KINDS = ['ended', 'error', 'silent', 'prompt', 'stopped', 'resumed', 'closed'] as const
const TERMINAL_MOVE = {
  prompt: 'Prompted',
  stopped: 'Stopped',
  resumed: 'Resumed',
  closed: 'Closed',
} as const

// The terminal of a run (its host too) or of an agent: its session.
const sessionOf = (work: Work, id: RunId | AssignmentId): SessionId | undefined =>
  id.startsWith('h')
    ? work.runs.get(id as RunId)?.session
    : work.sessions.get(id as AssignmentId)?.session

// A terminal event that the UI records, as a move of the terminal of its session. Only the
// supervisor writes a failure, a prompt and a close; the person's Stop and Resume are the
// person's.
const event: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const on = args.positional[0]
    const kind = args.one('kind')
    yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const { author } = yield* personAuthor(work)
        const found = yield* lookup(work, String(on), ['a', 'h'])
        const target = found._tag === 'Run' ? found.run.id : found._tag === 'Assignment' ? found.assignment.id : undefined
        const known = TERMINAL_KINDS.find((k) => k === kind)
        if (target === undefined) return yield* Effect.die(`lookup of ${String(on)} gave a ${found._tag}`)
        if (known === undefined) return yield* refuse(`"${String(kind)}" is not a terminal event`)
        // New in this code: a terminal event is a move of a terminal, by its session.
        const session = sessionOf(work, target)
        if (session === undefined) return yield* refuse(`${target} has no terminal`)
        const text = textOf(args.one('text')) ?? ''
        const tries = Number(args.one('tries') ?? 0)
        const failed = known === 'ended' || known === 'error' || known === 'silent'
        // A failure is after three tries; no other event has a try or (but a prompt) words.
        if (tries !== (failed ? 3 : 0) && args.one('tries') !== undefined) {
          return yield* refuse(`a ${known} event has ${failed ? '3 tries' : 'no tries'}`)
        }
        if (text && !failed && known !== 'prompt') {
          return yield* refuse(`a ${known} event has no --text`)
        }
        const moved =
          known === 'ended' || known === 'error' || known === 'silent'
            ? { _tag: 'Failed' as const, why: known, lastLines: text }
            : known === 'prompt'
              ? { _tag: 'Prompted' as const, line: text }
              : { _tag: TERMINAL_MOVE[known] }
        const person = author._tag === 'Person' ? author.name : ''
        const by =
          known === 'stopped' || known === 'resumed'
            ? author
            : { _tag: 'Supervisor' as const, name: person }
        return { author: by, event: move('Terminal', session, moved) }
      }),
    )
    return [`${String(on)}: ${String(kind)} recorded.`]
  })

// Why an assignment has no terminal, by its own tier: only a Luna runs inside its parent's.
const noTerminalWords = (work: Work, to: Assignment): string => {
  const tier = tierOf(work, to)
  if (tier === 'low') {
    return `${to.id} has no terminal (a Luna runs inside the terminal of its parent)`
  }
  if (tier === undefined) return `${to.id} has no terminal (a program runs no terminal)`
  const name = tier === 'high' ? 'Sol' : 'Terra'
  return `${to.id} has no terminal yet (a ${name} gets one when the UI starts its session)`
}

// The host sends an input to the terminal of a child; the UI types it there.
const send: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const [token, a] = args.positional
    yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* agentCallerOf(work, token ?? null)
        yield* needOpen(work, caller.assignment)
        const to = yield* lookupAssignment(work, String(a))
        // The old handler's words: a send goes to a terminal that exists.
        const session = sessionOf(work, to.id)
        if (session === undefined) {
          return yield* refuse(noTerminalWords(work, to))
        }
        // A line then Enter; a text with no words is Enter alone (the default answer of a prompt).
        const text = textOf(args.one('text')) ?? ''
        const sent = {
          _tag: 'Sent' as const,
          // The author (the host) is the sender.
          from: {
            _tag: 'Agent' as const,
            to: { _tag: 'Terminal' as const, session, via: { _tag: 'Tmux' as const } },
          },
          keys: isNonBlank(text) ? { _tag: 'Line' as const, text } : { _tag: 'Enter' as const },
        }
        return actOf(caller, create('Send', sent))
      }),
    )
    return [`sent to ${String(a)}; the UI types it into its terminal.`]
  })

// The UI starts the terminal of a real agent: it records the session, and with --token it gives
// the agent a new token (the one of the assign went only to the assigner), so that the UI can
// type the brief command into the new terminal. Only the supervisor starts one.
const session: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const a = args.positional[0]
    if (!/^a\d+$/.test(String(a ?? ''))) {
      return yield* refuse('work session <assignment> --id=<session id> [--token]')
    }
    const secret = args.one('token') ? yield* (yield* Tokens).random : undefined
    const id = textOf(args.one('id'))
    yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const { author } = yield* personAuthor(work)
        const assignment = yield* lookupAssignment(work, String(a))
        if (!SESSION_WORDS.test(String(id ?? ''))) {
          return yield* refuse('a session id is letters, digits, dot, dash')
        }
        const started = {
          _tag: 'Started' as const,
          for: assignment.id,
          secret: secret ? sha(secret) : null,
        }
        const name = author._tag === 'Person' ? author.name : ''
        const event = move('Terminal', SessionId.make(String(id)), started)
        return { author: { _tag: 'Supervisor' as const, name }, event }
      }),
    )
    return [`${String(a)} runs in the session ${String(id)}.`, ...(secret ? [`work brief ${String(a)}.${secret}`] : [])]
  })

export const commands: Commands = { run, problem, event, send, session }
