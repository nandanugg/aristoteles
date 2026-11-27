// Decode the Quint ITF values used by the Project witnesses.
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

const variant = (tag: string, raw: unknown): Plain =>
  isObject(raw) && Array.isArray(raw['#tup']) && raw['#tup'].length === 0 ? tag : { tag, value: decode(raw) }

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

// A pick is an Option: Some(value) or None.
export const picked = (p: Plain | undefined): Plain | null =>
  typeof p === 'object' && p !== null && !(p instanceof Map) && 'tag' in p && p['tag'] === 'Some'
    ? (p as { readonly value: Plain }).value
    : null
