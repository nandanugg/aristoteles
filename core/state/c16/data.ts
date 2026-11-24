// Item records and vocabulary shared by the C16 core and its adapters.
import type { ContextFacts, ScopeConditions } from '../../schema/index.ts'

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
// context conditions (null: everywhere). A rule's evidence: test (a command: no output = holds, each
// printed line a point), ref (`file#anchor:lines`), its form and its examples.
export interface ItemRec {
  readonly kind: ItemKind
  readonly parent: ItemKey | null
  readonly name: string
  readonly says: string
  readonly where: ScopeConditions | null
  readonly test: string | null
  readonly ref: string | null
  readonly form: Form
  readonly examples: ReadonlyArray<Example>
  readonly knownBreaks?: ReadonlyArray<string>
}
export type Versions = ReadonlyMap<ItemKey, number>

export type Verdict = 'Pass' | 'Fail' | 'RaiseTries' | 'RaiseNoRule' | 'RaiseMisses'
export type Level = 'Split' | 'Fit' | 'Principle' | 'Direct' | 'Standard'

// A draft's content: the item records it sets (null: removes the item). A role draft: the role
// card's words and model.
export type DraftItems = ReadonlyMap<ItemKey, ItemRec | null>
export interface RoleDraft {
  readonly role: string
  readonly words: string
  readonly model: string
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
  readonly facts: ContextFacts
  readonly directions: ReadonlyArray<string>
  readonly hostSession: number
  readonly done: boolean
  readonly ended: boolean
}

// A part of a split, or a task the host sends: a strict part of the sections.
export interface TaskSpec {
  readonly name: string
  readonly goal: string
  readonly sections: ReadonlyArray<string>
  readonly facts: ContextFacts
  readonly role: string
}
