// The UI's types: the person's typed send to a pane (a record that the fold keeps), and the view
// data that the page reads (GET /api/...). The view data keeps the keys and the word values of the
// page (parity); its optional keys, and the kind, act and type keys, are the outside (the JSON
// that the page reads). Each union is tagged with _tag where it is not that JSON.
import type {
  Destination,
  DropReason as DropReasonSchema,
  Enter,
  Line,
} from './events.ts'
import type { Settings } from './files.ts'
import type { EventRef, PositiveInt, SessionId, Time } from './ids.ts'
import type { NonEmpty } from './model.ts'

type Text = string

// --- 1. The person's typed sends ---------------------------------------------------------------

// Every text that goes into a terminal: the person's input for a pane (work send), stored so that
// the supervisor types it once. The person typing into a terminal on the page is raw input, not a
// Send.
export interface Send {
  readonly id: EventRef // its Sent event (e12)
  readonly from: { readonly _tag: 'Person'; readonly to: typeof Destination.Type }
  readonly keys: typeof Line.Type | typeof Enter.Type
  readonly state: SendState
  readonly at: Time // when it was sent (and pending from)
}
export type SendState =
  | { readonly _tag: 'Pending' }
  | { readonly _tag: 'Delivered'; readonly at: Time }
  | { readonly _tag: 'Dropped'; readonly at: Time; readonly why: DropReason }
// Why a send never reached its terminal (events.ts DropReason).
export type DropReason = typeof DropReasonSchema.Type

// --- 2. The view data that the page reads (GET /api/...) -----------------------------------------

// What a draft changes, as a code review: one diff of the whole text of the direction.
export interface DraftChange {
  readonly direction: Text // the title over it: the name of the direction, or what it compares
  readonly lines: ReadonlyArray<Text> // ' ' kept, '-' gone, '+' new
}

// One place of the sidebar's DIR / PROJECT picker: the dir with its project (a dir has at most
// one top), and where picking it goes.
export interface DirPick {
  readonly dir: Text
  readonly project: Text | null
  readonly path: Text
}

// GET /api/dir: the sidebar.
export interface DirView {
  readonly name: Text // the folder name
  readonly path: Text
  readonly theme: 'light' | 'dark'
  readonly sound: boolean
  readonly settings: Settings
  readonly hasConfig: boolean // aristoteles.yaml exists
  // Onboarding files are in the dir (.work/assess/ or aristoteles.draft.yaml): with no store, the
  // page shows the directions page and the agents page (rulings 2, 3, 11).
  readonly onboarding: boolean
  readonly initialized: boolean // the dir has a store
  readonly startPrompt: Text // the person pastes it into their AI CLI in the dir: that session is the host
  readonly picks: ReadonlyArray<DirPick>
  // P8, ruling 3: the toast of the dir view: what the AI does now.
  readonly toast: AiToast
}
export interface AiToast {
  readonly status: {
    readonly by: Text
    readonly kind: 'working' | 'thinking' | 'applied' | 'feedback' | 'waiting'
    readonly words: Text
    readonly text: Text
  } | null
}

export interface DirectionView {
  readonly id: Text
  readonly name: Text
  readonly owner: Text
  readonly version: Text // tsd-writing@2
  readonly summary: Text // the page shows it before the words (Nanda, 2026-11-15)
  readonly flow: ReadonlyArray<FlowStepView> // a sequence diagram under the summary; none: no diagram
  readonly says: Text
  readonly standards: ReadonlyArray<{
    readonly id: Text
    readonly says: Text
    readonly rules: ReadonlyArray<{
      readonly id: Text
      readonly says: Text
      readonly checkedBy: Text | null
      readonly test?: Text
      readonly ref?: Text
      readonly checkPrompt?: Text
      readonly result?: Text
      readonly examples?: ReadonlyArray<ExampleView>
      readonly searched?: ReadonlyArray<Text>
      readonly knownBreak?: boolean
    }>
  }>
  // The versions made during the project, and the drafts that wait.
  readonly changed: ReadonlyArray<{ readonly id: Text; readonly at: Time }>
  readonly drafts: ReadonlyArray<{ readonly id: Text; readonly by: Text; readonly at: Time }>
}
// The websocket: "changed" when the store has a new act, and the bytes of the terminals. The
// optional keys of the messages and of the acts below are the wire format (outside), as today.
export interface TermKey {
  readonly type: 'term.key'
  readonly instance: string
  readonly session: SessionId
  readonly target: string
  readonly seq: number
  readonly data: Text
}

