// The files of work that belong to this machine only: the worktrees and logs in .work/, and the
// links to the aristoteles skills (Nanda, 2026-11-13). They go into the exclude file of the dir's
// git (.git/info/exclude), which git reads and never commits, so the dir's own .gitignore stays
// as it is.
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

// Adds each path (relative to the dir; a folder ends with /) that the exclude file does not hold
// yet, and returns the lines it added. A dir outside git has no exclude file: nothing to add.
export const excludeFromGit = (
  dir: string,
  paths: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  if (paths.length === 0) return []
  const git = Bun.spawnSync(
    ['git', '-C', dir, 'rev-parse', '--show-toplevel', '--git-path', 'info/exclude'],
  )
  if (git.exitCode !== 0) return []
  const [top = '', path = ''] = git.stdout.toString().trim().split('\n')
  // --git-path is relative to the dir; the top is a real path, so the dir must be one too.
  const file = resolve(dir, path)
  const real = realpathSync(dir)
  const held = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : []
  const lines = paths
    .map((p) => `/${relative(top, resolve(real, p))}${p.endsWith('/') ? '/' : ''}`)
    .filter((line) => !held.includes(line))
  if (lines.length === 0) return []
  mkdirSync(dirname(file), { recursive: true })
  const start = held.length && held.at(-1) !== '' ? '\n' : ''
  appendFileSync(file, `${start}${lines.join('\n')}\n`)
  return lines
}
