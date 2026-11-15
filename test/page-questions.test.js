// A question to the person shows on the page (owner, 2026-11-15): the host or an agent asks with
// work ask --to=owner (with --option for a choice); the person answers on the page, and it counts
// at once (no forward, no confirm). A question to an agent never shows there.
import { describe, expect, test } from 'bun:test'
import { HOST, TASK_WHOLE, agentToken, init, ok, project, solToken } from './harness.js'
import { act, gitPerson, panel } from './outside.js'

const ASK = '--to=owner --text="Which merchant does the export name?"'
const OPTIONS = '--option="m-17, the first one" --option="m-18"'

// A dir with a host run h1 whose top task t1 is open, with the architect a1 as its host.
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
const questions = async (p) => (await panel(p, 't1')).decisions.filter((i) => i.kind === 'question')

describe('a question to the person', () => {
  test('options are none, or two or more, each once; only a question to the person has them', async () => {
    const { p, host } = await hosted()
    expect((await p.agent(`ask ${host} ${ASK} --option=m-17`)).err).toContain('one option is no choice')
    expect((await p.agent(`ask ${host} ${ASK} --option=m-17 --option=m-17`)).err)
      .toContain('each option has its own words, once')
    const lead = await agentToken(p, ok(await p.agent(`assign ${host} t1 --role=section-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    const above = await p.agent(`ask ${lead} --text="Which merchant?" ${OPTIONS}`)
    expect(above.err).toContain('only a question to the person has options')
    expect(above.err).toContain('next: ask with --to=owner')
  })

  test('work ask --option stores the options; work waiting and question show number them', async () => {
    const { p, host } = await hosted()
    expect(ok(await p.agent(`ask ${host} ${ASK} ${OPTIONS}`)).out).toBe('q1 asked; the task waits for the answer.')
    expect(ok(await p.agent('question show q1')).out).toBe([
      'q1 asked by a1, for Nanda:',
      'Which merchant does the export name?',
      '1. m-17, the first one',
      '2. m-18',
      '',
      'no answer yet',
    ].join('\n'))
    const waiting = ok(await p.nanda('waiting --for=Nanda')).out
    expect(waiting).toContain([
      'q1 for Nanda: Which merchant does the export name?',
      '    1. m-17, the first one',
      '    2. m-18',
      '    work answer q1 --text="..." or --option=<n>',
    ].join('\n'))
  })

  test('it shows on the page on the task of the asker; a question to an agent does not', async () => {
    const { p, host } = await hosted()
    const lead = await agentToken(p, ok(await p.agent(`assign ${host} t1 --role=section-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    // The lead's question goes to the host (a model): the page does not show it.
    ok(await p.agent(`ask ${lead} --text="Is the retry part of the export?"`))
    expect(await questions(p)).toEqual([])
    ok(await p.agent(`ask ${host} ${ASK} ${OPTIONS}`))
    expect(await questions(p)).toEqual([expect.objectContaining({
      kind: 'question',
      id: 'q2',
      task: 't1',
      text: 'Which merchant does the export name?',
      asker: 'architect (a1)',
      options: ['m-17, the first one', 'm-18'],
      words: null,
      shown: true,
    })])
  })

  test('the answer on the page counts at once; a second answer is refused', async () => {
    const { p, host } = await hosted()
    ok(await p.agent(`ask ${host} ${ASK} ${OPTIONS}`))
    expect(ok(await p.agent(`next ${host}`)).out).toContain('q1')
    expect(await act(p, 'answer', { question: 'q1', text: 'm-18' })).toEqual({ out: 'q1 answered.' })
    expect(ok(await p.agent('question show q1')).out).toEndWith('answer: m-18')
    expect(await questions(p)).toEqual([])
    // No forward waits for a confirm: the asker reads the answer now.
    expect(ok(await p.nanda('waiting --for=Nanda')).out).not.toContain('confirm')
    expect(ok(await p.agent(`next ${host}`)).out).toContain('your question q1 has its answer.')
    const again = await act(p, 'answer', { question: 'q1', text: 'm-17, the first one' })
    expect(again.error).toContain('the question is answered already: "m-18"')
  })

  test('a free answer: in words, also to a question with options', async () => {
    const { p, host } = await hosted()
    ok(await p.agent(`ask ${host} ${ASK}`))
    expect((await questions(p))[0]?.options).toEqual([])
    expect((await p.nanda('answer q1 --option=1')).err).toContain('this question has no options')
    expect((await act(p, 'answer', { question: 'q1', text: 'neither: the export names none' })).out).toBe('q1 answered.')
    expect(ok(await p.agent('question show q1')).out).toEndWith('answer: neither: the export names none')
    ok(await p.agent(`ask ${host} ${ASK} ${OPTIONS}`))
    expect((await p.nanda('answer q2 --option=3')).err).toContain('--option is the number of an option: 1 to 2')
    ok(await p.nanda('answer q2 --option=1'))
    expect(ok(await p.agent('question show q2')).out).toEndWith('answer: m-17, the first one')
  })
})
