// Before each test file (bunfig.toml): the PATH keeps only the folders that exist, once each.
// A spawn by name (git, tmux, sh) looks in each folder of the PATH; a folder that does not exist
// under an automounted root such as /home on macOS costs about 10 ms a look, each spawn. Bun
// uses this PATH only for a spawn that is given an env (src/services/outside.ts gives one).
import { existsSync } from 'node:fs'

const folders = (process.env.PATH ?? '').split(':')
process.env.PATH = [...new Set(folders)].filter((f) => f !== '' && existsSync(f)).join(':')