export interface KeyReceipt {
  readonly type: 'term.receipt'
  readonly instance: string
  readonly session: SessionId
  readonly target: string
  readonly seq: number
  readonly status: 'applied' | 'doNotResend' | 'refused' | 'uncertain'
  readonly reason?: 'target'
}

export type ServerMessage =
  | { readonly type: 'changed' }
  | KeyReceipt
  | { readonly type: 'term.bound'; readonly session: SessionId; readonly target: string }
  // P8: the build of the server's code, on each open of the socket; a new one reloads the page.
  | { readonly type: 'hello'; readonly build: string }
  | {
      readonly type: 'term.data'
      readonly session: SessionId
      readonly data: Text
      readonly attach: number
      readonly reset?: boolean
    } // base64
  | { readonly type: 'term.error'; readonly session: SessionId; readonly error: Text }
  // The size of a terminal as tmux has it, before its first bytes and after each resize: the page
  // never sizes a terminal itself (ruling 2026-11-14).
  | {
      readonly type: 'term.size'
      readonly session: SessionId
      readonly attach: number
      readonly cols: PositiveInt
      readonly rows: PositiveInt
    }
export type PageMessage =
  | { readonly type: 'term.open' | 'term.close' | 'term.redraw'; readonly session: SessionId }
  | TermKey
  | {
      readonly type: 'term.resize'
      readonly session: SessionId
      readonly cols: PositiveInt
      readonly rows: PositiveInt
    }

// GET /api/onboarding: the directions page and the agents page (rulings 2, 3, 11). One view
// serves both times: before the store it reads the onboarding files; after it, the store.
export interface OnboardingView {
  readonly discovery?: {
    readonly summary: Text
    readonly read: ReadonlyArray<Text>
    readonly notSearched: ReadonlyArray<Text>
    readonly app: boolean | null
  }
  readonly roleRequests?: ReadonlyArray<{ readonly role: Text; readonly words: Text }>
  readonly stage: 'files' | 'store'
  readonly directions: ReadonlyArray<DirectionCard>
  readonly roles: ReadonlyArray<RoleCard> // the roles that the project has come first
  readonly models: ReadonlyArray<Text> // the names of the models table, for the model of a role
  readonly start: StartView
}
// Whether the store can start (O1, core/actions startStateOf): open, waiting for an accept, or
// blocked, with what blocks it and who fixes it. started: the store exists.
export type StartView =
  | { readonly state: 'open' | 'waiting' | 'started' }
  | { readonly state: 'blocked'; readonly says: Text; readonly fix: Text }
// One direction of the list, and the right column when it is open. Its state says what it has:
// a draft (or a version) holds all its words at once, and only a question has open questions.
// loading, question, ready, accepted: a file of onboarding; current: official in the store.
export type DirectionCard = CardHead &
  (
    // the host drafts it: the first draft, or again because its file was in an older shape
    | { readonly state: 'loading'; readonly why: 'drafting' | 'reset' }
    | { readonly state: 'removed' }
    // the host drafts it again after the person's answers
    | {
        readonly state: 'loading'
        readonly why: 'answered'
        readonly draft?: DirectionWords
        readonly answered: NonEmpty<AnsweredView>
      }
    // the host drafts it again from the person's words (a Revise)
    | {
        readonly state: 'loading'
        readonly why: 'revise'
        readonly words: Text
        readonly checkerChanged?: true
        readonly draft: DirectionWords
        readonly answered: ReadonlyArray<AnsweredView>
      }
    | {
        readonly state: 'question'
        readonly draft?: DirectionWords
        readonly open: NonEmpty<QuestionView>
      }
    | { readonly state: 'ready' | 'accepted' | 'current'; readonly draft: DirectionWords }
  )
