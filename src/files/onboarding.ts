// Onboarding works on files before any store exists (ruling 1, BUILD.md 1b). This module is the
// only writer of the three files of onboarding; the CLI (work onboard) and the page call it, and
// the host passes its own drafts through the CLI with --file. Every write takes the lock, reads
// the files, applies one act, checks the result, writes a temp file and renames it onto the file.
// A reader reads with no lock: a rename always gives it a whole file.
//   .work/assess/<id>.yaml   one direction (OnboardingDirection)
//   .work/assess/roles.yaml  the onboarding state of each role (P4)
//   aristoteles.draft.yaml   the config draft only: people, limits, roles, decide, tiers
// The lock is outside .work/assess/, because the store start deletes that folder before it
// releases the lock.
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { Effect, Schema, type Scope } from 'effect'
import { type ConfigRead, configOfText } from '../config/config.ts'
import { CONFIG, DRAFT, parseYaml, type Raw, refusing } from '../config/core.ts'
import { mergeDraft } from '../config/settings.ts'
import type { Principle } from '../domain/closed.ts'
import { OutsideFailed, Refused, refuse } from '../domain/errors.ts'
import type { OnboardedDirection } from '../domain/events.ts'
import {
  type Case,
  type Cases,
  type CompanyFolder,
  checkerProblem,
  type RoleFile,
  type StandardFile,
} from '../domain/files.ts'
import { DirectionId, type NonBlank, type RoleName } from '../domain/ids.ts'
import {
  type OnboardingAct,
  OnboardingDirection,
  type OnboardingRole,
  OnboardingRoleState,
} from '../domain/onboarding.ts'
import type { Files, Spawn } from '../services/outside.ts'
import { fetchFolder, LOCK, type LockEntry, readLock, writeLock } from './company.ts'

export const ASSESS = join('.work', 'assess')
const ROLES = join(ASSESS, 'roles.yaml')
export const ONBOARDING_LOCK = join('.work', 'onboarding.lock')
// A writer tries again every 50 ms for up to 5 s; a lock older than 30 s is a dead writer's.
const RETRY_MS = 50
const WAIT_MS = 5000
const STALE_MS = 30000

const NONE = { _tag: 'None' } as const
const WAITING = { _tag: 'Waiting' } as const
const ACCEPTED = { _tag: 'Accepted' } as const

// --- the lock and the atomic writes ----------------------------------------------------------------

const outside = (e: unknown) =>
  new OutsideFailed({
    system: 'files',
    message: e instanceof Error ? e.message : String(e),
    next: null,
  })
const io = <A>(run: () => A) => Effect.try({ try: run, catch: outside })

const readText = (path: string): string | null =>
  existsSync(path) ? readFileSync(path, 'utf8') : null

// One try: 'wx' makes the lock file only when there is none.
const tryLock = (path: string, mine: string): boolean => {
  try {
    const fd = openSync(path, 'wx')
    writeSync(fd, mine)
    closeSync(fd)
    return true
  } catch (e) {
    if ((e as { code?: string }).code === 'EEXIST') return false
    throw e
  }
}
const ageOf = (path: string): number | null => {
  try {
    return Date.now() - statSync(path).mtimeMs
  } catch {
    return null
  }
}

// The lock holds the pid and the time of its writer, for the person who reads it.
const takeLock = (dir: string) =>
  Effect.gen(function* () {
    const path = join(dir, ONBOARDING_LOCK)
    yield* io(() => mkdirSync(dirname(path), { recursive: true }))
    const mine = `${process.pid} ${new Date().toISOString()}\n`
    const start = Date.now()
    for (;;) {
      if (yield* io(() => tryLock(path, mine))) return mine
      const age = ageOf(path)
      if (age !== null && age > STALE_MS) {
        yield* io(() => rmSync(path, { force: true }))
        continue
      }
      if (Date.now() - start > WAIT_MS) {
        const holder = (readText(path) ?? '').trim()
        return yield* new OutsideFailed({
          system: 'files',
          message: `another writer holds ${ONBOARDING_LOCK} (${holder || 'no pid'})`,
          next: 'run the command again; a lock older than 30 seconds goes by itself',
        })
      }
      yield* Effect.sleep(RETRY_MS)
    }
  })

