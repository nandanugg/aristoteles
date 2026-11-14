// The report of a maker: what it made, checked against the work of the other tasks (the same
// files, sections and commits; the base; the starting point; untouched or rejected work). The
// programs that run after a report are the adapter's (D11: Report, then for each program Give,
// Accept or Reject, Finish).
import { realpathSync } from 'node:fs'
import { join, posix } from 'node:path'
import { Effect } from 'effect'
import type { Derived } from '../derived/index.ts'
import {
  answered,
  isOpenTask,
  latestResultOf,
  resultsOf,
  reviewsOf,
  untouchedOf,
  within,
} from '../derived/reads.ts'
import type { Refusal } from '../schema/errors.ts'
import {
  type Assignment,
  create,
  decisionOf,
  type MadeFrom,
  type ReportedWork,
  type Result,
  ResultId,
  revisionOf,
  sectionOf,
  type Task,
  type TaskId,
  type Work,
} from '../schema/index.ts'
import {
  checkOutput,
  commitOnBase,
  digestNow,
  Files,
  outputChanged,
  sectionsInside,
  Spawn,
} from '../services/index.ts'
import { outputForm } from './output.ts'
import {
  allowed,
  blank,
  configUnchanged,
  current,
  no,
  type RefusalsOf,
  tierOfAgent,
} from './support.ts'
import type { Action } from './types.ts'

export const REFUSALS = {
  Report: {
    noOutput: () =>
      no(
        'a report needs --output=<what you made, and where>',
        'Write',
        'write what you made, and where it is, with --output',
      ),
    badOutput: (message: string) =>
      no(message, 'Write', 'report an output that names your work: a file, a section, a commit'),
    otherOutput: (expected: string) =>
      no(`the output of this task is ${expected}`, 'Pick', `report ${expected}`),
    otherForm: (role: string, form: string) =>
      no(`the output of ${role} has the form ${form}`, 'Pick', `report an output like ${form}`),
    notInWorkspace: (file: string, task: string, spaces: string) =>
      no(
        `${file} is not in the workspace of ${task}: ${spaces}`,
        'Pick',
        `report a file of the workspace of ${task}`,
      ),
    notRepoTop: (file: string) =>
      no(
        `${file} is not the top of its own git repo; the workspace repo is ${file}`,
        'Pick',
        `report a commit of the repo ${file} itself`,
      ),
    sectionOwned: (section: string, owner: string, name: string) =>
      no(
        `the section ${section} belongs to ${owner} (${name})`,
        'Pick',
        'report the section of your own task',
      ),
    startingPoint: (output: string, task: string, start: string) =>
      no(
        `${output} is the starting point of ${task} (${start}); a report is new work`,
        'Write',
        `make new work on top of ${start}, then report it`,
      ),
    notOnStart: (output: string, start: string, startOutput: string, commit: string) =>
      no(
        `${output} does not start from ${start} (${startOutput})`,
        'Write',
        `make your commit on top of ${commit}, then report it`,
      ),
    untouched: (output: string, task: string) =>
      no(
        `${output} is the same as before any work on ${task}; a report is new work`,
        'Write',
        'change the work, then report it',
      ),
    noBase: (file: string, task: string) =>
      no(
        `${file} is a git workspace of ${task} with no base, so the CLI cannot check the commit`,
        'Escalate',
        `escalate it: the person opens ${task} with base: <branch> in its workspace`,
      ),
    baseMissing: (file: string, base: string) =>
      no(
        `${file} has no ${base}, the base of this task, so the CLI cannot check the commit`,
        'Escalate',
        `escalate it: the person opens the task with a base that ${file} has`,
      ),
    onBase: (commit: string, base: string) =>
      no(
        `${commit} is already on ${base}; a report is a new commit`,
        'Write',
        `make a new commit on top of ${base}, then report it`,
      ),
    noHistory: (output: string, base: string) =>
      no(
        `${output} shares no history with ${base}; a report is a commit on top of ${base}`,
        'Write',
        `make the commit on a branch from ${base}, then report it`,
      ),
    sameAsBase: (output: string, base: string) =>
      no(
        `${output} has the same files as ${base}; a report is new work`,
        'Write',
        'change the work, then report it',
      ),
    noPatchId: (output: string) =>
      no(
        `git gave no patch-id for ${output}, so the CLI cannot compare it with other work`,
        'Escalate',
        'escalate it: git reads no patch of the commit',
      ),
    copied: (output: string, other: string, task: string, name: string, own: string) =>
      no(
        `${output} is the work of ${other} of ${task} (${name}); a report is the work of ${own}`,
        'Write',
        `make the work of ${own}, then report it`,
      ),
    notOnSource: (output: string, source: string, revision: string) =>
      no(
        `${output} is not built on ${source}@${revision}; rebase it first`,
        'Write',
        `rebase the commit on ${source}@${revision}, then report it`,
      ),
    rejectedTwin: (output: string, twin: string) =>
      no(
        `${output} is the same as ${twin}, which was rejected`,
        'Write',
        `change the work that ${twin} made, then report it`,
      ),
    nothingChanged: (previous: string) =>
      no(
        `nothing changed since ${previous}; a report is new work`,
        'Write',
        'change the work, then report it',
      ),
    nested: (nest: string) =>
      no(
        `${nest}; the sections of two tasks do not nest`,
        'Escalate',
        'escalate it: the person remakes the tasks with sections that do not nest',
      ),
    changesOther: (output: string, what: string, name: string, theirs: string, how: string) =>
      no(
        `${output} changes ${what} (${name}) after ${theirs} was ${how}`,
        'Write',
        `undo the change in ${what}; it changes only through a new result of its task`,
      ),
    missingNeed: (output: string, theirs: string, part: string, out: string, commit: string) =>
      no(
        `${output} does not contain ${theirs} of ${part} (${out})`,
        'Write',
        `merge ${commit} into your commit, then report it`,
      ),
    sameFiles: (message: string, other: string) =>
      no(
        message,
        'Escalate',
        `escalate it: one task waits for the other (a remake with needs: [${other}])`,
      ),
    madeFromForm: (word: string) =>
      no(
        `--made-from=${word} needs <source>@<revision>, or a result id`,
        'Write',
        'name the source and its revision, like facts@3',
      ),
    // A low agent stops on a refusal of its work: its parent decides (the old next lines).
    low: (message: string) =>
      no(message, 'Escalate', 'escalate it to your parent with what you found'),
  },
} satisfies Readonly<Record<string, RefusalsOf>>
const R = REFUSALS.Report

