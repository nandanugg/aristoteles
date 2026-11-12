// The daily refresh of the company directions of aristoteles.lock (Nanda, 2026-11-10): the first
// command of a day fetches each repo; a folder that changed comes in as a draft that its owner
// accepts. A failed fetch stops no command: the project stays on its accepted commit, and the next
// command tries again.
import { Effect, type Scope } from 'effect'
import type { OutsideFailed, Refused, StoreDamaged } from '../domain/errors.ts'
import { refuse } from '../domain/errors.ts'
import { create } from '../domain/events.ts'
import type { CompanyCheckers, CompanyFolder, ExternalSource } from '../domain/files.ts'
import { DirectionId, RoleName } from '../domain/ids.ts'
import type { Direction, Version } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import { current } from '../engine/queries.ts'
import {
  fetchFolder,
  type Lock,
  type LockEntry,
  LOCK,
  localDate,
  readLock,
  writeLock,
} from '../files/company.ts'
import { Dir, Env, Now } from '../services/io.ts'
import { parseArgs } from './args.ts'
import type { Call, CliServices } from './command.ts'
import { writeAct } from './run.ts'

// A write needs a call; the refresh has no command and no token, so no guard reads it.
const REFRESH_CALL: Call = {
  argv: [],
  args: parseArgs([]),
  name: 'status',
  act: null,
  token: null,
}

// The folder says what the current version says: the words, and each standard and rule by id
// and words, in the same order.
export const sameAsFolder = (
  work: Work,
  version: Version<Direction>,
  folder: CompanyFolder,
): boolean =>
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
export const refreshCompany: Effect.Effect<
  ReadonlyArray<string>,
  Refused | OutsideFailed | StoreDamaged,
  CliServices | Scope.Scope
> = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const env = (yield* Env).vars
  const lock = yield* readLock(cwd)
  if (!lock) return []
  const today = localDate(yield* (yield* Now).read)
  const notes: Array<string> = []
  const next: Record<string, LockEntry> = { ...lock }
  let changed = false
  for (const [id, entry] of Object.entries(lock)) {
    if (entry.refreshed === today) continue
    const fetched = yield* fetchFolder(env, entry).pipe(
      Effect.match({
        onFailure: (error) => ({ error }),
        onSuccess: (ok) => ({ ok }),
      }),
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
    const done = yield* writeAct(REFRESH_CALL, (work) =>
      Effect.gen(function* () {
        if (!work.config.people.includes(entry.owner)) {
          return yield* refuse(
            `${LOCK} ${id}: owner ${entry.owner} is not in the people of aristoteles.yaml`,
          )
        }
        const directionId = DirectionId.make(id)
        const d = work.directions.get(directionId)
        const now = d?._tag === 'Official' ? current(work, directionId) : undefined
        const same = now !== undefined && sameAsFolder(work, now, folder)
        const known = [...work.drafts.values()].some(
          (x) =>
            d !== undefined &&
            x.of === d.id &&
            x.origin._tag === 'Imported' &&
            x.origin.commit === commit,
        )
        if (same || known) return null
        const imported = {
          _tag: 'Imported' as const,
          direction: directionId,
          source,
          folder,
          owner: entry.owner,
          checkers: checkersOf(entry),
        }
        return { author: { _tag: 'Refresh' as const }, event: create('Revision', imported) }
      }),
    ).pipe(
      // The old main skipped the refresh of a dir with no store, and printed no note.
      Effect.catchIf(
        (e) => e._tag === 'Refused' && /no work store/.test(e.message),
        () => Effect.succeed(undefined),
      ),
    )
    if (done === undefined) return []
    if (done.written !== null) {
      const draft = done.created[0]
      notes.push(
        `refresh: ${id} at ${commit.slice(0, 7)} came in as ${draft}; it waits for the accept of ` +
          `${entry.owner} (work direction show ${draft})`,
      )
    }
    next[id] = { ...entry, newest: commit, refreshed: today }
    changed = true
  }
  if (changed) yield* writeLock(cwd, next as Lock)
  return notes
})

// After the owner accepts a commit of a company direction, the lock follows it.
export const followCommit = (
  work: Work,
  version: Version<Direction>,
): Effect.Effect<ReadonlyArray<string>, Refused | OutsideFailed, CliServices> =>
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
    return [
      `${version.of} follows ${source.commit.slice(0, 7)} of ${source.repo} now (${LOCK}).`,
    ]
  })
