// work skill install (ruling 12, onboarding 2026-11-14): the /aristoteles skill in a project with
// no aristoteles.yaml, as two local links to the one SKILL.md of the code. Git of the dir excludes
// both; no instruction file of the project changes; a second run changes nothing.
import { describe, expect, test } from 'bun:test'
import { lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { ok, onboardingProject } from './harness.js'

const SKILL = join(import.meta.dir, '..', 'skills', 'aristoteles', 'SKILL.md')
const LINKS = ['.claude/skills/aristoteles/SKILL.md', '.agents/skills/aristoteles/SKILL.md']
const excludeOf = (dir) => readFileSync(join(dir, '.git', 'info', 'exclude'), 'utf8')
const inGit = () => {
  const p = onboardingProject()
  Bun.spawnSync(['git', 'init', '-q', p.dir])
  return p
}

describe('work skill install', () => {
  test('both links point to the SKILL.md of the code; git excludes each once; a second run changes nothing', async () => {
    const p = inGit()
    const out = ok(await p.agent('skill install')).out
    expect(out).toContain(`linked the /aristoteles skill: ${LINKS.join(', ')} -> ${SKILL}`)
    expect(out).toContain(`next: read ${SKILL} and do what it says`)
    for (const link of LINKS) expect(readlinkSync(join(p.dir, link))).toBe(SKILL)
    const excluded = excludeOf(p.dir)
    for (const link of LINKS) expect(excluded.split('\n').filter((l) => l === `/${link}`)).toHaveLength(1)
    const again = ok(await p.agent('skill install')).out
    expect(again).toStartWith('the /aristoteles skill is linked already; nothing changed.')
    expect(excludeOf(p.dir)).toBe(excluded)
    const status = Bun.spawnSync(['git', '-C', p.dir, 'status', '--porcelain', '--untracked-files=all']).stdout.toString()
    expect(status).not.toContain('skills/aristoteles')
  })

  test('an old link of the whole folder is replaced, and the SKILL.md of the code stays as it is', async () => {
    const p = inGit()
    const before = readFileSync(SKILL, 'utf8')
    mkdirSync(join(p.dir, '.claude', 'skills'), { recursive: true })
    symlinkSync(join(import.meta.dir, '..', 'skills', 'aristoteles'), join(p.dir, '.claude', 'skills', 'aristoteles'))
    ok(await p.agent('skill install'))
    expect(lstatSync(join(p.dir, '.claude/skills/aristoteles')).isDirectory()).toBe(true)
    expect(readlinkSync(join(p.dir, LINKS[0]))).toBe(SKILL)
    expect(lstatSync(SKILL).isSymbolicLink()).toBe(false)
    expect(readFileSync(SKILL, 'utf8')).toBe(before)
  })

  test("a skill of the project's own stays, and the install says so", async () => {
    const p = inGit()
    p.write('.agents/skills/aristoteles/SKILL.md', 'our own skill\n')
    const out = ok(await p.agent('skill install')).out
    expect(out).toContain("kept .agents/skills/aristoteles/SKILL.md (the project's own); the install does not change it")
    expect(readFileSync(join(p.dir, LINKS[1]), 'utf8')).toBe('our own skill\n')
    expect(readlinkSync(join(p.dir, LINKS[0]))).toBe(SKILL)
    expect(excludeOf(p.dir)).not.toContain('.agents/skills')
  })

  test('outside git the links are made, and nothing is excluded', async () => {
    const p = onboardingProject()
    const out = ok(await p.agent('skill install')).out
    expect(out).not.toContain('git of the dir excludes')
    for (const link of LINKS) expect(readlinkSync(join(p.dir, link))).toBe(SKILL)
  })
})
