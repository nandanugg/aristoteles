// The views of the page (BUILD.md 3.8), built from Derived: the dir with its projects, the canvas
// of a project, the panel of a task, the diff of a file. The JSON is the view data of ui-model.ts
// part 4 (the keys and words of the old page). A view reads the states of Derived and waitingFor,
// never a state field of a record; the decisions are the items that SURFACES shows on the page.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  attemptOf,
  blockersOf,
  spotCurrent,
  type Derived,
  isEndedTask,
  adjustmentDraftAt,
  roleWordsDraftAt,
  onPage,
  type PersonKind,
  SURFACES,
  tierOfAssignment,
  waitingFor,
  type WaitingItem,
  type WaitingWho,
} from '../../core/derived/index.ts'
import {
  assignmentAt,
  currentOf,
  currentTask,
  decidesResults,
  decidingNow,
  decisionWaitsFor,
  directionAt,
  directionIdsOf,
  isAssignment,
  isDo,
  itemsOf,
  maxOf,
  openedTopOf,
  parentOf,
  partsOf,
  resultsOf,
  ruleAt,
  rulesOfStandard,
  runOfTree,
  standardAt,
  taskAt,
  untouchedOf,
  versionAt,
  type Item,
} from '../../core/derived/reads.ts'
import {
  type Assignment,
  type AssignmentId,
  type By,
  type CanvasRow,
  type Decision,
  type Direction,
  type DirectionCard,
  type DirectionView,
  type DirView,
  type DraftChange,
  type Example,
  isMarked,
  type ExampleView,
  type FlowStep,
  type FlowStepView,
  isSpot,
  type AiQuestion,
  type AnsweredQuestion,
  draftIn,
  onlyLead,
  type OnboardingDirection,
  type OnboardingView,
  type Owner,
  type ProjectSummary,
  type ProjectView,
  type ResultId,
  type Result,
  type Revision,
  type ReviewCard,
  type RoleCard,
  type RoleFile,
  type RunId,
  type RunState,
  type SessionId,
  type Supervised,
  type Settings,
  type Spot,
  type SpotView,
  type Standard,
  type StandardFile,
  type Task,
  type TaskCard,
  type TaskId,
  type TaskPanel,
  type CardTerminal,
  type TerminalSeen,
  type Version,
  type VersionId,
  type Work,
  type WorkCard,
  replacesOf,
  versionIdOf,
  whereRecord,
  whoOf,
} from '../../core/schema/index.ts'
import { startStateOf } from '../../core/actions/index.ts'
import { type OnboardingFiles, pathOf } from '../../core/services/index.ts'
import { an } from '../words/common.ts'
import {
  adjustmentWords,
  describeInner,
  drafterWords,
  logLine,
  startFixWords,
  roleWordsChange,
  touchedIds,
} from '../words/index.ts'
import type { TerminalStatus } from './frozen.ts'
import { foldTerminals } from '../../core/effects/terminals.ts'
import { actsOf, examplesWait, stepCardOf } from './cards.ts'
import { canAct } from '../../core/derived/can.ts'
import { idOf } from '../../core/derived/waiting.ts'

// What a view reads besides Derived: the dir, the settings now, the status of each terminal
// (empty without tmux), and the person of the page (git user.name).
export interface ViewContext {
  readonly dir: string
  readonly settings: Settings
  readonly terminals: Readonly<Record<string, TerminalStatus>>
  readonly person: string
}

type TierName = 'sol' | 'terra' | 'luna' | 'program'

// --- what a view reads from outside the Work: files and git of the dir ----------------------