const COMMIT = /^[^#]+@[0-9a-f]{7,40}$/
const COMMIT_AT_END = /@[0-9a-f]{7,40}$/
const commitOf = (output: string): string | undefined => output.split('@')[1]
const unique = (tasks: ReadonlyArray<Task>): ReadonlyArray<Task> => [
  ...new Map(tasks.map((t) => [t.id, t])).values(),
]
const real = (p: string): string => {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}
// The git sources: the workspaces that have a base.
const gitSources = (w: Work) =>
  [...w.tasks.values()].flatMap((t) =>
    t.descriptionAi.workspace.flatMap((x) => (x._tag === 'Repo' ? [x] : [])),
  )

// The checks of the work of a report, and its event (BUILD.md 3.6 step 3, 4).
const reportOf = (
  d: Derived,
  a: Assignment,
  output: string,
  madeFromWords: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    const w = d.moment.work
    const cwd = d.moment.outside.cwd
    const files = yield* Files
    const spawn = yield* Spawn
    const low = tierOfAgent(w, a) === 'low'
    // A refusal of the work: a low agent escalates it (its parent decides).
    const refuse = (r: Refusal) => Effect.fail(low ? R.low(r.message) : r)
    const git = (file: string, ...args: ReadonlyArray<string>) =>
      spawn.run(['git', '-C', join(cwd, file), ...args])
    yield* checkOutput(cwd, output).pipe(Effect.mapError((e) => R.badOutput(e.message)))
    const task = w.tasks.get(a.task)
    const file_ = w.config.roles[a.role]
    if (task === undefined) return yield* Effect.die(`${a.id} has no task`)
    const expected = outputForm(w, a.id)
    const form = file_?.output
    if (!expected.includes('<') && !expected.startsWith('"')) {
      if (output !== expected) return yield* Effect.fail(R.otherOutput(expected))
    } else if (
      form &&
      (form.includes('#') ? !output.includes('#') : form.includes('@') && !output.includes('@'))
    ) {
      return yield* Effect.fail(R.otherForm(a.role, form))
    }
    const workspace = task.descriptionAi.workspace
    const file = output.split(/[#@]/)[0] ?? ''
    const isCommit = COMMIT.test(output)
    // A file of the dir is written only in the workspace of the task; a task with none writes none.
    const onDisk = (yield* files.kind(join(cwd, file))) !== null
    if (
      (workspace.length || onDisk) &&
      !workspace.some((x) => file === x.path || (!isCommit && file.startsWith(`${x.path}/`)))
    ) {
      const spaces = workspace.map((x) => x.path).join(', ') || 'none'
      return yield* Effect.fail(R.notInWorkspace(file, task.id, spaces))
    }
    // A commit belongs to the workspace repo itself, not to a repo inside it or around it.
    if (isCommit) {
      const top = yield* git(file, 'rev-parse', '--show-toplevel')
      if (top.code !== 0 || real(top.out.trim()) !== real(join(cwd, file))) {
        return yield* Effect.fail(R.notRepoTop(file))
      }
    }
    // A task may not take a section that another open task of its tree owns.
    const section = output.split('#')[1]
    let topId = task.id
    let up = task.serves
    while (up._tag === 'Serves') {
      topId = up.task
      up = w.tasks.get(up.task)?.serves ?? { _tag: 'TopTask' }
    }
    const needsOpen = task.needs
      .map((n) => w.tasks.get(n))
      .filter((t): t is Task => t !== undefined && isOpenTask(t))
    const others = unique([
      ...[...w.tasks.values()].filter(
        (t) =>
          t.id !== task.id && isOpenTask(t) && within(w, t.id, topId) && !within(w, task.id, t.id),
      ),
      ...needsOpen,
    ])
    const owner = others.find((t) => section && sectionOf(t.descriptionAi.context) === section)
    if (owner) return yield* Effect.fail(R.sectionOwned(section ?? '', owner.id, owner.name))
    const { digest, size, commit } = yield* digestNow(cwd, output).pipe(
      Effect.mapError((e) => R.badOutput(e.message)),
    )
    // A task that starts from earlier work reports new work made on top of it.
    const startId = task.descriptionAi.from
    const start = startId ? w.results.get(startId) : undefined
    if (start && digest === start.work.digest) {
      return yield* refuse(R.startingPoint(output, task.id, start.id))
    }
    if (start && commit && COMMIT_AT_END.test(start.output)) {
      const on = yield* git(
        file,
        'merge-base',
        '--is-ancestor',
        commitOf(start.output) ?? '',
        commit,
      )
      if (on.code !== 0) {
        const at = start.output.split('@')[1] ?? ''
        return yield* Effect.fail(R.notOnStart(output, start.id, start.output, at))
      }
    }
    // Untouched work: as at the first brief of its task. A task that needs others may keep the
    // file as they left it, when one of them did accepted work.
    const first = untouchedOf(w, task.id)
    const beforeWork = first._tag === 'AtFirstBrief' ? first.files[file] : undefined
    const was = beforeWork && (section ? beforeWork.sections[section] : beforeWork.digest)
    const needsWorked = task.needs.some((t) =>
      resultsOf(w, t).some((r) => d.states.results.get(r.id)?._tag === 'Accepted'),
    )
    if (!commit && was && digest === was && !needsWorked) {
      return yield* refuse(R.untouched(output, task.id))
    }
    const space = workspace.find((x) => x.path === file)
    const spaceBase = space?._tag === 'Repo' ? space.base : undefined
    let mergeBase: string | undefined
    let patch: string | undefined
    if (commit && !spaceBase) return yield* Effect.fail(R.noBase(file, task.id))
    if (commit && spaceBase) {
      const base = spaceBase
      if ((yield* git(file, 'rev-parse', '--verify', `${base}^{commit}`)).code !== 0) {
        return yield* Effect.fail(R.baseMissing(file, base))
      }
      if (yield* commitOnBase(cwd, file, commit, base)) {
        return yield* Effect.fail(R.onBase(commitOf(output) ?? '', base))
      }
      mergeBase = (yield* git(file, 'merge-base', commit, base)).out.trim()
      if (!mergeBase) return yield* Effect.fail(R.noHistory(output, base))
      const baseTree = (yield* git(file, 'rev-parse', `${mergeBase}^{tree}`)).out.trim()
      if (baseTree === digest) return yield* Effect.fail(R.sameAsBase(output, base))
      // The work of a commit is its change against its merge base, as git patch-id names it, in
      // one fixed diff form whatever the repo or the environment sets.
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([k]) => !/^GIT_(CONFIG|EXTERNAL_DIFF|DIFF_OPTS)/.test(k),
        ),
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
      if (diff.out.length > 0 && !patch) return yield* Effect.fail(R.noPatchId(output))
      // Another task's work is not this task's result.
      const copied = [...w.results.values()].find(
        (r) =>
          r.task !== task.id &&
          !task.needs.includes(r.task) &&
          r.output.split('@')[0] === file &&
          COMMIT_AT_END.test(r.output) &&
          (commit.startsWith(commitOf(r.output) ?? '\0') ||
            (patch !== undefined && r.work._tag === 'Commit' && r.work.patch === patch)),
      )
      if (copied) {
        const name = w.tasks.get(copied.task)?.name ?? ''
        return yield* refuse(R.copied(output, copied.id, copied.task, name, task.id))
      }
    }
    const sameWork = (r: Result) =>
      patch && r.work._tag === 'Commit' ? r.work.patch === patch : r.work.digest === digest
    const previous = latestResultOf(w, task.id)
    const redoOpen =
      previous !== undefined &&
      reviewsOf(w, previous.id).some((v) => v._tag === 'Recheck' && !answered(w, v.id))
    // After a recheck, a commit contains the new revision of its source.
    const seen = space ? w.sources.get(space.source) : undefined
    const sourceNow = seen ? revisionOf(seen) : undefined
    if (commit && redoOpen && sourceNow && space) {
      if ((yield* git(file, 'merge-base', '--is-ancestor', sourceNow, commit)).code !== 0) {
        return yield* Effect.fail(R.notOnSource(output, space.source, sourceNow))
      }
    }
    const rejectedTwin = resultsOf(w, task.id).find(
      (r) =>
        r.id !== previous?.id &&
        sameWork(r) &&
        reviewsOf(w, r.id).some((v) => decisionOf(v) === 'Reject'),
    )
    if (rejectedTwin) return yield* refuse(R.rejectedTwin(output, rejectedTwin.id))
    if (previous && sameWork(previous) && !redoOpen) {
      return yield* refuse(R.nothingChanged(previous.id))
    }
    // A report keeps the work that other open tasks own (not its ancestors').
    const keepers = unique([
      ...[...w.tasks.values()].filter(
        (t) => t.id !== task.id && isOpenTask(t) && !within(w, task.id, t.id),
      ),
      ...needsOpen,
    ])
    if (section) {
      const inside = yield* sectionsInside(cwd, output)
      for (const t of keepers.filter(
        (x) =>
          sectionOf(x.descriptionAi.context) !== null &&
          x.descriptionAi.workspace.some((y) => y.path === file),
      )) {
        const theirSection = sectionOf(t.descriptionAi.context) ?? ''
        const nest = (yield* sectionsInside(cwd, `${file}#${theirSection}`)).includes(section)
          ? `the section ${section} lies inside the section ${theirSection} of ${t.id} (${t.name})`
          : inside.includes(theirSection)
            ? `the section ${theirSection} of ${t.id} (${t.name}) lies inside the section ` +
              section
            : undefined
        if (nest) return yield* refuse(R.nested(nest))
      }
    }
    for (const t of keepers) {
      const theirs = latestResultOf(w, t.id)
      if (!theirs || COMMIT_AT_END.test(theirs.output)) continue
      const [theirFile, theirSection] = theirs.output.split('#')
      const covered = theirFile === file && (theirSection ? true : task.needs.includes(t.id))
      if (!covered || !(yield* outputChanged(cwd, theirs))) continue
      const how = d.states.tasks.get(t.id)?._tag === 'Accepted' ? 'accepted' : 'reported'
      const what = theirSection
        ? `the section ${theirSection} of ${t.id}`
        : `${theirFile} of ${t.id}`
      return yield* refuse(R.changesOther(output, what, t.name, theirs.id, how))
    }
    // A commit of a task that needs others contains the accepted commit of each one.
    for (const part of commit ? needsOpen : []) {
      const theirs = latestResultOf(w, part.id)
      if (!theirs || theirs.output.split('@')[0] !== file || !COMMIT_AT_END.test(theirs.output)) {
        continue
      }
      const has = yield* git(
        file,
        'merge-base',
        '--is-ancestor',
        commitOf(theirs.output) ?? '',
        commit ?? '',
      )
      if (has.code !== 0) {
        const at = theirs.output.split('@')[1] ?? ''
        return yield* Effect.fail(R.missingNeed(output, theirs.id, part.id, theirs.output, at))
      }
    }
    // Work that changes the same files runs one after the other: a commit may not change a file
    // that the commit of another open task changes, when neither waits for the other.
    const changed = (from: string, to: string) =>
      Effect.map(git(file, 'diff', '--name-only', '--no-renames', from, to), (r) =>
        r.out.split('\n').filter(Boolean),
      )
    if (mergeBase && commit) {
      const waitsFor = (x: Task, y: Task, seen_ = new Set<TaskId>()): boolean =>
        x.needs.some((n) => {
          if (within(w, y.id, n)) return true
          const needed = w.tasks.get(n)
          if (seen_.has(n) || needed === undefined) return false
          seen_.add(n)
          return waitsFor(needed, y, seen_)
        })
      const linked = (x: Task, y: Task) =>
        within(w, x.id, y.id) || within(w, y.id, x.id) || waitsFor(x, y) || waitsFor(y, x)
      const mine = yield* changed(mergeBase, commit)
      for (const t of [...w.tasks.values()].filter(
        (x) => x.id !== task.id && isOpenTask(x) && !linked(task, x),
      )) {
        const theirs = latestResultOf(w, t.id)
        if (!theirs || theirs.output.split('@')[0] !== file || !COMMIT_AT_END.test(theirs.output)) {
          continue
        }
        const theirSource = t.descriptionAi.workspace.find((x) => x.path === file)?.source
        const recorded = theirs.madeFrom.find((m) => m._tag !== 'Result' && m.name === theirSource)
        const theirBase = recorded && recorded._tag !== 'Result' ? revisionOf(recorded) : undefined
        if (!theirBase) continue
        const theirCommit = commitOf(theirs.output) ?? ''
        const both = (yield* changed(theirBase, theirCommit)).filter((f) => mine.includes(f))
        if (both.length === 0) continue
        if ((yield* git(file, 'merge-base', '--is-ancestor', theirCommit, commit)).code === 0)
          continue
        const message =
          `${output} changes ${both.join(', ')}, and so does ${theirs.id} of ${t.id} ` +
          `(${t.name}), which does not wait for ${task.id}; work that changes the same files ` +
          'runs one after the other'
        return yield* refuse(R.sameFiles(message, t.id))
      }
    }
    // N4 (I4): a git source's revision comes from git (its merge base below), so the words of
    // the agent for it are dropped, not refused.
    const madeFrom: Array<MadeFrom> = []
    for (const word of madeFromWords) {
      if (/^r\d+$/.test(word)) {
        madeFrom.push({ _tag: 'Result', result: ResultId.make(word) })
        continue
      }
      const [source = '', revision] = word.split('@')
      if (!revision) return yield* Effect.fail(R.madeFromForm(word))
      if (gitSources(w).some((x) => x.source === source)) continue
      madeFrom.push({ _tag: 'Outside', name: source, revision })
    }
    if (mergeBase && space) {
      madeFrom.push({ _tag: 'Git', name: space.source, commit: mergeBase.slice(0, 12) })
    }
    // The files of the result, for the diff of the page: a commit's files against its base, in
    // the path of its repo; the file of a section, with its text now; none for words.
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
        const bytes = yield* files.size(join(cwd, f))
        const text = bytes !== null && bytes <= 512 * 1024 ? yield* files.read(join(cwd, f)) : null
        if (text !== null) after[f] = text
      }
    }
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
    return create('Result', result)
  })

const Report: Action<'Report'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const { output, madeFrom } = input.content
    if (blank(output)) return yield* Effect.fail(R.noOutput())
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const a = d.moment.work.assignments.get(input.target.assignment)
    if (a === undefined) return yield* Effect.die('canAct names the assignment')
    return [yield* reportOf(d, a, output, madeFrom)]
  })

export const ACTIONS = { Report }
