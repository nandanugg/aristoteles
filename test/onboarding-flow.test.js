import { expect, test } from 'bun:test'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eventsOf } from '../core/actions/fixture.test.ts'
import { foldWork } from '../core/state/c16/fold.ts'
import { acknowledge, aLiveHost, killBootstrap, launchEnv, recordOf } from './activation-fixture.js'
import { startServer } from './code.js'
import { ONBOARD_CONFIG, ONBOARD_DIRECTION, ONBOARD_NEW, ok, onboardingProject } from './harness.js'
import { dbOf, gitPerson } from './outside.js'

const ruleList = (draft) => draft.standards.flatMap(({ rules }) => rules)
const token = (output, who) => {
  const found = output.split(/\s+/).find((part) => part.startsWith(`w.${who}.0.`))
  expect(found).toBeDefined()
  return found
}

test('onboarding hands reviewed project guidance to the activated host and pipeline', async () => {
  const p = onboardingProject()
  gitPerson(p)
  p.realTime()
  const server = startServer({ dir: p.dir, env: { ARISTOTELES_DB: dbOf(p) } })
  const origin = new URL(server.url).origin
  const api = async (path, body) => {
    const response = await fetch(origin + '/api/' + path, body === undefined ? undefined : {
      method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const value = await response.json()
    if (!response.ok) throw new Error(`${path} (${response.status}): ${JSON.stringify(value)}`)
    return value
  }
  const onboarding = () => api('onboarding')
  const person = (body) => api('onboarding', body)
  const dash = () => api('dash')
  const card = async (id) => (await onboarding()).directions.find((item) => item.id === id)
  const role = async (id) => (await onboarding()).roles.find((item) => item.role === id)
  const agent = async (line) => ok(await p.agent(line)).out
  const yaml = (path, value) => p.write(path, Bun.YAML.stringify(value, null, 2))
  const state = () => foldWork(eventsOf(p.dir)).state
  const run = (line) => agent(`${line} --on ${state().seq}`)
  const ask = (kind) => [...state().asks.values()].find((item) =>
    item.kind === kind && (kind !== 'Execute' || item.to._tag === 'Maker')).id
  const read = (path) => readFileSync(join(p.dir, path), 'utf8')

  try {
    expect(await onboarding()).toMatchObject({ stage: 'files', directions: [] })
    p.write('CLAUDE.md', 'Use at most one topic per section.\nRecord the reason.\n')
    p.write('AGENTS.md', 'Group related facts in one section.\n')
    p.write('docs/checks.md', '# Guidance\nCheck the reasons and effects.\n')
    p.write('docs/legacy.md', 'A heading uses two topics.\nThe section lacks a reason.\n')
    const strict = { file: 'CLAUDE.md', line: 1, excerpt: 'Use at most one topic per section.' }
    const grouped = { file: 'AGENTS.md', line: 1, excerpt: 'Group related facts in one section.' }
    const reason = { file: 'CLAUDE.md', line: 2, excerpt: 'Record the reason.' }
    const heading = { file: 'docs/legacy.md', line: 1, excerpt: 'A heading uses two topics.' }
    const noReason = { file: 'docs/legacy.md', line: 2, excerpt: 'The section lacks a reason.' }
    const scope = { searched: ['docs/'], unknown: ['generated reports'] }
    const sources = [strict, grouped, reason]
    yaml('survey.yaml', { scope, sources, summary: 'The repository produces design documents.', app: null })
    await agent('onboard discovery --file=survey.yaml')
    expect((await onboarding()).discovery).toEqual({
      summary: 'The repository produces design documents.',
      read: ['CLAUDE.md:1', 'AGENTS.md:1', 'CLAUDE.md:2'], notSearched: ['generated reports'], app: null,
    })

    const config = Bun.YAML.parse(ONBOARD_CONFIG.replace('    icon: compass', '    pipeline: true\n    icon: compass'))
    config.roles.linter.questions = [{ says: 'Who checks the checker?', choices: ['The host', 'The writer'] }]
    yaml('draft-config.yaml', config)
    await agent('onboard config --file=draft-config.yaml')
    await agent('onboard found one-thing')
    yaml('sources.yaml', { questions: [{
      says: 'Which scope governs related facts?',
      options: [strict.excerpt, grouped.excerpt],
      target: { _tag: 'Candidates', topic: 'headings',
        a: { words: strict.excerpt, source: strict }, b: { words: grouped.excerpt, source: grouped } },
    }] })
    await agent('onboard ask one-thing --file=sources.yaml')
    const competing = await card('one-thing')
    expect(competing).toMatchObject({ state: 'question', open: [{
      sides: [{ source: 'CLAUDE.md:1' }, { source: 'AGENTS.md:1' }],
    }] })
    expect(competing.draft).toBeUndefined()
    const custom = 'Group closely related facts under one topic.'
    await person({ act: 'answer', direction: competing.id, revision: competing.revision, options: [{ words: custom }] })
    expect(await card(competing.id)).toMatchObject({ state: 'loading', why: 'answered', answered: [{ answer: { words: custom } }] })
    const chosen = Bun.YAML.parse(ONBOARD_NEW)
    chosen.says = custom
    chosen.discovery = { scope, sources: [strict, grouped] }
    yaml('chosen.yaml', chosen)
    await agent(`onboard draft one-thing --file=chosen.yaml --revision=${competing.revision}`)
    expect(await card(competing.id)).toMatchObject({ state: 'ready', draft: { says: custom } })

    await agent('onboard found tsd-writing')
    const draft = Bun.YAML.parse(ONBOARD_DIRECTION)
    const [codeRule, principleRule] = ruleList(draft)
    const deviation = (rule, code, stated) => {
      rule.ref = 'docs/checks.md#guidance:1-2'
      rule.evidence = {
        scope, cases: [{ fit: 'Breaks', output: code }], knownBreaks: [],
        check: { _tag: 'Reference', checker: 'linter', result: 'An existing case breaks the rule.' },
      }
      return { says: `Which rule governs ${rule.id}?`, options: [code.excerpt, stated.excerpt],
        target: { _tag: 'Deviation', rule: rule.id,
          code: { words: code.excerpt, source: code }, principle: { words: stated.excerpt, source: stated } } }
    }
    draft.questions = [deviation(codeRule, heading, strict), deviation(principleRule, noReason, reason)]
    yaml('conflicts.yaml', draft)
    await agent('onboard draft tsd-writing --file=conflicts.yaml')
    const conflicts = await card('tsd-writing')
    expect(conflicts).toMatchObject({ state: 'question', open: [
      { rule: codeRule.id, sides: [{ source: 'docs/legacy.md:1' }, { source: 'CLAUDE.md:1' }] },
      { rule: principleRule.id, sides: [{ source: 'docs/legacy.md:2' }, { source: 'CLAUDE.md:2' }] },
    ] })
    await person({ act: 'answer', direction: conflicts.id, revision: conflicts.revision, options: ['A', 'B'] })
    expect(await card(conflicts.id)).toMatchObject({ state: 'loading', why: 'answered', answered: [{ answer: 'A' }, { answer: 'B' }] })
    codeRule.says = draft.questions[0].options[0]
    codeRule.evidence.cases[0].fit = 'Follows'
    codeRule.evidence.check.result = 'The code satisfies the adopted rule.'
    principleRule.says = draft.questions[1].options[1]
    principleRule.evidence.knownBreaks = [noReason]
    delete draft.questions
    yaml('conflicts.yaml', draft)
    await agent(`onboard draft tsd-writing --file=conflicts.yaml --revision=${conflicts.revision}`)
    const ready = await card(conflicts.id)
    expect(ruleList(ready.draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: codeRule.id, knownBreak: false, examples: [expect.objectContaining({ fit: 'Follows' })] }),
      expect.objectContaining({ id: principleRule.id, knownBreak: true, examples: [expect.objectContaining({ fit: 'Breaks' })] }),
    ]))
    expect(ready.draft.flow.every((step) => !('examples' in step))).toBe(true)
    await agent('onboard found unused')
    const unused = Bun.YAML.parse(ONBOARD_NEW.replaceAll('one-thing', 'unused'))
    yaml('unused.yaml', unused)
    await agent('onboard draft unused --file=unused.yaml')
    await person({ act: 'revise', direction: 'unused', words: 'Remove this direction.' })
    await agent('onboard removed unused')
    expect(await card('unused')).toMatchObject({ state: 'removed' })
    const reviewed = (await onboarding()).directions.filter(({ state }) => state === 'ready')
      .map(({ id, revision }) => ({ id, revision }))
    await person({ act: 'approve-all-directions', reviewed })
    expect((await onboarding()).directions.map(({ state }) => state)).toEqual(['accepted', 'accepted', 'removed'])

    expect(await role('linter')).toMatchObject({ state: 'waiting', questions: [{ says: 'Who checks the checker?' }] })
    await person({ act: 'revise-role', role: 'linter', words: 'Who checks the checker?\nThe host' })
    expect(await role('linter')).toMatchObject({ request: 'Who checks the checker?\nThe host' })
    const linter = { ...config.roles.linter }
    delete linter.questions
    for (const key of ['model', 'persistence']) delete linter[key]
    yaml('linter.yaml', linter)
    await agent('onboard role linter --file=linter.yaml')
    expect(await role('linter')).toMatchObject({ request: null, state: 'waiting' })

    const request = 'Review accessibility on release.'
    await person({ act: 'add-role', words: request })
    const [pending] = (await onboarding()).roleRequests
    expect(pending.words).toBe(request)
    expect(await agent('onboard wait --seconds=1')).toContain(request)
    yaml('accessibility.yaml', {
      ...linter, summary: request, description: 'Checks release accessibility.',
      intro: 'Review the release evidence.', responsibilities: ['Report a release accessibility check.'],
    })
    await agent(`onboard role ${pending.role} --file=accessibility.yaml`)
    const beforeRoles = await onboarding()
    expect(beforeRoles.roleRequests ?? []).toEqual([])
    expect(beforeRoles.roles.find(({ role }) => role === pending.role)).toMatchObject({ summary: request })
    await person({ act: 'review-all-roles', reviewed: beforeRoles.roles.map(({ role, revision }) => ({ id: role, revision })) })
    expect((await onboarding()).roles.every((item) => item.state === 'accepted')).toBe(true)

    aLiveHost(p)
    const staffingFile = '.work/staffing.yaml'
    const arrangement = Bun.YAML.parse(read(staffingFile))
    arrangement.roles[pending.role] = { ...arrangement.roles.linter }
    arrangement.accounts.fixture.limits = { weekly: ' 40 jobs per week ', sessions: '2 sessions' }
    yaml(staffingFile, arrangement)
    const staffing = await api('staffing')
    expect(staffing.confirmed).toBe(false)
    const typed = ' 50 jobs per week '
    const preview = await api('staffing', { action: 'preview', revision: staffing.revision,
      edit: { kind: 'limit', account: 'fixture', limit: 'weekly', typed } })
    expect(preview.before.consequences).toEqual(expect.arrayContaining([expect.objectContaining({ limit: 'weekly', typed: ' 40 jobs per week ' })]))
    expect(preview.after.consequences).toEqual(expect.arrayContaining([expect.objectContaining({ limit: 'weekly', typed })]))
    expect(Bun.YAML.parse(read(staffingFile)).accounts.fixture.limits.weekly).toBe(' 40 jobs per week ')
    expect(await api('staffing', { action: 'apply', ticket: preview.ticket })).toMatchObject({ confirmed: true })
    expect(Bun.YAML.parse(read(staffingFile)).accounts.fixture.limits.weekly).toBe(typed)

    const approval = await api('activation/approval')
    expect(approval.entries.map(({ path }) => path)).toEqual(expect.arrayContaining(['CLAUDE.md', 'AGENTS.md']))
    await api('activation', { action: 'start', entries: approval.entries })
    expect((await dash()).activation.phase).toBe('activating')
    expect(read('CLAUDE.md')).toContain('aristoteles-marker')
    expect(read('AGENTS.md')).toContain('aristoteles-marker')
    const boot = await acknowledge(p, recordOf(p))
    expect((await dash()).activation.phase).toBe('activating')
    ok(await p.nanda('activation resume'))
    expect((await dash()).activation.phase).toBe('active')
    expect(eventsOf(p.dir).some(({ event }) => event.move?._tag === 'Activated')).toBe(true)
    const active = await onboarding()
    expect(active.stage).toBe('store')
    expect(active.directions.map(({ id }) => id).sort()).toEqual(['one-thing', 'tsd-writing'])
    expect(ruleList(active.directions.find(({ id }) => id === conflicts.id).draft)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: principleRule.id, knownBreak: true })]))
    const host = token(ok(await p.run(`wait --launch ${boot.pending.launch} --seconds=0.01`, {
      env: launchEnv(p, boot),
    })).out, 'host')
    expect(JSON.stringify(await dash())).not.toContain(host)

    const opened = ok(await p.nanda('top open --name="Export design" --goal="Explain the export" --sections=introduction')).out
    const pipe = token(opened, 'pipe')
    const lead = token(opened, 'role:section-lead')
    expect(await agent(`wait ${host} --seconds=1`)).toContain('work send')
    expect(recordOf(p).retired).toBe(true)
    expect((await dash()).directions.map(({ name }) => name)).toContain('TSD writing')
    await agent(`send ${host} --name="Introduction" --goal="Explain the export" --sections=introduction --role=section-lead`)
    expect((await dash()).columns).toEqual(expect.arrayContaining([expect.objectContaining({ task: expect.objectContaining({ id: 't1', state: 'QUEUED' }) })]))
    const maker = token(await agent(`assign ${lead} t1`), 'maker:m1')
    await agent(`brief ${maker}`)
    await run(`report ${maker} ${ask('Execute')} --output="Introduction explains the export"`)
    expect((await dash()).columns).toEqual(expect.arrayContaining([expect.objectContaining({ task: expect.objectContaining({ id: 't1', reject: true }) })]))
    const review = await agent(`wait ${lead} --seconds=1`)
    expect(review).toContain('Known break of')
    expect(review).toContain('docs/legacy.md:2')
    await run(`review ${lead} ${ask('Check')} pass`)

    const beforeEdit = await dash()
    const direction = beforeEdit.directions.find(({ name }) => name === 'TSD writing')
    const [std] = direction.standards
    const edit = { ...direction.rec, says: 'Explain the export and its effect.' }
    const write = { id: 'explain-impact', standard: std.key, says: 'State the resulting effect.',
      ref: 'docs/checks.md#guidance:2' }
    yaml('edit.yaml', { [direction.key]: edit })
    const editBasis = state().seq
    ok(await p.nanda(`ask-edit --file=edit.yaml --on ${editBasis}`))
    expect((await dash()).row).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'edit', status: 'IN_PIPELINE' })]))
    await run(`advance ${pipe} edit`)
    await run(`advance ${pipe} edit`)
    yaml('new-rule.yaml', write)
    await run(`rule ${pipe} edit new-rule.yaml`)
    yaml('ship.yaml', { [direction.key]: edit, 'rule:explain-impact': { ...write, parent: std.key } })
    await run(`ship ${pipe} edit ship.yaml`)
    expect(await agent(`wait ${pipe} --seconds=1`)).toContain('one before/after example')
    await run(`loop ${pipe} edit person --mode="self-review turns"`)
    const decision = (await dash()).row.find(({ id }) => id === 'edit')
    expect(decision).toMatchObject({ status: 'WAIT_FOR_REVIEW', reviewMode: 'self-review turns' })
    ok(await p.nanda(`respond ${decision.ask} accept --on ${state().seq}`))
    await agent(`reassign ${host}`)
    const told = await agent(`wait ${pipe} --seconds=1`)
    expect(told).toContain('recheck-brief t1')
    const basis = state().seq
    const brief = await agent(`recheck-brief t1 --on ${basis}`)
    expect(brief).toContain(`${direction.key} @1: Explain the export and its effect.`)
    expect(brief).toContain('rule:explain-impact @1: State the resulting effect.')
    expect((await dash()).pipe.work).toContain('Rechecking')
    await agent(`recheck ${pipe} t1 holds --items=${direction.key},rule:explain-impact --on ${basis}`)
    expect(state().tasks.get('t1').pending.size).toBe(0)
    expect((await dash()).pipe.work).not.toContain('Rechecking')
    expect(eventsOf(p.dir).at(-1).event.create.act.body).toMatchObject({
      _tag: 'RecheckDone', items: new Set([direction.key, 'rule:explain-impact']),
    })
  } finally {
    server.stop()
    killBootstrap(p)
    rmSync(p.dir, { recursive: true, force: true })
  }
}, 90000)