const readText = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const git = (cwd: string, ...args: string[]): string => {
  const r = Bun.spawnSync([pathOf('git'), '-C', cwd, ...args])
  return r.exitCode === 0 ? r.stdout.toString() : ''
}
// The git diff of two texts under the name of a file.
const textDiff = (file: string, before: string, after: string): string => {
  if (before === after) return ''
  const tmp = mkdtempSync(join(tmpdir(), 'aristoteles-diff-'))
  try {
    writeFileSync(join(tmp, 'a'), before)
    writeFileSync(join(tmp, 'b'), after)
    const diff = [pathOf('git'), 'diff', '--no-index', '--no-color', 'a', 'b']
    const r = Bun.spawnSync(diff, { cwd: tmp })
    return r.stdout.toString().replaceAll('a/a', `a/${file}`).replaceAll('b/b', `b/${file}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// --- small reads ----------------------------------------------------------------------------

const byName = (by: By): string => (isAssignment(by) ? by : by.name)
const workOf = (d: Derived): Work => d.moment.work
const TIER_WORD = { high: 'sol', medium: 'terra', low: 'luna' } as const
// The tier that the assignment kept at its give (core/derived tierOfAssignment); none: a program.
const tierWord = (w: Work, a: Assignment): TierName => {
  const tier = tierOfAssignment(w, a)
  return tier === null ? 'program' : TIER_WORD[tier]
}
// Where an assignment runs (ruling 7): the host and a persistent agent run in a terminal of their
// own; a persistent role on a task that no run holds (NoRun) has none, as no terminal starts
// there. A subagent runs inside the terminal above it, a program in the CLI.
const isPersistent = (a: Assignment): boolean =>
  a.runs._tag === 'Host' || a.runs._tag === 'Agent' || a.runs._tag === 'NoRun'
// Its terminal: the host's pane, or the one terminal of its persistent agent (ruling 9), which
// the supervisor starts after the give.
const terminalOf = (w: Work, a: Assignment) => {
  switch (a.runs._tag) {
    case 'Host':
      return { agent: null, session: w.runs.get(a.runs.run)?.session ?? null }
    case 'Agent': {
      const terminal = w.agents.get(a.runs.agent)?.terminal
      const session = terminal?._tag === 'Started' ? terminal.session : null
      return { agent: a.runs.agent, session }
    }
    default:
      return { agent: null, session: null }
  }
}
const assignmentsOn = (w: Work, task: TaskId): ReadonlyArray<Assignment> =>
  [...w.assignments.values()].filter((a) => a.task === task)
const ended = (d: Derived, a: AssignmentId): boolean =>
  d.states.assignments.get(a)?._tag === 'Ended'
// A maker that may still make a result of its own: it has tries left, and its task is open.
const tryingMaker = (d: Derived, a: AssignmentId): boolean => {
  const state = d.states.assignments.get(a)
  return state?._tag === 'Working' && state.tries._tag === 'Makes'
}
const taskOpen = (d: Derived, t: TaskId): boolean => {
  const state = d.states.tasks.get(t)
  return state !== undefined && !isEndedTask(state)
}
const taskIsAccepted = (d: Derived, t: TaskId): boolean =>
  d.states.tasks.get(t)?._tag === 'Accepted'
const runIsOpen = (d: Derived, run: RunId): boolean => {
  const tag = d.states.runs.get(run)?._tag
  return tag !== undefined && tag !== 'Done' && tag !== 'Closed'
}
const ruleIdOf = (w: Work, entry: string | null | undefined): string | null =>
  entry === null || entry === undefined ? null : ruleAt(w, entry as never).id
// The terminals as the store says, folded once for each Work.
const folded = new WeakMap<Work, ReadonlyMap<SessionId, Supervised>>()
const storedOf = (w: Work) => {
  const known = folded.get(w)
  if (known !== undefined) return known
  const fresh = foldTerminals(new Map(), w, w.events)
  folded.set(w, fresh)
  return fresh
}
// A terminal as the page shows it: the pump's reading, else a stop or a close of the store, else
// no reading yet.
const seenOf = (ctx: ViewContext, w: Work, session: SessionId): TerminalSeen => {
  const reading = ctx.terminals[session]
  if (reading !== undefined) return { _tag: reading._tag, session }
  const state = storedOf(w).get(session)?.state._tag
  const closed = state === 'Stopped' || state === 'Closed'
  return { _tag: closed ? 'Closed' : 'Unknown', session }
}
const cardTerminal = (ctx: ViewContext, w: Work, session: SessionId | null): CardTerminal =>
  session === null ? { _tag: 'None' } : seenOf(ctx, w, session)
const stateWord = (state: RunState): ProjectSummary['state'] => {
  switch (state._tag) {
    case 'Talking':
      return 'talks'
    case 'Working':
      return 'works'
    case 'AwaitingEndAccept':
      return 'ends'
    case 'Done':
      return 'done'
    case 'Closed':
      return 'closed'
  }
}
// The tasks of a tree, the task first.
const treeOf = (w: Work, task: TaskId): ReadonlyArray<TaskId> => [
  task,
  ...partsOf(w, task).flatMap((p) => treeOf(w, p.id)),
]

// A result that is neither in review nor accepted: rejected, or replaced after its Reject.
const rejected = (d: Derived, id: ResultId): boolean => {
  const tag = d.states.results.get(id)?._tag
  return tag !== 'Accepted' && tag !== 'InReview'
}

// What a task does now, in the words of its card (Nanda, 2026-11-11: "the task card only says
// what it's currently doing right now"). The attempt is that of its latest maker (S4).
const taskWords = (d: Derived, task: TaskId): string => {
  const w = workOf(d)
  const state = d.states.tasks.get(task)
  if (state === undefined) throw new Error(`the work has no task ${task}`)
  if (state._tag === 'Replaced') return `replaced by ${state.next}`
  if (state._tag === 'Closed') return 'closed'
  if (state._tag === 'Accepted') return 'accepted'
  if (state._tag === 'WaitsForEvaluation') return 'waits for an evaluation'
  const mine = assignmentsOn(w, task)
  const open = mine.filter((a) => !ended(d, a.id))
  const maker = mine.findLast((a) => isDo(w, a.role))
  const working = maker !== undefined && tryingMaker(d, maker.id)
  let attempt = ''
  if (maker) {
    const n = attemptOf(d.moment, maker.id)
    attempt = `attempt ${n.number}${n.max._tag === 'AtMost' ? ` of ${n.max.max}` : ''}`
  }
  const needs = taskAt(w, task).needs.filter((n) => !taskIsAccepted(d, n))
  const waitsFor = `waits for ${needs.join(', ')}`
  const result = resultsOf(w, task).at(-1)
  if (!result) {
    if (needs.length) return waitsFor
    if (working) return `works (${attempt})`
    if (open.length) return 'splits'
    return 'waits for an assign'
  }
  const items = blockersOf(d.moment, result.id)
  if (items.some((i) => i._tag === 'Reject' || i._tag === 'Maker')) {
    return working ? `works (${attempt})` : 'stopped'
  }
  const decider = (i: (typeof items)[number]) =>
    i._tag === 'DeciderWaits' ||
    i._tag === 'DeciderAnyApprover' ||
    i._tag === 'DeciderAcceptedUnderOld'
  if (items.length && items.every(decider)) return 'waits for its decider'
  if (needs.length) return waitsFor
  return 'in review'
}

// The lines of two texts as a diff (' ', '-', '+'), by the longest common subsequence.
export const lineDiff = (before: string, after: string): ReadonlyArray<string> => {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  const same = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  const at = (i: number, j: number) => same[i]?.[j] ?? 0
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = same[i] as number[]
      row[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const lines: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push(` ${a[i++]}`)
      j++
    } else if (i < a.length && (j === b.length || at(i + 1, j) >= at(i, j + 1))) {
      lines.push(`-${a[i++]}`)
    } else lines.push(`+${b[j++]}`)
  }
  return lines
}

// --- the decisions that reach the person ----------------------------------------------------

const baseVersion = (w: Work, id: VersionId): Version<Direction> => {
  const at = id.lastIndexOf('@')
  return versionAt(w, id.slice(0, at) as never, Number(id.slice(at + 1)))
}

// What a draft changes in its direction, for the person (Nanda, 2026-11-11: it reads as a code
// review, under the title of the direction, and the whole direction is there to unfold). One diff
// of the whole text: what the direction says, then each standard with its checks as "Check:"
// lines. A new direction has no base, so each of its lines comes.
const draftChange = (w: Work, x: Revision<Direction>): DraftChange => {
  const standardText = (s: Standard) =>
    [
      ...(s.where._tag === 'Where'
        ? [
            `(only where ${Object.entries(whereRecord(s.where) ?? {})
              .map(([k, v]) => `${k} is ${[v].flat().join(' or ')}`)
              .join(' and ')})`,
          ]
        : []),
      s.says.trimEnd(),
      ...rulesOfStandard(w, s).map((r) => `Check: ${r.says.trimEnd()}`),
    ].join('\n')
  const textOf = (v: Pick<Version<Direction>, 'says' | 'standards'>) =>
    [v.says.trimEnd(), ...v.standards.map((e) => standardText(standardAt(w, e)))].join('\n\n')
  const base = x._tag === 'Change' ? baseVersion(w, x.base) : undefined
  return {
    direction: directionAt(w, x.of).name,
    lines: lineDiff(base ? textOf(base) : '', textOf(x)),
  }
}

type Of<K extends WaitingItem['_tag']> = Extract<WaitingItem, { readonly _tag: K }>
type Base = Pick<Decision, 'task' | 'at' | 'acts' | 'waits'>
// The card of each kind that the person may move (P1): the mapped type asks for one of each
// PersonKind, of the decision kind that SURFACES names for it. Each has its fixed sentence; the
// host's words come from the Work (the latest counts).
type Card<K extends PersonKind> = (
  d: Derived,
  item: Of<K>,
  base: Base,
) => Extract<Decision, { readonly _tag: (typeof SURFACES)[K]['page'] }> | undefined
const step = <K extends PersonKind>(d: Derived, item: Of<K>, base: Base) =>
  stepCardOf(d, item as never, { id: idOf(item), words: null, ...base })
const CARDS: { readonly [K in PersonKind]: Card<K> } = {
  Problem: (d, item, base) => {
    const w = workOf(d)
    const p = w.problems.get(item.problem)
    if (p === undefined) return undefined
    // The host told its own problem, so its text is its words.
    const own = p.recordedBy._tag === 'Host' ? p.says : null
    const words = w.hostWords.get(item.problem)?.text ?? own
    const { says: text, stopped } = p
    return { _tag: 'System', id: p.id, text, stopped, words, ...base }
  },
  DraftForPerson: (d, item, base) => {
    const w = workOf(d)
    const x = w.drafts.get(item.draft)
    if (x === undefined) return undefined
    const words = w.hostWords.get(x.id)
    // D2: an Accept that canAct refuses is no act; the card says what the draft waits for.
    const name = item.for._tag === 'Person' ? item.for.name : ''
    const of = { _tag: 'Revision', id: x.id } as const
    const accept = canAct(d, { _tag: 'Person', name, channel: 'ui' }, {
      _tag: 'Accept',
      target: { of },
    })
    const missing = x._tag === 'New' && !x.flow.some(isMarked)
    const waits = accept._tag === 'May' ? null : missing ? examplesWait(d) : accept.refusal.message
    return {
      _tag: 'Direction',
      id: x.id,
      text: `A change to the direction "${directionAt(w, x.of).name}" waits for your decision.`,
      direction: x.of,
      change: draftChange(w, x),
      why: x.why,
      hope: words?._tag === 'DraftWords' ? words.hope : null,
      words: words?.text ?? null,
      ...base,
      waits,
    }
  },
  Forward: (d, item, base) => {
    const w = workOf(d)
    const logged = w.events.find((l) => `e${l.recorded.seq}` === item.forward)
    const stored = logged?.recorded.event
    const forward = w.forwards.get(item.forward)
    if (logged === undefined || stored?._tag !== 'Forward') return undefined
    if (!('create' in stored)) return undefined
    if (forward?._tag !== 'Confirmable') return undefined
    return {
      _tag: 'Confirm',
      id: item.forward,
      text:
        `${whoOf(logged.recorded.author).who} relayed your words as this act: ` +
        `${describeInner(forward.inner, w)}. It counts when you confirm it.`,
      quote: stored.create.quote,
      words: null,
      ...base,
    }
  },
  RunEnd: (d, item, base) => {
    const w = workOf(d)
    return {
      _tag: 'End',
      id: item.run,
      top: item.top,
      text:
        `The agent that leads "${taskAt(w, item.top).name}" accepted its result. ` +
        'Accept the end of the project, or reject the result with your reason.',
      words: w.hostWords.get(item.run)?.text ?? null,
      ...base,
    }
  },
  // New words of a role (ruling 2026-11-14): no host writes words about them.
  RoleWords: (d, item, base) => {
    const x = roleWordsDraftAt(workOf(d), item.draft)
    if (x === undefined) return undefined
    return {
      _tag: 'RoleWords',
      id: item.draft,
      text:
        `New words of the role "${x.role}", drafted by ${drafterWords(x.by)}, ` +
        'wait for your decision.',
      role: x.role,
      lines: roleWordsChange(workOf(d), x),
      words: null,
      ...base,
    }
  },
  // A drafted adjustment (ruling 14): no host writes words about it.
  Adjustment: (d, item, base) => {
    const x = adjustmentDraftAt(workOf(d), item.draft)
    if (x === undefined) return undefined
    return {
      _tag: 'Adjustment',
      id: item.draft,
      text:
        `An adjustment, drafted by ${drafterWords(x.by)}, waits for your decision: ` +
        `${adjustmentWords(x.adjustment)}.`,
      adjustment: x.adjustment,
      words: null,
      ...base,
    }
  },
  // A question to the person counts at once: no host holds it, and the asker's words are it.
  Question: (d, item, base) => {
    const w = workOf(d)
    const q = w.questions.get(item.question)
    if (q === undefined) return undefined
    const asker =
      typeof q.from === 'string' ? `${assignmentAt(w, q.from).role} (${q.from})` : q.from.name
    const { id, text, options } = q
    return { _tag: 'Question', id, text, asker, options, words: null, ...base }
  },
  // D1: an evaluation at the level of a direction or a principle counts after the owner's accept.
  EvaluationForOwner: (d, item, base) => {
    const e = workOf(d).evaluations.get(item.evaluation)
    if (e === undefined) return undefined
    const { id, level, wrong, why, improve } = e
    return {
      _tag: 'Evaluation',
      id,
      text: `${id} says what went wrong, and that ${an(level)} changes. It counts when you accept it.`,
      ...{ level, wrong, why, improve },
      words: null,
      ...base,
    }
  },
  Escalation: step,
  DraftForRole: step,
  DraftVetoed: step,
  RoleWordsRejected: step,
  AdjustmentRejected: step,
  ChangePoint: step,
  Stop: step,
  Suggestion: step,
  DecideResult: step,
  IdleTask: step,
  BriefOver: step,
}
// A decision, and whether it shows now: one that waits for its host's words is held, and only
// the shown ones go to the page.
export interface Placed {
  readonly decision: Decision
  readonly shown: boolean
}
const placedOf = (d: Derived, item: WaitingItem): Placed | undefined => {
  if (SURFACES[item._tag].mover !== 'Person') return undefined
  const base: Base = {
    task: item.placement._tag === 'OnTask' ? item.placement.task : null,
    at: item.at,
    acts: actsOf(d, item),
    waits: null,
  }
  const card = CARDS[item._tag as PersonKind] as Card<PersonKind>
  const decision = card(d, item as Of<PersonKind>, base)
  const shown = !('hold' in item) || item.hold._tag === 'Shown'
  return decision === undefined ? undefined : { decision, shown }
}

// The items that reach the person on the page: every item of waitingFor that the person may
// move, each one also while it waits for the host's words (shownOn keeps the shown ones).
export const decisionsOf = (d: Derived, person: string): ReadonlyArray<Placed> => {
  // B7, ruling 10.8: the person of git user.name sees only their own items, with no fallback: a
  // name that is no person of this work (none set, or a machine's global name) sees none.
  const who: WaitingWho = { _tag: 'Person', name: person }
  return waitingFor(d, who)
    .filter(onPage)
    .flatMap((item) => placedOf(d, item) ?? [])
}
// Where a decision shows (P1, F3): an item of a task, on the panel of its task while that task is
// open; an item of no task, in the inbox of the dir and on each open top task; an item of a task
// that ended, in the inbox. A shown one with an act needs the person.
const onOpenTask = (d: Derived, i: Decision): boolean => i.task !== null && taskOpen(d, i.task)
const needsYou = (p: Placed): boolean => p.shown && p.decision.acts.length > 0
const itemsOn = (d: Derived, items: ReadonlyArray<Placed>, task: Task) => {
  const top = task.serves._tag === 'TopTask' && taskOpen(d, task.id)
  return items.filter(({ decision: i }) =>
    i.task === null ? top : onOpenTask(d, i) && i.task === task.id,
  )
}
const shownOn = (d: Derived, items: ReadonlyArray<Placed>, task: Task) =>
  itemsOn(d, items, task).flatMap((p) => (p.shown ? [p.decision] : []))
export const inboxOf = (d: Derived, person: string): ReadonlyArray<Decision> =>
  decisionsOf(d, person).flatMap((p) => (p.shown && !onOpenTask(d, p.decision) ? [p.decision] : []))

// --- the projects of the dir ----------------------------------------------------------------

// The projects of a dir: each run (a session of the host model), and each top task that no run
// holds (a task opened at a terminal). The newest first.
type Bare<K> = Omit<Extract<ProjectSummary, { readonly kind: K }>, 'badge'>
export const projectsOf = (d: Derived, ctx: ViewContext): ReadonlyArray<ProjectSummary> => {
  const w = workOf(d)
  const runs = [...w.runs.values()].map((run): Bare<'host'> => {
    const opened = openedTopOf(w, run.id)
    const top = opened === undefined ? null : currentTask(w, opened)
    const state = d.states.runs.get(run.id)
    return {
      id: run.id,
      kind: 'host',
      at: run.startedAt,
      session: run.session,
      state: state === undefined ? 'talks' : stateWord(state),
      title: top ? taskAt(w, top).name : 'a new project',
      top,
    }
  })
  const tasks = [...w.tasks.values()]
    .filter(
      (t) =>
        t.serves._tag === 'TopTask' &&
        replacesOf(w, t.id) === null &&
        runOfTree(w, t.id) === undefined,
    )
    .map((t): Bare<'task'> => {
      const now = currentTask(w, t.id)
      const state = d.states.tasks.get(now)?._tag
      return {
        id: t.id,
        kind: 'task',
        at: t.when,
        state: state === 'Closed' ? 'closed' : state === 'Accepted' ? 'done' : 'works',
        title: taskAt(w, now).name,
        top: now,
      }
    })
  // A project has a badge when an item that its open tasks show needs the person.
  const needs = decisionsOf(d, ctx.person).filter(needsYou)
  return [...runs, ...tasks]
    .map((p) => {
      const ids = new Set<string>(p.top ? treeOf(w, p.top) : [])
      const open = p.top !== null && taskOpen(d, p.top)
      const shows = ({ decision: i }: Placed) =>
        i.task === null ? open : onOpenTask(d, i) && ids.has(i.task)
      return { ...p, badge: needs.some(shows) }
    })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

// --- the canvas -----------------------------------------------------------------------------

// The nearest assignment above that runs in a terminal of its own.
const persistentParentOf = (w: Work, a: AssignmentId): Assignment | undefined => {
  let parent = parentOf(w, a)
  while (parent && !isPersistent(assignmentAt(w, parent))) parent = parentOf(w, parent)
  return parent ? assignmentAt(w, parent) : undefined
}

// The terminal that owns a task: its open assignment of the host or of a persistent agent. When
// every lead finished, the host of an open run owns it, because the host acts on the person's
// end decision. A task that only a subagent does runs inside the terminal that assigned it
// (Nanda, 2026-11-11). Only live work can be resumed: the terminal of an agent while its project
// goes on (ruling 9), an open assignment that no run holds; the UI never restarts a host: the
// person triggers it again (Nanda, 2026-11-13).
const ownerOf = (d: Derived, task: TaskId, ctx: ViewContext): Owner | null => {
  const w = workOf(d)
  const mine = assignmentsOn(w, task)
  const leads = mine.filter(isPersistent)
  const hostOfOpenRun = (a: Assignment) => a.runs._tag === 'Host' && runIsOpen(d, a.runs.run)
  const lead =
    leads.findLast((a) => !ended(d, a.id)) ?? leads.findLast(hostOfOpenRun) ?? leads.at(-1)
  if (lead) {
    const runs = lead.runs
    const { agent, session } = terminalOf(w, lead)
    return {
      a: lead.id,
      role: lead.role,
      tier: tierWord(w, lead),
      agent,
      terminal: cardTerminal(ctx, w, session),
      inside: null,
      resumable:
        runs._tag === 'Agent'
          ? d.states.agents.get(runs.agent)?._tag !== 'Ended'
          : runs._tag === 'NoRun' && !ended(d, lead.id),
    }
  }
  const maker = mine.at(-1)
  if (!maker) return null
  const parent = persistentParentOf(w, maker.id)
  return {
    a: maker.id,
    role: maker.role,
    tier: tierWord(w, maker),
    agent: null,
    terminal: cardTerminal(ctx, w, parent ? terminalOf(w, parent).session : null),
    inside: parent?.id ?? null,
    resumable: false,
  }
}

// The attempt of a maker: one count (S4), and the card of a role that makes nothing has none.
const attemptCard = (d: Derived, m: Assignment) => {
  const n = attemptOf(d.moment, m.id)
  return { now: n.number, max: m._tag === 'Maker' ? (maxOf(n.max) ?? null) : null }
}

// The reviews of one result that run now (Nanda, 2026-11-11): a review that still stops it (an
// escalation with no answer, a Reject), a Luna checker that has not reviewed it yet, and a DECIDE
// card for a decider whose accept it still waits for. A done accept goes; the panel keeps it.
const reviewCards = (d: Derived, result: Result): ReadonlyArray<ReviewCard> => {
  const w = workOf(d)
  const items = itemsOf(w, result.id)
  const blockers = blockersOf(d.moment, result.id)
  const stops = new Set<string>(blockers.flatMap((b) => ('ref' in b ? [b.ref] : [])))
  const lineOf = (v: Item): string => {
    if (v.decision === 'Reject') return ruleIdOf(w, v.breaks) ?? v.reason ?? ''
    if (v.decision === 'Escalate') return v.reason ?? ''
    const evidence = v.evidence.map((e) => ruleIdOf(w, e.meets)).filter((r) => r !== null)
    return evidence.join(', ') || v.reason || ''
  }
  const cards: ReviewCard[] = items
    .filter((v) => !v.redo && stops.has(v.id))
    .map((v) => {
      const agent = isAssignment(v.by) ? assignmentAt(w, v.by) : undefined
      return {
        id: v.id,
        by: byName(v.by),
        role: agent ? agent.role : 'person',
        tier: agent ? tierWord(w, agent) : 'person',
        decides: agent ? decidesResults(w, v.by, result.id, v.when) : true,
        decision:
          v.decision === 'Accept' ? 'accept' : v.decision === 'Reject' ? 'reject' : 'escalate',
        line: lineOf(v),
      }
    })
  // A "check again" asks each checker for a new review.
  const since = items.findLastIndex((v) => v.redo)
  const reviewed = (a: Assignment) => items.some((v, i) => i > since && v.by === a.id)
  for (const a of assignmentsOn(w, result.task)) {
    if (ended(d, a.id) || isDo(w, a.role) || tierWord(w, a) !== 'luna') continue
    if (reviewed(a)) continue
    cards.push({
      id: null,
      by: `${a.id} ${a.role}`,
      role: a.role,
      tier: 'luna',
      decides: false,
      decision: 'reviews',
      line: '',
    })
  }
  const waits = blockers.find(
    (b) =>
      b._tag === 'DeciderWaits' ||
      b._tag === 'DeciderAnyApprover' ||
      b._tag === 'DeciderAcceptedUnderOld',
  )
  if (waits) {
    // With no decide entry, any role that approves the maker decides: the card names them.
    const makerRole = assignmentAt(w, result.by).role
    const approvers = [...w.workflow.roles.values()]
      .filter((r) => r.acts.some((a) => a._tag === 'Approve' && a.resultsOf.includes(makerRole)))
      .map((r) => r.role)
    const by =
      waits._tag === 'DeciderWaits'
        ? decisionWaitsFor(w, result.id, decidingNow(w, result.id))
        : waits._tag === 'DeciderAnyApprover'
          ? approvers.length
            ? approvers.join(' or ')
            : 'a role that decides it'
          : `${result.id} was accepted by its decider under an old version; the decider runs ` +
            'work brief (it reads the current version), then accepts it again'
    cards.push({ id: null, by, role: null, tier: null, decides: true, decision: 'waits', line: '' })
  }
  return cards
}

// One work card for each maker of a task that runs now: its latest attempt only, in work or in
// review, with the reviews of its latest result (Nanda, 2026-11-11). An accepted or stopped
// attempt goes.
const workCards = (d: Derived, task: TaskId, ctx: ViewContext): ReadonlyArray<WorkCard> => {
  const w = workOf(d)
  return assignmentsOn(w, task)
    .filter((a) => isDo(w, a.role))
    .flatMap((m): ReadonlyArray<WorkCard> => {
      const made = resultsOf(w, task).filter((r) => r.by === m.id)
      const last = made.at(-1)
      // A rejected result of a maker with tries left: its latest attempt is the next one, in work.
      const next =
        last !== undefined && tryingMaker(d, m.id) && rejected(d, last.id)
      const result = next ? undefined : last
      const parent = persistentParentOf(w, m.id)
      const own = isPersistent(m)
      const session = own ? terminalOf(w, m).session : parent ? terminalOf(w, parent).session : null
      const now: WorkCard['now'] | undefined = result
        ? d.states.results.get(result.id)?._tag === 'InReview'
          ? {
              state: 'in review',
              result: result.id,
              output: result.output,
              files: (w.resultFiles.get(result.id) ?? []).length,
              reviews: reviewCards(d, result),
            }
          : undefined
        : ended(d, m.id)
          ? undefined
          : { state: 'works' }
      if (now === undefined) return []
      const card = { a: m.id, role: m.role, tier: tierWord(w, m), attempt: attemptCard(d, m) }
      const inside = own || !parent ? null : parent.id
      return [{ ...card, terminal: cardTerminal(ctx, w, session), inside, now }]
    })
}

const taskCard = (
  d: Derived,
  task: Task,
  items: ReadonlyArray<Placed>,
  ctx: ViewContext,
): TaskCard => {
  const w = workOf(d)
  const maker = assignmentsOn(w, task.id).findLast((a) => isDo(w, a.role))
  const owner = ownerOf(d, task.id, ctx)
  const limited = maker?._tag === 'Maker' && maxOf(maker.maxAttempts) !== undefined
  return {
    id: task.id,
    name: task.name,
    // The attempt has its own row on the card, so the words leave it out.
    words: taskWords(d, task.id).replace(/ \(attempt [^)]*\)$/, ''),
    attempt: maker && limited ? attemptCard(d, maker) : null,
    owner,
    badge: itemsOn(d, items, task).some(needsYou),
    parent: task.serves._tag === 'Serves' ? task.serves.task : null,
  }
}

// The canvas of a project, in layout A: the task tree goes down, and each task has its work and
// its reviews to its right. The canvas shows only what runs now (Nanda, 2026-11-11): an accepted
// task goes away with its cards, unless an item there waits for the person (also while the host
// writes its words) or a part of it still runs. A closed or replaced task goes away too. The Diff
// of the parent keeps the files of its parts.
export const projectView = (d: Derived, id: string, ctx: ViewContext): ProjectView | undefined => {
  const w = workOf(d)
  const project = projectsOf(d, ctx).find((p) => p.id === id)
  if (!project) return undefined
  const items = decisionsOf(d, ctx.person)
  const walk = (task: Task, depth: number): ReadonlyArray<CanvasRow> => {
    if (!taskOpen(d, task.id)) return []
    const below = partsOf(w, task.id).flatMap((part) => walk(part, depth + 1))
    const card = taskCard(d, task, items, ctx)
    const waits = itemsOn(d, items, task).length > 0
    if (taskIsAccepted(d, task.id) && !waits && !below.length) return []
    return [{ depth, task: card, work: workCards(d, task.id, ctx) }, ...below]
  }
  const rows = project.top ? walk(taskAt(w, project.top), 0) : []
  // A run that talks: its drafts of the top task, and its terminal.
  const run = w.runs.get(id as RunId)
  const drafts = run
    ? [...w.taskDrafts.values()]
        .filter((x) => x.run === run.id && d.states.taskDrafts.get(x.id)?._tag === 'Waiting')
        .map((x) => ({ id: x.id, name: x.task.name, text: x.task.text, role: x.role, at: x.at }))
    : []
  const terminal = run ? { a: run.id, terminal: seenOf(ctx, w, run.session) } : null
  return { ...project, rows, drafts, terminal }
}

// --- the panel of a task --------------------------------------------------------------------

// The directions of a top task: each one with its version now, its standards and rules, the
// versions made during the project, and the drafts that wait.
// The standards of a version, each rule with the role that checks it.
// A step of the flow of a direction for the page: no place is null, an unmarked step uses and
// shows none (Nanda, 2026-11-15).
const flowStepView =
  (exampleOf: (e: Example) => ExampleView) =>
  (s: FlowStep): FlowStepView => ({
    from: s.from,
    to: s.to,
    says: s.says,
    place: s.place ? { file: s.place.file, line: s.place.line ?? null } : null,
    uses: s.uses ?? [],
    examples: (s.examples ?? []).map(exampleOf),
  })
const standardsOf = (w: Work, v: Version<Direction>): DirectionView['standards'] =>
  v.standards.map((entry) => {
    const s = standardAt(w, entry)
    return {
      id: s.id,
      says: s.says,
      rules: rulesOfStandard(w, s).map((r) => ({
        id: r.id,
        says: r.says,
        checkedBy: r.checkedBy._tag === 'Role' ? r.checkedBy.role : null,
      })),
    }
  })

const directionsView = (d: Derived, task: Task, dir: string): ReadonlyArray<DirectionView> => {
  const w = workOf(d)
  const flowOf = flowStepView(exampleReader(dir))
  const waiting = [...d.states.revisions]
    .filter(([, state]) => state._tag === 'Waiting')
    .flatMap(([id]) => w.drafts.get(id) ?? [])
  return directionIdsOf(w, task.id)
    .map((id) => directionAt(w, id))
    .map((dir) => {
      const v = currentOf(w, dir.id)
      return {
        id: dir.id,
        name: dir.name,
        owner: dir.owner.name,
        version: versionIdOf(v),
        summary: v.summary,
        flow: v.flow.map(flowOf),
        says: v.says,
        standards: standardsOf(w, v),
        changed:
          dir._tag === 'Official'
            ? dir.versions
                .filter((x) => x.when >= task.when && x.number > 1)
                .map((x) => ({ id: versionIdOf(x), at: x.when }))
            : [],
        drafts: waiting
          .filter((x) => x.of === dir.id)
          .map((x) => ({
            id: x.id,
            by: x.origin._tag === 'Written' ? byName(x.origin.by) : 'refresh',
            at: x.when,
          })),
      }
    })
}

// The panel of a task: its words, its reviews with their evidence, the acts in time order, the
// directions (only on the top task), and the list of its files.
export const taskPanel = (d: Derived, id: string, ctx: ViewContext): TaskPanel | undefined => {
  const w = workOf(d)
  const task = w.tasks.get(id as TaskId)
  if (!task) return undefined
  const ids = new Set<string>([task.id])
  for (const a of assignmentsOn(w, task.id)) ids.add(a.id)
  const results = resultsOf(w, task.id)
  for (const r of results) {
    ids.add(r.id)
    for (const v of itemsOf(w, r.id)) ids.add(v.id)
  }
  const resultViews = results.map((r) => ({
    id: r.id,
    by: byName(r.by),
    output: r.output,
    at: r.when,
    reviews: itemsOf(w, r.id).map((v) => ({
      id: v.id,
      by: byName(v.by),
      // The engine reads a resolve as an accept of its result; the page names it.
      decision: v.resolves ? ('Resolve' as const) : v.decision,
      reason: v.reason ?? null,
      breaks: ruleIdOf(w, v.breaks),
      at: v.when,
      evidence: v.evidence.map((e) => ({
        rule: ruleIdOf(w, e.meets),
        where: e.at,
        says: e.says,
      })),
    })),
  }))
  // The terminal of the task: its owner's (a subagent's task shows the terminal above it).
  const owner = ownerOf(d, task.id, ctx)
  const terminal =
    owner && owner.terminal._tag !== 'None'
      ? { a: owner.inside ?? owner.agent ?? owner.a, terminal: owner.terminal }
      : null
  return {
    id: task.id,
    name: task.name,
    text: task.descriptionAi.text,
    words: taskWords(d, task.id),
    top: task.serves._tag === 'TopTask' ? { directions: directionsView(d, task, ctx.dir) } : null,
    decisions: shownOn(d, decisionsOf(d, ctx.person), task),
    terminal,
    results: resultViews,
    timeline: w.events
      .filter((l) => touchedIds(l).some((x) => ids.has(x)))
      .map((l) => ({
        at: l.recorded.at,
        who: whoOf(l.recorded.author).who,
        line: logLine(w, l),
      })),
    files: filesOf(d, task.id, ctx),
  }
}

// --- the diff of a task ---------------------------------------------------------------------

interface Piece {
  readonly file: string
  readonly task: TaskId
  readonly a: AssignmentId
  readonly diff: () => string
}
interface InPlacePiece {
  task: TaskId
  a: AssignmentId
  before: string
  beforeAt: string | undefined
  after: string
  afterAt: string
}

// The diff of a task, by file (Nanda, 2026-11-11): a part shows the files that it touched; a
// parent shows every file that its descendants touched, one piece for each file (their sum).
//   a maker of commits: its worktree (live) or its latest commit, against its base;
//   a maker in place: its file at its latest report (or now, while it works), against the text
//   of the file at the first brief of its task (a new file: against nothing).
const piecesOf = (d: Derived, task: TaskId, ctx: ViewContext): ReadonlyArray<Piece> => {
  const w = workOf(d)
  const at = d.moment.at
  const commits: Piece[] = []
  const inPlace = new Map<string, InPlacePiece>()
  for (const t of treeOf(w, task)) {
    const taskT = taskAt(w, t)
    for (const m of assignmentsOn(w, t).filter((a) => isDo(w, a.role))) {
      const results = resultsOf(w, t).filter((r) => r.by === m.id)
      const latest = results.at(-1)
      const commit = latest?.output.match(/^([^#@]+)@([0-9a-f]{7,40})$/) ?? null
      const space = taskT.descriptionAi.workspace.find(
        (x) => x._tag === 'Repo' && (commit ? x.path === commit[1] : true),
      )
      const tree = join(ctx.dir, '.work', 'trees', m.id)
      const outputAt = w.config.roles[m.role]?.output?.includes('@') ?? false
      if (outputAt || commit) {
        if (space?._tag !== 'Repo') continue
        let base = space.base
        for (const x of latest?.madeFrom ?? []) {
          if (x._tag === 'Git' && x.name === space.source) {
            base = x.commit
            break
          }
        }
        const live = existsSync(tree) && !ended(d, m.id)
        if (!live && !commit) continue
        const files = live
          ? git(tree, 'diff', '--name-only', base).split('\n').filter(Boolean)
          : results
              .flatMap((r) => w.resultFiles.get(r.id) ?? [])
              .map((f) => f.slice(space.path.length + 1))
        for (const f of new Set(files)) {
          commits.push({
            file: `${space.path}/${f}`,
            task: t,
            a: m.id,
            diff: () =>
              live
                ? git(tree, 'diff', base, '--', f)
                : git(join(ctx.dir, space.path), 'diff', base, commit?.[2] ?? '', '--', f),
          })
        }
      } else {
        const first = untouchedOf(w, t)
        const seenInPlace = first._tag === 'AtFirstBrief' ? first.inPlace : undefined
        const before: Readonly<Record<string, string>> =
          seenInPlace?._tag === 'InPlace' ? seenInPlace.texts : {}
        const beforeAt = seenInPlace?._tag === 'InPlace' ? seenInPlace.at : ''
        const working =
          !ended(d, m.id) &&
          tryingMaker(d, m.id) &&
          (!latest || rejected(d, latest.id))
        const files = new Set([
          ...results.flatMap((r) => w.resultFiles.get(r.id) ?? []),
          ...Object.keys(before),
        ])
        for (const f of files) {
          const now = working || !latest
          const after = now
            ? readText(join(ctx.dir, f))
            : (w.after.get(latest.id)?.[f] ?? readText(join(ctx.dir, f)))
          const afterAt = now ? at : latest.when
          const had = inPlace.get(f)
          // The parent's piece of a file runs from the first text to the latest text of its tree,
          // in time: the maker of the parent itself can start after its parts (the live demo).
          // A file that no brief saw is new: it starts from nothing.
          const seen = f in before
          if (!had) {
            inPlace.set(f, {
              task: t,
              a: m.id,
              before: seen ? (before[f] ?? '') : '',
              beforeAt: seen ? beforeAt : undefined,
              after,
              afterAt,
            })
          } else {
            if (seen && (had.beforeAt === undefined || beforeAt < had.beforeAt)) {
              Object.assign(had, { before: before[f] ?? '', beforeAt })
            }
            if (afterAt > had.afterAt) Object.assign(had, { after, afterAt })
          }
        }
      }
    }
  }
  const own = [...inPlace].map(
    ([file, x]): Piece => ({
      file,
      task: x.task,
      a: x.a,
      diff: () => textDiff(file, x.before, x.after),
    }),
  )
  return [...commits, ...own]
}

const counts = (diff: string) => {
  let added = 0
  let removed = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added++
    else if (line.startsWith('-') && !line.startsWith('---')) removed++
  }
  return { added, removed }
}

// The diff of one file of a task: the pieces of the makers that touched it, each under the task
// and the maker that made it.
export const fileDiff = (
  d: Derived,
  task: string,
  file: string,
  ctx: ViewContext,
): string | undefined => {
  if (!workOf(d).tasks.has(task as TaskId)) return undefined
  const pieces = piecesOf(d, task as TaskId, ctx).filter((p) => p.file === file)
  return pieces
    .map((p) => {
      const text = p.diff()
      return pieces.length > 1 ? `# ${p.task} · ${p.a}\n${text}` : text
    })
    .join('\n')
}

