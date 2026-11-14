// One file for a dir (Nanda, 2026-11-11): aristoteles.yaml holds the mechanism (people, limits,
// roles, deciders) and the settings of the UI (the commands of each tier, the signs of a failed
// session, the sound, the theme). It has a schema, so an editor completes its keys. The name of
// the dir is its folder name.
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Ajv from 'ajv/dist/2020.js'
import { CODE_YAML, WORK_YAML, ok, project, started } from './harness.js'
import { act, api, settingsOf } from './outside.js'

const schema = JSON.parse(readFileSync(join(import.meta.dir, '..', 'schema', 'aristoteles.schema.json'), 'utf8'))
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema)
const valid = (text) => {
  const ok = validate(Bun.YAML.parse(text))
  return ok ? true : validate.errors.map((e) => `${e.instancePath} ${e.message}`).join('; ')
}

const SETTINGS = `# yaml-language-server: $schema=../schema/aristoteles.schema.json
tiers:
  sol:
    launch: agent-tool --model large --session-id {session}
    resume: agent-tool --resume {session}
  terra:
    launch: agent-tool --model medium --session-id {session}
    resume: agent-tool --resume {session}
    errors: ["connection error", "rate limit"]
    prompts: ["Do you want to proceed?"]
    silentMinutes: 10
    retryInput: continue
retryMinutes: 5
sound: false
`

