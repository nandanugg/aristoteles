import { expect, test } from 'bun:test'
import { Effect, Result, Schema } from 'effect'
import { cliProposal, evidence, proposeStaffing } from '../../src/store/proposal.probe.ts'
import { assignProposalReview } from './proposal.ts'
import { projectQuestionWords, questionAddressText } from '../../adapters/words/project.ts'
import { openPageProject, receiveProjectPayload } from '../../adapters/web/app/project-state.ts'
import { answerFromForm, questionAnswerSubmission } from '../../adapters/web/app/project-question.ts'
import { projectSnapshot } from '../../adapters/web/project.ts'
import { startSession, create, open, owner, session, staff, staffInput, startFixtureSession, withJournal } from '../../src/store/project.probe.ts'
import { answerYaml, cliQuestion, ownerAuthority, pageQuestion, questionKey, readRefusal, staffAuthorityOf, textForm } from '../../src/store/question.probe.ts'
import { resultInput, taskLine, toWorking } from '../../src/store/task.probe.ts'
import { nextStep, questionsFor } from '../derived/project/next-step.ts'
import { staffingAt, Answer, QuestionForm, ProposalKey, QuestionKey, ReadPosition, StaffSessionKey, Submission, type Of, type QuestionAddress, type Project } from '../schema/project.ts'
import { observeSession, readOpenProject } from './staff-session.ts'
import { readPosition } from '../state/project.ts'

const fromWire = Schema.decodeUnknownSync(Submission, { onExcessProperty: 'error' })
const asAnswer = Schema.decodeUnknownSync(Answer)
const asForm = Schema.decodeUnknownSync(QuestionForm)
const openForStaff = (path: string) => Effect.gen(function* () {
  const journal = yield* open(path)
  const created = yield* create(journal)
  const live = yield* startFixtureSession(journal, created.state)
  const opened = yield* cliQuestion(journal, ownerAuthority, 'question', staff.key, live.state.read, Bun.YAML.stringify({
    key: questionKey, text: 'Confirm the output.', form: textForm, owner: { _tag: 'Project' },
  }))
  return { journal, project: opened.state }
})
const projectQuestion = { _tag: 'Question', owner: { _tag: 'Project' }, key: questionKey } as const
const projectAddress = questionAddressText(projectQuestion)
const needed = (project: Project) => {
  const question = project.questions.get(questionKey)
  if (!question) throw new Error('Expected the addressed question')
  return question
}
const failure = (code: string) => ({ _tag: 'Failure', failure: { code } })

test('CLI and page see the same owed question, enforce the recipient, and append the answer once', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { journal, project } = yield* openForStaff(path)
    const question = needed(project)
    expect(question.state._tag).toBe('Open')
    expect(questionsFor(project, owner)).toHaveLength(0)
    const due = nextStep(project, session)
    if (due._tag !== 'Available' || due.subject._tag !== 'Question') throw new Error('Expected a question')
    expect(projectQuestionWords(due.subject, due.read).map(String)).toEqual([
      question.text, `work answer "$ARISTOTELES_TOKEN" project/question:example --on=${project.read} --file=answer.yaml`,
    ])
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    expect(page.current()).toEqual(project)
    const invalid = yield* Effect.result(cliQuestion(journal, ownerAuthority, 'answer', projectAddress, project.read, answerYaml('wrong')))
    expect(invalid).toMatchObject(failure('WrongActor'))
    const wrong = yield* pageQuestion(journal, ownerAuthority, fromWire({ read: project.read, line: projectQuestion, move: 'answer', input: { answer: { _tag: 'Single', text: 'wrong' } } }))
    expect(wrong.status).toBe(403)
    expect(readRefusal(yield* Effect.promise(() => wrong.json())).code).toBe('WrongActor')
    expect(yield* journal.eventsAfter(project.read)).toEqual([])
    const response = yield* pageQuestion(journal, staffAuthorityOf(),
      questionAnswerSubmission(projectQuestion, project.read, asAnswer({ _tag: 'Single', text: 'Accepted' })))
    expect(response.status).toBe(200)
    const updated = Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => response.json())))
    expect(updated?.questions.get(questionKey)?.state).toMatchObject({
      _tag: 'Answered', by: { key: staff.key }, answer: { text: 'Accepted' },
    })
    expect(yield* Effect.result(cliQuestion(journal, staffAuthorityOf(), 'answer', projectAddress,
      readPosition(updated), answerYaml('duplicate')))).toMatchObject(failure('WrongMove'))
    const reopened = yield* open(path, 'Read')
    expect(page.current()).toEqual(yield* readOpenProject(reopened))
    expect(yield* reopened.eventsAfter(project.read)).toHaveLength(1)
  }))),
))

