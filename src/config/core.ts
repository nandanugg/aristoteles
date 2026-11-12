// The names and the helpers that config.ts and settings.ts share (they would import each other).
import { createHash } from 'node:crypto'
import { Effect } from 'effect'
import { Refused } from '../domain/errors.ts'

export const CONFIG = 'aristoteles.yaml'
export const MECHANISM_KEYS = ['people', 'limits', 'roles', 'decide'] as const
// outsideSourceHours (the owner's ruling, 2026-11-12): how long the revision that an agent read
// of an outside source holds; after it, work made from that source waits for a new read. It is
// read from the file now, as the other times are, and a change of it is no change of the
// mechanism.
export const SETTING_KEYS = [
  'tiers',
  'retryMinutes',
  'hostWaitMinutes',
  'outsideSourceHours',
  'sound',
  'theme',
] as const
export const TIERS = ['low', 'medium', 'high'] as const
// The limits of a tier sit under the part that checks them, as on the page. A file that names
// another part (such as Note) is refused.
export const LIMIT_KEYS = {
  Assignment: ['briefChars', 'attempts'],
  Review: ['rules'],
  Result: ['size'],
} as const

export const sha = (text: string): string => createHash('sha256').update(text).digest('hex')

// A raw value of a yaml file: the readers check it by hand, as the old code did.
// biome-ignore lint/suspicious/noExplicitAny: parsed yaml is untyped until a reader checks it
export type Raw = any

// A refusal in the old words: "<where>: <message>". The readers below throw it, and `refusing`
// turns the throw into a failure of the Effect.
export const fail = (where: string, message: string): never => {
  throw new Refused({ message: `${where}: ${message}`, next: null })
}
export const list = (value: unknown): Raw[] => (Array.isArray(value) ? value : [])

// Runs a reader that throws Refused; any other throw is a bug and stays a defect.
export const refusing = <A>(read: () => A): Effect.Effect<A, Refused> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(read())
    } catch (e) {
      return e instanceof Refused ? Effect.fail(e) : Effect.die(e)
    }
  })

// Bun.YAML.parse; a text that does not parse is a refusal with the parser's own words.
export const parseYaml = (text: string): Raw => {
  try {
    return Bun.YAML.parse(text) ?? {}
  } catch (e) {
    throw new Refused({ message: e instanceof Error ? e.message : String(e), next: null })
  }
}
