// What waits, for a person or an assignment, with the command that ends the wait: the rows of
// `work waiting`, written from the WaitingItem list of waitingFor (golden text, as the old CLI
// wrote it).
// The kinds that SURFACES shows on the CLI (ruling 10.6: every kind, the problems and the ends
// too, after the old rows). The old rows grouped by hand what the items now say one by one, so
// this file regroups them: the points of one direction in one row, the unwritten stops of one
// task in one row, and the old order (the rows of each direction together, then the splits, the
// stops, the suggestions, the deciders).
// Findings that change a row: C1 (an assignment or a task that ended is no row), C2 (a question of
// an ended task is Irrelevant), C3 (a problem), C6 (an irrelevant forward), S2 (a draft that
// waits for the owner too), S6 (an outdated draft is no vetoed row), D14 (a maker that is
// OutOfTries holds no file turn, so no row says that the person finishes it).
import { whoOf } from '../../core/schema/index.ts'
import type {
  Direction,
  DirectionId,
  Task,
  TaskId,
  Work,
} from '../../core/schema/index.ts'
import {
  claimOf,
  directionIdsOf,
  evaluationCounts,
  itemAt,
  itemsOf,
  maxOf,
  resultAt,
  roleAt,
  stopAnswered,
  stopTask,
  taskAt,
  taskOfTarget,
  usedBy,
  isDo,
} from '../../core/derived/reads.ts'
import { openDrafts } from '../../core/derived/drafts.ts'
import {
  SURFACES,
  type Derived,
  roleWordsDraftAt,
  type WaitingItem,
} from '../../core/derived/index.ts'
import { sectionOf } from '../../core/schema/index.ts'
import { an, clock, describeInner, short, stateWord, who } from './common.ts'
import { drafterWords } from './role-words.ts'
import { aboutId, answerText, drafterOf, reviseAgainOf, stopIdOf, tierOfRole } from './shared.ts'

type Of<K extends WaitingItem['_tag']> = Extract<WaitingItem, { readonly _tag: K }>

const rolesOfTier = (w: Work, wanted: (tier: string | undefined) => boolean): string[] =>
  [...w.workflow.roles.values()].filter((r) => wanted(tierOfRole(w, r.role))).map((r) => r.role)

const topOf = (w: Work, t: Task): Task => {
  let top = t
  while (top.serves._tag === 'Serves') top = taskAt(w, top.serves.task)
  return top
}
const taskEnded = (d: Derived, id: TaskId): boolean => {
  const s = d.states.tasks.get(id)
  return s === undefined || s._tag === 'Closed' || s._tag === 'Replaced'
}
// The open top task that follows a direction: where a person assigns a role that it needs.
const topFollowing = (d: Derived, direction: DirectionId): Task | undefined =>
  [...d.moment.work.tasks.values()].find(
    (t) =>
      !taskEnded(d, t.id) &&
      t.serves._tag === 'TopTask' &&
      directionIdsOf(d.moment.work, t.id).includes(direction),
  )

// --- one row for each kind -----------------------------------------------------------------------

const questionRow = (d: Derived, item: Of<'Question'>): string => {
  const w = d.moment.work
  const q = w.questions.get(item.question)
  const state = d.states.questions.get(item.question)
  if (q === undefined || state?._tag !== 'Open') throw new Error(`${item.question} is not open`)
  const answerer = state.answerer
  const to = who(w, answerer)
  const cmd =
    typeof answerer === 'string' ? `work answer <${to} token> ${q.id}` : `work answer ${q.id}`
  return `${q.id} for ${to}: ${short(q.text, 200)}\n    ${cmd} --text="..."`
}

const escalationRow = (d: Derived, item: Of<'Escalation'>): string => {
  const w = d.moment.work
  const r = w.reviews.get(item.escalation)
  const state = d.states.escalations.get(item.escalation)
  if (r?._tag !== 'Escalate' || state?._tag !== 'Open') {
    throw new Error(`${item.escalation} is not an open escalation`)
  }
  const to = who(w, state.answerer)
  return (
    `${r.id} escalated on ${r.of} by ${who(w, r.by, r.id)} for ${to}: ${r.reason}\n` +
    `    work resolve ${typeof state.answerer === 'string' ? `<${to} token> ` : ''}` +
    `${r.id} --resolution="..."`
  )
}