test('wrong shapes and retired or stale staff sessions refuse before writing', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { journal, project } = yield* openForStaff(path)
    const shape = { _tag: 'OneChoice', picked: 0 } as const
    const cli = yield* Effect.result(cliQuestion(journal, staffAuthorityOf(), 'answer', projectAddress,
      project.read, Bun.YAML.stringify(shape)))
    const page = yield* pageQuestion(journal, staffAuthorityOf(),
      questionAnswerSubmission(projectQuestion, project.read, asAnswer(shape)))
    expect(cli).toMatchObject(failure('InvalidInput'))
    expect(readRefusal(yield* Effect.promise(() => page.json())).code).toBe('InvalidInput')
    expect(yield* journal.eventsAfter(project.read)).toEqual([])
    const address = { _tag: 'Session', key: session.key } as const
    yield* observeSession(journal, project, address, 'Ended')
    const retired = yield* readOpenProject(journal)
    const replacement = { ...session, key: StaffSessionKey.make('session:replacement') }
    yield* startSession(journal, retired, {
      key: replacement.key, staff: staff.key, pane: replacement.pane, staffing: staffingAt(retired),
    })
    const current = yield* readOpenProject(journal)
    expect(yield* Effect.result(cliQuestion(journal, staffAuthorityOf(), 'answer', projectAddress,
      current.read, answerYaml('old session')))).toMatchObject(failure('RetiredSession'))
    expect(yield* Effect.result(cliQuestion(journal, staffAuthorityOf(replacement), 'answer', projectAddress,
      project.read, answerYaml('old view')))).toMatchObject(failure('Stale'))
    expect(yield* journal.eventsAfter(current.read)).toEqual([])
    const answered = yield* cliQuestion(journal, staffAuthorityOf(replacement), 'answer', projectAddress,
      current.read, answerYaml('new session'))
    expect(needed(answered.state).state._tag).toBe('Answered')
  }))),
))

test('the host consults the owner on a particular staffing draft basis', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const created = yield* create(journal)
    const live = yield* startFixtureSession(journal, created.state)
    const plan = { staff: [staff], subscriptions: [staff.subscription] } as const
    const key = ProposalKey.make('proposal:staffing')
    const draft = yield* proposeStaffing(journal, live.state, plan, key)
    const line = { _tag: 'Proposal', key } as const
    const consult = (key: Of<typeof QuestionKey>, project: Project) =>
      cliQuestion(journal, staffAuthorityOf(), 'question', 'owner', project.read, Bun.YAML.stringify({
        key, text: 'Which allowance should the host propose?', form: textForm,
        owner: line,
      }))
    const first = yield* consult(questionKey, draft.state)
    const address = (question: Of<typeof QuestionKey>): Of<typeof QuestionAddress> =>
      ({ _tag: 'Question', owner: line, key: question })
    const firstAddress = questionAddressText(address(questionKey))
    expect(first.state.questions.size).toBe(0)
    expect(first.state.proposals.get(line.key)?.questions.get(questionKey)?.state._tag).toBe('Open')
    const send = { line, move: 'submit', input: { value: { ...plan, _tag: 'Staffing' } } }
    expect(yield* Effect.result(cliProposal(journal, first.state, send))).toMatchObject(failure('Stale'))
    const firstAnswer = yield* cliQuestion(journal, ownerAuthority, 'answer', firstAddress, first.state.read, answerYaml('Keep two slots.'))
    expect(yield* Effect.result(cliProposal(journal, first.state, send))).toMatchObject(failure('Stale'))
    const sent = yield* cliProposal(journal, firstAnswer.state, send)
    const proposal = sent.state.proposals.get(line.key)
    if (!proposal) throw new Error('No staffing proposal')
    yield* assignProposalReview(journal, proposal, session, sent.state.read)
    const returned = yield* cliProposal(journal, yield* readOpenProject(journal), { line, move: 'review', input: { facts: evidence('Breaks') } },
      { _tag: 'Review', session, line, review: proposal.lastChange })
    const laterKey = QuestionKey.make('question:revised')
    const latest = yield* consult(laterKey, returned.state)
    expect(questionsFor(latest.state, owner).map(({ line }) => line)).toEqual([address(laterKey)])
    expect(yield* Effect.result(cliQuestion(journal, ownerAuthority, 'answer', firstAddress, latest.state.read,
      answerYaml('old draft')))).toMatchObject(failure('Stale'))
    const reply = yield* pageQuestion(journal, ownerAuthority, questionAnswerSubmission(address(laterKey), latest.state.read,
      asAnswer({ _tag: 'Single', text: 'Keep one slot.' })))
    expect(reply.status).toBe(200)
    const answered = yield* readOpenProject(journal)
    expect(answered.proposals.get(line.key)?.questions.get(laterKey)).toMatchObject({
      state: { _tag: 'Answered', by: owner, answer: { text: 'Keep one slot.' } },
    })
    expect(answered.proposals.get(line.key)?.questions.get(questionKey)?.state._tag).toBe('Answered')
    expect(yield* Effect.result(cliQuestion(journal, ownerAuthority, 'answer', questionAddressText(address(laterKey)), ReadPosition.make(0),
      answerYaml('old view')))).toMatchObject(failure('Stale'))
  }))),
))

