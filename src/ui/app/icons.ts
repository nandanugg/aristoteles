// The inline stroke icons of the page.
import type { VNode } from 'preact'
import { html } from 'htm/preact'

export const icon = (paths: VNode, size = 16): VNode =>
  html`<svg aria-hidden="true" width=${size} height=${size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round"
    stroke-linejoin="round">${paths}</svg>`

// A long path of an icon, in parts of one line each.
const d = (...parts: string[]): string => parts.join('')

export const ICONS = {
  sol: html`
    <circle cx="12" cy="12" r="4"></circle>
    <path
      d=${d(
        'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 ',
        '17.7l-1.4 1.4M19.1 4.9l-1.4 1.4',
      )}
    ></path>
  `,
  terra: html`
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="2" y1="12" x2="22" y2="12"></line>
    <path
      d=${d(
        'M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 ',
        '15.3 15.3 0 0 1 4-10z',
      )}
    ></path>
  `,
  luna: html`
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"></path>
  `,
  work: html`
    <path d="M12 20h9"></path>
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>
  `,
  review: html`
    <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"></path>
    <polyline points="22 4 12 14 9 11"></polyline>
  `,
  decide: html`
    <path d="M12 3v18M5 21h14M4 7h16"></path>
    <path d="M7 7l-3 6a3 3 0 0 0 6 0zM17 7l-3 6a3 3 0 0 0 6 0z"></path>
  `,
  power: html`
    <path d="M18.4 6.6a9 9 0 1 1-12.7 0"></path>
    <line x1="12" y1="2" x2="12" y2="12"></line>
  `,
  gear: html`
    <circle cx="12" cy="12" r="3"></circle>
    <path
      d=${d(
        'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 ',
        '0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 ',
        '0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 ',
        '0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 ',
        '1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 ',
        '0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 ',
        '1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 ',
        '0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 ',
        '1z',
      )}
    ></path>
  `,
  folder: html`
    <path
      d=${d(
        'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 ',
        '1 2 2z',
      )}
    ></path>
  `,
  plus: html`
    <line x1="12" y1="5" x2="12" y2="19"></line>
    <line x1="5" y1="12" x2="19" y2="12"></line>
  `,
  close: html`
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  `,
  check: html`
    <polyline points="20 6 9 17 4 12"></polyline>
  `,
  play: html`
    <polygon points="6 3 20 12 6 21 6 3"></polygon>
  `,
  pageUp: html`
    <polyline points="17 11 12 6 7 11"></polyline>
    <polyline points="17 18 12 13 7 18"></polyline>
  `,
  pageDown: html`
    <polyline points="7 13 12 18 17 13"></polyline>
    <polyline points="7 6 12 11 17 6"></polyline>
  `,
}
