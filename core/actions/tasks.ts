// The actions of tasks and assignments: open, split, remake, close, describe; give, free,
// finish, brief, with the checks that read the content of an act.
import { realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { Effect } from 'effect'
import type { Derived } from '../derived/index.ts'
import {
  currentTask,
  directionIdsOf,
  isDo,
  isOpenTask,
  itemAt,
  latestResultOf,
  maxOf,
  reviewItems,
  roleAt,
  standardAt,
  tierOf,
  untouchedOf,
  within,
} from '../derived/reads.ts'
import { fileTurn } from '../derived/steps.ts'
import type { Refusal } from '../schema/errors.ts'
import {
  type Context,
  type ContextKey,
  contextOf,
  create,
  currentVersion,
  type Event,
  lookup,
  move,
  type PartFile,
  PositiveInt,
  remakeDataOf,
  type RoleName,
  type Snapshot,
  sectionOf,
  type TaskData,
  taskDataOf,
  type TaskId,
  valueAt,
  type TaskFile,
  type Workspace,
} from '../schema/index.ts'
import {
  checkWorkspace,
  Files,
  readTask,
  roleHash,
  sectionsOf,
  sha,
  snapshotOf,
} from '../services/index.ts'
import {
  agentOf,
  allowed,
  asPick,
  asWrite,
  blank,
  configUnchanged,
  current,
  no,
  readText,
  readYaml,
  type RefusalsOf,
  tierOfAgent,
  upTo,
} from './support.ts'
import { outputForm } from './output.ts'
import { taskDirections } from './runs.ts'
import type { Action } from './types.ts'

export const REFUSALS = {
  OpenTask: {
    closedNeed: (need: string) =>
      no(`${need} is closed; a task does not need a closed task`, 'Pick', 'need an open task'),
    noResult: (result: string) =>
      no(`there is no result ${result}`, 'Pick', 'start from a result that exists'),
  },
  OpenTaskFromDraft: {
    unknownRole: (draft: string, role: string) =>
      no(`${draft} names the role "${role}", which does not exist`, 'Pick', 'open another draft'),
    noFit: (role: string, draft: string) =>
      no(
        `${role} has no fit record for its current words`,
        'Wait',
        `open ${draft} after the fit of ${role} is recorded`,
      ),
    closedNeed: (need: string) =>
      no(
        `${need} is closed; a task does not need a closed task`,
        'Pick',
        'the host drafts the top task again with open needs',
      ),
  },
  SplitTask: {
    notParts: (file: string) =>
      no(`${file} must be a list of parts`, 'Write', `write the parts as a list in ${file}`),
    ownSection: (task: string, section: string) =>
      no(
        `${task} has the section ${section}, so it is one unit of work; it is not split`,
        'Pick',
        `run ${task} with a medium role, or remake it with no section`,
      ),
    badPart: (message: string, file: string) =>
      no(message, 'Write', `correct the parts in ${file}`),
    sharedFile: (message: string, task: string) =>
      no(
        message,
        'Write',
        `give each part its own section (context: { section: <heading id> }), or run ${task} ` +
          'as one task',
      ),
    notReject: (id: string) =>
      no(
        `${id} is not a Reject; a split answers a Reject (v<n>) or one point of it (v<n>.<m>)`,
        'Pick',
        'name a Reject or a point',
      ),
  },
  RemakeTask: {
    noReason: () =>
      no('a remake needs a reason', 'Write', 'write how the scope changed, with --reason'),
    closedNeed: (need: string) =>
      no(`${need} is closed; a task does not need a closed task`, 'Pick', 'need an open task'),
    noResult: (result: string) =>
      no(`there is no result ${result}`, 'Pick', 'start from a result that exists'),
    agentKeeps: (task: string) =>
      no(
        `an agent's remake keeps the directions, the context, and the workspace of ${task}; ` +
          'only the person changes them (leave them out of the file, and the remake keeps them)',
        'Write',
        'leave the directions, the context and the workspace out of the file',
      ),
    agentDrops: (task: string, need: string) =>
      no(
        `an agent's remake keeps the needs of ${task}; it may add a need, but only the person ` +
          `drops ${need}`,
        'Write',
        `keep ${need} in the needs of the file`,
      ),
    sameScope: (task: string) =>
      no(
        `the remake of ${task} says what ${task} says; a remake changes its scope: the text, ` +
          'the needs, the directions, the context, the workspace, or the references',
        'Write',
        'write the new scope in the file',
      ),
    cycle: (name: string, needs: string) =>
      no(
        `a cycle of needs: the new ${name} would need itself through ${needs}`,
        'Write',
        'drop the need that leads back into the task',
      ),
    notReject: (id: string) =>
      no(
        `${id} is not a Reject; a remake answers a Reject (v<n>) or one point of it (v<n>.<m>)`,
        'Pick',
        'name a Reject or a point',
      ),
  },
  CloseTask: {
    noReason: () =>
      no('a close needs a reason', 'Write', 'write why the task closes, with --reason'),
  },
  DescribeTask: {
    noText: (task: string) =>
      no(
        `work task describe ${task} --text="<the task, in words for people>"`,
        'Write',
        `write the description of ${task} for people`,
      ),
  },
  Give: {
    noFit: (role: string) =>
      no(
        `${role} has no fit record for its current words`,
        'Wait',
        `give the work after the fit of ${role} is recorded`,
      ),
    noWorkspace: (task: string, role: string, output: string) =>
      no(
        `${task} names no workspace, and ${role} writes ${output}; the person opens the task ` +
          'with its workspace (work task remake)',
        'Escalate',
        `the person remakes ${task} with its workspace`,
      ),
    reviewerAttempts: (role: string) =>
      no(
        `${role} makes no result, so it has no attempts; a limit of attempts is for a role that ` +
          'makes',
        'Pick',
        'give it with no limit of attempts',
      ),
    overCeiling: (asked: string, tier: string, ceiling: string) =>
      no(
        `maxAttempts ${asked} is over the ${tier} limit of ${ceiling}`,
        'Pick',
        `give at most ${ceiling} attempts`,
      ),
  },
  Free: {},
  Finish: {},
  Brief: {
    // Ruling 10.2: the turn passes by itself (an accept, or an idle holder), not at a finish.
    waitsForFile: (a: string, file: string, before: string, task: string, up: string) =>
      no(
        `${a} waits for ${file}: ${before} (${task}) writes it first, and one maker writes a ` +
          'file at a time',
        'Wait',
        `STOP and do not change ${file}; ${up} starts you again when it is your turn`,
      ),
  },
} satisfies Readonly<Record<string, RefusalsOf>>
const R = REFUSALS

const fail = <A = never>(r: Refusal): Effect.Effect<A, Refusal> => Effect.fail(r)

// --- the content of a task file ------------------------------------------------------------------

// N2 (I3): a need that was remade is the task that replaced it; a need that closed is refused.
export const needsNow = (
  d: Derived,
  needs: ReadonlyArray<TaskId>,
  closed: (need: string) => Refusal,
): Effect.Effect<ReadonlyArray<TaskId>, Refusal> =>
  Effect.gen(function* () {
    const w = d.moment.work
    const out: Array<TaskId> = []
    for (const id of needs) {
      yield* lookup(w, id, ['t']).pipe(Effect.mapError(asPick))
      const now = currentTask(w, id)
      const t = w.tasks.get(now)
      if (t === undefined || !isOpenTask(t)) return yield* fail(closed(id))
      if (!out.includes(now)) out.push(now)
    }
    return out
  })
export const followNeeds = (d: Derived, task: TaskData, closed: (need: string) => Refusal) =>
  Effect.map(needsNow(d, task.needs, closed), (needs) => ({ ...task, needs }))

// One file has one name in the store: a workspace path through a link, or in another case than
// on disk, is refused with its real name (realpath: the one read of the disk that Files lacks).
export const checkRealNames = (
  cwd: string,
  workspace: ReadonlyArray<{ readonly path: string }>,
): Effect.Effect<void, Refusal, Files> =>
  Effect.gen(function* () {
    const files = yield* Files
    const real = (p: string) => realpathSync.native(p)
    const root = real(cwd)
    for (const w of workspace) {
      let known = w.path
      while (known !== '.' && (yield* files.kind(join(cwd, known))) === null) known = dirname(known)
      if (known === '.') continue
      const onDisk = relative(root, real(join(cwd, known)))
      if (onDisk.startsWith('..') || isAbsolute(onDisk)) {
        return yield* fail(WORKSPACE.outside(w.path))
      }
      const name = known === w.path ? onDisk : join(onDisk, relative(known, w.path))
      if (name !== w.path) return yield* fail(WORKSPACE.realName(w.path, name))
    }
  })
// On a disk that ignores case, two names that differ only in case are one file.
export const checkCaseTwins = (
  d: Derived,
  workspace: ReadonlyArray<{ readonly path: string }>,
): Effect.Effect<void, Refusal> => {
  const lower = (x: string) => x.toLowerCase()
  const near = (x: string, y: string) => x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)
  const names = [...d.moment.work.tasks.values()]
    .filter(isOpenTask)
    .flatMap((t) => t.descriptionAi.workspace.map((w) => w.path))
  for (const w of workspace) {
    const twin = names.find((n) => near(lower(n), lower(w.path)) && !near(n, w.path))
    if (twin) return fail(WORKSPACE.caseTwin(w.path, twin))
  }
  return Effect.void
}
export const WORKSPACE = {
  outside: (path: string) =>
    no(`workspace ${path} leads outside the dir`, 'Write', 'name a workspace inside the dir'),
  realName: (path: string, name: string) =>
    no(
      `workspace ${path} is ${name} on disk; name it ${name}, so that one file has one name`,
      'Write',
      `name the workspace ${name}`,
    ),
  caseTwin: (path: string, twin: string) =>
    no(
      `workspace ${path} and ${twin} differ only in case, and on many disks they are one file; ` +
        `write it as ${twin} has it`,
      'Write',
      `write the workspace as ${twin}`,
    ),
} satisfies RefusalsOf

