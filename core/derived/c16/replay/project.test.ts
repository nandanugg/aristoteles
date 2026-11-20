// The projection of the TS core's state, and the model's told steps, on the initial state and one
// stored model state.
import { describe, expect, test } from 'bun:test'
import { readTrace } from './itf.ts'
import { canonical, modelActors, modelCmp, modelTold, storeOf } from './model.ts'
import { initial, project, start, told } from './project.ts'

const trace = readTrace(`${import.meta.dir}/traces/coreTwo-0.itf.json.gz`)
const first = storeOf(trace.states[0]!.store)

describe('the initial state', () => {
  const s = initial([0, 1])
  const c = start([0, 1])
  test('projects to the model initial state', () => {
    const cmp = project(s, c)
    expect(cmp).toEqual(canonical(modelCmp(first)))
    expect(cmp.tasks['0']?.state).toBe('Unsent')
    expect(cmp.ruleForm).toEqual({ '0': 'Ref', '1': 'Ref' })
  })
  test('the host is told to send, as in the model; the others nothing', () => {
    expect(told(s, c, 'Host')).toEqual(['Open:send'])
    expect(modelTold(first, 'Host')).toEqual(['Open:send'])
    for (const who of modelActors(first).filter((x) => x !== 'Host')) {
      expect(told(s, c, who)).toEqual(modelTold(first, who))
    }
  })
})

describe('a model state', () => {
  test('its compared fields, canonical, are idempotent', () => {
    const later = storeOf(trace.states[8]!.store)
    const cmp = modelCmp(later)
    expect(canonical(cmp)).toEqual(canonical(canonical(cmp)))
    expect(Object.keys(cmp.fixes)).toEqual(['0', '1', '2'])
  })
})
