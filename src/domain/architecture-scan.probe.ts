import { createHash } from 'node:crypto'
import ts from 'typescript'
import { canonical as targetOf, exportsOf, production, projectPath } from './architecture-projects.probe.ts'

export interface Finding {
  readonly file: string
  readonly declaration: string
  readonly path: string
  readonly rule: string
  readonly source: string
}

const leafTokens = (node: ts.Node, file: ts.SourceFile, output: string[]): void => {
  if (ts.isJSDoc(node)) return
  const children = node.getChildren(file)
  if (children.length === 0) output.push(node.getText(file))
  else for (const child of children) leafTokens(child, file, output)
}

export const sourceKey = (node: ts.Node, file: ts.SourceFile): string => {
  const tokens: string[] = []
  leafTokens(node, file, tokens)
  return createHash('sha256').update(JSON.stringify(tokens)).digest('hex')
}

// Domain and wire declarations are in scope. Adapter functions may emit raw IO or
// rendering scalars. Structured returns are contracts even when their types are inferred.
export const contracts = (file: string): boolean =>
  production(file) && /^(src\/(domain|config|files|services)\/|core\/|adapters\/)/.test(file) &&
  !/^core\/derived\/.*\/replay\//.test(file)

const callableContracts = (file: string): boolean =>
  /^(src\/(domain|config|files|services)\/|core\/)/.test(file)

