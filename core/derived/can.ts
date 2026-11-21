// canAct (BUILD.md 3.5): the one check behind every refusal of state. Every action calls it after
// its normalisation (3.6). It reads only Derived and never the content of an act (words, files):
// those are the action's. The refusal keeps the old words; its choice is the actor's real choice
// (D10). One check per tag in a total table: a new act fails the compile until it has its check.
// The acts are the person's, the host's model runs and the supervisor's before a top; a top's own
// acts are checked in core/derived/c16.
import type { ActionTag, Intent } from '../schema/actions.ts'
import { type ChoiceKind, refusal } from '../schema/errors.ts'
import { isMarked, type NonBlank } from '../schema/index.ts'
import { directionAt, draftAt, rejectionAt } from './reads.ts'
import type { CanAct, CanActOf, Derived } from './types.ts'

const MAY: CanAct = { _tag: 'May' }
const no = (message: string, kind: ChoiceKind, words: string): CanAct => ({
  _tag: 'MayNot',
  refusal: refusal(message, kind, words as NonBlank),
})

interface Ctx {
  readonly d: Derived
  readonly person: string | null
}
type IntentOf<K extends ActionTag> = Extract<Intent, { readonly _tag: K }>
type Check<K extends ActionTag> = (c: Ctx, intent: IntentOf<K>) => CanAct

const notPerson = (c: Ctx, message: string, words: string): CanAct =>
  c.person === null ? MAY : no(message, 'Write', words)

// --- directions ----------------------------------------------------------------------------------

// A model drafts a direction; the person accepts or rejects the draft.
const draftDirection: Check<'DraftDirection'> = (c) =>
  notPerson(
    c,
    'a model drafts a direction; the person accepts or rejects the draft',
    'leave the draft of the direction to a model',
  )

const reviseDirection: Check<'ReviseDirection'> = (c, { target: { direction } }) => {
  const d = c.d.moment.work.directions.get(direction)
  if (d === undefined) return no(`there is no direction "${direction}"`, 'Pick', 'name a direction')
  // B2: a company direction changes in its repo.
  if (d.source._tag === 'External') {
    return no(
      `${direction} is a company direction from ${d.source.repo} (${d.source.path}); it changes ` +
        'there, with a pull request',
      'Escalate',
      `change ${direction} in its repo, with a pull request`,
    )
  }
  if (d._tag !== 'Official') {
    return no(
      `${direction} has no version yet; a draft of it is the whole direction`,
      'Pick',
      'draft the whole direction anew',
    )
  }
  return notPerson(
    c,
    `a model revises ${d.name}; the person accepts or rejects the draft`,
    `leave the revise of ${direction} to a model`,
  )
}

const addExamples: Check<'AddExamples'> = (c, { target: { draft } }) => {
  const notModel = notPerson(
    c,
    'a model drafts the examples of a draft',
    'leave the examples of the draft to a model',
  )
  if (notModel._tag === 'MayNot') return notModel
  const x = c.d.moment.work.drafts.get(draft)
  if (x === undefined) return no(`there is no draft ${draft}`, 'Pick', 'name a draft that exists')
  if (x._tag !== 'New') {
    return no(
      `${draft} changes a direction that has a version; examples make no new version`,
      'Pick',
      'give examples for a draft of a new direction',
    )
  }
  return c.d.states.revisions.get(draft)?._tag === 'Waiting'
    ? MAY
    : no(`${draft} waits for no accept`, 'Pick', 'add the examples of a draft that waits')
}

// --- the owner's decision of a draft -------------------------------------------------------------

// The checks of an accept or a reject of a draft (S2, S7): only its owner, as the person, decides.
const reviewDraft = (c: Ctx, id: string, accept: boolean): CanAct => {
  const { moment, states } = c.d
  const w = moment.work
  if (!w.drafts.has(id as never)) return no(`there is no draft ${id}`, 'Pick', 'name a draft')
  const draft = draftAt(w, id as never)
  const direction = directionAt(w, draft.of)
  const state = states.revisions.get(draft.id)
  switch (state?._tag) {
    case 'Official':
      return no(`${id} is official: it made ${direction.name}`, 'Pick', 'decide an open draft')
    case 'Outdated': {
      const on =
        draft._tag === 'Change'
          ? `is built on ${direction.name} ${draft.base}, an old version`
          : `drafts ${direction.name} anew, and it has a version`
      return no(
        `${id} ${on} (${state.current} is current), so it stopped; a new draft changes ` +
          state.current,
        'Pick',
        `decide a draft built on ${state.current}`,
      )
    }
    case 'Conflicted':
      if (!accept) break
      return no(
        state.with === draft.id
          ? `${id} has the rule id "${state.rule}" twice; revise with a new id`
          : `the rule id "${state.rule}" is already used by another direction; revise with a ` +
              'new id',
        'Pick',
        `pick which draft keeps the id "${state.rule}": reject this one, or revise ${state.with}`,
      )
    case 'Vetoed':
      return no(
        `${id} is ended by the Reject ${state.by}: ${rejectionAt(w, state.by)?.reason ?? ''}; ` +
          'its reviser revises the current version again',
        'Pick',
        'decide the next draft',
      )
    default:
      break
  }
  const owner = direction.owner.name
  if (c.person !== owner) {
    return no(`${id} is decided by its owner, ${owner}`, 'Escalate', `${owner} decides it`)
  }
  if (accept && draft._tag === 'New' && !draft.flow.some(isMarked)) {
    return no(
      `${id} drafts the new direction ${direction.name}, and its flow marks no step; a direction ` +
        'starts with a flow whose marked steps each have an output that follows it and one that ' +
        'breaks it',
      'Wait',
      `a model adds its flow and examples first: work direction examples ${id} --file=<flow.yaml>`,
    )
  }
  return MAY
}

// --- the table -----------------------------------------------------------------------------------

const CHECKS: { readonly [K in ActionTag]: Check<K> } = {
  DefineWorkflow: () =>
    no('the store has a config; use work config apply', 'Pick', 'apply the config'),
  ApplyConfig: () => MAY,
  RestoreConfig: () => MAY,
  FitRole: () => MAY,
  SaveSettings: () => MAY,
  Send: () => MAY,
  SendDelivered: () => MAY,
  SendDropped: () => MAY,
  DraftDirection: draftDirection,
  ReviseDirection: reviseDirection,
  ImportCompany: () => MAY,
  AddExamples: addExamples,
  Accept: (c, { target: { of } }) => reviewDraft(c, of.id, true),
  Reject: (c, { target: { of } }) => reviewDraft(c, of.id, false),
  ReadSource: () => MAY,
}

export const canAct: CanActOf = (d, actor, intent) => {
  const c: Ctx = { d, person: actor._tag === 'Person' ? actor.name : null }
  return (CHECKS[intent._tag] as Check<ActionTag>)(c, intent)
}
