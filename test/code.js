// The code under test. The integrated tests reach the system only through these entry points: the
// CLI, the page server, the pump of the terminals, the watcher, and work start (adapters/).
export { main } from '../adapters/cli/main.ts'
export { startServer } from '../adapters/web/server.ts'
export { createPump, unescapeOutput } from '../adapters/web/pump.ts'
export { createWatcher } from '../adapters/web/watcher.ts'
export { recordOf, workStartDetached } from '../adapters/web/start.ts'
// The two helpers of work start that test/settings.test.js checks (ruling 10.12).
export { linkSkills } from '../adapters/web/skills.ts'
export { excludeFromGit } from '../adapters/web/git-exclude.ts'
// The hook of invariant 4.2 (next => canAct; test/harness.js calls it when WORK_CHECK_NEXT=1).
export { checkNextCanAct } from '../adapters/cli/invariants.ts'
