import { initializeLegacy } from './legacy-onboarding-fixture.js'
// Onboarding at a terminal (BUILD.md 1e; rulings 1 to 5, 7, 15, onboarding 2026-11-14): the host
// drafts into the files with work onboard, the person decides as on the two pages, and nothing is
// stored by the file endpoints. Retained config tests seed their store explicitly.
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  FLOW_FILES,
  git,
  ok,
  ONBOARD_CONFIG,
  ONBOARD_DIRECTION,
  ONBOARD_NEW,
  ONBOARD_QUESTIONS,
  onboardingProject,
  withModels,
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

test('onboarding refuses flow cases and reopens an accepted legacy draft', async () => {
  const p = await drafted()
  const old = Bun.YAML.parse(ONBOARD_DIRECTION)
  const sample = old.standards[0].rules[0].evidence.cases[0]
  old.flow.at(-1).examples = [sample]
  p.write('legacy.yaml', Bun.YAML.stringify(old))
  expect((await p.agent('onboard draft tsd-writing --file=legacy.yaml')).err).toContain('put cases in rule evidence')

  ok(await p.nanda('onboard approve-directions', 'approve'))
  const path = '.work/assess/tsd-writing.yaml'
  const accepted = Bun.YAML.parse(readFileSync(join(p.dir, path), 'utf8'))
  expect(accepted.stage._tag).toBe('Accepted')
  accepted.stage.draft.content.flow.at(-1).examples = [sample]
  p.write(path, Bun.YAML.stringify(accepted))
  expect(ok(await p.agent('onboard status')).out).toContain('tsd-writing is not in the current shape')
  expect((await p.nanda('onboard accept tsd-writing')).err).toContain('tsd-writing is not in the current shape')
  ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
  ok(await p.nanda('onboard approve-directions', 'approve'))
})

