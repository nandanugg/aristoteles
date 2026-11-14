// The commands of the UI: run, problem, event, send, session.
import { Effect } from 'effect'
import { hostOf } from '../../../core/derived/index.ts'
import {
  assignmentAt,
  openedTopOf,
  problemTask,
  roleAt,
  tierOf,
} from '../../../core/derived/reads.ts'
import {
  type AssignmentId,
  type Author,
  isNonBlank,
  lookup,
  lookupAssignment,
  type ProblemId,
  refuse,
  type RunId,
  type RunState,
  SessionId,
  type Work,
} from '../../../core/schema/index.ts'
import { Env, Now, Tokens } from '../../../core/services/index.ts'
import { textOf } from '../args.ts'
import { agentCallerOf, authorOf, callerOf, personAuthor, tierOfAssignment } from '../caller.ts'
import type { Command, Commands } from '../command.ts'
import { lookupKind } from '../lookups.ts'
import { act, peekWork, readWork } from '../runtime.ts'

// The words that run list prints for the state of a run.
const RUN_WORD = {
  Talking: 'talks',
  Working: 'works',
  AwaitingEndAccept: 'ends',
  Done: 'done',
  Closed: 'closed',
} as const satisfies Record<RunState['_tag'], string>

const SESSION_WORDS = /^[A-Za-z0-9._-]+$/

// The pane of the host (Nanda, 2026-11-13): the AI CLI that the person triggers runs in tmux, so
// its shell knows the socket (the first part of $TMUX) and the pane ($TMUX_PANE).
const hostPane = Effect.gen(function* () {
  const { vars } = yield* Env
  if (vars.ARISTOTELES_SESSION) {
    return yield* refuse(
      `a real agent of the UI runs in this terminal (session ${vars.ARISTOTELES_SESSION})`,
      'only the host that the person triggered starts or continues a run',
    )
  }
  const socket = (vars.TMUX ?? '').split(',')[0] ?? ''
  const pane = vars.TMUX_PANE ?? ''
  if (!socket || !/^%\d+$/.test(pane)) {
    return yield* refuse(
      'the host runs inside tmux, so that the page shows its terminal',
      'ask the person to start this AI CLI in a tmux pane, then trigger it again',
    )
  }
  return { socket, pane }
})

