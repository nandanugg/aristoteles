import { expect, test } from 'bun:test'
import { Effect, Result, Schema } from 'effect'
import { projectQuestionWords } from '../../adapters/words/work.ts'
import { openPageProject, receiveProjectPayload } from '../../adapters/web/app/project-state.ts'
import { answerFromForm, questionAnswerSubmission } from '../../adapters/web/app/questions.ts'
import { projectSnapshot } from '../../adapters/web/project.ts'
import { create, open, owner, session, staff, startFixtureSession, withJournal } from '../../src/store/project.probe.ts'
import { answerYaml, cliQuestion, ownerAuthority, pageQuestion, questionId, readRefusal, staffAuthorityOf, textForm } from '../../src/store/question.probe.ts'
import { nextStep, questionsFor } from '../derived/project/next-step.ts'
import { Answer, QuestionForm, QuestionId, ReadPosition, SessionId, Submission, type Of, type Project } from '../schema/project.ts'
import { observeSession, readOpenProject, startSession } from './staff-session.ts'
import { readPosition } from '../state/project.ts'

const fromWire = Schema.decodeUnknownSync(Submission, { onExcessProperty: 'error' })
const asAnswer = Schema.decodeUnknownSync(Answer)
const asForm = Schema.decodeUnknownSync(QuestionForm)
const openForStaff = (path: string) => Effect.gen(function* () {
  const journal = yield* open(path)
  const created = yield* create(journal)
  const live = yield* startFixtureSession(journal, created.state)
  const opened = yield* cliQuestion(journal, ownerAuthority, 'question', staff.id, live.state.read, Bun.YAML.stringify({
    id: questionId, text: 'Confirm the output.', form: textForm, about: { _tag: 'Project' },
  }))
  return { journal, project: opened.state }
})
const needed = (project: Project, id = questionId) => {
  const question = project.questions.get(id)
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
    const words = projectQuestionWords(nextStep(project, session))
    expect(words?.text).toBe(question.text)
    expect(String(words?.command)).toBe('work answer <token> question:example --file=<answer.yaml>')
    const snapshot = yield* projectSnapshot(journal)
    const page = Result.getOrThrow(openPageProject(yield* Effect.promise(() => snapshot.json()), () => {}))
    expect(page.current()).toEqual(project)
    const invalid = yield* Effect.result(cliQuestion(journal, ownerAuthority, 'answer', questionId, project.read, answerYaml('wrong')))
    expect(invalid).toMatchObject(failure('WrongActor'))
    const wrong = yield* pageQuestion(journal, ownerAuthority, fromWire({
      _tag: 'HumanChoice', read: project.read,
      choice: { _tag: 'Answer', line: { _tag: 'Question', id: questionId }, answer: { _tag: 'Single', text: 'wrong' } },
    }))
    expect(wrong.status).toBe(403)
    expect(readRefusal(yield* Effect.promise(() => wrong.json())).code).toBe('WrongActor')
    expect(yield* journal.eventsAfter(project.read)).toEqual([])
    const response = yield* pageQuestion(journal, staffAuthorityOf(),
      questionAnswerSubmission(question, project.read, asAnswer({ _tag: 'Single', text: 'Accepted' })))
    expect(response.status).toBe(200)
    const updated = Result.getOrThrow(receiveProjectPayload(page, yield* Effect.promise(() => response.json())))
    expect(updated?.questions.get(questionId)?.state).toMatchObject({
      _tag: 'Answered', by: { id: staff.id }, answer: { text: 'Accepted' },
    })
    expect(yield* Effect.result(cliQuestion(journal, staffAuthorityOf(), 'answer', questionId,
      readPosition(updated), answerYaml('duplicate')))).toMatchObject(failure('WrongMove'))
    const reopened = yield* open(path, 'Read')
    expect(page.current()).toEqual(yield* readOpenProject(reopened))
    expect(yield* reopened.eventsAfter(project.read)).toHaveLength(1)
  }))),
))

test('wrong shapes and retired or stale staff sessions refuse before writing', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const { journal, project } = yield* openForStaff(path)
    const question = needed(project)
    const shape = { _tag: 'OneChoice', picked: 0 } as const
    const cli = yield* Effect.result(cliQuestion(journal, staffAuthorityOf(), 'answer', questionId,
      project.read, Bun.YAML.stringify(shape)))
    const page = yield* pageQuestion(journal, staffAuthorityOf(),
      questionAnswerSubmission(question, project.read, asAnswer(shape)))
    expect(cli).toMatchObject(failure('InvalidInput'))
    expect(readRefusal(yield* Effect.promise(() => page.json())).code).toBe('InvalidInput')
    expect(yield* journal.eventsAfter(project.read)).toEqual([])
    const address = { _tag: 'Session', id: session.id } as const
    yield* observeSession(journal, project, address, 'Ended')
    const retired = yield* readOpenProject(journal)
    const replacement = { ...session, id: SessionId.make('session:replacement') }
    yield* startSession(journal, retired, {
      id: replacement.id, staff: staff.id, pane: replacement.pane, staffing: retired.staffingAt,
    })
    const current = yield* readOpenProject(journal)
    expect(yield* Effect.result(cliQuestion(journal, staffAuthorityOf(), 'answer', questionId,
      current.read, answerYaml('old session')))).toMatchObject(failure('RetiredSession'))
    expect(yield* Effect.result(cliQuestion(journal, staffAuthorityOf(replacement), 'answer', questionId,
      project.read, answerYaml('old view')))).toMatchObject(failure('Stale'))
    expect(yield* journal.eventsAfter(current.read)).toEqual([])
    const answered = yield* cliQuestion(journal, staffAuthorityOf(replacement), 'answer', questionId,
      current.read, answerYaml('new session'))
    expect(needed(answered.state).state._tag).toBe('Answered')
  }))),
))

test('the host consults the owner on a particular staffing draft basis', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const created = yield* create(journal)
    const live = yield* startFixtureSession(journal, created.state)
    const consult = (id: Of<typeof QuestionId>, project: Project, basis = project.read) =>
      cliQuestion(journal, staffAuthorityOf(), 'question', owner.id, project.read, Bun.YAML.stringify({
        id, text: 'Which allowance should the host propose?', form: textForm,
        about: { _tag: 'Staffing', proposal: { id: 'proposal:staffing', basis } },
      }))
    const first = yield* consult(questionId, live.state)
    const laterId = QuestionId.make('question:revised')
    const latest = yield* consult(laterId, first.state)
    expect(questionsFor(latest.state, owner).map(({ id }) => id)).toEqual([laterId])
    expect(yield* Effect.result(cliQuestion(journal, ownerAuthority, 'answer', questionId, latest.state.read,
      answerYaml('old draft')))).toMatchObject(failure('Stale'))
    const question = needed(latest.state, laterId)
    const reply = yield* pageQuestion(journal, ownerAuthority, questionAnswerSubmission(question, latest.state.read,
      asAnswer({ _tag: 'Single', text: 'Keep one slot.' })))
    expect(reply.status).toBe(200)
    const answered = yield* readOpenProject(journal)
    expect(needed(answered, laterId)).toMatchObject({
      about: { _tag: 'Staffing', proposal: { id: 'proposal:staffing', basis: first.state.read } },
      state: { _tag: 'Answered', by: { id: owner.id }, answer: { text: 'Keep one slot.' } },
    })
    expect(needed(answered).state._tag).toBe('Open')
    expect(yield* Effect.result(cliQuestion(journal, ownerAuthority, 'answer', laterId, ReadPosition.make(0),
      answerYaml('old view')))).toMatchObject(failure('Stale'))
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
