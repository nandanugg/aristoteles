// The engine's tick (terminals.qnt, G1): what the harness owes, done from the store alone. A
// persistent actor that is up but has no live pane `<actor>.<epoch>` is recorded as exited (the
// evidence: a revive recorded but never launched, or a pane that died); each revive the store
// owes the harness is recorded first (its token), then the pane is started with the first prompt
// as an argument of the launch command; the pump's status is the mark. A pane's silence restarts
// nothing. The host's pane is the person's: never revived here. The tick's words: what it did
// and what it could not.
import { Effect } from 'effect'
import { folding } from '../actions/dispatch.ts'
import { dispatchAct, type NewToken } from '../actions/work.ts'
import { dos } from '../derived/work/obligations.ts'
import { type Author, SessionId } from '../schema/index.ts'
import { Dir, Pump, readSettings, sha, Store } from '../services/index.ts'
import { fold } from '../state/index.ts'
import { foldWork } from '../state/work/fold.ts'
import { epOf } from '../state/work/reads.ts'
import type { Actor, What, WorkState } from '../state/work/types.ts'
import { HARNESS, PIPE, roleActor } from '../state/work/types.ts'
import { fill, quote } from './lines.ts'
import { ruleHolds } from './rules.ts'

const ENGINE: Author = { _tag: 'System' }

// What the adapter writes for a pane: the prompt (who the agent is, its role's words, its token
// and its wait), an argument of the launch command; and the settings text of its stop-at-prompt
// hook (--settings, beside the prompt), which records the actor's exit.
export interface Words {
  readonly prompt: (actor: Actor, words: string, token: NewToken) => string
  readonly hook: (actor: Actor, token: NewToken) => string
}

// The tmux session of an actor's pane at an epoch (tmux-safe: no ':' and no '.').
export const sessionOf = (actor: Actor, ep: number): SessionId =>
  SessionId.make(`${actor.replaceAll(':', '-')}-e${ep}`)

const persistent = (s: WorkState): ReadonlyArray<Actor> => [
  PIPE,
  ...[...s.cards.keys()].map(roleActor),
]

export const engineTick = (say: Words) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const pump = yield* Pump
    const lines: Array<string> = []
    const read = Effect.gen(function* () {
      const store = yield* (yield* Store).open(cwd, { create: false })
      const events = yield* store.events
      return { events, folded: yield* folding(() => foldWork(events)) }
    }).pipe(Effect.scoped)
    // An act of the harness; its refusal is a line, not a failure of the tick.
    const act = (s: WorkState, what: What) =>
      dispatchAct({
        by: ENGINE,
        act: { id: sha(JSON.stringify(['engine', s.seq, what])), who: HARNESS, ep: 0, what },
        on: null,
        build: null,
        current: 'engine',
      }).pipe(
        Effect.scoped,
        Effect.catch((e) =>
          Effect.as(Effect.sync(() => lines.push(`${what._tag}: ${e.message}`)), null)
        ),
      )
    const alive = (sid: SessionId) =>
      Effect.map(pump.status, (status) => status[sid]?._tag === 'Live')

    const first = yield* read
    if (first.folded === null) return lines
    let { state } = first.folded
    if (state.top.ended) {
      for (const k of persistent(state)) {
        const sid = sessionOf(k, epOf(state, k))
        if (yield* alive(sid)) yield* Effect.ignore(pump.stop(sid))
      }
      return lines
    }
    // The evidence: an actor that is up and has no live pane exited.
    let exited = false
    for (const k of persistent(state)) {
      if (state.down.has(k)) continue
      const sid = sessionOf(k, epOf(state, k))
      if (yield* alive(sid)) continue
      if ((yield* act(state, { _tag: 'Exit', who: k })) !== null) {
        yield* pump.forget(sid)
        lines.push(`${k}: no live pane ${sid}; its exit is recorded`)
        exited = true
      }
    }
    const now = exited ? yield* read : first
    if (now.folded === null) return lines
    state = now.folded.state

    const launchOf = (k: Actor) =>
      Effect.gen(function* () {
        const card = state.cards.get(k.slice('role:'.length))
        const pipe = card === undefined
          ? Object.values(fold(now.events).config.roles).find(
            (f) => f.kind === 'agent' && f.pipeline === true,
          )
          : undefined
        const role = card ??
          (pipe?.kind === 'agent' ? { words: pipe.intro, model: pipe.model } : null)
        const settings = yield* readSettings(cwd)
        const template = role === null ? undefined : settings.models[role.model]?.launch
        return role === null || template === undefined || template === ''
          ? null
          : { words: role.words, model: role.model, template }
      })
    for (const step of dos(state, HARNESS)) {
      const target = step.target ?? ''
      if (step.tag === 'RunRule') {
        const holds = yield* Effect.result(ruleHolds(state, now.events, target))
        if (holds._tag === 'Failure') {
          lines.push(`RunRule ${target}: ${holds.failure.message}`)
          continue
        }
        yield* act(state, { _tag: 'RunRule', task: target, holds: holds.success })
      } else if (step.tag === 'Revive') {
        const how = yield* Effect.result(launchOf(target))
        if (how._tag === 'Failure' || how.success === null) {
          lines.push(`${target}: no launch command for its model; it stays down`)
          continue
        }
        const acted = yield* act(state, { _tag: 'Revive', who: target })
        // A copy of a recorded revive has no token: its first run launches.
        if (acted?.token == null) continue
        const { words, model, template } = how.success
        const sid = sessionOf(target, acted.token.ep)
        // The prompt goes last (fill appends it when the template has no {prompt}).
        const command = fill(`${template} --settings ${quote(say.hook(target, acted.token))}`, {
          session: sid,
          model,
          prompt: say.prompt(target, words, acted.token),
        })
        const started = yield* Effect.result(
          pump.start(sid, { command, env: {}, cols: 160, rows: 48 }),
        )
        lines.push(
          started._tag === 'Success'
            ? `${target}: revived in ${sid}`
            : `${target}: its pane did not start: ${started.failure.message}`,
        )
      }
    }
    return lines
  })
