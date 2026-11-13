// The commands brief, report, review, resolve, recheck, escalate, ask, answer, note, evaluate,
// checkpoint, resume, source, and the program runs after a report.
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { Effect } from 'effect'
import {
  decisionOf,
  revisionOf,
  roleFileOf,
  versionIdOf,
} from '../../domain/derived.ts'
import { whoOf } from '../../domain/actor.ts'
import { refuse } from '../../domain/errors.ts'
import {
  type EvidenceData,
  type Event,
  create,
  move,
  type PointData,
  type ReportedWork,
  type ReviewWritten,
} from '../../domain/events.ts'
import type { RoleFile } from '../../domain/files.ts'
import {
  AssignmentId,
  type CheckpointId,
  isNonBlank,
  ResultId,
  type RevisionId,
  type TaskId,
} from '../../domain/ids.ts'
import { lookup } from '../../domain/lookup.ts'
import { sectionOf } from '../../domain/context.ts'
import type { MadeFrom, Result, Snapshot, Stop, Task } from '../../domain/model.ts'
import type { CreatedId, Work } from '../../domain/work.ts'
import {
  answered,
  evaluationCounts,
  evaluationWaits,
  isDo,
  madeBy,
  openDo,
  resultsOf,
  reviewsOf,
  rulesOf,
  stopTask,
  vetoOf,
  resume as engineResume,
  within,
  workStop,
} from '../../engine/queries.ts'
import { accepted, blockerItems, taskAccepted, taskState, used as triesUsed } from '../../engine/status.ts'
import { checkOutput, digestOf, sectionsInside, snapshotOf, changedSince } from '../../files/digest.ts'
import { Dir } from '../../services/io.ts'
import { Files, Spawn } from '../../services/outside.ts'
import { clock, taskStateWord } from '../../words/common.ts'
import {
  fileTurn,
  outputForm,
  renderBrief,
  rulesFor,
  staleOf,
} from '../../words/brief.ts'
import { nextLines, nextSteps } from '../../words/next.ts'
import { draftWaitsText, renderDraft, reviseAgainOf, stopIdOf } from '../../words/show.ts'
import { textOf } from '../args.ts'
import { agentCallerOf, agentOf, callerOf, needClaim, needOpen, tierOf } from '../caller.ts'
import type { Call, Command, Commands } from '../command.ts'
import { lookupKind } from '../lookups.ts'
import { actOf, type NewAct, readWork, writeAct } from '../run.ts'
import { afterVersion, checkHashes } from './directions.ts'
import { followCommit } from '../refresh.ts'
import {
  checkDigest,
  checkEvidence,
  evidenceFlag,
  evidenceOf,
  firstCreated,
  gitSources,
  inTree,
  latestResult,
  pointDataOf,
  pointsOf,
  programSecret,
  ruleNamed,
  baseOf,
  maxAttemptsOf,
  upTo,
  wordsOf,
  writtenEvent,
} from './work-support.ts'

const unique = (tasks: ReadonlyArray<Task>): ReadonlyArray<Task> => [
  ...new Map(tasks.map((t) => [t.id, t])).values(),
]
const COMMIT_AT_END = /@[0-9a-f]{7,40}$/
const commitOf = (output: string): string | undefined => output.split('@')[1]

// --- brief -------------------------------------------------------------------------------------