test('a live revise can carry accepted onboarding evidence with no observed break', async () => {
  const p = await drafted()
  const sparse = Bun.YAML.parse(ONBOARD_DIRECTION)
  for (const rule of sparse.standards.flatMap((s) => s.rules)) {
    if (rule.evidence) rule.evidence.cases = rule.evidence.cases.filter((e) => e.fit === 'Follows')
  }
  p.write('sparse.yaml', Bun.YAML.stringify(sparse))
  ok(await p.agent('onboard draft tsd-writing --file=sparse.yaml'))
  await acceptAll(p)
  ok(await initializeLegacy(p))
  p.write('unchanged-evidence.yaml', 'says: The reader can make a decision from the page.\n')
  expect(ok(await p.agent('direction revise tsd-writing --file=unchanged-evidence.yaml --by=host')).out).toContain('d2 drafted')
  ok(await p.nanda('direction accept d2', 'accept'))
  // The exception survives the unrelated revision, including when the same flow is supplied.
  p.write('same-flow.yaml', Bun.YAML.stringify({ flow: sparse.flow, says: 'Make the decision explicit.' }))
  expect(ok(await p.agent('direction revise tsd-writing --file=same-flow.yaml --by=host')).out).toContain('d3 drafted')
  const next = structuredClone(sparse.flow.at(-1))
  next.says = 'A newly governed step'
  p.write('new-flow.yaml', Bun.YAML.stringify({ flow: [next] }))
  expect((await p.agent('direction revise tsd-writing --file=new-flow.yaml --by=host')).err).toContain(
    'flow step 1: the rules it uses have no case that breaks',
  )
})

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
      'tsd-writing: drafted, with 4 examples; it shows Ready.',
    )
    // Ruling 5: the person adds a new direction; its first draft names its id.
    expect(ok(await p.nanda('onboard add --principle="A section says one thing"')).out).toStartWith('new-1: a new direction')
    p.write('one.yaml', ONBOARD_NEW)
    expect(ok(await p.agent('onboard draft new-1 --file=one.yaml')).out).toStartWith('one-thing: drafted (it was new-1)')
    // The host asks with an example and two options; the person answers; the host's wait wakes.
    p.write('q.yaml', ONBOARD_QUESTIONS)
    ok(await p.agent('onboard ask one-thing --file=q.yaml'))
    // Nanda, 2026-11-15: a direction has a summary; status shows it under the line of a draft.
    expect(ok(await p.agent('onboard status')).out).toContain(
      '  one-thing · Question · One thing per section · asked for by the person: "A section says one thing" · 3 examples\n' +
        '    summary: Each section of a TSD keeps to one topic, so a reader finds it fast.\n' +
        '    1 question for the person: work onboard show one-thing; work onboard answer one-thing --options=A',
    )
    // The summary comes before the words of the direction.
    expect(ok(await p.nanda('onboard show one-thing')).out).toContain(
      'name: One thing per section\n' +
        'summary: Each section of a TSD keeps to one topic, so a reader finds it fast.\n' +
        'flow:\n  1. writer -> docs/tsd.md: writes one section [uses one-thing, one-heading]\n' +
        'from: Logos\nsays: Each section says one thing.\n',
    )
    // Nanda, 2026-11-15: a question names an example, with no step (was: a case, a ladder).
    expect(ok(await p.nanda('onboard show one-thing')).out).toContain(
      '  1. Does a section of facts count as one thing?\n' +
        '      Follows\n' +
        '        output · docs/facts.md:3 "## Dedupe"\n' +
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
    expect((await p.nanda('onboard persistence writer --persistent=true')).err).toContain('.work/staffing.yaml')
    for (const role of ROLES) ok(await p.nanda(`onboard accept-role ${role}`))
    expect(ok(await p.agent('onboard status')).out).toContain(
      'next: accept the journal onboarding proposals to activate the project',
    )
    const refused = await p.nanda('onboard approve-roles', 'approve')
    expect(refused.err).toContain('Accept the journal onboarding proposals')
    ok(await initializeLegacy(p))
    const events = eventsOf(p)
    expect(events.map((e) => `${e.record}.${e.member}`)).toEqual(['Workflow.Initialized'])
    const { directions } = JSON.parse(events[0].event).create
    expect(directions.map((x) => [x.direction.id, x.direction.owner, x.direction.standards.flatMap((s) => s.rules.flatMap((r) => r.evidence?.cases ?? [])).length, x.source._tag])).toEqual([
      ['one-thing', 'Nanda', 3, 'Local'],
      ['tsd-writing', 'Nanda', 4, 'Local'],
    ])
    expect(ok(await p.nanda('direction show tsd-writing')).out).toContain(
      'tsd-writing@1 TSD writing (owner Nanda) · current\nmade from d2, drafted by the store start of onboarding (e1)',
    )
    for (const path of ['.work/assess', 'aristoteles.draft.yaml', '.work/onboarding.lock']) expect(exists(p, path)).toBe(false)
    const config = Bun.YAML.parse(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8'))
    expect(config.roles.writer.persistence).toBeUndefined()
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
// this project, the steps that it governs marked, and the examples of those steps.
const COMPANY_DRAFT = `checkedBy: linter
flow:
  - from: writer
    to: docs/tsd.md
    says: puts each change under a flag
    place: { file: docs/tsd.md, line: 7 }
    uses: [feature-flags, upper-snake]
evidence:
  upper-snake:
    evidence:
      scope: { searched: [docs/tsd.md], unknown: [] }
      check: { _tag: Absent }
      knownBreaks: []
      cases:
        - { fit: Follows, output: { file: docs/tsd.md, line: 3, excerpt: "## Introduction" } }
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
    ok(await initializeLegacy(p))
    const { directions } = JSON.parse(eventsOf(p)[0].event).create
    expect(directions[0].direction.standards[0].rules[0]).toMatchObject({
      id: 'upper-snake', says: 'The flag is FF_<FEATURE>.', checkedBy: 'linter', supersedes: [],
    })
    // Nanda, 2026-11-15: a direction has a summary. The host writes no words of a company
    // direction: its summary is the first sentence of the folder's words, under the heading.
    expect(directions[0].direction.summary).toBe('Each critical change is under a flag.')
    expect(directions[0].direction.flow).toEqual([
      {
        from: 'writer', to: 'docs/tsd.md', says: 'puts each change under a flag', place: { file: 'docs/tsd.md', line: 7 },
        uses: ['feature-flags', 'upper-snake'],
      },
    ])
    expect(directions[0].source).toEqual({
      _tag: 'External', repo: company.dir, path: company.folder, ref: { _tag: 'DefaultBranch' }, commit: company.commit,
    })
    const lock = Bun.YAML.parse(readFileSync(join(p.dir, 'aristoteles.lock'), 'utf8'))
    expect(lock['feature-flags']).toEqual({
      repo: company.dir, path: company.folder, owner: 'Nanda', rules: { 'upper-snake': 'linter' }, commit: company.commit,
    })
    // The refresh of the next command finds the folder as the store holds it: no new draft.
    expect(ok(await p.nanda('log')).err).not.toContain('came in')
  })

  test('the start refuses a company folder that changed since its draft', async () => {
    const { p, company } = await withCompany()
    await Bun.write(join(company.dir, company.folder, 'naming/upper-snake.md'), 'The flag is FF_<TEAM>_<FEATURE>.\n')
    git(company.dir, 'commit', '-q', '-am', 'the team')
    const r = await initializeLegacy(p)
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
    const r = await initializeLegacy(p)
    expect(r.err).toContain('refused: tsd-writing is not accepted yet')
    expect(r.err).toContain('next: resolve tsd-writing, then approve the reviewed directions together (work onboard approve-directions)')
    expect(exists(p, 'aristoteles.yaml')).toBe(false)
    expect(exists(p, '.work/assess/tsd-writing.yaml')).toBe(true)
    expect(exists(p, '.work/aristoteles.db')).toBe(false)
  })

  test('the start refuses a rule whose checker is no accepted role, and writes aristoteles.yaml back', async () => {
    const settings = 'theme: dark\nsound: false\n'
    const p = await drafted()
    p.write('aristoteles.yaml', settings)
    await acceptAll(p)
    // The host drops the linter, which checks two rules of tsd-writing (the person cannot: O1).
    p.write('draft2.yaml', ONBOARD_CONFIG.replace(/  linter:\n[\s\S]*$/, '').replaceAll(', linter]', ']'))
    ok(await p.agent('onboard config --file=draft2.yaml'))
    const r = await initializeLegacy(p)
    expect(r.err).toContain('refused: tsd-writing is not accepted yet')
    expect(ok(await p.agent('onboard status')).out).toContain('Reverify checker responsibility for no-code-proof, no-ticket-ids, repeatable.')
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

  // P10 rejected, onboarding 2026-11-14: a direction starts with real examples. Nanda, 2026-11-15:
  // an output that follows and one that breaks for each marked step of the flow.
  test('a rule case must match its excerpt and may have no observed break', async () => {
    const p = await drafted()
    p.write('stale.yaml', ONBOARD_DIRECTION.replace('excerpt: TODO', 'excerpt: DONE'))
    expect((await p.agent('onboard draft tsd-writing --file=stale.yaml')).err).toContain(
      'refused: stale.yaml: example 1: "DONE" is not in docs/tsd.md',
    )
    const sparse = Bun.YAML.parse(ONBOARD_DIRECTION)
    for (const rule of sparse.standards.flatMap((standard) => standard.rules)) {
      if (rule.evidence) rule.evidence.cases = rule.evidence.cases.filter((sample) => sample.fit === 'Follows')
    }
    p.write('few.yaml', Bun.YAML.stringify(sparse))
    ok(await p.agent('onboard draft tsd-writing --file=few.yaml'))
    expect(ok(await p.nanda('onboard show tsd-writing')).out).toContain('no break observed in docs/tsd.md')

  })

  // Nanda, 2026-11-15: a direction has a flow, from the first act down to the output, the steps
  // that it governs marked with their ids; its examples show by marked step, the input of a step
  // that checks, real or written by the host.
  test('a draft with a marked flow: show prints the marks, and the examples by step', async () => {
    const p = onboardingProject(FLOW_FILES)
    p.write('draft.yaml', ONBOARD_CONFIG)
    ok(await p.agent('onboard config --file=draft.yaml'))
    ok(await p.agent('onboard found tsd-writing'))
    p.write('tsd.yaml', ONBOARD_DIRECTION)
    ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
    const show = ok(await p.nanda('onboard show tsd-writing')).out
    expect(show).toContain(
      'summary: A TSD lets its reader decide without a meeting, so each page stands alone.\n' +
        'flow:\n' +
        '  1. Person -> architect: asks for a TSD of the export\n' +
        '  2. architect -> writer: gives each section to a writer (CLAUDE.md:3)\n' +
        '  3. writer: reads the rule of one heading for each section (.claude/skills/writer/SKILL.md:3)\n' +
        '  4. writer -> docs/tsd.md: fills the template one section at a time (docs/template.md:3) ' +
        '[uses tsd-writing, intro-story, repeatable]\n' +
        '  5. linter -> docs/tsd.md: checks that each section says one thing [uses facts-not-proof, no-code-proof]\n' +
        'from: Pathos, Logos\n',
    )
    expect(show).toContain('no-code-proof (linter)')
    expect(show).toContain('input · docs/tsd.md:5 "TODO"')
    expect(show).toContain('output · docs/tsd.md:3 "## Introduction"')
    // The excerpt of an input leaves its file: each example with it is stale, and its line says so.
    p.write('docs/tsd.md', '# TSD\n\n## Introduction\n\nThe export ran twice.\n')
    expect(ok(await p.nanda('onboard show tsd-writing')).out).toContain(
      '      input · docs/tsd.md:5 "TODO" · stale\n',
    )
    expect(ok(await p.agent('onboard status')).out).toContain('found in the project · 4 examples, 2 stale')
    const unmarked = Bun.YAML.parse(ONBOARD_DIRECTION)
    for (const step of unmarked.flow) delete step.uses
    p.write('unmarked.yaml', Bun.YAML.stringify(unmarked))
    expect((await p.agent('onboard draft tsd-writing --file=unmarked.yaml')).err).toContain(
      'no flow step has uses: mark each step that the direction governs',
    )
    p.write('bad.yaml', ONBOARD_DIRECTION.replace('says: asks for a TSD of the export', 'says: " "'))
    expect((await p.agent('onboard draft tsd-writing --file=bad.yaml')).err).toContain(
      'refused: bad.yaml: flow: a step needs from, to and says',
    )
  })

  // Nanda, 2026-11-15: the new shape is the only one. A file of onboarding in an older shape, an
  // accepted one too, is not read: it waits for the host to draft it again, and its draft writes
  // over it.
  test('a direction file in an older shape: Loading, a status line, and the host drafts it again', async () => {
    const p = await drafted()
    const old = 'id: tsd-writing\nasked: { _tag: Found }\ndraft:\n  _tag: Drafted\n  name: TSD writing\n' +
      '  from: []\n  content: { says: Old words., standards: [] }\n  cases: []\nquestions: []\n' +
      'request: { _tag: None }\naccepted: { _tag: Accepted }\n'
    p.write('.work/assess/tsd-writing.yaml', old)
    expect(ok(await p.agent('onboard status')).out).toContain(
      '  tsd-writing · Loading · found in the project\n' +
        '    tsd-writing is not in the current shape: the host drafts it again ' +
        '(the host: work onboard draft tsd-writing --file=<direction.yaml>)',
    )
    expect((await p.nanda('onboard accept tsd-writing')).err).toContain(
      'tsd-writing is not in the current shape: the host drafts it again',
    )
    p.write('tsd.yaml', ONBOARD_DIRECTION)
    ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
    ok(await p.nanda('onboard approve-directions', 'approve'))
  })

  test('work init refuses while onboarding files exist', async () => {
    const p = await drafted()
    p.write('aristoteles.yaml', ONBOARD_CONFIG)
    const r = await p.nanda('init')
    expect(r.err).toContain('refused: onboarding files are in this dir (.work/assess/ or aristoteles.draft.yaml)')
    expect(r.err).toContain('next: accept the journal onboarding proposals before activating')
    expect(exists(p, '.work/aristoteles.db')).toBe(false)
  })

  // Ruling 1, onboarding 2026-11-14: the config draft reads as the store start would read it, so a
  // draft whose models do not read is refused when the host sends it (was: at accept-roles).
  test('bad staffing blocks the start after responsibilities are accepted', async () => {
    const p = onboardingProject()
    p.write('draft.yaml', withModels(ONBOARD_CONFIG, { opus: { launch: 'host-cli' } }))
    const r = await p.agent('onboard config --file=draft.yaml')
    ok(r)
    expect(exists(p, 'aristoteles.draft.yaml')).toBe(true)
    for (const role of ROLES) ok(await p.nanda(`onboard accept-role ${role}`))
    const start = await initializeLegacy(p)
    expect(start.err).toContain('roles.architect.launch needs {session}')
  })

  test('the role of the top task has no toggle (ruling 15)', async () => {
    const p = await drafted()
    for (const persistent of ['false', 'true']) {
      expect((await p.nanda(`onboard persistence architect --persistent=${persistent}`)).err).toContain(
        'refused: edit .work/staffing.yaml to change the staffing of architect',
      )
    }
    expect((await p.nanda('onboard persistence section-lead --persistent=false')).err).toContain('.work/staffing.yaml')
  })
})

test('accepted responsibilities are joined with staffing from the project directory', async () => {
  const p = onboardingProject()
  const draft = Bun.YAML.parse(ONBOARD_CONFIG)
  delete draft.models
  const roles = {}
  for (const [name, role] of Object.entries(draft.roles)) {
    if (role.kind === 'program') continue
    roles[name] = {
      account: 'primary', cli: 'agent', allowedModels: [role.model], model: role.model,
      persistent: role.persistence.persistent, concurrency: 1, subagentAllowance: 0,
      launch: 'agent --session {session}',
    }
    delete role.model
    delete role.persistence
  }
  p.write('draft.yaml', Bun.YAML.stringify(draft))
  ok(await p.agent('onboard config --file=draft.yaml'))
  for (const role of ROLES) ok(await p.nanda(`onboard accept-role ${role}`))
  const missing = await initializeLegacy(p)
  expect(missing.code).toBe(1)
  expect(missing.err).toContain('.work/staffing.yaml')
  expect(exists(p, '.work/aristoteles.db')).toBe(false)

  p.write('.work/staffing.yaml', Bun.YAML.stringify({
    clis: { agent: { backgroundChildren: false, canPark: false } },
    accounts: { primary: { limits: { sessions: '1 session' } } },
    roles,
  }))
  ok(await initializeLegacy(p))
  const file = Bun.YAML.parse(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8'))
  expect(file.models).toBeUndefined()
  expect(file.roles.writer.model).toBeUndefined()
  expect(file.roles.writer.persistence).toBeUndefined()
  const stored = JSON.parse(eventsOf(p)[0].event).create
  expect(stored.config.roles.writer.model).toBe('haiku')
  expect(stored.config.roles.writer.persistence.persistent).toBe(false)
  expect(stored.texts['aristoteles.yaml']).not.toContain('primary')
})

test('embedded staffing is refused in both a responsibility file and a draft', async () => {
  const p = onboardingProject()
  const embedded = Bun.YAML.parse(ONBOARD_CONFIG)
  p.write('embedded.yaml', ONBOARD_CONFIG)
  expect((await p.agent('onboard config --file=embedded.yaml')).err).toContain('move models')
  delete embedded.models
  p.write('embedded.yaml', Bun.YAML.stringify(embedded, null, 2))
  expect((await p.agent('onboard config --file=embedded.yaml')).err).toContain('move roles.architect')
  const { writeFileSync } = await import('node:fs')
  writeFileSync(join(p.dir, 'aristoteles.yaml'), ONBOARD_CONFIG)
  expect((await p.nanda('init')).err).toContain('move models')
  expect(eventsOf(p)).toEqual([])
})

test('a code-wins answer is reverified on its revision and starts with rule-local evidence', async () => {
  const p = onboardingProject()
  p.write('draft.yaml', ONBOARD_CONFIG)
  p.write('docs/actual.md', 'The code permits two topics.\n')
  p.write('docs/stated.md', 'One topic per section.\n')
  ok(await p.agent('onboard config --file=draft.yaml'))
  ok(await p.agent('onboard found one-thing'))
  const draft = Bun.YAML.parse(ONBOARD_NEW)
  const rule = draft.standards[0].rules[0]
  rule.test = 'bun test headings.test.ts'
  const code = { file: 'docs/actual.md', line: 1, excerpt: 'The code permits two topics.' }
  const principle = { file: 'docs/stated.md', line: 1, excerpt: 'One topic per section.' }
  const scope = { searched: ['docs/actual.md'], unknown: ['generated headings'] }
  p.write('discovery.yaml', Bun.YAML.stringify({ scope, sources: [code, principle] }))
  ok(await p.agent('onboard discovery --file=discovery.yaml'))
  draft.discovery = { scope, sources: [code, principle] }
  rule.evidence = {
    scope, check: { _tag: 'Command', result: 'Two topics found' },
    cases: [{ fit: 'Breaks', output: code }], knownBreaks: [],
  }
  draft.questions = [{
    says: 'Should two topics be allowed?',
    options: ['Two topics are allowed.', principle.excerpt],
    target: { _tag: 'Deviation', rule: rule.id,
      code: { words: 'Two topics are allowed.', source: code },
      principle: { words: principle.excerpt, source: principle } },
  }]
  p.write('direction.yaml', Bun.YAML.stringify(draft))
  ok(await p.agent('onboard draft one-thing --file=direction.yaml'))
  const shown = ok(await p.nanda('onboard show one-thing')).out
  const revision = shown.match(/^revision: (.+)$/m)?.[1]
  expect(revision).toBeTruthy()
  expect(shown).toContain('unknown: generated headings')
  ok(await p.nanda(`onboard answer one-thing --revision=${revision} --options=A`))
  rule.says = draft.questions[0].options[0]
  delete draft.questions
  rule.evidence.cases[0].fit = 'Follows'
  rule.evidence.check.result = 'The result passes with two topics.'
  p.write('direction.yaml', Bun.YAML.stringify(draft))
  expect((await p.agent('onboard draft one-thing --file=direction.yaml')).err).toContain('answer revision changed')
  ok(await p.agent(`onboard draft one-thing --file=direction.yaml --revision=${revision}`))
  await acceptAll(p)
  ok(await initializeLegacy(p))
  const saved = JSON.parse(eventsOf(p)[0].event).create.directions[0].direction
  expect(saved.standards[0].rules[0]).toMatchObject({ says: 'Two topics are allowed.', evidence: rule.evidence })
  expect(saved.flow.every((step) => !('examples' in step))).toBe(true)
  expect(ok(await p.nanda('direction show one-thing')).out).toContain('cases of one-topic:')
})

test('adding a company URL publishes a loading card before fetching', async () => {
  const p = onboardingProject()
  ok(await p.nanda('onboard add --url="https://example.invalid/team/policy.git#directions/exports"'))
  const status = ok(await p.agent('onboard status')).out
  expect(status).toContain('exports · Loading · a company direction: directions/exports of https://example.invalid/team/policy.git')
})
