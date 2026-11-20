// The stored and wire form of the c16 contract's acts (core/state/c16/types.ts): the schemas of
// the actor, the ask, the typed question and its answer, and the Body of each act. An actor is
// its key on the wire (`keyOf`, `actorOf`: the one pair); a Set is an array.
import { Schema, SchemaGetter } from 'effect'
import {
  DraftItems,
  ItemRec,
  Keys,
  Level,
  RoleDraft,
  TaskSpec,
  Verdict,
  Versions,
} from './work-acts.ts'

const Str = Schema.String
const Strs = Schema.Array(Str)
const Min = <V extends Schema.Top>(item: V, n: number) =>
  Schema.Array(item).check(Schema.isMinLength(n))
const Int = Schema.Number.pipe(Schema.check(Schema.isInt()))

const ActorCase = Schema.Union([
  Schema.TaggedStruct('Human', {}),
  Schema.TaggedStruct('Host', {}),
  Schema.TaggedStruct('Role', { name: Str }),
  Schema.TaggedStruct('Pipe', {}),
  Schema.TaggedStruct('Harness', {}),
  Schema.TaggedStruct('Maker', { id: Str }),
])
export type ActorCase = typeof ActorCase.Type

// 'human' | 'host' | 'pipe' | 'harness' | 'role:<name>' | 'maker:<id>'; a name or an id may hold
// ':' (the first one ends the tag).
export const keyOf = (a: ActorCase): string => {
  switch (a._tag) {
    case 'Human':
      return 'human'
    case 'Host':
      return 'host'
    case 'Pipe':
      return 'pipe'
    case 'Harness':
      return 'harness'
    case 'Role':
      return `role:${a.name}`
    case 'Maker':
      return `maker:${a.id}`
  }
}

// Total on the keys keyOf made; any other key throws.
export const actorOf = (k: string): ActorCase => {
  if (k === 'human') return { _tag: 'Human' }
  if (k === 'host') return { _tag: 'Host' }
  if (k === 'pipe') return { _tag: 'Pipe' }
  if (k === 'harness') return { _tag: 'Harness' }
  if (k.startsWith('role:')) return { _tag: 'Role', name: k.slice(5) }
  if (k.startsWith('maker:')) return { _tag: 'Maker', id: k.slice(6) }
  throw new Error(`not an actor key: ${k}`)
}

// Only a key keyOf can make decodes: a malformed key fails the check, never throws.
const ActorKey = Str.check(Schema.isPattern(/^(human|host|pipe|harness|role:.*|maker:.*)$/s))
export const Actor = ActorKey.pipe(
  Schema.decodeTo(ActorCase, {
    decode: SchemaGetter.transform(actorOf),
    encode: SchemaGetter.transform(keyOf),
  }),
)

const Prompt = Schema.Struct({ description: Str, placeholder: Str })
export const QuestionForm = Schema.Union([
  Schema.TaggedStruct('Single', {}),
  Schema.TaggedStruct('Multiple', { questions: Min(Prompt, 1) }),
  Schema.TaggedStruct('Choice', { options: Min(Str, 2), multi: Schema.Boolean }),
  Schema.TaggedStruct('Matrix', { rows: Min(Str, 1), columns: Min(Str, 2) }),
])
export const QuestionBody = Schema.Struct({ title: Str, form: QuestionForm })

export const AnswerBody = Schema.Union([
  Schema.TaggedStruct('Single', { text: Str }),
  Schema.TaggedStruct('Multiple', { texts: Strs }),
  Schema.TaggedStruct('Choice', { picked: Schema.Array(Int) }),
  Schema.TaggedStruct('Matrix', { cells: Schema.Array(Int) }),
])

export const Ask = Schema.Struct({
  id: Str,
  kind: Schema.Literals(['Question', 'Execute', 'Check', 'Decide']),
  from: Actor,
  to: Actor,
  about: Schema.Union([
    Schema.TaggedStruct('Task', { id: Str }),
    Schema.TaggedStruct('Fix', { id: Str }),
    Schema.TaggedStruct('None', {}),
  ]),
})

const Reply = Schema.Literals(['AcceptIt', 'SendItBack', 'TakeAsIs', 'EvaluateAgain'])
const OpenBody = Schema.Union([
  Schema.TaggedStruct('OpenQuestion', { to: Actor, question: QuestionBody }),
  Schema.TaggedStruct('OpenSend', { spec: TaskSpec }),
  Schema.TaggedStruct('OpenMake', { task: Str }),
  Schema.TaggedStruct('OpenReject', { task: Str, points: Strs }),
])

export const Body = Schema.Union([
  Schema.TaggedStruct('Open', { open: OpenBody }),
  Schema.TaggedStruct('AskEdit', { draft: DraftItems }),
  Schema.TaggedStruct('AnswerQuestion', { ask: Str, answer: AnswerBody }),
  Schema.TaggedStruct('Hear', { ask: Str }),
  Schema.TaggedStruct('AskRaise', { to: Actor }),
  Schema.TaggedStruct('ReadBrief', { maker: Str }),
  Schema.TaggedStruct('Resume', { maker: Str }),
  Schema.TaggedStruct('Report', { ask: Str, output: Str, files: Strs, caught: Keys }),
  Schema.TaggedStruct('Review', { ask: Str, verdict: Verdict, points: Strs }),
  Schema.TaggedStruct('Evaluate', {
    fix: Str,
    level: Level,
    parts: Schema.Array(TaskSpec),
    roleDraft: Schema.NullOr(RoleDraft),
    summary: Str,
  }),
  Schema.TaggedStruct('Advance', { fix: Str }),
  Schema.TaggedStruct('WriteRule', {
    fix: Str,
    rule: Str,
    rec: ItemRec,
    refOk: Schema.Boolean,
    fights: Strs,
  }),
  Schema.TaggedStruct('RunTest', { fix: Str, own: Schema.Boolean, contra: Strs }),
  Schema.TaggedStruct('Ship', {
    fix: Str,
    items: Keys,
    draft: DraftItems,
    resolvesFight: Schema.Boolean,
  }),
  Schema.TaggedStruct('LoopReview', { fix: Str, toPerson: Schema.Boolean }),
  Schema.TaggedStruct('Respond', { ask: Str, reply: Reply, points: Strs }),
  Schema.TaggedStruct('Reassign', {}),
  Schema.TaggedStruct('TopDone', {}),
  Schema.TaggedStruct('RecheckDone', { task: Str, items: Keys, holds: Schema.Boolean }),
  Schema.TaggedStruct('RunRule', { task: Str, holds: Schema.Boolean }),
  Schema.TaggedStruct('Revive', { actor: Actor }),
  Schema.TaggedStruct('Exit', { actor: Actor }),
  Schema.TaggedStruct('EndProject', {}),
  Schema.TaggedStruct('MoveHost', { fromSession: Int }),
])

// The envelope of an act: its own id, the sender, its epoch and basis, and the body.
export const ActEnvelope = Schema.Struct({
  id: Str,
  who: Actor,
  ep: Int,
  seen: Int,
  seenVer: Int,
  vers: Versions,
  old: Schema.Boolean,
  body: Body,
})

export const RefusalName = Schema.Literals([
  'ended',
  'authority',
  'epoch',
  'legal',
  'basis',
  'build',
  'stale',
  'form',
  'pair',
  'cap',
  'heard',
  'terminal',
])
export type RefusalNameCase = typeof RefusalName.Type
export const Refusal = Schema.Struct({
  refused: RefusalName,
  words: Str,
  next: Schema.optionalKey(Str),
})
