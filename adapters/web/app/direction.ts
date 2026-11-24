// A direction as the person reviews it (Nanda, 2026-11-15): its summary, its flow with the steps
// that it governs marked, what its words changed (the last draft against this one, or the version
// before against this one), and the cases of its rules (pass 3b), each sample with the real code
// around it or the host's words. The gear's directions entry and the onboarding pages show it.
import { html } from 'htm/preact'
import type { DirectionCard } from '../contract.ts'
import { Change } from './change.ts'
import { FlowDiagram } from './flow.ts'

// The words of a draft or of a version: a card in any state but the first loading has them.
type Draft = Extract<typeof DirectionCard.Type, { readonly draft: unknown }>['draft']
type ExampleData = NonNullable<Draft['standards'][number]['rules'][number]['examples']>[number]
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
export function ExampleBlock({ e, label }: { e: ExampleData; label?: string }) {
  const fit = e.fit.toLowerCase()
  return html`<li class=${`example ${fit}`}>
    <span class=${label ? 'review-case-label' : `fit-tag ${fit}`}>${label ?? e.fit}${
      'written' in e.output ? label ? ' (made up)' : ' (illustrative)' : ''}</span>
    ${label ? html`<div class="review-case-box">${e.input ? sampleOf('Input', e.input) : ''}
      ${sampleOf('Output', e.output)}</div>` : html`${e.input ? sampleOf('Input', e.input) : ''}
      ${sampleOf('Output', e.output)}`}
  </li>`
}


// The direction for its review, in its order: the summary, the flow with its marks, the change of
// the words (each standard and each rule with its checker inside it), then the examples.
export function DirectionReview({ id, draft }: { id: string; draft: Draft }) {
  return html`<div class="direction-review">
    <p class="direction-summary">${draft.summary}</p>
    <${FlowDiagram} id=${id} flow=${draft.flow} />
    ${draft.discovery && html`<details><summary>Sources and scope</summary>
      <p>Searched: ${draft.discovery.scope.searched.join(', ')}</p>
      <p>Unknown: ${draft.discovery.scope.unknown.join(', ')}</p>
      <ul>${draft.discovery.sources.map((spot) => html`<li>${spot.file}:${spot.line} — ${spot.excerpt}</li>`)}</ul>
    </details>`}
    <div class="section-title">The words</div>
    <${Change} change=${draft.diff} />
    ${draft.standards.flatMap((standard) => standard.rules.map((rule) => rule.examples?.length
      ? html`<section class="example-group"><h3>${rule.id}</h3><ul class="examples">
        ${rule.examples.map((e) => html`<${ExampleBlock} e=${e} />`)}</ul></section>` : ''))}
  </div>`
}
