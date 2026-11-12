// The headers of a text, and the names of an actor.
import { describe, expect, test } from 'bun:test'
import { briefWords, headersOf, headerName } from './common.ts'

describe('the headers of a text', () => {
  const text = '# Top\nlead\n## Cost first\ncost\n```\n# not a header\n```\n## Other\nx'
  test('a header has a slug, a line and its words up to the next one of its level', () => {
    const found = headersOf(text).map((h) => [h.level, h.slug, h.line])
    expect(found).toEqual([
      [1, 'top', 0],
      [2, 'cost-first', 2],
      [2, 'other', 7],
    ])
    expect(headersOf(text)[1]?.text).toBe('## Cost first\ncost\n```\n# not a header\n```')
    expect(headerName(' Cost first! ')).toBe('cost-first')
  })
  test('a brief gives the lead and the address of each header', () => {
    expect(briefWords('plain', 'd1', '  ')).toBe('plain')
    expect(briefWords('## A\nx', 'tsd@1#r', '')).toBe(
      '(read the pieces below)\n- A: work direction show tsd@1#r#a',
    )
  })
})
