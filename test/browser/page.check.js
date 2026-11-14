// The page, read only (plan/ui/BUILD.md part 3), in a real browser: the canvas in layout A, the
// three kinds of card, the panel with its tabs, the folded diff, and both themes. It runs in a
// process of its own (test/page.test.js starts it): the browser tool can end its whole process
// group, and that must not end the test run.
import { expect } from 'bun:test'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { startServer } from '../code.js'
import { INTRO_V1, ok, tokenIn, withWriter } from '../harness.js'

const browser = await chromium.launch()

const open = async () => {
  const { p, lead, writer } = await withWriter()
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', INTRO_V1)
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
  const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  const s = startServer({ dir: p.dir, env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') } })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(s.url)
  await page.waitForSelector('.card.task')
  return { p, s, page, errors, linter }
}

{
  // the canvas, the panel, the diff, and a live change
    const { p, s, page, errors, linter } = await open()
    try {
      expect(await page.textContent('.crumb')).toBe('report-export/ The Introduction')
      expect(await page.textContent('.card.task .task-title')).toBe('t1The Introduction')
      expect(await page.textContent('.card.task .now')).toBe('in review')
      expect(await page.textContent('.card.task .tags')).toBe('Terra · a1')
      expect(await page.textContent('.card.work .tags')).toBe('a2 writer · Luna')
      // Only what runs: the linter that reviews r1 now, and the decider that r1 waits for.
      expect(await page.locator('.card.review').allTextContents()).toEqual([
        'REVIEWa3 linterreviews', 'DECIDEarchitect or section-leadwaits'])
      await page.click('.card.task')
      await page.waitForSelector('.panel .tab')
      expect(await page.locator('.tab').allTextContents()).toEqual(['Description', 'Directions', 'Diff', 'Terminal'])
      expect(await page.textContent('.timeline')).toContain('report docs/tsd.md#introduction -> r1')
      await page.click('text=Directions')
      expect(await page.textContent('.direction h3')).toContain('tsd-writing@1')
      await page.click('text=Diff')
      await page.click('.file-head')
      await page.waitForSelector('.diff .add')
      expect(await page.textContent('.diff .add')).toBe('+ABC-2964: the export ran twice for one merchant.')
      // A new act reaches the page through the websocket.
      ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
      await page.waitForFunction(() => document.querySelector('.card.task .now')?.textContent === 'works')
      expect(await page.textContent('.card.task .kv .v')).toBe('2 of 3')
      expect(errors).toEqual([])
    } finally {
      await page.close()
      s.stop()
    }
  }
{
  // the theme of the settings: dark
  {
    const { p, s, page } = await open()
    try {
      p.write('aristoteles.yaml', `theme: dark\n${(await Bun.file(join(p.dir, 'aristoteles.yaml')).text())}`)
      await page.reload()
      await page.waitForSelector('.card.task')
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark')
    } finally {
      await page.close()
      s.stop()
    }
  }
}
{
  // a live terminal: the page shows the terminal of the host, the AI CLI that the person triggered
  // in a pane of the person's own tmux server, and the person types into it there
  const { createPump } = await import('../code.js')
  const { TASK_WHOLE, init, personPane, project } = await import('../harness.js')
  const { Database } = await import('bun:sqlite')
  const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  const person = personPane(`bun ${join(import.meta.dir, '..', 'fake-agent.js')} start person-host`)
  ok(await p.run('run start', { env: person.env }))
  ok(await p.run('task draft --file=top.yaml --by=h1', { env: person.env }))
  ok(await p.ui('task open td1'))
  const db = new Database(join(p.dir, '.work', 'aristoteles.db'), { readonly: true })
  const host = db.query("SELECT session FROM run WHERE id = 'h1'").get().session
  db.close()
  const pump = createPump({ dir: p.dir, socket: `aristoteles-check-${process.pid}` })
  pump.adopt(host, person.socket, person.pane)
  const s = startServer({ dir: p.dir, env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') }, pump })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await page.goto(s.url)
    await page.waitForSelector('.card.task .dot.run')
    await page.click('.tag-button')
    await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('fake agent start person-host (env none)'))
    await page.keyboard.type('hello from the browser')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent.includes('you said: hello from the browser'), null, { timeout: 10000 })
    expect(await page.textContent('.term-bar')).toContain(`a1 · session ${host}`)
    // Ruling 2026-11-14 (fixed-size terminals): the terminal has the size of the pane in tmux
    // (160 x 48), not the size of its box (it fitted the box before), and the box scrolls.
    const { TMUX: _t, TMUX_PANE: _p, TMUX_SOCKET: _s, ...clean } = process.env
    const onPerson = (...args) => Bun.spawnSync(['tmux', '-f', '/dev/null', '-S', person.socket, ...args], { env: clean }).stdout.toString().trim()
    const paneSize = () => onPerson('display-message', '-p', '-t', person.pane, '#{pane_width}x#{pane_height}')
    const shownRows = () => page.evaluate(() => document.querySelectorAll('.xterm-rows > div').length)
    expect(await shownRows()).toBe(48)
    expect(await page.evaluate(() => {
      const box = document.querySelector('.term')
      return box.scrollWidth > box.clientWidth
    })).toBe(true)
    // The person attaches from a small terminal (60 x 15, a pty): the pane and the page keep the
    // size.
    const small = Bun.spawn(['tmux', '-f', '/dev/null', '-S', person.socket, 'attach'], { env: { ...clean, TERM: 'xterm-256color' }, terminal: { cols: 60, rows: 15, data() {} } })
    try {
      const attached = Date.now() + 5000
      while (onPerson('list-clients', '-F', '#{client_control_mode}').split('\n').length < 2 && Date.now() < attached) await Bun.sleep(50)
      expect(onPerson('list-clients', '-F', '#{client_control_mode}').split('\n').sort()).toEqual(['0', '1'])
      await page.waitForTimeout(500)
      expect(paneSize()).toBe('160x48')
      expect(await shownRows()).toBe(48)
      // Ruling 2026-11-14 (fixed-size terminals): the rows fit in the box only after the resize
      // button. It sets the window in tmux to the size that fills the box, but never less than
      // 80 x 24, and the page then shows the size that tmux reports. The rows fit in the box (the
      // last row is not cut off), and the width too, unless the box holds fewer than 80 columns
      // (this panel holds about 70, so it scrolls sideways a little).
      await page.click('text=Fit to box')
      await page.waitForFunction(() => document.querySelectorAll('.xterm-rows > div').length !== 48)
      const [cols, rows] = paneSize().split('x').map(Number)
      expect(await shownRows()).toBe(rows)
      expect(rows).toBeGreaterThanOrEqual(24)
      const fits = await page.evaluate(() => {
        const screen = document.querySelector('.xterm-screen').getBoundingClientRect()
        const box = document.querySelector('.term').getBoundingClientRect()
        return { down: screen.bottom <= box.bottom, across: screen.right <= box.right }
      })
      expect(fits.down).toBe(true)
      expect(fits.across || cols === 80).toBe(true)
    } finally {
      small.kill()
    }
    // Page Up and Page Down reach the tool, and the focus stays in the terminal. The terminal of
    // the fake tool echoes each Escape as "^[".
    await page.click('button[aria-label="Page up"]')
    await page.click('button[aria-label="Page down"]')
    await page.keyboard.type('after the buttons')
    await page.keyboard.press('Enter')
    const end = Date.now() + 10000
    while (!pump.tail(host).includes('^[[5~^[[6~after the buttons') && Date.now() < end) await Bun.sleep(100)
    expect(pump.tail(host)).toContain('^[[5~^[[6~after the buttons')
    // No page shows the terminal: the page's control client leaves the person's server.
    await page.close()
    const left = Date.now() + 5000
    while (onPerson('list-clients', '-F', '#{client_control_mode}') !== '' && Date.now() < left) await Bun.sleep(50)
    expect(onPerson('list-clients', '-F', '#{client_control_mode}')).toBe('')
  } finally {
    await page.close()
    s.stop()
    pump.killServer()
    person.kill()
  }
}
{
  // a direction problem: a refused accept keeps the person's words and shows why in the item;
  // the accept ends the item
  const { HOST, TASK_WHOLE, git, init, project, solToken } = await import('../harness.js')
  const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
  // The page acts as the git user of the dir.
  git(p.dir, 'init', '-q')
  git(p.dir, 'config', 'user.name', 'Nanda')
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.run('run start', HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out) // ruling 10.1
  ok(await p.run(`brief ${host}`, HOST))
  p.write('cost.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs., rules: [ { id: names-cost, says: "The introduction names the cost", checkedBy: linter } ] }\n')
  const draft = ok(await p.agent(`direction revise ${host} tsd-writing --file=cost.yaml`)).out.match(/(d\d+) drafted/)[1]
  // The host writes the problem and the hope; the page puts the change from the store between them.
  ok(await p.agent(`note ${host} words --on=${draft} --text="The readers stop at the introduction, and it does not say what the problem costs." --hope="The readers then see first why the work matters."`))
  const s = startServer({ dir: p.dir, env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') } })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  try {
    await page.goto(s.url)
    await page.click('.card.task')
    await page.waitForSelector('.item.direction')
    expect(await page.locator('.item .prose').allTextContents()).toEqual([
      'The readers stop at the introduction, and it does not say what the problem costs.', 'The readers then see first why the work matters.'])
    expect(await page.textContent('.item .change-title')).toBe('TSD writing')
    // Each added line: no old number, its new number, "+", and its text.
    const added = await page.locator('.item .dl.add').evaluateAll((rows) => rows.map((r) => [...r.children].map((c) => c.textContent)))
    expect(added).toEqual([['', '10', '+', ' '], ['', '11', '+', 'Say what the problem costs.'], ['', '12', '+', 'Check: The introduction names the cost']])
    // The prose, the change and the hope come in this order.
    expect(await page.evaluate(() => [...document.querySelector('.item').children].map((e) => e.className))).toEqual(
      ['item-head', 'prose', 'change', 'prose', 'item-raw', 'field', 'item-actions'])
    // The page never scrolls: on a short window the sidebar, the canvas and the panel fill it.
    // The item is the first thing in the Description, and the tab body scrolls with it.
    await page.setViewportSize({ width: 1440, height: 560 })
    expect(await page.evaluate(() => {
      const body = document.querySelector('.tab-body')
      return {
        page: document.documentElement.scrollHeight <= innerHeight,
        columns: ['.sidebar', '.canvas', '.panel'].map((s) => document.querySelector(s).getBoundingClientRect().height === innerHeight),
        first: body.firstElementChild.firstElementChild.classList.contains('item'),
        scrolls: body.scrollHeight > body.clientHeight,
      }
    })).toEqual({ page: true, columns: [true, true, true], first: true, scrolls: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.click('.tab >> text=Diff')
    await page.waitForSelector('.tab[aria-selected="true"] >> text=Diff')
    expect(await page.locator('.item').count()).toBe(0)
    await page.click('.tab >> text=Description')
    await page.waitForSelector('.item.direction')
    // The whole direction is there: the 6 unchanged lines far from the change hide behind a "@@"
    // row with the header of the part below it, and a short run opens whole.
    expect(await page.textContent('.item .dl.hunk .t')).toBe('@@ -7,3 +7,6 @@')
    await page.click('.item .dl.hunk button[aria-label="Show 6 hidden lines"]')
    expect(await page.locator('.item .dl.hunk').count()).toBe(0)
    expect(await page.locator('.item .dl').first().evaluate((r) => [...r.children].map((c) => c.textContent))).toEqual(
      ['1', '1', '', 'The reader understands and decides from the page alone.'])
    // A reject needs a comment; an accept does not.
    expect(await page.isDisabled('text=Reject the change')).toBe(true)
    await page.fill('.item textarea', 'the cost is what the readers ask first')
    expect(await page.isDisabled('text=Reject the change')).toBe(false)
    // Ruling 10.8 (B7): the page knows the person only by git user.name, and shows only that
    // person's items. A stranger's act is refused; the page then shows no item, and the line
    // that names the person to set.
    git(p.dir, 'config', 'user.name', 'Stranger')
    await page.click('text=Accept the change')
    await page.waitForSelector('.person-line')
    expect(await page.textContent('.person-line')).toContain('git user.name is "Stranger", and that is no person of this dir')
    expect(await page.locator('.item').count()).toBe(0)
    git(p.dir, 'config', 'user.name', 'Nanda')
    await page.reload()
    await page.click('.card.task')
    await page.waitForSelector('.item.direction')
    await page.click('text=Accept the change')
    await page.waitForSelector('.item.direction', { state: 'detached' })
    expect(ok(await p.ui(`direction show ${draft}`)).out).not.toContain('waits for the accept')
  } finally {
    await page.close()
    s.stop()
  }
}
await browser.close()
console.log('the page check passed')
process.exit(0)
