// The cards of the dashboard (DESIGN 10): the task queue, the host, one column for each
// persistent role, the pipeline row along the bottom, and the acts that the person owes.
import type { ComponentChildren } from 'preact'
import { html } from 'htm/preact'
import { useEffect, useState } from 'preact/hooks'
import type { Dash, DashTerminalCard } from '../contract.ts'
import type { ActView, WorkOut, WorkSender } from './api.ts'
import { QuestionForm } from './questions.ts'
import { useSubmission } from './submission.ts'
import { escalationClass, type Escalation, minto, statusClass } from './pure.ts'

type Task = Dash['queue'][number]
type Subagent = Dash['host']['subagents'][number]
export type Act = WorkSender
export type Forward = (op: 'confirm' | 'drop', id: string) => Promise<WorkOut>

// The terminal card: role, model, its status (a color and the word) and its work now. A click
// opens the terminal.
export function TerminalCard({ card, onOpen }: { card: DashTerminalCard; onOpen: () => void }) {
  return html`<button class="card terminal" aria-label=${`Terminal of ${card.role}`}
    onClick=${onOpen}>
    <div class="card-head"><span class="role-name">${card.role}</span>
      <span class="tags">${card.model || 'no model'}</span></div>
    <div class="card-body">
      <span class=${`status ${statusClass(card.status)}`}>${card.status}</span>
      <div class="now">${card.work}</div>
    </div>
  </button>`
}

const pointsOf = (text: string): ReadonlyArray<string> =>
  text.split('\n').map((point) => point.trim()).filter(Boolean)

function RejectForm({
  task, onAct, view, close,
}: { task: string; onAct: Act; view: ActView; close: () => void }) {
  const [text, setText] = useState('')
  const { submit, busy, words } = useSubmission(onAct, view)
  const points = pointsOf(text)
  const send = async (e: Event) => {
    e.preventDefault()
    if (!points.length) return
    const open = { _tag: 'OpenReject', task, points } as const
    if (await submit({ _tag: 'Open', open })) close()
  }
  return html`<form class="field" onSubmit=${send}>
    <label>Points for the pipeline<textarea value=${text} disabled=${busy}
      onInput=${(e: Event) => setText((e.currentTarget as HTMLTextAreaElement).value)}>
    </textarea></label>
    <div class="owed-acts">
      <button class="btn" type="button" disabled=${busy} onClick=${close}>Cancel</button>
      <button class="btn primary" disabled=${busy || !points.length}>Send to the pipeline</button>
    </div>
    ${words ? html`<div class="error" role="alert">${words}</div>` : ''}
  </form>`
}

function RejectResult({ id, onAct, view }: { id: string; onAct: Act; view: ActView }) {
  const [open, setOpen] = useState(false)
  return open ? html`<${RejectForm} task=${id} onAct=${onAct} view=${view}
    close=${() => setOpen(false)} />`
    : html`<button class="btn" onClick=${() => setOpen(true)}>Reject result</button>`
}

export function TaskCard({
  task, onAct, view,
}: { task: Task; onAct: Act; view: ActView }) {
  return html`<section class="card task" aria-label=${`Task ${task.name}`}>
    <div class="card-head"><span class="task-name">${task.name}</span>
      <span class=${`state ${task.state.toLowerCase()}`}>${task.state}</span></div>
    <div class="card-body"><div class="for">for ${task.role}</div>
      <p class="desc">${task.description}</p>
      ${task.reject ? html`<${RejectResult} id=${task.id} onAct=${onAct} view=${view} />` : ''}
    </div>
  </section>`
}

const SubagentCard = ({ s }: { s: Subagent }) =>
  html`<section class="card subagent" aria-label=${`Subagent of ${s.role}`}>
    <div class="card-head"><span class="tags">${s.model}</span><span class="kind">${s.role}</span>
    </div>
    <div class="card-body"><p class="desc">${s.goal}</p></div>
  </section>`

const Column = ({ title, children }: { title: string; children: ComponentChildren }) =>
  html`<section class="col" aria-label=${title}><h2 class="col-title">${title}</h2>${children}
  </section>`

