// User-owned staffing for one project directory. Responsibility files can be read separately.
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { NonBlank, PositiveInt } from '../domain/ids.ts'
import { Files } from '../services/outside.ts'
import { fail, parseYaml, refusing } from './core.ts'

export const STAFFING = '.work/staffing.yaml'

const RoleStaffing = Schema.Struct({
  account: NonBlank,
  cli: NonBlank,
  allowedModels: Schema.Array(NonBlank),
  model: NonBlank,
  persistent: Schema.Boolean,
  concurrency: PositiveInt,
  subagentAllowance: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  ),
  launch: NonBlank,
})

const Staffing = Schema.Struct({
  models: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  clis: Schema.Record(Schema.String, Schema.Struct({ backgroundChildren: Schema.Boolean })),
  accounts: Schema.Record(Schema.String, Schema.Struct({
    limits: Schema.Record(Schema.String, NonBlank),
  })),
  roles: Schema.Record(Schema.String, RoleStaffing),
})
export type Staffing = typeof Staffing.Type

export const staffingOf = (raw: unknown): Staffing => {
  const result = Schema.decodeUnknownResult(Staffing, { onExcessProperty: 'error' })(raw)
  if (result._tag === 'Failure') return fail(STAFFING, String(result.failure).replace(/\s*\n\s*/g, ' '))
  const staffing = result.success
  for (const [name, role] of Object.entries(staffing.roles)) {
    const path = `roles.${name}`
    if (!Object.hasOwn(staffing.accounts, role.account)) {
      fail(STAFFING, `${path}.account names an unknown account`)
    }
    if (!Object.hasOwn(staffing.clis, role.cli)) {
      fail(STAFFING, `${path}.cli names an unknown CLI`)
    }
    if (!role.launch.includes('{session}')) {
      fail(STAFFING, `${path}.launch needs {session}`)
    }
    if (!role.allowedModels.includes(role.model)) {
      fail(STAFFING, `${path}.model must be one of its allowed models`)
    }
    if (new Set(role.allowedModels).size !== role.allowedModels.length) {
      fail(STAFFING, `${path}.allowedModels lists a model twice`)
    }
  }
  return staffing
}

export const staffingOfText = (text: string | null): Staffing | null =>
  text === null ? null : staffingOf(parseYaml(text))

export const readStaffing = (dir: string) =>
  Effect.gen(function* () {
    const text = yield* (yield* Files).read(join(dir, STAFFING))
    return yield* refusing(() => staffingOfText(text))
  })