const forwardRow = (d: Derived, item: Of<'Forward'>): string => {
  const w = d.moment.work
  const forward = w.forwards.get(item.forward)
  const logged = w.events.find((l) => `e${l.recorded.seq}` === item.forward)
  const e = logged?.recorded.event
  if (forward?._tag !== 'Confirmable' || logged === undefined || e?._tag !== 'Forward') {
    throw new Error(`${item.forward} is not a confirmable forward`)
  }
  if (!('create' in e)) throw new Error(`${item.forward} is a confirm, not a forward`)
  return (
    `${item.forward} forwarded by ${whoOf(logged.recorded.author).who} for ${e.create.person}: ` +
    `${describeInner(forward.inner, w)}\n` +
    `    their words: "${e.create.quote}"\n    work confirm ${item.forward}`
  )
}

const vetoedRow = (d: Derived, item: Of<'DraftVetoed'>): string => {
  const w = d.moment.work
  const rejected = itemAt(w, item.reject)
  if (rejected === undefined) throw new Error(`the work has no review ${item.reject}`)
  const again = reviseAgainOf(d, item.draft)
  const by = rejected.by
  return (
    `${item.draft} is rejected by ${typeof by === 'string' ? by : by.name}: ` +
    `"${short(rejected.of._tag === 'Revision' ? (rejected.reason ?? '') : '', 120)}"; ` +
    `${again.text}\n    ${again.step ?? `work direction show ${item.draft}`}`
  )
}

// New words of a role (ruling 2026-11-14): a draft for the person, and a rejected draft that
// waits for a newer one of its drafter.
const roleWordsDraftOf = (d: Derived, item: Of<'RoleWords'> | Of<'RoleWordsRejected'>) => {
  const x = roleWordsDraftAt(d.moment.work, item.draft)
  if (x === undefined) throw new Error(`${item.draft} is no draft of the words of a role`)
  return x
}
const roleWordsRow = (d: Derived, item: Of<'RoleWords'>): string => {
  const x = roleWordsDraftOf(d, item)
  return (
    `${item.draft} new words of ${item.role}, drafted by ${drafterWords(x.by)}\n` +
    `    work role show ${item.draft}; work role accept ${item.draft}, ` +
    `or reject ${item.draft} --reason="<why>"`
  )
}
const roleWordsRejectedRow = (d: Derived, item: Of<'RoleWordsRejected'>): string => {
  const x = roleWordsDraftOf(d, item)
  const state = d.states.roleWords.get(item.draft)
  const reason = state?._tag === 'Rejected' ? state.reason : ''
  const draft = `work role draft ${item.role} --file=<words.yaml>`
  const again =
    item.for._tag === 'Assignment'
      ? `its drafter ${item.for.assignment} drafts new words that answer it\n` +
        `    work role draft <token> ${item.role} --file=<words.yaml>`
      : x.by._tag === 'ModelRun'
        ? `its drafter ${drafterWords(x.by)}, drafts new words that answer it\n` +
          `    ${draft} --by=${x.by.name}`
        : `a high role drafts new words that answer it`
  return `${item.draft} (new words of ${item.role}) is rejected: "${short(reason, 120)}"; ${again}`
}

// A draft that waits for a role's accept first names that role, and the assign when no open
// assignment of that role, outside the reviser's tree, can review it.
const roleRow = (d: Derived, item: Of<'DraftForRole'>, direction: DirectionId): string => {
  const { draft, role } = item
  if (item.reviewer._tag === 'Reviewer') {
    return `${draft} waits for the accept of ${item.reviewer.assignment} (${role}) before yours`
  }
  const top = topFollowing(d, direction)
  return (
    `${draft} waits for the accept of ${an(role)} outside the tree of its reviser before yours\n` +
    `    work assign ${top ? top.id : '<task>'} --role=${role}`
  )
}

const personRow = (d: Derived, item: Of<'DraftForPerson'>, direction: DirectionId): string => {
  const w = d.moment.work
  const x = w.drafts.get(item.draft)
  if (x === undefined) throw new Error(`the work has no draft ${item.draft}`)
  const answers = x.answers.length
    ? `; it answers ${x.answers.map((y) => answerText(w, y)).join('; ')}`
    : ''
  const reviews = itemsOf(w, x.id).map((r) => r.decision)
  return (
    `${x.id} drafted for ${direction} by ${drafterOf(w, x)}${answers}; ` +
    `reviews: ${reviews.join(', ') || 'none'}\n` +
    `    work direction show ${x.id}; work review ${x.id} accept ` +
    '[--reason="<a comment>"], or reject --reason="<why>"'
  )
}

