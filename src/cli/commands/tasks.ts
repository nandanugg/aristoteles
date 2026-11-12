// The commands task, assign, free, finish. Words, refusals, events and
// readings of the clock and of the random secret.
import { join } from 'node:path'
import { Effect } from 'effect'
import { readTask, roleHash, sha, TASK_TEMPLATE } from '../../config/config.ts'
import { parseYaml } from '../../config/core.ts'
import { replacesOf, roleFileOf } from '../../domain/derived.ts'
import { refuse } from '../../domain/errors.ts'
import { create, type Draft, move, remakeDataOf, taskDataOf } from '../../domain/events.ts'
import type { PartFile } from '../../domain/files.ts'
import {
  type AssignmentId,
  isNonBlank,
  PositiveInt,
  ResultId,
  RoleName,
  RunId,
  TaskId,
  Time,
} from '../../domain/ids.ts'
import { lookupAssignment } from '../../domain/lookup.ts'
import type { Role, Tier } from '../../domain/model.ts'
import type { Work } from '../../domain/work.ts'
import { mayChange, neederOf, personRejects, within } from '../../engine/queries.ts'
import { taskState } from '../../engine/status.ts'
import { stepNew } from '../../replay/replay.ts'
import { runOf } from '../../replay/runs.ts'
import { Dir, Env, Now, Tokens } from '../../services/io.ts'
import { Files, Spawn } from '../../services/outside.ts'
import { fileTurn, MEASURE_TOKEN, renderBrief, waitersOf } from '../../words/brief.ts'
import { outsideOf, taskStateWord } from '../../words/common.ts'
import { renderBlockers, renderTaskTree } from '../../words/show.ts'
import { parseArgs, textOf } from '../args.ts'
import { agentOf, callerOf, isPerson, needClaim, tierOf } from '../caller.ts'
import type { Call, Command, Commands } from '../command.ts'
import { checkHashes } from './directions.ts'
import { lookupKind } from '../lookups.ts'
import { actOf, checkContext, personAuthor, readArgFile, readWork, writeAct } from '../run.ts'
import {
  checkCaseTwins,
  checkParts,
  checkRealNames,
  firstCreated,
  givenBy,
  latestResult,
  officialDirections,
  rejectRef,
  wordsOf,
  writtenEvent,
} from './work-support.ts'

const roleOf = (work: Work, name: string): Role | undefined =>
  [...work.workflow.roles.values()].find((r) => r.role === name)

// The tier of a role; undefined: a check program.
const roleTier = (role: Role | undefined): Tier | undefined =>
  role?._tag === 'Model' ? role.tier : undefined

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
    const runId = RunId.make(String(run))
    const env = yield* Env
    const { cwd } = yield* Dir
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        yield* checkHashes(work, null)
        // The host drafts in the terminal of its run, which the UI marked with its session.
        const holder = work.runs.get(runId)
        if (holder && env.vars.ARISTOTELES_SESSION !== holder.session) {
          return yield* refuse(
            `a draft of ${runId} comes from the terminal of ${runId}`,
            'the host of the project drafts its top task',
          )
        }
        const { role, ...rest } = parseYaml(yield* readArgFile(file))
        const task = yield* readTask(file, Bun.YAML.stringify(rest), officialDirections(work))
        if (typeof role !== 'string') {
          return yield* refuse(`${file} names no role: add role: <the Sol role that does the task>`)
        }
        yield* checkRealNames(cwd, task.workspace)
        yield* checkCaseTwins(work, task.workspace)
        const drafted = {
          _tag: 'Drafted' as const,
          run: runId,
          task: taskDataOf(task),
          role: RoleName.make(role),
        }
        return { author: { _tag: 'Host' as const, run: runId }, event: create('TaskDraft', drafted) }
      }),
    )
    const written = yield* writtenEvent(done)
    if (written._tag !== 'TaskDraft') return yield* Effect.die('task draft: the store wrote no draft')
    const drafted = written.create
    const id = firstCreated(done.created)
    return [
      `${id} drafted by ${runId}: ${drafted.task.name}, for the role ${drafted.role}.`,
      `it waits for the person to open it: work task open ${id}`,
    ]
  })

