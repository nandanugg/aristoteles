// The agents (ruling 11): the grid of role cards and the window of one role, for the agents page
// of onboarding and the gear's agents entry. The role icons are a vendor file that loads only
// when a grid shows, as xterm.js loads with the first terminal.
import type { VNode } from 'preact'
import { html } from 'htm/preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { RoleCard as RoleCardSchema } from '../contract.ts'
import { ICONS, icon } from './icons.ts'

export type RoleCardData = typeof RoleCardSchema.Type

declare global {
  interface Window {
    roleIcons?: Readonly<Record<string, string>>
  }
}

// /vendor/role-icons.js sets window.roleIcons: the inner markup of each icon, by its name. A
// failed load is tried again by the next grid.
let loading: Promise<Readonly<Record<string, string>>> | undefined
const iconsLoaded = (): Promise<Readonly<Record<string, string>>> => {
  loading ??= new Promise((done, fail) => {
    const tag = document.createElement('script')
    tag.src = '/vendor/role-icons.js'
    tag.onload = () => done(window.roleIcons ?? {})
    tag.onerror = () => {
      loading = undefined
      tag.remove()
      fail(new Error('/vendor/role-icons.js did not load'))
    }
    document.head.append(tag)
  })
  return loading
}
const useRoleIcons = (): Readonly<Record<string, string>> => {
  const [icons, setIcons] = useState<Readonly<Record<string, string>>>(window.roleIcons ?? {})
  useEffect(() => {
    iconsLoaded()
      .then(setIcons)
      .catch(() => {})
  }, [])
  return icons
}

const roleIcon = (icons: Readonly<Record<string, string>>, name: string, size = 15): VNode =>
  html`<svg class="role-icon" aria-hidden="true" width=${size} height=${size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round" dangerouslySetInnerHTML=${{ __html: icons[name] ?? '' }}></svg>`

const persistenceWord = (r: RoleCardData): string =>
  r.persistence === null ? 'program' : r.persistence.persistent ? 'persistent' : 'disposable'

// The acts of the window of a role on the agents page (the gear's window has none); undefined:
// the act was refused, and the window stays.
type Done = Promise<unknown | undefined>
export interface RoleActs {
  readonly accept: (role: string) => Done
  readonly revise: (role: string, words: string) => Done
  readonly remove: (role: string) => Done
}

interface GridProps {
  readonly roles: ReadonlyArray<RoleCardData>
  readonly onToggle?: (role: string, persistent: boolean) => void
  readonly acts?: RoleActs
}
// The cards in a grid; a click opens the window of the role. A toggle sets the persistence: the
// role of the top task has none (ruling 15).
export function RoleGrid({ roles, onToggle, acts }: GridProps) {
  const icons = useRoleIcons()
  const [open, setOpen] = useState<string | null>(null)
  const shown = roles.find((r) => r.role === open)
  const checked = (e: Event) => (e.currentTarget as HTMLInputElement).checked
  return html`<div class="role-grid">
    ${roles.map((r) => html`<section class=${`card role-card ${r.tier}`} aria-label=${r.role}
      onClick=${() => setOpen(r.role)}>
      <div class="card-head"><span class="tier-icon">${roleIcon(icons, r.icon)}</span>
        <strong class="role-name">${r.role}</strong>
        ${r.state === 'accepted'
          ? html`<span class="accepted" role="img" aria-label="Accepted">${icon(ICONS.check, 14)}
            </span>` : ''}
        ${r.toggle && onToggle && r.persistence
          ? html`<label class="switch" onClick=${(e: Event) => e.stopPropagation()}>
            <input type="checkbox" checked=${r.persistence.persistent}
              aria-label=${`${r.role} is persistent`}
              onChange=${(e: Event) => onToggle(r.role, checked(e))}
            /><span>persistent</span></label>`
          : html`<span class="tags">${persistenceWord(r)}</span>`}
      </div>
      <div class="card-body">
        <div class="kv"><span class="k">Model</span><span class="v">${r.model ?? 'none'}</span>
          </div>
        <div class="now">${r.summary}</div>
        ${r.request
          ? html`<div class="waits">Your words wait for the host: ${r.request}</div>` : ''}
      </div>
    </section>`)}
    ${shown ? html`<${RoleWindow} role=${shown} icons=${icons} acts=${acts}
      onClose=${() => setOpen(null)} />` : ''}
  </div>`
}

interface WindowProps {
  readonly role: RoleCardData
  readonly icons: Readonly<Record<string, string>>
  readonly acts: RoleActs | undefined
  readonly onClose: () => void
}
// The window of one role: the model and the launch command read only from the settings, the
// words, the persistence with its reason; on the agents page a text box, Accept (the box is
// empty), Revise (it has words), and Remove.
function RoleWindow({ role: r, icons, acts, onClose }: WindowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [words, setWords] = useState('')
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', key)
  }, [])
  const then = (done: Done) => done.then((out) => out !== undefined && onClose())
  const empty = !words.trim()
  const back = (e: Event) => e.target === e.currentTarget && onClose()
  return html`<div class="modal-back" onClick=${back}>
    <div class="modal role-window" role="dialog" aria-modal="true" aria-label=${r.role}
      tabindex="-1" ref=${ref}>
      <h2 class=${r.tier}><span class="tier-icon">${roleIcon(icons, r.icon, 18)}</span>
        ${r.role}</h2>
      <div class="kv"><span class="k">Model</span><span class="v">${r.model ?? 'none'}</span>
        </div>
      <div class="kv"><span class="k">Launch</span><code class="v">${r.launch ?? 'none'}</code>
        </div>
      <p class="prose">${r.summary}</p>
      ${r.description !== r.summary ? html`<p class="prose muted">${r.description}</p>` : ''}
      ${r.persistence ? html`<p><strong>${persistenceWord(r)}</strong>: ${r.persistence.why}</p>`
        : html`<p>A program runs in the CLI, never in a terminal.</p>`}
      ${r.found ? html`<p class="muted">The project has it: <code>${r.found}</code></p>` : ''}
      ${r.request ? html`<p class="waits">Your words wait for the host: ${r.request}</p>` : ''}
      ${acts ? html`<label class="field"><span>What to change (Revise needs words)</span>
        <textarea rows="2" value=${words}
          onInput=${(e: Event) => setWords((e.currentTarget as HTMLTextAreaElement).value)}>
        </textarea></label>
        <div class="modal-foot">
          <button class="btn" onClick=${() => then(acts.remove(r.role))}>Remove</button>
          <button class="btn" disabled=${empty}
            onClick=${() => then(acts.revise(r.role, words))}>Revise</button>
          <button class="btn primary" disabled=${!empty}
            onClick=${() => then(acts.accept(r.role))}>Accept</button>
        </div>`
        : html`<div class="modal-foot"><button class="btn" onClick=${onClose}>Close</button></div>`}
    </div>
  </div>`
}
