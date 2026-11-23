// The words of a launch (ruling 10.1: nothing is typed into a terminal; the first prompt is an
// argument of the launch command), and the cleaning of a text from a terminal or the store.
import { cliSession } from '../services/index.ts'
export { cliSession } from '../services/index.ts'

export const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
type Key = 'session' | 'agent' | 'model' | 'prompt'
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
