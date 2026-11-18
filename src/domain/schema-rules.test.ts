// Rules that the Schemas hold (the owner's ruling: make illegal states unrepresentable): each
// value below decoded before, and now it is refused when it is decoded, so a stored event or a
// file that carries it does not read.
import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { Settings, ModelLimits, ReviseFile, DirectionFile } from './files.ts'
import { AiQuestion } from './onboarding.ts'

const refused = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
  expect(() => Schema.decodeUnknownSync(schema)(value)).toThrow()
const reads = <A, I>(schema: Schema.Codec<A, I>, value: unknown) =>
  expect(() => Schema.decodeUnknownSync(schema)(value)).not.toThrow()

describe('whole positive numbers', () => {
  test('a limit is a whole number of 1 or more', () => {
    reads(ModelLimits, { Assignment: { attempts: 3, briefChars: 9000 } })
    for (const bad of [-3, 0, 1.5]) {
      refused(ModelLimits, { Assignment: { attempts: bad } })
      refused(ModelLimits, { Review: { rules: bad } })
      refused(ModelLimits, { Result: { size: bad } })
    }
  })
  test('maxStandards of a direction file, and the minutes and hours of the settings', () => {
    const direction = {
      id: 'd',
      name: 'D',
      owner: 'Nanda',
      from: [],
      summary: 'S.',
      flow: [],
      says: 'S.',
      standards: [],
      maxStandards: 0,
    }
    refused(DirectionFile, direction)
    const settings = {
      models: {},
      retryMinutes: 5,
      hostWaitMinutes: 10,
      outsideSourceHours: 72,
      sound: false,
      theme: 'light',
    }
    reads(Settings, settings)
    for (const key of ['retryMinutes', 'hostWaitMinutes', 'outsideSourceHours']) {
      refused(Settings, { ...settings, [key]: -1 })
      refused(Settings, { ...settings, [key]: 0.5 })
    }
  })
})

describe('words, not blanks', () => {
  test('a question has no blank part', () => {
    const question = {
      says: 'Which?',
      example: { fit: 'Breaks', output: { written: 'w' } },
      options: ['yes', 'no'],
      answer: { _tag: 'Open' },
    }
    reads(AiQuestion, question)
    refused(AiQuestion, { ...question, options: ['', 'no'] })
  })
})

describe('a revise changes something', () => {
  test('an empty revise is refused, and one key is enough', () => {
    refused(ReviseFile, {})
    reads(ReviseFile, { says: 'new words' })
    reads(ReviseFile, { remove: ['s1'] })
  })
})
