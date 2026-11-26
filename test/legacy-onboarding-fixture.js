// Seed the retained config and work tests from reviewed file fixtures.
import { join } from 'node:path'
import { Cause, Effect, Exit } from 'effect'
import { layerOf } from '../adapters/cli/runtime.ts'
import { startStateOf, dispatch } from '../core/actions/index.ts'
import { startRefusal } from '../adapters/words/index.ts'
import { prepareStart } from '../src/files/onboarding.ts'

export const initializeLegacy = async (p) => {
  const env = { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') }
  const io = {
    cwd: p.dir, env, isTTY: false, out: () => {}, err: () => {},
    readLine: () => null, now: p.now, gitUser: () => 'Nanda', random: () => '',
  }
  const initialize = Effect.scoped(Effect.gen(function* () {
    const prepared = yield* prepareStart(p.dir, 'Nanda', env, (files) => startRefusal(startStateOf(files)))
    yield* dispatch({
      by: { _tag: 'Person', name: 'Nanda', channel: 'terminal' },
      input: { _tag: 'DefineWorkflow', target: {}, content: { directions: prepared.directions } },
    }).pipe(Effect.onError(() => Effect.ignore(prepared.restore)))
    yield* prepared.finish
  }))
  const exit = await Effect.runPromiseExit(initialize.pipe(Effect.provide(layerOf(io))))
  if (Exit.isSuccess(exit)) return { code: 0, out: '', err: '' }
  const error = Cause.squash(exit.cause)
  const next = error.next ?? error.choice?.words
  return { code: 1, out: '', err: `refused: ${error.message}${next ? '\nnext: ' + next : ''}` }
}
