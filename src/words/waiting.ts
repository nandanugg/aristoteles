// What waits, for a person or an assignment, with the command that ends the wait.
// Golden text.
import { type Author, whoOf } from '../domain/actor.ts'
import { sectionOf } from '../domain/context.ts'
import { answererOf } from '../domain/derived.ts'
import type { ConfirmableAct } from '../domain/events.ts'
import type { EventRef, Time } from '../domain/ids.ts'
import type { Direction, Result, Revision, Task } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import { leafName } from '../engine/deciders.ts'
import {
  answered,
  answeredItem,
  blockerItems,
  decisionWaitsOn,
  directionsOf,
  draftWaitsFor,
  evaluationCounts,
  evaluationDecision,
  evaluationWaits,
  isDo,
  madeBy,
  stopAnswered,
  stopKey,
  stopTask,
  stopsOf,
  taskAccepted,
  usedBy,
  vetoOf,
  within,
  workStop,
} from '../engine/queries.ts'
import { revisionState, taskState } from '../engine/status.ts'
import {
  assignmentAt,
  isAssignment,
  type Item,
  itemsOf,
  maxOf,
  officialAt,
  resultAt,
  roleAt,
  taskOfTarget,
} from '../engine/view.ts'
import { fileTurn, idleWhy } from './brief.ts'
import { an, clock, latestResult, short, taskStateWord, who } from './common.ts'
import {
  aboutId,
  answerText,
  drafted,
  describeInner,
  drafterOf,
  followsDirection,
  openDrafts,
  reviseAgainOf,
  stopIdOf,
  suggestionsToDraft,
  tierOfRole,
  waitsForNewDraft,
} from './show.ts'

const rolesOfTier = (work: Work, wanted: (tier: string | undefined) => boolean): string[] =>
  [...work.workflow.roles.values()]
    .filter((r) => wanted(tierOfRole(work, r.role)))
    .map((r) => r.role)

const topOf = (work: Work, t: Task): Task => {
  let top = t
  while (top.serves._tag === 'Serves') top = work.tasks.get(top.serves.task) as Task
  return top
}

// A draft built on the current version of its direction (a new direction: on none).
const builtOnCurrent = (work: Work, x: Revision<Direction>): boolean => {
  const now = officialAt(work, x.of)?.versions.at(-1)?.number
  if (x._tag === 'New') return now === undefined
  return Number(x.base.slice(x.base.lastIndexOf('@') + 1)) === now
}

// A result that still counts: the latest of its open task, which is not accepted.
const isCurrent = (work: Work, result: Result | undefined, at: Time): boolean =>
  result !== undefined &&
  latestResult(work, result.task)?.id === result.id &&
  work.tasks.get(result.task)?.end._tag === 'NotEnded' &&
  !taskAccepted(work, result.task, at)

// A forwarded act that waits for the confirm of its person. work waiting and the page show the
// same ones. A moot act waits no more: its question is answered, its draft decided, its result old.
export interface WaitingForward {
  readonly ref: EventRef
  readonly person: string
  readonly quote: string
  readonly author: Author
  readonly inner: ConfirmableAct
  readonly at: Time
}
export const waitingForwards = (work: Work, at: Time): ReadonlyArray<WaitingForward> =>
  [...work.forwards.values()].flatMap((forward): ReadonlyArray<WaitingForward> => {
    if (forward._tag !== 'Confirmable' || forward.state._tag !== 'Waiting') return []
    const logged = work.events.find((l) => `e${l.recorded.seq}` === forward.event)
    const e = logged?.recorded.event
    if (logged === undefined || e === undefined || e._tag !== 'Forward' || !('create' in e))
      return []
    const inner = forward.inner
    let moot = false
    if (inner._tag === 'Question') {
      moot = 'move' in inner && work.questions.get(inner.id)?.status._tag === 'Answered'
    } else {
      const d = inner.create
      if (d._tag === 'Accept' && d.of._tag === 'Revision') {
        moot = revisionState(work, d.of.id)._tag !== 'Waiting'
      } else if (d._tag === 'Accept' && d.of._tag === 'Result') {
        moot = !isCurrent(work, work.results.get(d.of.id), at)
      } else if (d._tag === 'Resolve') {
        const escalated = work.reviews.get(d.escalation)
        moot = !(
          escalated?._tag === 'Escalate' && isCurrent(work, work.results.get(escalated.of), at)
        )
      }
    }
    if (moot) return []
    const { author, at: when } = logged.recorded
    return [
      { ref: forward.event, person: e.create.person, quote: e.create.quote, author, inner, at: when },
    ]
  })

