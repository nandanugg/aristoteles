import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import type { DirectionCard, QuestionView } from '../contract.ts'
import { attempt, postOnboarding } from './api.ts'
import { casePairs, ExampleBlock, pairedOutputMarks, SampleBlock } from './direction.ts'
import { FlowDiagram } from './flow.ts'
import { Inline } from './markdown.ts'
import { Modal } from './modal.ts'

export type ReviewDirection = typeof DirectionCard.Type
type Question = typeof QuestionView.Type
type Draft = Extract<ReviewDirection, { draft: unknown }>['draft']
type Rule = Draft['standards'][number]['rules'][number]
type Example = NonNullable<Rule['examples']>[number]
type Sample = Example['output']
type Choice = 'A' | 'B' | { readonly words: string }

export function ReviewInput({ label, action, onSubmit, compact = false }: {
  label: string
  action: string
  compact?: boolean
  onSubmit: (words: string) => Promise<unknown>
}) {
  const [words, setWords] = useState('')
  const [saving, setSaving] = useState(false)
  return html`<form class=${compact ? 'review-input review-input-compact' : 'review-input'} onSubmit=${async (event: Event) => {
    event.preventDefault()
    if (!words.trim() || saving) return
    setSaving(true)
    try { await onSubmit(words.trim()) } finally { setSaving(false) }
  }}>
    <label class="field">${compact ? '' : html`<span>${label}</span>`}
      <textarea rows="2" aria-label=${compact ? label : undefined} placeholder=${compact ? label : undefined} value=${words}
        onInput=${(e: Event) => setWords((e.currentTarget as HTMLTextAreaElement).value)} /></label>
    <button class="btn primary" disabled=${saving || !words.trim()}>${action}</button>
  </form>`
}

export const directionLabel = (card: ReviewDirection) => {
  if (card.state === 'loading') {
    return card.why === 'answered' ? 'Re-verifying' : card.why === 'revise' ? 'Revising' : 'Assessing'
  }
  if (card.state === 'question') return card.open.some((q) => q.rule) ? 'Conflict' : 'Question'
  return card.state === 'removed' ? 'Removed' : card.state === 'ready' ? 'Ready' : 'Accepted'
}

function QuestionOptions({ q, chosen, choose, ownWords, onWords, sendWords, single, saving }: {
  q: Question
  chosen?: Choice | undefined
  choose: (choice: 'A' | 'B') => void
  ownWords: string
  onWords: (words: string) => void
  sendWords: () => void
  single: boolean
  saving: boolean
}) {
  return html`<fieldset class="review-question">
    <legend><${Inline} text=${q.says} /></legend>
    ${q.sides ? html`<div class="review-case-list">${[q.sides, ...(q.caseSides ?? [])].map((sides) =>
      html`<div class="review-pair">${sides.map((side, i) => html`
        <div class="review-case"><strong class="review-case-label">${q.rule
          ? (i ? 'Principle side' : 'Code side') : 'Source ' + (i + 1)}</strong>
          <div class="review-case-box review-evidence"><code>${side.source}</code><pre>${side.words}</pre></div>
        </div>`)}</div>`)}</div>`
      : q.example ? html`<ul class="examples"><${ExampleBlock} e=${q.example} /></ul>` : ''}
    <div class="review-options">
      ${(['A', 'B'] as const).map((choice, i) => html`<button type="button" class="review-option"
        aria-pressed=${choice === chosen} disabled=${saving} onClick=${() => choose(choice)}>
        <strong>Option ${choice}${q.rule ? (i ? ' · Keep the principle' : ' · Accept the code') : ''}</strong>
        <span>${q.options[i]}</span>
      </button>`)}
      <div class="review-own-words" data-recorded=${typeof chosen === 'object'}>
        <textarea rows="2" aria-label="Answer in your own words" placeholder="Answer in your own words"
          value=${ownWords} disabled=${saving} onInput=${(event: Event) => onWords((event.currentTarget as HTMLTextAreaElement).value)} />
        <button type="button" class="btn primary" aria-label=${single ? 'Submit own words' : 'Record own words'}
          aria-pressed=${single ? undefined : typeof chosen === 'object'} disabled=${saving || !ownWords.trim()}
          onClick=${sendWords}><span aria-hidden="true">→</span></button>
      </div>
      ${!single && typeof chosen === 'object' ? html`<p class="review-answer-recorded" role="status">Answer recorded</p>` : ''}
    </div>
  </fieldset>`
}