const pointsRow = (direction: DirectionId, points: ReadonlyArray<string>): string =>
  `${points.join(', ')} ${points.length > 1 ? 'need' : 'needs'} a change of ${direction}; ` +
  `a high role drafts it, or you suggest it\n    work suggest ${direction} --says="<the change>"`

// A point with no rule on a task can also be answered by the owner's own split of it.
const splitRow = (d: Derived, item: Of<'ChangePoint'>): string | undefined => {
  const w = d.moment.work
  const ref = itemAt(w, item.point)
  const t = taskAt(w, item.task)
  if (ref === undefined || taskOfTarget(w, ref.of) !== t.id) return undefined
  // A task with parts, or with a section (one unit, not split), is remade instead.
  const openParts =
    [...w.tasks.values()].some(
      (p) => p.serves._tag === 'Serves' && p.serves.task === t.id && !taskEnded(d, p.id),
    ) || sectionOf(t.descriptionAi.context) !== null
  return openParts
    ? `${ref.id} can also be answered by your remake of ${t.id}\n` +
        `    work task remake ${t.id} --file=<task.yaml> ` +
        `--reason="<how the scope changed>" --review=${ref.id}`
    : `${ref.id} can also be answered by your split of ${t.id}\n` +
        `    work task split ${t.id} --file=<parts.yaml> --review=${ref.id}`
}

// An evaluation that waits for the owner's accept.
const evaluationRow = (d: Derived, item: Of<'EvaluationForOwner'>): string => {
  const w = d.moment.work
  const pending = w.evaluations.get(item.evaluation)
  if (pending === undefined) throw new Error(`the work has no evaluation ${item.evaluation}`)
  const t = stopTask(w, pending.answers)
  return (
    `${pending.id} evaluates ${t} at the level ${pending.level}, ` +
    'and waits for your accept\n' +
    `    work review ${pending.id} accept --evidence="<where you read> | <what you saw>", ` +
    `or reject --reason="..." (read it in full: work evaluation show ${pending.id})\n` +
    `    wrong: ${short(pending.wrong, 160)}\n    why: ${short(pending.why, 160)}` +
    pending.improve.map((x) => `\n    improve: ${short(x, 160)}`).join('')
  )
}

// Evaluated: the task waits for the change that its evaluation asks for.
const changeOfEvaluationRow = (d: Derived, item: Of<'Stop'>): string | undefined => {
  const w = d.moment.work
  const t = taskAt(w, item.task)
  const e = [...w.evaluations.values()]
    .filter((x) => stopTask(w, x.answers) === t.id && evaluationCounts(w, x))
    .at(-1)
  if (e === undefined) return undefined
  const directions = directionIdsOf(w, t.id)
  return (
    `${t.id} ${t.name} waits for the change that ${e.id} asks for: ` +
    `"${short(e.improve.join('; '), 160)}"\n` +
    (e.level === 'task' || directions.length === 0
      ? `    work task remake ${t.id} --file=<task.yaml> --reason="as ${e.id} says"`
      : `    work suggest ${directions.join('|')} --says="<the change>"; ` +
        'a high role drafts it, and you accept the draft')
  )
}

// The stops of one task that no evaluation was written for, and no high role works on it.
const unwrittenRow = (w: Work, task: TaskId, stops: ReadonlyArray<Of<'Stop'>>): string => {
  const t = taskAt(w, task)
  const highRoles = rolesOfTier(w, (tier) => tier === 'high')
  const top = topOf(w, t)
  return (
    `${t.id} ${t.name} waits for ` +
    (stops.length > 1 ? `${stops.length} evaluations, one for each stop` : 'an evaluation') +
    ', and no high role works on it\n' +
    `    work assign ${top.id} --role=${highRoles.join('|')}, or evaluate it yourself: ` +
    stops
      .map(
        (s) =>
          `work evaluate ${stopIdOf(s.stop)} ` +
          '--wrong="<what is wrong>" --why="<why it cannot be done as asked>" ' +
          '--improve="<one change>" --level=task|standard|direction|principle',
      )
      .join(', then ')
  )
}

