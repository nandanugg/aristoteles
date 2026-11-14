// The terminal of a real agent, piped from its tmux window. The person types here.
import type { FitAddon as XFitAddon } from '@xterm/addon-fit'
import type { Terminal as XTerminal } from '@xterm/xterm'
import { html } from 'htm/preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { TerminalRef } from '../../../src/domain/ui-model.ts'
import { socket } from './api.ts'
import { ICONS, icon } from './icons.ts'

// xterm.js and its fit addon are vendor scripts of the page, loaded with the first terminal.
declare global {
  interface Window {
    Terminal: new (options: Record<string, unknown>) => XTerminal
    FitAddon: { FitAddon: new () => XFitAddon }
  }
}

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

// xterm.js, its fit addon and its style load when the first terminal opens: a page that shows
// no terminal never needs them (about 70 KB gzipped, B1). A failed load is tried again.
let vendor: Promise<unknown> | undefined
const added = (tag: HTMLScriptElement | HTMLLinkElement, url: string) =>
  new Promise<void>((done, fail) => {
    tag.onload = () => done()
    tag.onerror = () => fail(new Error(`${url} did not load`))
    document.head.append(tag)
  })
const script = (src: string) => added(Object.assign(document.createElement('script'), { src }), src)
const style = (href: string) =>
  added(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }), href)
const xtermLoaded = (): Promise<unknown> => {
  vendor ??= Promise.all([
    script('/vendor/xterm.js'),
    script('/vendor/addon-fit.js'),
    style('/vendor/xterm.css'),
  ]).catch((error: unknown) => {
    vendor = undefined
    throw error
  })
  return vendor
}

// xterm.js answers the queries in the output (the device attributes, the cursor place); tmux
// answers them for the program already, so these answers are not the person's input.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the escape bytes are the point
const REPLY = /^(?:\x1b\[[?>][\d;]*c|\x1b\[\d+;\d+R|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+$/

// The terminal of one session in its box: xterm.js on the socket. It always has the size of the
// pane in tmux, which the server sends; the box never sizes it (ruling 2026-11-14), and the box
// scrolls when the terminal is larger. Returns the size that would fill the box now, for the
// resize button, and the cleanup.
type Session = NonNullable<TerminalRef['session']>
interface OpenTerminal {
  readonly fill: () => { readonly cols: number; readonly rows: number } | undefined
  readonly close: () => void
}
function openTerminal(
  el: HTMLElement,
  session: Session,
  setState: (state: string) => void,
): OpenTerminal {
  const term = new window.Terminal({
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 5000,
    theme: { background: '#0b0d12', foreground: '#e5e7eb' },
  })
  // The fit addon only measures the box; it never resizes the terminal.
  const fit = new window.FitAddon.FitAddon()
  term.loadAddon(fit)
  term.open(el)
  const off = socket.listen((m) => {
    if (m.type === 'open') socket.send({ type: 'term.open', session })
    if (m.type === 'term.size' && m.session === session) term.resize(m.cols, m.rows)
    if (m.type === 'term.data' && m.session === session) {
      if (m.reset) term.reset()
      term.write(fromBase64(m.data))
      setState('open')
    }
    if (m.type === 'term.error' && m.session === session) setState(m.error)
  })
  const input = term.onData((data) => {
    if (!REPLY.test(data)) socket.send({ type: 'term.input', session, data })
  })
  socket.send({ type: 'term.open', session })
  term.focus()
  return {
    fill: () => fit.proposeDimensions(),
    close: () => {
      socket.send({ type: 'term.close', session })
      off()
      input.dispose()
      term.dispose()
    },
  }
}

export function Terminal({ terminal }: { terminal: TerminalRef | null }) {
  const box = useRef<HTMLDivElement>(null)
  const opened = useRef<OpenTerminal>()
  const [state, setState] = useState('connecting')
  const sessionId = terminal?.session
  useEffect(() => {
    const el = box.current
    if (!sessionId || !el) return undefined
    // A box that closes before xterm.js loads opens no terminal.
    let closed = false
    xtermLoaded()
      .then(() => {
        if (!closed) opened.current = openTerminal(el, sessionId, setState)
      })
      .catch((error: unknown) => setState(error instanceof Error ? error.message : String(error)))
    return () => {
      closed = true
      opened.current?.close()
      opened.current = undefined
    }
  }, [sessionId])
  if (!terminal?.session) {
    const words = 'This task has no terminal: no real agent works on it yet.'
    return html`<div style="padding: 16px; color: var(--faint)">${words}</div>`
  }
  // Page Up and Page Down for the tool in the terminal: Claude scrolls its own view with them.
  // A press keeps the focus in the terminal, so that the person types on.
  const page = (key: string) =>
    socket.send({ type: 'term.input', session: terminal.session, data: key })
  const keep = (e: Event) => e.preventDefault()
  // The resize button asks tmux for the size that fills the box now, but never less than 80 x 24:
  // a tap on a phone must leave an AI CLI a terminal that it can use. The terminal takes the size
  // when tmux reports it.
  const fitBox = () => {
    const fills = opened.current?.fill()
    if (fills === undefined || !(fills.cols > 0 && fills.rows > 0)) return
    const cols = Math.max(80, fills.cols)
    const rows = Math.max(24, fills.rows)
    socket.send({ type: 'term.resize', session: terminal.session, cols, rows })
  }
  const words = terminal.live ? 'runs' : terminal.ended ? 'ended' : 'closed'
  return html`<div class="term-bar"><span>${terminal.a} · session <code>${terminal.session}</code>
    </span><span class="grow"></span>
      ${terminal.live ? html`<button class="btn small" onMouseDown=${keep} onClick=${fitBox}
        title="Set the terminal to the size of this box, at least 80 x 24">Fit to box</button>`
        : ''}
      <span>${words}${state !== 'open' && state !== 'connecting' ? ` · ${state}` : ''}</span></div>
    <div class="term-wrap">
      <div class="term" ref=${box}></div>
      ${terminal.live ? html`<div class="term-scroll">
        <button aria-label="Page up" title="Page up" onMouseDown=${keep}
          onClick=${() => page('\x1b[5~')}>${icon(ICONS.pageUp, 18)}</button>
        <button aria-label="Page down" title="Page down" onMouseDown=${keep}
          onClick=${() => page('\x1b[6~')}>${icon(ICONS.pageDown, 18)}</button>
      </div>` : ''}
    </div>`
}
