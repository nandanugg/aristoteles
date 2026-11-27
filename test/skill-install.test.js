import { describe, expect, test } from 'bun:test'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const SKILL = join(import.meta.dir, '..', 'skills', 'aristoteles', 'SKILL.md')
const LINKS = ['.claude/skills/aristoteles/SKILL.md', '.agents/skills/aristoteles/SKILL.md']
const excludeOf = (dir) => readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')
const project = () => mkdtempSync(join(tmpdir(), 'skill-project-'))
const install = (dir) => {
  const installed = Bun.spawnSync(['bun', join(import.meta.dir, '../bin/work.js'), 'skill', 'install'], {
    cwd: dir, env: { ...process.env, WORK_DIR: dir },
  })
  expect(installed.stderr.toString()).toBe('')
  expect(installed.exitCode).toBe(0)
  return installed.stdout.toString()
}
const inGit = () => {
  const dir = project()
  expect(Bun.spawnSync(['git', 'init', '-q', dir]).exitCode).toBe(0)
  return dir
}

describe('work skill install', () => {
  test('both links point to the SKILL.md of the code; git excludes each once; a second run changes nothing', () => {
    const dir = inGit()
    const out = install(dir)
    expect(out).toContain(`linked the /aristoteles skill: ${LINKS.join(', ')} -> ${SKILL}`)
    for (const link of LINKS) expect(readlinkSync(join(dir, link))).toBe(SKILL)
    const excluded = excludeOf(dir)
    for (const link of LINKS) expect(excluded.split('\n').filter((l) => l === `/${link}`)).toHaveLength(1)
    const again = install(dir)
    expect(again).toStartWith('the /aristoteles skill is linked already; nothing changed.')
    expect(excludeOf(dir)).toBe(excluded)
    const status = Bun.spawnSync(['git', '-C', dir, 'status', '--porcelain', '--untracked-files=all']).stdout.toString()
    expect(status).not.toContain('skills/aristoteles')
  })

  test('a link to the entire installed skill is replaced with a local SKILL.md link', () => {
    const dir = inGit()
    const before = readFileSync(SKILL, 'utf8')
    mkdirSync(join(dir, '.claude', 'skills'), { recursive: true })
    symlinkSync(join(import.meta.dir, '..', 'skills', 'aristoteles'), join(dir, '.claude', 'skills', 'aristoteles'))
    install(dir)
    expect(lstatSync(join(dir, '.claude/skills/aristoteles')).isDirectory()).toBe(true)
    expect(readlinkSync(join(dir, LINKS[0]))).toBe(SKILL)
    expect(lstatSync(SKILL).isSymbolicLink()).toBe(false)
    expect(readFileSync(SKILL, 'utf8')).toBe(before)
  })

  test("a skill of the project's own stays, and the install says so", () => {
    const dir = inGit()
    const own = join(dir, LINKS[1])
    mkdirSync(dirname(own), { recursive: true })
    writeFileSync(own, 'our own skill\n')
    const out = install(dir)
    expect(out).toContain("kept .agents/skills/aristoteles/SKILL.md (the project's own); the install does not change it")
    expect(readFileSync(join(dir, LINKS[1]), 'utf8')).toBe('our own skill\n')
    expect(readlinkSync(join(dir, LINKS[0]))).toBe(SKILL)
    expect(excludeOf(dir)).not.toContain('.agents/skills')
  })

  test('outside git the links are made, and nothing is excluded', () => {
    const dir = project()
    const out = install(dir)
    expect(out).not.toContain('git of the dir excludes')
    for (const link of LINKS) expect(readlinkSync(join(dir, link))).toBe(SKILL)
  })
})
