import { expect } from 'bun:test'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { startServer } from '../code.js'
import { ONBOARD_CONFIG, ONBOARD_NEW, ONBOARD_QUESTIONS, ok, onboardingProject } from '../harness.js'
import { dbOf, gitPerson } from '../outside.js'

const p = onboardingProject()
gitPerson(p)
const config = ONBOARD_CONFIG
  .replace('    icon: compass', '    pipeline: true\n    icon: compass')
  .replace('    summary: Checks one section.', `    summary: Checks one section.
    principles: [Ethos]
    directions: [one-thing]
    questions:
      - says: Who checks the checker?
        choices: [The host, The reviewer]`)
const rule = ONBOARD_NEW
  .replace('uses: [one-thing, one-heading]', 'uses: [one-thing, one-heading, one-topic]')
  .replace('checkedBy: linter }', 'checkedBy: linter, test: bun test }')
p.write('draft.yaml', config)
p.write('direction.yaml', rule)
p.write('questions.yaml', ONBOARD_QUESTIONS)
ok(await p.agent('onboard config --file=draft.yaml'))
const server = startServer({ dir: p.dir, env: { ARISTOTELES_DB: dbOf(p) } })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
let discovery = 'none'
const shots = process.env.ONBOARDING_SCREENSHOTS ?? join(p.dir, 'screenshots')
mkdirSync(shots, { recursive: true })
const shot = (name) => page.screenshot({ path: join(shots, name), animations: 'disabled' })
const gridBoxes = () => page.locator('.review-card').evaluateAll((cards) =>
  cards.slice(0, 3).map((card) => { const { x, y } = card.getBoundingClientRect(); return { x, y } }))