// The brief of an agent: its snapshot and its claim. A refusal that the agent must obey is a
// refusal; the words that end an agent's work (no attempts left, a brief too big) are lines.
const brief: Command = (call) =>
  Effect.gen(function* () {
    const token = call.args.positional[0]
    const { cwd } = yield* Dir
    const files = yield* Files
    let refusedText: ReadonlyArray<string> | undefined
    const done = yield* writeAct(call, (work, at) =>
      Effect.gen(function* () {
        yield* checkHashes(work, token ?? null)
        const caller = yield* agentCallerOf(work, token ?? null)
        const a = caller.assignment
        const meta = work.meta.get(a.id)
        if (!meta) return yield* Effect.die(`${a.id} has no meta`)
        yield* needOpen(work, a)
        const tier = tierOf(work, a)
        // A medium or high agent may read its brief again; a low claim is one subagent's.
        if (meta.claim._tag !== 'Free' && tier === 'low') {
          return yield* refuse(
            `${a.id} is claimed since ${clock(meta.claim.since)} by another subagent`,
            a.parent._tag === 'Parent'
              ? `STOP and tell your parent. If that subagent stopped, the parent runs work free <parent token> ${a.id}`
              : `STOP. If that subagent stopped, the person runs work free ${a.id}`,
          )
        }
        // One maker writes a file at a time: a maker that waits for its file takes no snapshot yet.
        const waits = fileTurn(work, a.id, at)
        if (waits) {
          const before = work.assignments.get(waits.before)
          const beforeTask = before ? work.tasks.get(before.task) : undefined
          return yield* refuse(
            `${a.id} waits for ${waits.file}: ${waits.before} (${before?.task} ` +
              `${beforeTask?.name}) writes it first, and one maker writes a file at a time`,
            `STOP and do not change ${waits.file}. ${a.parent._tag === 'Parent' ? 'Your parent' : 'The person'} starts you again when ${waits.before} finishes`,
          )
        }
        // A mistake is evaluated before new work: a maker of a task that waits for its evaluation,
        // or for the change that it asks for, takes no snapshot yet.
        const maker = isDo(work, a.role)
        const stop = maker ? workStop(work, a.task, at) : undefined
        if (stop) {
          return yield* refuse(
            stop,
            `STOP and tell ${upTo(a)}; work next says when the work goes on`,
          )
        }
        // A maker with no attempts left takes no claim: its parent assigns a new maker.
        if (maker && !openDo(work, a.id)) {
          refusedText = [
            `${a.id} has used its ${maxAttemptsOf(a)} attempts; it makes no new result.`,
            a.parent._tag === 'Parent'
              ? `STOP and tell your parent: it assigns a new ${a.role}.`
              : `STOP: the person assigns a new ${a.role}.`,
          ]
          return null
        }
        const text = renderBrief(work, a.id, { token: caller.token, at, cwd })
        const briefLimit = work.workflow.roles.get(a.role)?.limits.Assignment.briefChars
        const limit = briefLimit?._tag === 'AtMost' ? briefLimit.max : undefined
        if (limit !== undefined && text.length > limit) {
          const parts = text.split(/\n(?=[A-Z]{3,} )/)
          const largest = parts
            .map((p) => [p.split(' ')[0] ?? '', p.length] as const)
            .sort((x, y) => y[1] - x[1])[0] ?? ['', 0]
          refusedText = [
            `the brief of ${a.id} has ${text.length} characters; the ${tier} limit is ${limit}.`,
            `The largest part is ${largest[0]} (${largest[1]} characters).`,
            `Run: work escalate ${caller.token} --reason="the brief is too big: ${largest[0]} has ${largest[1]} characters; work guide limits says how to shorten it"`,
            'STOP after the escalation.',
          ]
          return null
        }
        // The first brief of a task records how each of its files looked before any work (a
        // report equal to that is untouched work); a low checker's claim records the result
        // that it reviews.
        const task = work.tasks.get(a.task)
        let untouched: Record<string, Snapshot> | null = null
        let before: Record<string, string> | null = null
        if (maker && task?.untouched._tag === 'NotBriefed') {
          const form = outputForm(work, a.id)
          const names = [
            ...(task?.descriptionAi.workspace ?? []).map((w) => w.path),
            ...(form.includes('<') || form.startsWith('"') ? [] : [form.split(/[#@]/)[0] ?? '']),
          ]
          untouched = {}
          for (const f of new Set(names)) {
            const snapshot = yield* snapshotOf(cwd, f)
            if (snapshot) untouched[f] = snapshot
          }
          // A maker that writes in place shares its files with earlier makers, whose changes may
          // not be committed: the text before any work is the start of this task's own diff. A
          // maker of commits has its own branch for that.
          if (!form.includes('@')) {
            before = {}
            for (const f of Object.keys(untouched)) {
              const path = join(cwd, f)
              const size = yield* files.size(path)
              const text = size !== null && size <= 512 * 1024 ? yield* files.read(path) : null
              if (text !== null) before[f] = text
            }
          }
        }
        const latest = latestResult(work, a.task)
        const result = tier === 'low' && !maker && latest ? latest.id : null
        // A low checker's brief names its result; a maker's first brief keeps how its files
        // looked (and their text, for a maker that writes in place).
        const briefed =
          result !== null
            ? { _tag: 'BriefedToCheck' as const, result }
            : untouched !== null
              ? {
                  _tag: 'BriefedFirst' as const,
                  untouched,
                  before:
                    before === null
                      ? { _tag: 'NotInPlace' as const }
                      : { _tag: 'InPlace' as const, texts: before },
                }
              : { _tag: 'Briefed' as const }
        return actOf(caller, move('Assignment', a.id, briefed))
      }),
    )
    if (refusedText) return refusedText
    const briefed = yield* writtenEvent(done)
    if (briefed._tag !== 'Assignment' || !('move' in briefed)) {
      return yield* Effect.die('brief: the store wrote no brief')
    }
    return [renderBrief(done.work, briefed.id, { token: String(token), at: done.at, cwd })]
  })

// --- programs ----------------------------------------------------------------------------------

// Splits a program's run line into words; double quotes keep spaces. No shell runs it.
const wordsOfLine = (line: string): ReadonlyArray<string> =>
  [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? '')

interface Ran {
  readonly ok: boolean
  readonly text: string
  readonly output?: string
}

// Programs (gates) run after each report of a role that they review: in the workspace folder,
// or in a clean checkout of the reported commit. A program that cannot run, or runs too long,
// records a reject; its full output stays in .work/runs/.
const runProgram = (c: Extract<RoleFile, { kind: 'program' }>, result: Result, work: Work) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const files = yield* Files
    const spawn = yield* Spawn
    const workspace = work.tasks.get(result.task)?.descriptionAi.workspace?.[0]
    const commit = /^([^#]+)@([0-9a-f]{7,40})$/.exec(result.output)
    let folder = join(cwd, workspace?.path ?? '.')
    let tree: string | undefined
    const body = Effect.gen(function* () {
      if (commit) {
        tree = mkdtempSync(join(tmpdir(), 'work-gate-'))
        const add = yield* spawn.run([
          'git',
          '-C',
          join(cwd, commit[1] ?? ''),
          'worktree',
          'add',
          '--detach',
          tree,
          commit[2] ?? '',
        ])
        if (add.code !== 0) {
          return { ok: false, text: `could not check out ${commit[2]}: ${add.err.trim()}` } as Ran
        }
        folder = tree
      }
      const argv = wordsOfLine(c.run ?? '').map((w) =>
        w.replace('{workspace.path}', folder).replace('{output}', result.output),
      )
      const runCwd = (yield* files.kind(folder)) === 'folder' ? folder : cwd
      const seconds = c.timeout ?? 120
      const run = yield* spawn.run(argv, { cwd: runCwd, timeoutMs: seconds * 1000 })
      const output = run.out + run.err
      if (run.timedOut || run.code === -1) {
        return { ok: false, text: `timed out after ${seconds} s`, output } as Ran
      }
      return { ok: run.code === 0, text: run.code === 0 ? 'exit 0' : `exit ${run.code}`, output } as Ran
    })
    const cleanup = Effect.suspend(() =>
      tree && commit
        ? Effect.asVoid(
            spawn.run(['git', '-C', join(cwd, commit[1] ?? ''), 'worktree', 'remove', '--force', tree]),
          )
        : Effect.void,
    )
    return yield* body.pipe(
      Effect.catchDefect((defect) =>
        Effect.succeed({
          ok: false,
          text: `could not run: ${defect instanceof Error ? defect.message : String(defect)}`,
        } as Ran),
      ),
      Effect.ensuring(cleanup),
    )
  })

// After a report, each program that reviews the maker's role runs: three writes each (assign,
// review, finish), as the system. A program writes as the system, not as the agent whose
// report started it, so its writes carry no token.
export const runPrograms = (
  call: Call,
  work: Work,
  result: Result,
  out: (line: string) => void,
) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const files = yield* Files
    const programCall: Call = { ...call, token: null }
    const maker = work.assignments.get(result.by)?.role
    for (const role of work.workflow.roles.values()) {
      const c = roleFileOf(work, role.role)
      if (c.kind !== 'program' || c.on !== 'report') continue
      if (!role.acts.some((a) => a._tag === 'Review' && maker !== undefined && a.resultsOf.includes(maker))) {
        continue
      }
      const rid = result.id
      const tid = result.task
      // A program checks only its rules that the task has now; a change can remove them.
      const checks = c.checks.filter((id) => rulesOf(work, result.task).some((r) => r.id === id))
      if (checks.length === 0) {
        out(
          `${role.role} did not run on ${rid}: no direction of ${tid} has its checks (${c.checks.join(', ')}) now`,
        )
        continue
      }
      const run = yield* runProgram(c, result, work)
      const log = join('.work', 'runs', `${rid}-${role.role}.log`)
      yield* files.write(join(cwd, log), run.output ?? run.text)
      const tail =
        (run.output ?? '')
          .trim()
          .split('\n')
          .filter(Boolean)
          .slice(-3)
          .join(' / ') || '(no output)'
      const where = `${c.run} on ${result.output}`
      // The CLI's own assign and finish of a program: the author is the system.
      const system = { _tag: 'System' as const }
      // A program reviews: it makes no result, so it has no attempts.
      const given = {
        _tag: 'GivenReviewer' as const,
        task: tid,
        role: role.role,
        secret: programSecret(rid),
      }
      const assigned = yield* writeAct(programCall, () =>
        Effect.succeed({ author: system, event: create('Assignment', given) }),
      )
      const pid = AssignmentId.make(firstCreated(assigned.created))
      const [first = ''] = checks
      const line = (rule: string) => ({ rule, where: `${where}: exit 0`, what: `${tail} (${log})` })
      const review: ReviewWritten = run.ok
        ? {
            _tag: 'Accept',
            of: { _tag: 'Result', id: rid, evidence: [line(first), ...checks.slice(1).map(line)] },
            reason: null,
          }
        : {
            _tag: 'Reject',
            of: {
              _tag: 'Result',
              id: rid,
              points: [
                { text: `${where}: ${run.text}: ${tail} (full output: ${log})`, breaks: first },
              ],
            },
          }
      const program = { _tag: 'Program' as const, assignment: pid }
      const event: Event = { _tag: 'Review', create: review }
      yield* writeAct(programCall, () => Effect.succeed({ author: program, event }))
      const finished = move('Assignment', pid, { _tag: 'Finished' })
      yield* writeAct(programCall, () => Effect.succeed({ author: system, event: finished }))
      out(`${role.role} ran on ${rid}: ${run.ok ? 'accept' : `reject (${run.text}; ${log})`}`)
    }
  })

// --- report ------------------------------------------------------------------------------------

// A maker reports what it made. The long list of checks keeps the work of other tasks safe: the
// same files, sections and commits (the file queue), the base, the starting point, and untouched
// or rejected work.
const report: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const token = args.positional[0]
    const output = args.one('output')
    if (!output || output === true) {
      return yield* refuse('a report needs --output=<what you made, and where>')
    }
    const { cwd } = yield* Dir
    const files = yield* Files
    const spawn = yield* Spawn
    const git = (file: string, ...gitArgs: ReadonlyArray<string>) =>
      spawn.run(['git', '-C', join(cwd, file), ...gitArgs])
    const done = yield* writeAct(call, (work, at) =>
      Effect.gen(function* () {
        yield* checkHashes(work, token ?? null)
        const caller = yield* agentCallerOf(work, token ?? null)
        const a = caller.assignment
        const low = tierOf(work, a) === 'low'
        yield* checkOutput(cwd, output)
        const task = work.tasks.get(a.task)
        const role = work.workflow.roles.get(a.role)
        if (!task || !role) return yield* Effect.die(`${a.id} has no task or role`)
        const expected = outputForm(work, a.id)
        const form = roleFileOf(work, role.role).output
        if (!expected.includes('<') && !expected.startsWith('"')) {
          if (output !== expected) {
            return yield* refuse(
              `the output of this task is ${expected}`,
              `work report ${caller.token} --output=${expected}`,
            )
          }
        } else if (
          form &&
          (form.includes('#') ? !output.includes('#') : form.includes('@') && !output.includes('@'))
        ) {
          return yield* refuse(`the output of ${a.role} has the form ${form}`)
        }
        const workspace = task.descriptionAi.workspace
        const file = output.split(/[#@]/)[0] ?? ''
        const isCommit = /^[^#]+@[0-9a-f]{7,40}$/.test(output)
        // A file of the dir is written only in the workspace of the task (one maker at a time); a
        // task with no workspace writes none.
        const onDisk = (yield* files.kind(join(cwd, file))) !== null
        if (
          (workspace.length || onDisk) &&
          !workspace.some((w) => file === w.path || (!isCommit && file.startsWith(`${w.path}/`)))
        ) {
          return yield* refuse(
            `${file} is not in the workspace of ${task.id}: ${workspace.map((w) => w.path).join(', ') || 'none'}`,
          )
        }
        // A commit belongs to the workspace repo itself, not to a repo inside it or around it.
        if (isCommit) {
          const top = yield* git(file, 'rev-parse', '--show-toplevel')
          const real = (p: string) => {
            try {
              return realpathSync(p)
            } catch {
              return p
            }
          }
          if (top.code !== 0 || real(top.out.trim()) !== real(join(cwd, file))) {
            return yield* refuse(
              `${file} is not the top of its own git repo; the workspace repo is ${file}`,
            )
          }
        }
        // A task may not take a section that another open task of its tree owns.
        const section = output.split('#')[1]
        let topId = task.id
        let up = task.serves
        while (up._tag === 'Serves') {
          topId = up.task
          up = work.tasks.get(up.task)?.serves ?? { _tag: 'TopTask' }
        }
        const needsOpen = task.needs
          .map((n) => work.tasks.get(n))
          .filter((t): t is Task => t !== undefined && t.end._tag === 'NotEnded')
        // The other open tasks whose work this report must keep: those of its tree (not its
        // ancestors), and the tasks it needs, from any tree.
        const others = unique([
          ...[...work.tasks.values()].filter(
            (t) =>
              t.id !== task.id &&
              t.end._tag === 'NotEnded' &&
              within(work, t.id, topId) &&
              !within(work, task.id, t.id),
          ),
          ...needsOpen,
        ])
        const owner = others.find((t) => section && sectionOf(t.descriptionAi.context) === section)
        if (owner) {
          return yield* refuse(`the section ${section} belongs to ${owner.id} (${owner.name})`)
        }
        const { digest, size, commit } = yield* digestOf(cwd, output)
        // A task that starts from earlier work reports new work made on top of it.
        const startId = task.descriptionAi.from
        const start = startId ? work.results.get(startId) : undefined
        if (start && digest === start.work.digest) {
          return yield* refuse(
            `${output} is the starting point of ${task.id} (${start.id}); a report is new work`,
            low
              ? `work escalate ${caller.token} --reason="<why the starting point already does the task>"`
              : undefined,
          )
        }
        // For a commit, the digest is its tree; git takes the commits from the outputs.
        if (start && commit && COMMIT_AT_END.test(start.output)) {
          const on = yield* git(file, 'merge-base', '--is-ancestor', commitOf(start.output) ?? '', commit)
          if (on.code !== 0) {
            return yield* refuse(
              `${output} does not start from ${start.id} (${start.output})`,
              `make your commit on top of ${start.output.split('@')[1]}, then report again`,
            )
          }
        }
        // Untouched work: the output is as it was at the first brief of its task. A task that
        // needs others may keep the file as they left it, when one of them did accepted work.
        const beforeWork =
          task.untouched._tag === 'AtFirstBrief' ? task.untouched.files[file] : undefined
        const was = beforeWork && (section ? beforeWork.sections[section] : beforeWork.digest)
        const needsWorked = task.needs.some((t) =>
          resultsOf(work, t).some((r) => accepted(work, r.id, at)),
        )
        if (!commit && was && digest === was && !needsWorked) {
          return yield* refuse(
            `${output} is the same as before any work on ${task.id}; a report is new work`,
            low
              ? `work escalate ${caller.token} --reason="<why the work stays as it is>"`
              : undefined,
          )
        }
        const space = workspace.find((w) => w.path === file)
        const spaceBase = space ? baseOf(space) : undefined
        // A commit is new work against its base: not on the base, and with other files than its
        // merge base. A base that git cannot read is refused; the check never passes by default.
        let mergeBase: string | undefined
        let patch: string | undefined
        if (commit && !spaceBase) {
          return yield* refuse(
            `${file} is a git workspace of ${task.id} with no base, so the CLI cannot check the commit`,
            low
              ? `work escalate ${caller.token} --reason="the workspace ${file} names no base"`
              : 'the person opens the task with base: <branch> in its workspace',
          )
        }
        if (commit && spaceBase) {
          const base = spaceBase
          if ((yield* git(file, 'rev-parse', '--verify', `${base}^{commit}`)).code !== 0) {
            return yield* refuse(
              `${file} has no ${base}, the base of this task, so the CLI cannot check the commit`,
              low
                ? `work escalate ${caller.token} --reason="${file} has no base ${base}"`
                : `the person opens the task with a base that ${file} has`,
            )
          }
          if ((yield* git(file, 'merge-base', '--is-ancestor', commit, base)).code === 0) {
            return yield* refuse(
              `${commitOf(output)} is already on ${base}; a report is a new commit`,
            )
          }
          mergeBase = (yield* git(file, 'merge-base', commit, base)).out.trim()
          if (!mergeBase) {
            return yield* refuse(
              `${output} shares no history with ${base}; a report is a commit on top of ${base}`,
              `make the commit on a branch from ${base}, then report again`,
            )
          }
          const baseTree = (yield* git(file, 'rev-parse', `${mergeBase}^{tree}`)).out.trim()
          if (baseTree === digest) {
            return yield* refuse(`${output} has the same files as ${base}; a report is new work`)
          }
          // The work of a commit is its change against its merge base, as git patch-id names it: a
          // rebase or a new message of the same change is the same work. The diff has one fixed
          // form, whatever the repo or the environment sets (colour, an external diff, the diff
          // options), and white space counts: an indent can be the whole fix.
          const env = Object.fromEntries(
            Object.entries(process.env).filter(([k]) => !/^GIT_(CONFIG|EXTERNAL_DIFF|DIFF_OPTS)/.test(k)),
          )
          const diff = yield* spawn.run(
            [
              'git',
              '-C',
              join(cwd, file),
              '-c',
              'diff.suppressBlankEmpty=false',
              'diff',
              '--no-renames',
              '--no-color',
              '--no-ext-diff',
              '--no-textconv',
              '--full-index',
              '--src-prefix=a/',
              '--dst-prefix=b/',
              '--diff-algorithm=myers',
              '--unified=3',
              '--inter-hunk-context=0',
              '--indent-heuristic',
              mergeBase,
              commit,
            ],
            { env },
          )
          const patchId = yield* spawn.run(['git', '-C', join(cwd, file), 'patch-id', '--verbatim'], {
            env,
            stdin: diff.out,
          })
          patch = patchId.out.trim().split(' ')[0] || undefined
          if (diff.out.length > 0 && !patch) {
            return yield* refuse(
              `git gave no patch-id for ${output}, so the CLI cannot compare it with other work`,
            )
          }
          // Another task's work is not this task's result (a task that needs it builds on top of
          // it).
          const copied = [...work.results.values()].find(
            (r) =>
              r.task !== task.id &&
              !task.needs.includes(r.task) &&
              r.output.split('@')[0] === file &&
              COMMIT_AT_END.test(r.output) &&
              (commit.startsWith(commitOf(r.output) ?? '\0') ||
                (patch !== undefined && r.work._tag === 'Commit' && r.work.patch === patch)),
          )
          if (copied) {
            return yield* refuse(
              `${output} is the work of ${copied.id} of ${copied.task} (${work.tasks.get(copied.task)?.name}); a report is the work of ${task.id}`,
              low
                ? `work escalate ${caller.token} --reason="the work of ${task.id} is already in ${copied.id}"`
                : undefined,
            )
          }
        }
        const sameWork = (r: Result) =>
          patch && r.work._tag === 'Commit' ? r.work.patch === patch : r.work.digest === digest
        const previous = latestResult(work, task.id)
        const redoOpen =
          previous !== undefined &&
          reviewsOf(work, previous.id).some((v) => v._tag === 'Recheck' && !answered(work, v.id))
        // After a recheck, a commit contains the new revision of its source.
        const seen = space ? work.sources.get(space.source) : undefined
        const sourceNow = seen ? revisionOf(seen) : undefined
        if (commit && redoOpen && sourceNow && space) {
          if ((yield* git(file, 'merge-base', '--is-ancestor', sourceNow, commit)).code !== 0) {
            return yield* refuse(
              `${output} is not built on ${space.source}@${sourceNow}; rebase it first`,
            )
          }
        }
        const rejectedTwin = resultsOf(work, task.id).find(
          (r) =>
            r.id !== previous?.id &&
            sameWork(r) &&
            reviewsOf(work, r.id).some((v) => decisionOf(v) === 'Reject'),
        )
        // A recheck asks for the work again; it does not make rejected work right.
        if (rejectedTwin) {
          return yield* refuse(
            `${output} is the same as ${rejectedTwin.id}, which was rejected`,
            low
              ? `work escalate ${caller.token} --reason="<why the rejected work is right>"`
              : undefined,
          )
        }
        if (previous && sameWork(previous) && !redoOpen) {
          return yield* refuse(
            `nothing changed since ${previous.id}; a report is new work`,
            low
              ? `work escalate ${caller.token} --reason="<why the work stays as it is>"`
              : undefined,
          )
        }
        // A report keeps the work that other open tasks own: each of their sections in this file,
        // and the whole file of a task that it needs, stays as that task's latest result left it.
        // Any open task counts but the ancestors of this one, whose result comes after it. A
        // closed task is not needed, so it owns nothing.
        const keepers = unique([
          ...[...work.tasks.values()].filter(
            (t) => t.id !== task.id && t.end._tag === 'NotEnded' && !within(work, task.id, t.id),
          ),
          ...needsOpen,
        ])
        // The sections of two tasks do not nest (round 7, D4): a heading that was not in the file
        // at the split can still put one section inside another, so the report checks it again.
        if (section) {
          const inside = yield* sectionsInside(cwd, output)
          for (const t of keepers.filter(
            (x) =>
              sectionOf(x.descriptionAi.context) !== null &&
              x.descriptionAi.workspace.some((w) => w.path === file),
          )) {
            const theirSection = sectionOf(t.descriptionAi.context) ?? ''
            const nest = (yield* sectionsInside(cwd, `${file}#${theirSection}`)).includes(section)
              ? `the section ${section} lies inside the section ${theirSection} of ${t.id} (${t.name})`
              : inside.includes(theirSection)
                ? `the section ${theirSection} of ${t.id} (${t.name}) lies inside the section ${section}`
                : undefined
            if (nest) {
              return yield* refuse(
                `${nest}; the sections of two tasks do not nest`,
                low
                  ? `work escalate ${caller.token} --reason="${nest}"`
                  : 'the person remakes the tasks with sections that do not nest',
              )
            }
          }
        }
        for (const t of keepers) {
          const theirs = latestResult(work, t.id)
          if (!theirs || COMMIT_AT_END.test(theirs.output)) continue
          const [theirFile, theirSection] = theirs.output.split('#')
          const covered = theirFile === file && (theirSection ? true : task.needs.includes(t.id))
          if (!covered || !(yield* changedSince(cwd, theirs))) continue
          const how = taskAccepted(work, t.id, at) ? 'accepted' : 'reported'
          const what = theirSection
            ? `the section ${theirSection} of ${t.id}`
            : `${theirFile} of ${t.id}`
          return yield* refuse(
            `${output} changes ${what} (${t.name}) after ${theirs.id} was ${how}`,
            low
              ? `undo the change in ${theirSection ?? theirFile}; if it must change: work escalate ${caller.token} --reason="${t.id} needs a new result"`
              : `undo the change in ${theirSection ?? theirFile}; it changes only through a new result of ${t.id}`,
          )
        }
        // A commit of a task that needs others contains the accepted commit of each one, so
        // their work stays in it.
        for (const part of commit ? needsOpen : []) {
          const theirs = latestResult(work, part.id)
          if (!theirs || theirs.output.split('@')[0] !== file || !COMMIT_AT_END.test(theirs.output)) {
            continue
          }
          const has = yield* git(file, 'merge-base', '--is-ancestor', commitOf(theirs.output) ?? '', commit ?? '')
          if (has.code !== 0) {
            return yield* refuse(
              `${output} does not contain ${theirs.id} of ${part.id} (${theirs.output})`,
              `merge ${theirs.output.split('@')[1]} into your commit, then report again`,
            )
          }
        }
        // Work that changes the same files runs one after the other (Nanda, 2026-11-07): a commit
        // may not change a file that the commit of another open task changes, when the two tasks
        // do not wait for each other and this commit does not contain the other one. The other
        // commit's files come from its own recorded base, so a merge into the base hides nothing.
        const changed = (from: string, to: string) =>
          Effect.map(git(file, 'diff', '--name-only', '--no-renames', from, to), (r) =>
            r.out.split('\n').filter(Boolean),
          )
        if (mergeBase && commit) {
          const waitsFor = (x: Task, y: Task, seen = new Set<TaskId>()): boolean =>
            x.needs.some((n) => {
              if (within(work, y.id, n)) return true
              const needed = work.tasks.get(n)
              if (seen.has(n) || needed === undefined) return false
              seen.add(n)
              return waitsFor(needed, y, seen)
            })
          const linked = (x: Task, y: Task) =>
            within(work, x.id, y.id) ||
            within(work, y.id, x.id) ||
            waitsFor(x, y) ||
            waitsFor(y, x)
          const mine = yield* changed(mergeBase, commit)
          for (const t of [...work.tasks.values()].filter(
            (x) => x.id !== task.id && x.end._tag === 'NotEnded' && !linked(task, x),
          )) {
            const theirs = latestResult(work, t.id)
            if (!theirs || theirs.output.split('@')[0] !== file || !COMMIT_AT_END.test(theirs.output)) {
              continue
            }
            // Their base is the one recorded for their workspace entry of this repo path.
            const theirSource = t.descriptionAi.workspace.find((w) => w.path === file)?.source
            const recorded = theirs.madeFrom.find(
              (m) => m._tag !== 'Result' && m.name === theirSource,
            )
            const theirBase = recorded && recorded._tag !== 'Result' ? revisionOf(recorded) : undefined
            if (!theirBase) continue
            const theirCommit = commitOf(theirs.output) ?? ''
            const both = (yield* changed(theirBase, theirCommit)).filter((f) => mine.includes(f))
            if (both.length === 0) continue
            if ((yield* git(file, 'merge-base', '--is-ancestor', theirCommit, commit)).code === 0) continue
            return yield* refuse(
              `${output} changes ${both.join(', ')}, and so does ${theirs.id} of ${t.id} (${t.name}), which does not wait for ${task.id}; work that changes the same files runs one after the other`,
              low
                ? `work escalate ${caller.token} --reason="${task.id} and ${t.id} change ${both[0]}; one must run after the other"`
                : `make one task wait for the other: a remake of the later one with needs: [${t.id}] (work task remake), or an escalation to the person`,
            )
          }
        }
        const madeFrom: Array<MadeFrom> = []
        for (const m of args.all('made-from')) {
          const word = String(m)
          if (/^r\d+$/.test(word)) {
            madeFrom.push({ _tag: 'Result', result: ResultId.make(word) })
            continue
          }
          const [source = '', revision] = word.split('@')
          if (!revision) {
            return yield* refuse(`--made-from=${word} needs <source>@<revision>, or a result id`)
          }
          // The revision of a git source comes from git, not from the words of an agent.
          if (gitSources(work).some((w) => w.source === source)) {
            return yield* refuse(
              `--made-from=${word}: ${source} is a git source, and the CLI reads its revision from git`,
              `report again without --made-from=${word}`,
            )
          }
          // A source that no git workspace has: an outside source, as the agent names it.
          madeFrom.push({ _tag: 'Outside', name: source, revision })
        }
        // A commit is made from its base: the CLI reads the merge base from git and records it.
        if (mergeBase && space) {
          madeFrom.push({ _tag: 'Git', name: space.source, commit: mergeBase.slice(0, 12) })
        }
        // The files of the result, for the diff of the UI (Nanda, 2026-11-11): a commit's files
        // against its base, in the path of its repo; the file of a section, with its text now (the
        // end of the diff of this result); none for words.
        const resultFiles =
          commit && mergeBase
            ? (yield* changed(mergeBase, commit)).map((f) => posix.join(file, f))
            : output.startsWith('"')
              ? []
              : [output.split('#')[0] ?? '']
        let after: Record<string, string> | null = null
        if (!commit) {
          after = {}
          for (const f of resultFiles) {
            const path = join(cwd, f)
            const bytes = yield* files.size(path)
            const text = bytes !== null && bytes <= 512 * 1024 ? yield* files.read(path) : null
            if (text !== null) after[f] = text
          }
        }
        // A commit always has a patch here (an empty diff is the base's files, refused above),
        // and a file always has a size.
        const made: ReportedWork | undefined = commit
          ? patch === undefined
            ? undefined
            : { _tag: 'Commit', digest, patch }
          : size === undefined
            ? undefined
            : { _tag: 'File', digest, size }
        if (!made) return yield* Effect.die(`the report of ${output} has no patch and no size`)
        const result = {
          _tag: 'Result' as const,
          output,
          madeFrom,
          work: made,
          files: resultFiles,
          after,
        }
        return actOf(caller, { _tag: 'Result', create: result })
      }),
    )
    const result = done.work.results.get(firstCreated(done.created) as ResultId)
    const a = result ? done.work.assignments.get(result.by) : undefined
    if (!result || !a) return yield* Effect.die(`${firstCreated(done.created)} is no result`)
    // A result made under an old snapshot uses no attempt; the line says so instead of a count.
    const tries = triesUsed(done.work, a.id)
    const lines = [
      tries > 0
        ? `${result.id} reported on ${result.task} (attempt ${tries}${maxAttemptsOf(a) !== undefined ? ` of ${maxAttemptsOf(a)}` : ''}).`
        : `${result.id} reported on ${result.task}; it was made under an old version of a direction, so it uses no attempt (the next attempt reads a new brief first).`,
    ]
    yield* runPrograms(call, done.work, result, (l) => lines.push(l))
    lines.push(tierOf(done.work, a) === 'low' ? 'STOP: your parent continues.' : `next: work next ${token}`)
    return lines
  })

// --- review ------------------------------------------------------------------------------------

// A review of a draft of a direction, or of an evaluation: one accept with evidence, or one
// reject with a reason. The accept that meets the deciders of a draft makes it official in
// aristoteles. The person types "accept" for a draft, because the accept can make it official.
const reviewDecision = (call: Call, targetId: string, decision: 'accept' | 'reject') =>
  Effect.gen(function* () {
    const { args, token } = call
    const isDraft = targetId.startsWith('d')
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        yield* checkHashes(work, token)
        const found = yield* lookup(work, targetId, ['d', 'ev'])
        const target = found._tag === 'Revision' ? found.revision.id : undefined
        const confirm =
          !token && isDraft && decision === 'accept' && target
            ? { word: 'accept', show: `accept ${targetId}:\n${renderDraft(work, target)}` }
            : undefined
        const caller = yield* callerOf(work, token, confirm)
        if (caller._tag === 'Agent' && tierOf(work, caller.assignment) === 'low') {
          return yield* refuse(
            `a low role does not review ${isDraft ? 'drafts of directions' : 'evaluations'}`,
          )
        }
        const reason = textOf(args.one('reason'))
        if (decision === 'reject') {
          if (!isNonBlank(reason)) {
            return yield* refuse(`a reject of ${targetId} needs --reason="<why>"`)
          }
          const of =
            found._tag === 'Revision'
              ? { _tag: 'Revision' as const, id: found.revision.id, reason }
              : found._tag === 'Evaluation'
                ? { _tag: 'Evaluation' as const, id: found.evaluation.id, reason }
                : yield* Effect.die(`a review of ${targetId} with no target`)
          return actOf(caller, { _tag: 'Review', create: { _tag: 'Reject', of } })
        }
        const evidence = yield* evidenceOf(args.all('evidence'))
        // The person's accept of a draft needs no evidence; --reason is their optional comment.
        const person = !token && isDraft
        if (!evidence.length && !person) {
          return yield* refuse(
            `an accept of ${targetId} needs --evidence="<where you read in it> | <what you saw there>"`,
          )
        }
        for (const e of evidence) if (e.rule) yield* ruleNamed(work, e.rule)
        const [first, ...more] = evidence
        const review: ReviewWritten | undefined =
          found._tag === 'Revision'
            ? {
                _tag: 'Accept',
                of: { _tag: 'Revision', id: found.revision.id, evidence },
                reason: reason ?? null,
              }
            : found._tag === 'Evaluation' && first
              ? {
                  _tag: 'Accept',
                  of: { _tag: 'Evaluation', id: found.evaluation.id, evidence: [first, ...more] },
                  reason: reason ?? null,
                }
              : undefined
        if (!review) return yield* Effect.die(`a review of ${targetId} with no target or evidence`)
        return actOf(caller, { _tag: 'Review', create: review })
      }),
    )
    const vid = firstCreated(done.created)
    const work = done.work
    if (!isDraft) {
      const { evaluation } = yield* lookupKind('Evaluation', ['ev'], work, targetId)
      const tid = stopTask(work, evaluation.answers)
      return [
        decision === 'accept'
          ? `${vid}: ${targetId} is accepted; it counts for ${tid}.`
          : `${vid}: ${targetId} is rejected; ${tid} waits for a new evaluation.`,
      ]
    }
    const { revision } = yield* lookupKind('Revision', ['d'], work, targetId)
    const version = madeBy(work, revision.id)
    if (version) {
      return [
        `${vid}: accept of ${targetId}. ${targetId} is official: ${versionIdOf(version)}.`,
        ...(yield* followCommit(work, version)),
        ...afterVersion(work, version, done.at),
        'next: running agents keep their snapshot; each new work brief follows it.',
      ]
    }
    if (decision === 'reject') {
      if (!vetoOf(work, revision.id)) {
        const direction = work.directions.get(revision.of)
        return [
          `${vid}: reject of ${targetId}.`,
          `${targetId} stays open; after this Reject, only the accept of ${direction?.owner.name} makes it official.`,
        ]
      }
      // Who writes the next draft, and the command that starts it when there is one.
      const again = reviseAgainOf(work, revision.id)
      return [
        `${vid}: reject of ${targetId}.`,
        `${targetId} is ended; ${again.text}.`,
        ...(again.step === null ? [] : [`next: ${again.step}`]),
      ]
    }
    return [
      `${vid}: accept of ${targetId}; it waits for the accept of ${draftWaitsText(work, revision.id)}.`,
    ]
  })

