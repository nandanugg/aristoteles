// The markdown of a direction, its standards and rules, and the words of a role, as Preact nodes:
// never innerHTML, so a text shows only as text. Only what these texts use: headings,
// paragraphs, line breaks, lists, block quotes, code blocks, inline code, bold, italic, links.
// blocksOf and inlineOf parse; Markdown and Inline render.
import type { VNode } from 'preact'
import { html } from 'htm/preact'

export type InlineNode =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'break' }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong' | 'em'; readonly children: ReadonlyArray<InlineNode> }
  | { readonly kind: 'link'; readonly href: string; readonly children: ReadonlyArray<InlineNode> }
export type Block =
  | { readonly kind: 'heading'; readonly level: number; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string }
  | { readonly kind: 'list'; readonly ordered: boolean; readonly items: ReadonlyArray<string> }
  | { readonly kind: 'quote'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'rule' }

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const RULE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/
// A line that starts a block of its own ends a paragraph.
const starts = (line: string) =>
  FENCE.test(line) || HEADING.test(line) || ITEM.test(line) || QUOTE.test(line) || RULE.test(line)

// The blocks of a text. A list item holds its first line and the lines indented below it, as
// markdown of its own (so a list nests); a paragraph keeps its line ends for inlineOf.
export const blocksOf = (text: string): ReadonlyArray<Block> => {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Array<Block> = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const mark = fence[1] ?? '```'
      const body: Array<string> = []
      i++
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(mark)) {
        body.push(lines[i++] ?? '')
      }
      i++
      blocks.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]?.length ?? 1, text: heading[2] ?? '' })
      i++
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: Array<string> = []
      while (i < lines.length && QUOTE.test(lines[i] ?? '')) {
        body.push(QUOTE.exec(lines[i++] ?? '')?.[1] ?? '')
      }
      blocks.push({ kind: 'quote', text: body.join('\n') })
      continue
    }
    const item = ITEM.exec(line)
    if (item) {
      const ordered = /\d/.test(item[2] ?? '')
      const items: Array<string> = []
      while (i < lines.length) {
        const head = ITEM.exec(lines[i] ?? '')
        if (!head || /\d/.test(head[2] ?? '') !== ordered) break
        const body = [head[3] ?? '']
        i++
        // The lines below an item that are indented, or blank between indented ones, are its own.
        while (i < lines.length) {
          const next = lines[i] ?? ''
          const indented = /^\s{2,}\S/.test(next)
          const blankThenIndented = next.trim() === '' && /^\s{2,}\S/.test(lines[i + 1] ?? '')
          if (!indented && !blankThenIndented) break
          body.push(next.replace(/^\s{2,4}/, ''))
          i++
        }
        items.push(body.join('\n'))
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }
    const body: Array<string> = [line]
    i++
    while (i < lines.length && (lines[i] ?? '').trim() !== '' && !starts(lines[i] ?? '')) {
      body.push(lines[i++] ?? '')
    }
    blocks.push({ kind: 'paragraph', text: body.join('\n') })
  }
  return blocks
}

