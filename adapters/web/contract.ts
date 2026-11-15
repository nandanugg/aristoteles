// The JSON between the server and the page: the Schemas of the view data of ui-model.ts part 4. The
// server encodes each answer with them and decodes each act and each terminal message; the page
// decodes each answer. The wire keeps the keys and the words of today (parity). Where a domain
// type differs from the wire, the Schema converts at its edge: a Decision is tagged and has a
// tagged `shown` in the domain, and the wire has `kind` and `shown: boolean`.
import { Schema, SchemaGetter } from 'effect'
import {
  AdjustmentSchema,
  AgentId,
  AssignmentId,
  DirectionId,
  EventRef,
  ProblemId,
  QuestionId,
  RevisionId,
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
const Tier = Schema.Literals(['sol', 'terra', 'luna', 'program'])
// The live state of a terminal: the keys are on a card with a session only.
const Live = {
  live: Schema.optionalKey(Schema.Boolean),
  ended: Schema.optionalKey(Schema.Boolean),
}
const TimeOrNone = Schema.Union([Time, Schema.Literal('')])
const Attempt = Schema.Struct({ now: Schema.Number, max: Schema.NullOr(Schema.Number) })

// --- the decisions -------------------------------------------------------------------------

const DraftChange = Schema.Struct({ direction: Text, lines: Schema.Array(Text) })
const Shown = Schema.Union([
  Schema.TaggedStruct('Shown', {}),
  Schema.TaggedStruct('HeldForHost', { until: Time }),
])
const DecisionBase = {
  id: Text,
  task: Schema.NullOr(TaskId),
  text: Text,
  words: Schema.NullOr(Text),
  at: Time,
  shown: Shown,
}
const DecisionDomain = Schema.Union([
  Schema.TaggedStruct('System', { ...DecisionBase, stopped: TaskId }),
  Schema.TaggedStruct('Direction', {
    ...DecisionBase,
    direction: Text,
    change: DraftChange,
    hope: Schema.NullOr(Text),
    why: Why,
  }),
  Schema.TaggedStruct('End', DecisionBase),
  Schema.TaggedStruct('Confirm', { ...DecisionBase, quote: Text }),
  // New words of a role (ruling 2026-11-14).
  Schema.TaggedStruct('RoleWords', { ...DecisionBase, role: Text, lines: Schema.Array(Text) }),
  // A drafted adjustment (ruling 14).
  Schema.TaggedStruct('Adjustment', { ...DecisionBase, adjustment: AdjustmentSchema }),
  // A question to the person: the text is the question.
  Schema.TaggedStruct('Question', { ...DecisionBase, asker: Text, options: Schema.Array(Text) }),
])
type DecisionEncoded = typeof DecisionDomain.Encoded

const WireBase = {
  id: Text,
  task: Schema.NullOr(Text),
  text: Text,
  words: Schema.NullOr(Text),
  hope: Schema.NullOr(Text),
  at: Text,
  shown: Schema.Boolean,
}
const DecisionWire = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('system'), ...WireBase, stopped: Text }),
  Schema.Struct({
    kind: Schema.Literal('direction'),
    ...WireBase,
    direction: Text,
    change: DraftChange,
    why: Schema.toEncoded(Why),
  }),
  Schema.Struct({ kind: Schema.Literal('end'), ...WireBase }),
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
])
type DecisionWireType = typeof DecisionWire.Type

const toWire = (d: DecisionEncoded): DecisionWireType => {
  const base = {
    id: d.id,
    task: d.task,
    text: d.text,
    words: d.words,
    at: d.at,
    shown: d.shown._tag === 'Shown',
  }
  switch (d._tag) {
    case 'System':
      return { kind: 'system', ...base, hope: null, stopped: d.stopped }
    case 'Direction':
      return {
        kind: 'direction',
        ...base,
        hope: d.hope,
        direction: d.direction,
        change: d.change,
        why: d.why,
      }
    case 'End':
      return { kind: 'end', ...base, hope: null }
    case 'Confirm':
      return { kind: 'confirm', ...base, hope: null, quote: d.quote }
    case 'RoleWords':
      return { kind: 'roleWords', ...base, hope: null, role: d.role, lines: d.lines }
    case 'Adjustment':
      return { kind: 'adjustment', ...base, hope: null, adjustment: d.adjustment }
    case 'Question':
      return { kind: 'question', ...base, hope: null, asker: d.asker, options: d.options }
  }
}

