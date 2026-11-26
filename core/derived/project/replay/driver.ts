import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { Schema } from 'effect'
import { decode, picked, type Plain } from '../../c16/replay/itf.ts'

const registry = 'core/model/checks/registry.tsv'

export const registeredChecks = (root: string): readonly string[] => {
  const seen = new Set<string>()
  for (const row of readFileSync(root + '/' + registry, 'utf8').split('\n')) {
    if (!row || row.startsWith('#')) continue
    const [name, classes, target, cutoff, ...extra] = row.split('\t')
    if (!name || !/^[a-z][a-zA-Z0-9]*$/.test(name) || !classes || target !== '120' ||
        cutoff !== '600' || extra.length || seen.has(name)) throw new Error('Invalid model registry row: ' + row)
    seen.add(name)
  }
  if (!seen.size) throw new Error('Empty model registry')
  return [...seen]
}

const readTraceJson = Schema.decodeUnknownSync(Schema.Struct({
  '#meta': Schema.Struct({ modelRevision: Schema.String, status: Schema.Literal('violation') }),
  vars: Schema.Array(Schema.String),
  states: Schema.NonEmptyArray(Schema.Record(Schema.String, Schema.Unknown)),
}))

export const record = (value: Plain): Readonly<Record<string, Plain>> => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Map))
    return value as Readonly<Record<string, Plain>>
  throw new Error('Expected a record in the ITF state')
}

export const readTrace = (file: string, check: string, kind: 'success' | 'fault' | 'mutant') => {
  const raw = readTraceJson(JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')))
  const instance = kind === 'mutant' ? check + 'Mutant' : check
  const variable = raw.vars.find((name) => name.startsWith(instance + '::') && name.endsWith('::state'))
  if (!variable || !/^[a-f0-9]{40}$/.test(raw['#meta'].modelRevision)) throw new Error('Unexpected ITF source: ' + file)
  const states = raw.states.map((row) => {
    const action = row['mbt::actionTaken']
    if (typeof action !== 'string' || row['mbt::nondetPicks'] === undefined)
      throw new Error('Missing action instrumentation: ' + file)
    return { action, picks: record(decode(row['mbt::nondetPicks'])), state: record(decode(row[variable])) }
  })
  if (states.length < 2 || states[0]?.action !== 'init') throw new Error('Missing trace prefix: ' + file)
  return { states, modelRevision: raw['#meta'].modelRevision }
}

type TaskObservation = {
  readonly phase: 'Sent' | 'Working' | 'ReadyToReview' | 'Reviewing'
  readonly attempt: number
  readonly retryCount: number
  readonly writes: readonly number[]
}

export const integer = (value: Plain | null | undefined): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new Error('Expected an ITF integer')
}

const observation = (state: Readonly<Record<string, Plain>>): TaskObservation => {
  const task = record(state.task!)
  const phase = task.tag
  if (phase !== 'Sent' && phase !== 'Working' && phase !== 'ReadyToReview' && phase !== 'Reviewing')
    throw new Error('Unexpected race phase: ' + phase)
  const payload = record(task.value!)
  const work = phase === 'Reviewing' ? record(record(payload.result!).attempt!)
    : phase === 'ReadyToReview' ? record(payload.attempt!) : payload
  if (!Array.isArray(state.writes)) throw new Error('The trace is missing its append sequence')
  return {
    phase,
    attempt: integer(phase === 'Sent' ? work.last : work.number),
    retryCount: integer(work.retries),
    writes: state.writes.map(integer),
  }
}

export interface RacePort {
  readonly begin: () => Promise<void>
  readonly report: () => Promise<'Committed' | 'Refused'>
  readonly commands: () => Promise<void>
  readonly observe: () => Promise<TaskObservation>
}

const compare = (actual: TaskObservation, expected: TaskObservation): void => {
  if (actual.phase !== expected.phase || actual.attempt !== expected.attempt || actual.retryCount !== expected.retryCount ||
      actual.writes.length !== expected.writes.length || actual.writes.some((write, i) => write !== expected.writes[i]))
    throw new Error('Replay differs: ' + JSON.stringify({ expected, actual }))
}

export const replayReportRace = async (
  trace: ReturnType<typeof readTrace>, kind: 'success' | 'fault' | 'mutant', port: RacePort,
) => {
  let previous = observation(trace.states[0]!.state)
  let pending: number | null = null
  let interrupted = false
  let duplicateRefused = false
  const delivered = new Set<number>()
  await port.observe().then((actual) => compare(actual, previous))
  for (const step of trace.states.slice(1)) {
    const expected = observation(step.state)
    let guardedFault = false
    switch (step.action) {
      case '': break
      case 'begin': await port.begin(); break
      case 'prepare': {
        pending = integer(picked(step.picks.copy))
        if (pending !== 1 && pending !== 2) throw new Error('Unknown report copy')
        break
      }
      case 'interrupt':
        if (pending === null) throw new Error('Interrupt without a prepared delivery')
        pending = null
        interrupted = true
        break
      case 'commitResult': {
        if (pending === null || delivered.has(pending)) throw new Error('No unconsumed delivery')
        delivered.add(pending)
        pending = null
        const result = await port.report()
        const mayApply = previous.phase === 'Working'
        if ((result === 'Committed') !== mayApply) throw new Error('Production report guard disagrees with its phase')
        duplicateRefused ||= result === 'Refused'
        guardedFault = kind === 'mutant' && expected.writes.length > previous.writes.length && !mayApply
        break
      }
      case 'testCommands': await port.commands(); break
      default: throw new Error('Unknown race action: ' + step.action)
    }
    compare(await port.observe(), guardedFault ? previous : expected)
    if (guardedFault) return { interrupted, duplicateRefused, guardedFault }
    previous = expected
  }
  if (kind === 'mutant') throw new Error('The mutant did not reach the duplicate append')
  if (kind === 'success' && (previous.phase !== 'Reviewing' || previous.writes.length !== 1))
    throw new Error('The success trace did not reach the command seam')
  if (kind === 'fault' && (!interrupted || !duplicateRefused || delivered.size !== 2 || previous.writes.length !== 1))
    throw new Error('The fault trace did not exercise interruption and both copies')
  return { interrupted, duplicateRefused, guardedFault: false }
}
