import { Schema } from 'effect'

const Text = Schema.String
export const SubscriptionProvider = Schema.Literals(['Claude', 'ChatGPT'])
export type SubscriptionProvider = typeof SubscriptionProvider.Type
export const SubscriptionEstimate = Schema.Struct({
  share: Schema.Number.pipe(Schema.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))),
  basis: Text.pipe(Schema.refine((basis): basis is string => basis.trim().length > 0 && !/[\r\n]/.test(basis))),
})
export const Subscription = Schema.Struct({
  account: Text, provider: SubscriptionProvider, plan: Text,
  estimate: Schema.optionalKey(SubscriptionEstimate),
})
export type Subscription = typeof Subscription.Type

export const StaffArrangement = Schema.Struct({
  staff: Schema.Array(Schema.Struct({
    id: Text, model: Text, launch: Text, allowance: Schema.Int, account: Schema.NullOr(Text),
  })),
  assignments: Schema.Array(Schema.Struct({ role: Text, staff: Text })),
  subscriptions: Schema.Array(Subscription),
})
export type StaffArrangement = typeof StaffArrangement.Type

export const cliOfProvider = (provider: SubscriptionProvider) => provider === 'Claude' ? 'claude' : 'codex'

export const launchExecutable = (launch: string): string | null => {
  const first = launch.trim().match(/^(?:"([^"]+)"|'([^']+)'|([^\s|;&]+))/)
  return (first?.[1] ?? first?.[2] ?? first?.[3])?.split('/').at(-1) ?? null
}
