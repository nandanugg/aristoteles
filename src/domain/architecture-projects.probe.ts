// Test support shared by the architecture checks. The browser keeps its DOM-only config.
import { dirname, relative, resolve } from 'node:path'
import ts from 'typescript'

export const projectPath = (root: string, path: string): string => relative(root, path).replaceAll('\\', '/')
export const production = (file: string): boolean =>
  /^(src|core|adapters|bin)\//.test(file) &&
  /\.tsx?$/.test(file) && !/\.(test|probe|d)\.tsx?$/.test(file)

export const browserFile = (file: string): boolean => file.startsWith('adapters/web/app/')

export interface ProjectPrograms {
  readonly engine: ts.Program
  readonly browser: ts.Program
}

export const programs = (root: string, probes: Readonly<Record<string, string>> = {}): ProjectPrograms => {
  const make = (config: string, need: (file: string) => boolean): ts.Program => {
    const path = resolve(root, config)
    const loaded = ts.readConfigFile(path, ts.sys.readFile)
    if (loaded.error) throw new Error(ts.flattenDiagnosticMessageText(loaded.error.messageText, '\n'))
    const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, dirname(path))
    if (parsed.errors.length) throw new Error(ts.flattenDiagnosticMessageText(parsed.errors[0]!.messageText, '\n'))

    const virtual = new Map(Object.entries(probes).map(([file, text]) => [resolve(root, file), text]))
    const directories = new Set<string>()
    for (const file of virtual.keys()) {
      for (let dir = dirname(file); !directories.has(dir); dir = dirname(dir)) {
        directories.add(dir)
        if (dir === root) break
      }
    }
    const host = ts.createCompilerHost(parsed.options)
    const { getSourceFile, readFile, fileExists, directoryExists } = host
    host.directoryExists = (name) => directories.has(name) || directoryExists?.(name) === true
    host.getSourceFile = (name, ...rest) => {
      const text = virtual.get(name)
      return text === undefined ? getSourceFile(name, ...rest) : ts.createSourceFile(name, text, rest[0], true)
    }
    host.readFile = (name) => virtual.get(name) ?? readFile(name)
    host.fileExists = (name) => virtual.has(name) || fileExists(name)
    const roots = Object.keys(probes).filter(need).map((file) => resolve(root, file))
    return ts.createProgram({ rootNames: [...parsed.fileNames, ...roots], options: parsed.options, host })
  }
  return {
    engine: make('tsconfig.json', (file) => !browserFile(file)),
    browser: make('adapters/web/app/tsconfig.json', browserFile),
  }
}

export const canonical = (checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined =>
  symbol && (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)

export const exportsOf = (checker: ts.TypeChecker, file: ts.SourceFile): readonly ts.Symbol[] => {
  const symbol = checker.getSymbolAtLocation(file)
  return symbol ? checker.getExportsOfModule(symbol) : []
}
