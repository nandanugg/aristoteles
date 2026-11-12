// The context of a task and the where of a standard: from the files' form (a record of named
// keys, in the file's order) to the closed types of model.ts, and back for the words and the SQL.
// The files are read with their keys checked (config.ts), so every key here is a ContextKey.
// A Map keeps the order of the file and holds each key once. The key section is the one that
// the CLI acts on; the others are facts.
import type { ContextFile, ContextKey } from './files.ts'
import type { ConditionKey, Context, FactKey, NonEmptyMap, Text, Where } from './model.ts'

const entriesOf = (record: ContextFile) => Object.entries(record) as Array<[ContextKey, string]>

export const contextOf = (record: ContextFile): Context => {
  const section: Context['section'] =
    record.section === undefined ? { _tag: 'NoSection' } : { _tag: 'Section', id: record.section }
  const facts = new Map<FactKey, Text>()
  for (const [key, value] of entriesOf(record)) if (key !== 'section') facts.set(key, value)
  return { section, facts }
}

// A where with no key applies everywhere, as the old engine read it. The only maker of a
// NonEmptyMap: it has a key here.
export const whereOf = (record: ContextFile | undefined): Where => {
  const conditions: ReadonlyMap<ConditionKey, Text> = new Map(entriesOf(record ?? {}))
  return conditions.size === 0
    ? { _tag: 'Everywhere' }
    : { _tag: 'Where', conditions: conditions as NonEmptyMap<ConditionKey, Text> }
}

// The where as its file wrote it (the words print it as JSON; the SQL keeps it); null: none.
export const whereRecord = (where: Where): ContextFile | null =>
  where._tag === 'Everywhere'
    ? null
    : Object.fromEntries(where.conditions)

// The value of a key in a task's context; undefined: the task names none.
export const valueAt = (context: Context, key: ConditionKey): string | undefined =>
  key === 'section'
    ? context.section._tag === 'Section'
      ? context.section.id
      : undefined
    : context.facts.get(key)

export const sectionOf = (context: Context): string | null =>
  context.section._tag === 'Section' ? context.section.id : null

// A standard applies where each of its conditions matches the task's context.
export const applies = (where: Where, context: Context): boolean =>
  where._tag === 'Everywhere' ||
  [...where.conditions].every(([key, equals]) => valueAt(context, key) === equals)
