// The page of the UI: the sidebar with dir / project, the canvas in layout A (the task tree goes
// down; each task has its work and its reviews to its right), and the panel at the right. It
// only draws what the server sends; the server reads the store with the engine. The routes and
// the acts are typed by src/domain/ui-model.ts part 4.
import type { VNode } from 'preact'
import { Schema } from 'effect'
import { html, render } from 'htm/preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  DiffView,
  DirView,
  Owner as OwnerSchema,
  PersonView,
  ProjectView,
  ReviewCard as ReviewCardSchema,
  TaskPanel,
  WorkCard as WorkCardSchema,
} from '../contract.ts'
import { RunId, type TaskDraftId } from '../../../src/domain/ids.ts'
import type { ActOut } from './api.ts'
import { api, attempt, chime, post, socket, toast } from './api.ts'
import { DirectionText } from './direction.ts'
import { Gear } from './gear.ts'
import { ICONS, icon } from './icons.ts'
import { Item } from './item.ts'
import { Onboarding } from './onboarding.ts'
import { Terminal } from './terminal.ts'

type DirData = typeof DirView.Type
type ProjectData = typeof ProjectView.Type
type PanelData = typeof TaskPanel.Type
type Owner = typeof OwnerSchema.Type
type WorkCardData = typeof WorkCardSchema.Type
type ReviewCardData = typeof ReviewCardSchema.Type
type Row = ProjectData['rows'][number]
type TaskCardData = Row['task']
type Tier = 'sol' | 'terra' | 'luna' | 'program'

const useChanged = (fn: () => void) =>
  useEffect(
    () => socket.listen((m) => (m.type === 'changed' || m.type === 'open' ? fn() : undefined)),
    [fn],
  )

