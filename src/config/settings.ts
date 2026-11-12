// The settings of the UI live in aristoteles.yaml and are read from the file now (never stored).
import { join } from 'node:path'
import { Effect } from 'effect'
import type { OutsideFailed, Refused } from '../domain/errors.ts'
import type { Settings } from '../domain/files.ts'
import { Files } from '../services/outside.ts'
import { CONFIG, fail, parseYaml, type Raw, refusing, SETTING_KEYS } from './core.ts'

export const TIER_KEYS = [
  'launch',
  'resume',
  'start',
  'skills',
  'errors',
  'prompts',
  'silentMinutes',
  'retryInput',
] as const
export const DEFAULT_START = 'Use the work skill. Your command: work brief {token}'
const TIER_DEFAULTS = {
  start: DEFAULT_START,
  errors: [],
  prompts: [],
  silentMinutes: 10,
  retryInput: 'continue',
}

const wholeNumber = (v: unknown): boolean => Number.isInteger(v) && (v as number) >= 1

// The settings of a parsed file, checked, with their defaults. Sol and Terra run as real agents
// in terminals, so only they have commands: a Luna is a subagent inside its parent's terminal.
export const readSettingsOf = (raw: Raw): Settings => {
  const tiers: Record<string, unknown> = {}
  for (const [tier, t] of Object.entries<Raw>(raw.tiers ?? {})) {
    if (!['sol', 'terra'].includes(tier)) {
      fail(CONFIG, `tiers.${tier}: only sol and terra run in terminals (a luna is a subagent)`)
    }
    const key = Object.keys(t ?? {}).find((k) => !(TIER_KEYS as readonly string[]).includes(k))
    if (key) {
      fail(CONFIG, `tiers.${tier}.${key} is not a setting of a tier (${TIER_KEYS.join(', ')})`)
    }
    for (const k of ['launch', 'resume', 'start', 'skills', 'retryInput']) {
      if (t[k] !== undefined && (typeof t[k] !== 'string' || !t[k].trim())) {
        fail(CONFIG, `tiers.${tier}.${k} is a text`)
      }
    }
    for (const k of ['errors', 'prompts']) {
      if (
        t[k] !== undefined &&
        (!Array.isArray(t[k]) || t[k].some((w: unknown) => typeof w !== 'string'))
      ) {
        fail(CONFIG, `tiers.${tier}.${k} is a list of words`)
      }
    }
    if (t.silentMinutes !== undefined && !wholeNumber(t.silentMinutes)) {
      fail(CONFIG, `tiers.${tier}.silentMinutes is a whole number of 1 or more`)
    }
    // {prompt} in a command is the first input, given as an argument so it need not wait.
    if (t.launch !== undefined && !t.launch.includes('{session}')) {
      fail(
        CONFIG,
        `tiers.${tier}.launch has no {session}: the UI gives each real agent its session id, so that a resume finds it`,
      )
    }
    if (t.resume !== undefined && !t.resume.includes('{session}')) {
      fail(CONFIG, `tiers.${tier}.resume has no {session}`)
    }
    if (t.start !== undefined && !t.start.includes('{token}')) {
      fail(CONFIG, `tiers.${tier}.start has no {token}`)
    }
    tiers[tier] = { ...TIER_DEFAULTS, ...t }
  }
  for (const k of ['retryMinutes', 'hostWaitMinutes', 'outsideSourceHours']) {
    if (raw[k] !== undefined && !wholeNumber(raw[k])) {
      fail(CONFIG, `${k} is a whole number of 1 or more`)
    }
  }
  if (raw.sound !== undefined && typeof raw.sound !== 'boolean') fail(CONFIG, 'sound is true or false')
  if (raw.theme !== undefined && !['light', 'dark'].includes(raw.theme)) {
    fail(CONFIG, 'theme is light or dark')
  }
  return {
    tiers,
    retryMinutes: raw.retryMinutes ?? 5,
    hostWaitMinutes: raw.hostWaitMinutes ?? 10,
    outsideSourceHours: raw.outsideSourceHours ?? 72,
    sound: raw.sound ?? false,
    theme: raw.theme ?? 'light',
  } as Settings
}

// The settings of a dir, from its file now; a dir with no file has the defaults.
export const readSettings = (dir: string): Effect.Effect<Settings, Refused, Files> =>
  Effect.gen(function* () {
    const files = yield* Files
    const text = yield* files.read(join(dir, CONFIG))
    return yield* refusing(() => readSettingsOf(text === null ? {} : parseYaml(text)))
  })

const yamlBlock = (key: string, value: unknown): string =>
  Bun.YAML.stringify({ [key]: value }, null, 2)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter(Boolean)
    .join('\n')

// Puts each setting key into the text as one block of lines (from its key to the next line at
// the left margin) and keeps every other line as it is.
export const withSettings = (original: string, settings: Raw): string => {
  let text = original
  for (const key of SETTING_KEYS) {
    if (!(key in settings)) continue
    const block = settings[key] === undefined ? '' : yamlBlock(key, settings[key])
    const lines = text.split('\n')
    const start = lines.findIndex((l) => l.startsWith(`${key}:`))
    if (start === -1) {
      if (!block) continue
      // A new key goes after the first lines of comments (the schema line), before the rest.
      let at = 0
      while (at < lines.length && (lines[at] ?? '').startsWith('#')) at++
      lines.splice(at, 0, ...block.split('\n'))
    } else {
      let end = start + 1
      while (end < lines.length && (lines[end] === '' || /^\s/.test(lines[end] ?? ''))) end++
      while (end > start + 1 && (lines[end - 1] ?? '').trim() === '') end--
      lines.splice(start, end - start, ...(block ? block.split('\n') : []))
    }
    text = lines.join('\n')
  }
  readSettingsOf(parseYaml(text))
  return text.endsWith('\n') ? text : `${text}\n`
}

// Writes the settings into aristoteles.yaml and keeps the mechanism as it is. The new text is
// checked before the write, so a refusal leaves the file alone.
export const writeSettings = (
  dir: string,
  settings: unknown,
): Effect.Effect<void, Refused | OutsideFailed, Files> =>
  Effect.gen(function* () {
    const files = yield* Files
    const path = join(dir, CONFIG)
    const original = (yield* files.read(path)) ?? ''
    const text = yield* refusing(() => withSettings(original, settings))
    yield* files.write(path, text)
  })
