// The workflow of a dir: its first event (work init) makes the Work; a later event changes only
// the words of roles; a role fit records the yes and why of each question; a draft of new words
// and its reject stay in the log.
import {
  type EventOf,
  type GroupOf,
  human,
  type Limit,
  type Limits,
  Moves,
  noCounters,
  type PositiveInt,
  type RecordedOf,
  type Act as RoleAct,
  type Role,
  type RoleName,
  type Stepped,
  type Work,
  type Workflow,
} from '../../schema/index.ts'
import { damaged, put, unchanged } from '../act.ts'
import { decidersOf } from '../decisions.ts'
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

// The Work of a new dir from its first event. The person who made the store owns the roles.
type Defined = Extract<GroupOf<'Workflow'>, { readonly create: unknown }>
export const newWork = (event: Defined, who: string): Work => {
  const { config, hashes, texts } = event.create
  const names = Object.keys(config.roles) as Array<RoleName>
  const roles = new Map<RoleName, Role>(
    Object.entries(config.roles).map(([name, r]) => {
      const acts = r.acts.map((a): RoleAct => {
        if ('do' in a) return { _tag: 'Do', work: a.do }
        if ('review' in a) return { _tag: 'Review', resultsOf: a.review }
        if ('approve' in a) return { _tag: 'Approve', resultsOf: a.approve }
        return { _tag: 'Change', changesOf: a.change }
      })
      const role: Role =
        r.kind === 'program'
          ? { _tag: 'Program', role: name as RoleName, acts, limits: limitsOf(undefined) }
          : {
              _tag: 'Model',
              tier: r.tier,
              role: name as RoleName,
              acts,
              limits: limitsOf(config.limits[r.tier]),
            }
      return [name as RoleName, role]
    }),
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