// The Reject (or one point of it) that a split or a remake answers.
const answersARejection = (d: Derived, id: string | null, notReject: (id: string) => Refusal) =>
  Effect.gen(function* () {
    if (id === null) return
    const w = d.moment.work
    if (reviewItems(w).some((i) => i.group === id)) return
    yield* lookup(w, id, ['v']).pipe(Effect.mapError(asPick))
    if (itemAt(w, id)?.review._tag !== 'Reject') return yield* fail(notReject(id))
  })

// --- tasks ---------------------------------------------------------------------------------------

const OpenTask: Action<'OpenTask'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const w = d.moment.work
    const cwd = d.moment.outside.cwd
    const { file } = input.content
    const read = yield* readTask(file, yield* readText(cwd, file), taskDirections(w)).pipe(
      Effect.mapError(asWrite(file)),
    )
    yield* checkRealNames(cwd, read.workspace)
    yield* checkCaseTwins(d, read.workspace)
    const task = yield* followNeeds(d, taskDataOf(read), R.OpenTask.closedNeed)
    if (task.from !== null && !w.results.has(task.from)) {
      return yield* fail(R.OpenTask.noResult(task.from))
    }
    return [create('Task', { _tag: 'Opened', task })]
  })

// The person opens a host's draft; the adapter then gives it to the draft's role, and grants
// that role a change of it (D11: three actions in order).
const OpenTaskFromDraft: Action<'OpenTaskFromDraft'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const w = d.moment.work
    const draft = w.taskDrafts.get(input.target.draft)
    if (draft === undefined) return yield* Effect.die('canAct names the draft')
    const role = w.workflow.roles.get(draft.role as RoleName)
    if (role === undefined) {
      return yield* fail(R.OpenTaskFromDraft.unknownRole(draft.id, draft.role))
    }
    const file = w.config.roles[role.role]
    if (file !== undefined && w.fits.get(role.role)?.hash !== roleHash(file)) {
      return yield* fail(R.OpenTaskFromDraft.noFit(role.role, draft.id))
    }
    yield* needsNow(d, draft.task.needs, R.OpenTaskFromDraft.closedNeed)
    return [create('Task', { _tag: 'OpenedFromDraft', draft: draft.id })]
  })