const review: Command = (call) =>
  Effect.gen(function* () {
    const { args, token } = call
    const rest = token === null ? args.positional : args.positional.slice(1)
    const [targetWord, decisionWord] = rest
    if (decisionWord !== 'accept' && decisionWord !== 'reject') {
      return yield* refuse('a review is accept or reject; to escalate, use work escalate')
    }
    const targetId = String(targetWord)
    if (/^(d|ev)\d+$/.test(targetWord ?? '')) return yield* reviewDecision(call, targetId, decisionWord)
    const done = yield* writeAct(call, (work, at) =>
      Effect.gen(function* () {
        yield* checkHashes(work, token)
        const caller = yield* callerOf(work, token)
        const by = caller._tag === 'Agent' ? caller.assignment : undefined
        const found = yield* lookup(work, targetId, ['r', 't'])
        // A low checker reviews the one result that its brief named.
        const claim = by ? work.meta.get(by.id)?.claim : undefined
        const briefed = claim?._tag === 'Checking' ? claim.result : undefined
        const lowBy = by && tierOf(work, by) === 'low' ? by : undefined
        if (lowBy && !isDo(work, lowBy.role) && !briefed) {
          return yield* refuse(
            'your brief named no result to review',
            `work escalate ${token} --reason="nothing was reported when I read my brief", then STOP`,
          )
        }
        if (lowBy && briefed && targetId !== briefed) {
          return yield* refuse(
            `your brief named ${briefed}; a low checker reviews only that result`,
            targetId === latestResult(work, lowBy.task)?.id
              ? `work escalate ${token} --result=${briefed} --reason="a newer result ${targetId} came after my brief", then STOP`
              : `work review ${token} ${briefed} ...`,
          )
        }
        if (lowBy && found._tag !== 'Result') {
          return yield* refuse(
            `a low checker reviews only the result in its brief${briefed ? `: ${briefed}` : ''}`,
          )
        }
        if (decisionWord === 'accept') {
          const evidence = yield* evidenceOf(args.all('evidence'))
          const reason = textOf(args.one('reason'))
          // The evidence of an accept is about the reported work.
          yield* checkDigest(found, by, work, token ?? undefined)
          if (by && token) {
            const checks = rulesFor(work, by.id, at).map((r) => r.id)
            const named = evidence.flatMap((e) => (e.rule === null ? [] : [e.rule]))
            const outside = named.filter((r) => !checks.includes(r))
            if (outside.length && tierOf(work, by) === 'low') {
              return yield* refuse(
                `${outside.join(', ')} is not in your checks: ${checks.join(', ') || 'none'}`,
              )
            }
            const missing = tierOf(work, by) === 'low' ? checks.filter((r) => !named.includes(r)) : []
            if (missing.length) {
              return yield* refuse(`no --evidence for: ${missing.join(', ')}`)
            }
            // The same command with the one field to correct; the other lines stay as they were.
            const again = (index: number, fix: Partial<EvidenceData>) =>
              `work review ${token} ${targetId} accept ` +
              evidence
                .map((e, i) => (i === index ? { ...e, ...fix } : e))
                .map(evidenceFlag)
                .join(' ')
            if (found._tag === 'Result') yield* checkEvidence(found.result, evidence, again)
          }
          for (const e of evidence) if (e.rule) yield* ruleNamed(work, e.rule)
          if (!evidence.length) {
            return yield* refuse(
              'an accept needs --evidence: <the place in the result where you read it> | <what you saw there>',
            )
          }
          // The engine's own refusal of an accept of a task, which a typed accept cannot carry.
          if (found._tag !== 'Result') {
            return yield* refuse('a task takes only a Reject; an Accept goes on a result of the task')
          }
          const [first, ...others] = evidence
          // The check above leaves at least one line.
          const of = {
            _tag: 'Result' as const,
            id: found.result.id,
            evidence: [first as EvidenceData, ...others] as const,
          }
          const accept = { _tag: 'Accept' as const, of, reason: reason ?? null }
          return actOf(caller, { _tag: 'Review', create: accept })
        }
        const given = yield* pointsOf(args.flags)
        for (const p of given) if (p.breaks) yield* ruleNamed(work, p.breaks)
        // A reject has at least one point.
        if (given.length === 0) return yield* refuse('a reject needs at least one --point')
        const points = yield* pointDataOf(given)
        const [firstPoint, ...otherPoints] = points
        if (!firstPoint) return yield* Effect.die('a reject with points has no first point')
        void at
        if (found._tag === 'Task') {
          // The engine's words: a point on a task names no rule.
          const ruled = points.find((p) => p.breaks !== null)
          if (ruled) {
            return yield* refuse(
              `a Reject of a task names no rule; reject a result for ${ruled.breaks}, or give the point with no rule`,
            )
          }
          const textOf = (p: PointData) => ({ text: p.text })
          const taskPoints = [textOf(firstPoint), ...otherPoints.map(textOf)] as const
          const of = { _tag: 'Task' as const, id: found.task.id, points: taskPoints }
          return actOf(caller, { _tag: 'Review', create: { _tag: 'Reject', of } })
        }
        if (found._tag !== 'Result') return yield* Effect.die(`${targetId} is no result or task`)
        const of = {
          _tag: 'Result' as const,
          id: found.result.id,
          points: [firstPoint, ...otherPoints] as const,
        }
        return actOf(caller, { _tag: 'Review', create: { _tag: 'Reject', of } })
      }),
    )
    const vid = firstCreated(done.created)
    const stored = done.written?.event
    const review = stored?._tag === 'Review' ? stored.create : undefined
    const pointIds = (n: number) => Array.from({ length: n }, (_, i) => `${vid}.${i + 1}`)
    const what =
      review?._tag === 'Reject' && 'points' in review.of
        ? `reject of ${targetId} with ${review.of.points.length} point(s): ${pointIds(review.of.points.length).join(', ')}`
        : `accept of ${targetId}`
    const by = token ? yield* agentOf(done.work, token) : undefined
    // A low checker's unit ends here; the state of the result is its parent's to read.
    if (by && tierOf(done.work, by) === 'low') {
      return [`${vid}: your review of ${targetId} is recorded.`, `STOP: ${upTo(by)} continues.`]
    }
    const lines = [`${vid}: ${what}.`]
    const target = yield* lookup(done.work, targetId, ['r', 't'])
    if (target._tag === 'Result') {
      const items = blockerItems(done.work, target.result.id, done.at)
      lines.push(
        items.length
          ? `${targetId} still has ${items.length} blocker(s): work blockers ${targetId}`
          : `${targetId} has no blockers; ${target.result.task} is ${taskStateWord(taskState(done.work, target.result.task, done.at))}.`,
      )
    }
    return lines
  })

