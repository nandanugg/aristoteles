// The page: src/ui/app/main.ts, built with Bun.build at the first request of /app.js. The
// server serves src/ui/app/index.html and style.css as they are.
import { join } from 'node:path'

const ENTRY = join(import.meta.dir, 'app', 'main.ts')

// The bundled page script; built once per server process. A failed build is not kept, so the
// next request builds again.
let bundle: Promise<string> | undefined
const build = async (): Promise<string> => {
  const result = await Bun.build({ entrypoints: [ENTRY], target: 'browser' })
  if (!result.success) {
    throw new Error(`the page did not build: ${result.logs.map((l) => l.message).join('; ')}`)
  }
  const output = result.outputs[0]
  if (!output) throw new Error('the page did not build: no output')
  return output.text()
}
export const pageBundle = (): Promise<string> => {
  bundle ??= build().catch((e: unknown) => {
    bundle = undefined
    throw e
  })
  return bundle
}

// The static files of the page: path -> [file under the repo, content type].
export const PAGE_FILES: Readonly<Record<string, readonly [string, string]>> = {
  '/': ['src/ui/app/index.html', 'text/html; charset=utf-8'],
  '/style.css': ['src/ui/app/style.css', 'text/css'],
  '/vendor/xterm.js': ['node_modules/@xterm/xterm/lib/xterm.js', 'text/javascript'],
  '/vendor/xterm.css': ['node_modules/@xterm/xterm/css/xterm.css', 'text/css'],
  '/vendor/addon-fit.js': ['node_modules/@xterm/addon-fit/lib/addon-fit.js', 'text/javascript'],
}