const run: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const sub = args.positional[0]
    if (sub === 'list') {
      const { work, d } = yield* readWork
      if (!work.runs.size) {
        return ['no run yet; the host starts one in its own pane: work run start']
      }
      return [...work.runs.values()].map((r) => {
        const topId = openedTopOf(work, r.id)
        const top = topId === undefined ? undefined : work.tasks.get(topId)
        const where = r.terminal._tag === 'Pane' ? `pane ${r.terminal.pane}` : `session ${r.session}`
        const state = d.states.runs.get(r.id)
        return (
          `${r.id} host · ${state ? RUN_WORD[state._tag] : ''} · ${where} · ${r.startedAt}` +
          (top ? ` · ${top.id} ${top.name}` : '')
        )
      })
    }
    if (sub === 'start') {
      const { socket, pane } = yield* hostPane
      const session = SessionId.make(`host-${yield* (yield* Tokens).random}`)
      const at = yield* (yield* Now).read
      const done = yield* act(
        { _tag: 'ModelRun', name: 'host', at },
        { _tag: 'JoinRun', target: {}, content: { pane: { session, socket, pane } } },
      )
      const h = String(done.created[0])
      return [
        `${h} started: you are its host, in this terminal (pane ${pane}); the page shows it.`,
        `next: ask the person what they want, then draft the top task: work task draft --file=<file> --by=${h}`,
      ]
    }
    // Continue (Nanda, 2026-11-13): the host moves a run here with the person's words. A run whose
    // top task is open has its Sol in the host's terminal, so this terminal takes that assignment
    // too, with a new token; the old one stops working.
    if (sub === 'continue') {
      const id = args.positional[1]
      const words = textOf(args.one('quote'))
      if (!id || !words) {
        return yield* refuse('work run continue <run> --quote="<the words of the person>"')
      }
      const { socket, pane } = yield* hostPane
      const session = SessionId.make(`host-${yield* (yield* Tokens).random}`)
      const secret = yield* (yield* Tokens).random
      const at = yield* (yield* Now).read
      const by: Author = { _tag: 'ModelRun', name: 'host', at }
      const { work, d } = yield* peekWork
      const { run: found } = yield* lookupKind('Run', ['h'], work, id)
      // The Sol of the top task now (after its remakes), and never an Ended one (C1).
      const state = d.states.runs.get(found.id)
      const top =
        state?._tag === 'Working' || state?._tag === 'AwaitingEndAccept' ? state.top : undefined
      const host =
        top === undefined
          ? undefined
          : hostOf(d.moment, { _tag: 'OnTask', task: top }, d.states)
      const sol = host?._tag === 'Host' ? host.assignment : undefined
      yield* act(by, {
        _tag: 'ContinueRun',
        target: { run: found.id },
        content: { pane: { session, socket, pane }, quote: words },
      })
      const h = String(id)
      const here =
        `${h} continues: you are its host, in this terminal (pane ${pane}); the page shows it.`
      if (top !== undefined && sol === undefined) {
        // 10.1: a top task with no Sol yet; the host's work wait gives it the token of its Sol.
        return [here, `its top task ${String(top)} has no Sol yet: run work wait --by=${h}`]
      }
      if (sol === undefined) {
        return [
          here,
          `its top task is not open yet: talk with the person, then draft it: work task draft --file=<file> --by=${h}`,
        ]
      }
      yield* act(by, {
        _tag: 'StartSession',
        target: { assignment: sol },
        content: { session, secret },
      })
      return [
        here,
        `you are the Sol of its top task ${String(top)} (${sol}); the old token stops working. Your command: work brief ${sol}.${secret}`,
      ]
    }
    // The end of a project: its top task is accepted, and the person accepts the end last.
    if (sub === 'done' || sub === 'close') {
      const id = args.positional[1]
      if (!id) return yield* refuse(`work run ${sub} <run>`)
      const by = yield* personAuthor(undefined)
      const { work } = yield* peekWork
      const { run: found } = yield* lookupKind('Run', ['h'], work, id)
      yield* act(by, {
        _tag: sub === 'done' ? 'EndRun' : 'CloseRun',
        target: { run: found.id },
        content: {},
      })
      return [sub === 'done' ? `${id} is done.` : `${id} closed.`]
    }
    return yield* refuse('use work run start|continue|done|close|list')
  })

// A system problem: the host records it; a fix ends it.
const problem: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const target = args.positional[0]
    const fix = args.one('fixed') !== undefined
    const { work } = yield* peekWork
    const by = authorOf(yield* callerOf(work, call.token))
    if (fix) {
      if (!/^sp\d+$/.test(String(target ?? ''))) {
        return yield* refuse('work problem [<token>] <sp..> --fixed')
      }
      yield* act(by, {
        _tag: 'FixProblem',
        target: { problem: String(target) as ProblemId },
        content: {},
      })
      return [`${String(target)} is fixed.`]
    }
    if (!/^t\d+$/.test(String(target ?? ''))) {
      return yield* refuse(
        'work problem [<token>] <the task that it stops> --says="<what happened, and how to fix it>"',
      )
    }
    const stopped = yield* lookupKind('Task', ['t'], work, String(target))
    const done = yield* act(by, {
      _tag: 'RecordProblem',
      target: { task: stopped.task.id },
      content: { says: textOf(args.one('says')) ?? '' },
    })
    const sp = String(done.created[0] ?? '')
    const found = yield* lookupKind('Problem', ['sp'], done.work, sp)
    const shows = problemTask(done.work, found.problem)
    const on = done.work.tasks.get(shows)
    return [`${sp} recorded on ${shows} ${on?.name ?? ''}; it shows to the person until a fix.`]
  })

const TERMINAL_KINDS = ['ended', 'error', 'silent', 'prompt', 'stopped', 'resumed', 'closed'] as const

// The terminal of a run (its host too) or of an agent: its session.
const sessionOf = (work: Work, id: RunId | AssignmentId): SessionId | undefined =>
  id.startsWith('h')
    ? work.runs.get(id as RunId)?.session
    : work.sessions.get(id as AssignmentId)?.session

