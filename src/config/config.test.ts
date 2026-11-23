// config.ts reads aristoteles.yaml and the task and direction files. A case table pins the words
// of each refusal (and "ok" for a file that reads) in __snapshots__.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNew } from './outcome.ts'
import * as next from './config.ts'
import { checkerProblem } from '../domain/files.ts'
// @ts-expect-error fixture helpers are JavaScript
import { staffedFixture } from '../../test/staffing-fixture.js'

// biome-ignore lint/suspicious/noExplicitAny: a mutable raw config of a test
type Obj = any

// Ruling 7, onboarding 2026-11-14: each agent role says its persistence and its icon; a program
// has an icon only (P1, P12). The snapshots of the hashes and the restored texts follow.
const persistent = { persistent: true, why: 'it leads the project' }
const disposable = { persistent: false, why: 'it does one piece of work once' }
// Owner, 2026-11-15: a role names its model; the models table holds the commands of each model
// (settings) and its limits (mechanism). The acts say what a role may do.
const good = (): Obj => ({
  people: [{ name: 'Nanda' }, { name: 'Dewi' }],
  models: {
    // Ruling 9, onboarding 2026-11-14 (P9): the start words name the agent (was: {token}).
    opus: { launch: 'claude --session {session}', start: 'go {agent}', silentMinutes: 5, limits: { Review: { rules: 4 } } },
    sonnet: {},
    haiku: { limits: { Assignment: { attempts: 3 } } },
  },
  roles: {
    writer: { model: 'haiku', description: 'writes', intro: 'you write', responsibilities: ['one'], acts: [{ do: 'write' }], timeout: 60, persistence: disposable, icon: 'feather' },
    checker: { model: 'sonnet', description: 'checks', intro: 'you check', responsibilities: ['one'], output: 'a note', acts: [{ review: ['writer'] }, { approve: ['writer'] }, { assign: ['writer'] }], persistence: persistent, icon: 'eye' },
    boss: { model: 'opus', description: 'leads', intro: 'you lead', responsibilities: ['one'], acts: [{ approve: ['writer'] }, { change: ['tsd'] }, { assign: ['checker', 'writer'] }, 'split', 'direct', 'fit'], persistence: persistent, icon: 'crown' },
    linter: { kind: 'program', run: './lint', on: 'report', acts: [{ review: ['writer'] }], checks: ['r1'], icon: 'terminal' },
  },
  decide: [{ resultsOf: 'writer', by: { or: ['checker', 'boss'] } }],
  sound: true,
  theme: 'dark',
})
// The models table with its limits only: no command of a model is set.
const limitsOnly = (o: Obj): void => {
  o.models = { opus: { limits: o.models.opus.limits }, sonnet: {}, haiku: { limits: o.models.haiku.limits } }
}

const yaml = (o: Obj) => Bun.YAML.stringify(o, null, 2)
const dirWith = (text: string | null): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
  if (text !== null) {
    const pair = staffedFixture(text)
    writeFileSync(join(dir, 'aristoteles.yaml'), pair?.config ?? text)
    if (pair) {
      mkdirSync(join(dir, '.work'))
      writeFileSync(join(dir, '.work/staffing.yaml'), pair.staffing)
    }
  }
  return dir
}

