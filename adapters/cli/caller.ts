// Who calls: an agent by its token, or the person at a terminal or on the page. The prototype
// trusts the terminal and the git user.name (DESIGN section 4 states the limit). The adapter checks
// the secret of a token and the person's terminal and typed word; the state of the assignment
// (open, claim, tree) is canAct's. A person command from the terminal of a real agent
// (ARISTOTELES_SESSION set) is refused.
import { Effect } from 'effect'
import { assignmentAt, roleAt, tierOf } from '../../core/derived/reads.ts'
import {
  type Author,
  type AssignmentId,
  lookupAssignment,
  refuse,
  type Refused,
  type Work,
} from '../../core/schema/index.ts'
import { Env, GitUser, sha, Terminal } from '../../core/services/index.ts'
import { isToken } from './args.ts'

export type Caller =
  | { readonly _tag: 'Agent'; readonly assignment: AssignmentId; readonly token: string }
  | { readonly _tag: 'Person'; readonly name: string; readonly channel: 'terminal' | 'ui' }

// What the person types to confirm an act at a terminal, and what it shows first.
export interface Confirm {
  readonly word: string
  readonly show?: string
}

// The tier of an assignment's role; undefined: a program's role.
export const tierOfAssignment = (work: Work, a: AssignmentId): string | undefined =>
  tierOf(roleAt(work, assignmentAt(work, a).role))

// An agent: its token names an assignment, and the secret part must match the stored hash.
export const verify = (
  work: Work,
  token: string | null,
): Effect.Effect<{ readonly assignment: AssignmentId; readonly token: string }, Refused> =>
  Effect.gen(function* () {
    if (token === null) {
      return yield* refuse(
        'this command needs your assignment token (a7.<secret>), from the command that your parent gave you',
        'do not guess a token; when you have none, STOP and say so in your last words',
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
    return { assignment: assignment.id, token }
  })

export const agentCallerOf = (
  work: Work,
  token: string | null,
): Effect.Effect<Extract<Caller, { readonly _tag: 'Agent' }>, Refused> =>
  Effect.map(verify(work, token), (v) => ({ _tag: 'Agent' as const, ...v }))

// Whether the caller is the person: at a terminal or on the UI, and not a real agent.
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
// people (and a typed confirmation when asked). The person's own --by is ignored (N6).
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

export const personAuthor = (
  work: Work | undefined,
  confirm?: Confirm,
): Effect.Effect<Author, Refused, Terminal | GitUser | Env> =>
  Effect.gen(function* () {
    const name = yield* personOf(work, confirm)
    return { _tag: 'Person', name, channel: yield* personChannel }
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

// The author that the store keeps for an act of this caller.
export const authorOf = (caller: Caller): Author =>
  caller._tag === 'Agent'
    ? { _tag: 'Agent', assignment: caller.assignment }
    : { _tag: 'Person', name: caller.name, channel: caller.channel }

export { isToken }

// A command that needs a token reads its first word as the token, so a bare id gets the words
// "is an id" (the old CLI read the first word there).
export const tokenOfCall = (call: {
  readonly token: string | null
  readonly args: { readonly positional: ReadonlyArray<string> }
}): string | null => {
  if (call.token !== null) return call.token
  const first = call.args.positional[0]
  return first !== undefined && /^a\d+$/.test(first) ? first : null
}