const suggestionRow = (d: Derived, item: Of<'Suggestion'>): string => {
  const w = d.moment.work
  const y = w.suggestions.get(item.suggestion)
  if (y === undefined) throw new Error(`the work has no suggestion ${item.suggestion}`)
  // A suggestion that asks for a new direction: no task follows it, so a model run outside any
  // task drafts it (the skill that reads an app), and its owner accepts it. Each person sees it.
  if (item.about._tag === 'NewDirection') {
    return (
      `${y.id} asks for a new direction: "${short(y.says, 120)}" ` +
      `(${who(w, y.by)}); a model drafts it\n` +
      `    work direction new --file=<direction.yaml> --by=<model> --answers=${y.id}`
    )
  }
  const direction = w.directions.get(item.about.direction) as Direction
  // A company direction changes in its repo, with a pull request; the person says OK first.
  if (direction.source._tag === 'External') {
    return (
      `${y.id} suggests about ${aboutId(w, y.about)}: "${short(y.says, 120)}" ` +
      `(${who(w, y.by)}); ${direction.id} is a company direction\n` +
      `    it changes in ${direction.source.repo} (${direction.source.path}), with a pull ` +
      'request; the refresh brings the new commit in'
    )
  }
  const top = topFollowing(d, direction.id)
  const highRoles = rolesOfTier(w, (tier) => tier === 'high')
  return (
    `${y.id} suggests about ${aboutId(w, y.about)}: "${short(y.says, 120)}" ` +
    `(${who(w, y.by)}); no high role works on a task that follows ${direction.id}\n` +
    (top
      ? `    work assign ${top.id} --role=${highRoles.join('|')}`
      : `    no open task follows ${direction.id}; a high role starts on a task that names it`)
  )
}

// A result whose decision waits for a role that no open assignment plays waits for an assign.
const deciderRow = (d: Derived, item: Of<'DecideResult'>): string => {
  const w = d.moment.work
  if (item.leaf._tag !== 'Role') throw new Error(`${item.result} waits for a person, not a role`)
  const role = item.leaf.role
  const t = taskAt(w, resultAt(w, item.result).task)
  const top = topOf(w, t)
  // The person gives work only to medium and high roles: a low decider comes from a lead,
  // whose own next prints the assign.
  if (tierOfRole(w, role) === 'low') {
    const leads = rolesOfTier(w, (tier) => tier !== undefined && tier !== 'low')
    return (
      `${item.result} waits for the accept of ${an(role)}, ` +
      `and no lead works on ${t.id} to give it its work\n` +
      `    work assign ${top.id} --role=${leads.join('|')}`
    )
  }
  return (
    `${item.result} waits for the accept of ${an(role)}, and no ${role} works on ${t.id}\n` +
    `    work assign ${top.id} --role=${role}`
  )
}

// A maker that waits for a file: the file changes one maker after the other. Ruling 10.2: the
// maker before it writes now (one that idles gives up its turn), so nobody finishes it.
const idleAssignmentRow = (d: Derived, item: Of<'IdleAssignment'>): string => {
  const w = d.moment.work
  const y = w.assignments.get(item.assignment)
  const x = w.assignments.get(item.before)
  if (y === undefined || x === undefined) throw new Error(`${item.assignment} waits for no file`)
  return (
    `${y.id} (${y.role} on ${y.task}) waits for ${item.file}: ${x.id} ` +
    `(${x.task} ${w.tasks.get(x.task)?.name}) writes it first`
  )
}

const idleTaskRow = (d: Derived, item: Of<'IdleTask'>): string => {
  const w = d.moment.work
  const t = taskAt(w, item.task)
  const leads = rolesOfTier(w, (tier) => tier !== undefined && tier !== 'low')
  return (
    `${t.id} ${t.name} is ${stateWord(d, t.id)}, and no open assignment works on it\n` +
    `    work assign ${t.id} --role=${leads.join('|') || '<role>'}`
  )
}

