import { Effect, Schema } from 'effect'
import { Command, Lines, OutcomeTag, Quote } from './evidence.ts'
import { Human, Role } from './staff.ts'
import {
  ContextValue, ExampleText, FilePath, GitCommit, Goal, GuidanceText,
  Name, QuestionText, RepositoryAddress, Summary, type Of,
} from './values.ts'

export const Stage = Schema.Struct({
  name: Name, role: Role, work: Goal,
  where: Schema.Union([
    Schema.TaggedStruct('Project', {}),
    Schema.TaggedStruct('File', { file: FilePath }),
    Schema.TaggedStruct('Passage', { file: FilePath, lines: Lines }),
  ]),
})
export const Fact = Schema.Struct({
  name: Schema.Literals(['system', 'field', 'language', 'repo', 'audience', 'output']), value: ContextValue,
})
const Scope = Schema.Union([
  Schema.TaggedStruct('Everywhere', {}),
  Schema.TaggedStruct('Where', {
    stages: Schema.Union([
      Schema.TaggedStruct('AllStages', {}),
      Schema.TaggedStruct('NamedStages', { stages: Schema.NonEmptyArray(Stage) }),
    ]),
    facts: Schema.Array(Fact),
  }),
])
export const Rule = Schema.TaggedStruct('Rule', {
  name: Name, text: GuidanceText,
  verification: Schema.Union([
    Command,
    Schema.TaggedStruct('Prompt', { question: QuestionText, source: Quote }),
  ]),
  knownBreaks: Schema.Array(Quote).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  examples: Schema.Array(Schema.Struct({
    example: Schema.Union([Quote, Schema.TaggedStruct('MadeUp', { text: ExampleText })]),
    result: OutcomeTag,
  })),
})
const Standard = Schema.TaggedStruct('Standard', {
  name: Name, text: GuidanceText, scope: Scope, rules: Schema.Array(Rule),
})
export const Direction = Schema.TaggedStruct('Direction', {
  owner: Human,
  source: Schema.Union([
    Schema.TaggedStruct('Local', {}),
    Schema.TaggedStruct('Company', { repository: RepositoryAddress, commit: GitCommit, folder: FilePath }),
  ]),
  name: Name, summary: Summary, text: GuidanceText, stages: Schema.NonEmptyArray(Stage), standards: Schema.Array(Standard),
}).check(Schema.makeFilter((direction) => direction.standards.every(({ scope }) =>
  scope._tag !== 'Where' || scope.stages._tag !== 'NamedStages' ||
  scope.stages.stages.every((named) => direction.stages.some((stage) => JSON.stringify(stage) === JSON.stringify(named))),
)))
export type Direction = Of<typeof Direction>

// Match the stage's work in its direction. A sent task pins the current responsibility.
export const sameStage = (left: Of<typeof Stage>, right: Of<typeof Stage>) =>
  left.name === right.name && left.work === right.work && left.role.key === right.role.key &&
  JSON.stringify(left.where) === JSON.stringify(right.where) ? left : undefined
