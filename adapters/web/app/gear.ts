// The gear (ruling 13): the settings, and one entry for the directions and one for the agents.
// Each entry shows the current items, a text box that stores a suggestion (about a direction, a
// new one, or the roles: P7), and the adjustments that wait for the person. A model drafts the
// adjustment from the suggestion; the person accepts or rejects it here (ruling 14).
import { Schema } from 'effect'
import { html } from 'htm/preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { DirectionId, NonBlank } from '../../../src/domain/ids.ts'
import {
  type DirView,
  OnboardingView,
  type SettingsChange,
  SuggestionTarget,
  type TierChange as TierChangeSchema,
} from '../contract.ts'
import { RoleGrid } from './agents.ts'
import { api, attempt, post } from './api.ts'
import { DirectionReview } from './direction.ts'
import { ICONS, icon } from './icons.ts'
import { Item } from './item.ts'

type DirData = typeof DirView.Type
type OnboardingData = typeof OnboardingView.Type
type TierChange = typeof TierChangeSchema.Type
type Target = typeof SuggestionTarget.Type

// --- the settings --------------------------------------------------------------------------

// Every tier has its model and commands (ruling 10): a role of any tier can be persistent.
type TierName = 'sol' | 'terra' | 'luna'
const TIER_NAMES: ReadonlyArray<TierName> = ['sol', 'terra', 'luna']
const TIER_LEGEND = { sol: 'Sol (high)', terra: 'Terra (medium)', luna: 'Luna (low)' }
const TIER_FIELDS = [
  ['model', 'Model (the commands name it as {model})'],
  ['launch', 'Launch command ({session} is required, {prompt} is the first input)'],
  ['resume', 'Resume command ({session}, {prompt} is the retry input)'],
  ['start', 'First input ({agent} is the persistent agent, such as p1)'],
  ['skills', 'Skills folder of the AI tool (relative to the dir)'],
  ['errors', 'Error words (one per line)'],
  ['prompts', 'Prompt words (one per line)'],
  ['silentMinutes', 'Minutes of silence that count as a failure'],
  ['retryInput', 'Retry input'],
] as const
type TierField = (typeof TIER_FIELDS)[number][0]

// The form keeps every value as text, the way the inputs do.
interface SettingsForm {
  theme: 'light' | 'dark'
  sound: boolean
  retryMinutes: string
  hostWaitMinutes: string
  tiers: Record<TierName, Record<TierField, string>>
}
const formOf = (s: DirData['settings']): SettingsForm => {
  const tier = (name: TierName) => {
    const t: Record<string, string | number | ReadonlyArray<string> | undefined> = {
      ...s.tiers[name],
    }
    const field = {} as Record<TierField, string>
    for (const [k] of TIER_FIELDS) {
      const v = t[k]
      field[k] = Array.isArray(v) ? v.join('\n') : v === undefined ? '' : String(v)
    }
    return field
  }
  return {
    theme: s.theme,
    sound: s.sound,
    retryMinutes: String(s.retryMinutes),
    hostWaitMinutes: String(s.hostWaitMinutes),
    tiers: { sol: tier('sol'), terra: tier('terra'), luna: tier('luna') },
  }
}

// The words the server reads as settings: only the fields that the person filled in.
const settingsOf = (form: SettingsForm): SettingsChange => {
  const tiers: { sol?: TierChange; terra?: TierChange; luna?: TierChange } = {}
  for (const tier of TIER_NAMES) {
    const t: Record<string, string | number | string[]> = {}
    for (const [k] of TIER_FIELDS) {
      const v = form.tiers[tier][k]
      if (v === '') continue
      t[k] =
        k === 'errors' || k === 'prompts'
          ? v
              .split('\n')
              .map((x) => x.trim())
              .filter(Boolean)
          : k === 'silentMinutes'
            ? Number(v)
            : v
    }
    if (Object.keys(t).length) tiers[tier] = t as TierChange
  }
  return {
    theme: form.theme,
    sound: form.sound,
    retryMinutes: Number(form.retryMinutes),
    hostWaitMinutes: Number(form.hostWaitMinutes),
    tiers,
  }
}

