import { Effect } from 'effect'
import { refuse } from '../../../core/schema/index.ts'
import { Dir, Env } from '../../../core/services/index.ts'
import { bootstrapRequest, runActivation } from '../../live/activation.ts'
import { NONCE_ENV } from '../../live/bootstrap.ts'
import { personAuthor } from '../caller.ts'
import type { Commands } from '../command.ts'

export const commands: Commands = {
  activation: (call) => Effect.gen(function* () {
    const { cwd } = yield* Dir
    const [action, launch] = call.args.positional
    if (action === 'ack' && launch) {
      const { vars } = yield* Env
      const result = yield* bootstrapRequest(cwd, launch, vars[NONCE_ENV], 'ack')
      return [result.line]
    }
    if (action !== 'resume' && action !== 'rollback' && action !== 'relaunch') {
      return yield* refuse('use work activation ack <id>|resume|rollback|relaunch')
    }
    if (call.token !== null) return yield* refuse('the person runs activation recovery')
    const by = yield* personAuthor(undefined)
    if (by._tag !== 'Person') return yield* refuse('the person runs activation recovery')
    return [yield* runActivation(cwd, by, action)]
  }),
}
