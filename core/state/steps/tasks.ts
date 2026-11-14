// The steps of a task: open (from a file, or from the host's task draft), remake, split, close,
// and the person's description.
import {
  type Context,
  contextOf,
  type EventOf,
  Moves,
  type PartFile,
  type Stepped,
  type Task,
  type TaskId,
  type Work,
  type Workspace,
} from '../../schema/index.ts'
import { type Act, built, damaged, put, unchanged } from '../act.ts'
import { openTasksWithin, personOf, taskAt } from '../records.ts'

type Seq = { readonly seq: number }

// A workspace entry of a part file, as a task keeps it.
const workspaceOf = (x: NonNullable<PartFile['workspace']>[number]): Workspace =>
  x.base === undefined
    ? { _tag: 'Files', source: x.source, path: x.path, verify: x.verify ?? null }
    : { _tag: 'Repo', source: x.source, path: x.path, base: x.base, verify: x.verify ?? null }
// The context of a part: its task's, with the keys that the part names over it.
const contextWith = (base: Context, more: PartFile['context']): Context => {
  if (more === undefined) return base
  const facts = new Map(base.facts)
  let section = base.section
  for (const [key, value] of Object.entries(more)) {
    if (key === 'section') section = { _tag: 'Section', id: value }
    else facts.set(key as never, value)
  }
  return { section, facts }
}

// A top task, from its file or from the host's task draft (which the draft then names).
export const open = (
  work: Work,
  e: EventOf<'Task.Opened'> | EventOf<'Task.OpenedFromDraft'>,
  act: Act,
  r: Seq,
): Stepped =>
  built(work, (b) => {
    const d = e.create
    const draft = d._tag === 'OpenedFromDraft' ? work.taskDrafts.get(d.draft) : undefined
    const t = d._tag === 'Opened' ? d.task : draft?.task
    if (t === undefined) return damaged(r, 'an open names a task draft that the work does not have')
    const id = b.name('task')
    const task = Moves.openTask({
      id,
      name: t.name,
      owner: personOf(work, act.by),
      descriptionHuman: t.text,
      descriptionAi: {
        text: t.text,
        partOf: null,
        directions: t.directions,
        references: t.references,
        notes: [],
        context: contextOf(t.context),
        from: t.from,
        workspace: t.workspace,
      },
      serves: { _tag: 'TopTask' },
      needs: t.needs,
      when: act.when,
    })
    b.work = { ...b.work, tasks: put(b.work.tasks, id, task) }
    if (draft?.opened._tag === 'NotOpened') {
      const opened = Moves.openTaskDraft({ ...draft, opened: draft.opened }, id)
      b.work = { ...b.work, taskDrafts: put(b.work.taskDrafts, draft.id, opened) }
    }
  })

