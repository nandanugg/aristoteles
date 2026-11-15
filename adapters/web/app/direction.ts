// A direction as the person reviews it (Nanda, 2026-11-15): its summary, its flow with the steps
// that it governs marked, what its words changed (the last draft against this one, or the version
// before against this one), and its examples by marked step, each sample with the real code
// around it or the host's words. The directions page and the gear's directions entry show it; the
// panel of a task shows the words by level (DirectionText).
import { html } from 'htm/preact'
import type { DirectionCard } from '../contract.ts'
import { Change } from './change.ts'
import { FlowDiagram, whoOf } from './flow.ts'
import { Markdown } from './markdown.ts'

type Card = typeof DirectionCard.Type
type ExampleData = Card['flow'][number]['examples'][number]
type SampleData = ExampleData['output']
type SpotData = Extract<SampleData, { file: string }>

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
  if (s.current && lines.length) return html`<pre class="sample-code">${lines}</pre>`
  return html`<pre class="sample-code"><div class="line mark"><span class="ln">${s.line}</span><span
    class="t">${excerpt}</span></div></pre>
    ${lines.length ? html`<div class="muted">The file now, at line ${s.line}:</div>
      <pre class="sample-code">${lines}</pre>` : ''}`
}

// One sample: a real place with its code, or the host's words, labeled so.
const sampleOf = (name: string, s: SampleData) => html`<div class="sample">
  <div class="sample-head"><span class="sample-name">${name}</span>${'file' in s
    ? html`<code class="where">${s.file}:${s.line}</code>${s.current ? ''
      : html`<span class="stale">Stale: the excerpt is not in the file now</span>`}`
    : html`<span class="written-tag">written by the host</span>`}</div>
  ${'file' in s ? html`<${SpotCode} s=${s} />` : html`<pre class="written">${s.written}</pre>`}
</div>`

// One example: its fit, the input of a step that checks or decides, and the output.
export function ExampleBlock({ e }: { e: ExampleData }) {
  const fit = e.fit.toLowerCase()
  return html`<li class=${`example ${fit}`}>
    <span class=${`fit-tag ${fit}`}>${e.fit}</span>
    ${e.input ? sampleOf('Input', e.input) : ''}
    ${sampleOf('Output', e.output)}
  </li>`
}

// The examples by marked step, in the order of the flow.
export function Examples({ card }: { card: Pick<Card, 'flow'> }) {
  const groups = card.flow
    .map((s, i) => ({ head: `Step ${i + 1} · ${whoOf(s)}`, of: s.examples }))
    .filter((g) => g.of.length)
  const count = groups.reduce((sum, g) => sum + g.of.length, 0)
  if (!count) return null
  return html`<div class="section-title">Examples (${count})</div>
    ${groups.map((g) => html`<section class="example-group" aria-label=${g.head}>
      <h3 class="example-step">${g.head}</h3>
      <ul class="examples">${g.of.map((e) => html`<${ExampleBlock} e=${e} />`)}</ul>
    </section>`)}`
}

// The direction for its review, in its order: the summary, the flow with its marks, the change of
// the words (each standard and each rule with its checker inside it), then the examples.
export function DirectionReview({ card }: { card: Card }) {
  return html`<div class="direction-review">
    ${card.summary ? html`<p class="direction-summary">${card.summary}</p>` : ''}
    <${FlowDiagram} id=${card.id} flow=${card.flow} />
    ${card.diff ? html`<div class="section-title">The words</div>
      <${Change} change=${card.diff} />` : ''}
    <${Examples} card=${card} />
  </div>`
}

// The words of a direction, by level: the direction, then each standard with its rules inside.
// The summary comes first, then the flow as a sequence diagram, then the words (Nanda,
// 2026-11-15). The panel of a task shows its directions with it.
type Words = Pick<Card, 'id' | 'summary' | 'flow' | 'says' | 'standards'>
export function DirectionText({ card }: { card: Words }) {
  return html`<div class="direction-text">
    ${card.says ? html`<section class="level level-direction" aria-label="Direction">
      <div class="level-head"><span class="level-tag direction">Direction</span></div>
      ${card.summary ? html`<p class="direction-summary">${card.summary}</p>` : ''}
      <${FlowDiagram} id=${card.id} flow=${card.flow} />
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
