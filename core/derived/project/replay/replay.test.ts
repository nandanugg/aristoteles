import { acceptDirection, promptDirection, reportReview } from '../../../../src/store/task.probe.ts'
import { startWork } from '../../../../src/store/project-activation.probe.ts'
import { expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Effect, Result, Schema } from 'effect'
import { staffSessionOperations, type Sessions } from '../../../../adapters/live/staff-session.ts'
import { liveTaskCommands } from '../../../../adapters/live/task-commands.ts'
import { runTaskCommands } from '../../../effects/project-commands.ts'
import { acceptStaffing, cliProposal, direction } from '../../../../src/store/proposal.probe.ts'
import { assignProposalReview } from '../../../actions/proposal.ts'
import { recordTaskCommands } from '../../../actions/task.ts'
import { observeSession, readOpenProject, startChild } from '../../../actions/staff-session.ts'
import { initialStaffing, maker, sharedStaffing } from '../../../../src/store/staff-session.probe.ts'
import { openPageProject, receiveProjectPayload } from '../../../../adapters/web/app/project-state.ts'
import { projectEvents, projectSnapshot } from '../../../../adapters/web/project.ts'
import { create, open, session, staff, staffInput, startFixtureSession, startSession, withJournal } from '../../../../src/store/project.probe.ts'
import { activateTasks, begin, commandOutcomes, resultInput, send, taskKey, taskLine, toWorking } from '../../../../src/store/task.probe.ts'
import {
  answerYaml, cliQuestion, ownerAuthority, pageQuestion, questionKey, readRefusal, staffAuthorityOf, textForm,
} from '../../../../src/store/question.probe.ts'
import { capacity, staffingAt, taskRole, AnswerText, CommandOutcome, EventNumber, ProposalKey, ReadPosition, StaffSessionKey, TaskKey, type Of, type Projection, type Submission } from '../../../schema/project.ts'
import { fold, readPosition } from '../../../state/project.ts'
import { readTrace, registeredChecks, replayReportRace } from './driver.ts'

import { replayQuestionAnswer } from './question.ts'
import { replayStaffCapacity, replayStaffReplacementObservations } from './staff.ts'

const root = resolve(import.meta.dir, '../../../..')
const traces = join(import.meta.dir, 'traces')
const check = 'taskReportRace'
const kinds = ['success', 'fault', 'mutant'] as const
const filename = (kind: typeof kinds[number]) => check + '-' + kind + '.itf.json.gz'
const origin = ReadPosition.make(0)

test('every registered check has its success, fault and mutant witnesses', () => {
  const expected = registeredChecks(root).flatMap((check) => kinds.map((kind) => {
    const name = check + '-' + kind + '.itf.json.gz'
    expect(readTrace(join(traces, name), check, kind).states.length).toBeGreaterThan(1)
    return name
  }))
  expect(readdirSync(traces).sort()).toEqual(expected.sort())
})

test('the append seam has all three registered trace inputs', () => {
  expect(registeredChecks(root)).toContain(check)
  expect(readdirSync(traces).filter((name) => name.startsWith(check + '-')).sort())
    .toEqual(kinds.map(filename).sort())
  expect(new Set(kinds.map((kind) => readTrace(join(traces, filename(kind)), check, kind).modelRevision)).size).toBe(1)
})

