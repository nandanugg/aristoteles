// The JSON between the server and the page: the Schemas of the view data of ui-model.ts part 4. The
// server encodes each answer with them and decodes each act and each terminal message; the page
// decodes each answer. The wire keeps the keys and the words of today (parity). Where a domain
// type differs from the wire, the Schema converts at its edge: a Decision is tagged by `_tag` in
// the domain and by `kind` on the wire.
import { Schema, SchemaGetter } from 'effect'
import {
  AdjustmentSchema,
  AgentId,
  AssignmentId,
  DirectionId,
  EscalationId,
  EvaluationId,
  EventRef,
  NonBlank,
  PositiveInt,
  ProblemId,
  QuestionId,
  ResultId,
  RevisionId,
  RoleName,
  RunId,
  SessionId,
  Settings,
  TaskDraftId,
  TaskId,
  Time,
  type CanvasRow as UiCanvasRow,
  type Decision as UiDecision,
  type DiffView as UiDiffView,
  type DirectionCard as UiDirectionCard,
  type DirectionView as UiDirectionView,
  type DirView as UiDirView,
  type ExampleView as UiExampleView,
  type OnboardingView as UiOnboardingView,
  type Owner as UiOwner,
  type PageAct as UiPageAct,
  type PageMessage as UiPageMessage,
  type ProjectSummary as UiProjectSummary,
  type ProjectView as UiProjectView,
  type QuestionView as UiQuestionView,
  type ResultView as UiResultView,
  type ReviewCard as UiReviewCard,
  type RoleCard as UiRoleCard,
  type ServerMessage as UiServerMessage,
  type TaskCard as UiTaskCard,
  type TaskDraftView as UiTaskDraftView,
  type TaskPanel as UiTaskPanel,
  type TerminalRef as UiTerminalRef,
  type WorkCard as UiWorkCard,
  WhySchema as Why,
} from '../../core/schema/index.ts'

const Text = Schema.String
// A terminal as the page shows it (ui-model.ts TerminalSeen), and the terminal of a card.
const seen = (tag: 'Unknown' | 'Live' | 'Ended' | 'Closed') =>
  Schema.TaggedStruct(tag, { session: SessionId })
const TerminalSeen = Schema.Union([seen('Unknown'), seen('Live'), seen('Ended'), seen('Closed')])
const CardTerminal = Schema.Union([Schema.TaggedStruct('None', {}), ...TerminalSeen.members])
const TimeOrNone = Schema.Union([Time, Schema.Literal('')])
const Attempt = Schema.Struct({ now: Schema.Number, max: Schema.NullOr(PositiveInt) })

// --- the decisions -------------------------------------------------------------------------

// What a suggestion of the gear is about.
export const SuggestionTarget = Schema.Union([
  Schema.TaggedStruct('NewDirection', {}),
  Schema.TaggedStruct('Direction', { direction: DirectionId }),
  Schema.TaggedStruct('Roles', {}),
])

