# Core design

## 1. Names

Use the name a person or agent can understand on its own. Read a state label with its owner, as in `TaskPhase.Reviewing`. The decisions below follow [the settled design of 26 November](DESIGN-2026-11-26.md).

### WHO

| Name now | Decision | Why |
| --- | --- | --- |
| Human | keep | The journal has one human owner who answers questions and acts through the CLI or page. |
| Author, By, Drafter, Writer, WrittenBy, RecordedBy, AuthorTag | rename to Author | Author names who supplied the words or acted in the journal. |
| Role words | rename to Responsibility | Responsibility states the work a role is accountable for, with its summary, introduction, and duties. |
| Helper | rename to RecheckAgent | The agent carries out a recheck and submits its findings. |
| Maker | removed | The task carries its own Attempt through work and review. |
| Deciders, Or, And, Order | removed | A direction’s owner accepts its draft and one role reviews each task result. |
| ProgramRole, programStaff | removed | Roles are AI roles and the task runs verification commands before review. |
| Model tiers, Tier | removed | Staffing records the model chosen for the work and the reason for that choice. |
| Agent | keep | An agent is a model run acting for the project. |
| Actor | keep | An actor is whoever performs an act. |
| Actor as a Party | rename to Anyone | Any eligible owner or live staff session can take this move. |
| Owner | keep | The owner accepts a direction’s draft. |
| Role | keep | A role is a named responsibility for work. |
| Host | keep | The host works with the person and serves fresh judgment jobs through its staff. |
| Pipeline role | keep | The pipeline role handles raised work, including splits that require judgment. |
| Reviewing role | keep | One role reviews the result and chooses how to obtain a fresh point of view. |
| Staff | keep | Staff supplies the model, account, and capacity for the roles assigned to it. |
| Worker | keep | A worker runs the work assigned to its staff. |
| Subagent | keep | A subagent is an agent started by another agent. |

### WHAT

| Name now | Decision | Why |
| --- | --- | --- |
| Top | rename to TopTask | The top task is the root of the work tree. |
| Item, ItemRec, Guidance | removed | Directions hold their standards and rules, and the harness supplies the fixed principle questions. |
| Fact names | use System, Field, Language, Repository, Audience, Output | Each literal identifies a checked context field. |
| Case, example | rename to Example | An example traces guidance to a concrete output that follows it or breaks it. |
| Ask | rename to Request | The record asks someone to do work, review a result, or answer a question. |
| Owed, step from work wait | rename to PendingStep | It is the step the actor still needs to take. |
| Answered | rename to QuestionAndAnswer | The record keeps the question together with the answer that was given. |
| Contract between parts | rename to Contract | The contract says what dependent parts owe each other when they run in parallel. |
| Recorded, logged event | rename to StoredEvent | A stored event records a transition’s input, author, time, and place in the journal. |
| Forward | rename to ForwardedAct | An actor brings an act from another channel into the project. |
| Send, as terminal input | rename to TerminalMessage | It is the message queued for delivery to a terminal. |
| Dash | rename to Dashboard | The dashboard shows the project’s work, people’s pending decisions, and workers. |
| DashTask, TaskCardView | rename to TaskCard | The card shows the task, its phase, and the actions available to the person. |
| DashWorker | rename to WorkerCard | The card shows a worker’s activity, assigned identities, and available capacity. |
| DashEscalation | rename to EscalationCard | The card shows raised work that calls for the person’s response. |
| DashChange, DraftChange | rename to Direction diff | The view shows which part of the direction changes. |
| Staffing consultation | owned by Proposal | A draft’s Question closes when the draft advances. |
| Fresh check job | rename to JudgmentJob | The job calls for judgment from a fresh point of view. |
| `TaskKey`, `ProposalKey`, `QuestionKey`, `StaffSessionKey`, `StaffKey`, `RoleKey`, `SubscriptionKey` | keep | A key exists only for a map, and may name an entry of that map from elsewhere in the same project. |
| Project, Human | singleton lines and owner | Each journal has one project and one owner. The directory separates journals in storage. |
| Responsibility, Direction, Stage, Standard, Rule, StaffingPlan | by value | Drafts, scopes, and outcomes carry the checked value. Versions carry the accepted value and its event number. |
| HostLaunch | removed | StaffSession.Starting reserves the lifetime before spawn. The pane’s answer makes it Live, and cancellation or failure ends it. |
| Maker key | removed | A run belongs to its task and attempt. |
| Makers map | removed | Each task holds the attempt for its current phase. |
| Task.caught | removed | The result holds the outcomes produced by its verification commands. |
| Act | keep | An act is something a person or agent did that can be recorded. |
| Task | keep | A task is a piece of work with a goal and an assigned role. |
| Task part | keep | A task part covers an ordered portion of its parent’s stages. |
| Work tree | keep | The tree shows how a top task is divided into parents and parts. |
| Attempt | keep | An attempt is the run that keeps its context when the task returns for another try. |
| Brief | keep | A brief tells an agent what to do and which guidance applies. |
| Result | keep | A result contains the work done and its verification outcomes. |
| Verification | keep | A rule gives a command to run or a reference to consult. |
| Outcome | keep | An outcome says whether one applicable rule holds or breaks and cites the evidence. |
| Evidence | keep | Evidence shows where an outcome or finding was observed. |
| Principle | keep | A principle gives a broad guide to work and carries the plain question it asks. |
| Flow | keep | The main direction’s flow gives the stages in work order. |
| Direction | keep | A direction says how a kind of work should be done. |
| Standard | keep | A standard describes what acceptable output looks like. |
| Rule | keep | A rule states one condition the work must meet and how to verify it. |
| `Version<T>` | keep | A version carries the exact direction or responsibility that was in force for the task. |
| Revision | keep | A revision proposes a new version of a direction, including its standards and rules. |
| Onboarding direction draft | keep | It is the proposed direction the owner reviews during onboarding. |
| Question | owned by Project, Proposal, or Task | The subject owns its question map. A question move addresses that owner and the question key. |
| Answer, reply to a question | keep | The answer supplies the information requested by a question. |
| Staffing | keep | Staffing shows who covers each role and what capacity they have. |
| Staff assignment | keep | An assignment links a role to the staff that carries it out. |
| Subscription | keep | A subscription supplies an account’s access and usage limits. |
| Subscription estimate | keep | The estimate says how much of a subscription window the host expects the work to use. |
| Host job queue | keep | It lists fresh judgment jobs for the host’s staff in arrival order. |
| Journal | keep | The journal lists the project’s stored events in order. |
| DirectionCard | keep | The card presents a direction and the evidence for its review. |
| RoleCard | keep | The card presents a role and the responsibility under review. |
| TerminalCard | keep | The card shows the terminal’s activity and lets the person open it. |
| OnboardingView | keep | The view shows the project’s progress through directions, roles, and staffing. |
| StaffingView | keep | The view shows assignments, limits, and how many roles publish jobs to the host. |

### WHEN

| Name now | Decision | Why |
| --- | --- | --- |
| Time | rename to Timestamp | It marks the instant an act happened. |
| Seq | rename to EventNumber | The number gives the stored event’s place in journal order. |
| Cursor, journal basis, --on | rename to ReadPosition | It names the journal position the actor saw before acting. |
| lastChange | rename to changedIn | The number marks the latest event that changed the record. |
| openedAt | rename to openedIn | The project opened in this event. |
| startedAt, Started.at | rename to startedIn | The session or project work started in this event. |
| Result.at | rename to reportedIn | The result was reported in this event. |
| Activation.at | rename to approvedIn | The owner approved activation in this event. |
| Ended.at | rename to endedIn | The project ended in this event. |
| acceptedAt | rename to acceptedIn | The owner accepted this version in this event. |
| staffing basis | use staffedIn | The effective staffing was established in this event. |
| review basis | use queuedIn | The task or proposal entered its current waiting place in this event. |
| StoredEvent.at | keep | Wall time of the event. |
| Epoch | rename to AuthorityGeneration | A generation distinguishes current authority to act from authority that has been replaced. |
| tries | rename to RetryCount | Task and Proposal each own one count. A review that sends the record back increments it. |
| Worker generation | keep | It identifies which lifetime of a worker a turn or allocation belongs to. |
| Usage window | keep | A usage window is the period over which a subscription counts use. |

### WHERE

| Name now | Decision | Why |
| --- | --- | --- |
| Section as a split unit, Stage | rename to Stage | A stage is one ordered part of the main direction’s flow, such as a document section or a step in a code change. |
| Where, scope conditions | rename to Scope | A standard’s scope says where it applies. |
| Spot, file place | rename to FileExcerpt | The location and quoted lines show the exact place cited as evidence. |
| Workspace | keep | The workspace contains the files the task uses. |
| Worktree | keep | Parallel parts work in separate worktrees so each can make its own changes. |
| Section as a place in a document | keep | A section is a named part of a document. |
| File path | keep | It locates a file within the project. |
| Line number | keep | It locates a line in the cited file. |
| Changed lines | keep | The reviewer sees the whole touched file with the changed lines marked. |
| Terminal session | keep | It is the terminal session where a worker or person interacts with the project. |
| Pane | keep | A pane is the visible part of a terminal window where the session runs. |

### WHY

| Name now | Decision | Why |
| --- | --- | --- |
| Reason, Why for a revision | rename to RevisionReason | It explains why the revision was proposed. |
| CheckResult | removed | Each rule contributes an outcome on the result. |
| Cause, raise reason | keep | It tells the pipeline why work left the task line, such as exhausted tries, a repeated break, a finding, or excessive scope. |
| Finding | keep | A finding reports a problem no applicable rule covers. |
| Review point | keep | A point tells the attempt which observed break to address when work goes back. |
| Verdict | keep | Aristoteles computes the verdict from rule outcomes and findings. |
| Refusal | keep | A refusal explains why an attempted act could not proceed. |
| Evaluation | keep | An evaluation explains what went wrong and what should change. |
| KnownBreak, known break | keep | A break already recorded at that place is noted during review and leaves the task’s phase unchanged. |
| Staffing reason | keep | It explains why the staff’s model and capacity fit the work. |

### HOW

| Name now | Decision | Why |
| --- | --- | --- |
| InReview | rename to Reviewing | The reviewing role has taken the result and reports outcomes against the applicable rules. |
| Fix | rename to Repair | A repair is the work undertaken to address a raised problem. |
| work decide, Decide request on a raised task | rename to RaisedTaskResponse | It is the person’s response to a specific raised task. |
| Rule test, mechanical check | rename to VerificationCommand | The command is the rule’s verification and the task runs it in ReadyToReview. |
| Rule ref | rename to VerificationReference | The reference names the material used to verify the rule by judgment. |
| Check prompt | rename to JudgmentPrompt | The prompt asks an agent with a fresh point of view to apply judgment. |
| Review tier | rename to ReviewLevel | The review moves from rules at the leaves to standards, directions, and principles higher in the tree. |
| decide configuration | removed | The review contract governs how one reviewing role reports what it found. |
| Approve act | removed | Review reports facts and Aristoteles derives the next move. |
| approvedBy | removed | The direction owner is responsible for accepting the draft. |
| Rule.checkedBy | removed | The task’s reviewing role chooses its own way to verify each applicable rule. |
| Check, Check ask | removed | The task line hands the result to Reviewing after its verification commands have run. |
| EvidenceCheck | removed | A rule outcome supplies its evidence directly. |
| Checker | removed | Each rule carries its verification and the role chooses how to carry out a review. |
| TaskPhase | keep | It names the task’s place on the work line or the raised path. |
| Sent | keep | The task has been sent to its role and awaits work. |
| Working | keep | The attempt is doing the work or addressing review points. |
| ReadyToReview | keep | The result is available and the task runs the applicable verification commands before review. |
| Done | keep | The task has finished the work line successfully. |
| Raised | keep | The task has left the ordinary work line because a problem requires a response. |
| next() | keep | It moves the task forward one phase. |
| back(points) | keep | It returns the work to the same attempt with the observed breaks to address. |
| raise(reason) | keep | It moves the task out of the work line with the reason for raising it. |
| Transition | keep | A transition takes a state and produces its next state or a refusal. |
| Report | keep | A report supplies the result for review. |
| Review | keep | The reviewer reports rule outcomes with their evidence and any findings about uncovered problems. |
| Review contract | keep | It gives the reviewing role the result, applicable rules, and whole touched files, and asks for outcomes and findings. |
| Recheck | keep | A recheck verifies an existing result again when its previous evidence needs to be revisited. |
| Split | keep | Splitting divides a task into ordered parts that cover its stages. |
| Merge | keep | A merge combines adjacent parts when their stages fit one attempt. |
| Redistribute | keep | Redistribution shifts stages among adjacent parts while preserving their order and coverage. |
| Integration | keep | The later parallel part incorporates earlier merged work and goes through review again. |
| Admission | keep | Admission says whether a role can start work with the available capacity. |
| Onboarding | keep | Onboarding prepares the project’s directions, roles, and staffing for review. |
| Activation | keep | Activation puts the accepted project configuration into use. |

### Section 2 name rulings

Nanda accepted the Round 70 names and moves with the removals recorded below. The `settled vocabulary` governs the rest.

#### WHO

| Name | Decision | Why |
| --- | --- | --- |
| AssignedStaff | rename to Assignee | The assignee is the role given the work, and its staff supplies the execution. |
| ReviewingStaff, PerspectiveStaff | rename to Reviewer | One role owns the review even when the host supplies its fresh view. |
| PipelineStaff | rename to Pipeline | The pipeline is the role that assesses a raised task. |
| Respondent | rename to Recipient | The question’s recipient is the one expected to answer. |
| CurrentStaff | removed | The session line advances on an observed change to the staff’s session. |
| Proposer | keep | The proposer is the person or staff preparing a proposal. |
| Owner | keep | The owner is the person responsible for accepting, returning, or removing a proposal. |
| Nested | removed | Raised delegates to its Fix’s current owner. |
| Engine | keep | The engine applies the move that follows from the current state and recorded facts. |

#### WHAT

| Name | Decision | Why |
| --- | --- | --- |
| MoveRequest | rename to Submission | A submission carries a staff report or a human choice for the engine to validate. |
| ReviewWork, OpenReview | removed | Reviewing holds the pinned review input. |
| ReviewSeat, ReviewContext | removed | Reviewing holds either `{ waiting: true }` or `{ by: Staff }`. |
| OwnerChoice | rename to HumanChoice | The input carries a human’s decision or answer, and the line identifies which human may supply it. |
| StaffReport | keep | A staff report gives the engine its work, evidence, or observations. |
| CommandOutcomes | keep | These are the outcomes and evidence produced by the rule commands. |
| Assessment | keep | The pipeline’s assessment states the level of the problem and its reason. |
| Draft | keep | A draft is the material the proposer supplies for review. |

#### WHEN

| Name | Decision | Why |
| --- | --- | --- |
| enteredAt | removed | Derive FIFO from the event that entered Reviewing. |
| AwaitingPerspective | removed | `waiting: true` means the review needs a fresh view. |

#### WHERE

| Name | Decision | Why |
| --- | --- | --- |
| Perspective | removed | The attempt records its session. Authentication checks the reviewing run. |
| ViewReady | removed | Record `by` when the fresh child opens. |
| Reading | removed | Reviewing with `by` identifies the staff serving the review. |

#### WHY

| Name | Decision | Why |
| --- | --- | --- |
| TooBig | keep | The report gives evidence that the work exceeded what the attempt could cover. |
| ContractCannotHold | rename to WrongContract | The parent review identifies a promise between its subtasks that failed. |
| HumanRejection | keep | It records the human’s reason and evidence for rejecting the result. |

#### HOW

| Name | Decision | Why |
| --- | --- | --- |
| start | removed as a move | A report that work began gives the task its next phase. |
| report | removed as a move | The report supplies facts and the engine applies the move those facts support. |
| recordCommands | removed as a move | Command outcomes are the input to the next move from ReadyToReview. |
| takeReview | removed as a move | ReadyToReview advances to Reviewing with its one reviewing role. |
| claimPerspective | removed as a move | The engine opens the fresh view and records it on the review. |
| review | removed as a move | Review facts lead to next, back, or raise on the task line. |
| restart | keep | A confirmed crash without a checkpoint returns Working to Sent with the same retry count. |
| reopenReview | removed as a move | Changed guidance sends the task back to ReadyToReview. |
| collectSubtasks | removed as a move | Completed subtasks give their parent the result for its next phase. |
| rejectResult | removed as a move | A human rejection is the fact from which the engine raises the task. |
| dropStage | rename to drop | The task drops a stage when the report shows that it has no work. |
| integrate | removed as a move | The integration result gives the later parallel task its basis for returning to review. |
| evaluateFix | removed as a move | The assessment stays with Evaluating until a proposal, split, or question is ready. |
| draftFix | removed as a move | The first draft enters Reviewing in the same move that submits it. |
| submitFix | rename to submit | The fix submits its draft through the proposal line. |
| Project.apply | keep | The engine applies the accepted staffing or responsibility in the same transaction as proposal acceptance. |
| acceptFix | rename to accept | The owner accepts the nested proposal and the task returns to Sent. |
| sendBackFix | rename to sendBack | The owner returns the proposal to Drafting with feedback. |
| evaluateAgain | removed as a move | Going back on the fix line returns it to Evaluating. |
| relay | removed as a move | Submitting a quoted human act puts the proposal before the human for confirmation. |
| activate | removed as a move | Owner approval advances onboarding into activation. |
| markActive | removed as a move | Observed activation success advances the project to Active. |
| rollback | removed as a move | Activation failure sends the activation line back into RollingBack. |
| finishRollback | removed as a move | Observed rollback completion sends the activation line back to Onboarding. |
| pause | removed as a move | An observed pause advances the session to Paused with its checkpoint. |
| resume | removed as a move | An observed resume starts a new live session under the same staff. |
| endSession | removed as a move | An observed exit advances the session to Ended. |
| endProject | removed as a move | The owner’s decision advances the project to Ended. |
| openProject | removed as a move | The first project record advances the project to Open. |
| sendTask | removed as a move | The accepted task draft creates a task in Sent. |
| draftProposal | removed as a move | The supplied proposal draft opens its line at Drafting. |
| openQuestion | removed as a move | The question is created in Open with an identified recipient. |
| startSession | removed as a move | The observation of a new session adds its Live record to the project. |
| Preparing | removed from Fix | A proposal uses Drafting when it is returned for changes. |
| Proposed | rename to Proposal | The fix now contains a proposal with its own line. |
| Evaluating | keep | The pipeline assesses the break at the raised task’s review tier. |
| ReviewLevel | keep | The tier identifies a rule, standard, direction, or principle. |

## 2. Core types

This section follows the [settled design and all three reassessment passes](DESIGN-2026-11-26.md). Its declarations are the contract for the next model and implementation passes. Read the TypeScript blocks in order as one module. The transition registries give the signatures their implementations must satisfy.

### 2.1 Values, authority, and versions

A record carries its own key. A key exists only for a map, and may name an entry of that map from elsewhere in the same project. Versions carry their checked values. Journal events and submissions use keys for entry addresses. Maps index entries by those keys. Roles and staff use separate key types. A staff can serve both the host and the pipeline, and each of those roles still has its own responsibility.

A live `StaffSession` is one lifetime of a staff’s session in a pane. Pausing preserves a checkpoint on that lifetime. Resuming creates a new lifetime and retires authority from the old one. A task attempt belongs to its task, is numbered within it, and records its live session and whether the work runs in the main session or a child. The authority adapter checks the actual run when it authenticates a review.

Both the CLI and the browser use the codecs for submissions and stored events. Brand construction follows decoding and semantic checks. Configured limits come from the `Limits` service. The type-level bounds here describe fixed format properties such as a nonempty stage list. The timestamp is for people. Sequence, stale-read detection, and FIFO use journal order.

```typescript
import { Context, Effect, Schema } from 'effect'

type Of<S extends Schema.Top> = S['Type']
type NonEmpty<A> = readonly [A, ...A[]]
type AtLeastTwo<A> = readonly [A, A, ...A[]]
type Tagged<Members extends object> = {
  readonly [K in keyof Members]: Readonly<{ _tag: K }> & Readonly<Members[K]>
}[keyof Members]
type Empty = Readonly<Record<never, never>>
type Identified = Readonly<{ id: Identity }>
type Transition<From, To, R = never> = (from: From) => Effect.Effect<To, Refusal, R>

const Identity = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9]*:[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/u),
).pipe(Schema.brand('Identity'))
type Identity = Of<typeof Identity>
const idWithPrefix = (prefix: Prefix) =>
  Identity.check(Schema.makeFilter((value) => value.startsWith(prefix + ':')))
type Prefix =
  | 'project' | 'human' | 'staff' | 'session' | 'role' | 'responsibility'
  | 'subscription' | 'staffing' | 'principle' | 'direction' | 'standard'
  | 'rule' | 'stage' | 'contract' | 'task' | 'question' | 'proposal' | 'act'
const ProjectId = idWithPrefix('project').pipe(Schema.brand('ProjectId'))
const HumanId = idWithPrefix('human').pipe(Schema.brand('HumanId'))
const StaffId = idWithPrefix('staff').pipe(Schema.brand('StaffId'))
const SessionId = idWithPrefix('session').pipe(Schema.brand('SessionId'))
const RoleId = idWithPrefix('role').pipe(Schema.brand('RoleId'))
const ResponsibilityId = idWithPrefix('responsibility').pipe(Schema.brand('ResponsibilityId'))
const SubscriptionId = idWithPrefix('subscription').pipe(Schema.brand('SubscriptionId'))
const StaffingId = idWithPrefix('staffing').pipe(Schema.brand('StaffingId'))
const PrincipleId = idWithPrefix('principle').pipe(Schema.brand('PrincipleId'))
const DirectionId = idWithPrefix('direction').pipe(Schema.brand('DirectionId'))
const StandardId = idWithPrefix('standard').pipe(Schema.brand('StandardId'))
const RuleId = idWithPrefix('rule').pipe(Schema.brand('RuleId'))
const StageId = idWithPrefix('stage').pipe(Schema.brand('StageId'))
const ContractId = idWithPrefix('contract').pipe(Schema.brand('ContractId'))
const TaskId = idWithPrefix('task').pipe(Schema.brand('TaskId'))
const QuestionId = idWithPrefix('question').pipe(Schema.brand('QuestionId'))
const ProposalId = idWithPrefix('proposal').pipe(Schema.brand('ProposalId'))
const ActId = idWithPrefix('act').pipe(Schema.brand('ActId'))
type TaskId = Of<typeof TaskId>

const Words = Schema.String.check(
  Schema.isPattern(/\S/u), Schema.makeFilter((value) => !value.includes('\0')),
)
const Name = Words.pipe(Schema.brand('Name'))
const Goal = Words.pipe(Schema.brand('Goal'))
const Summary = Words.pipe(Schema.brand('Summary'))
const Introduction = Words.pipe(Schema.brand('Introduction'))
const Duty = Words.pipe(Schema.brand('Duty'))
const GuidanceText = Words.pipe(Schema.brand('GuidanceText'))
const QuestionText = Words.pipe(Schema.brand('QuestionText'))
const OptionText = Words.pipe(Schema.brand('OptionText'))
const Placeholder = Words.pipe(Schema.brand('Placeholder'))
const AnswerText = Words.pipe(Schema.brand('AnswerText'))
const QuoteText = Words.pipe(Schema.brand('QuoteText'))
const ExampleText = Words.pipe(Schema.brand('ExampleText'))
const CommandText = Words.pipe(Schema.brand('CommandText'))
const CommandTextOutput = Schema.String.check(
  Schema.makeFilter((value) => !value.includes('\0')),
).pipe(Schema.brand('CommandTextOutput'))
const FindingText = Words.pipe(Schema.brand('FindingText'))
const Rationale = Words.pipe(Schema.brand('Rationale'))
const ModelName = Words.pipe(Schema.brand('ModelName'))
const ProviderName = Words.pipe(Schema.brand('ProviderName'))
const SessionCheckpoint = Words.pipe(Schema.brand('SessionCheckpoint'))
const AccountName = Words.pipe(Schema.brand('AccountName'))
const PlanName = Words.pipe(Schema.brand('PlanName'))
const LaunchText = Words.pipe(Schema.brand('LaunchText'))
const PaneAddress = Words.pipe(Schema.brand('PaneAddress'))
const WorkspaceName = Words.pipe(Schema.brand('WorkspaceName'))
const ContextValue = Words.pipe(Schema.brand('ContextValue'))
const ContractText = Words.pipe(Schema.brand('ContractText'))
const ResultSummary = Words.pipe(Schema.brand('ResultSummary'))
const IntegrationBase = Words.pipe(Schema.brand('IntegrationBase'))

const FilePath = Schema.String.check(Schema.makeFilter((value) =>
  !/[\0\r\n\\]/u.test(value) && !/^[A-Za-z]:/u.test(value) &&
  value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
)).pipe(Schema.brand('ProjectFilePath'))
const FileContents = Schema.String.check(
  Schema.makeFilter((value) => !value.includes('\0')),
).pipe(Schema.brand('FileContents'))

const CountFrom = (first: 0 | 1) =>
  Schema.Int.check(Schema.isBetween({ minimum: first, maximum: Number.MAX_SAFE_INTEGER }))
const EventNumber = CountFrom(1).pipe(Schema.brand('EventNumber'))
const ReadPosition = CountFrom(0).pipe(Schema.brand('ReadPosition'))
const VersionNumber = CountFrom(1).pipe(Schema.brand('VersionNumber'))
const AttemptNumber = CountFrom(1).pipe(Schema.brand('AttemptNumber'))
const RetryCount = CountFrom(0).pipe(Schema.brand('RetryCount'))
const RetryLimit = RetryCount.check(Schema.isGreaterThan(0)).pipe(Schema.brand('RetryLimit'))
const OptionIndex = CountFrom(0).pipe(Schema.brand('OptionIndex'))
const SubagentCount = CountFrom(0).pipe(Schema.brand('SubagentCount'))
const LineNumber = CountFrom(1).pipe(Schema.brand('LineNumber'))
const SessionCount = CountFrom(1).pipe(Schema.brand('SessionCount'))
const WindowMinutes = CountFrom(1).pipe(Schema.brand('WindowMinutes'))
const WindowShare = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('WindowShare'))
const Timestamp = Schema.DateTimeUtcFromString
type EventNumber = Of<typeof EventNumber>
type ReadPosition = Of<typeof ReadPosition>
type RetryCount = Of<typeof RetryCount>

const RefusalCode = Schema.Literals([
  'WrongMove', 'WrongActor', 'Stale', 'InvalidInput', 'NoCapacity', 'RetiredSession',
  'InvalidEvidence', 'IncompleteReview', 'RetryLimit', 'NoResult',
  'SplitCoverage', 'SplitOrder', 'SplitDepth', 'AttemptTooLarge', 'ReviewTooLarge',
  'ContractRequired', 'SeparateWorktreesRequired', 'DependentParts', 'StaffingMinimum',
  'Unavailable', 'ProjectEnded',
])
const Refusal = Schema.TaggedStruct('Refusal', { code: RefusalCode, why: Rationale })
type Refusal = Of<typeof Refusal>
const refuse = (code: Of<typeof RefusalCode>, why: Of<typeof Rationale>): Refusal =>
  Refusal.make({ code, why })

type Version<T extends Identified> = Readonly<{
  // The identifier belongs to this version. T has its own distinct typed identity.
  id: Readonly<{ subject: T['id']; number: Of<typeof VersionNumber> }>
  value: T
  acceptedAt: EventNumber
}>
const versionOf = <S extends Schema.Top & { readonly Type: Identified }, K extends Schema.Top>(value: S, subject: K) =>
  Schema.Struct({
    id: Schema.Struct({ subject, number: VersionNumber }),
    value,
    acceptedAt: EventNumber,
  })
const versionMatches = <T extends Identified>(v: Version<T>) => v.id.subject === v.value.id

const Responsibility = Schema.Struct({
  id: ResponsibilityId, summary: Summary, introduction: Introduction, duties: Schema.NonEmptyArray(Duty),
})
type Responsibility = Of<typeof Responsibility>
const ResponsibilityVersion = versionOf(Responsibility, ResponsibilityId).check(Schema.makeFilter(versionMatches))
const Role = Schema.Struct({ id: RoleId, name: Name, responsibility: ResponsibilityVersion })
type Role = Of<typeof Role>
const Human = Schema.TaggedStruct('Human', { id: HumanId, name: Name })
type Human = Of<typeof Human>

const Subscription = Schema.Struct({
  id: SubscriptionId,
  provider: ProviderName,
  account: AccountName,
  plan: PlanName,
  usageWindow: WindowMinutes,
  sessions: Schema.Union([Schema.TaggedStruct('Unlimited', {}), Schema.TaggedStruct('Limited', { max: SessionCount })]),
  estimate: Schema.Union([
    Schema.TaggedStruct('NoEstimate', {}),
    Schema.TaggedStruct('Estimated', { share: WindowShare, why: Rationale }),
  ]),
})
type Subscription = Of<typeof Subscription>
const Staff = Schema.TaggedStruct('Staff', {
  id: StaffId, name: Name, model: ModelName, launch: LaunchText, subagents: SubagentCount,
  roles: Schema.NonEmptyArray(Role), subscription: Subscription, why: Rationale,
})
type Staff = Of<typeof Staff>
const Actor = Schema.Union([Human, Staff])
type Actor = Human | Staff
const StaffingPlan = Schema.Struct({
  id: StaffingId, staff: Schema.NonEmptyArray(Staff), subscriptions: Schema.NonEmptyArray(Subscription),
})
type StaffingPlan = Of<typeof StaffingPlan>
const Pane = Schema.Struct({ address: PaneAddress })
const sessionFields = { id: SessionId, staff: Staff, startedAt: EventNumber }
const LiveSession = Schema.TaggedStruct('Live', { ...sessionFields, pane: Pane })
type LiveSession = Of<typeof LiveSession>
const StaffSession = Schema.Union([
  LiveSession,
  Schema.TaggedStruct('Paused', { ...sessionFields, checkpoint: SessionCheckpoint }),
  Schema.TaggedStruct('Ended', { ...sessionFields }),
])
type StaffSession = Of<typeof StaffSession>
```

