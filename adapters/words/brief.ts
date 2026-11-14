// The brief of an assignment (golden text; its length is the measure of the brief limit, which the
// adapter gives as Outside.measure). The steps come from nextFor, and the state of every task,
// question and evaluation from Derived.
// Findings that change a brief: I2/D14 (no bookkeeping step in READY), C1 (an assignment of an
// ended task has no step), S4 (an assignment that is OutOfTries has no step).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  actorOf,
  actsOf,
  blockersOfResult,
  claimOf,
  closeReasonOf,
  coversMaker,
  currentOf,
  decidesResults,
  directionIdsOf,
  mayChange,
  rulesOf,
  stopTask,
  taskAt,
} from '../../core/derived/reads.ts'
import { type Derived, nextFor } from '../../core/derived/index.ts'
import { fileTurn, highAbove, RANK, tierOfA } from '../../core/derived/steps.ts'
import {
  type Assignment,
  type AssignmentId,
  type Blocker,
  type Result,
  revisionOf,
  type ResultId,
  type Role,
  type Rule,
  type Task,
  type Tier,
  type Workspace,
  type Work,
} from '../../core/schema/index.ts'
import { blockerLines, taskLines } from './blockers.ts'
import { briefWords, checkerOf, latestResult, short, stateWord, who } from './common.ts'
import { nextLines } from './next.ts'
import { attemptWords } from './shared.ts'

// The token that measures a brief (the length of a real token).
const MEASURE_TOKEN = 'a0.00000000000000000000000000'

// --- what an assignment is -----------------------------------------------------------------------

const assignmentOf = (w: Work, id: AssignmentId): Assignment => {
  const a = w.assignments.get(id)
  if (a === undefined) throw new Error(`the work has no assignment ${id}`)
  return a
}
const roleOfAssignment = (w: Work, a: Assignment): Role => {
  const role = w.workflow.roles.get(a.role)
  if (role === undefined) throw new Error(`the work has no role ${a.role}`)
  return role
}
// The roles of a lower tier than the assignment's, in the order of aristoteles.yaml (a program
// has no tier, so it gives none).
const lowerRoles = (w: Work, a: Assignment): ReadonlyArray<Extract<Role, { _tag: 'Model' }>> => {
  const own = tierOfA(w, a)
  if (own === undefined) return []
  return [...w.workflow.roles.values()].flatMap((r) =>
    r._tag === 'Model' && RANK[r.tier] < RANK[own] ? [r] : [],
  )
}

// What an assignment may do at a time: the old actKinds, by the `when` of the tier guides.
interface ActKinds {
  readonly do: boolean
  readonly review: boolean
  readonly approve: boolean
  readonly change: boolean
  readonly lower: boolean
  readonly top: boolean
  readonly evaluate: boolean
  readonly any: boolean
}
const actKinds = (w: Work, a: Assignment, at: string): ActKinds => {
  const acts = actsOf(w, a.id, at as never)
  const tier = tierOfA(w, a)
  return {
    do: acts.some((x) => x._tag === 'Do'),
    review: acts.some((x) => x._tag === 'Review' || x._tag === 'Approve'),
    approve: acts.some((x) => x._tag === 'Approve'),
    change: mayChange(w, a.id, a.task, at as never),
    lower: lowerRoles(w, a).length > 0,
    top: a.parent._tag === 'GivenByPerson' && tier !== 'low',
    evaluate: tier === 'high',
    any: true,
  }
}
// A low role that makes nothing: it checks the checks of its role on one result.
const lowChecker = (w: Work, a: Assignment, at: string): boolean =>
  tierOfA(w, a) === 'low' && !actKinds(w, a, at).do

// The rules that one review assignment checks: every rule of its task that names its role.
const checksOf = (w: Work, a: Assignment): ReadonlyArray<Rule> =>
  rulesOf(w, a.task).filter((r) => r.checkedBy._tag === 'Role' && r.checkedBy.role === a.role)
// A low checker checks its checks; everyone else reads every rule of the task.
const rulesForAt = (w: Work, a: Assignment, at: string): ReadonlyArray<Rule> =>
  tierOfA(w, a) === 'low' && actKinds(w, a, at).review ? checksOf(w, a) : rulesOf(w, a.task)

