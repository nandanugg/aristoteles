#!/usr/bin/env bun
// `work`: it runs bin/main.ts as one bundled file with its bytecode, which starts about 100 ms
// sooner than the sources. The first call after a change of what the bundle is built from builds
// it into .cache/cli/<key>/ (git ignores .cache/), and later calls load it. The key covers every
// source file under core/, adapters/, src/ and bin/ (its size and its change times), package.json,
// bun.lock, tsconfig.json, the installed packages, the Bun version and this folder: after a pull,
// an edit or a `bun install` no call uses the bundle of before. A build goes to a folder of its
// own and is renamed into place, so two calls that build at once do not break each other. A build
// that fails says nothing: the call runs the sources, and the next call tries again.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const ENTRY = join(ROOT, 'bin', 'main.ts')
const CACHE = join(ROOT, '.cache', 'cli')

const stamp = (path) => {
  const s = statSync(path)
  return `${path} ${s.size} ${s.mtimeMs} ${s.ctimeMs}`
}
// The files of the bundle's folders that a call can load: no test and no probe.
const isSource = (name) => /\.(ts|js)$/.test(name) && !/\.(test|probe)\.ts$/.test(name)
const stampFolder = (dir, lines) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, e.name)
    if (e.isDirectory()) stampFolder(path, lines)
    else if (isSource(e.name)) lines.push(stamp(path))
  }
}
const keyOf = () => {
  const lines = [ROOT, Bun.version, Bun.revision]
  for (const folder of ['core', 'adapters', 'src', 'bin']) stampFolder(join(ROOT, folder), lines)
  const manifest = join(ROOT, 'package.json')
  for (const file of [manifest, join(ROOT, 'bun.lock'), join(ROOT, 'tsconfig.json')]) {
    lines.push(stamp(file))
  }
  // A `bun install` that the lock did not ask for changes the code in the bundle too.
  const { dependencies = {} } = JSON.parse(readFileSync(manifest, 'utf8'))
  for (const name of Object.keys(dependencies)) {
    lines.push(stamp(join(ROOT, 'node_modules', name, 'package.json')))
  }
  return Bun.hash(lines.join('\n')).toString(36)
}

// In one bundle each file would read the bundle's folder as its import.meta.dir; the files that
// read guides/, skills/ and the page files from there get their own folder written in.
const ownFolders = {
  name: 'own folders',
  setup(build) {
    build.onLoad({ filter: /\.ts$/ }, async ({ path }) => {
      const text = await Bun.file(path).text()
      const own = path.includes('/node_modules/')
        ? text
        : text.replaceAll('import.meta.dir', JSON.stringify(dirname(path)))
      return { contents: own, loader: 'ts' }
    })
  },
}

const build = async (bundle) => {
  const tmp = `${bundle}.${process.pid}.tmp`
  try {
    mkdirSync(CACHE, { recursive: true })
    const built = await Bun.build({
      entrypoints: [ENTRY],
      outdir: tmp,
      target: 'bun',
      format: 'cjs',
      bytecode: true,
      plugins: [ownFolders],
    })
    if (!built.success) throw new Error('the bundle did not build')
    renameSync(tmp, bundle)
  } catch {
    // The build failed, or another call renamed its build into place first: no trace is left.
    rmSync(tmp, { recursive: true, force: true })
    return
  }
  for (const old of readdirSync(CACHE)) {
    if (join(CACHE, old) !== bundle && !old.endsWith('.tmp')) {
      rmSync(join(CACHE, old), { recursive: true, force: true })
    }
  }
}

const bundleOf = async () => {
  try {
    const bundle = join(CACHE, keyOf())
    if (!existsSync(join(bundle, 'main.js'))) await build(bundle)
    return existsSync(join(bundle, 'main.js')) ? join(bundle, 'main.js') : undefined
  } catch {
    return undefined
  }
}

await import((await bundleOf()) ?? ENTRY)
