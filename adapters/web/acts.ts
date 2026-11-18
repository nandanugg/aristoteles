// The acts of the person on the page that are one action of core/actions: the page's act, the
// ActionCall that it makes, and the words of its answer. The person acts on the ui channel; the
// act words are the page's own short lines (the CLI prints more, and the page needs only these).
import { Schema } from 'effect'
import { WORK } from '../../core/actions/work.ts'
import type { ActionCall, Refusal } from '../../core/actions/types.ts'
import type { Refusal as Check } from '../../core/derived/work/accept.ts'
import { type Author, type CreatedId, WhatSchema } from '../../core/schema/index.ts'
import { PERSON } from '../../core/state/work/types.ts'
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
      | 'resolve'
      | 'accept-evaluation'
      | 'reject-evaluation'
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
          content: { reason: act.reason },
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
          content: { points: [{ text: act.reason, breaks: null }] },
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
    case 'resolve':
      return {
        by,
        input: {
          _tag: 'Resolve',
          target: { escalation: act.escalation },
          content: { resolution: act.text, evidence: [] },
        },
      }
    // An accept of an evaluation says what the person read in it (P1, D1).
    case 'accept-evaluation': {
      const evidence = [{ rule: null, where: `evaluation ${act.evaluation}`, what: act.text }]
      return {
        by,
        input: {
          _tag: 'Accept',
          target: { of: { _tag: 'Evaluation', id: act.evaluation } },
          content: { evidence, reason: null },
        },
      }
    }
    case 'reject-evaluation':
      return {
        by,
        input: {
          _tag: 'Reject',
          target: { of: { _tag: 'Evaluation', id: act.evaluation } },
          content: { reason: act.reason },
        },
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
    case 'resolve':
      return `${act.escalation} resolved.`
    case 'accept-evaluation':
      return `${act.evaluation} accepted; it counts now.`
    case 'reject-evaluation':
      return `${act.evaluation} rejected.`
  }
}

// --- the person's acts of the work model (POST /api/act) -----------------------------------------

// What the page posts: an act of the person with the view's seq (`on`) and the page's build, the
// confirm of a forward of the host (with the build), or its drop.
export const WorkPost = Schema.Union([
  Schema.Struct({ act: WhatSchema, on: Schema.NullOr(Schema.Int), build: Schema.String }),
  Schema.Struct({ confirm: Schema.String, build: Schema.String }),
  Schema.Struct({ drop: Schema.String }),
])
export type WorkPost = typeof WorkPost.Type

export const workPostOf = (body: unknown): WorkPost | undefined => {
  const decoded = Schema.decodeUnknownOption(WorkPost)(body)
  return decoded._tag === 'Some' ? decoded.value : undefined
}

const CHECKS: ReadonlyArray<Check> = ['ended', 'authority', 'epoch', 'legal', 'basis', 'build']

// The words of a check have its act's tag in them: a message fits the check whose words, with
// any tag, make it.
const checkOf = (message: string): string => {
  const fits = (c: Check) => {
    const [head = '', tail = ''] = WORK.checks(c, PERSON, '\0').message.split('\0')
    return message.startsWith(head) && message.endsWith(tail)
  }
  return CHECKS.find(fits) ?? 'refused'
}

// The answer of a refused act: the check that refused it (or 'refused' for a refusal before the
// checks: no top, no forward, a basis that is missing), its words, and what to do next.
export const refusedOf = (r: Refusal) => ({
  refused: checkOf(r.message),
  words: r.message,
  next: r.choice.words,
})
