import { Schema } from 'effect'
import { EventNumber, VersionNumber, type Of } from './values.ts'

export const versionOf = <S extends Schema.Top>(value: S) =>
  Schema.Struct({ number: VersionNumber, value, acceptedAt: EventNumber })

export type Version<T> = Of<ReturnType<typeof versionOf<Schema.Schema<T>>>>
