// The words of directions, standards, and rules are any markdown (Nanda, 2026-11-10). Headers
// inside the words of one entry divide them: a role reads one piece by its address, a brief
// gives a long rule as its lead and its pieces, and work search finds words in aristoteles.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, ok, reported, started, tokenIn } from './harness.js'

const LONG_RULE = `      - id: no-ticket-ids
        checkedBy: linter
        says: |
          No ticket ids and no chat-thread citations in the body.

          ## Why
          A reader outside the team cannot open a ticket.

          ## Examples
          Write "the export ran twice", and leave out "ABC-2964".
`
const withLongRule = DIRECTION.replace('      - { id: no-ticket-ids, says: "No ticket ids and no chat-thread citations", checkedBy: linter }\n', LONG_RULE)

describe('the pieces of an entry', () => {
  test('a brief gives a long rule as its lead and the address of each piece', async () => {
    const { p, writer } = await (await import('./harness.js')).withWriter({ 'directions/tsd-writing.yaml': withLongRule })
    const brief = ok(await p.agent(`brief ${writer}`)).out
    expect(brief).toContain('no-ticket-ids  No ticket ids and no chat-thread citations in the body.\n' +
      `${' '.repeat(24)}- Why: work direction show tsd-writing@1#no-ticket-ids#why\n` +
      `${' '.repeat(24)}- Examples: work direction show tsd-writing@1#no-ticket-ids#examples  (linter)`)
    expect(ok(await p.agent('direction show tsd-writing@1#no-ticket-ids#examples')).out)
      .toBe('tsd-writing@1 · rule no-ticket-ids · Examples\n## Examples\nWrite "the export ran twice", and leave out "ABC-2964".')
  })

  test('an address names a standard, a rule, or a header; a wrong one lists the names', async () => {
    const { p } = await started({ 'directions/tsd-writing.yaml': withLongRule })
    expect(ok(await p.agent('direction show tsd-writing#intro-story')).out).toContain('tsd-writing@1 · standard intro-story where {"region":"introduction"}\nTell the story first, in plain words.\n- rule repeatable (region-lead)')
    expect(ok(await p.agent('direction show tsd-writing@1#why')).out).toContain('tsd-writing@1 · rule no-ticket-ids · Why\n## Why\nA reader outside the team cannot open a ticket.')
    expect((await p.agent('direction show tsd-writing#cost')).err).toContain('names no piece; after # comes one of: facts-not-proof, intro-story, no-code-proof, no-ticket-ids, repeatable, why, examples')
  })
})

describe('work search', () => {
  test('finds a rule by its words, with the versions that hold it and the tasks that read them', async () => {
    const { p } = await reported()
    const out = ok(await p.agent('search ticket')).out
    expect(out).toContain('rule no-ticket-ids: No [ticket] ids and no chat-thread citations')
    expect(out).toContain('in tsd-writing@1#no-ticket-ids · read by t1 (The Introduction)')
  })

  test('finds a suggestion and a reason; says when nothing matches', async () => {
    const { p } = await reported()
    ok(await p.nanda('suggest facts-not-proof --says="the facts also say what the problem costs"'))
    expect(ok(await p.agent('search costs')).out).toContain('suggestion s1: the facts also say what the problem [costs]')
    expect(ok(await p.agent('search kubernetes')).out).toBe('nothing in report-export says "kubernetes".')
    expect((await p.agent('search')).err).toContain('a search needs its words')
  })
})
