// The work model of core/model/work.qnt in TS: the state the store folds and the acts it takes.
// Names follow work.qnt so a trace of the model can be replayed on the code (P3). What differs:
// ids instead of the model's small sets (tasks, makers, items, roles), the environment's truths
// (cause, hits, broken, fights, truth) are not state but what the harness and the agents report,
// and every check of the model's FIXED configuration is on (no options).
// Who fills an act's field: the sender (S), or the store or the harness at the append (A).

// --- actors --------------------------------------------------------------------------------------

// 'person', 'harness' (the engine: pump, hooks, watcher, test runner), 'host', 'pipe' (the
// pipeline role), `role:<name>` (a persistent role, its card), `maker:<assignment>`.
export type Actor = string
export const PERSON: Actor = 'person'
export const HARNESS: Actor = 'harness'
export const HOST: Actor = 'host'
export const PIPE: Actor = 'pipe'
export const roleActor = (name: string): Actor => `role:${name}`
export const makerActor = (id: string): Actor => `maker:${id}`
export const isMakerActor = (k: Actor): boolean => k.startsWith('maker:')
export const isRoleActor = (k: Actor): boolean => k.startsWith('role:')
// The actors that live as long as the project (DESIGN 12): revived, never ended.
export const isPersistent = (k: Actor): boolean => k === HOST || k === PIPE || isRoleActor(k)

// --- items (DESIGN 9) ----------------------------------------------------------------------------

// `dir:<id>`, `std:<id>`, `rule:<id>`: each item has its own version.
export type ItemKey = string
export type ItemKind = 'dir' | 'std' | 'rule'
export const kindOf = (x: ItemKey): ItemKind => x.slice(0, x.indexOf(':')) as ItemKind
export type Form = 'none' | 'mech' | 'ref' | 'both'
export const hasMech = (f: Form): boolean => f === 'mech' || f === 'both'
export const hasRef = (f: Form): boolean => f === 'ref' || f === 'both'
// One example of a rule: a text or a place (`file#anchor:lines`) that follows or breaks it.
export interface Example {
  readonly fits: 'follows' | 'breaks'
  readonly sample: string
}
// An item's record. parent: a standard's direction, a rule's standard. where: a standard's
// sections (null: every section). A rule's evidence: test (a command: no output = holds, each
// printed line a point), ref (`file#anchor:lines`), its form and its examples.
export interface ItemRec {
  readonly kind: ItemKind
  readonly parent: ItemKey | null
  readonly name: string
  readonly says: string
  readonly where: ReadonlyArray<string> | null
  readonly test: string | null
  readonly ref: string | null
  readonly form: Form
  readonly examples: ReadonlyArray<Example>
}
export type Versions = ReadonlyMap<ItemKey, number>

// --- tasks, makers, fixes ------------------------------------------------------------------------

// Split: the task was split; it is done when its parts are (a raised task's parts own a strict
// part of its sections). The rest as work.qnt TS.
export type TS = 'Sent' | 'Working' | 'InReview' | 'Raised' | 'Done' | 'Split'
export type Verdict = 'Pass' | 'Fail' | 'RaiseTries' | 'RaiseNoRule' | 'RaiseMisses'
export type Level = 'Split' | 'Fit' | 'Principle' | 'Direct' | 'Standard'
export type Stage =
  | 'SEval'
  | 'SPrinciple'
  | 'SDirAssess'
  | 'SStdAssess'
  | 'SRuleAssess'
  | 'STest'
  | 'SDraft'
  | 'SLoop'
  | 'SAtPerson'
  | 'SAccepted'
  | 'SClosed'
export type DKind = 'DDir' | 'DRole'

