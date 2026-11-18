// One file for a dir (Nanda, 2026-11-11): aristoteles.yaml holds the mechanism (people, roles,
// deciders, the limits of each model) and the settings of the UI (the commands of each model, the signs of a failed
// session, the sound, the theme). It has a schema, so an editor completes its keys. The name of
// the dir is its folder name.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Ajv from 'ajv/dist/2020.js'
import { startServer } from './code.js'
import { CODE_YAML, ONBOARD_CONFIG, WORK_YAML, ok, initiated, onboardingProject, project, withModels } from './harness.js'
import { act, api, dbOf, gitPerson, settingsOf } from './outside.js'

// An act of the onboarding pages (POST /api/onboarding), with the key and the page's own origin.
const onboardingAct = async (p, body) => {
  const s = startServer({ dir: p.dir, env: { ARISTOTELES_DB: dbOf(p) } })
  try {
    const origin = `http://127.0.0.1:${s.port}`
    const headers = { origin, 'content-type': 'application/json' }
    return await (await fetch(`${origin}/api/onboarding`, { method: 'POST', headers, body: JSON.stringify(body) })).json()
  } finally {
    s.stop()
  }
}

const schema = JSON.parse(readFileSync(join(import.meta.dir, '..', 'schema', 'aristoteles.schema.json'), 'utf8'))
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)
const valid = (text) => {
  const ok = validate(Bun.YAML.parse(text))
  return ok ? true : validate.errors.map((e) => `${e.instancePath} ${e.message}`).join('; ')
}

// Owner, 2026-11-15: the models table holds the commands of each model beside its limits.
const SETTINGS = `# yaml-language-server: $schema=../schema/aristoteles.schema.json
retryMinutes: 5
sound: false
`
const MODELS = {
  opus: { launch: 'agent-tool --model {model} --session-id {session}', resume: 'agent-tool --resume {session}' },
  sonnet: {
    launch: 'agent-tool --model {model} --session-id {session}',
    resume: 'agent-tool --resume {session}',
    errors: ['connection error', 'rate limit'],
    prompts: ['Do you want to proceed?'],
    silentMinutes: 10,
    retryInput: 'continue',
  },
}
const WITH_MODELS = withModels(WORK_YAML, MODELS)

