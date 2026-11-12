// Who calls: an agent by its token, or the person at a terminal or on the page. The prototype
// trusts the terminal and the git user.name (DESIGN section 4 states the limit). The page is the
// person's other channel: its server calls main() with io.channel = 'ui'. A real agent runs in a
// terminal under the person's git user, so the UI starts it with ARISTOTELES_SESSION set, and a
// person command from that terminal is refused.
import { Effect } from 'effect'
import type { Author } from '../domain/actor.ts'
import { refuse, type Refused } from '../domain/errors.ts'
import { lookupAssignment } from '../domain/lookup.ts'
import type { Assignment, Tier } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import { sha } from '../config/config.ts'
import { Env, GitUser, Terminal } from '../services/io.ts'

export type Caller =
  | { readonly _tag: 'Agent'; readonly assignment: Assignment; readonly token: string }
  | { readonly _tag: 'Person'; readonly name: string; readonly channel: 'terminal' | 'ui' }

// What the person types to confirm an act at a terminal, and what it shows first.
export interface Confirm {
  readonly word: string
  readonly show?: string
}

// The tier of an assignment's role; undefined: a program's role, or no such role.
export const tierOf = (work: Work, a: Assignment): Tier | undefined => {
  const role = work.workflow.roles.get(a.role)
  return role?._tag === 'Model' ? role.tier : undefined
}

const upTo = (a: Assignment) => (a.parent._tag === 'Parent' ? 'your parent' : 'the person')

// The token as the CLI reads it after the command: a7.<secret>.
export const isToken = (word: string | undefined): word is string => /^a\d+\./.test(word ?? '')

// An agent: its token names an assignment, and the secret part must match the stored hash.
const verify = (
  work: Work,
  token: string | null,
): Effect.Effect<{ readonly assignment: Assignment; readonly token: string }, Refused> =>
  Effect.gen(function* () {
    if (token === null) {
      return yield* refuse(
        'this command needs the assignment token that assign printed (a7.<secret>); the person reads work waiting',
      )
    }
    const m = /^(a\d+)(?:\.([a-z0-9]+))?$/.exec(token)
    if (!m) return yield* refuse(`"${token}" is not an assignment token (a7.<secret>)`)
    const [, id = '', secret] = m
    if (!secret) {
      return yield* refuse(
        `${id} is an id; the command needs the token that assign printed (${id}.<secret>)`,
      )
    }
    const assignment = yield* lookupAssignment(work, id)
    if (work.meta.get(assignment.id)?.secret !== sha(secret)) {
      return yield* refuse(`the token of ${id} is wrong`)
    }
    return { assignment, token }
  })

export const agentOf = (work: Work, token: string | null): Effect.Effect<Assignment, Refused> =>
  Effect.map(verify(work, token), (v) => v.assignment)

// An agent that must hold a token (next, send): the token comes back as the string it is.
export const agentCallerOf = (
  work: Work,
  token: string | null,
): Effect.Effect<Extract<Caller, { readonly _tag: 'Agent' }>, Refused> =>
  Effect.map(verify(work, token), (v) => ({ _tag: 'Agent' as const, ...v }))

// Whether the caller is the person: at a terminal or on the UI, and not a real agent (whose
// terminal has ARISTOTELES_SESSION set, see personOf).
export const isPerson: Effect.Effect<boolean, never, Terminal | Env> = Effect.gen(function* () {
  const terminal = yield* Terminal
  const env = yield* Env
  return !env.vars.ARISTOTELES_SESSION && (terminal.isTTY || terminal.onPage)
})

// The channel of a person act: the terminal, or the UI.
export const personChannel: Effect.Effect<'terminal' | 'ui', never, Terminal> = Effect.map(
  Terminal,
  (terminal) => (terminal.onPage ? ('ui' as const) : ('terminal' as const)),
)

// The person: no ARISTOTELES_SESSION, a TTY or the page, no GIT_CONFIG variable, a git user in
// people (and a typed confirmation when asked).
export const personOf = (
  work: Work | undefined,
  confirm?: Confirm,
): Effect.Effect<string, Refused, Terminal | GitUser | Env> =>
  Effect.gen(function* () {
    const terminal = yield* Terminal
    const env = yield* Env
    const session = env.vars.ARISTOTELES_SESSION
    if (session) {
      return yield* refuse(
        `a real agent runs in this terminal (session ${session}); a person command comes from the person`,
        'an agent passes its token first: work <command> <token> ...',
      )
    }
    if (!terminal.isTTY && !terminal.onPage) {
      return yield* refuse(
        'this is a person command; a person runs it at a terminal',
        'an agent passes its token first: work <command> <token> ...',
      )
    }
    if (Object.keys(env.vars).some((k) => k.startsWith('GIT_CONFIG'))) {
      return yield* refuse(
        'GIT_CONFIG variables are set; a person command reads user.name from the git config files only',
      )
    }
    const name = yield* (yield* GitUser).name
    if (work && !work.config.people.includes(name)) {
      return yield* refuse(`${name} (git user.name) is not in the people of aristoteles.yaml`)
    }
    if (confirm) {
      if (confirm.show) yield* terminal.out(confirm.show)
      const typed = yield* terminal.readLine(`Type "${confirm.word}" to confirm: `)
      if (typed?.trim() !== confirm.word) return yield* refuse('not confirmed; nothing was stored')
    }
    return name
  })

// An agent when a token is given, else the person.
export const callerOf = (
  work: Work,
  token: string | null,
  confirm?: Confirm,
): Effect.Effect<Caller, Refused, Terminal | GitUser | Env> =>
  Effect.gen(function* () {
    if (token !== null) return yield* agentCallerOf(work, token)
    const name = yield* personOf(work, confirm)
    return { _tag: 'Person' as const, name, channel: yield* personChannel }
  })

// The author that the store keeps for an act of this caller (old caller().who/channel).
export const authorOf = (caller: Caller): Author =>
  caller._tag === 'Agent'
    ? { _tag: 'Agent', assignment: caller.assignment.id }
    : { _tag: 'Person', name: caller.name, channel: caller.channel }

// needOpen: the assignment is not finished.
export const needOpen = (_work: Work, a: Assignment): Effect.Effect<void, Refused> =>
  a.end._tag !== 'NotEnded'
    ? refuse(`${a.id} is finished`, `do no more work for it; tell ${upTo(a)}`)
    : Effect.void

// needClaim: a low agent with no claim either has not read its brief yet, or its one unit is
// done. A maker that was accepted used no attempt, so only a result or a review shows the unit.
export const needClaim = (
  work: Work,
  a: Assignment,
  token: string,
): Effect.Effect<void, Refused> => {
  const claim = work.meta.get(a.id)?.claim
  if (claim !== undefined && claim._tag !== 'Free') return Effect.void
  const done =
    [...work.results.values()].some((r) => r.by === a.id) ||
    [...work.reviews.values()].some((r) => r.by === a.id)
  if (tierOf(work, a) === 'low' && done) {
    return refuse(
      'your unit is done; this assignment has no open brief',
      `STOP: ${upTo(a)} continues. Run work brief ${token} only if ${upTo(a)} gives you this token again`,
    )
  }
  return refuse(
    'you have no brief in this attempt',
    `work brief ${token}; it takes the snapshot that your work follows`,
  )
}