// Only the writer that holds the lock removes it: a lock that another writer broke as stale and
// took is that writer's now.
const releaseLock = (dir: string, mine: string) =>
  Effect.sync(() => {
    const path = join(dir, ONBOARDING_LOCK)
    if (readText(path) === mine) rmSync(path, { force: true })
  })

// The lock until the scope closes.
const locked = (dir: string) =>
  Effect.acquireRelease(takeLock(dir), (mine) => releaseLock(dir, mine))

// A temp file of this process, renamed onto the file.
const writeWhole = (path: string, text: string) =>
  io(() => {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.tmp`
    writeFileSync(tmp, text)
    renameSync(tmp, path)
  })
const yamlOf = (value: unknown): string => Bun.YAML.stringify(value, null, 2)

// A file of onboarding that does not decode was edited by hand.
const decodeIn = <S extends Schema.Top>(schema: S, path: string, text: string) =>
  refusing(() => {
    const raw = parseYaml(text)
    try {
      return Schema.decodeUnknownSync(schema as never)(raw) as S['Type']
    } catch (e) {
      throw new Refused({
        message: `${path} does not read: ${e instanceof Error ? e.message : String(e)}`,
        next: 'an onboarding file is written only by work onboard; write it again with it',
      })
    }
  })

// --- the files ---------------------------------------------------------------------------------------

const directionPath = (dir: string, id: string) => join(dir, ASSESS, `${id}.yaml`)

const readDirectionAt = (dir: string, id: string) =>
  Effect.gen(function* () {
    const path = directionPath(dir, id)
    const text = readText(path)
    return text === null ? undefined : yield* decodeIn(OnboardingDirection, path, text)
  })
const writeDirection = (dir: string, file: OnboardingDirection) =>
  writeWhole(directionPath(dir, file.id), yamlOf(Schema.encodeSync(OnboardingDirection)(file)))

// Every direction file, by its id.
const readDirections = (dir: string) =>
  Effect.gen(function* () {
    const folder = join(dir, ASSESS)
    const names = existsSync(folder) ? readdirSync(folder) : []
    const ids = names
      .filter((n) => n.endsWith('.yaml') && n !== basename(ROLES))
      .map((n) => n.slice(0, -'.yaml'.length))
      .sort()
    const files: Array<OnboardingDirection> = []
    for (const id of ids) {
      const file = yield* readDirectionAt(dir, id)
      if (file !== undefined) files.push(file)
    }
    return files
  })

const RoleStates = Schema.Record(Schema.String, OnboardingRoleState)
type RoleStates = Readonly<Record<string, OnboardingRoleState>>
const readRoleStates = (dir: string) =>
  Effect.gen(function* () {
    const path = join(dir, ROLES)
    const text = readText(path)
    return text === null ? {} : yield* decodeIn(RoleStates, path, text)
  })
const writeRoleStates = (dir: string, states: RoleStates) =>
  writeWhole(join(dir, ROLES), yamlOf(Schema.encodeSync(RoleStates)(states)))

// The config draft, and how the store start would read it: merged into the settings of
// aristoteles.yaml (mergeDraft), as work config check reads it.
interface Draft {
  readonly raw: Raw
  readonly read: ConfigRead
}
const draftOf = (dir: string, text: string): Effect.Effect<Draft, Refused> =>
  refusing(() => ({ raw: parseYaml(text), merged: mergeDraft(readText(join(dir, CONFIG)) ?? '', text) })).pipe(
    Effect.flatMap(({ raw, merged }) =>
      Effect.map(configOfText(dir, merged), (read) => ({ raw, read })),
    ),
    Effect.mapError((e) => new Refused({ message: `${DRAFT}: ${e.message}`, next: e.next })),
  )
const readDraft = (dir: string): Effect.Effect<Draft | undefined, Refused> => {
  const text = readText(join(dir, DRAFT))
  return text === null ? Effect.succeed(undefined) : draftOf(dir, text)
}
const needDraft = (dir: string) =>
  Effect.flatMap(readDraft(dir), (draft) =>
    draft === undefined
      ? Effect.fail(
          refuse(
            `there is no ${DRAFT} yet: its people and roles come first`,
            'the host writes the config draft: work onboard config --file=<draft.yaml>',
          ),
        )
      : Effect.succeed(draft),
  )
// A new draft text is written only when it reads.
const writeDraft = (dir: string, raw: Raw) =>
  Effect.gen(function* () {
    const text = yamlOf(raw)
    yield* draftOf(dir, text)
    yield* writeWhole(join(dir, DRAFT), text)
  })

// --- what the page and work onboard status read ----------------------------------------------------

export interface OnboardingFiles {
  // The people of the config draft; null: the host has written no config draft yet.
  readonly people: ReadonlyArray<string> | null
  readonly directions: ReadonlyArray<OnboardingDirection>
  // The roles of the config draft in its order, each joined with its entry of roles.yaml.
  readonly roles: ReadonlyArray<OnboardingRole>
}

export const readOnboarding = (dir: string): Effect.Effect<OnboardingFiles, Refused> =>
  Effect.gen(function* () {
    const directions = yield* readDirections(dir)
    const draft = yield* readDraft(dir)
    const states = yield* readRoleStates(dir)
    const roles: Array<OnboardingRole> = []
    for (const [role, file] of Object.entries(draft?.read.config.roles ?? {})) {
      const state = states[role]
      if (state === undefined) {
        return yield* refuse(
          `${ROLES} has no entry for the role ${role} of ${DRAFT}`,
          `the host writes the role again: work onboard role ${role} --file=<role.yaml>`,
        )
      }
      roles.push({ ...state, role: role as RoleName, file })
    }
    return { people: draft?.read.config.people ?? null, directions, roles }
  })

// work init refuses while onboarding files exist: one dir has one way to start.
export const onboardingExists = (dir: string): Effect.Effect<boolean> =>
  Effect.sync(() => existsSync(join(dir, ASSESS)) || existsSync(join(dir, DRAFT)))

// --- the acts of the host ---------------------------------------------------------------------------

// The card words of a role: its summary, and where the project has it (those come first).
export interface RoleNotes {
  readonly summary: string
  readonly found: OnboardingRoleState['found']
}
// A drafted direction, as the CLI reads the host's file (id: the real id of a New direction).
export interface DirectionDraft {
  readonly id: DirectionId
  readonly name: string
  readonly from: ReadonlyArray<Principle>
  readonly says: string
  readonly standards: ReadonlyArray<StandardFile>
  readonly cases: Cases
}
export interface QuestionDraft {
  readonly says: NonBlank
  readonly case: Case
  readonly options: readonly [string, string]
}
// The CLI checks each file that the host names (its keys, real cases) before the act.
export type HostAct =
  | {
      readonly _tag: 'Config'
      readonly config: Readonly<Record<string, unknown>>
      readonly notes: Readonly<Record<string, RoleNotes>>
    }
  | {
      readonly _tag: 'Role'
      readonly role: RoleName
      readonly file: Readonly<Record<string, unknown>>
      readonly notes: RoleNotes
    }
  | { readonly _tag: 'Found'; readonly direction: DirectionId }
  | {
      readonly _tag: 'Company'
      readonly direction: DirectionId
      readonly repo: string
      readonly path: string
    }
  | { readonly _tag: 'Draft'; readonly direction: DirectionId; readonly draft: DirectionDraft }
  | {
      readonly _tag: 'Ask'
      readonly direction: DirectionId
      readonly questions: ReadonlyArray<QuestionDraft>
    }

const needDirection = (dir: string, id: string) =>
  Effect.flatMap(readDirectionAt(dir, id), (file) =>
    file === undefined
      ? Effect.fail(refuse(`there is no direction ${id} in ${ASSESS}`, 'work onboard status lists them'))
      : Effect.succeed(file),
  )
const notAccepted = (file: OnboardingDirection) =>
  file.accepted._tag === 'Accepted'
    ? Effect.fail(
        refuse(
          `${file.id} is accepted; the person accepted this draft`,
          `ask the person to revise it first: work onboard revise ${file.id} --words=<what to change>`,
        ),
      )
    : Effect.void
const newFile = (
  dir: string,
  id: DirectionId,
  asked: OnboardingDirection['asked'],
): Effect.Effect<ReadonlyArray<DirectionId>, Refused | OutsideFailed> =>
  Effect.gen(function* () {
    if (existsSync(directionPath(dir, id))) {
      return yield* refuse(`a direction ${id} exists already`, 'give the direction another id')
    }
    const file: OnboardingDirection = {
      id,
      asked,
      draft: { _tag: 'Drafting' },
      questions: [],
      request: NONE,
      accepted: WAITING,
    }
    yield* writeDirection(dir, file)
    return [id]
  })

const missingNotes = (roles: ReadonlyArray<string>, notes: Readonly<Record<string, RoleNotes>>) =>
  roles.find((role) => notes[role] === undefined)

// Each act returns the directions that it made, renamed or accepted (none for a role).
export const hostAct = (
  dir: string,
  act: HostAct,
): Effect.Effect<ReadonlyArray<DirectionId>, Refused | OutsideFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* locked(dir)
      switch (act._tag) {
        case 'Config': {
          const states = yield* readRoleStates(dir)
          const kept = Object.entries(states).find(([, s]) => s.accepted._tag === 'Accepted')
          if (kept !== undefined) {
            return yield* refuse(
              `${kept[0]} is accepted, and a new config draft would drop the accept`,
              'change one role at a time: work onboard role <role> --file=<role.yaml>',
            )
          }
          const text = yamlOf(act.config)
          const { read } = yield* draftOf(dir, text)
          const roles = Object.keys(read.config.roles)
          const bare = missingNotes(roles, act.notes)
          if (bare !== undefined) {
            return yield* refuse(
              `the role ${bare} has no summary: the one line of its card`,
              'write a summary for each role in the config draft',
            )
          }
          yield* writeWhole(join(dir, DRAFT), text)
          const entries = roles.map((r) => [r, { ...act.notes[r], request: NONE, accepted: WAITING }])
          yield* writeRoleStates(dir, Object.fromEntries(entries))
          return []
        }
        case 'Role': {
          const draft = yield* needDraft(dir)
          const states = yield* readRoleStates(dir)
          if (states[act.role]?.accepted._tag === 'Accepted') {
            return yield* refuse(
              `${act.role} is accepted; the person accepted this role`,
              `ask the person to revise it first: work onboard revise-role ${act.role} --words=<what to change>`,
            )
          }
          yield* writeDraft(dir, { ...draft.raw, roles: { ...draft.raw.roles, [act.role]: act.file } })
          const state: OnboardingRoleState = { ...act.notes, request: NONE, accepted: WAITING }
          yield* writeRoleStates(dir, { ...states, [act.role]: state })
          return []
        }
        case 'Found':
          return yield* newFile(dir, act.direction, { _tag: 'Found' })
        case 'Company':
          return yield* newFile(dir, act.direction, {
            _tag: 'Company',
            repo: act.repo,
            path: act.path,
          })
        case 'Draft':
          return yield* writeDrafted(dir, act.direction, act.draft)
        case 'Ask': {
          const file = yield* needDirection(dir, act.direction)
          yield* notAccepted(file)
          if (file.draft._tag === 'Drafting') {
            return yield* refuse(
              `${file.id} has no draft yet; a question is about a draft`,
              `draft it first: work onboard draft ${file.id} --file=<direction.yaml>`,
            )
          }
          if (act.questions.length === 0) return yield* refuse('ask names one question or more', 'write the questions in the file')
          const open = { _tag: 'Open' } as const
          const questions = act.questions.map((q) => ({ ...q, answer: open }))
          // The questions answer a Revise too: the request is done.
          yield* writeDirection(dir, { ...file, questions, request: NONE })
          return [file.id]
        }
      }
    }),
  )

// A draft of the host: the rules are checked by roles of the config draft; a New direction takes
// the id of its first draft (the file is renamed in the same locked step); the request and the
// answered questions are done.
const writeDrafted = (dir: string, id: DirectionId, draft: DirectionDraft) =>
  Effect.gen(function* () {
    const file = yield* needDirection(dir, id)
    yield* notAccepted(file)
    const { read } = yield* needDraft(dir)
    for (const rule of draft.standards.flatMap((s) => s.rules)) {
      const problem = checkerProblem(read.config.roles, rule.id, rule.checkedBy)
      if (problem !== null) {
        return yield* refuse(problem, `name a role of ${DRAFT} that checks it, in checkedBy`)
      }
    }
    const renames = file.asked._tag === 'New' && file.draft._tag === 'Drafting'
    if (draft.id !== file.id && !renames) {
      return yield* refuse(
        `${file.id} keeps its id; the draft names ${draft.id}`,
        `write id: ${file.id} in the draft, or leave the id out`,
      )
    }
    if (draft.id !== file.id && existsSync(directionPath(dir, draft.id))) {
      return yield* refuse(`a direction ${draft.id} exists already`, 'give the new direction another id')
    }
    const next: OnboardingDirection = {
      ...file,
      id: draft.id,
      draft: {
        _tag: 'Drafted',
        name: draft.name,
        from: draft.from,
        content: { says: draft.says, standards: draft.standards },
        cases: draft.cases,
      },
      questions: file.questions.filter((q) => q.answer._tag === 'Open'),
      request: NONE,
    }
    // The new words go into the old file first, then the file takes its new name: a reader sees
    // one file of the direction at each moment.
    yield* writeWhole(directionPath(dir, file.id), yamlOf(Schema.encodeSync(OnboardingDirection)(next)))
    if (draft.id !== file.id) {
      yield* io(() => renameSync(directionPath(dir, file.id), directionPath(dir, draft.id)))
    }
    return [draft.id]
  })

// --- the acts of the person -------------------------------------------------------------------------

// The acts of the two pages, but the store start: prepareStart does that.
export type PersonAct = Exclude<OnboardingAct, { readonly act: 'approve-all-roles' }>

// Why the person cannot accept a direction now; undefined: it is Ready. The cases are the states
// of core/derived onboardingStateOf, each with its reason.
const notReady = (file: OnboardingDirection): string | undefined => {
  if (file.accepted._tag === 'Accepted') return `${file.id} is accepted already`
  if (file.draft._tag === 'Drafting') return `${file.id} has no draft yet; the host drafts it`
  if (file.request._tag === 'Revise') return `a Revise of ${file.id} waits for the host`
  if (file.questions.some((q) => q.answer._tag === 'Open')) {
    return `${file.id} has questions for you; answer them first`
  }
  if (file.questions.length > 0) return `the answers of ${file.id} wait for the host's next draft`
  return undefined
}

// The id of a direction that the person adds: new-<n> until its first draft names it.
const newId = (dir: string): DirectionId => {
  let n = 1
  while (existsSync(directionPath(dir, `new-${n}`))) n++
  return DirectionId.make(`new-${n}`)
}
// A company direction is named by its folder, as aristoteles.lock names it.
const folderId = (path: string): string =>
  basename(path)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')

const roleIn = (draft: Draft, role: string) =>
  Object.hasOwn(draft.read.config.roles, role)
    ? Effect.succeed(draft.read.config.roles[role] as RoleFile)
    : Effect.fail(refuse(`there is no role ${role} in ${DRAFT}`, 'work onboard status lists the roles'))

export const personAct = (
  dir: string,
  person: string,
  act: PersonAct,
): Effect.Effect<ReadonlyArray<DirectionId>, Refused | OutsideFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* locked(dir)
      const draft = yield* readDraft(dir)
      // The person must be one of the people of the draft, once the host has written it.
      if (draft !== undefined && !draft.read.config.people.includes(person)) {
        return yield* refuse(
          `${person} (git user.name) is not in the people of ${DRAFT}`,
          `the host adds ${person || 'you'} to the people: work onboard config --file=<draft.yaml>`,
        )
      }
      switch (act.act) {
        case 'add-direction':
          return yield* newFile(dir, newId(dir), {
            _tag: 'New',
            principle: act.principle,
            example: act.example ?? null,
          })
        case 'add-company-direction': {
          const id = folderId(act.path)
          if (id === '') return yield* refuse(`${act.path} names no folder`, 'name the folder of the direction in its repo')
          return yield* newFile(dir, DirectionId.make(id), {
            _tag: 'Company',
            repo: act.repo,
            path: act.path,
          })
        }
        case 'answer': {
          const file = yield* needDirection(dir, act.direction)
          const open = file.questions.filter((q) => q.answer._tag === 'Open')
          if (open.length === 0) return yield* refuse(`${file.id} has no open question`, 'work onboard status shows what waits')
          if (act.options.length !== open.length) {
            return yield* refuse(
              `${file.id} has ${open.length} open questions, and ${act.options.length} options were given`,
              `give one option for each question, in order: --options=${open.map(() => 'A').join(',')}`,
            )
          }
          let next = 0
          const questions = file.questions.map((q) => {
            if (q.answer._tag !== 'Open') return q
            const option = act.options[next++] as 'A' | 'B'
            return { ...q, answer: { _tag: 'Chosen' as const, option } }
          })
          yield* writeDirection(dir, { ...file, questions })
          return []
        }
        case 'accept': {
          const file = yield* needDirection(dir, act.direction)
          const problem = notReady(file)
          if (problem !== undefined) return yield* refuse(problem, 'work onboard status shows what waits')
          yield* writeDirection(dir, { ...file, accepted: ACCEPTED })
          return [file.id]
        }
        case 'revise': {
          const file = yield* needDirection(dir, act.direction)
          if (file.draft._tag === 'Drafting') {
            return yield* refuse(`${file.id} has no draft yet; the host drafts it`, 'work onboard status shows what waits')
          }
          const request = { _tag: 'Revise' as const, words: act.words }
          yield* writeDirection(dir, { ...file, request, accepted: WAITING })
          return []
        }
        case 'remove': {
          const file = yield* needDirection(dir, act.direction)
          yield* io(() => rmSync(directionPath(dir, file.id)))
          return []
        }
        case 'approve-all-directions': {
          const ready = (yield* readDirections(dir)).filter((f) => notReady(f) === undefined)
          if (ready.length === 0) {
            return yield* refuse('no direction is ready; approve all accepts each ready one', 'work onboard status shows what waits')
          }
          for (const file of ready) yield* writeDirection(dir, { ...file, accepted: ACCEPTED })
          return ready.map((f) => f.id)
        }
        case 'accept-role':
        case 'revise-role': {
          const known = yield* needDraft(dir)
          yield* roleIn(known, act.role)
          const states = yield* readRoleStates(dir)
          const state = states[act.role]
          if (state === undefined) {
            return yield* refuse(
              `${ROLES} has no entry for ${act.role}`,
              `the host writes the role again: work onboard role ${act.role} --file=<role.yaml>`,
            )
          }
          if (act.act === 'accept-role' && state.request._tag === 'Revise') {
            return yield* refuse(`a Revise of ${act.role} waits for the host`, 'work onboard status shows what waits')
          }
          const next: OnboardingRoleState =
            'words' in act
              ? { ...state, request: { _tag: 'Revise', words: act.words }, accepted: WAITING }
              : { ...state, accepted: ACCEPTED }
          yield* writeRoleStates(dir, { ...states, [act.role]: next })
          return []
        }
        case 'remove-role': {
          const known = yield* needDraft(dir)
          yield* roleIn(known, act.role)
          const { [act.role]: _gone, ...roles } = known.raw.roles
          yield* writeDraft(dir, { ...known.raw, roles })
          const { [act.role]: _state, ...states } = yield* readRoleStates(dir)
          yield* writeRoleStates(dir, states)
          return []
        }
        case 'persistence': {
          const known = yield* needDraft(dir)
          const role = yield* roleIn(known, act.role)
          if (role.kind === 'program') {
            return yield* refuse(
              `${act.role} is a program; it runs in the CLI and has no persistence`,
              'toggle the persistence of an agent role',
            )
          }
          // Ruling 15: the role of the top task is the persistent high role that the host plays;
          // while it is the only one, its card has no toggle.
          const leads = Object.entries(known.read.config.roles).filter(
            ([, r]) => r.kind === 'agent' && r.tier === 'high' && r.persistence.persistent,
          )
          if (leads.length === 1 && leads[0]?.[0] === act.role) {
            return yield* refuse(
              `${act.role} is the role of the top task (the only persistent high role), so it has ` +
                'no toggle: the host plays it, and the host is a terminal (ruling 15)',
              `keep ${act.role} persistent`,
            )
          }
          const persistence = { persistent: act.persistent, why: `${person} chose it on the agents page.` }
          const raw = known.raw.roles[act.role]
          yield* writeDraft(dir, {
            ...known.raw,
            roles: { ...known.raw.roles, [act.role]: { ...raw, persistence } },
          })
          return []
        }
      }
    }),
  )

