// The checks of test/dash.test.js, in a process of its own: the columns, the pipeline row and its
// hover strip, the escalation modal with its review, the folded sidebar and its DIR / PROJECT
// picker, the poll that repairs a lost push, and the reload on a new build.
import { expect } from 'bun:test'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { startServer } from '../code.js'

const browser = await chromium.launch()
const serve = (dir, more = {}) =>
  startServer({ dir, env: { ARISTOTELES_DB: join(dir, '.work', 'aristoteles.db') }, ...more })

// A page of a server, with its page errors collected.
const open = async (s, before) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  if (before) await before(page)
  await page.goto(s.url)
  await page.waitForSelector('.board')
  return { page, errors }
}
const texts = (page, sel) => page.locator(sel).allTextContents()

{
  // the columns, the folded sidebar, the hidden row and its hover strip
  const s = serve(process.env.DASH_QUEUED)
  const { page, errors } = await open(s)
  try {
    expect(await page.textContent('h1')).toMatch(/ \/ TSD$/)
    expect(await texts(page, '.board .col-title')).toEqual(['Task queue', 'Host', 'section-lead'])
    const intro = '[aria-label="Task Intro"]'
    expect(await page.textContent(`${intro} .state`)).toBe('QUEUED')
    expect(await page.textContent(`${intro} .desc`)).toBe('Write the introduction.')
    expect(await page.textContent('[aria-label="Terminal of section-lead"] .status')).toMatch(
      /^(Working|Waiting|Inactive)$/)
    expect(await page.isVisible('.crumb')).toBe(false)
    expect(await page.getAttribute('.fold', 'aria-expanded')).toBe('false')
    await page.click('.fold')
    await page.waitForSelector('.crumb', { state: 'visible' })
    expect(await page.isVisible('.direction-card')).toBe(true)
    // The DIR / PROJECT picker at the top: this dir with its project; the current one is marked.
    expect(await texts(page, '.picker .pick')).toEqual([(await page.textContent('h1')) ?? ''])
    expect(await page.getAttribute('.picker .pick', 'aria-current')).toBe('true')
    await page.click('.picker .pick')
    expect(new URL(page.url()).pathname).toBe('/')
    await page.click('.fold')
    await page.waitForSelector('.crumb', { state: 'hidden' })
    // No escalation waits: the row is hidden, the strip at the bottom edge shows it.
    expect(await page.locator('.pipe-row').count()).toBe(0)
    await page.hover('.row-strip')
    await page.waitForSelector('.pipe-row')
    expect(await page.textContent('.pipe-row')).toContain('Task pipeline')
    await page.mouse.move(700, 300)
    await page.waitForSelector('.pipe-row', { state: 'detached' })
    expect(errors).toEqual([])
  } finally {
    await page.close()
    s.stop()
  }
}

{
  // an escalation that waits: the row shows, its modal has the review; a poll repairs a lost push
  const s = serve(process.env.DASH_WAITING)
  const { page, errors } = await open(s)
  try {
    await page.waitForSelector('.pipe-row')
    expect(await page.textContent('.escalation .status')).toBe('Waits for review')
    expect(await page.textContent('.escalation .conclusion')).toBe('Say it once.')
    expect(await page.textContent('.person')).toContain('Waits for you')
    await page.click('.escalation')
    const dialog = page.locator('[role=dialog]')
    await dialog.waitFor()
    expect(await dialog.locator('.diff .add').count()).toBeGreaterThan(0)
    expect(await dialog.locator('button', { hasText: 'Accept' }).count()).toBe(1)
    expect(await dialog.locator('button', { hasText: 'Send back' }).isDisabled()).toBe(true)
    await page.waitForTimeout(300)
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
    expect(errors).toEqual([])
  } finally {
    await page.close()
  }
  // A page whose socket never opens hears no push; the person accepts elsewhere; the poll shows it.
  const { page: deaf } = await open(s, (p) =>
    p.addInitScript(() => {
      window.WebSocket = class {
        constructor() {
          setTimeout(() => this.onclose?.(), 50)
        }
        send() {}
        close() {}
      }
    }))
  try {
    await deaf.waitForSelector('.pipe-row')
    const origin = s.url.slice(0, -1)
    const dash = await (await fetch(`${s.url}api/dash`, { headers: { origin } })).json()
    const act = { _tag: 'Accept', fix: 't1' }
    const res = await fetch(`${s.url}api/act`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ act, on: dash.header.seq, build: dash.header.build }),
    })
    expect((await res.json()).ok).toBe(true)
    await deaf.waitForSelector('.pipe-row', { state: 'detached', timeout: 9000 })
  } finally {
    await deaf.close()
    s.stop()
  }
}

{
  // a new build: the page reloads itself; the same build again: it stays
  const dir = process.env.DASH_QUEUED
  let s = serve(dir, { readBuild: () => 'one' })
  const port = s.port
  const { page } = await open(s)
  try {
    await page.waitForTimeout(500)
    await page.evaluate(() => { window.oldCode = true })
    s.stop()
    s = serve(dir, { port, readBuild: () => 'one' })
    await page.waitForTimeout(2500)
    expect(await page.evaluate(() => window.oldCode)).toBe(true)
    s.stop()
    s = serve(dir, { port, readBuild: () => 'two' })
    await page.waitForFunction(() => window.oldCode === undefined, null, { timeout: 10000 })
  } finally {
    await page.close()
    s.stop()
  }
}
await browser.close()
console.log('the dash check passed')
process.exit(0)
