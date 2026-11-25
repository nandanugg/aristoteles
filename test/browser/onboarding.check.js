import { expect } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
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
  .concat(`  document-judge:
    model: sonnet
    description: Judges the assembled document.
    intro: Review the assembled document.
    responsibilities: [Read the assembled document.]
    acts: [{ review: [writer] }]
    persistence: { persistent: true, why: It reviews the whole project. }
    icon: compass
    summary: Judges the assembled document.
`)
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
  ref: 'docs/grouping-check.md#grouping:3-4',
  evidence: { ...rule.evidence, cases: [{ fit: 'Follows', input: { written: 'Describe how the sections are grouped.' },
    output: { written: 'Name groups by topic.' } }], check: { _tag: 'Reference', checker: 'linter', result: 'Reviewed grouping.' } },
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
  const checkPrompt = direction.getByRole('region', { name: extra.id }).locator('.rule-check')
  await visible(checkPrompt.getByText('Check prompt', { exact: true }))
  await visible(checkPrompt.getByText(extra.ref, { exact: true }))
  await visible(checkPrompt.getByText('Checker · linter', { exact: true }))
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
  const sharedFile = { file: 'docs/grouping-check.md', line: 3, excerpt: 'Check that each heading names its topic.' }
  const sharedInstruction = { written: 'Check how this document separates topics.' }
  const writtenCase = (fit, written, input, mark) => ({ fit, output: { written, ...(mark && { mark }) }, input })
  const passExcerpt = '## Watering\nWater twice a week.'
  const failExcerpt = '# Second title'
  const explicitPass = writtenCase('Follows', `# Plant Watering Memo\n${passExcerpt}\nOwner: Garden team.`,
    sharedInstruction, passExcerpt)
  const explicitFail = writtenCase('Breaks', `# Plant Watering Memo\n${failExcerpt}\nWater twice a week.\nOwner: Plant team.`,
    sharedInstruction, failExcerpt)
  const memo = [
    '# Plant Watering Memo', '## Summary', 'Watering moves to Thursday.', '## Details',
    '### Background', 'Ferns dry out on Fridays.', '### Option 1', 'Water twice a week.',
    '## Sign-off', '[Sign-off pending]', '<!-- Aristoteles example doctype: memo -->',
  ].join('\n\n')
  const memoWithSecondTitle = memo.replace('Watering moves to Thursday.', `${failExcerpt}\n\nWatering moves to Thursday.`)
  rule.evidence.cases = [
    { ...rule.evidence.cases[0], input: sharedFile },
    { ...rule.evidence.cases[2], input: sharedFile },
    { ...rule.evidence.cases[1], input: principle },
    { fit: 'Breaks', input: { file: 'docs/facts.md', line: 5, excerpt: 'The export ran twice' }, output: code },
    explicitPass,
    explicitFail,
    writtenCase('Follows', memo),
    writtenCase('Breaks', memoWithSecondTitle),
    writtenCase('Follows', 'Heading\nOne topic.\nEnd'),
    writtenCase('Breaks', 'Heading\nTwo topics.\nEnd'),
  ]
  const prompt = `${sharedFile.excerpt}\nFlag any sections that combine topics.`
  p.write(sharedFile.file, `# Grouping\n\n${prompt}\n\nThis line is outside the reference.\n`)
  explicitFail.output.mark = 'Absent from the memo'
  p.write('bad-mark.yaml', Bun.YAML.stringify(draft))
  const refusedMark = await p.agent(`onboard draft one-thing --file=bad-mark.yaml --revision=${revision}`)
  expect(refusedMark.code).toBe(1)
  expect(refusedMark.err).toContain('mark must appear in the written sample')
  explicitFail.output.mark = failExcerpt
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
  const expectModalWidth = async () => {
    // A modal over the dashboard: wide, with the dashboard still showing around it.
    const box = await direction.boundingBox()
    const viewport = page.viewportSize().width
    if (viewport <= 720) {
      expect(box.width).toBe(viewport - 32)
      expect(box.x).toBe(16)
    } else {
      expect(box.width).toBe(Math.min(1280, viewport - 96))
      expect(box.x).toBeGreaterThanOrEqual(48)
    }
  }
  await expectModalWidth()
  const backdrop = await direction.locator('..').evaluate((back) => getComputedStyle(back).backgroundColor)
  expect(backdrop).toMatch(/^rgba\(.*, 0\.\d+\)$/)
  await visible(direction.getByText('Test command', { exact: true }))
  await visible(direction.getByText('bun test', { exact: true }))
  expect(await checkPrompt.locator('pre').textContent()).toBe(prompt)
  expect(await checkPrompt.getByText(extra.ref, { exact: true }).count()).toBe(0)
  const pairs = direction.getByRole('region', { name: rule.id }).locator('.review-rule-case-pair')
  const sharedPair = pairs.nth(0)
  const differentPair = pairs.nth(1)
  const sharedInput = sharedPair.locator('.review-case-input')
  const differentInputs = differentPair.locator('.review-case-input .review-case-box')
  const outputs = (pair) => pair.locator('.review-case-outputs .review-case-box')
  const expectOnSameRow = async (boxes) => {
    const left = await boxes.first().boundingBox()
    const right = await boxes.last().boundingBox()
    expect(left.y).toBe(right.y)
    expect(left.x).toBeLessThan(right.x)
  }
  expect(await sharedInput.locator('.sample').count()).toBe(1)
  await visible(sharedInput.getByText(`${sharedFile.file}:${sharedFile.line}`, { exact: true }))
  expect((await sharedInput.boundingBox()).width).toBe((await sharedPair.boundingBox()).width)
  await visible(sharedPair.getByText('Output that passes', { exact: true }))
  await visible(sharedPair.getByText('Output that fails', { exact: true }))
  await visible(outputs(sharedPair).last().getByText('made up', { exact: true }))
  expect((await sharedInput.boundingBox()).y).toBeLessThan((await outputs(sharedPair).first().boundingBox()).y)
  await expectOnSameRow(outputs(sharedPair))
  await visible(differentInputs.first().getByText('docs/facts.md:3', { exact: true }))
  await visible(differentInputs.last().getByText('docs/facts.md:5', { exact: true }))
  await expectOnSameRow(differentInputs)
  await expectOnSameRow(outputs(differentPair))
  expect(await pairs.nth(2).locator('.review-case-input .sample').count()).toBe(1)
  await visible(pairs.nth(2).getByText(sharedInstruction.written, { exact: true }))
  expect(await pairs.nth(3).locator('.review-case-input').count()).toBe(0)
  const markedLines = (box) => box.locator('.sample-code .line.mark')
  const markedText = (box) => markedLines(box).locator('.t').allTextContents()
  const markedNumbers = (box) => markedLines(box).locator('.ln').allTextContents()
  const explicitPair = pairs.nth(2)
  const explicitOutputs = outputs(explicitPair)
  const diffPair = pairs.nth(3)
  const diffOutputs = outputs(diffPair)
  const realOutputs = outputs(differentPair)
  expect(await markedText(explicitOutputs.first())).toEqual(passExcerpt.split('\n'))
  expect(await markedNumbers(explicitOutputs.first())).toEqual(['2', '3'])
  expect(await markedText(explicitOutputs.last())).toEqual([failExcerpt])
  expect(await markedNumbers(explicitOutputs.last())).toEqual(['2'])
  expect(await markedText(diffOutputs.first())).toEqual([])
  expect((await markedText(diffOutputs.last())).filter((line) => line.trim())).toEqual([failExcerpt])
  expect(await markedNumbers(diffOutputs.last())).toContain('5')
  const changedOutputs = outputs(pairs.nth(4))
  expect(await markedText(changedOutputs.first())).toEqual(['One topic.'])
  expect(await markedText(changedOutputs.last())).toEqual(['Two topics.'])
  expect(await markedText(realOutputs.first())).toEqual(['## Design'])
  expect(await markedText(realOutputs.last())).toEqual([code.excerpt])
  const markColor = (box) => markedLines(box).first().evaluate((line) => getComputedStyle(line).backgroundColor)
  expect(await markColor(realOutputs.first())).toBe('rgb(236, 253, 243)')
  expect(await markColor(realOutputs.last())).toBe('rgb(254, 243, 242)')
  expect(await markColor(explicitOutputs.first())).toBe(await markColor(realOutputs.first()))
  expect(await markColor(explicitOutputs.last())).toBe(await markColor(realOutputs.last()))
  expect(await markColor(diffOutputs.last())).toBe(await markColor(realOutputs.last()))
  const loneRule = direction.getByRole('region', { name: extra.id })
  await visible(loneRule.getByText('Output that passes', { exact: true }))
  await visible(loneRule.getByText('No break observed in', { exact: false }))
  const lonePair = loneRule.locator('.review-rule-case-pair')
  await visible(lonePair.getByText('Input', { exact: true }))
  expect(await outputs(lonePair).count()).toBe(1)
  expect(await markedText(outputs(lonePair))).toEqual([])
  expect((await outputs(lonePair).boundingBox()).width).toBe((await lonePair.boundingBox()).width)
  await visible(direction.getByRole('textbox', { name: 'What should change?' }))
  expect(await direction.getByText('What should change?', { exact: true }).count()).toBe(0)
  await sharedPair.scrollIntoViewIfNeeded()
  await shot('04-direction-shared-input.png')
  await differentPair.scrollIntoViewIfNeeded()
  await shot('05-direction-differing-inputs.png')
  await loneRule.screenshot({ path: join(shots, '06-direction-valid-only.png'), animations: 'disabled' })
  const caseShot = (name, scope) => scope.screenshot({ path: join(shots, name), animations: 'disabled' })
  await caseShot('r52-explicit-marks.png', explicitPair.locator('.review-case-outputs'))
  await caseShot('r52-plant-memo-diff.png', diffPair.locator('.review-case-outputs'))
  await caseShot('r52-real-spot-pair.png', differentPair.locator('.review-case-outputs'))
  await page.setViewportSize({ width: 420, height: 900 })
  await expectModalWidth()
  await differentPair.scrollIntoViewIfNeeded()
  const expectStacked = async (boxes) => {
    const top = await boxes.first().boundingBox()
    const bottom = await boxes.last().boundingBox()
    expect(top.x).toBe(bottom.x)
    expect(top.y).toBeLessThan(bottom.y)
  }
  await expectStacked(differentInputs)
  await expectStacked(outputs(differentPair))
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await shot('07-direction-narrow-dark.png')
  await expectStacked(explicitOutputs)
  await caseShot('r52-narrow-dark.png', explicitPair.locator('.review-case-outputs'))
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
  const staffingPath = join(p.dir, '.work/staffing.yaml')
  const proposalPath = join(p.dir, '.work/onboarding/staffing-proposal.yaml')
  const staffing = Bun.YAML.parse(readFileSync(staffingPath, 'utf8'))
  rmSync(staffingPath)
  await button('Accept all').click()
  await visible(page.getByRole('heading', { name: 'Staffing' }))
  const stage = page.getByRole('region', { name: 'Staffing', exact: true })
  const staff = (id) => stage.getByRole('article', { name: `Staff ${id}`, exact: true })
  const select = (role) => stage.getByRole('combobox', { name: `Staff for ${role}` })
  const arrows = stage.locator('[data-arrow-role]')
  const staffingShot = async (name) => {
    const viewport = page.viewportSize()
    await page.setViewportSize({ ...viewport, height: 1580 })
    await page.locator('.canvas').evaluate((element) => { element.scrollTop = 0 })
    try { await shot(name) } finally { await page.setViewportSize(viewport) }
  }
  await visible(stage.getByText('No subscriptions added.'))
  expect(await select('architect').inputValue()).toBe('architect')
  const roleIds = ['architect', 'section-lead', 'writer', 'linter', 'document-judge']
  const everyRole = async () => {
    expect((await arrows.evaluateAll((els) => els.map((e) => e.getAttribute('data-arrow-role')))).sort()).toEqual([...roleIds].sort())
  }
  await everyRole()
  expect(ok(await p.agent('onboard show staffing')).out).toContain('No measured project baseline.')
  await button('Accept all', stage).click()
  await visible(stage.getByRole('alert').getByText(/launch command/))
  expect(await stage.getByRole('alert').count()).toBe(1)
  expect(existsSync(staffingPath)).toBe(false)

  const launch = 'claude --model {model} --session-id {session}'
  const basis = 'Three sections, two review tries, and 144 five-hour windows per month.'
  staffing.accounts = {
    personal: { provider: 'Claude', plan: 'Pro', limits: {}, estimate: { share: 0.25, basis } },
    backup: { provider: 'Claude', plan: 'Max', limits: {} },
  }
  staffing.clis = { claude: { backgroundChildren: true, canPark: false } }
  for (const role of Object.values(staffing.roles)) Object.assign(role, { cli: 'claude', account: 'personal', launch })
  staffing.roles.writer.subagentOf = 'section-lead'
  staffing.roles.linter.subagentOf = 'architect'
  staffing.roles.architect.subagentAllowance = 1
  staffing.roles['section-lead'].subagentAllowance = 3
  p.write('staffing-input.yaml', Bun.YAML.stringify(staffing))
  const missing = structuredClone(staffing)
  delete missing.roles.writer
  p.write('staffing-invalid.yaml', Bun.YAML.stringify(missing))
  const refused = await p.agent('onboard staffing --file=staffing-invalid.yaml')
  expect(refused.err).toContain('roles.writer needs a staffing binding')
  const refusalPage = await browser.newPage({ viewport: { width: 950, height: 280 } })
  try {
    await refusalPage.setContent('<pre style="margin: 28px; line-height: 1.65; white-space: pre-wrap"></pre>')
    await refusalPage.locator('pre').evaluate((element, output) => { element.textContent = output },
      `$ work onboard staffing --file=staffing-invalid.yaml
${refused.err}`)
    await refusalPage.screenshot({ path: join(shots, 'r57-05-refused-proposal.png') })
  } finally { await refusalPage.close() }
  const extraStaffing = structuredClone(staffing)
  extraStaffing.roles.unknown = { ...extraStaffing.roles.writer }
  p.write('staffing-invalid.yaml', Bun.YAML.stringify(extraStaffing))
  expect((await p.agent('onboard staffing --file=staffing-invalid.yaml')).err).toContain('names an unknown role')
  const wrongProvider = structuredClone(staffing)
  wrongProvider.accounts.personal.provider = 'ChatGPT'
  p.write('staffing-invalid.yaml', Bun.YAML.stringify(wrongProvider))
  expect((await p.agent('onboard staffing --file=staffing-invalid.yaml')).err).toContain('CLI must match')
  const missingArrow = structuredClone(staffing)
  delete missingArrow.roles.writer.subagentOf
  p.write('staffing-invalid.yaml', Bun.YAML.stringify(missingArrow))
  expect((await p.agent('onboard staffing --file=staffing-invalid.yaml')).err).toContain('needs a staff card in subagentOf')
  expect(existsSync(proposalPath)).toBe(false)
  await everyRole()
  ok(await p.agent('onboard staffing --file=staffing-input.yaml'))
  await visible(stage.getByText('Host’s proposed arrangement'))
  await everyRole()
  const staffingUrl = new URL('/api/staffing', server.url)
  const current = await (await fetch(staffingUrl)).json()
  const incomplete = { ...current.arrangement, assignments: current.arrangement.assignments.slice(1) }
  const blocked = await fetch(staffingUrl, {
    method: 'POST', headers: { origin: staffingUrl.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'accept', revision: current.revision, arrangement: incomplete }),
  })
  expect(blocked.ok).toBe(false)
  expect((await blocked.json()).error).toContain('Assign every configured role')
  expect(existsSync(staffingPath)).toBe(false)
  expect(await stage.locator('[data-arrow-label="writer"]').textContent()).toBe('as subagent')
  expect(await stage.locator('[data-arrow-label="linter"]').textContent()).toBe('as subagent')
  expect(await select('writer').inputValue()).toBe('section-lead')
  expect(await staff('section-lead').getByRole('list', { name: 'Assigned roles' }).textContent()).toContain('writer')
  const costRow = (id) => stage.locator(`[data-subscription="${id}"]`)
  await visible(costRow('personal').getByText('25% of one 5-hour window'))
  await visible(costRow('personal').getByText(basis, { exact: false }))
  await visible(costRow('backup').getByText('No estimate'))
  expect(await costRow('backup').getByRole('meter').count()).toBe(0)
  await staffingShot('r57-01-five-roles.png')
  await costRow('personal').screenshot({ path: join(shots, 'r57-02-estimate.png') })
  await costRow('backup').screenshot({ path: join(shots, 'r57-03-no-estimate.png') })

  const subscription = (id) => staff(id).getByRole('combobox', { name: 'Subscription' })
  const choices = await subscription('architect').locator('option:not([disabled])').evaluateAll((options) => options.map((item) => item.value))
  const rows = await stage.locator('[data-subscription]').evaluateAll((items) => items.map((item) => item.dataset.subscription))
  expect(choices).toEqual(rows)
  // Show the native select’s actual options in the capture, including the cost rows above it.
  const chooser = staff('architect').locator('select')
  await chooser.evaluate((select) => { select.size = select.options.length })
  try { await staffingShot('r57-04-subscription-select.png') }
  finally { await chooser.evaluate((select) => { select.removeAttribute('size') }) }

  await select('writer').selectOption('document-judge')
  expect(await staff('document-judge').getByRole('list', { name: 'Assigned roles' }).textContent()).toContain('writer')
  await everyRole()
  await button('New staff', stage).click()
  await visible(staff('staff-1'))
  await select('section-lead').selectOption('staff-1')
  expect(await staff('staff-1').getByLabel('Allowed subagents for staff-1', { exact: true }).textContent()).toBe('3')
  await staff('staff-1').getByLabel('Model', { exact: true }).fill('sonnet')
  await staff('staff-1').getByLabel('Launch command').fill(launch)
  await button('Remove section-lead', stage).click()
  const remove = dialog('Remove empty staff?')
  await visible(remove)
  await button('Remove staff', remove).click()
  expect(existsSync(staffingPath)).toBe(false)

  const consult = button('Consult', stage)
  expect(await consult.isDisabled()).toBe(true)
  const consultQuestion = 'Can we share one staff and allow four subagents?'
  await stage.getByRole('textbox', { name: 'Staffing question' }).fill(consultQuestion)
  await consult.click()
  await visible(stage.getByText('Waiting for the host to reply.'))
  expect(ok(await p.agent('onboard wait --seconds=1')).out).toContain(consultQuestion)
  const show = ok(await p.agent('onboard show staffing')).out
  expect(show).toContain(consultQuestion)
  expect(show).toContain('"staff-1"')
  const consultRevision = show.match(/--revision=([\w-]+)/)[1]
  const group = 'project-staff'
  for (const name of ['architect', 'section-lead']) {
    Object.assign(staffing.roles[name], { workerGroup: group, model: 'sonnet', concurrency: 4, subagentAllowance: 4 })
  }
  staffing.roles.linter.subagentOf = group
  staffing.roles.writer.subagentOf = group
  p.write('staffing-input.yaml', Bun.YAML.stringify(staffing))
  expect((await p.agent('onboard staffing --file=staffing-input.yaml --revision=old')).err).toContain('question changed')
  const reply = 'Yes. One session should cover both roles.'
  ok(await p.agent(`onboard staffing --file=staffing-input.yaml --revision=${consultRevision} --reply="${reply}"`))
  await visible(stage.getByText(reply))
  await visible(staff(group))
  expect(await select('section-lead').inputValue()).toBe(group)
  expect(existsSync(staffingPath)).toBe(false)

  await button('Add subscription', stage).click()
  const sub = dialog('Add subscription')
  await sub.getByLabel('Provider').selectOption('ChatGPT')
  await sub.getByLabel('Plan').fill('Plus')
  await button('Add subscription', sub).click()
  await visible(costRow('chatgpt-plus').getByText('No estimate'))
  expect(await subscription(group).locator('option[value="chatgpt-plus"]').count()).toBe(0)
  await subscription(group).selectOption('backup')
  await select('writer').selectOption('document-judge')
  await button('Accept all', stage).click()
  await visible(stage.getByText('Saved to .work/staffing.yaml'))
  const arranged = Bun.YAML.parse(readFileSync(staffingPath, 'utf8'))
  expect(Object.keys(arranged.accounts).sort()).toEqual(['backup', 'chatgpt-plus', 'personal'])
  expect(arranged.accounts.backup.estimate).toBeUndefined()
  expect(arranged.accounts.personal.estimate).toEqual({ share: 0.25, basis })
  expect(arranged.roles.writer).toMatchObject({ persistent: false, subagentOf: 'document-judge', account: 'personal' })
  expect(arranged.roles.linter).toMatchObject({ persistent: false, subagentOf: group, account: 'backup' })
  for (const name of ['architect', 'section-lead']) {
    expect(arranged.roles[name]).toMatchObject({ account: 'backup', cli: 'claude', workerGroup: group,
      concurrency: 4, subagentAllowance: 4 })
  }
  await page.getByRole('tab', { name: 'Roles' }).click()
  await visible(card('Pipeline role').getByText('Allowed subagents · 4'))
  await page.getByRole('tab', { name: 'Staffing' }).click()
  expect(await select('writer').inputValue()).toBe('document-judge')
  await everyRole()
  await button('Review activation').click()
  await visible(dialog('Review activation'))
  await button('Cancel', dialog('Review activation')).click()
  // A new host proposal after an acceptance can replace an estimate with no estimate.
  delete arranged.accounts.personal.estimate
  p.write('staffing-input.yaml', Bun.YAML.stringify(arranged))
  ok(await p.agent('onboard staffing --file=staffing-input.yaml'))
  await visible(costRow('personal').getByText('No estimate'))
  await visible(button('Accept all', stage))
  expect(Bun.YAML.parse(readFileSync(staffingPath, 'utf8')).accounts.personal.estimate).toEqual({ share: 0.25, basis })
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
