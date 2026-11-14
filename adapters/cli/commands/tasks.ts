// The commands task, assign, free, finish. Each builds the ActionInput of its act, dispatches it,
// and prints the words of the act from the new Work.
import { join } from 'node:path'
import { Effect } from 'effect'
import { ACTIONS } from '../../../core/actions/index.ts'
import { Current } from '../../../core/actions/types.ts'
import {
  assignmentAt,
  roleAt,
  tierOf,
  within,
} from '../../../core/derived/reads.ts'
import { fileTurn, waitersOf } from '../../../core/derived/steps.ts'
import {
  type AssignmentId,
  type Author,
  lookup,
  lookupAssignment,
  PositiveInt,
  type PointId,
  type RejectId,
  refuse,
  RoleName,
  type RunId,
  type TaskId,
  type Time,
  type Work,
} from '../../../core/schema/index.ts'
import type { Refusal } from '../../../core/schema/errors.ts'
import { Dir, Env, Files, Now, Spawn, TASK_TEMPLATE, Tokens } from '../../../core/services/index.ts'
import { foldStep } from '../../../core/state/index.ts'
import { runOf } from '../../../core/state/records.ts'
import { renderTask, renderTaskTree } from '../../words/index.ts'
import { textOf, wordsOf } from '../args.ts'
import { authorOf, callerOf, isPerson, personAuthor } from '../caller.ts'
import type { Call, Command, Commands } from '../command.ts'
import { lookupKind } from '../lookups.ts'
import { act, derivedAfter, firstCreated, peekWork, readWork } from '../runtime.ts'

// The Reject (v4: all its points) or the point (v4.1) of a --review flag, as lookup finds it. A
// review that is no Reject passes as its id: the action refuses it with the old words.
const rejectRef = (work: Work, id: string) =>
  Effect.map(lookup(work, id, ['v']), (found): RejectId | PointId =>
    found._tag === 'Point' ? found.id : (id as RejectId),
  )

// --- task --------------------------------------------------------------------------------------

// A host drafts the top task of its project; the person opens it (Nanda, 2026-11-11).
const taskDraft = (call: Call) =>
  Effect.gen(function* () {
    const { args } = call
    const file = textOf(args.one('file'))
    const run = args.one('by')
    if (yield* isPerson) {
      return yield* refuse(
        'the person tells the host in words; the host drafts the top task, and you open it',
      )
    }
    if (!file || !/^h\d+$/.test(String(run ?? ''))) {
      return yield* refuse(
        'work task draft --file=<task.yaml> --by=<your run, h..>',
        `${TASK_TEMPLATE.trimEnd()}\nrole: <the Sol role that does the task>`,
      )
    }
    const runId = String(run) as RunId
    const { vars } = yield* Env
    const { work } = yield* peekWork
    // The host drafts in the terminal of its run: its own pane on the person's tmux server (tmux
    // tells the shell), or a window of the UI, which the UI marked with its session.
    const holder = work.runs.get(runId)
    const inTerminal =
      holder?.terminal._tag === 'Pane'
        ? vars.TMUX_PANE === holder.terminal.pane &&
          (vars.TMUX ?? '').split(',')[0] === holder.terminal.socket
        : vars.ARISTOTELES_SESSION === holder?.session
    if (holder && !inTerminal) {
      return yield* refuse(
        `a draft of ${runId} comes from the terminal of ${runId}`,
        'the host of the project drafts its top task',
      )
    }
    const done = yield* act(
      { _tag: 'Host', run: runId },
      { _tag: 'DraftTask', target: { run: runId }, content: { file } },
    )
    const id = firstCreated(done.created)
    const drafted = done.work.taskDrafts.get(id as never)
    return [
      `${id} drafted by ${runId}: ${drafted?.task.name}, for the role ${drafted?.role}.`,
      `it waits for the person to open it: work task open ${id}`,
    ]
  })