for (const kind of kinds) test('task report race append seam — ' + kind, () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const opened = yield* create(journal)
    const { state: active } = yield* startWork(journal, yield* activateTasks(journal, opened.state))
    const live = yield* startFixtureSession(journal, active)
    const sent = yield* send(journal, readPosition(live.state))
    let current: Projection = sent.state
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    let basis = readPosition(sent.state)
    const trace = readTrace(join(traces, filename(kind)), check, kind)
    const completed = yield* Effect.promise(() => replayReportRace(trace, kind, {
      begin: async () => {
        const committed = await Effect.runPromise(begin(journal, readPosition(current)))
        current = committed.state
        basis = readPosition(current)
      },
      report: async () => {
        const outcome = await Effect.runPromise(Effect.result(staffInput(journal, resultInput(basis))))
        if (Result.isFailure(outcome)) {
          expect(outcome.failure.code).toBe('Stale')
          return 'Refused'
        }
        current = outcome.success.state
        return 'Committed'
      },
      commands: async () => {
        current = (await Effect.runPromise(runTaskCommands(journal, taskLine, liveTaskCommands(dirname(path))))).state
      },
      observe: async () => {
        const response = await Effect.runPromise(projectEvents(journal, readPosition(page.current())))
        expect(Result.getOrThrow(receiveProjectPayload(page, await response.json()))).toEqual(current)
        const committed = await Effect.runPromise(journal.eventsAfter(origin))
        const state = Result.getOrThrow(fold(committed))
        expect(state).toEqual(current)
        if (state?.status._tag !== 'Open') throw new Error('The replay has no opened project')
        const task = state.tasks.get(taskKey)
        if (!task) throw new Error('The replay has no sent task')
        const phase = task.phase
        if (phase._tag === 'Done' || phase._tag === 'Raised') throw new Error('Unexpected terminal phase')
        const attempt = phase._tag === 'Working' ? phase.attempt
          : phase._tag === 'Sent' ? undefined : phase.result.attempt
        const writes = committed.flatMap((event) => {
          return event.from === 'Working' && event.move === 'next' ? event.input.files.map((file) => Number(file.image._tag === 'Present' ? file.image.contents : file.image.previousContents)) : []
        })
        return {
          phase: phase._tag,
          attempt: attempt?.number ?? 0,
          retryCount: phase._tag === 'Sent' ? phase.retryCount : phase._tag === 'Working' ? phase.attempt.retryCount : phase.result.attempt.retryCount,
          writes,
        }
      },
    }))
    expect(completed.guardedFault).toBe(kind === 'mutant')
    const reopened = yield* open(path, 'Read')
    const fresh = Result.getOrThrow(fold(yield* reopened.eventsAfter(origin)))
    expect(readPosition(fresh)).toBe(readPosition(current))
    expect(fresh).toEqual(page.current())
  }))),
))

for (const kind of kinds) test('staff capacity — ' + kind, () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const linked = yield* sharedStaffing(journal)
    const { state: activeWork } = yield* startWork(journal, yield* activateTasks(journal, linked))
    const roles = [linked.roles.host, linked.roles.pipeline, maker]
    const ids = initialStaffing().staff.map(({ key }) => key)
    // The model reuses a child tuple after release. A production begin addresses a fresh sent task.
    const drafts = roles.map((role, index) =>
      Array.from({ length: 4 }, (_, copy) => ({ key: TaskKey.make('task:' + index + '-' + copy), role })))
    let initial = readPosition(activeWork)
    for (const draft of drafts.flat()) {
      initial = readPosition((yield* send(journal, initial, draft.key, draft.role)).state)
    }
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    const active = new Map<number, Of<typeof TaskKey>>()
    const used = new Map<number, number>()
    const versions = new Map([[1, staffingAt(linked)]])
    let pendingLifetime = 2
    const trace = readTrace(join(traces, 'staffCapacity-' + kind + '.itf.json.gz'), 'staffCapacity', kind)
    const project = () => Effect.runPromise(readOpenProject(journal))
    const assertUnchanged = async (before: Of<typeof ReadPosition>) => expect((await project()).read).toBe(before)
    yield* Effect.promise(() => replayStaffCapacity(trace, kind, {
      startSession: async (staff, version) => {
        const current = await project()
        const result = await Effect.runPromise(Effect.result(startSession(journal, current, {
          key: StaffSessionKey.make('session:' + pendingLifetime++), staff: ids[staff]!, pane: session.pane,
          staffing: versions.get(version) ?? EventNumber.make(current.read + 1),
        })))
        if (Result.isSuccess(result)) return 'Committed'
        await assertUnchanged(current.read)
        if (result.failure.code === 'Stale') return 'Stale'
        expect(['NoCapacity', 'WrongMove']).toContain(result.failure.code)
        return 'Refused'
      },
      startChild: async (role) => {
        const current = await project()
        const copy = used.get(role) ?? 0
        const key = drafts[role]![copy]!.key
        const result = await Effect.runPromise(Effect.result(startChild(
          journal, current, { _tag: 'Task', key }, session, 'Work',
        )))
        if (Result.isFailure(result)) {
          expect(result.failure.code).toBe('NoCapacity')
          await assertUnchanged(current.read)
          return false
        }
        active.set(role, key)
        used.set(role, copy + 1)
        return true
      },
      finishChild: async (role) => {
        const current = await project()
        const key = active.get(role)
        if (!key) throw new Error('No started child')
        const input = resultInput(current.read)
        await Effect.runPromise(staffInput(journal, { ...input, line: { _tag: 'Task', key } }))
        active.delete(role)
      },
      changePlan: async () => {
        await Effect.runPromise(acceptStaffing(journal, await project(), initialStaffing(1)))
        versions.set(2, staffingAt(await project()))
      },
      observe: async () => {
        const current = await project()
        const response = await Effect.runPromise(projectEvents(journal, readPosition(page.current())))
        expect(Result.getOrThrow(receiveProjectPayload(page, await response.json()))).toEqual(current)
        const projected = page.current()
        if (!projected) throw new Error('Expected the page projection')
        const cards = [...projected.staff.values()].map((staff) => ({ staff, capacity: capacity(projected, staff) }))
        const first = cards[0]
        if (!first) throw new Error('Expected the shared staff card')
        const limit = first.capacity.sessionLimit
        if (limit._tag !== 'Limited') throw new Error('Expected a provider limit')
        const children = [...current.tasks.values()].flatMap((task) =>
          task.phase._tag === 'Working' ? [roles.findIndex((role) => role.key === taskRole(task).key)] : [],
        ).sort()
        expect(Number(first.capacity.usedSubagents)).toBe(children.length)
        expect(Number(first.capacity.liveSessions)).toBe([...current.sessions.values()].filter((s) => s._tag === 'Live').length)
        return {
          limit: limit.max,
          children,
          sessions: [...current.sessions.values()].flatMap((live) => live._tag === 'Live' ? [ids.indexOf(live.staff.key)] : []).sort(),
          allowance: cards.map(({ staff }) => staff.subagents),
          assignments: roles.map((role) => cards.findIndex(({ staff }) => staff.roles.some((item) => item.key === role.key))),
        }
      },
    }))
  }))),
))

