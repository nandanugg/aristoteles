// The acts of the person on the page that are one action of core/actions: the page's act, the
// ActionCall that it makes, and the words of its answer. The person acts on the ui channel; the
// act words are the page's own short lines (the CLI prints more, and the page needs only these).
import type { ActionCall } from '../../core/actions/types.ts'
import type { Author, CreatedId } from '../../core/schema/index.ts'
import type { PageAct } from './contract.ts'

// The acts that dispatch makes: a PageAct that is not here is a terminal act or the settings (the
// server runs those).
export type ActionAct = Extract<
  PageAct,
  {
    readonly act:
      | 'accept-draft'
      | 'reject-draft'
      | 'confirm'
      | 'answer'
      | 'end'
      | 'reject-task'
      | 'accept-words'
      | 'reject-words'
      | 'accept-adjustment'
      | 'reject-adjustment'
      | 'suggest'
  }
>

export const callOf = (act: ActionAct, by: Author): ActionCall => {
  switch (act.act) {
    case 'accept-draft':
      return {
        by,
        input: {
          _tag: 'Accept',
          target: { of: { _tag: 'Revision', id: act.draft } },
          content: { evidence: [], reason: act.comment?.trim() ? act.comment : null },
        },
      }
    case 'reject-draft':
      return {
        by,
        input: {
          _tag: 'Reject',
          target: { of: { _tag: 'Revision', id: act.draft } },
          content: { points: [], reason: act.reason },
        },
      }
    case 'confirm':
      return { by, input: { _tag: 'Confirm', target: { forward: act.forward }, content: {} } }
    // The person's answer counts at once (no forward, no confirm).
    case 'answer':
      return {
        by,
        input: { _tag: 'Answer', target: { question: act.question }, content: { text: act.text } },
      }
    case 'end':
      return { by, input: { _tag: 'EndRun', target: { run: act.run }, content: {} } }
    case 'reject-task':
      return {
        by,
        input: {
          _tag: 'Reject',
          target: { of: { _tag: 'Task', id: act.task } },
          content: { points: [{ text: act.reason, breaks: null }], reason: null },
        },
      }
    case 'accept-words':
      return { by, input: { _tag: 'AcceptRoleWords', target: { draft: act.draft }, content: {} } }
    case 'reject-words':
      return {
        by,
        input: {
          _tag: 'RejectRoleWords',
          target: { draft: act.draft },
          content: { reason: act.reason },
        },
      }
    case 'accept-adjustment':
      return { by, input: { _tag: 'AcceptAdjustment', target: { draft: act.draft }, content: {} } }
    case 'reject-adjustment':
      return {
        by,
        input: {
          _tag: 'RejectAdjustment',
          target: { draft: act.draft },
          content: { reason: act.reason },
        },
      }
    case 'suggest':
      return {
        by,
        input: { _tag: 'Suggest', target: { about: act.about }, content: { says: act.says } },
      }
  }
}

const made = (created: ReadonlyArray<CreatedId>): string =>
  created.length ? ` -> ${created.join(', ')}` : ''

// The words of the answer, after the act stored its event (the ids that it made).
export const wordsOf = (act: ActionAct, created: ReadonlyArray<CreatedId>): string => {
  switch (act.act) {
    case 'accept-draft':
      return `${act.draft} accepted${made(created)}.`
    case 'reject-draft':
      return `${act.draft} rejected${made(created)}.`
    case 'confirm':
      return `${act.forward} confirmed${made(created)}.`
    case 'answer':
      return `${act.question} answered.`
    case 'end':
      return `${act.run} is done.`
    case 'reject-task':
      return `${act.task} rejected${made(created)}.`
    // The accept wrote the words into aristoteles.yaml; the role needs its fit again.
    case 'accept-words':
      return `${act.draft} accepted: the new words are in aristoteles.yaml; record the fit again.`
    case 'reject-words':
      return `${act.draft} rejected.`
    case 'accept-adjustment':
      return `${act.draft} accepted.`
    case 'reject-adjustment':
      return `${act.draft} rejected.`
    // As work suggest says it: what answers the suggestion.
    case 'suggest':
      return act.about._tag === 'Roles'
        ? `${created.join(', ')}: a suggestion about the roles; an adjustment of a role answers it.`
        : `${created.join(', ')}: a suggestion; a draft of a direction answers it.`
  }
}