// rulesFor(a): the rules that this assignment gives evidence for, at the time of the act.
export const rulesFor = (d: Derived, a: AssignmentId): ReadonlyArray<Rule> =>
  rulesForAt(d.moment.work, assignmentOf(d.moment.work, a), d.moment.at)

// --- the guides of the tiers ---------------------------------------------------------------------

// A tier guide (guides/<tier>.yaml): files of the tool, not of the dir, read once.
interface Guide {
  readonly intro: string
  readonly stop: string | { readonly do: string; readonly review: string }
  readonly commands: Readonly<
    Record<string, { readonly when: keyof ActKinds; readonly run: string; readonly rule: string }>
  >
}
const GUIDES = join(import.meta.dir, '..', '..', 'guides')
const guides = new Map<Tier, Guide>()
const guideOf = (tier: Tier): Guide => {
  const known = guides.get(tier)
  if (known) return known
  const guide = Bun.YAML.parse(readFileSync(join(GUIDES, `${tier}.yaml`), 'utf8')) as Guide
  guides.set(tier, guide)
  return guide
}

// --- the words of a role and a task --------------------------------------------------------------

const roleFile = (w: Work, a: Assignment) => {
  const file = w.config.roles[a.role]
  if (file === undefined) throw new Error(`the config of the work has no role ${a.role}`)
  return file
}
const sectionOf = (t: Task): string | null =>
  t.descriptionAi.context.section._tag === 'Section' ? t.descriptionAi.context.section.id : null

// Role words and output forms name the workspace and the context; fill them in. A task that
// needs other tasks reports its whole workspace.
const fillText = (text: string, task: Task): string => {
  const t = task.descriptionAi
  let out = text.replaceAll('<task id>', task.id)
  const only = t.workspace.length === 1 ? t.workspace[0] : undefined
  if (only) {
    if (task.needs.length && sectionOf(task) === null) {
      out = out.replaceAll('<file>#<section>', only.path)
    }
    out = out.replaceAll('<file>', only.path).replaceAll('<repo>', only.path)
  }
  const section = sectionOf(task)
  if (section !== null) out = out.replaceAll('<section>', section)
  for (const [key, value] of t.context.facts) out = out.replaceAll(`<${key}>`, value)
  return out
}

// The form of the output that a maker reports: <file>#<section>, <repo>@<commit>. A task that
// needs others reports its whole workspace (a document file, or a commit in the workspace repo);
// a task with a section keeps its section.
export const outputForm = (w: Work, id: AssignmentId): string => {
  const a = assignmentOf(w, id)
  const task = taskAt(w, a.task)
  const output = roleFile(w, a).output
  const workspace = task.descriptionAi.workspace
  const only = workspace.length === 1 ? workspace[0] : undefined
  if (task.needs.length > 0 && only && sectionOf(task) === null) {
    return output?.includes('@') ? `${only.path}@<commit>` : only.path
  }
  return output ? fillText(output, task) : '"<what you made, and where it is>"'
}

// A block of a brief: its head in a column of nine, then its lines under the first.
const block = (head: string, lines: ReadonlyArray<string>): ReadonlyArray<string> => {
  const [first = '', ...rest] = lines
  return [
    `${head.padEnd(Math.max(9, head.length + 1))}${first}`,
    ...rest.map((l) => `${' '.repeat(9)}${l}`),
  ]
}
const fill = (text: string, values: Readonly<Record<string, string>>): string =>
  text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all)

// The programs that run on each report of this role.
const programsFor = (w: Work, a: Assignment): ReadonlyArray<string> =>
  [...w.workflow.roles.values()].flatMap((r) => {
    const file = w.config.roles[r.role]
    const checks = r.acts.some((x) => x._tag === 'Review' && x.resultsOf.includes(a.role))
    if (r._tag !== 'Program' || file?.kind !== 'program' || !checks) return []
    return [
      `${r.role}: ${file.run} (runs on each report, in a clean checkout of a commit; ` +
        `checks ${file.checks.join(', ')})`,
    ]
  })

// A low checker reviews the result of its claim; everyone else the latest result.
const reviewedResult = (d: Derived, a: Assignment): Result | undefined => {
  const w = d.moment.work
  const claim = claimOf(w, a.id)
  return lowChecker(w, a, d.moment.at) && claim._tag === 'Checking'
    ? w.results.get(claim.result)
    : latestResult(w, a.task)
}