const expectWideGrid = async () => {
  const boxes = await gridBoxes()
  expect(boxes).toHaveLength(3)
  expect(new Set(boxes.map(({ y }) => y)).size).toBe(1)
  expect(new Set(boxes.map(({ x }) => x)).size).toBe(3)
  expect((await page.locator('.review-grid').boundingBox()).width).toBeGreaterThan(1000)
}
try {
  await page.route('**/api/onboarding', async (route) => {
    if (discovery === 'none' || route.request().method() !== 'GET') return route.continue()
    const response = await route.fetch()
    const body = await response.json()
    body.discovery = { summary: 'Documentation review in this repository.',
      read: ['CLAUDE.md:3'], notSearched: ['deploy/'], app: discovery === 'summary' }
    for (const card of body.directions) {
      if (card.state !== 'question') continue
      card.open[0] = { ...card.open[0], rule: 'one-topic', sides: [
        { source: 'docs/tsd.md:3', words: 'The code groups related facts.' },
        { source: 'CLAUDE.md:3', words: 'Keep one topic per section.' },
      ] }
    }
    await route.fulfill({ response, json: body })
  })
  await page.goto(server.url)
  const button = (name, scope = page) => scope.getByRole('button', { name, exact: true })
  const visible = async (locator) => locator.waitFor({ state: 'visible' })
  const dialog = (name) => page.getByRole('dialog', { name, exact: true })
  const card = (text) => page.locator('.review-card').filter({ hasText: text })
  await visible(page.getByText('Analyzing your project directory…', { exact: true }))
  expect(await page.locator('.review-card').count()).toBe(0)
  expect(await page.locator('.review-empty .review-progress').evaluate((bar) =>
    getComputedStyle(bar, '::before').animationName)).toBe('review-progress')
  await shot('00-analyzing.png')

  discovery = 'summary'
  await page.reload()
  await visible(page.getByText('Please wait while the host drafts directions for this repository…', { exact: true }))
  expect(await page.locator('.review-card').count()).toBe(0)
  await visible(page.getByRole('heading', { name: 'About report-export' }))
  await shot('01-summary-waiting.png')

  ok(await p.nanda('onboard add --principle="One thing per section"'))
  ok(await p.agent('onboard draft new-1 --file=direction.yaml'))
  ok(await p.agent('onboard ask one-thing --file=questions.yaml'))
  ok(await p.nanda('onboard add --principle="Describe the verification steps"'))
  ok(await p.nanda('onboard add --principle="Record the open questions"'))
  discovery = 'conflict'
  await page.reload()
  await visible(card('Conflict'))
  expect(await page.getByRole('progressbar', { name: 'Assessing' }).count()).toBe(2)
  await expectWideGrid()
  await shot('02-direction-tiles.png')
  await page.setViewportSize({ width: 600, height: 900 })
  expect(new Set((await gridBoxes()).map(({ y }) => y)).size).toBeGreaterThan(1)
  await page.setViewportSize({ width: 1440, height: 900 })

  await visible(page.getByText('Areas not searched', { exact: true }))
  expect(await page.getByRole('region', { name: 'Project summary' }).textContent()).toContain('deploy/')
  await visible(page.getByText('This repository has no app yet.', { exact: false }))
  expect(await button('Accept all').isDisabled()).toBe(true)
  await card('Conflict').click()
  const direction = dialog('One thing per section')
  await visible(direction.getByText('Code side', { exact: true }))
  await visible(direction.getByText('Principle side', { exact: true }))
  expect(await direction.locator('textarea').count()).toBe(1)
  expect(await button('Revise', direction).count()).toBe(0)
  expect(await direction.locator('.flow').count()).toBeGreaterThan(0)
  await visible(direction.getByText('bun test', { exact: true }))
  await direction.getByRole('radio', { name: /Keep the principle/ }).check()
  await button('Submit answers', direction).click()
  await visible(card('Re-verifying'))
  expect(await button('Accept all').isDisabled()).toBe(true)

  discovery = 'none'
  ok(await p.nanda('onboard remove new-1'))
  ok(await p.nanda('onboard remove new-2'))
  ok(await p.agent('onboard draft one-thing --file=direction.yaml'))
  await page.reload()
  await visible(card('Ready'))
  const snapshot = await (await fetch(`${server.url}/api/onboarding`)).json()
  const reviewed = snapshot.directions.map(({ id, revision }) => ({ id, revision }))
  const post = (body) => fetch(`${server.url}/api/onboarding`, {
    method: 'POST', headers: { origin: new URL(server.url).origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const stale = await post({ act: 'approve-all-directions', reviewed: [{ ...reviewed[0], revision: 'old' }] })
  expect(stale.ok).toBe(false)
  await button('Accept all').click()
  await button('Accept all', dialog('Accept all directions')).click()
  await visible(page.getByRole('heading', { name: 'Review the roles' }))
  await expectWideGrid()
  await shot('03-role-tiles.png')

  expect(await button('Accept all').isDisabled()).toBe(true)
  await card('Checks one section.').click()
  const role = dialog('linter')
  await visible(role.getByText('Who checks the checker?', { exact: true }))
  expect(await role.locator('textarea').count()).toBe(1)
  expect(await button('Revise', role).count()).toBe(0)
  expect(await role.getByText('Ethos', { exact: true }).getAttribute('title')).toBe('Which tests and checks support this result?')
  await button('One thing per section', role).click()
  expect(await direction.locator('textarea').count()).toBe(0)
  await button('Close', direction).click()
  await button('The host', role).click()
  await visible(card('Revising'))
  expect(await button('Accept all').isDisabled()).toBe(true)

  const revised = Bun.YAML.parse(config)
  delete revised.roles.linter.questions
  p.write('draft-revised.yaml', Bun.YAML.stringify(revised, null, 2))
  ok(await p.agent('onboard config --file=draft-revised.yaml'))
  await visible(card('Ready').filter({ hasText: 'Checks one section.' }))
  await card('Checks one section.').click()
  await visible(button('Revise', role))
  expect(await role.getByText('Who checks the checker?', { exact: true }).count()).toBe(0)
  await button('Close', role).click()
  const staleRoles = await post({ act: 'review-all-roles', reviewed: [] })
  expect(staleRoles.ok).toBe(false)
  await button('Accept all').click()
  await visible(page.getByRole('heading', { name: 'Staffing' }))
  const staffingPath = join(p.dir, '.work/staffing.yaml')
  const staffing = Bun.YAML.parse(readFileSync(staffingPath, 'utf8'))
  staffing.accounts.fixture.limits = { weekly: '  40 credits / week  ', sessions: '2 sessions' }
  p.write('.work/staffing.yaml', Bun.YAML.stringify(staffing, null, 2))
  await page.getByRole('tab', { name: 'Roles' }).click()
  await page.getByRole('tab', { name: 'Staffing' }).click()
  await visible(button('Edit fixture weekly'))
  expect(await page.locator('.staffing-table tbody tr').count()).toBe(2)
  expect(await page.locator('.staffing-table tbody tr').filter({ hasText: 'weekly' }).textContent()).toContain('  40 credits / week  ')
  expect(await page.locator('.staffing-table').textContent()).toContain('Unknown. No usage evidence yet: it is measured from the first tasks.')
  expect(await page.locator('.staffing-role').filter({ hasText: 'writer' }).textContent()).toContain('self-review turns')
  expect(await button('Review activation').count()).toBe(0)
  await shot('04-staffing.png')

  const baseline = readFileSync(staffingPath, 'utf8')
  await button('Edit writer').click()
  await dialog('Edit writer').getByLabel('Effective model').selectOption('sonnet')
  await button('Preview changes', dialog('Edit writer')).click()
  const previewStaffing = dialog('Staffing preview')
  await visible(previewStaffing.getByText('writer.model: haiku -> sonnet', { exact: true }))
  expect(await previewStaffing.getByRole('region', { name: 'Before' }).count()).toBe(1)
  expect(await previewStaffing.getByRole('region', { name: 'After' }).count()).toBe(1)
  expect(readFileSync(staffingPath, 'utf8')).toBe(baseline)
  const comparison = previewStaffing.locator('.staffing-comparison')
  expect(await comparison.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await shot('05-staffing-preview.png')
  await button('Cancel', previewStaffing).click()

  await button('Edit fixture weekly').click()
  const editLimit = dialog('Edit fixture · weekly')
  await editLimit.getByRole('textbox').fill('  50 credits / week  ')
  await button('Preview changes', editLimit).click()
  await visible(previewStaffing.getByRole('region', { name: 'After' }))
  expect(await previewStaffing.getByRole('region', { name: 'After' }).textContent()).toContain('  50 credits / week  ')
  expect(readFileSync(staffingPath, 'utf8')).toBe(baseline)
  await button('Apply and confirm', previewStaffing).click()
  await visible(page.getByText('Staffing confirmed', { exact: true }))
  expect(Bun.YAML.parse(readFileSync(staffingPath, 'utf8')).accounts.fixture.limits.weekly).toBe('  50 credits / week  ')
  await button('Review activation').click()
  await visible(dialog('Review activation'))
  await button('Cancel', dialog('Review activation')).click()
  await page.getByRole('tab', { name: 'Roles' }).click()
  await button('Add role').click()
  const addRole = dialog('Add role')
  await addRole.getByRole('textbox').fill('Review accessibility on release.')
  await button('Add role', addRole).click()
  await visible(card('Assessing new role…'))
  expect(ok(await p.agent('onboard wait --seconds=1')).out).toContain('Review accessibility on release.')
  expect(await button('Accept all').isDisabled()).toBe(true)

  await page.getByRole('tab', { name: 'Directions' }).click()
  await button('Add direction').click()
  const addDirection = dialog('Add direction')
  await addDirection.getByRole('textbox').fill('Document accessibility decisions.')
  await button('Add direction', addDirection).click()
  await visible(card('Assessing new direction…'))
  expect(await page.getByRole('tab', { name: 'Roles' }).isDisabled()).toBe(true)
  expect(errors).toEqual([])
} finally {
  await browser.close()
  server.stop()
  rmSync(p.dir, { recursive: true, force: true })
}
console.log('the onboarding check passed')
