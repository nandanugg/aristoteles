import { expect } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { startServer } from '../code.js'
import { ONBOARD_CONFIG, ONBOARD_NEW, ok, onboardingProject } from '../harness.js'
import { dbOf, gitPerson } from '../outside.js'

const p = onboardingProject()
gitPerson(p)
const config = ONBOARD_CONFIG
  .replace('    icon: layers', '    pipeline: true\n    icon: layers')
  .replace('    summary: Checks one section.', `    summary: Checks one section.
    principles: [Ethos]
    directions: [one-thing]
    questions:
      - says: Who checks the checker?
        choices: [The host, The reviewer]`)
const draft = Bun.YAML.parse(ONBOARD_NEW)
const rule = draft.standards[0].rules[0]
rule.test = 'bun test'
rule.evidence.check = { _tag: 'Command', result: 'One observed break' }
draft.flow[0].uses.push(rule.id)
const code = { file: 'docs/tsd.md', line: 3, excerpt: '## Introduction' }
const principle = { file: 'docs/facts.md', line: 3, excerpt: '## Dedupe' }
const question = {
  says: 'Should facts be grouped?',
  options: ['Group related facts.', 'Keep one topic per section.'],
  target: { _tag: 'Deviation', rule: rule.id,
    code: { words: 'The code groups related facts.', source: code },
    principle: { words: 'Keep one topic per section.', source: principle } },
}
draft.questions = [question]
p.write('draft.yaml', config)
p.write('direction.yaml', Bun.YAML.stringify(draft))
const discover = async (app) => {
  p.write('survey.yaml', Bun.YAML.stringify({
    summary: 'Documentation review in this repository.', app,
    sources: [code, principle], scope: { searched: ['docs/'], unknown: ['deploy/'] },
  }))
  ok(await p.agent('onboard discovery --file=survey.yaml'))
}
ok(await p.agent('onboard config --file=draft.yaml'))
const server = startServer({ dir: p.dir, env: { ARISTOTELES_DB: dbOf(p) } })
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const shots = process.env.ONBOARDING_SCREENSHOTS ?? join(p.dir, 'screenshots')
mkdirSync(shots, { recursive: true })
const shot = (name) => page.screenshot({ path: join(shots, name), animations: 'disabled' })
const modalShot = async (name, modal) => {
  const viewport = page.viewportSize()
  const height = await modal.evaluate((element) => element.scrollHeight + 66)
  await page.setViewportSize({ ...viewport, height: Math.max(viewport.height, height) })
  try {
    await shot(name)
  } finally {
    await page.setViewportSize(viewport)
  }
}
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

  await discover(true)
  await page.reload()
  await visible(page.getByText('Please wait while the host drafts directions for this repository…', { exact: true }))
  expect(await page.locator('.review-card').count()).toBe(0)
  await visible(page.getByRole('heading', { name: 'About report-export' }))
  await shot('01-summary-waiting.png')

  ok(await p.nanda('onboard add --principle="One thing per section"'))
  ok(await p.agent('onboard draft new-1 --file=direction.yaml'))
  ok(await p.nanda('onboard add --principle="Describe the verification steps"'))
  ok(await p.nanda('onboard add --principle="Record the open questions"'))
  await discover(false)
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
  await visible(direction.getByRole('radio', { name: /Accept the code/ }))
  await visible(direction.getByRole('radio', { name: /Keep the principle/ }))
  await visible(direction.getByLabel('Answer in your own words'))
  await modalShot('05-direction-conflict.png', direction)
  await direction.getByRole('radio', { name: /Keep the principle/ }).check()
  await button('Submit answers', direction).click()
  await visible(card('Re-verifying'))
  expect(await button('Accept all').isDisabled()).toBe(true)

  ok(await p.nanda('onboard remove new-1'))
  ok(await p.nanda('onboard remove new-2'))
  const shown = ok(await p.agent('onboard show one-thing')).out
  const revision = shown.match(/^revision: (.+)$/m)?.[1]
  expect(revision).toBeTruthy()
  delete draft.questions
  rule.says = question.options[1]
  rule.evidence.knownBreaks = [code]
  rule.evidence.check.result = 'The break remains in the existing code'
  p.write('direction.yaml', Bun.YAML.stringify(draft))
  ok(await p.agent(`onboard draft one-thing --file=direction.yaml --revision=${revision}`))
  await page.reload()
  await visible(card('Ready'))
  await card('Ready').click()
  await visible(direction.locator('.flow'))
  await visible(direction.getByText('Each section of a TSD keeps to one topic, so a reader finds it fast.'))
  await direction.locator('.review-standard summary').click()
  await visible(direction.getByText('bun test', { exact: true }))
  const pair = direction.locator('.review-pair').first()
  const follows = await pair.locator('.example.follows').boundingBox()
  const breaks = await pair.locator('.example.breaks').boundingBox()
  expect(follows.y).toBe(breaks.y)
  expect(follows.x).toBeLessThan(breaks.x)
  await modalShot('04-direction-modal.png', direction)
  await button('Close', direction).click()
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
  await visible(card('Host').getByText('Built in', { exact: true }))
  await visible(card('Pipeline role').getByText('Built in', { exact: true }))
  await shot('03-role-tiles.png')

  expect(await button('Accept all').isDisabled()).toBe(true)
  await card('Checks one section.').click()
  const role = dialog('linter')
  await visible(role.getByText('Who checks the checker?', { exact: true }))
  expect(await role.locator('textarea').count()).toBe(1)
  expect(await button('Revise', role).count()).toBe(0)
  expect(await role.getByText('Ethos', { exact: true }).getAttribute('title')).toBe('Which tests and checks support this result?')
  await modalShot('06-role-question.png', role)
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
  expect(await role.locator('textarea').count()).toBe(1)
  expect(await button('Send words', role).count()).toBe(0)
  await modalShot('07-role-revise.png', role)
  await button('Close', role).click()
  const staleRoles = await post({ act: 'review-all-roles', reviewed: [] })
  expect(staleRoles.ok).toBe(false)
  await button('Accept all').click()
  await visible(page.getByRole('heading', { name: 'Staffing' }))
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
