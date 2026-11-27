import { projectReviewCommand } from '../../../../adapters/cli/commands/project.ts'
import { expect, test } from 'bun:test'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Effect, Result, Schema } from 'effect'
import { liveTaskCommands } from '../../../../adapters/live/task-commands.ts'
import { openPageProject, receiveProjectPayload } from '../../../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot } from '../../../../adapters/web/project.ts'
import { open, staffInput, withJournal } from '../../../../src/store/project.probe.ts'
import { direction } from '../../../../src/store/proposal.probe.ts'
import { artifactQuote, reviewAs, resultInput, taskKey, taskLine, toWorking } from '../../../../src/store/task.probe.ts'
import { Authority } from '../../../actions/project.ts'
import { startChild } from '../../../actions/staff-session.ts'
import { session } from '../../../../src/store/project.probe.ts'
import { runTaskCommands } from '../../../effects/project-commands.ts'
import { CommandOutput, Direction } from '../../../schema/project.ts'
import { readPosition } from '../../../state/project.ts'
import { picked } from './itf.probe.ts'
import { readTrace, record, integer } from './driver.ts'

const check = 'reviewEvidence'
const kinds = ['success', 'fault', 'mutant'] as const
const standard = direction.standards[0]!
const reviewDirection = Schema.decodeUnknownSync(Direction)({
  ...direction, standards: [{ ...standard, rules: [...standard.rules, {
    _tag: 'Rule', name: 'Readable result', text: 'Review the result for clarity.',
    verification: { _tag: 'Prompt', question: 'Is the result clear?',
      source: { _tag: 'Quote', file: 'artifact', lines: { first: 1, last: 1 }, text: '7' } },
    knownBreaks: [], examples: [],
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
    let blockedMutant = false
    let committedReviews = 0
    const rule = (key: number) => {
      const rules = reviewDirection.standards[0]!.rules
      return key === 3 ? { ...rules[1], text: 'A different version' } : rules[key - 1]
    }
    for (const step of trace.states.slice(1)) {
      const prior = state
      if (step.action === 'result') state = (yield* staffInput(journal, resultInput(state.read))).state
      else if (step.action === 'commands') {
        const observation = record(picked(step.picks.outcome)!)
        expect(integer(observation.rule)).toBe(1)
        const commands = liveTaskCommands(directory)
        const committed = yield* runTaskCommands(journal, taskLine, {
          ...commands, run: (command) => Effect.succeed(Schema.decodeUnknownSync(CommandOutput)({
            _tag: 'CommandOutput', command, exit: observation.breaks ? 1 : 0, stdout: 'test output', stderr: '',
          })),
        })
        state = committed.state
        expect(state.tasks.get(taskKey)?.phase).toMatchObject({
          _tag: 'Reviewing', outcomes: [{ _tag: observation.breaks ? 'Breaks' : 'Holds', rule: rule(1) }],
        })
        captured = true
      } else if (step.action === 'assignReview') {
        state = (yield* startChild(journal, state, taskLine, session, 'Review')).state
      } else if (step.action === 'report') {
        const reports = picked(step.picks.reports)
        if (!Array.isArray(reports)) throw new Error('Expected review outcomes')
        const facts = {
          outcomes: reports.map((raw) => {
            const { rule: key, breaks, evidence } = record(raw)
            return { rule: rule(integer(key)), _tag: breaks ? 'Breaks' : 'Holds',
              evidence: evidence ? artifactQuote : { ...artifactQuote, text: 'absent' } }
          }),
          findings: picked(step.picks.finding) ? [{ text: 'Uncovered problem', evidence: artifactQuote }] : [],
        }
        const outcome = yield* Effect.result(projectReviewCommand(journal, taskKey, state.read, Bun.YAML.stringify(facts)).pipe(
          Effect.provideService(Authority, { actor: Effect.succeed(reviewAs(state)) }),
        ))
        if (Result.isSuccess(outcome)) {
          expect(step.state.lastReportValid).toBe(true)
          state = outcome.success.state
          committedReviews++
        } else {
          expect(['InvalidInput', 'InvalidEvidence']).toContain(outcome.failure.code)
          expect(yield* journal.eventsAfter(prior.read)).toEqual([])
          blockedMutant = kind === 'mutant' && step.state.lastReportValid === false
        }
      } else if (step.action !== '') throw new Error('Unexpected work evidence action: ' + step.action)

      const actual = state.tasks.get(taskKey)?.phase
      const { tag, value } = record(step.state.task!)
      if (!blockedMutant) expect<unknown>(actual?._tag).toBe(tag)
      if (!blockedMutant && actual?._tag === 'Reviewing') {
        expect(actual.assignment._tag).toBe(record(value!).review === 'Waiting' ? 'Waiting' : 'Assigned')
      }
      if (!blockedMutant && actual?._tag === 'Working') {
        expect(Number(actual.attempt.retryCount)).toBe(integer(record(value!).retries))
      }
      if (!blockedMutant && actual?._tag === 'Done') {
        expect(actual.outcomes.map(({ rule, _tag }) => [rule.name, _tag]))
          .toEqual(reviewDirection.standards[0]!.rules.map(({ name }) => [name, 'Holds']))
      }
      if (!blockedMutant && actual?._tag === 'Raised') {
        expect<unknown>(actual.reason).toBe(typeof value === 'string' ? value : record(value!).tag)
        expect<unknown>(actual.evidence).toEqual(artifactQuote)
      }
      const response = yield* projectEvents(journal, readPosition(page.current()))
      expect(Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => response.json())))).toEqual(state)
      if (blockedMutant) { expect(state).toEqual(prior); break }
    }
    expect(blockedMutant).toBe(kind === 'mutant')
    if (kind !== 'mutant') expect(committedReviews).toBe(kind === 'fault' ? 2 : 1)
    expect(captured).toBe(true)
  }))),
))
