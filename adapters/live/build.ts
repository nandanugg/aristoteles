// P8, ruling 4: the build of the installed code is the git commit of its folder. The server sends
// its own on each open of the page's socket, and the page reloads when it changes; `work wait`
// returns when it changes while it blocks. ARISTOTELES_CODE names another folder (a test's).
import { resolve } from 'node:path'
import { pathOf } from '../../core/services/index.ts'

const ROOT = resolve(import.meta.dir, '..', '..')

// The commit of the code now; '' when the folder is no git repo (then it never changes).
export const buildOf = (env: Readonly<Record<string, string | undefined>>): string => {
  const root = env.ARISTOTELES_CODE ?? ROOT
  const git = Bun.spawnSync([pathOf('git'), '-C', root, 'rev-parse', 'HEAD'], {
    env: process.env,
    stderr: 'ignore',
  })
  return git.success ? git.stdout.toString().trim() : ''
}
