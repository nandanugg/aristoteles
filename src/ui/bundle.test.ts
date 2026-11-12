import { expect, test } from 'bun:test'
import { pageBundle } from './bundle.ts'

test('the page bundle builds, holds the page, and is kept for the process', async () => {
  const js = await pageBundle()
  expect(js.length).toBeGreaterThan(10000)
  // The entry mounts into #app; strings of the page's parts show it is the real page.
  expect(js).toContain('getElementById("app")')
  expect(js).toContain('Projects of this dir')
  expect(js).toContain('Page down')
  expect(js).toContain('The project is closed. Nothing runs now.')
  expect(await pageBundle()).toBe(js)
})