// A decision that the server held back never goes on the wire (only shown ones do), so the wire
// cannot say until when: a false `shown` reads as held until its own time.
const fromWire = (w: DecisionWireType): DecisionEncoded => {
  const shown = w.shown
    ? ({ _tag: 'Shown' } as const)
    : ({ _tag: 'HeldForHost', until: w.at } as const)
  const base = { id: w.id, task: w.task, text: w.text, words: w.words, at: w.at, shown }
  switch (w.kind) {
    case 'system':
      return { _tag: 'System', ...base, stopped: w.stopped }
    case 'direction':
      return {
        _tag: 'Direction',
        ...base,
        direction: w.direction,
        change: w.change,
        hope: w.hope,
        why: w.why,
      }
    case 'end':
      return { _tag: 'End', ...base }
    case 'confirm':
      return { _tag: 'Confirm', ...base, quote: w.quote }
    case 'roleWords':
      return { _tag: 'RoleWords', ...base, role: w.role, lines: w.lines }
    case 'adjustment':
      return { _tag: 'Adjustment', ...base, adjustment: w.adjustment }
    case 'question':
      return { _tag: 'Question', ...base, asker: w.asker, options: w.options }
  }
}

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
  tier: Tier,
  agent: Schema.NullOr(AgentId),
  session: Schema.NullOr(SessionId),
  inside: Schema.NullOr(AssignmentId),
  resumable: Schema.optionalKey(Schema.Boolean),
  ...Live,
})
export const ReviewCard = Schema.Struct({
  id: Schema.NullOr(Text),
  by: Text,
  role: Schema.NullOr(Text),
  tier: Schema.NullOr(Schema.Literals(['sol', 'terra', 'luna', 'program', 'person'])),
  decides: Schema.Boolean,
  decision: Schema.Literals(['accept', 'reject', 'escalate', 'reviews', 'waits']),
  line: Text,
})
// The word of a card (not a record state: the architecture test reads a `state:` beside a
// spread as a copy of a record with a new state).
const WorkWord = {
  state: Schema.Literals(['works', 'in review', 'accepted', 'rejected', 'finished']),
}
export const WorkCard = Schema.Struct({
  a: AssignmentId,
  role: Text,
  tier: Tier,
  attempt: Attempt,
  session: Schema.NullOr(SessionId),
  inside: Schema.NullOr(AssignmentId),
  result: Schema.NullOr(Text),
  output: Schema.NullOr(Text),
  ...WorkWord,
  files: Schema.Number,
  reviews: Schema.Array(ReviewCard),
  ...Live,
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
export const TerminalRef = Schema.Struct({ session: SessionId, a: Text, ...Live })

const SummaryFields = {
  id: Text,
  kind: Schema.Literals(['host', 'task']),
  at: TimeOrNone,
  session: Schema.NullOr(SessionId),
  state: Schema.Literals(['talks', 'works', 'ends', 'done', 'closed']),
  title: Text,
  top: Schema.NullOr(TaskId),
  badge: Schema.Boolean,
}
export const ProjectSummary = Schema.Struct(SummaryFields)
export const ProjectView = Schema.Struct({
  ...SummaryFields,
  rows: Schema.Array(CanvasRow),
  drafts: Schema.Array(TaskDraftView),
  terminal: Schema.NullOr(TerminalRef),
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
    file: Schema.NullOr(Text),
    line: Schema.NullOr(Schema.Number),
    uses: Schema.Array(Text),
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
  top: Schema.Boolean,
  decisions: Schema.Array(Decision),
  terminal: Schema.NullOr(TerminalRef),
  directions: Schema.NullOr(Schema.Array(DirectionView)),
  results: Schema.Array(ResultView),
  timeline: Schema.Array(Schema.Struct({ at: Time, who: Text, line: Text })),
  files: Schema.Array(Schema.Struct({ file: Text, added: Schema.Number, removed: Schema.Number })),
})
export const DiffView = Schema.Struct({ file: Schema.NullOr(Text), diff: Text })

// GET /api/onboarding: the directions page, the agents page, and the gear's two entries.
const SpotView = Schema.Struct({
  file: Text,
  line: Schema.Number,
  excerpt: Text,
  current: Schema.Boolean,
  around: Schema.Array(Schema.Struct({ line: Schema.Number, text: Text, mark: Schema.Boolean })),
})
const SampleView = Schema.Union([SpotView, Schema.Struct({ written: Text })])
export const ExampleView = Schema.Struct({
  step: Schema.Number,
  fit: Schema.Literals(['Follows', 'Breaks']),
  input: Schema.NullOr(SampleView),
  output: SampleView,
})
export const QuestionView = Schema.Struct({
  says: Text,
  example: ExampleView,
  options: Schema.Tuple([Text, Text]),
  answer: Schema.NullOr(Schema.Literals(['A', 'B'])),
})
export const DirectionCard = Schema.Struct({
  id: Text,
  name: Text,
  state: Schema.Literals(['loading', 'question', 'ready', 'accepted', 'current']),
  origin: Text,
  principle: Schema.NullOr(Text),
  example: Schema.NullOr(Text),
  summary: Schema.NullOr(Text),
  flow: FlowView,
  says: Schema.NullOr(Text),
  standards: StandardsView,
  diff: Schema.NullOr(DraftChange),
  examples: Schema.Array(ExampleView),
  questions: Schema.Array(QuestionView),
  request: Schema.NullOr(Text),
  reset: Schema.Boolean,
})
export const RoleCard = Schema.Struct({
  role: Text,
  icon: Text,
  tier: Tier,
  model: Schema.NullOr(Text),
  launch: Schema.NullOr(Text),
  summary: Text,
  description: Text,
  persistence: Schema.NullOr(Schema.Struct({ persistent: Schema.Boolean, why: Text })),
  toggle: Schema.Boolean,
  found: Schema.NullOr(Text),
  state: Schema.Literals(['waiting', 'accepted', 'current']),
  request: Schema.NullOr(Text),
})
export const OnboardingView = Schema.Struct({
  stage: Schema.Literals(['files', 'store']),
  directions: Schema.Array(DirectionCard),
  roles: Schema.Array(RoleCard),
  adjustments: Schema.Array(Decision),
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
    cols: Schema.Number,
    rows: Schema.Number,
  }),
])
export const PageMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literals(['term.open', 'term.close']), session: SessionId }),
  Schema.Struct({ type: Schema.Literal('term.input'), session: SessionId, data: Text }),
  Schema.Struct({
    type: Schema.Literal('term.resize'),
    session: SessionId,
    cols: Schema.Number,
    rows: Schema.Number,
  }),
])

