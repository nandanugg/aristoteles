// The views of the page (PORT of ui/view.js), built from the Work at a time with the reads of the
// engine, never with a second set of rules over the tables: the dir with its projects, the canvas
// of a project, the panel of a task, the diff of a file. The JSON is the view data of
// src/domain/ui-model.ts part 4 (parity: the keys and words of the old view).
// The terminal status (live, ended) is built in from the pump's status, not added afterwards.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { whoOf } from '../domain/actor.ts'
import { whereRecord } from '../domain/context.ts'
import { problemTaskOf, replacesOf, topOfRun } from '../domain/derived.ts'
import type { Settings } from '../domain/files.ts'
import type { AssignmentId, PointId, RunId, TaskId, Time, VersionId } from '../domain/ids.ts'
import { rejectOf, versionId } from '../domain/ids.ts'
import type {
  Assignment,
  Direction,
  Result,
  Revision,
  Standard,
  Task,
  Version,
} from '../domain/model.ts'
import type {
  CanvasRow,
  Decision,
  DirectionView,
  DirView,
  DraftChange,
  Owner,
  ProjectSummary,
  ProjectView,
  ResultView,
  ReviewCard,
  RunState,
  TaskCard,
  TaskPanel,
  WorkCard,
} from '../domain/ui-model.ts'
import type { Work } from '../domain/work.ts'
import {
  accepted,
  blockerItems,
  decidesResults,
  decisionWaitsText,
  directionsOf as directionsOfTask,
  draftWaitsFor,
  isDo,
  madeBy,
  openDo,
  partsOf,
  resultsOf,
  rulesOfStandard,
  taskAccepted,
  vetoOf,
} from '../engine/queries.ts'
import { currentTask, hostOf, runOf } from '../engine/runs.ts'
import {
  assignmentAt,
  currentOf,
  directionAt,
  finished,
  isAssignment,
  type Item,
  itemsOf as reviewItemsOf,
  maxOf,
  parentOf,
  roleAt,
  ruleAt,
  standardAt,
  taskAt,
  versionAt,
} from '../engine/view.ts'
import { runState } from '../replay/runs.ts'
import { taskWords, who } from '../words/common.ts'
import { logLine, touchedIds } from '../words/log.ts'
import type { TerminalStatus } from './pump.ts'

// What a view reads besides the Work: the time of the read, the settings now, the dir, and the
// status of each terminal (empty without tmux).
export interface ViewContext {
  readonly at: Time
  readonly dir: string
  readonly settings: Settings
  readonly terminals: Readonly<Record<string, TerminalStatus>>
}

type TierName = 'sol' | 'terra' | 'luna' | 'program'

// --- what a view reads from outside the Work: files and git of the dir ----------------------

