// Onboarding works on files before any store exists (ruling 1, BUILD.md 1b). This module is the
// only writer of the three files of onboarding; the CLI (work onboard) and the page call it, and
// the host passes its own drafts through the CLI with --file. Every write takes the lock, reads
// the files, applies one act, checks the result, writes a temp file and renames it onto the file.
// A reader reads with no lock: a rename always gives it a whole file.
//   .work/assess/<id>.yaml   one direction (OnboardingDirection)
//   .work/assess/roles.yaml  the onboarding state of each role (P4)
//   aristoteles.draft.yaml   the config draft only: people, roles, decide, models
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
import { randomUUID } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { Effect, Schema, type Scope } from 'effect'
import { type ConfigRead, configOfText, draftConfigOfText } from '../config/config.ts'
import { CONFIG, DRAFT, parseYaml, type Raw, refusing, sha } from '../config/core.ts'
import { mergeDraft } from '../config/settings.ts'
import { STAFFING, type Staffing, staffingOf, staffingOfText } from '../config/staffing.ts'
import { staffingPreview, staffingView } from '../config/staffing-view.ts'
import type { Principle } from '../domain/closed.ts'
import { OutsideFailed, Refused, refuse } from '../domain/errors.ts'
import type { OnboardedDirection } from '../domain/events.ts'
import {
  type CompanyFolder,
  type ConfigFile,
  checkerProblem,
  type FlowStep,
  type RoleFile,
  type StandardFile,
} from '../domain/files.ts'
import { DirectionId, NonBlank, type RoleName } from '../domain/ids.ts'
import {
  type AiQuestion,
  Discovery,
  companyDirectionAt,
  deviationCases,
  type OnboardingAct,
  answersIn,
  Asked,
  type DraftOfFile,
  draftIn,
  OnboardingDirection,
  type OnboardingRole,
  OnboardingRoleState,
  type RoleReview,
  onlyLead,
  resetWords,
  touchedRoles,
} from '../domain/onboarding.ts'
import type { Files, Spawn } from '../services/outside.ts'
import { fetchFolder, LOCK, type LockEntry, readLock } from './company.ts'

export const ASSESS = join('.work', 'assess')
const DISCOVERY = join(ASSESS, 'discovery.report')
const ROLES = join(ASSESS, 'roles.yaml')
export const ONBOARDING_LOCK = join('.work', 'onboarding.lock')
// A writer tries again every 50 ms for up to 5 s; a lock older than 30 s is a dead writer's.
const RETRY_MS = 50
const WAIT_MS = 5000
const STALE_MS = 30000

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
// The confirmation refers to the exact file reviewed by the person.
const staffingConfirmation = '.work/staffing-confirmed.json'
const staffingText = (dir: string) => readText(join(dir, STAFFING))
const confirmationOf = (person: string, revision: string) => JSON.stringify({ person, revision })

export const staffingConfirmed = (dir: string, person: string) => io(() => {
  const text = staffingText(dir)
  return text !== null && readText(join(dir, staffingConfirmation)) === confirmationOf(person, sha(text))
})
export const readStaffingReview = (dir: string, person: string) => Effect.gen(function* () {
  const text = staffingText(dir)
  const staffing = yield* refusing(() => staffingOfText(text))
  if (text === null || staffing === null) return null
  const revision = sha(text)
  return {
    revision,
    clis: Object.keys(staffing.clis).sort(),
    confirmed: readText(join(dir, staffingConfirmation)) === confirmationOf(person, revision),
    view: staffingView(staffing),
  }
})

export type StaffingEdit =
  | { readonly kind: 'limit'; readonly account: string; readonly limit: string; readonly typed: string }
  | { readonly kind: 'role'; readonly role: string; readonly account: string; readonly cli: string
      readonly model: string; readonly persistent: boolean; readonly concurrency: number; readonly subagentAllowance: number }

const editedStaffing = (before: Staffing, edit: StaffingEdit | undefined): unknown => {
  if (edit === undefined) return before
  if (edit.kind === 'limit') {
    const { account, limit, typed } = edit
    if (!Object.hasOwn(before.accounts, account) || !Object.hasOwn(before.accounts[account]!.limits, limit)) {
      throw refuse('This staffing limit no longer exists.')
    }
    return { ...before, accounts: { ...before.accounts,
      [account]: { limits: { ...before.accounts[account]!.limits, [limit]: typed } },
    } }
  }
  const { role, kind: _kind, ...values } = edit
  if (!Object.hasOwn(before.roles, role)) throw refuse('This staffing role no longer exists.')
  return { ...before, roles: { ...before.roles, [role]: { ...before.roles[role], ...values } } }
}