// Each case: a name, and the text of the file.
const edit = (f: (o: Obj) => void): string => {
  const o = good()
  f(o)
  return yaml(o)
}
const configCases: Array<[string, string | null]> = [
  ['a good file', yaml(good())],
  ['a good file with no settings', edit((o) => { limitsOnly(o); delete o.sound; delete o.theme })],
  ['an empty file', ''],
  ['a file of one scalar', 'hello'],
  ['no file', null],
  ['a file that does not parse', 'a: [1, 2\nb: {'],
  ['the project key', edit((o) => { o.project = 'x' })],
  ['the directions key', edit((o) => { o.directions = [] })],
  ['an unknown key', edit((o) => { o.colour = 'red' })],
  // Ruling 10, onboarding 2026-11-14: every model has its commands; a model with none reads.
  ['models: {model} in launch and resume', edit((o) => { o.models.haiku = { launch: 'c --model {model} --session {session}', resume: 'c --model {model} --resume {session}' } })],
  ['models: a list', edit((o) => { o.models = [] })],
  ['models: a model that is a word', edit((o) => { o.models.sonnet = 'big' })],
  ['models: a key that is not a setting', edit((o) => { o.models.opus.bogus = 1 })],
  ['models: launch is not a text', edit((o) => { o.models.opus.launch = 5 })],
  ['models: start is blank', edit((o) => { o.models.opus.start = '  ' })],
  ['models: errors is not a list of words', edit((o) => { o.models.opus.errors = [1] })],
  ['models: prompts is not a list', edit((o) => { o.models.opus.prompts = 'a' })],
  ['models: silentMinutes is 0', edit((o) => { o.models.opus.silentMinutes = 0 })],
  ['models: silentMinutes is 1.5', edit((o) => { o.models.opus.silentMinutes = 1.5 })],
  ['models: launch has no {session}', edit((o) => { o.models.opus.launch = 'claude' })],
  ['models: resume has no {session}', edit((o) => { o.models.opus.resume = 'claude --resume' })],
  // Ruling 9, onboarding 2026-11-14 (P9): a start names the agent (was: {token}).
  ['models: start has no {agent}', edit((o) => { o.models.opus.start = 'go' })],
  ['models: resume and skills set', edit((o) => { o.models.sonnet = { resume: 'c --resume {session}', skills: 'a', retryInput: 'again', errors: ['x'], prompts: ['y'] } })],
  ['retryMinutes is 0', edit((o) => { o.retryMinutes = 0 })],
  ['hostWaitMinutes is a text', edit((o) => { o.hostWaitMinutes = 'a' })],
  ['both minutes set', edit((o) => { o.retryMinutes = 2; o.hostWaitMinutes = 3 })],
  ['sound is a text', edit((o) => { o.sound = 'yes' })],
  ['theme is blue', edit((o) => { o.theme = 'blue' })],
  ['no people', edit((o) => { delete o.people })],
  ['a person with no name', edit((o) => { o.people = [{ name: 'A' }, { age: 3 }] })],
  ['a person with a name of an id', edit((o) => { o.people = [{ name: 'a1' }] })],
  ['limits: a part that has none', edit((o) => { o.models.haiku.limits.Bogus = {} })],
  ['limits: a key that is not a limit', edit((o) => { o.models.haiku.limits.Assignment.bogus = 1 })],
  ['limits: not a whole number', edit((o) => { o.models.haiku.limits.Assignment.attempts = 0 })],
  ['limits: an empty group', edit((o) => { o.models.sonnet = { limits: { Review: null } } })],
  ['limits: every part', edit((o) => { o.models.sonnet = { limits: { Assignment: { briefChars: 100, attempts: 2 }, Review: { rules: 4 }, Result: { size: 50 } } } })],
  ['a program with no run', edit((o) => { delete o.roles.linter.run })],
  ['a program that is not on report', edit((o) => { o.roles.linter.on = 'accept' })],
  ['a role with a model that the table lacks', edit((o) => { o.roles.writer.model = 'ultra' })],
  ['a role with no model', edit((o) => { delete o.roles.writer.model })],
  ['a program with a model', edit((o) => { o.roles.linter.model = 'haiku' })],
  ['a role with no description', edit((o) => { delete o.roles.writer.description })],
  ['a role with a blank intro', edit((o) => { o.roles.writer.intro = ' ' })],
  ['a role with no responsibilities', edit((o) => { o.roles.writer.responsibilities = [] })],
  ['a role with no acts', edit((o) => { o.roles.writer.acts = [] })],
  ['a role with no persistence', edit((o) => { delete o.roles.writer.persistence })],
  ['a role whose persistence has no why', edit((o) => { o.roles.writer.persistence = { persistent: false } })],
  ['a role whose persistence is a word', edit((o) => { o.roles.writer.persistence = 'yes' })],
  ['a role whose persistence has another key', edit((o) => { o.roles.writer.persistence = { ...disposable, model: 'haiku' } })],
  ['a role with no icon', edit((o) => { delete o.roles.writer.icon })],
  ['a role with an icon outside the set', edit((o) => { o.roles.writer.icon = 'rocket' })],
  ['a program with no icon', edit((o) => { delete o.roles.linter.icon })],
  ['a program with a persistence', edit((o) => { o.roles.linter.persistence = disposable })],
  ['an act with two keys', edit((o) => { o.roles.writer.acts = [{ do: 'a', review: [] }] })],
  ['an act with an unknown key', edit((o) => { o.roles.writer.acts = [{ jump: 'a' }] })],
  ['an act that names no role', edit((o) => { o.roles.checker.acts = [{ review: ['ghost'] }] })],
  ['an act that is a number do', edit((o) => { o.roles.writer.acts = [{ do: 5 }] })],
  ['an act that is an unknown word', edit((o) => { o.roles.writer.acts = ['jump'] })],
  ['an assign that names no role', edit((o) => { o.roles.checker.acts.push({ assign: ['ghost'] }) })],
  ['an assign that names a program', edit((o) => { o.roles.checker.acts.push({ assign: ['linter'] }) })],
  ['a program that splits', edit((o) => { o.roles.linter.acts.push('split') })],
  ['no role splits', edit((o) => { o.roles.boss.acts = o.roles.boss.acts.filter((a: unknown) => a !== 'split') })],
  ['no roles', edit((o) => { delete o.roles; delete o.decide })],
  ['decide: resultsOf is not a role that does work', edit((o) => { o.decide[0].resultsOf = 'boss' })],
  ['decide: a name that is no role', edit((o) => { o.decide[0].by = 'ghost' })],
  ['decide: a shape that is wrong', edit((o) => { o.decide[0].by = { xor: ['checker'] } })],
  ['decide: an empty list', edit((o) => { o.decide[0].by = { or: [] } })],
  ['decide: two keys', edit((o) => { o.decide[0].by = { or: ['checker'], and: ['boss'] } })],
  ['decide: a role with no approve', edit((o) => { o.decide[0].by = { or: ['linter', 'boss'] } })],
  ['decide: a name two times', edit((o) => { o.decide[0].by = { and: ['checker', { or: ['checker', 'boss'] }] } })],
  ['decide: a second entry for one maker', edit((o) => { o.decide.push({ resultsOf: 'writer', by: 'boss' }) })],
  ['decide: nested order', edit((o) => { o.decide[0].by = { order: ['checker', { and: ['boss'] }] } })],
  ['decide: a null entry', edit((o) => { o.decide = [null] })],
]

