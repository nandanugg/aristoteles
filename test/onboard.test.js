// Onboarding at a terminal (BUILD.md 1e; rulings 1 to 5, 7, 15, onboarding 2026-11-14): the host
// drafts into the files with work onboard, the person decides as on the two pages, and nothing is
// stored until approve-roles starts the store with the accepted result only. Each refusal of the
// start leaves aristoteles.yaml and the onboarding files as they were.
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  git,
  LADDER_FILES,
  ok,
  ONBOARD_CONFIG,
  ONBOARD_DIRECTION,
  ONBOARD_NEW,
  ONBOARD_QUESTIONS,
  onboardingProject,
  withFlow,
  withLadders,
} from './harness.js'

const ROLES = ['architect', 'section-lead', 'writer', 'linter']
const exists = (p, path) => existsSync(join(p.dir, path))
const eventsOf = (p) => {
  const db = new Database(join(p.dir, '.work', 'aristoteles.db'), { readonly: true })
  const rows = db.query('SELECT seq, record, member, event FROM event ORDER BY seq').all()
  db.close()
  return rows
}

// The host's config draft, a direction that it found and drafted, and every role accepted: what
// is left is the person's approve of the directions and the start.
async function drafted() {
  const p = onboardingProject()
  p.write('draft.yaml', ONBOARD_CONFIG)
  ok(await p.agent('onboard config --file=draft.yaml'))
  ok(await p.agent('onboard found tsd-writing'))
  p.write('tsd.yaml', ONBOARD_DIRECTION)
  ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
  return p
}
const acceptAll = async (p) => {
  ok(await p.nanda('onboard approve-directions', 'approve'))
  for (const role of ROLES) ok(await p.nanda(`onboard accept-role ${role}`))
}

