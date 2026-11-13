// The brief of an assignment (package P5a; the data of a brief is words, so it lives here). The
// brief is golden text, and its length is the measure of the brief limit (the CLI gives measure to
// the engine's CheckContext, with MEASURE_TOKEN).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { revisionOf } from '../domain/derived.ts'
import type { AssignmentId, Time } from '../domain/ids.ts'
import type { Assignment, Result, Rule, Task, Tier, Workspace } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import {
  current,
  directionsOf,
  evaluationCounts,
  stopTask,
  taskAccepted,
} from '../engine/queries.ts'
import { mayDecide } from '../engine/acts.ts'
import { taskState } from '../engine/status.ts'
import { briefWords, checkerOf, latestResult, short, taskStateWord, who } from './common.ts'
import { nextLines, nextSteps } from './next.ts'
import { openItems } from './open.ts'
import {
  type ActKinds,
  actKinds,
  assignmentOf,
  attemptWords,
  fileTurn,
  idleOf,
  idleWords,
  lowChecker,
  lowerRoles,
  overlap,
  rulesForAt,
  tierOfAssignment,
} from './reads.ts'

// The file queue of makers, why a maker is idle, a result made from an old revision: the CLI and
// waiting.ts read them here.
export { fileTurn, staleOf, waitersOf } from './reads.ts'
export const idleWhy = (w: Work, x: AssignmentId, at: Time): string | undefined => {
  const idle = idleOf(w, x, at)
  return idle === undefined ? undefined : idleWords(w, idle)
}

// The token that measures a brief (the length of a real token).
export const MEASURE_TOKEN = 'a0.00000000000000000000000000'

// rulesFor(a): the rules that this assignment gives evidence for, at the time of the act.
export const rulesFor = (w: Work, a: AssignmentId, at: Time): ReadonlyArray<Rule> =>
  rulesForAt(w, assignmentOf(w, a), at)

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

const taskOf = (w: Work, id: Task['id']): Task => {
  const t = w.tasks.get(id)
  if (t === undefined) throw new Error(`the work has no task ${id}`)
  return t
}
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
  const task = taskOf(w, a.task)
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