// What a case table pins: "ok" for a value, or the words of the refusal.
// biome-ignore lint/suspicious/noExplicitAny: an outcome of a test
const shape = (outcome: any): unknown => ('ok' in outcome ? 'ok' : outcome)

describe('readConfig', () => {
  test('a file with the waiver hours is refused, as any part that has no limits', async () => {
    const dir = dirWith(edit((o) => { o.models.opus.limits = { Note: { waiverHours: 24 } } }))
    expect(await runNew(next.readConfig(dir))).toEqual({
      refused:
        'aristoteles.yaml: models.opus.limits.Note is not a part with limits (Assignment, Review, Result)',
    })
  })

  for (const [name, text] of configCases) {
    test(name, async () => {
      const dir = dirWith(text)
      const now = await runNew(next.readConfig(dir))
      expect(JSON.parse(JSON.stringify(shape(now)).replaceAll(dir, '<dir>'))).toMatchSnapshot()
      if ('ok' in now) {
        // The JSON of each role, key by key in order, is what the fit hash is made of.
        const { config } = now.ok as Obj
        for (const role of Object.values(config.roles)) {
          expect(next.roleHash(role as never)).toBe(next.sha(JSON.stringify(role)))
        }
      }
    })
  }
})

describe('fileHashes and the hash of the mechanism', () => {
  const texts: Array<[string, string | null]> = [
    ['no file', null],
    ['a good file', yaml(good())],
    ['a file that does not parse', 'a: [1'],
    ['an empty file', ''],
  ]
  for (const [name, text] of texts) {
    test(name, async () => {
      const dir = dirWith(text)
      expect(await runNew(next.fileHashes(dir))).toMatchSnapshot()
    })
  }
  test('a change of the settings keeps the hash; a change of the mechanism does not', async () => {
    const a = dirWith(yaml(good()))
    const b = dirWith(edit((o) => { o.theme = 'light'; limitsOnly(o) }))
    const c = dirWith(edit((o) => { o.people.push({ name: 'Eka' }) }))
    // The limits of a model are mechanism, though the models table is a setting block.
    const d = dirWith(edit((o) => { o.models.haiku.limits.Assignment.attempts = 4 }))
    const hashOf = async (dir: string) =>
      ((await runNew(next.fileHashes(dir))) as Obj).ok['aristoteles.yaml']
    const [ha, hb, hc, hd] = await Promise.all([a, b, c, d].map(hashOf))
    expect(ha).toBe(hb)
    expect(ha).not.toBe(hc)
    expect(ha).toBe(hd)
  })
})

