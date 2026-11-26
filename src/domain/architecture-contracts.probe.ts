import { resolve } from 'node:path'
import ts from 'typescript'
import { browserFile, canonical, exportsOf, production, projectPath, type ProjectPrograms } from './architecture-projects.probe.ts'

const isDomain = (file: string): boolean => file.startsWith('src/domain/project/') && production(file)
const isWire = (file: string): boolean =>
  browserFile(file) || file === 'adapters/web/contract.ts' || file === 'core/schema/project.ts'

const declaredAt = (root: string, symbol: ts.Symbol | undefined): string | undefined => {
  const node = symbol?.valueDeclaration ?? symbol?.declarations?.[0]
  return node && `${projectPath(root, node.getSourceFile().fileName)}:${node.getStart()}`
}

const decodedOf = (checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type | undefined => {
  const declaration = symbol.valueDeclaration
  if (!declaration) return
  const type = checker.getTypeOfSymbolAtLocation(symbol, declaration)
  const encoded = type.getProperty('Encoded')
  const decoded = type.getProperty('Type')
  if (decoded && encoded?.declarations?.some((node) => /\/effect\/(dist|src)\/Schema\./.test(node.getSourceFile().fileName)))
    return checker.getTypeOfSymbolAtLocation(decoded, declaration)
}

const wireTypeOf = (checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type | undefined => {
  const decoded = decodedOf(checker, symbol)
  if (decoded) return decoded
  if (symbol.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface))
    return checker.getDeclaredTypeOfSymbol(symbol)
}

export const sharedWireViolations = (graph: ProjectPrograms, root: string): string[] => {
  const found = new Set<string>()
  const shared = 'core/schema/project.ts'
  const engineDoor = graph.engine.getSourceFile(resolve(root, shared))
  const browserDoor = graph.browser.getSourceFile(resolve(root, shared))
  if (engineDoor && !browserDoor) found.add(`${shared}: the browser does not use the shared Project schema`)

  const resolved = (program: ts.Program, file: ts.SourceFile) => {
    const checker = program.getTypeChecker()
    return new Map(exportsOf(checker, file).map((symbol) =>
      [symbol.name, declaredAt(root, canonical(checker, symbol))]))
  }
  if (engineDoor && browserDoor) {
    const engine = resolved(graph.engine, engineDoor)
    const browser = resolved(graph.browser, browserDoor)
    for (const [name, location] of engine) {
      if (location !== browser.get(name)) found.add(`${shared}: ${name} resolves differently in the browser`)
    }
  }

  const checker = graph.browser.getTypeChecker()
  const domain = new Map<string, ts.Symbol>()
  for (const file of graph.browser.getSourceFiles().filter((s) => isDomain(projectPath(root, s.fileName)))) {
    for (const exposed of exportsOf(checker, file)) {
      const symbol = canonical(checker, exposed)
      if (symbol?.declarations?.some((d) => isDomain(projectPath(root, d.getSourceFile().fileName))))
        domain.set(exposed.name, symbol)
    }
  }
  const domainSymbols = new Set(domain.values())
  const wireShapes = [...domainSymbols].flatMap((symbol) => {
    const decoded = wireTypeOf(checker, symbol)
    // Small scalar and unit schemas can share a shape and represent different things.
    return decoded && (decoded.isUnion() || decoded.getProperties().length > 1) ? [{ symbol, decoded }] : []
  })
  for (const file of graph.browser.getSourceFiles()) {
    const path = projectPath(root, file.fileName)
    if (!isWire(path) || !production(path)) continue
    for (const exposed of exportsOf(checker, file)) {
      const symbol = canonical(checker, exposed)
      if (!symbol || domainSymbols.has(symbol)) continue
      const decoded = wireTypeOf(checker, symbol)
      if (!decoded) continue
      const original = domain.get(exposed.name)
      if (original) {
        found.add(`${path}: ${exposed.name} must reuse the domain declaration`)
      } else {
        for (const candidate of wireShapes) {
          if (checker.isTypeAssignableTo(candidate.decoded, decoded) &&
              checker.isTypeAssignableTo(decoded, candidate.decoded))
            found.add(`${path}: ${exposed.name} duplicates ${candidate.symbol.name}'s domain schema`)
        }
      }
    }
  }
  return [...found].sort()
}

const phases = new Set(['phase', 'state', 'status', 'activation'])
const phaseOwners = new Set(['core/state/project.ts', 'core/state/project-activation.ts', 'core/state/proposal.ts', 'src/domain/project/lines.ts'])
const projectIn = new WeakMap<ts.Program, boolean>()

export const phaseWriteViolations = (program: ts.Program, root: string, file: ts.SourceFile): string[] => {
  const path = projectPath(root, file.fileName)
  if (phaseOwners.has(path)) return []
  if (!projectIn.has(program)) {
    projectIn.set(program, program.getSourceFiles().some((source) => isDomain(projectPath(root, source.fileName))))
  }
  if (!projectIn.get(program)) return []

  const checker = program.getTypeChecker()
  const nameOf = (node: ts.PropertyName): string | undefined => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text
    if (ts.isComputedPropertyName(node)) {
      const name = checker.getTypeAtLocation(node.expression)
      if (name.isStringLiteral()) return name.value
    }
  }
  const owned = (type: ts.Type | undefined, name: string): boolean =>
    type !== undefined && (type.isUnionOrIntersection()
      ? type.types.some((member) => owned(member, name))
      : checker.getPropertyOfType(type, name)?.declarations?.some((decl) =>
          isDomain(projectPath(root, decl.getSourceFile().fileName))) === true)

  const found: string[] = []
  const flag = (node: ts.Node, name: string) =>
    found.push(`${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: writes .${name} outside the project transitions`)

  const checkLiteral = (node: ts.ObjectLiteralExpression) => {
    const fields = node.properties.flatMap((prop) => {
      const name = prop.name && nameOf(prop.name)
      if (!name || !phases.has(name)) return []
      if (ts.isPropertyAssignment(prop) && checker.getTypeAtLocation(prop.initializer)
          .getProperty('Encoded')?.declarations?.some((d) => /\/effect\/(dist|src)\/Schema\./.test(d.getSourceFile().fileName)))
        return []
      return [{ prop, name }]
    })
    if (fields.length === 0) return
    const types = [checker.getContextualType(node), ...node.properties.flatMap((prop) =>
      ts.isSpreadAssignment(prop) ? [checker.getTypeAtLocation(prop.expression)] : [])]
    const parent = node.parent
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) &&
        parent.expression.expression.getText(file) === 'Object' && parent.expression.name.text === 'assign' &&
        parent.arguments[0] !== undefined && parent.arguments[0] !== node)
      types.push(checker.getTypeAtLocation(parent.arguments[0]))
    for (const { prop, name } of fields) if (types.some((type) => owned(type, name))) flag(prop, name)
  }

  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) checkLiteral(node)
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const left = node.left
      if (ts.isPropertyAccessExpression(left) && phases.has(left.name.text) &&
          owned(checker.getTypeAtLocation(left.expression), left.name.text)) flag(left, left.name.text)
      if (ts.isElementAccessExpression(left)) {
        const name = checker.getTypeAtLocation(left.argumentExpression)
        if (name.isStringLiteral() && phases.has(name.value) &&
            owned(checker.getTypeAtLocation(left.expression), name.value)) flag(left, name.value)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}
