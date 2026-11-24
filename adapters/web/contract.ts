// The JSON between the server and the page: the Schemas of the view data of ui-model.ts part 4. The
// server encodes each answer with them and decodes each act and each terminal message; the page
// decodes each answer. The wire keeps the keys and the words of today (parity). Where a domain
// type differs from the wire, the Schema converts at its edge.
import { Schema } from 'effect'
import {
  BodySchema,
  LoopReviewMode,
  Discovery,
  OnboardingChoice,
  PositiveInt,
  QuestionBodySchema,
  RefusalSchema,
  SessionId,
  Settings,
  type DirectionCard as UiDirectionCard,
  type DirView as UiDirView,
  type OnboardingView as UiOnboardingView,
  type PageMessage as UiPageMessage,
  type RoleCard as UiRoleCard,
  type ServerMessage as UiServerMessage,
} from '../../core/schema/index.ts'

const Text = Schema.String

const DraftChange = Schema.Struct({ direction: Text, lines: Schema.Array(Text) })

// P8, ruling 3: the toast of the dir view: what the AI does now.
export const AiToast = Schema.Struct({
  status: Schema.NullOr(
    Schema.Struct({
      by: Text,
      kind: Schema.Literals(['working', 'thinking', 'applied', 'feedback', 'waiting']),
      words: Text,
      text: Text,
    }),
  ),
})

// One place of the sidebar's DIR / PROJECT picker: the dir with its project (a dir has at most
// one top task), and where picking it goes.
export const DirPick = Schema.Struct({ dir: Text, project: Schema.NullOr(Text), path: Text })
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
  picks: Schema.Array(DirPick),
  toast: AiToast,
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
    rules: Schema.Array(Schema.Struct({
      id: Text, says: Text, checkedBy: Schema.NullOr(Text),
      test: Schema.optionalKey(Text), ref: Schema.optionalKey(Text), result: Schema.optionalKey(Text),
      checkPrompt: Schema.optionalKey(Text),
      examples: Schema.optionalKey(Schema.Array(ExampleView)),
      searched: Schema.optionalKey(Schema.Array(Text)), knownBreak: Schema.optionalKey(Schema.Boolean),
    })),
  }),
)
export const FlowView = Schema.Array(
  Schema.Struct({
    from: Text,
    to: Text,
    says: Text,
    place: Schema.NullOr(Schema.Struct({ file: Text, line: Schema.NullOr(PositiveInt) })),
    uses: Schema.Array(Text),
  }),
)