// The frame of a remake: what the file names, else what the old task had.
const remakeFrame = (w: Work, old: Task, file: EventOf<'Task.Remade'>['move']['file']) => {
  const tree = openTasksWithin(w, old.id).map((t) => t.id)
  const kept = old.needs.filter((n) => !tree.includes(n))
  return {
    tree,
    needs: file.needs._tag === 'Set' ? file.needs.value : kept,
    directions:
      file.directions._tag === 'Set' ? file.directions.value : old.descriptionAi.directions,
    context:
      file.context._tag === 'Set' ? contextOf(file.context.value) : old.descriptionAi.context,
    workspace: file.workspace._tag === 'Set' ? file.workspace.value : old.descriptionAi.workspace,
  }
}
// A change of scope: a new task replaces the old one, and the old task and its open parts end
// as replaced. Each open task that needed the old task needs the new one.
export const remake = (work: Work, e: EventOf<'Task.Remade'>, act: Act): Stepped =>
  built(work, (b) => {
    const d = e.move
    const old = taskAt(work, e.id)
    const frame = remakeFrame(work, old, d.file)
    const id = b.name('task')
    const task = Moves.openTask({
      id,
      name: d.file.name,
      owner: old.owner,
      descriptionHuman: d.file.text,
      descriptionAi: {
        text: d.file.text,
        partOf: null,
        directions: frame.directions,
        references: d.file.references,
        notes: [],
        context: frame.context,
        from: d.file.from,
        workspace: frame.workspace,
      },
      serves: old.serves,
      needs: frame.needs,
      when: act.when,
    })
    let tasks = put(b.work.tasks, id, task)
    for (const t of tasks.values()) {
      if (t.end._tag === 'NotEnded' && t.id !== id && t.needs.includes(old.id)) {
        tasks = put(tasks, t.id, { ...t, needs: t.needs.map((n) => (n === old.id ? id : n)) })
      }
    }
    for (const t of frame.tree) {
      const open = tasks.get(t)
      if (open?.end._tag === 'NotEnded') {
        const replaced = Moves.replaceTask(
          { ...open, end: open.end },
          id,
          act.by,
          d.reason,
          act.when,
        )
        tasks = put(tasks, t, replaced)
      }
    }
    const answers = d.review === null ? [] : [d.review]
    const change = {
      _tag: 'Remake' as const,
      task: old.id,
      answers,
      by: act.by,
      when: act.when,
      at: b.tick(),
    }
    b.work = { ...b.work, tasks, changes: [...b.work.changes, change] }
  })

// A big task becomes smaller tasks that serve it, and the task needs them. Each part waits for
// what its task waits for, and for the parts that it runs after.
export const split = (work: Work, e: EventOf<'Task.Split'>, act: Act): Stepped =>
  built(work, (b) => {
    const d = e.move
    const task = taskAt(work, e.id)
    const answers = d.review === null ? [] : [d.review]
    const change = {
      _tag: 'Split' as const,
      task: task.id,
      answers,
      by: act.by,
      when: act.when,
      at: b.tick(),
    }
    b.work = { ...b.work, changes: [...b.work.changes, change] }
    const made: Array<Task> = []
    for (const p of d.parts) {
      const id = b.name('task')
      const after = (p.after ?? []).flatMap((n) =>
        made.filter((x) => x.name === n).map((x) => x.id),
      )
      const ai = task.descriptionAi
      const part = Moves.openTask({
        id,
        name: p.name,
        owner: task.owner,
        descriptionHuman: p.text,
        descriptionAi: {
          ...ai,
          text: p.text,
          partOf: ai.text,
          context: contextWith(ai.context, p.context),
          from: p.from ?? ai.from,
          workspace: p.workspace ? p.workspace.map(workspaceOf) : ai.workspace,
          references: p.references ?? ai.references,
        },
        serves: { _tag: 'Serves', task: task.id },
        needs: [...task.needs, ...after],
        when: act.when,
      })
      made.push(part)
      b.work = { ...b.work, tasks: put(b.work.tasks, id, part) }
    }
    const parent = { ...task, needs: [...task.needs, ...made.map((x) => x.id)] }
    b.work = { ...b.work, tasks: put(b.work.tasks, task.id, parent) }
  })

// A close ends the task and its open parts.
export const close = (work: Work, e: EventOf<'Task.Closed'>, act: Act): Stepped => {
  let tasks = work.tasks
  for (const t of openTasksWithin(work, e.id)) {
    if (t.end._tag === 'NotEnded') {
      const closed = Moves.closeTask({ ...t, end: t.end }, act.by, e.move.reason, act.when)
      tasks = put(tasks, t.id, closed)
    }
  }
  return unchanged({ ...work, tasks })
}

export const described = (work: Work, e: EventOf<'Task.Described'>, r: Seq): Stepped => {
  const task = work.tasks.get(e.id) ?? damaged(r, `there is no task ${e.id}`)
  const id: TaskId = e.id
  return unchanged({
    ...work,
    tasks: put(work.tasks, id, Moves.MOVES['Task.Described'](task, e.move.text)),
  })
}