// --- the store start (BUILD.md 1c) ----------------------------------------------------------------

export interface Start {
  // The accepted directions, each with its cases and where it comes from.
  readonly directions: ReadonlyArray<OnboardedDirection>
  // The store is refused: aristoteles.yaml and aristoteles.lock as they were; the files stay.
  readonly restore: Effect.Effect<void, OutsideFailed>
  // The store holds the start: the onboarding files go.
  readonly finish: Effect.Effect<void, OutsideFailed>
}

// The folder of a company says what its draft says: the words, each standard and rule by id and
// words, in the same order (the checkers are the draft's own).
const sameAsDrafted = (
  drafted: Extract<OnboardingDirection['draft'], { readonly _tag: 'Drafted' }>,
  folder: CompanyFolder,
): boolean =>
  drafted.content.says === folder.says &&
  drafted.content.standards.length === folder.standards.length &&
  folder.standards.every((x, i) => {
    const s = drafted.content.standards[i]
    return (
      s?.id === x.id &&
      s.says === x.says &&
      s.rules.length === x.rules.length &&
      x.rules.every((r, j) => s.rules[j]?.id === r.id && s.rules[j]?.says === r.says)
    )
  })

// Takes the lock until the scope closes, and refuses while a direction or a role is not accepted.
// It writes aristoteles.yaml from the config draft, and the aristoteles.lock entry of each company
// direction at the commit of its folder now; the caller stores the start (DefineWorkflow, as the
// person) and then runs finish, or restore when the store refuses it. Each direction is owned by
// the person who starts the store: an onboarding draft names no owner.
export const prepareStart = (
  dir: string,
  person: string,
  env: Readonly<Record<string, string | undefined>>,
): Effect.Effect<Start, Refused | OutsideFailed, Files | Spawn | Scope.Scope> =>
  Effect.gen(function* () {
    yield* locked(dir)
    const files = yield* readDirections(dir)
    const waiting = files.find((f) => f.accepted._tag !== 'Accepted')
    if (waiting !== undefined) {
      return yield* refuse(
        `${waiting.id} is not accepted yet`,
        `accept it or remove it (work onboard accept|remove ${waiting.id}), then approve again`,
      )
    }
    const draft = yield* needDraft(dir)
    const states = yield* readRoleStates(dir)
    const role = Object.keys(draft.read.config.roles).find(
      (r) => states[r]?.accepted._tag !== 'Accepted',
    )
    if (role !== undefined) {
      return yield* refuse(
        `the role ${role} is not accepted yet`,
        `accept it or remove it (work onboard accept-role|remove-role ${role}), then approve again`,
      )
    }
    const lock: Record<string, LockEntry> = { ...((yield* readLock(dir)) ?? {}) }
    const directions: Array<OnboardedDirection> = []
    for (const file of files) {
      if (file.draft._tag !== 'Drafted') return yield* Effect.die(`${file.id} is accepted with no draft`)
      const drafted = file.draft
      let source: OnboardedDirection['source'] = { _tag: 'Local' }
      if (file.asked._tag === 'Company') {
        const { repo, path } = file.asked
        const { commit, folder } = yield* fetchFolder(env, { repo, path, owner: person })
        if (!sameAsDrafted(drafted, folder)) {
          return yield* refuse(
            `the company folder of ${file.id} changed since its draft`,
            `revise it, so that the host drafts it again: work onboard revise ${file.id} --words="the folder changed"`,
          )
        }
        source = { _tag: 'External', repo, path, ref: { _tag: 'DefaultBranch' }, commit }
        const rules = Object.fromEntries(
          drafted.content.standards.flatMap((s) =>
            s.rules.flatMap((r) => (r.checkedBy === undefined ? [] : [[r.id, r.checkedBy]])),
          ),
        )
        lock[file.id] = {
          repo,
          path,
          owner: person,
          ...(Object.keys(rules).length ? { rules } : {}),
          commit,
        }
      }
      directions.push({
        direction: {
          id: file.id,
          name: drafted.name,
          owner: person,
          from: drafted.from,
          says: drafted.content.says,
          standards: drafted.content.standards,
        },
        cases: drafted.cases,
        source,
      })
    }
    const configPath = join(dir, CONFIG)
    const lockPath = join(dir, LOCK)
    const oldConfig = readText(configPath)
    const oldLock = readText(lockPath)
    const writeBack = (path: string, text: string | null) =>
      text === null ? io(() => rmSync(path, { force: true })) : writeWhole(path, text)
    const merged = draft.read.texts[CONFIG]
    if (merged === undefined) return yield* Effect.die('a read config has its text')
    yield* writeWhole(configPath, merged)
    if (Object.keys(lock).length > 0) {
      yield* writeLock(dir, lock).pipe(
        Effect.tapError(() => writeBack(configPath, oldConfig)),
      )
    }
    return {
      directions,
      restore: Effect.all([writeBack(configPath, oldConfig), writeBack(lockPath, oldLock)]).pipe(
        Effect.asVoid,
      ),
      finish: io(() => {
        rmSync(join(dir, ASSESS), { recursive: true, force: true })
        rmSync(join(dir, DRAFT), { force: true })
      }),
    }
  })
