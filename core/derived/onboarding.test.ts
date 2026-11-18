// The derived states of onboarding (BUILD.md section 3, W1): an example and a direction of
// onboarding, and the flow that holds the examples.
import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { decodeRecorded } from '../../src/domain/events.ts'
import {
  type Author,
  Example,
  Flow,
  FlowStep,
  OnboardingDirection,
  type Time,
} from '../schema/index.ts'
import { exampleStateOf, onboardingStateOf } from './index.ts'

const HOST_RUN: Author = { _tag: 'ModelRun', name: 'host', at: '2026-10-25T08:00:00.000Z' as Time }

// Nanda, 2026-11-15: an example is an output of a marked step, real or written by the host.
const SPOT = { file: 'docs/tsd.md', line: 3, excerpt: '## Introduction' }
const CASE = { fit: 'Follows', output: SPOT } as unknown as Example
const BREAKS = { fit: 'Breaks', output: { written: 'Intro: see PR 42.' } } as unknown as Example
const STEP = { from: 'writer', to: 'docs/tsd.md', says: 'writes' }
const FLOW = [{ ...STEP, uses: ['tsd-writing'], examples: [CASE, BREAKS] }]
// The text of one file; any other file is not there.
const only = (file: string, text: string) => (f: string) => (f === file ? text : null)

// --- pure states --------------------------------------------------------------------------------

describe('exampleStateOf', () => {
  test('an example is Current while its file holds the excerpt, and Stale when it is gone', () => {
    const tsd = (text: string) => only('docs/tsd.md', text)
    expect(exampleStateOf(tsd('# TSD\n\n## Introduction\n'), CASE)).toEqual({ _tag: 'Current' })
    // The excerpt counts trimmed, and the line is only where the page points.
    const output = { ...SPOT, excerpt: '  ## Introduction  ', line: 99 }
    const spaced = { ...CASE, output } as unknown as Example
    expect(exampleStateOf(tsd('## Introduction'), spaced)).toEqual({ _tag: 'Current' })
    expect(exampleStateOf(tsd('# TSD\n\n## Design\n'), CASE)).toEqual({ _tag: 'Stale' })
    expect(exampleStateOf(() => null, CASE)).toEqual({ _tag: 'Stale' })
  })
  test('Stale when the excerpt of its input is gone, though its output holds', () => {
    const input = { file: 'CLAUDE.md', line: 4, excerpt: 'One idea a section.' }
    const checked = { ...CASE, input } as unknown as Example
    const texts: Record<string, string> = {
      'docs/tsd.md': '## Introduction\n',
      'CLAUDE.md': '# Rules\n\nOne idea a section.\n',
    }
    expect(exampleStateOf((f) => texts[f] ?? null, checked)).toEqual({ _tag: 'Current' })
    const moved: Record<string, string> = { ...texts, 'CLAUDE.md': '# Rules\n\nTwo ideas.\n' }
    expect(exampleStateOf((f) => moved[f] ?? null, checked)).toEqual({ _tag: 'Stale' })
  })
  test('the words of the host name no file, so they are never stale', () => {
    expect(exampleStateOf(() => null, BREAKS)).toEqual({ _tag: 'Current' })
  })
})

describe('Example', () => {
  test('an example reads and writes as it is: its input, its output', () => {
    const example = { fit: 'Breaks', input: SPOT, output: { written: 'Intro: see PR 42.' } }
    const read = Schema.decodeUnknownSync(Example)(example)
    expect(read).toEqual(example as never)
    expect(Schema.encodeSync(Example)(read)).toEqual(example as never)
  })
  test('no output, or blank words, do not read', () => {
    for (const old of [
      { ...SPOT, fit: 'Follows' },
      { fit: 'Follows' },
      { fit: 'Follows', output: { written: ' ' } },
    ]) {
      expect(() => Schema.decodeUnknownSync(Example)(old)).toThrow()
    }
  })
})

