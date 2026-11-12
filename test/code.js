// The code under test. The integrated tests reach the system only through these entry points.
export { main } from '../src/cli.ts'
export { startServer } from '../src/ui/server.ts'
export { createPump, unescapeOutput } from '../src/ui/pump.ts'
export { createWatcher } from '../src/ui/watcher.ts'
