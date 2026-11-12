// The terminal of a real agent, piped from its tmux window. The person types here.
import type { FitAddon as XFitAddon } from '@xterm/addon-fit'
import type { Terminal as XTerminal } from '@xterm/xterm'
import { html } from 'htm/preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { TerminalRef } from '../../domain/ui-model.ts'
import { socket } from './api.ts'
import { ICONS, icon } from './icons.ts'

// xterm.js and its fit addon are vendor scripts of the page (index.html).
declare global {
  interface Window {
    Terminal: new (options: Record<string, unknown>) => XTerminal
    FitAddon: { FitAddon: new () => XFitAddon }
  }
}

const fromBase64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

// xterm.js answers the queries in the output (the device attributes, the cursor place); tmux
// answers them for the program already, so these answers are not the person's input.
// biome-ignore lint/suspicious/noControlCharactersInRegex: the escape bytes are the point
const REPLY = /^(?:\x1b\[[?>][\d;]*c|\x1b\[\d+;\d+R|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\))+$/

export function Terminal({ terminal }: { terminal: TerminalRef | null }) {
  const box = useRef<HTMLDivElement>(null)
  const [state, setState] = useState('connecting')
  const sessionId = terminal?.session
  useEffect(() => {
    const el = box.current
    if (!sessionId || !el) return undefined
    const session = sessionId
    const term = new window.Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      theme: { background: '#0b0d12', foreground: '#e5e7eb' },
    })
    const fit = new window.FitAddon.FitAddon()
    term.loadAddon(fit)
    term.open(el)
    // A box in the middle of a layout (or a hidden one) fits to a few rows; the agent's real
    // terminal keeps its size then (the live demo got 74x5).
    const size = () => {
      try {
        fit.fit()
        if (term.cols < 40 || term.rows < 10) return
        socket.send({ type: 'term.resize', session, cols: term.cols, rows: term.rows })
      } catch {
        // The box is gone or hidden: keep the size.
      }
    }
    const off = socket.listen((m) => {
      if (m.type === 'open') {
        socket.send({ type: 'term.open', session })
        size()
      }
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
    const observer = new ResizeObserver(size)
    observer.observe(el)
    size()
    term.focus()
    return () => {
      socket.send({ type: 'term.close', session })
      off()
      input.dispose()
      observer.disconnect()
      term.dispose()
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
  const words = terminal.live ? 'runs' : terminal.ended ? 'ended' : 'closed'
  return html`<div class="term-bar"><span>${terminal.a} · session <code>${terminal.session}</code>
    </span><span class="grow"></span>
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
