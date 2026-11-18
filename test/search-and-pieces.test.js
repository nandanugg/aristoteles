// The words of directions, standards, and rules are any markdown (Nanda, 2026-11-10). Headers
// inside the words of one entry divide them: a reader takes one piece by its address, and work
// search finds words in aristoteles.
import { describe, expect, test } from 'bun:test'
import { DIRECTION, ok, started } from './harness.js'

const LONG_RULE = `      - id: no-ticket-ids
        checkedBy: linter
        says: |
          No ticket ids and no chat-thread citations in the body.

          ## Why
          A reader outside the team cannot open a ticket.

          ## Examples
          Write "the export ran twice", and leave out "ABC-2964".
`
const OLD_RULE =
  '      - { id: no-ticket-ids, says: "No ticket ids and no chat-thread citations", ' +
  'checkedBy: linter }\n'
const withLongRule = DIRECTION.replace(OLD_RULE, LONG_RULE)

describe('the pieces of an entry', () => {
  test('an address names a standard, a rule, or a header; a wrong one lists names', async () => {
    const { p } = await started({ 'directions/tsd-writing.yaml': withLongRule })
    expect(ok(await p.agent('direction show tsd-writing@1#no-ticket-ids#examples')).out)
      .toBe('tsd-writing@1 · rule no-ticket-ids · Examples\n## Examples\n' +
        'Write "the export ran twice", and leave out "ABC-2964".')
    expect(ok(await p.agent('direction show tsd-writing#intro-story')).out).toContain(
      'tsd-writing@1 · standard intro-story where {"section":"introduction"}\n' +
        'Tell the story first, in plain words.\n- rule repeatable (section-lead)',
    )
    expect(ok(await p.agent('direction show tsd-writing@1#why')).out).toContain(
      'tsd-writing@1 · rule no-ticket-ids · Why\n## Why\n' +
        'A reader outside the team cannot open a ticket.',
    )
    expect((await p.agent('direction show tsd-writing#cost')).err).toContain(
      'names no piece; after # comes one of: facts-not-proof, intro-story, no-code-proof, ' +
        'no-ticket-ids, repeatable, why, examples',
    )
  })
})

describe('work search', () => {
  test('finds a rule by its words, with the version that holds it', async () => {
    const { p } = await started()
    const out = ok(await p.agent('search ticket')).out
    expect(out).toContain('rule no-ticket-ids: No [ticket] ids and no chat-thread citations')
    expect(out).toContain('in tsd-writing@1#no-ticket-ids')
  })

  test('says when nothing matches', async () => {
    const { p } = await started()
    expect(ok(await p.agent('search kubernetes')).out)
      .toBe('nothing in report-export says "kubernetes".')
    expect((await p.agent('search')).err).toContain('a search needs its words')
  })
})