export function scan(program: ts.Program, root: string, included = contracts,
  issuerScope = production,
): Finding[] {
  const checker = program.getTypeChecker()
  const files = program.getSourceFiles().filter((file) => included(projectPath(root, file.fileName)))
  const result = new Map<string, Finding>()
  const canonical = (symbol: ts.Symbol | undefined) => targetOf(checker, symbol)
  const effectDeclaration = (declaration: ts.Declaration | undefined, module: string) =>
    declaration !== undefined && new RegExp(`/effect/(?:dist|src)/${module}\\.[^/]+$`).test(declaration.getSourceFile().fileName)
  const native = (symbol: ts.Symbol | undefined, module: string) =>
    canonical(symbol)?.declarations?.some((d) => effectDeclaration(d, module)) === true
  const memberType = (symbol: ts.Symbol, node: ts.Node) => checker.getTypeOfSymbolAtLocation(symbol, node)
  const schemaOutput = (type: ts.Type) => {
    const output = type.getProperty('Type')
    const encoded = type.getProperty('Encoded')
    return encoded?.declarations?.some((d) => effectDeclaration(d, 'Schema')) ? output : undefined
  }

  const brandKeys = (type: ts.Type): string[] => {
    if (type.isUnion() || !(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection))) return []
    const marker = type.getProperties().find((prop) => native(prop, 'Brand'))
    const declaration = marker?.valueDeclaration ?? marker?.declarations?.[0]
    return marker && declaration ? memberType(marker, declaration).getProperties().map((key) => key.name) : []
  }
  // Follow the applied schema chain or the return of a local schema factory. A check in
  // an annotation, an unused variable, or a sibling expression cannot approve a brand.
  const usedFunctions = (expression: ts.Expression, chain = new Set<ts.Symbol>()): ReadonlySet<string> => {
    if (ts.isParenthesizedExpression(expression)) return usedFunctions(expression.expression, chain)
    if (ts.isIdentifier(expression)) {
      const symbol = canonical(checker.getSymbolAtLocation(expression))
      if (!symbol || chain.has(symbol)) return new Set()
      const binding = symbol.valueDeclaration
      return binding && ts.isVariableDeclaration(binding) && binding.initializer
        ? usedFunctions(binding.initializer, new Set([...chain, symbol])) : new Set()
    }
    if (!ts.isCallExpression(expression)) return new Set()
    const callee = expression.expression
    const member = ts.isPropertyAccessExpression(callee) ? callee : undefined
    const symbol = canonical(checker.getSymbolAtLocation(member?.name ?? callee))
    const detects = new Set<string>()
    if (member?.name.text === 'pipe') {
      for (const part of [member.expression, ...expression.arguments]) {
        for (const operation of usedFunctions(part, chain)) detects.add(operation)
      }
    } else if (symbol && native(symbol, 'Schema')) {
      if (symbol.name !== 'check' || expression.arguments.length > 0) detects.add(symbol.name)
      if (member) for (const applied of usedFunctions(member.expression, chain)) detects.add(applied)
    } else if (symbol && !chain.has(symbol)) {
      const binding = symbol.valueDeclaration
      const body = binding && ts.isFunctionDeclaration(binding) ? binding.body
        : binding && ts.isVariableDeclaration(binding) && binding.initializer && ts.isArrowFunction(binding.initializer)
          ? binding.initializer.body : undefined
      if (body) {
        const returns = ts.isBlock(body)
          ? body.statements.flatMap((node) => ts.isReturnStatement(node) && node.expression ? [node.expression] : [])
          : [body]
        const evidence = returns.map((returned) => usedFunctions(returned, new Set([...chain, symbol])))
        for (const operation of evidence[0] ?? []) {
          if (evidence.every((set) => set.has(operation))) detects.add(operation)
        }
      }
    }
    return detects
  }

  const refined = new Set<string>()
  const unchecked = new Set<string>()
  for (const file of files) {
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) continue
        const output = schemaOutput(checker.getTypeAtLocation(declaration.name))
        if (!output) continue
        const decoded = memberType(output, declaration)
        const keys = brandKeys(decoded)
        if (!keys.length) continue
        const operations = usedFunctions(declaration.initializer)
        if (operations.has('brand') && (operations.has('check') || operations.has('refine'))) {
          for (const key of keys) refined.add(key)
        } else if (operations.has('brand')) {
          for (const key of keys) unchecked.add(key)
        }
      }
    }
  }

  const declarations = (file: ts.SourceFile): (ts.DeclarationStatement | ts.VariableDeclaration)[] =>
    file.statements.flatMap<ts.DeclarationStatement | ts.VariableDeclaration>((node) => {
      if (ts.isVariableStatement(node)) return [...node.declarationList.declarations]
      return ts.isDeclarationStatement(node) ? [node] : []
    })

  // Check a shared contract once, then charge its consumers when that contract is unchecked.
  // Keeping this edge prevents a new declaration from inheriting an old file's allowance.
  const owners = new Map<ts.Type | ts.Symbol, ts.Declaration>()
  for (const file of files) {
    for (const node of declarations(file)) {
      if (!node.name || !ts.isIdentifier(node.name)) continue
      const symbol = checker.getSymbolAtLocation(node.name)
      if (!symbol) continue
      if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
        owners.set(symbol, node)
        const declared = checker.getDeclaredTypeOfSymbol(symbol)
        if (declared.flags & (ts.TypeFlags.Object | ts.TypeFlags.Union | ts.TypeFlags.Intersection))
          owners.set(declared, node)
      } else if (ts.isVariableDeclaration(node)) {
        const output = schemaOutput(checker.getTypeAtLocation(node.name))
        const decoded = output && memberType(output, node)
        if (decoded && decoded.flags & (ts.TypeFlags.Object | ts.TypeFlags.Union | ts.TypeFlags.Intersection) &&
            !owners.has(decoded)) owners.set(decoded, node)
      }
    }
  }
  const dependants = new Map<ts.Declaration, Set<ts.Declaration>>()
  const uncheckedContracts = new Set<ts.Declaration>()
  const dependencies = new Map<ts.Declaration, Map<ts.Declaration, string>>()
  for (const file of files) {
    const fileName = projectPath(root, file.fileName)
    const exports = new Set(exportsOf(checker, file).map(canonical))
    const visitDeclaration = (node: ts.Node) => {
      if (!ts.isTypeAliasDeclaration(node) && !ts.isInterfaceDeclaration(node) && !ts.isVariableDeclaration(node)
        && !ts.isFunctionDeclaration(node) && !ts.isClassDeclaration(node)) return
      if (!node.name || !ts.isIdentifier(node.name)) return
      const own = checker.getSymbolAtLocation(node.name)
      if (!own) return
      const declaration = node.name.text
      let source: string | undefined
      const finding = (path: string, rule: string) => {
        uncheckedContracts.add(node)
        const item = { file: fileName, declaration, path, rule, source: source ??= sourceKey(node, file) }
        result.set(keyOf(item), item)
      }
      const active = new Set<ts.Type>()
      const typeArguments = (type: ts.Type) => type.aliasTypeArguments
        ?? (type.flags & ts.TypeFlags.Object && (type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
          ? checker.getTypeArguments(type as ts.TypeReference) : [])

      const structured = (type: ts.Type): boolean => !!(type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) ||
        (type.isUnion() && type.types.some(structured))
      const walk = (type: ts.Type, path: string, atRoot = false): void => {
        if (active.has(type)) return
        const flags = type.flags
        if (flags & (ts.TypeFlags.Literal | ts.TypeFlags.Null | ts.TypeFlags.Undefined
          | ts.TypeFlags.Void | ts.TypeFlags.Never | ts.TypeFlags.ESSymbolLike)) return
        const keys = brandKeys(type)
        if (keys.length) {
          if (keys.some((key) => !refined.has(key) || unchecked.has(key))) finding(path, 'unrefined-brand')
          const record = /^src\/domain\/project\/(?!events\.ts$)/.test(fileName)
          if (record && /^\$[.<]/.test(path) && !path.startsWith('$<') && !path.includes('()') &&
              keys.some((key) => /(?:Id|Identity)$/.test(key)) && !/\.id(?:[.<\[]|$)|\[key\]/.test(path))
            finding(path, 'record-id-reference')
          return
        }
        if (flags & ts.TypeFlags.String) return finding(path, 'bare-string')
        if (flags & ts.TypeFlags.Number) return finding(path, 'bare-number')
        if (flags & ts.TypeFlags.Boolean) return finding(path, 'bare-boolean')
        if (flags & ts.TypeFlags.Any) return finding(path, 'any')
        if (flags & ts.TypeFlags.Unknown) return finding(path, 'unknown')
        if (flags & ts.TypeFlags.TemplateLiteral) {
          const pattern = type as ts.TemplateLiteralType
          if (pattern.types.some((part) => part.flags & ts.TypeFlags.String)
            || (pattern.texts.every((text) => text === '') && pattern.types.some((part) => part.flags & ts.TypeFlags.Number))) {
            finding(path, 'unbounded-template')
          }
          pattern.types.filter((part) => part.isIntersection()).forEach((part) => walk(part, path))
          return
        }
        if (flags & (ts.TypeFlags.TypeParameter | ts.TypeFlags.Conditional)) return
        if (flags & ts.TypeFlags.IndexedAccess) {
          const indexed = type as ts.IndexedAccessType
          walk(indexed.objectType, `${path}[object]`)
          walk(indexed.indexType, `${path}[index]`)
          return
        }
        const output = schemaOutput(type)
        if (output) return walk(memberType(output, node), path)
        const name = type.aliasSymbol ?? type.getSymbol()
        const owner = owners.get(type) ?? (name && owners.get(name))
        if (!atRoot && owner && owner !== node) {
          const readers = dependants.get(owner) ?? new Set()
          dependants.set(owner, readers.add(node))
          const reads = dependencies.get(node) ?? new Map()
          if (!reads.has(owner)) reads.set(owner, path)
          dependencies.set(node, reads)
          typeArguments(type).forEach((arg, i) => walk(arg, `${path}<${i}>`))
          return
        }
        active.add(type)
        try {
          if (type.isUnion()) {
            const records = type.types.filter((part) => part.flags & ts.TypeFlags.Object &&
              !checker.isArrayType(part) && !checker.isTupleType(part))
            if (records.length > 1) {
              const literalAt = (part: ts.Type, key: string) => {
                const field = part.getProperty(key)
                const value = field && memberType(field, node)
                if (value?.isStringLiteral()) return value.value
                if (value && value.flags & ts.TypeFlags.Null) return null
              }
              // Journal moves carry a source phase. Public submissions omit it and
              // use the checked input to distinguish an empty start from a result.
              const address = (part: ts.Type) => {
                const input = part.getProperty('input')
                const line = part.getProperty('line')
                if (!line || !input) return
                const tag = literalAt(memberType(line, node), '_tag')
                const move = literalAt(part, 'move')
                if (typeof tag !== 'string' || typeof move !== 'string') return
                return { tag, move, input: memberType(input, node) }
              }
              const addresses = records.map(address)
              const phases = records.map((part) => literalAt(part, 'from'))
              const journal = addresses.every((entry) => entry !== undefined) &&
                phases.every((from) => from !== undefined) &&
                new Set(addresses.map((entry, i) => JSON.stringify([entry?.tag, phases[i], entry?.move]))).size === records.length
              const submissions = records.every((part) => part.getProperty('read') && !part.getProperty('from')) &&
                addresses.every((entry) => entry !== undefined) &&
                addresses.every((entry, index) => {
                  if (!entry) return false
                  const fields = entry.input.getProperties()
                  return addresses.slice(0, index).every((other) => {
                    if (!other || other.tag !== entry.tag || other.move !== entry.move) return true
                    const previous = other.input.getProperties()
                    return (fields.length === 0 && previous.some((field) => !(field.flags & ts.SymbolFlags.Optional))) ||
                      (previous.length === 0 && fields.some((field) => !(field.flags & ts.SymbolFlags.Optional)))
                  })
                })
              if (!journal && !submissions && records.some((part) => typeof literalAt(part, '_tag') !== 'string'))
                finding(path, 'untagged-union')
            }
            for (const part of type.types) {
              const tag = part.getProperty('_tag')
              const tagType = tag && memberType(tag, node)
              walk(part, tagType?.isStringLiteral() ? `${path}<${tagType.value}>` : path)
            }
            return
          }
          if (type.isIntersection()) {
            for (const part of type.types) walk(part, path)
            return
          }
          if (checker.isArrayType(type) || checker.isTupleType(type)) {
            typeArguments(type).forEach((arg, i) => walk(arg, checker.isTupleType(type) ? `${path}[${i}]` : `${path}[]`))
            return
          }
          if (name?.declarations?.some((d) => d.getSourceFile().isDeclarationFile
              && (ts.isInterfaceDeclaration(d) || ts.isClassDeclaration(d)))) {
            // Effect's environment parameter is a requirement. Service payloads are audited
            // at their own declarations, while the return and error channels are values here.
            const args = typeArguments(type)
            const values = native(name, 'Effect') && name?.name === 'Effect' ? args.slice(0, 2) : args
            values.forEach((arg, i) =>
              walk(arg, i === 0 && (name?.name === 'Map' || name?.name === 'ReadonlyMap') ? `${path}[key]` : `${path}<${i}>`))
            return
          }
          for (const signature of type.getCallSignatures()) {
            if (!checker.getTypePredicateOfSignature(signature)) walk(signature.getReturnType(), `${path}()`)
            if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || path !== '$') {
              for (const parameter of signature.getParameters())
                walk(memberType(parameter, signature.getDeclaration() ?? node), `${path}(${parameter.name})`)
            }
          }
          for (const index of checker.getIndexInfosOfType(type)) {
            walk(index.keyType, `${path}[key]`)
            walk(index.type, `${path}[value]`)
          }
          for (const prop of type.getProperties()) {
            if (prop.name.startsWith('~effect/') || prop.declarations?.some((d) =>
              /\/typescript\/lib\/lib\..*\.d\.ts$/.test(d.getSourceFile().fileName)
              || effectDeclaration(d, 'Inspectable'))) continue
            const child = `${path}.${prop.name.replace(/@\d+$/, '')}`
            if (prop.flags & ts.SymbolFlags.Optional) finding(child, 'optional')
            walk(memberType(prop, prop.valueDeclaration ?? prop.declarations?.[0] ?? node), child)
          }
        } finally {
          active.delete(type)
        }
      }
      const typeSyntax = (syntax: ts.Node): void => {
        if (ts.isConditionalTypeNode(syntax)) {
          walk(checker.getTypeAtLocation(syntax.trueType), '$?true')
          walk(checker.getTypeAtLocation(syntax.falseType), '$?false')
        }
        if (ts.isTypeParameterDeclaration(syntax)) {
          if (syntax.constraint) walk(checker.getTypeAtLocation(syntax.constraint), `$<${syntax.name.text}>.constraint`)
          if (syntax.default) walk(checker.getTypeAtLocation(syntax.default), `$<${syntax.name.text}>.default`)
        }
        ts.forEachChild(syntax, typeSyntax)
      }
      if (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) {
        walk(checker.getDeclaredTypeOfSymbol(own), '$', true)
        typeSyntax(node)
      } else {
        const value = checker.getTypeAtLocation(node.name)
        const output = schemaOutput(value)
        const service = typeArguments(value).length && value.getProperty('Service')
        if (output) walk(memberType(output, node), '$', true)
        else if (exports.has(own)) {
          if (service) walk(memberType(service, node), '$.Service', true)
          else {
            const signatures = value.getCallSignatures()
            if (callableContracts(fileName) || signatures.length === 0) walk(value, '$', true)
            else for (const signature of signatures) {
              const returned = signature.getReturnType()
              if (structured(returned)) walk(returned, '$()')
            }
          }
        }
      }
    }
    for (const declaration of declarations(file)) visitDeclaration(declaration)
  }

  // Set iteration also visits new entries. This propagates through cycles and chains once.
  for (const owner of uncheckedContracts) {
    for (const reader of dependants.get(owner) ?? []) uncheckedContracts.add(reader)
  }
  for (const [node, refs] of dependencies) {
    const name = (node as ts.NamedDeclaration).name
    if (!name || !ts.isIdentifier(name)) continue
    const file = node.getSourceFile()
    for (const [dependency, path] of refs) {
      if (!uncheckedContracts.has(dependency)) continue
      const item = {
        file: projectPath(root, file.fileName), declaration: name.text, path,
        rule: 'unchecked-contract', source: sourceKey(node, file),
      }
      result.set(keyOf(item), item)
    }
  }

  // An export facade enters the gate at its own file, even when it declares no types.
  for (const file of files) {
    const fileName = projectPath(root, file.fileName)
    const starExports = file.statements.filter((node): node is ts.ExportDeclaration =>
      ts.isExportDeclaration(node) && !node.exportClause && node.moduleSpecifier !== undefined)
    for (const exposed of exportsOf(checker, file)) {
      const target = canonical(exposed)
      const declarations = target?.declarations ?? []
      if (!declarations.some((decl) => uncheckedContracts.has(decl)) ||
          declarations.some((decl) => decl.getSourceFile() === file)) continue
      const site = exposed.declarations?.find((decl) => decl.getSourceFile() === file) ??
        starExports.find((statement) => {
          const module = checker.getSymbolAtLocation(statement.moduleSpecifier!)
          return module && checker.getExportsOfModule(module).some((member) => canonical(member) === target)
        })
      if (site) {
        const item = {
          file: fileName, declaration: exposed.name, path: '$', rule: 'unchecked-contract', source: sourceKey(site, file),
        }
        result.set(keyOf(item), item)
      }
    }
  }

  for (const file of program.getSourceFiles()) {
    const fileName = projectPath(root, file.fileName)
    if (!issuerScope(fileName)) continue
    const assertions = (node: ts.Node, name: string): void => {
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        const target = checker.getTypeAtLocation(node.type)
        const received = checker.getTypeAtLocation(node.expression)
        const keys = brandKeys(target)
        const input = brandKeys(received)
        const report = (path: string, rule: string) => {
          const item = { file: fileName, declaration: name, path, rule, source: sourceKey(node, file) }
          result.set(keyOf(item), item)
        }
        for (const brand of keys.filter((key) => !input.includes(key))) report(brand, 'brand-cast')
        const declarations = [target.aliasSymbol, target.getSymbol()].flatMap((symbol) => symbol?.declarations ?? [])
        const projectRecord = keys.length === 0 && declarations.some((decl) =>
          projectPath(root, decl.getSourceFile().fileName).startsWith('src/domain/project/'))
        if (projectRecord && (received.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown) ||
            !checker.isTypeAssignableTo(received, target))) report('$', 'domain-cast')
      }
      const identifier = 'name' in node && node.name && ts.isIdentifier(node.name as ts.Node)
        ? (node.name as ts.Identifier).text : name
      ts.forEachChild(node, (child) => assertions(child, identifier))
    }
    assertions(file, '$')
  }
  return [...result.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
}

export const keyOf = ({ file, declaration, path, rule, source }: Finding): string =>
  JSON.stringify([file, declaration, path, rule, source])

const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
export const findingDigest = (finding: Finding): string => hash(keyOf(finding))
export const ceilingDigest = (ceiling: readonly string[]): string => hash(JSON.stringify(ceiling))

export const compareBaseline = (
  measured: readonly Finding[],
  baseline: readonly Finding[],
  ceiling: readonly string[],
) => {
  const frozen = new Set(ceiling)
  const allowed = new Set(baseline.map(keyOf))
  const actual = new Set(measured.map(keyOf))
  return {
    newFindings: measured.filter((row) => !allowed.has(keyOf(row))),
    staleBaseline: baseline.filter((row) => !actual.has(keyOf(row))),
    outsideCeiling: baseline.filter((row) => !frozen.has(findingDigest(row))),
    duplicateEntries: baseline.length - allowed.size,
  }
}
