import { expect, test } from 'bun:test'
import { Schema } from 'effect'
import { basisOf, refused } from '../../core/derived/c16/accept.ts'
import { dos } from '../../core/derived/c16/obligations.ts'
import { take } from '../../core/state/c16/effect.ts'
import { initState, type WorkState } from '../../core/state/c16/state.ts'
import type { Act, Actor, AnswerBody, Body, QuestionForm } from '../../core/state/c16/types.ts'
import { forwardedPageBody, pageBodyOf, pagePointsOk, workPostOf } from './acts.ts'
import { ActResponse, type PageActJson } from './contract.ts'

const human: Actor = { _tag: 'Human' }
const host: Actor = { _tag: 'Host' }
const initial = () => initState(
  { name: 'top', goal: 'g', sections: ['section'], directions: [] }, new Map(), new Map(), 3,
)
const build = 'b1'
const envelope = (state: WorkState, who: Actor, body: Body): Act => ({
  id: 'fixture', who, ep: 0, seen: basisOf(state, body), seenVer: 0,
  vers: state.ver, old: false, body,
})
const forms: ReadonlyArray<readonly [QuestionForm, AnswerBody, AnswerBody]> = [
  [{ _tag: 'Single' }, { _tag: 'Single', text: 'first\nsecond' }, { _tag: 'Single', text: '' }],
  [{ _tag: 'Multiple', questions: [{ description: 'One', placeholder: 'Text' }] },
    { _tag: 'Multiple', texts: ['  first\nsecond  '] }, { _tag: 'Multiple', texts: [] }],
  [{ _tag: 'Choice', options: ['A', 'B'], multi: false },
    { _tag: 'Choice', picked: [1] }, { _tag: 'Choice', picked: [0, 1] }],
  [{ _tag: 'Matrix', rows: ['R1', 'R2'], columns: ['A', 'B'] },
    { _tag: 'Matrix', cells: [0, 1] }, { _tag: 'Matrix', cells: [1] }],
]

for (const [form, valid, invalid] of forms) {
  test(`F2.2 the ${form._tag} post uses the shared validator`, () => {
    const s0 = initial()
    const s = take(s0, envelope(s0, host, { _tag: 'Open',
      open: { _tag: 'OpenQuestion', question: { title: 'Question?', form }, to: human },
    }))
    const ask = [...s.asks.keys()][0]!
    const post = (answer: AnswerBody) => {
      const act: PageActJson = { _tag: 'AnswerQuestion', ask, answer }
      const wire = JSON.stringify({ act, on: s.seq, build, id: 'answer' })
      const decoded = workPostOf(JSON.parse(wire))
      if (!decoded || !('act' in decoded)) throw new Error('answer did not decode')
      expect(decoded.id).toBe('answer')
      return envelope(s, human, pageBodyOf(decoded.act))
    }
    expect(refused(s, post(invalid), 'page')?.refused).toBe('form')
    const act = post(valid)
    expect(refused(s, act, 'page')).toBeNull()
    const answered = take(s, act)
    expect(answered.answered.get(ask)?.answer).toEqual(valid)
    expect(dos(answered, host).find((step) => step.act === 'Hear'))
      .toMatchObject({ act: 'Hear', ask })
    expect(take(answered, envelope(answered, host, { _tag: 'Hear', ask })).answered.has(ask))
      .toBe(false)
    expect(refused(answered, act, 'page')?.refused).toBe('stale')
    expect(refused(s, { ...act, old: true }, 'page')?.refused).toBe('build')
  })
}