const readText = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const git = (cwd: string, ...args: string[]): string => {
  const r = Bun.spawnSync(['git', '-C', cwd, ...args])
  return r.exitCode === 0 ? r.stdout.toString() : ''
}
// The git diff of two texts under the name of a file.
const textDiff = (file: string, before: string, after: string): string => {
  if (before === after) return ''
  const tmp = mkdtempSync(join(tmpdir(), 'aristoteles-diff-'))
  try {
    writeFileSync(join(tmp, 'a'), before)
    writeFileSync(join(tmp, 'b'), after)
    const r = Bun.spawnSync(['git', 'diff', '--no-index', '--no-color', 'a', 'b'], { cwd: tmp })
    return r.stdout.toString().replaceAll('a/a', `a/${file}`).replaceAll('b/b', `b/${file}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// --- small reads ----------------------------------------------------------------------------

const tierOfAssignment = (work: Work, a: Assignment): TierName => {
  const role = roleAt(work, a.role)
  if (role._tag === 'Program') return 'program'
  return role.tier === 'high' ? 'sol' : role.tier === 'medium' ? 'terra' : 'luna'
}
// Only a Sol or a Terra runs as a real agent in a terminal; a Luna runs inside its parent's.
const isReal = (work: Work, a: Assignment): boolean => {
  const tier = tierOfAssignment(work, a)
  return tier === 'sol' || tier === 'terra'
}
const assignmentsOn = (work: Work, task: TaskId): ReadonlyArray<Assignment> =>
  [...work.assignments.values()].filter((a) => a.task === task)
const sessionOf = (work: Work, a: AssignmentId) => work.sessions.get(a)?.session ?? null
const maxAttemptsOf = (a: Assignment): number | null =>
  a._tag === 'Maker' ? (maxOf(a.maxAttempts) ?? null) : null
const ruleIdOf = (work: Work, entry: string | null | undefined): string | null =>
  entry === null || entry === undefined ? null : ruleAt(work, entry as never).id
// A card that has a session shows whether its terminal runs.
const withLive = <T extends { readonly session: string | null }>(ctx: ViewContext, card: T) => {
  if (!card.session) return card
  const status = ctx.terminals[card.session]
  return { ...card, live: Boolean(status?.live), ended: Boolean(status?.ended) }
}
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
const treeOf = (work: Work, task: TaskId): ReadonlyArray<TaskId> => [
  task,
  ...partsOf(work, task).flatMap((p) => treeOf(work, p.id)),
]

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

const baseVersion = (work: Work, id: VersionId): Version<Direction> => {
  const at = id.lastIndexOf('@')
  return versionAt(work, id.slice(0, at) as never, Number(id.slice(at + 1)))
}

// What a draft changes in its direction, for the person (Nanda, 2026-11-11: it reads as a code
// review, under the title of the direction, and the whole direction is there to unfold). One diff
// of the whole text: what the direction says, then each standard with its checks as "Check:"
// lines. A new direction has no base, so each of its lines comes.
const draftChange = (work: Work, x: Revision<Direction>): DraftChange => {
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
      ...rulesOfStandard(work, s).map((r) => `Check: ${r.says.trimEnd()}`),
    ].join('\n')
  const textOf = (v: Pick<Version<Direction>, 'says' | 'standards'>) =>
    [v.says.trimEnd(), ...v.standards.map((e) => standardText(standardAt(work, e)))].join('\n\n')
  const base = x._tag === 'Change' ? baseVersion(work, x.base) : undefined
  return {
    direction: directionAt(work, x.of).name,
    lines: lineDiff(base ? textOf(base) : '', textOf(x)),
  }
}

// The task that a draft answers: an answer is a Reject (or one of its points) of a result or a
// task, or a suggestion (which has none).
const taskOfAnswer = (work: Work, answer: string): TaskId | undefined => {
  const reject = work.reviews.get(rejectOf(answer as PointId))
  if (reject?._tag !== 'Reject') return undefined
  if (reject.of._tag === 'Result') return work.results.get(reject.of.id)?.task
  return reject.of._tag === 'Task' ? reject.of.id : undefined
}

// A decision before the host's words and its time are known.
type Bare = Decision extends infer D
  ? D extends Decision
    ? Omit<D, 'words' | 'at' | 'shown' | 'hope'>
    : never
  : never

// The items that reach the person (Nanda, 2026-11-11): a system problem, a direction problem (a
// draft of a direction whose next decider is the person), and the end of a project (the Sol
// reviewer accepted its top task). The host reviews each one first: an item shows when the host
// wrote its words, when no host holds its tree, or when the host wrote nothing for
// hostWaitMinutes. An item with no task belongs to the dir: it shows on every top task.
export const decisionsOf = (work: Work, ctx: ViewContext): ReadonlyArray<Decision> => {
  const waitMs = ctx.settings.hostWaitMinutes * 60000
  const items: Decision[] = []
  // raw: the item shows at once, with no wait for the host (the person's UI recorded it).
  const add = (item: Bare, at: Time, tree: TaskId | null, raw = false) => {
    const words = work.hostWords.get(item.id as never)
    const host = tree === null ? undefined : hostOf(work, tree)
    const late = Date.parse(ctx.at) - Date.parse(at) >= waitMs
    const shown = raw || words !== undefined || host === undefined || late
    const common = {
      words: words?.text ?? null,
      at,
      shown: shown
        ? ({ _tag: 'Shown' } as const)
        : ({
            _tag: 'HeldForHost',
            until: new Date(Date.parse(at) + waitMs).toISOString() as Time,
          } as const),
    }
    if (item._tag === 'Direction') {
      const hope = words?._tag === 'DraftWords' ? words.hope : null
      items.push({ ...item, ...common, hope })
    } else items.push({ ...item, ...common })
  }
  // A problem that the UI recorded as the person (the host itself failed) shows at once.
  for (const sp of work.problems.values()) {
    if (sp.fixed._tag === 'Fixed') continue
    const task = problemTaskOf(work, sp)
    add(
      { _tag: 'System', id: sp.id, task, stopped: sp.stopped, text: sp.says },
      sp.at,
      task,
      sp.recordedBy._tag !== 'Host',
    )
  }
  for (const x of work.drafts.values()) {
    if (madeBy(work, x.id) || vetoOf(work, x.id)) continue
    if (!draftWaitsFor(work, x.id).some((leaf) => leaf._tag !== 'Role')) continue
    const task = x.answers.map((a) => taskOfAnswer(work, a)).find((t) => t !== undefined) ?? null
    add(
      {
        _tag: 'Direction',
        id: x.id,
        task,
        direction: x.of,
        text:
          `A change to the direction "${directionAt(work, x.of).name}" waits for your decision.`,
        change: draftChange(work, x),
        why: x.why,
      },
      x.when,
      task,
    )
  }
  for (const run of work.runs.values()) {
    if (runState(work, run, ctx.at)._tag !== 'AwaitingEndAccept') continue
    const opened = topOfRun(work, run.id)
    if (opened === undefined) continue
    const top = currentTask(work, opened)
    // Its time is the time of the accept that ended the project.
    const last = resultsOf(work, top).at(-1)
    const accept = last
      ? reviewItemsOf(work, last.id)
          .filter((v) => v.decision === 'Accept')
          .at(-1)
      : undefined
    add(
      {
        _tag: 'End',
        id: run.id,
        task: top,
        text:
          `The Sol of the top task accepted the result of "${taskAt(work, top).name}". ` +
          'Accept the end of the project, or reject the result with your reason.',
      },
      last ? (accept?.when ?? last.when) : ctx.at,
      top,
    )
  }
  return items
}
// The items on a task: each one, also one that waits for the host's words; shownOn keeps the
// ones that the person sees.
const itemsOn = (items: ReadonlyArray<Decision>, task: Task) => {
  const isTop = task.serves._tag === 'TopTask'
  return items.filter((i) => i.task === task.id || (i.task === null && isTop))
}
const shownOn = (items: ReadonlyArray<Decision>, task: Task) =>
  itemsOn(items, task).filter((i) => i.shown._tag === 'Shown')

// --- the projects of the dir ----------------------------------------------------------------

// The projects of a dir: each run (a session of the host model), and each top task that no run
// holds (a task opened at a terminal). The newest first.
export const projectsOf = (work: Work, ctx: ViewContext): ReadonlyArray<ProjectSummary> => {
  const runs = [...work.runs.values()].map((run): Omit<ProjectSummary, 'badge'> => {
    const opened = topOfRun(work, run.id)
    const top = opened === undefined ? null : currentTask(work, opened)
    return {
      id: run.id,
      kind: 'host',
      at: run.startedAt,
      session: run.session,
      state: stateWord(runState(work, run, ctx.at)),
      title: top ? taskAt(work, top).name : 'a new project',
      top,
    }
  })
  const tasks = [...work.tasks.values()]
    .filter(
      (t) =>
        t.serves._tag === 'TopTask' &&
        replacesOf(work, t.id) === null &&
        runOf(work, t.id) === undefined,
    )
    .map((t): Omit<ProjectSummary, 'badge'> => {
      const now = currentTask(work, t.id)
      const words = taskWords(work, now, ctx.at)
      return {
        id: t.id,
        kind: 'task',
        at: t.when,
        session: null,
        state: words === 'closed' ? 'closed' : words === 'accepted' ? 'done' : 'works',
        title: taskAt(work, now).name,
        top: now,
      }
    })
  // A project has a badge when an item shows on a task of its tree.
  const shown = decisionsOf(work, ctx).filter((i) => i.shown._tag === 'Shown')
  return [...runs, ...tasks]
    .map((p) => {
      const ids = new Set<string>(p.top ? treeOf(work, p.top) : [])
      return { ...p, badge: shown.some((i) => (i.task ? ids.has(i.task) : Boolean(p.top))) }
    })
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
}

// --- the canvas -----------------------------------------------------------------------------

// The terminal that owns a task: its open Sol or Terra assignment. When every lead finished, the
// host of an open run owns it, because the host acts on the person's end decision. A task that
// only a Luna does runs inside the terminal of the real agent that assigned it (Nanda,
// 2026-11-11). Only the terminal of live work can be resumed: finished work has nothing to resume,
// and the UI never restarts a host: the person triggers it again (Nanda, 2026-11-13).
const ownerOf = (work: Work, task: TaskId): Owner | null => {
  const mine = assignmentsOn(work, task)
  const leads = mine.filter((a) => isReal(work, a))
  const inOpenRun = (a: Assignment) =>
    [...work.runs.values()].some(
      (r) => r.end._tag === 'NotEnded' && r.session === sessionOf(work, a.id),
    )
  const lead = leads.findLast((a) => !finished(a)) ?? leads.findLast(inOpenRun) ?? leads.at(-1)
  if (lead) {
    return {
      a: lead.id,
      role: lead.role,
      tier: tierOfAssignment(work, lead),
      session: sessionOf(work, lead.id),
      inside: null,
      resumable: !finished(lead) && !inOpenRun(lead),
    }
  }
  const maker = mine.at(-1)
  if (!maker) return null
  let parent = parentOf(work, maker.id)
  while (parent && !isReal(work, assignmentAt(work, parent))) parent = parentOf(work, parent)
  return {
    a: maker.id,
    role: maker.role,
    tier: tierOfAssignment(work, maker),
    session: parent ? sessionOf(work, parent) : null,
    inside: parent ?? null,
  }
}

// A result is accepted, rejected by a review that is not a recheck, or still in review.
const resultWord = (work: Work, result: Result, at: Time): WorkCard['state'] => {
  if (accepted(work, result.id, at)) return 'accepted'
  if (reviewItemsOf(work, result.id).some((v) => v.decision === 'Reject' && !v.redo)) {
    return 'rejected'
  }
  return 'in review'
}

// The latest attempt of a maker: its results so far, and one more while it works on a new try
// after a Reject.
const latestAttempt = (work: Work, task: TaskId, m: Assignment, at: Time) => {
  const made = resultsOf(work, task).filter((r) => r.by === m.id)
  const last = made.at(-1)
  const next =
    last !== undefined && openDo(work, m.id) && resultWord(work, last, at) === 'rejected'
  return {
    now: next || !made.length ? made.length + 1 : made.length,
    max: maxAttemptsOf(m),
    next,
    made,
  }
}

// The reviews of one result that run now (Nanda, 2026-11-11): a review that still stops it (a
// escalation with no answer, a Reject), a Luna checker that has not reviewed it yet, and a DECIDE card
// for a decider whose accept it still waits for. A done accept goes; the panel keeps it.
const reviewCards = (work: Work, result: Result, at: Time): ReadonlyArray<ReviewCard> => {
  const items = reviewItemsOf(work, result.id)
  const blockers = blockerItems(work, result.id, at)
  const stops = new Set<string>(blockers.flatMap((b) => ('ref' in b ? [b.ref] : [])))
  const lineOf = (v: Item): string => {
    if (v.decision === 'Reject') return ruleIdOf(work, v.breaks) ?? v.reason ?? ''
    if (v.decision === 'Escalate') return v.reason ?? ''
    const evidence = v.evidence.map((e) => ruleIdOf(work, e.meets)).filter((r) => r !== null)
    return evidence.join(', ') || v.reason || ''
  }
  const cards: ReviewCard[] = items
    .filter((v) => !v.redo && stops.has(v.id))
    .map((v) => {
      const agent = isAssignment(v.by) ? assignmentAt(work, v.by) : undefined
      return {
        id: v.id,
        by: who(work, v.by),
        role: agent ? agent.role : 'person',
        tier: agent ? tierOfAssignment(work, agent) : 'person',
        decides: agent ? decidesResults(work, v.by, result.id, v.when) : true,
        decision:
          v.decision === 'Accept' ? 'accept' : v.decision === 'Reject' ? 'reject' : 'escalate',
        line: lineOf(v),
      }
    })
  // A "check again" asks each checker for a new review.
  const since = items.findLastIndex((v) => v.redo)
  const reviewed = (a: Assignment) => items.some((v, i) => i > since && v.by === a.id)
  for (const a of assignmentsOn(work, result.task)) {
    if (finished(a) || isDo(work, a.role) || tierOfAssignment(work, a) !== 'luna') continue
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
    const makerRole = assignmentAt(work, result.by).role
    const approvers = [...work.workflow.roles.values()]
      .filter((r) => r.acts.some((a) => a._tag === 'Approve' && a.resultsOf.includes(makerRole)))
      .map((r) => r.role)
    const by =
      waits._tag === 'DeciderWaits'
        ? decisionWaitsText(work, result.id)
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
const workCards = (work: Work, task: TaskId, ctx: ViewContext): ReadonlyArray<WorkCard> => {
  const cards = assignmentsOn(work, task)
    .filter((a) => isDo(work, a.role))
    .map((m): WorkCard => {
      // A rejected result of a maker with tries left: its latest attempt is the next one, in work.
      const { now, max, next, made } = latestAttempt(work, task, m, ctx.at)
      const result = next ? undefined : made.at(-1)
      let parent = parentOf(work, m.id)
      while (parent && !isReal(work, assignmentAt(work, parent))) parent = parentOf(work, parent)
      const real = isReal(work, m)
      return withLive(ctx, {
        a: m.id,
        role: m.role,
        tier: tierOfAssignment(work, m),
        attempt: { now, max },
        session: real ? sessionOf(work, m.id) : parent ? sessionOf(work, parent) : null,
        inside: real || !parent ? null : parent,
        result: result ? result.id : null,
        output: result?.output ?? null,
        state: result ? resultWord(work, result, ctx.at) : finished(m) ? 'finished' : 'works',
        files: result ? (work.resultFiles.get(result.id) ?? []).length : 0,
        reviews: result ? reviewCards(work, result, ctx.at) : [],
      })
    })
  return cards.filter((w) => w.state === 'works' || w.state === 'in review')
}

const taskCard = (
  work: Work,
  task: Task,
  items: ReadonlyArray<Decision>,
  ctx: ViewContext,
): TaskCard => {
  const maker = assignmentsOn(work, task.id).findLast((a) => isDo(work, a.role))
  const owner = ownerOf(work, task.id)
  const attempt =
    maker && maxAttemptsOf(maker) !== null
      ? (({ now, max }) => ({ now, max }))(latestAttempt(work, task.id, maker, ctx.at))
      : null
  return {
    id: task.id,
    name: task.name,
    // The attempt has its own row on the card, so the words leave it out.
    words: taskWords(work, task.id, ctx.at).replace(/ \(attempt [^)]*\)$/, ''),
    attempt,
    owner: owner ? withLive(ctx, owner) : null,
    badge: shownOn(items, task).length > 0,
    parent: task.serves._tag === 'Serves' ? task.serves.task : null,
  }
}

// The canvas of a project, in layout A: the task tree goes down, and each task has its work and
// its reviews to its right. The canvas shows only what runs now (Nanda, 2026-11-11): an accepted
// task goes away with its cards, unless an item there waits for the person (also while the host
// writes its words) or a part of it still runs. A closed or replaced task goes away too. The Diff
// of the parent keeps the files of its parts.
export const projectView = (work: Work, id: string, ctx: ViewContext): ProjectView | undefined => {
  const project = projectsOf(work, ctx).find((p) => p.id === id)
  if (!project) return undefined
  const items = decisionsOf(work, ctx)
  const walk = (task: Task, depth: number): ReadonlyArray<CanvasRow> => {
    if (task.end._tag !== 'NotEnded') return []
    const below = partsOf(work, task.id).flatMap((part) => walk(part, depth + 1))
    const card = taskCard(work, task, items, ctx)
    const waits = itemsOn(items, task).length > 0
    if (taskAccepted(work, task.id, ctx.at) && !waits && !below.length) return []
    return [{ depth, task: card, work: workCards(work, task.id, ctx) }, ...below]
  }
  const rows = project.top ? walk(taskAt(work, project.top), 0) : []
  // A run that talks: its drafts of the top task, and its terminal.
  const run = work.runs.get(id as RunId)
  const drafts = run
    ? [...work.taskDrafts.values()]
        .filter((x) => x.run === run.id && x.opened._tag === 'NotOpened')
        .map((x) => ({ id: x.id, name: x.task.name, text: x.task.text, role: x.role, at: x.at }))
    : []
  const terminal = run ? withLive(ctx, { session: run.session, a: run.id }) : null
  return { ...project, rows, drafts, terminal }
}

// --- the panel of a task --------------------------------------------------------------------

// The directions of a top task: each one with its version now, its standards and rules, the
// versions made during the project, and the drafts that wait.
const directionsView = (work: Work, task: Task): ReadonlyArray<DirectionView> => {
  const open = (x: Revision<Direction>) => !madeBy(work, x.id) && !vetoOf(work, x.id)
  return directionsOfTask(work, task.id).map((d) => {
    const v = currentOf(work, d.id)
    return {
      id: d.id,
      name: d.name,
      owner: d.owner.name,
      version: versionId(v.of, v.number),
      says: v.says,
      standards: v.standards.map((entry) => {
        const s = standardAt(work, entry)
        return {
          id: s.id,
          says: s.says,
          rules: rulesOfStandard(work, s).map((r) => ({
            id: r.id,
            says: r.says,
            checkedBy: r.checkedBy._tag === 'Role' ? r.checkedBy.role : null,
          })),
        }
      }),
      changed:
        d._tag === 'Official'
          ? d.versions
              .filter((x) => x.when >= task.when && x.number > 1)
              .map((x) => ({ id: versionId(x.of, x.number), at: x.when }))
          : [],
      drafts: [...work.drafts.values()]
        .filter((x) => x.of === d.id && open(x))
        .map((x) => ({
          id: x.id,
          by: x.origin._tag === 'Written' ? who(work, x.origin.by) : 'refresh',
          at: x.when,
        })),
    }
  })
}

// The panel of a task: its words, its reviews with their evidence, the acts in time order, the
// directions (only on the top task), and the list of its files.
export const taskPanel = (work: Work, id: string, ctx: ViewContext): TaskPanel | undefined => {
  const task = work.tasks.get(id as TaskId)
  if (!task) return undefined
  const ids = new Set<string>([task.id])
  for (const a of assignmentsOn(work, task.id)) ids.add(a.id)
  const results = resultsOf(work, task.id)
  for (const r of results) {
    ids.add(r.id)
    for (const v of reviewItemsOf(work, r.id)) ids.add(v.id)
  }
  const resultViews = results.map(
    (r): ResultView => ({
      id: r.id,
      by: who(work, r.by),
      output: r.output,
      at: r.when,
      reviews: reviewItemsOf(work, r.id).map((v) => ({
        id: v.id,
        by: who(work, v.by),
        // The engine reads a resolve as an accept of its result; the page names it.
        decision: v.resolves ? 'Resolve' : v.decision,
        reason: v.reason ?? null,
        breaks: ruleIdOf(work, v.breaks),
        at: v.when,
        evidence: v.evidence.map((e) => ({
          rule: ruleIdOf(work, e.meets),
          where: e.at,
          says: e.says,
        })),
      })),
    }),
  )
  // The terminal of the task: its owner's (a Luna task shows the terminal of its parent).
  const owner = ownerOf(work, task.id)
  const terminal = owner?.session
    ? withLive(ctx, { session: owner.session, a: owner.inside ?? owner.a })
    : null
  return {
    id: task.id,
    name: task.name,
    text: task.descriptionAi.text,
    words: taskWords(work, task.id, ctx.at),
    top: task.serves._tag === 'TopTask',
    decisions: shownOn(decisionsOf(work, ctx), task),
    terminal,
    directions: task.serves._tag === 'TopTask' ? directionsView(work, task) : null,
    results: resultViews,
    timeline: work.events
      .filter((l) => touchedIds(l).some((x) => ids.has(x)))
      .map((l) => ({
        at: l.recorded.at,
        who: whoOf(l.recorded.author).who,
        line: logLine(l, work),
      })),
    files: filesOf(work, task.id, ctx),
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
const piecesOf = (work: Work, task: TaskId, ctx: ViewContext): ReadonlyArray<Piece> => {
  const commits: Piece[] = []
  const inPlace = new Map<string, InPlacePiece>()
  for (const t of treeOf(work, task)) {
    const taskT = taskAt(work, t)
    for (const m of assignmentsOn(work, t).filter((a) => isDo(work, a.role))) {
      const results = resultsOf(work, t).filter((r) => r.by === m.id)
      const latest = results.at(-1)
      const commit = latest?.output.match(/^([^#@]+)@([0-9a-f]{7,40})$/) ?? null
      const space = taskT.descriptionAi.workspace.find(
        (w) => w._tag === 'Repo' && (commit ? w.path === commit[1] : true),
      )
      const tree = join(ctx.dir, '.work', 'trees', m.id)
      const outputAt = work.config.roles[m.role]?.output?.includes('@') ?? false
      if (outputAt || commit) {
        if (space?._tag !== 'Repo') continue
        let base = space.base
        for (const x of latest?.madeFrom ?? []) {
          if (x._tag === 'Git' && x.name === space.source) {
            base = x.commit
            break
          }
        }
        const live = existsSync(tree) && !finished(m)
        if (!live && !commit) continue
        const files = live
          ? git(tree, 'diff', '--name-only', base).split('\n').filter(Boolean)
          : results
              .flatMap((r) => work.resultFiles.get(r.id) ?? [])
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
        const first = taskT.untouched
        const seenInPlace = first._tag === 'AtFirstBrief' ? first.inPlace : undefined
        const before: Readonly<Record<string, string>> =
          seenInPlace?._tag === 'InPlace' ? seenInPlace.texts : {}
        const beforeAt = seenInPlace?._tag === 'InPlace' ? seenInPlace.at : ''
        const working =
          !finished(m) &&
          openDo(work, m.id) &&
          (!latest || resultWord(work, latest, ctx.at) === 'rejected')
        const files = new Set([
          ...results.flatMap((r) => work.resultFiles.get(r.id) ?? []),
          ...Object.keys(before),
        ])
        for (const f of files) {
          const now = working || !latest
          const after = now
            ? readText(join(ctx.dir, f))
            : (work.after.get(latest.id)?.[f] ?? readText(join(ctx.dir, f)))
          const afterAt = now ? ctx.at : latest.when
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
  work: Work,
  task: string,
  file: string,
  ctx: ViewContext,
): string | undefined => {
  if (!work.tasks.has(task as TaskId)) return undefined
  const pieces = piecesOf(work, task as TaskId, ctx).filter((p) => p.file === file)
  return pieces
    .map((p) => {
      const text = p.diff()
      return pieces.length > 1 ? `# ${p.task} · ${p.a}\n${text}` : text
    })
    .join('\n')
}

const filesOf = (work: Work, task: TaskId, ctx: ViewContext) => {
  const pieces = piecesOf(work, task, ctx)
  return [...new Set(pieces.map((p) => p.file))].sort().map((file) => ({
    file,
    ...counts(fileDiff(work, task, file, ctx) ?? ''),
  }))
}

// --- the dir --------------------------------------------------------------------------------

// The dir, for the sidebar. With no Work the dir has no store, so it has no projects.
export const dirView = (
  work: Work | undefined,
  dir: {
    readonly name: string
    readonly path: string
    readonly settings: Settings
    readonly rolesDraft: boolean
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
  rolesDraft: dir.rolesDraft,
  initialized: work !== undefined,
  startPrompt: dir.startPrompt,
  projects: work ? projectsOf(work, ctx) : [],
})
