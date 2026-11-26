import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Effect, Result, Schema } from 'effect'
import { liveTaskCommands } from '../../../../adapters/live/task-commands.ts'
import { openPageProject, receiveProjectPayload } from '../../../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot } from '../../../../adapters/web/project.ts'
import { open, staffInput, withJournal } from '../../../../src/store/project.probe.ts'
import { direction } from '../../../../src/store/proposal.probe.ts'
import { resultInput, taskId, taskLine, toWorking } from '../../../../src/store/task.probe.ts'
import { runTaskCommands } from '../../../effects/project-commands.ts'
import { CommandOutput, Direction } from '../../../schema/project.ts'
import { readPosition } from '../../../state/project.ts'
import { picked } from '../../c16/replay/itf.ts'
import { readTrace, record, integer } from './driver.ts'

const check = 'reviewEvidence'
const kinds = ['success', 'fault', 'mutant'] as const
const standard = direction.standards[0]!
const reviewDirection = Schema.decodeUnknownSync(Direction)({
  ...direction, standards: [{ ...standard, rules: [...standard.rules, {
    _tag: 'Rule', id: 'rule:readable', name: 'Readable result', text: 'Review the result for clarity.',
    verification: { _tag: 'Prompt', question: 'Is the result clear?',
      source: { _tag: 'Quote', file: 'artifact', lines: { first: 1, last: 1 }, text: '7' } },
    examples: [],
  }] }],
})

for (const kind of kinds) test('review evidence uses the pinned result and command — ' + kind, () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const trace = readTrace(join(import.meta.dir, 'traces', check + '-' + kind + '.itf.json.gz'), check, kind)
    const directory = dirname(path)
    writeFileSync(join(directory, 'artifact'), '7')
    const journal = yield* open(path)
    let state = (yield* toWorking(journal, reviewDirection)).state
    const initial = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => initial.json()), () => {}))
    let captured = false
    for (const step of trace.states.slice(1)) {
      // U7 supplies the fresh review and outcomes of its prompt rules.
      if (step.action === 'assignReview') break
      if (step.action === 'result') state = (yield* staffInput(journal, resultInput(state.read))).state
      if (step.action === 'commands') {
        const observation = record(picked(step.picks.outcome)!)
        expect(integer(observation.rule)).toBe(1)
        const commands = liveTaskCommands(directory)
        const committed = yield* runTaskCommands(journal, taskLine, {
          ...commands, run: (command) => Effect.succeed(Schema.decodeUnknownSync(CommandOutput)({
            _tag: 'CommandOutput', command, exit: observation.breaks ? 1 : 0, stdout: 'test output', stderr: '',
          })),
        })
        state = committed.state
        expect(state.tasks.get(taskId)?.phase).toMatchObject({
          _tag: 'Reviewing', outcomes: [{ _tag: observation.breaks ? 'Breaks' : 'Holds',
            rule: { id: direction.standards[0]!.rules[0]!.id } }],
        })
        captured = true
      }
      if (!['', 'result', 'commands'].includes(step.action)) throw new Error('Unexpected work evidence action')
      const task = record(step.state.task!)
      if (task.tag !== 'Working' && task.tag !== 'ReadyToReview' && task.tag !== 'Reviewing') throw new Error('Invalid model task phase')
      expect(state.tasks.get(taskId)?.phase._tag).toBe(task.tag)
      const response = yield* projectEvents(journal, readPosition(page.current()))
      expect(Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => response.json())))).toEqual(state)
    }
    expect(captured).toBe(true)
  }))),
))
