import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve, relative } from 'node:path'

const file = process.argv[2]
if (!file) throw new Error('Supply the root Quint case.')
const sources = new Map<string, Buffer>()
const visit = (path: string) => {
  if (sources.has(path)) return
  const source = readFileSync(path)
  sources.set(path, source)
  for (const [, imported] of source.toString('utf8').matchAll(/^\s*import\b[^\r\n]*?\bfrom\s+"([^"]+)"/gmu))
    visit(resolve(dirname(path), imported + '.qnt'))
}
visit(resolve(file))
const hash = createHash('sha256')
for (const path of [...sources.keys()].sort()) {
  const source = sources.get(path)!
  hash.update(relative(process.cwd(), path) + '\0' + source.length + '\0')
  hash.update(source)
}
console.log(hash.digest('hex'))
