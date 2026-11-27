import { Schema, SchemaGetter } from 'effect'

export type Of<S> = S extends { readonly Type: infer Value } ? Value : never

export const recordsByKey = <S extends Schema.Top, K extends Schema.Top>(
  value: S & { readonly Type: { readonly key: K['Type'] }; readonly DecodingServices: never; readonly EncodingServices: never },
  key: K,
) => Schema.Array(value)
  .check(Schema.makeFilter((entries) => new Set(entries.map((item) => item.key)).size === entries.length))
  .pipe(Schema.decodeTo(Schema.ReadonlyMap(Schema.toType(key), Schema.toType(value)), {
    decode: SchemaGetter.transform((entries) => new Map(entries.map((item) => [item.key, item]))),
    encode: SchemaGetter.transform((map) => [...map.values()]),
  }))

type Prefix = 'staff' | 'task' | 'session' | 'role' | 'subscription' | 'question' | 'proposal'
const keyWithPrefix = (prefix: Prefix) => Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9]*:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u),
  Schema.makeFilter((value) => value.startsWith(prefix + ':')),
)

export const StaffKey = keyWithPrefix('staff').pipe(Schema.brand('StaffKey'))
export const QuestionKey = keyWithPrefix('question').pipe(Schema.brand('QuestionKey'))
export const ProposalKey = keyWithPrefix('proposal').pipe(Schema.brand('ProposalKey'))
export const TaskKey = keyWithPrefix('task').pipe(Schema.brand('TaskKey'))
export const StaffSessionKey = keyWithPrefix('session').pipe(Schema.brand('StaffSessionKey'))
export const RoleKey = keyWithPrefix('role').pipe(Schema.brand('RoleKey'))
export const SubscriptionKey = keyWithPrefix('subscription').pipe(Schema.brand('SubscriptionKey'))

export const StoredActor = Schema.Union([
  Schema.TaggedStruct('Human', {}),
  Schema.TaggedStruct('Session', { key: StaffSessionKey }),
])
export type StoredActor = Of<typeof StoredActor>

const Words = Schema.String.check(Schema.isPattern(/[^\s\0]/u), Schema.makeFilter((value) => !value.includes('\0')))
  .pipe(Schema.brand('Words'))
export const QuestionText = Words.pipe(Schema.brand('QuestionText'))
export const AnswerText = Words.pipe(Schema.brand('AnswerText'))
export const OptionText = Words.pipe(Schema.brand('OptionText'))
export const Placeholder = Words.pipe(Schema.brand('Placeholder'))
export const GuidanceText = Words.pipe(Schema.brand('GuidanceText'))
export const ExampleText = Words.pipe(Schema.brand('ExampleText'))
export const QuoteText = Words.pipe(Schema.brand('QuoteText'))
export const CommandText = Words.pipe(Schema.brand('CommandText'))
export const ContextValue = Words.pipe(Schema.brand('ContextValue'))
export const RepositoryAddress = Words.pipe(Schema.brand('RepositoryAddress'))
export const GitCommit = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u)).pipe(Schema.brand('GitCommit'))
export const Name = Words.pipe(Schema.brand('Name'))
export const Goal = Words.pipe(Schema.brand('Goal'))
export const Summary = Words.pipe(Schema.brand('Summary'))
export const Introduction = Words.pipe(Schema.brand('Introduction'))
export const DutyText = Words.pipe(Schema.brand('Duty'))
export const Rationale = Words.pipe(Schema.brand('Rationale'))
export const ModelName = Words.pipe(Schema.brand('ModelName'))
export const ProviderName = Words.pipe(Schema.brand('ProviderName'))
export const AccountName = Words.pipe(Schema.brand('AccountName'))
export const PlanName = Words.pipe(Schema.brand('PlanName'))
export const LaunchText = Words.pipe(Schema.brand('LaunchText'))
export const TaskBriefText = Words.pipe(Schema.brand('TaskBriefText'))
export const ResultSummary = Words.pipe(Schema.brand('ResultSummary'))
export const PaneAddress = Words.pipe(Schema.brand('PaneAddress'))

const countFrom = (minimum: 0 | 1) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum: Number.MAX_SAFE_INTEGER }))
export const EventNumber = countFrom(1).pipe(Schema.brand('EventNumber'))
export const ReadPosition = countFrom(0).pipe(Schema.brand('ReadPosition'))
export const AttemptNumber = countFrom(1).pipe(Schema.brand('AttemptNumber'))
export const VersionNumber = countFrom(1).pipe(Schema.brand('VersionNumber'))
export const LineNumber = countFrom(1).pipe(Schema.brand('LineNumber'))
export const OptionIndex = countFrom(0).pipe(Schema.brand('OptionIndex'))
export const RetryCount = countFrom(0).pipe(Schema.brand('RetryCount'))
export const RetryLimit = countFrom(0).pipe(Schema.brand('RetryLimit'))
export const SubagentCount = countFrom(0).pipe(Schema.brand('SubagentCount'))
export const SessionCount = countFrom(1).pipe(Schema.brand('SessionCount'))
export const WindowMinutes = countFrom(1).pipe(Schema.brand('WindowMinutes'))
export const WindowShare = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('WindowShare'))
export const Timestamp = Schema.DateTimeUtcFromString

export const FilePath = Schema.String.check(Schema.makeFilter((value) =>
  !/[\0\r\n\\]/u.test(value) && !/^[A-Za-z]:/u.test(value) &&
  value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
)).pipe(Schema.brand('ProjectFilePath'))
export const FileContents = Schema.String.check(Schema.makeFilter((value) => !value.includes('\0')))
  .pipe(Schema.brand('FileContents'))

export const RefusalCode = Schema.Literals([
  'WrongMove', 'WrongActor', 'Stale', 'InvalidInput', 'RetiredSession',
  'NoCapacity', 'StaffingMinimum', 'InvalidEvidence', 'Unavailable', 'ProjectEnded',
])
export const Refusal = Schema.TaggedStruct('Refusal', { code: RefusalCode, why: Rationale })
export type Refusal = Of<typeof Refusal>
export const refuse = (code: Of<typeof RefusalCode>, why: Of<typeof Rationale>): Refusal => Refusal.make({ code, why })

export const LaunchNonce = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)).pipe(Schema.brand('LaunchNonce'))
export const LaunchVerifier = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/u)).pipe(Schema.brand('LaunchVerifier'))
export const HostCredential = Schema.String.check(Schema.isPattern(/^host\.[a-f0-9]{64}$/u))
  .pipe(Schema.brand('HostCredential'))

const RunCredential = Schema.String.check(Schema.isPattern(/^run\.[a-f0-9]{32}\.[a-f0-9]{64}$/u))
  .pipe(Schema.brand('RunCredential'))
export const ProjectCredential = Schema.Union([HostCredential, RunCredential])

export const CommandExit = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })).pipe(Schema.brand('CommandExit'))
export const CommandTextOutput = Schema.String.check(Schema.isMaxLength(1_000_000)).pipe(Schema.brand('CommandTextOutput'))