// --- the acts of the person (POST /api/act) -------------------------------------------------

// The settings POST sends only the fields that the person changed: the server fills the rest
// from the file (a tier keeps the words that it did not send, and outsideSourceHours is not on
// the form).
export const TierChange = Schema.Struct({
  model: Schema.optionalKey(Text),
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
  tiers: Schema.optionalKey(
    Schema.Struct({
      sol: Schema.optionalKey(TierChange),
      terra: Schema.optionalKey(TierChange),
      luna: Schema.optionalKey(TierChange),
    }),
  ),
})
export type SettingsChange = typeof SettingsChange.Type

// What a suggestion of the gear is about.
export const SuggestionTarget = Schema.Union([
  Schema.TaggedStruct('NewDirection', {}),
  Schema.TaggedStruct('Direction', { direction: DirectionId }),
  Schema.TaggedStruct('Roles', {}),
])
export const PageAct = Schema.Union([
  Schema.Struct({ act: Schema.Literal('open'), draft: TaskDraftId }),
  Schema.Struct({
    act: Schema.Literal('close'),
    run: RunId,
    reason: Schema.optionalKey(Text),
  }),
  Schema.Struct({ act: Schema.Literal('stop'), session: SessionId }),
  Schema.Struct({
    act: Schema.Literal('resume'),
    session: SessionId,
    tier: Schema.Literals(['sol', 'terra', 'luna']),
  }),
  Schema.Struct({ act: Schema.Literal('fixed'), problem: ProblemId }),
  Schema.Struct({
    act: Schema.Literal('accept-draft'),
    draft: RevisionId,
    comment: Schema.optionalKey(Text),
  }),
  Schema.Struct({ act: Schema.Literal('reject-draft'), draft: RevisionId, reason: Text }),
  Schema.Struct({ act: Schema.Literal('confirm'), forward: EventRef }),
  Schema.Struct({ act: Schema.Literal('answer'), question: QuestionId, text: Text }),
  Schema.Struct({ act: Schema.Literal('end'), run: RunId }),
  Schema.Struct({ act: Schema.Literal('reject-task'), task: TaskId, reason: Text }),
  Schema.Struct({ act: Schema.Literal('settings'), settings: SettingsChange }),
  Schema.Struct({ act: Schema.Literal('accept-words'), draft: EventRef }),
  Schema.Struct({ act: Schema.Literal('reject-words'), draft: EventRef, reason: Text }),
  // The person decides a drafted adjustment (ruling 14).
  Schema.Struct({ act: Schema.Literal('accept-adjustment'), draft: EventRef }),
  Schema.Struct({ act: Schema.Literal('reject-adjustment'), draft: EventRef, reason: Text }),
  // The text box of the gear (P7).
  Schema.Struct({ act: Schema.Literal('suggest'), about: SuggestionTarget, says: Text }),
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
