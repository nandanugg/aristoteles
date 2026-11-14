// What work config check refuses in a config that reads: the git user is not one of its people,
// or the words of an agent role fail their static fit. The CLI (work config check, work onboard)
// and the page (the store start) check a config with it, so it lives where both may import it.
import { Effect } from 'effect'
import { wordsFit } from '../../core/actions/config.ts'
import type { ConfigFile } from '../../core/schema/index.ts'
import { GitUser } from '../../core/services/index.ts'

export const configProblems = (config: ConfigFile) =>
  Effect.gen(function* () {
    const problems: Array<string> = []
    const user = yield* (yield* GitUser).name
    if (!config.people.includes(user)) problems.push(`${user} (git user.name) is not in the people`)
    for (const [role, r] of Object.entries(config.roles)) {
      // The static fit of a role with no work behind it: its own words only.
      if (r.kind !== 'program') problems.push(...wordsFit(r).map((p) => `${role}: ${p}`))
    }
    return problems
  })
