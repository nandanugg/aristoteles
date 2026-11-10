// The rules of the design review of 2026-11-08, through the CLI: a model can grant, each stop
// gets its own evaluation, a draft on an old version is refused, a Reject of a reviewer that is
// not a decider asks for the owner's accept, a model writes each draft, a Reject of a draft
// goes back to its reviser, and an open suggestion shows to whoever answers it.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, INTRO_V1, ok, reported, started, tokenIn } from './harness.js'

const COST = 'add:\n  - { id: cost-first, says: Say what the problem costs., rules: [ { id: names-cost, says: "The introduction names the cost", checkedBy: linter } ] }\n'
const IMPACT = 'add:\n  - { id: impact-first, says: Say what the merchant saw., rules: [ { id: names-impact, says: "The introduction names what the merchant saw", checkedBy: linter } ] }\n'
const SEEN = '--evidence="the draft, its new standard | the linter can check its rule"'
const architect = async (p) => {
  const token = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${token}`))
  return token
}

describe('a model gives an executive act', () => {
  test('a lead gives the architect its own Approve act; a linter has no act to give; only the giver revokes', async () => {
    const { p, lead, linter } = await reported()
    const until = '2026-10-26T09:00:00Z'
    expect(ok(await p.agent(`grant ${lead} --act=approve --on=writer --to=architect --until=${until}`)).out)
      .toContain(`x1: architect may approve writer until ${until}.`)
    expect((await p.agent(`grant ${linter} --act=approve --on=writer --to=architect --until=${until}`)).err)
      .toContain('may not give this act')
    expect((await p.nanda('revoke x1', 'revoke')).err).toContain('only the giver revokes an executive act')
    expect(ok(await p.agent(`revoke ${lead} x1`)).out).toContain('x1 revoked; the acts before it stay.')
    expect((await p.agent(`revoke ${lead} x1`)).err).toContain('already revoked')
  })
})

describe('each stop gets its own evaluation', () => {
  test('the last try ends on a fault, and Nanda rejects the task too: two stops, two evaluations', async () => {
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 reject --point="cites ABC-2964" --breaks=no-ticket-ids`))
    ok(await p.nanda('review t1 reject --point="the task asks for two things at once"'))
    const sol = await architect(p)
    const words = '--wrong="r1 cites a ticket" --why="the facts name the ticket" --improve="name the event" --level=task'
    const first = ok(await p.agent(`evaluate ${sol} t1 ${words}`)).out
    expect(first).toContain('ev1 evaluates t1 at the level task; it answers ex1.')
    expect(first).toContain('t1 also waits for an evaluation of v3')
    expect(ok(await p.agent(`evaluate ${sol} t1 ${words}`)).out).toContain('ev2 evaluates t1 at the level task; it answers v3.')
    expect((await p.agent(`evaluate ${sol} t1 ${words}`)).err).toContain('t1 waits for no evaluation')
  })
})

describe('drafts of a direction', () => {
  test('two drafts on one version: the second is refused at the accept that would make it official', async () => {
    const { p } = await reported()
    const sol = await architect(p)
    p.write('cost.yaml', COST)
    p.write('impact.yaml', IMPACT)
    expect(ok(await p.agent(`direction revise ${sol} tsd-writing --file=cost.yaml`)).out).toContain('d2 drafted, built on tsd-writing@1')
    expect(ok(await p.agent(`direction revise ${sol} tsd-writing --file=impact.yaml`)).out).toContain('d3 drafted, built on tsd-writing@1')
    expect(ok(await p.nanda(`review d2 accept ${SEEN}`, 'accept')).out).toContain('d2 is official: tsd-writing@2')
    expect((await p.nanda(`review d3 accept ${SEEN}`, 'accept')).err)
      .toContain('is built on TSD writing v1, an old version; its reviser revises the current one')
  })

  test('after the Reject of a reviewer that is not a decider, only the accept of Nanda makes the draft official', async () => {
    const direction = DIRECTION.replace('from: [Pathos, Logos]\n', 'from: [Pathos, Logos]\napprovedBy: { or: [region-lead, Nanda] }\n')
    const { p, lead } = await reported({ 'directions/tsd-writing.yaml': direction })
    const sol = await architect(p)
    p.write('cost.yaml', COST)
    ok(await p.agent(`direction revise ${sol} tsd-writing --file=cost.yaml`))
    const other = await architect(p)
    expect(ok(await p.agent(`review ${other} d2 reject --reason="the cost has no source in the facts"`)).out)
      .toContain('d2 stays open; after this Reject, only the accept of Nanda makes it official.')
    expect((await p.agent(`review ${lead} d2 accept ${SEEN}`)).err)
      .toContain('only the accept of Nanda makes it official')
    expect(ok(await p.nanda(`review d2 accept ${SEEN}`, 'accept')).out).toContain('d2 is official: tsd-writing@2')
  })

  test('a model writes each draft: the person gives direction in words', async () => {
    const { p } = await reported()
    p.write('cost.yaml', COST)
    expect((await p.nanda('direction revise tsd-writing --file=cost.yaml')).err)
      .toContain('the person gives direction in words: work suggest <direction, standard, or rule>')
  })
})