// The commands of the tier guide that this assignment may run, with its ids filled in.
const turnLines = (w: Work, a: Assignment, tier: Tier, token: string, at: Time) => {
  const kinds = offered(w, a, at)
  const result = latestResult(w, a.task)
  // The evidence lines name only the rules whose evidence from this role counts.
  const checks = rulesForAt(w, a, at).filter(
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
const stopLine = (w: Work, a: Assignment, tier: Tier, at: Time): string => {
  const stop = guideOf(tier).stop
  return typeof stop === 'string' ? stop : actKinds(w, a, at).do ? stop.do : stop.review
}

const cut = (text: string, n: number) => short(text, n)

// What the brief offers an assignment: a review only when the engine lets it decide on the
// result (the same mayDecide that work review asks), not for every result of a role with a
// review act.
const offered = (w: Work, a: Assignment, at: Time): ActKinds => {
  const kinds = actKinds(w, a, at)
  const result = reviewedResult(w, a, at)
  if (!kinds.review || result === undefined) return kinds
  const allowed = mayDecide(w, a.id, { _tag: 'Result', id: result.id }, a.task, at)
  return allowed ? kinds : { ...kinds, review: false }
}
// A low checker reviews the result of its claim; everyone else the latest result.
const reviewedResult = (w: Work, a: Assignment, at: Time): Result | undefined => {
  const claim = w.meta.get(a.id)?.claim
  return lowChecker(w, a, at) && claim?._tag === 'Checking'
    ? w.results.get(claim.result)
    : latestResult(w, a.task)
}

// The three short blocks of the engine's brief with the CLI's ids: the
// tasks that this task needs, the latest evaluation of the task, the answers to its questions,
// and the person's comments. Each is one line, cut short, with the record to read in full.
const needsLines = (w: Work, task: Task, at: Time): ReadonlyArray<string> =>
  task.needs.map((n) => {
    const r = latestResult(w, n)
    const state = taskStateWord(taskState(w, n, at))
    return `${n} ${taskOf(w, n).name} · ${state}${r ? ` (${r.id} ${r.output})` : ''}`
  })
const evaluationLines = (w: Work, task: Task): ReadonlyArray<string> => {
  const e = [...w.evaluations.values()]
    .filter((x) => stopTask(w, x.answers) === task.id && evaluationCounts(w, x))
    .at(-1)
  if (e === undefined) return []
  return [
    `${e.id} (${e.level}, ${who(w, e.by)}) wrong: ${cut(e.wrong, 160)}`,
    `  why: ${cut(e.why, 160)}`,
    ...e.improve.map((x) => `  improve: ${cut(x, 160)}`),
  ]
}
// A low maker reads the answers to its own questions, and to those that a lead (a medium or high
// assignment) asked about its task; medium and high read the answers of the task.
const answerLines = (w: Work, a: Assignment): ReadonlyArray<string> => {
  const low = tierOfAssignment(w, a) === 'low'
  const askedAbove = (from: AssignmentId | { readonly _tag: 'Human' }) =>
    typeof from === 'string' && tierOfAssignment(w, assignmentOf(w, from)) !== 'low'
  return [...w.questions.values()]
    .filter(
      (q) =>
        q.status._tag === 'Answered' &&
        (low ? q.from === a.id || (askedAbove(q.from) && q.stops === a.task) : q.stops === a.task),
    )
    .slice(-3)
    .reverse()
    .flatMap((q) => {
      if (q.status._tag !== 'Answered') return []
      const answer = q.status.answer
      const full = answer.length > 200 ? ` (in full: work question show ${q.id})` : ''
      return [
        `${q.id} asked by ${who(w, q.from, q.id)}: ${cut(q.text, 100)}`,
        `  answer (${who(w, q.status.by)}): ${cut(answer, 200)}${full}`,
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
      `${e.id} escalated on ${e.of}: "${cut(e.reason, 100)}" (resolved by ${who(w, v.by, v.id)})`,
      `  resolution (${v.id}): ${cut(v.resolution, 200)}${full}`,
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
    .map((n) => `${n.id} ${who(w, n.by, n.id)}: "${cut(n.text, 160)}"`)

// --- the brief -----------------------------------------------------------------------------------

export const renderBrief = (
  w: Work,
  id: AssignmentId,
  { token, at, cwd }: { readonly token: string; readonly at: Time; readonly cwd: string },
): string => {
  const a = assignmentOf(w, id)
  const tier = tierOfAssignment(w, a)
  if (tier === undefined) throw new Error(`${id} is a program; a program reads no brief`)
  const task = taskOf(w, a.task)
  const t = task.descriptionAi
  const config = roleFile(w, a)
  const kinds = offered(w, a, at)
  const checker = lowChecker(w, a, at)
  const attempts = kinds.do ? ` · ${attemptWords(w, id)}` : ''
  const intro = guideOf(tier).intro.split('\n')
  const versions = directionsOf(w, task.id).map((d) => {
    const v = current(w, d.id)
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
  if (task.end._tag !== 'NotEnded') {
    const head = lines.slice(0, cwd ? 3 : 2)
    return [...head, '', closedLine(w, a, task), 'Run no work command for this task.'].join('\n')
  }
  // The tasks that this task needs, one line each: their accepted work goes into its result.
  const needs = needsLines(w, task, at)
  if (needs.length) {
    const waiting = task.needs.some((n) => !taskAccepted(w, n, at))
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
  const evaluation = evaluationLines(w, task)
  if (evaluation.length) lines.push(...block('EVALUATION', evaluation))
  // The starting point: earlier work that the maker starts from; its result is new work.
  const start = t.from === null ? undefined : w.results.get(t.from)
  if (start && !checker) {
    lines.push(
      ...block('FROM', [
        `${start.id} of ${start.task} ${taskOf(w, start.task).name}: ${start.output}`,
        'Start from this work and change what your task asks; a report of it as it is is refused.',
      ]),
    )
  }
  lines.push(...workIn(w, a, task, kinds, checker, cwd, at))
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
  const result = reviewedResult(w, a, at)
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
    // The engine would refuse a review of this result by this role (see offered).
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
  const answers = checker ? [] : answerLines(w, a)
  if (answers.length) lines.push(...block('ANSWERS', answers))
  const notes = checker ? [] : noteLines(w, a)
  if (notes.length) lines.push(...block('NOTES', notes))
  const open = [...resolvedLines(w, a), ...openItems(w, task.id, a, at, cwd)]
  if (open.length) {
    const more = open.length - 6
    const rest = more > 0 ? [`(${more} more: work blockers ${latestResult(w, task.id)?.id})`] : []
    lines.push(...block('OPEN', [...open.slice(0, 6), ...rest]))
  }
  const steps = tier !== 'low' ? nextSteps(w, id, { token, at, cwd }) : []
  const ready = nextLines(w, steps, { token, at })
  if (ready.length) lines.push('', 'READY', ...ready.map((s) => `  ${s}`))
  // Each step only waits (no step has a command): the agent stops, and does not ask again until
  // a wake (Nanda, 2026-11-13).
  const waitsOnly = (step: (typeof steps)[number]) =>
    !nextLines(w, [step], { token, at }).some((l) => l.startsWith('  '))
  if (steps.length && steps.every(waitsOnly)) {
    lines.push('  Nothing to run now: STOP. You are woken when a step changes.')
  }
  lines.push('', 'YOUR TURN', ...turnLines(w, a, tier, token, at), stopLine(w, a, tier, at))
  return lines.join('\n')
}

// The line of a closed task: who assigns next, on what.
const closedLine = (w: Work, a: Assignment, task: Task): string => {
  const end = task.end
  const by = a.parent._tag === 'Parent' ? 'your parent' : 'the person'
  if (end._tag !== 'Replaced') {
    const reason = end._tag === 'Closed' ? end.reason : ''
    return (
      `CLOSED   ${task.id} was closed ("${short(reason, 80)}"); ` +
      `STOP: ${by} decides what is next.`
    )
  }
  // The remade task: the highest task of the tree that the same remake replaced.
  let old = task
  for (;;) {
    const parent = old.serves._tag === 'Serves' ? w.tasks.get(old.serves.task) : undefined
    if (parent?.end._tag !== 'Replaced' || parent.end.next !== end.next) break
    old = parent
  }
  return (
    `CLOSED   ${task.id} was closed when ${old.id} was remade as ${end.next}; ` +
    `STOP: ${by} assigns on ${end.next}.`
  )
}

// The version of the snapshot that holds a rule (tsd-writing@2), for the address of its words.
const snapshotOf = (w: Work, a: Assignment, rule: Rule): string | undefined => {
  for (const [d, n] of a.under) {
    const direction = w.directions.get(d)
    const v = direction?._tag === 'Official' ? direction.versions[n - 1] : undefined
    const holds = v?.standards.some((s) => w.standards.get(s)?.rules.includes(rule.entry))
    if (holds) return `${d}@${n}`
  }
  return undefined
}

// WORK IN: each place of the workspace, the worktree of a code maker, the turn of a maker that
// waits for its file, and the programs that run on each report.
const workIn = (
  w: Work,
  a: Assignment,
  task: Task,
  kinds: ActKinds,
  checker: boolean,
  cwd: string,
  at: Time,
): ReadonlyArray<string> => {
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
  const waits = fileTurn(w, a.id, at)
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
            `${waits.before} (${before.task} ${taskOf(w, before.task).name}) ` +
              `writes ${waits.file} ` +
              `first; do not change it: your turn comes when ${waits.before} finishes`,
          ]
        : []),
    ]),
    ...programs,
  ])
}
