// The C16 state the store folds: work.ts WorkState with the model's names (types.qnt Task, Fix,
// MakerState, Store) and the asks of the contract (1.4). The acts' behaviour is elsewhere.
import type {
  DraftItems,
  ItemKey,
  ItemRec,
  Level,
  RoleDraft,
  Top,
  Versions,
} from '../work/types.ts'
import type { ActorKey, AskId, Answered, OpenAsk } from './types.ts'

// The model's words (types.qnt). The code keeps no Unsent: a section no task owns is `uncovered`.
export type Stage =
  | 'Evaluating'
  | 'AtPrinciple'
  | 'AtDirection'
  | 'AtStandard'
  | 'AtRule'
  | 'Testing'
  | 'Drafting'
  | 'InLoop'
  | 'AtPerson'
  | 'Accepted'
  | 'Closed'
export type TaskState = 'Sent' | 'Working' | 'InReview' | 'Raised' | 'Done' | 'Split'
export type FixKind = 'DirectionDraft' | 'RoleDraft'
export type Form = 'NoForm' | 'Mech' | 'Ref' | 'Both'

// The model's ASK_CAP: the questions per ordered pair before the next raises (AskRaise).
export const ASK_CAP = 2

// work.qnt Task with the model's field names. role: the persistent role it is sent to; parent:
// the task it is a part of; directions: the directions it serves; caught (A): the test-command
// rules that print lines on the latest result; at: the seq of its last change.
export interface Task {
  readonly id: string
  readonly name: string
  readonly goal: string
  readonly role: string
  readonly parent: string | null
  readonly sections: ReadonlyArray<string>
  readonly directions: ReadonlyArray<string>
  readonly generation: number
  readonly state: TaskState
  readonly tries: number
  readonly maker: string | null
  readonly resultId: number
  readonly checked: Versions
  readonly pending: ReadonlySet<ItemKey>
  readonly caught: ReadonlySet<ItemKey>
  readonly taken: boolean
  readonly floor: Level
  readonly at: number
}

// The model's MakerState: task is its slot; revisions: the revisions it was sent.
export interface Maker {
  readonly id: string
  readonly task: string
  readonly ended: boolean
  readonly claimed: boolean
  readonly brief: Versions
  readonly revisions: number
}

// The model's Fix. summary: the pending summary for the person (the conclusion first).
export interface Fix {
  readonly stage: Stage
  readonly entry: Stage
  readonly level: Level
  readonly kind: FixKind
  readonly form: Form
  readonly ruleTries: number
  readonly items: ReadonlySet<ItemKey>
  readonly real: ReadonlySet<ItemKey>
  readonly draft: DraftItems
  readonly roleDraft: RoleDraft | null
  readonly roleOnly: boolean
  readonly base: Versions
  readonly cardBase: number
  readonly revision: number
  readonly sentBack: ReadonlySet<number>
  readonly needRevise: boolean
  readonly loopRounds: number
  readonly basisStep: number
  readonly wrote: ReadonlySet<ItemKey>
  readonly climbedTo: Stage
  readonly sendBacks: number
  readonly contradicted: boolean
  // recorded with the draft at Ship: the accept of a contradicted draft clears fights if true
  readonly resolvesFight: boolean
  readonly fights: ReadonlySet<ItemKey>
  readonly at: number
  readonly summary: string
}

// The model's Store. asks: the open asks by occurrence id; answered: a question's answer not yet
// heard; askCount: the questions so far per ordered pair (pairKey); justAnswered: the answerers
// whose last act answered; created: the asks the current act made so far (the id discriminator,
// zero when seq moves); seq: the acts taken so far.
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
  readonly down: ReadonlySet<ActorKey>
  readonly ep: ReadonlyMap<ActorKey, number>
  readonly asks: ReadonlyMap<AskId, OpenAsk>
  readonly answered: ReadonlyMap<AskId, Answered>
  readonly askCount: ReadonlyMap<string, number>
  readonly justAnswered: ReadonlySet<ActorKey>
  readonly askCap: number
  readonly created: number
  readonly nextTask: number
  readonly nextMaker: number
  readonly maxTries: number
  readonly seq: number
}

const NONE: ReadonlySet<never> = new Set()

// The closed fix: a task with no raise open has it.
export const CLOSED: Fix = {
  stage: 'Closed',
  entry: 'Closed',
  level: 'Standard',
  kind: 'DirectionDraft',
  form: 'NoForm',
  ruleTries: 0,
  items: NONE,
  real: NONE,
  draft: new Map(),
  roleDraft: null,
  roleOnly: false,
  base: new Map(),
  cardBase: 0,
  revision: 0,
  sentBack: NONE,
  needRevise: false,
  loopRounds: 0,
  basisStep: 0,
  wrote: NONE,
  climbedTo: 'AtRule',
  sendBacks: 0,
  contradicted: false,
  resolvesFight: false,
  fights: NONE,
  at: 0,
  summary: '',
}

// The person opened the top; the host holds it in session 0. cards: the persistent roles.
export const initState = (
  top: Pick<Top, 'name' | 'goal' | 'sections' | 'directions'>,
  items: ReadonlyMap<ItemKey, ItemRec>,
  cards: ReadonlyMap<string, RoleDraft>,
  maxTries: number,
  askCap: number = ASK_CAP,
): WorkState => ({
  top: { ...top, hostSession: 0, done: false, ended: false },
  session: 0,
  tasks: new Map(),
  makers: new Map(),
  fixes: new Map(),
  items,
  ver: new Map([...items.keys()].map((x) => [x, 0])),
  cards,
  card: new Map([...cards.keys()].map((r) => [r, 0])),
  fixDepth: new Map(),
  down: NONE,
  ep: new Map(),
  asks: new Map(),
  answered: new Map(),
  askCount: new Map(),
  justAnswered: NONE,
  askCap,
  created: 0,
  nextTask: 1,
  nextMaker: 1,
  maxTries,
  seq: 0,
})
