// Explicit executable for the retained file-state integration fixtures.
import { runOnTerminal } from '../adapters/cli/bin.ts'
import { startCommand } from '../adapters/web/start.ts'

const args = process.argv.slice(2)
const dir = process.env.WORK_DIR ?? process.cwd()
process.exitCode = args[0] === 'start' ? await startCommand(dir, args, process.env) : await runOnTerminal(args, dir)