const QuestionSide = Schema.Struct({ source: Text, words: Text })
const QuestionFields = {
  rule: Schema.optionalKey(Text),
  sides: Schema.optionalKey(Schema.Tuple([QuestionSide, QuestionSide])),
  says: Text,
  example: Schema.optionalKey(ExampleView),
  caseSides: Schema.optionalKey(Schema.Array(Schema.Tuple([QuestionSide, QuestionSide]))),
  options: Schema.Tuple([Text, Text]),
}
export const QuestionView = Schema.Struct(QuestionFields)
const AnsweredView = Schema.Struct({ ...QuestionFields, answer: OnboardingChoice })
const DirectionWords = Schema.Struct({
  summary: Text,
  flow: FlowView,
  says: Text,
  standards: StandardsView,
  diff: DraftChange,
  discovery: Schema.optionalKey(Discovery),
})
const CardHead = {
  revision: Schema.optionalKey(Text),
  principles: Schema.optionalKey(Schema.Array(Text)),
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
    draft: Schema.optionalKey(draft),
    answered: Schema.NonEmptyArray(AnsweredView),
  }),
  Schema.Struct({
    ...CardHead,
    state: Schema.Literal('loading'),
    why: Schema.Literal('revise'),
    words: Text,
    checkerChanged: Schema.optionalKey(Schema.Literal(true)),
    draft,
    answered: Schema.Array(AnsweredView),
  }),
  Schema.Struct({
    ...CardHead,
    state: Schema.Literal('question'),
    draft: Schema.optionalKey(draft),
    open: Schema.NonEmptyArray(QuestionView),
  }),
  Schema.Struct({ ...CardHead, state: Schema.Literal('removed') }),
  Schema.Struct({ ...CardHead, state: Schema.Literals(['ready', 'accepted', 'current']), draft }),
])
const RoleCardBase = {
  revision: Schema.optionalKey(Text),
  builtIn: Schema.optionalKey(Schema.Literals(['host', 'pipeline'])),
  principles: Schema.optionalKey(Schema.Array(Text)),
  directions: Schema.optionalKey(Schema.Array(Text)),
  questions: Schema.optionalKey(Schema.Array(Schema.Struct({ says: Text, choices: Schema.Array(Text) }))),
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
  discovery: Schema.optionalKey(Schema.Struct({
    summary: Text, read: Schema.Array(Text), notSearched: Schema.Array(Text), app: Schema.NullOr(Schema.Boolean),
  })),
  roleRequests: Schema.optionalKey(Schema.Array(Schema.Struct({ role: Text, words: Text }))),
  stage: Schema.Literals(['files', 'store']),
  directions: Schema.Array(DirectionCard),
  roles: Schema.Array(RoleCard),
  models: Schema.Array(Text),
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

const KeySequence = Schema.Number.check(Schema.isInt(), Schema.isBetween({
  minimum: 1, maximum: Number.MAX_SAFE_INTEGER - 1,
}))
const KeyIdentity = { instance: Text, session: SessionId, target: Text, seq: KeySequence }
const Attach = Schema.Number.check(Schema.isInt())

export const ServerMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal('changed') }),
  Schema.Struct({ type: Schema.Literal('term.bound'), session: SessionId, target: Text }),
  Schema.Struct({
    type: Schema.Literal('term.receipt'), ...KeyIdentity,
    status: Schema.Literals(['applied', 'doNotResend', 'refused', 'uncertain']),
    reason: Schema.optionalKey(Schema.Literal('target')),
  }),
  // P8: the build of the server's code, on each open of the socket; a new one reloads the page.
  Schema.Struct({ type: Schema.Literal('hello'), build: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('term.data'),
    session: SessionId,
    data: Text,
    attach: Attach,
    reset: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({ type: Schema.Literal('term.error'), session: SessionId, error: Text }),
  // The size of a terminal as tmux has it, before its first bytes and after each resize: the
  // page never sizes a terminal itself (ruling 2026-11-14).
  Schema.Struct({
    type: Schema.Literal('term.size'),
    session: SessionId,
    attach: Attach,
    cols: PositiveInt,
    rows: PositiveInt,
  }),
])
export const PageMessage = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(['term.open', 'term.close', 'term.redraw']), session: SessionId,
  }),
  Schema.Struct({ type: Schema.Literal('term.key'), ...KeyIdentity, data: Text }),
  Schema.Struct({
    type: Schema.Literal('term.resize'),
    session: SessionId,
    cols: PositiveInt,
    rows: PositiveInt,
  }),
])

export type TermKey = Extract<typeof PageMessage.Type, { readonly type: 'term.key' }>
export type KeyReceipt = Extract<typeof ServerMessage.Type, { readonly type: 'term.receipt' }>

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
  reject: Schema.Boolean,
})
const DashSubagent = Schema.Struct({ model: Text, role: Text, goal: Text })
const DashTerminal = Schema.Struct({
  role: Text,
  // The pump session of its pane now (a click opens it).
  session: Text,
  model: Text,
  status: DashStatus,
  work: Text,
  worker: Schema.optionalKey(Text),
})

const DashWorkerIdentity = Schema.Struct({ actor: Text, label: Text })
const DashWorkerPermit = Schema.Struct({ used: Schema.Int, limit: Schema.NullOr(Schema.Int) })
const DashWorkerUsage = Schema.Struct({ actor: Text, ...DashWorkerPermit.fields })
const DashWait = Schema.Struct({
  reason: Text,
  actor: Schema.NullOr(Text),
  step: Schema.NullOr(Text),
})
const DashWorkerLane = Schema.Struct({
  ...DashWorkerPermit.fields,
  entries: Schema.Array(Schema.Struct({
    id: Text, label: Text, state: Schema.Literals(['held', 'ready', 'waiting', 'selected', 'owed']),
  })),
})