// work.qnt Task. role: the persistent role it is sent to; parent: the task it is a part of;
// sections: the sections of the top it owns; directions: the directions it serves. rid: the id
// of its latest result; checked: the item versions it was made or last checked under; pend:
// items of a done task still to recheck; floor: the lowest level of its next evaluation;
// caught (A): the test-command rules that print lines on the latest result (the harness runs
// them at the report); taken: the person took it as it is.
export interface Task {
  readonly id: string
  readonly name: string
  readonly goal: string
  readonly role: string
  readonly parent: string | null
  readonly sections: ReadonlyArray<string>
  readonly directions: ReadonlyArray<string>
  readonly gen: number
  readonly st: TS
  readonly tries: number
  readonly maker: string | null
  readonly rid: number
  readonly checked: Versions
  readonly pend: ReadonlySet<ItemKey>
  readonly caught: ReadonlySet<ItemKey>
  readonly taken: boolean
  readonly floor: Level
  // The seq of its last change (the age of what it owes).
  readonly at: number
}

// work.qnt Maker: a `do` subagent of a task's role, one per assignment; revs: the revisions it
// was sent (a Fail sends the review points to the same maker); brief: the item versions it read.
export interface Maker {
  readonly id: string
  readonly task: string
  readonly ended: boolean
  readonly claim: boolean
  readonly brief: Versions
  readonly revs: number
}

// A draft's content: the item records it sets (null: removes the item). A role draft: the role
// card's words and model.
export type DraftItems = ReadonlyMap<ItemKey, ItemRec | null>
export interface RoleDraft {
  readonly role: string
  readonly words: string
  readonly model: string
}

// work.qnt Fix: a raise (keyed by its task) or the person's direction edit (EDIT), and what
// follows it. items: what the draft names as changed (S); real: what its content changes (A,
// the store diffs it against the records); base: the item versions it was built on; cardBase:
// the role card's version it was built on; step: the basis of every act on it.
export interface Fix {
  readonly stage: Stage
  readonly entry: Stage
  readonly level: Level
  readonly kind: DKind
  readonly form: Form
  readonly ruleTries: number
  readonly items: ReadonlySet<ItemKey>
  readonly real: ReadonlySet<ItemKey>
  readonly draft: DraftItems
  readonly roleDraft: RoleDraft | null
  readonly roleOnly: boolean
  readonly base: Versions
  readonly cardBase: number
  readonly rev: number
  readonly sentBack: ReadonlySet<number>
  readonly needRevise: boolean
  readonly loops: number
  readonly step: number
  readonly wrote: ReadonlySet<ItemKey>
  readonly climb: Stage
  readonly backs: number
  readonly contradicted: boolean
  // The rules of the direction this draft's rule fails an example of (the cross test, A).
  readonly fights: ReadonlySet<ItemKey>
  // The seq of its last change (the age of what it owes).
  readonly at: number
  // The pending summary for the person (a Minto pyramid: the conclusion first).
  readonly summary: string
}
export const EDIT = 'edit'
// A fix with no task: the person's edit.
export const free = (i: string): boolean => i === EDIT

// The top: the person's task, held by the host for the whole project (DESIGN 12). sections: the
// sections the host covers with its tasks; hostSession: the session the host assignment is bound
// to; done: the host returned it; ended: the person ended the project.
export interface Top {
  readonly name: string
  readonly goal: string
  readonly sections: ReadonlyArray<string>
  readonly directions: ReadonlyArray<string>
  readonly hostSession: number
  readonly done: boolean
  readonly ended: boolean
}

// work.qnt Store. items: the records of directions, standards and rules; ver: each item's
// version; cards: each role's card and its version; fixDepth: per item, the depth of the level
// of its last fix from a task's raise (-1 none); down: the actors whose exit is recorded; ep:
// each actor's epoch.
export interface WorkState {
  readonly top: Top
  readonly session: number
  readonly tasks: ReadonlyMap<string, Task>
  readonly makers: ReadonlyMap<string, Maker>
  readonly fixes: ReadonlyMap<string, Fix>
  readonly items: ReadonlyMap<ItemKey, ItemRec>
  readonly ver: Versions
  readonly cards: ReadonlyMap<string, RoleDraft>
  readonly card: ReadonlyMap<string, number>
  readonly fixDepth: ReadonlyMap<ItemKey, number>
  readonly down: ReadonlySet<Actor>
  readonly ep: ReadonlyMap<Actor, number>
  readonly nextTask: number
  readonly nextMaker: number
  // The tries of a task before a raise (config); seq: the acts taken so far.
  readonly maxTries: number
  readonly seq: number
}

// --- acts ----------------------------------------------------------------------------------------