describe('aristoteles.yaml', () => {
  test('the schema accepts the files of the tests and the settings of the plan', () => {
    expect(valid(WORK_YAML)).toBe(true)
    expect(valid(CODE_YAML)).toBe(true)
    expect(valid(SETTINGS + WORK_YAML)).toBe(true)
  })

  test('the schema refuses a key that the CLI refuses', () => {
    expect(valid(`project: x\n${WORK_YAML}`)).not.toBe(true)
    expect(valid(SETTINGS.replace('retryInput: continue', 'retryWords: continue') + WORK_YAML)).not.toBe(true)
    expect(valid(SETTINGS.replace('--session-id {session}', '') + WORK_YAML)).not.toBe(true)
  })

  test('the schema and the CLI know the same keys', async () => {
    // When work init refuses a key, it names the keys that it knows.
    const known = async (yaml, words) => {
      const { err } = await project({ 'aristoteles.yaml': yaml + WORK_YAML }).nanda('init')
      return err.match(new RegExp(`${words} \\(([^)]*)\\)`))[1].split(', ').sort()
    }
    const keys = Object.keys(schema.properties)
    expect(keys.sort()).toEqual(await known('colour: blue\n', 'is not a key of aristoteles.yaml'))
    expect(Object.keys(schema.$defs.tier.properties).sort())
      .toEqual(await known('tiers:\n  sol: { colour: x }\n', 'is not a setting of a tier'))
  })

  test('the name of a dir is its folder name; the file has no project key', async () => {
    const p = project({ 'aristoteles.yaml': SETTINGS + WORK_YAML })
    expect(ok(await p.nanda('init')).out).toStartWith('store made for report-export in aristoteles')
    // work init reads the file before it looks at the store, so each init below says what is wrong.
    const refusal = async (yaml) => {
      p.write('aristoteles.yaml', yaml)
      return (await p.nanda('init')).err
    }
    expect(await refusal(`project: report-export\n${WORK_YAML}`))
      .toContain('the name of a dir is the name of its folder; remove the project key')
    expect(await refusal(`colour: blue\n${WORK_YAML}`)).toContain('"colour" is not a key of aristoteles.yaml')
    expect(await refusal(`tiers:\n  luna: { launch: x {session} }\n${WORK_YAML}`))
      .toContain('tiers.luna: only sol and terra run in terminals (a luna is a subagent)')
    expect(await refusal(`tiers:\n  sol: { launch: agent-tool }\n${WORK_YAML}`))
      .toContain('tiers.sol.launch has no {session}')
  })

  // The page reads the settings (GET /api/dir) and saves them (POST /api/act).
  test('the settings have defaults', async () => {
    const p = project({ 'aristoteles.yaml': SETTINGS + WORK_YAML })
    const s = await settingsOf(p)
    expect(s.tiers.sol).toEqual({
      launch: 'agent-tool --model large --session-id {session}', resume: 'agent-tool --resume {session}',
      start: 'Use the work skill. Your command: work brief {token}', errors: [], prompts: [], silentMinutes: 10, retryInput: 'System message, not from the person. Run work next with your token, and do what it says.',
    })
    expect(s.tiers.terra.prompts).toEqual(['Do you want to proceed?'])
    expect([s.retryMinutes, s.hostWaitMinutes, s.sound, s.theme]).toEqual([5, 10, false, 'light'])
  })

  test('a write of the settings keeps every other line, and the stored config does not change', async () => {
    const { p, lead } = await started({ 'aristoteles.yaml': `${SETTINGS}# the roles below are ours\n${WORK_YAML}` })
    const settings = { sound: true, theme: 'dark', tiers: { sol: { launch: 'other-tool --session-id {session}' } } }
    expect(await act(p, 'settings', { settings })).toEqual({ out: 'the settings are saved.' })
    const text = readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')
    expect(text).toStartWith('# yaml-language-server: $schema=../schema/aristoteles.schema.json\n')
    expect(text).toContain(`# the roles below are ours\n${WORK_YAML}`)
    const now = await settingsOf(p)
    expect(now).toMatchObject({ sound: true, theme: 'dark', retryMinutes: 5 })
    expect(now.tiers.sol.launch).toBe('other-tool --session-id {session}')
    expect(now.tiers.terra).toBeUndefined()
    // The stored config is the mechanism only, so every command still runs.
    ok(await p.agent(`next ${lead}`))
  })

  test('a restore writes back the stored mechanism and keeps the settings of now', async () => {
    const { p, lead } = await started({ 'aristoteles.yaml': SETTINGS + WORK_YAML })
    expect((await act(p, 'settings', { settings: { theme: 'dark' } })).out).toBe('the settings are saved.')
    p.write('aristoteles.yaml', readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8').replace('name: Nanda', 'name: Someone'))
    expect((await p.agent(`brief ${lead}`)).err).toContain('aristoteles.yaml changed since the stored config')
    ok(await p.nanda('config restore', 'restore'))
    expect(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')).toContain('name: Nanda')
    expect((await settingsOf(p)).theme).toBe('dark')
    ok(await p.agent(`next ${lead}`))
  })
})

// work start runs in bin/main.ts, which no entry point of test/code.js reaches: this check is of
// the function that it calls.
describe('the skills of a launched AI tool', () => {
  test('work start links the missing skills into the skills folder of each tier, and says so', async () => {
    const { linkSkills } = await import('./code.js')
    const { lstatSync, readlinkSync } = await import('node:fs')
    const p = project({ 'aristoteles.yaml': `tiers:\n  sol: { skills: .claude/skills }\n  terra: { skills: .claude/skills }\n${WORK_YAML}` })
    p.write('.claude/skills/assess/SKILL.md', 'our own assess\n')
    expect(linkSkills(p.dir)).toEqual([`linked the skills aristoteles, work, role-fitness into ${join(p.dir, '.claude/skills')}`])
    expect(readlinkSync(join(p.dir, '.claude/skills/work'))).toBe(join(import.meta.dir, '..', 'skills', 'work'))
    expect(lstatSync(join(p.dir, '.claude/skills/assess')).isSymbolicLink()).toBe(false)
    expect(linkSkills(p.dir)).toEqual([])
  })

  test('git of the dir excludes the links and .work/, once, and keeps the app\'s own skill', async () => {
    const { linkSkills } = await import('./code.js')
    const { excludeFromGit } = await import('./code.js')
    const p = project({ 'aristoteles.yaml': `tiers:\n  sol: { skills: .claude/skills }\n${WORK_YAML}` })
    // The dir is a sub folder of its repo, so each line starts at the top of the repo.
    const top = dirname(p.dir)
    Bun.spawnSync(['git', 'init', '-q', top])
    p.write('.claude/skills/assess/SKILL.md', 'our own assess\n')
    expect(linkSkills(p.dir)).toEqual([
      `linked the skills aristoteles, work, role-fitness into ${join(p.dir, '.claude/skills')}`,
      'git of the dir excludes /report-export/.claude/skills/aristoteles, /report-export/.claude/skills/work, /report-export/.claude/skills/role-fitness',
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

// The first start of a dir (Nanda, 2026-11-12): the person pastes the assess prompt into the AI CLI
// that they use, in the dir. That CLI is the host and knows its own commands, so its draft brings
// the tiers; Accept the roles writes them into aristoteles.yaml and runs work init.
describe('the first start of a dir', () => {
  // A dir with only the settings that the person saved on the page, and its git user.
  const fresh = () => {
    const p = project({ 'aristoteles.yaml': 'tiers:\n  sol:\n    launch: page-tool --session-id {session}\n' })
    Bun.spawnSync(['git', 'init', '-q', p.dir])
    Bun.spawnSync(['git', '-C', p.dir, 'config', 'user.name', 'Nanda'])
    return p
  }
  const HOST_TIERS = 'tiers:\n  sol:\n    launch: host-cli --session-id {session} {prompt}\n    skills: .host/skills\n'

  test('the page shows the prompt; the tiers of the draft replace the saved ones, in one block', async () => {
    const p = fresh()
    const dir = await api(p, '/api/dir')
    expect(dir.initialized).toBe(false)
    expect(dir.startPrompt).toStartWith(`Use aristoteles in the folder ${p.dir}: read ${join(import.meta.dir, '..', 'skills', 'aristoteles', 'SKILL.md')}`)
    p.write('aristoteles.draft.yaml', HOST_TIERS + WORK_YAML)
    expect((await act(p, 'accept-roles')).out).toStartWith('store made for report-export in aristoteles')
    const text = readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')
    expect(text.match(/^tiers:/gm)).toHaveLength(1)
    expect(text).toContain(WORK_YAML)
    expect((await settingsOf(p)).tiers.sol).toMatchObject({ launch: 'host-cli --session-id {session} {prompt}', skills: '.host/skills' })
    expect(existsSync(join(p.dir, 'aristoteles.draft.yaml'))).toBe(false)
  })

  test('a draft whose tiers do not read is refused, and the files stay as they were', async () => {
    const p = fresh()
    const before = readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')
    p.write('aristoteles.draft.yaml', `tiers:\n  sol: { launch: host-cli }\n${WORK_YAML}`)
    expect((await act(p, 'accept-roles')).error).toBe('aristoteles.draft.yaml: aristoteles.yaml: tiers.sol.launch has no {session}: the UI gives each real agent its session id, so that a resume finds it')
    expect(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')).toBe(before)
    expect(existsSync(join(p.dir, 'aristoteles.draft.yaml'))).toBe(true)
    expect((await api(p, '/api/dir')).initialized).toBe(false)
  })

  test('work config check reads the draft as Accept the roles does, for any caller, and writes nothing', async () => {
    const p = fresh()
    const before = readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')
    p.write('aristoteles.draft.yaml', HOST_TIERS + WORK_YAML)
    const checked = ok(await p.agent('config check')).out.split('\n')
    expect(checked[0]).toBe('aristoteles.draft.yaml reads, merged into aristoteles.yaml as Accept the roles does; nothing was written.')
    expect(checked[1]).toStartWith('the static fit checks pass for architect, section-lead, writer')
    expect(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')).toBe(before)
    expect(existsSync(join(p.dir, '.work', 'aristoteles.db'))).toBe(false)
    p.write('aristoteles.draft.yaml', HOST_TIERS + WORK_YAML.replace('Give one --evidence line', 'Ensure one --evidence line'))
    expect((await p.agent('config check')).err).toMatch(/^refused: aristoteles\.draft\.yaml: linter: ".*" uses the vague verb "ensure"/)
    // The same words as the refusal of the page.
    p.write('aristoteles.draft.yaml', `tiers:\n  sol: { launch: host-cli }\n${WORK_YAML}`)
    expect((await p.agent('config check')).err).toContain('aristoteles.draft.yaml: aristoteles.yaml: tiers.sol.launch has no {session}')
  })

  test('the host records the fit of each role as a model run; the person and a role do not use --by', async () => {
    const p = project()
    ok(await p.nanda('init'))
    // The host runs in a shell with no terminal, so the person's command is refused there.
    expect((await p.agent('role fit writer --answers=fit.yaml')).err).toContain('this is a person command')
    expect(ok(await p.agent('role fit writer --answers=fit.yaml --by=assess')).out).toBe('writer fits; recorded by assess.')
    expect(ok(await p.agent('role list')).out).not.toMatch(/^writer .*no fit record/m)
    expect(ok(await p.agent('log')).out).toMatch(/^e2 .* assess run \S+ \(run\) role\.fit$/m)
    // I4 (N6): the person's --by is not used: the person records the fit, with no refusal.
    expect(ok(await p.nanda('role fit architect --answers=fit.yaml --by=assess')).out).toBe('architect fits; recorded.')
    expect((await p.agent('role fit architect --answers=fit.yaml --by=assess --as=a1.k0001')).err).toContain('a high role passes only --as=<its token>')
    expect((await p.agent('role fit architect --answers=fit.yaml --by=Host')).err).toContain('--by=<its name in lower case>')
  })
})
