// What the commands of tasks.ts and work.ts share: the checks that many commands run
// (checkHashes, evidenceOf, checkEvidence, pointsOf, checkDigest, checkParts and the name checks
// of a workspace) and the small reads over the Work.
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { Effect } from 'effect'
import { checkWorkspace, sha } from '../../config/config.ts'
import { type Raw } from '../../config/core.ts'
import { type Refused, refuse } from '../../domain/errors.ts'
import type { Event, EvidenceData, PointData } from '../../domain/events.ts'
import type { ContextKey, Workspace } from '../../domain/files.ts'
import {
  type AssignmentId,
  isNonBlank,
  type PointId,
  type RejectId,
  type ResultId,
  type TaskId,
  type Time,
} from '../../domain/ids.ts'
import { type Found, lookup } from '../../domain/lookup.ts'
import { sectionOf, valueAt, whereRecord } from '../../domain/context.ts'
import type { Assignment, Result, Task, Where } from '../../domain/model.ts'
import type * as M from '../../domain/model.ts'
import type { CreatedId, Work } from '../../domain/work.ts'
import { current, directionsOf, findRule, resultsOf, within } from '../../engine/queries.ts'
import { changedSince, sectionsOf } from '../../files/digest.ts'
import { Dir } from '../../services/io.ts'
import { Files, Spawn } from '../../services/outside.ts'
import { tierOf } from '../caller.ts'
import type { Done } from '../run.ts'

// The words that say who continues when an agent stops.
export const upTo = (a: Assignment): string =>
  a.parent._tag === 'Parent' ? 'your parent' : 'the person'

// The assignment was given by that parent (the person gives the top assignments).
export const givenBy = (a: Assignment, parent: AssignmentId): boolean =>
  a.parent._tag === 'Parent' && a.parent.id === parent

// A maker's most attempts; undefined: no limit (or a role that makes nothing).
export const maxAttemptsOf = (a: Assignment): number | undefined =>
  a._tag === 'Maker' && a.maxAttempts._tag === 'AtMost' ? a.maxAttempts.max : undefined

// The keys that a where names.
export const whereKeys = (where: Where): ReadonlyArray<ContextKey> =>
  where._tag === 'Where' ? [...where.conditions.keys()] : []

// The base of a task's workspace entry: a repo has one; a file or a folder has none.
export const baseOf = (w: M.Workspace): string | undefined =>
  w._tag === 'Repo' ? w.base : undefined

// The first id that a step made, as a string for a line of words.
export const firstCreated = (created: ReadonlyArray<CreatedId>): string => String(created[0])

// The event that a write stored, as the tag the command wrote (a different tag is a bug).
export const writtenEvent = (done: Done): Effect.Effect<Event> =>
  done.written ? Effect.succeed(done.written.event) : Effect.die('the write stored nothing')

// The newest result of a task.
export const latestResult = (work: Work, task: TaskId): Result | undefined =>
  resultsOf(work, task).at(-1)

// A git source is a workspace with a base.
export const gitSources = (work: Work): ReadonlyArray<Extract<M.Workspace, { _tag: 'Repo' }>> =>
  [...work.tasks.values()].flatMap((t) =>
    t.descriptionAi.workspace.flatMap((w) => (w._tag === 'Repo' ? [w] : [])),
  )

// A record is in the task tree of an assignment.
export const inTree = (work: Work, found: Found, a: Assignment): boolean => {
  const task =
    found._tag === 'Task'
      ? found.task.id
      : found._tag === 'Result'
        ? found.result.task
        : found._tag === 'Question'
          ? found.question.stops
          : undefined
  return task !== undefined && within(work, task as TaskId, a.task)
}

// The directions that a task may name: each with a version, and its current standards in the
// file's shape that readTask reads (a typed Where keeps its keys in a Map). A direction with only
// a draft has no version yet, so no task names it.
export const officialDirections = (work: Work) =>
  [...work.directions]
    .flatMap(([id, d]) => (d._tag === 'Official' ? [id] : []))
    .map((id) => ({
      id,
      standards: current(work, id)
        .standards.flatMap((e) => work.standards.get(e) ?? [])
        .map((s) => ({ where: whereRecord(s.where) })),
    }))

// The form of the evidence of an accept, in each refusal that asks for it: one text, so that a
// checker does not meet two shapes (Nanda, 2026-11-13).
export const EVIDENCE_FORM =
  '--evidence="<rule id> | <where you read in the result> | <what you saw there>", one for each rule in your checks; with no rule: --evidence="<where you read> | <what you saw there>"'