// An act of a decision: an intent of its item's step that passed canAct (P1).
const DecisionAct = Schema.Union([
  Schema.TaggedStruct('Accept', {}),
  Schema.TaggedStruct('Reject', {}),
  Schema.TaggedStruct('Confirm', {}),
  Schema.TaggedStruct('Answer', {}),
  Schema.TaggedStruct('FixProblem', {}),
  Schema.TaggedStruct('Resolve', { escalation: EscalationId }),
  Schema.TaggedStruct('Give', { task: TaskId, role: RoleName }),
  Schema.TaggedStruct('Suggest', { about: SuggestionTarget, name: Text }),
  Schema.TaggedStruct('AtTerminal', { line: Text }),
])
const DraftChange = Schema.Struct({ direction: Text, lines: Schema.Array(Text) })
const DecisionBase = {
  task: Schema.NullOr(TaskId),
  text: Text,
  words: Schema.NullOr(Text),
  at: Time,
  acts: Schema.Array(DecisionAct),
  waits: Schema.NullOr(Text),
}
const EvaluationFields = { level: Text, wrong: Text, why: Text, improve: Schema.Array(Text) }
const DecisionDomain = Schema.Union([
  Schema.TaggedStruct('System', { ...DecisionBase, id: ProblemId, stopped: TaskId }),
  Schema.TaggedStruct('Direction', {
    ...DecisionBase,
    id: RevisionId,
    direction: Text,
    change: DraftChange,
    hope: Schema.NullOr(Text),
    why: Why,
  }),
  Schema.TaggedStruct('End', { ...DecisionBase, id: RunId, top: TaskId }),
  Schema.TaggedStruct('Confirm', { ...DecisionBase, id: EventRef, quote: Text }),
  // New words of a role (ruling 2026-11-14).
  Schema.TaggedStruct('RoleWords', {
    ...DecisionBase,
    id: EventRef,
    role: Text,
    lines: Schema.Array(Text),
  }),
  // A drafted adjustment (ruling 14).
  Schema.TaggedStruct('Adjustment', { ...DecisionBase, id: EventRef, adjustment: AdjustmentSchema }),
  // A question to the person: the text is the question.
  Schema.TaggedStruct('Question', {
    ...DecisionBase,
    id: QuestionId,
    asker: Text,
    options: Schema.Array(Text),
  }),
  Schema.TaggedStruct('Evaluation', { ...DecisionBase, id: EvaluationId, ...EvaluationFields }),
  Schema.TaggedStruct('Step', { ...DecisionBase, id: Text, title: Text }),
])
type DecisionEncoded = typeof DecisionDomain.Encoded

// The wire names the kind in `kind`; each id is plain text there, and the domain brands it.
const WireBase = {
  id: Text,
  task: Schema.NullOr(Text),
  text: Text,
  words: Schema.NullOr(Text),
  at: Text,
  acts: Schema.Array(Schema.toEncoded(DecisionAct)),
  waits: Schema.NullOr(Text),
}
const DecisionWire = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('system'), ...WireBase, stopped: Text }),
  Schema.Struct({
    kind: Schema.Literal('direction'),
    ...WireBase,
    direction: Text,
    change: DraftChange,
    hope: Schema.NullOr(Text),
    why: Schema.toEncoded(Why),
  }),
  Schema.Struct({ kind: Schema.Literal('end'), ...WireBase, top: Text }),
  Schema.Struct({ kind: Schema.Literal('confirm'), ...WireBase, quote: Text }),
  Schema.Struct({
    kind: Schema.Literal('roleWords'),
    ...WireBase,
    role: Text,
    lines: Schema.Array(Text),
  }),
  Schema.Struct({
    kind: Schema.Literal('adjustment'),
    ...WireBase,
    adjustment: Schema.toEncoded(AdjustmentSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal('question'),
    ...WireBase,
    asker: Text,
    options: Schema.Array(Text),
  }),
  Schema.Struct({ kind: Schema.Literal('evaluation'), ...WireBase, ...EvaluationFields }),
  Schema.Struct({ kind: Schema.Literal('step'), ...WireBase, title: Text }),
])
type DecisionWireType = typeof DecisionWire.Type

const KINDS = {
  System: 'system',
  Direction: 'direction',
  End: 'end',
  Confirm: 'confirm',
  RoleWords: 'roleWords',
  Adjustment: 'adjustment',
  Question: 'question',
  Evaluation: 'evaluation',
  Step: 'step',
} as const
const TAGS = {
  system: 'System',
  direction: 'Direction',
  end: 'End',
  confirm: 'Confirm',
  roleWords: 'RoleWords',
  adjustment: 'Adjustment',
  question: 'Question',
  evaluation: 'Evaluation',
  step: 'Step',
} as const
// Only the tag and the kind differ: each member keeps its own keys.
const toWire = ({ _tag, ...rest }: DecisionEncoded): DecisionWireType =>
  ({ kind: KINDS[_tag], ...rest }) as DecisionWireType
