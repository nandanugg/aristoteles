// Before each test file (bunfig.toml): the PATH keeps only the folders that exist, once each.
// A spawn by name (git, tmux, sh) looks in each folder of the PATH; a folder that does not exist
// under an automounted root such as /home on macOS costs about 10 ms a look, each spawn. Bun
// uses this PATH only for a spawn that is given an env (src/services/outside.ts gives one).
import { existsSync } from 'node:fs'

const folders = (process.env.PATH ?? '').split(':')
process.env.PATH = [...new Set(folders)].filter((f) => f !== '' && existsSync(f)).join(':')

// The temporary folders of the tests: this process (and each spawn of it, which inherits TMPDIR)
// makes every temp folder and tmux socket file under one folder of its own, which is removed when
// the process ends. A test needs no cleanup of its own for a folder of tmpdir().
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'bun:test'

// Each test file gets a folder of its own, removed after its last test (afterAll) or when the
// process ends, whichever comes first.
const own = mkdtempSync(join(tmpdir(), 'ar-test-'))
const before = process.env.TMPDIR
process.env.TMPDIR = own
const remove = () => rmSync(own, { recursive: true, force: true })
afterAll(() => {
  remove()
  if (before === undefined) delete process.env.TMPDIR
  else process.env.TMPDIR = before
})
process.on('exit', remove)
