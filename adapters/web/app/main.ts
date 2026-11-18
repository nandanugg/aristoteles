// The page of the UI: the dashboard (DESIGN 10) of the open project, drawn from the last whole
// Dash that the server sent (its socket pushes one on each change; a poll of GET /api/dash
// repairs a lost push; never a patch), with the sidebar of the directions at its left.
import { html, render } from 'htm/preact'
import { SessionId } from '../../../src/domain/ids.ts'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { Dash as DashSchema, type DashTerminalCard, DirView } from '../contract.ts'
import { api, chime, postForward, postWork, socket, toast } from './api.ts'
import type { WhatJson } from './api.ts'
import { Board, Person, PipeRow } from './board.ts'
import { DirectionCard, DirectionModal } from './directions.ts'
import { Gear } from './gear.ts'
import { ICONS, icon } from './icons.ts'
import { Modal } from './modal.ts'
import { Onboarding } from './onboarding.ts'
import { Review } from './review.ts'
import { Terminal } from './terminal.ts'

type DirData = typeof DirView.Type
type DashData = typeof DashSchema.Type

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

// The poll that repairs a lost push (G4).
const POLL_MS = 5000

// The last whole Dash. A push is taken at once; a poll that was in flight while a push came is
// older than it, so it is dropped. A Dash of another build reloads the page.
const useDash = () => {
  const [dash, setDash] = useState<DashData | null>(null)
  const pushes = useRef(0)
  const build = useRef<string | null>(null)
  const take = useCallback((d: DashData) => {
    if (build.current !== null && build.current !== d.header.build) location.reload()
    build.current = d.header.build
    setDash(d)
  }, [])
  const poll = useCallback(() => {
    const before = pushes.current
    api('/api/dash', DashSchema).then(
      (d) => before === pushes.current && take(d),
      () => setDash(null),
    )
  }, [take])
  useEffect(() => {
    poll()
    const off = socket.listen((m) => {
      if (m.type === 'dash') {
        pushes.current++
        take(m.dash)
      } else if (m.type === 'open') poll()
    })
    const timer = setInterval(poll, POLL_MS)
    const seen = () => document.visibilityState === 'visible' && poll()
    document.addEventListener('visibilitychange', seen)
    return () => {
      off()
      clearInterval(timer)
      document.removeEventListener('visibilitychange', seen)
    }
  }, [poll, take])
  return { dash, poll }
}

// The first start of a dir: the person pastes the prompt into the AI CLI that they use, in the
// dir. That session is the host: it installs the /aristoteles skill (ruling 12), then drafts the
// directions and the roles into the onboarding files, which the onboarding pages show.
function FirstStart({ dir }: { dir: DirData }) {
  const copy = () =>
    navigator.clipboard.writeText(dir.startPrompt).then(
      () => toast('The prompt is copied.'),
      () => toast('The page cannot copy: select the prompt and copy it.'),
    )
  return html`<div class="empty first">
    <h2>${dir.name} has no store yet</h2>
    <p>${'Open the AI CLI that you use in this dir, in a tmux pane, and paste this prompt into ' +
      'it. That session is the host. It installs the /aristoteles skill here (work skill ' +
      'install), then drafts the directions and the roles of this dir (work onboard). Each ' +
      'draft shows here: you check each direction, then each role, and approve all roles to ' +
      'start the store.'}</p>
    <pre class="draft-text">${dir.startPrompt}</pre>
    <button class="btn primary" onClick=${copy}>Copy the prompt</button>
  </div>`
}

interface SidebarProps {
  title: string
  dash: DashData | null
  open: boolean
  onToggle: () => void
  onSettings: () => void
  onDirection: (key: string, edit: boolean) => void
}
// Folded by default (Nanda, 2026-11-15); the button on its edge opens it: dir / project at the
// top, the direction cards, and the settings at the bottom.
function Sidebar({ title, dash, open, onToggle, onSettings, onDirection }: SidebarProps) {
  return html`<nav class=${open ? 'sidebar' : 'sidebar folded'} aria-label="Directions">
    <div class="sidebar-head">
      <button class="icon-button fold" aria-expanded=${open}
        aria-label=${open ? 'Hide the sidebar' : 'Show the sidebar'}
        onClick=${onToggle}>${icon(ICONS.panel, 18)}</button>
      <div class="crumb">${icon(ICONS.folder)}<strong>${title}</strong></div>
    </div>
    <div class="sidebar-list">${dash?.directions.map((d) => html`<${DirectionCard} key=${d.key}
      d=${d} onOpen=${(edit: boolean) => onDirection(d.key, edit)} />`)}</div>
    <div class="sidebar-foot">
      <button class="icon-button" aria-label="Settings"
        onClick=${onSettings}>${icon(ICONS.gear, 18)}</button>
    </div>
  </nav>`
}