const fromWire = ({ kind, ...rest }: DecisionWireType): DecisionEncoded =>
  ({ _tag: TAGS[kind], ...rest }) as DecisionEncoded

export const Decision = DecisionWire.pipe(
  Schema.decodeTo(DecisionDomain, {
    decode: SchemaGetter.transform(fromWire),
    encode: SchemaGetter.transform(toWire),
  }),
)
export type Decision = typeof Decision.Type

// --- the view data --------------------------------------------------------------------------

export const Owner = Schema.Struct({
  a: AssignmentId,
  role: Text,
  model: Schema.NullOr(Text),
  agent: Schema.NullOr(AgentId),
  terminal: CardTerminal,
  inside: Schema.NullOr(AssignmentId),
  resumable: Schema.Boolean,
})
export const ReviewCard = Schema.Struct({
  id: Schema.NullOr(Text),
  by: Text,
  role: Schema.NullOr(Text),
  model: Schema.NullOr(Text),
  decides: Schema.Boolean,
  decision: Schema.Literals(['accept', 'reject', 'escalate', 'reviews', 'waits']),
  line: Text,
})
// The work of a card that runs now: in work, or its result in review.
const WorkNow = Schema.Union([
  Schema.Struct({ state: Schema.Literal('works') }),
  Schema.Struct({
    state: Schema.Literal('in review'),
    result: ResultId,
    output: Text,
    files: Schema.Number,
    reviews: Schema.Array(ReviewCard),
  }),
])
export const WorkCard = Schema.Struct({
  a: AssignmentId,
  role: Text,
  model: Schema.NullOr(Text),
  attempt: Attempt,
  terminal: CardTerminal,
  inside: Schema.NullOr(AssignmentId),
  now: WorkNow,
})
export const TaskCard = Schema.Struct({
  id: TaskId,
  name: Text,
  words: Text,
  attempt: Schema.NullOr(Attempt),
  owner: Schema.NullOr(Owner),
  badge: Schema.Boolean,
  parent: Schema.NullOr(TaskId),
})
export const CanvasRow = Schema.Struct({
  depth: Schema.Number,
  task: TaskCard,
  work: Schema.Array(WorkCard),
})
export const TaskDraftView = Schema.Struct({
  id: TaskDraftId,
  name: Text,
  text: Text,
  role: Text,
  at: Time,
})
export const TerminalRef = Schema.Struct({ a: Text, terminal: TerminalSeen })

const HostSummary = {
  kind: Schema.Literal('host'),
  id: RunId,
  at: TimeOrNone,
  session: SessionId,
  state: Schema.Literals(['talks', 'works', 'ends', 'done', 'closed']),
  title: Text,
  top: Schema.NullOr(TaskId),
  badge: Schema.Boolean,
}
const TaskSummary = {
  kind: Schema.Literal('task'),
  id: TaskId,
  at: TimeOrNone,
  state: Schema.Literals(['works', 'done', 'closed']),
  title: Text,
  top: TaskId,
  badge: Schema.Boolean,
}
export const ProjectSummary = Schema.Union([
  Schema.Struct(HostSummary),
  Schema.Struct(TaskSummary),
])
const ProjectRows = {
  rows: Schema.Array(CanvasRow),
  drafts: Schema.Array(TaskDraftView),
  terminal: Schema.NullOr(TerminalRef),
}
export const ProjectView = Schema.Union([
  Schema.Struct({ ...HostSummary, ...ProjectRows }),
  Schema.Struct({ ...TaskSummary, ...ProjectRows }),
])
// P8, ruling 3: the toast of the dir view: what the AI does now, or its question for the person.
export const AiToast = Schema.Struct({
  status: Schema.NullOr(
    Schema.Struct({
      by: Text,
      kind: Schema.Literals(['working', 'thinking', 'applied', 'feedback', 'waiting']),
      words: Text,
      text: Text,
    }),
  ),
  question: Schema.NullOr(Decision),
})
export const DirView = Schema.Struct({
  name: Text,
  path: Text,
  theme: Schema.Literals(['light', 'dark']),
  sound: Schema.Boolean,
  settings: Settings,
  hasConfig: Schema.Boolean,
  onboarding: Schema.Boolean,
  initialized: Schema.Boolean,
  startPrompt: Text,
  projects: Schema.Array(ProjectSummary),
  inbox: Schema.Array(Decision),
  toast: AiToast,
})