interface BoardProps {
  dash: Dash
  onTerminal: (card: DashTerminalCard) => void
  onAct: Act
}
export function Board({ dash, onTerminal, onAct }: BoardProps) {
  return html`<div class="board">
    <${Column} title="Task queue">
      ${dash.queue.map((t) => html`<${TaskCard} key=${t.id} task=${t}
        onAct=${onAct} view=${dash.header} />`)}
    <//>
    <${Column} title="Host">
      <${TerminalCard} card=${dash.host.card} onOpen=${() => onTerminal(dash.host.card)} />
      ${dash.host.subagents.map((s, i) => html`<${SubagentCard} key=${i} s=${s} />`)}
    <//>
    ${dash.columns.map((c) => html`<${Column} key=${c.role} title=${c.role}>
      <${TerminalCard} card=${c.card} onOpen=${() => onTerminal(c.card)} />
      ${c.task ? html`<${TaskCard} task=${c.task} onAct=${onAct} view=${dash.header} />` : ''}
      ${c.subagents.map((s, i) => html`<${SubagentCard} key=${i} s=${s} />`)}
    <//>`)}
  </div>`
}

export function Results({ dash, onAct }: { dash: Dash; onAct: Act }) {
  if (!dash.results.length) return ''
  return html`<section class="person" aria-label="Completed results">
    <h2 class="col-title">Completed results</h2>
    <ul>${dash.results.map((result) => html`<li key=${result.id} class="owed">
      <div class="owed-words">${result.name}</div>
      <${RejectResult} id=${result.id} onAct=${onAct} view=${dash.header} />
    </li>`)}</ul>
  </section>`
}

// The summary of an escalation as a pyramid: the conclusion, then what supports it.
export function Pyramid({ summary }: { summary: string }) {
  const { conclusion, supports } = minto(summary)
  return html`<div class="pyramid"><p class="conclusion">${conclusion}</p>
    ${supports.length ? html`<ul class="supports">${supports.map((x) => html`<li>${x}</li>`)}</ul>`
      : ''}</div>`
}

const STATUS_WORDS = {
  QUEUED: 'Queued',
  IN_PIPELINE: 'In the pipeline',
  WAIT_FOR_REVIEW: 'Waits for review',
} as const

// The pipeline row: every escalation, and the pipeline role's card. It is hidden unless an
// escalation waits for review; the strip at the bottom edge shows it while the pointer is on it
// (DESIGN 10.1).
interface RowProps {
  dash: Dash
  onEscalation: (id: string) => void
  onTerminal: (card: DashTerminalCard) => void
}
export function PipeRow({ dash, onEscalation, onTerminal }: RowProps) {
  const [peek, setPeek] = useState(false)
  // The row stays while the pointer is on it; a move anywhere else hides it again.
  useEffect(() => {
    if (!peek) return undefined
    const on = (e: MouseEvent) =>
      e.target instanceof Element && !e.target.closest('.pipe-row, .row-strip') && setPeek(false)
    document.addEventListener('mousemove', on)
    return () => document.removeEventListener('mousemove', on)
  }, [peek])
  if (!dash.rowShown && !peek) {
    return html`<button class="row-strip" aria-label="Show the task pipeline"
      onMouseEnter=${() => setPeek(true)} onFocus=${() => setPeek(true)}
      onClick=${() => setPeek(true)}></button>`
  }
  return html`<section class="pipe-row" aria-label="Task pipeline">
    <h2 class="col-title">Task pipeline</h2>
    <div class="pipe-cards">
      <${TerminalCard} card=${dash.pipe} onOpen=${() => onTerminal(dash.pipe)} />
      ${dash.row.map((e) => html`<${EscalationCard} key=${e.id} e=${e}
        onOpen=${() => onEscalation(e.id)} />`)}
      ${dash.row.length ? '' : html`<p class="muted">No escalation.</p>`}
    </div>
  </section>`
}

function EscalationCard({ e, onOpen }: { e: Escalation; onOpen: () => void }) {
  return html`<button class=${`card escalation ${escalationClass(e.status)}`}
    aria-label=${`Escalation ${e.id}`} onClick=${onOpen}>
    <div class="card-head"><span class="status">${STATUS_WORDS[e.status]}</span>
      <span class="tags">${e.id}</span></div>
    <div class="card-body"><div class="for">${e.task}</div><${Pyramid} summary=${e.summary} /></div>
  </button>`
}

function EndProject({ onAct, view }: { onAct: Act; view: ActView }) {
  const { submit, busy, words } = useSubmission(onAct, view)
  return html`<li class="owed"><button class="btn primary" disabled=${busy}
    onClick=${() => submit({ _tag: 'EndProject' })}>End the project</button>
    ${words ? html`<div class="error" role="alert">${words}</div>` : ''}
  </li>`
}

interface PersonProps {
  dash: Dash
  onAct: Act
  onForward: Forward
  onEscalation: (id: string) => void
}
// A forwarded act: the host carried the person's words; nothing counts until the person confirms.
function Forwarded({ f, onForward }: { f: Dash['forwards'][number]; onForward: Forward }) {
  const [refused, setRefused] = useState<string | null>(null)
  const run = (op: 'confirm' | 'drop') =>
    onForward(op, f.id).then((out) => setRefused('refused' in out ? out.words : null))
  return html`<li class="owed forwarded"><div class="owed-words">
      <div class="muted">The host forwards: ${f.quote}</div>
      ${f.words.map((w) => html`<div>${w}</div>`)}</div>
    <div class="owed-acts"><button class="btn primary" onClick=${() => run('confirm')}>Confirm
      </button><button class="btn" onClick=${() => run('drop')}>Drop</button></div>
    ${refused ? html`<div class="error" role="alert">${refused}</div>` : ''}</li>`
}

export function Person({ dash, onAct, onForward, onEscalation }: PersonProps) {
  const list = dash.person.owed
  if (!list.length && !dash.forwards.length) return ''
  return html`<section class="person" aria-label="Waits for you">
    <h2 class="col-title">Waits for you</h2>
    <ul>${list.map((act) => {
      switch (act._tag) {
        case 'Question':
          return html`<${QuestionForm} key=${act.ask} act=${act} onAct=${onAct}
            view=${dash.header} />`
        case 'Decide': {
          const row = dash.row.find((item) => item.ask === act.ask)
          if (!row) return ''
          return html`<li class="owed" key=${act.ask}><div class="owed-words">
            <${Pyramid} summary=${row.summary} /></div>
            <button class="btn primary" onClick=${() => onEscalation(act.fix)}>Review it</button>
          </li>`
        }
        case 'ReviveHost':
          return html`<li class="owed" key="revive-host">
            Run <code>work run continue</code> in the host terminal.
          </li>`
        case 'EndProject':
          return html`<${EndProject} key="end-project" onAct=${onAct} view=${dash.header} />`
      }
    })}
      ${dash.forwards.map((f) => html`<${Forwarded} key=${f.id} f=${f} onForward=${onForward} />`)}
    </ul></section>`
}