// --- resolve, recheck, escalate, ask, answer, note ----------------------------------------------

// The answerer of an escalation (or a role that decides its result) resolves it in words: the
// agreement or the direction. A Resolve accepts and rejects nothing; the deciders of the result
// then review it as usual.
const resolve: Command = (call) =>
  Effect.gen(function* () {
    const { args, token } = call
    const rest = token === null ? args.positional : args.positional.slice(1)
    const escalationWord = String(rest[0])
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        yield* checkHashes(work, token)
        const caller = yield* callerOf(work, token)
        const found = yield* lookup(work, escalationWord, ['v'])
        if (found._tag !== 'Review' || found.review._tag !== 'Escalate') {
          return yield* refuse(
            `${escalationWord} is not an escalation; a resolve ends an escalation`,
            'work waiting lists the escalations that wait for you',
          )
        }
        const resolution = wordsOf(args.one('resolution'))
        if (!isNonBlank(resolution)) {
          return yield* refuse(
            'a resolve needs its words: --resolution="<the agreement, or the direction>"',
          )
        }
        const evidence = yield* evidenceOf(args.all('evidence'))
        for (const e of evidence) if (e.rule) yield* ruleNamed(work, e.rule)
        // Evidence is about the reported work, so that work must be unchanged; an agent names
        // the place in the result, as in a review.
        if (evidence.length) {
          const by = caller._tag === 'Agent' ? caller.assignment : undefined
          const result = yield* lookup(work, found.review.of, ['r'])
          yield* checkDigest(result, by, work, token ?? undefined)
          const again = (index: number, fix: Partial<EvidenceData>) =>
            `work resolve ${token} ${escalationWord} --resolution="${resolution}" ` +
            evidence
              .map((e, i) => (i === index ? { ...e, ...fix } : e))
              .map(evidenceFlag)
              .join(' ')
          if (by && result._tag === 'Result') yield* checkEvidence(result.result, evidence, again)
        }
        const escalation = found.review.id
        const resolve = { _tag: 'Resolve' as const, escalation, resolution, evidence }
        return actOf(caller, { _tag: 'Review', create: resolve })
      }),
    )
    const stored = done.written?.event
    if (stored?._tag !== 'Review' || stored.create._tag !== 'Resolve') {
      return yield* Effect.die('resolve: the store wrote no resolve')
    }
    const escalated = done.work.reviews.get(stored.create.escalation)
    const result = escalated?._tag === 'Escalate' ? done.work.results.get(escalated.of) : undefined
    if (!result) return yield* Effect.die('resolve: the escalation names no result')
    const items = blockerItems(done.work, result.id, done.at)
    const state = taskStateWord(taskState(done.work, result.task, done.at))
    return [
      `${firstCreated(done.created)}: resolves ${stored.create.escalation} on ${result.id}.`,
      items.length
        ? `${result.id} still has ${items.length} blocker(s): work blockers ${result.id}`
        : `${result.id} has no blockers; ${result.task} is ${state}.`,
    ]
  })