export const previewStaffingReview = (dir: string, revision: string, edit?: StaffingEdit) =>
  Effect.gen(function* () {
    const text = staffingText(dir)
    if (text === null || sha(text) !== revision) return yield* refuse('Staffing changed. Reload it and preview again.')
    const before = yield* refusing(() => staffingOfText(text)!)
    const after = yield* refusing(() => staffingOf(editedStaffing(before, edit)))
    return { preview: staffingPreview(before, after), after }
  })

export const applyStaffingReview = (dir: string, person: string, revision: string, candidate: Staffing) =>
  Effect.gen(function* () {
    const text = staffingText(dir)
    if (text === null || sha(text) !== revision) return yield* refuse('Staffing changed. Reload it and preview again.')
    const staffing = yield* refusing(() => staffingOf(candidate))
    const before = yield* refusing(() => staffingOfText(text))
    const next = Bun.deepEquals(before, staffing) ? text : yamlOf(staffing)
    if (next !== text) yield* writeWhole(join(dir, STAFFING), next)
    yield* writeWhole(join(dir, staffingConfirmation), confirmationOf(person, sha(next)))
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

// A direction file in an older shape is not read (Nanda, 2026-11-15: the new shape is the only
// one): it counts as a direction that the host drafts again, by the id of its file, from where it
// came when that still reads, and with no accept.
const resetOf = (id: string, raw: unknown): OnboardingDirection => {
  const asked = Schema.decodeUnknownOption(Asked)((raw as { asked?: unknown } | null)?.asked)
  return {
    id: DirectionId.make(id),
    asked: asked._tag === 'Some' ? asked.value : { _tag: 'Found' },
    stage: { _tag: 'Reset' },
  }
}
const readDirectionAt = (dir: string, id: string) =>
  Effect.gen(function* () {
    const text = readText(directionPath(dir, id))
    if (text === null) return undefined
    const raw = yield* refusing(() => parseYaml(text))
    const read = Schema.decodeUnknownOption(OnboardingDirection)(raw)
    return read._tag === 'Some' ? read.value : resetOf(id, raw)
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
  readonly staffingProblem?: string
}
const draftOf = (dir: string, text: string): Effect.Effect<Draft, Refused> =>
  refusing(() => ({
    raw: parseYaml(text),
    merged: mergeDraft(readText(join(dir, CONFIG)) ?? '', text),
  })).pipe(
    Effect.flatMap(({ raw, merged }) =>
      Effect.gen(function* () {
        const read = yield* draftConfigOfText(dir, merged)
        const joined = yield* Effect.result(Effect.gen(function* () {
          const staffing = yield* refusing(() => staffingOfText(readText(join(dir, STAFFING))))
          if (staffing === null) return yield* refuse(`add the staffing bindings in ${STAFFING}`)
          return yield* configOfText(dir, merged, staffing)
        }))
        return joined._tag === 'Success' ? { raw, read: joined.success }
          : { raw, read, staffingProblem: joined.failure.message }
      }),
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
    const draft = yield* draftOf(dir, text)
    yield* writeWhole(join(dir, DRAFT), text)
    return draft
  })

// --- what the page and work onboard status read ----------------------------------------------------

export interface OnboardingFiles {
  readonly roleRequests?: ReadonlyArray<{ readonly role: string; readonly words: NonBlank }>
  // The config draft as the store start reads it; null: the host has written none yet.
  readonly config: ConfigFile | null
  readonly responsibilityOnly?: true
  readonly staffingProblem?: string
  readonly directions: ReadonlyArray<OnboardingDirection>
  readonly discovery?: Discovery
  // The roles of the config draft in its order, each joined with its entry of roles.yaml.
  readonly roles: ReadonlyArray<OnboardingRole>
}

const readDiscovery = (dir: string) => Effect.gen(function* () {
  const path = join(dir, DISCOVERY)
  const text = readText(path)
  return text === null ? undefined : yield* decodeIn(Discovery, path, text)
})

export const readOnboarding = (dir: string): Effect.Effect<OnboardingFiles, Refused> =>
  Effect.gen(function* () {
    const directions = yield* readDirections(dir)
    const discovery = yield* readDiscovery(dir)
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
    const configured = draft?.read.config.roles ?? {}
    const roleRequests = Object.entries(states).flatMap(([role, { decision }]) =>
      role.startsWith('requested-role-') && !(role in configured) && decision._tag === 'Revising' ? [{ role, words: decision.words }] : [])
    return { config: draft?.read.config ?? null, directions, roles, roleRequests,
      ...(discovery === undefined ? {} : { discovery }),
      ...(draft !== undefined ? { responsibilityOnly: true } : {}),
      ...(draft?.staffingProblem === undefined ? {} : { staffingProblem: draft.staffingProblem }) }
  })

// An accepted direction as the store holds it. The person who starts the store owns it: an
// onboarding draft names no owner.
export const onboardedOf = (
  id: DirectionId,
  draft: DraftOfFile,
  owner: string,
  source: OnboardedDirection['source'],
): OnboardedDirection => ({
  direction: {
    id,
    name: draft.name,
    owner,
    from: draft.from,
    summary: draft.content.summary,
    flow: draft.content.flow,
    says: draft.content.says,
    standards: draft.content.standards,
  },
  source,
})

// work init refuses while onboarding files exist: one dir has one way to start.
export const onboardingExists = (dir: string): Effect.Effect<boolean> =>
  Effect.sync(() => existsSync(join(dir, ASSESS)) || existsSync(join(dir, DRAFT)))

// --- the acts of the host ---------------------------------------------------------------------------

// The card words of a role: its summary, and where the project has it (those come first).
export type RoleNotes = typeof RoleReview.Type & {
  readonly summary: string
  readonly found: OnboardingRoleState['found']
}
// A drafted direction, as the CLI reads the host's file (id: the real id of a New direction).
// summary: the host's, or for a company direction the first sentence of its folder's words.
export interface DirectionDraft {
  readonly id: DirectionId
  readonly name: string
  readonly from: ReadonlyArray<Principle>
  readonly summary: NonBlank
  readonly flow: ReadonlyArray<FlowStep>
  readonly says: string
  readonly standards: ReadonlyArray<StandardFile>
  readonly discovery?: Discovery
}
export type QuestionDraft = AiQuestion

export const directionRevision = (draft: DraftOfFile, discovery?: Discovery): string =>
  sha(JSON.stringify([draft, discovery]))

export const directionReview = (files: ReadonlyArray<OnboardingDirection>, discovery?: Discovery) =>
  files.flatMap(({ id, stage }) => stage._tag === 'Ready'
    ? [{ id, revision: directionRevision(stage.draft, discovery) }] : [])

// The CLI checks each file that the host names (its keys, real examples) before the act.
// A Draft with reopen: the store start names this accepted direction, so the host drafts it again,
// and the person decides it again.
export type HostAct =
  | { readonly _tag: 'Discovery'; readonly discovery: Discovery }
  | { readonly _tag: 'RemoveRevised'; readonly direction: DirectionId }
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
  | {
      readonly _tag: 'Draft'
      readonly direction: DirectionId
      readonly draft: DirectionDraft
      readonly reopen: boolean
      readonly revision?: string
      readonly questions?: readonly [AiQuestion, ...AiQuestion[]]
      readonly adoptCompany?: true
    }
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
const notAccepted = (file: OnboardingDirection, reopen: boolean) =>
  file.stage._tag === 'Accepted' && !reopen
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
    yield* writeDirection(dir, { id, asked, stage: { _tag: 'Drafting' } })
    return [id]
  })

const missingNotes = (roles: ReadonlyArray<string>, notes: Readonly<Record<string, RoleNotes>>) =>
  roles.find((role) => notes[role] === undefined)
// The role states after a host's edit of the config draft (O2: it never freezes). A role whose
// card the edit changed (touchedRoles) or whose card words changed waits for the person again;
// the others keep the person's decision.
const statesAfter = (
  before: Raw | undefined,
  after: Draft,
  states: RoleStates,
  notes: Readonly<Record<string, RoleNotes>>,
): RoleStates => {
  const touched = touchedRoles(before, after.raw, after.read.config.roles)
  const entries = Object.keys(after.read.config.roles).flatMap((r): Array<[string, OnboardingRoleState]> => {
    const kept = states[r]
    const words = notes[r] ?? kept
    if (words === undefined) return []
    const same =
      kept !== undefined &&
      !touched.includes(r) &&
      kept.summary === words.summary &&
      Bun.deepEquals(kept.found, words.found) &&
      Bun.deepEquals(kept.principles, words.principles) &&
      Bun.deepEquals(kept.directions, words.directions) &&
      Bun.deepEquals(kept.questions, words.questions)
    return [[r, same ? kept : { ...words, decision: WAITING }]]
  })
  const requests = Object.entries(states).filter(([role, state]) =>
    role.startsWith('requested-role-') && !(role in after.read.config.roles) &&
    state.decision._tag === 'Revising')
  return Object.fromEntries([...entries, ...requests])
}

const reopenCheckerDirections = (dir: string, roles: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (!roles.length) return
    for (const file of yield* readDirections(dir)) {
      if (file.stage._tag !== 'Ready' && file.stage._tag !== 'Accepted') continue
      const draft = file.stage.draft
      const changed = draft.content.standards.flatMap((s) => s.rules)
        .filter((r) => r.checkedBy !== undefined && roles.includes(r.checkedBy))
      if (!changed.length) continue
      const words = NonBlank.make(`Reverify checker responsibility for ${changed.map((r) => r.id).join(', ')}.`)
      yield* writeDirection(dir, { ...file, stage: { _tag: 'Revising', words, checkerChanged: true, draft, answered: [] } })
    }
  })

