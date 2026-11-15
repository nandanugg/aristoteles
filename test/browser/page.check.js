// The page (plan/ui/BUILD.md part 3), in a real browser: the canvas in layout A, the three kinds
// of card, the panel with its tabs, the folded diff, both themes, the onboarding pages, the gear,
// and the decisions. It runs in a process of its own (test/page.test.js starts it): the browser
// tool can end its whole process group, and that must not end the test run.
import { expect } from 'bun:test'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { startServer } from '../code.js'
import { INTRO_V1, ok, tokenIn, withWriter } from '../harness.js'

const browser = await chromium.launch()

// PAGE_SHOTS=<folder>: screenshots of a page at a wide and a phone width, for a person to see.
const shot = async (page, name) => {
  if (!process.env.PAGE_SHOTS) return
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()))
  const size = page.viewportSize()
  for (const [width, height, kind] of [[2560, 1440, 'wide'], [375, 812, 'phone']]) {
    await page.setViewportSize({ width, height })
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(process.env.PAGE_SHOTS, `${name}-${kind}.png`), fullPage: kind === 'phone' })
  }
  await page.setViewportSize(size)
}

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
  // BUILD.md 1g: the role icons load only with a view of the agents.
  const icons = []
  page.on('request', (r) => r.url().includes('/vendor/role-icons.js') && icons.push(r.url()))
  // Nanda, 2026-11-15: a project has its own path; / lists the projects (it opened the first).
  await page.goto(`${s.url}t1`)
  await page.waitForSelector('.card.task')
  return { p, s, page, errors, linter, icons }
}