function RuleCheck({ rule }: { rule: Rule }) {
  const checkerPrefix = rule.checkedBy ? `${rule.checkedBy}: ` : ''
  const promptResult = checkerPrefix && rule.result?.startsWith(checkerPrefix)
    ? rule.result.slice(checkerPrefix.length) : rule.result
  return html`<div class="rule-check">
    ${rule.test ? html`<strong>Test command</strong><code>${rule.test}</code>
      <span>${rule.result ?? 'Result unknown'}</span>`
      : rule.ref || rule.checkedBy ? html`<strong>Check prompt</strong>
        ${rule.checkPrompt ? html`<pre>${rule.checkPrompt}</pre>` : rule.ref ? html`<code>${rule.ref}</code>` : ''}
        ${rule.checkedBy ? html`<span>Checker · ${rule.checkedBy}</span>` : ''}
        ${promptResult ? html`<span>${promptResult}</span>` : ''}
        ${!rule.ref && !promptResult ? html`<span>Check unknown</span>` : ''}
        ${!rule.checkedBy && !promptResult ? html`<span>Checker unknown</span>` : ''}`
        : html`<strong>${rule.result === 'Check absent' ? 'Check absent' : 'Check unknown'}</strong>
          ${rule.result && rule.result !== 'Check absent' ? html`<span>${rule.result}</span>` : ''}`}
  </div>`
}

const sameInput = (a: Sample, b: Sample) => 'file' in a
  ? 'file' in b && a.file === b.file && a.line === b.line
  : 'written' in b && a.written === b.written

function CasePair({ pass, fail }: { pass: Example | undefined; fail: Example | undefined }) {
  const passInput = pass?.input
  const failInput = fail?.input
  const input = passInput ?? failInput
  const { passMarks, failMarks } = pairedOutputMarks(pass?.output, fail?.output)
  return html`<div class="review-rule-case-pair">
    ${passInput && failInput && !sameInput(passInput, failInput) ? html`
      <div class="review-case-input">
        <strong class="review-case-label">Input</strong>
        <div class="review-case-columns">
          <div class="review-case-box"><${SampleBlock} name="For passing output" sample=${passInput} /></div>
          <div class="review-case-box"><${SampleBlock} name="For failing output" sample=${failInput} /></div>
        </div>
      </div>` : input ? html`
      <div class="review-case-input review-case-box"><${SampleBlock} name="Input" sample=${input} /></div>` : ''}
    <div class="review-case-columns review-case-outputs">
      ${pass ? html`<div class="review-case-box"><${SampleBlock} name="Output that passes" sample=${pass.output}
        writtenLabel="made up" fit=${pass.fit} diffMarks=${passMarks} /></div>` : ''}
      ${fail ? html`<div class="review-case-box"><${SampleBlock} name="Output that fails" sample=${fail.output}
        writtenLabel="made up" fit=${fail.fit} diffMarks=${failMarks} /></div>` : ''}
    </div>
  </div>`
}

function RuleEvidence({ rule, paired, conflict }: { rule: Rule; paired: boolean; conflict: boolean }) {
  const examples = rule.examples ?? []
  const observedBreak = examples.some((example) => example.fit === 'Breaks' && 'file' in example.output)
  return html`<div class="rule-evidence">
    ${rule.knownBreak ? html`<span class="chip review-state" data-state="Conflict">Known break</span>` : ''}
    ${!conflict && rule.searched?.length && !observedBreak && !rule.knownBreak
      ? html`<p class="muted">No break observed in ${rule.searched.join(', ')}.</p>` : ''}
    ${paired && examples.length ? html`<div class="review-case-list">
      ${casePairs(examples).map(({ pass, fail }) => html`<${CasePair} pass=${pass} fail=${fail} />`)}
    </div>` : ''}
  </div>`
}