describe('restoreConfig', () => {
  const cases: Array<[string, string, string | null]> = [
    ['the stored text and a file with other settings', yaml(good()), edit((o) => { o.theme = 'light'; o.sound = false; limitsOnly(o) })],
    ['a stored text with no settings, a file with some', edit((o) => { limitsOnly(o); delete o.sound; delete o.theme }), yaml(good())],
    // The commands of a model are the file's; its limits are the stored ones.
    ['a file with other commands and other limits', yaml(good()), edit((o) => { o.models.opus.launch = 'other --session {session}'; o.models.haiku.limits = { Review: { rules: 9 } } })],
    ['no file now', yaml(good()), null],
    ['a file now that does not parse', yaml(good()), 'a: [1'],
    ['a stored text with comments', `# schema line\n# second\n${yaml(good())}`, edit((o) => { o.theme = 'light' })],
  ]
  for (const [name, stored, now] of cases) {
    test(name, async () => {
      const dir = dirWith(now)
      expect(await runNew(next.restoreConfig(dir, staffedFixture(stored)?.config ?? stored))).toEqual({ ok: undefined })
      expect(await Bun.file(join(dir, 'aristoteles.yaml')).text()).toMatchSnapshot()
    })
  }
})

const people = ['Nanda', 'Dewi']
const roles = async (): Promise<Obj> =>
  ((await runNew(next.readConfig(dirWith(yaml(good()))))) as Obj).ok.config.roles

