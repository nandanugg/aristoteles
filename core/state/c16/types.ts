// The core contract of C16 (plan/C16-CONTRACT.md, section 1 as amended): actors, asks, the typed
// question, one record per act, the asks of the state, steps and obligations, refusal names.
// Types, the key functions and the one answer validator; the behaviour is built on them.
import { type ActorCase, type LoopReviewMode, type RefusalNameCase, actorOf, keyOf } from '../../schema/index.ts'
import type {
  DraftItems,
  ItemKey,
  ItemRec,
  Level,
  RoleDraft,
  TaskSpec,
  Verdict,
  Versions,
} from './data.ts'

// --- actors --------------------------------------------------------------------------------------

// Derived from the schema's type: a new case cannot drift.
export type Actor = ActorCase
// The string key of maps, sets, tokens and the store's JSON: keyOf and actorOf, nowhere else.
export type ActorKey = string
export { actorOf, keyOf }
export const isMaker = (a: Actor): a is Extract<Actor, { _tag: 'Maker' }> => a._tag === 'Maker'
// Host, Role, Pipe and Maker have an epoch.
export const hasEpoch = (a: Actor): boolean =>
  a._tag === 'Host' || a._tag === 'Role' || a._tag === 'Pipe' || a._tag === 'Maker'
// Host, Role and Pipe live as long as the project: revived, never ended.
export const isPersistent = (a: Actor): boolean =>
  a._tag === 'Host' || a._tag === 'Role' || a._tag === 'Pipe'

// --- asks ----------------------------------------------------------------------------------------

export type AskKind = 'Question' | 'Execute' | 'Check' | 'Decide'
export type AskAbout =
  | { readonly _tag: 'Task'; readonly id: string }
  | { readonly _tag: 'Fix'; readonly id: string }
  | { readonly _tag: 'None' }
// The creating event's seq, plus '.n' (n >= 1) when one event creates several asks. Unique within
// a project's event stream, never reused.
export type AskId = string
export interface Ask {
  readonly id: AskId
  readonly kind: AskKind
  readonly from: Actor
  readonly to: Actor
  readonly about: AskAbout
}
// The key of an ordered pair (the question cap, the one-open rule): an unambiguous tuple.
export const pairKey = (from: Actor, to: Actor): string => JSON.stringify([keyOf(from), keyOf(to)])

// --- the typed question --------------------------------------------------------------------------

export interface Prompt {
  readonly description: string
  readonly placeholder: string
}
export type QuestionForm =
  | { readonly _tag: 'Single' }
  | { readonly _tag: 'Multiple'; readonly questions: ReadonlyArray<Prompt> }
  | { readonly _tag: 'Choice'; readonly options: ReadonlyArray<string>; readonly multi: boolean }
  | {
    readonly _tag: 'Matrix'
    readonly rows: ReadonlyArray<string>
    readonly columns: ReadonlyArray<string>
  }
export interface QuestionBody {
  readonly title: string
  readonly form: QuestionForm
}
export type AnswerBody =
  | { readonly _tag: 'Single'; readonly text: string }
  | { readonly _tag: 'Multiple'; readonly texts: ReadonlyArray<string> }
  | { readonly _tag: 'Choice'; readonly picked: ReadonlyArray<number> }
  | { readonly _tag: 'Matrix'; readonly cells: ReadonlyArray<number> }

const inRange = (i: number, n: number): boolean => Number.isInteger(i) && i >= 0 && i < n

// The one validity rule of an answer: the store, the CLI and the page all use it.
export const answers = (form: QuestionForm, a: AnswerBody): boolean => {
  switch (form._tag) {
    case 'Single':
      return a._tag === 'Single' && a.text !== ''
    case 'Multiple':
      return a._tag === 'Multiple' && a.texts.length === form.questions.length
    case 'Choice':
      return a._tag === 'Choice' && a.picked.length >= 1 &&
        (form.multi || a.picked.length === 1) &&
        a.picked.every(
          (i, n) => inRange(i, form.options.length) && (n === 0 || i > a.picked[n - 1]!),
        )
    case 'Matrix':
      return a._tag === 'Matrix' && a.cells.length === form.rows.length &&
        a.cells.every((i) => inRange(i, form.columns.length))
  }
}

// --- acts ----------------------------------------------------------------------------------------

export type Reply = 'AcceptIt' | 'SendItBack' | 'TakeAsIs' | 'EvaluateAgain'
export type OpenBody =
  | { readonly _tag: 'OpenQuestion'; readonly to: Actor; readonly question: QuestionBody }
  | { readonly _tag: 'OpenSend'; readonly spec: TaskSpec }
  | { readonly _tag: 'OpenMake'; readonly task: string }
  | { readonly _tag: 'OpenReject'; readonly task: string; readonly points: ReadonlyArray<string> }