export function DirectionModal({ card, onClose, readOnly = false }: {
  card: ReviewDirection
  onClose: () => void
  readOnly?: boolean
}) {
  const [choices, setChoices] = useState<Readonly<Record<number, Choice | undefined>>>({})
  const [wordDrafts, setWordDrafts] = useState<Readonly<Record<number, string>>>({})
  const [saving, setSaving] = useState(false)
  const questions = card.state === 'question' ? card.open : []
  const draft = 'draft' in card ? card.draft : undefined
  const answering = !readOnly && questions.length > 0
  const single = questions.length === 1
  const Content = answering ? 'form' : 'div'
  const revise = attempt(async (words: string) => {
    const answer = await postOnboarding({ act: 'revise', direction: card.id, words })
    onClose()
    return answer
  })
  const submit = attempt(async (answers: Readonly<Record<number, Choice | undefined>> = choices) => {
    if (saving || !questions.length || questions.some((_, i) => !answers[i])) return
    const options = questions.map((_, i) => answers[i]!)
    const first = options[0]!
    setSaving(true)
    try {
      const answer = await postOnboarding({ act: 'answer', direction: card.id, options: [first, ...options.slice(1)], ...(card.revision && { revision: card.revision }) })
      onClose()
      return answer
    } finally { setSaving(false) }
  })
  const choose = (index: number, value: Choice) => {
    const next = { ...choices, [index]: value }
    setChoices(next)
    if (single) void submit(next)
  }
  const question = (q: Question, index: number) => {
    const choice = choices[index]
    const words = wordDrafts[index] ?? ''
    return html`<div class="review-question-actions">
      <${QuestionOptions} q=${q} chosen=${choice} ownWords=${words} single=${single} saving=${saving}
        choose=${(value: 'A' | 'B') => {
          setWordDrafts((current) => ({ ...current, [index]: '' }))
          choose(index, value)
        }}
        onWords=${(value: string) => {
          setWordDrafts((current) => ({ ...current, [index]: value }))
          if (typeof choice === 'object' && value.trim() !== choice.words) {
            setChoices((current) => ({ ...current, [index]: undefined }))
          }
        }}
        sendWords=${() => { if (words.trim()) choose(index, { words: words.trim() }) }} />
    </div>`
  }
  const ruleIds = new Set(draft?.standards.flatMap((standard) => standard.rules.map((rule) => rule.id)))
  const principles = card.principles?.length ? html`<div class="review-tags">${card.principles.map((name) => html`
    <span class="chip">${name}</span>`)}</div>` : undefined
  return html`<${Modal} title=${card.name} headingAside=${principles}
    kind="onboarding-modal onboarding-direction-modal" onClose=${onClose}>
    <${Content} class="review-detail" aria-label=${answering ? 'Direction answers' : undefined}
      onSubmit=${answering ? (event: Event) => { event.preventDefault(); void submit() } : undefined}>
      ${draft ? html`
        <div class="review-summary">
          <${FlowDiagram} id=${card.id} flow=${draft.flow} showSteps=${false} />
          <p><${Inline} text=${draft.summary} /></p>
          ${draft.says && draft.says !== draft.summary ? html`<p class="review-direction-words"><${Inline} text=${draft.says} /></p>` : ''}
        </div>
        ${draft.standards.map((std) => html`<details class="review-standard"
          open=${questions.some((q) => std.rules.some((r) => r.id === q.rule)) || undefined}>
          <summary><span class="review-standard-copy"><strong>${std.id}</strong>
            <span><${Inline} text=${std.says} /></span></span>
            <span class="review-expand"><span class="review-show">Show rules</span>
              <span class="review-hide">Hide rules</span> <span class="review-chevron" aria-hidden="true">▼</span></span>
          </summary>
          <div class="review-rules">${std.rules.map((rule) => {
            const attached = questions.flatMap((q, i) => q.rule === rule.id ? [{ q, i }] : [])
            const conflict = attached.length > 0
            return html`<section class="review-rule" aria-label=${rule.id}>
              <header class="review-rule-head"><div>
                <h3>${rule.id}${conflict ? html` <span class="chip review-state" data-state="Conflict">Conflict</span>` : ''}</h3>
                <p><${Inline} text=${rule.says} /></p>
              </div><${RuleCheck} rule=${rule} /></header>
              <${RuleEvidence} rule=${rule} conflict=${conflict} paired=${readOnly || !attached.some(({ q }) => q.sides)} />
              ${readOnly ? '' : attached.map(({ q, i }) => question(q, i))}
            </section>`
          })}</div></details>`)}
      ` : html`<p class="muted" role="status">The host is drafting this direction.</p>`}
      ${answering ? html`<div class="review-questions">
        ${questions.map((q, i) => !q.rule || !ruleIds.has(q.rule) ? question(q, i) : '')}
        ${questions.length > 1 ? html`
          <button type="submit" class="btn primary" disabled=${saving || questions.some((_, i) => !choices[i])}>Submit answers</button>` : ''}
      </div>` : !readOnly && draft && card.state !== 'loading'
        ? html`<${ReviewInput} label="What should change?" action="Revise" compact=${true} onSubmit=${revise} />` : ''}
      ${card.state === 'loading' && 'answered' in card && card.answered.length ? html`
        <p class="muted" role="status">Answers received. The host is re-verifying the draft.</p>` : ''}
    <//>
  <//>`
}
