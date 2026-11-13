// The page of the UI: the sidebar with dir / project, the canvas in layout A (the task tree goes
// down; each task has its work and its reviews to its right), and the panel at the right. It
// only draws what the server sends; the server reads the store with the engine. The routes and
// the acts are typed by src/domain/ui-model.ts part 4.
import type { VNode } from 'preact'
import { Schema } from 'effect'
import { html, render } from 'htm/preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import {
  type Decision,
  DiffView,
  DirView,
  Owner as OwnerSchema,
  ProjectView,
  ReviewCard as ReviewCardSchema,
  RolesDraft,
  type SettingsChange,
  TierChange as TierChangeSchema,
  TaskPanel,
  WorkCard as WorkCardSchema,
} from '../contract.ts'
import { ProblemId, RevisionId, RunId, type TaskDraftId, TaskId } from '../../domain/ids.ts'
import type { ActOut } from './api.ts'
import { api, attempt, chime, post, socket, toast } from './api.ts'
import { Change } from './change.ts'
import { ICONS, icon } from './icons.ts'
import { Terminal } from './terminal.ts'

type DirData = typeof DirView.Type
type ProjectData = typeof ProjectView.Type
type PanelData = typeof TaskPanel.Type
type Owner = typeof OwnerSchema.Type
type WorkCardData = typeof WorkCardSchema.Type
type ReviewCardData = typeof ReviewCardSchema.Type
type TierChange = typeof TierChangeSchema.Type
type Row = ProjectData['rows'][number]
type TaskCardData = Row['task']
type Tier = 'sol' | 'terra' | 'luna' | 'program'

const useChanged = (fn: () => void) =>
  useEffect(
    () => socket.listen((m) => (m.type === 'changed' || m.type === 'open' ? fn() : undefined)),
    [fn],
  )

