// rowsOf on a hand-built Work: each table gets its columns and its words, and every row goes into
// the reader tables.
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import type {
  DirectionId,
  PositiveInt,
  RejectId,
  ReviewId,
  RevisionId,
  RoleName,
  RuleEntry,
  StandardEntry,
  Time,
} from '../domain/ids.ts'
import { whereOf } from '../domain/context.ts'
import { noCounters } from '../domain/ids.ts'
import type { Direction, Revision } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'
import { rowsOf } from './rows.ts'
import { READER_TABLES } from './schema.ts'

const DIR = '/work/report-export'
const at = (minute: number) => `2026-10-25T09:${String(minute).padStart(2, '0')}:00.000Z` as Time
const tsd = 'tsd-writing' as DirectionId
const hld = 'hld-writing' as DirectionId
const d1 = 'd1' as RevisionId
const d2 = 'd2' as RevisionId
const standard = 'd1/facts-not-proof' as StandardEntry
const rule = 'd1/facts-not-proof/no-ticket-ids' as RuleEntry
const nanda = { _tag: 'Human', name: 'Nanda' } as const
const assess = { _tag: 'Agent', name: 'assess', run: '2026-10-25T09:00:00.000Z' } as const
const one = 1 as PositiveInt

const company = {
  repo: '/company',
  path: 'directions/tsd',
  ref: { _tag: 'DefaultBranch' },
  commit: 'abc123',
} as const
const official: Direction = {
  _tag: 'Official',
  id: tsd,
  name: 'TSD writing',
  owner: nanda,
  from: ['Pathos', 'Logos'],
  maxStandards: { _tag: 'Unlimited' },
  versions: [
    {
      of: tsd,
      number: one,
      revision: d1,
      // Nanda, 2026-11-15: a direction has a summary, and a flow (none here).
      summary: 'The reader decides from the page.',
      flow: [],
      says: 'The reader decides from the page.',
      standards: [standard],
      when: at(2),
    },
  ],
  source: { _tag: 'External', repo: company.repo, path: company.path },
}
const drafted: Direction = {
  _tag: 'NewDirection',
  id: hld,
  name: 'HLD writing',
  owner: nanda,
  from: [],
  maxStandards: { _tag: 'Unlimited' },
  source: { _tag: 'Local' },
}
const revision = (
  id: RevisionId,
  of: DirectionId,
  more: Partial<Revision<Direction>>,
): Revision<Direction> => ({
  _tag: 'New',
  id,
  of,
  says: 'The reader decides from the page.',
  standards: [],
  origin: { _tag: 'Written', by: assess },
  answers: [],
  why: { _tag: 'NoneGiven' },
  when: at(1),
  at: 1,
  ...more,
} as Revision<Direction>)
const work: Work = {
  config: {
    project: 'report-export',
    people: ['Nanda'],
    models: {},
    roles: {},
    decide: {},
  },
  hashes: {},
  texts: {},
  fits: new Map(),
  directions: new Map<DirectionId, Direction>([
    [tsd, official],
    [hld, drafted],
  ]),
  drafts: new Map([
    // The company draft that made tsd-writing@1.
    [
      d1,
      revision(d1, tsd, {
        standards: [standard],
        origin: { _tag: 'Imported', commit: company.commit, ref: company.ref },
      }),
    ],
    [
      d2,
      revision(d2, hld, {
        origin: { _tag: 'Written', by: assess },
        answers: ['v2' as RejectId],
        why: { _tag: 'Given', reason: 'Correct the standard', words: null },
      }),
    ],
  ]),
  standards: new Map([
    [
      standard,
      {
        entry: standard,
        id: 'facts-not-proof',
        says: 'The body states facts.',
        where: whereOf({ section: 'introduction' }),
        rules: [rule],
      },
    ],
  ]),
  rules: new Map([
    [
      rule,
      {
        entry: rule,
        id: 'no-ticket-ids',
        says: 'No ticket ids.',
        checkedBy: { _tag: 'Role', role: 'linter' as RoleName },
        supersedes: [],
      },
    ],
  ]),
  reviews: new Map([
    [
      'v1' as ReviewId,
      {
        id: 'v1' as ReviewId,
        _tag: 'Accept',
        of: { _tag: 'Revision', id: d1 },
        by: nanda,
        reason: null,
        when: at(2),
        at: 2,
      },
    ],
    [
      'v2' as ReviewId,
      {
        id: 'v2' as RejectId,
        _tag: 'Reject',
        of: { _tag: 'Revision', id: d2, reason: 'too thin' },
        by: nanda,
        when: at(8),
        at: 8,
      },
    ],
  ]),
  sources: new Map(),
  sends: [],
  events: [],
  counters: noCounters,
  clock: 8,
}