describe('a Reject of a draft goes back to its reviser', () => {
  const COST_FROM_FACTS = 'add:\n  - { id: cost-first, says: "Say what the problem costs, from the facts.", rules: [ ' +
    '{ id: names-cost, says: "The introduction names the cost that the facts give", checkedBy: linter } ] }\n'

  test('the new draft answers the Reject, and shows what changed since the rejected draft', async () => {
    const { p } = await reported()
    const sol = await architect(p)
    p.write('cost.yaml', COST)
    ok(await p.agent(`direction revise ${sol} tsd-writing --file=cost.yaml`))
    expect(ok(await p.nanda('review d2 reject --reason="the cost has no source in the facts"')).out)
      .toContain('d2 is ended; its reviser revises the current version again.')
    expect(ok(await p.agent(`next ${sol}`)).out).toContain(`work direction revise ${sol} tsd-writing --file=<edit.yaml> --answers=v2`)
    expect((await p.agent(`direction revise ${sol} tsd-writing --file=cost.yaml --answers=v2`)).err)
      .toContain('this draft proposes the same as d2, so it cannot answer "the cost has no source in the facts"')
    p.write('cost2.yaml', COST_FROM_FACTS)
    expect(ok(await p.agent(`direction revise ${sol} tsd-writing --file=cost2.yaml --answers=v2`)).out)
      .toContain('d3 drafted, built on tsd-writing@1, answering v2; it waits for the accept of Nanda.')
    expect(ok(await p.nanda('waiting')).out).toContain('it answers v2, the Reject of d2 by Nanda: "the cost has no source in the facts"')
    const show = ok(await p.nanda('direction show d3')).out
    expect(show).toContain('since d2, which v2 rejected:\n  ~ cost-first: Say what the problem costs, from the facts.\n    was: Say what the problem costs.')
    expect(show).toContain('-   names-cost: The introduction names the cost (linter)')
    expect(ok(await p.nanda(`review d3 accept ${SEEN}`, 'accept')).out).toContain('d3 is official: tsd-writing@2')
  })

  test('when the reviser is finished, a new architect revises', async () => {
    const { p } = await reported()
    const sol = await architect(p)
    p.write('cost.yaml', COST)
    ok(await p.agent(`direction revise ${sol} tsd-writing --file=cost.yaml`))
    ok(await p.agent(`finish ${sol}`))
    const reject = ok(await p.nanda('review d2 reject --reason="the cost has no source in the facts"')).out
    expect(reject).toContain('its reviser a4 is finished; a new architect revises the current version.')
    expect(reject).toContain('next: work assign t1 --role=architect')
    const next = await architect(p)
    expect(ok(await p.agent(`next ${next}`)).out).toContain(`work direction revise ${next} tsd-writing --file=<edit.yaml> --answers=v2`)
  })
})

describe('an open suggestion shows to whoever answers it', () => {
  const COSTS = 'replace:\n  - { id: facts-not-proof, with: { id: facts-not-proof, says: "The body states facts, with what the problem costs.", rules: [ ' +
    '{ id: no-code-proof, says: "No file paths with line numbers, no commit hashes in the body", checkedBy: linter } ] } }\n'
  const OPEN = 's1 suggests about facts-not-proof: "the facts also say what the problem costs" (Nanda)'

  test('with no high role, the person assigns one; the high role answers it with a draft', async () => {
    const { p } = await reported()
    ok(await p.nanda('suggest facts-not-proof --says="the facts also say what the problem costs"'))
    const waiting = ok(await p.nanda('waiting')).out
    expect(waiting).toContain(`${OPEN}; no high role works on a task that follows tsd-writing\n    work assign t1 --role=architect`)
    const sol = await architect(p)
    expect(ok(await p.nanda('waiting')).out).not.toContain('s1 suggests')
    expect(ok(await p.agent(`next ${sol}`)).out)
      .toContain(`${OPEN}; answer it with a draft that changes the standard facts-not-proof\n  work direction revise ${sol} tsd-writing --file=<edit.yaml> --answers=s1`)
    p.write('costs.yaml', COSTS)
    expect(ok(await p.agent(`direction revise ${sol} tsd-writing --file=costs.yaml --answers=s1`)).out).toContain('d2 drafted, built on tsd-writing@1, answering s1')
    expect(ok(await p.agent(`next ${sol}`)).out).not.toContain('s1 suggests')
    ok(await p.nanda(`review d2 accept ${SEEN}`, 'accept'))
    expect(ok(await p.agent(`next ${sol}`)).out).not.toContain('s1 suggests')
  })

  test('a suggestion about the direction itself asks for a change of what it says', async () => {
    const { p } = await reported()
    const sol = await architect(p)
    ok(await p.nanda('suggest tsd-writing --says="the reader also sees what the problem costs"'))
    expect(ok(await p.agent(`next ${sol}`)).out)
      .toContain(`answer it with a draft that changes what tsd-writing says\n  work direction revise ${sol} tsd-writing --file=<edit.yaml> --answers=s1`)
  })
})
