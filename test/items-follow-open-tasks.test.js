// The person sees each item that waits for them on an open task (Nanda, 2026-11-13): a draft
// answers no point of a closed task; a draft whose task closes later follows it to the task that
// replaced it; and a relayed act that waits for the person's confirm shows on the page, with a
// Confirm act.
import { describe, expect, test } from 'bun:test'
import { HOST, INTRO_V2, TASK_WHOLE, agentToken, init, ok, project, solToken, tokenIn } from './harness.js'
import { act, gitPerson, panel } from './outside.js'

// hostWaitMinutes passed since every act of these tests: every decision shows.
const LATE = '2026-10-25T11:00:00.000Z'
const summary = async (p, task) =>
  (await panel(p, task, LATE)).decisions.map((i) => [i.kind, i.id, i.task])

const COSTS =
  'replace:\n  - { id: facts-not-proof, with: { id: facts-not-proof, says: "The body states facts, ' +
  'with what the problem costs.", rules: [ { id: no-code-proof, says: "No file paths with line ' +
  'numbers, no commit hashes in the body", checkedBy: linter } ] } }\n'

// A host run h1 on t1 (the architect a1), a lead a2, and a Reject of the lead on the writer's r1
// with a point that names no rule.
const rejected = async () => {
  const top = `${TASK_WHOLE}role: architect\n`
  const p = project({ 'top.yaml': top, 'again.yaml': top.replace('agreed facts.', 'agreed facts, with their cost.') })
  gitPerson(p)
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.run('run start', HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out) // ruling 10.1
  ok(await p.agent(`brief ${host}`))
  const lead = await agentToken(p, ok(await p.agent(`assign ${host} t1 --role=section-lead`)).out) // 10.1
  ok(await p.agent(`brief ${lead}`))
  const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=3`)).out)
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', INTRO_V2)
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
  const reject = ok(await p.agent(`review ${lead} r1 reject --point="the reader cannot see the cost"`)).out
  return { p, host, vid: reject.match(/^(v\d+): reject/)[1] }
}
const remake = (p, host) =>
  p.agent(`task remake ${host} t1 --file=again.yaml --reason="the text asks for the cost"`)

describe('an item that waits for the person shows on an open task', () => {
  test('a draft answers no point of a closed task: the harness drops it, and says so', async () => {
    const { p, host, vid } = await rejected()
    ok(await remake(p, host))
    // The remake ends the host's Sol a1 (C1): the person gives t2 to a new Sol of the run, which
    // gets its token as the host (ruling 10.1).
    const sol = await solToken(p, ok(await p.nanda('assign t2 --role=architect')).out)
    ok(await p.agent(`brief ${sol}`))
    p.write('costs.yaml', COSTS)
    const drafted = ok(await p.agent(`direction revise ${sol} tsd-writing --file=costs.yaml --answers=${vid}`)).out
    expect(drafted).toStartWith('d2 drafted, built on tsd-writing@1; it waits')
    expect(drafted).toContain(`${vid}: a point of a closed task blocks no work, so d2 does not answer it.`)
    expect(ok(await p.agent('direction show d2')).out).not.toContain('answers:')
  }, 20000)

  test('a draft whose task closes follows it to the task that replaced it', async () => {
    const { p, host, vid } = await rejected()
    p.write('costs.yaml', COSTS)
    ok(await p.agent(`direction revise ${host} tsd-writing --file=costs.yaml --answers=${vid}`))
    expect(await summary(p, 't1')).toEqual([['direction', 'd2', 't1']])
    ok(await remake(p, host))
    expect(await summary(p, 't2')).toEqual([['direction', 'd2', 't2']])
  }, 20000)

  test('a draft on an old version stops: the page drops it, and no accept counts for it', async () => {
    const { p, host } = await rejected()
    p.write('costs.yaml', COSTS)
    p.write('story.yaml', 'replace:\n  - { id: intro-story, with: { id: intro-story, where: { section: introduction }, ' +
      'says: "Tell the story first, with one example.", rules: [ { id: repeatable, says: "A reviewer can repeat ' +
      'the problem without the design", checkedBy: section-lead } ] } }\n')
    ok(await p.agent(`direction revise ${host} tsd-writing --file=costs.yaml`))
    ok(await p.agent(`direction revise ${host} tsd-writing --file=story.yaml`))
    expect(await summary(p, 't1')).toEqual([['direction', 'd2', null], ['direction', 'd3', null]])
    ok(await p.nanda('review d2 accept', 'accept'))
    // d3 is built on tsd-writing@1; d2 became tsd-writing@2 first.
    expect(await summary(p, 't1')).toEqual([])
    expect((await p.nanda('review d3 accept', 'accept')).err).toContain(
      'd3 is built on TSD writing v1, an old version (tsd-writing@2 is current), so it stopped',
    )
    expect(ok(await p.agent('direction show d3')).out)
      .toContain('built on an old version, so it stopped (tsd-writing@2 is current)')
  }, 20000)

  test('a relayed act shows with the words of the person, and the Confirm of the page counts it', async () => {
    const { p, host } = await rejected()
    p.write('costs.yaml', COSTS)
    ok(await p.agent(`direction revise ${host} tsd-writing --file=costs.yaml`))
    const relayed = ok(await p.agent(`forward ${host} Nanda accept d2 --evidence="chat | Nanda says yes" --quote="yes, add the cost"`)).out
    const id = relayed.match(/^(e\d+)/)[1]
    const item = (await panel(p, 't1', LATE)).decisions.find((i) => i.kind === 'confirm')
    expect(item).toMatchObject({
      id,
      task: 't1',
      shown: true,
      words: null,
      quote: 'yes, add the cost',
      text: `a1 relayed your words as this act: accept d2 with evidence chat | Nanda says yes. It counts when you confirm it.`,
    })
    expect((await act(p, 'confirm', { forward: id })).out).toContain(`${id} confirmed`)
    expect(await summary(p, 't1')).toEqual([])
  }, 20000)
})