for (const kind of kinds) test('staff replacement observations — ' + kind, () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal, promptDirection)
    const reported = yield* staffInput(journal, resultInput(working.state.read))
    const commands = yield* commandOutcomes(journal, reported.state.read)
    const assigned = yield* startChild(journal, commands.state, taskLine, session, 'Review')
    const returned = yield* reportReview(journal, assigned.state, 'Breaks')
    const reviewLine = { _tag: 'Task', key: TaskKey.make('task:retained-review') } as const
    const rules = yield* acceptDirection(journal, returned.state, direction)
    const sent = yield* send(journal, rules.read, reviewLine.key)
    const began = yield* staffInput(journal, { read: sent.state.read, line: reviewLine, move: 'next', input: {} })
    const result = yield* staffInput(journal, { ...resultInput(began.state.read), line: reviewLine })
    const rule = direction.standards[0]!.rules[0]!
    const outcome = Schema.decodeUnknownSync(CommandOutcome)({ _tag: 'Holds', rule,
      evidence: { _tag: 'CommandOutput', command: rule.verification, exit: 0, stdout: '7', stderr: '' } })
    const entered = yield* recordTaskCommands(journal, reviewLine, result.state.read, [outcome])
    const reviewed = yield* startChild(journal, entered.state, reviewLine, session, 'Review')
    const proposalLine = { _tag: 'Proposal', key: ProposalKey.make('proposal:retained-review') } as const
    const draft = yield* cliProposal(journal, reviewed.state, { line: proposalLine, move: 'open', input: { previous: { _tag: 'None' }, value: direction } })
    const submitted = yield* cliProposal(journal, draft.state, { line: proposalLine, move: 'submit', input: { value: direction } })
    const proposal = submitted.state.proposals.get(proposalLine.key)!
    const pending = yield* assignProposalReview(journal, proposal, session, submitted.state.read)
    const asked = yield* cliQuestion(journal, ownerAuthority, 'question', staff.key, pending.state.read, Bun.YAML.stringify({
      key: questionKey, text: 'What is the answer?', form: textForm, owner: { _tag: 'Project' },
    }))
    const answered = yield* cliQuestion(journal, staffAuthorityOf(), 'answer', `project/${questionKey}`, asked.state.read, answerYaml('9'))
    const current = answered.state
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    const address = { _tag: 'Session', key: session.key } as const
    const replacement = StaffSessionKey.make('session:2')
    let expectedPrior: Of<typeof StaffSessionKey> | null = null
    let observation: 'Paused' | 'Ended' = 'Ended'
    let key = session.key
    const provider: Sessions = {
      stop: () => Effect.void,
      reconcile: () => Effect.void,
      launch: (_staff, _id, previous) => Effect.sync(() => {
        expect(previous).toBe(expectedPrior)
        return session.pane
      }),
      observe: () => Effect.sync(() => observation),
      child: () => Effect.void,
    }
    const operations = staffSessionOperations(dirname(path), journal, provider)
    const trace = readTrace(join(traces, 'staffReplacement-' + kind + '.itf.json.gz'), 'staffReplacement', kind)
    yield* Effect.promise(() => replayStaffReplacementObservations(trace, kind, {
      retire: async (checkpoint) => {
        observation = checkpoint ? 'Paused' : 'Ended'
        await Effect.runPromise(operations.observe(address))
      },
      replace: async (checkpoint) => {
        expectedPrior = checkpoint ? session.key : null
        await Effect.runPromise(operations.launch(staff.key, replacement, staffingAt(current), checkpoint ? address : null))
        key = replacement
      },
      begin: async () => {
        const project = await Effect.runPromise(readOpenProject(journal))
        await Effect.runPromise(staffInput(journal, { read: project.read, line: taskLine, move: 'next', input: {} }, { ...session, key }))
      },
      report: async (source) => {
        const project = await Effect.runPromise(readOpenProject(journal))
        const phase = project.tasks.get(taskKey)?.phase
        if (phase?._tag !== 'Working') throw new Error('The model reported after the attempt closed')
        const result = await Effect.runPromise(Effect.result(staffInput(journal,
          resultInput(project.read, 11, phase.attempt.number), { ...session, key: source === 1 ? session.key : replacement })))
        if (Result.isSuccess(result)) return true
        expect(result.failure.code).toBe('RetiredSession')
        expect((await Effect.runPromise(readOpenProject(journal))).read).toBe(project.read)
        return false
      },
      work: async () => {
        const project = await Effect.runPromise(readOpenProject(journal))
        const task = project.tasks.get(taskKey)
        const phase = task?.phase
        const count = (feedback: Extract<NonNullable<typeof phase>, { _tag: 'Sent' }>['feedback']) =>
          feedback._tag === 'Review' ? feedback.breaks.length : 0
        if (phase?._tag === 'Sent') return {
          phase: 'Sent', attempt: task?.lastAttempt._tag === 'Attempted' ? task.lastAttempt.number : 0,
          lifetime: 0, retries: phase.retryCount, artifact: null, pointedOut: count(phase.feedback),
        }
        if (phase?._tag !== 'Working' && phase?._tag !== 'ReadyToReview') throw new Error('Unexpected production work phase')
        const attempt = phase._tag === 'Working' ? phase.attempt : phase.result.attempt
        const image = phase._tag === 'ReadyToReview' ? phase.result.files[0]?.image : null
        return {
          phase: phase._tag, attempt: attempt.number, lifetime: attempt.session.key === replacement ? 2 : 1,
          retries: attempt.retryCount, pointedOut: count(attempt.feedback), artifact: image?._tag === 'Present' ? Number(image.contents) : null,
        }
      },
      companions: async () => {
        const project = await Effect.runPromise(readOpenProject(journal))
        const feed = await Effect.runPromise(projectEvents(journal, readPosition(page.current())))
        expect(Result.getOrThrow(receiveProjectPayload(page, await feed.json()))).toEqual(project)
        const task = project.tasks.get(reviewLine.key)?.phase
        const pending = project.proposals.get(proposalLine.key)?.phase
        const question = project.questions.get(questionKey)?.state
        if (task?._tag !== 'Reviewing' || pending?._tag !== 'Reviewing' ||
            question?._tag !== 'Answered' || question.answer._tag !== 'Single') throw new Error('A companion record was lost')
        const image = task.result.files[0]?.image
        return {
          review: task.assignment._tag, artifact: image?._tag === 'Present' ? Number(image.contents) : -1,
          commandHolds: task.outcomes.length === 1 && task.outcomes[0]?._tag === 'Holds',
          proposal: pending.assignment._tag, answer: Number(question.answer.text),
        }
      },
      observe: async () => {
        const project = await Effect.runPromise(readOpenProject(journal))
        const actual = project.sessions.get(key)
        if (!actual) throw new Error('Expected a session participant')
        if (key === replacement) expect(project.sessions.get(session.key)?._tag).toBe(observation)
        if (actual._tag === 'Starting') throw new Error('The fixture acknowledged this session')
        return [actual._tag, key === replacement ? 2 : 1]
      },
    }))
  }))),
))