// One evidence line: <rule id> | <where> | <what>, or <where> | <what> for what no rule names.
export const evidenceOf = (
  values: ReadonlyArray<string | true>,
): Effect.Effect<ReadonlyArray<EvidenceData>, Refused> =>
  Effect.gen(function* () {
    const out: Array<EvidenceData> = []
    for (const v of values) {
      const parts = String(v)
        .split('|')
        .map((p) => p.trim())
      if (![2, 3].includes(parts.length) || parts.some((p) => !p)) {
        return yield* refuse(
          `--evidence="${String(v)}" does not read: an accept needs ${EVIDENCE_FORM}`,
        )
      }
      const [rule, where, what] = parts.length === 3 ? parts : [null, ...parts]
      out.push({ rule: rule ?? null, where: where ?? '', what: what ?? '' })
    }
    return out
  })

export const evidenceFlag = (e: EvidenceData): string =>
  `--evidence="${e.rule ? `${e.rule} | ` : ''}${e.where} | ${e.what}"`

// An agent's evidence names the place it looked (the file, the repo, or the section of the
// result) and says what it saw in at least three words. The refusal gives the command again,
// so the checker corrects the one field.
export const checkEvidence = (
  result: Result,
  evidence: ReadonlyArray<EvidenceData>,
  again: (index: number, fix: Partial<EvidenceData>) => string,
): Effect.Effect<void, Refused> =>
  Effect.gen(function* () {
    const [file = '', section] = result.output.split(/[#@]/)
    const base = file.split('/').at(-1)
    for (const [i, e] of evidence.entries()) {
      const about = e.rule ?? 'the result'
      const where = e.where.toLowerCase()
      if (![file, base, section].filter(Boolean).some((x) => where.includes((x ?? '').toLowerCase()))) {
        return yield* refuse(
          `the evidence for ${about} says where "${e.where}"; name the place in ${result.output}`,
          `correct the place and run the review again: ${again(i, { where: `<the place in ${result.output} where you looked>` })}`,
        )
      }
      const realWords = e.what.split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w))
      if (realWords.length < 3 || e.what.trim().toLowerCase() === e.where.trim().toLowerCase()) {
        return yield* refuse(
          `the evidence for ${about} says what "${e.what}"; say what you saw, in a sentence of words`,
          `correct what you saw and run the review again: ${again(i, { what: '<what you saw, in a sentence>' })}`,
        )
      }
    }
  })

// The points of a reject, from the flags in their order: a --breaks belongs to the --point
// before it.
export interface GivenPoint {
  readonly text: string
  readonly breaks: string | null
}
export const pointsOf = (
  flags: ReadonlyArray<readonly [string, string | true]>,
): Effect.Effect<ReadonlyArray<GivenPoint>, Refused> =>
  Effect.gen(function* () {
    const points: Array<{ text: string; breaks: string | null }> = []
    for (const [key, value] of flags) {
      if (key === 'point') points.push({ text: String(value), breaks: null })
      if (key === 'breaks') {
        const last = points.at(-1)
        if (!last) {
          return yield* refuse('--breaks belongs to the --point before it; put the --point first')
        }
        last.breaks = String(value)
      }
    }
    return points
  })

// The points as the stored Reject holds them: each one says something (the old engine's words,
// after the other checks of the reject).
export const pointDataOf = (
  points: ReadonlyArray<GivenPoint>,
): Effect.Effect<ReadonlyArray<PointData>, Refused> =>
  Effect.forEach(points, ({ text, breaks }) =>
    isNonBlank(text)
      ? Effect.succeed({ text, breaks })
      : Effect.fail(refuse('a Reject needs a reason')),
  )

// The reviewed work must be the reported work.
export const checkDigest = (
  found: Found,
  by: Assignment | undefined,
  work: Work,
  token: string | undefined,
): Effect.Effect<void, Refused, Dir | Files | Spawn> =>
  Effect.gen(function* () {
    if (found._tag !== 'Result') return
    const { cwd } = yield* Dir
    if (!(yield* changedSince(cwd, found.result))) return
    const id = found.result.id
    return yield* refuse(
      `the work changed after ${id} was reported`,
      by && tierOf(work, by) === 'low'
        ? `work escalate ${token} --result=${id} --reason="the work changed after ${id} was reported", then STOP`
        : 'the maker reports it again as a new attempt; review that result',
    )
  })

// A rule by its id in the official versions now, or a refusal.
export const ruleNamed = (work: Work, id: string): Effect.Effect<void, Refused> =>
  findRule(work, id) === undefined
    ? refuse(`there is no rule "${id}" in an official version`)
    : Effect.void

