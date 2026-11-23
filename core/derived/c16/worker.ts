import type { Turn } from '../../schema/index.ts'
import type { WorkState } from '../../state/c16/state.ts'
import { actorOf, type Step } from '../../state/c16/types.ts'
import { dos, stepAge } from './obligations.ts'

// A step's age detects a replaced occurrence even if the same task or fix is owed again.
export const obligationOf = (s: WorkState, step: Step): string =>
  JSON.stringify([step.act, step.task, step.fix, step.ask, step.maker, step.actor, stepAge(s, step)])

export const workerSteps = (state: WorkState, members: ReadonlyArray<string>) =>
  [...members].sort().flatMap((actor) =>
    state.down.has(actor) ? [] : dos(state, actorOf(actor)).map((step, index) => ({ actor, step, index }))
  ).sort((a, b) => stepAge(state, a.step) - stepAge(state, b.step) ||
    a.index - b.index || a.actor.localeCompare(b.actor))

export const oldestWorkerStep = (state: WorkState, members: ReadonlyArray<string>,
  eligible: (actor: string, step: Step) => boolean = () => true,
) => workerSteps(state, members).find(({ actor, step }) => eligible(actor, step))

export const currentOffer = (s: WorkState, offer: Turn): boolean =>
  !s.top.ended && !s.down.has(offer.actor) &&
  dos(s, actorOf(offer.actor)).some((step) => obligationOf(s, step) === offer.obligation)
