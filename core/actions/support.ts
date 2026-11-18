// What the actions share: the check of state (canAct, the one check), the reads of the files that
// a content names, and the shape of the refusals tables. An action refuses only through a maker
// of its module's table.
import { join } from 'node:path'
import { Effect } from 'effect'
import { canAct, type Derived } from '../derived/index.ts'
import { type ActionInput, intentOf } from '../schema/actions.ts'
import { type ChoiceKind, type Refusal, refusal } from '../schema/errors.ts'
import { type Author, isNonBlank, type NonBlank, type Refused } from '../schema/index.ts'
import { fileHashes, Files, parseYaml } from '../services/index.ts'
import { Current } from './types.ts'

// --- refusals ------------------------------------------------------------------------------------

export const no = (message: string, kind: ChoiceKind, words: string): Refusal =>
  refusal(message, kind, words as NonBlank)
// The refusal paths of each action: the action refuses only through these makers (and through
// canAct, whose refusals are core/derived's).
export type RefusalsOf = Readonly<Record<string, (...args: ReadonlyArray<string>) => Refusal>>

// The domain Refused of a reused reader (lookup, a config reader) as a refusal with a choice
// (BUILD.md D10): an id that names nothing is a Pick; a file that does not decode is a Write.
export const COMMON = {
  noRecord: (message: string) => no(message, 'Pick', 'name a record that exists'),
  badFile: (message: string, file: string) =>
    no(message, 'Write', `correct ${file}, then act again with it`),
  noFile: (file: string, cwd: string) =>
    no(`there is no file ${file} in ${cwd}`, 'Write', `write ${file} in ${cwd}`),
  // The mechanism of aristoteles.yaml changed since the stored config (the old checkHashes).
  configChanged: (changed: string, fix: string) =>
    no(`${changed} changed since the stored config`, 'Pick', fix),
} satisfies RefusalsOf
export const asPick = (e: Refused): Refusal => COMMON.noRecord(e.message)
export const asWrite =
  (file: string) =>
  (e: Refused): Refusal =>
    COMMON.badFile(e.message, file)

// --- the state -----------------------------------------------------------------------------------

export const current: Effect.Effect<Derived, never, Current> = Effect.map(
  Effect.service(Current),
  (c) => c.derived,
)

// Step 2 of an action (BUILD.md 3.6): canAct, the one check of state.
export const allowed = (
  d: Derived,
  by: Author,
  input: ActionInput,
): Effect.Effect<void, Refusal> => {
  const r = canAct(d, by, intentOf(input))
  return r._tag === 'May' ? Effect.void : Effect.fail(r.refusal)
}

// The stored config is the one in the dir: a changed mechanism is the person's to restore or to
// apply before any act that reads it (the old checkHashes, a check of files).
export const configUnchanged = (d: Derived): Effect.Effect<void, Refusal, Files> =>
  Effect.gen(function* () {
    const was = d.moment.work.hashes
    const hashes = yield* fileHashes(d.moment.outside.cwd)
    const keys = Object.keys({ ...hashes, ...was }).filter((f) => hashes[f] !== was[f])
    if (keys.length === 0) return
    const changed = keys
      .map((f) => (was[f] === undefined ? `${f} (new, not in the store: delete it)` : f))
      .join(', ')
    const fresh = keys.filter((f) => was[f] === undefined)
    const fix = [
      ...(fresh.length ? [`delete ${fresh.join(', ')}`] : []),
      ...(fresh.length < keys.length
        ? ['restore the stored files (work config restore), or apply the role words']
        : []),
    ].join('; ')
    return yield* Effect.fail(COMMON.configChanged(changed, fix))
  })

// --- words and files -----------------------------------------------------------------------------

export const blank = (words: string | null | undefined): boolean =>
  words === null || words === undefined || !isNonBlank(words)

// The text of a file that a content names, read from the dir.
const readText = (cwd: string, file: string): Effect.Effect<string, Refusal, Files> =>
  Effect.gen(function* () {
    const files = yield* Files
    const path = join(cwd, file)
    const text = (yield* files.kind(path)) === 'file' ? yield* files.read(path) : null
    return text ?? (yield* Effect.fail(COMMON.noFile(file, cwd)))
  })
// The yaml of a file; a text that does not parse is a Write refusal with the parser's words.
export const readYaml = (cwd: string, file: string): Effect.Effect<unknown, Refusal, Files> =>
  Effect.flatMap(readText(cwd, file), (text) =>
    Effect.try({
      try: () => parseYaml(text) as unknown,
      catch: (e) => COMMON.badFile(e instanceof Error ? e.message : String(e), file),
    }),
  )