// The address of the page: #/<project>[/<task>[/<tab>]].
interface Hash {
  readonly project: string | null
  readonly task: string | null
  readonly tab: string | null
}
const readHash = (): Hash => {
  const [, project, task, tab] = location.hash.split('/')
  return { project: project || null, task: task || null, tab: tab || null }
}
const go = (project: string | null, task?: string | null, tab?: string | null) => {
  location.hash = `/${[project, task, tab].filter(Boolean).join('/')}`
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const STATE_WORDS: Record<string, string> = {
  talks: 'talks',
  works: 'works',
  done: 'done',
  closed: 'closed',
}

const dot = (kind: string): VNode =>
  html`<span class=${`dot ${kind}`} aria-hidden="true"></span>`

// --- the sidebar ---------------------------------------------------------------------------

interface SidebarProps {
  dir: DirData
  project: string | null
  onSettings: () => void
}
// A project starts in the AI CLI that the person triggers (Nanda, 2026-11-13): that session is the
// host, so the sidebar starts none.
function Sidebar({ dir, project, onSettings }: SidebarProps) {
  const current = dir.projects.find((p) => p.id === project)
  const crumbTail = current ? html`<span>/ ${current.title}</span>` : ''
  return html`<nav class="sidebar" aria-label="Projects of this dir">
    <div class="crumb">${icon(ICONS.folder)}<strong>${dir.name}</strong>${crumbTail}</div>
    ${dir.projects.map((p) => html`
      <a class="project" href=${`#/${p.id}`} aria-current=${p.id === project ? 'page' : undefined}>
        ${p.state === 'done' ? icon(ICONS.check, 14) : dot(p.state === 'closed' ? 'closed' : 'run')}
        <span class="title">${p.title}</span>
        ${p.badge ? html`<span class="badge" role="img"
          aria-label="Needs you">!</span>` : html`<span
          class="state">${STATE_WORDS[p.state] ?? p.state}</span>`}
      </a>`)}
    <div class="sidebar-foot">
      <button class="icon-button" aria-label="Settings"
        onClick=${onSettings}>${icon(ICONS.gear, 20)}</button>
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
  const tags = o
    ? o.inside
      ? `${TIER_NAME[tier]} · in ${o.inside}`
      : `${TIER_NAME[tier]} · ${o.a}`
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
      <div class="prose" style="margin-top: 8px">${d.says}</div>
      ${d.standards.map((s) => html`<div class="standard"><div><span class="sid">${s.id}</span>
        </div><div class="prose">${s.says}</div>
        ${s.rules.map((r) => html`<div class="rule">
          <span class="rid">${r.id}${r.checkedBy ? ` · ${r.checkedBy}` : ''}</span>
          <div class="prose">${r.says}</div></div>`)}</div>`)}
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

// A decision that needs the person: the host's words (or the raw text), and its buttons. A
// direction problem reads in three parts: the problem, the change, the hope.
const KIND = {
  system: 'A system problem',
  direction: 'A direction problem',
  end: 'The end of the project',
}
const kindOf = (item: Decision): keyof typeof KIND => {
  switch (item._tag) {
    case 'System':
      return 'system'
    case 'Direction':
      return 'direction'
    case 'End':
      return 'end'
  }
}
function Item({ item }: { item: Decision }) {
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  // A refused act keeps the person's comment, and its reason stays in the decision (a toast goes
  // after 5 seconds, and the decision looked as if nothing happened).
  const run = (fn: () => Promise<ActOut>) => async () => {
    if (busy.current) return
    busy.current = true
    setError(null)
    try {
      const out = await fn()
      if (out.out) toast(out.out.split('\n')[0] ?? '')
      setComment('')
    } catch (e) {
      setError(errorText(e))
    } finally {
      busy.current = false
    }
  }
  const kind = kindOf(item)
  // Each act decodes the id of the decision into its branded type; a bad id is shown as a refusal.
  const fixed = () => post({ act: 'fixed', problem: Schema.decodeUnknownSync(ProblemId)(item.id) })
  const acceptDraft = () =>
    post({ act: 'accept-draft', draft: Schema.decodeUnknownSync(RevisionId)(item.id), comment })
  const rejectDraft = () =>
    post({
      act: 'reject-draft',
      draft: Schema.decodeUnknownSync(RevisionId)(item.id),
      reason: comment,
    })
  const acceptEnd = () => post({ act: 'end', run: Schema.decodeUnknownSync(RunId)(item.id) })
  const rejectTask = () =>
    post({ act: 'reject-task', task: Schema.decodeUnknownSync(TaskId)(item.task), reason: comment })
  // A decision takes one comment: a reject needs it, an accept does not.
  const decides = kind === 'direction' || kind === 'end'
  const noComment = !comment.trim()
  const change = item._tag === 'Direction' ? item.change : null
  const hope = item._tag === 'Direction' ? item.hope : null
  return html`<div class=${`item ${kind}`} role="region" aria-label=${KIND[kind]}>
    <div class="item-head"><span class="badge" aria-hidden="true">!</span>
      <strong>${KIND[kind]}</strong></div>
    <div class="prose">${item.words ?? item.text}</div>
    ${change ? html`<${Change} change=${change} />` : ''}
    ${hope ? html`<div class="prose">${hope}</div>` : ''}
    ${item.words ? html`<div class="item-raw">${item.text}</div>` : ''}
    ${decides ? html`<label class="field"><span>Your comment (a reject needs one)</span>
      <textarea rows="2" value=${comment}
        onInput=${(e: Event) => setComment((e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea></label>` : ''}
    ${error ? html`<div class="error" role="alert">Refused: ${error}</div>` : ''}
    <div class="item-actions">
      ${kind === 'system' ? html`<button class="btn primary"
        onClick=${run(fixed)}>Fixed</button>` : ''}
      ${kind === 'direction' ? html`
        <button class="btn primary" onClick=${run(acceptDraft)}>Accept the change</button>
        <button class="btn" disabled=${noComment}
          onClick=${run(rejectDraft)}>Reject the change</button>` : ''}
      ${kind === 'end' ? html`
        <button class="btn primary" onClick=${run(acceptEnd)}>Accept the end</button>
        <button class="btn" disabled=${noComment}
          onClick=${run(rejectTask)}>Reject the result</button>` : ''}
    </div>
  </div>`
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

// --- the settings modal --------------------------------------------------------------------

type TierName = 'sol' | 'terra'
const TIER_NAMES: ReadonlyArray<TierName> = ['sol', 'terra']
const TIER_FIELDS = [
  ['launch', 'Launch command ({session} is required, {prompt} is the first input)'],
  ['resume', 'Resume command ({session}, {prompt} is the retry input)'],
  ['start', 'First input ({token})'],
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
    tiers: { sol: tier('sol'), terra: tier('terra') },
  }
}

// The words the server reads as settings: only the fields that the person filled in.
const settingsOf = (form: SettingsForm): SettingsChange => {
  const tiers: { sol?: TierChange; terra?: TierChange } = {}
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

function SettingsModal({ dir, onClose }: { dir: DirData; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState<SettingsForm>(() => formOf(dir.settings))
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', key)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', key)
  }, [])
  const setTop = (change: Partial<SettingsForm>) => setForm((f) => ({ ...f, ...change }))
  const setTier = (tier: TierName, k: TierField, value: string) =>
    setForm((f) => ({ ...f, tiers: { ...f.tiers, [tier]: { ...f.tiers[tier], [k]: value } } }))
  const save = attempt(async () => {
    const out = await post({ act: 'settings', settings: settingsOf(form) })
    onClose()
    return out
  })
  const value = (e: Event) =>
    (e.currentTarget as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value
  return html`<div class="modal-back"
    onClick=${(e: Event) => e.target === e.currentTarget && onClose()}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Settings" tabindex="-1"
      ref=${ref}>
      <h2>Settings</h2>
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
        <legend>${tier === 'sol' ? 'Sol (high)' : 'Terra (medium)'}</legend>
        ${TIER_FIELDS.map(([k, label]) => html`<label class="field">
          <span>${label}</span>${k === 'errors' || k === 'prompts'
          ? html`<textarea rows="2" value=${form.tiers[tier][k]}
            onInput=${(e: Event) => setTier(tier, k, value(e))}></textarea>`
          : html`<input value=${form.tiers[tier][k]}
            onInput=${(e: Event) => setTier(tier, k, value(e))} />`}</label>`)}
      </fieldset>`)}
      <div class="modal-foot"><button class="btn" onClick=${onClose}>Cancel</button>
        <button class="btn primary" onClick=${save}>Save</button></div>
    </div>
  </div>`
}

// The first start of a dir: the person pastes the assess prompt into the AI CLI that they use,
// in the dir (it is the host, so it writes the commands of the tiers); then the person accepts
// the roles that it drafted.
function FirstStart({ dir }: { dir: DirData }) {
  const [draft, setDraft] = useState<string | null>(null)
  useEffect(() => {
    if (dir.rolesDraft) {
      api('/api/roles-draft', RolesDraft)
        .then((d) => setDraft(d.text))
        .catch(() => {})
    }
  }, [dir.rolesDraft])
  const copy = () =>
    navigator.clipboard.writeText(dir.startPrompt).then(
      () => toast('The prompt is copied.'),
      () => toast('The page cannot copy: select the prompt and copy it.'),
    )
  return html`<div class="empty first">
    <h2>${dir.name} has no store yet</h2>
    ${dir.rolesDraft ? html`<p>${
          'The assess skill drafted the people, the limits and the roles of ' +
          'this dir. Read them, then accept them: the UI writes '}<code>aristoteles.yaml</code>
          ${' and runs '}<code>work init</code>.</p>
        <pre class="draft-text">${draft ?? ''}</pre>
        <button class="btn primary"
          onClick=${attempt(() => post({ act: 'accept-roles' }))}>Accept the roles</button>`
      : html`<p>${
          'Open the AI CLI that you use in this dir, in a tmux pane, and paste this prompt ' +
          'into it. That session is the host: it reads the dir and drafts its people and ' +
          'roles; the draft shows here, and waits for you.'}</p>
        <pre class="draft-text">${dir.startPrompt}</pre>
        <button class="btn primary" onClick=${copy}>Copy the prompt</button>`}
  </div>`
}

// --- the app -------------------------------------------------------------------------------

function App() {
  const [dir, setDir] = useState<DirData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hash, setHash] = useState(readHash())
  const [view, setView] = useState<ProjectData | null>(null)
  const [version, setVersion] = useState(0)
  const [settings, setSettings] = useState(false)

  useEffect(() => {
    const on = () => setHash(readHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
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
    if (dir) document.documentElement.dataset.theme = dir.theme
  }, [dir?.theme])
  const project = hash.project ?? dir?.projects[0]?.id ?? null
  useEffect(() => {
    if (!project) return setView(null)
    api(`/api/project/${project}`, ProjectView)
      .then(setView)
      .catch(() => setView(null))
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
  const resume = attempt(async (o: Owner) =>
    o.session && (o.tier === 'sol' || o.tier === 'terra')
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
    <${Sidebar} dir=${dir} project=${project} onSettings=${() => setSettings(true)} />
    <main class="canvas">
      ${!dir.initialized ? html`<${FirstStart} dir=${dir} />`
        : !view ? html`<div class="empty"><h2>No project yet</h2>
          <p>A project starts in your AI CLI: trigger the aristoteles skill there, and that
            session is the host. Its terminal shows here.</p></div>`
        : html`<div class="canvas-head"><h1>${view.title}</h1>
          <span class="meta">${view.id} · ${view.state}${sessionWords}</span>
            ${canClose ? html`<button class="btn quiet small"
              onClick=${() => closeProject()}>Close project</button>` : ''}</div>
          <${Canvas} view=${view} selected=${hash.task}
            onOpen=${(task: string, tab?: string) => go(project, task, tab)} onStop=${stop}
            onResume=${resume} onOpenDraft=${openDraft} />`}
    </main>
    ${hash.task ? html`<${Panel} id=${hash.task} tab=${hash.tab} version=${version}
      onClose=${() => go(project)} onTab=${(t: string) => go(project, hash.task, t)} />` : ''}
    ${settings ? html`<${SettingsModal} dir=${dir} onClose=${() => setSettings(false)} />` : ''}
  </div>`
}

const root = document.getElementById('app')
if (root) render(html`<${App} />`, root)