// One file has one name in the store: the file queue and the same-files checks compare names,
// so a workspace path through a link, or in another case than on disk, is refused with its real
// name. A path that does not exist yet is checked through the deepest folder of it that exists.
export const checkRealNames = (
  cwd: string,
  workspace: ReadonlyArray<Workspace>,
): Effect.Effect<void, Refused, Files> =>
  Effect.gen(function* () {
    const files = yield* Files
    // realpath is the one call that Files does not offer; it is a plain read of the disk.
    const real = (p: string) => realpathSync.native(p)
    const root = real(cwd)
    for (const w of workspace) {
      let known = w.path
      while (known !== '.' && (yield* files.kind(join(cwd, known))) === null) known = dirname(known)
      if (known === '.') continue
      const onDisk = relative(root, real(join(cwd, known)))
      if (onDisk.startsWith('..') || isAbsolute(onDisk)) {
        return yield* refuse(`workspace ${w.path} leads outside the dir`)
      }
      const name = known === w.path ? onDisk : join(onDisk, relative(known, w.path))
      if (name !== w.path) {
        return yield* refuse(
          `workspace ${w.path} is ${name} on disk; name it ${name}, so that one file has one name`,
        )
      }
    }
  })

// On a disk that ignores case, two names that differ only in case are one file: a new workspace
// path takes the case of the name that a task already uses.
export const checkCaseTwins = (
  work: Work,
  workspace: ReadonlyArray<Workspace>,
): Effect.Effect<void, Refused> =>
  Effect.gen(function* () {
    const lower = (x: string) => x.toLowerCase()
    const near = (x: string, y: string) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
    const names = [...work.tasks.values()]
      .filter((t) => t.end._tag === 'NotEnded')
      .flatMap((t) => t.descriptionAi.workspace.map((w) => w.path))
    for (const w of workspace) {
      const twin = names.find((n) => near(lower(n), lower(w.path)) && !near(n, w.path))
      if (twin) {
        return yield* refuse(
          `workspace ${w.path} and ${twin} differ only in case, and on many disks they are one file; write it as ${twin} has it`,
        )
      }
    }
  })