const ReviewOfResult = Schema.Struct({
  id: Text,
  by: Text,
  decision: Schema.Literals(['Accept', 'Reject', 'Escalate', 'Resolve']),
  reason: Schema.NullOr(Text),
  breaks: Schema.NullOr(Text),
  at: Time,
  evidence: Schema.Array(
    Schema.Struct({
      rule: Schema.NullOr(Text),
      where: Schema.NullOr(Text),
      says: Text,
    }),
  ),
})
export const ResultView = Schema.Struct({
  id: Text,
  by: Text,
  output: Text,
  at: Time,
  reviews: Schema.Array(ReviewOfResult),
})
const SpotView = Schema.Struct({
  file: Text,
  line: PositiveInt,
  excerpt: Text,
  current: Schema.Boolean,
  around: Schema.Array(Schema.Struct({ line: Schema.Number, text: Text, mark: Schema.Boolean })),
})
const SampleView = Schema.Union([SpotView, Schema.Struct({ written: Text })])
export const ExampleView = Schema.Struct({
  fit: Schema.Literals(['Follows', 'Breaks']),
  input: Schema.NullOr(SampleView),
  output: SampleView,
})
const StandardsView = Schema.Array(
  Schema.Struct({
    id: Text,
    says: Text,
    rules: Schema.Array(Schema.Struct({ id: Text, says: Text, checkedBy: Schema.NullOr(Text) })),
  }),
)
const FlowView = Schema.Array(
  Schema.Struct({
    from: Text,
    to: Text,
    says: Text,
    place: Schema.NullOr(Schema.Struct({ file: Text, line: Schema.NullOr(PositiveInt) })),
    uses: Schema.Array(Text),
    examples: Schema.Array(ExampleView),
  }),
)
export const DirectionView = Schema.Struct({
  id: Text,
  name: Text,
  owner: Text,
  version: Text,
  summary: Text,
  flow: FlowView,
  says: Text,
  standards: StandardsView,
  changed: Schema.Array(Schema.Struct({ id: Text, at: Time })),
  drafts: Schema.Array(Schema.Struct({ id: Text, by: Text, at: Time })),
})
export const TaskPanel = Schema.Struct({
  id: TaskId,
  name: Text,
  text: Text,
  words: Text,
  top: Schema.NullOr(Schema.Struct({ directions: Schema.Array(DirectionView) })),
  decisions: Schema.Array(Decision),
  terminal: Schema.NullOr(TerminalRef),
  results: Schema.Array(ResultView),
  timeline: Schema.Array(Schema.Struct({ at: Time, who: Text, line: Text })),
  files: Schema.Array(Schema.Struct({ file: Text, added: Schema.Number, removed: Schema.Number })),
})
export const DiffView = Schema.Struct({ file: Schema.NullOr(Text), diff: Text })

