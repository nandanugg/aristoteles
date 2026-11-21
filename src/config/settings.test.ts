// readSettings and writeSettings of settings.ts.
import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNew } from './outcome.ts'
import * as next from './settings.ts'

// biome-ignore lint/suspicious/noExplicitAny: a raw settings object of a test
type Obj = any

const dirWith = (text: string | null): string => {
  const dir = mkdtempSync(join(tmpdir(), 'set-'))
  if (text !== null) {
    let raw: Obj
    try { raw = Bun.YAML.parse(text) } catch { raw = null }
    if (raw?.models !== undefined && !Array.isArray(raw.models)) {
      const { models, ...config } = raw
      mkdirSync(join(dir, '.work'))
      writeFileSync(join(dir, '.work/staffing.yaml'), Bun.YAML.stringify({
        models, roles: {}, clis: {}, accounts: {},
      }, null, 2))
      writeFileSync(join(dir, 'aristoteles.yaml'), Bun.YAML.stringify(config, null, 2))
    } else writeFileSync(join(dir, 'aristoteles.yaml'), text)
  }
  return dir
}

// Ruling 9, onboarding 2026-11-14 (P9): the start words name {agent}, not {token}. Owner,
// 2026-11-15: the models table holds the commands of each model by its name.
const MODEL = 'models:\n  opus:\n    launch: claude --session {session}\n    start: go {agent}\n'
const readCases: Array<[string, string | null, string?]> = [
  ['no file', null],
  ['an empty file', ''],
  ['defaults only', 'people: []\n'],
  ['a model with commands', MODEL],
  ['theme dark and sound', 'theme: dark\nsound: true\nretryMinutes: 2\nhostWaitMinutes: 20\n'],
  ['a file that does not parse', 'models: [1\n', 'YAML Parse error: Unexpected token'],
  // Ruling 10, onboarding 2026-11-14: every model has its commands; a model with none reads.
  ['a model with no commands', 'models:\n  haiku: {}\n'],
  ['three models', 'models:\n  opus: {}\n  sonnet: {}\n  haiku: {}\n'],
  ['a launch that names {model}', 'models:\n  haiku:\n    launch: c --model {model} --session {session}\n'],
  ['limits beside the commands', 'models:\n  haiku:\n    launch: c {session}\n    limits: { Assignment: { attempts: 3 } }\n'],
  ['a models table that is a list', 'models: [a]\n', 'aristoteles.yaml: move models to .work/staffing.yaml'],
  ['a model that is a word', 'models:\n  opus: big\n', 'aristoteles.yaml: models.opus is a map of settings'],
  // Bun 1.4.3 and later: the YAML parser refuses an unquoted { } in a flow map (Bun 1.3 made a
  // key of it).
  ['a { } that is not in quotes', 'models:\n  haiku: { launch: x {session} }\n', 'YAML Parse error: Unexpected token'],
  ['a key that is not a model setting', 'models:\n  opus:\n    bogus: 1\n', 'aristoteles.yaml: models.opus.bogus is not a setting of a model (launch, resume, start, skills, errors, prompts, silentMinutes, retryInput, limits)'],
  ['a launch that is a number', 'models:\n  opus:\n    launch: 5\n', 'aristoteles.yaml: models.opus.launch is a text'],
  ['a blank retryInput', 'models:\n  sonnet:\n    retryInput: "  "\n', 'aristoteles.yaml: models.sonnet.retryInput is a text'],
  ['errors that are numbers', 'models:\n  opus:\n    errors: [1, 2]\n', 'aristoteles.yaml: models.opus.errors is a list of words'],
  ['prompts that are a text', 'models:\n  opus:\n    prompts: hi\n', 'aristoteles.yaml: models.opus.prompts is a list of words'],
  ['silentMinutes 0', 'models:\n  opus:\n    silentMinutes: 0\n', 'aristoteles.yaml: models.opus.silentMinutes is a whole number of 1 or more'],
  ['a launch with no {session}', 'models:\n  opus:\n    launch: claude\n', 'aristoteles.yaml: models.opus.launch has no {session}: the UI gives each real agent its session id, so that a resume finds it'],
  ['a resume with no {session}', 'models:\n  opus:\n    resume: claude\n', 'aristoteles.yaml: models.opus.resume has no {session}'],
  // Ruling 9, onboarding 2026-11-14 (P9): the start words name {agent} (was {token}).
  ['a start with no {agent}', 'models:\n  opus:\n    start: go\n', 'aristoteles.yaml: models.opus.start has no {agent}'],
  ['retryMinutes 0', 'retryMinutes: 0\n', 'aristoteles.yaml: retryMinutes is a whole number of 1 or more'],
  ['hostWaitMinutes 2.5', 'hostWaitMinutes: 2.5\n', 'aristoteles.yaml: hostWaitMinutes is a whole number of 1 or more'],
  ['sound that is a text', 'sound: "yes"\n', 'aristoteles.yaml: sound is true or false'],
  ['theme blue', 'theme: blue\n', 'aristoteles.yaml: theme is light or dark'],
]