// A decider asks for a new result after a change outside (a source outside git changed), or to
// reopen accepted work.
const recheck: Command = (call) =>
  Effect.gen(function* () {
    const [token, targetId] = call.args.positional
    const { cwd } = yield* Dir
    const done = yield* writeAct(call, (work, at) =>
      Effect.gen(function* () {
        const caller = yield* agentCallerOf(work, token ?? null)
        const a = caller.assignment
        yield* needOpen(work, a)
        yield* needClaim(work, a, caller.token)
        if (tierOf(work, a) === 'low') {
          return yield* refuse('a low role does not ask for a recheck; escalate it')
        }
        const found = yield* lookup(work, String(targetId), ['r'])
        if (found._tag !== 'Result') return yield* Effect.die(`lookup of ${String(targetId)} gave a ${found._tag}`)
        const target = found.result
        if (!inTree(work, found, a)) {
          return yield* refuse(`${targetId} is outside the task tree of ${a.id}`)
        }
        // A recheck asks for new work after a change outside (a newer source, newer work of a task
        // that it needs, a new version), or reopens accepted work. With none, it would be a free
        // try.
        const outside =
          staleOf(work, target.id, cwd) ||
          blockerItems(work, target.id, at).some((i) => i._tag === 'OldNeed' || i._tag === 'OldVersion')
        if (!outside && !accepted(work, target.id, at)) {
          return yield* refuse(
            `nothing changed outside since ${targetId} was made, and it is not accepted, so a recheck would be a free try`,
            `review it: work review ${caller.token} ${targetId} reject --point="<what is wrong>", or work escalate ${caller.token} --result=${targetId} --reason="<what changed>"`,
          )
        }
        // The engine's words: a recheck is a Reject, and a Reject needs a reason.
        const reason = wordsOf(call.args.one('reason'))
        if (!isNonBlank(reason)) return yield* refuse('a Reject needs a reason')
        const recheck = { _tag: 'Recheck' as const, of: target.id, reason }
        return actOf(caller, { _tag: 'Review', create: recheck })
      }),
    )
    const stored = done.written?.event
    if (stored?._tag !== 'Review' || stored.create._tag !== 'Recheck') {
      return yield* Effect.die('recheck: the store wrote no recheck')
    }
    const target = done.work.results.get(stored.create.of)
    return [
      `${firstCreated(done.created)} asks for a new result of ${target?.task}; the gates run on the next report.`,
      `next: work next ${token}`,
    ]
  })