### 2.2 Project records and the task line

**Direction and stage.** A direction owns an ordered, nonempty list of stages. Each stage gives a role, work, and a place. A `StageView` adds the guidance that governs it. Computing that view against the task’s pinned directions and scope lets a standard point to a stage by value. Stage attachments identify the additional direction stage that governs a spine stage. The project publishes the whole direction version when the owner accepts. Standards and rules inherit that version from their enclosing direction. Principle questions are fixed records supplied by the harness when the project opens. Direction drafts carry their own standards and rules. A task keeps the direction and responsibility versions it was sent under.

**Ownership and references.** The project contains the records. A task holds its parent and its ordered stage slice. Find children by selecting records whose parent matches. A `Split` phase tracks work awaiting the children. A parent’s assembled result carries the whole files and their evidence. A contract is keyed by its task and holds the task and the exact subtasks it binds. Tasks reach contracts through the project. A contract carries promises between dependent subtasks. A replacement proposes the Contract under the existing identity and preserves the original binding to the task and subtasks. Prepared views build from the current parent first, then the children, then contracts and question subjects. Published versions and material already supplied to a review keep the values that were actually read.

**Task and proposal.** An attempt survives a return from review, retaining its context and the outcomes already pointed out. The command run belongs to `ReadyToReview`. Each task and proposal names its reviewing role once. That role receives a contract carrying the whole touched files, changed lines, known breaks, and applicable guidance at the exact versions. The Reviewing phase holds that input until the outcomes and findings arrive. It carries either `{ waiting: true }` or `{ by: Staff }`. The role stays responsible when host staff supply the review. A direction’s owner alone accepts its proposal. An acceptance publishes the next version. Company direction input pins the repository commit selected through its own review process.

`Staffing` is a `Proposal<StaffingPlan>`. An existing accepted version remains effective while a replacement is reviewed. The onboarding host already serves its role when the project opens. The host reviews direction, responsibility, and staffing proposals in its own fresh child, using the ordinary review gate and its current role assignment. The owner sees a proposal after that review. Nanda alone edits responsibilities. Roles name broad work by verb and object, and directions, standards, and rules say how to do it. Activation uses its own short line. A relayed `Act` is also a proposal. The source quote and proposed human move remain visible until the human confirms or drops it. A question retains its answer in its Answered state.

```typescript
const Lines = Schema.Struct({ first: LineNumber, last: LineNumber }).check(
  Schema.makeFilter(({ first, last }) => first <= last),
)
const Quote = Schema.TaggedStruct('Quote', { file: FilePath, lines: Lines, text: QuoteText })
type Quote = Of<typeof Quote>
const MadeUp = Schema.TaggedStruct('MadeUp', { text: ExampleText })
const Example = Schema.Union([Quote, MadeUp])
type Example = Of<typeof Example>
const Command = Schema.TaggedStruct('Command', { text: CommandText })
const Prompt = Schema.TaggedStruct('Prompt', { question: QuestionText, source: Quote })
const Verification = Schema.Union([Command, Prompt])
type Verification = Of<typeof Verification>
const CommandOutput = Schema.TaggedStruct('CommandOutput', {
  command: Command, output: CommandTextOutput, places: Schema.NonEmptyArray(Quote),
})
const Evidence = Schema.Union([Quote, CommandOutput])
type Evidence = Of<typeof Evidence>

const StagePlace = Schema.Union([
  Schema.TaggedStruct('Project', {}),
  Schema.TaggedStruct('File', { file: FilePath }),
  Schema.TaggedStruct('Passage', { file: FilePath, lines: Lines }),
])
const Stage = Schema.Struct({
  id: StageId, name: Name, role: Role, work: Goal, where: StagePlace,
})
type Stage = Of<typeof Stage>
const Fact = Schema.Struct({
  name: Schema.Literals(['system', 'field', 'language', 'repo', 'audience', 'output']),
  value: ContextValue,
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
type Scope = Of<typeof Scope>
const Principle = Schema.TaggedStruct('Principle', {
  id: PrincipleId, name: Name, question: QuestionText,
})
type Principle = Of<typeof Principle>
const Rule = Schema.TaggedStruct('Rule', {
  id: RuleId, name: Name, text: GuidanceText, verification: Verification, examples: Schema.Array(Schema.Struct({ example: Example, result: Schema.Literals(['Holds', 'Breaks']) })),
})
type Rule = Of<typeof Rule>
const Standard = Schema.TaggedStruct('Standard', {
  id: StandardId, name: Name, text: GuidanceText, scope: Scope, rules: Schema.Array(Rule),
})
type Standard = Of<typeof Standard>
const RepositoryAddress = Words.pipe(Schema.brand('RepositoryAddress'))
const GitCommit = Schema.String.check(Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u))
  .pipe(Schema.brand('GitCommit'))
const DirectionSource = Schema.Union([
  Schema.TaggedStruct('Local', {}),
  Schema.TaggedStruct('Company', { repository: RepositoryAddress, commit: GitCommit, folder: FilePath }),
])
const Direction = Schema.TaggedStruct('Direction', {
  id: DirectionId, owner: Human, source: DirectionSource, name: Name,
  summary: Summary, text: GuidanceText, stages: Schema.NonEmptyArray(Stage),
  standards: Schema.Array(Standard),
})
type Direction = Of<typeof Direction>
const DirectionVersion = versionOf(Direction, DirectionId).check(Schema.makeFilter(versionMatches))
const ReviewSubject = Schema.Union([
  versionOf(Principle, PrincipleId).check(Schema.makeFilter(versionMatches)),
  DirectionVersion,
  versionOf(Standard, StandardId).check(Schema.makeFilter(versionMatches)),
  versionOf(Rule, RuleId).check(Schema.makeFilter(versionMatches)),
])
type ReviewSubject = Of<typeof ReviewSubject>

const FileImage = Schema.Union([
  Schema.TaggedStruct('Present', { contents: FileContents }),
  Schema.TaggedStruct('Deleted', { previousContents: FileContents }),
])
const WholeFile = Schema.Struct({
  file: FilePath, image: FileImage, changed: Schema.Array(Lines),
})
type WholeFile = Of<typeof WholeFile>
const KnownBreak = Schema.Struct({ guidance: ReviewSubject, place: Quote })
type KnownBreak = Of<typeof KnownBreak>
const WorkOrigin = Schema.Struct({ attempt: AttemptNumber, session: LiveSession })
type WorkOrigin = Of<typeof WorkOrigin>
const Outcome = Schema.Union([
  Schema.TaggedStruct('Holds', { guidance: ReviewSubject, evidence: Evidence }),
  Schema.TaggedStruct('Breaks', { guidance: ReviewSubject, evidence: Evidence }),
])
type Outcome = Of<typeof Outcome>
type BreakingOutcome = Extract<Outcome, { _tag: 'Breaks' }>
const Finding = Schema.Union([
  Schema.TaggedStruct('UncoveredProblem', { text: FindingText, evidence: Evidence }),
  Schema.TaggedStruct('WrongContract', { text: FindingText, evidence: Evidence }),
])
type Finding = Of<typeof Finding>
const ReviewFacts = Schema.Struct({
  outcomes: Schema.Array(Outcome), findings: Schema.Array(Finding),
})
type ReviewFacts = Of<typeof ReviewFacts>
type ReviewSet = Tagged<{
  Rules: { values: readonly Version<Rule>[] }
  Standards: { values: readonly Version<Standard>[] }
  Directions: { values: readonly Version<Direction>[] }
  Principles: { values: readonly Version<Principle>[] }
}>
type ReviewInput<T> = Readonly<{
  thing: T
  applicable: ReviewSet
  files: readonly WholeFile[]
  knownBreaks: readonly KnownBreak[]
  commandOutcomes: readonly Outcome[]
}>
type Review<T> = Readonly<{ input: ReviewInput<T>; output: ReviewFacts }>
type ProposalBasis<T extends Identified> = Tagged<{
  New: Empty
  Revision: { version: Version<T> }
}>
type ReviewFeedback = Readonly<{
  breaks: readonly BreakingOutcome[]
  findings: readonly Finding[]
}>
type ProposalStates<T extends Identified> = Tagged<{
  Drafting: { feedback: ReviewFeedback }
  Reviewing: { input: ReviewInput<T> } &
    (Readonly<{ waiting: true }> | Readonly<{ by: Staff }>)
  WaitingForOwner: { handoff: Tagged<{ Reviewed: { review: Review<T> }; Relayed: { act: Extract<T, Act> } }> }
  Accepted: { version: Version<T> }
  Removed: Empty
}>
type Proposal<T extends Identified> = Readonly<{
  id: Of<typeof ProposalId>
  value: T
  basis: ProposalBasis<T>
  proposer: Actor
  owner: Human
  reviewer: Role
  retryCount: RetryCount
  phase: ProposalPhase<T>
  lastChange: EventNumber
}>
const acceptVersion = <T extends Identified>(
  proposal: Proposal<T>, event: EventNumber,
): Effect.Effect<Version<T>, Refusal> => {
  if (proposal.phase._tag !== 'WaitingForOwner') {
    return Effect.fail(refuse('WrongMove', Rationale.make('The proposal must reach its owner before acceptance.')))
  }
  const base = proposal.basis
  if (base._tag === 'Revision' && base.version.value.id !== proposal.value.id) {
    return Effect.fail(refuse('Stale', Rationale.make('Keep the identity of the subject being revised.')))
  }
  const candidate = base._tag === 'New' ? 1 : base.version.id.number + 1
  if (!Schema.is(VersionNumber)(candidate)) {
    return Effect.fail(refuse('InvalidInput', Rationale.make('The version number exceeds the journal format.')))
  }
  return Effect.succeed({
    id: { subject: proposal.value.id, number: candidate }, value: proposal.value, acceptedAt: event,
  })
}
type Revision = Proposal<Direction>
type Staffing = Proposal<StaffingPlan>
const QuestionPrompt = Schema.Struct({ text: QuestionText, placeholder: Schema.NullOr(Placeholder) })
const QuestionForm = Schema.Union([
  Schema.TaggedStruct('Single', { prompt: QuestionPrompt }),
  Schema.TaggedStruct('Multiple', { prompts: Schema.NonEmptyArray(QuestionPrompt) }),
  Schema.TaggedStruct('OneChoice', { options: Schema.NonEmptyArray(OptionText) }),
  Schema.TaggedStruct('ManyChoices', { options: Schema.NonEmptyArray(OptionText) }),
  Schema.TaggedStruct('Matrix', { rows: Schema.NonEmptyArray(OptionText), columns: Schema.NonEmptyArray(OptionText) }),
])
type QuestionForm = Of<typeof QuestionForm>
const Answer = Schema.Union([
  Schema.TaggedStruct('Single', { text: AnswerText }),
  Schema.TaggedStruct('Multiple', { texts: Schema.NonEmptyArray(Schema.NullOr(AnswerText)) }),
  Schema.TaggedStruct('OneChoice', { picked: OptionIndex }),
  Schema.TaggedStruct('ManyChoices', { picked: Schema.NonEmptyArray(OptionIndex) }),
  Schema.TaggedStruct('Matrix', { cells: Schema.NonEmptyArray(OptionIndex) }),
])
type Answer = Of<typeof Answer>
const answerFits = (form: QuestionForm, answer: Answer) => {
  switch (form._tag) {
    case 'Single': return answer._tag === 'Single'
    case 'Multiple': return answer._tag === 'Multiple' && answer.texts.length === form.prompts.length
    case 'OneChoice': return answer._tag === 'OneChoice' && answer.picked < form.options.length
    case 'ManyChoices': return answer._tag === 'ManyChoices' &&
      answer.picked.every((choice, i) => choice < form.options.length && (i === 0 || choice > answer.picked[i - 1]!))
    case 'Matrix': return answer._tag === 'Matrix' && answer.cells.length === form.rows.length &&
      answer.cells.every((cell) => cell < form.columns.length)
  }
}
type QuestionState = Tagged<{
  Open: Empty
  Answered: { by: Actor; answer: Answer }
}>
type Question = Readonly<{
  id: Of<typeof QuestionId>
  from: Actor
  to: Actor
  about: Tagged<{
    Project: Empty
    Task: { task: Task }
    Staffing: { plan: StaffingPlan }
  }>
  text: Of<typeof QuestionText>
  form: QuestionForm
  state: QuestionState
  lastChange: EventNumber
}>
// Stage attachments point from the spine stage to a stage in an additional pinned direction.
type StageAttachment = Readonly<{
  main: Stage
  other: Stage
  direction: Version<Direction>
}>
type TaskContext = Readonly<{
  direction: Version<Direction>
  attachments: readonly StageAttachment[]
  responsibility: Version<Responsibility>
  facts: readonly Of<typeof Fact>[]
}>
type StageView = Readonly<{
  stage: Stage
  guidance: readonly ReviewSubject[]
}>
type Brief = Readonly<{
  goal: Of<typeof Goal>
  stages: NonEmpty<StageView>
  context: TaskContext
}>
type Attempt = Readonly<{
  number: Of<typeof AttemptNumber>
  session: LiveSession
  place: 'Main' | 'Child'
  brief: Brief
  retryCount: RetryCount
  pointedOut: readonly BreakingOutcome[]
}>
const Result = Schema.Struct({
  summary: ResultSummary,
  origin: WorkOrigin,
  files: Schema.Array(WholeFile),
  outcomes: Schema.Array(Outcome),
})
type Result = Of<typeof Result>
const RaiseReason = Schema.Literals([
  'tries', 'misses', 'noRule', 'tooBig', 'contractWrong', 'rejectedByHuman',
])
type RaiseReason = Of<typeof RaiseReason>
const ReviewLevel = Schema.Literals(['rule', 'standard', 'direction', 'principle'])
type ReviewLevel = Of<typeof ReviewLevel>
const FixLevel = Schema.Union([ReviewLevel, Schema.Literals(['contract', 'split'])])
type FixLevel = Of<typeof FixLevel>
const Promises = Schema.NonEmptyArray(ContractText)
type Promises = Of<typeof Promises>
const ContractInput = Schema.Struct({ id: ContractId, promises: Promises })
const FixInput = Schema.Union([
  Schema.TaggedStruct('Direction', { value: Direction }),
  Schema.TaggedStruct('Contract', { value: ContractInput }),
])
const Assessment = Schema.Struct({ level: FixLevel, why: Rationale })
type Assessment = Of<typeof Assessment>
type FixStates = Tagged<{
  Evaluating: { assessment: Tagged<{ Unassessed: Empty; Assessed: { value: Assessment } }> }
  Proposal: { assessment: Assessment; proposal: Tagged<{
    Direction: { value: Revision }
    Contract: { value: Proposal<Contract> }
  }> }
  Question: { assessment: Assessment; question: Question }
}>
type History = Tagged<{
  NoResult: Empty
  Retained: { result: Result }
}>
type ReviewReason = Tagged<{
  Report: Empty
  SubtasksDone: Empty
  GuidanceChanged: Empty
}>
type TaskStates = Tagged<{
  Sent: { history: History; retryCount: RetryCount }
  Working: { attempt: Attempt; history: History }
  ReadyToReview: {
    attempt: Attempt; result: Result; applicable: ReviewSet; reason: ReviewReason
  }
  Reviewing: { attempt: Attempt; input: ReviewInput<Result>; reason: ReviewReason } &
    (Readonly<{ waiting: true }> | Readonly<{ by: Staff }>)
  Done: { result: Result }
  Raised: { reason: RaiseReason; fix: Fix; history: History }
  Split: { history: History }
}>
type Task = Readonly<{
  id: TaskId
  name: Of<typeof Name>
  goal: Of<typeof Goal>
  parent: Task | null
  stages: NonEmpty<Stage>
  role: Role
  reviewer: Role
  context: TaskContext
  dependencies: readonly StageDependency[]
  worktree: Of<typeof WorkspaceName>
  attempts: AttemptHistory
  phase: TaskPhase
  lastChange: EventNumber
}>
type AttemptHistory = Tagged<{
  First: Empty
  PreviouslyWorked: { last: Of<typeof AttemptNumber> }
}>
type Contract = Readonly<{
  id: Of<typeof ContractId>
  task: Task
  from: Role
  subtasks: AtLeastTwo<Task>
  promises: Promises
}>
type Act = Readonly<{
  id: Of<typeof ActId>
  human: Human
  quote: Of<typeof QuoteText>
  effect: HumanMove
}>
type HumanMove = Tagged<{
  Answer: { question: Question; answer: Answer }
  AcceptFix: { task: Task }
  TakeAsIs: { task: Task }
  SendBack: { task: Task; feedback: ReviewFeedback }
  EvaluateAgain: { task: Task }
  AcceptDirection: { revision: Revision }
  AcceptStaffing: { staffing: Staffing }
}>
type ActivationStates = Tagged<{
  Onboarding: Empty
  Activating: Empty
  Active: Empty
  RollingBack: { refusal: Refusal }
}>
type ProjectStatus = Tagged<{
  Open: Empty
  Ended: { at: EventNumber }
}>
type ProjectProposal = Tagged<{
  Direction: { proposal: Revision }
  Responsibility: { proposal: Proposal<Responsibility> }
  Contract: { proposal: Proposal<Contract> }
  Act: { proposal: Proposal<Act> }
}>
type Project = Readonly<{
  id: Of<typeof ProjectId>
  owner: Human
  host: Role
  pipeline: Role
  roles: ReadonlyMap<Of<typeof RoleId>, Role>
  directions: ReadonlyMap<Of<typeof DirectionId>, NonEmpty<Version<Direction>>>
  principles: ReadonlyMap<Of<typeof PrincipleId>, Principle>
  staff: ReadonlyMap<Of<typeof StaffId>, Staff>
  staffing: Tagged<{ Unproposed: Empty; Proposed: { proposal: Staffing } }>
  sessions: ReadonlyMap<Of<typeof SessionId>, StaffSession>
  tasks: ReadonlyMap<TaskId, Task>
  contracts: ReadonlyMap<TaskId, Version<Contract>>
  proposals: ReadonlyMap<Of<typeof ProposalId>, ProjectProposal>
  questions: ReadonlyMap<Of<typeof QuestionId>, Question>
  activation: ActivationPhase
  status: ProjectStatus
  lastChange: EventNumber
  read: ReadPosition
}>
```

### 2.3 Higher-order lines and moves

Each line’s edge table declares its phases, the duty owed in each phase, and its destinations by move. `StateOf`, `MoveOf`, and `MoveAt` derive their types from that table. A `Transition<From, To, R>` enters a declared destination through the shared guard. For example, `accept` is available on a proposal or a nested fix. It is a type error on a task. Raised delegates to its Fix’s current phase. When that phase contains a proposal, the proposal’s current phase determines who owes the move. `next` checks the next position in the declared order. `back` increments the retry count against the runtime limit. The proposal line uses the same `back` when a review or owner sends it back to Drafting. Reviewing starts waiting for a fresh view. A `next` records which staff opened it, while the phase stays Reviewing.

Staff give the tool reports. A report says that work began, supplies a result, or gives evidence that work is too big. The engine derives `raise` from verified evidence. A parent review that identifies a broken promise in its contract derives `contractWrong`. The reporting staff similarly supplies review facts, a draft, an assessment, or a proposed partition. The engine validates the facts and determines the move.

Within Raised, the pipeline assesses the problem using the involved rules’ breaks grouped by role across serial tasks and across parallel roles. A leaf fixes a rule, a parent fixes a standard, and the tier above fixes a direction. Each submits a whole `Proposal<Direction>`, with the level identifying which part changes. A pattern limited to one role’s work still changes the directions that govern that work. A broken promise can submit a `Proposal<Contract>` wherever the split supplied a contract. At the principle tier, open a Question to Nanda using the fixed harness question. Oversized work supplies a partition report, and the engine splits when its guards hold.

A Fix’s first draft and submission are one journal move from Evaluating to the proposal’s Reviewing. The preceding assessment can be durable within Evaluating so a crash during drafting restarts there. An owner’s sendBack enters the ordinary proposal’s Drafting, and resubmission supplies changed material. Acceptance publishes the change and returns the task to Sent. The owner may take an actual retained result as is or return the fix to Evaluating. Submitting a quoted human act uses the same proposal move and goes to WaitingForOwner. Confirming it runs the contained human choice in the same project transaction.

The task and proposal states have separate payloads. Raised contains the Fix, which can contain a proposal. A paused session remains a historical Paused record. A confirmed checkpoint resumes the same attempt under a new Live session. When a session ends without a checkpoint, the session event folds the task’s `restart` from Working to Sent, retaining its retry count and last attempt number. The next start allocates a fresh attempt. The session event carries the exit observation for all affected tasks and reviews. Reviews assigned to the ended staff return to waiting at their original entry, including proposal reviews. Committed results, command outcomes, and answered questions are preserved.