// Each act returns the directions that it made, renamed or accepted (none for a role).
export const hostAct = (
  dir: string,
  act: HostAct,
): Effect.Effect<ReadonlyArray<DirectionId>, Refused | OutsideFailed> =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* locked(dir)
      switch (act._tag) {
        case 'Discovery':
          yield* io(() => mkdirSync(dirname(join(dir, DISCOVERY)), { recursive: true }))
          yield* writeWhole(join(dir, DISCOVERY), yamlOf(act.discovery))
          return []
        case 'RemoveRevised': {
          const file = yield* needDirection(dir, act.direction)
          if (file.stage._tag !== 'Revising' || file.stage.checkerChanged) {
            return yield* refuse(`${file.id} has no pending revision`, 'revise the direction first')
          }
          yield* writeDirection(dir, { ...file, stage: { _tag: 'Removed' } })
          return [file.id]
        }
        case 'Config': {
          const before = yield* readDraft(dir)
          const states = yield* readRoleStates(dir)
          const text = yamlOf(act.config)
          const after = yield* draftOf(dir, text)
          const bare = missingNotes(Object.keys(after.read.config.roles), act.notes)
          if (bare !== undefined) {
            return yield* refuse(
              `the role ${bare} has no summary: the one line of its card`,
              'write a summary for each role in the config draft',
            )
          }
          yield* writeWhole(join(dir, DRAFT), text)
          yield* writeRoleStates(dir, statesAfter(before?.raw, after, states, act.notes))
          if (before !== undefined) {
            const edited = touchedRoles(before.raw, after.raw, after.read.config.roles)
            const removed = Object.keys(before.raw.roles).filter((r) => !(r in after.raw.roles))
            yield* reopenCheckerDirections(dir, [...edited, ...removed])
          }
          return []
        }
        // The host's role answers a Revise of it, so the role waits for the person again.
        case 'Role': {
          const draft = yield* needDraft(dir)
          const states = yield* readRoleStates(dir)
          const roles = { ...draft.raw.roles, [act.role]: act.file }
          const after = yield* writeDraft(dir, { ...draft.raw, roles })
          const next = statesAfter(draft.raw, after, states, { [act.role]: act.notes })
          yield* writeRoleStates(dir, { ...next, [act.role]: { ...act.notes, decision: WAITING } })
          yield* reopenCheckerDirections(dir, touchedRoles(draft.raw, after.raw, after.read.config.roles))
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
          return yield* writeDrafted(dir, act.direction, act.draft, act.reopen, act.revision, act.questions, act.adoptCompany)
        case 'Ask': {
          const file = yield* needDirection(dir, act.direction)
          yield* notAccepted(file, false)
          if (file.stage._tag === 'Removed' || (file.stage._tag === 'Answered' && file.stage.revision)) {
            return yield* refuse(`${file.id} cannot take a new question now`, 'finish the current revision first')
          }
          const draft = draftIn(file.stage)
          if (draft === undefined && act.questions.some((q) => q.target?._tag !== 'Candidates')) {
            return yield* refuse(
              file.stage._tag === 'Reset'
                ? `${resetWords(file.id)}; a question is about a draft`
                : `${file.id} has no draft yet; a question is about a draft`,
              `draft it first: work onboard draft ${file.id} --file=<direction.yaml>`,
            )
          }
          const [first, ...rest] = act.questions
          if (first === undefined) return yield* refuse('ask names one question or more', 'write the questions in the file')
          const problem = questionProblem(act.questions, draft?.content.standards ?? [])
          if (problem !== undefined) return yield* refuse(problem, 'draft that rule first')
          // The questions answer a Revise too: the request is done.
          yield* writeDirection(dir, { ...file, stage: { _tag: 'Question', ...(draft && { draft }), ...(act.questions.some((q) => q.target !== undefined) && { revision: randomUUID() }), open: [first, ...rest] } })
          return [file.id]
        }
      }
    }),
  )