const filesOf = (d: Derived, task: TaskId, ctx: ViewContext) => {
  const pieces = piecesOf(d, task, ctx)
  return [...new Set(pieces.map((p) => p.file))].sort().map((file) => ({
    file,
    ...counts(fileDiff(d, task, file, ctx) ?? ''),
  }))
}

// --- the onboarding pages and the gear (GET /api/onboarding) --------------------------------

// The lines of a file around a spot (Nanda, 2026-11-15): the lines of its excerpt, at the place
// nearest to the line that the spot names, or that line when the excerpt is not there; and 3
// lines above and below. A long line is cut, so a minified file stays small on the page.
const AROUND = 3
const LINE_CHARS = 240
const aroundOf = (text: string | null, s: Spot): SpotView['around'] => {
  if (text === null) return []
  // A last line end starts no line of its own.
  const lines = text.replace(/\n$/, '').split('\n')
  const first = s.excerpt.trim().split('\n')[0]?.trim() ?? ''
  const holds = lines.flatMap((l, n) => (first && l.includes(first) ? [n] : []))
  const at = holds.sort((a, b) => Math.abs(a + 1 - s.line) - Math.abs(b + 1 - s.line))[0]
  const start = at ?? s.line - 1
  if (start < 0 || start >= lines.length) return []
  const end = at === undefined ? start : start + s.excerpt.trim().split('\n').length - 1
  const from = Math.max(0, start - AROUND)
  const to = Math.min(lines.length - 1, end + AROUND)
  return lines.slice(from, to + 1).map((l, k) => ({
    line: from + k + 1,
    text: l.length > LINE_CHARS ? `${l.slice(0, LINE_CHARS)}…` : l,
    mark: from + k >= start && from + k <= end,
  }))
}