// Who may accept or reject a result: its owner, a Change act on it, a role that covers or decides
// the maker. Not canAct: that adds the claim of the agent (needClaim), and a brief is measured
// and read before the agent holds one, so the check here is the permission alone (the old
// mayDecide, from the leaf reads of core/derived/reads.ts).
const mayReview = (d: Derived, a: Assignment, result: Result): boolean => {
  const w = d.moment.work
  const at = d.moment.at
  return (
    actorOf(w, a.id).name === taskAt(w, a.task).owner.name ||
    mayChange(w, a.id, a.task, at) ||
    coversMaker(w, a.id, result.id, at) ||
    decidesResults(w, a.id, result.id, at)
  )
}

// What the brief offers an assignment: a review only when the act is allowed on the result (the
// same permission that work review asks), not for every result of a role with a review act.
const offered = (d: Derived, a: Assignment): ActKinds => {
  const kinds = actKinds(d.moment.work, a, d.moment.at)
  const result = reviewedResult(d, a)
  if (!kinds.review || result === undefined) return kinds
  return mayReview(d, a, result) ? kinds : { ...kinds, review: false }
}

// The commands of the tier guide that this assignment may run, with its ids filled in.
const turnLines = (d: Derived, a: Assignment, tier: Tier, token: string) => {
  const w = d.moment.work
  const kinds = offered(d, a)
  const result = latestResult(w, a.task)
  // The evidence lines name only the rules whose evidence from this role counts.
  const checks = rulesForAt(w, a, d.moment.at).filter(
    (r) =>
      (r.checkedBy._tag === 'Role' && r.checkedBy.role === a.role) ||
      (r.checkedBy._tag === 'Decider' && kinds.approve) ||
      (tier === 'low' && kinds.review),
  )
  const where = result ? ` in ${result.output}` : ''
  const values = {
    you: token,
    id: a.id,
    task: a.task,
    result: result ? result.id : '<result>',
    output: outputForm(w, a.id),
    evidence:
      checks.length > 0
        ? checks
            .map((r) => `--evidence="${r.id} | <where you looked${where}> | <what you saw>"`)
            .join(' ')
        : `--evidence="<the place in ${result ? result.output : 'the result'} where you read it> ` +
          '| <what you saw there>"',
    lower: lowerRoles(w, a)
      .map((r) => r.role)
      .join('|'),
  }
  const shown = Object.entries(guideOf(tier).commands).filter(([, c]) => kinds[c.when])
  const width = Math.max(...shown.map(([name]) => name.length)) + 2
  return shown.flatMap(([name, c]) => [
    `  ${name.padEnd(width)}${fill(c.run, values)}`,
    `  ${' '.repeat(width)}${fill(c.rule, values)}`,
  ])
}
const stopLine = (d: Derived, a: Assignment, tier: Tier): string => {
  const stop = guideOf(tier).stop
  return typeof stop === 'string'
    ? stop
    : actKinds(d.moment.work, a, d.moment.at).do
      ? stop.do
      : stop.review
}

// --- the short blocks ----------------------------------------------------------------------------

// The tasks that this task needs, the latest evaluation of the task, the answers to its
// questions, and the person's comments. Each is one line, cut short, with the record to read.
const needsLines = (d: Derived, task: Task): ReadonlyArray<string> =>
  task.needs.map((n) => {
    const r = latestResult(d.moment.work, n)
    return `${n} ${taskAt(d.moment.work, n).name} · ${stateWord(d, n)}` +
      `${r ? ` (${r.id} ${r.output})` : ''}`
  })
