// Invariant 4.1 (plan/rebuild/BUILD.md): the layer rule of the new tree, the two doors to src/, the
// state fields that only core/derived and core/state may read, the lists that only waitingFor may
// make, and a probe for each rule (a fixture that breaks it must be flagged).
import { beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import ts from 'typescript'

const ROOT = join(import.meta.dir, '..')

// --- the files of the new tree -------------------------------------------------------------------

// Tests and probes are not part of the tree, and the page app has its own tsconfig.
const isTree = (name: string): boolean =>
  name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.probe.ts')

const treeFiles = (dir: string): ReadonlyArray<string> =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const path = posix.join(dir, e.name)
    if (e.isDirectory()) return e.name === 'app' || e.name === 'node_modules' ? [] : treeFiles(path)
    return isTree(e.name) ? [path] : []
  })

// Repo-relative, with `/`.
const FILES = [...treeFiles('core'), ...treeFiles('adapters')]

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

// Each module specifier of a file: import, export from, import(), require().
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

// One line per import that breaks the layer rule or a door: `file:line: why`.
const importViolations = (rel: string, text: string): ReadonlyArray<string> => {
  const owner = layerOf(rel)
  if (owner === null) return [`${rel}: is in no layer of the new tree`]
  return specifiersOf(parse(rel, text)).flatMap(({ spec, line }) => {
    if (!spec.startsWith('.')) return []
    const target = posix.normalize(posix.join(posix.dirname(rel), spec)).replace(/\.(ts|js)$/, '')
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
const STATE_FIELDS = ['end', 'opened', 'status', 'fixed', 'revoked', 'claim', 'untouched', 'state']
// The records of the Work that own a state field, by the declaration that holds the field. A view
// (ProjectSummary.state) or a derived value (SourceSeen.state) is a state already: allowed.
const RECORDS = [
  'Task',
  'Assignment',
  'AssignmentBase',
  'Maker',
  'Reviewer',
  'Run',
  'RunBase',
  'HostRun',
  'TaskDraft',
  'Problem',
  'Question',
  'Permission',
  'Meta',
  'Forward',
  'Send',
]
// The helpers of the domain that work out a state again: core/derived owns those states. (switch
// 2026-11-14: the others went with the old engine, so the probe uses topOfRun, not madeBy.)
const STATE_HELPERS = ['topOfRun', 'problemTaskOf']
// The lists of the Work that only waitingFor turns into items for the person (invariant 3).
const PERSON_LISTS = ['problems', 'forwards', 'questions', 'drafts']
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

// (c): a read of a state field of a record, or a use of a helper that works a state out again.
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
    if (ts.isIdentifier(node) && STATE_HELPERS.includes(node.text))
      flag(node, `uses ${node.text}: core/derived owns that state`)
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
        found.push(`${rel}:${lineOf(file, node)}: lists work.${node.name.text}: use waitingFor`)
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
import type { Assignment, Meta, Permission, Question, Task } from '../../src/domain/model.ts'
import type { Problem, Run, Send, TaskDraft } from '../../src/domain/ui-model.ts'
import type { Forward } from '../../src/domain/work.ts'
import { topOfRun } from '../../src/domain/derived.ts'
export const reads = (
  task: Task, a: Assignment, q: Question, p: Problem, d: TaskDraft, s: Send, f: Forward,
  perm: Permission, m: Meta, r: Run,
) => [
  task.end._tag, a.end._tag, q.status, p.fixed._tag, d.opened, s.state, f, perm.revoked, m.claim,
  r.end, task.untouched, task['end'],
]
export const destructures = (task: Task) => { const { end } = task; return end }
export const helper = topOfRun
`,
  'core/actions/probe-allowed.ts': `
import type { Task } from '../../src/domain/model.ts'
import type { ProjectSummary } from '../../src/domain/ui-model.ts'
interface SourceSeen { readonly state: string }
export const fine = (t: Task, view: ProjectSummary, seen: SourceSeen) =>
  [t.id, t.name, view.state, seen.state]
`,
  'adapters/cli/probe-lists.ts': `
import type { Work } from '../../src/domain/work.ts'
export const lists = (work: Work) => [
  ...work.problems.values(), ...work.questions, work.forwards.size, work.drafts.get('x' as never),
]
`,
}
const READS = 'core/actions/probe-reads.ts'
const ALLOWED = 'core/actions/probe-allowed.ts'
const LISTS = 'adapters/cli/probe-lists.ts'

const abs = (rel: string): string => join(ROOT, rel)

const buildProgram = (): ts.Program => {
  const config = ts.readConfigFile(abs('tsconfig.json'), ts.sys.readFile)
  const options = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT).options
  const virtual = new Map(Object.entries(PROBES).map(([rel, text]) => [abs(rel), text]))
  const host = ts.createCompilerHost(options)
  const { getSourceFile, fileExists, readFile } = host
  host.getSourceFile = (name, ...rest) => {
    const text = virtual.get(name)
    return text === undefined ? getSourceFile.call(host, name, ...rest) : parse(name, text)
  }
  host.fileExists = (name) => virtual.has(name) || fileExists.call(host, name)
  host.readFile = (name) => virtual.get(name) ?? readFile.call(host, name)
  const roots = [...FILES.map(abs), ...virtual.keys()]
  return ts.createProgram({ rootNames: roots, options, host })
}

let program: ts.Program
let checker: ts.TypeChecker
beforeAll(() => {
  program = buildProgram()
  checker = program.getTypeChecker()
}, 120_000)

const sourceOf = (rel: string): ts.SourceFile => {
  const file = program.getSourceFile(abs(rel))
  if (file === undefined) throw new Error(`the program has no ${rel}`)
  return file
}

// --- the tests -----------------------------------------------------------------------------------

describe('the tree', () => {
  test('it has files, and every file is in a layer', () => {
    expect(FILES.length).toBeGreaterThan(20)
    expect(FILES.filter((f) => layerOf(f) === null)).toEqual([])
  })
})

describe('(a) the layer rule', () => {
  test('each layer imports only the layers to its left', () => {
    const found = FILES.flatMap((f) =>
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
    const found = FILES.flatMap((f) =>
      importViolations(f, readFileSync(abs(f), 'utf8')).filter((v) => v.includes('src/')),
    )
    expect(found).toEqual([])
  })

  test('a fixture that imports src/ outside the doors is flagged', () => {
    const at = (rel: string, text: string) => importViolations(rel, text)
    expect(at('core/derived/p.ts', `import { x } from '../../src/domain/ids.ts'`)).toHaveLength(1)
    expect(at('adapters/web/p.ts', `import { x } from '../../src/domain/ids.ts'`)).toHaveLength(1)
    expect(at('core/schema/p.ts', `import { x } from '../../src/domain/ids.ts'`)).toEqual([])
    expect(at('core/services/p.ts', `import { x } from '../../src/store/sqlite.ts'`)).toEqual([])
  })

  test('the door of core/schema does not export what the new tree replaces', () => {
    const door = sourceOf('core/schema/index.ts')
    const symbol = checker.getSymbolAtLocation(door)
    if (symbol === undefined) throw new Error('core/schema/index.ts is not a module')
    const names = checker.getExportsOfModule(symbol).map((s) => s.name)
    // The stored ForwardState and SendState stay the facts; core/derived has the states.
    const forbidden = [...STATE_HELPERS, 'ForwardState', 'SendState']
    expect(names.filter((n) => forbidden.includes(n))).toEqual([])
    expect(names.length).toBeGreaterThan(50)
  })
})

describe('(c) no read of a state field outside core/derived and core/state', () => {
  const owners = ['core/derived/', 'core/state/']
  const outside = FILES.filter((f) => !owners.some((o) => f.startsWith(o)))

  test('no file reads the state of a record, or uses a helper that works a state out', () => {
    const found = outside.flatMap((f) => stateReadViolations(checker, sourceOf(f), f))
    expect(found).toEqual([])
  })

  test('the fixture reads of each state field are flagged', () => {
    const found = stateReadViolations(checker, sourceOf(READS), READS)
    for (const field of STATE_FIELDS)
      expect(found.some((v) => v.includes(`reads .${field} of a record`))).toBe(true)
    expect(found.some((v) => v.includes("['end']"))).toBe(true)
    expect(found.some((v) => v.includes('destructures end'))).toBe(true)
    expect(found.some((v) => v.includes('uses topOfRun'))).toBe(true)
  })

  test('a field of a view or of a derived value is not flagged', () => {
    expect(stateReadViolations(checker, sourceOf(ALLOWED), ALLOWED)).toEqual([])
  })

  test('each helper that works a state out is flagged by name', () => {
    for (const name of STATE_HELPERS) {
      const text = `export const x = ${name}(1)`
      const file = parse('core/actions/p.ts', text)
      expect(stateReadViolations(checker, file, 'core/actions/p.ts')).toHaveLength(1)
    }
  })
})

describe('(d) no adapter lists the Work for the person', () => {
  const adapters = FILES.filter((f) => f.startsWith('adapters/'))

  test('no adapter iterates problems, forwards, questions or drafts', () => {
    const found = adapters.flatMap((f) => personListViolations(checker, sourceOf(f), f))
    expect(found).toEqual([])
  })

  test('a fixture that iterates, spreads or reads a size is flagged; a lookup is not', () => {
    const found = personListViolations(checker, sourceOf(LISTS), LISTS)
    expect(found.map((v) => v.split(': ').slice(1).join(': '))).toEqual([
      'lists work.problems: use waitingFor',
      'lists work.questions: use waitingFor',
    ])
  })
})

describe('(e) the probe is real', () => {
  test('the fixtures are outside the real tree', () => {
    for (const rel of Object.keys(PROBES)) expect(FILES).not.toContain(rel)
    for (const rel of Object.keys(PROBES)) expect(existsSync(abs(rel))).toBe(false)
  })

})
