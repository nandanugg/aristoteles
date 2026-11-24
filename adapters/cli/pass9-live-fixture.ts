// Drive the real Unit 2 supervisor, CLI wait, and SQLite intake. Only process I/O and
// the worker model's adversary (which can create or withdraw arbitrary work) are fixtures.
import { join } from 'node:path'
import { Effect, Layer, type Scope } from 'effect'
import { main } from './main.ts'
import { dispatchAct } from '../../core/actions/work.ts'
import { memberSecretOf, reserveWorker, settleWorker } from '../../core/actions/worker.ts'
import { dos, stepAge } from '../../core/derived/c16/obligations.ts'
import { obligationOf } from '../../core/derived/c16/worker.ts'
import { ROLE } from '../../core/derived/c16/replay/project.ts'
import { workerDriver } from '../../core/derived/pass9/replay/runtime-port.ts'
import { readJournal } from '../../core/derived/pass9/replay/journal.ts'
import type { Identity } from '../../core/derived/pass9/replay/model.ts'
import { type Intake, type WorkerRead, sameTurn } from '../../core/derived/pass9/replay/project.ts'
import { replayIdentity, replayTurn, stepKey, unit2Journal } from '../../core/derived/pass9/replay/unit2-journal.ts'
import { create, type Time, type WorkerPlacement } from '../../core/schema/index.ts'
import { Dir, Env, FilesLive, Now, Pump, SpawnLive, Store, StoreLive, Tokens, type DirStore, sha } from '../../core/services/index.ts'
import { foldWork } from '../../core/state/c16/fold.ts'
import { epochOf, vsum } from '../../core/state/c16/reads.ts'
import { actorOf, type Actor, type Body, keyOf } from '../../core/state/c16/types.ts'
import { foldRuntime } from '../../core/state/worker-runtime.ts'
import { backoffMemory, engineTick } from '../../core/effects/engine.ts'

const WORKER = 'group:replay'
const OTHER = 'private:role:other'
const members = { Host: 'host', Role: `role:${ROLE}`, Pipe: 'pipe' } as const satisfies Record<Identity, string>
const HUMAN: Actor = { _tag: 'Human' }
const at = '2026-11-23T00:00:00.000Z' as Time
const person = { _tag: 'Person', name: 'Fixture', channel: 'terminal' } as const
const system = { _tag: 'System' } as const
const answer = { _tag: 'Single', text: 'A fixture answer.' } as const

