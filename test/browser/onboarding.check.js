import { expect } from 'bun:test'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
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
draft.summary = draft.summary.replace('one topic', '**one topic**')
const rule = draft.standards[0].rules[0]
rule.test = 'bun test'
rule.evidence.check = { _tag: 'Command', result: 'One observed break' }
draft.flow[0].uses.push(rule.id)
draft.flow[0].place = { file: 'docs/tsd.md', line: 3 }
const code = { file: 'docs/tsd.md', line: 3, excerpt: '## Introduction' }
const principle = { file: 'docs/facts.md', line: 3, excerpt: '## Dedupe' }
const question = {
  says: 'Should facts be grouped?',
  options: ['Group related facts.', 'Keep one topic per section.'],
  target: { _tag: 'Deviation', rule: rule.id,
    code: { words: 'The code groups related facts.', source: code },
    principle: { words: 'Keep one topic per section.', source: principle } },
}
const extra = {
  id: 'explain-grouping', says: 'Explain how the topics are grouped.', checkedBy: rule.checkedBy,
  ref: 'docs/facts.md#dedupe:3',
  evidence: { ...rule.evidence, cases: [{ fit: 'Follows', output: { written: 'Name groups by topic.' } }], check: { _tag: 'Reference', checker: 'linter', result: 'Reviewed grouping.' } },
}
draft.standards[0].rules.push(extra)
const extraQuestion = {
  says: 'When should the grouping be explained?',
  options: ['Explain only surprising groups.', 'Explain every group.'],
  target: { ...question.target, rule: extra.id },
}
draft.questions = [question, extraQuestion]
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
  const direction = dialog('One thing per section')
  const ownWords = 'Explain groups that could mislead the reader.'
  const singlePosts = []
  const releaseRefusal = Promise.withResolvers()
  const onboardingRoute = '**/api/onboarding'
  await page.route(onboardingRoute, async (route) => {
    if (route.request().method() === 'GET') {
      const response = await route.fetch()
      const snapshot = await response.json()
      const directions = snapshot.directions.map((item) => item.id === draft.id && item.state === 'question'
        ? { ...item, open: item.open.slice(0, 1) } : item)
      return route.fulfill({ response, json: { ...snapshot, directions } })
    }
    singlePosts.push(route.request().postDataJSON())
    if (singlePosts.length === 1) {
      await releaseRefusal.promise
      return route.fulfill({ status: 409, json: { error: 'The answer could not be saved.' } })
    }
    return route.fulfill({ json: {} })
  })
  try {
    await page.reload()
    await card('Conflict').click()
    expect(await button('Submit answers', direction).count()).toBe(0)
    const acceptCode = direction.getByRole('button', { name: /Accept the code/ })
    const keepPrinciple = direction.getByRole('button', { name: /Keep the principle/ })
    const unselected = await acceptCode.evaluate((element) => getComputedStyle(element).backgroundColor)
    const postRequest = () => page.waitForRequest((req) => req.url().endsWith('/api/onboarding') && req.method() === 'POST')
    await Promise.all([postRequest(), acceptCode.click()])
    expect(await acceptCode.getAttribute('aria-pressed')).toBe('true')
    expect(await acceptCode.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(unselected)
    expect(await acceptCode.isDisabled()).toBe(true)
    expect(await keepPrinciple.isDisabled()).toBe(true)
    releaseRefusal.resolve()
    await visible(page.getByText('The answer could not be saved.', { exact: true }))
    expect(await acceptCode.getAttribute('aria-pressed')).toBe('true')
    expect(await acceptCode.isEnabled()).toBe(true)
    expect(await keepPrinciple.isEnabled()).toBe(true)
    await direction.getByLabel('Answer in your own words').fill(` ${ownWords} `)
    await Promise.all([postRequest(), button('Submit own words', direction).click()])
    await direction.waitFor({ state: 'hidden' })
    expect(singlePosts).toEqual([
      expect.objectContaining({ act: 'answer', direction: draft.id, revision: expect.any(String), options: ['A'] }),
      expect.objectContaining({ act: 'answer', direction: draft.id, revision: expect.any(String), options: [{ words: ownWords }] }),
    ])
  } finally {
    releaseRefusal.resolve()
    await page.unrouteAll({ behavior: 'wait' })
  }

  await page.reload()
  await card('Conflict').click()
  const answers = direction.getByRole('form', { name: 'Direction answers' })
  const grouping = answers.locator('.review-question-actions').filter({ hasText: question.says })
  const explaining = answers.locator('.review-question-actions').filter({ hasText: extraQuestion.says })
  await visible(grouping.getByText('Code side', { exact: true }))
  await visible(grouping.getByText('Principle side', { exact: true }))
  expect(await answers.locator('textarea').count()).toBe(2)
  expect(await answers.locator('button[type=submit]').count()).toBe(1)
  expect(await button('Send words', direction).count()).toBe(0)
  expect(await button('Revise', direction).count()).toBe(0)
  expect(await direction.locator('.flow').count()).toBeGreaterThan(0)
  await visible(direction.getByText('bun test', { exact: true }))
  const keep = grouping.getByRole('button', { name: /Keep the principle/ })
  await visible(grouping.getByRole('button', { name: /Accept the code/ }))
  await visible(keep)
  expect(await keep.textContent()).toContain(question.options[1])
  expect(await grouping.locator('.review-pair').first().locator('.review-case').count()).toBe(2)
  expect(await direction.locator('.review-rule h3').filter({ hasText: 'Conflict' }).count()).toBe(2)
  expect(await direction.getByText('No break observed in', { exact: false }).count()).toBe(0)
  await visible(explaining.getByLabel('Answer in your own words'))
  await modalShot('05-direction-conflict.png', direction)
  const submit = button('Submit answers', answers)
  const wordsInput = explaining.getByLabel('Answer in your own words')
  const recordWords = button('Record own words', explaining)
  const submissions = []
  const capture = (req) => {
    if (req.url().endsWith('/api/onboarding') && req.method() === 'POST') submissions.push(req.postDataJSON())
  }
  page.on('request', capture)
  await wordsInput.fill(ownWords)
  await recordWords.click()
  await visible(explaining.getByText('Answer recorded', { exact: true }))
  expect(await recordWords.getAttribute('aria-pressed')).toBe('true')
  expect(await submit.isDisabled()).toBe(true)
  await modalShot('08-direction-two-question-own-words.png', direction)
  await keep.focus()
  await page.keyboard.press('Space')
  expect(await keep.getAttribute('aria-pressed')).toBe('true')
  expect(await submit.isEnabled()).toBe(true)
  await wordsInput.fill('Updated answer')
  expect(await recordWords.getAttribute('aria-pressed')).toBe('false')
  expect(await submit.isDisabled()).toBe(true)
  await wordsInput.fill(ownWords)
  expect(await submit.isDisabled()).toBe(true)
  await recordWords.click()
  expect(submissions).toEqual([])
  await submit.click()
  await visible(card('Re-verifying'))
  page.off('request', capture)
  expect(submissions).toEqual([expect.objectContaining({
    act: 'answer', direction: 'one-thing', revision: expect.any(String), options: ['B', { words: ownWords }],
  })])
  extra.says = ownWords
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
  const summary = direction.locator('.review-summary > p').first()
  expect(await summary.textContent()).toBe('Each section of a TSD keeps to one topic, so a reader finds it fast.')
  await visible(summary.locator('strong').getByText('one topic', { exact: true }))
  await visible(direction.locator('.review-summary > p + .review-direction-words').getByText(draft.says, { exact: true }))
  expect(await direction.locator('.flow-steps').count()).toBe(0)
  const flowStep = direction.locator('.flow-step').first()
  expect(await flowStep.locator('title').textContent()).toContain('docs/tsd.md:3')
  expect(await flowStep.getAttribute('aria-label')).toContain(rule.id)
  await flowStep.focus()
  await page.keyboard.press('Enter')
  await visible(direction.locator('.flow-selection').getByText('docs/tsd.md:3', { exact: true }))
  await page.keyboard.press('Enter')
  const standard = direction.locator('.review-standard summary').first()
  await visible(standard.getByText('Show rules', { exact: true }))
  await standard.focus()
  await page.keyboard.press('Enter')
  await visible(standard.getByText('Hide rules', { exact: true }))
  await visible(direction.getByText('bun test', { exact: true }))
  const pair = direction.locator('.review-pair').first()
  const follows = await pair.locator('.example.follows').boundingBox()
  const breaks = await pair.locator('.example.breaks').boundingBox()
  expect(follows.y).toBe(breaks.y)
  expect(follows.x).toBeLessThan(breaks.x)
  const loneRule = direction.getByRole('region', { name: extra.id })
  await visible(loneRule.getByText('Valid case (made up)', { exact: true }))
  await visible(loneRule.getByText('No break observed in', { exact: false }))
  const lonePair = loneRule.locator('.review-pair')
  expect(await lonePair.locator('.example').count()).toBe(1)
  expect((await lonePair.locator('.review-case-box').boundingBox()).width).toBe((await lonePair.boundingBox()).width)
  await visible(direction.getByRole('textbox', { name: 'What should change?' }))
  expect(await direction.getByText('What should change?', { exact: true }).count()).toBe(0)
  await modalShot('04-direction-modal.png', direction)
  await loneRule.screenshot({ path: join(shots, '06-direction-valid-only.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 420, height: 900 })
  await pair.scrollIntoViewIfNeeded()
  const narrowValid = await pair.locator('.example.follows').boundingBox()
  const narrowInvalid = await pair.locator('.example.breaks').boundingBox()
  expect(narrowValid.x).toBe(narrowInvalid.x)
  expect(narrowValid.y).toBeLessThan(narrowInvalid.y)
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await shot('07-direction-narrow-dark.png')
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.setViewportSize({ width: 1440, height: 900 })
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
  expect(await previewStaffing.getByRole('region', { name: 'Current worker placement' }).textContent())
    .toContain('section-lead')
  expect(await previewStaffing.getByRole('region', { name: 'Proposed worker placement' }).textContent())
    .toContain('section-lead')
  expect(await previewStaffing.getByRole('region', { name: 'After' }).count()).toBe(1)
  expect(readFileSync(staffingPath, 'utf8')).toBe(baseline)
  const comparison = previewStaffing.locator('.staffing-comparison')
  expect(await comparison.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  await shot('05-staffing-preview.png')
  await button('Cancel', previewStaffing).click()

  await button('Edit section-lead').click()
  const placementEdit = dialog('Edit section-lead')
  await placementEdit.getByLabel('Worker group').fill('delivery')
  await button('Preview changes', placementEdit).click()
  const currentPlacement = previewStaffing.getByRole('region', { name: 'Current worker placement' })
  const proposedPlacement = previewStaffing.getByRole('region', { name: 'Proposed worker placement' })
  await visible(proposedPlacement.getByText('delivery', { exact: true }))
  expect(await currentPlacement.getByText('delivery', { exact: true }).count()).toBe(0)
  expect(readFileSync(staffingPath, 'utf8')).toBe(baseline)
  await shot('08-proposed-worker-placement.png')
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
