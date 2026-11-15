// A direction as the person reviews it (Nanda, 2026-11-15): each level has its label (the
// direction, each standard, each rule with the role that checks it), the words show as markdown,
// and each case shows as a ladder from the direction down to its output, each place with the real
// code around it. The directions page and the gear's directions entry show it.
import { html } from 'htm/preact'
import type { DirectionCard } from '../contract.ts'
import { Markdown } from './markdown.ts'

type Card = typeof DirectionCard.Type
type CaseData = Card['cases'][number]
type SpotData = CaseData['output']

// The excerpt inside its line, marked; a line that does not hold it shows as it is.
const withExcerpt = (text: string, excerpt: string) => {
  const at = excerpt ? text.indexOf(excerpt) : -1
  if (at === -1) return text || ' '
  return html`${text.slice(0, at)}<mark>${excerpt}</mark>${text.slice(at + excerpt.length)}`
}

// The code of one place. A current place shows the lines around it with its own lines marked; a
// stale place shows its excerpt, and the lines that are at its place now.
function SpotCode({ s }: { s: SpotData }) {
  const excerpt = s.excerpt.trim()
  const lines = s.around.map((l) => html`<div class=${s.current && l.mark ? 'line mark' : 'line'}>
    <span class="ln">${l.line}</span><span class="t">${
      s.current && l.mark ? withExcerpt(l.text, excerpt) : l.text || ' '}</span></div>`)
  if (s.current && lines.length) return html`<pre class="case-code">${lines}</pre>`
  return html`<pre class="case-code"><div class="line mark"><span class="ln">${s.line}</span><span
    class="t">${excerpt}</span></div></pre>
    ${lines.length ? html`<div class="muted">The file now, at line ${s.line}:</div>
      <pre class="case-code">${lines}</pre>` : ''}`
}

// One place of the ladder: its tag, where it is, and its code.
const rungOf = (tag: unknown, s: SpotData, kind: string) => html`<li class=${`rung ${kind}`}>
  <div class="rung-head">${tag}<code class="where">${s.file}:${s.line}</code>
    ${s.current ? '' : html`<span class="stale">Stale: the excerpt is not in the file now</span>`}
  </div>
  <${SpotCode} s=${s} />
</li>`

// One case as a small vertical ladder (Nanda, 2026-11-15): the direction at the top, each named
// rung with its code, and the output at the bottom in the color of its fit.
export function CaseBlock({ c }: { c: CaseData }) {
  const fit = c.fit.toLowerCase()
  return html`<li class=${`case ${fit}`}>
    <ol class="ladder" aria-label=${`${c.fit}: a ladder of ${c.via.length + 1} steps`}>
      <li class="rung top"><span class="ladder-top">Direction</span></li>
      ${c.via.map((r) => rungOf(html`<span class="rung-name">${r.name}</span>`, r, 'via'))}
      ${rungOf(html`<span class=${`fit-tag ${fit}`}>Output · ${c.fit}</span>`, c.output,
        `output ${fit}`)}
    </ol>
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