export const unit2Fixture = async (dir: string, competingWorker = false) => {
  const env = { ARISTOTELES_DB: join(dir, 'aristoteles.db') }
  let id = 0
  let clock = Date.parse(at)
  const cli = async (argv: ReadonlyArray<string>, vars: Readonly<Record<string, string>> = {}) => {
    const output: string[] = []
    const code = await main(argv, {
      cwd: dir, env: { ...env, ...vars }, out: (line) => output.push(line), err: () => {},
      isTTY: false, readLine: () => null, now: () => at, gitUser: () => 'Fixture', random: () => `nonce${++id}`,
    })
    if (code !== 0) throw new Error(`fixture CLI command ${argv[0]} failed (${code})`)
    return output.join('\n')
  }

  const processes = new Map<string, { readonly credential: string; state: 'live' | 'unknown' }>()
  const unused = () => Effect.die('unexpected terminal operation during replay')
  const pump = Layer.succeed(Pump, {
    start: (session, start) => Effect.promise(async () => {
      if (processes.has(session)) throw new Error('duplicate provider launch')
      const credential = start.env['ARISTOTELES_WORKER_CREDENTIAL']
      if (!credential) throw new Error('provider launched without a worker credential')
      processes.set(session, { credential, state: 'live' })
      await cli(['worker', 'ack'], { ...start.env, ARISTOTELES_SESSION: session })
    }),
    stop: (session) => Effect.sync(() => {
      if (processes.get(session)?.state === 'live') processes.delete(session)
    }),
    forget: (session) => Effect.sync(() => { processes.delete(session) }),
    observe: (session) => Effect.sync(() => processes.get(session)?.state ?? 'ended'),
    status: Effect.succeed({}),
    resume: unused, input: unused, enter: unused, tail: unused, adopt: unused, release: unused,
    paneOf: unused, keysAt: unused,
  })
  const layer = Layer.mergeAll(
    Layer.succeed(Env, { vars: env }), Layer.succeed(Dir, { cwd: dir }),
    Layer.succeed(Now, { read: Effect.sync(() => new Date(clock).toISOString() as Time) }), Layer.succeed(Tokens, { random: Effect.sync(() => `nonce${++id}`) }),
    StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env }))), FilesLive, SpawnLive, pump,
  )
  const run = <A, E>(effect: Effect.Effect<A, E, Layer.Success<typeof layer> | Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(layer)))
  const withStore = <A, E>(f: (store: DirStore) => Effect.Effect<A, E>, fresh = false) =>
    run(Effect.flatMap(Store, (store) => Effect.flatMap(store.open(dir, { create: fresh }), f)))
  const placement = (worker: string, actors: WorkerPlacement['members']): WorkerPlacement => ({
    worker, members: actors, account: 'fixture', cli: 'fixture', model: 'fixture', sessionLimit: 1,
    launch: 'fixture provider {session}',
  })
  await withStore((store) => store.write(() => Effect.succeed({
    draft: { at, author: person, event: create('Work', {
      _tag: 'Opened', hostSession: null, top: { name: 'Replay', goal: 'Replay', sections: [], facts: {}, directions: [] },
      items: [], cards: [[ROLE, { role: ROLE, words: 'Replay', model: 'fixture' }]], tokens: [], maxTries: 1,
      placements: [placement(WORKER, [members.Host, members.Role, members.Pipe]),
        ...(competingWorker ? [placement(OTHER, ['role:other'])] : [])],
    }) }, rows: [],
  })), true)

  const events = () => withStore((store) => store.events)
  const memory = Effect.runSync(backoffMemory)
  const tick = () => run(engineTick({}, memory))
  const generation = async () => {
    const current = foldRuntime(await events()).workers.get(WORKER)
    if (!current?.binding) throw new Error('shared worker was not bound by the supervisor')
    return { ...current, binding: current.binding }
  }
  const launch = async () => {
    clock += 60_000
    await tick()
    await tick()
    if ((await generation()).ended) throw new Error('supervisor did not launch a replacement')
  }
  await launch()

  const dispatch = (
    who: Actor, ep: number, body: Body, on: number, turn?: { credential: string; receipt?: string }, actId = `p${++id}`,
  ) => dispatchAct({
    by: who._tag === 'Human' ? person : system, act: { id: actId, who, ep, body },
    on, build: null, current: 'pass9-replay',
    ...(turn ? { credential: turn.credential } : {}),
    ...(turn?.receipt === undefined ? {} : { turn: turn.receipt }),
  })
  const adversary = (who: Actor, body: Body) => withStore((store) => store.write((records) => {
    const state = foldWork(records)!.state
    return Effect.succeed({
      draft: { at, author: system, event: create('Work', { _tag: 'Acted',
        act: { id: `p${++id}`, who, ep: epochOf(state, who), body, seen: -1, seenVer: vsum(state), old: false, vers: state.ver },
        token: null, request: 'model adversary', forward: null,
      }) }, rows: [],
    })
  }))
  let printed: {
    readonly view: NonNullable<WorkerRead['printed']>
    readonly credential: string
    readonly actor: Actor
    readonly ask: string
    readonly receipt: string
  } | null = null
  let submitted: ReturnType<typeof dispatch> | undefined
  const wait = async () => {
    const current = await generation()
    const process = processes.get(current.binding.session)
    if (!process) throw new Error('wait has no live fixture process')
    const result = await cli(['worker', 'wait', process.credential, '--seconds=2'])
    const match = /^work hear (w\.([\w:-]+)\.(\d+)\.[a-z0-9]+) (\S+) --on=(\d+) --turn=([a-f0-9]+)$/m.exec(result)
    if (!match) throw new Error('worker wait did not print a scoped Hear command')
    const [, credential, actor, epoch, ask, basis, receipt] = match
    if (!credential || !actor || !epoch || !ask || !basis || !receipt) {
      throw new Error('worker wait omitted a required scoped field')
    }
    const { offer, binding } = await generation()
    if (!offer || offer.receiptVerifier !== sha(receipt)) throw new Error('printed receipt does not match the durable offer')
    if (!binding.members.some((member) => member.actor === actor && member.epoch === Number(epoch) &&
      member.verifier === sha(credential.split('.').at(-1)!))) {
      throw new Error('wait printed a credential outside the live binding')
    }
    const view = {
      scope: { ...replayTurn(offer), on: Number(basis),
        step: stepKey({ act: 'Hear', task: null, fix: null, ask, maker: null, actor: null }) },
      tokenActor: replayIdentity(actor), tokenEpoch: Number(epoch),
    }
    if (view.scope.on !== offer.on || view.scope.step !== stepKey(offer.step)) {
      throw new Error('printed command does not match the durable step and basis')
    }
    return { view, credential, actor: actorOf(actor), ask, receipt }
  }

  const refusal = (failure: { readonly _tag: string } & Partial<{ readonly refused: string }>): string =>
    failure.refused ?? failure._tag
  const driver = workerDriver({
    read: async () => {
      const records = await events()
      const { state } = foldWork(records)!
      const owed = Object.entries(members).flatMap(([identity, actor]) => dos(state, actorOf(actor)).map((step) => ({
        actor: identity as Identity, obligation: obligationOf(state, step), age: stepAge(state, step), ready: true,
      })))
      const rows = unit2Journal(records)
      const display = printed?.view ?? null
      const observed = readJournal(rows).worker(WORKER, { owed, printed: display })
      const offer = foldRuntime(records).workers.get(WORKER)?.offer
      const folded = offer ? replayTurn(offer) : null
      if ((observed.activeTurn || folded) && !sameTurn(observed.activeTurn, folded)) {
        throw new Error('folded worker turn differs from the journal')
      }
      return { worker: WORKER, rows, owed, printed: display }
    },
    perform: async (command) => {
      switch (command.kind) {
        case 'offer': {
          // Seed the model adversary's question even if the addressed generation is down.
          // The human answer is accepted through the normal C16 authority and basis checks.
          const who = actorOf(members[command.identity])
          await adversary(who, { _tag: 'Open', open: { _tag: 'OpenQuestion', to: HUMAN,
            question: { title: 'Fixture question', form: { _tag: 'Single' } },
          } })
          const { state } = foldWork(await events())!
          const ask = [...state.asks.values()].findLast((ask) => ask.kind === 'Question')!
          await run(dispatch(HUMAN, 0, { _tag: 'AnswerQuestion', ask: ask.id, answer }, state.seq))
          break
        }
        case 'withdraw': {
          const { state } = foldWork(await events())!
          const who = actorOf(members[command.identity])
          const step = dos(state, who).find((step) => step.act === 'Hear')
          if (!step?.ask) throw new Error('worker adversary has no obligation to withdraw')
          await adversary(who, { _tag: 'Hear', ask: step.ask })
          break
        }
        case 'printOldest':
          printed = await wait()
          break
        case 'submit': {
          if (!printed) throw new Error('no printed command to submit')
          const { view, actor, ask, credential, receipt } = printed
          printed = null
          submitted = dispatch(actor, view.tokenEpoch, { _tag: 'Hear', ask }, view.scope.on, { credential, receipt })
          const result = await run(Effect.result(submitted))
          if (result._tag === 'Failure') {
            const current = await generation()
            const expected = current.reservation.generation === view.scope.generation ? 'stale' : 'epoch'
            if (refusal(result.failure) !== expected) {
              throw new Error(`expected ${expected} refusal, got ${refusal(result.failure)}`)
            }
          }
          return {
            requested: view.scope,
            credential: { actor: view.tokenActor, epoch: view.tokenEpoch, generation: view.scope.generation },
            outcome: result._tag === 'Failure' ? 'refused' : result.success.again ? 'retry' : 'taken',
            ...(result._tag === 'Failure' ? { refused: refusal(result.failure) } : {}),
          } satisfies Omit<Intake, 'committed' | 'actsAppended'>
        }
        case 'exit': {
          const { binding } = await generation()
          processes.delete(binding.session)
          await tick()
          break
        }
        case 'relaunch':
          await launch()
          break
        case 'park':
          throw new Error('unit 2 has no park transition')
      }
      return undefined
    },
  })
  return {
    driver,
    submitPrintedInCli: async () => {
      if (!printed) throw new Error('no printed command to submit')
      const { credential, ask, view, receipt } = printed
      const output = await cli(['hear', credential, ask, `--on=${view.scope.on}`, `--turn=${receipt}`])
      printed = null
      return output.split('\n').some((line) => line.startsWith('Hear taken ('))
    },
    refusePrinted: async (change: 'identity' | 'subject' | 'receipt' | 'basis') => {
      if (!printed) throw new Error('no printed command to vary')
      const { view, actor, ask, credential, receipt } = printed
      const { binding } = await generation()
      const originalSize = (await events()).length
      const other = binding.members.find((member) => member.actor !== keyOf(actor))!
      const credentialSecret = processes.get(binding.session)!.credential.split('.').at(-1)!
      const otherCredential = `w.${other.actor}.${other.epoch}.${memberSecretOf(credentialSecret, other.actor, other.epoch)}`
      const call = dispatch(
        change === 'identity' ? actorOf(other.actor) : actor,
        change === 'identity' ? other.epoch : view.tokenEpoch,
        { _tag: 'Hear', ask: change === 'subject' ? `${ask}-wrong` : ask },
        change === 'basis' ? view.scope.on - 1 : view.scope.on,
        {
          credential: change === 'identity' ? otherCredential : credential,
          ...(change === 'receipt' ? {} : { receipt }),
        },
      )
      const result = await run(Effect.result(call))
      const appended = (await events()).slice(originalSize)
      return {
        refused: result._tag === 'Failure' ? refusal(result.failure) : null,
        actsAppended: appended.filter(({ event }) => event._tag === 'Work' && event.create._tag === 'Acted').length,
      }
    },
    retry: async () => {
      if (!submitted) throw new Error('no recorded submission to retry')
      return run(Effect.result(submitted))
    },
    journal: async () => readJournal(unit2Journal(await events())),
    fenceWithUnknownProcess: async () => {
      const { reservation, binding } = await generation()
      await run(settleWorker(WORKER, reservation.generation, reservation.launch))
      const process = processes.get(binding.session)!
      process.state = 'unknown'
      await tick()
    },
    finishProcess: async () => {
      const { binding } = await generation()
      processes.delete(binding.session)
      await tick()
    },
    reserveOther: () => run(reserveWorker(OTHER, crypto.randomUUID().replaceAll('-', ''))),
    bindCapacityWaiter: async () => {
      await tick()
      const current = foldRuntime(await events()).workers.get(OTHER)
      return current?.binding !== null && current?.binding !== undefined
    },
  }
}
