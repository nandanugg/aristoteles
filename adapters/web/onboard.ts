// The acts of the onboarding pages (POST /api/onboarding, BUILD.md 1c and 1g): each one writes the
// files through src/files/onboarding.ts and stores nothing (ruling 1), but approve all roles, which
// starts the store with the accepted result only. The words are the page's own short lines.
import { Effect } from 'effect'
import { dispatch } from '../../core/actions/index.ts'
import { type DirectionId, type OnboardingAct, refuse } from '../../core/schema/index.ts'
import {
  CONFIG,
  GitUser,
  type OnboardingFiles,
  prepareStart,
  readConfig,
} from '../../core/services/index.ts'
import { configProblems } from '../live/config-problems.ts'
import { answersWords } from '../words/index.ts'

type PersonAct = Exclude<OnboardingAct, { readonly act: 'approve-all-roles' }>

// The words of the answer, after the act wrote the files (the directions that it made, accepted,
// and the files as the act left them).
export const onboardingWords = (
  act: PersonAct,
  made: ReadonlyArray<DirectionId>,
  files: OnboardingFiles,
): string => {
  switch (act.act) {
    case 'add-direction':
      return `${made.join(', ')}: a new direction; it shows Loading until the host drafts it.`
    case 'add-company-direction':
      return `${made.join(', ')}: a company direction; it shows Loading until the host drafts it.`
    case 'answer': {
      const answered = files.directions.find((f) => f.id === act.direction)
      const words = answered === undefined ? `the answers of ${act.direction} are in` : answersWords(answered)
      return `${words}; the host drafts it again.`
    }
    case 'accept':
      return `${act.direction} is accepted.`
    case 'revise':
      return `${act.direction}: the host drafts it again from your words.`
    case 'remove':
      return `${act.direction} is removed; nothing keeps it.`
    case 'approve-all-directions':
      return `accepted: ${made.join(', ')}.`
    case 'accept-role':
      return `${act.role} is accepted.`
    case 'revise-role':
      return `${act.role}: the host writes it again from your words.`
    case 'remove-role':
      return `${act.role} is removed; nothing keeps it.`
    case 'persistence':
      return act.persistent
        ? `${act.role} is persistent: it gets a terminal of its own.`
        : `${act.role} is disposable: it runs as a subagent of a terminal.`
  }
}

// The store start. The page asked for the confirmation before this call, so the lock is held only
// while the start runs. prepareStart writes aristoteles.yaml from the draft; the checks of work
// config check run on it, and the person stores the start; a refusal writes the files back.
export const startStore = (
  dir: string,
  person: string,
  env: Readonly<Record<string, string | undefined>>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const start = yield* prepareStart(dir, person, env)
      const done = yield* Effect.gen(function* () {
        const problems = yield* configProblems((yield* readConfig(dir)).config)
        if (problems.length) {
          return yield* refuse(
            `${CONFIG}: ${problems.join('; ')}`,
            'the host writes the role again (work onboard role), and you accept it',
          )
        }
        return yield* dispatch({
          by: { _tag: 'Person', name: person, channel: 'ui' },
          input: { _tag: 'DefineWorkflow', target: {}, content: { directions: start.directions } },
        })
      }).pipe(Effect.onError(() => Effect.ignore(start.restore)))
      yield* start.finish
      const { project, roles } = done.work.config
      return (
        `store made for ${project} in aristoteles: ${Object.keys(roles).length} roles and ` +
        `${start.directions.length} directions; the onboarding files are gone.`
      )
    }),
  ).pipe(Effect.provideService(GitUser, { name: Effect.succeed(person) }))
