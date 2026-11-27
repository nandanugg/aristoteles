import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { join } from 'node:path'
import { Effect, Result, Schema } from 'effect'
import { projectReportCommand } from '../../../../adapters/cli/commands/project.ts'
import { openPageProject, receiveProjectPayload } from '../../../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot } from '../../../../adapters/web/project.ts'
import { create, host, open, ownerInput, session, staffInput, withJournal } from '../../../../src/store/project.probe.ts'
import { direction } from '../../../../src/store/proposal.probe.ts'
import { startWork } from '../../../../src/store/project-activation.probe.ts'
import { acceptDirection, activateTasks, artifactQuote, draftFor, resultInput, reviewAs, send, taskKey } from '../../../../src/store/task.probe.ts'
import { Authority, submit } from '../../../actions/project.ts'
import { startChild } from '../../../actions/staff-session.ts'
import { recordTaskCommands } from '../../../actions/task.ts'
import { Direction, ReadPosition, TaskKey, activeStages, taskMembership, taskRules, type Project } from '../../../schema/project.ts'
import type { Journal } from '../../../services/project.ts'
import { fold, readPosition } from '../../../state/project.ts'
import { taskChildren } from '../task-tree.ts'
import { integer, readTrace } from './driver.ts'
import { picked } from './itf.probe.ts'

const check = 'splitDependency'
const origin = ReadPosition.make(0)
const rootLine = { line: 'Task', key: taskKey } as const
const staffAuthority = Effect.provideService(Authority, { actor: Effect.succeed({ _tag: 'Staff', session } as const) })
const stageNames = ['Plan the change', 'Make the change', 'Check the result', 'Record the work', 'Hand it over'] as const
const projectFor = (journal: Journal, stageCount = 3) => Effect.gen(function* () {
  const selected = Schema.decodeUnknownSync(Direction)({
    ...direction, standards: [], stages: stageNames.slice(0, stageCount).map((name) => ({ ...direction.stages[0], name })),
  })
  const opened = yield* create(journal)
  return (yield* startWork(journal, yield* activateTasks(journal, opened.state, selected))).state
})
const part = (key: string, first: number, last: number) => ({
  task: TaskKey.make('task:' + key), name: 'Part ' + key, goal: 'Complete the named stages.',
  range: { first, last }, role: host.key, dependency: { _tag: 'Serial' }, why: 'This work fits the assigned staff model.',
})
const plan = (...parts: readonly ReturnType<typeof part>[]) => ({
  why: 'Separate the work by purpose.', review: 'The handoff can be reviewed in one pass.', parts,
})
const firstSplit = (journal: Journal, project: Project, partition: ReturnType<typeof plan>, read = project.read) => {
  const { key, ...draft } = draftFor(project)
  return ownerInput(journal, { read, ...rootLine, key, move: 'split',
    input: { _tag: 'New', draft: { ...draft, role: host.key, attachments: [] }, partition },
  })
}
const beginPart = (journal: Journal, project: Project, key: typeof TaskKey.Type, read = project.read) =>
  staffInput(journal, { line: 'Task', key, move: 'next', read, input: {} })
const finishPart = (journal: Journal, working: Project, key: typeof TaskKey.Type) => Effect.gen(function* () {
  const reported = yield* staffInput(journal, { ...resultInput(working.read), key })
  const ready = yield* submitNothingToReview(journal, reported.state, key)
  const line = { line: 'Task', key } as const
  const assigned = yield* startChild(journal, ready, key, session, 'Review')
  return (yield* submit(journal, { ...line, read: assigned.state.read, move: 'review', input: { facts: { outcomes: [], findings: [] } } })
    .pipe(Effect.provideService(Authority, { actor: Effect.succeed(reviewAs(assigned.state, line)) }))).state
})
const submitNothingToReview = (journal: Journal, project: Project, key: typeof TaskKey.Type) =>
  Effect.map(recordTaskCommands(journal, key, project.read, []), ({ state }) => state)

