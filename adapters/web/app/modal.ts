// A modal window: a click on the back or Escape closes it.
import type { ComponentChildren } from 'preact'
import { html } from 'htm/preact'
import { useEffect } from 'preact/hooks'
import { ICONS, icon } from './icons.ts'

interface ModalProps {
  readonly title: string
  readonly kind?: string
  readonly onClose: () => void
  readonly children: ComponentChildren
}
export function Modal({ title, kind = '', onClose, children }: ModalProps) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  const back = (e: Event) => e.target === e.currentTarget && onClose()
  return html`<div class="modal-back" onClick=${back}>
    <div class=${`modal ${kind}`} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="modal-top"><h2>${title}</h2>
        <button class="icon-button" aria-label="Close"
          onClick=${onClose}>${icon(ICONS.close)}</button></div>
      ${children}
    </div>
  </div>`
}