export const DashWorker = Schema.Struct({
  id: Text,
  label: Text,
  account: Text,
  cli: Text,
  model: Text,
  identities: Schema.Array(DashWorkerIdentity),
  generation: Schema.NullOr(Schema.Int),
  session: Schema.NullOr(Schema.Struct({ id: Text, attach: Schema.NullOr(Text) })),
  status: Schema.Literals([
    'starting', 'idle', 'foreground occupied', 'parked', 'waiting for capacity', 'resuming', 'recovering', 'stopping', 'stopped',
  ]),
  turn: Schema.NullOr(Schema.Struct({ id: Text, actor: Text, step: Text, basis: Schema.Int })),
  waits: Schema.NullOr(Schema.Array(DashWait)),
  permits: Schema.Struct({
    provider: Schema.Struct({ ...DashWorkerPermit.fields, charged: Schema.Boolean }),
    attempts: Schema.NullOr(Schema.Array(DashWorkerUsage)),
    children: Schema.NullOr(Schema.Array(DashWorkerUsage)),
    fixes: Schema.NullOr(DashWorkerLane),
    rechecks: Schema.NullOr(DashWorkerLane),
  }),
})
export type DashWorker = typeof DashWorker.Type

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
const Reply = Schema.Literals(['AcceptIt', 'SendItBack', 'TakeAsIs', 'EvaluateAgain'])
const DashEscalation = Schema.Struct({
  id: Text,
  ask: Schema.NullOr(Text),
  reply: Schema.Array(Reply),
  status: Schema.Literals(['QUEUED', 'IN_PIPELINE', 'WAIT_FOR_REVIEW']),
  summary: Text,
  reviewMode: Schema.optionalKey(LoopReviewMode),
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
export const DashOwed = Schema.Union([
  Schema.TaggedStruct('Decide', { ask: Text, fix: Text, age: Schema.Int }),
  Schema.TaggedStruct('Question', {
    ask: Text, from: Text, role: Schema.NullOr(Text), age: Schema.Int, question: QuestionBodySchema,
  }),
  Schema.TaggedStruct('ReviveHost', { age: Schema.Int }),
  Schema.TaggedStruct('EndProject', { age: Schema.Int }),
])
// `rec` is the whole record of the item: an edit starts from it.
// A forwarded act waits for the person's Confirm or Drop.
const DashForward = Schema.Struct({ id: Text, quote: Text, words: Schema.Array(Text) })
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
export const ActivationView = Schema.Struct({
  phase: Schema.Literals(['activating', 'rolling back', 'active', 'host lost', 'relaunching']),
  step: Text,
  next: Schema.NullOr(Schema.Literals(['resume', 'roll back', 'relaunch'])),
})
export const MarkerApproval = Schema.Struct({
  entries: Schema.Array(Schema.Struct({ path: Text, hash: Text, premarked: Schema.Boolean })),
  reported: Schema.Array(Text),
})
export const ActivationPost = Schema.Union([
  Schema.Struct({ action: Schema.Literal('start'), entries: MarkerApproval.fields.entries }),
  Schema.Struct({ action: Schema.Literals(['resume', 'rollback', 'relaunch']) }),
])

// The whole dashboard: the page draws from a whole copy of it, never from a diff (browser.qnt).
export const Dash = Schema.Struct({
  activation: Schema.optionalKey(Schema.NullOr(ActivationView)),
  header: Schema.Struct({ dir: Text, project: Text, seq: Schema.Number, build: Text }),
  queue: Schema.Array(DashTask),
  results: Schema.Array(Schema.Struct({ id: Text, name: Text })),
  host: Schema.Struct({ card: DashTerminal, subagents: Schema.Array(DashSubagent) }),
  columns: Schema.Array(DashColumn),
  pipe: DashTerminal,
  workers: Schema.Array(DashWorker),
  row: Schema.Array(DashEscalation),
  rowShown: Schema.Boolean,
  person: Schema.Struct({ owed: Schema.Array(DashOwed) }),
  forwards: Schema.Array(DashForward),
  directions: Schema.Array(DashDirection),
})
export type Dash = typeof Dash.Type
export type DashTerminalCard = typeof DashTerminal.Type
export type DashStatusWord = typeof DashStatus.Type
export const DashMessage = Schema.Struct({ type: Schema.Literal('dash'), dash: Dash })

// --- the acts of the person (POST /api/act) -------------------------------------------------

const { cases: ActCases } = BodySchema.pipe(Schema.toTaggedUnion('_tag'))
const { cases: OpenCases } = ActCases.Open.fields.open.pipe(Schema.toTaggedUnion('_tag'))
export const PageActBody = Schema.Union([
  Schema.TaggedStruct('Open', { open: OpenCases.OpenReject }),
  ActCases.AskEdit,
  ActCases.AnswerQuestion,
  Schema.TaggedStruct('Respond', {
    ask: Text, reply: Reply, points: Schema.optionalKey(Schema.Array(Text)),
  }),
  ActCases.EndProject,
])
export type PageActBody = typeof PageActBody.Type
export type PageActJson = typeof PageActBody.Encoded

export const DirectWorkPost = Schema.Struct({
  act: PageActBody, on: Schema.Int, build: Text, id: Schema.optionalKey(Text),
})
export const ForwardWorkPost = Schema.Union([
  Schema.Struct({ confirm: Text, build: Text }),
  Schema.Struct({ drop: Text }),
])
export const ActResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true), seq: Schema.NullOr(Schema.Int),
    duplicate: Schema.optionalKey(Schema.Literal(true)),
  }),
  RefusalSchema,
  Schema.Struct({ error: Text, next: Schema.optionalKey(Text) }),
])
export type ActResponse = typeof ActResponse.Type

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

