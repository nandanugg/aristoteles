// The words that more than one renderer prints: what a draft waits for, who drafted it, what it
// answers, what follows a veto, a stop's id, a suggestion's target, an attempt, a file idle. Every
// state they read comes from Derived.
import {
  directionAt,
  directionIdsOf,
  draftAt,
  itemAt,
  ruleAt,
  standardAt,
} from '../../core/derived/reads.ts'
import { attemptOf, type Derived, type DraftLeaf } from '../../core/derived/index.ts'
import { leafName } from '../../core/derived/deciders.ts'
import { draftWaitsFor } from '../../core/derived/reads.ts'
import { followsDirection, tierOfA } from '../../core/derived/steps.ts'
import type {
  AssignmentId,
  Direction,
  Revision,
  RevisionId,
  Stop,
  Suggestion,
  Work,
} from '../../core/schema/index.ts'
import { short, who } from './common.ts'

// The name of a leaf of a draft: a role, a person, or the owner who accepts too (S2).
const draftLeafName = (leaf: DraftLeaf): string =>
  leaf._tag === 'OwnerAccept' ? leaf.owner.name : leafName(leaf)

// draftWaitsText(draft): "the accept of Nanda": whose accept a draft waits for, in words. S2: a
// draft that the owner accepts too names the owner in the list; the old words never did.
export const draftWaitsText = (d: Derived, draft: RevisionId): string => {
  const state = d.states.revisions.get(draft)
  if (state?._tag === 'Waiting') return state.waitsFor.map(draftLeafName).join(' or ')
  return draftWaitsFor(d.moment.work, draft).map(leafName).join(' or ')
}

// stopIdOf(stop): ex3, or v4 for the points of one reject.
export const stopIdOf = (stop: Stop): string =>
  stop._tag === 'PersonReject' ? stop.id.replace(/\.\d+$/, '') : stop.id

// A suggestion's target: a direction, a standard or a rule, by the name the person knows.
export const aboutId = (work: Work, about: Suggestion['about']): string => {
  switch (about._tag) {
    case 'NewDirection':
      return 'a new direction'
    case 'Direction':
      return about.direction
    case 'Standard':
      return standardAt(work, about.standard).id
    case 'Rule':
      return ruleAt(work, about.rule).id
  }
}

// The tier of a role: low, medium or high; a check program has none.
export const tierOfRole = (work: Work, role: string): string | undefined => {
  const r = work.workflow.roles.get(role as never)
  return r?._tag === 'Model' ? r.tier : undefined
}

// The attempt of a maker in words: the try it is on, never above its limit (bug 9: one count for
// the brief, the card and work next).
export const attemptWords = (d: Derived, a: AssignmentId): string => {
  const { number, max } = attemptOf(d.moment, a)
  return `attempt ${number}${max._tag === 'AtMost' ? ` of ${max.max}` : ''}`
}

// Who wrote a draft: an assignment, a model run, or the refresh that brought in a commit of a
// company direction.
export const drafterOf = (work: Work, x: Revision<Direction>): string => {
  if (x.origin._tag === 'Written') return who(work, x.origin.by)
  const source = directionAt(work, x.of).source
  const where = source._tag === 'External' ? `${source.repo} (${source.path})` : ''
  const tag = x.origin.ref._tag === 'Tag' ? ` (tag ${x.origin.ref.tag})` : ''
  return `the refresh: commit ${x.origin.commit.slice(0, 7)}${tag} of ${where}`
}

// What a draft answers, in words: a suggestion, or a Reject (of an earlier draft, a result, or
// a task) with its reason.
export const answerText = (work: Work, id: string): string => {
  const suggestion = work.suggestions.get(id as never)
  if (suggestion) return `${id} "${short(suggestion.says, 80)}"`
  const y = itemAt(work, id) ?? itemAt(work, `${id}.1`)
  if (y === undefined) throw new Error(`the work has no review ${id}`)
  return (
    `${id}, the Reject${y.of._tag === 'Revision' ? ` of ${y.of.id}` : ''} by ` +
    `${who(work, y.by, id)}: "${short(y.reason ?? '', 80)}"`
  )
}

// What follows the Reject of a decider: its reviser revises again; when the reviser is
// finished, an open high role of a tree that follows the direction; else a new one that the
// person assigns. text is the words; step is the command that follows, when there is one.
export const reviseAgainOf = (
  d: Derived,
  draft: RevisionId,
): { readonly text: string; readonly step: string | null } => {
  const work = d.moment.work
  const open = (id: AssignmentId): boolean => d.states.assignments.get(id)?._tag !== 'Ended'
  const x = draftAt(work, draft)
  // A company direction changes in its repo: the project stays on its accepted commit.
  if (x.origin._tag === 'Imported') {
    const source = directionAt(work, x.of).source
    const where = source._tag === 'External' ? `${source.repo} (${source.path})` : ''
    return {
      text: `${x.of} stays on its accepted commit; it changes in ${where}, with a pull request`,
      step: null,
    }
  }
  const by = x.origin.by
  // A model run outside any task (the skill that reads an app) is run again; it answers the Reject
  // with the same kind of draft: a whole new direction, or a revise of the current version.
  if (typeof by !== 'string') {
    const state = d.states.revisions.get(draft)
    const vetoed = state?._tag === 'Vetoed' ? state.by : undefined
    return {
      text:
        `its writer ${who(work, by)}, a model run outside any task, ` +
        'writes a new draft that answers it',
      step:
        x._tag === 'Change'
          ? `work direction revise ${x.of} --file=<edit.yaml> --by=${by.name} --answers=${vetoed}`
          : `work direction new --file=<direction.yaml> --by=${by.name} --answers=${vetoed}`,
    }
  }
  const reviser = work.assignments.get(by)
  if (reviser === undefined) throw new Error(`the work has no assignment ${by}`)
  // C1: an assignment of an ended task is Ended too, which the old end of an assignment missed.
  if (open(reviser.id)) return { text: 'its reviser revises the current version again', step: null }
  const finished = `its reviser ${by} is finished`
  const next = [...work.assignments.values()].find(
    (y) => open(y.id) && tierOfA(work, y) === 'high' && followsDirection(d, y, x.of),
  )
  if (next) {
    const text = `${finished}; ${next.id} (${next.role}) revises the current version`
    return { text, step: null }
  }
  const top = [...work.tasks.values()].find((t) => {
    const s = d.states.tasks.get(t.id)
    return (
      s !== undefined &&
      s._tag !== 'Closed' &&
      s._tag !== 'Replaced' &&
      t.serves._tag === 'TopTask' &&
      directionIdsOf(work, t.id).includes(x.of)
    )
  })
  return {
    text: `${finished}; a new ${reviser.role} revises the current version`,
    step: `work assign ${top ? top.id : '<task>'} --role=${reviser.role}`,
  }
}
// The next line after a vetoed draft.
export const reviseAgain = (d: Derived, draft: RevisionId): string => reviseAgainOf(d, draft).text