// The person opens a draft of a host: the task, the assign to the Sol role of the draft, and a
// change grant for 30 days, so that the host may split its project.
const openDraft = (call: Call, draftId: string) =>
  Effect.gen(function* () {
    const opened = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        yield* checkHashes(work, null)
        const author = yield* personAuthor(work)
        // The assign of the same act must pass: check it before anything is stored.
        const { taskDraft: draft } = yield* lookupKind('TaskDraft', ['td'], work, draftId)
        const role = roleOf(work, draft.role)
        if (!role) {
          return yield* refuse(`${draftId} names the role "${draft.role}", which does not exist`)
        }
        if (work.fits.get(role.role)?.hash !== roleHash(roleFileOf(work, role.role))) {
          return yield* refuse(
            `${draft.role} has no fit record for its current words`,
            `work role fit ${draft.role}, answer the questions, then work role fit ${draft.role} --answers=<file>; then open ${draftId}`,
          )
        }
        // A creation of the task, from the draft (the fold makes its id).
        return { ...author, event: create('Task', { _tag: 'OpenedFromDraft', draft: draft.id }) }
      }),
    )
    const tid = firstCreated(opened.created)
    const { taskDraft: draft } = yield* lookupKind('TaskDraft', ['td'], opened.work, draftId)
    // The same act gives the task to the Sol role of the draft, in the session of its run, and
    // lets that role change the task (its split) for 30 days: the host must split its project.
    const lines = yield* assignWith({
      argv: [],
      args: parseArgs([tid, `--role=${draft.role}`]),
      name: 'assign',
      act: null,
      token: null,
    })
    const now = yield* (yield* Now).read
    const until = new Date(Date.parse(now) + 30 * 24 * 3600 * 1000).toISOString()
    yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const author = yield* personAuthor(work)
        const granted = {
          _tag: 'Granted' as const,
          act: { _tag: 'Change' as const, changesOf: [TaskId.make(tid)] },
          to: RoleName.make(draft.role),
          until: Time.make(until),
        }
        return { ...author, event: create('Permission', granted) }
      }),
    )
    return [
      `${tid} opened from ${draftId}: ${draft.task.name}`,
      ...lines,
      `${draft.role} may change ${tid} (its split) until ${until}.`,
    ]
  })

const openFile = (call: Call) =>
  Effect.gen(function* () {
    const file = textOf(call.args.one('file'))
    if (!file) {
      return [TASK_TEMPLATE.trimEnd(), '', 'Save it as a file, then: work task open --file=<file>']
    }
    const { cwd } = yield* Dir
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        yield* checkHashes(work, null)
        const author = yield* personAuthor(work)
        const task = yield* readTask(file, yield* readArgFile(file), officialDirections(work))
        yield* checkRealNames(cwd, task.workspace)
        yield* checkCaseTwins(work, task.workspace)
        return { ...author, event: create('Task', { _tag: 'Opened', task: taskDataOf(task) }) }
      }),
    )
    const written = yield* writtenEvent(done)
    const opened = written._tag === 'Task' && 'create' in written ? written.create : undefined
    if (opened?._tag !== 'Opened') return yield* Effect.die('task open: the store wrote no open')
    const tid = firstCreated(done.created)
    return [`${tid} opened: ${opened.task.name}`, `next: work assign ${tid} --role=<role>`]
  })

const showTask = (sub: 'show' | 'tree', rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { work, at, dir } = yield* readWork
    const { task } = yield* lookupKind('Task', ['t'], work, String(rest[0]))
    const inTree = [...work.results.values()].filter((r) => within(work, r.task, task.id))
    const outside = yield* outsideOf(work, dir, sub === 'tree' ? inTree : inTree.filter((r) => r.task === task.id).slice(-1))
    if (sub === 'tree') return renderTaskTree(work, task.id, at, outside)
    const t = task.descriptionAi
    const latest = latestResult(work, task.id)
    const replaced = replacesOf(work, task.id)
    const state = taskStateWord(taskState(work, task.id, at))
    return [
      `${task.id} ${task.name} · ${state} · owner ${task.owner.name}`,
      `text: ${t.text}`,
      ...(t.partOf ? [`part of: ${t.partOf}`] : []),
      `directions: ${t.directions.join(', ') || 'none'}`,
      ...(task.needs.length ? [`needs: ${task.needs.join(', ')}`] : []),
      ...(replaced ? [`replaces ${replaced}`] : []),
      ...(task.end._tag === 'Replaced' ? [`closed as replaced by ${task.end.next}`] : []),
      ...(latest ? renderBlockers(work, latest.id, at, outside) : []),
    ]
  })

