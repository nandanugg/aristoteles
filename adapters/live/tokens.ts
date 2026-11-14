// The secret of a new token: 26 letters and digits that read apart. The CLI, the page and the
// watcher give it as their live Tokens service.
import { randomBytes } from 'node:crypto'

export const tokenSecret = (): string =>
  [...randomBytes(26)].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')