// The person opens a draft of a host: the task, the assign to the Sol role of the draft, and a
// change grant for 30 days, so that the host may split its project.
const openDraft = (call: Call, draftId: string) =>
  Effect.gen(function* () {
    const by = yield* personAuthor(undefined)
    const { work } = yield* peekWork
    const { taskDraft: draft } = yield* lookupKind('TaskDraft', ['td'], work, draftId)
    const opened = yield* act(by, {
      _tag: 'OpenTaskFromDraft',
      target: { draft: draft.id },
      content: {},
    })
    const tid = firstCreated(opened.created)
    // The same act gives the task to the Sol role of the draft, in the session of its run, and
    // lets that role change the task (its split) for 30 days: the host must split its project.
    const lines = yield* assignWith(
      { ...call, args: { ...call.args, positional: [tid], flags: [['role', draft.role]] } },
      by,
      tid,
      draft.role,
    )
    const now = yield* (yield* Now).read
    const until = new Date(Date.parse(now) + 30 * 24 * 3600 * 1000).toISOString() as Time
    yield* act(by, {
      _tag: 'Grant',
      target: {
        act: { _tag: 'Change', changesOf: [tid as TaskId] },
        to: draft.role,
      },
      content: { until },
    } as never)
    return [
      `${tid} opened from ${draftId}: ${draft.task.name}`,
      ...lines,
      `${draft.role} may change ${tid} (its split) until ${until}.`,
    ]
  })

const openFile = (_call: Call, file: string | undefined) =>
  Effect.gen(function* () {
    if (!file) {
      return [TASK_TEMPLATE.trimEnd(), '', 'Save it as a file, then: work task open --file=<file>']
    }
    const by = yield* personAuthor(undefined)
    const done = yield* act(by, { _tag: 'OpenTask', target: {}, content: { file } })
    const tid = firstCreated(done.created)
    return [`${tid} opened: ${done.work.tasks.get(tid as TaskId)?.name}`, `next: work assign ${tid} --role=<role>`]
  })

const showTask = (sub: 'show' | 'tree', rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { work, d } = yield* readWork
    const { task } = yield* lookupKind('Task', ['t'], work, String(rest[0]))
    return sub === 'tree' ? renderTaskTree(d, task.id) : renderTask(d, task.id)
  })

// A split, a close or a remake: the person, or a high agent that holds a change act on the task.
const changeTask = (call: Call, sub: 'split' | 'close' | 'remake', rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { args, token } = call
    const taskWord = String(rest[0])
    const { work } = yield* peekWork
    const caller = yield* callerOf(work, token)
    const by: Author = authorOf(caller)
    const { task } = yield* lookupKind('Task', ['t'], work, taskWord)
    const reviewFlag = textOf(args.one('review'))
    const answers = reviewFlag ? yield* rejectRef(work, reviewFlag) : null
    const file = textOf(args.one('file')) ?? ''
    const target = { task: task.id, answers }
    if (sub === 'close') {
      yield* act(by, {
        _tag: 'CloseTask',
        target: { task: task.id },
        content: { reason: wordsOf(args.one('reason')) },
      })
      return [`${taskWord} closed.`]
    }
    if (sub === 'remake') {
      const done = yield* act(by, {
        _tag: 'RemakeTask',
        target,
        content: { file, reason: wordsOf(args.one('reason')) },
      })
      const d = yield* derivedAfter(done.work)
      const made = done.work.tasks.get(firstCreated(done.created) as TaskId)
      if (!made) return yield* Effect.die(`task ${firstCreated(done.created)} was not made`)
      const replaced = [...done.work.tasks.keys()].filter((id) => {
        const s = d.states.tasks.get(id)
        return s?._tag === 'Replaced' && s.next === made.id
      })
      // A remade top task is outside the tree of every agent of the old one: the person assigns it.
      const mine = caller._tag === 'Agent' ? assignmentAt(done.work, caller.assignment) : undefined
      if (mine && !within(done.work, made.id, mine.task)) {
        return [
          `${taskWord} is remade as ${made.id}; closed as replaced: ${replaced.join(', ')}.`,
          `next: ${made.id} is outside your task tree, so ${made.owner.name} assigns it (work waiting --for=${made.owner.name}); ` +
            `work next ${token} lists your finishes`,
        ]
      }
      return [
        `${taskWord} is remade as ${made.id}; closed as replaced: ${replaced.join(', ')}.`,
        `next: split ${made.id} or assign it. To start from old work, name it in the task or part file ` +
          '(from: <result>); its maker starts there, and its result is new work.',
      ]
    }
    const done = yield* act(by, { _tag: 'SplitTask', target, content: { file } })
    return [
      `${taskWord} split into ${done.created.join(', ')}.`,
      `next: assign each part; ${taskWord} needs them, so its own result comes after every part is accepted.`,
    ]
  })

// The description of a task for people (the owner's ruling, 2026-11-12). The person writes it.
const describeTask = (call: Call, rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    if (call.token !== null) {
      return yield* refuse('the person describes a task for people; an agent passes no token here')
    }
    const by = yield* personAuthor(undefined)
    const { work } = yield* peekWork
    const { task } = yield* lookupKind('Task', ['t'], work, String(rest[0]))
    yield* act(by, {
      _tag: 'DescribeTask',
      target: { task: task.id },
      content: { text: wordsOf(call.args.one('text')) },
    })
    return [`${rest[0]} is described for people.`]
  })

