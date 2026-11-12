// config.ts reads aristoteles.yaml and the task and direction files. A case table pins the words
// of each refusal (and "ok" for a file that reads) in __snapshots__.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNew } from './outcome.ts'
import * as next from './config.ts'
import { checkerProblem } from '../domain/files.ts'

// biome-ignore lint/suspicious/noExplicitAny: a mutable raw config of a test
type Obj = any

const good = (): Obj => ({
  people: [{ name: 'Nanda' }, { name: 'Dewi' }],
  limits: { low: { Assignment: { attempts: 3 } }, high: { Review: { rules: 4 } } },
  roles: {
    writer: { tier: 'low', description: 'writes', intro: 'you write', responsibilities: ['one'], acts: [{ do: 'write' }], timeout: 60 },
    checker: { tier: 'medium', description: 'checks', intro: 'you check', responsibilities: ['one'], output: 'a note', acts: [{ review: ['writer'] }, { approve: ['writer'] }] },
    boss: { tier: 'high', description: 'leads', intro: 'you lead', responsibilities: ['one'], acts: [{ approve: ['writer'] }, { change: ['tsd'] }] },
    linter: { kind: 'program', run: './lint', on: 'report', acts: [{ review: ['writer'] }], checks: ['r1'] },
  },
  decide: [{ resultsOf: 'writer', by: { or: ['checker', 'boss'] } }],
  tiers: { sol: { launch: 'claude --session {session}', start: 'go {token}', silentMinutes: 5 } },
  sound: true,
  theme: 'dark',
})

const yaml = (o: Obj) => Bun.YAML.stringify(o, null, 2)
const dirWith = (text: string | null): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
  if (text !== null) writeFileSync(join(dir, 'aristoteles.yaml'), text)
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
  ['a good file with no settings', edit((o) => { delete o.tiers; delete o.sound; delete o.theme })],
  ['an empty file', ''],
  ['a file of one scalar', 'hello'],
  ['no file', null],
  ['a file that does not parse', 'a: [1, 2\nb: {'],
  ['the project key', edit((o) => { o.project = 'x' })],
  ['the directions key', edit((o) => { o.directions = [] })],
  ['an unknown key', edit((o) => { o.colour = 'red' })],
  ['tiers: luna', edit((o) => { o.tiers.luna = {} })],
  ['tiers: a key that is not a setting', edit((o) => { o.tiers.sol.bogus = 1 })],
  ['tiers: launch is not a text', edit((o) => { o.tiers.sol.launch = 5 })],
  ['tiers: start is blank', edit((o) => { o.tiers.sol.start = '  ' })],
  ['tiers: errors is not a list of words', edit((o) => { o.tiers.sol.errors = [1] })],
  ['tiers: prompts is not a list', edit((o) => { o.tiers.sol.prompts = 'a' })],
  ['tiers: silentMinutes is 0', edit((o) => { o.tiers.sol.silentMinutes = 0 })],
  ['tiers: silentMinutes is 1.5', edit((o) => { o.tiers.sol.silentMinutes = 1.5 })],
  ['tiers: launch has no {session}', edit((o) => { o.tiers.sol.launch = 'claude' })],
  ['tiers: resume has no {session}', edit((o) => { o.tiers.sol.resume = 'claude --resume' })],
  ['tiers: start has no {token}', edit((o) => { o.tiers.sol.start = 'go' })],
  ['tiers: resume and skills set', edit((o) => { o.tiers.terra = { resume: 'c --resume {session}', skills: 'a', retryInput: 'again', errors: ['x'], prompts: ['y'] } })],
  ['retryMinutes is 0', edit((o) => { o.retryMinutes = 0 })],
  ['hostWaitMinutes is a text', edit((o) => { o.hostWaitMinutes = 'a' })],
  ['both minutes set', edit((o) => { o.retryMinutes = 2; o.hostWaitMinutes = 3 })],
  ['sound is a text', edit((o) => { o.sound = 'yes' })],
  ['theme is blue', edit((o) => { o.theme = 'blue' })],
  ['no people', edit((o) => { delete o.people })],
  ['a person with no name', edit((o) => { o.people = [{ name: 'A' }, { age: 3 }] })],
  ['a person with a name of an id', edit((o) => { o.people = [{ name: 'a1' }] })],
  ['limits: a part that has none', edit((o) => { o.limits.low.Bogus = {} })],
  ['limits: a key that is not a limit', edit((o) => { o.limits.low.Assignment.bogus = 1 })],
  ['limits: not a whole number', edit((o) => { o.limits.low.Assignment.attempts = 0 })],
  ['limits: an empty group', edit((o) => { o.limits.medium = { Review: null } })],
  ['limits: every part', edit((o) => { o.limits.medium = { Assignment: { briefChars: 100, attempts: 2 }, Review: { rules: 4 }, Result: { size: 50 } } })],
  ['a program with no run', edit((o) => { delete o.roles.linter.run })],
  ['a program that is not on report', edit((o) => { o.roles.linter.on = 'accept' })],
  ['a role with a bad tier', edit((o) => { o.roles.writer.tier = 'ultra' })],
  ['a role with no tier', edit((o) => { delete o.roles.writer.tier })],
  ['a role with no description', edit((o) => { delete o.roles.writer.description })],
  ['a role with a blank intro', edit((o) => { o.roles.writer.intro = ' ' })],
  ['a role with no responsibilities', edit((o) => { o.roles.writer.responsibilities = [] })],
  ['a role with no acts', edit((o) => { o.roles.writer.acts = [] })],
  ['an act with two keys', edit((o) => { o.roles.writer.acts = [{ do: 'a', review: [] }] })],
  ['an act with an unknown key', edit((o) => { o.roles.writer.acts = [{ jump: 'a' }] })],
  ['an act that names no role', edit((o) => { o.roles.checker.acts = [{ review: ['ghost'] }] })],
  ['an act that is a number do', edit((o) => { o.roles.writer.acts = [{ do: 5 }] })],
  ['no high role', edit((o) => { o.roles.boss.tier = 'medium' })],
  ['no medium role', edit((o) => { o.roles.checker.tier = 'low' })],
  ['no low role', edit((o) => { o.roles.writer.tier = 'medium' })],
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
    const dir = dirWith(edit((o) => { o.limits.high = { Note: { waiverHours: 24 } } }))
    expect(await runNew(next.readConfig(dir))).toEqual({
      refused:
        'aristoteles.yaml: limits.high.Note is not a part with limits (Assignment, Review, Result)',
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
    const b = dirWith(edit((o) => { o.theme = 'light'; o.tiers = {} }))
    const c = dirWith(edit((o) => { o.people.push({ name: 'Eka' }) }))
    const hashOf = async (dir: string) =>
      ((await runNew(next.fileHashes(dir))) as Obj).ok['aristoteles.yaml']
    const [ha, hb, hc] = await Promise.all([a, b, c].map(hashOf))
    expect(ha).toBe(hb)
    expect(ha).not.toBe(hc)
  })
})

