// The stored form of the acts of the work model (core/state/work/types.ts): the schemas of its
// item records, its What members and its Act, and the two events of the Work group. A Map or a
// Set is an array in the store; the decoded value is the Map or the Set of types.ts.
import { Schema, SchemaGetter } from 'effect'

const setOf = <V extends Schema.Top>(value: V) =>
  Schema.Array(value).pipe(
    Schema.decodeTo(Schema.ReadonlySet(value), {
      decode: SchemaGetter.transform((xs) => new Set(xs)),
      encode: SchemaGetter.transform((set) => [...set]),
    }),
  )

const Str = Schema.String
const Strs = Schema.Array(Str)
const Int = Schema.Number.pipe(Schema.check(Schema.isInt()))

export const Form = Schema.Literals(['none', 'mech', 'ref', 'both'])
export const ItemRec = Schema.Struct({
  kind: Schema.Literals(['dir', 'std', 'rule']),
  parent: Schema.NullOr(Str),
  name: Str,
  says: Str,
  where: Schema.NullOr(Strs),
  test: Schema.NullOr(Str),
  ref: Schema.NullOr(Str),
  form: Form,
  examples: Schema.Array(
    Schema.Struct({ fits: Schema.Literals(['follows', 'breaks']), sample: Str }),
  ),
})
export type ItemRec = typeof ItemRec.Type

export const Level = Schema.Literals(['Split', 'Fit', 'Principle', 'Direct', 'Standard'])
export const Verdict = Schema.Literals(['Pass', 'Fail', 'RaiseTries', 'RaiseNoRule', 'RaiseMisses'])
export const RoleDraft = Schema.Struct({ role: Str, words: Str, model: Str })
export const TaskSpec = Schema.Struct({ name: Str, goal: Str, sections: Strs, role: Str })
export const Versions = Schema.Array(Schema.Tuple([Str, Int])).pipe(
  Schema.decodeTo(Schema.ReadonlyMap(Str, Int), {
    decode: SchemaGetter.transform((pairs) => new Map(pairs)),
    encode: SchemaGetter.transform((map) => [...map]),
  }),
)
const Drafted = Schema.NullOr(ItemRec)
export const DraftItems = Schema.Array(Schema.Tuple([Str, Drafted])).pipe(
  Schema.decodeTo(Schema.ReadonlyMap(Str, Drafted), {
    decode: SchemaGetter.transform((pairs) => new Map(pairs)),
    encode: SchemaGetter.transform((map) => [...map]),
  }),
)
export const Keys = setOf(Str)

export const What = Schema.Union([
  Schema.TaggedStruct('EndProject', {}),
  Schema.TaggedStruct('MoveHost', { fromSession: Int }),
  Schema.TaggedStruct('EditDirection', { draft: DraftItems }),
  Schema.TaggedStruct('Reject', { task: Str, points: Strs }),
  Schema.TaggedStruct('Accept', { fix: Str }),
  Schema.TaggedStruct('SendBack', { fix: Str, points: Strs }),
  Schema.TaggedStruct('Decide', { task: Str, take: Schema.Boolean }),
  Schema.TaggedStruct('Answer', { asker: Str, answer: Str }),
  Schema.TaggedStruct('Ask', { asker: Str, question: Str }),
  Schema.TaggedStruct('SendTask', { spec: TaskSpec }),
  Schema.TaggedStruct('Reassign', {}),
  Schema.TaggedStruct('TopDone', {}),
  Schema.TaggedStruct('AssignDo', { task: Str }),
  Schema.TaggedStruct('Review', { task: Str, v: Verdict, points: Strs }),
  Schema.TaggedStruct('Resume', { maker: Str }),
  Schema.TaggedStruct('ReadBrief', { maker: Str }),
  Schema.TaggedStruct('Report', { maker: Str, output: Str, files: Strs, caught: Keys }),
  Schema.TaggedStruct('Evaluate', {
    task: Str,
    level: Level,
    parts: Schema.Array(TaskSpec),
    roleDraft: Schema.NullOr(RoleDraft),
    summary: Str,
  }),
  Schema.TaggedStruct('Advance', { fix: Str }),
  Schema.TaggedStruct('WriteRule', { fix: Str, rule: Str, rec: ItemRec, refOk: Schema.Boolean }),
  Schema.TaggedStruct('RunTest', { fix: Str, own: Schema.Boolean, contra: Strs }),
  Schema.TaggedStruct('Ship', { fix: Str, items: Keys, draft: DraftItems }),
  Schema.TaggedStruct('LoopReview', { fix: Str, toPerson: Schema.Boolean }),
  Schema.TaggedStruct('RecheckDone', { task: Str, items: Keys, holds: Schema.Boolean }),
  Schema.TaggedStruct('RunRule', { task: Str, holds: Schema.Boolean }),
  Schema.TaggedStruct('Revive', { who: Str }),
  Schema.TaggedStruct('Exit', { who: Str }),
])
export type What = typeof What.Type

export const Act = Schema.Struct({
  id: Str,
  who: Str,
  ep: Int,
  what: What,
  seen: Int,
  seenVer: Int,
  vers: Versions,
  old: Schema.Boolean,
})
export type Act = typeof Act.Type

// A token as the store keeps it: the actor and the hash of its secret.
const TokenHash = Schema.Tuple([Str, Str])

// The person opened the top: its items, the cards of the persistent roles, the tries of a task
// before a raise, and the tokens (actor, hash) of the host, the pipe and each role at epoch 0.
export const WorkOpened = Schema.TaggedStruct('Opened', {
  top: Schema.Struct({ name: Str, goal: Str, sections: Strs, directions: Strs }),
  items: Schema.Array(Schema.Tuple([Str, ItemRec])),
  cards: Schema.Array(Schema.Tuple([Str, RoleDraft])),
  maxTries: Int,
  tokens: Schema.Array(TokenHash),
})
// One act the store accepted; token: the new token the act makes (a new maker, a revived role, a
// resumed maker, the host of a move), else null.
export const WorkActed = Schema.TaggedStruct('Acted', {
  act: Act,
  token: Schema.NullOr(TokenHash),
})

// The pane of the host in the person's own tmux (its socket and pane id): bookkeeping that the
// page and the engine read, not an act of the protocol.
export const WorkHostPane = Schema.TaggedStruct('HostPane', { socket: Str, pane: Str })

// The host carries the person's words from its chat as the person's act: it waits on the page for
// the person's confirm (Confirm dispatches it with its `on`) or drop. Bookkeeping, not an act.
export const WorkForwarded = Schema.TaggedStruct('Forwarded', {
  id: Str,
  what: What,
  on: Schema.NullOr(Int),
  quote: Str,
})
// The forward is spent: the person dropped it, or confirmed it.
export const WorkForwardDropped = Schema.TaggedStruct('ForwardDropped', { id: Str })
