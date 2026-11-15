// The markdown of the onboarding pages (Nanda, 2026-11-15): a direction, its standards and rules,
// and the words of a role show as headings, paragraphs, lists, code and links, made of Preact
// nodes (a text never becomes markup), with no library.
import { describe, expect, test } from 'bun:test'
import { blocksOf, Inline, inlineOf, Markdown } from './app/markdown.ts'

// The tags and texts of a tree of Preact nodes, as HTML-like words.
const html = (n: unknown): string => {
  if (n === null || n === undefined || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n).replaceAll('<', '&lt;')
  if (Array.isArray(n)) return n.map(html).join('')
  const node = n as { type: unknown; props: Record<string, unknown> }
  if (typeof node.type === 'function') return html((node.type as (p: unknown) => unknown)(node.props))
  const { children, ...props } = node.props
  const attrs = Object.entries(props).map(([k, v]) => ` ${k}="${String(v)}"`).join('')
  return `<${String(node.type)}${attrs}>${html(children)}</${String(node.type)}>`
}

describe('the blocks of a text', () => {
  test('headings, paragraphs, a rule, a quote and a code block', () => {
    const text = '# Top\n\nOne line\nand its next line.\n\n## Where it comes from\n---\n> a quote\n\n```ts\nconst a = 1\n\n# not a heading\n```\n'
    expect(blocksOf(text)).toEqual([
      { kind: 'heading', level: 1, text: 'Top' },
      { kind: 'paragraph', text: 'One line\nand its next line.' },
      { kind: 'heading', level: 2, text: 'Where it comes from' },
      { kind: 'rule' },
      { kind: 'quote', text: 'a quote' },
      { kind: 'code', text: 'const a = 1\n\n# not a heading' },
    ])
  })

  test('lists: bullets, numbers, a nested list, and a paragraph that a list ends', () => {
    expect(blocksOf('Steps:\n1. read\n2. write\n   - one part\n   - two parts\n\n- a\n- b\n')).toEqual([
      { kind: 'paragraph', text: 'Steps:' },
      { kind: 'list', ordered: true, items: ['read', 'write\n- one part\n- two parts'] },
      { kind: 'list', ordered: false, items: ['a', 'b'] },
    ])
  })
})

describe('the inline marks', () => {
  test('code, bold, italic, links, escapes, and line breaks', () => {
    expect(inlineOf('Read `runs/<slug>/direction.md` and **keep** it _as is_.')).toEqual([
      { kind: 'text', text: 'Read ' },
      { kind: 'code', text: 'runs/<slug>/direction.md' },
      { kind: 'text', text: ' and ' },
      { kind: 'strong', children: [{ kind: 'text', text: 'keep' }] },
      { kind: 'text', text: ' it ' },
      { kind: 'em', children: [{ kind: 'text', text: 'as is' }] },
      { kind: 'text', text: '.' },
    ])
    expect(inlineOf('See [the guide](https://example.com/guide) or [here](docs/a.md).')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', href: 'https://example.com/guide', children: [{ kind: 'text', text: 'the guide' }] },
      { kind: 'text', text: ' or ' },
      { kind: 'link', href: 'docs/a.md', children: [{ kind: 'text', text: 'here' }] },
      { kind: 'text', text: '.' },
    ])
    // A single line end is a space; two spaces or a backslash before it is a break.
    expect(inlineOf('one\ntwo  \nthree\\\nfour')).toEqual([
      { kind: 'text', text: 'one two' },
      { kind: 'break' },
      { kind: 'text', text: 'three' },
      { kind: 'break' },
      { kind: 'text', text: 'four' },
    ])
  })

  test('no mark where the text means none: snake_case, a lone star, an escape, a script link', () => {
    expect(inlineOf('the snake_case_name and 2 * 3 and \\*not bold\\*')).toEqual([
      { kind: 'text', text: 'the snake_case_name and 2 * 3 and *not bold*' },
    ])
    expect(inlineOf('[click](javascript:alert)')).toEqual([{ kind: 'text', text: '[click](javascript:alert)' }])
    expect(inlineOf('`a **b** c`')).toEqual([{ kind: 'code', text: 'a **b** c' }])
  })
})

describe('the nodes', () => {
  test('a direction shows as headings, paragraphs, lists and code, never as raw marks', () => {
    const says = 'A design follows the direction.\n\n## Where it comes from\nThe parts of `page.md`:\n\n- **Plain** words\n- *Lean* sentences\n'
    expect(html(Markdown({ text: says }))).toBe(
      '<div class="md"><p>A design follows the direction.</p><h3>Where it comes from</h3>' +
        '<p>The parts of <code>page.md</code>:</p>' +
        '<ul><li><strong>Plain</strong> words</li><li><em>Lean</em> sentences</li></ul></div>',
    )
  })

  test('markup in a text is text, and a link opens in a new tab', () => {
    expect(html(Markdown({ text: '<img src=x onerror=alert(1)> [a](https://example.com)' }))).toBe(
      '<div class="md"><p>&lt;img src=x onerror=alert(1)> <a href="https://example.com" target="_blank" rel="noreferrer">a</a></p></div>',
    )
    expect(html(Inline({ text: 'Checks `one` section.' }))).toBe('<span class="md-inline">Checks <code>one</code> section.</span>')
  })
})