// The page's acts that no work post carries: the settings.
export const PageAct = Schema.Struct({ act: Schema.Literal('settings'), settings: SettingsChange })
export type PageAct = typeof PageAct.Type
export const ACTS = ['settings'] as const

// The answer of an act: { out }, or { error }.
export const ActAnswer = Schema.Struct({ out: Schema.optionalKey(Text) })
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
  Must<Agree<typeof OnboardingView.Type, UiOnboardingView>>,
  Must<Agree<typeof DirectionCard.Type, UiDirectionCard>>,
  Must<Agree<typeof RoleCard.Type, UiRoleCard>>,
  Must<Agree<typeof ServerMessage.Type, UiServerMessage>>,
  Must<Agree<typeof PageMessage.Type, UiPageMessage>>,
]
// The proof that a mismatch fails: each line under @ts-expect-error is one, so the compile fails
// if Agree ever says true for it (an unused @ts-expect-error is an error too).
export type Mismatches = [
  // @ts-expect-error a message that the type lacks (term.size was missing from ui-model.ts)
  Must<Agree<typeof ServerMessage.Type, Exclude<UiServerMessage, { readonly type: 'term.size' }>>>,
  // @ts-expect-error a field that the Schema lacks
  Must<Agree<typeof DirView.Type, UiDirView & { readonly extra: string }>>,
  // @ts-expect-error a field that the Schema lacks
  Must<Agree<typeof RoleCard.Type, UiRoleCard & { readonly extra: string }>>,
  // @ts-expect-error an `any` on one side
  Must<Agree<typeof RoleCard.Type, ReturnType<typeof JSON.parse>>>,
]

const StaffingUnknown = Schema.Struct({ known: Schema.Literal(false), why: Text })
const StaffingLimit = Schema.Struct({ limit: Text, typed: Text })
export const StaffingView = Schema.Struct({
  accounts: Schema.Array(Schema.Struct({
    account: Text, limits: Schema.Array(StaffingLimit), roles: Schema.Array(Text),
    sessionLimit: Schema.NullOr(Schema.Number),
  })),
  workers: Schema.Array(Schema.Struct({
    worker: Text, roles: Schema.Array(Text), account: Text, shared: Schema.Boolean,
  })),
  arrangement: Schema.Array(Schema.Struct({
    role: Text, account: Text, cli: Text, model: Text, alternatives: Schema.Array(Text),
    persistent: Schema.Boolean, worker: Schema.NullOr(Text), workerGroup: Schema.NullOr(Text),
    concurrency: Schema.Number, subagentAllowance: Schema.Number,
    review: Schema.Literals(['fresh subagent', 'self-review turns']),
    fit: StaffingUnknown,
  })),
  consequences: Schema.Array(Schema.Struct({
    account: Text, limit: Text, typed: Text, roles: Schema.Array(Text),
    peakSessions: Schema.Number, workload: StaffingUnknown,
  })),
  warnings: Schema.Array(Schema.Struct({ role: Text, says: Text })),
})
export const StaffingState = Schema.NullOr(Schema.Struct({
  revision: Text, clis: Schema.Array(Text), confirmed: Schema.Boolean, view: StaffingView,
}))
export const StaffingPreview = Schema.Struct({
  ticket: Text, before: StaffingView, after: StaffingView, changed: Schema.Array(Text),
})
const StaffingEdit = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('limit'), account: Text, limit: Text, typed: Text }),
  Schema.Struct({ kind: Schema.Literal('sessions'), account: Text, sessionLimit: Schema.NullOr(Schema.Number) }),
  Schema.Struct({
    kind: Schema.Literal('role'), role: Text, account: Text, cli: Text, model: Text,
    persistent: Schema.Boolean, concurrency: Schema.Number, subagentAllowance: Schema.Number,
    workerGroup: Schema.optionalKey(Schema.NullOr(Text)),
  }),
])
export const StaffingPost = Schema.Union([
  Schema.Struct({ action: Schema.Literal('preview'), revision: Text, edit: Schema.optionalKey(StaffingEdit) }),
  Schema.Struct({ action: Schema.Literal('apply'), ticket: Text }),
])