{
  // the canvas, the panel, the diff, and a live change
    const { p, s, page, errors, linter, icons } = await open()
    try {
      // The sidebar starts folded (Nanda, 2026-11-15); the button at the top left opens it.
      expect(await page.isVisible('.crumb')).toBe(false)
      expect(await page.getAttribute('.fold', 'aria-expanded')).toBe('false')
      await page.click('.fold')
      expect(await page.getAttribute('.fold', 'aria-expanded')).toBe('true')
      await page.waitForSelector('.crumb', { state: 'visible' })
      expect(await page.textContent('.crumb')).toBe('report-export/ The Introduction')
      await page.click('.fold')
      await page.waitForSelector('.crumb', { state: 'hidden' })
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
      expect(icons).toEqual([])
    } finally {
      await page.close()
      s.stop()
    }
  }
{
  // Nanda, 2026-11-15: real paths. / lists the projects of the dir, a click opens one, a task and
  // its tab have paths, back and forward work, a reload keeps the place, and an old #/ address
  // opens its path.
  const { s, page, errors } = await open()
  const path = () => new URL(page.url()).pathname
  try {
    await page.goto(s.url)
    await page.waitForSelector('.project-row')
    expect(await page.locator('.project-row').allTextContents()).toEqual(['The Introductiont1works'])
    await shot(page, 'projects')
    await page.click('.project-row')
    await page.waitForSelector('.card.task')
    expect(path()).toBe('/t1')
    await shot(page, 'project')
    await page.click('.card.task')
    await page.waitForSelector('.panel .tab')
    expect(path()).toBe('/t1/t1')
    await page.click('.tab >> text=Diff')
    expect(path()).toBe('/t1/t1/diff')
    await page.reload()
    await page.waitForSelector('.tab[aria-selected="true"] >> text=Diff')
    await page.goBack()
    await page.waitForSelector('.tab[aria-selected="true"] >> text=Description')
    expect(path()).toBe('/t1/t1')
    await page.goBack()
    await page.waitForSelector('.panel', { state: 'detached' })
    expect(path()).toBe('/t1')
    await page.goBack()
    await page.waitForSelector('.project-row')
    expect(path()).toBe('/')
    await page.goForward()
    await page.waitForSelector('.card.task')
    expect(path()).toBe('/t1')
    await page.goto(`${s.url}#/t1/t1/directions`)
    await page.waitForSelector('.tab[aria-selected="true"] >> text=Directions')
    expect(page.url()).toBe(`${s.url}t1/t1/directions`)
    // The crumb of the dir leads back to the list.
    await page.click('.fold')
    await page.click('.crumb-dir')
    await page.waitForSelector('.project-row')
    expect(path()).toBe('/')
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
    // Nanda, 2026-11-15: the project of the host has its own path (/ lists the projects).
    await page.goto(`${s.url}h1`)
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
    // Nanda, 2026-11-15: the project of the host has its own path (/ lists the projects).
    await page.goto(`${s.url}h1`)
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
{
  // Onboarding (rulings 1 to 6, 11, 15, onboarding 2026-11-14): the directions page with each
  // state, the question form, Revise, Remove and approve all; then the agents page, its grid and
  // the window of a role; approve all roles starts the store. Then the gear: three tiers with a
  // model, the entries of the directions and the agents (robot icon), and the sixth decision.
  const {
    FLOW_FILES, ONBOARD_CONFIG, ONBOARD_DIRECTION, ONBOARD_NEW, ONBOARD_QUESTIONS, git, onboardingProject,
  } = await import('../harness.js')
  const p = onboardingProject(FLOW_FILES)
  // The page stores the start at the real time, so the CLI acts after it use the real clock too.
  p.realTime()
  git(p.dir, 'init', '-q')
  git(p.dir, 'config', 'user.name', 'Nanda')
  p.write('draft.yaml', ONBOARD_CONFIG)
  ok(await p.agent('onboard config --file=draft.yaml'))
  ok(await p.agent('onboard found tsd-writing'))
  // Nanda, 2026-11-15: the words of a direction are markdown; the review shows them as lines of
  // its diff, and the panel of a task by level.
  const tsdFile = ONBOARD_DIRECTION.replace('says: The reader understands and decides from the page alone.\n',
    'says: |\n  The reader understands and decides from the page alone.\n\n  ## What a page holds\n' +
    '  The `docs/tsd.md` file, **every** section of it:\n\n  - the introduction\n  - the design\n')
  p.write('tsd.yaml', tsdFile)
  ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
  ok(await p.agent('onboard found code-proof'))
  const s = startServer({ dir: p.dir, env: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') } })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  const icons = []
  page.on('request', (r) => r.url().includes('/vendor/role-icons.js') && icons.push(r.url()))
  const item = (name) => `.direction-item:has-text("${name}")`
  try {
    await page.goto(s.url)
    await page.waitForSelector('.direction-list')
    expect(await page.locator('.direction-item').allTextContents()).toEqual(['code-proofLoading', 'TSD writingReady'])
    expect(await page.textContent('.direction-page .waits')).toBe('The host drafts it.')
    expect(await page.isDisabled('.tab >> text=2. Agents')).toBe(true)
    // Ruling 5: add new direction asks for the principle; the host drafts it, then asks.
    await page.click('text=Add new direction')
    expect(await page.isDisabled('form[aria-label="Add new direction"] button')).toBe(true)
    await page.fill('form[aria-label="Add new direction"] textarea >> nth=0', 'A section says one thing')
    await page.click('form[aria-label="Add new direction"] button')
    await page.waitForSelector(`${item('A section says one thing')} .chip.loading`)
    p.write('one.yaml', ONBOARD_NEW)
    ok(await p.agent('onboard draft new-1 --file=one.yaml'))
    p.write('q.yaml', ONBOARD_QUESTIONS)
    ok(await p.agent('onboard ask one-thing --file=q.yaml'))
    await page.waitForSelector(`${item('One thing per section')} .chip.question`)
    await page.click(item('One thing per section'))
    expect(await page.textContent('.direction-page')).toContain('The principle: A section says one thing')
    expect(await page.textContent('.question legend')).toBe('Does a section of facts count as one thing?')
    expect(await page.textContent('.question .example')).toContain('docs/facts.md:3')
    expect(await page.locator('.question .option').allTextContents()).toEqual(
      ['A: each fact is one thing', 'B: the facts together are one thing'])
    expect(await page.isDisabled('text=Submit the answers')).toBe(true)
    await page.check('.question .option >> nth=1 >> input')
    await page.click('text=Submit the answers')
    await page.waitForSelector(`${item('One thing per section')} .chip.loading`)
    // Ruling 2: Accept with an empty box, Revise with words, Remove.
    await page.click(item('TSD writing'))
    // Nanda, 2026-11-15: a direction shows for its review, in this order: its summary, its flow
    // with the steps that it governs marked, the change of its words (each standard and each rule
    // with its checker inside it), then its examples by marked step.
    expect(await page.evaluate(() =>
      [...document.querySelector('.direction-page .direction-review').children].map((e) => e.className)))
      .toEqual(['direction-summary', 'flow', 'section-title', 'change', 'section-title', 'example-group', 'example-group'])
    expect(await page.textContent('.direction-page .direction-summary')).toBe(
      'A TSD lets its reader decide without a meeting, so each page stands alone.')
    // The flow: a lifeline for each actor in the order that it first appears, a numbered arrow for
    // each step from one actor to the next, a box for an act on its own, and the steps in words
    // under it. A marked step is colored with a tag of its ids; once a step is marked, the others
    // are gray.
    expect(await page.locator('.direction-page .flow-life text').allTextContents()).toEqual(
      ['Person', 'architect', 'writer', 'docs/tsd.md', 'linter'])
    expect(await page.locator('.direction-page .flow-arrow > text').allTextContents()).toEqual([
      '1 asks for a TSD of the export', '2 gives each section to a writer',
      '4 fills the template one section at a time', '5 checks that each section says one thing'])
    expect(await page.locator('.direction-page .flow-arrow line[marker-end]').count()).toBe(4)
    expect(await page.textContent('.direction-page .flow-act > text')).toBe('3 reads the rule of one heading for each section')
    expect(await page.locator('.direction-page .flow-svg g.marked').count()).toBe(2)
    expect(await page.locator('.direction-page .flow-svg g.gray').count()).toBe(3)
    expect(await page.locator('.direction-page .flow-tag text').allTextContents()).toEqual([
      'tsd-writing · intro-story · repeatable', 'facts-not-proof · no-code-proof'])
    expect(await page.evaluate(() => {
      const color = (sel) => getComputedStyle(document.querySelector(`.direction-page ${sel}`)).stroke
      return color('.flow-arrow.marked line') !== color('.flow-arrow.gray line')
    })).toBe(true)
    expect(await page.locator('.direction-page .flow-steps li').allTextContents()).toEqual([
      'Person → architect: asks for a TSD of the export',
      'architect → writer: gives each section to a writer CLAUDE.md:3',
      'writer: reads the rule of one heading for each section .claude/skills/writer/SKILL.md:3',
      'writer → docs/tsd.md: fills the template one section at a time docs/template.md:3 tsd-writing · intro-story · repeatable',
      'linter → docs/tsd.md: checks that each section says one thing facts-not-proof · no-code-proof'])
    expect(await page.locator('.direction-page .flow-steps li').evaluateAll((l) => l.map((x) => x.className)))
      .toEqual(['gray', 'gray', 'gray', 'marked', 'marked'])
    // The words: a first draft has none before it, so each line comes, the markdown as written.
    expect(await page.textContent('.direction-page .change-title')).toBe('The first draft: every line is new')
    const rows = await page.locator('.direction-page .dl').evaluateAll((l) => l.map((x) => x.className))
    expect(rows.length).toBeGreaterThan(10)
    expect(rows.every((c) => c === 'dl add')).toBe(true)
    expect(await page.locator('.direction-page .dl .t').allTextContents()).toContain('## What a page holds')
    expect(await page.locator('.direction-page .dl .t').allTextContents()).toContain(
      '  Rule no-code-proof (checked by linter): No file paths with line numbers, no commit hashes in the body')
    // The examples by marked step: the writer's outputs only, the linter's input and output; a
    // real one with the code around it, its line marked; the host's words labeled so.
    expect(await page.locator('.direction-page .example-step').allTextContents()).toEqual(
      ['Step 4 · writer → docs/tsd.md', 'Step 5 · linter → docs/tsd.md'])
    const group = (n) => `.direction-page .example-group >> nth=${n}`
    expect(await page.locator(`${group(0)} >> .example .fit-tag`).allTextContents()).toEqual(['Follows', 'Breaks'])
    expect(await page.locator(`${group(0)} >> .sample-name`).allTextContents()).toEqual(['Output', 'Output'])
    expect(await page.textContent(`${group(0)} >> .example >> nth=0 >> .sample-head`)).toBe('Outputdocs/tsd.md:3')
    expect(await page.textContent(`${group(0)} >> .example >> nth=0 >> .line.mark mark`)).toBe('## Introduction')
    expect(await page.textContent(`${group(0)} >> .example >> nth=1 >> .sample-head`)).toBe('Outputwritten by the host')
    expect(await page.textContent(`${group(0)} >> .example >> nth=1 >> .written`)).toBe('## Introduction and design, in one section')
    expect(await page.locator(`${group(1)} >> .sample-name`).allTextContents()).toEqual(['Input', 'Output', 'Input', 'Output'])
    expect(await page.textContent(`${group(1)} >> .example >> nth=0 >> .sample-head >> nth=0`)).toBe('Inputdocs/tsd.md:5')
    expect(await page.evaluate(() => {
      const [follows, breaks] = document.querySelectorAll('.direction-page .example-group .example')
      return [follows, breaks].map((c) => getComputedStyle(c).borderLeftColor).filter((x, i, a) => a.indexOf(x) === i).length
    })).toBe(2)
    // On a phone, the diagram scrolls inside its own box, and the page does not scroll sideways.
    await page.setViewportSize({ width: 375, height: 812 })
    expect(await page.evaluate(() => {
      const box = document.querySelector('.direction-page .flow-scroll')
      return { scrolls: box.scrollWidth > box.clientWidth, page: document.documentElement.scrollWidth <= innerWidth }
    })).toEqual({ scrolls: true, page: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    // Nanda, 2026-11-15: the page fills the main area, and the list stays in view when the page
    // scrolls.
    await page.setViewportSize({ width: 1440, height: 600 })
    expect(await page.evaluate(() => {
      const canvas = document.querySelector('.canvas')
      const list = document.querySelector('.direction-list')
      const fills = document.querySelector('.onboarding-cols').getBoundingClientRect().width > canvas.clientWidth - 80
      canvas.scrollTop = canvas.scrollHeight
      const top = list.getBoundingClientRect().top
      return { fills, scrolled: canvas.scrollTop > 100, sticky: getComputedStyle(list).position, inView: top >= 0 && top < 40 }
    })).toEqual({ fills: true, scrolled: true, sticky: 'sticky', inView: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await shot(page, 'directions')
    expect(await page.isDisabled('.direction-page .item-actions >> text=Revise')).toBe(true)
    await page.fill('.direction-page textarea', 'name the reader of the TSD')
    expect(await page.isDisabled('.direction-page .item-actions >> text=Accept')).toBe(true)
    await page.click('.direction-page .item-actions >> text=Revise')
    await page.waitForSelector(`${item('TSD writing')} .chip.loading`)
    expect(await page.textContent('.direction-page .waits')).toBe('The host drafts it, from your words: "name the reader of the TSD".')
    // Nanda, 2026-11-15: a draft over a draft shows what changed since the last one.
    p.write('tsd.yaml', tsdFile.replace('says: Tell the story first, in plain words.', 'says: Tell the story first, for the reader.'))
    ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
    await page.waitForSelector('.direction-page .change-title:has-text("The last draft → this draft")')
    expect(await page.locator('.direction-page .dl.del .t').allTextContents()).toEqual(
      ['Standard intro-story: Tell the story first, in plain words.'])
    expect(await page.locator('.direction-page .dl.add .t').allTextContents()).toEqual(
      ['Standard intro-story: Tell the story first, for the reader.'])
    ok(await p.agent('onboard draft one-thing --file=one.yaml'))
    await page.click(item('code-proof'))
    await page.click('.direction-page .item-actions >> text=Remove')
    await page.waitForFunction(() => document.querySelectorAll('.direction-item').length === 2)
    // Nanda, 2026-11-15: a remove opens the next direction that is not accepted.
    expect(await page.textContent('.direction-item[aria-current="true"] .title')).toBe('One thing per section')
    await page.waitForSelector(`${item('One thing per section')} .chip.ready`)
    await page.waitForSelector(`${item('TSD writing')} .chip.ready`)
    // Nanda, 2026-11-15: an accept opens the next direction that is not accepted, from the top
    // of the list again after the last one.
    await page.click(item('TSD writing'))
    await page.click('.direction-page .item-actions >> text=Accept')
    await page.waitForSelector(`${item('TSD writing')} .chip.accepted`)
    expect(await page.textContent('.direction-item[aria-current="true"] .title')).toBe('One thing per section')
    // Approve all, with a confirmation; then the agents page opens (ruling 3).
    await page.click('.direction-list >> text=Approve all')
    // Nanda, 2026-11-15: TSD writing is accepted already, so approve all names one direction.
    expect(await page.textContent('[role=alertdialog] .prose')).toBe(
      'Approve all accepts each ready direction: One thing per section.')
    await page.click('[role=alertdialog] .btn.primary')
    await page.waitForSelector('text=Next: the agents')
    expect(icons).toEqual([])
    await page.click('text=Next: the agents')
    // Ruling 11: the cards in a grid, the roles that the project has first; the role icons load.
    await page.waitForSelector('.role-card .role-icon path, .role-card .role-icon rect')
    expect(icons).toHaveLength(1)
    expect(await page.locator('.role-card .role-name').allTextContents()).toEqual(['linter', 'architect', 'section-lead', 'writer'])
    expect(await page.textContent('.role-card:has-text("architect") .kv')).toBe('ModelOpus')
    await shot(page, 'agents')
    // Ruling 15: the role of the top task has no toggle; ruling 7: a toggle sets the persistence.
    expect(await page.locator('.role-card:has-text("architect") input[type=checkbox]').count()).toBe(0)
    await page.click('[aria-label="writer is persistent"]')
    await page.waitForFunction(() => document.querySelector('[aria-label="writer is persistent"]')?.checked === true)
    // The window of a role: model and launch read only, the words, the persistence and why.
    await page.click('.role-card:has-text("section-lead")')
    const win = '[role=dialog][aria-label="section-lead"]'
    const words = await page.textContent(win)
    for (const part of ['ModelSonnet', 'Launchnone', 'Runs one section.', 'persistent: It runs one section through its writers and linters until it decides the section.']) {
      expect(words).toContain(part)
    }
    expect(await page.isDisabled(`${win} .modal-foot >> text=Revise`)).toBe(true)
    await page.click(`${win} .modal-foot >> text=Accept`)
    await page.waitForSelector(win, { state: 'detached' })
    await page.waitForSelector('.role-card:has-text("section-lead") .accepted')
    for (const role of ['architect', 'writer', 'linter']) ok(await p.nanda(`onboard accept-role ${role}`))
    await page.waitForFunction(() => document.querySelectorAll('.role-card .accepted').length === 4)
    await page.click('.agents-page >> text=Approve all')
    expect(await page.textContent('[role=alertdialog] .prose')).toContain(
      'The store starts with the directions One thing per section, TSD writing, and the roles linter, architect, section-lead, writer')
    await page.click('[role=alertdialog] .btn.primary')
    await page.waitForSelector('text=No project yet')

    // The gear (ruling 13): settings with three tiers, each with a model (ruling 10).
    await page.click('[aria-label="Settings"]')
    await page.waitForSelector('.gear')
    expect(await page.locator('.gear .tab').allTextContents()).toEqual(['Settings', 'Directions', 'Agents'])
    expect(await page.locator('.gear .tab:has-text("Agents") svg').count()).toBe(1)
    expect(await page.locator('.tier-set legend').allTextContents()).toEqual(['Sol (high)', 'Terra (medium)', 'Luna (low)'])
    expect(await page.locator('[aria-label="luna model"]').count()).toBe(1)
    // The directions entry: the current directions and a text box that stores a suggestion.
    await page.click('.gear .tab >> text=Directions')
    // Nanda, 2026-11-15: as on the directions page, a list and the open direction by level (was:
    // each direction as a block of raw text).
    await page.waitForSelector('.gear .direction-list')
    expect(await page.locator('.gear .direction-item .title').allTextContents()).toEqual(['One thing per section', 'TSD writing'])
    await page.click('.gear .direction-item:has-text("TSD writing")')
    // Nanda, 2026-11-15: a direction has a flow; the store keeps it, and the gear draws it, its
    // marks too; the words show as the version against the one before it, and the examples.
    expect(await page.locator('.gear .flow-life').count()).toBe(5)
    expect(await page.locator('.gear .flow-steps li.marked').count()).toBe(2)
    expect(await page.textContent('.gear .direction-summary')).toBe(
      'A TSD lets its reader decide without a meeting, so each page stands alone.')
    expect(await page.textContent('.gear .change-title')).toBe('tsd-writing@1, the first version: every line is new')
    expect(await page.locator('.gear .example').count()).toBe(4)
    await shot(page, 'gear-directions')
    await page.fill('.gear .suggest textarea', 'say who reads the TSD')
    await page.click('text=Store the suggestion')
    await page.waitForSelector('.toast:has-text("a suggestion; a draft of a direction answers it")')
    // The agents entry: the roles, and the sixth decision: an adjustment that a model drafted.
    ok(await p.agent('adjust tier writer --tier=medium --by=host'))
    await page.click('.gear .tab >> text=Agents')
    await page.waitForSelector('.gear .item.adjustment')
    expect(await page.locator('.gear .role-card').count()).toBe(4)
    await shot(page, 'gear-agents')
    expect(await page.locator('.gear .role-card input[type=checkbox]').count()).toBe(0)
    expect(await page.textContent('.gear .item.adjustment .prose')).toBe(
      'An adjustment, drafted by host, a model run outside any task, waits for your decision: writer becomes a medium role.')
    expect(await page.isDisabled('.gear .item.adjustment .item-actions >> text=Reject')).toBe(true)
    await page.fill('.gear .item.adjustment textarea', 'the writer stays low')
    await page.click('.gear .item.adjustment .item-actions >> text=Reject')
    await page.waitForSelector('.gear .item.adjustment', { state: 'detached' })
    ok(await p.agent('adjust tier writer --tier=medium --by=host'))
    await page.waitForSelector('.gear .item.adjustment')
    await page.click('.gear .item.adjustment .item-actions >> text=Accept')
    await page.waitForSelector('.gear .item.adjustment', { state: 'detached' })
    expect(Bun.YAML.parse(await Bun.file(join(p.dir, 'aristoteles.yaml')).text()).roles.writer.tier).toBe('medium')
    expect(errors).toEqual([])
  } finally {
    await page.close()
    s.stop()
  }
}
await browser.close()
console.log('the page check passed')
process.exit(0)
