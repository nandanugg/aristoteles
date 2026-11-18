// The small helpers that many views share: who, clock, headers, short, an, indented. The readings
// of the outside are Readings' (core/services), not here.
import type { By, Rule } from '../../core/schema/index.ts'

// HH:MM of a time, or --:-- (golden in work log and waiting).
export const clock = (iso: string | null | undefined): string => (iso ? iso.slice(11, 16) : '--:--')

// --- who -------------------------------------------------------------------------------------

// The name of an actor as the CLI prints it: an assignment id, a person, a model run.
export const who = (by: By): string => (typeof by === 'string' ? by : by.name)

// --- text ------------------------------------------------------------------------------------

// "a" or "an", as the word starts.
export const an = (word: string): string => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`)
export const short = (text: string, n = 120): string =>
  text.length > n ? `${text.slice(0, n - 3)}...` : text
// Words of any markdown, on lines that keep the indent of the view.
export const indented = (text: string, pad: string): string =>
  String(text).trimEnd().split('\n').join(`\n${pad}`)
// Who checks a rule: a role, or the decider of the result.
export const checkerOf = (rule: Rule): string =>
  rule.checkedBy._tag === 'Role' ? rule.checkedBy.role : 'decider'

// The headers inside the words of one entry divide them, so that a role reads one piece
// (Nanda, 2026-11-10): a header is a markdown line that starts with #, and its name in an
// address is in lower case, with dashes for spaces (Cost first -> cost-first).
export const headerName = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

// One header of a text: its level, its title, its slug, its line, and its words up to the next
// header of the same or a higher level.
export interface Header {
  readonly level: number
  readonly title: string
  readonly slug: string
  readonly line: number
  readonly text: string
}
export const headersOf = (text: string): ReadonlyArray<Header> => {
  const lines = String(text).split('\n')
  const found: Array<Omit<Header, 'text'>> = []
  let fence = false
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fence = !fence
    const m = fence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) {
      const title = m[2] as string
      found.push({ level: (m[1] as string).length, title, slug: headerName(title), line: i })
    }
  })
  return found.map((h, i) => {
    const end = found.slice(i + 1).find((x) => x.level <= h.level)
    return {
      ...h,
      text: lines
        .slice(h.line, end ? end.line : lines.length)
        .join('\n')
        .trimEnd(),
    }
  })
}
// The words of an entry for a brief: the text before its first header, and an address for each
// header, so that a long entry costs only what the role reads.
export const briefWords = (text: string, address: string, pad: string): string => {
  const heads = headersOf(text)
  const first = heads[0]
  if (first === undefined) return indented(text, pad)
  const lead = String(text).split('\n').slice(0, first.line).join('\n').trim()
  const top = Math.min(...heads.map((h) => h.level))
  return [
    lead || '(read the pieces below)',
    ...heads.map(
      (h) => `${'  '.repeat(h.level - top)}- ${h.title}: work direction show ${address}#${h.slug}`,
    ),
  ].join(`\n${pad}`)
}