describe('restoreConfig', () => {
  const cases: Array<[string, string, string | null]> = [
    ['the stored text and a file with other settings', yaml(good()), edit((o) => { o.theme = 'light'; o.sound = false; delete o.tiers })],
    ['a stored text with no settings, a file with some', edit((o) => { delete o.tiers; delete o.sound; delete o.theme }), yaml(good())],
    ['no file now', yaml(good()), null],
    ['a file now that does not parse', yaml(good()), 'a: [1'],
    ['a stored text with comments', `# schema line\n# second\n${yaml(good())}`, edit((o) => { o.theme = 'light' })],
  ]
  for (const [name, stored, now] of cases) {
    test(name, async () => {
      const dir = dirWith(now)
      expect(await runNew(next.restoreConfig(dir, stored))).toEqual({ ok: undefined })
      expect(await Bun.file(join(dir, 'aristoteles.yaml')).text()).toMatchSnapshot()
    })
  }
})

describe('readTask', () => {
  const directions = [
    { id: 'tsd', standards: [{ id: 's1', where: { section: 'x', system: 'y' } }, { id: 's2' }] },
    { id: 'plain', standards: [] },
  ]
  const task = (o: Obj) => yaml({ name: 'N', text: 'T', ...o })
  const cases: Array<[string, string]> = [
    ['a minimal task', task({})],
    ['an empty file', ''],
    ['a task that does not parse', 'name: [1'],
    ['no name', yaml({ text: 'T' })],
    ['a blank text', task({ text: '  ' })],
    ['a direction that has no version', task({ directions: ['ghost'] })],
    ['a full task', task({ directions: ['tsd'], context: { section: 'a', system: 'b' }, needs: ['t1', 't2'], from: 'r3', references: ['a.md#b', 5], workspace: [{ source: 's', path: 'docs/a.md', base: 'main', verify: 'true' }] })],
    ['the section key is free', task({ context: { section: 'a' } })],
    ['a context key that no where uses', task({ directions: ['plain'], context: { system: 'a' } })],
    ['a context key of a direction that the task does not name', task({ directions: ['plain'], context: { system: 'b' } })],
    ['a workspace entry with no path', task({ workspace: [{ source: 's' }] })],
    ['a workspace path that is absolute', task({ workspace: [{ source: 's', path: '/etc' }] })],
    ['a workspace path with ..', task({ workspace: [{ source: 's', path: 'a/../b' }] })],
    ['a workspace path that is not plain', task({ workspace: [{ source: 's', path: 'a//b/' }] })],
    ['a workspace path ./a', task({ workspace: [{ source: 's', path: './a' }] })],
    ['maxRounds', task({ maxRounds: 3 })],
    ['a need that is no task id', task({ needs: ['x1'] })],
    ['a numeric need', task({ needs: [4] })],
    ['a from that is no result id', task({ from: 't1' })],
    ['a from of a number', task({ from: 5 })],
    ['a task that names only some keys', task({ needs: [] })],
  ]
  for (const [name, text] of cases) {
    test(name, async () => {
      const now = await runNew(next.readTask('task.yaml', text, directions))
      expect(now).toMatchSnapshot()
    })
  }

  // The context is closed (model.ts Context).
  test('a context key that the closed Context does not know is refused, with the known keys', async () => {
    const staged = [{ id: 'tsd', standards: [{ id: 's1', where: { stage: 'y' } }] }]
    const text = task({ directions: ['tsd'], context: { stage: 'y' } })
    expect(await runNew(next.readTask('task.yaml', text, staged))).toEqual({
      refused:
        'task.yaml: context key "stage" is not one of system, field, language, repo, section, audience',
    })
    const number = task({ context: { section: 3 } })
    expect(await runNew(next.readTask('task.yaml', number, staged))).toEqual({
      refused: 'task.yaml: context section is a text, like section: introduction',
    })
  })
})