export const renderWaiting = (
  work: Work,
  forWho: string | null,
  at: Time,
): ReadonlyArray<string> => {
  const rows: Array<string> = []
  const matches = (name: string) => !forWho || name === forWho
  const tasks = [...work.tasks.values()]
  const assignments = [...work.assignments.values()]
  const isOpen = (x: { readonly end: { readonly _tag: string } }) => x.end._tag === 'NotEnded'
  const serves = (p: Task, t: Task) => p.serves._tag === 'Serves' && p.serves.task === t.id
  const current = (result: Result | undefined) => isCurrent(work, result, at)

  for (const q of work.questions.values()) {
    if (q.status._tag !== 'Open') continue
    const answerer = answererOf(work, q.answerBy)
    const to = who(work, answerer)
    if (!matches(to)) continue
    const cmd = isAssignment(answerer) ? `work answer <${to} token> ${q.id}` : `work answer ${q.id}`
    rows.push(`${q.id} for ${to}: ${short(q.text, 200)}\n    ${cmd} --text="..."`)
  }
  const resolved = new Set(
    [...work.reviews.values()].flatMap((r) => (r._tag === 'Resolve' ? [r.escalation] : [])),
  )
  for (const r of work.reviews.values()) {
    if (r._tag !== 'Escalate' || resolved.has(r.id)) continue
    if (!current(resultAt(work, r.of))) continue
    const answerer = answererOf(work, r.answerBy)
    const to = who(work, answerer)
    if (!matches(to)) continue
    rows.push(
      `${r.id} escalated on ${r.of} by ${who(work, r.by, r.id)} for ${to}: ${r.reason}\n` +
        `    work resolve ${isAssignment(answerer) ? `<${to} token> ` : ''}` +
        `${r.id} --resolution="..."`,
    )
  }
  for (const f of waitingForwards(work, at)) {
    if (!matches(f.person)) continue
    rows.push(
      `${f.ref} forwarded by ${whoOf(f.author).who} for ${f.person}: ` +
        `${describeInner(f.inner, work)}\n` +
        `    their words: "${f.quote}"\n    work confirm ${f.ref}`,
    )
  }

  const openTasks = tasks.filter((t) => isOpen(t) && !taskAccepted(work, t.id, at))
  const changePoints: Array<{ t: Task; ref: Item }> = []
  for (const t of openTasks) {
    const result = latestResult(work, t.id)
    if (!result || evaluationWaits(work, t.id) !== undefined) continue
    for (const b of blockerItems(work, result.id, at)) {
      if (b._tag !== 'Change' && b._tag !== 'Reject') continue
      const ref = itemsOf(work, result.id).find((i) => i.id === b.ref)
      if (!ref) continue
      if (b._tag === 'Reject' && (ref.breaks !== undefined || answered(work, ref.id))) continue
      changePoints.push({ t, ref })
    }
  }
  // A Reject of an open task itself is a change point too, with or without a result.
  for (const t of openTasks.filter((x) => evaluationWaits(work, x.id) === undefined)) {
    for (const r of itemsOf(work, t.id)) {
      if (r.decision !== 'Reject' || r.redo || answeredItem(work, r)) continue
      if (changePoints.some(({ ref }) => ref.id === r.id)) continue
      changePoints.push({ t, ref: r })
    }
  }

  const officials = [...work.directions.values()].filter((d) => d._tag === 'Official')
  const fresh = [...work.directions.values()].filter((d) => d._tag === 'NewDirection')
  for (const d of [...officials, ...fresh]) {
    const points = changePoints
      .filter(({ t }) => directionsOf(work, t.id).some((x) => x.id === d.id))
      .map(({ ref }) => ref.id)
    if (!matches(d.owner.name)) continue
    // A draft that a decider rejected ended: its reviser revises again.
    for (const x of work.drafts.values()) {
      if (x.of !== d.id || madeBy(work, x.id) || !builtOnCurrent(work, x)) continue
      const rejected = vetoOf(work, x.id)
      if (rejected === undefined || !waitsForNewDraft(work, x)) continue
      const again = reviseAgainOf(work, x.id)
      const by = rejected.by
      rows.push(
        `${x.id} is rejected by ${typeof by === 'string' ? by : by.name}: ` +
          `"${short(rejected.of._tag === 'Revision' ? rejected.of.reason : '', 120)}"; ` +
          `${again.text}\n    ${again.step ?? `work direction show ${x.id}`}`,
      )
    }
    const drafts = openDrafts(work, d.id)
    for (const x of drafts) {
      // A draft that waits for a role's accept first names that role, and the assign when no
      // open assignment of that role, outside the reviser's tree, can review it.
      const before = draftWaitsFor(work, x.id).filter((leaf) => leaf._tag === 'Role')
      if (before.length) {
        const inTree = (id: string) => {
          if (x.origin._tag !== 'Written' || typeof x.origin.by !== 'string') return false
          for (let z: string | undefined = id; z; ) {
            if (z === x.origin.by) return true
            const p: Task['serves'] | { _tag: 'GivenByPerson' } | { _tag: 'Parent'; id: string } =
              assignmentAt(work, z as never).parent
            z = p._tag === 'Parent' ? p.id : undefined
          }
          return false
        }
        const top = tasks.find(
          (t) =>
            isOpen(t) &&
            t.serves._tag === 'TopTask' &&
            directionsOf(work, t.id).some((z) => z.id === d.id),
        )
        for (const leaf of before) {
          const role = leafName(leaf)
          const reviewer = assignments.find(
            (y) =>
              isOpen(y) &&
              y.role === role &&
              !inTree(y.id) &&
              followsDirection(work, y.id, d.id) &&
              !itemsOf(work, x.id).some((r) => r.by === y.id),
          )
          rows.push(
            reviewer
              ? `${x.id} waits for the accept of ${reviewer.id} (${role}) before yours`
              : `${x.id} waits for the accept of ${an(role)} ` +
                  'outside the tree of its reviser before yours\n' +
                  `    work assign ${top ? top.id : '<task>'} --role=${role}`,
          )
        }
        continue
      }
      const answers = x.answers.length
        ? `; it answers ${x.answers.map((y) => answerText(work, y)).join('; ')}`
        : ''
      const reviews = itemsOf(work, x.id).map((r) => r.decision)
      rows.push(
        `${x.id} drafted for ${d.id} by ${drafterOf(work, x)}${answers}; ` +
          `reviews: ${reviews.join(', ') || 'none'}\n` +
          `    work direction show ${x.id}; work review ${x.id} accept ` +
          '[--reason="<a comment>"], or reject --reason="<why>"',
      )
    }
    if (points.length && drafts.length === 0) {
      rows.push(
        `${points.join(', ')} ${points.length > 1 ? 'need' : 'needs'} a change of ${d.id}; ` +
          'a high role drafts it, ' +
          `or you suggest it\n    work suggest ${d.id} --says="<the change>"`,
      )
    }
  }

  // A point with no rule on a task can also be answered by the owner's own split of it.
  const splitShown = new Set<string>()
  for (const { t, ref } of changePoints) {
    if (taskOfTarget(work, ref.of) !== t.id || !matches(t.owner.name) || splitShown.has(ref.id)) {
      continue
    }
    splitShown.add(ref.id)
    // A task with parts, or with a section (one unit, not split), is remade instead.
    const openParts =
      tasks.some((p) => serves(p, t) && isOpen(p)) || sectionOf(t.descriptionAi.context) !== null
    rows.push(
      openParts
        ? `${ref.id} can also be answered by your remake of ${t.id}\n` +
            `    work task remake ${t.id} --file=<task.yaml> ` +
            `--reason="<how the scope changed>" --review=${ref.id}`
        : `${ref.id} can also be answered by your split of ${t.id}\n` +
            `    work task split ${t.id} --file=<parts.yaml> --review=${ref.id}`,
    )
  }

  // An evaluation of a direction or a principle waits for the owner's accept; a task that waits
  // for an evaluation, with no high role in its tree, waits for the person's assign (or own
  // evaluation).
  const highRoles = rolesOfTier(work, (tier) => tier === 'high')
  for (const t of openTasks.filter((x) => matches(x.owner.name) && workStop(work, x.id, at))) {
    // Each stop gets its own evaluation, so each stop that waits gets its own row.
    const stops = stopsOf(work, t.id).filter((x) => !stopAnswered(work, x))
    const waits = stops[0]
    const highOpen = assignments.some(
      (x) => isOpen(x) && tierOfRole(work, x.role) === 'high' && within(work, t.id, x.task),
    )
    const top = topOf(work, t)
    if (!waits) {
      // Evaluated: the task waits for the change that its evaluation asks for.
      const e = [...work.evaluations.values()]
        .filter((x) => stopTask(work, x.answers) === t.id && evaluationCounts(work, x))
        .at(-1)
      const changing =
        tasks.some((p) => serves(p, t) && isOpen(p)) ||
        directionsOf(work, t.id).some((d) => openDrafts(work, d.id).length > 0)
      if (!e || changing) continue
      const directions = directionsOf(work, t.id)
      rows.push(
        `${t.id} ${t.name} waits for the change that ${e.id} asks for: ` +
          `"${short(e.improve.join('; '), 160)}"\n` +
          (e.level === 'task' || directions.length === 0
            ? `    work task remake ${t.id} --file=<task.yaml> --reason="as ${e.id} says"`
            : `    work suggest ${directions.map((d) => d.id).join('|')} --says="<the change>"; ` +
              'a high role drafts it, and you accept the draft'),
      )
      continue
    }
    const unwritten = []
    for (const stop of stops) {
      const pending = [...work.evaluations.values()]
        .filter(
          (e) =>
            stopKey(work, e.answers) === stopKey(work, stop) &&
            !evaluationDecision(work, e) &&
            !evaluationCounts(work, e),
        )
        .at(-1)
      if (!pending) {
        unwritten.push(stop)
        continue
      }
      rows.push(
        `${pending.id} evaluates ${t.id} at the level ${pending.level}, ` +
          'and waits for your accept\n' +
          `    work review ${pending.id} accept --evidence="<where you read> | <what you saw>", ` +
          `or reject --reason="..." (read it in full: work evaluation show ${pending.id})\n` +
          `    wrong: ${short(pending.wrong, 160)}\n    why: ${short(pending.why, 160)}` +
          pending.improve.map((x) => `\n    improve: ${short(x, 160)}`).join(''),
      )
    }
    if (highOpen || !unwritten.length) continue
    rows.push(
      `${t.id} ${t.name} waits for ` +
        (unwritten.length > 1
          ? `${unwritten.length} evaluations, one for each stop`
          : 'an evaluation') +
        ', and no high role works on it\n' +
        `    work assign ${top.id} --role=${highRoles.join('|')}, or evaluate it yourself: ` +
        unwritten
          .map(
            (stop) =>
              `work evaluate ${stopIdOf(work, stop)} ` +
              '--wrong="<what is wrong>" --why="<why it cannot be done as asked>" ' +
              '--improve="<one change>" --level=task|standard|direction|principle',
          )
          .join(', then '),
    )
  }

  // A suggestion that no open high role can answer: the person assigns one on a task that
  // follows its direction.
  for (const { y, d } of suggestionsToDraft(work).filter((x) => matches(x.d.owner.name))) {
    // A company direction changes in its repo, with a pull request; the person says OK first.
    if (d.source._tag === 'External') {
      rows.push(
        `${y.id} suggests about ${aboutId(work, y.about)}: "${short(y.says, 120)}" ` +
          `(${who(work, y.by)}); ${d.id} is a company direction\n` +
          `    it changes in ${d.source.repo} (${d.source.path}), with a pull request; ` +
          'the refresh brings the new commit in',
      )
      continue
    }
    const highWorks = assignments.some(
      (x) => isOpen(x) && tierOfRole(work, x.role) === 'high' && followsDirection(work, x.id, d.id),
    )
    if (highWorks) continue
    const top = tasks.find(
      (t) =>
        isOpen(t) &&
        t.serves._tag === 'TopTask' &&
        directionsOf(work, t.id).some((z) => z.id === d.id),
    )
    rows.push(
      `${y.id} suggests about ${aboutId(work, y.about)}: "${short(y.says, 120)}" ` +
        `(${who(work, y.by)}); no high role works on a task that follows ${d.id}\n` +
        (top
          ? `    work assign ${top.id} --role=${highRoles.join('|')}`
          : `    no open task follows ${d.id}; a high role starts on a task that names it`),
    )
  }
  // A suggestion that asks for a new direction: no task follows it, so a model run outside any
  // task drafts it (the skill that reads an app), and its owner accepts it. Each person sees it.
  if (!forWho || work.config.people.includes(forWho)) {
    for (const y of work.suggestions.values()) {
      if (y.about._tag !== 'NewDirection' || drafted(work, y.id)) continue
      rows.push(
        `${y.id} asks for a new direction: "${short(y.says, 120)}" ` +
          `(${who(work, y.by)}); a model drafts it\n` +
          `    work direction new --file=<direction.yaml> --by=<model> --answers=${y.id}`,
      )
    }
  }

  // A result whose decision waits for a role that no open assignment plays waits for an assign.
  const deciderTags = ['DeciderWaits', 'DeciderAnyApprover', 'DeciderAcceptedUnderOld']
  for (const t of openTasks.filter((x) => matches(x.owner.name))) {
    const result = latestResult(work, t.id)
    if (!result) continue
    if (!blockerItems(work, result.id, at).every((i) => deciderTags.includes(i._tag))) continue
    for (const leaf of decisionWaitsOn(work, result.id)) {
      if (leaf._tag !== 'Role') continue
      const role = leaf.role
      if (assignments.some((x) => isOpen(x) && x.role === role && within(work, t.id, x.task))) {
        continue
      }
      const top = topOf(work, t)
      // The person gives work only to medium and high roles: a low decider comes from a lead,
      // whose own next prints the assign.
      if (tierOfRole(work, role) === 'low') {
        const leadWorks = assignments.some(
          (x) => isOpen(x) && tierOfRole(work, x.role) !== 'low' && within(work, t.id, x.task),
        )
        if (leadWorks) continue
        const leads = rolesOfTier(work, (tier) => tier !== undefined && tier !== 'low')
        rows.push(
          `${result.id} waits for the accept of ${an(role)}, ` +
            `and no lead works on ${t.id} to give it its work\n` +
            `    work assign ${top.id} --role=${leads.join('|')}`,
        )
        continue
      }
      rows.push(
        `${result.id} waits for the accept of ${an(role)}, and no ${role} works on ${t.id}\n` +
          `    work assign ${top.id} --role=${role}`,
      )
    }
  }

  // A maker that waits for a file: the file changes one maker after the other. When the maker
  // before it makes no more results and has no parent (the person gave it its work), the person
  // finishes it.
  for (const y of assignments) {
    const task = work.tasks.get(y.task)
    if (!isOpen(y) || task?.end._tag !== 'NotEnded' || !matches(task.owner.name)) continue
    const waits = fileTurn(work, y.id, at)
    if (!waits) continue
    const x = assignmentAt(work, waits.before)
    const done = idleWhy(work, x.id, at)
    rows.push(
      `${y.id} (${y.role} on ${y.task}) waits for ${waits.file}: ${x.id} ` +
        `(${x.task} ${work.tasks.get(x.task)?.name}) writes it first` +
        (done && x.parent._tag === 'GivenByPerson'
          ? `, and makes no more results\n    work finish ${x.id}`
          : ''),
    )
  }

  // A task that is not done, and that no open assignment works on, waits for an assign.
  const idle = openTasks.filter(
    (t) => !assignments.some((x) => isOpen(x) && within(work, t.id, x.task)),
  )
  const leads = rolesOfTier(work, (tier) => tier !== undefined && tier !== 'low')
  const parentIdle = (t: Task) =>
    t.serves._tag === 'Serves' && idle.some((i) => i.id === (t.serves as { task: string }).task)
  for (const t of idle.filter((x) => !parentIdle(x) && matches(x.owner.name))) {
    rows.push(
      `${t.id} ${t.name} is ${taskStateWord(taskState(work, t.id, at))}, ` +
        'and no open assignment works on it\n' +
        `    work assign ${t.id} --role=${leads.join('|') || '<role>'}`,
    )
  }

  // A task that needs a task of another tree waits for that tree, which its own agents cannot
  // move. A part that runs after another part of its own tree is the lead's to show.
  for (const t of openTasks.filter((x) => matches(x.owner.name))) {
    for (const id of t.needs) {
      const n = work.tasks.get(id)
      if (!n || !isOpen(n)) continue
      if (topOf(work, n).id === topOf(work, t).id || taskAccepted(work, n.id, at)) continue
      rows.push(
        `${t.id} ${t.name} waits for ${n.id} ${n.name} ` +
          `(${taskStateWord(taskState(work, n.id, at))}), of another task tree\n` +
          `    it moves when ${n.id} is accepted: work task show ${n.id}`,
      )
    }
  }
  return rows.length
    ? rows.flatMap((r) => r.split('\n'))
    : [`nothing waits${forWho ? ` for ${forWho}` : ''}.`]
}

export const renderStatus = (work: Work, at: Time): ReadonlyArray<string> => {
  const today = at.slice(0, 10)
  const when = (iso: string) =>
    iso.slice(0, 10) === today ? clock(iso) : `${iso.slice(5, 10)} ${clock(iso)}`
  const rows = [...work.assignments.values()]
    .filter((a) => a.end._tag === 'NotEnded')
    .map((a) => {
      const meta = work.meta.get(a.id)
      const max = a._tag === 'Maker' ? maxOf(a.maxAttempts) : undefined
      const attempts = isDo(work, a.role)
        ? ` · attempts ${usedBy(work, a.id)}${max ? `/${max}` : ''}`
        : ''
      const claim =
        meta && meta.claim._tag !== 'Free' ? ` · claimed since ${when(meta.claim.since)}` : ''
      const parent = a.parent._tag === 'Parent' ? ` · parent ${a.parent.id}` : ''
      const role = roleAt(work, a.role)
      const tier = role._tag === 'Model' ? role.tier : 'program'
      return `${a.id} ${a.role} (${tier}) on ${a.task}${attempts}${claim}${parent}`
    })
  return rows.length ? rows : ['no open assignments.']
}