const evaluationLines = (d: Derived, task: Task): ReadonlyArray<string> => {
  const w = d.moment.work
  const e = [...w.evaluations.values()]
    .filter(
      (x) =>
        stopTask(w, x.answers) === task.id && d.states.evaluations.get(x.id)?._tag === 'Counts',
    )
    .at(-1)
  if (e === undefined) return []
  return [
    `${e.id} (${e.level}, ${who(w, e.by)}) wrong: ${short(e.wrong, 160)}`,
    `  why: ${short(e.why, 160)}`,
    ...e.improve.map((x) => `  improve: ${short(x, 160)}`),
  ]
}
// A low maker reads the answers to its own questions, and to those that a lead (a medium or high
// assignment) asked about its task; medium and high read the answers of the task.
const answerLines = (d: Derived, a: Assignment): ReadonlyArray<string> => {
  const w = d.moment.work
  const low = tierOfA(w, a) === 'low'
  const askedAbove = (from: AssignmentId | { readonly _tag: 'Human' }) =>
    typeof from === 'string' && tierOfA(w, assignmentOf(w, from)) !== 'low'
  return [...d.states.questions]
    .flatMap(([id, state]) => {
      const q = w.questions.get(id)
      if (q === undefined || state._tag !== 'Answered') return []
      const mine = low
        ? q.from === a.id || (askedAbove(q.from) && q.stops === a.task)
        : q.stops === a.task
      return mine ? [{ q, state }] : []
    })
    .slice(-3)
    .reverse()
    .flatMap(({ q, state }) => {
      const full = state.answer.length > 200 ? ` (in full: work question show ${q.id})` : ''
      return [
        `${q.id} asked by ${who(w, q.from, q.id)}: ${short(q.text, 100)}`,
        `  answer (${who(w, state.by)}): ${short(state.answer, 200)}${full}`,
      ]
    })
}
// The escalations of this assignment that a resolve closed: who resolved each, and the words. An
// open one is a line of OPEN already; its resolution takes the same place, so the agent that
// escalated reads the answer where it reads what to do next, and does not escalate again.
const resolvedLines = (w: Work, a: Assignment): ReadonlyArray<string> =>
  [...w.reviews.values()].flatMap((v) => {
    const e = v._tag === 'Resolve' ? w.reviews.get(v.escalation) : undefined
    if (v._tag !== 'Resolve' || e?._tag !== 'Escalate' || e.by !== a.id) return []
    const full = v.resolution.length > 200 ? ` (in full: work result show ${e.of})` : ''
    return [
      `${e.id} escalated on ${e.of}: "${short(e.reason, 100)}" (resolved by ${who(w, v.by, v.id)})`,
      `  resolution (${v.id}): ${short(v.resolution, 200)}${full}`,
    ]
  })
const noteLines = (w: Work, a: Assignment): ReadonlyArray<string> =>
  [...w.notes.values()]
    .flatMap((n) =>
      n._tag === 'Message' &&
      n.about === a.task &&
      typeof n.by !== 'string' &&
      n.by._tag === 'Human'
        ? [n]
        : [],
    )
    .slice(-2)
    .reverse()
    .map((n) => `${n.id} ${who(w, n.by, n.id)}: "${short(n.text, 160)}"`)

// --- the OPEN block ------------------------------------------------------------------------------

const isDecider = (item: Blocker): boolean =>
  item._tag === 'DeciderAcceptedUnderOld' ||
  item._tag === 'DeciderWaits' ||
  item._tag === 'DeciderAnyApprover'

// The open items of one result, with ids. A low maker sees what to fix; a low checker only its
// own checks; medium and high see everything.
const resultItems = (d: Derived, result: ResultId, a: Assignment): ReadonlyArray<string> => {
  const w = d.moment.work
  const checker = lowChecker(w, a, d.moment.at)
  const checks = rulesForAt(w, a, d.moment.at).map((x) => x.entry)
  const low = tierOfA(w, a) === 'low'
  const wanted = (item: Blocker): boolean => {
    if (checker) return item._tag === 'Evidence' && checks.includes(item.ref)
    if (!low) return true
    // The decider's accept is not a low maker's act, so its OPEN does not show it.
    if (isDecider(item)) return false
    return item._tag !== 'Evidence' || item.rejects.length > 0
  }
  const { outside } = d.moment
  const lines: Array<string> = []
  if (outside.changed.has(result)) {
    lines.push(`${result} changed after it was reported; the maker reports it again`)
  }
  const stale = outside.stale.get(result)
  if (stale && !checker) {
    lines.push(
      `${result} was built on ${stale.source}@${stale.was}; ${stale.source} is now at ${stale.now}`,
    )
  }
  for (const item of blockersOfResult(w, result).filter(wanted)) {
    lines.push(...blockerLines(d, result, item))
  }
  return lines
}
// The OPEN lines of a task for an assignment: those of its latest result, then those of the task,
// each once (a low checker sees only its result's).
const openItems = (d: Derived, task: Task, a: Assignment): ReadonlyArray<string> => {
  const w = d.moment.work
  const result = latestResult(w, task.id)
  const own = result ? resultItems(d, result.id, a) : []
  if (lowChecker(w, a, d.moment.at)) return own
  return [...new Set([...own, ...taskLines(d, task.id)])]
}

