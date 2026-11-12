// The files that a person or a model writes, as config.ts reads them: aristoteles.yaml (the
// mechanism and the settings), a task file, a direction file, a company folder. Their parsed
// forms are stored inside events, so each one is a Schema.
import { Schema } from 'effect'
import { Principle, Tier } from './closed.ts'
import { DirectionId, ResultId, RoleName, TaskId } from './ids.ts'

// The key of a standard or a rule in a file (Standard.id, Rule.id of the page).
const Key = Schema.String

// The keys that a task's context and a standard's where may name: the page's five, and audience
// (who reads the output; a direction of test/round8 selects a standard by it). Any other key is
// refused when a file is read, and a stored one stops the migration.
export const CONTEXT_KEYS = ['system', 'field', 'language', 'repo', 'section', 'audience'] as const
export const ContextKey = Schema.Literals(CONTEXT_KEYS)
export type ContextKey = typeof ContextKey.Type
// A context or a where as a file writes it: named keys, each a text, in the file's order (a
// Record over the literals would ask for every key; a checked string keeps the order).
const ContextFileKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(new RegExp(`^(${CONTEXT_KEYS.join('|')})$`))),
)
export const ContextFile = Schema.Record(ContextFileKey, Schema.String)
export type ContextFile = typeof ContextFile.Type

export { Tier } from './closed.ts'

// Who decides: a name (a role; for a direction, a person too), or one of or / and / order.
export type DeciderFile =
  | string
  | { readonly or: ReadonlyArray<DeciderFile> }
  | { readonly and: ReadonlyArray<DeciderFile> }
  | { readonly order: ReadonlyArray<DeciderFile> }
export const DeciderFile: Schema.Codec<DeciderFile> = Schema.Union([
  Schema.String,
  Schema.Struct({ or: Schema.Array(Schema.suspend((): Schema.Codec<DeciderFile> => DeciderFile)) }),
  Schema.Struct({
    and: Schema.Array(Schema.suspend((): Schema.Codec<DeciderFile> => DeciderFile)),
  }),
  Schema.Struct({
    order: Schema.Array(Schema.suspend((): Schema.Codec<DeciderFile> => DeciderFile)),
  }),
])

// One act of a role, as aristoteles.yaml writes it: exactly one key.
export const ActFile = Schema.Union([
  Schema.Struct({ do: Schema.String }),
  Schema.Struct({ review: Schema.Array(RoleName) }),
  Schema.Struct({ approve: Schema.Array(RoleName) }),
  Schema.Struct({ change: Schema.Array(DirectionId) }),
])
export type ActFile = typeof ActFile.Type

// A role of aristoteles.yaml after readConfig: an agent of a tier, or a program that checks on
// each report. The keys keep the file's order, and an absent key stays absent, so that the JSON
// of a role (its fit hash) is the old one; what each kind needs is required.
export const RoleFile = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('agent'),
    tier: Tier,
    description: Schema.String,
    intro: Schema.String,
    responsibilities: Schema.Array(Schema.String),
    output: Schema.optionalKey(Schema.String),
    acts: Schema.Array(ActFile),
    checks: Schema.Array(Key),
  }),
  Schema.Struct({
    kind: Schema.Literal('program'),
    // A file may name one; a program plays no tier (page: Role).
    tier: Schema.optionalKey(Tier),
    description: Schema.String,
    intro: Schema.String,
    responsibilities: Schema.Array(Schema.String),
    output: Schema.optionalKey(Schema.String),
    acts: Schema.Array(ActFile),
    run: Schema.String,
    on: Schema.Literal('report'),
    checks: Schema.Array(Key),
    timeout: Schema.optionalKey(Schema.Number),
  }),
])
export type RoleFile = typeof RoleFile.Type

