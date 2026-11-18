// Every row of the reader tables for a Work, as [table, row]; the store adds the rows that it does
// not have. The tests read them. Each Standard and Rule carries its entry (d1/facts-not-proof),
// made by the engine.
import type { Actor } from '../domain/actor.ts'
import { whereRecord } from '../domain/context.ts'
import { decisionOf, versionIdOf } from '../domain/derived.ts'
import type { By, Direction, Review, SuggestionAbout } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import type { ReaderRow } from '../services/store.ts'

type Value = string | number | null

// Who did an act: a person by name, a model run outside any top by its name and run.
const actorText = (actor: Actor) => ('run' in actor ? `${actor.name} run ${actor.run}` : actor.name)
const byText = (by: By) => actorText(by)

// The id that a suggestion is about; null: it asks for a new direction; roles: the roles (P7).
const aboutId = (about: SuggestionAbout): string | null => {
  switch (about._tag) {
    case 'NewDirection':
      return null
    case 'Roles':
      return 'roles'
    case 'Direction':
      return about.direction
    case 'Standard':
      return about.standard
    case 'Rule':
      return about.rule
  }
}

// The row of the review table for one Review: the draft that it decides, and its words.
const reviewRow = (v: Review): { of: string; reason: string | null } =>
  v._tag === 'Accept' ? { of: v.of.id, reason: v.reason } : { of: v.of.id, reason: v.of.reason }

export const rowsOf = (work: Work, dir: string): ReadonlyArray<ReaderRow> => {
  const rows: Array<ReaderRow> = []
  const add = (table: string, row: Readonly<Record<string, Value>>) =>
    rows.push([table, { project: dir, ...row }])
  const words = (place: string, kind: string, text: string | null) => {
    if (text) add('words', { place, kind, text })
  }

  // The official directions, then the ones that only a draft names, each once.
  const directions = new Map<string, Direction>()
  const official = [...work.directions.values()].filter((d) => d._tag === 'Official')
  for (const id of [...official.map((d) => d.id), ...[...work.drafts.values()].map((x) => x.of)]) {
    const d = work.directions.get(id)
    if (!d)
      throw new Error(`rowsOf: a draft names the direction ${id}, which the work does not have`)
    if (!directions.has(id)) directions.set(id, d)
  }
  for (const d of directions.values()) {
    add('direction', { id: d.id, name: d.name, owner: d.owner.name, principles: d.from.join(', ') })
  }

  for (const x of work.drafts.values()) {
    add('draft', {
      id: x.id,
      direction: x.of,
      base: x._tag === 'Change' ? x.base : null,
      says: x.says,
      // An import's old author was the refresh as a run of its commit; an onboarded draft's
      // author is the store start of onboarding, by its event.
      by:
        x.origin._tag === 'Written'
          ? byText(x.origin.by)
          : x.origin._tag === 'Imported'
            ? `refresh run ${x.origin.commit}`
            : `onboarding ${x.origin.event}`,
      // The old column held the reviser's words: its words when given, else its reason.
      why: x.why._tag === 'Given' ? (x.why.words ?? x.why.reason) : null,
      at: x.when,
    })
    words(x.id, 'draft', x.says)
    for (const y of x.answers) add('answer', { draft: x.id, answers: y })
    for (const entry of x.standards) {
      const s = work.standards.get(entry)
      if (!s)
        throw new Error(`rowsOf: the draft ${x.id} names the standard ${entry}, which is missing`)
      add('standard', {
        id: s.entry,
        key: s.id,
        says: s.says,
        where: s.where._tag === 'Where' ? JSON.stringify(whereRecord(s.where)) : null,
      })
      add('draft_standard', { draft: x.id, standard: s.entry })
      words(s.entry, 'standard', s.says)
      for (const ruleEntry of s.rules) {
        const r = work.rules.get(ruleEntry)
        if (!r)
          throw new Error(
            `rowsOf: the standard ${s.entry} names the rule ${ruleEntry}, which is missing`,
          )
        add('rule', {
          id: r.entry,
          key: r.id,
          says: r.says,
          checked_by: r.checkedBy._tag === 'Role' ? r.checkedBy.role : null,
        })
        add('standard_rule', { standard: s.entry, rule: r.entry })
        words(r.entry, 'rule', r.says)
      }
    }
  }

  for (const d of official) {
    if (d._tag !== 'Official') continue
    for (const v of d.versions) {
      const origin = d.source._tag === 'External' ? d.source : null
      const made = work.drafts.get(v.revision)?.origin
      const source =
        made?._tag === 'Imported' && origin ? `${origin.repo} ${origin.path}@${made.commit}` : null
      add('version', {
        id: versionIdOf(v),
        direction: d.id,
        number: v.number,
        draft: v.revision,
        source,
        at: v.when,
      })
    }
  }

  for (const y of work.suggestions.values()) {
    add('suggestion', {
      id: y.id,
      about: aboutId(y.about),
      says: y.says,
      by: byText(y.by),
      at: y.when,
    })
    words(y.id, 'suggestion', y.says)
  }

  for (const v of work.reviews.values()) {
    const { of, reason } = reviewRow(v)
    add('review', { id: v.id, of, decision: decisionOf(v), reason, by: byText(v.by), at: v.when })
    words(v.id, 'reason', reason)
  }
  return rows
}