const outsideNeedRow = (d: Derived, item: Of<'OutsideNeed'>): string => {
  const w = d.moment.work
  const t = taskAt(w, item.task)
  const n = taskAt(w, item.need)
  return (
    `${t.id} ${t.name} waits for ${n.id} ${n.name} ` +
    `(${stateWord(d, n.id)}), of another task tree\n` +
    `    it moves when ${n.id} is accepted: work task show ${n.id}`
  )
}

// Ruling 10.6: a system problem and the end of a project are rows of work waiting too.
const problemRow = (d: Derived, item: Of<'Problem'>): string => {
  const w = d.moment.work
  const p = w.problems.get(item.problem)
  if (p === undefined) throw new Error(`the work has no problem ${item.problem}`)
  const r = p.recordedBy
  const by = r._tag === 'Host' ? `the host ${r.assignment}` : r.name
  return (
    `${p.id} stops ${p.stopped} ${taskAt(w, p.stopped).name} (recorded by ${by}): ` +
    `${short(p.says, 200)}\n    when it is fixed: work problem ${p.id} --fixed`
  )
}

const endRow = (d: Derived, item: Of<'RunEnd'>): string => {
  const t = taskAt(d.moment.work, item.top)
  return (
    `${item.run} ends: the agent that leads ${t.id} ${t.name} accepted its result\n` +
    `    work run done ${item.run}, or work review ${t.id} reject --point="<your reason>"`
  )
}

// Ruling 10.9: a brief over its limit, with no high role above it: the owner splits the task.
const briefOverRow = (d: Derived, item: Of<'BriefOver'>): string => {
  const w = d.moment.work
  const s = d.states.assignments.get(item.assignment)
  const a = w.assignments.get(item.assignment)
  if (s?._tag !== 'BriefOver' || a === undefined) throw new Error(`${item.assignment} fits`)
  const t = taskAt(w, item.task)
  const directions = directionIdsOf(w, t.id)
  return (
    `${a.id} (${a.role} on ${t.id}) waits: its brief has ${s.size} characters, and the limit ` +
    `of its tier is ${s.limit}; shorten the directions of ${t.id}, or split ${t.id}\n` +
    (directions.length > 0
      ? `    work suggest ${directions.join('|')} --says="<the shorter words>", or `
      : '    ') +
    `work task split ${t.id} --file=<parts.yaml>`
  )
}

// --- the rows ------------------------------------------------------------------------------------

