import { beforeAll, expect, test } from 'bun:test'
import { resolve } from 'node:path'
import ts from 'typescript'
import { phaseWriteViolations, sharedWireViolations } from './architecture-contracts.probe.ts'
import { programs } from './architecture-projects.probe.ts'
import { compareBaseline, findingDigest, keyOf, scan, sourceKey } from './architecture-scan.probe.ts'

const ROOT = resolve(import.meta.dir, '../..')
const DOMAIN = 'src/domain/project/architecture-record.ts'
const LEGACY = 'src/domain/architecture-legacy.ts'
const BROWSER = 'adapters/web/app/architecture-view.ts'
const MOVES = 'core/state/project.ts'
const sources = {
  [DOMAIN]: `
import { Context, Effect, Schema } from 'effect'
const key = (pattern: RegExp) => Schema.String.check(Schema.isPattern(pattern))
export const RoleKey = key(/^role:[a-z]+$/).pipe(Schema.brand('ProbeRoleKey'))
export type RoleKey = typeof RoleKey.Type
export const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(Schema.brand('ProbeCount'))
export type Count = typeof Count.Type
export const Notice = Schema.TaggedStruct('Notice', { key: RoleKey, count: Count })
export type Notice = typeof Notice.Type
export type Good = { readonly _tag: 'First'; readonly key: RoleKey; readonly count: Count; readonly key: \`role:\${RoleKey}\` }
  | { readonly _tag: 'Second'; readonly choice: 'a' | 'b' }
export type Assignment = { readonly key: RoleKey; readonly counts: ReadonlyMap<RoleKey, Count> }
export type EmbeddedKey = { readonly reviewer: RoleKey }
export type Task = { phase: { _tag: 'Sent' } | { _tag: 'Done' } }
export const decodeCount = (input: unknown) => Schema.decodeUnknownSync(Count)(input)
export const Loose = Schema.Struct({ count: Schema.Number, label: Schema.String })
export const Unchecked = Schema.String.pipe(Schema.brand('ProbeUnchecked'))
export const EmptyCheck = Schema.String.check().pipe(Schema.brand('ProbeEmptyCheck'))
export type Bad = { raw: string; count: number; ready: boolean; value?: 'yes'; hidden: unknown; bypass: any }
export type PublicMoves =
  | { readonly read: Count; readonly line: 'Task'; readonly key: RoleKey; readonly move: 'next'; readonly input: {} }
  | { readonly read: Count; readonly line: 'Task'; readonly key: RoleKey; readonly move: 'next'; readonly input: { readonly attempt: Count } }
  | { readonly read: Count; readonly line: 'Question'; readonly key: RoleKey; readonly move: 'answer'; readonly input: { readonly answer: 'Yes' } }
export type OverlappingMoves =
  | { readonly read: Count; readonly line: 'Task'; readonly key: RoleKey; readonly move: 'next'; readonly input: { readonly attempt: Count } }
  | { readonly read: Count; readonly line: 'Task'; readonly key: RoleKey; readonly move: 'next'; readonly input: { readonly attempt: Count; readonly reason: 'Done' } }
export type NestedTag = { expects: { _tag: 'ShortAnswer' }; answer: 'Done' }
  | { expects: { _tag: 'OneChoice' }; answer: Count }
export type RepeatedNestedTag = { expects: { _tag: 'ShortAnswer' }; answer: 'Done' }
  | { expects: { _tag: 'ShortAnswer' }; answer: Count }
export type Untagged = { a: 'a' } | { b: 'b' }
export type BrokenTemplate = \`role:\${string}\`
export type Conditional<T> = T extends 'a' ? string : 'b'
export type Unbounded<T extends string = string> = ReadonlyArray<T>
export class RawService extends Context.Service<RawService, { read(): Effect.Effect<string> }>()('probe/RawService') {}
export const castKey = (input: string) => input as RoleKey
`,
  [LEGACY]: "export type Legacy = { name: string }",
  'core/schema/project.ts': "export { Notice, RoleKey, Count } from '../../src/domain/project/architecture-record.ts'",
  [MOVES]: `
import type { Task } from '../../src/domain/project/architecture-record.ts'
export const move = (task: Task): Task => ({ ...task, phase: { _tag: 'Done' } })
`,
  [BROWSER]: `
import type { Legacy } from '../../../src/domain/architecture-legacy.ts'
import type { Task } from '../../../src/domain/project/architecture-record.ts'
import { Schema } from 'effect'
import { Notice as SharedNotice, RoleKey, Count } from '../../../core/schema/project.ts'
export { SharedNotice }
export type { Legacy as ReExportedLegacy }
export const Notice = Schema.TaggedStruct('Notice', { key: Schema.String, count: Count })
export type RenamedCopy = { readonly _tag: 'Notice'; readonly key: RoleKey; readonly count: Count }
export type Projection = { readonly count: Count }
export type ThroughAlias = { readonly legacy: Legacy }
export type BrowserPrimitive = { label: string }
export const inferredRawView = () => ({ label: 'widened', count: 3 })
export const inferredCheckedView = (count: Count) => ({ count })
export const renderCount = (count: Count): string => String(count)
export const edits = (task: Task, raw: unknown) => {
  task['phase'] = { _tag: 'Done' }
  Object.assign(task, { phase: { _tag: 'Sent' } })
  const copy: Task = { ...task, phase: { _tag: 'Done' } }
  return [copy, raw as Task]
}
`,
} as const

