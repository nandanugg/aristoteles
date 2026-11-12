// The file of the store: ARISTOTELES_DB, or ~/.aristoteles/aristoteles.db. One file serves every
// dir on this machine.
import { homedir } from 'node:os'
import { join } from 'node:path'

export const dbPath = (env: Readonly<Record<string, string | undefined>>): string =>
  env.ARISTOTELES_DB ?? join(homedir(), '.aristoteles', 'aristoteles.db')