// One record per act; A marks what the store or the harness fills.
export type Body =
  | { readonly _tag: 'Open'; readonly open: OpenBody }
  | { readonly _tag: 'AskEdit'; readonly draft: DraftItems }
  | { readonly _tag: 'AnswerQuestion'; readonly ask: AskId; readonly answer: AnswerBody }
  | { readonly _tag: 'Hear'; readonly ask: AskId }
  | { readonly _tag: 'AskRaise'; readonly to: Actor }
  | { readonly _tag: 'ReadBrief'; readonly maker: string }
  | { readonly _tag: 'Resume'; readonly maker: string }
  | {
    readonly _tag: 'Report'
    readonly ask: AskId
    readonly output: string
    readonly files: ReadonlyArray<string>
    readonly caught: ReadonlySet<ItemKey> // A
  }
  | {
    readonly _tag: 'Review'
    readonly ask: AskId
    readonly verdict: Verdict
    readonly points: ReadonlyArray<string>
  }
  | {
    readonly _tag: 'Evaluate'
    readonly fix: string
    readonly level: Level
    readonly parts: ReadonlyArray<TaskSpec>
    readonly roleDraft: RoleDraft | null
    readonly summary: string
  }
  | { readonly _tag: 'Advance'; readonly fix: string }
  | {
    readonly _tag: 'WriteRule'
    readonly fix: string
    readonly rule: ItemKey
    readonly rec: ItemRec
    readonly refOk: boolean // A
    // The role's claim of the other rules its rule contradicts: for a rule with no test command
    // (Ref); a rule with one keeps the harness's verdict (RunTest contra).
    readonly fights: ReadonlyArray<ItemKey>
  }
  | {
    readonly _tag: 'RunTest'
    readonly fix: string
    readonly own: boolean // A
    readonly contra: ReadonlyArray<ItemKey> // A
  }
  | {
    readonly _tag: 'Ship'
    readonly fix: string
    readonly items: ReadonlySet<ItemKey>
    readonly draft: DraftItems
    // The drafted direction resolves the rule's contradiction: the harness's cross test for a
    // rule with a test command, the pipeline role's claim for a reference-only rule.
    readonly resolvesFight: boolean
  }
  | {
      readonly _tag: 'LoopReview'
      readonly fix: string
      readonly toPerson: boolean
      readonly mode: LoopReviewMode
    }
  | {
    readonly _tag: 'Respond'
    readonly ask: AskId
    readonly reply: Reply
    readonly points: ReadonlyArray<string>
  }
  | { readonly _tag: 'Reassign' }
  | { readonly _tag: 'TopDone' }
  | {
    readonly _tag: 'RecheckDone'
    readonly task: string
    readonly items: ReadonlySet<ItemKey>
    readonly holds: boolean
  }
  | { readonly _tag: 'RunRule'; readonly task: string; readonly holds: boolean } // A holds
  | { readonly _tag: 'Revive'; readonly actor: Actor }
  | { readonly _tag: 'Exit'; readonly actor: Actor }
  | { readonly _tag: 'EndProject' }
  | { readonly _tag: 'MoveHost'; readonly fromSession: number }

// An act as it reaches the store. id: its own idempotency id; who, ep: the token and its epoch;
// seen, seenVer, vers: the basis it was built on; old: from an old build of the page.
export interface Act {
  readonly id: string
  readonly who: Actor
  readonly ep: number
  readonly seen: number
  readonly seenVer: number
  readonly vers: Versions
  readonly old: boolean
  readonly body: Body
}

// --- the asks of the state -----------------------------------------------------------------------

export interface OpenAsk extends Ask {
  readonly at: number
  readonly question: QuestionBody | null
}
export interface Answered {
  readonly ask: OpenAsk
  readonly answer: AnswerBody
  readonly at: number
}
// --- what wait tells -----------------------------------------------------------------------------

export interface Step {
  readonly act: Body['_tag']
  readonly ask: AskId | null
  readonly task: string | null
  readonly fix: string | null
  readonly maker: string | null
  readonly actor: ActorKey | null
}
export type Obligation =
  | { readonly _tag: 'SendOb'; readonly task: string }
  | { readonly _tag: 'AskOb'; readonly ask: AskId }
  | { readonly _tag: 'HearOb'; readonly ask: AskId }
  | { readonly _tag: 'ResumeOb'; readonly maker: string }
  | { readonly _tag: 'PipeOb'; readonly fix: string }
  | { readonly _tag: 'ReassignOb' }
  | { readonly _tag: 'ReviveOb'; readonly actor: ActorKey }
  | { readonly _tag: 'RecheckOb'; readonly task: string }
  | { readonly _tag: 'RuleRunOb'; readonly task: string }
  | { readonly _tag: 'EndOb' }
  | { readonly _tag: 'TopDoneOb' }
export interface Owed {
  readonly ob: Obligation
  readonly owner: ActorKey
  readonly age: number
}

// Derived from the schema: the list of names exists once.
export type RefusalName = RefusalNameCase
export interface Refusal {
  readonly refused: RefusalName
  readonly words: string
  readonly next?: string
}