// The parts of a split are checked like a task file, and keep the parent's context. The parts
// are the raw yaml of the file, so each key is checked by hand.
export const checkParts = (
  work: Work,
  task: Task,
  parts: Raw,
  file: string,
): Effect.Effect<void, Refused, Dir | Files> =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const files = yield* Files
    if (!Array.isArray(parts) || parts.length === 0) {
      return yield* refuse(`${file} must be a list of parts`)
    }
    // A task with a section is one unit of work: a part keeps the section of its task, so a part
    // would own the whole of what its task owns.
    const ownSection = sectionOf(task.descriptionAi.context) ?? undefined
    if (ownSection) {
      return yield* refuse(
        `${task.id} has the section ${ownSection}, so it is one unit of work; it is not split`,
        `run ${task.id} with a medium role, or remake it with no section`,
      )
    }
    const used = new Set(
      directionsOf(work, task.id).flatMap((d) =>
        current(work, d.id).standards.flatMap((e) => {
          const standard = work.standards.get(e)
          return standard ? whereKeys(standard.where) : []
        }),
      ),
    )
    const taskWorkspace = task.descriptionAi.workspace
    for (const [i, p] of parts.entries()) {
      if (!p?.name || !p?.text) return yield* refuse(`each part in ${file} needs a name and a text`)
      if (p.maxRounds !== undefined) {
        return yield* refuse(
          `part ${p.name}: maxRounds is gone; when the tries of a maker end on a fault, the high role evaluates the mistake`,
        )
      }
      if (p.from !== undefined) yield* lookup(work, String(p.from), ['r'])
      // A part that uses the work of other parts, or changes the same files, runs after them.
      if (p.after !== undefined && !Array.isArray(p.after)) {
        return yield* refuse(`part ${p.name}: after is a list of part names, like after: [Schema]`)
      }
      const above: Array<unknown> = parts.slice(0, i).map((x: Raw) => x?.name)
      if (above.includes(p.name)) {
        return yield* refuse(`two parts in ${file} are named ${p.name}; each part needs its own name`)
      }
      const unknown = ((p.after ?? []) as Array<unknown>).find((n) => !above.includes(n))
      if (unknown) {
        return yield* refuse(
          `part ${p.name}: after names "${String(unknown)}", which is not a part above it in ${file}`,
        )
      }
      for (const [key, value] of Object.entries(p.context ?? {})) {
        // section is the CLI's own key (a report of <file>#<section>, and who owns a section), so a
        // part may name one with no "when" that uses it.
        if (!used.has(key as ContextKey) && key !== 'section') {
          return yield* refuse(
            `part ${p.name}: context key "${key}" is used by no "when" of its directions`,
          )
        }
        // The context is closed (model.ts Context): a value is a text, or the event cannot hold it.
        if (typeof value !== 'string') {
          return yield* refuse(`part ${p.name}: context ${key} is a text, like ${key}: introduction`)
        }
        const was = valueAt(task.descriptionAi.context, key as ContextKey)
        if (was !== undefined && was !== value) {
          return yield* refuse(
            `part ${p.name} changes the context ${key} from ${was} to ${String(value)}; a part keeps the rules of its task`,
          )
        }
      }
      if (p.workspace !== undefined && (!Array.isArray(p.workspace) || p.workspace.length === 0)) {
        return yield* refuse(
          `part ${p.name} has an empty workspace; leave workspace out, and the part keeps its task's workspace`,
        )
      }
      if (p.workspace) {
        yield* checkWorkspace(`part ${p.name}`, p.workspace)
        // A part works in its task's workspace, with the same base.
        for (const w of p.workspace as ReadonlyArray<Workspace>) {
          const same = (o: M.Workspace) =>
            o.source === w.source && o.path === w.path && baseOf(o) === w.base
          if (!taskWorkspace.some(same)) {
            return yield* refuse(
              `part ${p.name}: workspace ${w.path} is not one of its task's (${taskWorkspace.map((o) => o.path).join(', ') || 'none'}), with the same base`,
            )
          }
        }
      }
    }
    // Parts that share a document file own their sections of it, so a report keeps the sections of
    // the others: in one file, every part has its own section. A folder (a git repo) has no
    // sections; its parts make their own commits, and the task merges them.
    const partSection = (p: Raw): string | undefined => p.context?.section ?? ownSection
    const filesOf = (p: Raw): ReadonlyArray<string> =>
      ((p.workspace ?? taskWorkspace) as ReadonlyArray<{ readonly path: string }>).map((w) => w.path)
    const all: Array<Raw> = parts
    for (const f of new Set(all.flatMap(filesOf))) {
      const sharing = all.filter((p) => filesOf(p).includes(f))
      if ((yield* files.kind(join(cwd, f))) === 'folder') continue
      const bare = sharing.filter((p) => !partSection(p))
      if (sharing.length > 1 && bare.length) {
        return yield* refuse(
          `the parts ${sharing.map((p) => p.name).join(', ')} share ${f}, and ${bare.map((p) => p.name).join(', ')} ${bare.length > 1 ? 'have' : 'has'} no section; each part needs its own section of the file, so no part changes the work of another`,
          `give each part its own section (context: { section: <heading id> }), or run ${task.id} as one task`,
        )
      }
      // No section of a part lies inside the section of another part (a sub-heading of it).
      const text = yield* files.read(join(cwd, f))
      const heads = text === null ? [] : sectionsOf(text)
      const span = (p: Raw) => heads.find((h) => h.slug === partSection(p))
      const inside = (p: Raw, q: Raw) => {
        const a = span(p)
        const b = span(q)
        return q !== p && a !== undefined && b !== undefined && a.start > b.start && a.start < b.end
      }
      const inner = sharing.find((p) => sharing.some((q) => inside(p, q)))
      if (inner) {
        const outer = sharing.find((q) => inside(inner, q))
        return yield* refuse(
          `the section ${partSection(inner)} of ${f} lies inside the section ${partSection(outer)}; two parts may not own one piece of the file`,
          'give each part a section that no other part holds',
        )
      }
      const twin = sharing.find(
        (p, i) => partSection(p) && sharing.findIndex((q) => partSection(q) === partSection(p)) !== i,
      )
      if (twin) {
        return yield* refuse(
          `two parts of ${task.id} have the section ${partSection(twin)} of ${f}; a section is the work of one task`,
          `give each part its own section, or run ${task.id} as one task with a medium role`,
        )
      }
    }
  })

// The time of a moment in the dir, as the clock gives it.
export const asTime = (iso: string): Time => iso as Time

// The Reject (v4: all its points) or the point (v4.1) of a --review flag, as lookup finds it.
// A review that is no Reject passes as its id: the engine's check refuses it with the old words.
export const rejectRef = (work: Work, id: string): Effect.Effect<RejectId | PointId, Refused> =>
  Effect.map(lookup(work, id, ['v']), (found) =>
    found._tag === 'Point' ? found.id : (id as RejectId),
  )

// The text of a flag that a command read as a value; a missing flag is the empty text, which the
// engine's check refuses with the old words.
export const wordsOf = (value: string | true | undefined): string =>
  typeof value === 'string' ? value : ''

// The secret of a program's assignment (no clock, no random).
export const programSecret = (result: ResultId): string => sha(`program-${result}`)