// The parts of a split as the stored event keeps them, checked like a task file. A part keeps
// its task's context; N7 (I4): a part with an empty workspace keeps its task's workspace.
const checkParts = (d: Derived, task: TaskId, raw: unknown, file: string) =>
  Effect.gen(function* () {
    const w = d.moment.work
    const cwd = d.moment.outside.cwd
    const files = yield* Files
    const t = w.tasks.get(task)
    if (t === undefined) return yield* Effect.die('canAct names the task')
    if (!Array.isArray(raw) || raw.length === 0) return yield* fail(R.SplitTask.notParts(file))
    const bad = (message: string) => fail(R.SplitTask.badPart(message, file))
    const ownSection = sectionOf(t.descriptionAi.context) ?? undefined
    if (ownSection) return yield* fail(R.SplitTask.ownSection(task, ownSection))
    const used = new Set<string>(
      directionIdsOf(w, task).flatMap((id) => {
        const x = w.directions.get(id)
        if (x?._tag !== 'Official') return []
        return currentVersion(x).standards.flatMap((e) => {
          const where = standardAt(w, e).where
          return where._tag === 'Where' ? [...where.conditions.keys()] : []
        })
      }),
    )
    const own = t.descriptionAi.workspace
    const parts: Array<Record<string, unknown>> = []
    for (const value of raw) {
      const p = { ...(value as Record<string, unknown>) }
      const name = p.name
      if (!name || !p.text) return yield* bad(`each part in ${file} needs a name and a text`)
      if (p.maxRounds !== undefined) {
        return yield* bad(
          `part ${String(name)}: maxRounds is gone; when the tries of a maker end on a fault, ` +
            'the high role evaluates the mistake',
        )
      }
      if (p.from !== undefined) {
        yield* lookup(w, String(p.from), ['r']).pipe(Effect.mapError(asPick))
      }
      if (p.after !== undefined && !Array.isArray(p.after)) {
        return yield* bad(
          `part ${String(name)}: after is a list of part names, like after: [Schema]`,
        )
      }
      const above: Array<unknown> = parts.map((x) => x.name)
      if (above.includes(name)) {
        return yield* bad(
          `two parts in ${file} are named ${String(name)}; each part needs its own name`,
        )
      }
      const unknown = ((p.after ?? []) as Array<unknown>).find((n) => !above.includes(n))
      if (unknown !== undefined) {
        return yield* bad(
          `part ${String(name)}: after names "${String(unknown)}", which is not a part above ` +
            `it in ${file}`,
        )
      }
      for (const [key, v] of Object.entries((p.context ?? {}) as Record<string, unknown>)) {
        if (!used.has(key) && key !== 'section') {
          return yield* bad(
            `part ${String(name)}: context key "${key}" is used by no "when" of its directions`,
          )
        }
        if (typeof v !== 'string') {
          return yield* bad(
            `part ${String(name)}: context ${key} is a text, like ${key}: introduction`,
          )
        }
        const was = valueAt(t.descriptionAi.context, key as ContextKey)
        if (was !== undefined && was !== v) {
          return yield* bad(
            `part ${String(name)} changes the context ${key} from ${was} to ${v}; a part keeps ` +
              'the rules of its task',
          )
        }
      }
      // N7: an empty workspace is no workspace: the part keeps its task's.
      if (Array.isArray(p.workspace) && p.workspace.length === 0) delete p.workspace
      if (p.workspace !== undefined && !Array.isArray(p.workspace)) {
        return yield* bad(`part ${String(name)}: workspace is a list, like its task's`)
      }
      if (p.workspace) {
        const space = p.workspace as TaskFile['workspace']
        yield* checkWorkspace(`part ${String(name)}`, space).pipe(Effect.mapError(asWrite(file)))
        for (const x of space) {
          const same = own.some(
            (o) =>
              o.source === x.source &&
              o.path === x.path &&
              (o._tag === 'Repo' ? o.base : undefined) === x.base,
          )
          if (!same) {
            return yield* bad(
              `part ${String(name)}: workspace ${x.path} is not one of its task's ` +
                `(${own.map((o) => o.path).join(', ') || 'none'}), with the same base`,
            )
          }
        }
      }
      parts.push(p)
    }
    // In one document file, every part has its own section, and no section lies inside another.
    const partSection = (p: Record<string, unknown>): string | undefined =>
      ((p.context ?? {}) as Record<string, string | undefined>).section ?? ownSection
    const filesOf = (p: Record<string, unknown>): ReadonlyArray<string> =>
      ((p.workspace ?? own) as ReadonlyArray<{ readonly path: string }>).map((x) => x.path)
    for (const f of new Set(parts.flatMap(filesOf))) {
      const sharing = parts.filter((p) => filesOf(p).includes(f))
      if ((yield* files.kind(join(cwd, f))) === 'folder') continue
      const bare = sharing.filter((p) => !partSection(p))
      if (sharing.length > 1 && bare.length) {
        const names = (list: ReadonlyArray<Record<string, unknown>>) =>
          list.map((p) => String(p.name)).join(', ')
        return yield* fail(
          R.SplitTask.sharedFile(
            `the parts ${names(sharing)} share ${f}, and ${names(bare)} ` +
              `${bare.length > 1 ? 'have' : 'has'} no section; each part needs its own section ` +
              'of the file, so no part changes the work of another',
            task,
          ),
        )
      }
      const text = yield* files.read(join(cwd, f))
      const heads = text === null ? [] : sectionsOf(text)
      const span = (p: Record<string, unknown>) => heads.find((h) => h.slug === partSection(p))
      const inside = (p: Record<string, unknown>, q: Record<string, unknown>) => {
        const a = span(p)
        const b = span(q)
        return q !== p && a !== undefined && b !== undefined && a.start > b.start && a.start < b.end
      }
      const inner = sharing.find((p) => sharing.some((q) => inside(p, q)))
      if (inner) {
        const outer = sharing.find((q) => inside(inner, q))
        return yield* bad(
          `the section ${partSection(inner)} of ${f} lies inside the section ` +
            `${outer === undefined ? '' : partSection(outer)}; two parts may not own one piece ` +
            'of the file',
        )
      }
      const twin = sharing.find(
        (p, i) =>
          partSection(p) && sharing.findIndex((q) => partSection(q) === partSection(p)) !== i,
      )
      if (twin) {
        return yield* fail(
          R.SplitTask.sharedFile(
            `two parts of ${task} have the section ${partSection(twin)} of ${f}; a section is ` +
              'the work of one task',
            task,
          ),
        )
      }
    }
    // The keys that a part may have, as the stored event keeps them.
    return parts.map(
      (p) =>
        ({
          name: p.name,
          text: p.text,
          ...(p.context !== undefined ? { context: p.context } : {}),
          ...(p.from !== undefined ? { from: String(p.from) } : {}),
          ...(p.workspace !== undefined ? { workspace: p.workspace } : {}),
          ...(p.references !== undefined ? { references: p.references } : {}),
          ...(p.after !== undefined ? { after: p.after } : {}),
        }) as unknown as PartFile,
    )
  })