interface CardHead {
  readonly revision?: Text
  readonly principles?: ReadonlyArray<Text>
  readonly id: Text
  readonly name: Text // before its first draft: the person's principle, or the company folder
  readonly origin: Text // where it comes from, in one line
  readonly principle: Text | null // the words of the person who added it (ruling 5)
  readonly example: Text | null
}
// The words of a draft or of a version, all present together. The summary shows before the words;
// diff: the words against the last draft, or the version against the one before it (Nanda,
// 2026-11-15): with none before, every line comes.
export interface DirectionWords {
  readonly summary: Text
  readonly flow: ReadonlyArray<FlowStepView> // none: no diagram
  readonly says: Text
  readonly standards: DirectionView['standards'] // each rule names the role that checks it
  readonly diff: DraftChange
  readonly discovery?: import('./onboarding.ts').Discovery
}
// One step of the flow of a direction (Nanda, 2026-11-15): an actor acts on another actor or on a
// file (from equal to to: an act on its own). place: where the project defines the step, with the
// line when it has one; null: it names none. uses: the ids that apply at a step that the direction
// governs (the page marks it); none: an unmarked step. The cases live on the rules (pass 3b).
export interface FlowStepView {
  readonly from: Text
  readonly to: Text
  readonly says: Text
  readonly place: { readonly file: Text; readonly line: PositiveInt | null } | null
  readonly uses: ReadonlyArray<Text>
}
// An example (ruling 4; Nanda, 2026-11-15): an output that follows or breaks a rule (fit), with
// the input of a step that checks or decides. It sits on its rule (pass 3b). A stale spot asks for
// other examples.
export interface ExampleView {
  readonly fit: 'Follows' | 'Breaks'
  readonly input: SampleView | null
  readonly output: SampleView
}
// A real place of the project, or the host's own words when the project has none.
export type SampleView = SpotView | { readonly written: Text }
// One real place of an example. current: its excerpt is in its file now. around: the real code, so the
// person sees the place (Nanda, 2026-11-15): 3 lines above and 3 below the lines of the excerpt
// (or its line, when the excerpt is gone), the lines of the excerpt marked; none when the file
// does not read.
export interface SpotView {
  readonly file: Text
  readonly line: PositiveInt
  readonly excerpt: Text
  readonly current: boolean
  readonly around: ReadonlyArray<CaseLine>
}
export interface CaseLine {
  readonly line: number
  readonly text: Text
  readonly mark: boolean
}
// A question of the AI about a draft (ruling 5): an example, and the options A and B.
export interface QuestionView {
  readonly rule?: Text
  readonly sides?: readonly [
    { readonly source: Text; readonly words: Text },
    { readonly source: Text; readonly words: Text },
  ]
  readonly says: Text
  readonly example?: ExampleView
  readonly caseSides?: ReadonlyArray<NonNullable<QuestionView['sides']>>
  readonly options: readonly [Text, Text]
}
export interface AnsweredView extends QuestionView {
  readonly answer: typeof import('./onboarding.ts').OnboardingChoice.Type
}
// One card of the agents page (ruling 11); its window shows the rest. An agent role runs on its
// model and has its persistence; a program runs in the CLI and has neither.
interface RoleCardBase {
  readonly revision?: Text
  readonly builtIn?: 'host' | 'pipeline'
  readonly principles?: ReadonlyArray<Text>
  readonly directions?: ReadonlyArray<Text>
  readonly questions?: ReadonlyArray<{ readonly says: Text; readonly choices: ReadonlyArray<Text> }>
  readonly role: Text
  readonly icon: Text // a name of ROLE_ICONS (adapters/web/vendor/role-icons.js draws it)
  readonly summary: Text // the line of the card; after the store, its description
  readonly description: Text
  readonly found: Text | null // where the project has the role
  readonly state: 'waiting' | 'accepted' | 'current' // current: a role of the store
  readonly request: Text | null // the words of a Revise that wait for the host
}
export type RoleCard = RoleCardBase &
  (
    | {
        readonly _tag: 'Agent'
        readonly model: Text // the role's model, an entry of the models table
        readonly launch: Text | null // models.<model>.launch of the settings, read only
        readonly persistence: { readonly persistent: boolean; readonly why: Text }
        // false: the role of the top task (the only persistent role that splits), or a role of
        // the store (the gear changes it by an adjustment)
        readonly toggle: boolean
      }
    | { readonly _tag: 'Program' }
  )