for (const surface of ['CLI', 'page'] as const) for (const kind of kinds) {
  test('question answer via ' + surface + ' — ' + kind, () => withJournal((path) =>
    Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const journal = yield* open(path)
      const created = yield* create(journal)
      const live = yield* startFixtureSession(journal, created.state)
      const opened = yield* cliQuestion(journal, ownerAuthority, 'question', staff.key, live.state.read, Bun.YAML.stringify({
        key: questionKey, text: 'Confirm the output.', form: textForm, owner: { _tag: 'Project' },
      }))
      const response = yield* projectSnapshot(journal)
      const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => response.json()), () => {}))
      const trace = readTrace(join(traces, 'questionAnswer-' + kind + '.itf.json.gz'), 'questionAnswer', kind)
      let holder = session
      const replacement = { ...session, key: StaffSessionKey.make('session:2') }
      const address = { _tag: 'Question', owner: { _tag: 'Project' }, key: questionKey } as const
      const project = () => Effect.runPromise(readOpenProject(journal))
      yield* Effect.promise(() => replayQuestionAnswer(trace, kind, {
        replace: async () => {
          const current = await project()
          await Effect.runPromise(observeSession(journal, current, { _tag: 'Session', key: holder.key }, 'Ended'))
          const after = await project()
          await Effect.runPromise(startSession(journal, after, {
            key: replacement.key, staff: staff.key, pane: replacement.pane, staffing: staffingAt(after),
          }))
          holder = replacement
        },
        answer: async (actor, message) => {
          const current = await project()
          const authority = actor === 1 ? ownerAuthority : staffAuthorityOf(holder)
          const text = String(message)
          if (surface === 'CLI') {
            const outcome = await Effect.runPromise(Effect.result(cliQuestion(journal, authority, 'answer', `project/${questionKey}`, current.read, answerYaml(text))))
            if (Result.isSuccess(outcome)) return 'Committed'
            if (outcome.failure.code === 'WrongActor' || outcome.failure.code === 'WrongMove') return outcome.failure.code
            throw new Error(outcome.failure.why)
          }
          const reply = { line: address, move: 'answer', input: { answer: { _tag: 'Single', text: AnswerText.make(text) } } } as const
          const submission: Submission = { ...reply, read: current.read }
          const response = await Effect.runPromise(pageQuestion(journal, authority, submission))
          if (response.ok) return 'Committed'
          const refusal = readRefusal(await response.json())
          if (refusal.code === 'WrongActor' || refusal.code === 'WrongMove') return refusal.code
          throw new Error(refusal.why)
        },
        observe: async () => {
          const current = await project()
          const response = await Effect.runPromise(projectEvents(journal, readPosition(page.current())))
          expect(Result.getOrThrow(receiveProjectPayload(page, await response.json()))).toEqual(current)
          const question = current.questions.get(questionKey)
          if (!question) throw new Error('Question is absent')
          const actual = question.state
          const events = await Effect.runPromise(journal.eventsAfter(opened.state.read))
          const accepted = events.filter((event) => event.line._tag === 'Question' && event.move === 'answer').length
          const by = actual._tag === 'Open' ? question.to : actual.by
          const recipient = by._tag === 'Staff' && by.key === staff.key ? 2 : 1
          if (actual._tag === 'Answered' && actual.answer._tag !== 'Single') throw new Error('Expected a textual answer')
          const currentSession = current.sessions.get(holder.key)
          if (currentSession?._tag !== 'Live') throw new Error('Wrong live session')
          return {
            phase: actual._tag, recipient, accepted, lifetime: holder.key === replacement.key ? 2 : 1,
            answer: actual._tag === 'Answered' && actual.answer._tag === 'Single' ? Number(actual.answer.text) : null,
          }
        },
      }))
      const reopened = yield* open(path, 'Read')
      expect(page.current()).toEqual(yield* readOpenProject(reopened))
    }))),
  ))
}