const SplitTask: Action<'SplitTask'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const { task, answers } = input.target
    const { file } = input.content
    const raw = yield* readYaml(d.moment.outside.cwd, file)
    const parts = yield* checkParts(d, task, raw, file)
    yield* answersARejection(d, answers, R.SplitTask.notReject)
    const [first, ...others] = parts
    if (first === undefined) return yield* Effect.die('checkParts gives at least one part')
    return [move('Task', task, { _tag: 'Split', parts: [first, ...others], review: answers })]
  })

const sameSet = <A>(x: ReadonlyArray<A>, y: ReadonlyArray<A>) =>
  x.length === y.length && x.every((v) => y.includes(v))
const spaceKey = (list: ReadonlyArray<Workspace>) =>
  JSON.stringify(
    list.map((x) => [x.source, x.path, x._tag === 'Repo' ? x.base : null, x.verify]).sort(),
  )

const RemakeTask: Action<'RemakeTask'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const w = d.moment.work
    const cwd = d.moment.outside.cwd
    const { task, answers } = input.target
    const { file, reason } = input.content
    const read = yield* readTask(file, yield* readText(cwd, file), taskDirections(w)).pipe(
      Effect.mapError(asWrite(file)),
    )
    yield* checkRealNames(cwd, read.workspace)
    yield* checkCaseTwins(d, read.workspace)
    yield* answersARejection(d, answers, R.RemakeTask.notReject)
    if (blank(reason)) return yield* fail(R.RemakeTask.noReason())
    const data = remakeDataOf(read)
    const needs =
      data.needs._tag === 'Set'
        ? {
            _tag: 'Set' as const,
            value: yield* needsNow(d, data.needs.value, R.RemakeTask.closedNeed),
          }
        : data.needs
    if (data.from !== null && !w.results.has(data.from)) {
      return yield* fail(R.RemakeTask.noResult(data.from))
    }
    // The frame: what the file names, else what the old task had.
    const old = w.tasks.get(task)
    if (old === undefined) return yield* Effect.die('canAct names the task')
    const was = old.descriptionAi
    const tree = [...w.tasks.values()]
      .filter((t) => isOpenTask(t) && within(w, t.id, task))
      .map((t) => t.id)
    const kept = old.needs.filter((n) => !tree.includes(n))
    const frameNeeds = needs._tag === 'Set' ? needs.value : kept
    const directions = data.directions._tag === 'Set' ? data.directions.value : was.directions
    const context = data.context._tag === 'Set' ? contextOf(data.context.value) : was.context
    const sameContext = contextKey(context) === contextKey(was.context)
    const workspace = data.workspace._tag === 'Set' ? data.workspace.value : was.workspace
    if (agentOf(w, by) !== undefined) {
      if (
        !sameSet(directions, was.directions) ||
        !sameContext ||
        spaceKey(workspace) !== spaceKey(was.workspace)
      ) {
        return yield* fail(R.RemakeTask.agentKeeps(task))
      }
      const dropped = kept.find((n) => !frameNeeds.includes(n))
      if (dropped) return yield* fail(R.RemakeTask.agentDrops(task, dropped))
    }
    const same =
      data.text === was.text &&
      sameSet(directions, was.directions) &&
      sameContext &&
      spaceKey(workspace) === spaceKey(was.workspace) &&
      sameSet(frameNeeds, kept) &&
      sameSet(data.references, was.references) &&
      (data.from ?? was.from) === was.from
    if (same) return yield* fail(R.RemakeTask.sameScope(task))
    const seen = new Set<TaskId>()
    const reaches = (list: ReadonlyArray<TaskId>): boolean =>
      list.some(
        (n) =>
          tree.includes(n) ||
          (!seen.has(n) && seen.add(n) !== undefined && reaches(w.tasks.get(n)?.needs ?? [])),
      )
    if (reaches(frameNeeds))
      return yield* fail(R.RemakeTask.cycle(data.name, frameNeeds.join(', ')))
    const remade = { ...data, needs }
    return [
      move('Task', task, {
        _tag: 'Remade',
        file: remade,
        reason: reason as never,
        review: answers,
      }),
    ]
  })