describe('readDirection', () => {
  // Nanda, 2026-11-15: a direction has a summary.
  // Nanda, 2026-11-15: a direction has a flow, a step of it marked.
  const shown = [
    { fit: 'Follows', output: { written: 'a' } },
    { fit: 'Breaks', output: { written: 'b' } },
  ]
  // pass 3b: the cases live on a rule's evidence; the flow only marks where the rules apply
  const evidence = (cases: unknown = shown) =>
    ({ scope: { searched: ['doc'], unknown: [] }, check: { _tag: 'Absent' }, knownBreaks: [], cases })
  const withCases = { id: 'sc', says: 'cases', rules: [{ id: 'rc', says: 'has cases', evidence: evidence() }] }
  const marked = [{ from: 'writer', to: 'doc', says: 'writes', uses: ['tsd'] }]
  const direction = (o: Obj): Obj =>
    ({ id: 'tsd', name: 'TSD', summary: 'U', flow: marked, says: 'S', owner: 'Nanda', standards: [withCases], ...o })
  const cases: Array<[string, Obj]> = [
    ['a minimal direction', direction({})],
    ['a full direction', direction({ from: ['Logos', 'Mnēmē'], maxStandards: 5, approvedBy: 'checker', standards: [{ id: 's1', says: 'a', where: { section: 'x' }, rules: [{ id: 'r1', says: 'b', checkedBy: 'checker', supersedes: ['r0'] }, { id: 'r2', says: 'c' }] }, withCases] })],
    ['no id', direction({ id: undefined })],
    ['a blank name', direction({ name: ' ' })],
    ['no says', direction({ says: undefined })],
    ['no owner', direction({ owner: undefined })],
    ['an owner who is not a person', direction({ owner: 'Ghost' })],
    ['a standard with no says', direction({ standards: [{ id: 's' }] })],
    ['a null standard', direction({ standards: [null] })],
    ['a rule with no id', direction({ standards: [{ id: 's', says: 'a', rules: [{ says: 'b' }] }] })],
    ['a standard with "when"', direction({ standards: [{ id: 's', says: 'a', when: { a: 1 } }] })],
  ]
  for (const [name, d] of cases) {
    test(name, async () => {
      expect(await runNew(next.readDirection('d.yaml', d, people))).toMatchSnapshot()
    })
  }

  // The principles are the eleven; the same word in another case, or with no marks, is the
  // principle, and another word is refused with the list.
  test('the principles that a direction comes from are the closed list', async () => {
    const given = direction({ from: ['logos', 'Mneme'] })
    expect(await runNew(next.readDirection('d.yaml', given, people))).toMatchObject({
      ok: { from: ['Logos', 'Mnēmē'] },
    })
    const wrong = direction({ from: ['Logoss'] })
    expect(await runNew(next.readDirection('d.yaml', wrong, people))).toEqual({
      refused:
        'd.yaml: from names "Logoss", which is not a principle; the principles are ' +
        'Logos, Pathos, Ethos, Mythos, Oikos, Nomos, Telos, Kairos, Mnēmē, Topoi, Aporia',
    })
  })

  // Nanda, 2026-11-15: a direction has a summary; a draft with none is refused with what to write.
  test.each([['no', undefined], ['a blank', '  ']])('%s summary is refused', async (_name, summary) => {
    expect(await runNew(next.readDirection('d.yaml', direction({ summary }), people))).toEqual({
      refused:
        'd.yaml: summary is required: one or two plain sentences that say what the direction ' +
        'asks and why it matters, for a person who reads it the first time',
    })
  })

  // Nanda, 2026-11-15: a direction has a flow: the steps from the first act down to the output,
  // each with where the project defines it when it does; a step from an actor to itself is an act
  // on its own. A file with no flow is refused; the Schema of the flow gives the other refusals.
  test('the flow of a direction reads; a step with no words or a line with no file is refused', async () => {
    const flow = [
      { from: 'Person', to: 'architect', says: 'asks for a TSD' },
      {
        from: 'writer',
        to: 'writer',
        says: 'fills the template',
        place: { file: 'docs/t.md', line: 3 },
        uses: ['tsd'],
      },
    ]
    expect(await runNew(next.readDirection('d.yaml', direction({ flow }), people))).toMatchObject({
      ok: { flow },
    })
    expect(await runNew(next.readDirection('d.yaml', direction({ flow: undefined }), people))).toEqual({
      refused:
        'd.yaml: flow is required: the steps from the first act down to the output, each step ' +
        'that the direction governs with uses (the cases go on its rules)',
    })
    const refusedFlow = async (steps: unknown) => {
      const read = (await runNew(next.readDirection('d.yaml', direction({ flow: steps }), people))) as Obj
      return String(read.refused)
    }
    expect(await refusedFlow([{ from: 'Person', to: 'architect' }, ...marked])).toContain('d.yaml: flow: ')
    const lineOnly = [{ from: 'a', to: 'b', says: 'c', place: { line: 4 } }, ...marked]
    expect(await refusedFlow(lineOnly)).toContain('["place"]["file"]')
  })

  // Nanda, 2026-11-15: a step that the direction governs names the ids that apply there: the
  // direction, a standard, a rule of it; a flow marks at least one step, and the rules each marked
  // step uses hold a case that follows and one that breaks (pass 3b: cases live on rules).
  test('the uses of a flow step name ids of the direction, and a flow marks a step', async () => {
    const standardsWith = (cases: unknown) =>
      [{ id: 's1', says: 'a', rules: [{ id: 'r2', says: 'b', evidence: evidence(cases) }] }]
    const standards = standardsWith(shown)
    const step = (uses?: unknown) => ({
      from: 'writer',
      to: 'doc',
      says: 'writes',
      ...(uses === undefined ? {} : { uses }),
    })
    const read = (flow: unknown, given: unknown = standards) =>
      runNew(next.readDirection('d.yaml', direction({ flow, standards: given }), people))
    const refused = async (flow: unknown) => String(((await read(flow)) as Obj).refused)
    expect(await read([step(['tsd', 's1', 'r2'])])).toMatchObject({ ok: { flow: [step(['tsd', 's1', 'r2'])] } })
    expect(await read([step(['tsd', 'r9'])])).toEqual({
      refused: 'd.yaml: flow step 1 uses "r9", which is not tsd or a standard or rule of it',
    })
    expect(await refused([])).toContain('no flow step has uses: mark each step that the direction governs')
    expect(await refused([step(), step()])).toContain('no flow step has uses')
    for (const uses of [[], 'tsd', [' ']]) {
      expect(await refused([step(uses)])).toContain('d.yaml: flow: ')
    }
    for (const legacy of [
      [{ ...step(['tsd']), examples: shown }],
      [{ ...step(), examples: [] }, step(['tsd'])],
    ]) {
      const result = (await runNew(next.readFlow('legacy.yaml', legacy))) as Obj
      expect(result.refused).toContain('put cases in rule evidence')
      expect(result.refused).toContain('examples key on a flow step is obsolete')
    }
    // readDirection reads a marked step whose rules hold no break (onboarding's no break observed,
    // U5a); the live draft refuses it (core/actions/directions.ts DraftDirection, casesProblem).
    expect(await read([step(['tsd'])], standardsWith(shown.slice(0, 1)))).toMatchObject({ ok: {} })
  })

  // A where is a filter over the closed context keys.
  test.each([
    ['an unknown key', { stage: 'y' }, 'd.yaml: standard s: where key "stage" is not one of system, field, language, repo, section, audience'],
    ['no key', {}, 'd.yaml: standard s: where names no key; leave it out, and the standard applies everywhere'],
    ['a value that is no text', { section: 3 }, 'd.yaml: standard s: where section is a text, like section: introduction'],
    ['a list', ['section'], 'd.yaml: standard s: where is a map of context keys, like where: { section: introduction }'],
  ])('a where with %s is refused', async (_name, where, message) => {
    const d = direction({ standards: [{ id: 's', says: 'a', where }] })
    expect(await runNew(next.readDirection('d.yaml', d, people))).toEqual({ refused: message })
  })
})

