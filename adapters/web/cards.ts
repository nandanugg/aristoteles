// The page cards of the person's items that have no card of their own kind (P1, 2026-11-15): a
// Step card says what waits in a short sentence, and its acts are the item's step. An act is an
// intent that passed canAct, so the page offers nothing that is refused.
import { dirDrafters } from '../../core/derived/authors.ts'
import {
  adjustmentDraftAt,
  type Derived,
  type PersonKind,
  roleWordsDraftAt,
  SURFACES,
  type WaitingItem,
} from '../../core/derived/index.ts'
import {
  directionAt,
  evaluationCounts,
  itemAt,
  resultAt,
  stopAnswered,
  stopTask,
  taskAt,
} from '../../core/derived/reads.ts'
import type { Intent } from '../../core/schema/actions.ts'
import type { Decision, DecisionAct, Work } from '../../core/schema/index.ts'
import { an, short, stateWord, who } from '../words/common.ts'
import { adjustmentWords } from '../words/index.ts'
import { reviseAgainOf, stopIdOf, suggestionMover } from '../words/shared.ts'

type Of<K extends WaitingItem['_tag']> = Extract<WaitingItem, { readonly _tag: K }>
// The kinds that show as a Step card.
type StepKind = {
  [K in PersonKind]: (typeof SURFACES)[K]['page'] extends 'Step' ? K : never
}[PersonKind]

// The act of the page for an intent of a person's step; none for an intent that no person runs.
const actOf = (w: Work, intent: Intent): DecisionAct | undefined => {
  switch (intent._tag) {
    case 'Accept':
    case 'AcceptRoleWords':
    case 'AcceptAdjustment':
    case 'EndRun':
      return { _tag: 'Accept' }
    case 'Reject':
    case 'RejectRoleWords':
    case 'RejectAdjustment':
      return { _tag: 'Reject' }
    case 'Confirm':
    case 'Answer':
    case 'FixProblem':
      return { _tag: intent._tag }
    case 'Resolve':
      return { _tag: 'Resolve', escalation: intent.target.escalation }
    case 'Give':
      return { _tag: 'Give', task: intent.target.task, role: intent.target.role }
    case 'Suggest': {
      const about = intent.target.about
      if (about._tag === 'Direction') {
        return { _tag: 'Suggest', about, name: directionAt(w, about.direction).name }
      }
      if (about._tag === 'Roles') return { _tag: 'Suggest', about, name: 'the roles' }
      return about._tag === 'NewDirection'
        ? { _tag: 'Suggest', about, name: 'a new direction' }
        : undefined
    }
    // A split and a remake read a file, and an evaluation has four parts: a terminal runs them.
    case 'SplitTask':
    case 'RemakeTask': {
      const { task, answers } = intent.target
      const review = answers === null ? '' : ` --review=${answers}`
      const line =
        intent._tag === 'SplitTask'
          ? `work task split ${task} --file=<parts.yaml>${review}`
          : `work task remake ${task} --file=<task.yaml> --reason="<why>"${review}`
      return { _tag: 'AtTerminal', line }
    }
    case 'Evaluate':
      return {
        _tag: 'AtTerminal',
        line:
          `work evaluate ${stopIdOf(intent.target.stop)} --wrong="<what is wrong>" ` +
          '--why="<why>" --improve="<one change>" --level=task|standard|direction|principle',
      }
    default:
      return undefined
  }
}
export const actsOf = (d: Derived, item: WaitingItem): ReadonlyArray<DecisionAct> =>
  item.step._tag === 'Do' ? item.step.intents.flatMap((i) => actOf(d.moment.work, i) ?? []) : []

// What a draft for the person waits for when the person may not accept it yet: its flow and
// examples, which a drafter adds (D2), or the reason of canAct.
export const examplesWait = (d: Derived): string => {
  const w = d.moment.work
  const names = dirDrafters(d).map((a) => `${a} (${w.assignments.get(a)?.role})`)
  return names.length > 0
    ? `Its flow and examples come first: ${names.join(' or ')} adds them.`
    : 'Its flow and examples come first, and no agent can add them now: start a project in ' +
        'your AI CLI, and its host adds them.'
}