// A context as its file wrote it, for the compares of a remake.
const contextKey = (c: Context): string =>
  JSON.stringify(
    Object.entries({
      ...(c.section._tag === 'Section' ? { section: c.section.id } : {}),
      ...Object.fromEntries(c.facts),
    }).sort(),
  )

const CloseTask: Action<'CloseTask'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const { reason } = input.content
    if (blank(reason)) return yield* fail(R.CloseTask.noReason())
    return [move('Task', input.target.task, { _tag: 'Closed', reason: reason as never })]
  })

const DescribeTask: Action<'DescribeTask'> = ({ by, input }) =>
  Effect.gen(function* () {
    yield* allowed(yield* current, by, input)
    const { task } = input.target
    const { text } = input.content
    if (blank(text)) return yield* fail(R.DescribeTask.noText(task))
    return [move('Task', task, { _tag: 'Described', text: text as never })]
  })

// --- assignments ---------------------------------------------------------------------------------

// A role that writes a file or a commit writes it in its task's workspace.
const namesFile = (output: string | undefined): boolean => {
  const part = (output ?? '').split(/[#@]/)[0] ?? ''
  return part === '<file>' || part === '<repo>' || (part !== '' && !/^[<"]/.test(part))
}

const Give: Action<'Give'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    const { task, role } = input.target
    const { maxAttempts, secret } = input.content
    const program = by._tag === 'System'
    if (!program) yield* configUnchanged(d, by)
    const file = w.config.roles[role]
    const makes = isDo(w, role)
    // As the old CLI: the fit of a model role and the workspace come before the state checks.
    if (!program && file !== undefined && w.workflow.roles.get(role)?._tag === 'Model') {
      if (w.fits.get(role)?.hash !== roleHash(file)) return yield* fail(R.Give.noFit(role))
      const t = w.tasks.get(task)
      if (t !== undefined && makes && namesFile(file.output) && !t.descriptionAi.workspace.length) {
        return yield* fail(R.Give.noWorkspace(task, role, file.output ?? ''))
      }
    }
    yield* allowed(d, by, input)
    const r = roleAt(w, role)
    if (!makes && maxAttempts !== null) return yield* fail(R.Give.reviewerAttempts(role))
    const ceiling = maxOf(r.limits.Assignment.attempts)
    if (makes && ceiling !== undefined && maxAttempts !== null && maxAttempts > ceiling) {
      return yield* fail(
        R.Give.overCeiling(String(maxAttempts), tierOf(r) ?? role, String(ceiling)),
      )
    }
    const base = { task, role, secret: sha(secret) }
    const event: Event = makes
      ? create('Assignment', {
          _tag: 'GivenMaker',
          ...base,
          maxAttempts: maxAttempts === null ? null : PositiveInt.make(maxAttempts),
        })
      : create('Assignment', { _tag: 'GivenReviewer', ...base })
    // Ruling 10.9: a brief over its limit is a derived state of the new assignment, no refusal.
    return [event]
  })

const Free: Action<'Free'> = ({ by, input }) =>
  Effect.gen(function* () {
    yield* allowed(yield* current, by, input)
    return [move('Assignment', input.target.assignment, { _tag: 'Freed' })]
  })

// N9 (C1, I2): a finish of an assignment that ended already makes no event.
const Finish: Action<'Finish'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const { assignment } = input.target
    if (d.states.assignments.get(assignment)?._tag === 'Ended') return []
    yield* allowed(d, by, input)
    return [move('Assignment', assignment, { _tag: 'Finished' })]
  })