// Each real sample of an example with its state and its code (ruling 4), and the host's words as
// they are: each file is read once a view.
const exampleReader = (dir: string) => {
  const texts = new Map<string, string | null>()
  const textOf = (file: string): string | null => {
    if (!texts.has(file)) {
      try {
        texts.set(file, readFileSync(join(dir, file), 'utf8'))
      } catch {
        texts.set(file, null)
      }
    }
    return texts.get(file) ?? null
  }
  const spotOf = (s: Spot): SpotView => ({
    file: s.file,
    line: s.line,
    excerpt: s.excerpt,
    current: spotCurrent(textOf(s.file), s),
    around: aroundOf(textOf(s.file), s),
  })
  const sampleOf = (s: Example['output']): ExampleView['output'] =>
    isSpot(s) ? spotOf(s) : { written: s.written }
  return (e: Example): ExampleView => ({
    fit: e.fit,
    input: e.input ? sampleOf(e.input) : null,
    output: sampleOf(e.output),
  })
}

// The words of a direction as one text for its diff (Nanda, 2026-11-15): the summary, the words,
// then each standard with each rule and its checker.
type Words = {
  readonly summary: string
  readonly says: string
  readonly standards: DirectionView['standards']
}
const wordsText = (v: Words): string =>
  [
    v.summary,
    v.says.trimEnd(),
    ...v.standards.map((s) =>
      [
        `Standard ${s.id}: ${s.says.trimEnd()}`,
        ...s.rules.map(
          (r) => `  Rule ${r.id} (checked by ${r.checkedBy ?? 'the decider'}): ${r.says.trimEnd()}`,
        ),
      ].join('\n'),
    ),
  ].join('\n\n')