// The address of the page is a path (Nanda, 2026-11-15): / is onboarding or the list of the
// projects, then /<project>[/<task>[/<tab>]]. The History API keeps it, so back and forward work
// and each address can be bookmarked; the server serves the page for each such path.
interface Place {
  readonly project: string | null
  readonly task: string | null
  readonly tab: string | null
}
const placeNow = (): Place => {
  const [project, task, tab] = location.pathname.split('/').filter(Boolean)
  return { project: project ?? null, task: task ?? null, tab: tab ?? null }
}
// An old address (#/<project>/...) opens the same place once, as its path.
if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1) || '/')
// A move in the page: a new entry of the history, and the App reads the place again.
const goTo = (path: string) => {
  if (path !== location.pathname) history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
const go = (project: string | null, task?: string | null, tab?: string | null) =>
  goTo(`/${[project, task, tab].filter(Boolean).join('/')}`)
// A click on a link of the page moves in the page; with a key or another button the browser opens
// it in a new tab, as any link.
const follow = (e: MouseEvent) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  goTo((e.currentTarget as HTMLAnchorElement).pathname)
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const STATE_WORDS: Record<string, string> = {
  talks: 'talks',
  works: 'works',
  ends: 'ends',
  done: 'done',
  closed: 'closed',
}

const dot = (kind: string): VNode =>
  html`<span class=${`dot ${kind}`} aria-hidden="true"></span>`

// --- the sidebar ---------------------------------------------------------------------------

interface SidebarProps {
  dir: DirData
  project: string | null
  open: boolean
  onToggle: () => void
  onSettings: () => void
}
// A project starts in the AI CLI that the person triggers (Nanda, 2026-11-13): that session is the
// host, so the sidebar starts none. The sidebar starts folded (Nanda, 2026-11-15); the button at
// the top left opens it. Folded, a dot on the button tells of a project that needs the person.
function Sidebar({ dir, project, open, onToggle, onSettings }: SidebarProps) {
  const current = dir.projects.find((p) => p.id === project)
  const crumbTail = current ? html`<span>/ ${current.title}</span>` : ''
  const needsYou = !open && dir.projects.some((p) => p.badge)
  // One shape for both states, so the width can move between them; folded, the parts beside the
  // buttons are hidden (they take no focus).
  return html`<nav class=${open ? 'sidebar' : 'sidebar folded'} aria-label="Projects of this dir">
    <div class="sidebar-head">
      <button class="icon-button fold" aria-expanded=${open}
        aria-label=${open ? 'Hide the projects' : 'Show the projects'}
        onClick=${onToggle}>${icon(ICONS.panel, 18)}${needsYou
          ? html`<span class="badge-dot" aria-hidden="true"></span>` : ''}</button>
      <div class="crumb">${icon(ICONS.folder)}<a class="crumb-dir" href="/"
        onClick=${follow}><strong>${dir.name}</strong></a>${crumbTail}</div>
    </div>
    <div class="sidebar-list">${dir.projects.map((p) => html`
      <a class="project" href=${`/${p.id}`} onClick=${follow}
        aria-current=${p.id === project ? 'page' : undefined}>
        ${p.state === 'done' ? icon(ICONS.check, 14) : dot(p.state === 'closed' ? 'closed' : 'run')}
        <span class="title">${p.title}</span>
        ${p.badge ? html`<span class="badge" role="img"
          aria-label="Needs you">!</span>` : html`<span
          class="state">${STATE_WORDS[p.state] ?? p.state}</span>`}
      </a>`)}</div>
    <div class="sidebar-foot">
      <button class="icon-button" aria-label="Settings"
        onClick=${onSettings}>${icon(ICONS.gear, 18)}</button>
    </div>
  </nav>`
}

// --- the cards -----------------------------------------------------------------------------

const TIER_NAME: Record<string, string> = { sol: 'Sol', terra: 'Terra', luna: 'Luna' }
const tierIcon = (tier: Tier): VNode =>
  tier === 'sol' ? ICONS.sol : tier === 'terra' ? ICONS.terra : ICONS.luna

interface TaskCardProps {
  task: TaskCardData
  selected: boolean
  onOpen: (task: string, tab?: string) => void
  onStop: (o: Owner) => Promise<ActOut | undefined>
  onResume: (o: Owner) => Promise<ActOut | undefined>
}
// A click on a button of a card must not open the card.
const stopThen = (fn: () => unknown) => (e: Event) => {
  e.stopPropagation()
  fn()
}

function TaskCard({ task, selected, onOpen, onStop, onResume }: TaskCardProps) {
  const o = task.owner
  const tier: Tier = o?.tier ?? 'luna'
  // The terminal of a persistent agent is its own, across its assignments (ruling 9).
  const tags = o
    ? o.inside
      ? `${TIER_NAME[tier]} · in ${o.inside}`
      : `${TIER_NAME[tier]} · ${o.agent ? `${o.agent} · ${o.a}` : o.a}`
    : 'no terminal'
  const live = o && !o.inside && o.live
  return html`<section class=${`card task ${tier}${selected ? ' selected' : ''}`}
    aria-label=${`${task.id} ${task.name}`} onClick=${() => onOpen(task.id)}>
    <div class="card-head">
      <span class="tier-icon">${icon(tierIcon(tier), 15)}</span>
      ${o && !o.inside && o.session ? html`<span class=${`dot ${live ? 'run' : 'closed'}`}
        role="img" aria-label=${live ? 'Its terminal runs' : 'Its terminal is closed'}>
        </span>` : ''}
      ${task.badge ? html`<span class="badge" role="img" aria-label="Needs you">!</span>` : ''}
      <button class="tags tag-button" aria-label=${`Open the terminal of ${task.id}`}
        onClick=${stopThen(() => onOpen(task.id, 'terminal'))}>${tags}</button>
      ${o && live ? html`<button class="icon-button power"
        aria-label=${`Stop the terminal of ${o.a}`}
        onClick=${stopThen(() => onStop(o))}>${icon(ICONS.power, 15)}</button>` : ''}
    </div>
    <div class="card-body">
      <div class="task-title"><span class="id">${task.id}</span>${task.name}</div>
      <div class="now">${task.words}</div>
      ${task.attempt ? html`<div class="kv"><span class="k">Attempt</span>
        <span class="v">${task.attempt.now} of ${task.attempt.max}</span></div>` : ''}
    </div>
    ${o && !o.inside && o.session && !live && o.resumable ? html`<div class="card-foot">
      <button class="btn primary wide" onClick=${stopThen(() => onResume(o))}>
        ${icon(ICONS.play, 13)} Resume ${o.a}</button></div>` : ''}
  </section>`
}

function WorkCard({ work, onOpen }: { work: WorkCardData; onOpen: () => void }) {
  const attemptMax = work.attempt.max ? ` of ${work.attempt.max}` : ''
  const fileWord = work.files === 1 ? 'file' : 'files'
  return html`<section class="card work" aria-label=${`work of ${work.a}`} onClick=${onOpen}>
    <div class="card-head"><span class="kind">WORK</span>
      <span class="tags">${work.a} ${work.role} · ${TIER_NAME[work.tier] ?? work.tier}</span></div>
    <div class="card-body">
      <div class="kv"><span class="k">Now</span><span class="v">${work.state}</span></div>
      ${work.attempt ? html`<div class="kv"><span class="k">Attempt</span>
        <span class="v">${work.attempt.now}${attemptMax}</span></div>` : ''}
      ${work.result ? html`<div class="kv"><span class="k">Result</span>
        <span class="v">${work.result} · ${work.files} ${fileWord}</span>
        </div>` : ''}
    </div>
  </section>`
}

function ReviewCard({ review, onOpen }: { review: ReviewCardData; onOpen: () => void }) {
  const kind = review.decides ? 'DECIDE' : 'REVIEW'
  return html`<section class=${`card review ${review.decision}`}
    aria-label=${`${kind.toLowerCase()} by ${review.by}`} onClick=${onOpen}>
    <div class="card-head"><span class="kind">${kind}</span>
      <span class="tags">${review.id ?? ''}</span></div>
    <div class="card-body">
      <div class="kv"><span class="v"
        title=${review.by}>${review.id ? `${review.by} ${review.role}` : review.by}</span></div>
      <div class=${`decision ${review.decision}`}>${review.decision}</div>
      ${review.line ? html`<div class="line" title=${review.line}>${review.line}</div>` : ''}
    </div>
  </section>`
}

// The tree lines of layout A: for each row, one gutter cell for each level above it.
const gutters = (rows: ReadonlyArray<Row>): string[][] => {
  const out: string[][] = rows.map(() => [])
  rows.forEach((row, i) => {
    const cells = out[i] ?? []
    for (let level = 1; level <= row.depth; level++) {
      // Is there a later row at this level before the tree goes back above it?
      let more = false
      for (let j = i + 1; j < rows.length; j++) {
        const depth = rows[j]?.depth ?? 0
        if (depth < level) break
        if (depth === level) {
          more = true
          break
        }
      }
      cells.push(level === row.depth ? (more ? 'tee' : 'elbow') : more ? 'pipe' : 'blank')
    }
  })
  return out
}

interface CanvasProps {
  view: ProjectData
  selected: string | null
  onOpen: (task: string, tab?: string) => void
  onStop: (o: Owner) => Promise<ActOut | undefined>
  onResume: (o: Owner) => Promise<ActOut | undefined>
  onOpenDraft: (id: TaskDraftId) => Promise<ActOut | undefined>
}
function Canvas({ view, selected, onOpen, onStop, onResume, onOpenDraft }: CanvasProps) {
  if (!view.rows.length) {
    // A run that talks: its terminal is the talk; a drafted top task waits for the person's Open.
    // A run that ended has no rows, because the canvas shows only what runs now.
    const words =
      view.state === 'done'
        ? 'The project is done. Nothing runs now.'
        : view.state === 'closed'
          ? 'The project is closed. Nothing runs now.'
          : view.kind === 'host'
            ? 'The host talks with you here. Say what you want; when it drafts the top task, ' +
              'the draft shows below, and you open it.'
            : 'The assess skill reads this dir and drafts its directions; each draft waits for you.'
    return html`<div class="talk">
      <p class="talk-words">${words}</p>
      ${view.drafts.map((d) => html`<section class="card task sol draft-card">
        <div class="card-head"><span class="tier-icon">${icon(ICONS.sol, 15)}</span>
          <span class="kind">DRAFT</span><span class="tags">${d.id} · for ${d.role}</span></div>
        <div class="card-body"><div class="task-title">${d.name}</div>
          <div class="now prose">${d.text}</div></div>
        <div class="card-foot"><button class="btn primary wide"
          onClick=${() => onOpenDraft(d.id)}>Open ${d.id}</button></div>
      </section>`)}
      ${view.terminal ? html`<div class="talk-term"><${Terminal} terminal=${view.terminal} />
        </div>` : ''}
    </div>`
  }
  const cells = gutters(view.rows)
  return html`<div class="rows">${view.rows.map((row, i) => html`
    <div class="row">
      <div class="gutter">${(cells[i] ?? []).map((c) => html`<span class=${`g ${c}`}>
        </span>`)}</div>
      <div class="row-cards">
        <${TaskCard} task=${row.task} selected=${selected === row.task.id} onOpen=${onOpen}
          onStop=${onStop} onResume=${onResume} />
        ${row.work.length ? html`<span class="link" aria-hidden="true"></span>` : ''}
        <div class="works">${row.work.map((w) => html`
          <div class="chain">
            <${WorkCard} work=${w} onOpen=${() => onOpen(row.task.id, 'diff')} />
            ${w.reviews.map((r) => html`<span class="link" aria-hidden="true"></span>
              <${ReviewCard} review=${r} onOpen=${() => onOpen(row.task.id, 'description')} />`)}
          </div>`)}
        </div>
      </div>
    </div>`)}
  </div>`
}

// --- the panel -----------------------------------------------------------------------------

type Evidence = PanelData['results'][number]['reviews'][number]['evidence'][number]
const evidenceLine = (e: Evidence): VNode =>
  html`<li>${e.rule ? html`<code>${e.rule}</code> · ` : ''}
    ${e.where ? `${e.where} · ` : ''}${e.says}</li>`

// The decision of the person is the first thing in the Description, above the words of
// the task: the panel is not split.
function Description({ panel }: { panel: PanelData }) {
  return html`<div>
    ${panel.decisions.map((item) => html`<${Item} key=${item.id} item=${item} />`)}
    <div class="prose">${panel.text}</div>
    <div class="section-title">Reviews</div>
    ${panel.results.length ? panel.results.map((r) => html`
      <div class="review-entry">
        <div class="head"><strong>${r.id}</strong><span>by ${r.by}</span><code>${r.output}</code>
          </div>
        ${r.reviews.length ? r.reviews.map((v) => html`
          <div style="margin-top: 8px">
            <span class=${`decision ${v.decision.toLowerCase()}`}>
              ${v.decision.toLowerCase()}</span> by ${v.by}
            ${v.breaks ? html` · breaks <code>${v.breaks}</code>` : ''}
            ${v.reason ? html`: ${v.reason}` : ''}
            ${v.evidence.length
              ? html`<ul class="evidence">${v.evidence.map(evidenceLine)}</ul>` : ''}
          </div>`) : html`<div style="margin-top: 6px; color: var(--faint)">no reviews yet</div>`}
      </div>`) : html`<div style="color: var(--faint)">no result yet</div>`}
    <div class="section-title">Time line</div>
    <div class="timeline">${panel.timeline.map((e) => html`<div>${e.line}</div>`)}</div>
  </div>`
}

function Directions({ panel }: { panel: PanelData }) {
  const directions = panel.directions
  if (!directions?.length) {
    return html`<div style="color: var(--faint)">This task follows no direction.</div>`
  }
  return html`<div>${directions.map((d) => html`
    <div class="direction">
      <h3>${d.name} <code style="font-weight: 400; color: var(--faint)">${d.version}</code></h3>
      <div style="font-size: 13px; color: var(--muted)">owner ${d.owner}</div>
      <${DirectionText} card=${d} />
      ${d.changed.length ? html`<div class="section-title">Versions in this project</div>
        ${d.changed.map((v) => html`<div><code>${v.id}</code> · ${v.at}</div>`)}` : ''}
      ${d.drafts.length ? html`<div class="section-title">Drafts that wait</div>
        ${d.drafts.map((x) => html`<div><code>${x.id}</code> by ${x.by}</div>`)}` : ''}
    </div>`)}
  </div>`
}

// The lines of a diff from its first hunk: the file is named in the head of the file already.
const hunks = (text: string): string[] =>
  text
    .split('\n')
    .filter(
      (l, i, all) =>
        all.slice(0, i + 1).some((x) => x.startsWith('@@') || x.startsWith('# ')) &&
        !/^(diff --git|index |--- |\+\+\+ )/.test(l),
    )

const diffClass = (l: string): string =>
  l.startsWith('@@')
    ? 'hunk'
    : l.startsWith('+') && !l.startsWith('+++')
      ? 'add'
      : l.startsWith('-') && !l.startsWith('---')
        ? 'del'
        : ''

const diffLine = (l: string): VNode => html`<div class=${diffClass(l)}>${l || ' '}</div>`

type PanelFile = PanelData['files'][number]
function DiffFile({ task, file, version }: { task: string; file: PanelFile; version: number }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    if (open) {
      api(`/api/diff/${task}?file=${encodeURIComponent(file.file)}`, DiffView)
        .then((d) => setText(d.diff))
        .catch((e) => setText(`# ${errorText(e)}`))
    }
  }, [open, task, file.file, version])
  return html`<div class="file">
    <button class="file-head" aria-expanded=${open} onClick=${() => setOpen(!open)}>
      <span>${open ? '▾' : '▸'}</span><span>${file.file}</span>
      <span class="counts">
        <span class="add-n">+${file.added}</span>${' '}
        <span class="del-n">−${file.removed}</span></span>
    </button>
    ${open && text !== null ? html`<pre class="diff">${hunks(text).map(diffLine)}</pre>` : ''}
  </div>`
}

