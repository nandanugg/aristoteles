// A direction as the person reviews it (Nanda, 2026-11-15): its summary, its flow with the steps
// that it governs marked, what its words changed (the last draft against this one, or the version
// before against this one), and the cases of its rules (pass 3b), each sample with the real code
// around it or the host's words. The gear's directions entry and the onboarding pages show it.
import { html } from 'htm/preact'
import type { DirectionCard } from '../contract.ts'
import { lineDiff } from '../line-diff.ts'
import { Change } from './change.ts'
import { FlowDiagram } from './flow.ts'

// The words of a draft or of a version: a card in any state but the first loading has them.
type Draft = Extract<typeof DirectionCard.Type, { readonly draft: unknown }>['draft']
type ExampleData = NonNullable<Draft['standards'][number]['rules'][number]['examples']>[number]
type SampleData = ExampleData['output']
type SpotData = Extract<SampleData, { file: string }>
type WrittenData = Extract<SampleData, { written: string }>
type CodeLine = SpotData['around'][number]

const normalizeLines = (text: string) => text.replace(/\r\n/g, '\n')
const withoutFinalNewline = (text: string) => text.replace(/\n$/, '')

export function casePairs(examples: readonly ExampleData[]) {
  const passes = examples.filter((example) => example.fit === 'Follows')
  const fails = examples.filter((example) => example.fit === 'Breaks')
  return Array.from({ length: Math.max(passes.length, fails.length) }, (_, i) => ({ pass: passes[i], fail: fails[i] }))
}

// Count the lines on each side independently as the diff moves through the pair.
export function pairedOutputMarks(pass?: SampleData, fail?: SampleData) {
  const passMarks = new Set<number>()
  const failMarks = new Set<number>()
  const needsDiff = (sample: SampleData) => 'written' in sample && sample.mark === undefined
  if (pass && fail && (needsDiff(pass) || needsDiff(fail))) {
    const textOf = (sample: SampleData) => withoutFinalNewline(normalizeLines(
      'written' in sample ? sample.written : sample.excerpt,
    ))
    let passLine = 1
    let failLine = 1
    for (const line of lineDiff(textOf(pass), textOf(fail))) {
      // A blank line that differs is spacing, not the point of the rule: it gets no mark.
      if (line[0] === '-' && line.slice(1).trim()) passMarks.add(passLine)
      if (line[0] === '+' && line.slice(1).trim()) failMarks.add(failLine)
      if (line[0] !== '+') passLine++
      if (line[0] !== '-') failLine++
    }
  }
  return { passMarks, failMarks }
}

// The excerpt inside its line, marked; a line that does not hold it shows as it is.
const withExcerpt = (text: string, excerpt: string) => {
  const at = excerpt ? text.indexOf(excerpt) : -1
  if (at === -1) return text || ' '
  return html`${text.slice(0, at)}<mark>${excerpt}</mark>${text.slice(at + excerpt.length)}`
}

function NumberedCode({ lines, excerpt = '', written = false }: {
  lines: readonly CodeLine[]; excerpt?: string; written?: boolean
}) {
  return html`<pre class=${written ? 'sample-code written' : 'sample-code'}>${lines.map((line) => html`
    <span class=${line.mark ? 'line mark' : 'line'}><span class="ln">${line.line}</span><span
      class="t">${line.mark ? withExcerpt(line.text, excerpt) : line.text || ' '}</span></span>`)}</pre>`
}

// A stale place shows its recorded excerpt and the current context without marks.
function SpotCode({ s }: { s: SpotData }) {
  const excerpt = s.excerpt.trim()
  if (s.current && s.around.length) return html`<${NumberedCode} lines=${s.around} excerpt=${excerpt} />`
  const lines = normalizeLines(excerpt).split('\n').map((text, index) => ({ line: s.line + index, text, mark: true }))
  return html`<${NumberedCode} lines=${lines} />
    ${s.around.length ? html`<div class="muted">The file now, at line ${s.line}:</div>
      <${NumberedCode} lines=${s.around.map((line) => ({ ...line, mark: false }))} />` : ''}`
}

function WrittenCode({ sample, diffMarks }: { sample: WrittenData; diffMarks?: ReadonlySet<number> }) {
  const text = normalizeLines(sample.written)
  const excerpt = sample.mark === undefined ? undefined : normalizeLines(sample.mark)
  let match = excerpt ? text.indexOf(excerpt) : -1
  let start = 0
  const lines = withoutFinalNewline(text).split('\n').map((textLine, index) => {
    const line = index + 1
    const next = start + textLine.length + 1
    if (excerpt) {
      while (match !== -1 && match + excerpt.length <= start) match = text.indexOf(excerpt, match + 1)
    }
    const mark = excerpt ? match !== -1 && match < next : diffMarks?.has(line) ?? false
    start = next
    return { line, text: textLine, mark }
  })
  return html`<${NumberedCode} lines=${lines} written />`
}

// One sample: a real place with its code, or the host's words, labeled so.
export function SampleBlock({ name, sample, writtenLabel = 'written by the host', fit, diffMarks }: {
  name: string; sample: SampleData; writtenLabel?: string; fit?: ExampleData['fit']; diffMarks?: ReadonlySet<number>
}) {
  return html`<div class=${fit ? `sample ${fit.toLowerCase()}` : 'sample'}>
    <div class="sample-head"><span class="sample-name">${name}</span>${'file' in sample
      ? html`<code class="where">${sample.file}:${sample.line}</code>${sample.current ? ''
        : html`<span class="stale">Stale: the excerpt is not in the file now</span>`}`
      : html`<span class="written-tag">${writtenLabel}</span>`}</div>
    ${'file' in sample ? html`<${SpotCode} s=${sample} />` : html`<${WrittenCode} sample=${sample} diffMarks=${diffMarks} />`}
  </div>`
}

// One example: its fit, the input of a step that checks or decides, and the output.
export function ExampleBlock({ e, diffMarks }: { e: ExampleData; diffMarks?: ReadonlySet<number> }) {
  const fit = e.fit.toLowerCase()
  return html`<li class=${`example ${fit}`}>
    <span class=${`fit-tag ${fit}`}>${e.fit}${'written' in e.output ? ' (illustrative)' : ''}</span>
    ${e.input ? html`<${SampleBlock} name="Input" sample=${e.input} />` : ''}
    <${SampleBlock} name="Output" sample=${e.output} fit=${e.fit} diffMarks=${diffMarks} />
  </li>`
}

function RuleExamples({ id, examples }: { id: string; examples: readonly ExampleData[] }) {
  const marks = new Map<ExampleData, ReadonlySet<number>>()
  for (const { pass, fail } of casePairs(examples)) {
    if (!pass || !fail) continue
    const { passMarks, failMarks } = pairedOutputMarks(pass.output, fail.output)
    marks.set(pass, passMarks)
    marks.set(fail, failMarks)
  }
  return html`<section class="example-group"><h3>${id}</h3><ul class="examples">
    ${examples.map((e) => html`<${ExampleBlock} e=${e} diffMarks=${marks.get(e)} />`)}
  </ul></section>`
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
      ? html`<${RuleExamples} id=${rule.id} examples=${rule.examples} />` : ''))}
  </div>`
}
