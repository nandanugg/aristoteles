// What a direction draft changes, from the store: the title of the direction over a diff of its
// whole text, as GitHub shows a file. Two columns of line numbers (the old text, the new text),
// a "+" or "-" column, and the line. The unchanged lines more than 3 lines from a change are
// hidden behind a "@@" row: down opens 20 lines below the part above it, up opens 20 lines above
// the part below it, and the double arrow opens a short run whole.
import type { VNode } from 'preact'
import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import type { DraftChange } from '../../../src/domain/ui-model.ts'

const CONTEXT = 3
const STEP = 20

interface Numbered {
  readonly mark: string
  readonly text: string
  readonly old: number | null
  readonly now: number | null
}
// A run of unchanged lines far from a change; top and bottom count the lines opened at each end.
interface Run {
  readonly start: number
  readonly end: number
  readonly top: number
  readonly bottom: number
}
interface Opened {
  readonly top: number
  readonly bottom: number
}

const numbered = (lines: ReadonlyArray<string>): Numbered[] => {
  let old = 0
  let now = 0
  return lines.map((l) => ({
    mark: l[0] ?? ' ',
    text: l.slice(1),
    old: l[0] === '+' ? null : ++old,
    now: l[0] === '-' ? null : ++now,
  }))
}

// The header of a part, as GitHub writes it: where it starts and how long it is in each text.
const hunkHeader = (part: Numbered[]): string => {
  const old = part.filter((l) => l.old !== null)
  const now = part.filter((l) => l.now !== null)
  return `@@ -${old[0]?.old ?? 0},${old.length} +${now[0]?.now ?? 0},${now.length} @@`
}

const row = (l: Numbered): VNode =>
  html`<div class=${`dl${l.mark === '+' ? ' add' : l.mark === '-' ? ' del' : ''}`}>
    <span class="n">${l.old ?? ''}</span><span class="n">${l.now ?? ''}</span><span
      class="m">${l.mark === ' ' ? '' : l.mark}</span><span class="t">${l.text || ' '}</span></div>`

export function Change({ change }: { change: DraftChange }) {
  const lines = numbered(change.lines)
  // The start of a run -> how much of it the person opened.
  const [opened, setOpened] = useState<Map<number, Opened>>(() => new Map())
  const near = lines.map((_, i) =>
    lines.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((l) => l.mark !== ' '),
  )
  // The runs of lines far from a change; a run of 3 lines or fewer is never hidden.
  const runs: Run[] = []
  for (let i = 0; i < lines.length; ) {
    if (near[i]) {
      i++
      continue
    }
    let end = i
    while (end < lines.length && !near[end]) end++
    if (end - i > CONTEXT) runs.push({ start: i, end, top: 0, bottom: 0, ...opened.get(i) })
    i = end
  }
  const hiddenBy = (i: number) => (r: Run) => i >= r.start + r.top && i < r.end - r.bottom
  const visible = lines.map((_, i) => !runs.some(hiddenBy(i)))
  const rows: VNode[] = []
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]
    if (visible[i] && line) {
      rows.push(row(line))
      i++
      continue
    }
    const run = runs.find((r) => i >= r.start && i < r.end)
    if (!run) {
      i++
      continue
    }
    let end = i
    while (end < lines.length && !visible[end]) end++
    let partEnd = end
    while (partEnd < lines.length && visible[partEnd]) partEnd++
    const hidden = end - i
    const open = (top: number, bottom: number) =>
      setOpened(new Map(opened).set(run.start, { top, bottom }))
    const buttons =
      hidden <= STEP
        ? html`<button aria-label=${`Show ${hidden} hidden lines`}
          onClick=${() => open(run.end - run.start, 0)}>↕</button>`
        : html`${i > 0 ? html`<button aria-label="Show 20 lines below"
          onClick=${() => open(run.top + STEP, run.bottom)}>↓</button>` : ''}
          ${end < lines.length ? html`<button aria-label="Show 20 lines above"
            onClick=${() => open(run.top, run.bottom + STEP)}>↑</button>` : ''}`
    const label =
      partEnd > end ? hunkHeader(lines.slice(end, partEnd)) : `${hidden} unchanged lines`
    rows.push(html`<div class="dl hunk"><span class="x">${buttons}</span>
      <span class="t">${label}</span></div>`)
    i = end
  }
  return html`<div class="change">
    <div class="change-title">${change.direction}</div>
    <div class="dlines">${rows}</div>
  </div>`
}
