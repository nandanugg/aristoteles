import { beforeAll, describe, expect, test } from 'bun:test'
import { join, posix } from 'node:path'
import ts from 'typescript'
import { browserFile, production, programs, projectPath, type ProjectPrograms } from '../src/domain/architecture-projects.probe.ts'
import { phaseWriteViolations, sharedWireViolations } from '../src/domain/architecture-contracts.probe.ts'

const ROOT = join(import.meta.dir, '..')

// Both production graphs, with independent TypeScript options.
let graphs: ProjectPrograms
let files: readonly string[]

const parse = (rel: string, text: string): ts.SourceFile =>
  ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true)

const CORE_RANK = { schema: 0, services: 1, state: 2, derived: 3, actions: 4, effects: 5 } as const
type CoreLayer = keyof typeof CORE_RANK
const ADAPTERS = ['live', 'words', 'cli', 'web'] as const
type AdapterLayer = (typeof ADAPTERS)[number]
// What an adapter layer may import among the adapters (every adapter imports core).
const ADAPTER_MAY: Readonly<Record<AdapterLayer, ReadonlyArray<AdapterLayer>>> = {
  live: ['live'],
  words: ['live', 'words'],
  cli: ['live', 'words', 'cli'],
  web: ['live', 'words', 'web'],
}
// Only these two layers import src/ (D3).
const SRC_DOORS: ReadonlyArray<string> = ['core/schema', 'core/services']

type Layer = { readonly tree: 'core'; readonly name: CoreLayer } | {
  readonly tree: 'adapters'
  readonly name: AdapterLayer
}

const layerOf = (rel: string): Layer | null => {
  const [tree, name] = rel.split('/')
  if (tree === 'core' && name !== undefined && name in CORE_RANK)
    return { tree, name: name as CoreLayer }
  if (tree === 'adapters' && (ADAPTERS as ReadonlyArray<string | undefined>).includes(name))
    return { tree, name: name as AdapterLayer }
  return null
}

// Each module specifier of a file, including inline import types and dynamic loads.
const specifiersOf = (file: ts.SourceFile): ReadonlyArray<{ spec: string; line: number }> => {
  const found: Array<{ spec: string; line: number }> = []
  const add = (node: ts.Node, text: string): void => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    found.push({ spec: text, line })
  }
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      add(node, node.moduleSpecifier.text)
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    )
      add(node, node.moduleReference.expression.text)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)) add(node, node.argument.literal.text)
    if (ts.isCallExpression(node)) {
      const [arg] = node.arguments
      const isLoad =
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      if (isLoad && arg !== undefined && ts.isStringLiteralLike(arg)) add(node, arg.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

const browserImportViolations = (file: ts.SourceFile, rel: string): string[] =>
  specifiersOf(file).flatMap(({ spec, line }) => {
    const target = posix.normalize(posix.join(posix.dirname(rel), spec)).replace(/\.[jt]sx?$/, '')
    const serverModule =
      /^core\/(actions|effects|services)\//.test(target) ||
      /^adapters\/web\/(?!app\/)/.test(target)
    if (spec.startsWith('node:') || spec.startsWith('bun:') || serverModule)
      return [`${rel}:${line}: browser imports runtime ${spec}`]
    return []
  })

// One line per import that breaks the layer rule or a door: `file:line: why`.
const importViolations = (rel: string, text: string): ReadonlyArray<string> => {
  const owner = layerOf(rel)
  if (owner === null) return [`${rel}: is in no layer of the new tree`]
  return specifiersOf(parse(rel, text)).flatMap(({ spec, line }) => {
    if (!spec.startsWith('.')) return []
    const target = posix.normalize(posix.join(posix.dirname(rel), spec)).replace(/\.[jt]sx?$/, '')
    const at = `${rel}:${line}: imports ${spec}`
    if (target === 'src' || target.startsWith('src/')) {
      if (!SRC_DOORS.includes(`${owner.tree}/${owner.name}`))
        return [`${at}, src/ (only core/schema and core/services import it)`]
      return []
    }
    const to = layerOf(target)
    if (to === null) return []
    if (owner.tree === 'core')
      return to.tree === 'adapters'
        ? [`${at}, an adapter (core never imports an adapter)`]
        : CORE_RANK[to.name] > CORE_RANK[owner.name]
          ? [`${at}, which is to its right (${to.name} is right of ${owner.name})`]
          : []
    if (to.tree === 'core') return []
    return ADAPTER_MAY[owner.name].includes(to.name)
      ? []
      : [`${at}, which an adapter ${owner.name} may not import (${to.name})`]
  })
}


beforeAll(() => {
  graphs = programs(ROOT)
  files = [...new Set([graphs.engine, graphs.browser].flatMap((program) =>
    program.getSourceFiles().map((file) => projectPath(ROOT, file.fileName))))]
    .filter((file) => production(file) && /^(core|adapters)\//.test(file))
}, 120_000)

const sourceOf = (rel: string): ts.SourceFile => {
  const file = (browserFile(rel) ? graphs.browser : graphs.engine).getSourceFile(join(ROOT, rel))
  if (!file) throw new Error(`Missing source: ${rel}`)
  return file
}

describe('the import layers', () => {
  test('the project tree follows the layer and src door rules', () => {
    expect(files).toContain('core/schema/project.ts')
    expect(files).toContain('adapters/web/app/project-main.ts')
    expect(files.flatMap((file) => importViolations(file, sourceOf(file).text))).toEqual([])
  })

  test('a forbidden import is flagged, including dynamic loads and inline types', () => {
    const state = (text: string) => importViolations('core/state/probe.ts', text)
    expect(state(`import { x } from '../derived/project/review.ts'`)).toHaveLength(1)
    expect(state(`export * from '../effects/project-commands.ts'`)).toHaveLength(1)
    expect(state(`const m = await import('../actions/project.ts')`)).toHaveLength(1)
    expect(state(`import { x } from '../../adapters/live/project-runs.ts'`)).toHaveLength(1)
    expect(state(`type T = import('../../src/domain/project/values.ts').Of`)).toHaveLength(1)
    expect(state(`import { x } from '../schema/project.ts'`)).toEqual([])
  })
})

describe('the shared project boundary', () => {
  test('the browser is checked without the server runtime', () => {
    expect(graphs.browser.getCompilerOptions().types).toEqual([])
    const browser = graphs.browser.getSourceFiles().filter((file) => production(projectPath(ROOT, file.fileName)))
    expect(browser.some((file) => browserFile(projectPath(ROOT, file.fileName)))).toBe(true)
    expect(browser.flatMap((file) => browserImportViolations(file, projectPath(ROOT, file.fileName)))).toEqual([])
  })

  test('the browser rules flag runtime imports and bypasses of the schema door', () => {
    const page = 'adapters/web/app/probe.ts'
    expect(importViolations(page, "import { x } from '../../../src/domain/project/values.ts'")).toHaveLength(1)
    for (const spec of ['bun:sqlite', 'node:fs', '../../../core/actions/project.ts', '../project-server.ts'])
      expect(browserImportViolations(parse(page, `import { x } from '${spec}'`), page)).toHaveLength(1)
  })

  test('engine and page use the shared wire declarations', () => {
    expect(sharedWireViolations(graphs, ROOT)).toEqual([])
  })

  test('only the transitions construct or change project phases', () => {
    const found = [graphs.engine, graphs.browser].flatMap((graph) => graph.getSourceFiles()
      .filter((file) => production(projectPath(ROOT, file.fileName)))
      .flatMap((file) => phaseWriteViolations(graph, ROOT, file)))
    expect([...new Set(found)]).toEqual([])
  })
})
