// P8, ruling 3 (Nanda, 2026-11-15): the dir view (the directions page, the agents page) shows no
// task and no terminal; a toast says what the AI does now. The host sets it with work status set;
// it is a small file next to the store, and an old one shows no more. When the AI asks the person,
// the toast is its question, and the answer there counts at once.
import { describe, expect, test } from 'bun:test'
import { HOST, TASK_WHOLE, init, ok, project, solToken } from './harness.js'
import { gitPerson, withServer } from './outside.js'

const hosted = async () => {
  const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
  gitPerson(p)
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.run('run start', HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out)
  ok(await p.agent(`brief ${host}`))
  return { p, host }
}
const later = (at, minutes) => new Date(Date.parse(at) + minutes * 60000).toISOString()

describe('the toast of the dir view', () => {
  test('work status set: the toast shows it, and an old one shows no more', async () => {
    const { p } = await hosted()
    expect((await p.agent('status set --kind=sleeping --text="x" --by=h1')).err)
      .toContain('--kind is one of working, thinking, applied, feedback, waiting')
    expect((await p.agent('status set --kind=thinking --by=h1')).err).toContain('a status needs --text')
    expect(ok(await p.agent('status set --kind=feedback --text="the rules of tsd-writing" --by=h1')).out)
      .toBe('the page shows: Wants to apply your feedback: the rules of tsd-writing')
    // The clock of the page is the clock of the harness, as the status has it.
    const now = p.now()
    await withServer(p, async ({ get }) => {
      expect((await get('/api/dir')).toast).toEqual({
        status: { by: 'h1', kind: 'feedback', words: 'Wants to apply your feedback', text: 'the rules of tsd-writing' },
        question: null,
      })
    }, now)
    await withServer(p, async ({ get }) => {
      expect((await get('/api/dir')).toast).toEqual({ status: null, question: null })
    }, later(now, 11))
  })

  test("the AI's question takes the place of its status, and the answer there counts at once", async () => {
    const { p, host } = await hosted()
    ok(await p.agent('status set --kind=waiting --text="a question for you" --by=h1'))
    ok(await p.agent(`ask ${host} --to=owner --text="Which merchant?" --option=m-17 --option=m-18`))
    await withServer(p, async ({ get, post }) => {
      const { question } = (await get('/api/dir')).toast
      expect(question).toMatchObject({ kind: 'question', id: 'q1', text: 'Which merchant?', options: ['m-17', 'm-18'] })
      expect(question.acts).toEqual([{ _tag: 'Answer' }])
      expect((await post('answer', { question: 'q1', text: 'm-18' })).error).toBeUndefined()
      expect((await get('/api/dir')).toast.question).toBeNull()
    })
    expect(ok(await p.agent('question show q1')).out).toContain('m-18')
  })
})
