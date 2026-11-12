// readSettings and writeSettings of settings.ts.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runNew } from './outcome.ts'
import * as next from './settings.ts'

// biome-ignore lint/suspicious/noExplicitAny: a raw settings object of a test
type Obj = any

const dirWith = (text: string | null): string => {
  const dir = mkdtempSync(join(tmpdir(), 'set-'))
  if (text !== null) writeFileSync(join(dir, 'aristoteles.yaml'), text)
  return dir
}

const TIER = 'tiers:\n  sol:\n    launch: claude --session {session}\n    start: go {token}\n'
const readCases: Array<[string, string | null, string?]> = [
  ['no file', null],
  ['an empty file', ''],
  ['defaults only', 'people: []\n'],
  ['a sol tier', TIER],
  ['theme dark and sound', 'theme: dark\nsound: true\nretryMinutes: 2\nhostWaitMinutes: 20\n'],
  ['a file that does not parse', 'tiers: [1\n', 'YAML Parse error: Unexpected token'],
  ['a luna tier', 'tiers:\n  luna: {}\n', 'aristoteles.yaml: tiers.luna: only sol and terra run in terminals (a luna is a subagent)'],
  ['a key that is not a tier setting', 'tiers:\n  sol:\n    bogus: 1\n', 'aristoteles.yaml: tiers.sol.bogus is not a setting of a tier (launch, resume, start, skills, errors, prompts, silentMinutes, retryInput)'],
  ['a launch that is a number', 'tiers:\n  sol:\n    launch: 5\n', 'aristoteles.yaml: tiers.sol.launch is a text'],
  ['a blank retryInput', 'tiers:\n  terra:\n    retryInput: "  "\n', 'aristoteles.yaml: tiers.terra.retryInput is a text'],
  ['errors that are numbers', 'tiers:\n  sol:\n    errors: [1, 2]\n', 'aristoteles.yaml: tiers.sol.errors is a list of words'],
  ['prompts that are a text', 'tiers:\n  sol:\n    prompts: hi\n', 'aristoteles.yaml: tiers.sol.prompts is a list of words'],
  ['silentMinutes 0', 'tiers:\n  sol:\n    silentMinutes: 0\n', 'aristoteles.yaml: tiers.sol.silentMinutes is a whole number of 1 or more'],
  ['a launch with no {session}', 'tiers:\n  sol:\n    launch: claude\n', 'aristoteles.yaml: tiers.sol.launch has no {session}: the UI gives each real agent its session id, so that a resume finds it'],
  ['a resume with no {session}', 'tiers:\n  sol:\n    resume: claude\n', 'aristoteles.yaml: tiers.sol.resume has no {session}'],
  ['a start with no {token}', 'tiers:\n  sol:\n    start: go\n', 'aristoteles.yaml: tiers.sol.start has no {token}'],
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
const writeCases: Array<[string, string | null, Obj]> = [
  ['a theme into a file with a schema line', BASE, { theme: 'dark' }],
  ['every setting into a plain file', 'people:\n  - name: Nanda\n', { tiers: { sol: { launch: 'c {session}', start: 'go {token}' } }, retryMinutes: 3, hostWaitMinutes: 4, sound: true, theme: 'dark' }],
  ['a replaced block', `${BASE}theme: light\nsound: false\n`, { theme: 'dark', sound: true }],
  ['a replaced block of several lines with blanks', `${BASE}tiers:\n  sol:\n    launch: a {session}\n\n    start: b {token}\n\n\nsound: true\n`, { tiers: { terra: { start: 'x {token}', errors: ['boom'] } } }],
  ['a block that is removed', `${BASE}theme: dark\nsound: true\n`, { theme: undefined }],
  ['a key that is not there and removed', BASE, { sound: undefined }],
  ['no file', null, { theme: 'dark' }],
  ['no key of the settings in the object', `${BASE}theme: dark\n`, { other: 1 }],
  ['a file with no final newline', 'people:\n  - name: Nanda', { sound: true }],
  ['an empty settings object', BASE, {}],
  ['a block with a comment line inside', `${BASE}tiers:\n  # about sol\n  sol:\n    start: go {token}\n`, { tiers: {} }],
  ['a text with a colon and a quote', BASE, { tiers: { sol: { start: 'say "hi": {token}', prompts: ["it's", 'a: b'] } } }],
]
const refusedWrites: Array<[string, string | null, Obj]> = [
  ['a theme that is blue', BASE, { theme: 'blue' }],
  ['a luna tier', BASE, { tiers: { luna: {} } }],
  ['a launch with no {session}', BASE, { tiers: { sol: { launch: 'c' } } }],
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
    const dir = dirWith(BASE)
    const settings = { tiers: { sol: { start: 'go {token}' } }, sound: true, theme: 'dark' }
    await runNew(next.writeSettings(dir, settings))
    expect(await runNew(next.readSettings(dir))).toMatchObject({ ok: settings })
  })
})