// The words against the ones before them; with none before, every line comes.
const diffOf = (title: string, before: Words | undefined, now: Words): DraftChange => ({
  direction: title,
  lines: lineDiff(before ? wordsText(before) : '', wordsText(now)),
})
const standardsView = (standards: ReadonlyArray<StandardFile>): DirectionView['standards'] =>
  standards.map((st) => ({
    id: st.id,
    says: st.says,
    rules: st.rules.map((r) => ({ id: r.id, says: r.says, checkedBy: r.checkedBy ?? null })),
  }))

const originOf = (asked: OnboardingDirection['asked']): string => {
  switch (asked._tag) {
    case 'Found':
      return 'found in the project by the host'
    case 'New':
      return 'asked for by the person'
    case 'Company':
      return `a company direction: ${asked.path} of ${asked.repo}`
  }
}
// One file of .work/assess, for the directions page: its stage says what the card has.
const onboardingDirectionCard = (
  f: OnboardingDirection,
  exampleOf: (e: Example) => ExampleView,
): DirectionCard => {
  const { asked, stage } = f
  const drafted = draftIn(stage)
  const head = {
    id: f.id,
    name:
      drafted?.name ??
      (asked._tag === 'New' ? asked.principle : asked._tag === 'Company' ? asked.path : f.id),
    origin: originOf(asked),
    principle: asked._tag === 'New' ? asked.principle : null,
    example: asked._tag === 'New' ? asked.example : null,
  }
  const question = (q: AiQuestion) => ({
    says: q.says,
    example: exampleOf(q.example),
    options: q.options,
  })
  const answered = (q: AnsweredQuestion) => ({ ...question(q), answer: q.chosen })
  switch (stage._tag) {
    case 'Drafting':
      return { ...head, state: 'loading', why: 'drafting' }
    case 'Reset':
      return { ...head, state: 'loading', why: 'reset' }
  }
  const words = { ...stage.draft.content, standards: standardsView(stage.draft.content.standards) }
  const last = stage.draft.previous
  const title = last ? 'The last draft → this draft' : 'The first draft: every line is new'
  const draft = {
    ...words,
    flow: words.flow.map(flowStepView(exampleOf)),
    diff: diffOf(title, last && { ...last, standards: standardsView(last.standards) }, words),
  }
  switch (stage._tag) {
    case 'Question': {
      const [first, ...rest] = stage.open
      return { ...head, state: 'question', draft, open: [question(first), ...rest.map(question)] }
    }
    case 'Answered': {
      const [first, ...rest] = stage.answered
      const all = [answered(first), ...rest.map(answered)] as const
      return { ...head, state: 'loading', why: 'answered', draft, answered: all }
    }
    case 'Revising': {
      const { words } = stage
      const all = stage.answered.map(answered)
      return { ...head, state: 'loading', why: 'revise', words, draft, answered: all }
    }
    case 'Ready':
      return { ...head, state: 'ready', draft }
    case 'Accepted':
      return { ...head, state: 'accepted', draft }
  }
}

