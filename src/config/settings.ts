// The settings of the UI live in aristoteles.yaml and are read from the file now (never stored).
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import type { OutsideFailed, Refused } from '../domain/errors.ts'
import type { Settings } from '../domain/files.ts'
import { PositiveInt } from '../domain/ids.ts'
import { Files } from '../services/outside.ts'
import { CONFIG, DRAFT, fail, parseYaml, type Raw, refusing, SETTING_KEYS } from './core.ts'

// The settings of a model; limits is its mechanism, which config.ts reads.
export const MODEL_KEYS = [
  'launch',
  'resume',
  'start',
  'skills',
  'errors',
  'prompts',
  'silentMinutes',
  'retryInput',
  'limits',
] as const
// The first prompt of a persistent agent names no token (P9): each of its assignments comes to it
// through its own work wait, as the steps of a host come to the host (ruling 9).
export const DEFAULT_START =
  'Use the work skill. You are {agent}: run work wait --by={agent}, and do what it prints.'
// What the UI types into a terminal that ended, shows an error, or is silent: one command, and
// the words that say it is the UI's, not the person's (Nanda, 2026-11-13).
export const DEFAULT_RETRY =
  'System message, not from the person. Run work wait --by={agent}, and do what it prints.'
const MODEL_DEFAULTS = {
  start: DEFAULT_START,
  errors: [],
  prompts: [],
  silentMinutes: 10,
  retryInput: DEFAULT_RETRY,
}

const wholeNumber = Schema.is(PositiveInt)

// The commands of one model of the models table, checked, with their defaults. {model} in a
// command is the model's name; {prompt} is the first input, given as an argument.
const readModel = (file: string, name: string, m: Raw): unknown => {
  const at = `models.${name}`
  if (typeof m !== 'object' || m === null || Array.isArray(m)) fail(file, `${at} is a map of settings`)
  const key = Object.keys(m).find((k) => !(MODEL_KEYS as readonly string[]).includes(k))
  if (key) fail(file, `${at}.${key} is not a setting of a model (${MODEL_KEYS.join(', ')})`)
  for (const k of ['launch', 'resume', 'start', 'skills', 'retryInput']) {
    if (m[k] !== undefined && (typeof m[k] !== 'string' || !m[k].trim())) {
      fail(file, `${at}.${k} is a text`)
    }
  }
  for (const k of ['errors', 'prompts']) {
    const v = m[k]
    if (v !== undefined && (!Array.isArray(v) || v.some((w: unknown) => typeof w !== 'string'))) {
      fail(file, `${at}.${k} is a list of words`)
    }
  }
  if (m.silentMinutes !== undefined && !wholeNumber(m.silentMinutes)) {
    fail(file, `${at}.silentMinutes is a whole number of 1 or more`)
  }
  if (m.launch !== undefined && !m.launch.includes('{session}')) {
    fail(
      file,
      `${at}.launch has no {session}: the UI gives each real agent its session id, so that a resume finds it`,
    )
  }
  if (m.resume !== undefined && !m.resume.includes('{session}')) {
    fail(file, `${at}.resume has no {session}`)
  }
  if (m.start !== undefined && !m.start.includes('{agent}')) fail(file, `${at}.start has no {agent}`)
  const { limits: _, ...commands } = m
  return { ...MODEL_DEFAULTS, ...commands }
}

// The settings of a parsed file, checked, with their defaults. Every model has its commands
// (ruling 10): a role of any model can be persistent, and runs in a terminal of its own.
export const readSettingsOf = (raw: Raw, file: string = CONFIG): Settings => {
  const table = raw.models ?? {}
  if (typeof table !== 'object' || Array.isArray(table)) fail(file, 'models is a map of models by name')
  const models = Object.fromEntries(
    Object.entries<Raw>(table).map(([name, m]) => [name, readModel(file, name, m)]),
  )
  for (const k of ['retryMinutes', 'hostWaitMinutes', 'outsideSourceHours']) {
    if (raw[k] !== undefined && !wholeNumber(raw[k])) {
      fail(file, `${k} is a whole number of 1 or more`)
    }
  }
  if (raw.sound !== undefined && typeof raw.sound !== 'boolean') fail(file, 'sound is true or false')
  if (raw.theme !== undefined && !['light', 'dark'].includes(raw.theme)) {
    fail(file, 'theme is light or dark')
  }
  return {
    models,
    retryMinutes: raw.retryMinutes ?? 5,
    hostWaitMinutes: raw.hostWaitMinutes ?? 10,
    outsideSourceHours: raw.outsideSourceHours ?? 72,
    sound: raw.sound ?? false,
    theme: raw.theme ?? 'light',
  } as Settings
}

// The settings of a dir, from its file now; a dir with no file has the defaults.
// Before the store starts, the config draft holds the settings that will apply (the host edits
// its models during onboarding): one reader for both, so the page never shows another model than
// the file (Nanda, 2026-11-15).
export const readSettings = (dir: string): Effect.Effect<Settings, Refused, Files> =>
  Effect.gen(function* () {
    const files = yield* Files
    const config = yield* files.read(join(dir, CONFIG))
    const file = config === null ? DRAFT : CONFIG
    const text = config ?? (yield* files.read(join(dir, DRAFT)))
    return yield* refusing(() => readSettingsOf(text === null ? {} : parseYaml(text), file))
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

// The text of aristoteles.yaml after Accept the roles, from the file and the host's draft. The
// settings in the draft (the host writes the models of its own AI CLI) replace their blocks in the
// file, so that each key has one block; the people and the roles go below. Two blocks of one key
// would parse as the last one, and a later edit on the page would change only the first.
export const mergeDraft = (file: string, draft: string): string => {
  const raw = parseYaml(draft)
  const keys = SETTING_KEYS.filter((k) => k in raw)
  const head = withSettings(file, Object.fromEntries(keys.map((k) => [k, raw[k]])))
  const rest = withSettings(draft, Object.fromEntries(keys.map((k) => [k, undefined])))
  return `${head.trimEnd()}${head.trim() ? '\n' : ''}${rest}`
}

// The models of a change of the page: the commands that it sends, for each model of the file;
// the limits of each model are its mechanism and stay as they are, and no model comes or goes.
const withModels = (original: string, settings: Raw): Raw => {
  if (settings?.models === undefined) return settings
  const now: Raw = parseYaml(original).models ?? {}
  const models = Object.fromEntries(
    Object.entries<Raw>(now).map(([name, m]) => {
      const { limits: _, ...commands } = settings.models[name] ?? m
      return [name, m?.limits ? { ...commands, limits: m.limits } : commands]
    }),
  )
  return { ...settings, models }
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
    const text = yield* refusing(() => withSettings(original, withModels(original, settings)))
    yield* files.write(path, text)
  })