describe('checkerProblem', () => {
  const cases: Array<[string, string | undefined, string]> = [
    ['no checker', undefined, 'r1'],
    ['Human', 'Human', 'r1'],
    ['a role that does not exist', 'ghost', 'r1'],
    ['a role that reviews a maker', 'checker', 'r1'],
    ['a role that approves a maker', 'boss', 'r1'],
    ['a role that reviews no maker', 'writer', 'r1'],
    ['a program that lists the rule', 'linter', 'r1'],
    ['a program that does not list the rule', 'linter', 'r2'],
  ]
  for (const [name, checkedBy, id] of cases) {
    test(name, async () => {
      expect(checkerProblem(await roles(), id, checkedBy)).toMatchSnapshot()
    })
  }
})

describe('the small exports', () => {
  test('the hash of a text is its sha-256', () => {
    expect(next.sha('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  test('the name of the project is the name of the folder', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'my-project')
    mkdirSync(dir)
    const pair = staffedFixture(yaml(good()))
    writeFileSync(join(dir, 'aristoteles.yaml'), pair.config)
    mkdirSync(join(dir, '.work'))
    writeFileSync(join(dir, '.work/staffing.yaml'), pair.staffing)
    const now = (await runNew(next.readConfig(dir))) as Obj
    expect(now.ok.config.project).toBe('my-project')
  })
})