// A brief takes the snapshot and the claim. The first brief of a maker's task records how its
// files looked (a report equal to that is untouched work); a low checker's names its result.
const Brief: Action<'Brief'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const w = d.moment.work
    const cwd = d.moment.outside.cwd
    const a = w.assignments.get(input.target.assignment)
    if (a === undefined) return yield* Effect.die('canAct names the assignment')
    const state = d.states.assignments.get(a.id)
    const maker = isDo(w, a.role)
    const waits = fileTurn(d, a.id)
    if (waits) {
      const task = w.tasks.get(w.assignments.get(waits.before)?.task ?? ('' as TaskId))
      const named = task === undefined ? '' : `${task.id} ${task.name}`
      return yield* fail(R.Brief.waitsForFile(a.id, waits.file, waits.before, named, upTo(a)))
    }
    // A maker with no tries left takes no claim: nothing to brief (the words read the state).
    if (maker && state?._tag === 'OutOfTries') return []
    // Ruling 10.9: a brief over its limit takes no claim; the words say that the agent waits.
    if (state?._tag === 'BriefOver') return []
    const tier = tierOfAgent(w, a)
    const untouched = untouchedOf(w, a.task)
    if (maker && untouched._tag === 'NotBriefed') {
      const t = w.tasks.get(a.task)
      const form = outputForm(w, a.id)
      const names = [
        ...(t?.descriptionAi.workspace ?? []).map((x) => x.path),
        ...(form.includes('<') || form.startsWith('"') ? [] : [form.split(/[#@]/)[0] ?? '']),
      ]
      const files: Record<string, Snapshot> = {}
      for (const f of new Set(names)) {
        const snapshot = yield* snapshotOf(cwd, f)
        if (snapshot) files[f] = snapshot
      }
      // A maker that writes in place keeps the text before any work: the start of its diff.
      const fs = yield* Files
      const texts: Record<string, string> = {}
      if (!form.includes('@')) {
        for (const f of Object.keys(files)) {
          const size_ = yield* fs.size(join(cwd, f))
          const text = size_ !== null && size_ <= 512 * 1024 ? yield* fs.read(join(cwd, f)) : null
          if (text !== null) texts[f] = text
        }
      }
      const before = form.includes('@')
        ? ({ _tag: 'NotInPlace' } as const)
        : ({ _tag: 'InPlace', texts } as const)
      return [move('Assignment', a.id, { _tag: 'BriefedFirst', untouched: files, before })]
    }
    const latest = latestResultOf(w, a.task)
    if (tier === 'low' && !maker && latest !== undefined) {
      return [move('Assignment', a.id, { _tag: 'BriefedToCheck', result: latest.id })]
    }
    return [move('Assignment', a.id, { _tag: 'Briefed' })]
  })

export const ACTIONS = {
  OpenTask,
  OpenTaskFromDraft,
  SplitTask,
  RemakeTask,
  CloseTask,
  DescribeTask,
  Give,
  Free,
  Finish,
  Brief,
}