const rows = rowsOf(work, DIR)
const rowsIn = (table: string) => rows.filter(([t]) => t === table).map(([, row]) => row)

describe('the rows of a Work', () => {
  test('every row names its dir, and goes into the reader tables', () => {
    expect(rows.every(([, row]) => row.project === DIR)).toBe(true)
    const db = new Database(':memory:')
    db.exec(READER_TABLES)
    for (const [table, row] of rows) {
      const keys = Object.keys(row)
      const columns = keys.map((k) => `"${k}"`).join(', ')
      db.query(`INSERT INTO ${table} (${columns}) VALUES (${keys.map(() => '?').join(', ')})`).run(
        ...keys.map((k) => row[k] ?? null),
      )
    }
    db.close()
  })

  test('the directions: the official one, then the one that only a draft names', () => {
    expect(rowsIn('direction')).toEqual([
      {
        project: DIR,
        id: 'tsd-writing',
        name: 'TSD writing',
        owner: 'Nanda',
        principles: 'Pathos, Logos',
      },
      { project: DIR, id: 'hld-writing', name: 'HLD writing', owner: 'Nanda', principles: '' },
    ])
    expect(rowsIn('version')).toEqual([
      {
        project: DIR,
        id: 'tsd-writing@1',
        direction: 'tsd-writing',
        number: 1,
        draft: 'd1',
        source: '/company directions/tsd@abc123',
        at: at(2),
      },
    ])
  })

  test('the drafts, their answers, standards and rules, and their words', () => {
    expect(rowsIn('draft')).toEqual([
      {
        project: DIR,
        id: 'd1',
        direction: 'tsd-writing',
        base: null,
        says: 'The reader decides from the page.',
        // The old author of a company import: the refresh, as a run of its commit.
        by: 'refresh run abc123',
        why: null,
        at: at(1),
      },
      {
        project: DIR,
        id: 'd2',
        direction: 'hld-writing',
        base: null,
        says: 'The reader decides from the page.',
        by: 'assess run 2026-10-25T09:00:00.000Z',
        why: 'Correct the standard',
        at: at(1),
      },
    ])
    expect(rowsIn('answer')).toEqual([{ project: DIR, draft: 'd2', answers: 'v2' }])
    expect(rowsIn('standard')).toEqual([
      {
        project: DIR,
        id: standard,
        key: 'facts-not-proof',
        says: 'The body states facts.',
        where: '{"section":"introduction"}',
      },
    ])
    expect(rowsIn('rule')).toEqual([
      {
        project: DIR,
        id: rule,
        key: 'no-ticket-ids',
        says: 'No ticket ids.',
        checked_by: 'linter',
      },
    ])
    expect(rowsIn('words').map((w) => [w.place, w.kind])).toEqual([
      ['d1', 'draft'],
      [standard, 'standard'],
      [rule, 'rule'],
      ['d2', 'draft'],
      ['v2', 'reason'],
    ])
  })

  test('reviews', () => {
    expect(rowsIn('review')).toEqual([
      {
        project: DIR,
        id: 'v1',
        of: 'd1',
        decision: 'Accept',
        reason: null,
        by: 'Nanda',
        at: at(2),
      },
      {
        project: DIR,
        id: 'v2',
        of: 'd2',
        decision: 'Reject',
        reason: 'too thin',
        by: 'Nanda',
        at: at(8),
      },
    ])
  })
})