const escalate: Command = (call) =>
  Effect.gen(function* () {
    const token = call.args.positional[0]
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* agentCallerOf(work, token ?? null)
        const a = caller.assignment
        yield* needOpen(work, a)
        const result = textOf(call.args.one('result'))
        const reason = wordsOf(call.args.one('reason'))
        if (result) {
          const found = yield* lookup(work, result, ['r'])
          if (found._tag !== 'Result') return yield* Effect.die(`lookup of ${result} gave a ${found._tag}`)
          if (!inTree(work, found, a)) {
            return yield* refuse(`${result} is outside the task tree of ${a.id}`)
          }
          if (!isNonBlank(reason)) return yield* refuse('an escalation needs a reason')
          // escalate --result: the result waits for the answerer's resolve.
          const escalate = { _tag: 'Escalate' as const, of: found.result.id, reason }
          return actOf(caller, { _tag: 'Review', create: escalate })
        }
        // An escalation with no result: the maker sends its blocked task up as a question.
        if (!isNonBlank(reason)) return yield* refuse('an escalation needs a reason')
        return actOf(caller, create('Question', { _tag: 'Escalated', text: reason }))
      }),
    )
    const author = done.written?.author
    const a = author?._tag === 'Agent' ? done.work.assignments.get(author.assignment) : undefined
    if (!a) return yield* Effect.die('the escalation stored no assignment')
    const owner = done.work.tasks.get(a.task)?.owner.name
    const to = a.parent._tag === 'Parent' ? a.parent.id : owner
    return [
      `${firstCreated(done.created)} escalated to ${to}.`,
      tierOf(done.work, a) === 'low'
        ? 'STOP: your parent continues.'
        : a.parent._tag === 'Parent'
          ? `next: work next ${token}`
          : `next: ${to} answers it; work waiting --for=${to} shows it`,
    ]
  })