// The model of a tier: its setting, or the class of the tier (P9, as work assign words it).
const MODEL_CLASS = { sol: 'Opus', terra: 'Sonnet', luna: 'Haiku' } as const
// What every card of a role shows, from its file and the settings of its tier (ruling 10).
const roleCardOf = (settings: Settings, role: string, file: RoleFile) => {
  if (file.kind === 'program') {
    const tier = 'program' as const
    return { role, icon: file.icon, tier, model: null, launch: null, persistence: null }
  }
  const tier = TIER_WORD[file.tier]
  const commands = settings.tiers[tier]
  return {
    role,
    icon: file.icon,
    tier,
    model: commands?.model ?? MODEL_CLASS[tier],
    launch: commands?.launch ?? null,
    persistence: file.persistence,
  }
}

// Before the store: the onboarding files (ruling 1). The role of the top task has no toggle while
// it is the only persistent high role (ruling 15); the roles that the project has come first.
export const onboardingFilesView = (
  files: OnboardingFiles,
  settings: Settings,
  dir: string,
): OnboardingView => {
  const exampleOf = exampleReader(dir)
  const lead = onlyLead(files.config?.roles ?? {})
  const roles = files.roles.map(
    (r): RoleCard => ({
      ...roleCardOf(settings, r.role, r.file),
      summary: r.summary,
      description: r.file.description,
      toggle: r.file.kind === 'agent' && lead !== r.role,
      found: r.found._tag === 'InProject' ? r.found.path : null,
      state: r.decision._tag === 'Accepted' ? 'accepted' : 'waiting',
      request: r.decision._tag === 'Revising' ? r.decision.words : null,
    }),
  )
  return {
    stage: 'files',
    directions: files.directions.map((f) => onboardingDirectionCard(f, exampleOf)),
    roles: [...roles.filter((r) => r.found !== null), ...roles.filter((r) => r.found === null)],
    adjustments: [],
    start: startViewOf(files),
  }
}
// What the agents page says of the store start: the one reader (startStateOf), in the words of
// work onboard status.
const startViewOf = (files: OnboardingFiles): OnboardingView['start'] => {
  const start = startStateOf(files)
  switch (start._tag) {
    case 'Blocked':
      return { state: 'blocked', says: start.refusal.message, fix: startFixWords(start.fix) }
    case 'Open':
      return { state: 'open' }
    default:
      return { state: 'waiting' }
  }
}

