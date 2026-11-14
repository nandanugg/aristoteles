// The words of the supervisor (as the old watcher said them). Ruling 10.1: nothing is typed into a
// terminal, so these are the first prompt and the retry prompt of a launch or a resume (arguments
// of its command), the text of a problem that the supervisor records, and the text of the
// person's ask to try a problem again (stored, never typed). They are the content of
// stored records, so they live with the effects, not in adapters/words.
import type { ProblemId } from '../schema/index.ts'

export const SYSTEM = 'System message, not from the person.'
// The prompt of a resumed terminal (the settings' default retryInput, src/config/settings.ts).
export const DEFAULT_RETRY = `${SYSTEM} Run work next with your token, and do what it says.`

const quote = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`
// The values of a command: {session} and {token} as they are, {prompt} quoted for the shell. A
// command with no {prompt} gets it as its last argument: a first prompt is never typed (10.1).
export const fill = (
  template: string,
  values: { readonly session?: string; readonly token?: string; readonly prompt?: string },
): string => {
  const filled = template.replace(
    /\{(session|token|prompt)\}/g,
    (m, k: 'session' | 'token' | 'prompt') =>
      k === 'prompt' ? quote(values.prompt ?? '') : (values[k] ?? m),
  )
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

// The problems that the supervisor records for a host itself: the person acts in its terminal.
export const hostPromptSays = (line: string): string =>
  `Your AI CLI waits for your answer: ${line}. Answer it in the terminal of your AI ` +
  'CLI. The project goes on after that.'

export const hostStuckSays = (why: 'error' | 'silent', last: string): string =>
  `The host ${why === 'silent' ? 'is silent' : 'shows an error'}, and it does not wait for ` +
  `work. Its last lines: ${last} Tell it in its terminal to go on.`

// The person's Fixed of a problem that its host recorded: stored as the host's ask, never typed.
export const problemRetryLine = (problem: ProblemId, says: string): string =>
  `${SYSTEM} ${problem} is not fixed: ${clean(says, 300)} Test it once, when your ` +
  `current step ends. When it works, run work problem <your token> ${problem} --fixed.`