// --- the brief -----------------------------------------------------------------------------------

// The brief of an assignment, as `work brief` prints it. The dir and the time are the moment's.
export const briefOf = (d: Derived, id: AssignmentId, token: string): string =>
  renderBrief(d, id, token, true)

// The size that the limit of a tier measures (ruling 10.9): the brief with a token of a real
// token's length, without its READY steps. The steps change with each act, and the remedy of an
// over-long brief (shorter directions, or a split) does not change them.
export const briefSizeOf = (d: Derived, id: AssignmentId): number =>
  renderBrief(d, id, MEASURE_TOKEN, false).length

const renderBrief = (d: Derived, id: AssignmentId, token: string, ready: boolean): string => {
  const w = d.moment.work
  const at = d.moment.at
  const cwd = d.moment.outside.cwd
  const a = assignmentOf(w, id)
  const role = roleOfAssignment(w, a)
  const tier = role._tag === 'Model' ? role.tier : undefined
  if (tier === undefined) throw new Error(`${id} is a program; a program reads no brief`)
  const task = taskAt(w, a.task)
  const t = task.descriptionAi
  const config = roleFile(w, a)
  const kinds = offered(d, a)
  const checker = lowChecker(w, a, at)
  const attempts = kinds.do ? ` · ${attemptWords(d, id)}` : ''
  const intro = guideOf(tier).intro.split('\n')
  const versions = directionIdsOf(w, task.id).map((x) => {
    const v = currentOf(w, x)
    return `${v.of}@${v.number}`
  })
  const lines: Array<string> = [
    `work brief ${id} · ${a.role} (${tier}) · ${task.id} ${task.name}${attempts}`,
    `snapshot: ${versions.join(', ') || 'no directions'}`,
    ...(cwd ? [`dir: ${cwd} (run every work command in this folder)`] : []),
    '',
    ...block('YOU ARE', [`${tier} tier. ${intro[0]}`, ...intro.slice(1)]),
    ...block('ROLE', [
      fillText(config.description, task),
      ...config.responsibilities.map((r) => `- ${fillText(r, task)}`),
    ]),
    // A low checker reads the maker's task to know what was asked; it writes nothing.
    ...block('TASK', [
      checker ? `the maker's task (you check it; you do not do it): ${t.text}` : t.text,
      ...(t.partOf ? [`part of: ${t.partOf}`] : []),
    ]),
  ]
  // A closed task takes no work: its assignment stops, and its parent assigns on the new task.
  // Its brief says only that, so that the agent runs none of its commands (Nanda, 2026-11-13).
  const taskState = d.states.tasks.get(task.id)
  if (taskState?._tag === 'Closed' || taskState?._tag === 'Replaced') {
    const head = lines.slice(0, cwd ? 3 : 2)
    return [...head, '', closedLine(d, a, task), 'Run no work command for this task.'].join('\n')
  }
  // Ruling 10.9: a brief over the limit of its tier is not given; the agent waits for a short one.
  const state = d.states.assignments.get(id)
  if (state?._tag === 'BriefOver') {
    const head = lines.slice(0, cwd ? 3 : 2)
    const high = highAbove(d, a)
    const who = high === undefined ? task.owner.name : high.id
    return [
      ...head,
      '',
      `Your brief has ${state.size} characters; the limit of the ${tier} tier is ${state.limit}. ` +
        `${who} shortens the directions of ${task.id}, or splits ${task.id}.`,
      'Run no work command for this task. STOP: your parent gives you this token again.',
    ].join('\n')
  }
  // The tasks that this task needs, one line each: their accepted work goes into its result.
  const needs = needsLines(d, task)
  if (needs.length) {
    const waiting = task.needs.some((n) => d.states.tasks.get(n)?._tag !== 'Accepted')
    lines.push(
      ...block('NEEDS', [
        ...needs,
        waiting
          ? kinds.do
            ? `Not all of them are accepted yet. Do not report. Run work escalate ${token} ` +
              '--reason="the needs are not accepted", then STOP.'
            : 'Not all of them are accepted yet. This task takes its result after each one is.'
          : config.output?.includes('@')
            ? 'Their work is done. Merge their accepted commits with git merge (a squash or a ' +
              'copy is refused); then do only what your task asks beyond them, and what ' +
              'combines them.'
            : 'Their work is done: use it as it is (a change to it is refused). Do only what ' +
              'your task asks beyond them, and what combines them.',
      ]),
    )
  }
  // The latest evaluation of the task: what went wrong before, why, and what changed for it.
  const evaluation = evaluationLines(d, task)
  if (evaluation.length) lines.push(...block('EVALUATION', evaluation))
  // The starting point: earlier work that the maker starts from; its result is new work.
  const start = t.from === null ? undefined : w.results.get(t.from)
  if (start && !checker) {
    lines.push(
      ...block('FROM', [
        `${start.id} of ${start.task} ${taskAt(w, start.task).name}: ${start.output}`,
        'Start from this work and change what your task asks; a report of it as it is is refused.',
      ]),
    )
  }
  lines.push(...workIn(d, a, task, kinds, checker))
  if (t.references.length) lines.push(...block('READ', t.references))
  const rules = rulesForAt(w, a, at)
  if (rules.length) {
    const width = Math.max(...rules.map((r) => r.id.length)) + 2
    lines.push(
      ...block(
        checker ? 'CHECKS' : 'RULES',
        rules.map(
          (r) =>
            `${r.id.padEnd(width)}` +
            briefWords(
              r.says,
              `${snapshotOf(w, a, r) ?? 'its direction'}#${r.id}`,
              ' '.repeat(9 + width),
            ) +
            `  (${checkerOf(r)})`,
        ),
      ),
    )
  }
  const result = reviewedResult(d, a)
  if (kinds.review && result) {
    // A commit names the base it was made from, so a checker can compare with it.
    const from = result.madeFrom.flatMap((m) =>
      m._tag === 'Result' ? [] : [`${m.name}@${revisionOf(m)}`],
    )
    const maker = assignmentOf(w, result.by).role
    lines.push(
      ...block('REVIEW', [
        `${result.id} by ${result.by} (${maker}): ${result.output}` +
          `${from.length ? ` (made from ${from.join(', ')})` : ''}`,
      ]),
    )
  } else if (checker && result) {
    // The act of this role on this result is refused (see offered).
    lines.push(
      ...block('REVIEW', [
        `${result.id} by ${result.by} (${assignmentOf(w, result.by).role}): ${result.output}`,
        `your role may not review it; escalate with --result=${result.id} and STOP`,
      ]),
    )
  } else if (checker) {
    lines.push(
      ...block('REVIEW', [
        `nothing is reported yet. Run work escalate ${token} --reason="no result to check", ` +
          'then STOP.',
      ]),
    )
  }
  // ANSWERS and NOTES: what was said about the task (a low checker reads none).
  const answers = checker ? [] : answerLines(d, a)
  if (answers.length) lines.push(...block('ANSWERS', answers))
  const notes = checker ? [] : noteLines(w, a)
  if (notes.length) lines.push(...block('NOTES', notes))
  const open = [...resolvedLines(w, a), ...openItems(d, task, a)]
  if (open.length) {
    const more = open.length - 6
    const rest = more > 0 ? [`(${more} more: work blockers ${latestResult(w, task.id)?.id})`] : []
    lines.push(...block('OPEN', [...open.slice(0, 6), ...rest]))
  }
  const steps = ready && tier !== 'low' ? nextFor(d, { _tag: 'Agent', assignment: id }) : []
  const readyLines = nextLines(d, steps, token)
  if (readyLines.length) lines.push('', 'READY', ...readyLines.map((s) => `  ${s}`))
  // Each step only waits (no step has a command): the agent waits for work (ruling 10.1).
  const waitsOnly = (step: (typeof steps)[number]) =>
    !nextLines(d, [step], token).some((l) => l.startsWith('  '))
  if (steps.length && steps.every(waitsOnly)) {
    lines.push('  Nothing to run now: wait for work, as YOUR TURN says.')
  }
  lines.push('', 'YOUR TURN', ...turnLines(d, a, tier, token), stopLine(d, a, tier))
  return lines.join('\n')
}

