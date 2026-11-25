import { Schema } from 'effect'

const Text = Schema.String
export const StaffArrangement = Schema.Struct({
  staff: Schema.Array(Schema.Struct({
    id: Text, model: Text, launch: Text, allowance: Schema.Int, account: Schema.NullOr(Text),
  })),
  assignments: Schema.Array(Schema.Struct({ role: Text, staff: Text })),
  subscriptions: Schema.Array(Schema.Struct({ account: Text, plan: Text })),
})
export type StaffArrangement = typeof StaffArrangement.Type

export const launchExecutable = (launch: string): string | null => {
  const first = launch.trim().match(/^(?:"([^"]+)"|'([^']+)'|([^\s|;&]+))/)
  return (first?.[1] ?? first?.[2] ?? first?.[3])?.split('/').at(-1) ?? null
}
