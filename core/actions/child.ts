// Native subagents start in the parent's CLI. The parent receives one launch authorization,
// then the child's own command binds it. Neither phase allocates a provider session.
import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { sha } from '../services/index.ts'
import { epochOf } from '../state/c16/reads.ts'
import { actorOf, type RefusalName } from '../state/c16/types.ts'
import { childFor, childLoad, foldRuntime, type ChildAllocation, type Runtime } from '../state/worker-runtime.ts'
import type { WorkFolded } from '../state/c16/fold.ts'
import { currentOffer } from '../derived/c16/worker.ts'
import { workerRefusal, writeRuntime } from './worker.ts'

const SYSTEM = { _tag: 'System' } as const
const SUPERVISOR = { _tag: 'Supervisor', name: 'worker runtime' } as const

const currentWorker = (runtime: Runtime, child: ChildAllocation) => {
  const { worker, generation } = child.reservation
  const parent = runtime.workers.get(worker)
  return parent?.reservation.generation === generation && !parent.fenced && !parent.ended
    ? parent : undefined
}
const parsed = (token: string) => /^w\.(.+)\.(\d+)\.([a-z0-9]+)$/.exec(token)
const parentMatches = (runtime: Runtime, child: ChildAllocation, token: string,
  allowSuccessor = false): boolean => {
  const match = parsed(token)
  const { parentActor, parentEpoch, worker, generation } = child.reservation
  const current = runtime.workers.get(worker)
  const parent = currentWorker(runtime, child) ??
    (allowSuccessor && current && !current.fenced && !current.ended &&
      current.reservation.generation > generation ? current : undefined)
  return match !== null && match[1] === parentActor &&
    parent?.binding?.members.some((member) => member.actor === parentActor &&
      member.epoch === Number(match[2]) && member.verifier === sha(match[3]!) &&
      (allowSuccessor || member.epoch === parentEpoch)) === true
}
const fieldsOf = ({ reservation }: ChildAllocation) => ({
  child: reservation.child, worker: reservation.worker, generation: reservation.generation,
  launch: reservation.launch,
})
const failure = (kind: RefusalName, message: string) => Effect.fail(workerRefusal(kind, message))

const stillOwed = (folded: WorkFolded, { reservation }: ChildAllocation): boolean => {
  const { state, permits } = folded
  if (state.top.ended) return false
  if (reservation.purpose === 'review') {
    const fix = state.fixes.get(reservation.subject)
    return permits.fixes.has(reservation.attempt) && fix?.stage === 'InLoop' &&
      fix.at === reservation.reviewBasis
  }
  return state.makers.get(reservation.actor.slice('maker:'.length))?.ended === false &&
    permits.roles.get(reservation.attempt) === reservation.parentActor &&
    state.tasks.get(reservation.attempt)?.state === 'Working' &&
    epochOf(state, actorOf(reservation.actor)) === reservation.epoch
}

export const reserveReviewChild = (parentToken: string, fix: string, on: number, turn: string) =>
  writeRuntime((events, folded) => {
    const runtime = foldRuntime(events)
    const match = parsed(parentToken)
    const placement = runtime.placements.find(({ members }) => members.includes('pipe'))
    const worker = placement === undefined ? undefined : runtime.workers.get(placement.worker)
    const actor = worker?.binding?.members.find((entry) => entry.actor === 'pipe')
    if (!worker || worker.fenced || worker.ended || !actor || match?.[1] !== 'pipe' ||
      Number(match[2]) !== actor.epoch || actor.verifier !== sha(match[3]!)) {
      return failure('authority', 'Only the current Pipe identity can reserve a draft reviewer.')
    }
    const offer = worker.offer
    const draft = folded.state.fixes.get(fix)
    if (!offer || offer.receiptVerifier !== sha(turn) || offer.actor !== 'pipe' ||
      offer.step.act !== 'LoopReview' || offer.step.fix !== fix || !currentOffer(folded.state, offer) ||
      !folded.permits.fixes.has(fix) || draft?.stage !== 'InLoop') {
      return failure('stale', 'Reserve a reviewer from the current LoopReview turn.')
    }
    if (offer.on !== on) return failure('basis', 'Use the basis from the LoopReview turn.')
    const limits = folded.policy.get('pipe')
    if (!limits || !limits.backgroundChildren || limits.subagentAllowance === 0) {
      return failure('legal', 'Staffing routes this review to self-review turns.')
    }
    const existing = [...runtime.children.values()].find(({ reservation, released }) =>
      reservation.purpose === 'review' && reservation.subject === fix && reservation.reviewBasis === draft.at &&
      reservation.worker === worker.reservation.worker && reservation.generation === worker.reservation.generation &&
      (released === null || released.reason === 'reported'))
    if (existing) return Effect.succeed(null)
    if (childLoad(runtime, 'pipe') >= limits.subagentAllowance) {
      return failure('cap', `Pipe is waiting for child capacity (allowance ${limits.subagentAllowance}).`)
    }
    const child = `child-${(events.at(-1)?.seq ?? 0) + 1}`
    return Effect.succeed({
      _tag: 'ChildReserved', child, worker: worker.reservation.worker, generation: worker.reservation.generation,
      launch: randomUUID().replaceAll('-', ''), parentActor: 'pipe', parentEpoch: actor.epoch, attempt: fix,
      purpose: 'review', subject: fix, on, execution: 'background', actor: `review:${child}`, epoch: 0,
      reviewBasis: draft.at,
    })
  }, SYSTEM)

