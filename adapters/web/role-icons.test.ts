// The role icons are a vendor file of the page (BUILD.md 1g): one name for each of ROLE_ICONS,
// each the inner markup of a stroke icon of the pinned Lucide release, with its license beside it.
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROLE_ICONS } from '../../core/schema/index.ts'
import { PAGE_FILES } from './bundle.ts'

const VENDOR = join(import.meta.dir, 'vendor')

test('the vendored icon names equal ROLE_ICONS, each an SVG inner markup', () => {
  const page: { roleIcons?: Readonly<Record<string, string>> } = {}
  new Function('window', readFileSync(join(VENDOR, 'role-icons.js'), 'utf8'))(page)
  const icons = page.roleIcons ?? {}
  expect(Object.keys(icons)).toEqual([...ROLE_ICONS])
  for (const markup of Object.values(icons)) {
    expect(markup).toMatch(/^(<(path|rect|circle|line|polyline|polygon|ellipse) [^<>]*\/>)+$/)
  }
})

test('the license file names the pinned release, and the page serves the icons', () => {
  const license = readFileSync(join(VENDOR, 'LICENSE-lucide.txt'), 'utf8')
  expect(license).toContain('lucide-static@1.62.0')
  expect(license).toContain('ISC License')
  expect(readFileSync(join(VENDOR, 'role-icons.js'), 'utf8')).toContain('Lucide 1.62.0')
  expect(PAGE_FILES['/vendor/role-icons.js']).toEqual([
    'adapters/web/vendor/role-icons.js',
    'text/javascript',
  ])
})