// A part of the split file as the stored event keeps it: only the keys that a part may have.
const partOf = (p: Record<string, unknown>): PartFile =>
  ({
    name: p.name,
    text: p.text,
    ...(p.context !== undefined ? { context: p.context } : {}),
    ...(p.from !== undefined ? { from: ResultId.make(String(p.from)) } : {}),
    ...(p.workspace !== undefined ? { workspace: p.workspace } : {}),
    ...(p.references !== undefined ? { references: p.references } : {}),
    ...(p.after !== undefined ? { after: p.after } : {}),
  }) as PartFile

// A split, a close or a remake: the person, or a high agent that holds a change act on the task.
const changeTask = (call: Call, sub: 'split' | 'close' | 'remake', rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { args, token } = call
    const { cwd } = yield* Dir
    const taskWord = String(rest[0])
    const remakeLine = (tid: string) =>
      `work task remake ${token ? `${token} ` : ''}${tid} --file=<task.yaml> --reason="<how the scope changed>"`
    const done = yield* writeAct(call, (work, at) =>
      Effect.gen(function* () {
        yield* checkHashes(work, null)
        const caller = yield* callerOf(work, token)
        const by = caller._tag === 'Agent' ? caller.assignment : undefined
        if (by && token) {
          yield* needClaim(work, by, token)
          if (tierOf(work, by) !== 'high') {
            return yield* refuse(
              `a ${tierOf(work, by)} role does not ${sub} tasks`,
              `work escalate ${token} --reason="..."`,
            )
          }
        }
        const { task } = yield* lookupKind('Task', ['t'], work, taskWord)
        if (by && !mayChange(work, by.id, task.id, at)) {
          return yield* refuse(
            `${by.id} (${by.role}) has no change act on ${taskWord}`,
            `work escalate ${token} --reason="a change grant on ${taskWord}, to ${sub} it"`,
          )
        }
        const reviewFlag = textOf(args.one('review'))
        // The engine refuses these acts; here the refusal gets its ids and its next line.
        if (sub === 'close') {
          // A needed task is not closed: the scope of the task that needs it changed.
          const needer = neederOf(work, task.id)
          if (needer) {
            const needed = [...work.tasks.values()].find(
              (t) => needer.needs.includes(t.id) && within(work, t.id, task.id),
            )
            return yield* refuse(
              `${needer.id} needs ${needed?.id}; without it the scope of ${needer.id} changes: remake ${needer.id}`,
              remakeLine(needer.id),
            )
          }
          // The person may close a part with their own point; an agent may not drop it.
          const personReject = by ? personRejects(work, task.id, true)[0] : undefined
          if (personReject) {
            const of = personReject.reject.of
            const on = of._tag === 'Result' ? (work.results.get(of.id)?.task ?? of.id) : of.id
            const id = personReject.id
            return yield* refuse(
              `${id} is the person's open Reject on ${on}; a close would drop it`,
              `work escalate ${token} --reason="${on} has the person's open point ${id}"`,
            )
          }
          const reason = wordsOf(args.one('reason'))
          if (!isNonBlank(reason)) return yield* refuse('a close needs a reason')
          return actOf(caller, move('Task', task.id, { _tag: 'Closed', reason }))
        }
        if (sub === 'remake') {
          const file = textOf(args.one('file'))
          if (!file) {
            return yield* refuse(
              'a remake needs --file=<task.yaml>: the new task, as for work task open',
              remakeLine(taskWord),
            )
          }
          const t = yield* readTask(file, yield* readArgFile(file), officialDirections(work))
          yield* checkRealNames(cwd, t.workspace)
          yield* checkCaseTwins(work, t.workspace)
          const review = reviewFlag ? yield* rejectRef(work, reviewFlag) : null
          const reason = wordsOf(args.one('reason'))
          if (!isNonBlank(reason)) return yield* refuse('a remake needs a reason')
          // A remake is a move of the old task; the fold makes the new one.
          const remade = { _tag: 'Remade' as const, file: remakeDataOf(t), reason, review }
          return actOf(caller, move('Task', task.id, remade))
        }
        // The person's open point that names no rule (a point on a task names none).
        const open = by
          ? personRejects(work, task.id, false).find(
              ({ point: p }) => !('breaks' in p) || p.breaks._tag === 'NoRule',
            )
          : undefined
        if (open && !args.one('review')) {
          const { id, point } = open
          return yield* refuse(
            `${id} is the person's open point on ${taskWord}: "${point.text}"; only that person's split answers it`,
            `work escalate ${token} --reason="${id} may need a split: work task split ${taskWord} --file=<parts.yaml> --review=${id}"`,
          )
        }
        const file = textOf(args.one('file'))
        if (!file) {
          return yield* refuse(
            'a split needs --file=<parts.yaml>, a list of parts like:\n' +
              '  - { name: Design, text: Write the design., context: { section: design } }\n' +
              '  - { name: Failure, text: Write the failure cases., context: { section: failure } }',
          )
        }
        const parts = parseYaml(yield* readArgFile(file))
        yield* checkParts(work, task, parts, file)
        const review = reviewFlag ? yield* rejectRef(work, reviewFlag) : null
        const [first, ...others] = (parts as ReadonlyArray<Record<string, unknown>>).map(partOf)
        const split = {
          _tag: 'Split' as const,
          parts: [first as PartFile, ...others] as const,
          review,
        }
        return actOf(caller, move('Task', task.id, split))
      }),
    )
    if (sub === 'close') return [`${taskWord} closed.`]
    if (sub === 'remake') {
      const made = done.work.tasks.get(firstCreated(done.created) as TaskId)
      if (!made) return yield* Effect.die(`task ${firstCreated(done.created)} was not made`)
      const replaced = [...done.work.tasks.values()]
        .filter((t) => t.end._tag === 'Replaced' && t.end.next === made.id)
        .map((t) => t.id)
      // A remade top task is outside the tree of every agent of the old one: the person assigns it.
      const by = token ? yield* agentOf(done.work, token) : undefined
      if (by && !within(done.work, made.id, by.task)) {
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
    return [
      `${taskWord} split into ${done.created.join(', ')}.`,
      `next: assign each part; ${taskWord} needs them, so its own result comes after every part is accepted.`,
    ]
  })

// The description of a task for people, its own fact (new in this code: the owner's ruling,
// 2026-11-12). The person writes it; until then it is the text of the task file.
const describeTask = (call: Call, rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const text = textOf(call.args.one('text'))
    yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        if (call.token !== null) {
          return yield* refuse(
            'the person describes a task for people; an agent passes no token here',
          )
        }
        const author = yield* personAuthor(work)
        const { task } = yield* lookupKind('Task', ['t'], work, String(rest[0]))
        if (!isNonBlank(text)) {
          return yield* refuse(
            `work task describe ${task.id} --text="<the task, in words for people>"`,
          )
        }
        return { ...author, event: move('Task', task.id, { _tag: 'Described', text }) }
      }),
    )
    return [`${rest[0]} is described for people.`]
  })