const ask: Command = (call) =>
  Effect.gen(function* () {
    const token = call.args.positional[0]
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* agentCallerOf(work, token ?? null)
        const a = caller.assignment
        yield* needOpen(work, a)
        const to = textOf(call.args.one('to'))
        if (tierOf(work, a) === 'low' && to === 'owner') {
          return yield* refuse('a low role asks its parent', `work ask ${token} --text="..."`)
        }
        const text = wordsOf(call.args.one('text'))
        if (!isNonBlank(text)) return yield* refuse('a question needs its text')
        const asked = {
          _tag: 'Asked' as const,
          text,
          to: to === 'owner' ? { _tag: 'Owner' as const } : { _tag: 'Above' as const },
        }
        return actOf(caller, create('Question', asked))
      }),
    )
    return [`${firstCreated(done.created)} asked; the task waits for the answer.`]
  })

const answer: Command = (call) =>
  Effect.gen(function* () {
    const rest = call.token === null ? call.args.positional : call.args.positional.slice(1)
    yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* callerOf(work, call.token)
        const { question } = yield* lookupKind('Question', ['q'], work, String(rest[0]))
        const text = wordsOf(call.args.one('text'))
        if (!isNonBlank(text)) return yield* refuse('an answer needs its text')
        const answered = { _tag: 'Answered' as const, text }
        return actOf(caller, move('Question', question.id, answered))
      }),
    )
    return [`${rest[0]} answered; the asker's next brief shows the answer.`]
  })

const NOTE_KINDS = { finding: 'Finding', message: 'Message', words: 'Words' } as const

// The hope of the words of a draft: an open draft (a direction problem that waits) needs it; a
// draft that is already official has no problem left to hope about, so it takes none.
const hopeOf = (work: Work, draft: RevisionId, on: string | undefined, hope: string | undefined) =>
  Effect.gen(function* () {
    if (madeBy(work, draft) !== undefined) {
      if (hope) return yield* refuse(`${on} is already official; its words take no --hope`)
      return null
    }
    if (!hope) {
      return yield* refuse(
        `work note <token> words --on=${on} --text="<the problem>" --hope="<what you hope by this change>": the UI shows the diff of the draft between them (work guide decision-words)`,
      )
    }
    return hope
  })

const note: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const [token, which] = args.positional
    const kind = which !== undefined && Object.hasOwn(NOTE_KINDS, which)
      ? NOTE_KINDS[which as keyof typeof NOTE_KINDS]
      : undefined
    if (!kind) {
      return yield* refuse(
        'a note is a finding, a message, or (the host) words --on=<decision>; a question is work ask',
      )
    }
    const on = textOf(args.one('on'))
    const hope = textOf(args.one('hope'))
    if (kind === 'Words' && !on) {
      return yield* refuse(
        `work note ${token} words --on=<the decision: sp.., d.., h..> --text="<the words>" (work guide decision-words)`,
      )
    }
    // A --hope belongs only to the words of a draft of a direction (--on=d..).
    const direction = kind === 'Words' && /^d\d+$/.test(on ?? '')
    if (!direction && hope) {
      return yield* refuse('--hope is only for the words of a direction problem (--on=d..)')
    }
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* agentCallerOf(work, token ?? null)
        const a = caller.assignment
        yield* needOpen(work, a)
        const text = wordsOf(args.one('text'))
        if (!isNonBlank(text)) return yield* refuse('a note needs its text')
        if (kind === 'Words') {
          // The words of a decision, one member per kind of decision; a hope only on a draft.
          const found = yield* lookup(work, String(on), ['sp', 'd', 'h'])
          const hostWords =
            found._tag === 'Problem'
              ? { _tag: 'ProblemWords' as const, on: found.problem.id, text }
              : found._tag === 'Revision'
                ? {
                    _tag: 'DraftWords' as const,
                    on: found.revision.id,
                    text,
                    hope: yield* hopeOf(work, found.revision.id, on, hope),
                  }
                : found._tag === 'Run'
                  ? { _tag: 'EndWords' as const, on: found.run.id, text }
                  : yield* Effect.die(`lookup of ${String(on)} gave a ${found._tag}`)
          return actOf(caller, { _tag: 'HostWords', create: hostWords })
        }
        // A message or a finding is about the task of the agent.
        return actOf(caller, { _tag: 'Note', create: { _tag: kind, about: a.task, text } })
      }),
    )
    if (kind === 'Words') return [`the words of ${on} are written; the UI shows them on the decision.`]
    return [`${firstCreated(done.created)} noted.`]
  })

// --- evaluate, checkpoint, source, resume ------------------------------------------------------

const LEVELS = ['task', 'standard', 'direction', 'principle'] as const