test('task and project questions with the same key stay scoped through a task move and replay', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const working = yield* toWorking(journal)
    const taskQuestion = { _tag: 'Question', owner: taskLine, key: questionKey } as const
    const ask = (line: Of<typeof QuestionAddress>, text: string, read: Of<typeof ReadPosition>) =>
      cliQuestion(journal, ownerAuthority, 'question', staff.key, read,
        Bun.YAML.stringify({ key: line.key, owner: line.owner, text, form: textForm }))
    const projectAsked = yield* ask(projectQuestion, 'Project question', working.state.read)
    const taskAsked = yield* ask(taskQuestion, 'Task question', projectAsked.state.read)
    expect(questionsFor(taskAsked.state, session).map(({ line }) => line)).toEqual([projectQuestion, taskQuestion])
    expect(yield* Effect.result(ask(taskQuestion, 'Duplicate task question', taskAsked.state.read))).toMatchObject(failure('Stale'))

    const reported = yield* staffInput(journal, resultInput(taskAsked.state.read))
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    expect(page.current()).toEqual(reported.state)
    expect(yield* Effect.result(cliQuestion(journal, staffAuthorityOf(), 'answer', questionKey,
      reported.state.read, answerYaml('missing owner')))).toMatchObject(failure('InvalidInput'))

    const reply = yield* pageQuestion(journal, staffAuthorityOf(), questionAnswerSubmission(taskQuestion, reported.state.read,
      asAnswer({ _tag: 'Single', text: 'Task answer' })))
    expect(reply.status).toBe(200)
    const state = Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => reply.json())))
    expect(state?.tasks.get(taskLine.key)?.phase._tag).toBe('ReadyToReview')
    expect(state?.tasks.get(taskLine.key)?.questions.get(questionKey)?.state).toMatchObject({
      _tag: 'Answered', answer: { text: 'Task answer' },
    })
    expect(state?.questions.get(questionKey)?.state._tag).toBe('Open')
    expect(page.current()).toEqual(yield* readOpenProject(yield* open(path, 'Read')))
  }))),
))

test('browser controls produce the shared checked form for text, options and matrices', () => {
  const values = (fields: readonly (readonly [string, string])[]) => {
    const data = new FormData()
    for (const [key, value] of fields) data.append(key, value)
    return data
  }
  expect(answerFromForm(asForm(textForm), values([['answer-0', 'text']]))).toMatchObject({ _tag: 'Single', text: 'text' })
  expect(answerFromForm(asForm({ _tag: 'Multiple', prompts: [textForm.prompt, textForm.prompt] }),
    values([['answer-0', 'text']]))).toMatchObject({ _tag: 'Multiple', texts: ['text', null] })
  const single = asForm({ _tag: 'OneChoice', options: ['A', 'B'] })
  expect(answerFromForm(single, values([['answer-0', '1']]))).toMatchObject({ _tag: 'OneChoice', picked: 1 })
  expect(answerFromForm(single, values([['answer-0', '2']]))).toBeNull()
  const multiple = asForm({ _tag: 'ManyChoices', options: ['A', 'B'] })
  expect(answerFromForm(multiple, values([['answer-0', '1'], ['answer-0', '0']])))
    .toMatchObject({ _tag: 'ManyChoices', picked: [0, 1] })
  expect(answerFromForm(multiple, values([['answer-0', '0'], ['answer-0', '0']]))).toBeNull()
  const matrix = asForm({ _tag: 'Matrix', rows: ['A', 'B'], columns: ['Yes', 'No'] })
  expect(answerFromForm(matrix, values([['answer-0', '1'], ['answer-1', '0']])))
    .toMatchObject({ _tag: 'Matrix', cells: [1, 0] })
  expect(answerFromForm(matrix, values([['answer-0', '1']]))).toBeNull()
})