// GET /api/onboarding: the directions page, the agents page, and the gear's two entries.
const QuestionFields = {
  says: Text,
  example: ExampleView,
  options: Schema.Tuple([Text, Text]),
}
export const QuestionView = Schema.Struct(QuestionFields)
const AnsweredView = Schema.Struct({ ...QuestionFields, answer: Schema.Literals(['A', 'B']) })
const DirectionWords = Schema.Struct({
  summary: Text,
  flow: FlowView,
  says: Text,
  standards: StandardsView,
  diff: DraftChange,
})
const CardHead = {
  id: Text,
  name: Text,
  origin: Text,
  principle: Schema.NullOr(Text),
  example: Schema.NullOr(Text),
}
const draft = DirectionWords
export const DirectionCard = Schema.Union([
  Schema.Struct({
    ...CardHead,
    state: Schema.Literal('loading'),
    why: Schema.Literals(['drafting', 'reset']),
  }),
  Schema.Struct({
    ...CardHead,
    state: Schema.Literal('loading'),
    why: Schema.Literal('answered'),
    draft,
    answered: Schema.NonEmptyArray(AnsweredView),
  }),
  Schema.Struct({
    ...CardHead,
    state: Schema.Literal('loading'),
    why: Schema.Literal('revise'),
    words: Text,
    draft,
    answered: Schema.Array(AnsweredView),
  }),
  Schema.Struct({
    ...CardHead,
    state: Schema.Literal('question'),
    draft,
    open: Schema.NonEmptyArray(QuestionView),
  }),
  Schema.Struct({ ...CardHead, state: Schema.Literals(['ready', 'accepted', 'current']), draft }),
])
const RoleCardBase = {
  role: Text,
  icon: Text,
  summary: Text,
  description: Text,
  found: Schema.NullOr(Text),
  state: Schema.Literals(['waiting', 'accepted', 'current']),
  request: Schema.NullOr(Text),
}
export const RoleCard = Schema.Union([
  Schema.TaggedStruct('Agent', {
    ...RoleCardBase,
    model: Text,
    launch: Schema.NullOr(Text),
    persistence: Schema.Struct({ persistent: Schema.Boolean, why: Text }),
    toggle: Schema.Boolean,
  }),
  Schema.TaggedStruct('Program', RoleCardBase),
])
export const OnboardingView = Schema.Struct({
  stage: Schema.Literals(['files', 'store']),
  directions: Schema.Array(DirectionCard),
  roles: Schema.Array(RoleCard),
  models: Schema.Array(Text),
  adjustments: Schema.Array(Decision),
  start: Schema.Union([
    Schema.Struct({ state: Schema.Literals(['open', 'waiting', 'started']) }),
    Schema.Struct({ state: Schema.Literal('blocked'), says: Text, fix: Text }),
  ]),
})
// GET /api/person (ruling 10.8): the page knows the person only by git user.name. A name that is
// no person of the dir sees no items, and the line says which name to set.
export const PersonView = Schema.Struct({
  name: Text,
  known: Schema.Boolean,
  line: Schema.NullOr(Text),
})

// --- the websocket --------------------------------------------------------------------------

export const ServerMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal('changed') }),
  // P8: the build of the server's code, on each open of the socket; a new one reloads the page.
  Schema.Struct({ type: Schema.Literal('hello'), build: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('term.data'),
    session: SessionId,
    data: Text,
    reset: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({ type: Schema.Literal('term.error'), session: SessionId, error: Text }),
  // The size of a terminal as tmux has it, before its first bytes and after each resize: the
  // page never sizes a terminal itself (ruling 2026-11-14).
  Schema.Struct({
    type: Schema.Literal('term.size'),
    session: SessionId,
    cols: PositiveInt,
    rows: PositiveInt,
  }),
])
export const PageMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literals(['term.open', 'term.close']), session: SessionId }),
  Schema.Struct({ type: Schema.Literal('term.input'), session: SessionId, data: Text }),
  Schema.Struct({
    type: Schema.Literal('term.resize'),
    session: SessionId,
    cols: PositiveInt,
    rows: PositiveInt,
  }),
])

// --- the dashboard (GET /api/dash, and the `dash` message of the socket) ----------------------