```typescript
type Duty = 'Assignee' | 'Reviewer' | 'Pipeline' | 'Proposer' | 'Owner' | 'Recipient' | 'Engine' | 'None'
type Row<State extends PropertyKey> = Readonly<{
  moves: Readonly<Record<PropertyKey, readonly State[]>>
}>
type Line<States extends PropertyKey, Moves extends Readonly<Record<States, Row<States>>>> =
  Readonly<{ states: Moves }>
type Table = Readonly<Record<PropertyKey, Row<PropertyKey>>>
const line = <const T extends Table>(states: T & {
  readonly [S in keyof T]: { readonly moves: { readonly [M in keyof T[S]['moves']]: readonly (keyof T)[] } }
}) => ({ states })
type AnyLine = Line<PropertyKey, Table>
type StateOf<L extends AnyLine> = keyof L['states']
type ElementOf<A> = A extends readonly (infer T)[] ? T : never
type MoveAt<L extends AnyLine, S extends StateOf<L>> = keyof L['states'][S]['moves']
type MoveOf<L extends AnyLine> = { [S in StateOf<L>]: MoveAt<L, S> }[StateOf<L>]

const taskLine = line({
  Sent:          { owes: 'Assignee', moves: { next: ['Working'], split: ['Split'] } },
  Working:       { owes: 'Assignee', moves: { next: ['ReadyToReview'], raise: ['Raised'], restart: ['Sent'], drop: ['Working'] } },
  ReadyToReview: { owes: 'Engine', moves: { next: ['Reviewing'], raise: ['Raised'] } },
  Reviewing:     { owes: 'Reviewer', moves: {
    next: ['Reviewing', 'Done'], back: ['Working', 'Split'], raise: ['Raised'],
  } },
  Done:          { owes: 'Engine', moves: { back: ['ReadyToReview'], raise: ['Raised'] } },
  Raised:        { moves: { split: ['Split'] } },
  Split:         { owes: 'Engine', moves: {
    next: ['ReadyToReview'], merge: ['Split'], redistribute: ['Split'], drop: ['Split'],
  } },
})
const proposalLine = line({
  Drafting:        { owes: 'Proposer', moves: { submit: ['Reviewing', 'WaitingForOwner'] } },
  Reviewing:       { owes: 'Reviewer', moves: { next: ['Reviewing', 'WaitingForOwner'], sendBack: ['Drafting'] } },
  WaitingForOwner: { owes: 'Owner', moves: { sendBack: ['Drafting'], accept: ['Accepted'], remove: ['Removed'] } },
  Accepted:        { owes: 'None', moves: {} },
  Removed:         { owes: 'None', moves: {} },
})
const fixLine = line({
  Evaluating: { owes: 'Pipeline', moves: { next: ['Evaluating', 'Question'], submit: ['Proposal'] } },
  Proposal:   { moves: {
    submit: ['Proposal'], next: ['Proposal'], sendBack: ['Proposal'],
    accept: ['Proposal'], takeAsIs: ['Proposal'], back: ['Evaluating'],
  } },
  Question: { moves: { back: ['Evaluating'] } },
})
const activationLine = line({
  Onboarding:  { owes: 'Owner', moves: { next: ['Activating'] } },
  Activating:  { owes: 'Engine', moves: { next: ['Active'], back: ['RollingBack'] } },
  RollingBack: { owes: 'Engine', moves: { back: ['Onboarding'] } },
  Active:      { owes: 'None', moves: {} },
})
const sessionLine = line({
  Live:   { owes: 'Engine', moves: { next: ['Paused', 'Ended'] } },
  Paused: { owes: 'Engine', moves: { next: ['Live'] } },
  Ended:  { owes: 'None', moves: {} },
})
const projectLine = line({
  BeforeProject: { owes: 'Owner', moves: { next: ['Open'] } },
  Open:          { owes: 'None', moves: { next: ['Open', 'Ended'] } },
  Ended:         { owes: 'None', moves: {} },
})
const questionLine = line({
  Open:     { owes: 'Recipient', moves: { answer: ['Answered'] } },
  Answered: { owes: 'None', moves: {} },
})

type TaskPhase = Extract<TaskStates, { readonly _tag: StateOf<typeof taskLine> }>
type ProposalPhase<T extends Identified> = Extract<ProposalStates<T>, { readonly _tag: StateOf<typeof proposalLine> }>
type Fix = Extract<FixStates, { readonly _tag: StateOf<typeof fixLine> }>
type ActivationPhase = Extract<ActivationStates, { readonly _tag: StateOf<typeof activationLine> }>
type TaskAt<S extends StateOf<typeof taskLine>> = Omit<Task, 'phase'> & {
  readonly phase: Extract<TaskPhase, { readonly _tag: S }>
}
type Matches<T, L extends AnyLine> =
  [T] extends [{ readonly _tag: StateOf<L> }]
    ? [StateOf<L>] extends [T extends { readonly _tag: infer S } ? S : never] ? true : never
    : never
const matchingPhases: readonly [
  Matches<TaskStates, typeof taskLine>,
  Matches<ProposalStates<Direction>, typeof proposalLine>,
  Matches<FixStates, typeof fixLine>,
  Matches<ActivationStates, typeof activationLine>,
  Matches<StaffSession, typeof sessionLine>,
  Matches<Projection, typeof projectLine>,
  Matches<QuestionState, typeof questionLine>,
] = [true, true, true, true, true, true, true]

const withinLine = <
  L extends AnyLine, S extends StateOf<L>, M extends MoveAt<L, S>,
  A extends { readonly _tag: S }, B extends { readonly _tag: ElementOf<L['states'][S]['moves'][M]> }, R,
>(definition: L, state: S, move: M, build: Transition<A, B, R>): Transition<A, B, R> =>
  (from) => {
    if (from._tag !== state) {
      return Effect.fail(refuse('WrongMove', Rationale.make('This move belongs to another phase.')))
    }
    const destinations: readonly PropertyKey[] = definition.states[state].moves[move]
    return Effect.flatMap(build(from), (to) => destinations.includes(to._tag)
      ? Effect.succeed(to)
      : Effect.fail(refuse('WrongMove', Rationale.make('This move cannot enter that phase.'))))
  }

const taskOrder = ['Sent', 'Working', 'ReadyToReview', 'Reviewing', 'Done'] as const satisfies
  NonEmpty<StateOf<typeof taskLine>>
const proposalOrder = ['Drafting', 'Reviewing', 'WaitingForOwner', 'Accepted'] as const satisfies
  NonEmpty<StateOf<typeof proposalLine>>
const next = <A extends { readonly _tag: PropertyKey }, B extends { readonly _tag: PropertyKey }, R>(
  order: NonEmpty<PropertyKey>, build: Transition<A, B, R>,
): Transition<A, B, R> => (from) =>
  Effect.flatMap(build(from), (to) => {
    const i = order.indexOf(from._tag)
    return i >= 0 && order[i + 1] === to._tag
      ? Effect.succeed(to)
      : Effect.fail(refuse('WrongMove', Rationale.make('Advance by one phase on the line.')))
  })
const back = <A, B, R>(
  build: Transition<Readonly<{ from: A; feedback: ReviewFeedback; retryCount: RetryCount }>, B, R>,
) => (feedback: ReviewFeedback, retryCount: RetryCount, limit: RetryCount): Transition<A, B, R> =>
  (from) => retryCount >= limit
    ? Effect.fail(refuse('RetryLimit', Rationale.make('The configured retry limit was reached.')))
    : build({ from, feedback, retryCount: RetryCount.make(retryCount + 1) })
const raise = <R>(
  reason: RaiseReason,
  build: Transition<Readonly<{ from: TaskPhase; reason: RaiseReason }>, Extract<TaskPhase, { _tag: 'Raised' }>, R>,
): Transition<TaskPhase, Extract<TaskPhase, { _tag: 'Raised' }>, R> =>
  (from) => build({ from, reason })
```

### 2.4 Event boundary and replay

The journal writes one `StoredEvent` per applied move. Its shape records which line, which move, its input, the authenticated actor, the actor’s read position, and the wall time. Each line’s codec gets its move names from its edge table and its payloads from a matching exhaustive map. The event checks that the input’s tag matches the move. Addresses and inputs can name records by ID in the encoded representation. The move resolves them into the project’s records within the same transaction.

The public codec reads a `Submission`. An authenticated Staff uses the report branch, and an authenticated Human uses the choice branch. The report branch rejects extra fields such as a supplied move or destination. Human choices are limited to their named lines. The engine supplies the event number, actor, timestamp, and the move it derived or verified. The browser submits the same report or choice using its UI keys.

Property guards belong to the move. A stale read is refused when a record the move relied on changed after its read position. Scope that test to the actual reliance, such as the task, its attempt, the active review basis, or the staffing proposal being accepted. Decode and validate against the current state under the same atomic write as the append. On refusal, return the single `Refusal` shape. Opening a second view for the same review, starting a second live lifetime for the same staff, and reporting under retired authority all fail at this boundary. A review report contains outcomes and findings. The authenticated channel supplies the run authority. The transaction checks that authority against the current review assignment, its live session and fresh child, and the work’s origin. A retry or a replacement session invalidates the earlier run even when the same staff serves again.

Record inputs that external effects establish, including command outcomes, file images, and session observations. Engine-applied moves are attributed to the human or staff whose authorized operation they complete. For example, a test command completes the assigned staff’s report, and a rollback completes the human’s activation. The fold uses the recorded input and repeats the pure move. Typed terminal input stays in terminal transport.

```typescript
const PartInput = Schema.Struct({
  id: TaskId, name: Name, goal: Goal, stages: Schema.NonEmptyArray(StageId), role: RoleId,
  reviewer: RoleId, worktree: WorkspaceName,
})
const SplitContractInput = Schema.Union([
  Schema.TaggedStruct('Independent', {}),
  Schema.TaggedStruct('SerialDependencies', {}),
  Schema.TaggedStruct('ParallelDependencies', {
    id: ContractId,
    promises: Promises,
  }),
])
const AtLeastTwoOf = <S extends Schema.Top>(member: S) =>
  Schema.TupleWithRest(Schema.Tuple([member, member]), [member])
const SplitInput = Schema.Struct({
  parts: AtLeastTwoOf(PartInput),
  dependencies: Schema.Array(Schema.Struct({
    before: StageId, after: StageId, scheduling: Schema.Literals(['Serial', 'Parallel']),
  })),
  contract: SplitContractInput,
})
const FeedbackInput = Schema.Struct({
  breaks: Schema.Array(Outcome), findings: Schema.Array(Finding),
})
const HumanActInput = Schema.Struct({
  id: ActId, human: HumanId, quote: QuoteText,
  instruction: Schema.Union([
    Schema.TaggedStruct('Answer', { question: QuestionId, answer: Answer }),
    Schema.TaggedStruct('AcceptFix', { task: TaskId }),
    Schema.TaggedStruct('TakeAsIs', { task: TaskId }),
    Schema.TaggedStruct('SendBackFix', { task: TaskId, feedback: FeedbackInput }),
    Schema.TaggedStruct('EvaluateAgain', { task: TaskId }),
    Schema.TaggedStruct('AcceptDirection', { proposal: ProposalId }),
    Schema.TaggedStruct('AcceptStaffing', { proposal: ProposalId }),
  ]),
})
const ProposalValue = Schema.Union([
  Schema.TaggedStruct('Direction', { value: Direction }),
  Schema.TaggedStruct('Responsibility', { value: Responsibility }),
  Schema.TaggedStruct('Contract', { value: ContractInput }),
  Schema.TaggedStruct('Staffing', { value: StaffingPlan }),
  Schema.TaggedStruct('Act', { value: HumanActInput }),
])
const QuestionAbout = Schema.Union([
  Schema.TaggedStruct('Project', {}),
  Schema.TaggedStruct('Task', { task: TaskId }),
  Schema.TaggedStruct('Staffing', { proposal: ProposalId }),
])

const TaskAddress = Schema.TaggedStruct('Task', { id: TaskId })
const ProposalAddress = Schema.TaggedStruct('Proposal', { id: ProposalId })
const FixAddress = Schema.TaggedStruct('Fix', { task: TaskId })
const QuestionAddress = Schema.TaggedStruct('Question', { id: QuestionId })
const SessionAddress = Schema.TaggedStruct('Session', { id: SessionId })
const ProjectAddress = Schema.TaggedStruct('Project', { id: ProjectId })
const ActivationAddress = Schema.TaggedStruct('Activation', { project: ProjectId })
const StoredActor = Schema.Union([
  Schema.TaggedStruct('Human', { id: HumanId }),
  Schema.TaggedStruct('Staff', { id: StaffId }),
])

const Began = Schema.TaggedStruct('Began', { session: LiveSession, place: Schema.Literals(['Main', 'Child']) })
const WorkResult = Schema.TaggedStruct('Result', {
  attempt: AttemptNumber, summary: ResultSummary, files: Schema.Array(WholeFile),
})
const TooBig = Schema.TaggedStruct('TooBig', { attempt: AttemptNumber, evidence: Evidence })
const EmptyStage = Schema.TaggedStruct('EmptyStage', { stage: StageId, evidence: Evidence })
const Integrated = Schema.TaggedStruct('Integrated', { on: IntegrationBase, files: Schema.Array(WholeFile) })
const WorkReport = Schema.Union([Began, WorkResult, TooBig, EmptyStage, Integrated])
type WorkReport = Of<typeof WorkReport>
const CommandOutcomes = Schema.TaggedStruct('CommandOutcomes', { outcomes: Schema.Array(Outcome) })
const Reviewing = Schema.TaggedStruct('Reviewing', { by: Staff })
const Reviewed = Schema.TaggedStruct('ReviewFacts', { facts: ReviewFacts })
const GuidanceChanged = Schema.TaggedStruct('GuidanceChanged', { changed: Schema.NonEmptyArray(ReviewSubject) })
const SubtasksDone = Schema.TaggedStruct('SubtasksDone', {})
const HumanRejection = Schema.TaggedStruct('HumanRejection', { why: Rationale, evidence: Evidence })
type Payloads<L extends AnyLine> = {
  readonly [M in MoveOf<L>]: Schema.Top & { readonly Type: { readonly _tag: M } }
}

const taskInput = {
  next: Schema.TaggedStruct('next', { fact: Schema.Union([Began, WorkResult, CommandOutcomes, Reviewing, Reviewed, SubtasksDone]) }),
  back: Schema.TaggedStruct('back', { fact: Schema.Union([Reviewed, GuidanceChanged, Integrated]) }),
  raise: Schema.TaggedStruct('raise', { fact: Schema.Union([TooBig, Reviewed, HumanRejection]) }),
  restart: Schema.TaggedStruct('restart', { session: SessionId }),
  split: Schema.TaggedStruct('split', { plan: SplitInput }),
  merge: Schema.TaggedStruct('merge', { plan: SplitInput }),
  redistribute: Schema.TaggedStruct('redistribute', { plan: SplitInput }),
  drop: Schema.TaggedStruct('drop', { fact: EmptyStage }),
} satisfies Payloads<typeof taskLine>
const proposalInput = {
  submit: Schema.TaggedStruct('submit', { value: ProposalValue }),
  next: Schema.TaggedStruct('next', { fact: Schema.Union([Reviewing, Reviewed]) }),
  sendBack: Schema.TaggedStruct('sendBack', {
    cause: Schema.Union([
      Schema.TaggedStruct('OwnerFeedback', { feedback: FeedbackInput }),
      Reviewed,
    ]),
  }),
  accept: Schema.TaggedStruct('accept', {}),
  remove: Schema.TaggedStruct('remove', {}),
} satisfies Payloads<typeof proposalLine>
const fixInput = {
  next: Schema.TaggedStruct('next', {
    fact: Schema.Union([
      Schema.TaggedStruct('Assessment', { assessment: Assessment }),
      Schema.TaggedStruct('Question', { id: QuestionId }),
      Reviewing,
      Reviewed,
    ]),
  }),
  submit: Schema.TaggedStruct('submit', { id: ProposalId, value: FixInput }),
  sendBack: proposalInput.sendBack,
  accept: proposalInput.accept,
  takeAsIs: Schema.TaggedStruct('takeAsIs', {}),
  back: Schema.TaggedStruct('back', {}),
} satisfies Payloads<typeof fixLine>
const questionInput = {
  answer: Schema.TaggedStruct('answer', { answer: Answer }),
} satisfies Payloads<typeof questionLine>
const activationInput = {
  next: Schema.TaggedStruct('next', {
    fact: Schema.Union([Schema.TaggedStruct('OwnerApproval', {}), Schema.TaggedStruct('ActivationSucceeded', { launch: SessionId, files: Schema.NonEmptyArray(WholeFile), committed: EventNumber })]),
  }),
  back: Schema.TaggedStruct('back', {
    fact: Schema.Union([
      Schema.TaggedStruct('ActivationFailed', { refusal: Refusal }),
      Schema.TaggedStruct('RollbackComplete', {}),
    ]),
  }),
} satisfies Payloads<typeof activationLine>
const SessionBegan = Schema.Struct({ id: SessionId, staff: StaffId, pane: Pane })
const sessionInput = {
  next: Schema.TaggedStruct('next', {
    fact: Schema.Union([
      Schema.TaggedStruct('Paused', { checkpoint: SessionCheckpoint }),
      Schema.TaggedStruct('Resumed', { id: SessionId, pane: Pane }),
      Schema.TaggedStruct('Ended', { observation: Rationale }),
    ]),
  }),
} satisfies Payloads<typeof sessionLine>
const TaskDraftInput = Schema.Struct({
  task: PartInput, direction: DirectionId, facts: Schema.Array(Fact),
  attachments: Schema.Array(Schema.Struct({ main: StageId, other: StageId, direction: DirectionId })),
})
const DraftInput = Schema.Struct({ id: ProposalId, value: ProposalValue, reviewer: RoleId })
const QuestionDraftInput = Schema.Struct({
  id: QuestionId, to: StoredActor, about: QuestionAbout, text: QuestionText, form: QuestionForm,
})
const projectInput = {
  next: Schema.TaggedStruct('next', {
    fact: Schema.Union([
      Schema.TaggedStruct('ProjectOpened', { owner: Human, host: Role, pipeline: Role, staff: Staff }),
      Schema.TaggedStruct('TaskSent', { draft: TaskDraftInput }),
      Schema.TaggedStruct('ProposalDrafted', { draft: DraftInput }),
      Schema.TaggedStruct('QuestionOpened', { question: QuestionDraftInput }),
      Schema.TaggedStruct('SessionStarted', { session: SessionBegan }),
      Schema.TaggedStruct('ProjectEnded', {}),
    ]),
  }),
} satisfies Payloads<typeof projectLine>

const moveOf = <L extends AnyLine>(definition: L) =>
  Schema.declare((value): value is MoveOf<L> =>
    typeof value === 'string' &&
    Object.values(definition.states).some((state) => Object.hasOwn(state.moves, value)),
  )
const journalEntry = <L extends AnyLine, A extends Schema.Top, I extends Schema.Top>(
  definition: L, address: A, input: I,
) => Schema.Struct({ number: EventNumber, line: address, move: moveOf(definition), input, actor: StoredActor,
  read: ReadPosition, at: Timestamp })
const matchesEntry = (event: {
  readonly number: EventNumber
  readonly move: PropertyKey
  readonly input: { readonly _tag: PropertyKey }
  readonly read: ReadPosition
}) => event.move === event.input._tag && event.read < event.number

const TaskEvent = journalEntry(taskLine, TaskAddress, Schema.Union(Object.values(taskInput))).check(Schema.makeFilter(matchesEntry))
const ProposalEvent = journalEntry(proposalLine, ProposalAddress, Schema.Union(Object.values(proposalInput))).check(Schema.makeFilter(matchesEntry))
const FixEvent = journalEntry(fixLine, FixAddress, Schema.Union(Object.values(fixInput))).check(Schema.makeFilter(matchesEntry))
const QuestionEvent = journalEntry(questionLine, QuestionAddress, questionInput.answer).check(Schema.makeFilter(matchesEntry))
const ActivationEvent = journalEntry(activationLine, ActivationAddress, Schema.Union(Object.values(activationInput))).check(Schema.makeFilter(matchesEntry))
const SessionEvent = journalEntry(sessionLine, SessionAddress, sessionInput.next).check(Schema.makeFilter(matchesEntry))
const ProjectEvent = journalEntry(projectLine, ProjectAddress, projectInput.next).check(Schema.makeFilter(matchesEntry))
const StoredEvent = Schema.Union([TaskEvent, ProposalEvent, FixEvent, QuestionEvent, ActivationEvent, SessionEvent, ProjectEvent])
type StoredEvent = Of<typeof StoredEvent>

// Staff supply facts. The submission address and authenticated run identify the work.
const ReviewAddress = Schema.Union([TaskAddress, ProposalAddress, FixAddress])
const StaffReport = Schema.Union([
  Schema.TaggedStruct('Work', { line: TaskAddress, report: WorkReport }),
  Schema.TaggedStruct('Review', { line: ReviewAddress, facts: ReviewFacts }),
  Schema.TaggedStruct('Proposal', { line: ProposalAddress, value: ProposalValue }),
  Schema.TaggedStruct('Assessment', { line: FixAddress, assessment: Assessment }),
  Schema.TaggedStruct('Draft', { line: FixAddress, value: FixInput }),
  Schema.TaggedStruct('Partition', { line: TaskAddress, plan: SplitInput, evidence: Evidence }),
  Schema.TaggedStruct('Answer', { line: QuestionAddress, answer: Answer }),
  Schema.TaggedStruct('TaskDraft', { draft: TaskDraftInput }),
  Schema.TaggedStruct('ProposalDraft', { draft: DraftInput }),
  Schema.TaggedStruct('Question', { question: QuestionDraftInput }),
])
type StaffReport = Of<typeof StaffReport>
const HumanChoice = Schema.Union([
  Schema.TaggedStruct('Proposal', {
    line: ProposalAddress,
    choice: Schema.Union([proposalInput.accept, proposalInput.remove,
      Schema.TaggedStruct('sendBack', { feedback: FeedbackInput })]),
  }),
  Schema.TaggedStruct('Fix', {
    line: FixAddress,
    choice: Schema.Union([fixInput.accept, fixInput.takeAsIs, fixInput.back,
      Schema.TaggedStruct('sendBack', { feedback: FeedbackInput })]),
  }),
  Schema.TaggedStruct('SubmitProposal', { line: ProposalAddress, value: ProposalValue }),
  Schema.TaggedStruct('RejectResult', { line: TaskAddress, why: Rationale, evidence: Evidence }),
  Schema.TaggedStruct('Activate', { line: ActivationAddress }),
  Schema.TaggedStruct('EndProject', { line: ProjectAddress }),
  Schema.TaggedStruct('NewProject', { project: ProjectAddress, owner: Human, host: Role, pipeline: Role, staff: Staff }),
  Schema.TaggedStruct('Answer', { line: QuestionAddress, answer: Answer }),
  Schema.TaggedStruct('ProposalDraft', { draft: DraftInput }),
  Schema.TaggedStruct('Question', { question: QuestionDraftInput }),
])
type HumanChoice = Of<typeof HumanChoice>
const Submission = Schema.Union([
  Schema.TaggedStruct('StaffReport', { read: ReadPosition, report: StaffReport }),
  Schema.TaggedStruct('HumanChoice', { read: ReadPosition, choice: HumanChoice }),
])
type Submission = Of<typeof Submission>
const readSubmission = Schema.decodeUnknownSync(Submission, { onExcessProperty: 'error' })
```

### 2.5 Derived capacity, review decisions, and split checks

**Capacity and review.** A shared subscription counts live sessions on that subscription. A live child attempt and an assigned review each use one subagent slot. Staff with an allowance wait for their own slot. Reviews assigned to roles whose staff have no subagents wait in the host’s derived FIFO. Derive the order from the event that entered Reviewing. Later changes to the task, a staff crash while reviewing, and the host consuming a slot do not change that entry order. This draft uses the same FIFO for task and proposal reviews, including a Fix’s proposal and Staffing. Validate live session, capacity, and the waiting phase at the serialized boundary. Record `by` only after the adapter opens the fresh child. Reconcile a child started for an assignment that fails to commit. The host reports on behalf of the assigned reviewing role. Authentication and replay validate the live and recorded parts of that handoff respectively.

Combine the already recorded command outcomes with the reviewer’s submitted outcomes. Require each pinned applicable version exactly once and verify every quote against the review material. The assigned reviewing role chooses the method. The host role has a current staff assignment and a fresh child during onboarding, before any staffing proposal becomes effective. The authority adapter refuses a report from the work’s originating run. A documented break outside the changed lines remains in the result without sending the task back. New breaks in unchanged lines are actionable. Where reasons overlap, this draft applies contract findings first, then other findings, repeated breaks, and exhausted retries. The engine derives the destination from those facts.

Recheck reopens Done at ReadyToReview with the changed guidance that now applies. Keep the artifact and unaffected outcomes. The changed guidance gets a fresh retry basis, with the attempt’s context retained and its list of already pointed-out outcomes cleared. A first break on that basis returns the work to its role. A parent’s review uses the next guidance level across its parts. On an actionable parent break, route its cited places to the responsible subtasks and put the parent back in Split while they work.

**Split and rebalance.** The ordered stage slice is the spine. The parts cover it exactly once and in order, at least one stage each. The depth cap is four. Measure each proposed node’s own brief and the parent’s cross-part review against configured capacity. The parent’s own brief is its coordination and review work. A too-large leaf brief goes straight to a mechanical stage split before work. Observed oversized work raises to the pipeline for a split by meaning. A stage with no work is dropped on evidence and the same coverage check runs on the remaining spine. Independent stages may run in parallel from the start in distinct worktrees. Dependent stages may start in parallel once the partition passes and the assigned role has recorded the contract. A stage belongs to one part. The contract holds only the promises the dependent parts make to one another. Its broken promises surface in the parent review. Merge and redistribute use the same guard. The later parallel result integrates the first merged result and re-enters review with the integration evidence.

