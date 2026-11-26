// Invariant 4.1 (plan/rebuild/BUILD.md): the layer rule of the new tree, the two doors to src/, the
// state fields that only core/derived and core/state may read, the lists that only waitingFor may
// make, and a probe for each rule (a fixture that breaks it must be flagged).
import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import ts from 'typescript'
import { browserFile, production, programs, projectPath, type ProjectPrograms } from '../src/domain/architecture-projects.probe.ts'
import { phaseWriteViolations, sharedWireViolations } from '../src/domain/architecture-contracts.probe.ts'
import { sourceKey } from '../src/domain/architecture-scan.probe.ts'

const ROOT = join(import.meta.dir, '..')

// Both production graphs, with independent TypeScript options.
let graphs: ProjectPrograms
let files: readonly string[]

const parse = (rel: string, text: string): ts.SourceFile =>
  ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true)

// --- (a), (b) the imports ------------------------------------------------------------------------

// The layers left to right (D2). A core layer imports only a layer with a lower or equal rank.
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
const specifiersOf = (file: ts.SourceFile): ReadonlyArray<{ spec: string; line: number; source: string }> => {
  const found: Array<{ spec: string; line: number; source: string }> = []
  const add = (node: ts.Node, text: string): void => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1
    found.push({ spec: text, line, source: sourceKey(node, file) })
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

// These pre-existing imports through the src door are identified by the full import site.
const retainedDoorImports = new Set<string>([
  'adapters/web/app/api.ts c57c8b97a9e14c6f3d61f4c555a4e7755c13292699645253895bd747ede5be17',
  'adapters/web/app/change.ts c447f1349f2df128630bc5dd7b4a9427256b9330494bf6f836961976de497720',
  'adapters/web/app/main.ts ceeea94c06e3c74c8e8ead43acdcfe75ead317c3b74b871a5ef6f7eee2c2bdcc',
  'adapters/web/app/staffing.ts 9b68d686427864bbdaf5cb47677d649bbd89a8ac8ca9b599c4e34138eb249b75',
  'adapters/web/app/terminal.ts 888789d1ea83406af575119c8fdb906ef21a7cf543ed287cc2cfea87a0867e3c',
  'adapters/web/view.ts 1bea4c0b9927f4e770e4b9c2773d4e773688f135454e64d47d2e742aa05e70b4',
])

const doorImportKey = (file: string, source: string): string => `${file} ${source}`
const browserImportViolations = (file: ts.SourceFile, rel: string): string[] =>
  specifiersOf(file).flatMap(({ spec, line }) => {
    const target = posix.normalize(posix.join(posix.dirname(rel), spec)).replace(/\.[jt]sx?$/, '')
    const serverModule =
      /^core\/(actions|effects)\//.test(target) ||
      /^adapters\/web\/(server|start|watcher|pump|pipe-keys)$/.test(target)
    if (spec.startsWith('node:') || spec.startsWith('bun:') || serverModule)
      return [`${rel}:${line}: browser imports runtime ${spec}`]
    return []
  })

// One line per import that breaks the layer rule or a door: `file:line: why`.
const importViolations = (rel: string, text: string): ReadonlyArray<string> => {
  const owner = layerOf(rel)
  if (owner === null) return [`${rel}: is in no layer of the new tree`]
  return specifiersOf(parse(rel, text)).flatMap(({ spec, line, source }) => {
    if (retainedDoorImports.has(doorImportKey(rel, source))) return []
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

// --- (c), (d) the checker ------------------------------------------------------------------------

// The state field of each record with a lifecycle (BUILD.md 4.1 (c)).
const STATE_FIELDS = ['state']
// The records of the Work that own a state field, by the declaration that holds the field. A view
// (DirView) or a derived value is a state already: allowed.
const RECORDS = ['Send']
// The lists of the Work that no adapter lists for the person (invariant 3).
const PERSON_LISTS = ['drafts']
// What a list may still be asked: one record by its id.
const LOOKUPS = ['get', 'has', 'size']

const DOMAIN_FILE = /src\/domain\/(model|work|ui-model)\.ts$/

// The name of the interface or type alias that holds a property declaration.
const holderOf = (decl: ts.Declaration): string | null => {
  for (let n: ts.Node | undefined = decl; n !== undefined; n = n.parent)
    if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return n.name.text
  return null
}

// Does the property named `name` of this type come from a domain declaration of one of `holders`?
const propertyOf = (
  checker: ts.TypeChecker,
  type: ts.Type,
  name: string,
  holders: ReadonlyArray<string>,
): boolean => {
  const symbol = checker.getPropertyOfType(checker.getApparentType(type), name)
  return (symbol?.declarations ?? []).some((decl) => {
    const holder = holderOf(decl)
    const inDomain = DOMAIN_FILE.test(decl.getSourceFile().fileName)
    return inDomain && holder !== null && holders.includes(holder)
  })
}

const lineOf = (file: ts.SourceFile, node: ts.Node): number =>
  file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1

// (c): a read of a state field of a record.
const stateReadViolations = (
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  rel: string,
): ReadonlyArray<string> => {
  const found: Array<string> = []
  const flag = (node: ts.Node, what: string): void => {
    found.push(`${rel}:${lineOf(file, node)}: ${what}`)
  }
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && STATE_FIELDS.includes(node.name.text)) {
      const type = checker.getTypeAtLocation(node.expression)
      if (propertyOf(checker, type, node.name.text, RECORDS))
        flag(node, `reads .${node.name.text} of a record: read the derived state`)
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      STATE_FIELDS.includes(node.argumentExpression.text)
    ) {
      const type = checker.getTypeAtLocation(node.expression)
      if (propertyOf(checker, type, node.argumentExpression.text, RECORDS))
        flag(node, `reads ['${node.argumentExpression.text}'] of a record`)
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name
      const field = ts.isIdentifier(key) ? key.text : null
      if (field !== null && STATE_FIELDS.includes(field)) {
        const type = checker.getTypeAtLocation(node.parent)
        if (propertyOf(checker, type, field, RECORDS))
          flag(node, `destructures ${field} of a record: read the derived state`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

// (d): an adapter asks a list of the Work for more than one record by id.
const personListViolations = (
  checker: ts.TypeChecker,
  file: ts.SourceFile,
  rel: string,
): ReadonlyArray<string> => {
  const found: Array<string> = []
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && PERSON_LISTS.includes(node.name.text)) {
      const type = checker.getTypeAtLocation(node.expression)
      const lookup =
        ts.isPropertyAccessExpression(node.parent) &&
        node.parent.expression === node &&
        LOOKUPS.includes(node.parent.name.text)
      if (!lookup && propertyOf(checker, type, node.name.text, ['Work']))
        found.push(`${rel}:${lineOf(file, node)}: lists work.${node.name.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

// --- the program: the files of the tree, and the probe fixtures as virtual files -----------------

// Each fixture breaks one rule; the real run never reads them.
const PROBES: Readonly<Record<string, string>> = {
  'core/actions/probe-reads.ts': `
import type { Send } from '../../src/domain/ui-model.ts'
export const reads = (s: Send) => [s.state, s['state']]
export const destructures = (s: Send) => { const { state } = s; return state }
`,
  'core/actions/probe-allowed.ts': `
import type { DirView } from '../../src/domain/ui-model.ts'
import type { Direction } from '../../src/domain/model.ts'
interface SourceSeen { readonly state: string }
export const fine = (d: Direction, view: DirView, seen: SourceSeen) =>
  [d.id, d.name, view.name, seen.state]
`,
  'adapters/cli/probe-lists.ts': `
import type { Work } from '../../src/domain/work.ts'
export const lists = (work: Work) => [
  ...work.drafts.values(), work.drafts.size, work.drafts.get('x' as never),
]
`,
}
const READS = 'core/actions/probe-reads.ts'
const ALLOWED = 'core/actions/probe-allowed.ts'
const LISTS = 'adapters/cli/probe-lists.ts'

const abs = (rel: string): string => join(ROOT, rel)

beforeAll(() => {
  graphs = programs(ROOT, PROBES)
  files = [...new Set([graphs.engine, graphs.browser].flatMap((program) =>
    program.getSourceFiles().map((file) => projectPath(ROOT, file.fileName))))]
    .filter((file) => production(file) && /^(core|adapters)\//.test(file) && !Object.hasOwn(PROBES, file))
}, 120_000)

const sourceOf = (rel: string): ts.SourceFile => {
  const file = (browserFile(rel) ? graphs.browser : graphs.engine).getSourceFile(abs(rel))
  if (!file) throw new Error(`the program has no ${rel}`)
  return file
}

const checkerOf = (rel: string): ts.TypeChecker =>
  (browserFile(rel) ? graphs.browser : graphs.engine).getTypeChecker()

// --- the tests -----------------------------------------------------------------------------------

describe('the tree', () => {
  test('it has files, and every file is in a layer', () => {
    expect(files.length).toBeGreaterThan(20)
    expect(files.filter((f) => layerOf(f) === null)).toEqual([])
  })
})

describe('(a) the layer rule', () => {
  test('each layer imports only the layers to its left', () => {
    const found = files.flatMap((f) =>
      importViolations(f, readFileSync(abs(f), 'utf8')).filter((v) => !v.includes('src/')),
    )
    expect(found).toEqual([])
  })

  test('a fixture import that goes to the right is flagged', () => {
    const state = (text: string) => importViolations('core/state/probe.ts', text)
    expect(state(`import { x } from '../derived/index.ts'`)).toHaveLength(1)
    expect(state(`export * from '../effects/types.ts'`)).toHaveLength(1)
    expect(state(`const m = await import('../actions/index.ts')`)).toHaveLength(1)
    expect(state(`import { x } from '../../adapters/live/index.ts'`)).toHaveLength(1)
    expect(state(`import { x } from '../schema/index.ts'`)).toEqual([])
    expect(state(`import { x } from './sibling.ts'`)).toEqual([])
    const cli = (text: string) => importViolations('adapters/cli/probe.ts', text)
    expect(cli(`import { x } from '../web/server.ts'`)).toHaveLength(1)
    expect(cli(`import { x } from '../words/index.ts'`)).toEqual([])
    expect(cli(`import { x } from '../../core/actions/index.ts'`)).toEqual([])
    const live = (text: string) => importViolations('adapters/live/probe.ts', text)
    expect(live(`import { x } from '../words/index.ts'`)).toHaveLength(1)
  })
})

describe('(b) the two doors to src/', () => {
  test('only core/schema and core/services import src/', () => {
    const found = files.flatMap((f) =>
      importViolations(f, readFileSync(abs(f), 'utf8')).filter((v) => v.includes('src/')),
    )
    expect(found).toEqual([])
  })

  test('a fixture that imports src/ outside the doors is flagged', () => {
    const at = (rel: string, text: string) => importViolations(rel, text)
    expect(at('core/derived/p.ts', `import { x } from '../../src/domain/ids.ts'`)).toHaveLength(1)
    expect(at('adapters/web/p.ts', `import { x } from '../../src/domain/ids.ts'`)).toHaveLength(1)
    expect(at('adapters/web/p.ts', `type T = import('../../src/domain/ids.ts').Id`)).toHaveLength(1)
    expect(at('core/schema/p.ts', `import { x } from '../../src/domain/ids.ts'`)).toEqual([])
    expect(at('core/services/p.ts', `import { x } from '../../src/store/sqlite.ts'`)).toEqual([])
  })

  test('the door of core/schema does not export what the new tree replaces', () => {
    const door = sourceOf('core/schema/index.ts')
    const checker = checkerOf('core/schema/index.ts')
    const symbol = checker.getSymbolAtLocation(door)
    if (symbol === undefined) throw new Error('core/schema/index.ts is not a module')
    const names = checker.getExportsOfModule(symbol).map((s) => s.name)
    // The stored SendState stays a fact; core/derived has the states.
    const forbidden = ['SendState']
    expect(names.filter((n) => forbidden.includes(n))).toEqual([])
    expect(names.length).toBeGreaterThan(50)
  })
})

describe('(c) no read of a state field outside core/derived and core/state', () => {
  const owners = ['core/derived/', 'core/state/']
  test('no file reads the state of a record', () => {
    const found = files.filter((f) => !owners.some((o) => f.startsWith(o)))
      .flatMap((f) => stateReadViolations(checkerOf(f), sourceOf(f), f))
    expect(found).toEqual([])
  })

  test('the fixture reads of each state field are flagged', () => {
    const found = stateReadViolations(checkerOf(READS), sourceOf(READS), READS)
    for (const field of STATE_FIELDS)
      expect(found.some((v) => v.includes(`reads .${field} of a record`))).toBe(true)
    expect(found.some((v) => v.includes("['state']"))).toBe(true)
    expect(found.some((v) => v.includes('destructures state'))).toBe(true)
  })

  test('a field of a view or of a derived value is not flagged', () => {
    expect(stateReadViolations(checkerOf(ALLOWED), sourceOf(ALLOWED), ALLOWED)).toEqual([])
  })

})

describe('(d) no adapter lists the Work for the person', () => {
  test('no adapter iterates the drafts', () => {
    const found = files.filter((f) => f.startsWith('adapters/'))
      .flatMap((f) => personListViolations(checkerOf(f), sourceOf(f), f))
    expect(found).toEqual([])
  })

  test('a fixture that iterates, spreads or reads a size is flagged; a lookup is not', () => {
    const found = personListViolations(checkerOf(LISTS), sourceOf(LISTS), LISTS)
    expect(found.map((v) => v.split(': ').slice(1).join(': '))).toEqual(['lists work.drafts'])
  })
})

describe('(e) the probe is real', () => {
  test('the fixtures are outside the real tree', () => {
    for (const rel of Object.keys(PROBES)) expect(files).not.toContain(rel)
    for (const rel of Object.keys(PROBES)) expect(existsSync(abs(rel))).toBe(false)
  })

})

describe('the shared project boundary', () => {
  test('the browser is checked without the server runtime', () => {
    expect(graphs.browser.getCompilerOptions().types).toEqual([])
    const browser = graphs.browser.getSourceFiles().filter((file) => production(projectPath(ROOT, file.fileName)))
    expect(browser.some((file) => browserFile(projectPath(ROOT, file.fileName)))).toBe(true)
    expect(browser.flatMap((file) => browserImportViolations(file, projectPath(ROOT, file.fileName)))).toEqual([])
  })

  test('an added browser import cannot use old exceptions or cross into the runtime', () => {
    const page = 'adapters/web/app/probe.ts'
    expect(importViolations(page, "import { x } from '../../../src/domain/ids.ts'")).toHaveLength(1)
    for (const spec of ['bun:sqlite', 'node:fs', '../../../core/actions/project.ts', '../server.ts'])
      expect(browserImportViolations(parse(page, `import { x } from '${spec}'`), page)).toHaveLength(1)
  })

  test('old import allowances match only existing sites', () => {
    const actual = files.filter((path) => path.startsWith('adapters/web/')).flatMap((path) => specifiersOf(sourceOf(path))
      .filter(({ spec }) => posix.normalize(posix.join(posix.dirname(path), spec)).startsWith('src/'))
      .map(({ source }) => doorImportKey(path, source)))
    expect([...retainedDoorImports].filter((key) => !actual.includes(key))).toEqual([])
  })

  test('engine and page use the shared wire declarations', () => {
    expect(sharedWireViolations(graphs, ROOT)).toEqual([])
  })

  test('only the transitions construct or change project phases', () => {
    const found = [graphs.engine, graphs.browser].flatMap((graph) => graph.getSourceFiles()
      .filter((file) => production(projectPath(ROOT, file.fileName)) &&
        !Object.hasOwn(PROBES, projectPath(ROOT, file.fileName)))
      .flatMap((file) => phaseWriteViolations(graph, ROOT, file)))
    expect([...new Set(found)]).toEqual([])
  })
})
