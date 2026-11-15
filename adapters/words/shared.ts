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
import {
  attemptOf,
  type Derived,
  type DraftAuthor,
  type DraftLeaf,
  waitingFor,
} from '../../core/derived/index.ts'
import { leafName } from '../../core/derived/deciders.ts'
import { draftWaitsFor } from '../../core/derived/reads.ts'
import { authorOf, redrafterOf } from '../../core/derived/authors.ts'
import type {
  AssignmentId,
  Direction,
  Revision,
  RevisionId,
  Stop,
  Suggestion,
  SuggestionId,
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
    case 'Roles':
      return 'the roles'
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
  if (x.origin._tag === 'Onboarded') return `the store start of onboarding (${x.origin.event})`
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

// What follows the Reject of a decider (redrafterOf): who writes the next draft, in words. text
// is the words; step is the command that follows, when there is one.
export const reviseAgainOf = (
  d: Derived,
  draft: RevisionId,
): { readonly text: string; readonly step: string | null } => {
  const work = d.moment.work
  const x = draftAt(work, draft)
  const author = authorOf(work, x)
  const next = redrafterOf(d, x)
  const writer =
    author._tag === 'Host'
      ? `its writer, the host ${author.assignment ?? author.run},`
      : author._tag === 'ModelRun'
        ? `its writer ${author.name}, a model run outside any task,`
        : 'its reviser'
  const again = 'revises the current version'
  switch (next._tag) {
    // An onboarded draft is official at the store start: no Reject reaches it.
    case 'Official':
      return { text: `${draft} is official`, step: null }
    // A company direction changes in its repo: the project stays on its accepted commit.
    case 'Repo': {
      const source = directionAt(work, x.of).source
      const where = source._tag === 'External' ? `${source.repo} (${source.path})` : ''
      return {
        text: `${x.of} stays on its accepted commit; it changes in ${where}, with a pull request`,
        step: null,
      }
    }
    case 'Writer':
      return { text: `${writer} ${again} again`, step: null }
    case 'Hosts': {
      const [one, ...more] = next.hosts
      const hosts = more.length ? `an active host (${next.hosts.join(', ')})` : `the host ${one}`
      return { text: `${writer} has ended; ${hosts} ${again}`, step: null }
    }
    // No agent writes it: the person runs the model again (the skill that reads an app), and it
    // answers the Reject with the same kind of draft: a whole new direction, or a revise.
    case 'Person': {
      const by = `--by=${author._tag === 'ModelRun' ? author.name : runOf(author)}`
      const state = d.states.revisions.get(draft)
      const answers = `--answers=${state?._tag === 'Vetoed' ? state.by : undefined}`
      return {
        text: `${writer} writes a new draft that answers it`,
        step:
          x._tag === 'Change'
            ? `work direction revise ${x.of} --file=<edit.yaml> ${by} ${answers}`
            : `work direction new --file=<direction.yaml> ${by} ${answers}`,
      }
    }
    case 'Follower': {
      const y = work.assignments.get(next.followers[0])
      const text = `its reviser ${next.finished} is finished; ${y?.id} (${y?.role}) ${again}`
      return { text, step: null }
    }
    case 'NewRole': {
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
        text: `its reviser ${next.finished} is finished; a new ${next.role} ${again}`,
        step: `work assign ${top ? top.id : '<task>'} --role=${next.role}`,
      }
    }
  }
}
// The run of a host's draft, for --by.
const runOf = (a: DraftAuthor): string => (a._tag === 'Host' ? a.run : '')
// The next line after a vetoed draft.
export const reviseAgain = (d: Derived, draft: RevisionId): string => reviseAgainOf(d, draft).text

// Who answers a suggestion, read from its waiting item (P1): the agents that draft it, the
// person's assign of a high role, or that nothing can yet. With no item, a high role that follows
// its direction drafts it. command: the assign as a command (the page has a button for it).
export const suggestionMover = (d: Derived, id: SuggestionId, command = true): string => {
  const w = d.moment.work
  const item = waitingFor(d, { _tag: 'Everyone' }).find(
    (i) => i._tag === 'Suggestion' && i.suggestion === id,
  )
  if (item?._tag !== 'Suggestion') return 'a high role that follows its direction drafts it'
  const about = item.about._tag === 'Direction' ? w.directions.get(item.about.direction) : undefined
  if (about?.source._tag === 'External') {
    return `${about.id} changes in ${about.source.repo}, with a pull request`
  }
  if (item.drafters.length > 0) {
    const names = item.drafters.map((a) => `${a} (${w.assignments.get(a)?.role})`)
    return `${names.join(' or ')} drafts it`
  }
  const gives = item.step._tag === 'Do' ? item.step.intents : []
  const [one] = gives
  if (one?._tag === 'Give') {
    const roles = gives.flatMap((i) => (i._tag === 'Give' ? [i.target.role] : []))
    const assign = command ? `: work assign ${one.target.task} --role=${roles.join('|')}` : ''
    return `no agent can draft it now; give a high role work, and it drafts it${assign}`
  }
  return 'no agent can draft it now; start a project in your AI CLI, and its host drafts it'
}
