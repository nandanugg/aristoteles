// A direction as the person reviews it (Nanda, 2026-11-15): each level has its label (the
// direction, each standard, each rule with the role that checks it), the words show as markdown,
// and each case shows the real code around it. The directions page and the gear's directions
// entry show it.
import { html } from 'htm/preact'
import type { DirectionCard } from '../contract.ts'
import { Markdown } from './markdown.ts'

type Card = typeof DirectionCard.Type
type CaseData = Card['cases'][number]

// The excerpt inside its line, marked; a line that does not hold it shows as it is.
const withExcerpt = (text: string, excerpt: string) => {
  const at = excerpt ? text.indexOf(excerpt) : -1
  if (at === -1) return text || ' '
  return html`${text.slice(0, at)}<mark>${excerpt}</mark>${text.slice(at + excerpt.length)}`
}

// One case: Follows or Breaks in its color, the place, and the code. A current case shows the
// lines around it with its own lines marked; a stale case shows its excerpt, and the lines that
// are at its place now.
export function CaseBlock({ c }: { c: CaseData }) {
  const fit = c.fit.toLowerCase()
  const excerpt = c.excerpt.trim()
  const lines = c.around.map((l) => html`<div class=${c.current && l.mark ? 'line mark' : 'line'}>
    <span class="ln">${l.line}</span><span class="t">${
      c.current && l.mark ? withExcerpt(l.text, excerpt) : l.text || ' '}</span></div>`)
  return html`<li class=${`case ${fit}`}>
    <div class="case-head"><span class=${`fit-tag ${fit}`}>${c.fit}</span>
      <code class="where">${c.file}:${c.line}</code>
      ${c.current ? '' : html`<span class="stale">Stale: the excerpt is not in the file now</span>`}
    </div>
    ${c.current && lines.length ? html`<pre class="case-code">${lines}</pre>`
      : html`<pre class="case-code"><div class="line mark"><span class="ln">${c.line}</span><span
        class="t">${excerpt}</span></div></pre>
        ${lines.length ? html`<div class="muted">The file now, at line ${c.line}:</div>
          <pre class="case-code">${lines}</pre>` : ''}`}
  </li>`
}

export function Cases({ cases }: { cases: ReadonlyArray<CaseData> }) {
  if (!cases.length) return null
  return html`<div class="section-title">Cases (${cases.length})</div>
    <ul class="cases">${cases.map((c) => html`<${CaseBlock} c=${c} />`)}</ul>`
}

// The words of a direction, by level: the direction, then each standard with its rules inside.
// The panel of a task shows its directions with it too.
type Words = Pick<Card, 'says' | 'standards'>
export function DirectionText({ card }: { card: Words }) {
  return html`<div class="direction-text">
    ${card.says ? html`<section class="level level-direction" aria-label="Direction">
      <div class="level-head"><span class="level-tag direction">Direction</span></div>
      <${Markdown} text=${card.says} />
    </section>` : ''}
    ${card.standards.map((s) => html`<section class="level level-standard"
      aria-label=${`Standard ${s.id}`}>
      <div class="level-head"><span class="level-tag standard">Standard</span>
        <code>${s.id}</code></div>
      <${Markdown} text=${s.says} />
      ${s.rules.map((r) => html`<section class="level level-rule" aria-label=${`Rule ${r.id}`}>
        <div class="level-head"><span class="level-tag rule">Rule</span><code>${r.id}</code>
          <span class="checker">${r.checkedBy ? html`checked by <strong>${r.checkedBy}</strong>`
            : 'checked by the decider of the result'}</span></div>
        <${Markdown} text=${r.says} />
      </section>`)}
    </section>`)}
  </div>`
}