function Diff({ panel, version }: { panel: PanelData; version: number }) {
  if (!panel.files.length) return html`<div style="color: var(--faint)">No file changed yet.</div>`
  return html`<div>${panel.files.map((f) => html`<${DiffFile} key=${f.file} task=${panel.id}
    file=${f} version=${version} />`)}</div>`
}

interface PanelProps {
  id: string
  tab: string | null
  version: number
  onClose: () => void
  onTab: (tab: string) => void
}
const TAB_LABEL: Record<string, string> = {
  description: 'Description',
  directions: 'Directions',
  diff: 'Diff',
  terminal: 'Terminal',
}
function Panel({ id, tab, version, onClose, onTab }: PanelProps) {
  const [panel, setPanel] = useState<PanelData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api(`/api/task/${id}`, TaskPanel)
      .then((p) => {
        setPanel(p)
        setError(null)
      })
      .catch((e) => setError(errorText(e)))
  }, [id, version])
  if (error) {
    return html`<aside class="panel"><div class="panel-head"><h2>${id}</h2>
      <button class="icon-button" aria-label="Close"
      onClick=${onClose}>${icon(ICONS.close)}</button></div>
      <div class="tab-body error">${error}</div></aside>`
  }
  if (!panel) return html`<aside class="panel"></aside>`
  const tabs = ['description', ...(panel.top ? ['directions'] : []), 'diff', 'terminal']
  const now = tab && tabs.includes(tab) ? tab : 'description'
  return html`<aside class="panel" aria-label=${`${panel.id} ${panel.name}`}>
    <div class="panel-head"><h2><span class="id">${panel.id}</span>${panel.name}</h2>
      <button class="icon-button" aria-label="Close"
        onClick=${onClose}>${icon(ICONS.close)}</button></div>
    <div class="panel-words">${panel.words}</div>
    <div class="tabs" role="tablist">${tabs.map((t) => html`<button class="tab" role="tab"
      aria-selected=${t === now} onClick=${() => onTab(t)}>${TAB_LABEL[t]}</button>`)}</div>
    <div class=${`tab-body${now === 'terminal' ? ' terminal-body' : ''}`} role="tabpanel">
      ${now === 'description' ? html`<${Description} panel=${panel} />` : ''}
      ${now === 'directions' ? html`<${Directions} panel=${panel} />` : ''}
      ${now === 'diff' ? html`<${Diff} panel=${panel} version=${version} />` : ''}
      ${now === 'terminal' ? html`<${Terminal} terminal=${panel.terminal} />` : ''}
    </div>
  </aside>`
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