// The line of a closed task: who assigns next, on what.
const closedLine = (d: Derived, a: Assignment, task: Task): string => {
  const w = d.moment.work
  const end = d.states.tasks.get(task.id)
  const by = a.parent._tag === 'Parent' ? 'your parent' : 'the person'
  if (end?._tag !== 'Replaced') {
    return (
      `CLOSED   ${task.id} was closed ("${short(closeReasonOf(w, task.id), 80)}"); ` +
      `STOP: ${by} decides what is next.`
    )
  }
  // The remade task: the highest task of the tree that the same remake replaced.
  let old = task
  for (;;) {
    const parent = old.serves._tag === 'Serves' ? w.tasks.get(old.serves.task) : undefined
    const above = parent === undefined ? undefined : d.states.tasks.get(parent.id)
    if (parent === undefined || above?._tag !== 'Replaced' || above.next !== end.next) break
    old = parent
  }
  return (
    `CLOSED   ${task.id} was closed when ${old.id} was remade as ${end.next}; ` +
    `STOP: ${by} assigns on ${end.next}.`
  )
}

// The version of the snapshot that holds a rule (tsd-writing@2), for the address of its words.
const snapshotOf = (w: Work, a: Assignment, rule: Rule): string | undefined => {
  for (const [dir, n] of a.under) {
    const direction = w.directions.get(dir)
    const v = direction?._tag === 'Official' ? direction.versions[n - 1] : undefined
    const holds = v?.standards.some((s) => w.standards.get(s)?.rules.includes(rule.entry))
    if (holds) return `${dir}@${n}`
  }
  return undefined
}