// The checker of a rule can give evidence that counts: a role that reviews or approves a role
// that does the work, and a program that lists the rule in its checks. null: the checker is fine.
export const checkerProblem = (
  roles: Readonly<Record<string, RoleFile>>,
  id: string,
  checkedBy: string | undefined,
): string | null => {
  if (checkedBy === undefined) return null
  if (checkedBy === 'Human') {
    return (
      `rule ${id} is checked by Human; the person approves directions and standards, ` +
      'not results: name the role that reviews it'
    )
  }
  const role = roles[checkedBy]
  if (!role) return `rule ${id} is checked by "${checkedBy}", which is not a role`
  const checked = role.acts.flatMap((a) => [
    ...('review' in a ? a.review : []),
    ...('approve' in a ? a.approve : []),
  ])
  const makes = (name: string) => roles[name]?.acts.some((a) => 'do' in a && Boolean(a.do))
  if (!checked.some(makes)) {
    return (
      `rule ${id} is checked by ${checkedBy}, which reviews or approves no role that does ` +
      'the work, so its evidence never counts'
    )
  }
  if (role.kind === 'program' && !role.checks.includes(id)) {
    return `rule ${id} is checked by the program ${checkedBy}, which does not list it in its checks`
  }
  return null
}

// The limits of one tier, by the part that checks them.
export const TierLimits = Schema.Struct({
  Assignment: Schema.optionalKey(
    Schema.Struct({
      briefChars: Schema.optionalKey(Schema.Number),
      attempts: Schema.optionalKey(Schema.Number),
    }),
  ),
  Review: Schema.optionalKey(Schema.Struct({ rules: Schema.optionalKey(Schema.Number) })),
  Result: Schema.optionalKey(Schema.Struct({ size: Schema.optionalKey(Schema.Number) })),
})
export type TierLimits = typeof TierLimits.Type

// The mechanism of aristoteles.yaml: what the store keeps (the settings stay in the file).
export const ConfigFile = Schema.Struct({
  // The name of the dir: its folder name.
  project: Schema.String,
  people: Schema.Array(Schema.String),
  limits: Schema.Struct({ low: TierLimits, medium: TierLimits, high: TierLimits }),
  roles: Schema.Record(Schema.String, RoleFile),
  // Who decides the results of each maker: one entry per maker (the file's list, by its role).
  decide: Schema.Record(RoleName, DeciderFile),
})
export type ConfigFile = typeof ConfigFile.Type

// The words of a role that `work config apply` may change without a new mechanism.
export const RoleWords = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  intro: Schema.optionalKey(Schema.String),
  responsibilities: Schema.optionalKey(Schema.Array(Schema.String)),
  output: Schema.optionalKey(Schema.String),
})
export type RoleWords = typeof RoleWords.Type

// The settings of the UI, from aristoteles.yaml now (never stored).
export const TerminalTier = Schema.Literals(['sol', 'terra'])
export type TerminalTier = typeof TerminalTier.Type
export const TierSettings = Schema.Struct({
  launch: Schema.optionalKey(Schema.String),
  resume: Schema.optionalKey(Schema.String),
  start: Schema.String,
  skills: Schema.optionalKey(Schema.String),
  errors: Schema.Array(Schema.String),
  prompts: Schema.Array(Schema.String),
  silentMinutes: Schema.Number,
  retryInput: Schema.String,
})
export type TierSettings = typeof TierSettings.Type
export const Settings = Schema.Struct({
  tiers: Schema.Struct({
    sol: Schema.optionalKey(TierSettings),
    terra: Schema.optionalKey(TierSettings),
  }),
  retryMinutes: Schema.Number,
  hostWaitMinutes: Schema.Number,
  // How long an outside source that an agent read stays fresh (derived.ts sourceStateOf).
  outsideSourceHours: Schema.Number,
  sound: Schema.Boolean,
  theme: Schema.Literals(['light', 'dark']),
})
export type Settings = typeof Settings.Type

// One place of the workspace of a task: a source, its path in the dir, and for a repo its base.
export const Workspace = Schema.Struct({
  source: Schema.String,
  path: Schema.String,
  base: Schema.optionalKey(Schema.String),
  verify: Schema.optionalKey(Schema.String),
})
export type Workspace = typeof Workspace.Type

// The keys that a task file may leave out; a remake keeps them from the task it replaces.
export const TaskFileKey = Schema.Literals(['directions', 'context', 'needs', 'workspace'])
export type TaskFileKey = typeof TaskFileKey.Type