// A draft of the host: the rules are checked by roles of the config draft; a New direction takes
// the id of its first draft (the file is renamed in the same locked step); the request and the
// answers are done, and open questions stay open.
const questionProblem = (questions: ReadonlyArray<AiQuestion>, standards: ReadonlyArray<StandardFile>) => {
  for (const { target } of questions) {
    if (target?._tag !== 'Deviation') continue
    const rule = standards.flatMap((s) => s.rules).find((r) => r.id === target.rule)
    if (rule === undefined || (rule.test === undefined && rule.ref === undefined)) {
      return `deviation ${target.rule} needs a rule with a command or reference`
    }
  }
}

const writeDrafted = (
  dir: string, id: DirectionId, draft: DirectionDraft, reopen: boolean, revision?: string,
  questions?: readonly [AiQuestion, ...AiQuestion[]], adoptCompany?: true,
) =>
  Effect.gen(function* () {
    const file = yield* needDirection(dir, id)
    yield* notAccepted(file, reopen)
    if (file.stage._tag === 'Removed') return yield* refuse(`${file.id} was removed`, 'add another direction')
    const open = questions ?? (file.stage._tag === 'Question' ? file.stage.open : undefined)
    const problem = questionProblem(open ?? [], draft.standards)
    if (problem !== undefined) return yield* refuse(problem, 'name the check on the conflicting rule')
    const sameSpot = (a: { file: string; line: number; excerpt: string },
      b: { file: string; line: number; excerpt: string }) =>
      a.file === b.file && a.line === b.line && a.excerpt === b.excerpt
    const answered = answersIn(file.stage)
    if (file.stage._tag === 'Answered' && answered.some((q) => q.target !== undefined)) {
      if (revision !== file.stage.revision) {
        return yield* refuse('the answer revision changed', 'read the current answer and draft with --revision')
      }
      const rules = draft.standards.flatMap((s) => s.rules)
      for (const q of answered) {
        const target = q.target
        if (target?._tag === 'Candidates') {
          const selected = q.chosen === 'A' ? [target.a.source]
            : q.chosen === 'B' ? [target.b.source] : [target.a.source, target.b.source]
          if (!selected.some((source) => draft.discovery?.sources.some((s) => sameSpot(s, source)))) {
            return yield* refuse('the revised direction lacks the source of the decision', 'cite its source in discovery')
          }
          if (!rules.some((r) => r.evidence !== undefined)) {
            return yield* refuse('the source decision has no verification evidence', 'rerun verification and record the rule evidence')
          }
          continue
        }
        if (target?._tag !== 'Deviation') continue
        const rule = rules.find((r) => r.id === target.rule)
        const evidence = rule?.evidence
        const words = typeof q.chosen === 'string' ? q.options[q.chosen === 'A' ? 0 : 1] : undefined
        if (rule === undefined || (words !== undefined && rule.says !== words) || evidence === undefined ||
          (evidence.check._tag !== 'Command' && evidence.check._tag !== 'Reference') ||
          (q.chosen === 'B' && !deviationCases(target).every(({ code }) =>
            evidence.knownBreaks.some((spot) => sameSpot(spot, code.source))))) {
          return yield* refuse(`revision of ${target.rule} lacks the chosen words or recheck evidence`,
            'rerun the rule verification and record its result and any known breaks')
        }
      }
    }
    for (const rule of draft.standards.flatMap((s) => s.rules)) {
      const evidence = rule.evidence
      if (evidence === undefined) continue
      const priorBreaks = draftIn(file.stage)?.content.standards.flatMap((s) => s.rules)
        .find((r) => r.id === rule.id)?.evidence?.knownBreaks ?? []
      for (const spot of evidence.knownBreaks) {
        const decided = answered.some(({ target, chosen }) => target?._tag === 'Deviation' &&
          target.rule === rule.id && chosen !== 'A' &&
          deviationCases(target).some(({ code }) => sameSpot(code.source, spot)))
        if (!decided && !priorBreaks.some((known) => sameSpot(known, spot))) {
          return yield* refuse(`${rule.id} has a known break without a decision at ${spot.file}:${spot.line}`,
            'raise its two versions and record the break after the person decides')
        }
      }
      for (const sample of evidence.cases) {
        const spot = sample.output
        if (sample.fit !== 'Breaks' || !('file' in spot)) continue
        const recorded = evidence.knownBreaks.some((k) => sameSpot(k, spot))
        const questioned = open?.some(({ target }) => target?._tag === 'Deviation' &&
          target.rule === rule.id && deviationCases(target).some(({ code }) => sameSpot(code.source, spot)))
        if (!recorded && !questioned) {
          return yield* refuse(`${rule.id} has an unresolved deviation at ${spot.file}:${spot.line}`,
            'raise its two versions on the rule before it can be approved')
        }
      }
    }
    const { read } = yield* needDraft(dir)
    for (const rule of draft.standards.flatMap((s) => s.rules)) {
      const problem = checkerProblem(read.config.roles, rule.id, rule.checkedBy)
      if (problem !== null) {
        return yield* refuse(problem, `name a role of ${DRAFT} that checks it, in checkedBy`)
      }
    }
    const renames = file.asked._tag === 'New' && draftIn(file.stage) === undefined
    if (draft.id !== file.id && !renames) {
      return yield* refuse(
        `${file.id} keeps its id; the draft names ${draft.id}`,
        `write id: ${file.id} in the draft, or leave the id out`,
      )
    }
    if (draft.id !== file.id && existsSync(directionPath(dir, draft.id))) {
      return yield* refuse(`a direction ${draft.id} exists already`, 'give the new direction another id')
    }
    // A draft over a draft keeps what the last one said, so that the page shows what changed.
    const last = draftIn(file.stage)?.content
    const words: DraftOfFile = {
      name: draft.name,
      from: draft.from,
      content: {
        summary: draft.summary,
        flow: draft.flow,
        says: draft.says,
        standards: draft.standards,
        ...(draft.discovery && { discovery: draft.discovery }),
      },
      ...(last && {
        previous: { summary: last.summary, says: last.says, standards: last.standards },
      }),
    }
    const stage: OnboardingDirection['stage'] =
      open !== undefined
        ? { _tag: 'Question', draft: words, open, ...(open.some((q) => q.target !== undefined) &&
          { revision: randomUUID() }) }
        : { _tag: 'Ready', draft: words }
    const asked = adoptCompany && file.asked._tag === 'Company'
      ? { ...file.asked, _tag: 'AdoptedCompany' as const } : file.asked
    const next: OnboardingDirection = { ...file, id: draft.id, stage, asked }
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

// Why the person cannot accept a direction now; undefined: it is Ready.
const notReady = (file: OnboardingDirection): string | undefined => {
  switch (file.stage._tag) {
    case 'Ready':
      return undefined
    case 'Accepted':
      return `${file.id} is accepted already`
    case 'Removed':
      return `${file.id} was removed`
    case 'Drafting':
      return `${file.id} has no draft yet; the host drafts it`
    case 'Reset':
      return resetWords(file.id)
    case 'Revising':
      return `a Revise of ${file.id} waits for the host`
    case 'Question':
      return `${file.id} has questions for you; answer them first`
    case 'Answered':
      return `the answers of ${file.stage.draft?.name ?? file.id} (${file.id}) decide its next draft, and the host has not written it yet`
  }
}
// The rules of the drafted directions that a role checks: the store cannot start without it.
const checkedBy = (files: ReadonlyArray<OnboardingDirection>, role: string) =>
  files.flatMap((f) =>
    (draftIn(f.stage)?.content.standards ?? []).flatMap((s) =>
      s.rules.filter((r) => r.checkedBy === role).map((r) => ({ direction: f.id, rule: r.id })),
    ),
  )

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

const sameReview = (
  received: ReadonlyArray<{ readonly id: string; readonly revision: string }>,
  current: ReadonlyArray<{ readonly id: string; readonly revision: string }>,
) => received.length === current.length &&
  current.every((item) => received.some(({ id, revision }) => id === item.id && revision === item.revision))

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
        case 'add-company-url':
        case 'add-company-direction': {
          const source = act.act === 'add-company-url' ? companyDirectionAt(act.url) : act
          if (source === undefined) {
            return yield* refuse('the URL must name a git repo and a direction folder',
              'use https://host/owner/repo.git#directions/folder')
          }
          const id = folderId(source.path)
          if (id === '') return yield* refuse(`${source.path} names no folder`, 'name the folder of the direction in its repo')
          return yield* newFile(dir, DirectionId.make(id), {
            _tag: 'Company',
            repo: source.repo,
            path: source.path,
          })
        }
        case 'answer': {
          const file = yield* needDirection(dir, act.direction)
          if (file.stage._tag !== 'Question') {
            return yield* refuse(`${file.id} has no open question`, 'work onboard status shows what waits')
          }
          const { draft: words, open, revision } = file.stage
          if ((act.revision !== undefined || open.some((q) => q.target !== undefined)) &&
            act.revision !== revision) {
            return yield* refuse('the question revision changed', 'reload the direction before answering')
          }
          if (act.options.length !== open.length) {
            return yield* refuse(
              `${file.id} has ${open.length} open questions, and ${act.options.length} options were given`,
              `give one option for each question, in order: --options=${open.map(() => 'A').join(',')}`,
            )
          }
          const [first, ...rest] = open.map((q, i) => ({ ...q, chosen: act.options[i] ?? 'A' }))
          if (first === undefined) return []
          yield* writeDirection(dir, {
            ...file,
            stage: { _tag: 'Answered', ...(words && { draft: words }), ...(revision && { revision }), answered: [first, ...rest] },
          })
          return []
        }
        case 'accept': {
          const file = yield* needDirection(dir, act.direction)
          if (file.stage._tag !== 'Ready') {
            return yield* refuse(notReady(file) ?? '', 'work onboard status shows what waits')
          }
          if (file.stage.draft.content.standards.some((s) => s.rules.some((r) => r.evidence !== undefined))) {
            return yield* refuse('accept all the reviewed directions together', 'work onboard approve-directions')
          }
          yield* writeDirection(dir, { ...file, stage: { _tag: 'Accepted', draft: file.stage.draft } })
          return [file.id]
        }
        case 'revise': {
          const file = yield* needDirection(dir, act.direction)
          const words = draftIn(file.stage)
          if (words === undefined) {
            return yield* refuse(notReady(file) ?? '', 'work onboard status shows what waits')
          }
          if (file.stage._tag === 'Answered') {
            return yield* refuse('the host is verifying your answers', 'wait for the revised direction')
          }
          if (file.stage._tag === 'Question' && file.stage.open.some((q) => q.target !== undefined)) {
            return yield* refuse('answer the open questions on this revision', 'choose a version or enter your own words')
          }
          // Open questions go: the person's words come instead of the answers.
          const answered = answersIn(file.stage)
          yield* writeDirection(dir, {
            ...file,
            stage: { _tag: 'Revising', draft: words, words: act.words, answered },
          })
          return []
        }
        case 'remove': {
          const file = yield* needDirection(dir, act.direction)
          if ((file.stage._tag === 'Question' && file.stage.revision !== undefined) ||
            (file.stage._tag === 'Answered' && file.stage.revision !== undefined) ||
            draftIn(file.stage)?.content.discovery !== undefined) {
            return yield* refuse('remove through a reviewed revision', 'revise the direction and ask to remove it')
          }
          yield* io(() => rmSync(directionPath(dir, file.id)))
          return []
        }
        case 'approve-all-directions': {
          const directions = yield* readDirections(dir)
          const waiting = directions.find((f) => !['Ready', 'Accepted', 'Removed'].includes(f.stage._tag))
          if (waiting !== undefined) {
            return yield* refuse(`${waiting.id} still waits for review`, 'resolve all directions before approving them')
          }
          const current = directionReview(directions, yield* readDiscovery(dir))
          if (act.reviewed === undefined || !sameReview(act.reviewed, current)) {
            return yield* refuse('The directions changed while you were reviewing them', 'reload and review the current drafts')
          }
          const ready = directions.flatMap((f) =>
            f.stage._tag === 'Ready' ? [{ ...f, stage: { ...f.stage, _tag: 'Accepted' as const } }] : [],
          )
          if (ready.length === 0) {
            return yield* refuse('no direction is ready; approve all accepts each ready one', 'work onboard status shows what waits')
          }
          for (const file of ready) yield* writeDirection(dir, file)
          return ready.map((f) => f.id)
        }
        case 'add-role': {
          yield* needDraft(dir)
          const states = yield* readRoleStates(dir)
          let n = 1
          while (Object.hasOwn(states, `requested-role-${n}`)) n++
          yield* writeRoleStates(dir, {
            ...states,
            [`requested-role-${n}`]: { summary: act.words, found: { _tag: 'New' },
              decision: { _tag: 'Revising', words: act.words } },
          })
          return []
        }
        case 'review-all-roles': {
          const files = yield* readOnboarding(dir)
          const waiting = files.roles.filter(({ decision }) => decision._tag === 'Waiting')
          const current = waiting.map((r) => ({ id: r.role, revision: sha(JSON.stringify(r)) }))
          if (files.directions.some(({ stage }) => stage._tag !== 'Accepted' && stage._tag !== 'Removed') || files.roleRequests?.length ||
            files.roles.some(({ decision, questions }) => decision._tag === 'Revising' || questions?.length) ||
            current.length === 0 || !sameReview(act.reviewed, current)) {
            return yield* refuse('The roles changed or are still being drafted')
          }
          const states = yield* readRoleStates(dir)
          yield* writeRoleStates(dir, {
            ...states,
            ...Object.fromEntries(waiting.map(({ role }) => [role, { ...states[role]!, decision: ACCEPTED }])),
          })
          return []
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
          if (act.act === 'accept-role' && state.questions?.length) {
            return yield* refuse(`Questions for ${act.role} still need answers`)
          }
          if (act.act === 'accept-role' && state.decision._tag === 'Revising') {
            return yield* refuse(`a Revise of ${act.role} waits for the host`, 'work onboard status shows what waits')
          }
          const decision: OnboardingRoleState['decision'] =
            'words' in act ? { _tag: 'Revising', words: act.words } : ACCEPTED
          yield* writeRoleStates(dir, { ...states, [act.role]: { ...state, decision } })
          return []
        }
        case 'remove-role': {
          const known = yield* needDraft(dir)
          yield* roleIn(known, act.role)
          if (onlyLead(known.read.config.roles) === act.role) {
            return yield* refuse(
              `${act.role} is the role of the top task (the only persistent role that splits), so it ` +
                'stays: the host plays it, and the store cannot start without it (ruling 15)',
              `keep ${act.role}; the host writes another persistent role that splits first, if it should go`,
            )
          }
          const [uses] = checkedBy(yield* readDirections(dir), act.role)
          if (uses !== undefined) {
            return yield* refuse(
              `${act.role} checks the rule ${uses.rule} of ${uses.direction}, so the store cannot start without it`,
              `revise ${uses.direction} first, so that the host names another checker: work onboard ` +
                `revise ${uses.direction} --words="<who checks ${uses.rule} instead of ${act.role}>"`,
            )
          }
          const { [act.role]: _gone, ...kept } = known.raw.roles
          // No role gives work to a role that is gone: it leaves each assign act.
          const unassigned = (acts: unknown): unknown =>
            Array.isArray(acts)
              ? acts.map((a) =>
                  Array.isArray(a?.assign) ? { assign: a.assign.filter((n: unknown) => n !== act.role) } : a,
                )
              : acts
          const roles = Object.fromEntries(
            Object.entries(kept).map(([n, r]) => [n, { ...(r as object), acts: unassigned((r as { acts?: unknown }).acts) }]),
          )
          yield* writeDraft(dir, { ...known.raw, roles })
          const { [act.role]: _state, ...states } = yield* readRoleStates(dir)
          yield* writeRoleStates(dir, states)
          return []
        }
        case 'persistence':
        case 'model':
          return yield* refuse(`edit ${STAFFING} to change the staffing of ${act.role}`)

      }
    }),
  )

