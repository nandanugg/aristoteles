// The moves are the one way to change the state of a record (REVIEW-3 3.10): outside
// src/domain/moves.ts, no code writes a state field of a record, as a literal state or as a copy
// of a record with a new state. A step that narrows a record writes the same state back (end:
// run.end), and only that passes. Tests and probes build records in any state: not read.
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const SRC = join(import.meta.dir, '..')
// The state field of each record with a lifecycle (model.ts, ui-model.ts, work.ts).
const STATE_FIELDS = ['end', 'status', 'revoked', 'fixed', 'state', 'opened', 'untouched', 'claim']

const sources = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'app' ? [] : sources(path)
    const test = e.name.endsWith('.test.ts') || e.name.endsWith('.probe.ts')
    return e.name.endsWith('.ts') && !test ? [path] : []
  })

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
    const files = sources(SRC).filter((p) => relative(SRC, p) !== join('domain', 'moves.ts'))
    expect(files.flatMap(writesOf)).toEqual([])
  })

  test('the check finds a literal state, and a copy with a new state', () => {
    const probe = join(import.meta.dir, 'moves.ts')
    expect(writesOf(probe).length).toBeGreaterThan(10)
  })
})