describe('the whole onboarding at a terminal', () => {
  test('config, found, draft, ask, answer, revise, remove, approve, roles, persistence, and the start', async () => {
    const p = onboardingProject()
    p.write('draft.yaml', ONBOARD_CONFIG)
    expect(ok(await p.agent('onboard config --file=draft.yaml')).out).toContain(
      'aristoteles.draft.yaml holds the config draft: 4 roles (architect, section-lead, writer, linter)',
    )
    ok(await p.agent('onboard found tsd-writing'))
    ok(await p.agent('onboard found code-proof'))
    p.write('tsd.yaml', ONBOARD_DIRECTION)
    expect(ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml')).out).toStartWith(
      'tsd-writing: drafted, with 3 cases; it shows Ready.',
    )
    // Ruling 5: the person adds a new direction; its first draft names its id.
    expect(ok(await p.nanda('onboard add --principle="A section says one thing"')).out).toStartWith('new-1: a new direction')
    p.write('one.yaml', ONBOARD_NEW)
    expect(ok(await p.agent('onboard draft new-1 --file=one.yaml')).out).toStartWith('one-thing: drafted (it was new-1)')
    // The host asks with a case and two options; the person answers; the host's wait wakes.
    p.write('q.yaml', ONBOARD_QUESTIONS)
    ok(await p.agent('onboard ask one-thing --file=q.yaml'))
    // Nanda, 2026-11-15: a direction has a summary; status shows it under the line of a draft.
    expect(ok(await p.agent('onboard status')).out).toContain(
      '  one-thing · Question · One thing per section · asked for by the person: "A section says one thing" · 3 cases\n' +
        '    summary: Each section of a TSD keeps to one topic, so a reader finds it fast.\n' +
        '    1 question for the person: work onboard show one-thing; work onboard answer one-thing --options=A',
    )
    // The summary comes before the words of the direction.
    expect(ok(await p.nanda('onboard show one-thing')).out).toContain(
      'name: One thing per section\n' +
        'summary: Each section of a TSD keeps to one topic, so a reader finds it fast.\n' +
        'from: Logos\nsays: Each section says one thing.\n',
    )
    // Nanda, 2026-11-15: a case is a ladder to an output, one line for each rung (was: one line).
    expect(ok(await p.nanda('onboard show one-thing')).out).toContain(
      '  1. Does a section of facts count as one thing?\n' +
        '    Follows · current\n' +
        '      Output · docs/facts.md:3 "## Dedupe"\n' +
        '     A: each fact is one thing\n     B: the facts together are one thing',
    )
    // Nanda, 2026-11-15: a reply names the direction and what each answer chose (was: the letters).
    expect(ok(await p.nanda('onboard answer one-thing --options=B')).out).toBe(
      'the answers of One thing per section (one-thing) decide its next draft: B ("the facts together are one thing") to "Does a section of facts count as one thing?"; it shows Loading until the host drafts it again.',
    )
    expect(ok(await p.agent('onboard wait --seconds=1')).out).toContain(
      '    the answers of One thing per section (one-thing) decide its next draft: B ("the facts together are one thing") to "Does a section of facts count as one thing?" (the host: work onboard draft one-thing --file=<direction.yaml>',
    )
    ok(await p.agent('onboard draft one-thing --file=one.yaml'))
    // Ruling 2: a Revise goes to the host, which drafts again; a remove keeps nothing.
    ok(await p.nanda('onboard revise tsd-writing --words="name the reader of the TSD"'))
    expect(ok(await p.agent('onboard wait --seconds=1')).out).toContain('the person asks: "name the reader of the TSD"')
    ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
    ok(await p.nanda('onboard remove code-proof'))
    expect(exists(p, '.work/assess/code-proof.yaml')).toBe(false)
    expect(ok(await p.nanda('onboard approve-directions', 'approve')).out).toContain(
      'accepted: one-thing, tsd-writing.\nevery direction is accepted or removed: the roles come next',
    )
    // Ruling 7: the person's toggle writes the persistence with a true reason (P11).
    ok(await p.nanda('onboard persistence writer --persistent=true'))
    for (const role of ROLES) ok(await p.nanda(`onboard accept-role ${role}`))
    expect(ok(await p.agent('onboard status')).out).toContain(
      'next: everything is accepted; the person starts the store: work onboard approve-roles',
    )
    const started = ok(await p.nanda('onboard approve-roles', 'approve')).out
    expect(started).toContain('store made for report-export in aristoteles: 4 roles and 2 directions; the onboarding files are gone.')
    // Question 20, option A: one Workflow.Defined holds the config and the accepted directions.
    const events = eventsOf(p)
    expect(events.map((e) => `${e.record}.${e.member}`)).toEqual(['Workflow.Defined'])
    const { directions } = JSON.parse(events[0].event).create
    expect(directions.map((x) => [x.direction.id, x.direction.owner, x.cases.length, x.source._tag])).toEqual([
      ['one-thing', 'Nanda', 3, 'Local'],
      ['tsd-writing', 'Nanda', 3, 'Local'],
    ])
    expect(ok(await p.nanda('direction show tsd-writing')).out).toContain(
      'tsd-writing@1 TSD writing (owner Nanda) · current\nmade from d2, drafted by the store start of onboarding (e1)',
    )
    for (const path of ['.work/assess', 'aristoteles.draft.yaml', '.work/onboarding.lock']) expect(exists(p, path)).toBe(false)
    const config = Bun.YAML.parse(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8'))
    expect(config.roles.writer.persistence).toEqual({ persistent: true, why: 'Nanda chose it on the agents page.' })
    expect(config.roles.linter.summary).toBeUndefined()
    // After the start, an onboarding act is refused: a change is an adjustment now (ruling 14).
    expect((await p.nanda('onboard add --principle="one more"')).err).toContain('the store of this dir has started, so onboarding is over')
  })
})

// A company repo with one direction, one standard and one rule (ruling 6).
const companyRepo = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'company-'))
  const folder = 'directions/feature-flags'
  await Bun.write(join(dir, folder, 'direction.md'), '# Feature flags\n\nEach critical change is under a flag.\n')
  await Bun.write(join(dir, folder, 'naming/standard.md'), 'The flag name tells the feature.\n')
  await Bun.write(join(dir, folder, 'naming/upper-snake.md'), 'The flag is FF_<FEATURE>.\n')
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'feature flags')
  return { dir, folder, commit: git(dir, 'rev-parse', 'HEAD') }
}
// Nanda, 2026-11-15: a direction has a flow; the host writes the flow of a company direction in
// this project.
const COMPANY_DRAFT = `checkedBy: linter
flow:
  - { from: writer, to: docs/tsd.md, says: puts each change under a flag, file: docs/tsd.md, line: 7 }
cases:
  - { file: docs/tsd.md, line: 3, excerpt: "## Introduction", fit: Follows }
  - { file: docs/tsd.md, line: 5, excerpt: TODO, fit: Breaks }
  - { file: docs/facts.md, line: 3, excerpt: "## Dedupe", fit: Follows }
`
const withCompany = async () => {
  const company = await companyRepo()
  const p = onboardingProject()
  p.write('draft.yaml', ONBOARD_CONFIG)
  ok(await p.agent('onboard config --file=draft.yaml'))
  const added = ok(await p.nanda(`onboard company --repo=${company.dir} --path=${company.folder}`)).out
  expect(added).toStartWith('feature-flags: a company direction from directions/feature-flags of')
  p.write('ff.yaml', COMPANY_DRAFT)
  ok(await p.agent('onboard draft feature-flags --file=ff.yaml'))
  await acceptAll(p)
  return { p, company }
}