export const authorizeChildStart = (id: string, parentToken: string, secret: string) =>
  writeRuntime((events, folded) => {
    const runtime = foldRuntime(events)
    const child = runtime.children.get(id)
    if (!child || !parentMatches(runtime, child, parentToken)) {
      return failure('authority', 'Only the current parent can launch this child.')
    }
    if (child.released || !stillOwed(folded, child)) {
      return failure('stale', 'The child reservation is no longer owed.')
    }
    return Effect.succeed(child.started ? null : {
      _tag: 'ChildStarted', ...fieldsOf(child), verifier: sha(secret),
    })
  }, SYSTEM)

export const acknowledgeChild = (token: string) =>
  writeRuntime((events, folded) => {
    const runtime = foldRuntime(events)
    const match = parsed(token)
    const child = match?.[1] === undefined ? undefined : childFor(runtime, match[1])
    if (!child) return failure('authority', 'There is no child for this credential.')
    if (!currentWorker(runtime, child) || child.released || folded.state.top.ended ||
      Number(match?.[2]) !== child.reservation.epoch || child.started?.verifier !== sha(match![3]!) ||
      !stillOwed(folded, child)) {
      return failure('epoch', 'This child allocation is no longer current.')
    }
    return Effect.succeed(child.binding ? null : {
      _tag: 'ChildBound', ...fieldsOf(child), handle: child.reservation.launch,
      verifier: child.started.verifier,
    })
  }, SUPERVISOR)

export const finishReviewChild = (token: string) =>
  writeRuntime((events, folded) => {
    const runtime = foldRuntime(events)
    const match = parsed(token)
    const child = match?.[1] === undefined ? undefined : childFor(runtime, match[1])
    if (!child || child.reservation.purpose !== 'review' || !currentWorker(runtime, child) ||
      Number(match?.[2]) !== child.reservation.epoch || child.binding?.verifier !== sha(match![3]!)) {
      return failure('authority', 'Only the bound review child can complete its allocation.')
    }
    if (child.released?.reason === 'reported') return Effect.succeed(null)
    if (child.released || !stillOwed(folded, child)) return failure('stale', 'This review is no longer owed.')
    return Effect.succeed({
      _tag: 'ChildReleased', ...fieldsOf(child), reason: 'reported', observation: 'Review child completed.',
    })
  }, SUPERVISOR)

// Native CLI observes termination or a failed launch. The responsible parent supplies that
// observation. A reserve that never authorized a launch requires no process observation.
export const reconcileChild = (id: string, parentToken: string, observation: string) =>
  writeRuntime((events) => {
    const runtime = foldRuntime(events)
    const child = runtime.children.get(id)
    if (!child || !parentMatches(runtime, child, parentToken, true)) {
      return failure('authority', 'Only the current parent can reconcile this child.')
    }
    if (child.released) return Effect.succeed(null)
    if (child.started && !observation.trim()) {
      return failure('legal', 'Supply the native CLI observation that the child exited or did not launch.')
    }
    return Effect.succeed({
      _tag: 'ChildReleased', ...fieldsOf(child),
      reason: child.binding ? 'exited' : 'never launched',
      observation: observation.trim()
        ? `Native CLI observation sha256:${sha(observation.trim())}`
        : 'No launch was authorized.',
    })
  }, SUPERVISOR)

export const settleGenerationChildren = (worker: string, generation: number) =>
  Effect.gen(function* () {
    for (;;) {
      const seq = yield* writeRuntime((events) => {
        const runtime = foldRuntime(events)
        // The parent session being gone proves an unissued launch cannot start. Native
        // launches already issued require a native exit observation, even after replacement.
        const child = [...runtime.children.values()].find(({ reservation, released, started }) =>
          reservation.worker === worker && reservation.generation === generation && released === null && started === null)
        if (!child) return Effect.succeed(null)
        const ended = events.some(({ event }) =>
          event._tag === 'Runtime' && event.create._tag === 'WorkerEnded' &&
          event.create.worker === worker && event.create.generation === generation)
        return Effect.succeed(ended ? {
          _tag: 'ChildReleased', ...fieldsOf(child), reason: 'generation ended',
          observation: 'Parent session ended before launch authorization.',
        } : null)
      }, SUPERVISOR)
      if (seq === null) return
    }
  })
