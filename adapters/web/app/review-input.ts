import { html } from 'htm/preact'
import { useState } from 'preact/hooks'

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
