// The JSON between the server and the page: the Schemas of the view data of ui-model.ts part 4. The
// server encodes each answer with them and decodes each act and each terminal message; the page
// decodes each answer. The wire keeps the keys and the words of today (parity). Where a domain
// type differs from the wire, the Schema converts at its edge.
import { Schema } from 'effect'
import {
  DirectionId,
  NonBlank,
  PositiveInt,
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

// What a suggestion of the gear is about.
export const SuggestionTarget = Schema.Union([
  Schema.TaggedStruct('NewDirection', {}),
  Schema.TaggedStruct('Direction', { direction: DirectionId }),
  Schema.TaggedStruct('Roles', {}),
])

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
    rules: Schema.Array(Schema.Struct({ id: Text, says: Text, checkedBy: Schema.NullOr(Text) })),
  }),
)
export const FlowView = Schema.Array(
  Schema.Struct({
    from: Text,
    to: Text,
    says: Text,
    place: Schema.NullOr(Schema.Struct({ file: Text, line: Schema.NullOr(PositiveInt) })),
    uses: Schema.Array(Text),
    examples: Schema.Array(ExampleView),
  }),
)

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
  forwards: Schema.Array(DashForward),
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

// The page's acts that no work post carries: the settings, and the text box of the gear (P7).
export const PageAct = Schema.Union([
  Schema.Struct({ act: Schema.Literal('settings'), settings: SettingsChange }),
  Schema.Struct({ act: Schema.Literal('suggest'), about: SuggestionTarget, says: NonBlank }),
])
export type PageAct = typeof PageAct.Type
export const ACTS = ['settings', 'suggest'] as const

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
