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
    const question = page.getByRole('form', { name: 'Which examples?' })
    const answer = 'first line\nsecond line'
    const textbox = question.getByLabel('First example')
    await textbox.fill(answer)
    const retry = []
    await page.route('**/api/act', async (route) => {
      retry.push(route.request().postDataJSON())
      if (retry.length === 1) await route.abort()
      else await route.continue()
    })
    const answerButton = question.getByRole('button', { name: 'Answer' })
    await answerButton.click()
    await question.getByRole('alert').waitFor()
    expect(await textbox.inputValue()).toBe(answer)
    const delivered = page.waitForResponse((response) =>
      response.url().endsWith('/api/act') && response.request().method() === 'POST')
    await answerButton.click()
    const response = await delivered
    expect(retry).toHaveLength(2)
    expect(retry[0]).toEqual(retry[1])
    const submission = retry[1]
    expect(submission.act).toMatchObject({
      _tag: 'AnswerQuestion', answer: { _tag: 'Multiple', texts: [answer, ''] },
    })
    expect(submission.id).toMatch(/^[0-9a-f]{32}$/)
    expect((await response.json()).ok).toBe(true)
    await question.waitFor({ state: 'detached' })
    const repost = await fetch(`${s.url}api/act`, {
      method: 'POST', headers: {
        origin: new URL(s.url).origin, 'content-type': 'application/json',
      },
      body: JSON.stringify(submission),
    })
    expect((await repost.json()).duplicate).toBe(true)
    await page.click('.escalation')
    const dialog = page.locator('[role=dialog]')
    await dialog.waitFor()
    expect(await dialog.textContent()).toContain('Reviewed by: self-review turns (as the pipeline role reports)')
    expect(await dialog.locator('.diff .add').count()).toBeGreaterThan(0)
    expect(await dialog.locator('button', { hasText: 'Accept' }).count()).toBe(1)
    expect(await dialog.locator('button', { hasText: 'Send back' }).isDisabled()).toBe(true)
    const notes = dialog.getByLabel(/Points to send back/)
    await notes.fill('This belongs to the original decision.')
    const wire = await (await fetch(`${s.url}api/dash`)).json()
    const before = wire.row[0].ask
    const after = `${before}.replacement`
    s.send({
      type: 'dash',
      dash: { ...wire, header: { ...wire.header, seq: wire.header.seq + 1 },
        row: wire.row.map((row) => (row.ask === before ? { ...row, ask: after } : row)),
        person: { owed: wire.person.owed.map((entry) =>
          entry._tag === 'Decide' && entry.ask === before ? { ...entry, ask: after } : entry) },
      },
    })
    await page.waitForFunction(() => document.querySelector('[role=dialog] textarea')?.value === '')
    expect(await dialog.getByRole('button', { name: 'Send back' }).isDisabled()).toBe(true)
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
    const act = { _tag: 'Respond', ask: dash.row[0].ask, reply: 'AcceptIt' }
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
