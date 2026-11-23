import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import { bindWorker, memberSecretOf, reserveWorker, workerSession } from '../core/actions/worker.ts'
import { Dir, Env, Now, stageWorkerLaunch, StoreLive } from '../core/services/index.ts'
import { foldRuntime } from '../core/state/worker-runtime.ts'
import { eventsOf } from '../core/actions/fixture.test.ts'

export const workerRuntimeIn = (p, action) => {
  const services = Layer.mergeAll(
    Layer.succeed(Dir, { cwd: p.dir }),
    Layer.succeed(Now, { read: Effect.sync(p.now) }),
    StoreLive.pipe(Layer.provide(Layer.succeed(Env, {
      vars: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') },
    }))),
  )
  return Effect.runPromise(action.pipe(Effect.provide(services)))
}

export const workerIn = async (p, actor) => {
  const { placements, workers } = foldRuntime(eventsOf(p.dir))
  const { worker } = placements.find(({ members }) => members.includes(actor))
  const generation = (workers.get(worker)?.reservation.generation ?? 0) + 1
  const launch = randomUUID().replaceAll('-', '')
  const secret = randomUUID().replaceAll('-', '')
  const run = (action) => workerRuntimeIn(p, action)
  // This fixture supplies the observer's reserved-launch acknowledgement without a provider.
  const seq = await run(reserveWorker(worker, launch))
  if (seq === null) throw new Error(`worker ${worker} could not reserve a session`)
  stageWorkerLaunch(p.dir, launch, 'secret', secret)
  await run(bindWorker(worker, generation, launch, workerSession(launch), secret))
  const binding = foldRuntime(eventsOf(p.dir)).workers.get(worker).binding
  return {
    token: (key) => {
      const { epoch } = binding.members.find(({ actor }) => actor === key)
      return `w.${key}.${epoch}.${memberSecretOf(secret, key, epoch)}`
    },
    credential: `g.${launch}.${generation}.${secret}`,
  }
}