// The title and the sentence of each kind that the page shows as a Step card.
type Words = { readonly title: string; readonly text: string }
const WORDS: { readonly [K in StepKind]: (d: Derived, item: Of<K>) => Words } = {
  Escalation: (d, item) => {
    const w = d.moment.work
    const r = w.reviews.get(item.escalation)
    const reason = r?._tag === 'Escalate' ? r.reason : ''
    const by = r === undefined ? '' : who(w, r.by, r.id)
    return {
      title: 'An escalation',
      text: `${by} escalated ${item.result}: "${short(reason, 200)}". Resolve it in your words.`,
    }
  },
  DraftForRole: (d, item) => {
    const w = d.moment.work
    const name = directionAt(w, w.drafts.get(item.draft)?.of ?? ('' as never)).name
    const head = `${item.draft} changes the direction "${name}".`
    return {
      title: 'A draft waits for a reviewer',
      text:
        item.reviewer._tag === 'Reviewer'
          ? `${head} It waits for the accept of ${item.reviewer.assignment} (${item.role}) ` +
            'before yours.'
          : `${head} It waits for the accept of ${an(item.role)} outside the tree of its ` +
            'writer, and none works now. Assign one.',
    }
  },
  DraftVetoed: (d, item) => {
    const w = d.moment.work
    const x = w.drafts.get(item.draft)
    const name = x === undefined ? '' : directionAt(w, x.of).name
    const r = itemAt(w, item.reject)
    const reason = r?.of._tag === 'Revision' ? (r.reason ?? '') : ''
    const next = reviseAgainOf(d, item.draft).text
    return {
      title: 'A rejected draft',
      text: `${item.draft} of "${name}" is rejected: "${short(reason, 120)}"; ${next}.`,
    }
  },
  RoleWordsRejected: (d, item) => {
    const state = d.states.roleWords.get(item.draft)
    const reason = state?._tag === 'Rejected' ? state.reason : ''
    const x = roleWordsDraftAt(d.moment.work, item.draft)
    return {
      title: 'Rejected words of a role',
      text:
        `The new words of ${x?.role ?? item.role} are rejected: "${short(reason, 120)}". ` +
        'Say in words what you want; a high role drafts it.',
    }
  },
  AdjustmentRejected: (d, item) => {
    const state = d.states.adjustments.get(item.draft)
    const reason = state?._tag === 'Rejected' ? state.reason : ''
    const x = adjustmentDraftAt(d.moment.work, item.draft)
    const what = x === undefined ? item.draft : adjustmentWords(x.adjustment)
    return {
      title: 'A rejected adjustment',
      text:
        `The adjustment "${what}" is rejected: "${short(reason, 120)}". ` +
        'Say in words what you want; a high role drafts it.',
    }
  },
  ChangePoint: (d, item) => {
    const t = taskAt(d.moment.work, item.task)
    return {
      title: 'A point needs a change',
      text:
        `${item.point} on ${t.id} ${t.name} needs a change of its directions or of the task. ` +
        'Suggest the change in words, or change the task.',
    }
  },
  Stop: (d, item) => {
    const w = d.moment.work
    const t = taskAt(w, item.task)
    if (!stopAnswered(w, item.stop)) {
      return {
        title: 'A task stopped',
        text:
          `${t.id} ${t.name} stopped and waits for an evaluation, and no high role works on ` +
          'it. Assign one, or evaluate it yourself.',
      }
    }
    const e = [...w.evaluations.values()]
      .filter((x) => stopTask(w, x.answers) === t.id && evaluationCounts(w, x))
      .at(-1)
    return {
      title: 'A task waits for a change',
      text:
        `${t.id} ${t.name} waits for the change that ${e?.id} asks for: ` +
        `"${short(e?.improve.join('; ') ?? '', 160)}".`,
    }
  },
  Suggestion: (d, item) => {
    const y = d.moment.work.suggestions.get(item.suggestion)
    const mover = suggestionMover(d, item.suggestion, false)
    return {
      title: 'A suggestion',
      text: `${item.suggestion}: "${short(y?.says ?? '', 160)}". ${mover[0]?.toUpperCase()}${mover.slice(1)}.`,
    }
  },
  DecideResult: (d, item) => {
    const w = d.moment.work
    const t = taskAt(w, resultAt(w, item.result).task)
    const role = item.leaf._tag === 'Role' ? item.leaf.role : ''
    return {
      title: 'A result waits for its decider',
      text: `${item.result} on ${t.id} waits for the accept of ${an(role)}, and none works on it. Assign one.`,
    }
  },
  IdleTask: (d, item) => {
    const t = taskAt(d.moment.work, item.task)
    return {
      title: 'A task with no agent',
      text: `${t.id} ${t.name} is ${stateWord(d, t.id)}, and no agent works on it. Assign one.`,
    }
  },
  BriefOver: (d, item) => {
    const w = d.moment.work
    const s = d.states.assignments.get(item.assignment)
    const a = w.assignments.get(item.assignment)
    const size = s?._tag === 'BriefOver' ? `${s.size} characters, over its limit of ${s.limit}` : ''
    return {
      title: 'A brief over its limit',
      text:
        `${item.assignment} (${a?.role} on ${item.task}) waits: its brief has ${size}. Suggest ` +
        `shorter words for a direction of ${item.task}, or split ${item.task}.`,
    }
  },
}
export const stepCardOf = (
  d: Derived,
  item: Of<StepKind>,
  base: Omit<Extract<Decision, { readonly _tag: 'Step' }>, '_tag' | 'title' | 'text'>,
): Extract<Decision, { readonly _tag: 'Step' }> => {
  const words = (WORDS[item._tag] as (d: Derived, item: Of<StepKind>) => Words)(d, item)
  return { _tag: 'Step', ...base, ...words }
}
