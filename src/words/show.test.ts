// The words of a draft's why: the reason, then the reviser's words; nothing when none was given.
import { describe, expect, test } from 'bun:test'
import { whyLines } from './show.ts'

describe('the why of a draft', () => {
  test('prints its reason and its words, and nothing when none was given', () => {
    expect(whyLines({ _tag: 'NoneGiven' })).toEqual([])
    expect(whyLines({ _tag: 'Given', reason: 'Shorten', words: null })).toEqual(['why: Shorten'])
    const words = 'Two readings of facts-not-proof.'
    expect(whyLines({ _tag: 'Given', reason: 'Correct the standard', words })).toEqual([
      'why: Correct the standard',
      'Two readings of facts-not-proof.',
    ])
  })
})
