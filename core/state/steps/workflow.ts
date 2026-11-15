// The workflow of a dir: its first event (work init, or the store start of onboarding with the
// accepted directions) makes the Work; a later event changes the words of roles, or a role by an
// accepted adjustment; a role fit records the yes and why of each question; a draft of new words
// or of an adjustment, and its reject, stay in the log.
import {
  type EventOf,
  type EventRef,
  type GroupOf,
  human,
  type Limit,
  type Limits,
  Moves,
  noCounters,
  type PositiveInt,
  type RecordedOf,
  type RoleFile,
  type Act as RoleAct,
  type Role,
  type RoleName,
  type Stepped,
  type Time,
  type Work,
  type Workflow,
} from '../../schema/index.ts'
import { built, damaged, put, unchanged } from '../act.ts'
import { decidersOf } from '../decisions.ts'
import { officialAt } from '../records.ts'
import { onboarded } from './directions.ts'
import { eventRef } from './ui.ts'

type TierLimits = Work['config']['limits'][keyof Work['config']['limits']]

const limitOf = (n: number | undefined): Limit =>
  n === undefined ? { _tag: 'Unlimited' } : { _tag: 'AtMost', max: n as PositiveInt }
const limitsOf = (tier: TierLimits | undefined): Limits => ({
  Assignment: {
    briefChars: limitOf(tier?.Assignment?.briefChars),
    attempts: limitOf(tier?.Assignment?.attempts),
  },
  Review: { rules: limitOf(tier?.Review?.rules) },
  Result: { size: limitOf(tier?.Result?.size) },
})

// A role of the workflow from its file: a program, or a model of a tier with its persistence.
const roleOf = (config: Work['config'], name: RoleName, r: RoleFile): Role => {
  const acts = r.acts.map((a): RoleAct => {
    if ('do' in a) return { _tag: 'Do', work: a.do }
    if ('review' in a) return { _tag: 'Review', resultsOf: a.review }
    if ('approve' in a) return { _tag: 'Approve', resultsOf: a.approve }
    return { _tag: 'Change', changesOf: a.change }
  })
  // The keys of before keep their order; the onboarding keys go last.
  if (r.kind === 'program') {
    return { _tag: 'Program', role: name, acts, limits: limitsOf(undefined), icon: r.icon }
  }
  const { persistent, why } = r.persistence
  return {
    _tag: 'Model',
    tier: r.tier,
    role: name,
    acts,
    limits: limitsOf(config.limits[r.tier]),
    persistence: persistent ? { _tag: 'Persistent', why } : { _tag: 'Disposable', why },
    icon: r.icon,
  }
}

// The Work of a new dir from its first event. The person who made the store owns the roles.
type Defined = Extract<GroupOf<'Workflow'>, { readonly create: unknown }>
const newWork = (event: Defined, who: string): Work => {
  const { config, hashes, texts } = event.create
  const names = Object.keys(config.roles) as Array<RoleName>
  const roles = new Map<RoleName, Role>(
    Object.entries(config.roles).map(([name, r]) => [
      name as RoleName,
      roleOf(config, name as RoleName, r),
    ]),
  )
  const workflow: Workflow = {
    system: config.project,
    owner: human(who),
    roles,
    limits: limitsOf(undefined),
    decide: new Map(
      Object.entries(config.decide).map(([maker, file]) => [
        maker as RoleName,
        decidersOf(file, names),
      ]),
    ),
  }
  return {
    config,
    hashes,
    texts,
    workflow,
    fits: new Map(),
    directions: new Map(),
    drafts: new Map(),
    standards: new Map(),
    rules: new Map(),
    suggestions: new Map(),
    tasks: new Map(),
    changes: [],
    assignments: new Map(),
    results: new Map(),
    reviews: new Map(),
    questions: new Map(),
    notes: new Map(),
    exhaustions: new Map(),
    evaluations: new Map(),
    permissions: new Map(),
    checkpoints: new Map(),
    meta: new Map(),
    forwards: new Map(),
    sources: new Map(),
    resultFiles: new Map(),
    after: new Map(),
    runs: new Map(),
    sessions: new Map(),
    agents: new Map(),
    taskDrafts: new Map(),
    problems: new Map(),
    terminalEvents: [],
    sends: [],
    hostWords: new Map(),
    events: [],
    counters: noCounters,
    clock: 0,
  }
}