// The rows of work waiting: one string per row, its command lines indented by four.
export const waitingRows = (d: Derived, all: ReadonlyArray<WaitingItem>): ReadonlyArray<string> => {
  const w = d.moment.work
  const items = all.filter((i) => SURFACES[i._tag].cli)
  const of = <K extends WaitingItem['_tag']>(kind: K) =>
    items.filter((i): i is Of<K> => i._tag === kind)
  const rows: Array<string> = []

  rows.push(...of('Question').map((i) => questionRow(d, i)))
  rows.push(...of('Escalation').map((i) => escalationRow(d, i)))
  rows.push(...of('Forward').map((i) => forwardRow(d, i)))

  // The rows of each direction together: the official ones first, then the new ones.
  const points = of('ChangePoint')
  const directions = [...w.directions.values()].sort(
    (a, b) => Number(b._tag === 'Official') - Number(a._tag === 'Official'),
  )
  for (const direction of directions) {
    const mine = (draft: string): boolean => w.drafts.get(draft as never)?.of === direction.id
    rows.push(...of('DraftVetoed').filter((i) => mine(i.draft)).map((i) => vetoedRow(d, i)))
    // One row for each draft that waits for a person, though it may name two (S2).
    const shown = new Set<string>()
    for (const id of d.states.revisions.keys()) {
      const draft = w.drafts.get(id)
      if (draft === undefined || draft.of !== direction.id) continue
      for (const i of of('DraftForRole').filter((x) => x.draft === draft.id)) {
        rows.push(roleRow(d, i, direction.id))
      }
      // The old row waits for the roles first: a draft with a role leaf has no person row.
      const person = of('DraftForPerson').find((x) => x.draft === draft.id)
      const roleFirst = of('DraftForRole').some((x) => x.draft === draft.id)
      if (person !== undefined && !roleFirst && !shown.has(draft.id)) {
        shown.add(draft.id)
        rows.push(personRow(d, person, direction.id))
      }
    }
    const here = points
      .filter((i) => directionIdsOf(w, i.task).includes(direction.id))
      .map((i) => i.point as string)
    if (here.length > 0 && openDrafts(d, direction.id).length === 0) {
      rows.push(pointsRow(direction.id, here))
    }
  }

  for (const i of points) {
    const row = splitRow(d, i)
    if (row !== undefined) rows.push(row)
  }

  rows.push(...of('RoleWords').map((i) => roleWordsRow(d, i)))
  rows.push(...of('RoleWordsRejected').map((i) => roleWordsRejectedRow(d, i)))

  // The stops of one task are together in the items: the evaluations that wait for the owner, then
  // one row for the stops that no one evaluated.
  const stops = items.filter(
    (i): i is Of<'Stop'> | Of<'EvaluationForOwner'> =>
      i._tag === 'Stop' || i._tag === 'EvaluationForOwner',
  )
  const tasksOfStops = [
    ...new Set(
      stops.map((i) =>
        i._tag === 'Stop' ? i.task : stopTask(w, w.evaluations.get(i.evaluation)?.answers as never),
      ),
    ),
  ]
  for (const task of tasksOfStops) {
    const unwritten: Array<Of<'Stop'>> = []
    for (const i of stops) {
      if (i._tag === 'EvaluationForOwner') {
        const e = w.evaluations.get(i.evaluation)
        if (e !== undefined && stopTask(w, e.answers) === task) rows.push(evaluationRow(d, i))
        continue
      }
      if (i.task !== task) continue
      if (stopAnswered(w, i.stop)) {
        const row = changeOfEvaluationRow(d, i)
        if (row !== undefined) rows.push(row)
      } else unwritten.push(i)
    }
    if (unwritten.length > 0) rows.push(unwrittenRow(w, task, unwritten))
  }

  rows.push(...of('Suggestion').map((i) => suggestionRow(d, i)))
  rows.push(...of('DecideResult').map((i) => deciderRow(d, i)))
  rows.push(...of('IdleAssignment').map((i) => idleAssignmentRow(d, i)))
  rows.push(...of('IdleTask').map((i) => idleTaskRow(d, i)))
  rows.push(...of('OutsideNeed').map((i) => outsideNeedRow(d, i)))
  rows.push(...of('BriefOver').map((i) => briefOverRow(d, i)))
  rows.push(...of('Problem').map((i) => problemRow(d, i)))
  rows.push(...of('RunEnd').map((i) => endRow(d, i)))
  return rows.flatMap((r) => r.split('\n'))
}

// The lines of work waiting: the rows, or the line that says nothing waits (for a person).
export const waitingLines = (
  d: Derived,
  items: ReadonlyArray<WaitingItem>,
  forWho: string | null,
): ReadonlyArray<string> => {
  const rows = waitingRows(d, items)
  return rows.length > 0 ? rows : [`nothing waits${forWho ? ` for ${forWho}` : ''}.`]
}

// --- the status ----------------------------------------------------------------------------------

// The open assignments, one row each. C1, I2: an assignment of an ended task, and a settled child
// of an ended parent, are Ended, so no row; the old end of an assignment still showed them.
export const renderStatus = (d: Derived): ReadonlyArray<string> => {
  const w = d.moment.work
  const today = d.moment.at.slice(0, 10)
  const when = (iso: string) =>
    iso.slice(0, 10) === today ? clock(iso) : `${iso.slice(5, 10)} ${clock(iso)}`
  const rows = [...w.assignments.values()]
    .filter((a) => d.states.assignments.get(a.id)?._tag !== 'Ended')
    .map((a) => {
      const claimed = claimOf(w, a.id)
      const max = a._tag === 'Maker' ? maxOf(a.maxAttempts) : undefined
      const attempts = isDo(w, a.role)
        ? ` · attempts ${usedBy(w, a.id)}${max ? `/${max}` : ''}`
        : ''
      const claim = claimed._tag !== 'Free' ? ` · claimed since ${when(claimed.since)}` : ''
      const parent = a.parent._tag === 'Parent' ? ` · parent ${a.parent.id}` : ''
      const role = roleAt(w, a.role)
      const tier = role._tag === 'Model' ? role.tier : 'program'
      return `${a.id} ${a.role} (${tier}) on ${a.task}${attempts}${claim}${parent}`
    })
  return rows.length ? rows : ['no open assignments.']
}