// A part of a split, or a task the host sends: a strict part of the sections.
export interface TaskSpec {
  readonly name: string
  readonly goal: string
  readonly sections: ReadonlyArray<string>
  readonly role: string
}

// work.qnt What, with the content each act carries (S unless marked A).
export type What =
  | { readonly _tag: 'EndProject' }
  // fromSession: the basis (the session it moves from; a second copy is refused).
  | { readonly _tag: 'MoveHost'; readonly fromSession: number }
  // wrote: what the person wrote, built on vers (the versions the page showed).
  | { readonly _tag: 'EditDirection'; readonly draft: DraftItems }
  | { readonly _tag: 'Reject'; readonly task: string; readonly points: ReadonlyArray<string> }
  | { readonly _tag: 'Accept'; readonly fix: string }
  | { readonly _tag: 'SendBack'; readonly fix: string; readonly points: ReadonlyArray<string> }
  // take: take the result as it is; else back to evaluation.
  | { readonly _tag: 'Decide'; readonly task: string; readonly take: boolean }
  | { readonly _tag: 'SendTask'; readonly spec: TaskSpec }
  | { readonly _tag: 'Reassign' }
  | { readonly _tag: 'TopDone' }
  | { readonly _tag: 'AssignDo'; readonly task: string }
  | {
    readonly _tag: 'Review'
    readonly task: string
    readonly v: Verdict
    readonly points: ReadonlyArray<string>
  }
  | { readonly _tag: 'Resume'; readonly maker: string }
  | { readonly _tag: 'ReadBrief'; readonly maker: string }
  // caught (A): the test-command rules that print lines on this result.
  | {
    readonly _tag: 'Report'
    readonly maker: string
    readonly output: string
    readonly caught: ReadonlySet<ItemKey>
  }
  // parts: for Split; roleDraft: for Fit; summary: the cause, for the escalation card.
  | {
    readonly _tag: 'Evaluate'
    readonly task: string
    readonly level: Level
    readonly parts: ReadonlyArray<TaskSpec>
    readonly roleDraft: RoleDraft | null
    readonly summary: string
  }
  | { readonly _tag: 'Advance'; readonly fix: string }
  // refOk (A): the harness found the reference.
  | {
    readonly _tag: 'WriteRule'
    readonly fix: string
    readonly rule: ItemKey
    readonly rec: ItemRec
    readonly refOk: boolean
  }
  // own (A): the rule's test holds on its own examples; contra (A): the other rules of the
  // direction whose examples it fails (the cross test).
  | {
    readonly _tag: 'RunTest'
    readonly fix: string
    readonly own: boolean
    readonly contra: ReadonlyArray<ItemKey>
  }
  // items: what the draft names; draft: its content (the store computes `real` from it).
  | {
    readonly _tag: 'Ship'
    readonly fix: string
    readonly items: ReadonlySet<ItemKey>
    readonly draft: DraftItems
  }
  // toPerson: hand the draft to the person; else the loop revises it.
  | { readonly _tag: 'LoopReview'; readonly fix: string; readonly toPerson: boolean }
  // holds: the result still holds against the items it judged (the act's vers).
  | {
    readonly _tag: 'RecheckDone'
    readonly task: string
    readonly items: ReadonlySet<ItemKey>
    readonly holds: boolean
  }
  // holds (A): the test commands of the pending rules print nothing on the result.
  | { readonly _tag: 'RunRule'; readonly task: string; readonly holds: boolean }
  | { readonly _tag: 'Revive'; readonly who: Actor }
  | { readonly _tag: 'Exit'; readonly who: Actor }
export type WhatTag = What['_tag']

// An act as it reaches the store. id: its own id (a second copy is refused, G3 firstTime); who,
// ep: the token and its epoch; seen: the revision of its target it was built on (-1: none);
// seenVer: the sum of the item versions of its view; vers: the item versions its content is
// built on; old (A): it comes from an old build of the page.
export interface Act {
  readonly id: string
  readonly who: Actor
  readonly ep: number
  readonly what: What
  readonly seen: number
  readonly seenVer: number
  readonly vers: Versions
  readonly old: boolean
}