describe('readSettings', () => {
  for (const [name, text, refusal] of readCases) {
    test(name, async () => {
      const now = await runNew(next.readSettings(dirWith(text)))
      if (refusal === undefined) expect(now).toHaveProperty('ok')
      else expect(now).toEqual({ refused: refusal })
    })
  }

  test('an outside source holds 72 hours, or the hours of the file', async () => {
    const hours = async (text: string | null) => runNew(next.readSettings(dirWith(text)))
    expect(await hours(null)).toMatchObject({ ok: { outsideSourceHours: 72 } })
    const set = await hours('outsideSourceHours: 24\n')
    expect(set).toMatchObject({ ok: { outsideSourceHours: 24 } })
    expect(await hours('outsideSourceHours: 0\n')).toEqual({
      refused: 'aristoteles.yaml: outsideSourceHours is a whole number of 1 or more',
    })
  })
})

// Each case: the file before, and the settings to write.
const SCHEMA_LINE = '# yaml-language-server: $schema=schema/aristoteles.schema.json\n'
const BASE = `${SCHEMA_LINE}people:\n  - name: Nanda\nroles: {}\n`
// A file with a models table: the page writes the commands of the models that it has.
const MODELS = `${BASE}models:\n  opus:\n    launch: a {session}\n    limits: { Assignment: { attempts: 3 } }\n  haiku: {}\n`
// Ruling 9, onboarding 2026-11-14 (P9): each start below names {agent} (was {token}).
const writeCases: Array<[string, string | null, Obj]> = [
  ['a theme into a file with a schema line', BASE, { theme: 'dark' }],
  ['every setting into a plain file', 'people:\n  - name: Nanda\n', { models: {}, retryMinutes: 3, hostWaitMinutes: 4, sound: true, theme: 'dark' }],
  ['a replaced block', `${BASE}theme: light\nsound: false\n`, { theme: 'dark', sound: true }],
  ['a replaced block of several lines with blanks', `${BASE}models:\n  opus:\n    launch: a {session}\n\n    start: b {agent}\n\n\nsound: true\n`, { models: { opus: { start: 'x {agent}', errors: ['boom'] } } }],
  ['a block that is removed', `${BASE}theme: dark\nsound: true\n`, { theme: undefined }],
  ['a key that is not there and removed', BASE, { sound: undefined }],
  ['no file', null, { theme: 'dark' }],
  ['no key of the settings in the object', `${BASE}theme: dark\n`, { other: 1 }],
  ['a file with no final newline', 'people:\n  - name: Nanda', { sound: true }],
  ['an empty settings object', BASE, {}],
  ['a block with a comment line inside', `${BASE}models:\n  # about opus\n  opus:\n    start: go {agent}\n`, { models: {} }],
  ['a text with a colon and a quote', MODELS, { models: { opus: { start: 'say "hi": {agent}', prompts: ["it's", 'a: b'] } } }],
]
const refusedWrites: Array<[string, string | null, Obj]> = [
  ['a theme that is blue', BASE, { theme: 'blue' }],
  ['a launch with no {session}', MODELS, { models: { opus: { launch: 'c' } } }],
  ['sound that is a text', BASE, { sound: 'yes' }],
  ['retryMinutes that is 0', BASE, { retryMinutes: 0 }],
]

describe('writeSettings', () => {
  for (const [name, before, settings] of [...writeCases, ...refusedWrites]) {
    test(name, async () => {
      const dir = dirWith(before)
      const now = await runNew(next.writeSettings(dir, settings))
      expect(now).toHaveProperty(refusedWrites.some(([n]) => n === name) ? 'refused' : 'ok')
    })
  }
  test('the settings that were written read back the same', async () => {
    const dir = dirWith(MODELS)
    // Ruling 9, onboarding 2026-11-14 (P9): the start words name {agent} (was {token}).
    const settings = { models: { opus: { start: 'go {agent}' }, haiku: {} }, sound: true, theme: 'dark' }
    await runNew(next.writeSettings(dir, settings))
    expect(await runNew(next.readSettings(dir))).toMatchObject({ ok: settings })
  })
  // The page sends the commands of the models of the file: the limits of each model stay, and a
  // model that the file lacks is not written.
  test('a write of the models keeps their limits and adds no model', async () => {
    const dir = dirWith(MODELS)
    const settings = { models: { opus: { launch: 'b {session}' }, ghost: { launch: 'g {session}' } } }
    expect(await runNew(next.writeSettings(dir, settings))).toEqual({ ok: undefined })
    const text = await Bun.file(join(dir, '.work/staffing.yaml')).text()
    expect((Bun.YAML.parse(text) as { models: unknown }).models).toEqual({
      opus: { launch: 'b {session}', limits: { Assignment: { attempts: 3 } } },
      haiku: {},
    })
  })
})
