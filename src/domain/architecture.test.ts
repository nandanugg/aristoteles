import { expect, test } from 'bun:test'
import { resolve } from 'node:path'
import { programs } from './architecture-projects.probe.ts'
import { ceilingDigest, compareBaseline, keyOf, scan } from './architecture-scan.probe.ts'
import baseline from './domain-primitive-baseline.json' with { type: 'json' }
import ceiling from './domain-primitive-baseline-u0.json' with { type: 'json' }

const ROOT = resolve(import.meta.dir, '../..')

test('the surviving U0 findings are frozen and unique', () => {
  expect(ceilingDigest(ceiling)).toBe('aa758d9a1260ec31dffe11b4a7f814871c33c4fa9d38eea1f704d0a3daf50733')
  expect(new Set(ceiling).size).toBe(ceiling.length)
})

// The checker can print a readonly array element as either [] or <0>.
// Reconcile only the same declaration, source tokens, rule, and element path.
const baselineKeys = new Set(baseline.map(keyOf))

test('both project type graphs match the shrinking baseline exactly', () => {
  const { engine, browser } = programs(ROOT)
  const measured = new Map([engine, browser]
    .flatMap((program) => scan(program, ROOT))
    .map((finding) => [keyOf(finding), finding]))
  const normalized = [...measured.values()].map((finding) => {
    if (baselineKeys.has(keyOf(finding))) return finding
    const equivalent = { ...finding, path: finding.path.replaceAll('[]', '<0>') }
    return baselineKeys.has(keyOf(equivalent)) ? equivalent : finding
  })
  expect(new Set(normalized.map(keyOf)).size).toBe(measured.size)
  expect(compareBaseline(normalized, baseline, ceiling)).toEqual({
    newFindings: [], staleBaseline: [], outsideCeiling: [], duplicateEntries: 0,
  })
}, 30_000)