const DashStatus = Schema.Literals(['Working', 'Waiting', 'Inactive'])
const DashItemKind = Schema.Literals(['dir', 'std', 'rule'])
const DashForm = Schema.Literals(['none', 'mech', 'ref', 'both'])
const DashExample = Schema.Struct({
  fits: Schema.Literals(['follows', 'breaks']),
  sample: Text,
})
const DashRec = Schema.Struct({
  kind: DashItemKind,
  parent: Schema.NullOr(Text),
  name: Text,
  says: Text,
  where: Schema.NullOr(Schema.Array(Text)),
  test: Schema.NullOr(Text),
  ref: Schema.NullOr(Text),
  form: DashForm,
  examples: Schema.Array(DashExample),
})
const DashTask = Schema.Struct({
  id: Text,
  name: Text,
  role: Text,
  state: Schema.Literals(['WORKING', 'QUEUED']),
  description: Text,
})
const DashSubagent = Schema.Struct({ model: Text, role: Text, goal: Text })
const DashTerminal = Schema.Struct({
  role: Text,
  // The pump session of its pane now (a click opens it).
  session: Text,
  model: Text,
  status: DashStatus,
  work: Text,
})
const DashColumn = Schema.Struct({
  role: Text,
  card: DashTerminal,
  task: Schema.NullOr(DashTask),
  subagents: Schema.Array(DashSubagent),
})
// An item of a draft: the record now and the record the draft sets (null: removed).
const DashChange = Schema.Struct({
  key: Text,
  version: Schema.Number,
  before: Schema.NullOr(DashRec),
  after: Schema.NullOr(DashRec),
})
const DashCardWords = Schema.Struct({ words: Text, model: Text })
const DashEscalation = Schema.Struct({
  id: Text,
  status: Schema.Literals(['QUEUED', 'IN_PIPELINE', 'WAIT_FOR_REVIEW']),
  summary: Text,
  // The task's name, or 'your direction edit'.
  task: Text,
  changes: Schema.Array(DashChange),
  card: Schema.NullOr(
    Schema.Struct({
      role: Text,
      before: Schema.NullOr(DashCardWords),
      after: DashCardWords,
    }),
  ),
})
const DashAct = Schema.Struct({
  tag: Text,
  target: Schema.NullOr(Text),
  words: Schema.Array(Text),
})
// `rec` is the whole record of the item: an edit starts from it.
const DashRule = Schema.Struct({
  key: Text,
  rec: DashRec,
  name: Text,
  version: Schema.Number,
  says: Text,
  form: DashForm,
})
const DashStandard = Schema.Struct({
  key: Text,
  rec: DashRec,
  name: Text,
  version: Schema.Number,
  summary: Text,
  rules: Schema.Array(DashRule),
})
const DashDirection = Schema.Struct({
  key: Text,
  rec: DashRec,
  name: Text,
  version: Schema.Number,
  principles: Schema.Array(Text),
  summary: Text,
  // The names of the first 3 standards (the card); the modal has them all in `standards`.
  first: Schema.Array(Text),
  examples: Schema.Array(DashExample),
  standards: Schema.Array(DashStandard),
})
// The whole dashboard: the page draws from a whole copy of it, never from a diff (browser.qnt).
export const Dash = Schema.Struct({
  header: Schema.Struct({ dir: Text, project: Text, seq: Schema.Number, build: Text }),
  queue: Schema.Array(DashTask),
  host: Schema.Struct({ card: DashTerminal, subagents: Schema.Array(DashSubagent) }),
  columns: Schema.Array(DashColumn),
  pipe: DashTerminal,
  row: Schema.Array(DashEscalation),
  rowShown: Schema.Boolean,
  person: Schema.Array(DashAct),
  directions: Schema.Array(DashDirection),
})
export type Dash = typeof Dash.Type
export type DashTerminalCard = typeof DashTerminal.Type
export type DashStatusWord = typeof DashStatus.Type
export const DashMessage = Schema.Struct({ type: Schema.Literal('dash'), dash: Dash })

// --- the acts of the person (POST /api/act) -------------------------------------------------