describe('a company direction in onboarding (ruling 6)', () => {
  test('its words come from the folder; the start keeps it a company direction, in aristoteles.lock', async () => {
    const { p, company } = await withCompany()
    ok(await p.nanda('onboard approve-roles', 'approve'))
    const { directions } = JSON.parse(eventsOf(p)[0].event).create
    expect(directions[0].direction.standards[0].rules[0]).toEqual({
      id: 'upper-snake', says: 'The flag is FF_<FEATURE>.', checkedBy: 'linter', supersedes: [],
    })
    // Nanda, 2026-11-15: a direction has a summary. The host writes no words of a company
    // direction: its summary is the first sentence of the folder's words, under the heading.
    expect(directions[0].direction.summary).toBe('Each critical change is under a flag.')
    expect(directions[0].direction.flow).toEqual([
      { from: 'writer', to: 'docs/tsd.md', says: 'puts each change under a flag', file: 'docs/tsd.md', line: 7 },
    ])
    expect(directions[0].source).toEqual({
      _tag: 'External', repo: company.dir, path: company.folder, ref: { _tag: 'DefaultBranch' }, commit: company.commit,
    })
    const lock = Bun.YAML.parse(readFileSync(join(p.dir, 'aristoteles.lock'), 'utf8'))
    expect(lock['feature-flags']).toEqual({
      repo: company.dir, path: company.folder, owner: 'Nanda', rules: { 'upper-snake': 'linter' }, commit: company.commit,
    })
    // The refresh of the next command finds the folder as the store holds it: no new draft.
    expect(ok(await p.nanda('waiting')).err).not.toContain('came in')
  })

  test('the start refuses a company folder that changed since its draft', async () => {
    const { p, company } = await withCompany()
    await Bun.write(join(company.dir, company.folder, 'naming/upper-snake.md'), 'The flag is FF_<TEAM>_<FEATURE>.\n')
    git(company.dir, 'commit', '-q', '-am', 'the team')
    const r = await p.nanda('onboard approve-roles', 'approve')
    expect(r.err).toContain('refused: the company folder of feature-flags changed since its draft')
    expect(exists(p, 'aristoteles.yaml')).toBe(false)
    expect(exists(p, 'aristoteles.lock')).toBe(false)
    expect(exists(p, '.work/assess/feature-flags.yaml')).toBe(true)
  })
})