const task: Command = (call) =>
  Effect.gen(function* () {
    const [sub, ...rest] = call.args.positional
    if (sub === 'draft') return yield* taskDraft(call)
    if (sub === 'open' && /^td\d+$/.test(String(rest[0] ?? ''))) {
      return yield* openDraft(call, String(rest[0]))
    }
    if (sub === 'open') return yield* openFile(call, textOf(call.args.one('file')))
    if (sub === 'show' || sub === 'tree') return yield* showTask(sub, rest)
    if (sub === 'describe') return yield* describeTask(call, rest)
    if (sub === 'split' || sub === 'close' || sub === 'remake') {
      return yield* changeTask(call, sub, rest)
    }
    return yield* refuse('use work task open|show|tree|split|close|remake')
  })

// --- assign ------------------------------------------------------------------------------------

const MODEL = { high: 'Opus', medium: 'Sonnet', low: 'Haiku' } as const

// assign, as the command and as the step of `task open <draft>`: the caller says who gives.
const assignWith = (call: Call, given: Author | null, taskWord: string, roleName: string) =>
  Effect.gen(function* () {
    const { args, token } = call
    const { cwd } = yield* Dir
    // The secret is read before the store opens, once per assign (parity: the random is counted).
    const secret = yield* (yield* Tokens).random
    const maxWord = args.one('max-attempts')
    const max = maxWord === undefined ? null : Number(maxWord)
    if (max !== null && !(Number.isInteger(max) && max >= 1)) {
      return yield* refuse('maxAttempts must be a whole number of 1 or more')
    }
    const maxAttempts = max === null ? null : PositiveInt.make(max)
    const { work } = yield* peekWork
    const by = given ?? authorOf(yield* callerOf(work, token))
    const input = {
      _tag: 'Give',
      target: { task: taskWord as TaskId, role: RoleName.make(roleName) },
      content: { maxAttempts, secret },
    } as const
    if (args.one('dry-run')) return yield* dryRun(by, input, taskWord, roleName)
    const done = yield* act(by, input)
    const d = yield* derivedAfter(done.work)
    const a = done.work.assignments.get(firstCreated(done.created) as AssignmentId)
    if (!a) return yield* Effect.die(`${firstCreated(done.created)} is no assignment`)
    const tier = tierOf(roleAt(done.work, a.role))
    if (tier === undefined) return yield* Effect.die(`${a.id} has a role with no tier`)
    const model = MODEL[tier as keyof typeof MODEL]
    const taskName = done.work.tasks.get(a.task)?.name ?? ''
    // A maker that waits for a file is stored now; its subagent starts at its turn, which passes
    // when the maker before it is accepted or idle, not at a finish (ruling 10.2).
    const waits = fileTurn(d, a.id)
    const when = waits ? ' at its turn (work next says when)' : ''
    // In a project of the UI, a medium or high role is a real agent: the UI starts its terminal
    // with a new token, or the host's work wait gives it one (10.1): this one is never shown.
    const run = runOf(done.work, a.task)
    if (run && tier !== 'low') {
      const host = done.work.sessions.get(a.id)?.session === run.session
      return [
        `${a.id} · ${roleName} (${tier}) on ${taskWord} ${taskName}`,
        host
          ? `${a.id} is the host of ${run.id}; the host gets its token from work wait.`
          : `${a.id} is a real agent: the UI starts its terminal with its command; ` +
            'do not start it yourself.',
        // 10.1: the parent hears of the child through its own work wait.
        ...(token ? [`Then run work wait ${token}: it returns when you have work.`] : []),
      ]
    }
    const before = waits ? done.work.assignments.get(waits.before) : undefined
    const beforeTask = before ? done.work.tasks.get(before.task) : undefined
    return [
      `${a.id} · ${roleName} (${tier}) on ${taskWord} ${taskName}`,
      ...(waits
        ? [
            `${a.id} waits for ${waits.file}: ${waits.before} (${before?.task} ` +
              `${beforeTask?.name}) writes it first, and one maker writes a file at a time.`,
          ]
        : []),
      `Start ${model === 'Opus' ? 'an' : 'a'} ${model} subagent${when} with this prompt, and nothing else:`,
      `  Use the work skill. In ${cwd}, run: work brief ${a.id}.${secret}, and do what the brief says.`,
      'The token is shown only now. Keep it: work next prints "give a new subagent the command of" a later attempt.',
    ]
  })

