import { html } from 'htm/preact'
import { useState } from 'preact/hooks'
import type { DirectionCard, QuestionView } from '../contract.ts'
import { attempt, postOnboarding } from './api.ts'
import { ExampleBlock } from './direction.ts'
import { FlowDiagram } from './flow.ts'
import { Inline } from './markdown.ts'
import { Modal } from './modal.ts'

export type ReviewDirection = typeof DirectionCard.Type
type Question = typeof QuestionView.Type
type Draft = Extract<ReviewDirection, { draft: unknown }>['draft']
type Rule = Draft['standards'][number]['rules'][number]
type Choice = 'A' | 'B' | { readonly words: string }

export function ReviewInput({ label, action, onSubmit }: {
  label: string
  action: string
  onSubmit: (words: string) => Promise<unknown>
}) {
  const [words, setWords] = useState('')
  const [saving, setSaving] = useState(false)
  return html`<form class="review-input" onSubmit=${async (event: Event) => {
    event.preventDefault()
    if (!words.trim() || saving) return
    setSaving(true)
    try { await onSubmit(words.trim()) } finally { setSaving(false) }
  }}>
    <label class="field"><span>${label}</span>
      <textarea rows="2" value=${words}
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

function QuestionOptions({ q, index, chosen, select }: {
  q: Question
  index: number
  chosen?: Choice | undefined
  select: (n: number, choice: Choice) => void
}) {
  return html`<fieldset class="review-question">
    <legend><${Inline} text=${q.says} /></legend>
    ${q.sides ? [q.sides, ...(q.caseSides ?? [])].map((sides) =>
      html`<div class="review-pair">${sides.map((side, i) => html`
        <div class="review-evidence"><strong>${q.rule ? (i ? 'Principle side' : 'Code side') : 'Source ' + (i + 1)}</strong>
          <code>${side.source}</code><pre>${side.words}</pre></div>`)}</div>`)
      : q.example ? html`<ul class="examples"><${ExampleBlock} e=${q.example} /></ul>` : ''}
    ${(['A', 'B'] as const).map((choice, i) => html`<label class="review-option">
      <input type="radio" name=${`direction-question-${index}`} checked=${choice === chosen}
        onChange=${() => select(index, choice)} />
      <span><strong>${choice}${q.rule ? (i ? ' · Keep the principle' : ' · Accept the code') : ''}</strong>
        <span>${q.options[i]}</span></span>
    </label>`)}
  </fieldset>`
}

function RuleEvidence({ rule, examples }: { rule: Rule; examples: NonNullable<Rule['examples']> }) {
  const valid = examples.filter((example) => example.fit === 'Follows')
  const invalid = examples.filter((example) => example.fit === 'Breaks')
  return html`<div class="rule-evidence">
    ${rule.test ? html`<p><strong>Test command </strong><code>${rule.test}</code>
      <span class="muted"> · ${rule.result ?? 'Result unknown'}</span></p>`
      : rule.ref ? html`<p><strong>Reference </strong><code>${rule.ref}</code>
        <span class="muted"> · ${rule.result ?? rule.checkedBy ?? 'Checker unknown'}</span></p>`
        : html`<p class="muted">${rule.checkedBy ? `Checker: ${rule.checkedBy}. ` : ''}${rule.result ?? 'Check unknown.'}</p>`}
    ${rule.knownBreak ? html`<span class="chip review-state" data-state="Conflict">Known break</span>` : ''}
    ${rule.searched?.length && !invalid.some((item) => 'file' in item.output) && !rule.knownBreak
      ? html`<p class="muted">No break observed in ${rule.searched.join(', ')}.</p>` : ''}
    ${Array.from({ length: Math.max(valid.length, invalid.length) }, (_, i) => html`
      <ul class="examples review-pair">
        ${valid[i] ? html`<${ExampleBlock} e=${valid[i]} />` : ''}
        ${invalid[i] ? html`<${ExampleBlock} e=${invalid[i]} />` : ''}
      </ul>`)}
  </div>`
}

export function DirectionModal({ card, onClose, readOnly = false }: {
  card: ReviewDirection
  onClose: () => void
  readOnly?: boolean
}) {
  const [choices, setChoices] = useState<Readonly<Record<number, Choice | undefined>>>({})
  const [saving, setSaving] = useState(false)
  const questions = card.state === 'question' ? card.open : []
  const draft = 'draft' in card ? card.draft : undefined
  const answering = !readOnly && questions.length > 0
  const Content = answering ? 'form' : 'div'
  const revise = attempt(async (words: string) => {
    const answer = await postOnboarding({ act: 'revise', direction: card.id, words })
    onClose()
    return answer
  })
  const submit = attempt(async () => {
    if (saving || !questions.length || questions.some((_, i) => !choices[i])) return
    const options = questions.map((_, i) => choices[i]!)
    const first = options[0]!
    setSaving(true)
    try {
      const answer = await postOnboarding({ act: 'answer', direction: card.id, options: [first, ...options.slice(1)], ...(card.revision && { revision: card.revision }) })
      onClose()
      return answer
    } finally { setSaving(false) }
  })
  const question = (q: Question, index: number) => html`<div class="review-question-actions">
    <${QuestionOptions} q=${q} index=${index}
      chosen=${choices[index]} select=${(n: number, value: Choice) => setChoices((c) => ({ ...c, [n]: value }))} />
    <label class="field"><span>Answer in your own words</span>
      <textarea rows="2" value=${(choices[index] as { words?: string } | undefined)?.words ?? ''}
        onInput=${(event: Event) => {
          const words = (event.currentTarget as HTMLTextAreaElement).value
          setChoices((current) => ({ ...current, [index]: words.trim() ? { words } : undefined }))
        }} /></label>
  </div>`
  const ruleIds = new Set(draft?.standards.flatMap((standard) => standard.rules.map((rule) => rule.id)))
  return html`<${Modal} title=${card.name} kind="wide onboarding-modal" onClose=${onClose}>
    <${Content} class="review-detail" aria-label=${answering ? 'Direction answers' : undefined}
      onSubmit=${answering ? (event: Event) => { event.preventDefault(); void submit() } : undefined}>
      ${card.principles?.length ? html`<div class="review-tags">${card.principles.map((name) => html`
        <span class="chip">${name}</span>`)}</div>` : ''}
      ${draft ? html`
        <div class="review-summary">
          <p><${Inline} text=${draft.summary} /></p>
          <${FlowDiagram} id=${card.id} flow=${draft.flow} />
        </div>
        ${draft.says && draft.says !== draft.summary ? html`<p><${Inline} text=${draft.says} /></p>` : ''}
        ${draft.standards.map((std) => html`<details class="review-standard"
          open=${questions.some((q) => std.rules.some((r) => r.id === q.rule)) || undefined}>
          <summary><strong>${std.id}</strong><span><${Inline} text=${std.says} /></span>
            <span class="review-expand">Rules</span></summary>
          <div class="review-rules">${std.rules.map((rule) => {
            const examples = rule.examples ?? []
            return html`<section class="review-rule">
              <h3>${rule.id}</h3><p><${Inline} text=${rule.says} /></p>
              <${RuleEvidence} rule=${rule} examples=${examples} />
              ${readOnly ? '' : questions.map((q, i) => q.rule === rule.id ? question(q, i) : '')}
            </section>`
          })}</div></details>`)}
      ` : html`<p class="muted" role="status">The host is drafting this direction.</p>`}
      ${answering ? html`<div class="review-questions">
        ${questions.map((q, i) => !q.rule || !ruleIds.has(q.rule) ? question(q, i) : '')}
        <button type="submit" class="btn primary" disabled=${saving || questions.some((_, i) => !choices[i])}>Submit answers</button>
      </div>` : !readOnly && draft && card.state !== 'loading'
        ? html`<${ReviewInput} label="What should change?" action="Revise" onSubmit=${revise} />` : ''}
      ${card.state === 'loading' && 'answered' in card && card.answered.length ? html`
        <p class="muted" role="status">Answers received. The host is re-verifying the draft.</p>` : ''}
    <//>
  <//>`
}