const task: Command = (call) =>
  Effect.gen(function* () {
    const [sub, ...rest] = call.args.positional
    if (sub === 'draft') return yield* taskDraft(call)
    if (sub === 'open' && /^td\d+$/.test(String(rest[0] ?? ''))) {
      return yield* openDraft(call, String(rest[0]))
    }
    if (sub === 'open') return yield* openFile(call)
    if (sub === 'show' || sub === 'tree') return yield* showTask(sub, rest)
    if (sub === 'describe') return yield* describeTask(call, rest)
    if (sub === 'split' || sub === 'close' || sub === 'remake') {
      // The token sits right after the act word; the task id follows it.
      return yield* changeTask(call, sub, call.token === null ? rest : rest.slice(1))
    }
    return yield* refuse('use work task open|show|tree|split|close|remake')
  })

// --- assign ------------------------------------------------------------------------------------

const MODEL = { high: 'Opus', medium: 'Sonnet', low: 'Haiku' } as const

// assign, as the command and as the step of `task open <draft>`: the call says which.
const assignWith = (call: Call) =>
  Effect.gen(function* () {
    const { args, token } = call
    const rest = token === null ? args.positional : args.positional.slice(1)
    const taskWord = String(rest[0])
    const roleName = String(args.one('role'))
    const { cwd } = yield* Dir
    // The secret is read before the store opens, once per assign (parity: the random is counted).
    const secret = yield* (yield* Tokens).random
    const maxAttempts = args.one('max-attempts')
    const build = (work: Work) =>
      Effect.gen(function* () {
        yield* checkHashes(work, null)
        const role = roleOf(work, roleName)
        if (!role) return yield* refuse(`there is no role "${roleName}"; work role list`)
        const c = roleFileOf(work, role.role)
        if (c.kind === 'program') {
          return yield* refuse(`${roleName} is a program; it runs on each report by itself`)
        }
        if (work.fits.get(role.role)?.hash !== roleHash(c)) {
          return yield* refuse(
            `${roleName} has no fit record for its current words`,
            `work role fit ${roleName}, answer the questions, then work role fit ${roleName} --answers=<file>`,
          )
        }
        // A maker that writes a file or a commit writes it in its task's workspace; with none, it
        // would write outside the file queue and the same-files checks.
        const { task } = yield* lookupKind('Task', ['t'], work, taskWord)
        const filePart = (c.output ?? '').split(/[#@]/)[0] ?? ''
        const namesFile =
          filePart === '<file>' ||
          filePart === '<repo>' ||
          (filePart !== '' && !filePart.startsWith('<') && !filePart.startsWith('"'))
        if (
          role.acts.some((x) => x._tag === 'Do') &&
          namesFile &&
          !task.descriptionAi.workspace?.length
        ) {
          return yield* refuse(
            `${taskWord} names no workspace, and ${roleName} writes ${c.output}; the person opens the task with its workspace (work task remake)`,
          )
        }
        // Who gives it is the author of the act: an agent gives a child, the person a top one.
        const caller = yield* callerOf(work, token)
        if (caller._tag === 'Agent') yield* needClaim(work, caller.assignment, caller.token)
        // The person approves directions, not results: a low role gets its work from a lead,
        // so every result has a decider below the person.
        if (caller._tag === 'Person' && roleTier(role) === 'low') {
          const leads = [...work.workflow.roles.values()]
            .filter((r) => roleTier(r) === 'medium' || roleTier(r) === 'high')
            .map((r) => r.role)
          return yield* refuse(
            `the person gives work to a medium or high role; ${roleName} is low, so a lead gives it its work`,
            `work assign ${taskWord} --role=${leads.join('|') || '<role>'}`,
          )
        }
        // The engine refused a limit that is no whole number of 1 or more.
        const max = maxAttempts === undefined ? null : Number(maxAttempts)
        if (max !== null && !(Number.isInteger(max) && max >= 1)) {
          return yield* refuse('maxAttempts must be a whole number of 1 or more')
        }
        const base = { task: task.id, role: role.role, secret: sha(secret) }
        // Only a role that makes has attempts (the old engine's words).
        if (!role.acts.some((x) => x._tag === 'Do')) {
          if (max !== null) {
            return yield* refuse(
              `${role.role} makes no result, so it has no attempts; ` +
                'a limit of attempts is for a role that makes',
            )
          }
          return actOf(caller, create('Assignment', { _tag: 'GivenReviewer', ...base }))
        }
        const limit = max === null ? null : PositiveInt.make(max)
        const maker = { _tag: 'GivenMaker' as const, ...base, maxAttempts: limit }
        return actOf(caller, create('Assignment', maker))
      })
    if (args.one('dry-run')) {
      const { work, at } = yield* readWork
      const act = yield* build(work)
      const when = yield* (yield* Now).read
      const services = yield* Effect.context<Files | Spawn>()
      const draft: Draft = { at: when, author: act.author, event: act.event }
      const seq = (work.events.at(-1)?.recorded.seq ?? 0) + 1
      const stepped = yield* stepNew(work, draft, seq, checkContext(cwd, at, services))
      const made = stepped.work.assignments.get(firstCreated(stepped.created) as AssignmentId)
      if (!made) return yield* Effect.die(`dry run: ${firstCreated(stepped.created)} is no assignment`)
      const size = renderBrief(stepped.work, made.id, { token: MEASURE_TOKEN, at, cwd }).length
      const madeRole = roleOf(stepped.work, made.role)
      const brief = madeRole?.limits.Assignment.briefChars
      const limit = brief?._tag === 'AtMost' ? brief.max : undefined
      return [
        `dry run: the brief of ${roleName} on ${taskWord} has ${size} characters` +
          (limit ? `; the ${roleTier(madeRole)} limit is ${limit}.` : '.'),
        'nothing was stored.',
      ]
    }
    const done = yield* writeAct(call, build)
    const a = done.work.assignments.get(firstCreated(done.created) as AssignmentId)
    if (!a) return yield* Effect.die(`${firstCreated(done.created)} is no assignment`)
    const tier = tierOf(done.work, a)
    if (tier === undefined) return yield* Effect.die(`${a.id} has a role with no tier`)
    const model = MODEL[tier]
    const taskName = done.work.tasks.get(a.task)?.name ?? ''
    // A maker that waits for a file is stored now; its subagent starts at its turn.
    const waits = fileTurn(done.work, a.id, done.at)
    const when = waits ? ` when ${waits.before} finishes (work next says when)` : ''
    // In a project of the UI, a medium or high role is a real agent: the UI starts its terminal.
    const run = runOf(done.work, a.task)
    if (run && tier !== 'low') {
      const host = done.work.sessions.get(a.id)?.session === run.session
      return [
        `${a.id} · ${roleName} (${tier}) on ${taskWord} ${taskName}`,
        host
          ? `${a.id} is the host of ${run.id}: the UI types into its session: work brief ${a.id}.${secret}`
          : `${a.id} is a real agent: the UI starts its terminal and types: work brief ${a.id}.${secret}; do not start it yourself.`,
        ...(token ? [`When it stops, work next ${token} shows the next steps.`] : []),
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

const assign: Command = (call) => assignWith(call)

// --- free and finish ---------------------------------------------------------------------------

const free: Command = (call) =>
  Effect.gen(function* () {
    const [first, second] = call.args.positional
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* callerOf(work, call.token)
        const by = caller._tag === 'Agent' ? caller.assignment : undefined
        const child = yield* lookupAssignment(work, String(by ? second : first))
        if (by && !givenBy(child, by.id)) return yield* refuse(`${child.id} is not your child`)
        return actOf(caller, move('Assignment', child.id, { _tag: 'Freed' }))
      }),
    )
    const freed = yield* writtenEvent(done)
    if (freed._tag !== 'Assignment' || !('move' in freed)) {
      return yield* Effect.die('free: the store wrote no free')
    }
    return [`${freed.id} is freed; the next work brief claims it.`]
  })

const finish: Command = (call) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const files = yield* Files
    const spawn = yield* Spawn
    const [first, second] = call.args.positional
    let waiters: ReadonlyArray<{ readonly id: AssignmentId; readonly path: string }> = []
    const done = yield* writeAct(call, (work, at) =>
      Effect.gen(function* () {
        const caller = yield* callerOf(work, call.token)
        const by = caller._tag === 'Agent' ? caller.assignment : undefined
        const target = by
          ? second
            ? yield* lookupAssignment(work, second)
            : by
          : yield* lookupAssignment(work, String(first))
        if (by && target.id !== by.id && !givenBy(target, by.id)) {
          return yield* refuse(`${target.id} is not your child`)
        }
        const open = [...work.assignments.values()]
          .filter((x) => givenBy(x, target.id) && x.end._tag === 'NotEnded')
          .map((x) => x.id)
        if (open.length) {
          return yield* refuse(
            `${target.id} has open children: ${open.join(', ')}; finish them first`,
            by ? `work finish ${first} ${open[0]}` : `work finish ${open[0]}`,
          )
        }
        waiters = waitersOf(work, target.id, at).map((y) => ({
          id: y,
          path: fileTurn(work, y, at)?.file ?? '',
        }))
        return actOf(caller, move('Assignment', target.id, { _tag: 'Finished' }))
      }),
    )
    const stored = yield* writtenEvent(done)
    if (stored._tag !== 'Assignment' || !('move' in stored)) {
      return yield* Effect.die('finish: the store wrote no finish')
    }
    const id = stored.id
    // A code maker's worktree goes when it finishes; its branch stays, because results name its
    // commits. The removal is best effort: a worktree that git does not know stays as it is.
    const tree = join(cwd, '.work', 'trees', id)
    const finished = done.work.assignments.get(id)
    const hadTree = (yield* files.kind(tree)) !== null
    if (hadTree) {
      const task = finished ? done.work.tasks.get(finished.task) : undefined
      for (const w of task?.descriptionAi.workspace ?? []) {
        yield* spawn.run(['git', '-C', join(cwd, w.path), 'worktree', 'remove', '--force', tree])
      }
    }
    const removed = hadTree && (yield* files.kind(tree)) === null
    // A maker that waited for this one may start now: its parent gives it to a new subagent.
    const turns = waiters
      .filter((w) => !fileTurn(done.work, w.id, done.at))
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
