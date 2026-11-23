import { cliSession } from '../core/services/index.ts'
import { foldRechecks } from '../core/state/rechecks.ts'
import { foldRuntime } from '../core/state/worker-runtime.ts'
import { recheckPumpIn, workerIn, workerTurn } from './worker-fixture.js'
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

test.each(['child', 'park', 'defer'])('onboarding hands reviewed guidance through a %s recheck', async (route) => {
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
    if (route === 'child') {
      arrangement.clis.fixture.backgroundChildren = true
      arrangement.roles.architect.subagentAllowance = 1
    }
    if (route === 'park') {
      arrangement.clis.fixture.canPark = true
      arrangement.models.opus.resume = 'fixture --resume {session} {prompt}'
    }
    arrangement.accounts.fixture.limits = { weekly: ' 40 jobs per week ', sessions: '2 sessions' }
    arrangement.accounts.fixture.sessionLimit = 2
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
    // a limit edit keeps the account's session limit; a sessions edit shows in the preview (pass 9)
    expect(Bun.YAML.parse(read(staffingFile)).accounts.fixture.sessionLimit).toBe(2)
    const now = await api('staffing')
    const sessions = await api('staffing', { action: 'preview', revision: now.revision,
      edit: { kind: 'sessions', account: 'fixture', sessionLimit: null } })
    expect(sessions.changed).toEqual(['sessions fixture: 2 -> no limit'])
    expect(sessions.after.accounts.find((a) => a.account === 'fixture').sessionLimit).toBeNull()
    // a staffedGroup persistent role made disposable: its group must go with it (44b finding 2)
    const staffedGroup = Bun.YAML.parse(read(staffingFile))
    const persistentRole = Object.entries(staffedGroup.roles).find(([, r]) => r.persistent)
    staffedGroup.roles[persistentRole[0]].workerGroup = 'pair'
    yaml(staffingFile, staffedGroup)
    const groupState = await api('staffing')
    const base = groupState.view.arrangement.find((r) => r.role === persistentRole[0])
    const roleEdit = { kind: 'role', role: base.role, account: base.account, cli: base.cli, model: base.model,
      persistent: false, concurrency: base.concurrency, subagentAllowance: base.subagentAllowance }
    await expect(api('staffing', { action: 'preview', revision: groupState.revision, edit: { ...roleEdit, workerGroup: 'pair' } }))
      .rejects.toThrow('only a persistent role runs on a worker')
    const cleared = await api('staffing', { action: 'preview', revision: groupState.revision, edit: { ...roleEdit, workerGroup: null } })
    expect(cleared.changed).toContain(`${base.role}.persistent: true -> false`)
    expect(cleared.after.arrangement.find((r) => r.role === base.role).workerGroup).toBeNull()
    delete staffedGroup.roles[persistentRole[0]].workerGroup
    yaml(staffingFile, staffedGroup)

    const restored = await api('staffing')
    const finalPreview = await api('staffing', { action: 'preview', revision: restored.revision,
      edit: { kind: 'sessions', account: 'fixture', sessionLimit: route === 'child' ? null : 2 } })
    expect(await api('staffing', { action: 'apply', ticket: finalPreview.ticket })).toMatchObject({ confirmed: true })

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

    ok(await p.nanda('top open --name="Export design" --goal="Explain the export" --sections=introduction'))
    const handoff = await agent(`wait ${host} --seconds=1`)
    const leader = await workerIn(p, 'role:section-lead')
    const lead = leader.token('role:section-lead')
    let projectWorker = handoff.match(/g\.[a-f0-9.]+/)[0]
    const projectTurn = (command) => workerTurn(p, projectWorker, command)
    const projectAct = async (command, fields = '') => {
      const step = await projectTurn(command)
      return agent(`${command} ${step.token} ${fields} ${step.args}`)
    }
    expect(recordOf(p).retired).toBe(true)
    expect((await dash()).directions.map(({ name }) => name)).toContain('TSD writing')
    await projectAct('send', '--name="Introduction" --goal="Explain the export" --sections=introduction --role=section-lead')
    expect((await dash()).columns).toEqual(expect.arrayContaining([expect.objectContaining({ task: expect.objectContaining({ id: 't1', state: 'QUEUED' }) })]))
    expect(await agent(`assign ${lead} t1`)).toContain('will work on this worker')
    const briefTurn = await workerTurn(p, leader.credential, 'brief')
    await agent(`brief ${briefTurn.token} ${briefTurn.args}`)
    const report = await workerTurn(p, leader.credential, 'report')
    await agent(`report ${report.token} ${ask('Execute')} --output="Introduction explains the export" ${report.args}`)
    expect((await dash()).columns).toEqual(expect.arrayContaining([expect.objectContaining({ task: expect.objectContaining({ id: 't1', reject: true }) })]))
    const review = await agent(`wait ${lead} --seconds=1`)
    expect(review).toContain('Known break of')
    expect(review).toContain('docs/legacy.md:2')
    await run(`review ${lead} ${ask('Check')} pass`)
    await projectAct('top-done')

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
    await projectAct('advance', 'edit')
    await projectAct('advance', 'edit')
    yaml('new-rule.yaml', write)
    await projectAct('rule', 'edit new-rule.yaml')
    yaml('ship.yaml', { [direction.key]: edit, 'rule:explain-impact': { ...write, parent: std.key } })
    await projectAct('ship', 'edit ship.yaml')
    expect((await projectTurn('loop')).words).toContain('one before/after example')
    await projectAct('loop', 'edit person --mode="self-review turns"')
    const decision = (await dash()).row.find(({ id }) => id === 'edit')
    expect(decision).toMatchObject({ status: 'WAIT_FOR_REVIEW', reviewMode: 'self-review turns' })
    ok(await p.nanda(`respond ${decision.ask} accept --on ${state().seq}`))
    await projectAct('reassign')
    const fake = await recheckPumpIn(p)
    const jobs = () => foldRechecks(eventsOf(p.dir))
    const runtime = () => foldRuntime(eventsOf(p.dir))
    await fake.tick()
    const job = [...jobs().keys()][0]
    const first = jobs().get(job)
    expect(first.queued.task).toBe('t1')
    expect(first.queued.items).toHaveLength(2)
    const forged = await p.agent(`recheck ${host} t1 holds --items=${direction.key},rule:explain-impact --on=${state().seq}`)
    expect(forged.code).toBe(1)
    let helper
    if (route === 'child') {
      const wait = await agent(`worker wait ${projectWorker} --seconds=0.01`)
      const launch = wait.match(/work worker child-start [^\n]+/)[0].slice(5)
      helper = (await agent(launch)).match(/h\.[a-f0-9.]+/)[0]
      await agent(`recheck-helper ack ${helper}`)
      expect(jobs().get(job).route.kind).toBe('child')
    } else {
      expect(first.deferred).not.toBeNull()
      expect(first.route).toBeNull()
      if (route === 'park') {
        const handle = cliSession(boot.pending.launch)
        await agent(`worker checkpoint ${job} ${handle} --credential=${projectWorker}`)
        fake.restart()
        fake.stopMode('failed')
        await fake.tick()
        expect(jobs().get(job).park._tag).toBe('WorkerParkCancelled')
        expect(runtime().workers.get(first.queued.worker).ended).toBe(false)
        await agent(`worker checkpoint ${job} ${handle} --credential=${projectWorker}`)
        fake.stopMode('unknown')
        await fake.tick()
        expect(jobs().get(job).park._tag).toBe('WorkerParkRequested')
        expect(jobs().get(job).route).toBeNull()
        expect(runtime().workers.get(first.queued.worker).ended).toBe(false)
        await agent(`worker checkpoint ${job} ${handle} --credential=${projectWorker}`)
        fake.restart()
        fake.running.set(`boot-${boot.pending.launch}`, 'ended')
        await fake.tick()
        expect(jobs().get(job).park._tag).toBe('WorkerParkConfirmed')
        expect(runtime().workers.get(first.queued.worker).ended).toBe(true)
        await fake.tick()
      } else {
        expect((await agent(`worker wait ${projectWorker} --seconds=0.01`))).toContain('compatible child or session slot')
        const other = runtime().workers.get('role:section-lead')
        fake.running.set(other.binding.session, 'ended')
        await fake.tick()
        await fake.tick()
      }
      let started = fake.starts.find(({ env }) => env.ARISTOTELES_RECHECK_CREDENTIAL)
      expect(started).toBeDefined()
      if (route === 'defer') {
        const abandoned = started
        fake.running.set(abandoned.sid, 'ended')
        fake.restart()
        await fake.tick()
        await fake.tick()
        started = fake.starts.filter(({ env }) => env.ARISTOTELES_RECHECK_CREDENTIAL).at(-1)
        expect(started.sid).not.toBe(abandoned.sid)
        expect((await p.run(`recheck-helper ack ${abandoned.env.ARISTOTELES_RECHECK_CREDENTIAL}`,
          { env: { ARISTOTELES_SESSION: abandoned.sid } })).code).toBe(1)
      }
      helper = started.env.ARISTOTELES_RECHECK_CREDENTIAL
      ok(await p.run(`recheck-helper ack ${helper}`, { env: { ARISTOTELES_SESSION: started.sid } }))
      fake.restart()
      await fake.tick()
      expect(fake.starts.filter(({ env }) => env.ARISTOTELES_RECHECK_CREDENTIAL)).toHaveLength(route === 'defer' ? 2 : 1)
    }
    const brief = await agent(`recheck-brief ${helper} ${job}`)
    expect(brief).toContain(`${direction.key} @1: Explain the export and its effect.`)
    expect(brief).toContain('rule:explain-impact @1: State the resulting effect.')
    expect((await dash()).pipe.work).toContain('Rechecking')
    const findings = first.queued.items.map(([item, version]) => ({
      item, version, outcome: 'holds', evidence: 'Reviewed docs/checks.md:2',
    }))
    yaml('recheck.yaml', { on: first.queued.on - 1, findings })
    expect((await p.agent(`recheck-report ${helper} ${job} --file=recheck.yaml`)).err).toContain('original recheck basis')
    yaml('recheck.yaml', { on: first.queued.on, findings: findings.slice(0, 1) })
    expect((await p.agent(`recheck-report ${helper} ${job} --file=recheck.yaml`)).err).toContain('every exact item')
    yaml('recheck.yaml', { on: first.queued.on, findings })
    const helperReport = await agent(`recheck-report ${helper} ${job} --file=recheck.yaml`)
    fake.restart()
    if (route === 'park') {
      fake.stopMode('unknown')
      await fake.tick()
      const allocation = jobs().get(job).route.allocation
      expect(runtime().workers.get(allocation).ended).toBe(false)
      expect(fake.starts.some(({ command }) => command.includes('--resume'))).toBe(false)
      fake.restart()
      const helperSession = fake.starts.find(({ env }) => env.ARISTOTELES_RECHECK_CREDENTIAL).sid
      fake.running.set(helperSession, 'ended')
      fake.stopMode('ended')
    }
    await fake.tick()
    if (route === 'park') {
      const resumed = fake.starts.find(({ command }) => command.includes('--resume'))
      expect(resumed).toBeDefined()
      expect(resumed.command).toContain(cliSession(boot.pending.launch))
      projectWorker = resumed.env.ARISTOTELES_WORKER_CREDENTIAL
      const [, launch, , root] = projectWorker.split('.')
      const { stageWorkerLaunch, sha } = await import('../core/services/index.ts')
      stageWorkerLaunch(p.dir, launch, 'ack', sha(root))
      fake.restart()
      await fake.tick()
      expect(jobs().get(job).resumed).toBe(true)
    }
    expect(await agent(`recheck-report ${helper} ${job} --file=recheck.yaml`)).toBe(helperReport)
    const dispatch = (await agent(`worker wait ${projectWorker} --seconds=0.01`)).split('\n')
      .find((line) => line.startsWith('work recheck ')).slice(5)
    expect(dispatch).toContain(`--job=${job}`)
    expect((await p.agent(dispatch.replace(/--report=report-\d+/, '--report=foreign'))).err).toContain('current helper job')
    expect((await p.agent(dispatch.replace(' holds ', ' fails '))).err).toContain('does not match the helper')
    await agent(dispatch)
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