for (const kind of ['success', 'fault', 'mutant'] as const) test('ordered partition and serial admission — ' + kind, () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const trace = readTrace(join(import.meta.dir, 'traces', check + '-' + kind + '.itf.json.gz'), check, kind)
    let project = yield* projectFor(journal)
    const initialRead = project.read
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    let revision = 0
    let blocked = false
    for (const step of trace.states.slice(1)) {
      const prior = project
      switch (step.action) {
        case '': break
        case 'split': {
          const ranges = picked(step.picks.parts)
          if (!Array.isArray(ranges) || ranges.length !== 2) throw new Error('Expected two model parts')
          const parts = ranges.map((range, index) => {
            if (!Array.isArray(range)) throw new Error('Expected a stage range')
            return part('revision-' + revision + '-' + index, integer(range[0]), integer(range.at(-1)))
          })
          const pickedRead = integer(picked(step.picks.read))
          const read = pickedRead === revision ? project.read
            : pickedRead === 0 ? initialRead : ReadPosition.make(project.read + 1)
          const partition = plan(...parts)
          const result = yield* Effect.result(revision === 0 ? firstSplit(journal, project, partition, read)
            : ownerInput(journal, { ...rootLine, read, move: 'redistribute', input: partition }))
          const wanted = integer(step.state.basis)
          if (Result.isFailure(result)) {
            expect(result.failure.code).toBe(pickedRead === revision ? 'InvalidInput' : 'Stale')
            expect(yield* journal.eventsAfter(prior.read)).toEqual([])
            blocked = kind === 'mutant' && wanted !== revision
          } else {
            expect(wanted).toBe(revision + 1)
            expect(result.success.following.map(({ move }) => move)).toEqual(['open', 'open'])
            project = result.success.state
            revision = wanted
          }
          break
        }
        case 'startFirst':
        case 'startSecond':
        case 'finishFirst': {
          const parent = project.tasks.get(taskKey)!
          const [first, second] = taskChildren(project, parent)
          if (!first || !second) throw new Error('The split must have two parts')
          if (step.action === 'startFirst') {
            const refused = yield* Effect.result(beginPart(journal, project, second.key))
            expect(Result.getOrThrow(Result.flip(refused)).code).toBe('WrongMove')
            project = (yield* beginPart(journal, project, first.key)).state
          } else if (step.action === 'finishFirst') {
            project = yield* finishPart(journal, project, first.key)
          } else project = (yield* beginPart(journal, project, second.key)).state
          break
        }
        default: throw new Error('Unexpected split witness action: ' + step.action)
      }
      const events = yield* projectEvents(journal, readPosition(page.current()))
      expect(Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => events.json())))).toEqual(project)
      expect(Result.getOrThrow(fold(yield* journal.eventsAfter(origin)))).toEqual(project)
      if (blocked) break
      expect(revision).toBe(integer(step.state.basis))
      const parent = project.tasks.get(taskKey)
      if (!parent) continue
      const parts = taskChildren(project, parent)
      expect<unknown>(parts.map(({ phase }) => phase._tag)).toEqual([step.state.first, step.state.second])
      expect<unknown>(parts.flatMap((task) => activeStages(task).map(({ name }) => name))).toEqual(stageNames.slice(0, 3))
    }
    expect(blocked).toBe(kind === 'mutant')
  })))))

test('the assignee raises before working and only the sender repairs or retires a part', () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = yield* projectFor(journal)
    const sent = yield* send(journal, project.read)
    const report = { reason: 'TooBig', why: 'The brief spans separate changes.' }
    const raised = yield* projectReportCommand(journal, taskKey, sent.state.read, Bun.YAML.stringify(report)).pipe(staffAuthority)
    expect(raised.state.tasks.get(taskKey)?.phase).toMatchObject({
      _tag: 'Raised', reason: 'TooBig', origin: { _tag: 'Brief', why: report.why }, retained: { _tag: 'NoResult' },
    })
    const first = part('first', 1, 1), second = part('second', 2, 2), third = part('third', 3, 3)
    const request = { ...rootLine, read: raised.state.read, move: 'split', input: { _tag: 'Existing', partition: plan(first, second, third) } }
    expect(Result.getOrThrow(Result.flip(yield* Effect.result(staffInput(journal, request)))).code).toBe('WrongActor')
    const split = yield* ownerInput(journal, request)
    const raisedChild = yield* projectReportCommand(journal, first.task, split.state.read, Bun.YAML.stringify(report)).pipe(staffAuthority)
    const droppedInput = { line: 'Task', key: first.task, read: raisedChild.state.read, move: 'drop', input: { why: 'The sender will replace this stage.' } }
    expect(Result.getOrThrow(Result.flip(yield* Effect.result(ownerInput(journal, droppedInput)))).code).toBe('WrongActor')
    const dropped = yield* staffInput(journal, droppedInput)
    expect(Result.getOrThrow(Result.flip(yield* Effect.result(beginPart(journal, dropped.state, second.task)))).code).toBe('WrongMove')
    const changed = yield* ownerInput(journal, { ...rootLine, read: dropped.state.read, move: 'dropStage',
      input: { _tag: 'Split', stage: 1, evidence: [artifactQuote], partition: plan(second, third) },
    })
    expect(changed.state.tasks.get(first.task)?.phase._tag).toBe('Dropped')
    expect(taskMembership(changed.state, changed.state.tasks.get(first.task)!)).toBe('Replaced')
    expect((yield* beginPart(journal, changed.state, second.task)).state.tasks.get(second.task)?.phase._tag).toBe('Working')
  })))))

