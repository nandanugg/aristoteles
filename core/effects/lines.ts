// The words of a launch (ruling 10.1: nothing is typed into a terminal; the first prompt is an
// argument of the launch command), and the cleaning of a text from a terminal or the store.
import { createHash } from 'node:crypto'

export const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
type Key = 'session' | 'agent' | 'model' | 'prompt'
// The session of a command is a UUID: an AI CLI takes no other session id (Claude Code: "Invalid
// session ID. Must be a valid UUID", Nanda, 2026-11-15). A UUID stays as it is; any other id maps
// to the same UUID each time (the SHA-1 of the id, shaped as a version 5 UUID), so a launch and
// its later resumes name one session.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const cliSession = (session: string): string => {
  if (UUID.test(session)) return session
  const h = createHash('sha1').update(session).digest('hex')
  const variant = ((Number.parseInt(h[16] ?? '0', 16) & 0x3) | 0x8).toString(16)
  const tail = `${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${tail}`
}

// The values of a command: {session} as a UUID, {agent} and {model} as they are, {prompt} quoted
// for the shell. A command with no {prompt} gets it as its last argument: a first prompt is never
// typed (10.1).
export const fill = (template: string, values: { readonly [K in Key]?: string }): string => {
  const filled = template.replace(/\{(session|agent|model|prompt)\}/g, (m, k: Key) => {
    if (k === 'prompt') return quote(values.prompt ?? '')
    if (k === 'session' && values.session !== undefined) return cliSession(values.session)
    return values[k] ?? m
  })
  const appended = values.prompt !== undefined && !template.includes('{prompt}')
  return appended ? `${filled} ${quote(values.prompt ?? '')}` : filled
}

// Text from a terminal or the store goes to a host as data: no token, no control byte, short,
// and quoted, so that a child cannot write instructions to its host.
export const clean = (text: string, max = 160): string => {
  const one = text
    .replace(/a\d+\.[a-z0-9]{10,}/g, (m) => `${m.split('.')[0]}.<token>`)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the control bytes go
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return `«${one.length > max ? `${one.slice(0, max)}…` : one}»`
}