// The end of an emphasis that opens at `from`: the same mark, with no space before it.
const closeOf = (s: string, from: number, mark: string): number => {
  for (let j = s.indexOf(mark, from); j !== -1; j = s.indexOf(mark, j + 1)) {
    const single = mark.length === 1 && (s[j + 1] === mark || s[j - 1] === mark)
    const word = mark[0] === '_' && /\w/.test(s[j + mark.length] ?? '')
    if (j > from && !/\s/.test(s[j - 1] ?? '') && !single && !word) return j
  }
  return -1
}
// Only a link to the web, a mail, or a place in the page: no script runs from a link.
const safe = (href: string) => /^(https?:|mailto:|#|\/|\.{1,2}\/|[\w.-]+(\/|$))/i.test(href)

// The inline nodes of a text: code spans first (nothing inside them is markdown), then links,
// bold, italic, escapes, and line breaks (two spaces or a backslash at a line end; a single
// line end is a space).
export const inlineOf = (s: string): ReadonlyArray<InlineNode> => {
  const out: Array<InlineNode> = []
  let text = ''
  const flush = () => {
    if (text) out.push({ kind: 'text', text })
    text = ''
  }
  let i = 0
  while (i < s.length) {
    const c = s[i] ?? ''
    const rest = s.slice(i)
    const hardBreak = /^( {2,}|\\)\n/.exec(rest)
    if (hardBreak) {
      flush()
      out.push({ kind: 'break' })
      i += hardBreak[0].length
      continue
    }
    if (c === '\n') {
      text += ' '
      i++
      continue
    }
    if (c === '\\' && /[\\`*_[\]()#+\-.!>~|]/.test(s[i + 1] ?? '')) {
      text += s[i + 1]
      i += 2
      continue
    }
    if (c === '`') {
      const run = /^`+/.exec(rest)?.[0] ?? '`'
      const end = s.indexOf(run, i + run.length)
      if (end !== -1) {
        flush()
        out.push({ kind: 'code', text: s.slice(i + run.length, end).replace(/\n/g, ' ') })
        i = end + run.length
        continue
      }
      text += run
      i += run.length
      continue
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)
    if (c === '[' && link && safe(link[2] ?? '')) {
      flush()
      out.push({ kind: 'link', href: link[2] ?? '', children: inlineOf(link[1] ?? '') })
      i += link[0].length
      continue
    }
    if (c === '*' || c === '_') {
      const mark = s[i + 1] === c ? c + c : c
      const inWord = c === '_' && /\w/.test(s[i - 1] ?? '')
      const opens = !/\s/.test(s[i + mark.length] ?? ' ') && !inWord
      const end = opens ? closeOf(s, i + mark.length, mark) : -1
      if (end !== -1) {
        flush()
        const children = inlineOf(s.slice(i + mark.length, end))
        out.push({ kind: mark.length === 2 ? 'strong' : 'em', children })
        i = end + mark.length
        continue
      }
      text += mark
      i += mark.length
      continue
    }
    text += c
    i++
  }
  flush()
  return out
}

const inlineNode = (n: InlineNode): VNode | string => {
  switch (n.kind) {
    case 'text':
      return n.text
    case 'break':
      return html`<br />`
    case 'code':
      return html`<code>${n.text}</code>`
    case 'strong':
      return html`<strong>${n.children.map(inlineNode)}</strong>`
    case 'em':
      return html`<em>${n.children.map(inlineNode)}</em>`
    case 'link':
      return html`<a href=${n.href} target="_blank" rel="noreferrer"
        >${n.children.map(inlineNode)}</a>`
  }
}

// A heading inside a card sits below the card's own title (h2): # and ## are h3, ### is h4, the
// rest h5.
const HEADING_TAG = ['h3', 'h3', 'h4', 'h5', 'h5', 'h5']

const blockNode = (b: Block): VNode => {
  switch (b.kind) {
    case 'heading':
      return html`<${HEADING_TAG[b.level - 1] ?? 'h5'}>${inlineOf(b.text).map(inlineNode)}<//>`
    case 'paragraph':
      return html`<p>${inlineOf(b.text).map(inlineNode)}</p>`
    case 'list': {
      // An item of one paragraph is a line of the list; a longer item holds its blocks.
      const items = b.items.map((item) => {
        const inner = blocksOf(item)
        const only = inner.length === 1 && inner[0]?.kind === 'paragraph' ? inner[0] : undefined
        return html`<li>${only ? inlineOf(only.text).map(inlineNode) : inner.map(blockNode)}</li>`
      })
      return b.ordered ? html`<ol>${items}</ol>` : html`<ul>${items}</ul>`
    }
    case 'quote':
      return html`<blockquote>${blocksOf(b.text).map(blockNode)}</blockquote>`
    case 'code':
      return html`<pre><code>${b.text}</code></pre>`
    case 'rule':
      return html`<hr />`
  }
}

// A text of many lines, as blocks.
export function Markdown({ text }: { text: string }) {
  return html`<div class="md">${blocksOf(text).map(blockNode)}</div>`
}
// A text of one line (the summary of a card, a question): its inline marks only.
export function Inline({ text }: { text: string }) {
  return html`<span class="md-inline">${inlineOf(text).map(inlineNode)}</span>`
}