test('the partition transaction rolls back on child append failure and refuses a fifth level', () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    let project = yield* projectFor(journal, 5)
    const initial = plan(part('left', 1, 4), part('right', 5, 5))
    const db = new Database(path)
    try {
      db.exec(`CREATE TRIGGER fail_child BEFORE INSERT ON project_event WHEN NEW.number = ${project.read + 2}
        BEGIN SELECT RAISE(ABORT, 'interrupted split test'); END`)
      expect(Result.getOrThrow(Result.flip(yield* Effect.result(firstSplit(journal, project, initial)))).code).toBe('Unavailable')
      expect(yield* journal.eventsAfter(project.read)).toEqual([])
      db.exec('DROP TRIGGER fail_child')
    } finally { db.close() }
    project = (yield* firstSplit(journal, project, initial)).state
    const nested = (parent: string, from: number) => staffInput(journal, {
      line: 'Task', key: 'task:' + parent, read: project.read, move: 'split',
      input: { _tag: 'Existing', partition: plan(part('left-' + from, 1, from), part('right-' + from, from + 1, from + 1)) },
    })
    project = (yield* nested('left', 3)).state
    project = (yield* nested('left-3', 2)).state
    const refused = yield* Effect.result(nested('left-2', 1))
    expect(Result.getOrThrow(Result.flip(refused)).why).toContain('at most four levels')
    expect(yield* journal.eventsAfter(project.read)).toEqual([])
  })))))

test('join and redistribute preserve an unchanged child and reject a live replacement', () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    let project = yield* projectFor(journal, 4)
    const right = part('right', 3, 4)
    const initial = plan(part('one', 1, 1), part('two', 2, 2), right)
    project = (yield* firstSplit(journal, project, initial)).state
    const joined = plan(part('left', 1, 2), right)
    const revise = (move: 'joinParts' | 'redistribute' | 'split', partition: ReturnType<typeof plan>, read = project.read) =>
      ownerInput(journal, { ...rootLine, read, move, input: move === 'split' ? { _tag: 'Existing', partition } : partition })
    const firstRead = project.read
    const beforeJoin = project.tasks.get(right.task)
    const result = yield* revise('joinParts', joined)
    expect(result.following).toHaveLength(1)
    project = result.state
    expect(project.tasks.get(right.task)).toEqual(beforeJoin)
    const newBoundary = plan(part('three', 1, 3), part('four', 4, 4))
    expect(Result.getOrThrow(Result.flip(yield* Effect.result(revise('redistribute', newBoundary, firstRead)))).code).toBe('Stale')
    expect(Result.getOrThrow(Result.flip(yield* Effect.result(revise('redistribute', joined)))).code).toBe('InvalidInput')
    project = (yield* revise('redistribute', newBoundary)).state
    project = (yield* beginPart(journal, project, newBoundary.parts[0]!.task)).state
    const replaceBusy = yield* Effect.result(revise('split', plan(part('new-left', 1, 2), part('new-right', 3, 4))))
    expect(Result.getOrThrow(Result.flip(replaceBusy)).why).toContain('Keep active and completed parts')
    expect(yield* journal.eventsAfter(project.read)).toEqual([])
  })))))


test('attached direction steps stay with their spine stage when children open', () =>
  withJournal((path) => Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const opened = yield* projectFor(journal)
    const original = draftFor(opened)
    const updated = yield* acceptDirection(journal, opened, direction)
    const attached = draftFor(updated).direction
    const state = yield* ownerInput(journal, { ...rootLine, read: updated.read, move: 'split', input: {
      _tag: 'New', draft: { name: original.name, goal: original.goal, stages: original.stages,
        role: host.key, reviewer: original.reviewer, direction: original.direction, facts: original.facts,
        attachments: [{ at: 2, direction: attached, stage: 1 }] },
      partition: plan(part('first', 1, 1), part('second', 2, 3)),
    } })
    const [first, second] = taskChildren(state.state, state.state.tasks.get(taskKey)!)
    expect(first?.attachments).toEqual([])
    expect(taskRules(first!)).toEqual([])
    expect(second?.attachments).toMatchObject([{ at: 1, direction: attached, stage: 1 }])
    expect(taskRules(second!)).toEqual(direction.standards[0]!.rules)
  })))))