// The settings POST sends only the fields that the person changed: the server fills the rest
// from the file (a model keeps the words that it did not send, and outsideSourceHours is not on
// the form). The page changes the commands of the models that the table has; it adds none.
export const ModelChange = Schema.Struct({
  launch: Schema.optionalKey(Text),
  resume: Schema.optionalKey(Text),
  start: Schema.optionalKey(Text),
  skills: Schema.optionalKey(Text),
  errors: Schema.optionalKey(Schema.Array(Text)),
  prompts: Schema.optionalKey(Schema.Array(Text)),
  silentMinutes: Schema.optionalKey(Schema.Number),
  retryInput: Schema.optionalKey(Text),
})
export const SettingsChange = Schema.Struct({
  theme: Schema.optionalKey(Schema.Literals(['light', 'dark'])),
  sound: Schema.optionalKey(Schema.Boolean),
  retryMinutes: Schema.optionalKey(Schema.Number),
  hostWaitMinutes: Schema.optionalKey(Schema.Number),
  outsideSourceHours: Schema.optionalKey(Schema.Number),
  models: Schema.optionalKey(Schema.Record(Text, ModelChange)),
})
export type SettingsChange = typeof SettingsChange.Type

export const PageAct = Schema.Union([
  Schema.Struct({ act: Schema.Literal('open'), draft: TaskDraftId }),
  Schema.Struct({
    act: Schema.Literal('close'),
    run: RunId,
    reason: Schema.optionalKey(Text),
  }),
  Schema.Struct({ act: Schema.Literal('stop'), session: SessionId }),
  Schema.Struct({ act: Schema.Literal('resume'), session: SessionId }),
  Schema.Struct({ act: Schema.Literal('fixed'), problem: ProblemId }),
  Schema.Struct({
    act: Schema.Literal('accept-draft'),
    draft: RevisionId,
    comment: Schema.optionalKey(Text),
  }),
  Schema.Struct({ act: Schema.Literal('reject-draft'), draft: RevisionId, reason: NonBlank }),
  Schema.Struct({ act: Schema.Literal('confirm'), forward: EventRef }),
  Schema.Struct({ act: Schema.Literal('answer'), question: QuestionId, text: Text }),
  Schema.Struct({ act: Schema.Literal('end'), run: RunId }),
  Schema.Struct({ act: Schema.Literal('reject-task'), task: TaskId, reason: NonBlank }),
  Schema.Struct({ act: Schema.Literal('settings'), settings: SettingsChange }),
  Schema.Struct({ act: Schema.Literal('accept-words'), draft: EventRef }),
  Schema.Struct({ act: Schema.Literal('reject-words'), draft: EventRef, reason: NonBlank }),
  // The person decides a drafted adjustment (ruling 14).
  Schema.Struct({ act: Schema.Literal('accept-adjustment'), draft: EventRef }),
  Schema.Struct({ act: Schema.Literal('reject-adjustment'), draft: EventRef, reason: NonBlank }),
  // The text box of the gear (P7).
  Schema.Struct({ act: Schema.Literal('suggest'), about: SuggestionTarget, says: NonBlank }),
  Schema.Struct({ act: Schema.Literal('assign'), task: TaskId, role: RoleName }),
  Schema.Struct({ act: Schema.Literal('resolve'), escalation: EscalationId, text: Text }),
  Schema.Struct({
    act: Schema.Literal('accept-evaluation'),
    evaluation: EvaluationId,
    text: Text,
  }),
  Schema.Struct({
    act: Schema.Literal('reject-evaluation'),
    evaluation: EvaluationId,
    reason: NonBlank,
  }),
])
export type PageAct = typeof PageAct.Type
export const ACTS = [
  'open',
  'close',
  'stop',
  'resume',
  'fixed',
  'accept-draft',
  'reject-draft',
  'confirm',
  'answer',
  'end',
  'reject-task',
  'settings',
  'accept-words',
  'reject-words',
  'accept-adjustment',
  'reject-adjustment',
  'suggest',
  'assign',
  'resolve',
  'accept-evaluation',
  'reject-evaluation',
] as const