// After the store (the gear, ruling 13): the official directions with their examples, the roles of
// the stored config, and the adjustments that wait for the person.
export const onboardingStoreView = (d: Derived, ctx: ViewContext): OnboardingView => {
  const w = workOf(d)
  const exampleOf = exampleReader(ctx.dir)
  const directions = [...w.directions.values()]
    .filter((x) => d.states.directions.get(x.id)?._tag === 'Official')
    .map((x): DirectionCard => {
      const v = currentOf(w, x.id)
      const from = x.source._tag === 'External' ? `, from ${x.source.path} of ${x.source.repo}` : ''
      const standards = standardsOf(w, v)
      const before = x._tag === 'Official' ? x.versions[v.number - 2] : undefined
      const title = before
        ? `${versionIdOf(before)} → ${versionIdOf(v)}`
        : `${versionIdOf(v)}, the first version: every line is new`
      const diff = diffOf(title, before && { ...before, standards: standardsOf(w, before) }, {
        ...v,
        standards,
      })
      return {
        id: x.id,
        name: x.name,
        state: 'current',
        origin: `${versionIdOf(v)}, owner ${x.owner.name}${from}`,
        principle: null,
        example: null,
        draft: {
          summary: v.summary,
          flow: v.flow.map(flowStepView(exampleOf)),
          says: v.says,
          standards,
          diff,
        },
      }
    })
  const roles = Object.entries(w.config.roles).map(
    ([role, file]): RoleCard => ({
      ...roleCardOf(ctx.settings, role, file),
      summary: file.description,
      description: file.description,
      toggle: false,
      found: null,
      state: 'current',
      request: null,
    }),
  )
  const adjustments = decisionsOf(d, ctx.person).flatMap(({ decision: x }) =>
    x._tag === 'Adjustment' ? [x] : [],
  )
  return { stage: 'store', directions, roles, adjustments, start: { state: 'started' } }
}