let graph: ReturnType<typeof programs>
let findings: ReturnType<typeof scan>
beforeAll(() => {
  graph = programs(ROOT, sources)
  const include = (file: string) => Object.hasOwn(sources, file)
  findings = [graph.engine, graph.browser].flatMap((program) => scan(program, ROOT, include, include))
}, 30_000)

const rules = (file: string, declaration: string): string[] =>
  [...new Set(findings.filter((row) => row.file === file && row.declaration === declaration).map((row) => row.rule))].sort()

test('checked brands, templates, tagged phases and map keys are admitted', () => {
  for (const name of ['RoleKey', 'Count', 'Notice', 'Good', 'Assignment', 'decodeCount', 'NestedTag'])
    expect({ declaration: name, rules: rules(DOMAIN, name) }).toEqual({ declaration: name, rules: [] })
  for (const name of ['Projection', 'inferredCheckedView', 'renderCount'])
    expect(rules(BROWSER, name)).toEqual([])
})

test('public submissions are identified by their line, move and disjoint input', () => {
  expect(rules(DOMAIN, 'PublicMoves')).toEqual([])
  expect(rules(DOMAIN, 'OverlappingMoves')).toEqual(['untagged-union'])
})

test('both compiler graphs expose raw, inferred, wrapped and unsafe values', () => {
  expect(rules(DOMAIN, 'Bad')).toEqual(['any', 'bare-boolean', 'bare-number', 'bare-string', 'optional', 'unknown'])
  expect(rules(DOMAIN, 'Loose')).toEqual(['bare-number', 'bare-string'])
  expect(rules(DOMAIN, 'Untagged')).toContain('untagged-union')
  expect(rules(DOMAIN, 'RepeatedNestedTag')).toEqual(['untagged-union'])
  expect(rules(DOMAIN, 'Unbounded')).toContain('bare-string')
  expect(rules(DOMAIN, 'Conditional')).toContain('bare-string')
  expect(rules(DOMAIN, 'BrokenTemplate')).toContain('unbounded-template')
  expect(rules(DOMAIN, 'Unchecked')).toContain('unrefined-brand')
  expect(rules(DOMAIN, 'EmptyCheck')).toContain('unrefined-brand')
  expect(rules(DOMAIN, 'RawService')).toContain('bare-string')
  expect(rules(DOMAIN, 'EmbeddedKey')).toContain('record-key-reference')
  expect(rules(DOMAIN, 'castKey')).toContain('brand-cast')
  expect(rules(BROWSER, 'BrowserPrimitive')).toEqual(['bare-string'])
  expect(rules(BROWSER, 'inferredRawView')).toEqual(['bare-number', 'bare-string'])
  expect(rules(BROWSER, 'ThroughAlias')).toContain('unchecked-contract')
  expect(rules(BROWSER, 'ReExportedLegacy')).toContain('unchecked-contract')
})

test('a canonical wire re-export and a smaller view pass, while a second schema or DTO fails', () => {
  const violations = sharedWireViolations(graph, ROOT)
  expect(violations).toEqual([
    `${BROWSER}: Notice must reuse the domain declaration`,
    `${BROWSER}: RenamedCopy duplicates Notice's domain schema`,
  ])
})

test('a phase mutation is rejected in the browser and admitted at its transition owner', () => {
  const page = graph.browser.getSourceFile(resolve(ROOT, BROWSER))!
  const moves = graph.engine.getSourceFile(resolve(ROOT, MOVES))!
  expect(phaseWriteViolations(graph.browser, ROOT, page)).toHaveLength(3)
  expect(phaseWriteViolations(graph.engine, ROOT, moves)).toEqual([])
  expect(findings.some(({ file, rule }) => file === BROWSER && rule === 'domain-cast')).toBe(true)
})

test('a measured allowance cannot grow, move with an alias, or survive a removed finding', () => {
  const legacy = findings.find((row) => row.file === LEGACY)!
  const added = findings.find((row) => row.file === BROWSER && row.declaration === 'ThroughAlias')!
  const ceiling = [findingDigest(legacy)]
  expect(compareBaseline([legacy, added], [legacy], ceiling).newFindings.map(keyOf)).toEqual([keyOf(added)])
  expect(compareBaseline([legacy, added], [legacy, added], ceiling).outsideCeiling).toEqual([added])
  const changed = { ...legacy, source: added.source }
  expect(compareBaseline([changed], [legacy], ceiling).newFindings).toEqual([changed])
  expect(compareBaseline([], [legacy], ceiling).staleBaseline).toEqual([legacy])
  expect(compareBaseline([legacy], [legacy, legacy], ceiling).duplicateEntries).toBe(1)
  expect(compareBaseline([], [], ceiling)).toEqual({
    newFindings: [], outsideCeiling: [], staleBaseline: [], duplicateEntries: 0,
  })
})

test('normalized source sites ignore layout and comments and distinguish changed declarations', () => {
  const fingerprint = (source: string): string => {
    const file = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)
    return sourceKey(file.statements[0]!, file)
  }
  const original = fingerprint('export type Words = { text: string }')
  expect(fingerprint('// old note\nexport type Words={ text : /* explanation */ string }')).toBe(original)
  expect(fingerprint('export type Words = { text: string; other: string }')).not.toBe(original)
})
