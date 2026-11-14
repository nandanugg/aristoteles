// The programs (gates) that run after a report, as the system (BUILD.md D11: Report, then for each
// program Give, Accept or Reject, Finish). A program writes as the system, not as the agent whose report started it.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { rulesOf } from '../../core/derived/reads.ts'
import {
  type AssignmentId,
  type Result,
  type RoleFile,
  roleFileOf,
  type Work,
} from '../../core/schema/index.ts'
import { Dir, Files, Spawn } from '../../core/services/index.ts'
import { act, firstCreated } from './runtime.ts'

// Splits a program's run line into words; double quotes keep spaces. No shell runs it.
const wordsOfLine = (line: string): ReadonlyArray<string> =>
  [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? '')

interface Ran {
  readonly ok: boolean
  readonly text: string
  readonly output?: string
}

// A program that cannot run, or runs too long, records a reject; its full output stays in
// .work/runs/.
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
      return {
        ok: run.code === 0,
        text: run.code === 0 ? 'exit 0' : `exit ${run.code}`,
        output,
      } as Ran
    })
    const cleanup = Effect.suspend(() =>
      tree && commit
        ? Effect.asVoid(
            spawn.run([
              'git',
              '-C',
              join(cwd, commit[1] ?? ''),
              'worktree',
              'remove',
              '--force',
              tree,
            ]),
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

// After a report, each program that reviews the maker's role runs: three writes each.
export const runPrograms = (
  work: Work,
  result: Result,
  out: (line: string) => void,
) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const files = yield* Files
    const maker = work.assignments.get(result.by)?.role
    for (const role of work.workflow.roles.values()) {
      const c = roleFileOf(work, role.role)
      if (c.kind !== 'program' || c.on !== 'report') continue
      if (
        !role.acts.some(
          (a) => a._tag === 'Review' && maker !== undefined && a.resultsOf.includes(maker),
        )
      ) {
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
        (run.output ?? '').trim().split('\n').filter(Boolean).slice(-3).join(' / ') ||
        '(no output)'
      const where = `${c.run} on ${result.output}`
      const system = { _tag: 'System' } as const
      // A program reviews: it makes no result, so it has no attempts. The secret is the old one:
      // Give stores its sha256.
      const assigned = yield* act(system, {
        _tag: 'Give',
        target: { task: tid, role: role.role },
        content: { maxAttempts: null, secret: `program-${rid}` },
      })
      const pid = firstCreated(assigned.created) as AssignmentId
      const program = { _tag: 'Program', assignment: pid } as const
      const [first = ''] = checks
      const line = (rule: string) => ({ rule, where: `${where}: exit 0`, what: `${tail} (${log})` })
      if (run.ok) {
        yield* act(program, {
          _tag: 'Accept',
          target: { of: { _tag: 'Result', id: rid } },
          content: { evidence: checks.map(line), reason: null },
        })
      } else {
        yield* act(program, {
          _tag: 'Reject',
          target: { of: { _tag: 'Result', id: rid } },
          content: {
            points: [
              {
                text: `${where}: ${run.text}: ${tail} (full output: ${log})`,
                breaks: first,
              },
            ],
            reason: null,
          },
        })
      }
      yield* act(system, { _tag: 'Finish', target: { assignment: pid }, content: {} })
      out(`${role.role} ran on ${rid}: ${run.ok ? 'accept' : `reject (${run.text}; ${log})`}`)
    }
  })