// --- the dir --------------------------------------------------------------------------------

// The dir, for the sidebar. With no Derived the dir has no store, so it has no projects.
// Ruling 10.8: who the page acts as, and the one line for a name that is no person of the dir.
export const personView = (
  people: ReadonlyArray<string>,
  name: string,
): { readonly name: string; readonly known: boolean; readonly line: string | null } => {
  const known = people.includes(name)
  if (known) return { name, known, line: null }
  const now = name === '' ? 'git user.name is not set' : `git user.name is "${name}"`
  const set =
    people.length === 1
      ? `Set it: git config user.name "${people[0]}"`
      : `Set your name, one of ${people.join(', ')}: git config user.name "<your name>"`
  return {
    name,
    known,
    line:
      `The page shows the items of the person that git names; ${now}, and that is no person ` +
      `of this dir. ${set}`,
  }
}

export const dirView = (
  d: Derived | undefined,
  dir: {
    readonly name: string
    readonly path: string
    readonly settings: Settings
    readonly onboarding: boolean
    readonly hasConfig: boolean
    readonly startPrompt: string
  },
  ctx: ViewContext,
): DirView => ({
  name: dir.name,
  path: dir.path,
  theme: dir.settings.theme,
  sound: dir.settings.sound,
  settings: dir.settings,
  hasConfig: dir.hasConfig,
  onboarding: dir.onboarding,
  initialized: d !== undefined,
  startPrompt: dir.startPrompt,
  projects: d ? projectsOf(d, ctx) : [],
  inbox: d ? inboxOf(d, ctx.person) : [],
})