```typescript
type SlotLimit = Subscription['sessions']
type Capacity = Readonly<{
  liveSessions: Of<typeof SubagentCount>
  sessionLimit: SlotLimit
  usedSubagents: Of<typeof SubagentCount>
  freeSubagents: Of<typeof SubagentCount>
}>
type TaskAtReview = TaskAt<'Reviewing'>
type Selection = Tagged<{
  Awaiting: Empty
  Available: { subject: LineTarget; for: 'Report' | 'Choose' | 'Answer'; read: ReadPosition }
}>
type LineTarget = Tagged<{
  Project: { project: Project }
  Task: { task: Task }
  Proposal: { proposal: ProjectProposal }
  Staffing: { staffing: Staffing }
  Fix: { task: TaskAt<'Raised'>; fix: Fix }
  Session: { session: StaffSession }
  Question: { question: Question }
}>
type StageDependency = Readonly<{
  before: Stage; after: Stage; scheduling: 'Serial' | 'Parallel'
}>
type PartDraft = Readonly<{
  name: Of<typeof Name>; goal: Of<typeof Goal>; stages: NonEmpty<Stage>; role: Role
  worktree: Of<typeof WorkspaceName>
}>
type SplitDraft = Readonly<{
  parts: AtLeastTwo<PartDraft>
  dependencies: readonly StageDependency[]
  contract: Tagged<{ None: Empty; Written: { by: Role; promises: Promises } }>
}>
type Fit = Tagged<{ Fits: Empty; TooLarge: Empty }>
type ReviewMove = Tagged<{
  Next: Empty
  Back: { outcomes: NonEmpty<BreakingOutcome> }
  Raise: { reason: RaiseReason }
}>

const subtaskList = (project: Project, parent: Task): readonly Task[] =>
  [...project.tasks.values()].filter((task) => task.parent?.id === parent.id)
const staffFor = (project: Project, role: Role): Staff | null =>
  [...project.staff.values()].find((staff) => staff.roles.some((assigned) => assigned.id === role.id)) ?? null
const isReviewing = (task: Task): task is TaskAtReview => task.phase._tag === 'Reviewing'
const sameReview = (a: Of<typeof ReviewAddress>, b: Of<typeof ReviewAddress>) =>
  a._tag === 'Fix' ? b._tag === 'Fix' && a.task === b.task : b._tag === a._tag && a.id === b.id
const hostQueue = (project: Project, events: readonly StoredEvent[]): readonly Of<typeof ReviewAddress>[] => {
  const waiting: Of<typeof ReviewAddress>[] = []
  const add = (line: Of<typeof ReviewAddress>, reviewer: Role) => {
    if (staffFor(project, reviewer)?.subagents === 0) waiting.push(line)
  }
  const addProposal = <T extends Identified>(line: Of<typeof ReviewAddress>, proposal: Proposal<T>) => {
    if (proposal.phase._tag === 'Reviewing' && 'waiting' in proposal.phase) add(line, proposal.reviewer)
  }
  for (const task of project.tasks.values()) {
    if (isReviewing(task) && 'waiting' in task.phase) add({ _tag: 'Task', id: task.id }, task.reviewer)
    if (task.phase._tag === 'Raised' && task.phase.fix._tag === 'Proposal') {
      const { proposal } = task.phase.fix
      const address = { _tag: 'Fix', task: task.id } as const
      if (proposal._tag === 'Direction') addProposal(address, proposal.value)
      else addProposal(address, proposal.value)
    }
  }
  for (const { proposal } of project.proposals.values()) {
    if (proposal.phase._tag === 'Reviewing' && 'waiting' in proposal.phase) {
      add({ _tag: 'Proposal', id: proposal.id }, proposal.reviewer)
    }
  }
  if (project.staffing._tag === 'Proposed') {
    const { proposal } = project.staffing
    addProposal({ _tag: 'Proposal', id: proposal.id }, proposal)
  }
  const entries: Of<typeof ReviewAddress>[] = []
  for (const event of events) {
    if ((Schema.is(TaskEvent)(event) && event.input._tag === 'next' &&
        event.input.fact._tag === 'CommandOutcomes') ||
        ((Schema.is(ProposalEvent)(event) || Schema.is(FixEvent)(event)) &&
          event.input._tag === 'submit')) {
      const { line } = event
      if (waiting.some((item) => sameReview(item, line))) {
        const prior = entries.findIndex((item) => sameReview(item, line))
        if (prior >= 0) entries.splice(prior, 1)
        entries.push(line)
      }
    }
  }
  return entries
}

const capacity = (project: Project, staff: Staff): Capacity => {
  const live = [...project.sessions.values()].filter((s) => s._tag === 'Live')
  const isLive = live.some((session) => session.staff.id === staff.id)
  const owns = (review: Readonly<{ by: Staff }> | Readonly<{ waiting: true }>) =>
    isLive && 'by' in review && review.by.id === staff.id
  const work = [...project.tasks.values()].reduce((count, { phase }) => {
    if (phase._tag === 'Working' && phase.attempt.place === 'Child' &&
        phase.attempt.session.staff.id === staff.id &&
        live.some((session) => session.id === phase.attempt.session.id)) return count + 1
    if (phase._tag === 'Reviewing' && owns(phase)) return count + 1
    if (phase._tag === 'Raised' && phase.fix._tag === 'Proposal') {
      const inner = phase.fix.proposal.value.phase
      if (inner._tag === 'Reviewing' && owns(inner)) return count + 1
    }
    return count
  }, 0)
  const proposals = [...project.proposals.values()].filter(({ proposal: { phase } }) =>
    phase._tag === 'Reviewing' && owns(phase),
  ).length
  const staging = project.staffing._tag === 'Proposed' ? project.staffing.proposal.phase : null
  const used = work + proposals + (staging?._tag === 'Reviewing' && owns(staging) ? 1 : 0)
  return {
    liveSessions: SubagentCount.make(live.filter((s) => s.staff.subscription.id === staff.subscription.id).length),
    sessionLimit: staff.subscription.sessions,
    usedSubagents: SubagentCount.make(used),
    freeSubagents: SubagentCount.make(Math.max(0, staff.subagents - used)),
  }
}

const sameVersion = (a: ReviewSubject, b: ReviewSubject) =>
  a.id.subject === b.id.subject && a.id.number === b.id.number
const places = (evidence: Evidence): NonEmpty<Quote> =>
  evidence._tag === 'Quote' ? [evidence] : evidence.places
const overlaps = (a: Of<typeof Lines>, b: Of<typeof Lines>) =>
  a.first <= b.last && b.first <= a.last
const hasQuote = (files: readonly WholeFile[], quote: Quote) => files.some((file) => {
  if (file.file !== quote.file) return false
  const text = file.image._tag === 'Present' ? file.image.contents : file.image.previousContents
  const lines = text.split(/\r?\n/u)
  return quote.lines.last <= lines.length &&
    lines.slice(quote.lines.first - 1, quote.lines.last).join('\n').includes(quote.text)
})
const changedAt = (files: readonly WholeFile[], place: Quote) =>
  files.some((file) => file.file === place.file && file.changed.some((lines) => overlaps(lines, place.lines)))
const alreadyKnown = <T>(input: ReviewInput<T>, outcome: BreakingOutcome) =>
  places(outcome.evidence).every((place) =>
    !changedAt(input.files, place) &&
    input.knownBreaks.some((known) =>
      sameVersion(known.guidance, outcome.guidance) && known.place.file === place.file &&
      known.place.lines.first === place.lines.first && known.place.lines.last === place.lines.last &&
      known.place.text === place.text,
    ),
  )
const reviewFacts = <T>(
  input: ReviewInput<T>, report: ReviewFacts,
): Effect.Effect<Review<T>, Refusal> => {
  const all = [...input.commandOutcomes, ...report.outcomes]
  const expected: readonly ReviewSubject[] = input.applicable.values
  if (all.length !== expected.length || expected.some((item) =>
      all.filter((outcome) => sameVersion(item, outcome.guidance)).length !== 1)) {
    return Effect.fail(refuse('IncompleteReview', Rationale.make('Supply one outcome for every applicable version.')))
  }
  if ([...all, ...report.findings].some(({ evidence }) =>
    places(evidence).some((quote) => !hasQuote(input.files, quote)))) {
    return Effect.fail(refuse('InvalidEvidence', Rationale.make('Cite an exact passage in the review material.')))
  }
  return Effect.succeed({ input, output: { ...report, outcomes: all } })
}
const forChangedGuidance = (attempt: Attempt): Attempt => ({
  ...attempt, retryCount: RetryCount.make(0), pointedOut: [],
})
const deriveReviewMove = <T>(
  review: Review<T>, pointedOut: readonly BreakingOutcome[], retryCount: RetryCount, maxRetries: RetryCount,
): ReviewMove => {
  if (review.output.findings.some((finding) => finding._tag === 'WrongContract')) {
    return { _tag: 'Raise', reason: 'contractWrong' }
  }
  if (review.output.findings.length > 0) return { _tag: 'Raise', reason: 'noRule' }
  const [first, ...rest] = review.output.outcomes.filter(
    (outcome): outcome is BreakingOutcome => outcome._tag === 'Breaks' && !alreadyKnown(review.input, outcome),
  )
  if (first === undefined) return { _tag: 'Next' }
  const breaks: NonEmpty<BreakingOutcome> = [first, ...rest]
  if (breaks.some((now) => pointedOut.some((was) => now.guidance.id.subject === was.guidance.id.subject))) {
    return { _tag: 'Raise', reason: 'misses' }
  }
  if (retryCount >= maxRetries) return { _tag: 'Raise', reason: 'tries' }
  return { _tag: 'Back', outcomes: breaks }
}

class Limits extends Context.Service<Limits, {
  readonly maxRetries: (role: Role) => Effect.Effect<Of<typeof RetryLimit>, Refusal>
  readonly fitsAttempt: (part: PartDraft) => Effect.Effect<Fit, Refusal>
  readonly fitsReview: (set: ReviewSet) => Effect.Effect<Fit, Refusal>
}>()('Core/Limits') {}
type SplitSource = Readonly<{
  parent: Task
  draft: SplitDraft
  parentReview: ReviewSet
  parentAttempt: PartDraft
}>
type ValidSplit = Readonly<SplitSource & { _tag: 'ValidSplit' }>
const depthOf = (task: Task): 1 | 2 | 3 | 4 | 'TooDeep' => {
  if (task.parent === null) return 1
  switch (depthOf(task.parent)) {
    case 1: return 2
    case 2: return 3
    case 3: return 4
    default: return 'TooDeep'
  }
}
const validateSplit: Transition<SplitSource, ValidSplit, Limits> = ({ parent, draft, parentReview, parentAttempt }) =>
  Effect.gen(function* () {
    if (depthOf(parent) === 4 || depthOf(parent) === 'TooDeep') {
      return yield* Effect.fail(refuse('SplitDepth', Rationale.make('A task tree has at most four levels.')))
    }
    const parts = draft.parts.flatMap((part) => part.stages.map((stage) => stage.id))
    const required = parent.stages.map((stage) => stage.id)
    if (parts.length !== required.length || new Set(parts).size !== parts.length ||
        required.some((id) => !parts.includes(id))) {
      return yield* Effect.fail(refuse('SplitCoverage', Rationale.make('Cover each parent stage exactly once.')))
    }
    if (parts.some((stage, i) => stage !== required[i])) {
      return yield* Effect.fail(refuse('SplitOrder', Rationale.make('Keep the parent’s stage order.')))
    }
    const partFor = (stage: Stage) => draft.parts.find(
      (part) => part.stages.some((here) => here.id === stage.id),
    )
    for (const { before, after, scheduling } of draft.dependencies) {
      const left = required.indexOf(before.id)
      const right = required.indexOf(after.id)
      const a = partFor(before)
      const b = partFor(after)
      if (left < 0 || right < 0 || left >= right) {
        return yield* Effect.fail(refuse('DependentParts', Rationale.make('A dependency must follow stage order.')))
      }
      if (a !== b && scheduling === 'Parallel' &&
          (draft.contract._tag !== 'Written' || draft.contract.by.id !== parent.role.id)) {
        return yield* Effect.fail(refuse('ContractRequired', Rationale.make('Have the assigned role record the promises before parallel work.')))
      }
    }
    for (const [i, part] of draft.parts.entries()) {
      for (const other of draft.parts.slice(i + 1)) {
        const serial = draft.dependencies.some(({ before, after, scheduling }) =>
          scheduling === 'Serial' && partFor(before) === part && partFor(after) === other)
        if (!serial && part.worktree === other.worktree) {
          return yield* Effect.fail(refuse('SeparateWorktreesRequired', Rationale.make('Give each parallel sibling its own worktree.')))
        }
      }
    }
    const limits = yield* Limits
    if ((yield* limits.fitsAttempt(parentAttempt))._tag === 'TooLarge') {
      return yield* Effect.fail(refuse('AttemptTooLarge', Rationale.make('The parent’s own work must fit an attempt.')))
    }
    for (const part of draft.parts) {
      if ((yield* limits.fitsAttempt(part))._tag === 'TooLarge') {
        return yield* Effect.fail(refuse('AttemptTooLarge', Rationale.make('Each part must fit one attempt.')))
      }
    }
    if ((yield* limits.fitsReview(parentReview))._tag === 'TooLarge') {
      return yield* Effect.fail(refuse('ReviewTooLarge', Rationale.make('The parent’s cross-part work must fit one review.')))
    }
    return { _tag: 'ValidSplit', parent, draft, parentReview, parentAttempt }
  })
```

### 2.6 Services for the same transitions

The transition signatures below name the resources a move can read. The engine and browser supply the same service interfaces. The engine owns authoritative writes. The browser’s reactive state reads and folds accepted events and runs the same transition rules against the state it displays. To persist a move it sends the shared request to the engine and folds the committed event response. It supplies IO through the authenticated engine adapter. This keeps the browser’s preview and refusal meanings aligned with the durable transition without transferring authority for clock, files, or process observations.

| Moves | R in both environments | Engine layer | Browser layer |
| --- | --- | --- | --- |
| Submission intake | ProjectState, Authority, Clock, Files, Limits | Validate reports and owner choices before deriving or applying a move | Same submission codec and refusal meanings |
| Task next | Files, Commands, Sessions, Limits | Capture results, command outcomes, and fresh views | Serve authenticated observations to the reactive projection |
| Task back, raise, drop | Files, Limits | Validate integration, review facts, and evidence | Serve the files and limits used by the engine |
| Task split, merge, redistribute | Limits | Measure the proposed parts and cross-part review | Effective limits served by the engine |
| Proposal and Fix | Files, Sessions, Limits where the move uses them | Capture review material, open fresh children, and check retry or acceptance limits | Authenticated file, session, and limit inputs |
| Question answer | Common journal services | Validate the recipient and answer form | Submit the same answer shape |
| Project, Activation, Session | Files, Limits, Sessions where the move uses them | Confirm project changes, observed session changes, and activation results | Reactive project state with engine observations |
| Journal replay | No services | Apply the recorded input to the previous projection | Apply the same input to reactive state |

External work happens through the listed services. Every captured input has a read position. Revalidate when committing, and discard or reconcile work from a replaced basis. For irreversible operations such as starting or pausing a process, reconcile against the session identity before accepting another observation. The pure fold never runs the external effect again.

```typescript
type Projection = Tagged<{ BeforeProject: Empty; Open: { value: Project }; Ended: { value: Project } }>
type StateEdit = (state: Projection, events: readonly StoredEvent[]) => Effect.Effect<
  Readonly<{ state: Project; event: StoredEvent }>, Refusal
>
class ProjectState extends Context.Service<ProjectState, {
  readonly read: Effect.Effect<Projection, Refusal>
  readonly transact: (edit: StateEdit) => Effect.Effect<Project, Refusal>
}>()('Core/ProjectState') {}
class Authority extends Context.Service<Authority, {
  readonly actor: Effect.Effect<Actor, Refusal>
  readonly review: (line: Of<typeof ReviewAddress>, read: ReadPosition) => Effect.Effect<Staff, Refusal>
}>()('Core/Authority') {}
class Clock extends Context.Service<Clock, {
  readonly now: Effect.Effect<Of<typeof Timestamp>, Refusal>
}>()('Core/Clock') {}
class Files extends Context.Service<Files, {
  readonly readTouched: (task: Task) => Effect.Effect<readonly WholeFile[], Refusal>
  readonly integrate: (task: Task, base: Of<typeof IntegrationBase>) =>
    Effect.Effect<readonly WholeFile[], Refusal>
}>()('Core/Files') {}
class Commands extends Context.Service<Commands, {
  readonly run: (task: Task, command: Of<typeof Command>) => Effect.Effect<Of<typeof CommandOutput>, Refusal>
}>()('Core/Commands') {}
class Sessions extends Context.Service<Sessions, {
  readonly start: (staff: Staff) => Effect.Effect<Of<typeof Pane>, Refusal>
  readonly pause: (session: StaffSession) => Effect.Effect<Of<typeof SessionCheckpoint>, Refusal>
  readonly end: (session: StaffSession) => Effect.Effect<Of<typeof Rationale>, Refusal>
}>()('Core/Sessions') {}
type Common = ProjectState | Authority | Clock
type RequestTransitions = Readonly<{
  report: Transition<Extract<Submission, { _tag: 'StaffReport' }>, Project, Common | Files | Limits>
  choose: Transition<Extract<Submission, { _tag: 'HumanChoice' }>, Project, Common | Files | Limits>
}>
const submit = (transitions: RequestTransitions): Transition<
  Submission, Project, Common | Files | Limits
> => (request) => Effect.gen(function* () {
  const identity = yield* Authority
  const actor = yield* identity.actor
  if (request._tag === 'StaffReport' && actor._tag === 'Staff') {
    if (request.report._tag === 'Review') {
      const by = yield* identity.review(request.report.line, request.read)
      if (by.id !== actor.id) {
        return yield* Effect.fail(refuse('WrongActor', Rationale.make('Submit the review from its assigned run.')))
      }
    }
    return yield* transitions.report(request)
  }
  if (request._tag === 'HumanChoice' && actor._tag === 'Human') return yield* transitions.choose(request)
  return yield* Effect.fail(refuse('WrongActor', Rationale.make('Use the input for your authenticated actor.')))
})
type EventLine = StoredEvent['line']['_tag']
type EventOn<L extends EventLine> = Extract<StoredEvent, { readonly line: { readonly _tag: L } }>
type MoveOn<L extends EventLine> = EventOn<L>['move']
type Needs = {
  Task: {
    next: Files | Commands | Sessions | Limits
    back: Files | Limits
    raise: Files | Limits
    restart: Sessions
    split: Limits
    merge: Limits
    redistribute: Limits
    drop: Files | Limits
  }
  Proposal: { submit: Files; next: Sessions | Limits; sendBack: Limits; accept: Limits; remove: never }
  Fix: { submit: Files; next: Files | Sessions | Limits; sendBack: Limits; accept: Limits; takeAsIs: never; back: never }
  Question: { answer: never }
  Project: { next: Files | Limits | Sessions }
  Activation: { next: Limits | Sessions; back: Sessions }
  Session: { next: Sessions }
}
type LiveTransitions = {
  readonly [L in EventLine]: {
    readonly [M in MoveOn<L>]: Transition<
      Readonly<Omit<EventOn<L>, 'number' | 'at' | 'actor' | 'move' | 'input'> & {
        move: M
        input: Extract<EventOn<L>['input'], { readonly _tag: M }>
        actor: Actor
      }>,
      Project,
      Common | Needs[L][M & keyof Needs[L]]
    >
  }
}
type FoldMoves = {
  readonly [L in EventLine]: Transition<Readonly<{ state: Projection; event: EventOn<L> }>, Project>
}
const foldMove = (moves: FoldMoves, state: Projection, event: StoredEvent): Effect.Effect<Project, Refusal> => {
  if (Schema.is(TaskEvent)(event)) return moves.Task({ state, event })
  if (Schema.is(ProposalEvent)(event)) return moves.Proposal({ state, event })
  if (Schema.is(FixEvent)(event)) return moves.Fix({ state, event })
  if (Schema.is(QuestionEvent)(event)) return moves.Question({ state, event })
  if (Schema.is(ActivationEvent)(event)) return moves.Activation({ state, event })
  if (Schema.is(SessionEvent)(event)) return moves.Session({ state, event })
  if (Schema.is(ProjectEvent)(event)) return moves.Project({ state, event })
  return Effect.fail(refuse('WrongMove', Rationale.make('The event needs a move on its own line.')))
}
const applyEvent = (moves: FoldMoves, state: Projection, event: StoredEvent): Effect.Effect<Project, Refusal> => {
  const before = state._tag === 'BeforeProject' ? 0 : state.value.read
  if (event.number !== before + 1) {
    return Effect.fail(refuse('InvalidInput', Rationale.make('Apply stored events once and in journal order.')))
  }
  return Effect.map(foldMove(moves, state, event), (project) => ({
    ...project, read: ReadPosition.make(event.number),
  }))
}
const fold = (moves: FoldMoves, events: readonly StoredEvent[], before: Projection) =>
  Effect.reduce(events, () => before, (state, event): Effect.Effect<Projection, Refusal> =>
    Effect.map(applyEvent(moves, state, event), (value) => ({ _tag: value.status._tag, value })),
  )
```

### 2.7 Queries and the tree

`nextStep` reads the same owed edges from the line definitions. Its result is a derived selection for wait and the page. It tells staff which subject needs a report and tells the human when the active phase needs a choice. A question tells its recipient to answer. Background engine moves follow from their guards. When a submission arrives, check the current phase, authority, read basis, and the active review assignment before deriving or applying a move. Staff see a review report step when they are recorded in Reviewing as `by`.

The stage and scope joins below provide the material for a leaf review. A parent reviews the next level across its subtasks. For uneven branches this draft uses subtree height to select the parent’s level. When a parent sees a break, each cite has to resolve to the subtask responsible for those lines. Refuse an ambiguous cite before moving any task. Starting a subtask checks its serial dependencies and each concurrently active sibling’s schedule. The staffing guard uses canonical roles and subscription records from the project and the proposal. The host and pipeline staff get at least one subagent each, including when both roles share that staff.

```typescript
type Due = Readonly<{ for: 'Report' | 'Choose' | 'Answer'; subject: LineTarget; since: EventNumber }>
const sameActor = (a: Actor, b: Actor) => a._tag === b._tag && a.id === b.id
const serves = (project: Project, actor: Actor, role: Role) =>
  actor._tag === 'Staff' && staffFor(project, role)?.id === actor.id
const hostStaff = (project: Project) => staffFor(project, project.host)

const hasStage = (task: Task, stage: Stage) => task.stages.some((here) => here.id === stage.id)
const dependenciesReady = (project: Project, task: Task) => {
  if (task.parent === null) return true
  const parent = project.tasks.get(task.parent.id)
  if (parent === undefined) return false
  const siblings = subtaskList(project, parent)
  const active = siblings.filter(({ id, phase }) => id !== task.id &&
    (phase._tag === 'Working' || phase._tag === 'ReadyToReview' || phase._tag === 'Reviewing'))
  const separate = active.every((sibling) => sibling.worktree !== task.worktree)
  return separate && parent.dependencies.every(({ before, after, scheduling }) =>
    !hasStage(task, after) || hasStage(task, before) ||
    (scheduling === 'Parallel'
      ? project.contracts.has(parent.id)
      : siblings.some((sibling) => hasStage(sibling, before) && sibling.phase._tag === 'Done')),
  )
}
const hasLive = (project: Project, actor: Staff) =>
  [...project.sessions.values()].some((session) => session._tag === 'Live' && session.staff.id === actor.id)
const staffForReview = (
  project: Project, events: readonly StoredEvent[], line: Of<typeof ReviewAddress>,
  reviewer: Role, review: Readonly<{ waiting: true }> | Readonly<{ by: Staff }>,
): Staff | null => {
  if (!('waiting' in review)) return null
  const staff = staffFor(project, reviewer)
  if (staff === null) return null
  const [oldest] = staff.subagents > 0 ? [] : hostQueue(project, events)
  const by = staff.subagents > 0 ? staff
    : oldest !== undefined && sameReview(oldest, line) ? hostStaff(project) : null
  return by !== null && hasLive(project, by) && capacity(project, by).freeSubagents > 0 ? by : null
}

const beginReview = (
  project: Project, events: readonly StoredEvent[], line: Of<typeof ReviewAddress>,
  reviewer: Role, review: Readonly<{ waiting: true }> | Readonly<{ by: Staff }>, by: Staff,
): Effect.Effect<Readonly<{ _tag: 'next'; fact: Of<typeof Reviewing> }>, Refusal> => {
  if (staffForReview(project, events, line, reviewer, review)?.id !== by.id) {
    return Effect.fail(refuse('NoCapacity', Rationale.make('Use the staff due to begin this review.')))
  }
  return Effect.succeed({ _tag: 'next', fact: { _tag: 'Reviewing', by } })
}

type TaskReviewMove = Of<typeof taskInput.next | typeof taskInput.back | typeof taskInput.raise>
const taskReviewMove = (
  project: Project, task: TaskAtReview, by: Staff, facts: ReviewFacts, limit: RetryCount,
): Effect.Effect<TaskReviewMove, Refusal> => {
  const { phase } = task
  if (!('by' in phase) || phase.by.id !== by.id) {
    return Effect.fail(refuse('WrongActor', Rationale.make('Use the staff already reviewing this result.')))
  }
  if (facts.findings.some((finding) => finding._tag === 'WrongContract') && !project.contracts.has(task.id)) {
    return Effect.fail(refuse('InvalidEvidence', Rationale.make('Cite a broken promise from the parent’s contract.')))
  }
  return Effect.map(reviewFacts(phase.input, facts), (checked): TaskReviewMove => {
    const { retryCount, pointedOut } = phase.attempt
    const move = deriveReviewMove(checked, pointedOut, retryCount, limit)
    const fact = Reviewed.make({ facts })
    switch (move._tag) {
      case 'Next': return { _tag: 'next', fact }
      case 'Back': return { _tag: 'back', fact }
      case 'Raise': return { _tag: 'raise', fact }
    }
  })
}

type ProposalReviewMove = Of<typeof proposalInput.next | typeof proposalInput.sendBack>
const proposalReviewMove = <T extends Identified>(
  proposal: Proposal<T>, by: Staff, facts: ReviewFacts,
): Effect.Effect<ProposalReviewMove, Refusal> => {
  const phase = proposal.phase
  if (phase._tag !== 'Reviewing' || !('by' in phase) || phase.by.id !== by.id) {
    return Effect.fail(refuse('WrongActor', Rationale.make('Use the staff already reviewing this proposal.')))
  }
  return Effect.map(reviewFacts(phase.input, facts), (checked): ProposalReviewMove => {
    const evidence = Reviewed.make({ facts })
    const hasBreak = checked.output.outcomes.some(
      (outcome) => outcome._tag === 'Breaks' && !alreadyKnown(checked.input, outcome),
    )
    return hasBreak || checked.output.findings.length > 0
      ? { _tag: 'sendBack', cause: evidence }
      : { _tag: 'next', fact: evidence }
  })
}

type WorkMove = Of<typeof taskInput.next | typeof taskInput.back | typeof taskInput.raise | typeof taskInput.drop>
const workMove = (task: Task, report: WorkReport): Effect.Effect<WorkMove, Refusal> => {
  const phase = task.phase
  if (report._tag === 'Began' && phase._tag === 'Sent') {
    return Effect.succeed({ _tag: 'next', fact: report })
  }
  if (report._tag === 'Integrated' && phase._tag === 'Done') {
    return Effect.succeed({ _tag: 'back', fact: report })
  }
  if (report._tag === 'EmptyStage' && (phase._tag === 'Working' || phase._tag === 'Split')) {
    return Effect.succeed({ _tag: 'drop', fact: report })
  }
  if (phase._tag === 'Working' &&
      (report._tag === 'Result' || report._tag === 'TooBig') &&
      report.attempt === phase.attempt.number) {
    return Effect.succeed(report._tag === 'Result' ? { _tag: 'next', fact: report } : { _tag: 'raise', fact: report })
  }
  return Effect.fail(refuse('WrongMove', Rationale.make('This fact does not apply to the current task or attempt.')))
}

const dueProposal = <T extends Identified>(proposal: Proposal<T>, actor: Actor): Due['for'] | null => {
  const phase = proposal.phase
  switch (proposalLine.states[phase._tag].owes) {
    case 'Proposer':
      return sameActor(actor, proposal.proposer) ? actor._tag === 'Human' ? 'Choose' : 'Report' : null
    case 'Reviewer':
      return phase._tag === 'Reviewing' && 'by' in phase && sameActor(phase.by, actor) ? 'Report' : null
    case 'Owner':
      return sameActor(actor, proposal.owner) ? 'Choose' : null
    default:
      return null
  }
}
const dueTask = (project: Project, task: Task, actor: Actor): readonly Due[] => {
  const phase = task.phase
  const subject: LineTarget = { _tag: 'Task', task }
  const since = task.lastChange
  if (isRaised(task)) {
    const { fix } = task.phase
    const target: LineTarget = { _tag: 'Fix', task, fix }
    if (fix._tag === 'Question') return []
    if (fix._tag === 'Evaluating') {
      return fixLine.states[fix._tag].owes === 'Pipeline' && serves(project, actor, project.pipeline)
        ? [{ subject: target, since, for: 'Report' }] : []
    }
    const forActor = fix.proposal._tag === 'Direction'
      ? dueProposal(fix.proposal.value, actor)
      : dueProposal(fix.proposal.value, actor)
    return forActor === null ? [] : [{ subject: target, since, for: forActor }]
  }
  if (phase._tag === 'Raised') return []
  switch (taskLine.states[phase._tag].owes) {
    case 'Assignee':
      return serves(project, actor, task.role) && (phase._tag !== 'Sent' || dependenciesReady(project, task))
        ? [{ subject, since, for: 'Report' }] : []
    case 'Reviewer':
      return phase._tag === 'Reviewing' && 'by' in phase && sameActor(phase.by, actor) ? [{ subject, since, for: 'Report' }] : []
    default:
      return []
  }
}
const isRaised = (task: Task): task is TaskAt<'Raised'> => task.phase._tag === 'Raised'
const nextStep = (project: Project, actor: Actor): Selection => {
  if (project.status._tag === 'Ended') return { _tag: 'Awaiting' }
  if (actor._tag === 'Staff' && !hasLive(project, actor)) return { _tag: 'Awaiting' }
  const tasks = [...project.tasks.values()].flatMap((task) => dueTask(project, task, actor))
  const questions = [...project.questions.values()].flatMap((question): readonly Due[] =>
    questionLine.states[question.state._tag].owes === 'Recipient' && sameActor(question.to, actor)
      ? [{ subject: { _tag: 'Question', question }, since: question.lastChange, for: 'Answer' }] : [],
  )
  const offers = <T extends Identified>(proposal: Proposal<T>, subject: LineTarget): readonly Due[] => {
    const forActor = dueProposal(proposal, actor)
    return forActor === null ? [] : [{ subject, since: proposal.lastChange, for: forActor }]
  }
  const proposals = [...project.proposals.values()].flatMap((entry) => {
    const subject: LineTarget = { _tag: 'Proposal', proposal: entry }
    switch (entry._tag) {
      case 'Direction': return offers(entry.proposal, subject)
      case 'Responsibility': return offers(entry.proposal, subject)
      case 'Contract': return offers(entry.proposal, subject)
      case 'Act': return offers(entry.proposal, subject)
    }
  })
  const staffing = project.staffing._tag === 'Proposed' ? offers(
    project.staffing.proposal, { _tag: 'Staffing', staffing: project.staffing.proposal },
  ) : []
  const activate: readonly Due[] = activationLine.states[project.activation._tag].owes === 'Owner' &&
    sameActor(actor, project.owner) && onboardingAccepted(project)
    ? [{ subject: { _tag: 'Project', project }, since: project.lastChange, for: 'Choose' }] : []
  const [first] = [...tasks, ...questions, ...proposals, ...staffing, ...activate].sort((a, b) => a.since - b.since)
  return first === undefined
    ? { _tag: 'Awaiting' }
    : { _tag: 'Available', subject: first.subject, for: first.for, read: project.read }
}

const onboardingAccepted = (project: Project) =>
  project.staffing._tag === 'Proposed' && project.staffing.proposal.phase._tag === 'Accepted' &&
  [...project.proposals.values()].every(({ proposal }) =>
    proposal.phase._tag === 'Accepted' || proposal.phase._tag === 'Removed')

type ParentReturn = Readonly<{ subtask: Task; outcomes: NonEmpty<BreakingOutcome> }>
type ParentReturns = Tagged<{
  Routed: { returns: NonEmpty<ParentReturn> }
  Unroutable: { refusal: Refusal }
}>
const coversQuote = (stage: Stage, quote: Quote) => {
  switch (stage.where._tag) {
    case 'Project': return true
    case 'File': return stage.where.file === quote.file
    case 'Passage':
      return stage.where.file === quote.file && overlaps(stage.where.lines, quote.lines)
  }
}
const routeParentBreaks = (
  project: Project, parent: TaskAtReview, breaks: NonEmpty<BreakingOutcome>,
): ParentReturns => {
  const pending = new Map<TaskId, ParentReturn>()
  const children = subtaskList(project, parent)
  for (const outcome of breaks) {
    for (const quote of places(outcome.evidence)) {
      const targets = children.filter((part) => part.stages.some((stage) => coversQuote(stage, quote)))
      const [part, ...other] = targets
      if (part === undefined || other.length > 0) {
        return { _tag: 'Unroutable', refusal: refuse('InvalidEvidence', Rationale.make('Cite the stage and passage that put the break on one subtask.')) }
      }
      const prior = pending.get(part.id)
      if (prior === undefined) pending.set(part.id, { subtask: part, outcomes: [outcome] })
      else if (!prior.outcomes.includes(outcome)) {
        pending.set(part.id, { subtask: part, outcomes: [...prior.outcomes, outcome] })
      }
    }
  }
  const [first, ...rest] = pending.values()
  return first === undefined
    ? { _tag: 'Unroutable', refusal: refuse('InvalidEvidence', Rationale.make('A parent break needs a subtask and evidence.')) }
    : { _tag: 'Routed', returns: [first, ...rest] }
}

// Each registry entry is supplied by the implementation under the service contracts above.
declare const requestTransitions: RequestTransitions
declare const liveTransitions: LiveTransitions
declare const foldMoves: FoldMoves

type AssessmentInput = Readonly<{
  task: TaskAt<'Raised'>
  tier: ReviewLevel
  serial: readonly Readonly<{ role: Role; task: Task; breaks: readonly BreakingOutcome[] }>[]
  parallel: readonly Readonly<{ roles: AtLeastTwo<Role>; parent: Task; breaks: readonly BreakingOutcome[] }>[]
}>
const fixLevel = (project: Project, task: TaskAt<'Raised'>): FixLevel => {
  if (task.phase.reason === 'tooBig') return 'split'
  if (task.phase.reason === 'contractWrong' && project.contracts.has(task.id)) return 'contract'
  return reviewLevel(project, task)
}
const scopeApplies = (scope: Scope, stage: Stage, facts: readonly Of<typeof Fact>[]) =>
  scope._tag === 'Everywhere' ||
  (scope.stages._tag === 'AllStages' || scope.stages.stages.some((entry) => entry.id === stage.id)) &&
  scope.facts.every((required) => facts.some((fact) => fact.name === required.name && fact.value === required.value))

const reviewLevel = (project: Project, task: Task): ReviewLevel => {
  const children = subtaskList(project, task)
  if (children.length === 0) return 'rule'
  const below = children.map((part) => reviewLevel(project, part))
  if (below.includes('direction') || below.includes('principle')) return 'principle'
  return below.includes('standard') ? 'direction' : 'standard'
}

const validateStaffing = (project: Project, plan: StaffingPlan): Effect.Effect<StaffingPlan, Refusal> => {
  const roles = plan.staff.flatMap((staff) => staff.roles.map((role) => role.id))
  if (new Set(plan.staff.map((staff) => staff.id)).size !== plan.staff.length) {
    return Effect.fail(refuse('InvalidInput', Rationale.make('Give each staff its own identity.')))
  }
  if (roles.length !== project.roles.size || new Set(roles).size !== roles.length ||
      roles.some((id) => !project.roles.has(id))) {
    return Effect.fail(refuse('InvalidInput', Rationale.make('Assign every project role to exactly one staff.')))
  }
  const subscriptions = new Set(plan.subscriptions.map((subscription) => subscription.id))
  if (subscriptions.size !== plan.subscriptions.length ||
      plan.staff.some((staff) => !subscriptions.has(staff.subscription.id))) {
    return Effect.fail(refuse('InvalidInput', Rationale.make('Use the subscriptions in the staffing plan.')))
  }
  for (const role of [project.host, project.pipeline]) {
    const staff = plan.staff.find(({ roles }) => roles.some((candidate) => candidate.id === role.id))
    if (staff === undefined || staff.subagents === 0) {
      return Effect.fail(refuse('StaffingMinimum', Rationale.make('The host and pipeline each need access to a subagent.')))
    }
  }
  const canonicalRole = (role: Role) => project.roles.get(role.id)!
  const canonicalStaff = (staff: Staff): Staff => {
    const [first, ...rest] = staff.roles
    return {
      ...staff,
      roles: [canonicalRole(first), ...rest.map(canonicalRole)],
      subscription: plan.subscriptions.find((entry) => entry.id === staff.subscription.id)!,
    }
  }
  const [first, ...rest] = plan.staff
  return Effect.succeed({ ...plan, staff: [canonicalStaff(first), ...rest.map(canonicalStaff)] })
}

const sessionMayStart = (project: Project, staff: Staff) => {
  const { liveSessions, sessionLimit } = capacity(project, staff)
  return !hasLive(project, staff) && (sessionLimit._tag === 'Unlimited' || liveSessions < sessionLimit.max)
}
```

