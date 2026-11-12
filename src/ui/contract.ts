// The JSON between the server and the page: the Schemas of src/domain/ui-model.ts part 4. The
// server encodes each answer with them and decodes each act and each terminal message; the page
// decodes each answer. The wire keeps the keys and the words of today (parity). Where a domain
// type differs from the wire, the Schema converts at its edge: a Decision is tagged and has a
// tagged `shown` in the domain, and the wire has `kind` and `shown: boolean`.
import { Schema, SchemaGetter } from 'effect'
import { Why } from '../domain/events.ts'
import { Settings } from '../domain/files.ts'
import {
  AssignmentId,
  ProblemId,
  RevisionId,
  RunId,
  SessionId,
  TaskDraftId,
  TaskId,
  Time,
} from '../domain/ids.ts'
import type * as Ui from '../domain/ui-model.ts'

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
  rolesDraft: Schema.Boolean,
  launchSet: Schema.Boolean,
  initialized: Schema.Boolean,
  assessPrompt: Text,
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
export const DirectionView = Schema.Struct({
  id: Text,
  name: Text,
  owner: Text,
  version: Text,
  says: Text,
  standards: Schema.Array(
    Schema.Struct({
      id: Text,
      says: Text,
      rules: Schema.Array(
        Schema.Struct({ id: Text, says: Text, checkedBy: Schema.NullOr(Text) }),
      ),
    }),
  ),
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

// GET /api/roles-draft.
export const RolesDraft = Schema.Struct({ text: Schema.NullOr(Text) })

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
    }),
  ),
})
export type SettingsChange = typeof SettingsChange.Type

export const PageAct = Schema.Union([
  Schema.Struct({ act: Schema.Literals(['new-project', 'accept-roles']) }),
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
    tier: Schema.Literals(['sol', 'terra']),
  }),
  Schema.Struct({ act: Schema.Literal('fixed'), problem: ProblemId }),
  Schema.Struct({
    act: Schema.Literal('accept-draft'),
    draft: RevisionId,
    comment: Schema.optionalKey(Text),
  }),
  Schema.Struct({ act: Schema.Literal('reject-draft'), draft: RevisionId, reason: Text }),
  Schema.Struct({ act: Schema.Literal('end'), run: RunId }),
  Schema.Struct({ act: Schema.Literal('reject-task'), task: TaskId, reason: Text }),
  Schema.Struct({ act: Schema.Literal('settings'), settings: SettingsChange }),
])
export type PageAct = typeof PageAct.Type
export const ACTS = [
  'new-project',
  'accept-roles',
  'open',
  'close',
  'stop',
  'resume',
  'fixed',
  'accept-draft',
  'reject-draft',
  'end',
  'reject-task',
  'settings',
] as const

// The answer of an act: { out } (and { run, session } for a new project), or { error }.
export const ActAnswer = Schema.Struct({
  out: Schema.optionalKey(Text),
  run: Schema.optionalKey(Text),
  session: Schema.optionalKey(Text),
})
export const ApiError = Schema.Struct({ error: Text })

// --- the Schemas agree with the types of ui-model.ts ----------------------------------------
// A mismatch fails the compile here: each pair is assignable both ways.
type Agree<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
type Must<T extends true> = T
export type Agreements = [
  Must<Agree<typeof DirView.Type, Ui.DirView>>,
  Must<Agree<typeof ProjectSummary.Type, Ui.ProjectSummary>>,
  Must<Agree<typeof ProjectView.Type, Ui.ProjectView>>,
  Must<Agree<typeof CanvasRow.Type, Ui.CanvasRow>>,
  Must<Agree<typeof TaskCard.Type, Ui.TaskCard>>,
  Must<Agree<typeof Owner.Type, Ui.Owner>>,
  Must<Agree<typeof WorkCard.Type, Ui.WorkCard>>,
  Must<Agree<typeof ReviewCard.Type, Ui.ReviewCard>>,
  Must<Agree<typeof TaskDraftView.Type, Ui.TaskDraftView>>,
  Must<Agree<typeof TerminalRef.Type, Ui.TerminalRef>>,
  Must<Agree<typeof TaskPanel.Type, Ui.TaskPanel>>,
  Must<Agree<typeof ResultView.Type, Ui.ResultView>>,
  Must<Agree<typeof DirectionView.Type, Ui.DirectionView>>,
  Must<Agree<typeof DiffView.Type, Ui.DiffView>>,
  Must<Agree<typeof Decision.Type, Ui.Decision>>,
  Must<Agree<typeof ServerMessage.Type, Ui.ServerMessage>>,
  Must<Agree<typeof PageMessage.Type, Ui.PageMessage>>,
  // The act of the page is the type of ui-model but for the settings, which carry a change.
  Must<
    Agree<
      Exclude<PageAct, { readonly act: 'settings' }>,
      Exclude<Ui.PageAct, { readonly act: 'settings' }>
    >
  >,
]