// What a modal shows: a terminal, an escalation, or a direction (by key, so a new Dash keeps it).
type Shown =
  | { readonly kind: 'terminal'; readonly card: DashTerminalCard }
  | { readonly kind: 'escalation'; readonly id: string }
  | { readonly kind: 'direction'; readonly key: string; readonly edit: boolean }

function App() {
  const [dir, setDir] = useState<DirData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [settings, setSettings] = useState(false)
  const [sidebar, setSidebar] = useState(false)
  const [shown, setShown] = useState<Shown | null>(null)
  const { dash, poll } = useDash()

  useEffect(
    () => socket.listen((m) => (m.type === 'changed' ? setVersion((v) => v + 1) : undefined)),
    [],
  )
  useEffect(() => {
    api('/api/dir', DirView)
      .then((d) => {
        setDir(d)
        setError(null)
      })
      .catch((e) => setError(errorText(e)))
  }, [version])
  useEffect(() => {
    if (dir) document.documentElement.dataset.theme = dir.theme
  }, [dir?.theme])

  // The sound: when the person owes a new act, if the settings ask for it.
  const owed = useRef<number | null>(null)
  useEffect(() => {
    if (!dash || !dir) return
    const now = dash.person.length + dash.forwards.length
    if (owed.current !== null && dir.sound && now > owed.current) chime()
    owed.current = now
  }, [dash?.person.length, dash?.forwards.length])

  // An act of the person: a refusal makes the page read the Dash again.
  const act = useCallback(
    async (what: WhatJson) => {
      if (!dash) return { refused: 'none', words: 'The page has no dashboard yet.' }
      const out = await postWork(what, dash)
      if ('refused' in out) poll()
      return out
    },
    [dash, poll],
  )

  const forward = useCallback(
    async (op: 'confirm' | 'drop', id: string) => {
      if (!dash) return { refused: 'none', words: 'The page has no dashboard yet.' }
      const out = await postForward(op, id, dash)
      if ('refused' in out) poll()
      return out
    },
    [dash, poll],
  )

  if (error) {
    return html`<main class="canvas"><div class="empty"><h2>The UI cannot read this dir</h2>
      <p class="error">${error}</p></div></main>`
  }
  if (!dir) return html`<main class="canvas"></main>`
  const title = dash ? `${dash.header.dir} / ${dash.header.project}` : dir.name
  const escalation = shown?.kind === 'escalation' ? dash?.row.find((e) => e.id === shown.id) : null
  const direction =
    shown?.kind === 'direction' ? dash?.directions.find((d) => d.key === shown.key) : null
  const close = () => setShown(null)
  const terminal = (card: DashTerminalCard) => setShown({ kind: 'terminal', card })
  const review = (id: string) => setShown({ kind: 'escalation', id })
  return html`<div class="layout">
    <${Sidebar} title=${title} dash=${dash} open=${sidebar} onToggle=${() => setSidebar(!sidebar)}
      onSettings=${() => setSettings(true)}
      onDirection=${(key: string, edit: boolean) => setShown({ kind: 'direction', key, edit })} />
    <main class="canvas">
      ${dash
        ? html`<header class="dash-head"><h1>${title}</h1></header>
          <${Person} dash=${dash} onAct=${act} onForward=${forward} onEscalation=${review} />
          <${Board} dash=${dash} onTerminal=${terminal} />
          <${PipeRow} dash=${dash} onEscalation=${review} onTerminal=${terminal} />`
        : !dir.initialized
        ? dir.onboarding
          ? html`<${Onboarding} dir=${dir} version=${version} />`
          : html`<${FirstStart} dir=${dir} />`
        : html`<div class="empty"><h2>No project is open</h2>
          <p>A project opens from your AI CLI: trigger the aristoteles skill there.</p></div>`}
    </main>
    ${shown?.kind === 'terminal'
      ? html`<${Modal} title=${`Terminal of ${shown.card.role}`} kind="term" onClose=${close}>
          <${Terminal} label=${shown.card.role} session=${SessionId.make(shown.card.session)}
            live=${shown.card.status !== 'Inactive'} /><//>`
      : ''}
    ${escalation ? html`<${Review} e=${escalation} onAct=${act} onClose=${close} />` : ''}
    ${direction ? html`<${DirectionModal} d=${direction}
      editing=${shown?.kind === 'direction' && shown.edit} onAct=${act} onClose=${close} />` : ''}
    ${settings ? html`<${Gear} dir=${dir} version=${version}
      onClose=${() => setSettings(false)} />` : ''}
  </div>`
}

const root = document.getElementById('app')
if (root) render(html`<${App} />`, root)