const overlap = (x: string, y: string): boolean =>
  x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)

// WORK IN: each place of the workspace, the worktree of a code maker, the turn of a maker that
// waits for its file, and the programs that run on each report.
const workIn = (
  d: Derived,
  a: Assignment,
  task: Task,
  kinds: ActKinds,
  checker: boolean,
): ReadonlyArray<string> => {
  const w = d.moment.work
  const cwd = d.moment.outside.cwd
  const t = task.descriptionAi
  const output = roleFile(w, a).output
  // A code maker works in its own git worktree, so two makers on one repo do not change each
  // other's files; the work commands still run in the dir. It starts at the commit of the
  // starting point, or at the base.
  const tree = kinds.do && output?.includes('@') ? join(cwd || '.', '.work', 'trees', a.id) : null
  const start = t.from === null ? undefined : w.results.get(t.from)
  const startAt = (x: Workspace): string =>
    start?.output.startsWith(`${x.path}@`)
      ? (start.output.split('@')[1] ?? '')
      : x._tag === 'Repo'
        ? x.base
        : 'HEAD'
  const programs = kinds.do ? programsFor(w, a) : []
  if (!t.workspace.length && !programs.length) return []
  const waits = fileTurn(d, a.id)
  const before = waits ? assignmentOf(w, waits.before) : undefined
  return block('WORK IN', [
    ...t.workspace.flatMap((x) => [
      `${x.path} (source ${x.source}${x._tag === 'Repo' ? `, base ${x.base}` : ''})` +
        (x.verify && !checker
          ? `; verify: ${x.verify} ` +
            `(run it in ${tree ? 'your worktree' : 'the dir'}; exit 0 = ready)`
          : ''),
      ...(tree
        ? [
            `your worktree: ${tree}, branch work/${a.id} from ${startAt(x)}; make and commit the ` +
              'change only there',
            `make it once, if it is not there: git -C ${x.path} worktree add -b work/${a.id} ` +
              `${tree} ${startAt(x)}`,
          ]
        : []),
      // One maker writes a file at a time: a maker that waits for the file does not touch it.
      ...(waits && before && overlap(waits.file, x.path)
        ? [
            `${waits.before} (${before.task} ${taskAt(w, before.task).name}) ` +
              `writes ${waits.file} ` +
              `first; do not change it: your turn comes when the file is free`,
          ]
        : []),
    ]),
    ...programs,
  ])
}
