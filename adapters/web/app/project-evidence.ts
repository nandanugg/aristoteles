import { html } from 'htm/preact'
import type { Evidence, Of } from '../../../core/schema/project.ts'

export function ReviewEvidence({ evidence }: { readonly evidence: Of<typeof Evidence> }) {
  return evidence._tag === 'Quote'
    ? html`<blockquote>${evidence.text}<footer>${evidence.file} · ${evidence.lines.first}–${evidence.lines.last}</footer></blockquote>`
    : html`<p>${evidence.command.text} · exit ${evidence.exit}</p>
      <pre>${evidence.stdout}</pre>${evidence.stderr ? html`<pre>${evidence.stderr}</pre>` : null}`
}