// A task file after readTask.
export const TaskFile = Schema.Struct({
  name: Schema.String,
  text: Schema.String,
  directions: Schema.Array(DirectionId),
  context: ContextFile,
  needs: Schema.Array(TaskId),
  // The keys that the file names. The migration fills it for an old remake that has none.
  named: Schema.Array(TaskFileKey),
  from: Schema.optionalKey(ResultId),
  workspace: Schema.Array(Workspace),
  references: Schema.Array(Schema.String),
})
export type TaskFile = typeof TaskFile.Type

// One part of a split file.
export const PartFile = Schema.Struct({
  name: Schema.String,
  text: Schema.String,
  context: Schema.optionalKey(ContextFile),
  from: Schema.optionalKey(ResultId),
  workspace: Schema.optionalKey(Schema.Array(Workspace)),
  references: Schema.optionalKey(Schema.Array(Schema.String)),
  // The names of the earlier parts of the same split that this part runs after.
  after: Schema.optionalKey(Schema.Array(Schema.String)),
})
export type PartFile = typeof PartFile.Type

// A rule and a standard, as a direction file or a revise file writes them.
export const RuleFile = Schema.Struct({
  id: Key,
  says: Schema.String,
  checkedBy: Schema.optionalKey(RoleName),
  supersedes: Schema.Array(Key),
})
export type RuleFile = typeof RuleFile.Type
export const StandardFile = Schema.Struct({
  id: Key,
  says: Schema.String,
  where: Schema.optionalKey(ContextFile),
  rules: Schema.Array(RuleFile),
})
export type StandardFile = typeof StandardFile.Type

// A direction file after readDirection and readApprovedBy.
export const DirectionFile = Schema.Struct({
  id: DirectionId,
  name: Schema.String,
  owner: Schema.String,
  from: Schema.Array(Principle),
  says: Schema.String,
  maxStandards: Schema.optionalKey(Schema.Number),
  standards: Schema.Array(StandardFile),
  approvedBy: Schema.optionalKey(DeciderFile),
})
export type DirectionFile = typeof DirectionFile.Type

// A revise file: the change of a direction from its current version.
export const ReviseFile = Schema.Struct({
  says: Schema.optionalKey(Schema.String),
  add: Schema.optionalKey(Schema.Array(StandardFile)),
  remove: Schema.optionalKey(Schema.Array(Key)),
  replace: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Key, with: StandardFile }))),
})
export type ReviseFile = typeof ReviseFile.Type

// page: Revision.source (was CompanySource). A commit of a company direction: its repo and
// folder, the ref that the daily refresh follows (aristoteles.lock: a tag, or none for the
// newest commit of the default branch), and the commit that it read. The record and the stored
// CompanyImported keep this shape; the lock file's entry is files/company.ts LockEntry.
export const ExternalSource = Schema.Struct({
  repo: Schema.String,
  path: Schema.String,
  ref: Schema.Union([
    Schema.TaggedStruct('DefaultBranch', {}),
    Schema.TaggedStruct('Tag', { tag: Schema.String }),
  ]),
  commit: Schema.String,
})
export type ExternalSource = typeof ExternalSource.Type

// A company folder, as company.ts reads it at a commit.
export const CompanyFolder = Schema.Struct({
  name: Schema.String,
  says: Schema.String,
  standards: Schema.Array(
    Schema.Struct({
      id: Key,
      says: Schema.String,
      rules: Schema.Array(Schema.Struct({ id: Key, says: Schema.String })),
    }),
  ),
})
export type CompanyFolder = typeof CompanyFolder.Type

// Who checks the rules of a company direction: one role for all, and one per rule.
export const CompanyCheckers = Schema.Struct({
  checkedBy: Schema.optionalKey(RoleName),
  rules: Schema.optionalKey(Schema.Record(Schema.String, RoleName)),
})
export type CompanyCheckers = typeof CompanyCheckers.Type

// How a file looked at a first brief: its digest, and the digest of each section.
export const Snapshot = Schema.Struct({
  digest: Schema.String,
  sections: Schema.Record(Schema.String, Schema.String),
})
export type Snapshot = typeof Snapshot.Type