// An evaluation of a mistake (Nanda, 2026-11-08): the high role of the task's tree, or the
// person, says what is wrong, why the task cannot be done as asked, and what to improve. It
// answers one stop; a task id names its first stop that waits.
const evaluate: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const rest = call.token === null ? args.positional : args.positional.slice(1)
    const [stopId] = rest
    if (!stopId) {
      return yield* refuse(
        'use work evaluate [<token>] <stop> --wrong="..." --why="..." --improve="..." --level=task|standard|direction|principle ' +
          '(a stop is ex<n>, the last try of a maker, or v<n>, a Reject of the person; a task id names its first stop)',
      )
    }
    let stopWord = stopId
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* callerOf(work, call.token)
        if (caller._tag === 'Agent') yield* needOpen(work, caller.assignment)
        let stop: Stop
        if (/^t\d+$/.test(stopId)) {
          const { task } = yield* lookupKind('Task', ['t'], work, stopId)
          const waits = evaluationWaits(work, task.id)
          if (!waits) return yield* refuse(`${stopId} waits for no evaluation`)
          stop = waits
          stopWord = stopIdOf(work, waits)
        } else {
          const found = yield* lookup(work, stopId, ['ex', 'v'])
          // The stop by its kind; any other review is no stop (the engine's words).
          const review = found._tag === 'Review' ? found.review : undefined
          if (found._tag === 'Exhaustion') stop = { _tag: 'Exhaustion', id: found.exhaustion.id }
          else if (found._tag === 'Point') stop = { _tag: 'PersonReject', id: found.id }
          else if (review?._tag === 'Reject') stop = { _tag: 'PersonReject', id: review.id }
          else {
            return yield* refuse(
              'an evaluation answers a stop: the last try of a maker that ended on a fault, or a Reject of the person',
            )
          }
        }
        // The engine refused these after its other checks, in this order; a typed evaluation
        // cannot hold them .
        const [wrong, why] = [wordsOf(args.one('wrong')), wordsOf(args.one('why'))]
        if (!isNonBlank(wrong) || !isNonBlank(why)) {
          return yield* refuse(
            'an evaluation says what is wrong and why the task cannot be done as asked',
          )
        }
        const [first, ...more] = args.all('improve').map(String).filter(isNonBlank)
        if (first === undefined || more.length + 1 < args.all('improve').length) {
          return yield* refuse('an evaluation says what to improve, so that the task can continue')
        }
        const level = LEVELS.find((l) => l === args.one('level'))
        if (level === undefined) {
          return yield* refuse(`the level of the deepest cause is one of: ${LEVELS.join(', ')}`)
        }
        const evaluation = {
          _tag: 'Evaluation' as const,
          stop,
          wrong,
          why,
          improve: [first, ...more] as const,
          level,
        }
        return actOf(caller, { _tag: 'Evaluation', create: evaluation })
      }),
    )
    const work = done.work
    const { evaluation: e } = yield* lookupKind('Evaluation', ['ev'], work, firstCreated(done.created))
    const task = stopTask(work, e.answers)
    const next = evaluationWaits(work, task)
    const owner = work.tasks.get(task)?.owner.name
    const stopLine = String(stopWord)
    return [
      `${e.id} evaluates ${task} at the level ${e.level}; it answers ${stopLine}.`,
      !evaluationCounts(work, e)
        ? `It counts after ${owner} accepts it: work review ${e.id} accept --evidence="<where you read> | <what you saw>"`
        : next
          ? `${task} also waits for an evaluation of ${stopIdOf(work, next)}: work evaluate ${stopIdOf(work, next)} ...`
          : workStop(work, task, done.at)
            ? 'The next maker starts after a change that its improvements ask for: a direction version that says something new to the task, a newer accepted result of a task that it needs, or a remake or a split.'
            : `${task} goes on: work next prints its steps.`,
      call.token ? `next: work next ${call.token}` : 'next: work waiting',
    ]
  })

// A checkpoint keeps the revision of each source outside git as it is now.
const checkpoint: Command = (call) =>
  Effect.gen(function* () {
    const [token, taskWord] = call.args.positional
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* agentCallerOf(work, token ?? null)
        const a = caller.assignment
        yield* needOpen(work, a)
        if (tierOf(work, a) === 'low') {
          return yield* refuse('a low role does not checkpoint; report or escalate')
        }
        const { task } = yield* lookupKind('Task', ['t'], work, String(taskWord))
        // New: the stored checkpoint says what comes next (the old one could keep none).
        const next = wordsOf(call.args.one('next'))
        if (!isNonBlank(next)) return yield* refuse('a checkpoint needs --next="<what comes next>"')
        const checkpoint = { _tag: 'Checkpoint' as const, task: task.id, next }
        return actOf(caller, { _tag: 'Checkpoint', create: checkpoint })
      }),
    )
    return [`${firstCreated(done.created)} saved for ${String(taskWord)}.`]
  })

const source: Command = (call) =>
  Effect.gen(function* () {
    const [token, ref] = call.args.positional
    const [name = '', revision] = String(ref ?? '').split('@')
    if (!revision) return yield* refuse('use work source <token> <source>@<revision>')
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* agentCallerOf(work, token ?? null)
        const a = caller.assignment
        yield* needOpen(work, a)
        if (tierOf(work, a) === 'low') {
          return yield* refuse('a low role records no source', 'STOP and tell your parent what changed')
        }
        // A git source has its revision in git; the CLI reads the base of each commit there.
        if (gitSources(work).some((w) => w.source === name)) {
          return yield* refuse(
            `${name} is a git source: the CLI reads the base of each commit from git, and a new commit on it asks for no recheck`,
          )
        }
        // An outside source: a new revision moves it; the same revision again only renews when
        // it was seen (new: the old CLI stored the same revision again).
        const now = work.sources.get(name)
        if (now?._tag === 'Outside' && now.revision === revision) {
          return actOf(caller, move('Source', name, { _tag: 'Checked' }))
        }
        const source = { _tag: 'Outside' as const, name, revision }
        return actOf(caller, create('Source', { _tag: 'Moved', source }))
      }),
    )
    const event = done.written?.event
    const checked = event?._tag === 'Source' && 'move' in event
    return [checked ? `${name} is still at ${revision}; seen now.` : `${name} is at ${revision}.`]
  })

const resume: Command = (call) =>
  Effect.gen(function* () {
    const [token, taskWord] = call.args.positional
    const { work, at, dir } = yield* readWork
    const caller = yield* agentCallerOf(work, token ?? null)
    const a = caller.assignment
    const { task } = yield* lookupKind('Task', ['t'], work, String(taskWord))
    if (!within(work, task.id, a.task)) {
      return yield* refuse(`${taskWord} is outside the task tree of ${a.id}`)
    }
    const saved = [...work.checkpoints.values()].filter((k) => k.task === task.id).at(-1)
    if (!saved?.id) {
      return [`${taskWord} has no checkpoint; work next ${caller.token} shows what is ready.`]
    }
    const savedId = saved.id
    const savedAt = work.events.find((l) => l.created.includes(savedId as CheckpointId as CreatedId))
    const author = savedAt ? whoOf(savedAt.recorded.author).who : undefined
    // The answers that came after the checkpoint, to questions about this tree.
    const answeredSince = work.events
      .filter((l) => l.recorded.seq > (savedAt?.recorded.seq ?? 0))
      .flatMap(({ recorded: { event: e } }) =>
        e._tag === 'Question' && 'move' in e && e.move._tag === 'Answered' ? [e.id] : [],
      )
      .filter((q) => {
        const asked = work.questions.get(q)
        return asked !== undefined && within(work, asked.stops, task.id)
      })
    const outsideNow = [...work.sources.values()]
    const { changedOutside } = engineResume(work, savedId, a.id, at, outsideNow)
    // Only results built on a revision that is no longer current need a recheck.
    const latest = latestResult(work, task.id)
    const stale = resultsOf(work, task.id).filter(
      (r) => r.id === latest?.id && staleOf(work, r.id, dir),
    )
    const lines = nextLines(work, nextSteps(work, a.id, { token: caller.token, at, cwd: dir }), {
      token: caller.token,
      at,
    })
    return [
      `resume ${taskWord} from ${savedId} (saved by ${author}): next was "${saved.next}"`,
      `changed outside: ${changedOutside.map((c) => `${c.name}@${revisionOf(c)}`).join(', ') || 'nothing'}`,
      ...(answeredSince.length
        ? [`answered since ${savedId}: ${answeredSince.join(', ')} (work question show <id>)`]
        : []),
      ...(stale.length
        ? stale.map(
            (r) =>
              `check again: work recheck ${caller.token} ${r.id} --reason="${changedOutside.map((c) => c.name).join(', ')} changed"`,
          )
        : ['check again: nothing']),
      ...lines,
    ]
  })

export const commands: Commands = {
  brief,
  report,
  review,
  resolve,
  recheck,
  escalate,
  ask,
  answer,
  note,
  evaluate,
  checkpoint,
  resume,
  source,
}

// Types that the file names for readers of the bundle.
export type { NewAct, RevisionId }
