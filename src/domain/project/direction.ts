import { Effect, Schema } from 'effect'
import { Command, Lines, OutcomeTag, Quote } from './evidence.ts'
import { Human, Role } from './staff.ts'
import {
  ContextValue, DirectionId, ExampleText, FilePath, GitCommit, Goal, GuidanceText,
  Name, QuestionText, RepositoryAddress, RuleId, StageId, StandardId, Summary, type Of,
} from './values.ts'

export const Stage = Schema.Struct({
  id: StageId, name: Name, role: Role, work: Goal,
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
  id: RuleId, name: Name, text: GuidanceText,
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
  id: StandardId, name: Name, text: GuidanceText, scope: Scope, rules: Schema.Array(Rule),
})
export const Direction = Schema.TaggedStruct('Direction', {
  id: DirectionId, owner: Human,
  source: Schema.Union([
    Schema.TaggedStruct('Local', {}),
    Schema.TaggedStruct('Company', { repository: RepositoryAddress, commit: GitCommit, folder: FilePath }),
  ]),
  name: Name, summary: Summary, text: GuidanceText, stages: Schema.NonEmptyArray(Stage), standards: Schema.Array(Standard),
}).check(Schema.makeFilter((direction) => {
  const stageIds = new Set(direction.stages.map(({ id }) => id))
  const standards = new Set(direction.standards.map(({ id }) => id))
  const rules = direction.standards.flatMap(({ rules }) => rules.map(({ id }) => id))
  return stageIds.size === direction.stages.length && standards.size === direction.standards.length &&
    new Set(rules).size === rules.length && direction.standards.every(({ scope }) =>
      scope._tag !== 'Where' || scope.stages._tag !== 'NamedStages' ||
      scope.stages.stages.every(({ id }) => stageIds.has(id)),
    )
}))
export type Direction = Of<typeof Direction>