// Nanda, 2026-11-15 (the owner's ruling: make illegal states unrepresentable): an example lives in
// the marked step that it shows, so it cannot name a step that is gone or that is not marked.
describe('the flow holds its examples', () => {
  const flow = Schema.decodeUnknownSync(Flow)
  const step = Schema.decodeUnknownSync(FlowStep)
  const marked = { ...STEP, uses: ['d'], examples: [CASE, BREAKS] }
  test('a marked step has uses and examples with one that follows and one that breaks', () => {
    expect(flow([STEP, marked])).toEqual([STEP, marked] as never)
    expect(() => step({ ...marked, examples: [CASE] })).toThrow('no example that breaks')
    expect(() => step({ ...marked, examples: [BREAKS] })).toThrow('no example that follows')
    expect(() => step({ ...marked, examples: [] })).toThrow()
  })
  test('uses without examples, or examples without uses, do not read', () => {
    expect(() => step({ ...STEP, uses: ['d'] })).toThrow()
    expect(() => step({ ...STEP, examples: [CASE, BREAKS] })).toThrow()
    expect(() => step({ ...marked, uses: [] })).toThrow()
  })
  test('a flow that marks no step does not read', () => {
    expect(() => flow([STEP, STEP])).toThrow('no flow step has uses')
    expect(() => flow([])).toThrow('no flow step has uses')
  })
  test('a line needs its file', () => {
    const place = { file: 'docs/t.md', line: 3 }
    expect(step({ ...STEP, place })).toEqual({ ...STEP, place } as never)
    expect(step({ ...STEP, place: { file: 'docs/t.md' } })).toEqual({
      ...STEP,
      place: { file: 'docs/t.md' },
    } as never)
    expect(() => step({ ...STEP, line: 12 })).not.toThrow()
    expect(() => step({ ...STEP, place: { line: 12 } })).toThrow()
    expect(() => step({ ...STEP, place: { file: 'docs/t.md', line: 0 } })).toThrow()
  })
  test('a stored event of an older shape does not decode: the store refuses to read it', () => {
    const direction = { id: 'd', name: 'D', owner: 'Nanda', from: [], summary: 'S.', says: 'S.', standards: [] }
    const old = {
      _tag: 'Drafted',
      direction: { ...direction, flow: [{ ...STEP, uses: ['d'] }] },
      examples: [CASE, BREAKS],
      answers: [],
      why: { _tag: 'NoneGiven' },
    }
    const row = { seq: 1, at: '2026-10-25T09:00:00.000Z', author: HOST_RUN, event: { _tag: 'Revision', create: old } }
    expect(() => decodeRecorded(row)).toThrow()
    const { examples: _, ...rest } = old
    const now = { ...rest, direction: { ...direction, flow: [marked] } }
    expect(decodeRecorded({ ...row, event: { _tag: 'Revision', create: now } }).seq).toBe(1)
  })
})

describe('onboardingStateOf', () => {
  const question = { says: 'Is the facts file the source?', example: CASE, options: ['yes', 'no'] }
  const draft = {
    name: 'TSD writing',
    from: ['Pathos'],
    content: { summary: 'S.', flow: FLOW, says: 'The reader decides.', standards: [] },
  }
  const file = (stage: object) =>
    Schema.decodeUnknownSync(OnboardingDirection)({
      id: 'tsd-writing',
      asked: { _tag: 'Found' },
      stage,
    })
  test('Loading while the host drafts, revises, or reads the submitted answers', () => {
    expect(onboardingStateOf(file({ _tag: 'Drafting' }))).toEqual({ _tag: 'Loading' })
    const revise = file({ _tag: 'Revising', draft, words: 'name the cost', answered: [] })
    expect(onboardingStateOf(revise)).toEqual({ _tag: 'Loading' })
    const answered = file({ _tag: 'Answered', draft, answered: [{ ...question, chosen: 'A' }] })
    expect(onboardingStateOf(answered)).toEqual({ _tag: 'Loading' })
  })
  test('Question while questions are open, with the open ones', () => {
    const state = onboardingStateOf(file({ _tag: 'Question', draft, open: [question] }))
    expect(state._tag === 'Question' ? state.open.map((q: { says: string }) => q.says) : []).toEqual([question.says])
  })
  test('Ready when the draft waits for the person, and Accepted after the accept', () => {
    expect(onboardingStateOf(file({ _tag: 'Ready', draft }))).toEqual({ _tag: 'Ready' })
    expect(onboardingStateOf(file({ _tag: 'Accepted', draft }))).toEqual({ _tag: 'Accepted' })
  })
  test('Loading for a file that the reader reset: the host drafts it again', () => {
    expect(onboardingStateOf(file({ _tag: 'Reset' }))).toEqual({ _tag: 'Loading' })
  })
  // T2: an accept, a question, a Revise and answers each come with their draft, so a file that is
  // Accepted with no draft, or that holds a Revise and open questions beside its accept, does not
  // decode.
  test('an Accepted, Question, Answered or Revising file with no draft does not decode', () => {
    for (const stage of [
      { _tag: 'Accepted' },
      { _tag: 'Question', open: [question] },
      { _tag: 'Question', draft, open: [] },
      { _tag: 'Answered', draft, answered: [] },
      { _tag: 'Revising', words: 'shorter', answered: [] },
    ]) {
      expect(() => file(stage)).toThrow()
    }
    // The four fields of the old shape, Drafting and Accepted at once (2-type-shapes.md, value 1).
    const old = {
      id: 'd1',
      asked: { _tag: 'Found' },
      draft: { _tag: 'Drafting' },
      questions: [{ ...question, answer: { _tag: 'Open' } }],
      request: { _tag: 'Revise', words: 'shorter' },
      accepted: { _tag: 'Accepted' },
    }
    expect(Schema.decodeUnknownOption(OnboardingDirection)(old)._tag).toBe('None')
  })
})
