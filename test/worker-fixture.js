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


export const workerTurn = async (p, credential, command) => {
  const response = await p.agent(`worker wait ${credential} --seconds=0.01`)
  if (response.code !== 0) throw new Error(response.err)
  const line = response.out.split('\n').find((text) => text.startsWith(`work ${command} `))
  if (!line) throw new Error(`Expected ${command} in ${response.out}`)
  if ([...line.matchAll(/--on(?:=| )/g)].length !== 1) throw new Error(`Expected one basis in ${line}`)
  return { words: response.out, token: line.split(' ')[2], args: line.match(/--on=\d+ --turn=[a-f0-9]+/)[0] }
}

export const recheckPumpIn = async (p) => {
  const { Pump, sha } = await import('../core/services/index.ts')
  const { backoffMemory, engineTick } = await import('../core/effects/engine.ts')
  const running = new Map()
  const starts = []
  const stopped = new Set()
  let stopMode = 'ended'
  for (const worker of foldRuntime(eventsOf(p.dir)).workers.values()) {
    if (worker.binding) running.set(worker.binding.session, 'live')
  }
  const observe = (sid) => running.get(sid) ?? 'ended'
  const stop = (sid) => {
    if (stopMode === 'failed') throw new Error('fixture stop failed')
    running.set(sid, stopMode)
    if (stopMode === 'ended') stopped.add(sid)
  }
  const pump = Layer.succeed(Pump, {
    start: (sid, input) => Effect.sync(() => {
      running.set(sid, 'live')
      starts.push({ sid, ...input })
    }),
    observe: (sid) => Effect.sync(() => observe(sid)),
    stop: (sid) => Effect.try(() => stop(sid)),
    forget: () => Effect.void,
  })
  let memory = Effect.runSync(backoffMemory)
  return {
    starts, stopped, running,
    stopMode: (value) => { stopMode = value },
    restart: () => { memory = Effect.runSync(backoffMemory) },
    tick: () => workerRuntimeIn(p, engineTick({
      bootstrap: (sid) => ({ state: observe(sid), stop: () => stop(sid) }),
    }, memory).pipe(Effect.provide(pump))),
    ack: (credential) => {
      const [, launch, secret] = credential.split('.')
      stageWorkerLaunch(p.dir, launch, 'ack', sha(secret))
    },
  }
}
