// The daily refresh of the company directions of aristoteles.lock (Nanda, 2026-11-10): the first
// command of a day fetches each repo; a folder that changed comes in as a draft that its owner
// accepts. A failed fetch stops no command: the project stays on its accepted commit, and the next
// command tries again. A changed folder is an ImportCompany action.
import { join } from 'node:path'
import { Effect, type Scope } from 'effect'
import { importedAlready } from '../../core/actions/drafts.ts'
import { currentOf } from '../../core/derived/reads.ts'
import {
  type CompanyCheckers,
  type CompanyFolder,
  DirectionId,
  type Direction,
  type Expected,
  type ExternalSource,
  refuse,
  RoleName,
  type Version,
  type Work,
} from '../../core/schema/index.ts'
import {
  Dir,
  Env,
  fetchFolder,
  Files,
  localDate,
  LOCK,
  Now,
  readLock,
  Terminal,
  writeLock,
} from '../../core/services/index.ts'
import type { Refusal } from '../../core/schema/errors.ts'
import type { CliServices } from './command.ts'
import { act, peekWork } from './runtime.ts'

type Lock = NonNullable<Effect.Success<ReturnType<typeof readLock>>>
type LockEntry = Lock[string]

// The folder says what the current version says: the words, and each standard and rule by id
// and words, in the same order.
const sameAsFolder = (work: Work, version: Version<Direction>, folder: CompanyFolder): boolean =>
  version.says === folder.says &&
  version.standards.length === folder.standards.length &&
  folder.standards.every((x, i) => {
    const standard = work.standards.get(version.standards[i] as (typeof version.standards)[number])
    return (
      standard?.id === x.id &&
      standard.says === x.says &&
      standard.rules.length === x.rules.length &&
      x.rules.every((r, j) => {
        const rule = work.rules.get(standard.rules[j] as (typeof standard.rules)[number])
        return rule?.id === r.id && rule.says === r.says
      })
    )
  })

const checkersOf = (entry: LockEntry): CompanyCheckers => ({
  ...(entry.checkedBy !== undefined ? { checkedBy: RoleName.make(entry.checkedBy) } : {}),
  ...(entry.rules !== undefined
    ? {
        rules: Object.fromEntries(
          Object.entries(entry.rules).map(([rule, role]) => [rule, RoleName.make(role)]),
        ),
      }
    : {}),
})

// The lines that tell what happened (main prints them on err). A dir with no store has nothing to
// refresh into: the old main skipped it and printed no note.
const refreshCompany = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const env = (yield* Env).vars
  const lock = yield* readLock(cwd)
  if (!lock) return [] as ReadonlyArray<string>
  const today = localDate(yield* (yield* Now).read)
  const notes: Array<string> = []
  const next: Record<string, LockEntry> = { ...lock }
  let changed = false
  for (const [id, entry] of Object.entries(lock)) {
    if (entry.refreshed === today) continue
    const fetched = yield* fetchFolder(env, entry).pipe(
      Effect.match({ onFailure: (error) => ({ error }), onSuccess: (ok) => ({ ok }) }),
    )
    if ('error' in fetched) {
      const why = String(fetched.error.message).split('\n')[0]
      notes.push(
        `refresh: ${id} failed (${why}); still on ${entry.commit?.slice(0, 7) ?? 'no commit'}`,
      )
      continue
    }
    const { commit, folder } = fetched.ok
    const source: ExternalSource = {
      repo: entry.repo,
      path: entry.path,
      ref: entry.tag ? { _tag: 'Tag', tag: entry.tag } : { _tag: 'DefaultBranch' },
      commit,
    }
    const peeked = yield* peekWork.pipe(
      Effect.catchTag('Refused', (e) =>
        /no work store/.test(e.message) ? Effect.succeed(undefined) : Effect.fail(e),
      ),
    )
    // The old main skipped the refresh of a dir with no store, and printed no note.
    if (peeked === undefined) return []
    const { work, d: derived } = peeked
    if (!work.config.people.includes(entry.owner)) {
      return yield* refuse(
        `${LOCK} ${id}: owner ${entry.owner} is not in the people of aristoteles.yaml`,
      )
    }
    const direction = DirectionId.make(id)
    const d = work.directions.get(direction)
    const now = d?._tag === 'Official' ? currentOf(work, direction) : undefined
    const same = now !== undefined && sameAsFolder(work, now, folder)
    // Ruling 10.4: the action's own rule; a vetoed commit is offered again.
    const known = d !== undefined && importedAlready(derived, direction, commit)
    if (!same && !known) {
      const done = yield* act(
        { _tag: 'Refresh' },
        {
          _tag: 'ImportCompany',
          target: { direction },
          content: { source, folder, owner: entry.owner, checkers: checkersOf(entry) },
        },
      )
      notes.push(
        `refresh: ${id} at ${commit.slice(0, 7)} came in as ${done.created[0]}; it waits for the accept of ` +
          `${entry.owner} (work direction show ${done.created[0]})`,
      )
    }
    next[id] = { ...entry, newest: commit, refreshed: today }
    changed = true
  }
  if (changed) yield* writeLock(cwd, next as Lock)
  return notes
})

// The first command of a day refreshes the company directions, after init made a store.
export const refresh = (name: string): Effect.Effect<void, Expected | Refusal, CliServices | Scope.Scope> =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    if (name === 'init' || (yield* (yield* Files).kind(join(cwd, LOCK))) === null) return
    const terminal = yield* Terminal
    for (const note of yield* refreshCompany) yield* terminal.err(note)
  })

// After the owner accepts a commit of a company direction, the lock follows it.
export const followCommit = (
  work: Work,
  version: Version<Direction>,
): Effect.Effect<ReadonlyArray<string>, Expected, CliServices> =>
  Effect.gen(function* () {
    // A company version names its commit through the draft that made it.
    const origin = work.directions.get(version.of)?.source
    const made = work.drafts.get(version.revision)?.origin
    if (made?._tag !== 'Imported' || origin?._tag !== 'External') return []
    const source = { repo: origin.repo, commit: made.commit }
    const { cwd } = yield* Dir
    const lock = yield* readLock(cwd)
    const entry = lock?.[version.of]
    if (!lock || !entry) return []
    yield* writeLock(cwd, { ...lock, [version.of]: { ...entry, commit: source.commit } })
    return [`${version.of} follows ${source.commit.slice(0, 7)} of ${source.repo} now (${LOCK}).`]
  })