describe('what onboarding refuses', () => {
  test('the start refuses a direction that is not accepted, and leaves the files as they were', async () => {
    const p = await drafted()
    for (const role of ROLES) ok(await p.nanda(`onboard accept-role ${role}`))
    const r = await p.nanda('onboard approve-roles', 'approve')
    expect(r.err).toContain('refused: tsd-writing is not accepted yet')
    expect(r.err).toContain('next: accept it or remove it (work onboard accept|remove tsd-writing), then approve again')
    expect(exists(p, 'aristoteles.yaml')).toBe(false)
    expect(exists(p, '.work/assess/tsd-writing.yaml')).toBe(true)
    expect(exists(p, '.work/aristoteles.db')).toBe(false)
  })

  test('the start refuses a rule whose checker is no accepted role, and writes aristoteles.yaml back', async () => {
    const settings = 'theme: dark\nsound: false\n'
    const p = await drafted()
    p.write('aristoteles.yaml', settings)
    await acceptAll(p)
    // The person removes the linter, which checks two rules of tsd-writing.
    ok(await p.nanda('onboard remove-role linter'))
    const r = await p.nanda('onboard approve-roles', 'approve')
    expect(r.err).toContain('refused: rule no-code-proof of tsd-writing is checked by linter, which is not an accepted role')
    expect(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')).toBe(settings)
    expect(exists(p, '.work/assess/tsd-writing.yaml')).toBe(true)
    expect(exists(p, 'aristoteles.draft.yaml')).toBe(true)
    expect(exists(p, '.work/onboarding.lock')).toBe(false)
  })

  // Nanda, 2026-11-15: a direction has a summary; a draft sent with none is refused with what to write.
  test('a draft with no summary is refused, and the refusal says what to write', async () => {
    const p = await drafted()
    p.write('bare.yaml', ONBOARD_DIRECTION.replace(/summary: .*\n/, ''))
    const r = await p.agent('onboard draft tsd-writing --file=bare.yaml')
    expect(r.err).toContain(
      'refused: bare.yaml: summary is required: one or two plain sentences that say what the ' +
        'direction asks and why it matters, for a person who reads it the first time',
    )
  })

  test('a draft refuses a case whose excerpt is not in its file, and fewer than 3 cases', async () => {
    const p = await drafted()
    // P10 rejected, onboarding 2026-11-14: a direction starts with 3 real cases or more.
    p.write('stale.yaml', ONBOARD_DIRECTION.replace('excerpt: TODO', 'excerpt: DONE'))
    expect((await p.agent('onboard draft tsd-writing --file=stale.yaml')).err).toContain(
      'refused: stale.yaml: case 3: "DONE" is not in docs/tsd.md',
    )
    p.write('few.yaml', ONBOARD_DIRECTION.replace(/ {2}- \{ file: docs\/tsd.md, line: 5.*\n/, ''))
    expect((await p.agent('onboard draft tsd-writing --file=few.yaml')).err).toContain('refused: few.yaml: cases lists 2')
  })

  // Nanda, 2026-11-15: a case is a ladder from the direction down to a real output.
  test('a draft of ladders: show gives one line for each rung, and a stale rung is refused', async () => {
    const p = onboardingProject(LADDER_FILES)
    p.write('draft.yaml', ONBOARD_CONFIG)
    ok(await p.agent('onboard config --file=draft.yaml'))
    ok(await p.agent('onboard found tsd-writing'))
    const ladders = withLadders(ONBOARD_DIRECTION)
    p.write('stale.yaml', ladders.replace('excerpt: Write one heading for each section.', 'excerpt: Write two headings.'))
    expect((await p.agent('onboard draft tsd-writing --file=stale.yaml')).err).toContain(
      'refused: stale.yaml: case 1, rung 2 (Writer skill): "Write two headings." is not in .claude/skills/writer/SKILL.md',
    )
    p.write('tsd.yaml', ladders)
    ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
    expect(ok(await p.nanda('onboard show tsd-writing')).out).toContain(
      'cases:\n' +
        '  Follows · current\n' +
        '    Instruction · CLAUDE.md:3 "Each TSD section says one thing."\n' +
        '    Writer skill · .claude/skills/writer/SKILL.md:3 "Write one heading for each section."\n' +
        '    Template · docs/template.md:3 "## Introduction"\n' +
        '    Output · docs/tsd.md:3 "## Introduction"\n' +
        '  Breaks · current\n' +
        '    Instruction · CLAUDE.md:3 "Each TSD section says one thing."\n' +
        '    Output · docs/tsd.md:5 "TODO"\n' +
        '  Follows · current\n' +
        '    Output · docs/facts.md:5 "The export ran twice for one merchant."',
    )
    // The excerpt of a rung leaves its file: each case with that rung is stale, and its line says so.
    p.write('CLAUDE.md', '# How we write\n\nA section may say two things.\n')
    expect(ok(await p.nanda('onboard show tsd-writing')).out).toContain(
      '  Breaks · stale\n' +
        '    Instruction · CLAUDE.md:3 "Each TSD section says one thing." · stale\n' +
        '    Output · docs/tsd.md:5 "TODO"\n',
    )
    expect(ok(await p.agent('onboard status')).out).toContain('found in the project · 3 cases, 2 stale')
  })

  // Nanda, 2026-11-15: a direction has a flow, from the first act down to the output.
  test('a draft with a flow: show prints its steps after the summary, an act on its own once', async () => {
    const p = onboardingProject(LADDER_FILES)
    p.write('draft.yaml', ONBOARD_CONFIG)
    ok(await p.agent('onboard config --file=draft.yaml'))
    ok(await p.agent('onboard found tsd-writing'))
    p.write('tsd.yaml', withFlow(ONBOARD_DIRECTION))
    ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
    expect(ok(await p.nanda('onboard show tsd-writing')).out).toContain(
      'summary: A TSD lets its reader decide without a meeting, so each page stands alone.\n' +
        'flow:\n' +
        '  1. Person -> architect: asks for a TSD of the export\n' +
        '  2. architect -> writer: gives each section to a writer (CLAUDE.md:3)\n' +
        '  3. writer: reads the rule of one heading for each section (.claude/skills/writer/SKILL.md:3)\n' +
        '  4. writer -> docs/tsd.md: fills the template one section at a time (docs/template.md:3)\n' +
        '  5. linter -> docs/tsd.md: checks that each section says one thing\n' +
        'from: Pathos, Logos\n',
    )
    p.write('bad.yaml', withFlow(ONBOARD_DIRECTION).replace('says: asks for a TSD of the export', 'says: " "'))
    expect((await p.agent('onboard draft tsd-writing --file=bad.yaml')).err).toContain(
      'refused: bad.yaml: flow step 1 needs from, to and says: who acts, on whom or on what file, and what happens',
    )
  })

  test('work init refuses while onboarding files exist', async () => {
    const p = await drafted()
    p.write('aristoteles.yaml', ONBOARD_CONFIG)
    const r = await p.nanda('init')
    expect(r.err).toContain('refused: onboarding files are in this dir (.work/assess/ or aristoteles.draft.yaml)')
    expect(r.err).toContain('next: approve all on the agents page, or run work onboard approve-roles')
    expect(exists(p, '.work/aristoteles.db')).toBe(false)
  })

  // Ruling 1, onboarding 2026-11-14: the config draft reads as the store start would read it, so a
  // draft whose tiers do not read is refused when the host sends it (was: at accept-roles).
  test('a config draft whose tiers do not read is refused, and no file is written', async () => {
    const p = onboardingProject()
    p.write('draft.yaml', `tiers:\n  sol: { launch: host-cli }\n${ONBOARD_CONFIG}`)
    const r = await p.agent('onboard config --file=draft.yaml')
    expect(r.err).toContain('tiers.sol.launch has no {session}')
    expect(exists(p, 'aristoteles.draft.yaml')).toBe(false)
  })

  test('the role of the top task has no toggle (ruling 15)', async () => {
    const p = await drafted()
    for (const persistent of ['false', 'true']) {
      expect((await p.nanda(`onboard persistence architect --persistent=${persistent}`)).err).toContain(
        'refused: architect is the role of the top task (the only persistent high role), so it has no toggle',
      )
    }
    expect((await p.nanda('onboard persistence section-lead --persistent=false')).code).toBe(0)
  })
})