// A terminal event that the UI records. Only the supervisor writes a failure, a prompt and a
// close; the person's Stop and Resume are the person's.
const event: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const on = args.positional[0]
    const kind = args.one('kind')
    const { work } = yield* peekWork
    const person = yield* personAuthor(work)
    const found = yield* lookup(work, String(on), ['a', 'h'])
    const target =
      found._tag === 'Run'
        ? found.run.id
        : found._tag === 'Assignment'
          ? found.assignment.id
          : undefined
    const known = TERMINAL_KINDS.find((k) => k === kind)
    if (target === undefined) return yield* Effect.die(`lookup of ${String(on)} gave a ${found._tag}`)
    if (known === undefined) return yield* refuse(`"${String(kind)}" is not a terminal event`)
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
    const name = person._tag === 'Person' ? person.name : ''
    const supervisor: Author = { _tag: 'Supervisor', name }
    if (known === 'stopped') {
      yield* act(person, { _tag: 'StopTerminal', target: { session }, content: {} })
    } else if (known === 'resumed') {
      const tier =
        target.startsWith('a') && tierOf(roleAt(work, assignmentAt(work, target as AssignmentId).role)) === 'high'
          ? 'sol'
          : 'terra'
      yield* act(person, { _tag: 'ResumeTerminal', target: { session }, content: { tier } })
    } else {
      const move =
        failed
          ? { _tag: 'Failed' as const, why: known, lastLines: text }
          : known === 'prompt'
            ? { _tag: 'Prompted' as const, line: text }
            : { _tag: 'Closed' as const }
      yield* act(supervisor, {
        _tag: 'ReportTerminal',
        target: { session },
        content: { move: move as never },
      })
    }
    return [`${String(on)}: ${String(kind)} recorded.`]
  })

// Why an assignment has no terminal, by its own tier: only a Luna runs inside its parent's.
const noTerminalWords = (work: Work, to: AssignmentId): string => {
  const tier = tierOfAssignment(work, to)
  if (tier === 'low') return `${to} has no terminal (a Luna runs inside the terminal of its parent)`
  if (tier === undefined) return `${to} has no terminal (a program runs no terminal)`
  const name = tier === 'high' ? 'Sol' : 'Terra'
  return `${to} has no terminal yet (a ${name} gets one when the UI starts its session)`
}

// The host sends an input to the terminal of a child; the UI types it there.
const send: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const a = args.positional[0]
    const { work } = yield* peekWork
    const caller = yield* agentCallerOf(work, call.token)
    const to = yield* lookupAssignment(work, String(a))
    const session = sessionOf(work, to.id)
    if (session === undefined) return yield* refuse(noTerminalWords(work, to.id))
    // A line then Enter; a text with no words is Enter alone (the default answer of a prompt).
    const text = textOf(args.one('text')) ?? ''
    yield* act(authorOf(caller), {
      _tag: 'Send',
      target: { session },
      content: { keys: isNonBlank(text) ? { _tag: 'Line', text } : { _tag: 'Enter' } },
    })
    return [`sent to ${String(a)}; the UI types it into its terminal.`]
  })

// The UI starts the terminal of a real agent: it records the session, and with --token it gives
// the agent a new token. Only the supervisor starts one.
const session: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const a = args.positional[0]
    if (!/^a\d+$/.test(String(a ?? ''))) {
      return yield* refuse('work session <assignment> --id=<session id> [--token]')
    }
    const secret = args.one('token') ? yield* (yield* Tokens).random : null
    const id = textOf(args.one('id'))
    const { work } = yield* peekWork
    const person = yield* personAuthor(work)
    const assignment = yield* lookupAssignment(work, String(a))
    if (!SESSION_WORDS.test(String(id ?? ''))) {
      return yield* refuse('a session id is letters, digits, dot, dash')
    }
    yield* act(
      { _tag: 'Supervisor', name: person._tag === 'Person' ? person.name : '' },
      {
        _tag: 'StartSession',
        target: { assignment: assignment.id },
        content: { session: SessionId.make(String(id)), secret },
      },
    )
    return [
      `${String(a)} runs in the session ${String(id)}.`,
      ...(secret ? [`work brief ${String(a)}.${secret}`] : []),
    ]
  })

export const commands: Commands = { run, problem, event, send, session }
