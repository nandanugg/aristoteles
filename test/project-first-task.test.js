import { expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { bootstrapSocket } from '../adapters/live/bootstrap.ts'
import { direction } from '../src/store/proposal.probe.ts'
import { owner, host, pipeline, staff, subscription } from '../src/store/project.probe.ts'
import { PROJECT_FORMAT } from '../src/store/schema.ts'
import { openProjectPage } from './browser/project-first-task.check.js'

const bin = resolve(import.meta.dir, '../bin/work.js')
const quote = (word) => "'" + word.replaceAll("'", "'\\''") + "'"
const until = async (read, description) => {
  const deadline = Date.now() + 10000
  do {
    const value = await read()
    if (value) return value
    await Bun.sleep(35)
  } while (Date.now() < deadline)
  throw new Error('Did not observe ' + description)
}
const git = (cwd, ...args) => expect(Bun.spawnSync(['git', '-C', cwd, ...args]).exitCode).toBe(0)
const excerpt = (text) => ({ _tag: 'Quote', file: 'sample.md', lines: { first: 1, last: 1 }, text })
const terminal = (args) => ['script', '-qec', [process.execPath, bin, ...args].map(quote).join(' '), '/dev/null']

test('shipped work refuses an older SQLite format before writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'project-format-'))
  const db = join(dir, 'old.db')
  try {
    git(dir, 'init', '-q')
    git(dir, 'config', 'user.name', owner.name)
    const database = new Database(db)
    database.exec("PRAGMA user_version=27; CREATE TABLE previous(value TEXT); INSERT INTO previous VALUES ('kept')")
    database.close()
    const original = readFileSync(db)
    const yaml = join(dir, 'project.yaml')
    writeFileSync(yaml, Bun.YAML.stringify({ owner, roles: [host, pipeline], staff }))
    for (const args of [['status'], ['start'], ['onboard', 'open', '--file=' + yaml]]) {
      const result = Bun.spawnSync(terminal(args), {
        cwd: dir, env: { ...process.env, WORK_DIR: dir, ARISTOTELES_DB: db, WORK_NO_OPEN: '1' },
      })
      expect(result.exitCode).toBe(1)
      expect(result.stdout.toString() + result.stderr.toString()).toContain(`not a format ${PROJECT_FORMAT} project journal`)
      expect(readFileSync(db).equals(original)).toBe(true)
    }
    expect(existsSync(join(dir, '.work'))).toBe(false)
    expect(existsSync(join(dir, 'project-ui'))).toBe(false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 30_000)

test('the bundled CLI and served page complete the local first task and refuse stale input', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'project-first-task-'))
  const dir = join(scratch, 'repo')
  const db = join(scratch, 'project.db')
  const captures = join(scratch, 'launches')
  const path = join(scratch, 'bin')
  mkdirSync(dir)
  mkdirSync(captures, { mode: 0o700 })
  mkdirSync(path)
  const launch = join(scratch, 'local-session')
  const realTmux = Bun.which('tmux')
  if (!realTmux) throw new Error('tmux is required for the local rehearsal')
  writeFileSync(join(path, 'tmux'), `#!/bin/sh
key=
for arg in "$@"; do
  case "$arg" in
    boot-*) key=$(printf '%s' "$arg" | cut -c 6-);;
  esac
done
case " $* " in
  *" new-session "*) [ -z "$key" ] || date +%s%3N > ${quote(captures)}/"$key.issued";;
esac
exec ${quote(realTmux)} "$@"
`, { mode: 0o700 })
  writeFileSync(launch, `#!/bin/sh
umask 077
if [ -n "$ARISTOTELES_BOOTSTRAP_PROJECT" ]; then
  ${quote(process.execPath)} ${quote(bin)} session ack "$ARISTOTELES_BOOTSTRAP_SESSION" > ${quote(captures)}/host.intro || exit
  ${quote(process.execPath)} ${quote(bin)} session collect "$ARISTOTELES_BOOTSTRAP_SESSION" > ${quote(captures)}/host || exit
else
  key=$(printf '%s' "$ARISTOTELES_SESSION" | cut -c 9-)
  if [ -n "$ARISTOTELES_LAUNCH_NONCE" ]; then
    ${quote(process.execPath)} ${quote(bin)} session ack "$ARISTOTELES_SESSION" > ${quote(captures)}/"$key.intro" || exit
  fi
  printf '%s' "$ARISTOTELES_TOKEN" > ${quote(captures)}/"$key.token"
  date +%s%3N > ${quote(captures)}/"$key.started"
fi
exec sleep 90
`, { mode: 0o700 })
  const env = { ...process.env, PATH: path + ':' + process.env.PATH, WORK_DIR: dir,
    ARISTOTELES_DB: db, WORK_NO_OPEN: '1' }
  for (const key of ['TMUX', 'TMUX_PANE', 'ARISTOTELES_SESSION', 'ARISTOTELES_TOKEN']) delete env[key]
  const call = async (args, options = {}) => {
    const child = Bun.spawn(options.owner ? terminal(args) : [process.execPath, bin, ...args], {
      cwd: dir, env: { ...env, ...(options.token ? { ARISTOTELES_TOKEN: options.token } : {}) },
      stdout: 'pipe', stderr: 'pipe',
    })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    return { out: out.replaceAll('\r', ''), err, code }
  }
  const ok = async (args, options) => {
    const result = await call(args, options)
    expect(result.err + (result.code ? result.out : '')).toBe('')
    expect(result.code).toBe(0)
    return result.out
  }
  const ownerCall = { owner: true }
  const put = (name, input) => writeFileSync(join(dir, name), Bun.YAML.stringify(input))
  let browser
  let webPid
  try {
    git(dir, 'init', '-q')
    git(dir, 'config', 'user.name', owner.name)
    writeFileSync(join(dir, 'AGENTS.md'), 'Review the local output.\n')
    writeFileSync(join(dir, 'aristoteles.yaml'), 'models:\n  local:\n    skills: .claude/skills\n')
    const local = { ...staff, roles: [host.key], launch: launch + ' {session}' }
    const worker = { ...local, key: 'staff:pipeline', name: 'Pipeline staff', roles: [pipeline.key] }
    put('project.yaml', { owner, roles: [host, pipeline], staff: local, subscription })
    await ok(['skill', 'install'])
    expect(existsSync(join(dir, '.claude/skills/aristoteles/SKILL.md'))).toBe(true)
    await ok(['onboard', 'open', '--file=project.yaml'], ownerCall)
    const web = await ok(['start', '--detach'])
    const url = new URL(/Project page (http:[^\s]+)/u.exec(web)?.[1])
    const record = readdirSync(join(scratch, 'project-ui')).find((name) => name.endsWith('.json'))
    const webRecord = join(scratch, 'project-ui', record)
    webPid = JSON.parse(readFileSync(webRecord, 'utf8')).pid
    for (const skill of ['work', 'assess', 'role-fitness'])
      expect(existsSync(join(dir, '.claude', 'skills', skill, 'SKILL.md'))).toBe(true)
    const state = async () => (await fetch(new URL('api/project/snapshot', url))).json()
    const basis = async () => '--on=' + (await state()).read
    const events = async () => (await fetch(new URL('api/project/events?after=0', url))).json()
    const submit = (body, route = 'api/project/submissions') => fetch(new URL(route, url), {
      method: 'POST', headers: { origin: url.origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    browser = await openProjectPage(url.href)
    await browser.read(1)
    const measures = []
    const launchStaff = async (assigned = local) => {
      const launched = await ok(['session', 'launch', assigned.key], ownerCall)
      const key = /Staff session (session:[a-f0-9]+)/u.exec(launched)?.[1]
      const file = join(captures, key.slice(8) + '.token')
      const token = await until(() => existsSync(file) && readFileSync(file, 'utf8'), 'staff start')
      const introduction = readFileSync(join(captures, key.slice(8) + '.intro'), 'utf8').trimEnd()
      const continuation = /--on=\d+/u.exec(introduction)?.[0]
      expect(continuation).toMatch(/^--on=\d+$/u)
      return { key, token, introduction, continuation }
    }
    let live = await launchStaff()
    expect(live.introduction).toContain('Session introduction for ' + local.name)
    expect(live.introduction.indexOf('Session ' + live.key + ' · Live.')).toBeGreaterThan(-1)
    expect(live.introduction.indexOf('Session ' + live.key + ' · Live.')).toBeLessThan(
      live.introduction.indexOf('Session introduction for ' + local.name))
    expect(live.introduction).toContain(host.responsibility.value.introduction)
    expect(live.introduction).toContain('No accepted directions yet.')
    const introducedAt = (await state()).read
    expect((await ok(['wait'], live)).trimEnd()).toBe(live.introduction.split('\n').slice(1).join('\n'))
    expect((await ok(['wait', live.continuation], live)).trim()).toBe('Nothing is due.\nContinue with work wait <token> ' + live.continuation)
    expect((await state()).read).toBe(introducedAt)
    const apply = async (args, token, label) => {
      const start = Date.now()
      const text = await ok(args, token ? { token } : ownerCall)
      const number = Number(/Committed event (\d+)/u.exec(text)?.[1])
      expect(Number.isFinite(number)).toBe(true)
      await browser.read(number)
      measures.push([label, Date.now() - start])
      return { number, start }
    }
    const rule = direction.standards[0].rules[0]
    const drafted = { ...direction, source: { _tag: 'Local' },
      stages: ['Prepare the result', 'Write the result', 'Check the result'].map((name) =>
        ({ ...direction.stages[0], role: pipeline.key, name })),
      standards: [{ ...direction.standards[0], rules: [
        { ...rule, verification: { _tag: 'Command', text: 'test -f sample.md' } },
        { ...rule, name: 'Clear wording',
          verification: { _tag: 'Prompt', question: 'Is the wording clear?', source: excerpt('Local first result') } },
      ] }],
    }
    const fresh = async (before) => {
      const file = await until(() => readdirSync(captures).find((name) => name.endsWith('.started') && !before.has(name)), 'fresh child')
      const suffix = file.slice(0, -'.started'.length)
      const started = Number(readFileSync(join(captures, suffix + '.started'), 'utf8'))
      const issued = Number(readFileSync(join(captures, suffix + '.issued'), 'utf8'))
      return { token: readFileSync(join(captures, suffix + '.token'), 'utf8'), started, issued, startup: started - issued }
    }
    const reviewStarts = []
    const proposal = async (key, value, title) => {
      const line = { line: 'Proposal', key }
      put('draft.yaml', { ...line, move: 'open', input: { previous: { _tag: 'None' }, value } })
      await apply(['onboard', 'submit', await basis(), '--file=draft.yaml'], live.token, key + ' open')
      put('draft.yaml', { ...line, move: 'submit', input: { value } })
      const before = new Set(readdirSync(captures))
      const submitted = await apply(['onboard', 'submit', await basis(), '--file=draft.yaml'], live.token, key + ' submit')
      const review = await fresh(before)
      const commit = (await events()).find(({ number }) => number === submitted.number)
      reviewStarts.push({
        fromSubmit: review.started - submitted.start,
        commitToDispatch: review.issued - Date.parse(commit.at),
        childStartup: review.startup,
      })
      const reviewPrompt = await ok(['wait'], { token: review.token })
      expect(reviewPrompt).toContain('Draft for review (proposal.json)')
      const checks = JSON.parse(await ok(['onboard', 'rules'])).rules[value._tag]
      for (const rule of checks) expect(reviewPrompt).toContain(rule.name)
      put('facts.yaml', { outcomes: checks.map((rule) => ({ _tag: 'Holds', rule,
        evidence: { _tag: 'Quote', file: 'proposal.json', lines: { first: 2, last: 2 }, text: JSON.stringify(value._tag) } })), findings: [] })
      await apply(['review', key, await basis(), '--file=facts.yaml'], review.token, key + ' review')
      const start = Date.now()
      await browser.accept(title)
      measures.push([key + ' accept', Date.now() - start])
    }
    await proposal('proposal:staffing', { _tag: 'Staffing', staff: [local, worker],
      subscriptions: [subscription] }, 'Staffing')
    await proposal('proposal:direction', drafted, drafted.name)
    const question = 'Which wording should the work use?'
    put('question.yaml', { key: 'question:wording', text: question, owner: { _tag: 'Project' },
      expects: { _tag: 'ShortAnswer' } })
    const asked = await apply(['question', 'owner', await basis(), '--file=question.yaml'], live.token, 'question')
    const card = browser.page.getByRole('form', { name: question })
    await card.getByRole('textbox').fill('Use the local wording.')
    let started = Date.now()
    await card.getByRole('button', { name: 'Answer' }).click()
    await card.waitFor({ state: 'hidden' })
    measures.push(['answer', Date.now() - started])
    const reply = await ok(['wait', '--on=' + asked.number], live)
    expect(reply).toContain('Answer to project/question:wording')
    expect(reply).toContain('Use the local wording.')
    expect(reply).toContain('Nothing is due.')
    expect(reply.indexOf('Use the local wording.')).toBeLessThan(reply.indexOf('Nothing is due.'))
    const replyBasis = /Continue with work wait <token> (--on=\d+)/u.exec(reply)[1]
    expect(await ok(['wait', replyBasis], live)).not.toContain('Answer to project/question:wording')


    const button = (name) => browser.page.getByRole('button', { name, exact: true })
    await button('Review activation files').click()
    started = Date.now()
    await button('Approve and activate').click()
    await browser.page.getByText('Waiting for the host to acknowledge activation.').waitFor({ timeout: 1000 }).catch(() => {})
    await button('Start work').waitFor()
    measures.push(['activation to binding', Date.now() - started])
    started = Date.now()
    await button('Start work').click()
    await browser.page.getByText('Work is open.', { exact: true }).waitFor()
    measures.push(['start work', Date.now() - started])
    const hostToken = await until(() => existsSync(join(captures, 'host')) && readFileSync(join(captures, 'host'), 'utf8').trim(), 'host credential')
    expect(readFileSync(join(captures, 'host.intro'), 'utf8')).toContain('Accepted direction ' + drafted.name)
    expect(await ok(['wait'], { token: hostToken })).toContain('Session introduction for ' + local.name)
    live = await launchStaff(worker)
    expect(live.introduction).toContain('Role ' + pipeline.name)
    expect(live.introduction).toContain(pipeline.responsibility.value.summary)
    expect(live.introduction).toContain(pipeline.responsibility.value.duties[0])
    expect(live.introduction).toContain('Accepted direction ' + drafted.name)
    const project = await state()
    const accepted = project.proposals.find(({ key }) => key === 'proposal:direction').phase.version
    const prompt = accepted.value.standards[0].rules[1]
    writeFileSync(join(dir, 'sample.md'), 'Local first result\n')
    const task = async (key, name) => {
      put('task.yaml', { key, name, goal: 'Write the local result', reviewer: project.roles.find(({ _tag }) => _tag === 'Pipeline').key,
        direction: accepted, stages: accepted.value.stages, facts: [] })
      await apply(['send', await basis(), '--file=task.yaml'], hostToken, name + ' open')
    }
    const key = 'task:first'
    const name = 'Local first result'
    await task(key, name)
    const report = async (key, input, label) => {
      put('report.yaml', input)
      return apply(['report', key, await basis(), '--file=report.yaml'], live.token, label)
    }
    const beforeCrash = await report(key, {}, 'begin')
    const finish = async (attempt, result, outcome, work = { key, name, returned: true }) => {
      const { key, name, returned: expectingReturn = true } = work
      const resultReport = await report(key, { attempt, summary: 'A local sample', files: [{ path: 'sample.md',
        image: { _tag: 'Present', contents: result + '\n' }, changed: [{ first: 1, last: 1 }] }] }, 'result')
      await browser.phase(name, pipeline.name, 'Reviewing')
      const before = new Set(readdirSync(captures))
      await apply(['wait'], live.token, 'assign task review')
      const child = await fresh(before)
      expect(await ok(['wait'], { token: child.token })).toContain('Clear wording')
      put('facts.yaml', { outcomes: [{ _tag: outcome, rule: prompt, evidence: excerpt(result) }], findings: [] })
      await apply(['review', key, await basis(), '--file=facts.yaml'], child.token, 'task review')
      if (outcome === 'Breaks' && expectingReturn) {
        const stale = await call(['report', key, '--on=' + resultReport.number, '--file=report.yaml'], live)
        expect(stale.code).toBe(1)
        expect(stale.err).toContain('Stale')
        const returned = await ok(['wait', '--on=' + resultReport.number], live)
        expect(returned).toContain('Task ' + key + ' returned')
        expect(returned).toContain('Clear wording · Breaks')
        expect(returned.indexOf('Task ' + key + ' returned')).toBeLessThan(returned.indexOf('work report'))
      }
      return child.token
    }
    const child = await finish(1, 'Local first result', 'Breaks')
    await browser.phase(name, pipeline.name, 'Working')
    await browser.page.getByRole('heading', { name: 'Review feedback' }).waitFor()
    expect((await state()).tasks.find((task) => task.key === key).retryCount).toBe(1)
    expect((await call(['wait'], { token: child })).code).toBe(1)

    Bun.spawnSync([realTmux, '-L', bootstrapSocket(dir), 'kill-session', '-t', '=boot-' + live.key.slice(8)])
    await browser.phase(name, pipeline.name, 'Sent')
    const oldReport = await submit({ read: beforeCrash.number, line: 'Task', key, move: 'next', input: {} })
    expect(oldReport.status).toBe(403)
    expect((await oldReport.json()).code).toBe('WrongActor')
    for (const route of ['api/onboarding', 'api/activation', 'api/staffing', 'api/act'])
      expect((await submit({}, route)).status).toBe(404)
    const old = live
    live = await launchStaff(worker)
    expect((await call(['wait'], old)).code).toBe(1)
    expect(await ok(['wait', old.continuation], live)).toContain('Session introduction for ' + worker.name)
    const due = await ok(['wait', live.continuation], live)
    expect(due).toContain('work report')
    expect(due).not.toContain('Session introduction')
    await report(key, {}, 'restart begin')
    expect(await ok(['wait'], live)).not.toContain('Session introduction')
    writeFileSync(join(dir, 'sample.md'), 'Local second result\n')
    await finish(2, 'Local second result', 'Holds')
    await browser.phase(name, pipeline.name, 'Done')
    const done = (await state()).tasks.find((task) => task.key === key)
    expect(done.phase.result.attempt.number).toBe(2)
    expect(done.phase.outcomes.map(({ _tag }) => _tag)).toEqual(['Holds', 'Holds'])

    await task('task:raise', 'Wrong cut')
    await report('task:raise', {}, 'begin later task')
    await report('task:raise', { attempt: 1, reason: 'WrongTask', evidence: [excerpt('Local second result')] }, 'raise')
    await browser.phase('Wrong cut', pipeline.name, 'Raised')
    expect(await ok(['brief', 'task:raise'], ownerCall)).toContain('Reason: WrongTask')
    const wrongCut = browser.page.getByRole('article', { name: 'Wrong cut', exact: true })
    expect(await wrongCut.getByRole('button', { name: 'Take as is' }).count()).toBe(0)
    await wrongCut.getByRole('textbox', { name: 'Why drop this task?' }).fill('The sender will prepare a different brief.')
    await wrongCut.getByRole('button', { name: 'Drop task' }).click()
    await browser.phase('Wrong cut', pipeline.name, 'Dropped')

    const raisedKey = 'task:review-fix'
    const raisedName = 'Reviewed fix'
    await task(raisedKey, raisedName)
    await report(raisedKey, {}, 'begin fix fixture')
    await finish(1, 'Local second result', 'Breaks', { key: raisedKey, name: raisedName })
    await finish(1, 'Local second result', 'Breaks', { key: raisedKey, name: raisedName, returned: false })
    await browser.phase(raisedName, pipeline.name, 'Raised')
    const assessment = await ok(['wait'], live)
    expect(assessment).toContain('work assess')
    put('assessment.yaml', { missed: 'Guidance', why: 'The rule needs to distinguish a clear result from a verbose one.' })
    const wrongRole = await call(['assess', raisedKey, await basis(), '--file=assessment.yaml'], { token: hostToken })
    expect(wrongRole.code).toBe(1)
    expect(wrongRole.err).toContain('WrongActor')
    await apply(['assess', raisedKey, await basis(), '--file=assessment.yaml'], live.token, 'assessment')
    const fixDraft = {
      ...drafted, standards: drafted.standards.map((standard) => ({
        ...standard, rules: standard.rules.map((rule) => rule.name === prompt.name
          ? { ...rule, text: 'Make the result clear and concise.' } : rule),
      })),
    }
    put('fix.yaml', { line: 'Proposal', key: 'proposal:fix', move: 'submit', input: { subject: { _tag: 'Fix', task: raisedKey }, value: fixDraft } })
    const beforeFixReview = new Set(readdirSync(captures))
    await apply(['onboard', 'submit', await basis(), '--file=fix.yaml'], live.token, 'submit fix')
    const fixReviewer = await fresh(beforeFixReview)
    expect(await ok(['wait'], { token: fixReviewer.token })).toContain('Make the result clear and concise.')
    const assignedFix = (await state()).proposals.find(({ key }) => key === 'proposal:fix')
    expect(assignedFix.phase).toMatchObject({ _tag: 'Reviewing', assignment: { _tag: 'Assigned' } })
    const raisedCard = browser.page.getByRole('article', { name: raisedName, exact: true })
    await raisedCard.getByRole('textbox', { name: 'Why accept the finished result?' }).fill('The finished example serves the current purpose.')
    await raisedCard.getByRole('button', { name: 'Take as is' }).click()
    await browser.phase(raisedName, pipeline.name, 'Done')
    expect(await raisedCard.getByText('Taken as is · The finished example serves the current purpose.').count()).toBe(1)
    expect((await state()).proposals.find(({ key }) => key === 'proposal:fix').phase._tag).toBe('Removed')
    const childKey = fixReviewer.token.split('.')[1]
    expect(Bun.spawnSync([realTmux, '-L', bootstrapSocket(dir), 'has-session', '-t', '=boot-' + childKey]).exitCode).not.toBe(0)
    expect((await call(['wait'], { token: fixReviewer.token })).code).toBe(1)

    const treePart = (key, title, first, last) => ({
      task: key, name: title, goal: 'Complete the marked stage range.',
      role: pipeline.key, range: { first, last }, dependency: { _tag: 'Serial' }, why: 'This slice fits one attempt.',
    })
    put('split.yaml', { _tag: 'New', draft: {
      name: 'Stage partition', goal: 'Work through the direction in order.', role: pipeline.key,
      reviewer: pipeline.key, direction: accepted, stages: accepted.value.stages, facts: [], attachments: [],
    }, partition: {
      why: 'Separate preparation from the remaining work.', review: 'Review the handoff in one pass.',
      parts: [treePart('task:prepare', 'Prepare', 1, 1), treePart('task:write-check', 'Write and check', 2, 3)],
    } })
    await apply(['split', 'task:tree', await basis(), '--file=split.yaml'], undefined, 'split before sending')
    await browser.phase('Stage partition', pipeline.name, 'Split')
    await browser.phase('Prepare', pipeline.name, 'Sent')
    const secondPart = browser.page.getByRole('article', { name: 'Write and check', exact: true })
    await secondPart.getByText('Waiting for the preceding part.').waitFor()
    await secondPart.getByText('Task brief', { exact: true }).click()
    await secondPart.getByRole('list', { name: 'Direction stages' }).getByText(/Check the result/).waitFor()
    put('begin.yaml', {})
    const early = await call(['report', 'task:write-check', await basis(), '--file=begin.yaml'], live)
    expect(early.err).toContain('preceding part')
    const duePart = await ok(['wait'], live)
    expect(duePart).toContain('task:prepare')

    await apply(['session', 'end', live.key], undefined, 'owner ends staff')
    expect((await state()).sessions.find(({ key }) => key === live.key)._tag).toBe('Ended')
    const stopped = Bun.spawnSync([realTmux, '-L', bootstrapSocket(dir), 'has-session', '-t', '=boot-' + live.key.slice(8)])
    expect(stopped.exitCode).not.toBe(0)
    const beforeRestart = (await state()).read
    process.kill(webPid)
    await until(() => !existsSync(webRecord), 'server shutdown')
    await browser.page.getByText('Project connection unavailable. Reconnecting…', { exact: true }).waitFor()
    env.WORK_PORT = url.port
    await ok(['start', '--detach'])
    webPid = JSON.parse(readFileSync(webRecord, 'utf8')).pid
    await browser.page.getByText('Project connection unavailable. Reconnecting…', { exact: true }).waitFor({ state: 'hidden' })
    await browser.read(beforeRestart)
    const committed = await events()
    expect(committed.map(({ number }) => number)).toEqual(committed.map((_, index) => index + 1))
    expect((await state()).read).toBe(beforeRestart)
    const stale = await submit({ read: 1, line: 'Project', move: 'start', input: {} })
    expect(stale.status).toBe(409)
    expect((await stale.json()).code).toBe('Stale')
    for (const secret of [hostToken, live.token, child, fixReviewer.token]) {
      expect(JSON.stringify(committed)).not.toContain(secret)
      await browser.noSecret(secret)
      expect(readFileSync(webRecord + '.log', 'utf8')).not.toContain(secret)
    }
    console.log('Project feedback ms', JSON.stringify({ moves: measures, reviewStarts }))
    expect(Math.max(...measures.filter(([label]) => label !== 'activation to binding').map(([, ms]) => ms))).toBeLessThan(1000)
    expect(Math.max(...reviewStarts.map(({ fromSubmit }) => fromSubmit))).toBeLessThan(1000)
  } finally {
    await browser?.close()
    if (webPid) { try { process.kill(webPid) } catch {} }
    Bun.spawnSync([realTmux, '-L', bootstrapSocket(dir), 'kill-server'])
    rmSync(scratch, { recursive: true, force: true })
  }
}, 90_000)