test('the page validates required points and normalizes optional Respond points', () => {
  const decode = (act: PageActJson) => {
    const post = workPostOf({ act, on: 0, build })
    if (!post || !('act' in post)) throw new Error('act did not decode')
    return post.act
  }
  const accept = decode({ _tag: 'Respond', ask: '23', reply: 'AcceptIt' })
  expect(pageBodyOf(accept)).toMatchObject({ points: [] })
  expect(pagePointsOk(accept)).toBe(true)
  expect(pagePointsOk(decode({ _tag: 'Respond', ask: '23', reply: 'SendItBack' }))).toBe(false)
  expect(pagePointsOk(decode({ _tag: 'Open',
    open: { _tag: 'OpenReject', task: 't1', points: [' '] },
  }))).toBe(false)
  expect(workPostOf({ act: { _tag: 'Hear', ask: '23' }, on: 0, build })).toBeUndefined()
  const refusedForward = forwardedPageBody({ _tag: 'Hear', ask: '23' })
  expect(refusedForward).toBeUndefined()
  const allowedForward = forwardedPageBody(pageBodyOf(accept))
  expect(allowedForward).toMatchObject({ ...accept, points: [] })
})

test('F2.8 all named refusals retain their words and next step on the wire', () => {
  const decode = Schema.decodeUnknownSync(ActResponse)
  for (const refused of [
    'ended', 'authority', 'epoch', 'legal', 'basis', 'build', 'stale', 'form',
    'pair', 'cap', 'heard', 'terminal',
  ] as const) {
    const reply = { refused, words: `Refusal ${refused}`, next: 'Refresh the view.' }
    expect(decode(reply)).toEqual(reply)
  }
  expect(decode({ ok: true, seq: 42, duplicate: true })).toEqual({
    ok: true, seq: 42, duplicate: true,
  })
})

test('CLI and page see the same obligations after reopening a fresh format-6 store', async () => {
  const { join } = await import('node:path')
  const { eventsOf, h } = await import('../../core/actions/fixture.test.ts')
  const { foldWork } = await import('../../core/state/c16/fold.ts')
  const { startServer } = await import('./server.ts')
  const config = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')
  const { p } = await h.initiated({ 'aristoteles.yaml': config })
  h.git(p.dir, 'init', '-q')
  h.git(p.dir, 'config', 'user.name', 'Nanda')
  const top = h.ok(await p.nanda('top open --name=T --goal=g --sections=introduction')).out
  const host = top.match(/^  host: (w\.\S+)$/m)?.[1]
  const role = top.match(/^  role:section-lead: (w\.\S+)$/m)?.[1]
  h.ok(await p.agent(`send ${host} --name=Intro --goal=g --sections=introduction --role=section-lead`))
  const assigned = h.ok(await p.agent(`assign ${role} t1`)).out
  const maker = assigned.match(/^  maker:m1: (w\.\S+)$/m)?.[1]
  h.ok(await p.agent(`brief ${maker}`))
  h.ok(await p.agent(`ask ${maker} human --text="Which approach?"`))
  const start = () => startServer({
    dir: p.dir, env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') },
    readBuild: () => 'test',
  })
  let server = start()
  const dash = async () => (await fetch(new URL('api/dash', server.url))).json()
  const post = async (body: object) => {
    const res = await fetch(new URL('api/act', server.url), {
      method: 'POST',
      headers: { origin: new URL(server.url).origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }
  try {
    const before = await dash()
    const question = before.person.owed.find((entry: { _tag: string }) => entry._tag === 'Question')
    expect(question).toMatchObject({ question: { title: 'Which approach?' } })
    const waitBefore = h.ok(await p.agent(`wait ${maker}`)).out
    server.stop()
    server = start()
    expect((await dash()).person.owed).toEqual(before.person.owed)
    expect(h.ok(await p.agent(`wait ${maker}`)).out).toBe(waitBefore)
    const submission = {
      act: {
        _tag: 'AnswerQuestion', ask: question.ask,
        answer: { _tag: 'Single' as const, text: 'Line one\nLine two' },
      },
      on: before.header.seq, build: before.header.build, id: 'page-answer',
    }
    const first = await post(submission)
    expect(first).toMatchObject({ ok: true })
    expect(await post(submission)).toEqual({ ...first, duplicate: true })
    expect(await post({
      ...submission, act: { ...submission.act, answer: { _tag: 'Single', text: 'different' } },
    })).toMatchObject({ refused: 'legal' })
    const folded = foldWork(eventsOf(p.dir))
    expect(folded?.state.answered.get(question.ask)?.answer).toEqual(submission.act.answer)
  } finally {
    server.stop()
  }
}, 90000)