// A dry run: the action runs on the Derived of now, its event folds into a Work that is not
// stored, and the brief of that Work is measured. Nothing is written.
const dryRun = (
  by: Author,
  input: Parameters<typeof ACTIONS.Give>[0]['input'],
  taskWord: string,
  roleName: string,
) =>
  Effect.gen(function* () {
    const { d } = yield* readWork
    const made: ReadonlyArray<never> = yield* (
      ACTIONS.Give({ by, input }) as Effect.Effect<ReadonlyArray<never>, Refusal, never>
    ).pipe(
      Effect.provideService(Current, { derived: d }),
      Effect.provideService(Files, yield* Files),
      Effect.provideService(Spawn, yield* Spawn),
      Effect.provideService(Now, yield* Now),
      Effect.provideService(Tokens, yield* Tokens),
    )
    const [event] = made
    const w = d.moment.work
    const seq = (w.events.at(-1)?.recorded.seq ?? 0) + 1
    const stepped = foldStep(w, { seq, at: d.moment.at, author: by, event } as never)
    const id = firstCreated(stepped.created) as AssignmentId
    const size = d.moment.outside.measure(stepped.work, id)
    const brief = roleAt(stepped.work, assignmentAt(stepped.work, id).role).limits.Assignment
      .briefChars
    const limit = brief._tag === 'AtMost' ? brief.max : undefined
    const tier = tierOf(roleAt(stepped.work, assignmentAt(stepped.work, id).role))
    return [
      `dry run: the brief of ${roleName} on ${taskWord} has ${size} characters` +
        (limit ? `; the ${tier} limit is ${limit}.` : '.'),
      'nothing was stored.',
    ]
  })

const assign: Command = (call) =>
  Effect.gen(function* () {
    const taskWord = String(call.args.positional[0])
    const roleName = String(call.args.one('role'))
    return yield* assignWith(call, null, taskWord, roleName)
  })

// --- free and finish ---------------------------------------------------------------------------

const free: Command = (call) =>
  Effect.gen(function* () {
    const { work } = yield* peekWork
    const by = authorOf(yield* callerOf(work, call.token))
    const child = yield* lookupAssignment(work, String(call.args.positional[0]))
    yield* act(by, { _tag: 'Free', target: { assignment: child.id }, content: {} })
    return [`${child.id} is freed; the next work brief claims it.`]
  })

const finish: Command = (call) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const files = yield* Files
    const spawn = yield* Spawn
    const { work, d } = yield* peekWork
    const caller = yield* callerOf(work, call.token)
    const word = call.args.positional[0]
    const target =
      word !== undefined
        ? yield* lookupAssignment(work, word)
        : caller._tag === 'Agent'
          ? assignmentAt(work, caller.assignment)
          : yield* lookupAssignment(work, String(word))
    const waiters = waitersOf(d, target.id).map((y) => ({ id: y, path: fileTurn(d, y)?.file ?? '' }))
    const done = yield* act(authorOf(caller), {
      _tag: 'Finish',
      target: { assignment: target.id },
      content: {},
    })
    const id = target.id
    // A code maker's worktree goes when it finishes; its branch stays, because results name its
    // commits. The removal is best effort: a worktree that git does not know stays as it is.
    const tree = join(cwd, '.work', 'trees', id)
    const hadTree = (yield* files.kind(tree)) !== null
    if (hadTree) {
      const t = done.work.tasks.get(target.task)
      for (const w of t?.descriptionAi.workspace ?? []) {
        yield* spawn.run(['git', '-C', join(cwd, w.path), 'worktree', 'remove', '--force', tree])
      }
    }
    const removed = hadTree && (yield* files.kind(tree)) === null
    // A maker that waited for this one may start now: its parent gives it to a new subagent.
    const after = yield* derivedAfter(done.work)
    const turns = waiters
      .filter((w) => !fileTurn(after, w.id))
      .map((w) => {
        const y = done.work.assignments.get(w.id)
        return (
          `${w.id} may write ${w.path} now: ` +
          `${y?.parent._tag === 'Parent' ? `its parent ${y.parent.id} gives` : 'give'} a new subagent the command that work assign printed for ${w.id}`
        )
      })
    return [
      `${id} is finished.`,
      ...(removed ? [`its worktree is removed; its branch work/${id} stays.`] : []),
      ...turns,
    ]
  })

export const commands: Commands = { task, assign, free, finish }