describe('checkWorkspace', () => {
  const cases: Array<[string, Obj[]]> = [
    ['none', []],
    ['a good list', [{ source: 'a', path: 'a/b.md' }, { source: 'b', path: '.' }]],
    ['a null entry', [null]],
    ['a path of a number', [{ source: 'a', path: 4 }]],
    ['an absolute path', [{ source: 'a', path: '/x' }]],
    ['a path with ..', [{ source: 'a', path: '../x' }]],
    ['a trailing slash', [{ source: 'a', path: 'x/' }]],
    ['a dot path with a slash', [{ source: 'a', path: './' }]],
  ]
  for (const [name, list] of cases) {
    test(name, async () => {
      expect(await runNew(next.checkWorkspace('w', list))).toMatchSnapshot()
    })
  }
})

const people = ['Nanda', 'Dewi']
const roles = async (): Promise<Obj> =>
  ((await runNew(next.readConfig(dirWith(yaml(good()))))) as Obj).ok.config.roles

describe('readDirection', () => {
  const direction = (o: Obj): Obj => ({ id: 'tsd', name: 'TSD', says: 'S', owner: 'Nanda', ...o })
  const cases: Array<[string, Obj]> = [
    ['a minimal direction', direction({})],
    ['a full direction', direction({ from: ['Logos', 'Mnēmē'], maxStandards: 5, approvedBy: 'checker', standards: [{ id: 's1', says: 'a', where: { section: 'x' }, rules: [{ id: 'r1', says: 'b', checkedBy: 'checker', supersedes: ['r0'] }, { id: 'r2', says: 'c' }] }] })],
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

describe('readApprovedBy', () => {
  const cases: Array<[string, Obj]> = [
    ['no approvedBy', { owner: 'Nanda' }],
    ['a role', { owner: 'Nanda', approvedBy: 'checker' }],
    ['the owner', { owner: 'Nanda', approvedBy: 'Nanda' }],
    ['a role then the owner', { owner: 'Nanda', approvedBy: { order: ['checker', 'Nanda'] } }],
    ['the owner before a role', { owner: 'Nanda', approvedBy: { order: ['Nanda', 'checker'] } }],
    ['the owner in an and', { owner: 'Nanda', approvedBy: { and: ['Nanda', 'boss'] } }],
    ['a person who is not the owner', { owner: 'Nanda', approvedBy: 'Dewi' }],
    ['two persons', { owner: 'Nanda', approvedBy: { and: ['Nanda', 'Dewi'] } }],
    ['a low role', { owner: 'Nanda', approvedBy: 'writer' }],
    ['a program', { owner: 'Nanda', approvedBy: 'linter' }],
    ['a name that is nobody', { owner: 'Nanda', approvedBy: 'ghost' }],
    ['a bad shape', { owner: 'Nanda', approvedBy: { nor: ['boss'] } }],
    ['a name two times', { owner: 'Nanda', approvedBy: { or: ['boss', 'boss'] } }],
    ['a number', { owner: 'Nanda', approvedBy: 7 }],
  ]
  for (const [name, d] of cases) {
    test(name, async () => {
      const r = await roles()
      expect(await runNew(next.readApprovedBy('d.yaml', d, r, people))).toMatchSnapshot()
    })
  }
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
    writeFileSync(join(dir, 'aristoteles.yaml'), yaml(good()))
    const now = (await runNew(next.readConfig(dir))) as Obj
    expect(now.ok.config.project).toBe('my-project')
  })
})