const value = (e: Event) =>
  (e.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value

function Settings({ dir, onClose }: { dir: DirData; onClose: () => void }) {
  const [form, setForm] = useState<SettingsForm>(() => formOf(dir.settings))
  const setTop = (change: Partial<SettingsForm>) => setForm((f) => ({ ...f, ...change }))
  const setTier = (tier: TierName, k: TierField, v: string) =>
    setForm((f) => ({ ...f, tiers: { ...f.tiers, [tier]: { ...f.tiers[tier], [k]: v } } }))
  const save = attempt(async () => {
    const out = await post({ act: 'settings', settings: settingsOf(form) })
    onClose()
    return out
  })
  return html`<div>
    <p class="modal-note">${'They are saved in '}<code>aristoteles.yaml</code>
      ${' of '}${dir.name}${'. The people and the roles are in the file too; ' +
      'edit them there, with its schema.'}</p>
    <div class="grid2">
      <label class="field"><span>Theme</span><select value=${form.theme}
        onChange=${(e: Event) => setTop({ theme: value(e) === 'dark' ? 'dark' : 'light' })}>
        <option value="light">Light</option><option value="dark">Dark</option></select></label>
      <label class="field check"><input type="checkbox" checked=${form.sound}
        onChange=${(e: Event) => setTop({ sound: (e.currentTarget as HTMLInputElement).checked })}
      /><span>Play a sound when a badge shows</span></label>
      <label class="field"><span>Minutes between the tries after a system problem</span>
        <input type="number" min="1" value=${form.retryMinutes}
        onInput=${(e: Event) => setTop({ retryMinutes: value(e) })} /></label>
      <label class="field"><span>Minutes to wait for the host's words</span><input type="number"
        min="1" value=${form.hostWaitMinutes}
        onInput=${(e: Event) => setTop({ hostWaitMinutes: value(e) })} /></label>
    </div>
    ${TIER_NAMES.map((tier) => html`<fieldset class="tier-set">
      <legend>${TIER_LEGEND[tier]}</legend>
      ${TIER_FIELDS.map(([k, label]) => html`<label class="field">
        <span>${label}</span>${k === 'errors' || k === 'prompts'
        ? html`<textarea rows="2" value=${form.tiers[tier][k]}
          onInput=${(e: Event) => setTier(tier, k, value(e))}></textarea>`
        : html`<input value=${form.tiers[tier][k]} aria-label=${`${tier} ${k}`}
          onInput=${(e: Event) => setTier(tier, k, value(e))} />`}</label>`)}
    </fieldset>`)}
    <div class="modal-foot"><button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn primary" onClick=${save}>Save</button></div>
  </div>`
}

// --- the directions and the agents ---------------------------------------------------------

// A text box that stores a suggestion; a model drafts what answers it.
function Suggest({ targets }: { targets: ReadonlyArray<readonly [string, Target]> }) {
  const [says, setSays] = useState('')
  const [chosen, setChosen] = useState(0)
  const about = targets[chosen]?.[1]
  const store = attempt(async () => {
    if (!about) return undefined
    const out = await post({ act: 'suggest', about, says: Schema.decodeUnknownSync(NonBlank)(says) })
    setSays('')
    return out
  })
  return html`<div class="suggest">
    ${targets.length > 1 ? html`<label class="field"><span>About</span>
      <select value=${String(chosen)} onChange=${(e: Event) => setChosen(Number(value(e)))}>
        ${targets.map(([label], i) => html`<option value=${String(i)}>${label}</option>`)}
      </select></label>` : ''}
    <label class="field"><span>Your suggestion, in words (a model drafts the change)</span>
      <textarea rows="2" value=${says} onInput=${(e: Event) => setSays(value(e))}></textarea>
    </label>
    <button class="btn" disabled=${!says.trim()} onClick=${store}>Store the suggestion</button>
  </div>`
}

const isDirectionAdjustment = (tag: string) => tag === 'RetireDirection'

function Entry({ view, kind }: { view: OnboardingData; kind: 'directions' | 'agents' }) {
  const mine = (tag: string) => isDirectionAdjustment(tag) === (kind === 'directions')
  const adjustments = view.adjustments.filter(
    (d) => d._tag === 'Adjustment' && mine(d.adjustment._tag),
  )
  const waiting = html`<div class="section-title">Adjustments that wait</div>
    ${adjustments.length
      ? adjustments.map((d) => html`<${Item} key=${d.id} item=${d} />`)
      : html`<p class="muted">None waits for you.</p>`}`
  if (kind === 'agents') {
    return html`<div>
      <${RoleGrid} roles=${view.roles} />
      <${Suggest} targets=${[['the roles', { _tag: 'Roles' }]]} />
      ${waiting}
    </div>`
  }
  const targets: ReadonlyArray<readonly [string, Target]> = [
    ['a new direction', { _tag: 'NewDirection' }],
    ...view.directions.map((x) => {
      const direction = Schema.decodeUnknownSync(DirectionId)(x.id)
      return [x.name, { _tag: 'Direction', direction }] as const
    }),
  ]
  return html`<div>
    <${CurrentDirections} directions=${view.directions} />
    <${Suggest} targets=${targets} />
    ${waiting}
  </div>`
}

// The current directions as the directions page shows them (Nanda, 2026-11-15): the list stays
// in view at the left, and the open one shows for its review: the version against the one before
// it, and its examples.
function CurrentDirections({ directions }: { directions: OnboardingData['directions'] }) {
  const [open, setOpen] = useState<string | null>(null)
  const card = directions.find((d) => d.id === open) ?? directions[0]
  if (!card) return html`<p class="muted">No direction is official yet.</p>`
  return html`<div class="onboarding-cols gear-directions">
    <nav class="direction-list" aria-label="Directions">
      ${directions.map((d) => html`<button class="direction-item"
        aria-current=${d.id === card.id ? 'true' : undefined} onClick=${() => setOpen(d.id)}>
        <span class="title">${d.name}</span></button>`)}
    </nav>
    <article class="direction-page" aria-label=${card.name}>
      <div class="direction-head"><h2>${card.name}</h2></div>
      <div class="muted"><code>${card.id}</code> · ${card.origin}</div>
      <div class="direction-body"><${DirectionReview} card=${card} /></div>
    </article>
  </div>`
}

type Tab = 'settings' | 'directions' | 'agents'
interface GearProps {
  readonly dir: DirData
  readonly version: number
  readonly onClose: () => void
}
export function Gear({ dir, version, onClose }: GearProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<Tab>('settings')
  const [view, setView] = useState<OnboardingData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', key)
  }, [])
  useEffect(() => {
    if (tab === 'settings' || !dir.initialized) return
    api('/api/onboarding', OnboardingView)
      .then((v) => {
        setView(v)
        setError(null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [tab, version, dir.initialized])
  const tabButton = (t: Tab, label: string, mark: unknown = '') => html`<button class="tab"
    role="tab" aria-selected=${t === tab} onClick=${() => setTab(t)}>${mark}${label}</button>`
  const entry =
    tab === 'settings' ? html`<${Settings} dir=${dir} onClose=${onClose} />`
    : !dir.initialized ? html`<p class="muted">Until the store starts, the directions and the
        agents are on the onboarding pages.</p>`
    : error ? html`<p class="error">${error}</p>`
    : view ? html`<${Entry} view=${view} kind=${tab} />` : ''
  return html`<div class="modal-back"
    onClick=${(e: Event) => e.target === e.currentTarget && onClose()}>
    <div class=${`modal gear${tab === 'settings' ? '' : ' wide'}`} role="dialog"
      aria-modal="true" aria-label="Settings" tabindex="-1" ref=${ref}>
      <h2>Settings</h2>
      <div class="tabs" role="tablist">
        ${tabButton('settings', 'Settings')}
        ${tabButton('directions', 'Directions')}
        ${tabButton('agents', 'Agents', icon(ICONS.bot, 15))}
      </div>
      <div class="gear-body">${entry}</div>
    </div>
  </div>`
}
