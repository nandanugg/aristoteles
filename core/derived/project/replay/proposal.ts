import { picked } from './itf.probe.ts'
import { integer, record, type readTrace } from './driver.ts'

type Trace = ReturnType<typeof readTrace>
type Kind = 'success' | 'fault' | 'mutant'
type Observation = Readonly<{
  phase: 'Drafting' | 'Reviewing' | 'WaitingForOwner' | 'Accepted'
  child: number
  lifetime: number
  session: 'Live' | 'Ended'
  visible: boolean
}>
export interface OnboardingReviewPort {
  readonly submit: () => Promise<void>
  readonly launch: (lifetime: number) => Promise<void>
  readonly exit: () => Promise<void>
  readonly recover: () => Promise<void>
  readonly report: (lifetime: number, child: number, holds: boolean) => Promise<'Committed' | 'RetiredSession'>
  readonly accept: (actor: number) => Promise<void>
  readonly observe: () => Promise<Observation>
}

const model = (step: Trace['states'][number]): Observation => {
  const { tag } = record(step.state.proposal!)
  const session = record(step.state.session!)
  if (session.tag !== 'Live' && session.tag !== 'Ended') throw new Error('Unexpected lifetime state')
  const phase = tag === 'ProposalReview' ? 'Reviewing' : tag
  if (phase !== 'Drafting' && phase !== 'Reviewing' && phase !== 'WaitingForOwner' && phase !== 'Accepted')
    throw new Error('Unexpected proposal state')
  return {
    phase, child: integer(step.state.child),
    lifetime: session.tag === 'Live' ? integer(record(session.value!).lifetime) : integer(session.value),
    session: session.tag, visible: phase === 'WaitingForOwner' || phase === 'Accepted',
  }
}
const compare = (actual: Observation, expected: Observation) => {
  for (const field of ['phase', 'child', 'lifetime', 'session', 'visible'] as const) {
    if (actual[field] !== expected[field])
      throw new Error('Onboarding replay differs for ' + field + ': ' + JSON.stringify({ expected, actual }))
  }
}

export const replayOnboardingReview = async (trace: Trace, kind: Kind, port: OnboardingReviewPort): Promise<void> => {
  let before = model(trace.states[0]!)
  let returned = false
  let stale = false
  compare(await port.observe(), before)
  for (const step of trace.states.slice(1)) {
    const after = model(step)
    switch (step.action) {
      case '': break
      case 'submitDraft': await port.submit(); break
      case 'openFreshChild': await port.launch(integer(picked(step.picks.lifetime))); break
      case 'exit': await port.exit(); break
      case 'recover': await port.recover(); break
      case 'acceptDraft': await port.accept(integer(picked(step.picks.actor))); break
      case 'report': {
        const source = picked(step.picks.source)
        const holds = picked(step.picks.holds)
        if (!Array.isArray(source) || typeof holds !== 'boolean') throw new Error('Missing review facts')
        const lifetime = integer(source[0])
        const child = integer(source[1])
        const applied = await port.report(lifetime, child, holds)
        const fresh = before.child === child && before.lifetime === lifetime && before.session === 'Live'
        if (kind === 'mutant' && !fresh && after.phase !== before.phase) {
          if (applied !== 'RetiredSession') throw new Error('Production accepted the obsolete review')
          compare(await port.observe(), before)
          return
        }
        if ((applied === 'Committed') !== fresh) throw new Error('Review authority differs from the model')
        returned ||= fresh && !holds
        stale ||= before.lifetime === 2 && lifetime === 1 && child === 2
        break
      }
      default: throw new Error('Unknown onboarding action: ' + step.action)
    }
    compare(await port.observe(), after)
    if (returned !== step.state.returnedOnce || stale !== step.state.staleTried || step.state.acceptedEarly)
      throw new Error('Onboarding replay differs on refusal or send-back history')
    before = after
  }
  if (kind === 'mutant') throw new Error('Onboarding mutant did not attempt a stale review')
}