// The answer of an act: { out } (and { run, session } for a new project), or { error }.
export const ActAnswer = Schema.Struct({
  out: Schema.optionalKey(Text),
  run: Schema.optionalKey(Text),
  session: Schema.optionalKey(Text),
})
// A refusal: its message, and the next line that says what to do, when it has one.
export const ApiError = Schema.Struct({ error: Text, next: Schema.optionalKey(Text) })

// --- the Schemas agree with the types of ui-model.ts ----------------------------------------
// A mismatch fails the compile here: each pair is assignable both ways, and neither is `any` (an
// `any` is assignable both ways). Agree says false for a mismatch, and Must<false> is an error;
// with never in place of false, Must<never> compiled, so no mismatch ever failed.
type IsAny<T> = 0 extends 1 & T ? true : false
type Agree<A, B> =
  IsAny<A> extends true
    ? false
    : IsAny<B> extends true
      ? false
      : [A] extends [B]
        ? [B] extends [A]
          ? true
          : false
        : false
type Must<T extends true> = T
export type Agreements = [
  Must<Agree<typeof DirView.Type, UiDirView>>,
  Must<Agree<typeof ProjectSummary.Type, UiProjectSummary>>,
  Must<Agree<typeof ProjectView.Type, UiProjectView>>,
  Must<Agree<typeof CanvasRow.Type, UiCanvasRow>>,
  Must<Agree<typeof TaskCard.Type, UiTaskCard>>,
  Must<Agree<typeof Owner.Type, UiOwner>>,
  Must<Agree<typeof WorkCard.Type, UiWorkCard>>,
  Must<Agree<typeof ReviewCard.Type, UiReviewCard>>,
  Must<Agree<typeof TaskDraftView.Type, UiTaskDraftView>>,
  Must<Agree<typeof TerminalRef.Type, UiTerminalRef>>,
  Must<Agree<typeof TaskPanel.Type, UiTaskPanel>>,
  Must<Agree<typeof ResultView.Type, UiResultView>>,
  Must<Agree<typeof DirectionView.Type, UiDirectionView>>,
  Must<Agree<typeof DiffView.Type, UiDiffView>>,
  Must<Agree<typeof Decision.Type, UiDecision>>,
  Must<Agree<typeof OnboardingView.Type, UiOnboardingView>>,
  Must<Agree<typeof DirectionCard.Type, UiDirectionCard>>,
  Must<Agree<typeof RoleCard.Type, UiRoleCard>>,
  Must<Agree<typeof ExampleView.Type, UiExampleView>>,
  Must<Agree<typeof QuestionView.Type, UiQuestionView>>,
  Must<Agree<typeof ServerMessage.Type, UiServerMessage>>,
  Must<Agree<typeof PageMessage.Type, UiPageMessage>>,
  // The act of the page is the type of ui-model but for the settings, which carry a change.
  Must<
    Agree<
      Exclude<PageAct, { readonly act: 'settings' }>,
      Exclude<UiPageAct, { readonly act: 'settings' }>
    >
  >,
]
// The proof that a mismatch fails: each line under @ts-expect-error is one, so the compile fails
// if Agree ever says true for it (an unused @ts-expect-error is an error too).
export type Mismatches = [
  // @ts-expect-error a message that the type lacks (term.size was missing from ui-model.ts)
  Must<Agree<typeof ServerMessage.Type, Exclude<UiServerMessage, { readonly type: 'term.size' }>>>,
  // @ts-expect-error a field that the Schema lacks
  Must<Agree<typeof TerminalRef.Type, UiTerminalRef & { readonly extra: string }>>,
  // @ts-expect-error an `any` on one side
  Must<Agree<typeof TerminalRef.Type, ReturnType<typeof JSON.parse>>>,
]
