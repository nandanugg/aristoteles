// The moves are the one way to change the state of a record (REVIEW-3 3.10): outside
// src/domain/moves.ts, no code writes a state field of a record, as a literal state or as a copy
// of a record with a new state. A step that narrows a record writes the same state back (end:
// run.end), and only that passes. Tests and probes build records in any state: not read.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { production, programs, projectPath } from './architecture-projects.probe.ts'
import { ceilingDigest, compareBaseline, keyOf, scan, type Finding } from './architecture-scan.probe.ts'
import baseline from './domain-primitive-baseline.json' with { type: 'json' }
import activationRemoval from './architecture-activation-removal.json' with { type: 'json' }
import ceiling from './domain-primitive-baseline-u0.json' with { type: 'json' }

const SRC = join(import.meta.dir, '..')
// The state field of each record with a lifecycle (model.ts, ui-model.ts, work.ts).
const STATE_FIELDS = ['end', 'status', 'revoked', 'fixed', 'state', 'opened', 'untouched', 'claim']

const ROOT = resolve(SRC, '..')
let graph: ReturnType<typeof programs> | undefined
const project = () => graph ??= programs(ROOT)

// Each write of a state field in a file: a literal state, or a new state in a copy of a record.
const writesOf = (path: string): ReadonlyArray<string> => {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const found: Array<string> = []
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const copy = node.properties.some(ts.isSpreadAssignment)
      for (const p of node.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue
        const field = p.name.text
        if (!STATE_FIELDS.includes(field)) continue
        const value = p.initializer
        const literal =
          ts.isObjectLiteralExpression(value) &&
          value.properties.some((x) => x.name !== undefined && x.name.getText(file) === '_tag')
        const sameBack = ts.isPropertyAccessExpression(value) && value.name.text === field
        if (literal || (copy && !sameBack)) {
          const { line } = file.getLineAndCharacterOfPosition(p.getStart(file))
          found.push(`${relative(SRC, path)}:${line + 1} ${field}`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

describe('the moves of the records', () => {
  test('outside moves.ts, no code writes a state of a record', () => {
    const files = new Set([project().engine, project().browser].flatMap((program) =>
      program.getSourceFiles().map((file) => projectPath(ROOT, file.fileName))))
    const oldRecords = [...files].filter((file) => file.startsWith('src/') && production(file) &&
      file !== 'src/domain/moves.ts' && !file.startsWith('src/domain/project/'))
    expect(oldRecords.flatMap((file) => writesOf(join(ROOT, file)))).toEqual([])
  })

  test('the check finds a literal state, and a copy with a new state', () => {
    const probe = join(import.meta.dir, 'moves.ts')
    expect(writesOf(probe).length).toBeGreaterThan(2)
  })
})

// Removing legacy activation changed the declaration hashes of the surviving contracts.
// Match each exact removal to its original source before checking the frozen identity.
const activationRemovalSources = new Map(activationRemoval.map(([file, declaration, after, before]) =>
  [JSON.stringify([file, declaration, after]), before] as const))
const originalActivationSite = (finding: Finding): Finding => {
  const { file, declaration, source, path } = finding
  const original = activationRemovalSources.get(JSON.stringify([file, declaration, source]))
  if (file === 'src/domain/events.ts') {
    if (declaration === 'WorkflowMove' && original !== undefined)
      return { ...finding, source: original, path: path.replace(/^\$\./, '$<RoleWordsChanged>.') }
    // The last remaining case of the former union no longer gets a variant hop.
    if (declaration === 'encodeEvent' && source === '35b59f41dade7aa83f4ea11919f4cf028fb6707f9d1039624bbe79c4237c5ab6')
      return { ...finding, path: path.replace(/^\$\(\)<Workflow>\.move\./, '$()<Workflow>.move<RoleWordsChanged>.') }
  }
  return original === undefined ? finding : { ...finding, source: original }
}

describe('the domain and wire type boundary', () => {
  test('the U0 ceiling is frozen and contains unique finding identities', () => {
    expect(ceilingDigest(ceiling)).toBe('2fd1dc44c5534fb5a320e05069382e7a06e5891772651a060676deb2cd00eee5')
    expect(new Set(ceiling).size).toBe(ceiling.length)
  })

  test('both graphs match the shrinking baseline exactly', () => {
    const measured = new Map([project().engine, project().browser]
      .flatMap((program) => scan(program, ROOT))
      .map((finding) => [keyOf(finding), finding]))
    const normalized = [...measured.values()].map(originalActivationSite)
    expect(new Set(normalized.map(keyOf)).size).toBe(measured.size)
    expect(compareBaseline(normalized, baseline, ceiling)).toEqual({
      newFindings: [], staleBaseline: [], outsideCeiling: [], duplicateEntries: 0,
    })
  }, 30_000)
})