describe('aristoteles.yaml', () => {
  test('the schema accepts the files of the tests and the settings of the plan', () => {
    expect(valid(WORK_YAML)).toBe(true)
    expect(valid(CODE_YAML)).toBe(true)
    expect(valid(SETTINGS + WITH_MODELS)).toBe(true)
  })

  test('the schema refuses a key that the CLI refuses', () => {
    expect(valid(`project: x\n${WORK_YAML}`)).not.toBe(true)
    expect(valid(SETTINGS + WITH_MODELS.replace('retryInput: "continue"', 'retryWords: "continue"'))).not.toBe(true)
    expect(valid(SETTINGS + WITH_MODELS.replace('--session-id {session}', ''))).not.toBe(true)
    expect(valid(WORK_YAML.replace('model: haiku', 'model: 5'))).not.toBe(true)
  })

  test('the schema and the CLI know the same keys', async () => {
    // When work init refuses a key, it names the keys that it knows.
    const known = async (yaml, words) => {
      const { err } = await project({ 'aristoteles.yaml': yaml }).nanda('init')
      return err.match(new RegExp(`${words} \\(([^)]*)\\)`))[1].split(', ').sort()
    }
    const keys = Object.keys(schema.properties)
    expect(keys.sort()).toEqual(await known(`colour: blue\n${WORK_YAML}`, 'is not a key of aristoteles.yaml'))
    expect(Object.keys(schema.$defs.model.properties).sort())
      .toEqual(await known(withModels(WORK_YAML, { opus: { colour: 'x' } }), 'is not a setting of a model'))
  })

  test('the name of a dir is its folder name; the file has no project key', async () => {
    const p = project({ 'aristoteles.yaml': SETTINGS + WITH_MODELS })
    expect(ok(await p.nanda('init')).out).toStartWith('store made for report-export in aristoteles')
    // work init reads the file before it looks at the store, so each init below says what is wrong.
    const refusal = async (yaml) => {
      p.write('aristoteles.yaml', yaml)
      return (await p.nanda('init')).err
    }
    expect(await refusal(`project: report-export\n${WORK_YAML}`))
      .toContain('the name of a dir is the name of its folder; remove the project key')
    expect(await refusal(`colour: blue\n${WORK_YAML}`)).toContain('"colour" is not a key of aristoteles.yaml')
    // What is wrong in this line is the { } with no quotes, which the YAML parser of Bun 1.4.3
    // refuses.
    expect(await refusal(WORK_YAML.replace('  sonnet: {', '  sonnet: { launch: x {session},')))
      .toContain('YAML Parse error: Unexpected token')
    expect(await refusal(withModels(WORK_YAML, { opus: { launch: 'agent-tool' } })))
      .toContain('models.opus.launch has no {session}')
    expect(await refusal(WORK_YAML.replace('model: haiku', 'model: tiny')))
      .toContain('roles.writer: model names an entry of the models table (haiku, sonnet, opus)')
  })

  // The page reads the settings (GET /api/dir) and saves them (POST /api/act).
  test('the settings have defaults', async () => {
    const p = project({ 'aristoteles.yaml': SETTINGS + WITH_MODELS })
    const s = await settingsOf(p)
    // Ruling 9, onboarding 2026-11-14 (P9): the start words and the retry name the agent's wait (were: a token, work next).
    // The limits of a model are its mechanism: the settings hold its commands only.
    expect(s.models.opus).toEqual({
      launch: 'agent-tool --model {model} --session-id {session}', resume: 'agent-tool --resume {session}',
      start: 'Use the work skill. You are {agent}: run work wait --by={agent}, and do what it prints.', errors: [], prompts: [], silentMinutes: 10, retryInput: 'System message, not from the person. Run work wait --by={agent}, and do what it prints.',
    })
    expect(s.models.sonnet.prompts).toEqual(['Do you want to proceed?'])
    expect(Object.keys(s.models)).toEqual(['haiku', 'sonnet', 'opus'])
    expect([s.retryMinutes, s.hostWaitMinutes, s.sound, s.theme]).toEqual([5, 10, false, 'light'])
  })

  // Ruling 10, onboarding 2026-11-14: each model has its commands; the page writes them, and the
  // limits of each model stay in the file.
  test('the commands of the models, read and written by the page', async () => {
    const p = project({ 'aristoteles.yaml': withModels(WORK_YAML, { haiku: { launch: 'agent-tool --model {model} --session-id {session}' } }) })
    const s = await settingsOf(p)
    expect(s.models.haiku).toMatchObject({ launch: 'agent-tool --model {model} --session-id {session}' })
    const settings = { models: { opus: { launch: 'agent-tool --model {model} --session-id {session}' }, haiku: { launch: 'agent-tool --session-id {session}' } } }
    expect(await act(p, 'settings', { settings })).toEqual({ out: 'the settings are saved.' })
    const now = await settingsOf(p)
    expect(now.models.opus).toMatchObject({ launch: 'agent-tool --model {model} --session-id {session}' })
    expect(now.models.haiku).toMatchObject({ launch: 'agent-tool --session-id {session}' })
    const file = Bun.YAML.parse(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8'))
    expect(file.models.haiku.limits).toEqual({ Assignment: { briefChars: 6000, attempts: 3 }, Review: { rules: 5 } })
    expect(file.models.sonnet.launch).toBeUndefined()
  })

  test('a write of the settings keeps every other line, and the stored config does not change', async () => {
    const { p } = await initiated({ 'aristoteles.yaml': `${SETTINGS}# the roles below are ours\n${WORK_YAML}` })
    const settings = { sound: true, theme: 'dark', models: { opus: { launch: 'other-tool --session-id {session}' } } }
    expect(await act(p, 'settings', { settings })).toEqual({ out: 'the settings are saved.' })
    const text = readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')
    expect(text).toStartWith('# yaml-language-server: $schema=../schema/aristoteles.schema.json\n')
    expect(text).toContain(`# the roles below are ours\npeople:\n  - name: Nanda\n`)
    expect(text).toContain(WORK_YAML.slice(WORK_YAML.indexOf('roles:')))
    const now = await settingsOf(p)
    expect(now).toMatchObject({ sound: true, theme: 'dark', retryMinutes: 5 })
    expect(now.models.opus.launch).toBe('other-tool --session-id {session}')
    expect(now.models.sonnet.launch).toBeUndefined()
    // The stored config is the mechanism only, so every command still runs.
    ok(await p.nanda('log'))
  })

  test('a restore writes back the stored mechanism and keeps the settings of now', async () => {
    const { p } = await initiated({ 'aristoteles.yaml': SETTINGS + WITH_MODELS })
    expect((await act(p, 'settings', { settings: { theme: 'dark' } })).out).toBe('the settings are saved.')
    p.write('aristoteles.yaml', readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8').replace('name: Nanda', 'name: Someone'))
    ok(await p.nanda('config restore', 'restore'))
    expect(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')).toContain('name: Nanda')
    expect((await settingsOf(p)).theme).toBe('dark')
  })
})

// work start runs in bin/main.ts, which no entry point of test/code.js reaches: this check is of
// the function that it calls.
describe('the skills of a launched AI tool', () => {
  test('work start links the missing skills into the skills folder of each model, and says so', async () => {
    const { linkSkills } = await import('./code.js')
    const { lstatSync, readlinkSync } = await import('node:fs')
    const p = project({ 'aristoteles.yaml': withModels(WORK_YAML, { opus: { skills: '.claude/skills' }, sonnet: { skills: '.claude/skills' } }) })
    p.write('.claude/skills/assess/SKILL.md', 'our own assess\n')
    // Ruling 12, onboarding 2026-11-14: work skill install owns the aristoteles skill.
    expect(linkSkills(p.dir)).toEqual([`linked the skills work, role-fitness into ${join(p.dir, '.claude/skills')}`])
    expect(readlinkSync(join(p.dir, '.claude/skills/work'))).toBe(join(import.meta.dir, '..', 'skills', 'work'))
    expect(lstatSync(join(p.dir, '.claude/skills/assess')).isSymbolicLink()).toBe(false)
    expect(linkSkills(p.dir)).toEqual([])
  })

  test('git of the dir excludes the links and .work/, once, and keeps the app\'s own skill', async () => {
    const { linkSkills } = await import('./code.js')
    const { excludeFromGit } = await import('./code.js')
    const p = project({ 'aristoteles.yaml': withModels(WORK_YAML, { opus: { skills: '.claude/skills' } }) })
    // The dir is a sub folder of its repo, so each line starts at the top of the repo.
    const top = dirname(p.dir)
    Bun.spawnSync(['git', 'init', '-q', top])
    p.write('.claude/skills/assess/SKILL.md', 'our own assess\n')
    // Ruling 12, onboarding 2026-11-14: work skill install owns the aristoteles skill.
    expect(linkSkills(p.dir)).toEqual([
      `linked the skills work, role-fitness into ${join(p.dir, '.claude/skills')}`,
      'git of the dir excludes /report-export/.claude/skills/work, /report-export/.claude/skills/role-fitness',
    ])
    expect(excludeFromGit(p.dir, ['.work/'])).toEqual(['/report-export/.work/'])
    expect(linkSkills(p.dir)).toEqual([])
    expect(excludeFromGit(p.dir, ['.work/'])).toEqual([])
    p.write('.work/runs/r1.log', 'a log\n')
    const status = Bun.spawnSync(['git', '-C', top, 'status', '--porcelain', '--untracked-files=all']).stdout.toString()
    expect(status).toContain('report-export/.claude/skills/assess/SKILL.md')
    expect(status).not.toContain('skills/work')
    expect(status).not.toContain('.work/')
  })
})

// The first start of a dir (Nanda, 2026-11-12; ruling 12, onboarding 2026-11-14): the person
// pastes the prompt into the AI CLI that they use, in the dir. That CLI is the host: it installs
// the /aristoteles skill, then drafts the onboarding files, and its draft brings the models of its
// own commands; the store start writes them into aristoteles.yaml.
describe('the first start of a dir', () => {
  // A dir with only the settings that the person saved on the page, and its git user.
  const fresh = () => {
    const p = project({ 'aristoteles.yaml': 'models:\n  opus:\n    launch: page-tool --session-id {session}\n' })
    Bun.spawnSync(['git', 'init', '-q', p.dir])
    Bun.spawnSync(['git', '-C', p.dir, 'config', 'user.name', 'Nanda'])
    return p
  }
  // The host's draft brings the models table: the commands of its own AI CLI and the limits.
  const hostDraft = (yaml) => withModels(yaml, { opus: { launch: 'host-cli --session-id {session} {prompt}', skills: '.host/skills' } })
  const ROOT = join(import.meta.dir, '..')

  test('the page shows the prompt: the skill install first, then the skill', async () => {
    const p = fresh()
    const dir = await api(p, '/api/dir')
    expect(dir).toMatchObject({ initialized: false, onboarding: false })
    // Ruling 12, onboarding 2026-11-14: the prompt names work skill install as its first step (it
    // named the skill only).
    expect(dir.startPrompt).toBe(
      `Use aristoteles in the folder ${p.dir}: run work skill install there, then read ` +
        `${join(ROOT, 'skills', 'aristoteles', 'SKILL.md')} and do what it says; you are the host. ` +
        `When work is not on the PATH, use bun ${join(ROOT, 'bin', 'work.js')} in its place.`,
    )
  })

  // Ruling 1, onboarding 2026-11-14: the store start of the page writes the models of the draft
  // (Accept the roles did, with no onboarding files).
  test('the store start: the models of the draft replace the saved ones, in one block', async () => {
    const p = onboardingProject({ 'aristoteles.yaml': 'models:\n  opus:\n    launch: page-tool --session-id {session}\n' })
    gitPerson(p)
    p.write('draft.yaml', hostDraft(ONBOARD_CONFIG))
    ok(await p.agent('onboard config --file=draft.yaml'))
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`onboard accept-role ${role}`))
    expect((await onboardingAct(p, { act: 'approve-all-roles' })).out).toBe(
      'store made for report-export in aristoteles: 4 roles and 0 directions; the onboarding files are gone.',
    )
    const text = readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')
    expect(text.match(/^models:/gm)).toHaveLength(1)
    expect((await settingsOf(p)).models.opus).toMatchObject({ launch: 'host-cli --session-id {session} {prompt}', skills: '.host/skills' })
    expect(existsSync(join(p.dir, 'aristoteles.draft.yaml'))).toBe(false)
  })

  test('work config check reads the draft as the store start does, for any caller, and writes nothing', async () => {
    const p = fresh()
    const before = readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')
    p.write('aristoteles.draft.yaml', hostDraft(WORK_YAML))
    const checked = ok(await p.agent('config check')).out.split('\n')
    // Ruling 1, onboarding 2026-11-14: files first, the store starts at the end (was: as Accept the
    // roles does).
    expect(checked[0]).toBe('aristoteles.draft.yaml reads, merged into aristoteles.yaml as the store start (work onboard approve-roles) merges it; nothing was written.')
    expect(checked[1]).toStartWith('the static fit checks pass for architect, section-lead, writer')
    expect(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')).toBe(before)
    expect(existsSync(join(p.dir, '.work', 'aristoteles.db'))).toBe(false)
    p.write('aristoteles.draft.yaml', hostDraft(WORK_YAML.replace('Give one --evidence line', 'Ensure one --evidence line')))
    expect((await p.agent('config check')).err).toMatch(/^refused: aristoteles\.draft\.yaml: linter: ".*" uses the vague verb "ensure"/)
    // The same words as the refusal of the page.
    p.write('aristoteles.draft.yaml', withModels(WORK_YAML, { opus: { launch: 'host-cli' } }))
    expect((await p.agent('config check')).err).toContain('aristoteles.draft.yaml: aristoteles.yaml: models.opus.launch has no {session}')
  })

  test('the host records the fit of each role as a model run; the person does not use --by', async () => {
    const p = project()
    ok(await p.nanda('init'))
    // The host runs in a shell with no terminal, so the person's command is refused there.
    expect((await p.agent('role fit writer --answers=fit.yaml')).err).toContain('this is a person command')
    expect(ok(await p.agent('role fit writer --answers=fit.yaml --by=assess')).out).toBe('writer fits; recorded by assess.')
    expect(ok(await p.agent('role list')).out).not.toMatch(/^writer .*no fit record/m)
    expect(ok(await p.agent('log')).out).toMatch(/^e2 .* assess run \S+ \(run\) role\.fit$/m)
    // I4 (N6): the person's --by is not used: the person records the fit, with no refusal.
    expect(ok(await p.nanda('role fit architect --answers=fit.yaml --by=assess')).out).toBe('architect fits; recorded.')
    expect((await p.agent('role fit architect --answers=fit.yaml --by=Host')).err).toContain('--by=<its name in lower case>')
  })
})
