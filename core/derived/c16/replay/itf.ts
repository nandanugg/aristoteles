// Quint's ITF traces (quint run --mbt --out-itf) as plain data: bigints are numbers, a set is a
// sorted array, a map is a Map, a variant without payload is its tag, a Maker is `Maker(n)`, an
// item is D | S<n> | R<n>. A step of the trace carries the action taken and its nondet picks
// (--mbt), which hold the act the model took.
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

export type Plain =
  | number
  | boolean
  | string
  | ReadonlyArray<Plain>
  | ReadonlyMap<string | number, Plain>
  | { readonly [field: string]: Plain }

const isObject = (v: unknown): v is { readonly [field: string]: unknown } =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const keyOf = (p: Plain): string | number =>
  typeof p === 'number' || typeof p === 'string' ? p : JSON.stringify(p)

// The names of the model's Item and Actor cases: one word each, so a state compares as text.
const variant = (tag: string, raw: unknown): Plain => {
  if (isObject(raw) && Array.isArray(raw['#tup']) && raw['#tup'].length === 0) {
    return tag === 'ItemDirection' ? 'D' : tag
  }
  const value = decode(raw)
  if (tag === 'Maker') return `Maker(${value})`
  if (tag === 'ItemStandard') return `S${value}`
  if (tag === 'ItemRule') return `R${value}`
  return { tag, value }
}

export const decode = (v: unknown): Plain => {
  if (typeof v === 'boolean' || typeof v === 'string' || typeof v === 'number') return v
  if (Array.isArray(v)) return v.map(decode)
  if (!isObject(v)) throw new Error(`not ITF: ${JSON.stringify(v)}`)
  if ('#bigint' in v) return Number(v['#bigint'])
  if ('#tup' in v) return (v['#tup'] as ReadonlyArray<unknown>).map(decode)
  if ('#set' in v) {
    return (v['#set'] as ReadonlyArray<unknown>).map(decode).sort((a, b) =>
      JSON.stringify(a) < JSON.stringify(b) ? -1 : 1
    )
  }
  if ('#map' in v) {
    return new Map(
      (v['#map'] as ReadonlyArray<readonly [unknown, unknown]>).map(([k, x]) =>
        [keyOf(decode(k)), decode(x)] as const
      ),
    )
  }
  if ('tag' in v && 'value' in v && typeof v['tag'] === 'string') {
    return variant(v['tag'], v['value'])
  }
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]))
}

// One state of a trace: the store, and (from the second state on) the step that led to it.
export interface TraceState {
  readonly store: Plain
  readonly action: string
  readonly picks: { readonly [name: string]: Plain }
}
export interface Trace {
  readonly instance: string
  readonly states: ReadonlyArray<TraceState>
}

export const readTrace = (path: string): Trace => {
  const raw = JSON.parse(
    (path.endsWith('.gz') ? gunzipSync(readFileSync(path)) : readFileSync(path)).toString('utf8'),
  ) as {
    readonly vars: ReadonlyArray<string>
    readonly states: ReadonlyArray<{ readonly [name: string]: unknown }>
  }
  const storeVar = raw.vars.find((x) => x.endsWith('::store'))
  if (storeVar === undefined) throw new Error(`${path}: no store variable`)
  return {
    instance: storeVar.split('::')[0] ?? '',
    states: raw.states.map((st) => ({
      store: decode(st[storeVar]),
      action: typeof st['mbt::actionTaken'] === 'string' ? st['mbt::actionTaken'] : '',
      picks: st['mbt::nondetPicks'] === undefined
        ? {}
        : decode(st['mbt::nondetPicks']) as { readonly [name: string]: Plain },
    })),
  }
}

// A pick is an Option: Some(value) or None.
export const picked = (p: Plain | undefined): Plain | null =>
  typeof p === 'object' && p !== null && !(p instanceof Map) && 'tag' in p && p['tag'] === 'Some'
    ? (p as { readonly value: Plain }).value
    : null