// The projects of a dir with a store (Nanda, 2026-11-15): / lists them, the newest first, each
// with its name and state, and the person opens one.
function Projects({ dir }: { dir: DirData }) {
  if (!dir.projects.length) {
    return html`<div class="empty"><h2>No project yet</h2>
      <p>A project starts in your AI CLI: trigger the aristoteles skill there, and that session is
        the host. Its terminal shows here.</p></div>`
  }
  return html`<div class="projects-page">
    <div class="canvas-head"><h1>Projects of ${dir.name}</h1></div>
    <ul class="project-list">${dir.projects.map((p) => html`<li><a class="project-row"
      href=${`/${p.id}`} onClick=${follow}>
      <span class="title">${p.title}</span><code>${p.id}</code>
      <span class=${`chip ${p.state}`}>${STATE_WORDS[p.state] ?? p.state}</span>
      ${p.badge ? html`<span class="badge" role="img" aria-label="Needs you">!</span>` : ''}
    </a></li>`)}</ul>
  </div>`
}

// --- the app -------------------------------------------------------------------------------

function App() {
  const [dir, setDir] = useState<DirData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [place, setPlace] = useState(placeNow())
  const [view, setView] = useState<ProjectData | null>(null)
  const [version, setVersion] = useState(0)
  const [settings, setSettings] = useState(false)
  const [sidebar, setSidebar] = useState(false)
  // Ruling 10.8: a git user.name that is no person of the dir sees no items, and this line.
  const [personLine, setPersonLine] = useState<string | null>(null)

  useEffect(() => {
    const on = () => setPlace(placeNow())
    window.addEventListener('popstate', on)
    return () => window.removeEventListener('popstate', on)
  }, [])
  const refresh = () => setVersion((v) => v + 1)
  useChanged(refresh)
  useEffect(() => {
    api('/api/dir', DirView)
      .then((d) => {
        setDir(d)
        setError(null)
      })
      .catch((e) => setError(errorText(e)))
  }, [version])
  useEffect(() => {
    if (!dir?.initialized) return setPersonLine(null)
    api('/api/person', PersonView)
      .then((p) => setPersonLine(p.line))
      .catch(() => setPersonLine(null))
  }, [dir?.initialized, version])
  useEffect(() => {
    if (dir) document.documentElement.dataset.theme = dir.theme
  }, [dir?.theme])
  const project = place.project
  // missing: the server has no project of the path.
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    if (!project) return setView(null)
    api(`/api/project/${project}`, ProjectView)
      .then((v) => {
        setView(v)
        setMissing(false)
      })
      .catch(() => {
        setView(null)
        setMissing(true)
      })
  }, [project, version])

  // The sound: when a new badge shows, if the settings ask for it.
  const badges = useRef<string | null>(null)
  useEffect(() => {
    if (!dir) return
    const now = dir.projects
      .filter((p) => p.badge)
      .map((p) => p.id)
      .join(',')
    if (badges.current !== null && dir.sound && now && now !== badges.current) chime()
    badges.current = now
  }, [dir])
  const stop = attempt(async (o: Owner) =>
    o.session ? post({ act: 'stop', session: o.session }) : undefined,
  )
  // Every tier has its commands (ruling 10), so a persistent agent of any tier resumes.
  const resume = attempt(async (o: Owner) =>
    o.session && o.tier !== 'program'
      ? post({ act: 'resume', session: o.session, tier: o.tier })
      : undefined,
  )
  const openDraft = attempt((id: TaskDraftId) => post({ act: 'open', draft: id }))
  const closeProject = attempt(async () => {
    const reason = window.prompt(
      'Why do you close this project? ' +
        '(it stops every terminal of the project and closes its tasks)',
    )
    if (!reason || !view) return undefined
    return post({ act: 'close', run: Schema.decodeUnknownSync(RunId)(view.id), reason })
  })

  const sessionWords = view?.session ? ` · session ${view.session}` : ''
  const canClose = view && view.kind !== 'task' && view.state !== 'done' && view.state !== 'closed'
  if (error) {
    return html`<main class="canvas"><div class="empty"><h2>The UI cannot read this dir</h2>
      <p class="error">${error}</p></div></main>`
  }
  if (!dir) return html`<main class="canvas"></main>`
  return html`<div class="layout">
    <${Sidebar} dir=${dir} project=${project} open=${sidebar}
      onToggle=${() => setSidebar(!sidebar)} onSettings=${() => setSettings(true)} />
    <main class="canvas">
      ${personLine ? html`<p class="person-line">${personLine}</p>` : ''}
      ${!dir.initialized
        ? dir.onboarding
          ? html`<${Onboarding} dir=${dir} version=${version} />`
          : html`<${FirstStart} dir=${dir} />`
        : !project ? html`<${Projects} dir=${dir} />`
        : !view ? missing ? html`<div class="empty"><h2>There is no project ${project} here</h2>
          <p><a href="/" onClick=${follow}>The projects of ${dir.name}</a></p></div>` : ''
        : html`<div class="canvas-head"><h1>${view.title}</h1>
          <span class="meta">${view.id} · ${view.state}${sessionWords}</span>
            ${canClose ? html`<button class="btn quiet small"
              onClick=${() => closeProject()}>Close project</button>` : ''}</div>
          <${Canvas} view=${view} selected=${place.task}
            onOpen=${(task: string, tab?: string) => go(project, task, tab)} onStop=${stop}
            onResume=${resume} onOpenDraft=${openDraft} />`}
    </main>
    ${place.task ? html`<${Panel} id=${place.task} tab=${place.tab} version=${version}
      onClose=${() => go(project)} onTab=${(t: string) => go(project, place.task, t)} />` : ''}
    ${settings ? html`<${Gear} dir=${dir} version=${version}
      onClose=${() => setSettings(false)} />` : ''}
  </div>`
}

const root = document.getElementById('app')
if (root) render(html`<${App} />`, root)