### 2.8 Migration map

The map comes from the Round 71 type audit. Paths shown as text name files from that audit which are absent on the Metis-first base.

Use the table when moving the existing code. Each name below is a named first-party declaration or a schema used as a type at the `cf8c8c3` checkout. A group shares its destination. **Boundary** keeps the type in its adapter and makes its domain input or view explicit. The Quint and fixture rows identify their migration home for the later model and replay pass.

##### Domain and persistence

| Current module | Current types | New home |
| --- | --- | --- |
| [src/config/config.ts](../../src/config/config.ts#L50) | `ConfigRead` | Boundary decoding into Project proposals and settings |
| [src/config/core.ts](../../src/config/core.ts#L36) | `Raw` | Raw config input boundary |
| [src/config/staffing.ts](../../src/config/staffing.ts#L21) | `AuthoredRole`, `AuthoredStaffing`, `Execution`, `Staff`, `Allowed`, `StaffAssignment`, `StaffAccount`, `StaffCli`, `StaffModel`, `Staffing`, `RoleBinding` | StaffingPlan and checked role-to-staff assignment |
| [src/domain/actor.ts](../../src/domain/actor.ts#L9) | `Human`, `Actor` | Actor, Human, Staff at the domain boundary |
| [src/domain/actor.ts](../../src/domain/actor.ts#L43) | `Author` | Removed → Actor on StoredEvent |
| [src/domain/actor.ts](../../src/domain/actor.ts#L14) | `Agent` | Removed → identities are Human or Staff and the run is an Attempt or perspective |
| [src/domain/actor.ts](../../src/domain/actor.ts#L25) | `PersonChannel` | Removed → the source channel has no effect on a move |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L22) | `TaskRef` | Submission and the matching StoredInput of the Task, Proposal, Question, or Project line |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L20) | `Points` | Removed as a separate record → breaking outcomes returned to the attempt |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L114) | `ReviewResult`, `CheckResult` | Removed → Outcome and the move derived from ReviewFacts |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L18) | `LoopReviewMode` | Removed → method chosen by the reviewing role |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L23) | `FixRef` | Removed → nested Fix reached on the Task line |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L21) | `AskRef`, `TaskTarget`, `FixTarget`, `AskAbout`, `Ask`, `DecideAsk` | Removed → stage-appropriate line moves and their subjects |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L24) | `MakerRef` | Removed → the attempt number on the task’s move |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L198) | `RefusalName`, `RefusalNameCase`, `Refusal` | Renamed or retained → one Refusal with a closed reason |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L36) | `ActorCase`, `Actor` | Renamed → Actor is Human or Staff |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L127) | `OpenBody`, `Body` | Renamed → StoredInput variants |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L187) | `ActEnvelope` | Renamed → stored event or authenticated request |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L70) | `Prompt`, `QuestionForm`, `QuestionBody`, `AnswerBody`, `QuestionAsk` | Retained or renamed → Question, QuestionForm, Answer, and QuestionPrompt |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L104) | `ReplyName`, `Reply`, `Resolution`, `LoopDecision` | State → Proposal and Fix moves, including the human response |
| [src/domain/c16-acts.ts](../../src/domain/c16-acts.ts#L134) | `Evaluation` | State → Task.Raised.fix.Evaluating and its chosen level |
| [src/domain/closed.ts](../../src/domain/closed.ts#L9) | `Authority`, `RoleIcon`, `Level`, `Principle`, `Reason` | Closed rule, responsibility, and presentation vocabulary at the relevant boundary |
| [src/domain/context.ts](../../src/domain/context.ts#L55) | `ScopeMatch` | Derived scopeApplies and the StageView of a pinned TaskContext |
| `src/domain/direction-journal.ts:9` | `RuleContent`, `StandardContent`, `StandardLimit`, `DirectionInput`, `Edit`, `DirectionEdit` | Proposal<Direction> and its decoded submit input |
| `src/domain/directions.ts:139` | `FlowPlace`, `FlowEnd`, `FlowStep`, `Flow`, `DirectionFlow` | Removed → Direction.stages and derived StageView |
| `src/domain/directions.ts:59` | `EvidenceCheck`, `Checker` | Removed → Verification and Outcome |
| `src/domain/directions.ts:42` | `Spot`, `Sample` | Renamed → Quote and Example |
| `src/domain/directions.ts:137` | `Where` | Renamed → Scope |
| `src/domain/directions.ts:14` | `LineRange`, `RuleRef`, `RuleRefInput`, `Written`, `CaseInput`, `RuleCase`, `SearchScope`, `RuleEvidence`, `Evidence`, `Verification`, `FactKey`, `FactValues`, `FactEntry`, `FactsMap`, `NonEmptyFacts`, `Facts`, `RequiredFacts` | Stage, Scope, Direction, Verification, Example, and Evidence |
| [src/domain/errors.ts](../../src/domain/errors.ts#L19) | `Refused`, `UsageError`, `OutsideSystem`, `OutsideFailed`, `StoreDamaged`, `Expected` | Refusal at the shared transition boundary |
| [src/domain/events.ts](../../src/domain/events.ts#L53) | `Outside`, `SourceMove`, `Source` | Boundary → import or observation recorded with the corresponding proposal or evidence |
| [src/domain/events.ts](../../src/domain/events.ts#L232) | `TokenHash` | Boundary → verified session or attempt credential in Authority |
| [src/domain/events.ts](../../src/domain/events.ts#L409) | `EventBy` | Derived → edge authority and authenticated Actor |
| [src/domain/events.ts](../../src/domain/events.ts#L129) | `Destination`, `DropReason`, `SendMove`, `Line`, `Enter`, `Send` | Removed from the journal → live terminal transport |
| [src/domain/events.ts](../../src/domain/events.ts#L405) | `AuthorTag`, `WrittenBy`, `AuthorsOf` | Removed → Actor authority on the line edge |
| [src/domain/events.ts](../../src/domain/events.ts#L301) | `EventGroup`, `GroupOf`, `DataOf`, `CreateOf`, `MoveOf`, `MoveTag`, `Kind`, `Total`, `CreateData`, `MoveData`, `Created`, `Moved`, `EventOf` | Removed → one StoredEvent shape and move-indexed StoredInput |
| [src/domain/events.ts](../../src/domain/events.ts#L456) | `Draft` | Renamed → Submission until StoredEvent is assigned |
| [src/domain/events.ts](../../src/domain/events.ts#L85) | `WorkflowMove`, `Workflow`, `RoleMove`, `Role`, `WorkOpened` | Renamed → Project or proposal moves in StoredInput |
| [src/domain/events.ts](../../src/domain/events.ts#L299) | `Event`, `RecordedBy`, `RecordedOf`, `Recorded` | Renamed → StoredEvent |
| [src/domain/events.ts](../../src/domain/events.ts#L171) | `ReviewWritten`, `Review` | Renamed → a review move carrying ReviewFacts |
| [src/domain/events.ts](../../src/domain/events.ts#L115) | `FitAnswer` | Renamed → staff rationale in StaffingPlan |
| [src/domain/events.ts](../../src/domain/events.ts#L256) | `WorkActed`, `WorkEvent` | Renamed → the Task, Question, and Project moves |
| [src/domain/events.ts](../../src/domain/events.ts#L83) | `Generation`, `Activation` | State → Project.activation |
| [src/domain/events.ts](../../src/domain/events.ts#L274) | `WorkForwarded`, `WorkForwardDropped` | State → Proposal<Act> waiting for the human, then accepted or removed |
| [src/domain/events.ts](../../src/domain/events.ts#L270) | `WorkHostPane` | State → StaffSession.Live |
| [src/domain/events.ts](../../src/domain/events.ts#L76) | `OnboardedDirection`, `Why`, `RevisionMove`, `Revision` | State → online or onboarding Proposal<Direction> |
| [src/domain/events.ts](../../src/domain/events.ts#L48) | `Text`, `NonEmpty` | StoredEvent and its tagged StoredInput |
| [src/domain/files.ts](../../src/domain/files.ts#L17) | `ContextKey`, `ContextFileKey`, `FactFileKey`, `FactInput`, `ContextFacts`, `ScopeFile`, `ScopeConditions`, `ContextFile`, `WhereFile`, `DeciderFile`, `RuleTest`, `RuleRef`, `SearchPathInput`, `SearchScope`, `Fit`, `Written`, `Sample` | Authored guidance, file, and project input codecs at the boundary |
| [src/domain/files.ts](../../src/domain/files.ts#L115) | `Example`, `RuleCaseInput`, `RuleEvidence`, `RuleFile`, `StandardFile`, `Examples`, `Place`, `StepAt`, `Marked`, `Unmarked`, `FlowStep`, `MarkedStep`, `Flow`, `RulesOf`, `RuleCases`, `DirectionFile`, `ReviseFile` | Authored guidance, file, and project input codecs at the boundary |
| [src/domain/files.ts](../../src/domain/files.ts#L375) | `ExternalSource`, `CompanyFolder`, `CompanyCheckers`, `Snapshot` | Authored guidance, file, and project input codecs at the boundary |
| [src/domain/ids.ts](../../src/domain/ids.ts#L8) | `PositiveInt`, `ModelId`, `CliId`, `AccountId`, `SourceId`, `ProjectId`, `RunName`, `SlotId`, `ReportId`, `CheckpointId`, `RequestId`, `RunId`, `ActId`, `ChildHandle`, `PaneId`, `Socket`, `LaunchId` | Purpose-branded identities used on their own records, in stored inputs, and as UI or map keys |
| [src/domain/ids.ts](../../src/domain/ids.ts#L85) | `ConsultId`, `Digest`, `Verifier`, `Nonce`, `CommitId`, `SourceRevision`, `Anchor`, `ReviewId`, `RevisionId`, `ChildId`, `RejectId`, `AnswerId`, `PersonId`, `StandardEntry`, `RuleEntry`, `ActorKey`, `StepKind` | Purpose-branded identities used on their own records, in stored inputs, and as UI or map keys |
| [src/domain/ids.ts](../../src/domain/ids.ts#L228) | `GitTag`, `RepoUrl`, `ProjectPath`, `LocalRepositoryPath`, `RelativeRepositoryPath`, `RepositoryLocation`, `CharsOf`, `Visible`, `NonBlank`, `Counted`, `Prefix`, `IdByKind`, `Counters` | Purpose-branded identities used on their own records, in stored inputs, and as UI or map keys |
| [src/domain/ids.ts](../../src/domain/ids.ts#L124) | `SendId` | Removed from the journal |
| [src/domain/ids.ts](../../src/domain/ids.ts#L114) | `ForwardId` | Removed → ProposalId of the relayed Act |
| [src/domain/ids.ts](../../src/domain/ids.ts#L53) | `HelperId`, `JobId`, `TurnId`, `MakerId`, `AskId`, `MakerKey`, `FixKey`, `PairKey`, `ObligationId`, `WorkerRef` | Removed → Task and Attempt, Question, nested Fix, StaffSession, and derived edges |
| [src/domain/ids.ts](../../src/domain/ids.ts#L108) | `EventRef` | Renamed → EventNumber |
| [src/domain/ids.ts](../../src/domain/ids.ts#L179) | `ItemKey` | Renamed → identity within a direction version |
| [src/domain/ids.ts](../../src/domain/ids.ts#L165) | `Member` | Renamed → Role served by Staff |
| [src/domain/ids.ts](../../src/domain/ids.ts#L216) | `WorkerId` | Renamed → StaffId |
| [src/domain/ids.ts](../../src/domain/ids.ts#L32) | `SectionId` | Renamed → StageId |
| [src/domain/ids.ts](../../src/domain/ids.ts#L141) | `VersionId` | Renamed → Version<T>.id |
| [src/domain/ids.ts](../../src/domain/ids.ts#L24) | `DirectionId`, `RoleId`, `StandardId`, `RuleId`, `StaffId`, `SessionId`, `TaskId`, `QuestionId` | Retained → identity of the matching record |
| [src/domain/lookup.ts](../../src/domain/lookup.ts#L10) | `Found` | Derived lookup of the Project records |
| [src/domain/model.ts](../../src/domain/model.ts#L45) | `Text`, `NonEmpty`, `NonEmptyMap`, `Context`, `ConditionKey`, `Source`, `Limit`, `DirectionContent`, `Why`, `RevisionOrigin`, `Direction`, `DirectionBase`, `OfficialDirection`, `Standard`, `Rule`, `ReviewBase` | Project guidance, immutable Versions, and Proposal phases |
| [src/domain/model.ts](../../src/domain/model.ts#L74) | `By`, `Reviser` | Removed as attribution types → Actor on the stored move |
| [src/domain/model.ts](../../src/domain/model.ts#L65) | `Section` | Removed → Stage |
| [src/domain/model.ts](../../src/domain/model.ts#L126) | `Revision` | Renamed → Proposal<Direction> |
| [src/domain/model.ts](../../src/domain/model.ts#L195) | `Review` | Retained → Review<T> contract |
| [src/domain/model.ts](../../src/domain/model.ts#L102) | `Version` | Retained → Version<T> with the subject value |
| [src/domain/model.ts](../../src/domain/model.ts#L202) | `Accept`, `Reject` | State → owner’s proposal moves or the derived outcome of review |
| [src/domain/moves.ts](../../src/domain/moves.ts#L16) | `In`, `PendingSend`, `MoveKind` | LineAddress, Submission, and journal routing by move |
| [src/domain/onboarding.ts](../../src/domain/onboarding.ts#L12) | `Text`, `Discovery`, `Candidate`, `QuestionTarget`, `Deviation`, `OnboardingChoice`, `QuestionFields`, `AiQuestion`, `AnsweredQuestion`, `OnboardingFlow`, `Content`, `Previous`, `DraftOfFile`, `Asked`, `DirectionStage`, `OnboardingDirection`, `OnboardingDirectionState` | Project proposals and Question phases |
| [src/domain/onboarding.ts](../../src/domain/onboarding.ts#L159) | `RoleDecision`, `RoleReview`, `OnboardingRoleState`, `Block`, `OnboardingRole`, `Reviewed`, `OnboardingAct` | Project proposals and Question phases |
| `src/domain/roles.ts:15` | `Approve`, `Multiple`, `DeciderGroup`, `Decider` | Removed → one reviewer, and the direction owner accepts its proposal |
| `src/domain/roles.ts:22` | `ProgramAct`, `ProgramRole` | Removed → rule verification commands run in ReadyToReview |
| `src/domain/roles.ts:87` | `AgentRole`, `Role` | Renamed or retained → Role |
| `src/domain/roles.ts:67` | `RoleChange`, `RoleBinding` | Renamed → Version<Responsibility> and its proposal |
| `src/domain/roles.ts:11` | `RoleRefs`, `Directions`, `Do`, `Review`, `Change`, `Assign`, `Power`, `RoleAct`, `Fitness`, `ModelLimits`, `RoleIndex`, `Bindings`, `Pipeline`, `ConfigFile`, `Commands`, `ModelSettings`, `Settings` | Role, Version<Responsibility>, and the project’s role roster |
| `src/domain/scalars.ts:190` | `BelowCount`, `AtMostCount`, `Below`, `AtMost` | Boundary → runtime configured limits checked by Limits |
| `src/domain/scalars.ts:11` | `Goal`, `StandardSays`, `RoleIntro`, `WorkDescription`, `Responsibility`, `StepWords`, `DecisionReason`, `FitReason`, `Explanation`, `NextStep`, `PlacementReason`, `Observation`, `StoreIssue`, `OutputDescription`, `ResultOutput`, `RuleSays`, `Summary` | Refined scalar schemas at the field’s boundary |
| `src/domain/scalars.ts:48` | `RoleDescription`, `QuestionText`, `OptionText`, `Placeholder`, `MarkWords`, `DirectionSays`, `AnswerText`, `RevisionWords`, `Quote`, `DecisionWords`, `ItemStatement`, `FixSummary`, `CaseWords`, `Excerpt`, `CandidateWords`, `FindingEvidence`, `Command` | Refined scalar schemas at the field’s boundary |
| `src/domain/scalars.ts:83` | `LaunchCommand`, `MatchText`, `SendText`, `ItemName`, `TopName`, `TaskName`, `DirectionName`, `RuleName`, `StandardName`, `ObserverName`, `ContextValue`, `ExternalLabel`, `SearchUnknown`, `RoleDraftWords`, `EstimateBasis`, `PlanName`, `LimitName` | Refined scalar schemas at the field’s boundary |
| `src/domain/scalars.ts:122` | `LimitWords`, `StartInput`, `RetryInput`, `FileText`, `Positive`, `ActivationId`, `LineNumber`, `FitQuestionId`, `TokenCount`, `Minutes`, `Hours`, `Milliseconds`, `Characters`, `Count`, `Tick`, `HostTurn`, `ItemVersion` | Refined scalar schemas at the field’s boundary |
| `src/domain/scalars.ts:171` | `CardVersion`, `DraftNumber`, `BasisRevision`, `VersionSum`, `Occurrence`, `OptionIndex`, `WindowShare`, `RefreshDate` | Refined scalar schemas at the field’s boundary |
| `src/domain/scalars.ts:23` | `ReviewPoint` | Removed → breaking Outcome |
| `src/domain/scalars.ts:179` | `FixStep` | Removed → nested proposal phase and its lastChange |
| `src/domain/scalars.ts:136` | `Seq`, `Cursor` | Renamed → EventNumber and ReadPosition |
| `src/domain/scalars.ts:221` | `UtcTime`, `Time` | Renamed → Timestamp |
| `src/domain/scalars.ts:140` | `Generation`, `Epoch` | State → StaffSession lifetime |
| [src/domain/staffing-sketch.ts](../../src/domain/staffing-sketch.ts#L6) | `SubscriptionProvider`, `SubscriptionEstimate`, `Estimate`, `Subscription`, `SessionLimit`, `Children`, `Parking`, `StaffRoute`, `StaffRole`, `StaffCard`, `Arrow`, `StaffArrangement`, `StaffingLimit`, `StaffingEdit`, `StaffingPost` | StaffingPlan proposal input and the page’s edit form |
| `src/domain/staffing-view.ts:8` | `Unknown`, `Bound`, `ArrangedRole`, `ArrangedAgent`, `LimitConsequence`, `StaffingWarning`, `StaffingView`, `StaffingPreview`, `StaffingReview`, `CheckedStaffingPreview`, `StaffingPreviewTicket` | Derived view of the Staffing proposal, its effective version, and capacity |
| `src/domain/staffing-view.ts:53` | `ConsultReview` | Removed → Question to the host about the Staffing proposal |
| `src/domain/staffing-view.ts:7` | `ReviewMode` | Removed → method chosen by the reviewing role |
| [src/domain/ui-model.ts](../../src/domain/ui-model.ts#L17) | `Text`, `DraftChange`, `DirPick`, `DirView`, `AiToast`, `DirectionView`, `TermKey`, `KeyReceipt`, `ServerMessage`, `PageMessage`, `OnboardingView`, `StartView`, `DirectionCard`, `CardHead`, `DirectionWords`, `FlowStepView`, `ExampleView` | Derived Project views and the page’s transport types |
| [src/domain/ui-model.ts](../../src/domain/ui-model.ts#L254) | `SampleView`, `SpotView`, `CaseLine`, `QuestionView`, `AnsweredView`, `RoleCardBase`, `RoleCard` | Derived Project views and the page’s transport types |
| [src/domain/ui-model.ts](../../src/domain/ui-model.ts#L24) | `Send`, `SendState`, `DropReason` | Removed from state → live terminal transport |
| [src/domain/work-acts.ts](../../src/domain/work-acts.ts#L38) | `Verdict` | Removed → deriveReviewMove |
| [src/domain/work-acts.ts](../../src/domain/work-acts.ts#L35) | `ItemRec` | Renamed → Direction versions and their standards and rules |
| [src/domain/work-acts.ts](../../src/domain/work-acts.ts#L40) | `TaskSpec` | Renamed → the task’s sendTask input and validated stage slice |
| [src/domain/work-acts.ts](../../src/domain/work-acts.ts#L19) | `RuleAddress`, `KnownBreak`, `Form`, `Level`, `RoleDraft`, `Versions`, `Drafted`, `DraftItems`, `Keys` | StoredInput of the task line and pinned guidance for ReviewInput |
| `src/domain/work-state.ts:10` | `TaskResult` | Renamed → Result with published outcomes |
| `src/domain/work-state.ts:20` | `TaskDecision` | State → Done follows derived acceptance or the owner’s takeAsIs move |
| `src/domain/work-state.ts:34` | `TaskParent` | State → Task.parent is the parent by value or null at the root |
| `src/domain/work-state.ts:15` | `TaskHistory`, `TaskPhase`, `Task` | Task and its phase payloads |
| [src/domain/work.ts](../../src/domain/work.ts#L34) | `CreatedId`, `Logged`, `Fit`, `Work`, `Stepped` | Project and the outcome of applying a journal move |
| [src/domain/worker-runtime.ts](../../src/domain/worker-runtime.ts#L41) | `AdmissionPolicy` | Derived → capacity from the staffing version and active states |
| [src/domain/worker-runtime.ts](../../src/domain/worker-runtime.ts#L17) | `WorkerStep`, `Turn` | Derived → nextStep and the current StaffSession |
| [src/domain/worker-runtime.ts](../../src/domain/worker-runtime.ts#L36) | `WorkerDelivery` | Removed → delivery transport and authentication stay outside the journal |
| [src/domain/worker-runtime.ts](../../src/domain/worker-runtime.ts#L50) | `ChildReservation`, `SerialAssignment`, `ChildRelease` | Removed → live perspectives of active Task and Reviewing phases drive capacity |
| [src/domain/worker-runtime.ts](../../src/domain/worker-runtime.ts#L16) | `WorkerPlacement`, `WorkerMember` | Renamed → Staff and its assigned Roles |
| [src/domain/worker-runtime.ts](../../src/domain/worker-runtime.ts#L8) | `Text`, `Number`, `Nullable`, `Versions`, `RuntimeEvent` | StaffSession and the associated journal inputs and derived capacity |
| [src/domain/worker-runtime.ts](../../src/domain/worker-runtime.ts#L67) | `RecheckFinding`, `RecheckBrief`, `RecheckUse` | State → ordinary ReviewInput and findings for a task with GuidanceChanged |
| [src/files/activation.ts](../../src/files/activation.ts#L16) | `Pending`, `Revision`, `RecordFile`, `ActivationRecord`, `PendingLaunch` | Activation line persistence and observed session outcomes |
| [src/files/company.ts](../../src/files/company.ts#L29) | `LockEntry`, `Lock` | Imported Version<Direction> and the Git import adapter |
| [src/files/onboarding.ts](../../src/files/onboarding.ts#L187) | `Confirmation`, `RoleStates`, `Draft`, `OnboardingFiles`, `RoleNotes`, `DirectionDraft`, `QuestionDraft`, `HostAct`, `PersonAct`, `StartFile`, `Start` | Project proposals, Question, and authored file input codecs |
| [src/files/onboarding.ts](../../src/files/onboarding.ts#L84) | `StaffingConsult` | Removed → Question with a Staffing subject |
| [src/services/io.ts](../../src/services/io.ts#L9) | `WorkIo`, `Terminal`, `Dir`, `Env`, `Now`, `GitUser`, `Tokens`, `IoServices` | Engine service implementations and CLI input/output |
| [src/services/outside.ts](../../src/services/outside.ts#L9) | `Files`, `Spawned`, `Spawn` | Files and Commands engine layers |
| [src/services/store.ts](../../src/services/store.ts#L10) | `ReaderRow`, `Written`, `DirStore`, `Store` | Engine ProjectState journal transaction |
| [src/store/rows.ts](../../src/store/rows.ts#L13) | `Value` | SQLite encoding of StoredEvent |
| [src/store/sqlite.ts](../../src/store/sqlite.ts#L52) | `FileFormat`, `EventRow` | SQLite storage boundary and projection of StoredEvent |

##### Engine and adapters

| Current module | Current types | New home |
| --- | --- | --- |
| [adapters/cli/args.ts](../../adapters/cli/args.ts#L6) | `Args`, `FlagTable`, `ActOf`, `CommandName` | CLI command parsing boundary |
| [adapters/cli/caller.ts](../../adapters/cli/caller.ts#L12) | `Confirm` | CLI input/confirmation boundary |
| [adapters/cli/command.ts](../../adapters/cli/command.ts#L16) | `CliServices`, `Call`, `Command`, `Commands` | CLI adapter to Submission and the live registry |
| [adapters/cli/commands/acts.ts](../../adapters/cli/commands/acts.ts#L91) | `Failure`, `Run`, `Ctx`, `Spec` | CLI registry for Submission and Refusal presentation |
| [adapters/cli/commands/recheck.ts](../../adapters/cli/commands/recheck.ts#L73) | `Report` | CLI review-facts input for a task that re-entered review |
| [adapters/cli/lookups.ts](../../adapters/cli/lookups.ts#L7) | `Of` | CLI projection of Project lookup |
| [adapters/cli/runtime.ts](../../adapters/cli/runtime.ts#L42) | `Read` | CLI reads of ProjectState |
| [adapters/live/activation.ts](../../adapters/live/activation.ts#L39) | `Person` | Engine layer for activation and session observations |
| [adapters/live/host-pane.ts](../../adapters/live/host-pane.ts#L5) | `PaneReading` | Live Pane observation |
| [adapters/live/markers.ts](../../adapters/live/markers.ts#L59) | `Fallbacks`, `Entry`, `Content`, `Inventory`, `Outcome` | File authoring adapter for onboarding proposals |
| [adapters/live/pump.ts](../../adapters/live/pump.ts#L22) | `TmuxPumpOptions`, `TerminalStatus`, `StartOptions`, `TerminalSize`, `PreparedTerminalWrite`, `TerminalTarget`, `TmuxPump`, `PaneRow`, `Ring`, `ControlClient`, `Adopted`, `Capture`, `PumpFacade` | Live terminal transport and Sessions engine layer |
| [adapters/live/readings.ts](../../adapters/live/readings.ts#L8) | `ReadingsOptions` | Engine readout of live session observations |
| [adapters/live/skill-install.ts](../../adapters/live/skill-install.ts#L17) | `At` | Skill installation adapter |
| [adapters/live/status.ts](../../adapters/live/status.ts#L10) | `StatusKind`, `AiStatus`, `Env` | Derived terminal activity presentation |
| [adapters/live/waiting.ts](../../adapters/live/waiting.ts#L15) | `Marker`, `WaitPlace` | CLI wake-up transport around nextStep |
| [adapters/web/acts.ts](../../adapters/web/acts.ts#L8) | `WorkPost` | Authenticated Effect Submission boundary |
| [adapters/web/app/agents.ts](../../adapters/web/app/agents.ts#L12) | `RoleCardData`, `Window`, `Done`, `RoleActs`, `GridProps`, `WindowProps` | Derived browser presentation with ProjectState |
| [adapters/web/app/ai.ts](../../adapters/web/app/ai.ts#L6) | `Toast` | Derived browser presentation with ProjectState |
| [adapters/web/app/api.ts](../../adapters/web/app/api.ts#L21) | `ApiError`, `ActOut`, `WorkOut`, `ActView`, `PageSubmission`, `WorkSender`, `OnboardingActJson` | Derived browser presentation with ProjectState |
| [adapters/web/app/board.ts](../../adapters/web/app/board.ts#L12) | `TaskCardView`, `Subagent`, `Act`, `Forward`, `TerminalActions`, `BoardProps`, `RowProps`, `PersonProps` | Derived browser presentation with ProjectState |
| [adapters/web/app/change.ts](../../adapters/web/app/change.ts#L14) | `Numbered`, `Run`, `Opened` | Derived browser presentation with ProjectState |
| [adapters/web/app/direction.ts](../../adapters/web/app/direction.ts#L12) | `Draft`, `ExampleData`, `SampleData`, `SpotData`, `WrittenData`, `CodeLine` | Derived browser presentation with ProjectState |
| [adapters/web/app/directions.ts](../../adapters/web/app/directions.ts#L13) | `Direction`, `Standard`, `Rec`, `CardProps`, `EncodedItem`, `Edited`, `EditorProps`, `ModalProps` | Derived browser presentation with ProjectState |
| [adapters/web/app/flow.ts](../../adapters/web/app/flow.ts#L12) | `Step` | Derived browser presentation with ProjectState |
| [adapters/web/app/gear.ts](../../adapters/web/app/gear.ts#L18) | `DirData`, `OnboardingData`, `ModelChange`, `ModelField`, `SettingsForm`, `Tab`, `GearProps` | Derived browser presentation with ProjectState |
| [adapters/web/app/main.ts](../../adapters/web/app/main.ts#L20) | `DirData`, `DashData`, `SidebarProps`, `Shown` | Derived browser presentation with ProjectState |
| [adapters/web/app/markdown.ts](../../adapters/web/app/markdown.ts#L8) | `InlineNode`, `Block` | Derived browser presentation with ProjectState |
| [adapters/web/app/modal.ts](../../adapters/web/app/modal.ts#L7) | `ModalProps` | Derived browser presentation with ProjectState |
| [adapters/web/app/onboarding-review.ts](../../adapters/web/app/onboarding-review.ts#L10) | `ReviewDirection`, `Question`, `Draft`, `Rule`, `Example`, `Sample`, `Choice` | Derived browser presentation with ProjectState |
| [adapters/web/app/onboarding-roles.ts](../../adapters/web/app/onboarding-roles.ts#L8) | `View`, `Role` | Derived browser presentation with ProjectState |
| [adapters/web/app/onboarding.ts](../../adapters/web/app/onboarding.ts#L11) | `View`, `Dir`, `Step` | Derived browser presentation with ProjectState |
| [adapters/web/app/pipe-outbox.ts](../../adapters/web/app/pipe-outbox.ts#L3) | `Session`, `Key`, `Stream`, `State` | Derived browser presentation with ProjectState |
| [adapters/web/app/pipe-socket.ts](../../adapters/web/app/pipe-socket.ts#L6) | `Heard`, `Listener`, `Transport`, `Session` | Derived browser presentation with ProjectState |
| [adapters/web/app/pure.ts](../../adapters/web/app/pure.ts#L5) | `Escalation`, `Change`, `Rec`, `DiffLine` | Derived browser presentation with ProjectState |
| [adapters/web/app/questions.ts](../../adapters/web/app/questions.ts#L10) | `Question` | Derived browser presentation with ProjectState |
| [adapters/web/app/review.ts](../../adapters/web/app/review.ts#L15) | `ReviewProps` | Derived browser presentation with ProjectState |
| [adapters/web/app/staffing.ts](../../adapters/web/app/staffing.ts#L11) | `CardInput`, `CardInputs` | Derived browser presentation with ProjectState |
| [adapters/web/app/terminal.ts](../../adapters/web/app/terminal.ts#L13) | `Window`, `Session`, `TerminalProps`, `OpenTerminal` | Derived browser presentation with ProjectState |
| [adapters/web/contract.ts](../../adapters/web/contract.ts#L342) | `DashEscalation`, `DashOwed` | Derived → Question or nested Fix moves from nextStep |
| [adapters/web/contract.ts](../../adapters/web/contract.ts#L283) | `DashWorkerIdentity`, `DashWorkerPermit`, `DashAttempts`, `DashChildren`, `DashWait`, `DashWorkerLane`, `DashWorker` | Derived → StaffCard, its StaffSession, nextStep and capacity |
| [adapters/web/contract.ts](../../adapters/web/contract.ts#L268) | `DashTask` | Derived → TaskCard from TaskPhase |
| [adapters/web/contract.ts](../../adapters/web/contract.ts#L36) | `Text`, `DraftChange`, `AiToast`, `DirPick`, `DirView`, `SpotView`, `SampleView`, `ExampleView`, `StandardsView`, `FlowView`, `QuestionSide`, `QuestionFields`, `QuestionView`, `AnsweredView`, `DirectionWords`, `CardHead`, `DirectionCard` | Project-derived page projections and authenticated Submission codec |
| [adapters/web/contract.ts](../../adapters/web/contract.ts#L165) | `RoleCardBase`, `RoleCard`, `OnboardingView`, `PersonView`, `KeySequence`, `Attach`, `ServerMessage`, `PageMessage`, `TermKey`, `KeyReceipt`, `DashStatus`, `DashSubagent`, `DashTerminal`, `DashColumn`, `DashChange`, `DashRule`, `DashStandard` | Project-derived page projections and authenticated Submission codec |
| [adapters/web/contract.ts](../../adapters/web/contract.ts#L385) | `DashDirection`, `ActivationView`, `MarkerApproval`, `ActivationPost`, `DashTerminalCard`, `DashStatusWord`, `DashMessage`, `PageActBody`, `PageActJson`, `DirectWorkPost`, `ActResponse`, `ModelChange`, `SettingsChange`, `PageAct`, `ActAnswer`, `ApiError`, `IsAny` | Project-derived page projections and authenticated Submission codec |
| [adapters/web/contract.ts](../../adapters/web/contract.ts#L501) | `Agree`, `Must`, `Agreements`, `Mismatches` | Project-derived page projections and authenticated Submission codec |
| [adapters/web/contract.ts](../../adapters/web/contract.ts#L427) | `Dash` | Renamed → derived Dashboard |
| [adapters/web/contract.ts](../../adapters/web/contract.ts#L368) | `DashForward`, `ForwardWorkPost` | State → Proposal<Act> and its human confirmation |
| [adapters/web/dash.ts](../../adapters/web/dash.ts#L24) | `DashForwardInput`, `Reading`, `DashInput` | Derived dashboard from Project and capacity |
| [adapters/web/frozen.ts](../../adapters/web/frozen.ts#L7) | `Env`, `PumpOptions`, `TerminalStatus`, `StartOptions`, `TerminalSize`, `Pump`, `WatcherTiming`, `WatcherOptions`, `Watcher`, `ServerTools`, `ServerOptions`, `ServerHandle`, `DetachedOptions` | Browser/server adapter interfaces |
| [adapters/web/onboard.ts](../../adapters/web/onboard.ts#L6) | `PersonAct` | Authenticated Project Proposal moves |
| [adapters/web/pipe-keys.ts](../../adapters/web/pipe-keys.ts#L7) | `Reply`, `Destination`, `Entry` | Terminal transport and acknowledgement |
| [adapters/web/server.ts](../../adapters/web/server.ts#L576) | `Person` | Authenticated Actor and server boundary |
| [adapters/web/view.ts](../../adapters/web/view.ts#L55) | `DirView`, `OnboardingView`, `ViewContext`, `EvidenceReader`, `Words`, `CardWords` | Project-derived direction, staffing, and onboarding presentation |
| [adapters/words/common.ts](../../adapters/words/common.ts#L38) | `Header` | CLI presentation derived from the current Project |
| [adapters/words/index.ts](../../adapters/words/index.ts#L27) | `LogLine` | CLI presentation derived from the current Project |
| [adapters/words/onboard.ts](../../adapters/words/onboard.ts#L24) | `TextOf` | CLI presentation derived from the current Project |
| [adapters/words/show.ts](../../adapters/words/show.ts#L39) | `Words` | CLI presentation derived from the current Project |
| [adapters/words/work.ts](../../adapters/words/work.ts#L14) | `Lines` | CLI presentation derived from the current Project |
| [core/actions/activation.ts](../../core/actions/activation.ts#L23) | `Binding`, `ActivationState` | Project activation line moves and Sessions |
| [core/actions/config.ts](../../core/actions/config.ts#L121) | `StartFix`, `StartProblem`, `StartState`, `WaitingOn`, `Answer` | Project proposal and activation moves |
| [core/actions/directions.ts](../../core/actions/directions.ts#L129) | `Raw` | Proposal<Direction> and authoring input |
| [core/actions/drafts.ts](../../core/actions/drafts.ts#L164) | `Guard`, `Answer`, `StandardOfFile`, `Built`, `Roles`, `Edit`, `Drafted` | Proposal values, review input, and version publication |
| [core/actions/recheck.ts](../../core/actions/recheck.ts#L244) | `HelperReport` | Done → ReadyToReview with changed guidance |
| [core/actions/support.ts](../../core/actions/support.ts#L19) | `RefusalsOf` | Refusal construction for a move |
| [core/actions/types.ts](../../core/actions/types.ts#L28) | `ActionCall`, `Current`, `ActionServices`, `Action`, `Actions`, `Dispatched`, `Dispatch` | Transition, Submission, ProjectState, and the live move registry |
| [core/actions/work.ts](../../core/actions/work.ts#L106) | `NewToken` | Boundary → authenticated StaffSession or task-plus-attempt proof from Authority |
| [core/actions/work.ts](../../core/actions/work.ts#L112) | `Acted`, `Opened` | Renamed → Project after committing a StoredEvent |
| [core/actions/work.ts](../../core/actions/work.ts#L92) | `ActCall`, `OpenCall` | Task and Project transitions with authenticated Submission |
| [core/derived/c16/accept.ts](../../core/derived/c16/accept.ts#L478) | `Via` | Line edge, actor, basis, and evidence validation |
| [core/derived/c16/admission.ts](../../core/derived/c16/admission.ts#L9) | `Demand`, `Admission` | Derived capacity and explicit move refusals |
| [core/derived/c16/obligations.ts](../../core/derived/c16/obligations.ts#L47) | `Tag` | Derived nextStep and the line’s owed edges |
| [core/derived/c16/replay/acts.ts](../../core/derived/c16/replay/acts.ts#L55) | `ModelAct`, `Fields` | Replay-only projection from the model into Task, Proposal, and StoredEvent |
| [core/derived/c16/replay/itf.ts](../../core/derived/c16/replay/itf.ts#L8) | `Plain`, `TraceState`, `Trace` | Replay-only projection from the model into Task, Proposal, and StoredEvent |
| [core/derived/c16/replay/model.ts](../../core/derived/c16/replay/model.ts#L8) | `MAsk`, `MTask`, `MMaker`, `MFix`, `MStore`, `Variant`, `ModelResult`, `History`, `TaskPhase`, `ModelTask`, `ModelMaker`, `ModelFix`, `ModelStore`, `Vers`, `CTask`, `CMaker`, `CFix` | Replay-only projection from the model into Task, Proposal, and StoredEvent |
| [core/derived/c16/replay/model.ts](../../core/derived/c16/replay/model.ts#L184) | `Cmp`, `Ob` | Replay-only projection from the model into Task, Proposal, and StoredEvent |
| [core/derived/c16/replay/project.ts](../../core/derived/c16/replay/project.ts#L100) | `Ctx` | Replay-only projection from the model into Task, Proposal, and StoredEvent |
| [core/derived/c16/replay/replay.ts](../../core/derived/c16/replay/replay.ts#L51) | `Replayed` | Replay-only projection from the model into Task, Proposal, and StoredEvent |
| [core/derived/can.ts](../../core/derived/can.ts#L19) | `Ctx`, `IntentOf`, `Check` | Derived available moves and Refusal |
| [core/derived/onboarding.ts](../../core/derived/onboarding.ts#L19) | `ExampleState` | Derived Proposal phase and evidence presentation |
| [core/derived/pass9/replay/driver.ts](../../core/derived/pass9/replay/driver.ts#L13) | `WorkerCommand`, `AdmissionCommand`, `PermitsCommand`, `RuntimeDriver`, `Frame` | Replay-only projection and fixtures for StaffSession, capacity, and Reviewing |
| [core/derived/pass9/replay/journal.ts](../../core/derived/pass9/replay/journal.ts#L6) | `Launch`, `Child`, `Worker`, `Job` | Removed old replay nouns → inspect StaffSession, assigned reviews, and Reviewing |
| [core/derived/pass9/replay/journal.ts](../../core/derived/pass9/replay/journal.ts#L5) | `ItemVersions`, `RuntimeRow`, `JournalRow` | Replay-only projection and fixtures for StaffSession, capacity, and Reviewing |
| [core/derived/pass9/replay/live-scheduler.ts](../../core/derived/pass9/replay/live-scheduler.ts#L10) | `Scenario`, `PhaseView` | Replay-only projection and fixtures for StaffSession, capacity, and Reviewing |
| [core/derived/pass9/replay/model.ts](../../core/derived/pass9/replay/model.ts#L8) | `Identity`, `Session`, `TaskPhase`, `JobPhase`, `Phase`, `Route`, `WorkerView`, `AdmissionView`, `PermitsView`, `Fields`, `Frame`, `Witness` | Replay-only projection and fixtures for StaffSession, capacity, and Reviewing |
| [core/derived/pass9/replay/project.ts](../../core/derived/pass9/replay/project.ts#L9) | `Turn`, `Owed`, `Intake` | Replay projection → nextStep and result of the stored move |
| [core/derived/pass9/replay/project.ts](../../core/derived/pass9/replay/project.ts#L25) | `WorkerRead`, `WorkerObservation`, `AdmissionRead`, `PermitsRead` | Replay-only projection and fixtures for StaffSession, capacity, and Reviewing |
| [core/derived/pass9/replay/runtime-port.ts](../../core/derived/pass9/replay/runtime-port.ts#L8) | `WorkerRuntimeProbe` | Replay-only projection and fixtures for StaffSession, capacity, and Reviewing |
| [core/derived/reads.ts](../../core/derived/reads.ts#L76) | `Rejection` | Derived versioned Proposal review and recorded feedback |
| [core/derived/types.ts](../../core/derived/types.ts#L25) | `States`, `Derived`, `Derive`, `DirectionState`, `DirectionStateOf`, `RevisionState`, `RevisionStateOf`, `SendState`, `SendStateOf`, `CanAct`, `CanActOf`, `PendingSend`, `SendsPending` | Derived Project, proposal, and action availability views |
| [core/effects/engine.ts](../../core/effects/engine.ts#L26) | `Words`, `Backoff`, `Memory` | Engine layers for Sessions, Commands, Files, and ProjectState |
| [core/effects/lines.ts](../../core/effects/lines.ts#L7) | `Key` | Terminal launch adapter output |
| [core/effects/recheck.ts](../../core/effects/recheck.ts#L14) | `HelperWords` | Derived return to review and ordinary review instructions |
| [core/effects/rules.ts](../../core/effects/rules.ts#L16) | `RuleRunFailed` | Commands and command evidence refusal |
| [core/effects/types.ts](../../core/effects/types.ts#L32) | `EffectName`, `Selected`, `EffectLog`, `Acted`, `Dispatcher`, `Timing`, `Supervision`, `EffectServices`, `WorkEffect`, `Effects`, `Reconcile` | Live transition registry and engine service adapters |
| [core/effects/wait.ts](../../core/effects/wait.ts#L18) | `WaitEnd`, `WaitOptions` | Derived nextStep and CLI wait transport |
| [core/schema/actions.ts](../../core/schema/actions.ts#L32) | `FilePath`, `Words`, `OfRevision`, `Keys`, `WhyInput`, `None`, `In`, `ActionInput`, `ActionTag`, `InputOf`, `Intent` | Effect schemas for Submission and StoredInput |
| [core/schema/errors.ts](../../core/schema/errors.ts#L14) | `ChoiceKind`, `Choice`, `Refusal` | Refusal and CLI presentation |
| [core/schema/outside.ts](../../core/schema/outside.ts#L8) | `TerminalReading`, `WaitMarker`, `Outside` | Engine session observations and Files input |
| [core/services/pump.ts](../../core/services/pump.ts#L10) | `PumpStart`, `PaneRef`, `Pump` | Sessions engine layer and live terminal transport |
| [core/services/readings.ts](../../core/services/readings.ts#L8) | `Readings` | Engine observation layer |
| [core/state/act.ts](../../core/state/act.ts#L19) | `Act`, `Build` | StoredEvent actor, read position, and wall time |
| [core/state/admission.ts](../../core/state/admission.ts#L8) | `Permits` | Removed → derived capacity |
| [core/state/c16/data.ts](../../core/state/c16/data.ts#L9) | `ItemKind`, `Form`, `ItemRec`, `Versions`, `Verdict`, `Level`, `DraftItems`, `RoleDraft`, `Top`, `TaskSpec` | Task, Direction, and proposal inputs |
| [core/state/c16/effect.ts](../../core/state/c16/effect.ts#L63) | `Of` | Task and nested proposal transitions |
| [core/state/c16/fold.ts](../../core/state/c16/fold.ts#L16) | `WorkToken` | Boundary → Authority verifies the session and, for work, the task and attempt |
| [core/state/c16/fold.ts](../../core/state/c16/fold.ts#L21) | `HostPane` | Project replay and authenticated Actor resolution |
| [core/state/c16/fold.ts](../../core/state/c16/fold.ts#L22) | `WorkFolded` | Renamed → Project |
| [core/state/c16/fold.ts](../../core/state/c16/fold.ts#L20) | `PendingForward` | State → Proposal<Act>.WaitingForOwner |
| [core/state/c16/reads.ts](../../core/state/c16/reads.ts#L129) | `AskSpec`, `AskQuery` | Derived nextStep, guidelines in scope, and Question lookup |
| [core/state/c16/state.ts](../../core/state/c16/state.ts#L16) | `Stage`, `OpenStage` | Removed as a repair ladder → Fix evaluation names the level directly |
| [core/state/c16/state.ts](../../core/state/c16/state.ts#L141) | `AskOccurrence` | Removed → task and proposal phases or Question.state |
| [core/state/c16/state.ts](../../core/state/c16/state.ts#L151) | `WorkState` | Renamed → Project |
| [core/state/c16/state.ts](../../core/state/c16/state.ts#L33) | `Task`, `Brief` | Retained → Task and Brief with pinned versions |
| [core/state/c16/state.ts](../../core/state/c16/state.ts#L81) | `MakerFacts`, `Maker` | State → Attempt inside Work and Review phases |
| [core/state/c16/state.ts](../../core/state/c16/state.ts#L99) | `ClosedFix`, `FixPhase`, `OpenFix`, `FixCandidate`, `FixResolution`, `OpenFixFields` | State → Task.Raised.fix and its nested Proposal |
| [core/state/c16/state.ts](../../core/state/c16/state.ts#L28) | `Form`, `Fix` | Task, Attempt, nested Fix, and Project |
| [core/state/c16/types.ts](../../core/state/c16/types.ts#L82) | `Step`, `Obligation`, `Owed` | Derived → nextStep |
| [core/state/c16/types.ts](../../core/state/c16/types.ts#L28) | `Ask`, `AskKind`, `AskAbout`, `AskId`, `OpenAsk` | Removed → phase and owed edge, or Question with its own identity |
| [core/state/c16/types.ts](../../core/state/c16/types.ts#L14) | `Actor` | Renamed → Actor and its stored locator |
| [core/state/c16/types.ts](../../core/state/c16/types.ts#L68) | `OpenBody`, `Body` | Renamed → StoredInput |
| [core/state/c16/types.ts](../../core/state/c16/types.ts#L70) | `Act` | Renamed → authenticated move and StoredEvent |
| [core/state/c16/types.ts](../../core/state/c16/types.ts#L38) | `Prompt`, `QuestionForm`, `QuestionBody`, `RefusalName`, `Refusal` | Shared Task and Question moves, StoredInput, and Refusal |
| [core/state/c16/types.ts](../../core/state/c16/types.ts#L41) | `AnswerBody`, `Answered` | State → Question.Answered and its validated Answer |
| [core/state/c16/types.ts](../../core/state/c16/types.ts#L66) | `Reply`, `ReplyName` | State → owner’s moves on the nested Fix or Proposal |
| [core/state/cache.ts](../../core/state/cache.ts#L17) | `Cached`, `WorkCache`, `LoadWork` | Storage adapter cache of the Project projection |
| [core/state/fold.ts](../../core/state/fold.ts#L22) | `Step`, `FoldStep`, `Fold` | Pure fold over StoredEvent |
| [core/state/index.ts](../../core/state/index.ts#L18) | `Moment`, `MomentOf` | Derived Project snapshot |
| [core/state/rechecks.ts](../../core/state/rechecks.ts#L5) | `Event` | Derived change-of-guidance input into ReadyToReview |
| [core/state/rechecks.ts](../../core/state/rechecks.ts#L6) | `RecheckQueued`, `RecheckRoute`, `RecheckJob` | Removed → Done returns to ReadyToReview, then enters ordinary Reviewing |
| [core/state/rechecks.ts](../../core/state/rechecks.ts#L7) | `ParkRecord` | State → StaffSession.Paused |
| [core/state/steps/directions.ts](../../core/state/steps/directions.ts#L52) | `JournalPosition`, `Scratch`, `Edit`, `Planned`, `DraftOf`, `DraftFields` | Direction Proposal transitions and Version publication |
| [core/state/steps/workflow.ts](../../core/state/steps/workflow.ts#L20) | `Defined` | Project creation and proposal acceptance |
| [core/state/versions.ts](../../core/state/versions.ts#L20) | `Content`, `Comparison` | Version<T> and read-side comparisons of guidance |
| [core/state/worker-runtime.ts](../../core/state/worker-runtime.ts#L90) | `Runtime` | Removed → Project.sessions and derived capacity |
| [core/state/worker-runtime.ts](../../core/state/worker-runtime.ts#L4) | `Reservation`, `ChildAllocation` | Removed → live sessions and assigned reviews |
| [core/state/worker-runtime.ts](../../core/state/worker-runtime.ts#L5) | `Binding`, `WorkerGeneration` | Renamed → StaffSession |

##### Quint and fixtures

| Current module | Current types | New home |
| --- | --- | --- |
| [adapters/cli/caller.test.ts](../../adapters/cli/caller.test.ts#L21) | `Options` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [adapters/live/pump.test.ts](../../adapters/live/pump.test.ts#L13) | `PersonPane` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [adapters/live/readings.test.ts](../../adapters/live/readings.test.ts#L13) | `Project` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [adapters/web/pipe-keys.test.ts](../../adapters/web/pipe-keys.test.ts#L193) | `MemoryStorage`, `FakeSocket` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [adapters/web/pure.test.ts](../../adapters/web/pure.test.ts#L26) | `Change` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [core/actions/fixture.test.ts](../../core/actions/fixture.test.ts#L34) | `Ran`, `Run`, `Project`, `Harness`, `Outcome` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [core/architecture.test.ts](../../core/architecture.test.ts#L34) | `CoreLayer`, `AdapterLayer`, `Layer` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [core/effects/pass9-conformance-fixtures.ts](../../core/effects/pass9-conformance-fixtures.ts#L131) | `AdmissionFixture` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [core/effects/wait.test.ts](../../core/effects/wait.test.ts#L75) | `Needs` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [core/model/activation.qnt](../../core/model/activation.qnt#L35) | `Content`, `StoreState`, `RecordState`, `World` | Model pass → witness for the corresponding new Project, Line, or adapter behavior |
| [core/model/admission.qnt](../../core/model/admission.qnt#L18) | `Task`, `Job`, `Runtime` | Model pass → capacity derived from active Task and StaffSession |
| [core/model/browser.qnt](../../core/model/browser.qnt#L26) | `Escalation`, `StoreView`, `ServerState`, `BrowserState`, `Card` | Model pass → witness for the corresponding new Project, Line, or adapter behavior |
| [core/model/contract.qnt](../../core/model/contract.qnt#L36) | `Fresh` | Model pass → witness for the corresponding new Project, Line, or adapter behavior |
| [core/model/permits.qnt](../../core/model/permits.qnt#L15) | `RecheckPhase`, `Context`, `Case`, `Scheduler` | Model pass → staff capacity and task review states |
| [core/model/pipe.qnt](../../core/model/pipe.qnt#L35) | `Tmux`, `Pump`, `Socket`, `View`, `Live` | Model pass → witness for the corresponding new Project, Line, or adapter behavior |
| [core/model/protocol.qnt](../../core/model/protocol.qnt#L1319) | `Obligation` | Model pass → witness for the corresponding new Project, Line, or adapter behavior |
| [core/model/store.qnt](../../core/model/store.qnt#L30) | `Versions`, `ActKind`, `Act`, `Page`, `Store` | Model pass → witness for the corresponding new Project, Line, or adapter behavior |
| [core/model/terminals.qnt](../../core/model/terminals.qnt#L52) | `Agent`, `Op`, `Process`, `Pump`, `InputLine`, `OutboxState`, `SendTarget`, `World` | Model pass → witness for the corresponding new Project, Line, or adapter behavior |
| [core/model/types.qnt](../../core/model/types.qnt#L166) | `TaskParts` | Derived → child membership by parent |
| [core/model/types.qnt](../../core/model/types.qnt#L257) | `Top`, `Store` | Model pass → Project |
| [core/model/types.qnt](../../core/model/types.qnt#L130) | `Body`, `Act` | Model pass → StoredInput and StoredEvent |
| [core/model/types.qnt](../../core/model/types.qnt#L86) | `Verdict`, `Form`, `Judgement`, `TestRun`, `Shipment`, `Loop` | Model pass → derived review move, Verification, and nested proposal state |
| [core/model/types.qnt](../../core/model/types.qnt#L88) | `Level`, `Stage`, `FixKind`, `Fix`, `OpenDraft` | Model pass → nested Fix, direct level, and Proposal |
| [core/model/types.qnt](../../core/model/types.qnt#L5) | `Options`, `Actor`, `Item`, `TaskKind`, `Cause`, `Reply`, `Finding`, `Edit`, `Result`, `Decision`, `Evaluation`, `RuleDraft`, `Recheck`, `TaskResult`, `ResultHistory`, `TaskDecision`, `TaskPhase` | Model pass → witness for the corresponding new Project, Line, or adapter behavior |
| [core/model/types.qnt](../../core/model/types.qnt#L176) | `Task`, `Brief`, `Ghost` | Model pass → witness for the corresponding new Project, Line, or adapter behavior |
| [core/model/types.qnt](../../core/model/types.qnt#L82) | `Index`, `AskKind`, `Ask`, `MakerRecord` | Remove in the model pass → Attempt or state that owes the move |
| `core/model/worker.qnt:7` | `Identity`, `Session`, `Delivery`, `Worker` | Model pass → StaffSession, Actor, and the derived step |
| `core/state/c16/work-fixture.probe.ts:6` | `TaskData`, `TaskSeed`, `FixSeed`, `MakerSeed` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [core/state/cache.test.ts](../../core/state/cache.test.ts#L13) | `Ran`, `Project` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [core/state/fold.test.ts](../../core/state/fold.test.ts#L37) | `Ran`, `Project` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [src/config/config.test.ts](../../src/config/config.test.ts#L14) | `Obj` | Test boundary → update the fixture to supply the new records and observe the new moves |
| `src/config/outcome.probe.ts:7` | `Outcome` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [src/config/settings.test.ts](../../src/config/settings.test.ts#L10) | `Obj` | Test boundary → update the fixture to supply the new records and observe the new moves |
| `src/domain/architecture-scalars.probe.ts:6` | `CheckedRole`, `Good`, `Hidden`, `Bare`, `Loose`, `Untagged`, `AliasThroughGenerics`, `Conditional`, `MapOfText`, `LooseTemplate`, `Inferred`, `Unchecked`, `MisusedTransport`, `RawService`, `ProbeFailure`, `OwnInspection` | Architecture tests and probes for the new boundary |
| `src/domain/architecture-scan.probe.ts:4` | `Finding` | Architecture tests and probes for the new boundary |
| [src/files/files.test.ts](../../src/files/files.test.ts#L14) | `Obj`, `Fetched` | Test boundary → update the fixture to supply the new records and observe the new moves |
| [src/files/onboarding.test.ts](../../src/files/onboarding.test.ts#L33) | `Obj` | Test boundary → update the fixture to supply the new records and observe the new moves |

## 3. Path review

### 3.1 Six flows

Each new path starts at the named entry condition and counts committed moves. An arrow inside Reviewing records a fresh child assignment. Parallel branches are shown as separate chains. External test runs, writes, merges, and process observations are named where they gate a move. Current-model counts refer to model steps over the interval stated. The C16 archive contains 120 simulator traces. The cited baseline trace counts are observed intervals. The simulator samples reachable paths. [C16 replay archive](../../core/derived/c16/replay/traces) · [Pass 9 replay archive](../../core/derived/pass9/replay/traces)

#### Sent to Done

- **Shortest path.** Sent → Working when staff report that the attempt began → ReadyToReview with the result → Reviewing waiting with the task’s command outcomes and pinned input → Reviewing by staff once a fresh child opens → Done from the reviewer’s outcomes and findings. That is four phase changes and one assignment in the same phase. The task runs commands before a reviewer consumes a subagent slot. Zero applicable commands give an empty list. Staff with a positive allowance wait for their own slot. A zero allowance uses the host FIFO.
- **Merge and loops.** Result arrival and the collection of command outcomes have separate failure boundaries. Keep ReadyToReview for retry or recovery of those commands. The settled design folds the two review steps into one phase. Identical reports, duplicate assignments, and retries of the same completed command basis add no information. One fresh break returns the same attempt to Working with evidence and a retry increment. Seeing an already pointed-out break again or exhausting the budget derives a raise.
- **Today.** The recorder first opens Execute for the assignee. Starting from Sent, an archived four-step interval is Open(Execute for maker), ReadBrief, Report, Review(Pass), in `coreAskRogue-14`, states 13–17, slot 0. Report opens Check and Review consumes a verdict. The new path removes the brief acknowledgement as a durable step and separates the command evidence and fresh-child assignment from the reviewer’s facts. [Current work transitions](../../core/model/protocol.qnt#L505)

#### Raise to resolution

- **Shortest path for an accepted change.** Start in Raised with Fix Evaluating. Record the assessment in Evaluating → submit a whole direction or contract directly into its proposal’s Reviewing → record the fresh child → review facts pass it to WaitingForOwner → the owner accepts. Five moves. Acceptance publishes the exact version and returns the task to Sent. If a retained result exists, the owner can instead take it as is and finish Done.
- **Branches and loops.** A leaf fixes a rule, a parent fixes a standard, and the tier above fixes a direction. Each changes a part of the direction version. A split contract can get its own proposal. The root at the principle tier asks Nanda the fixed harness question. Oversized work takes the partition branch. The assessment compares rule breaks by role over serial tasks and across parallel roles. A role-specific pattern changes the direction, while Nanda alone changes a role’s broad responsibility. The first draft is invisible until submission; a crash before submit starts again from the assessment. Feedback or new evidence can justify returning. An identical rejected draft or unchanged assessment adds nothing.
- **Today.** Evaluate can go directly to a split or a role draft in InLoop. A guidance fix can traverse AtPrinciple, AtDirection, AtStandard, AtRule, Testing, and Drafting. Ship can publish a standard directly and send the task to its role. At higher levels LoopReview supplies AtPerson, Escalate opens Decide, and Respond can accept or keep a result. Accepted changes can depend on a further Host Reassign. The section 2 path picks the level from the assessment, uses one review and owner gate, and couples publication to returning the task to Sent. The old role-fit fix published a responsibility change. Nanda’s ruling keeps such edits with the owner and routes the pipeline’s evidence about how work is done to the task’s tier in its direction. [Current fix transitions](../../core/model/protocol.qnt#L672)

#### Done reopened by changed guidance

- **Shortest path.** Start from Done and an accepted relevant guidance change. The task goes back to ReadyToReview with its artifact, unaffected outcomes and fresh retry basis → Reviewing waiting with evidence for changed applicable commands → Reviewing by staff → Done when the review holds. Four moves after the change. An actionable break goes to Working with that evidence and returns by the ordinary task path. Unrelated changes leave Done in place.
- **Merge and loops.** Reuse the ordinary ReadyToReview and Reviewing phases. Keep the artifact and its checked versions distinct from the newly approved versions so a stale review can be refused. A second event for the same guidance and artifact adds nothing. A later applicable version is new input and supersedes the review’s basis. A repeat of an already proved break on the same retry basis derives a raise.
- **Today.** A change adds pending items to TaskDone. RunRule can consume command-backed items. A RecheckDone can update Done or send a broken result to Sent. Each takes one model step from TaskDone once its route is eligible. The Pass 9 scheduler models the separate helper. The first park branch in `permits-park` uses seven scheduler/review actions from routeRecheck to RecheckDone, with an unrelated Reassign also interleaved. The second child branch in `permits-child`, states 19–22, uses routeRecheck, helperReports, and RecheckDone. The new route uses the task’s own commands and ordinary fresh review. It removes the parked parent, deferral and helper verdict from this flow. [Current model recheck transitions](../../core/model/protocol.qnt#L995) · [Current scheduled helper](../../core/model/permits.qnt#L177)

#### Parallel subtasks with a contract

- **Shortest path.** Start with a Sent parent whose stage slice needs splitting. Validate the contiguous partition, node and review sizes, depth, distinct worktrees and dependencies. The assigned role supplies the contract for the two dependent siblings before they start. Commit Split with the two Sent children and the promises between those children. Run both children through the task line in parallel. Merge the first Done child. The later child integrates that exact merged base before its own merge. Where the later child already reached Done, integration sends it back to ReadyToReview with new files and evidence, then through Reviewing to Done. The two review passes are necessary when the first pass saw an earlier base. When both integrated results are Done, assemble the parent result → ReadyToReview → Reviewing waiting → Reviewing by staff → Done. Review the next guidance tier across the parent’s parts.
- **Merge and loops.** The partition and contract can share the Split commit if both are ready. Keep subtask branches independent. A child finishes on its own evidence. Sibling integration changes that evidence and gates the later merge. A parent break returns the responsible part to Working and the parent to Split. Repeating integration against the same base with the same files or redistributing to the same partition adds nothing. An ambiguous cite refuses the whole parent return. A broken promise raises contractWrong with evidence at the parent review.
- **Today.** Evaluate(Splits) stores the parent and replaces its slot with a smaller Sent part. The bounded split witness in coreRecordTypes reaches that stored parent. The model covers scope reduction and reuse of the slot. There is no corresponding trace for two concurrent worktrees, a contract or the merge order. Stage partitioning determines disjoint ownership. Dependent siblings may start together once the promises are recorded. The integration check covers which merge happened first and whether the later result was reviewed on that merged base. [Current split behavior](../../core/model/protocol.qnt#L695) · [Current split witness](../../core/model/configs.qnt#L250)

#### Onboarding to activation

- **Shortest path.** Start with a host able to review onboarding material. Directions, responsibilities and staffing use proposals. For each required new proposal, Drafting → Reviewing waiting → Reviewing by staff → WaitingForOwner → Accepted. Independent proposals can overlap. The owner approves the accepted set, taking Onboarding → Activating. After approved file material, the current host acknowledgement and the durable activation commit are confirmed, Activating → Active. That is two activation phase moves after the acceptance prerequisite. A pre-commit failure or cancellation follows Activating → RollingBack → Onboarding once restoration is observed.
- **Merge and loops.** Keep the approval, durable work gate and cleanup distinct. Multiple proposals need only their own generic line. The onboarding host already holds its role when the project opens. It reviews each draft in its own fresh subagent through the ordinary proposal path. The owner sees only drafts that reached WaitingForOwner. That review uses the host’s current assignment before the first staffing plan takes effect. Intermediate activation observations can be held inside the Activating step if the evidence needed after a crash still survives. After a commit, reconciling a missing note completes the same activation. Repeated approval, spawn, acknowledgement or rollback requests against unchanged evidence must leave the effective state unchanged. A human edit to approved material is a different basis, and rollback must preserve it.
- **Today.** activationFixed starts with already-approved files. The shortest fault-free route to the Activated record uses nine actions, reproduced in a focused simulator trace. Write the record, create the inactive store, mark both files, record the launch, spawn it, acknowledge that launch, activate the store, and record the note. Per-file notes can follow the writes and the fixed commit reads file evidence. Activating the store and recording completion have a crash boundary. First work also depends on the binding, credential and top guard. Section 2 puts the approval and outward result on the project line and keeps those physical gates as test seams. The success event carries the current launch, marked file evidence, and durable commit so the pure fold can apply it. [Current activation actions](../../core/model/activation.qnt#L79)

#### Staff session crash and resume

- **Shortest path.** From Live, observe an exit and retire that session in one move. The session event folds `restart` for its Working tasks, returning them to Sent with the same RetryCount. It also releases its assigned reviews back to waiting in entry order. A confirmed replacement creates a new Live record for the same staff through project next. That is two session changes. For a planned pause, Live → Paused saves the checkpoint, and Paused → new Live creates the next lifetime. Starting a Sent task after the crash allocates a fresh attempt. Resuming a checkpoint under a replacement lifetime keeps the attempt. Committed results, answered questions and completed command evidence survive. An interrupted review returns to waiting on its original entry. A new fresh child gets authority. A report from the old child or session is refused even when the staff identity is unchanged.
- **Merge and loops.** An observation and its journal append can share a move. Keep end or pause evidence separate from the confirmed replacement because they can fail independently. Duplicate exit observations, reconnects to the same live process, and repeated submissions with the old authority add nothing. The confirmed exit is the input for these changes. The same fold resets affected task and proposal assignments and preserves earlier command outcomes and answers.
- **Today.** The Round 71 worker trace `worker-replacement`, states 4–7, takes exit, relaunch, then an old submit that is refused. The core model advances the actor epoch on Revive. A role’s revive ends its makers and sends Working back to Sent, while keeping an existing Check on a reported result. The terminal model checks reattach, revive and lost delivery separately. The new path uses one staff lifetime across the staff’s roles, with all eligible duties derived again from the project. [Current core recovery](../../core/model/protocol.qnt#L1063) · [Current terminal recovery](../../core/model/terminals.qnt)

### 3.2 Proof inventory before the replacement

Times are per completed job or logged TLC search phase, as labeled. The search phase excludes translation and startup. A property in a grouped run shares the instance’s runtime. Unrecorded means the checked sources give no duration. A breaking mutant witnesses a missing guard. A negated reachability query witnesses the corresponding positive path. R65 timings come from its Round 65 results in the earlier type audit and TLC summaries. The R66 fresh runs stopped with no violation so far and no final verdict. Other times come from the [model README](../../core/model/README.md) or the archived admission and pipe logs.

These rows record the pre-replacement jobs reviewed in Round 71. The Metis slice uses the active [registry](../../core/model/checks/registry.tsv) below. Pre-replacement model source paths identify where each claim came from. Keep carries the fault-specific claim into a bounded unit or leaves an independent adapter check in place. Split retains the indicated part in focused checks. Drop retires that proof from the redesign. A dash denotes a broad or retired claim with no independent fault class.

**TLC suite labels**

- Core safety — `Sane`, `EveryObligationToldOnce`, `ToldIsAllowed`, `SomethingOwed`, `DoneIsCurrent`, `NoDoneBrokenAtEnd`, `NoLostUpdate`, `NoTakenUndone`, `NoPassOfBadResult`, `NoRefixAtSameLevel`, `NoEscalationWithoutPerson`, `NoAgentChangeAtTop`, `Converges`, `NoWaitCycle`, `AskCap`, `NoExecuteToEndedMaker`.
- Core temporal — `CoreProgress`, `CoreChangesStop`, `CoreSettles`.
- Worker safety — `OldestFirst`, `NoIdentityCrossing`, `NoBlockedOnlyExecutor`.
- Permit safety — `AsksFollowState`, `NoWaitCycle`, `PermitsNeverExceeded`, `NoRecheckInParentContext`, `ChildMakersCharged`.
- Permit temporal — `ParkedResumes`, `DeferredRuns`, `RechecksProgress`, `AdmittedProgress`, `AdmittedSettles`.
- Admission safety — `PipeBound`, `PipeMatchesJobs`, `Ownership`, `RoleBound`, `WorkerChildBound`, `TaskMatchesPermits`, `OneSerialTurn`, `RecheckIndependent`, `NoSerialWithAllowance`.
- Pipe safety — `NoKeystrokeTwice`, `Prefix`, `AtMostOneWriting`, `WritingIsMarked`.

#### Instances

**[configs.qnt](../../core/model/configs.qnt)**

| Instance | Checks | Fault classes | Recorded time | Decision |
| --- | --- | --- | --- | --- |
| `coreTwo` | Check — Core safety, Core temporal<br>Break or witness — `CoreProgressNoPipe` | config changes, corruption | 3,516 s holds and 179 s mutant (R65), earlier 2,702 s and 55 s | Split. Extract basis, scope, and legal shapes. |
| `coreTwoDir` | Check — Core safety, Core temporal | config changes, corruption | 484 s | Split. Extract basis, scope, and legal shapes. |
| `coreTwoExit` | Check — Core safety, Core temporal<br>Break or witness — `CoreProgressNoEngine`<br>Simulator witnesses `NoRestartAssigned`, `NoKeptCheckJudged`, `NoKeptFailAssigned` | crash, timing | 5,597 s holds and 109 s mutant (earlier model). Fresh rerun stopped at 2,901,859 distinct states (R66) | Split. Extract session retirement and unfinished work recovery. |
| `coreLoops` | Check — Core safety, Core temporal | human intervention | 161 s | Split. Extract changed drafts and retry evidence. |
| `coreNoRuleLadder` | Break or witness — `CoreProgress` | — | 54 s | Drop. Retired ladders and broad convergence or simulation. |
| `coreNoLoopLadder` | Break or witness — `CoreProgress` | — | 54 s | Drop. Retired ladders and broad convergence or simulation. |
| `corePersonUnbounded` | Break or witness — `CoreSettles` | human intervention | 54 s | Drop. The owner controls whether editing ends. |
| `coreAsks` | Check — Core safety, Core temporal | human intervention, duplicate, out of order | 195 s (R65) | Split. Keep the one-question boundary and current-answer authority. |
| `coreAsksPipe` | Check — Core safety, Core temporal | human intervention, duplicate, out of order | 855 s (R65) | Split. Keep the one-question boundary and current-answer authority. |
| `coreAskRogue` | Check — Core safety, Core temporal, `AnswererFinishes`<br>Simulator witness `NoRecheckAfterAskRaise` | human intervention, duplicate, out of order | 7,200 s timeout (R65). Fresh rerun stopped at 4,779,214 distinct states (R66) | Split. Keep the one-question boundary and current-answer authority. |
| `coreAskReverse` | Break or witness — `NoWaitCycle` | human intervention, dependency failure | 175 s (R65) | Split. Retain a bounded cycle refusal where actual wait edges exist. |
| `coreAll` | Simulator, Core safety | — | Unrecorded | Drop. Retired ladders and broad convergence or simulation. |
| `coreNoRaise` | Break or witness — `CoreChangesStop`<br>Simulator also breaks `Converges` | — | 1,007 s | Drop. Retired ladders and broad convergence or simulation. |
| `coreNoCross` | Break or witness — `CoreChangesStop`<br>Simulator also breaks `Converges` | — | 109 s | Drop. Retired ladders and broad convergence or simulation. |
| `coreCrossOnly` | Check — `CoreChangesStop`<br>Simulator checks `Converges` | config changes, corruption | 720 s | Split. Extract basis, scope, and legal shapes. |
| `coreNoSplit` | Break or witness — `CoreChangesStop`<br>Simulator also breaks `Converges` | — | 52 s | Drop. Retired ladders and broad convergence or simulation. |
| `coreWhereContext` | Check — `Sane`, `OutputScopeSound`<br>Break or witness — `NoAddedOutputScope` | config changes, corruption | 406 s holds and 197 s witness (R65) | Split. Extract basis, scope, and legal shapes. |
| `coreRecordTypes` | Check — `RecordsHaveTheirFields`, `TakeNeedsResult`<br>Break or witness — `NoStoredSplit` | config changes, corruption | 98 s holds and 96 s witness (R65) | Split. Extract basis, scope, and legal shapes. |

**`worker.qnt`**

| Instance | Checks | Fault classes | Recorded time | Decision |
| --- | --- | --- | --- | --- |
| `workerFixed` | Check — Worker safety, `G1All`<br>Break or witness — `NoYield` / `NoAllIdentities` / `NoHeardAfterPark` / `NoStaleRefusal` | timing, crash, concurrency | Unrecorded | Split. Separate current selection, shared staff, and replacement. |
| `workerSticky` | Break or witness — `G1All`<br>Simulator also breaks `OldestFirst` | timing, crash, concurrency | Unrecorded | Split. Separate current selection, shared staff, and replacement. |
| `workerWrongToken` | Break or witness — `NoIdentityCrossing` | out of order, concurrency | Unrecorded | Keep. Keep wrong authority refusal at the boundary. |

**[permits.qnt](../../core/model/permits.qnt)**

| Instance | Checks | Fault classes | Recorded time | Decision |
| --- | --- | --- | --- | --- |
| `permitsPark` | Check — Permit safety, Permit temporal<br>Break or witness — `NoPark` / `NoParkResume` | timing, dependency failure | Unrecorded | Drop. The recheck helper and park/deferral workflow are retired. |
| `permitsDefer` | Check — Permit safety, Permit temporal<br>Break or witness — `NoDefer` | timing, dependency failure | Unrecorded | Drop. The recheck helper and park/deferral workflow are retired. |
| `permitsChild` | Check — Permit safety, Permit temporal<br>Break or witness — `NoChild` | concurrency, timing | Unrecorded | Split. Separate capacity and independent review authority. |
| `permitsSerial` | Check — Permit safety, Permit temporal<br>Break or witness — `NoSerial` | timing, concurrency | Unrecorded | Split. Separate foreground work and the zero-allowance review route. |
| `permitsAdmission` | Check — Permit safety, Permit temporal<br>Break or witness — `NoSecondDenied` | concurrency, timing | Unrecorded | Split. Derive capacity across yields. |
| `permitsDropParent` | Break or witness — `PermitsNeverExceeded` | concurrency, timing | Unrecorded | Split. Derive capacity across yields. |
| `permitsRetained` | Break or witness — `NoRecheckInParentContext` | concurrency, timing | Unrecorded | Split. Separate capacity and independent review authority. |
| `permitsIgnore` | Break or witness — `RechecksProgress`<br>Simulator witness `NoIgnoredRecheck` | timing, dependency failure | Unrecorded | Drop. The recheck helper and park/deferral workflow are retired. |

**[admission.qnt](../../core/model/admission.qnt)**

| Instance | Checks | Fault classes | Recorded time | Decision |
| --- | --- | --- | --- | --- |
| `admissionPipeOne` | Check — Admission safety, `NoPipeOverlap`<br>Break or witness — `NoRecheckBesideFix` | concurrency, timing | 00 s TLC phase | Split. Prove work and review capacity without a pipe permit lane. |
| `admissionPipeTwo` | Check — Admission safety<br>Break or witness — `NoPipeOverlap` | concurrency, timing | 00 s TLC phase | Split. Prove work and review capacity without a pipe permit lane. |
| `admissionWait` | Check — Admission safety, `NoSaturatedSerial`<br>Break or witness — `NoSaturatedWait` / `NoFailWait` | timing, concurrency | 00 s TLC phase. NoSaturatedWait unrecorded | Split. Check own-slot wait and host queue routing. |
| `admissionZero` | Check — Admission safety<br>Break or witness — `NoSerialReview` | timing, concurrency | 00 s TLC phase | Split. Check own-slot wait and host queue routing. |
| `admissionCollocated` | Check — Admission safety<br>Break or witness — `NoCollocatedOwners` / `NoCollocatedWait` | concurrency, config changes | 00 s TLC phase. NoCollocatedOwners unrecorded | Split. Check shared allowance and distinct role authority. |
| `admissionNoPipeCap` | Break or witness — `PipeBound` | concurrency, crash | 00 s TLC phase | Drop. Independent stored pipeline permits are retired. |
| `admissionDropsPipe` | Break or witness — `PipeMatchesJobs` | concurrency, crash | 00 s TLC phase | Drop. Independent stored pipeline permits are retired. |
| `admissionWrongOwner` | Break or witness — `Ownership` | concurrency, config changes | 00 s TLC phase | Split. Check shared allowance and distinct role authority. |
| `admissionSharedLane` | Break or witness — `RecheckIndependent` | concurrency, timing | 00 s TLC phase | Split. Prove work and review capacity without a pipe permit lane. |
| `admissionSerialOnFull` | Break or witness — `NoSerialWithAllowance` | timing, concurrency | 00 s TLC phase | Split. Check own-slot wait and host queue routing. |
| `admissionPerRoleChildren` | Break or witness — `WorkerChildBound` | concurrency, config changes | 00 s TLC phase | Split. Check shared allowance and distinct role authority. |

**`activation.qnt`**

| Instance | Checks | Fault classes | Recorded time | Decision |
| --- | --- | --- | --- | --- |
| `activationFixed` | Check — `ActivationSafe`, `ActivationEnds`, `RebindEnds`, `BoundHostServed`<br>Break or witness — `ActivatesOrRollsBack` / `NoActive` / `NoRolledBack` / `NoReplacedActive` / `NoBlockedByEdit` / `NoReboundWork` / `NoCancelledByTop` / `NoLateCollection` / `NoLateNote`<br>400-sample ActivationSafe smoke, 108 ms (Round 71). Focused fault-free trace reached Activated in nine actions | crash, config changes, human intervention, partial execution | Unrecorded | Split. Separate commit, rollback, and rebind. |
| `activationTrustRecord` | Break or witness — `ActiveMeansMarked` / `NoLostEdit` | config changes, corruption | Unrecorded | Keep. Verify marked file contents and preserve newer human edits. |
| `activationStaleAck` | Break or witness — `ActivationNeedsCurrentAck` | crash, timing, out of order | Unrecorded | Keep. Require the current live launch and its acknowledgement. |
| `activationReuseId` | Break or witness — `ActivationNeedsCurrentAck` | crash, timing, out of order | Unrecorded | Keep. Require the current live launch and its acknowledgement. |
| `activationSpawnFirst` | Break or witness — `NoOrphanHost` | crash, partial execution | Unrecorded | Keep. Record the launch before spawning it. |
| `activationNoGuard` | Break or witness — `ActiveNeverRolledBack` | human intervention, concurrency, partial execution | Unrecorded | Keep. Distinguish pre-commit rollback and active work admission. |
| `activationRebindAfterTop` | Break or witness — `NoRebindAfterTop` | human intervention, concurrency, out of order | Unrecorded | Keep. Check top opening against a pending rebind under the same guard. |
| `activationDeliverPending` | Break or witness — `NoCredentialToPending` | crash, out of order | Unrecorded | Keep. Bind authority to the committed host. |
| `activationRetireAtOpen` | Break or witness — `BoundHostServed` | human intervention, partial execution, data loss | Unrecorded | Keep. Retire credential delivery after authenticated use. |
| `activationNoReconcile` | Break or witness — `CommittedNeverCancelled` | crash, human intervention, partial execution | Unrecorded | Keep. Distinguish a committed rebind from uncommitted launch data. |
| `activationOpenStore` | Break or witness — `NoWorkBeforeActive` | human intervention, concurrency, partial execution | Unrecorded | Keep. Distinguish pre-commit rollback and active work admission. |

**[store.qnt](../../core/model/store.qnt)**

| Instance | Checks | Fault classes | Recorded time | Decision |
| --- | --- | --- | --- | --- |
| `storeFixed` | Check — `G3Holds` | out of order, concurrency, duplicate | 7 s | Split. Use scoped read bases, retired sessions, and atomic append. |
| `storeNoBasis` | Break or witness — `G3Holds` | out of order, concurrency, duplicate | 6 s | Split. Use scoped read bases, retired sessions, and atomic append. |
| `storeNoRecheckBasis` | Break or witness — `G3Holds` | out of order, concurrency, duplicate | 6 s | Split. Use scoped read bases, retired sessions, and atomic append. |
| `storeNoEpochs` | Break or witness — `G3Holds` | out of order, concurrency, duplicate | 7 s | Split. Use scoped read bases, retired sessions, and atomic append. |
| `storeNoBuild` | Break or witness — `G3Holds` | config changes, out of order | 6 s | Keep. Keep the stale-client guard at the boundary. |
| `storeNoAcceptCheck` | Check — `G3Holds`<br>Redundant-guard negative control | out of order | 7 s | Drop. The draft-version guard already rejects this stale accept. |
| `storeBlind` | Break or witness — `G3Holds` | out of order, concurrency, duplicate | 7 s | Split. Use scoped read bases, retired sessions, and atomic append. |

**[browser.qnt](../../core/model/browser.qnt)**

| Instance | Checks | Fault classes | Recorded time | Decision |
| --- | --- | --- | --- | --- |
| `browserFixed` | Check — `DashAfterRefresh`, `G4All` | network, out of order, config changes | 14 s | Split. Separate page catch-up from stale submissions. |
| `browserNoReconnect` | Break or witness — `G4All` | network, data loss | 10 s | Keep. Preserve each missed delivery or connection witness. |
| `browserNoReload` | Break or witness — `G4All` | network, config changes | 9 s | Keep. Preserve the stale page build witness. |
| `browserNoPush` | Break or witness — `G4All` | network, data loss | 10 s | Keep. Preserve each missed delivery or connection witness. |
| `browserNoPoll` | Break or witness — `G4All` | network, data loss | 9 s | Keep. Preserve each missed delivery or connection witness. |

**[terminals.qnt](../../core/model/terminals.qnt)**

| Instance | Checks | Fault classes | Recorded time | Decision |
| --- | --- | --- | --- | --- |
| `termFixed` | Check — `Sane`, `ExactlyOnce`, `G1All`, `SendDone` | crash, network | 10 s | Split. Extract process observation and current prompt delivery. |
| `termFixed3` | Check — `Sane`, `ExactlyOnce`, `G1All`, `SendDone` | crash, network | 22 s | Drop. Exercise the relevant crash boundaries directly. |
| `termNoList` | Break or witness — `G1All` | crash, network | 8 s | Split. Extract process observation and current prompt delivery. |
| `termNoReattach` | Break or witness — `G1All` | crash, network | 10 s | Split. Extract process observation and current prompt delivery. |
| `termNoPromptArg` | Break or witness — `G1All` | partial execution, data loss | 12 s | Keep. Keep the terminal adapter witness. |
| `termNoOutbox` | Break or witness — `G1All` / `SendDone` | crash, data loss, duplicate | 9 s for each check | Split. Separate committed process-start evidence from typed sends. |
| `termNoEvidence` | Break or witness — `ExactlyOnce` | crash, duplicate | 8 s | Keep. Keep the duplicate revival witness. |
| `termNoHostWatch` | Break or witness — `G1All` | crash, network | 9 s | Split. Extract process observation and current prompt delivery. |
| `termNoIdleSeen` | Break or witness — `G1All` | timing, dependency failure | 10 s | Split. Test a missing readiness observation directly. |

**[pipe.qnt](../../core/model/pipe.qnt)**

| Instance | Checks | Fault classes | Recorded time | Decision |
| --- | --- | --- | --- | --- |
| `pipeFixed` | Check — Pipe safety, `ShowsCurrentScreen`, `NoKeystrokeLost`<br>Simulator also checks `NotStuck` | network, crash, duplicate, out of order, data loss, partial execution | 20 s TLC phase | Split. Carry adapter safety and recovery separately. |
| `pipeNoReattach` | Break or witness — `ShowsCurrentScreen`<br>Simulator also breaks `NotStuck` | network, crash | 02 s TLC phase | Keep. Keep independent screen recovery witnesses. |
| `pipeNoReconnect` | Break or witness — `ShowsCurrentScreen`<br>Simulator also breaks `NotStuck` | network, crash | 02 s TLC phase | Keep. Keep independent screen recovery witnesses. |
| `pipeNoRedraw` | Break or witness — `ShowsCurrentScreen`<br>Simulator also breaks `NotStuck` | network, crash | 03 s TLC phase | Keep. Keep independent screen recovery witnesses. |
| `pipeNoDedup` | Break or witness — `NoKeystrokeTwice` | duplicate, crash, partial execution | 00 s TLC phase | Keep. Keep the distinct double-delivery witnesses. |
| `pipeMarkAfter` | Break or witness — `NoKeystrokeTwice` | duplicate, crash, partial execution | 00 s TLC phase | Keep. Keep the distinct double-delivery witnesses. |
| `pipeNoBuffer` | Break or witness — `NoKeystrokeLost` | network, data loss, out of order | 03 s TLC phase | Keep. Keep the bounded delivery and reachability checks. |
| `pipeVolatileMarks` | Break or witness — `NoKeystrokeTwice` | duplicate, crash, partial execution | 00 s TLC phase | Keep. Keep the distinct double-delivery witnesses. |
| `pipeNoOutbox` | Break or witness — `NoKeystrokeLost` | network, data loss, out of order | 04 s TLC phase | Keep. Keep the bounded delivery and reachability checks. |
| `pipeWitnesses` | Simulator witnesses `ReplayedAfterRestart`, `ReplayRetired`, `InterruptedWrite`, `BufferedKeySurvivesReload`, `GapDrained` | network, data loss, out of order | Unrecorded | Keep. Keep the bounded delivery and reachability checks. |

The eight permits cases are labels for corresponding initializers in `permits`. Modules `activation`, `activationCfgs`, `admission`, `browser`, `browserCfgs`, `canon`, `check`, `configsBase`, `contract`, `permits`, `pipe`, `pipeCfgs`, `properties`, `protocol`, `store`, `storeCfgs`, `terminals`, `termCfgs`, `types`, `worker` supply shared definitions and have no separate run. Their named properties appear below where defined.

#### Properties

Named constituent predicates, formulas, fairness assumptions, and witnesses are included. A bundled check uses the runtime of its instance in the preceding table. A constituent, witness predicate, or assumption without its own check has no independent runtime.

| Source | Properties | Fault classes | Decision |
| --- | --- | --- | --- |
| [properties.qnt](../../core/model/properties.qnt) | `DoneIsClosed`, `DoneIsCurrent`, `NoDoneBrokenAtEnd`, `NoLostUpdate` | config changes, concurrency, data loss | Split. Check version-pinned validity and atomic append separately. |
| [properties.qnt](../../core/model/properties.qnt) | `OneMakerPerTask` | concurrency, duplicate | Split. Check one current attempt per task. |
| [properties.qnt](../../core/model/properties.qnt) | `RaiseHasOwner`, `NoEscalationWithoutPerson`, `NoAgentChangeAtTop`, `NoTakenUndone` | human intervention, out of order | Split. Check owner, current draft, and retained result. |
| [properties.qnt](../../core/model/properties.qnt) | `AsksFollowState`, `EveryObligationToldOnce`, `ToldIsAllowed`, `SomethingOwed`, `Sane` | timing, duplicate, corruption | Split. Derive obligations from phases, then check actor, shape, and duplicate input. |
| [properties.qnt](../../core/model/properties.qnt) | `NoPassOfBadResult`, `OutputScopeSound`, `NoAddedOutputScope` | corruption, config changes | Split. Check required evidence and changed guidance scope. |
| [properties.qnt](../../core/model/properties.qnt) | `NoRefixAtSameLevel`, `Converges`, `Progress`, `AgentChangesStop`, `Settles`, `CoreProgress`, `CoreChangesStop`, `CoreSettles`, `AssumedNoPipe`, `CoreProgressNoPipe`, `CoreProgressNoEngine` | — | Drop. Retired ladders and whole-run progress, including its variants and assumptions. |
| [properties.qnt](../../core/model/properties.qnt) | `AnswererFinishes`, `NoFinalWithAsk`, `NoCrossing`, `NoWaitChain`, `NoLongWaitChain`, `NoCapReached`, `AskCap`, `NoAskRaise`, `NoRecheckAfterAskRaise` | human intervention, timing | Drop. Retire Ask scheduling and end-state assertions. Carry current Question authority and deduplication separately. |
| [properties.qnt](../../core/model/properties.qnt) | `NoWaitCycle` | dependency failure, human intervention | Split. Check a bounded cycle guard only where the design has wait edges. |
| [properties.qnt](../../core/model/properties.qnt) | `NoRestartAssigned`, `NoKeptCheckJudged`, `NoKeptFailAssigned`, `NoExecuteToEndedMaker` | crash, out of order | Split. Check replacement and stale work or review authority. |
| [configs.qnt](../../core/model/configs.qnt) | `RecordsHaveTheirFields`, `TakeNeedsResult` | corruption, human intervention | Keep. Carry the small shape and retained-result probes. |
| [configs.qnt](../../core/model/configs.qnt) | `NoStoredSplit` | concurrency | Split. Replace slot reuse with a positive two-subtask witness. |
| [check.qnt](../../core/model/check.qnt) | `AgentsG1`, `EngineFair`, `Assumed` | timing | Drop. Fairness assumptions for broad progress. |
| [contract.qnt](../../core/model/contract.qnt) | `G1`, `G4` | network, timing | Split. Formula helpers for localized delivery. |
| [contract.qnt](../../core/model/contract.qnt) | `G3` | concurrency, out of order, duplicate | Split. Check journal and authority separately. |
| [contract.qnt](../../core/model/contract.qnt) | `CapacityReturns` | timing, dependency failure | Split. An assumption about a slot coming back in a bounded check. |
| `worker.qnt` | `OldestFirst`, `NoIdentityCrossing`, `NoBlockedOnlyExecutor` | timing, concurrency, out of order | Split. Separate derived ordering, authority, and shared staff. |
| `worker.qnt` | `AllIdentitiesHeard`, `YieldReached`, `HeardAfterPark`, `StaleRefused`, `NoYield`, `NoAllIdentities`, `NoHeardAfterPark`, `NoStaleRefusal` | timing, crash, out of order | Split. Keep positive and refusal witnesses with new subjects and sessions. |
| `worker.qnt` | `SelectionFair`, `G1All` | timing, dependency failure | Split. Check one available step with a local selection assumption. |
| [permits.qnt](../../core/model/permits.qnt) | `NoWaitCycle`, `AsksFollowState`, `PermitsNeverExceeded`, `ChildMakersCharged` | concurrency, dependency failure | Split. Derive role/capacity and any wait edges from current phases. |
| [permits.qnt](../../core/model/permits.qnt) | `NoRecheckInParentContext`, `NoSecondDenied`, `ChildRecheckRan`, `NoChild` | concurrency, timing | Split. Keep independent source and bounded saturation witnesses. |
| [permits.qnt](../../core/model/permits.qnt) | `ParkReached`, `DeferReached`, `ChildDeniedSerial`, `ParkResumed`, `NoPark`, `NoDefer`, `NoSerial`, `NoParkResume`, `NoIgnoredRecheck`, `SchedulerFair`, `ParkedResumes`, `DeferredRuns`, `RechecksProgress`, `AdmittedProgress`, `AdmittedSettles` | — | Drop. Retired helper behavior or broad progress and its assumption. |
| [permits.qnt](../../core/model/permits.qnt) | `CapacityFair` | timing, dependency failure | Split. Assumption of slot availability in a localized case. |
| [admission.qnt](../../core/model/admission.qnt) | `Ownership`, `RoleBound`, `WorkerChildBound`, `NoSerialWithAllowance` | concurrency, config changes | Split. Check ownership, shared staff capacity, and own-slot selection. |
| [admission.qnt](../../core/model/admission.qnt) | `PipeBound`, `PipeMatchesJobs`, `TaskMatchesPermits`, `OneSerialTurn`, `NoPipeOverlap`, `NoRecheckBesideFix`, `NoSerialReview` | concurrency, timing | Drop. Retire standalone permit, serial review, and separate recheck lane claims. |
| [admission.qnt](../../core/model/admission.qnt) | `RecheckIndependent`, `NoFailWait`, `NoSaturatedSerial`, `NoCollocatedOwners`, `NoCollocatedWait`, `NoSaturatedWait` | concurrency, timing | Split. Keep relevant capacity and wait cases. Negated reachability cases are witnesses. |
| `activation.qnt` | `NoWorkBeforeActive`, `OnlyActivatedHostWorks`, `ActivationNeedsCurrentAck`, `ActiveMeansMarked`, `NoLostEdit` | crash, out of order, config changes, partial execution | Keep. Gate work on actual current material and authority. |
| `activation.qnt` | `NoOrphanHost`, `NoCredentialToPending`, `NoRebindAfterTop`, `CommittedNeverCancelled`, `ActiveNeverRolledBack`, `RolledBackClean` | crash, partial execution, human intervention | Keep. Carry launch, credentials, and rollback claims by boundary. |
| `activation.qnt` | `ActivationSafe`, `Fair`, `ActivationEnds`, `BoundHostServed`, `RebindEnds` | timing, crash, partial execution | Split. Separate aggregate safety and recovery. Fair is an assumption. |
| `activation.qnt` | `NoActive`, `NoRolledBack`, `NoReplacedActive`, `NoReboundWork`, `NoLateNote`, `NoLateCollection`, `NoCancelledByTop`, `NoBlockedByEdit` | crash, human intervention, config changes | Keep. Keep expected-false reachability witnesses. |
| `activation.qnt` | `ActivatesOrRollsBack` | human intervention | Drop. The human can leave blocked activation awaiting a decision. |
| [store.qnt](../../core/model/store.qnt) | `G3Holds` | concurrency, out of order, duplicate, config changes | Split. Divide freshness checks by source of staleness. |
| [browser.qnt](../../core/model/browser.qnt) | `Fairness`, `G4All` | network, timing | Split. Local reconnect and catch-up. Record fairness as an assumption. |
| [browser.qnt](../../core/model/browser.qnt) | `NoFalseWorking`, `InactiveFromEngine`, `RowMatches`, `EscalationMatches`, `OwedShown`, `DashAfterRefresh` | network, out of order, corruption | Split. Test one authoritative phase and owed action after catch-up. |
| [terminals.qnt](../../core/model/terminals.qnt) | `Fairness`, `G1Host`, `G1Role`, `G1Pipe`, `G1Maker`, `G1All` | crash, network, timing | Split. Use local assumptions for session and prompt delivery. |
| [terminals.qnt](../../core/model/terminals.qnt) | `SendActed`, `SendDone` | crash, data loss, duplicate | Keep. Retain bounded typed transport checks independently. |
| [terminals.qnt](../../core/model/terminals.qnt) | `ExactlyOnce`, `Sane` | crash, duplicate, corruption | Keep. Keep one replacement and consistent process observations. |
| [pipe.qnt](../../core/model/pipe.qnt) | `Fairness`, `ShowsCurrentScreen`, `NotStuck` | network, crash | Keep. Adapter screen recovery with its stated fairness assumption. |
| [pipe.qnt](../../core/model/pipe.qnt) | `keystrokeReaches`, `NoKeystrokeLost`, `ReplayedAfterRestart`, `ReplayRetired`, `GapDrained`, `InterruptedWrite`, `BufferedKeySurvivesReload` | network, crash, data loss, out of order, partial execution | Keep. Adapter delivery checks and reachability witnesses. |
| [pipe.qnt](../../core/model/pipe.qnt) | `Prefix`, `AtMostOneWriting`, `WritingIsMarked`, `NoKeystrokeTwice` | duplicate, concurrency, out of order, partial execution | Keep. Maintain bounded writer and ordering checks at the adapter. |

### 3.3 Proof units for the new lines

Use one small state space per row and one fault at a time, except where the interaction itself is the fault. Each instance needs a successful path, the named fault interleaving, and a counterexample when its critical guard is removed. A proof checks the property over that finite space. A conformance replay feeds a representative accepted or refused sequence to the shared engine/web transition and checks the fold and selected next step. Nanda approved these fifteen checks and their fault scope. The Metis-first registry implements the ten checks marked in its rows. The other five follow in their own rounds. The [registry](../../core/model/checks/registry.tsv) lists each active check and its approved fault classes, with a 120-second target and a 600-second cutoff per check. Adding a check takes one case file and one row. The runner rejects unknown fault classes. Keep the shared Quint model under about 500 lines total and each case under about 80. The phase tables name the duty and legal moves. If a part cannot fit, stop and report what forces its size. The [results](../../core/model/README.md) record file sizes, state counts, and completed run times.

| New instance | Approved fault classes | Bound and property |
| --- | --- | --- |
| `taskReportRace` | concurrency, duplicate, partial execution | One Sent task, one attempt, two competing copies of a report and one interrupted append. Accept the current report once. Projection and journal agree after recovery. Command outcomes cannot advance a task without a committed result. |
| `reviewEvidence` | corruption, dependency failure | One artifact, one command and one prompt. Refuse an incomplete result, a missing or duplicate outcome, and a quote absent from the artifact. Model one command failure. A reported breaking command stays in the combined outcomes and can never produce Done by omission. |
| `reviewSlot` | concurrency, timing, out of order | Two host-queued reviews, one own-slot reviewer and one child slot per staff. Entry event order wins despite a later edit to the older task. Positive allowance makes a busy reviewer wait locally. Assignment is exclusive. An earlier fresh child cannot report against a later assignment. Repeat the same scheduling cases for an addressed proposal through the shared boundary. |
| `staffCapacity` | concurrency, config changes | Host and pipeline may share a staff, and two staff may share a subscription. One live slot and one child slot contend. Roles keep their distinct duties, capacity is charged to the staff and subscription once, and stale staffing cannot open a forbidden session or child. |
| `fixOwnerChoice` | human intervention, out of order, duplicate | One raised task, two draft versions, one owner, and a retained or absent result. Reject an old acceptance after send-back, acceptance by another actor, and taking as is without a result. Replaying an owner’s acceptance must not create a second version or resend the task twice. |
| `guidanceChanges` | config changes, out of order, concurrency | One Done artifact, one relevant edit and one unrelated edit. Reopen only for related accepted guidance, retain unaffected outcomes, and refuse a delayed verdict from an older checked basis. An accepted child review or owner choice pins the exact version. |
| `splitDependency` | dependency failure, concurrency, corruption | One parent and two possible parts over two ordered stages. Refuse duplicated or missing stages, wrong order, and dependent parallel start without the parties’ promises. Valid parallel parts can start together in separate worktrees. |
| `splitIntegration` | concurrency, out of order, partial execution | One split, two finishes, two candidate bases, one merge interruption. Require the second part to include and review the first merged base before merging. The independent partition and parent-routing behavior stays outside this instance. |
| `onboardingReview` | dependency failure, config changes | An onboarding proposal and an authenticated host that already serves its role. Its own fresh child reviews it under the regular proposal guard. A departed host cannot report, and the owner sees only the proposal that passed review. |
| `activationCommit` | crash, partial execution, out of order | One accepted proposal set, one marker file, two launch identities and one crash between durable steps. Require current file evidence and acknowledgement. No orphan host, premature work or second activation. Reconcile commit-before-note without losing the binding. |
| `activationRollback` | human intervention, config changes, data loss, crash | One approved file, one human edit, approval or cancellation, and one interruption during restoration. Retain the human edit, restore only the project’s own changes, and keep a committed activation intact. |
| `activationHostBinding` | human intervention, crash, out of order, partial execution | One committed host, one pending replacement and an opening top. Authorize only the committed binding, retire delivery only on authenticated use, and reconcile a committed rebind before cancellation. |
| `staffReplacement` | crash, timing, out of order, data loss | One staff, one working task, one running review and one replacement lifetime. Keep committed results and answers, use `restart` from Working to Sent with the same retry count, and return assigned reviews to waiting. Only one live session holds authority. A checkpoint resumes the same attempt. Exercise pause and crash as separate scenarios with the same checked shape. |
| `questionAnswer` | human intervention, duplicate, dependency failure | One open question with two potential responders. Only its recipient can answer once. Preserve the question across session replacement. A design that lets questions block transitions also needs a separate two-subject cycle refusal check. |
| `pageCatchUp` | network, out of order, data loss | One authoritative phase change, one disconnected browser and a delayed update. Catch up from the authoritative journal and show its owed actor and phase. A request from the pre-change view fails when it relied on the changed record. |

Pure phase paths and shape checks get deterministic witnesses, including the six paths above. Human choices and external service availability are inputs to bounded checks. A guarantee that an arbitrary project finishes, an owner eventually responds, or independent models compose into whole-project liveness requires Nanda’s approval. Terminal keystroke and screen guarantees stay in their bounded adapter models.

After review of these sections, start with the isolated checks and replay fixtures that exercise durian-metis onboarding and its first task. The first delivery needs current proposal acceptance, activation, staffing capacity and the task-to-review boundary. Bring the other fault units in when their flows are implemented. [Settled delivery order and proof scope](DESIGN-2026-11-26.md)
