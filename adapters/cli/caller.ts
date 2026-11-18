// Who calls: an agent by its work token, or the person at a terminal or on the page. The prototype
// trusts the terminal and the git user.name (DESIGN section 4 states the limit). The adapter checks
// the secret of a token and the person's terminal and typed word. A person command from the
// terminal of a real agent (ARISTOTELES_SESSION set) is refused.
import { Effect } from 'effect'
import { type Author, refuse, type Refused, type Work } from '../../core/schema/index.ts'
import { Env, GitUser, sha, Terminal } from '../../core/services/index.ts'
import type { WorkFolded } from '../../core/state/work/fold.ts'
import type { Actor } from '../../core/state/work/types.ts'

// What the person types to confirm an act at a terminal, and what it shows first.
export interface Confirm {
  readonly word: string
  readonly show?: string
}

export { workTokenOf } from '../words/work.ts'

// The actor and the epoch a work token names, when the secret matches the hash that the store
// kept for that actor at that epoch. An old epoch's token verifies as that epoch, so that the
// store's check refuses it as old (not as a wrong token).
export const verifyWork = (
  folded: WorkFolded,
  token: string | null,
): Effect.Effect<{ readonly who: Actor; readonly ep: number }, Refused> =>
  Effect.gen(function* () {
    if (token === null) {
      return yield* refuse(
        'this command needs your token (w.<actor>.<epoch>.<secret>), from the command that ' +
          'your parent gave you',
        'do not guess a token; when you have none, STOP and say so in your last words',
      )
    }
    const m = /^w\.(.+)\.(\d+)\.([a-z0-9]+)$/.exec(token)
    if (!m) return yield* refuse(`"${token}" is not a work token (w.<actor>.<epoch>.<secret>)`)
    const [, who = '', epoch = '', secret = ''] = m
    const ep = Number(epoch)
    const hash = folded.tokens.get(who)?.find((t) => t.ep === ep)?.hash
    if (hash !== sha(secret)) return yield* refuse(`the token of ${who} is wrong`)
    return { who, ep }
  })

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
        'ask the person to type it at their terminal; an agent command takes its token first: ' +
          'work <command> <token> ...',
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