// --- the store start (BUILD.md 1c) ----------------------------------------------------------------

export interface StartFile {
  readonly name: 'aristoteles.yaml' | 'aristoteles.lock'
  readonly before: string | null
  readonly after: string
}
export interface Start {
  readonly files: ReadonlyArray<StartFile>
  readonly install: Effect.Effect<void, OutsideFailed>
  // The accepted directions, each with where it comes from.
  readonly directions: ReadonlyArray<OnboardedDirection>
  // The store is refused: aristoteles.yaml and aristoteles.lock as they were; the files stay.
  readonly restore: Effect.Effect<void, OutsideFailed>
  // The store holds the start: the onboarding files go.
  readonly finish: Effect.Effect<void, OutsideFailed>
}

// The folder of a company says what its draft says: the words, each standard and rule by id and
// words, in the same order (the checkers are the draft's own).
const sameAsDrafted = (drafted: DraftOfFile, folder: CompanyFolder): boolean =>
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

// Takes the lock until the scope closes, and refuses what `blocked` refuses: the one reader of
// whether the store can start (core/actions startStateOf), read on the files under the lock.
// It writes aristoteles.yaml from the config draft, and the aristoteles.lock entry of each company
// direction at the commit of its folder now; the caller stores the start (DefineWorkflow, as the
// person) and then runs finish, or restore when the store refuses it.
export const prepareStart = (
  dir: string,
  person: string,
  env: Readonly<Record<string, string | undefined>>,
  blocked: (files: OnboardingFiles) => Refused | undefined,
  install = true,
): Effect.Effect<Start, Refused | OutsideFailed, Files | Spawn | Scope.Scope> =>
  Effect.gen(function* () {
    yield* locked(dir)
    const no = blocked(yield* readOnboarding(dir))
    if (no !== undefined) return yield* Effect.fail(no)
    const files = yield* readDirections(dir)
    const draft = yield* needDraft(dir)
    const lock: Record<string, LockEntry> = { ...((yield* readLock(dir)) ?? {}) }
    const directions: Array<OnboardedDirection> = []
    for (const file of files) {
      if (file.stage._tag !== 'Accepted') continue
      const drafted = file.stage.draft
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
      directions.push(onboardedOf(file.id, drafted, person, source))
    }
    const configPath = join(dir, CONFIG)
    const lockPath = join(dir, LOCK)
    const oldConfig = readText(configPath)
    const oldLock = readText(lockPath)
    const writeBack = (path: string, text: string | null) =>
      text === null ? io(() => rmSync(path, { force: true })) : writeWhole(path, text)
    const merged = draft.read.texts[CONFIG]
    if (merged === undefined) return yield* Effect.die('a read config has its text')
    const startFiles: ReadonlyArray<StartFile> = [
      { name: CONFIG, before: oldConfig, after: merged },
      ...(Object.keys(lock).length > 0
        ? [{ name: LOCK, before: oldLock, after: yamlOf(lock) } as const]
        : []),
    ]
    const apply = Effect.forEach(startFiles,
      ({ name, after }) => writeWhole(join(dir, name), after), { discard: true })
    const restore = Effect.forEach(startFiles,
      ({ name, before }) => writeBack(join(dir, name), before), { discard: true })
    if (install) yield* apply.pipe(Effect.onError(() => Effect.ignore(restore)))
    return {
      directions,
      files: startFiles,
      install: apply,
      restore,
      finish: finishOnboardingStart(dir),
    }
  })


export const finishOnboardingStart = (dir: string) => io(() => {
  rmSync(join(dir, ASSESS), { recursive: true, force: true })
  rmSync(join(dir, DRAFT), { force: true })
})