// The first event: the Work, and version 1 of each direction that onboarding accepted (Question
// 20, option A), whose draft names this event as its origin.
export const defined = (
  event: Defined,
  who: string,
  recorded: { readonly seq: number; readonly at: Time },
): Stepped =>
  built(newWork(event, who), (b) => {
    for (const d of event.create.directions) onboarded(b, d, eventRef(recorded.seq), recorded.at)
  })

export const roleWordsChanged = (
  work: Work,
  e: EventOf<'Workflow.RoleWordsChanged'>,
): Stepped => {
  const d = e.move
  return unchanged({
    ...work,
    config: Moves.MOVES['Workflow.RoleWordsChanged'](work.config, d.roles),
    hashes: d.hashes,
    texts: d.texts,
  })
}

export const roleFitted = (
  work: Work,
  e: EventOf<'Role.Fitted'>,
  r: RecordedOf<'Role.Fitted'>,
): Stepped => {
  const fit = { hash: e.move.hash, by: r.author, answers: e.move.answers }
  return unchanged({ ...work, fits: put(work.fits, e.id, fit) })
}

// New words of a role and their reject (ruling 2026-11-14) make no record: the log holds them,
// and core/derived reads their state from it. A step refuses only what no act stores.
export const roleWordsDrafted = (
  work: Work,
  e: EventOf<'Role.WordsDrafted'>,
  r: RecordedOf<'Role.WordsDrafted'>,
): Stepped => (work.workflow.roles.has(e.id) ? unchanged(work) : damaged(r, `no role ${e.id}`))
export const roleWordsRejected = (
  work: Work,
  e: EventOf<'Role.WordsRejected'>,
  r: RecordedOf<'Role.WordsRejected'>,
): Stepped => {
  const draft = work.events.find((l) => eventRef(l.recorded.seq) === e.move.draft)
  const d = draft?.recorded.event
  const ofRole = d?._tag === 'Role' && d.move._tag === 'WordsDrafted' && d.id === e.id
  return ofRole ? unchanged(work) : damaged(r, `${e.move.draft} drafts no words of ${e.id}`)
}

// --- adjustments (ruling 14) ---------------------------------------------------------------------

// The draft that an accept or a reject names: an Adjustment.Drafted event of the log.
const adjustmentAt = (work: Work, ref: EventRef) => {
  const e = work.events.find((l) => eventRef(l.recorded.seq) === ref)?.recorded.event
  return e?._tag === 'Adjustment' && 'create' in e ? e.create.adjustment : undefined
}

// A draft changes nothing until the person accepts it: the log holds it, and core/derived reads
// its state.
export const adjustmentDrafted = (work: Work): Stepped => unchanged(work)
export const adjustmentRejected = (
  work: Work,
  e: EventOf<'Adjustment.Rejected'>,
  r: RecordedOf<'Adjustment.Rejected'>,
): Stepped =>
  adjustmentAt(work, e.id) === undefined
    ? damaged(r, `${e.id} drafts no adjustment`)
    : unchanged(work)

// The accept applies the change: a role adjustment to the config and the roles of the workflow,
// with the stored text of aristoteles.yaml; other examples to an official direction. A retired
// direction keeps its record: its state follows from this event (core/derived).
export const adjustmentAccepted = (
  work: Work,
  e: EventOf<'Adjustment.Accepted'>,
  r: RecordedOf<'Adjustment.Accepted'>,
): Stepped => {
  const adjustment = adjustmentAt(work, e.id) ?? damaged(r, `${e.id} drafts no adjustment`)
  const { hashes, texts } = e.move
  if (adjustment._tag === 'SetExamples') {
    const official =
      officialAt(work, adjustment.direction) ??
      damaged(r, `${adjustment.direction} has no version`)
    const changed = Moves.setExamples(official, adjustment.examples)
    return unchanged({
      ...work,
      hashes,
      texts,
      directions: put(work.directions, official.id, changed),
    })
  }
  if (adjustment._tag === 'RetireDirection') return unchanged({ ...work, hashes, texts })
  const config = Moves.adjustRoles(work.config, adjustment)
  const roles = new Map(work.workflow.roles)
  const name = adjustment.role
  const file = config.roles[name]
  if (file === undefined) roles.delete(name)
  else roles.set(name, roleOf(config, name, file))
  const workflow = { ...work.workflow, roles }
  return unchanged({ ...work, config, hashes, texts, workflow })
}
