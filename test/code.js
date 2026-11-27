// The code under test. The integrated tests reach the system only through these entry points: the
// CLI, the page server, the pump of the terminals, the watcher, and work start (adapters/).
export { main } from '../adapters/cli/main.ts'
export { startServer } from '../adapters/web/server.ts'
export { createPump, unescapeOutput } from '../adapters/web/pump.ts'
import { createWatcher as watchLegacy } from '../adapters/web/watcher.ts'
import { join } from 'node:path'
import { workStartDetached as startLegacy } from '../adapters/web/start.ts'
export { recordOf } from '../adapters/web/start.ts'
const fixtureOptions = (options) => ({
  ...options, env: { ...options?.env, ARISTOTELES_LEGACY_FIXTURE_ENTRY: join(import.meta.dir, 'legacy-start.ts') },
})
export const workStartDetached = (dir, options) => startLegacy(dir, fixtureOptions(options))
export const createWatcher = (options) => watchLegacy(fixtureOptions(options))
// The two helpers of work start that test/settings.test.js checks (ruling 10.12).
export { linkSkills } from '../adapters/web/skills.ts'
export { excludeFromGit } from '../adapters/live/git-exclude.ts'
