// rowsOf on a hand-built Work: each table gets the columns and the words of the old rowsOf, and
// every row goes into the reader tables. The row-for-row compare with the old code on real
// stores is part (c), after the engine (P3) and the replay (P4).
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import type {
  AssignmentId,
  DirectionId,
  EvaluationId,
  ExhaustionId,
  PointId,
  PositiveInt,
  ProblemId,
  RejectId,
  ResultId,
  ReviewId,
  RevisionId,
  RoleName,
  RuleEntry,
  RunId,
  SessionId,
  StandardEntry,
  SuggestionId,
  TaskDraftId,
  TaskId,
  Time,
} from '../domain/ids.ts'
import { whereOf } from '../domain/context.ts'
import { noCounters } from '../domain/ids.ts'
import type { Direction, Limits, Revision } from '../domain/model.ts'
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
const t1 = 't1' as TaskId
const t2 = 't2' as TaskId
const a1 = 'a1' as AssignmentId
const a2 = 'a2' as AssignmentId
const r1 = 'r1' as ResultId
const h1 = 'h1' as RunId
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
  approvedBy: { _tag: 'Owner' },
  versions: [
    {
      of: tsd,
      number: one,
      revision: d1,
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
  approvedBy: { _tag: 'Owner' },
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
const unlimited: Limits = {
  Assignment: { briefChars: { _tag: 'Unlimited' }, attempts: { _tag: 'Unlimited' } },
  Review: { rules: { _tag: 'Unlimited' } },
  Result: { size: { _tag: 'Unlimited' } },
}

const work: Work = {
  config: {
    project: 'report-export',
    people: ['Nanda'],
    limits: { low: {}, medium: {}, high: {} },
    roles: {},
    decide: {},
  },
  hashes: {},
  texts: {},
  workflow: {
    system: 'report-export',
    owner: nanda,
    roles: new Map(),
    limits: unlimited,
    decide: new Map(),
  },
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
        origin: { _tag: 'Written', by: a1 },
        answers: ['v2.1' as PointId],
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
  suggestions: new Map([
    [
      's1' as SuggestionId,
      {
        id: 's1' as SuggestionId,
        about: { _tag: 'Standard', standard },
        says: 'Shorter.',
        by: nanda,
        when: at(3),
        at: 3,
      },
    ],
  ]),
  tasks: new Map([
    [
      t1,
      {
        id: t1,
        name: 'The Introduction',
        owner: nanda,
        descriptionHuman: 'Write the Introduction.',
        descriptionAi: {
          text: 'Write the Introduction.',
          partOf: null,
          directions: [tsd],
          references: [],
          notes: [],
          context: { section: { _tag: 'NoSection' }, facts: new Map() },
          from: null,
          workspace: [],
        },
        serves: { _tag: 'TopTask' },
        needs: [],
        when: at(4),
        end: { _tag: 'Replaced', by: nanda, reason: 'the scope grew', next: t2, when: at(20) },
        untouched: {
          _tag: 'AtFirstBrief',
          files: {},
          inPlace: { _tag: 'InPlace', texts: { 'docs/tsd.md': '# TSD\n' }, at: at(5) },
        },
      },
    ],
  ]),
  changes: [],
  assignments: new Map([
    [
      a1,
      {
        _tag: 'Reviewer',
        id: a1,
        actor: { _tag: 'Agent', name: 'Sol', run: 'a1' },
        role: 'architect' as RoleName,
        task: t1,
        under: new Map([[tsd, 1 as PositiveInt]]),
        parent: { _tag: 'GivenByPerson' },
        when: at(5),
        end: { _tag: 'Finished', when: at(25) },
      },
    ],
    [
      a2,
      {
        _tag: 'Maker',
        id: a2,
        actor: { _tag: 'Agent', name: 'Luna', run: 'a2' },
        role: 'writer' as RoleName,
        task: t1,
        under: new Map(),
        maxAttempts: { _tag: 'AtMost', max: 3 as PositiveInt },
        parent: { _tag: 'Parent', id: a1 },
        when: at(6),
        end: { _tag: 'NotEnded' },
      },
    ],
  ]),
  results: new Map([
    [
      r1,
      {
        id: r1,
        task: t1,
        by: a2,
        output: 'docs/tsd.md#introduction',
        madeFrom: [],
        work: { _tag: 'File', digest: 'abc', size: 3 },
        under: new Map([[tsd, 1 as PositiveInt]]),
        when: at(7),
        at: 7,
      },
    ],
  ]),
  reviews: new Map([
    [
      'v1' as ReviewId,
      {
        id: 'v1' as ReviewId,
        _tag: 'Accept',
        of: {
          _tag: 'Revision',
          id: d1,
          evidence: [
            {
              says: 'the whole direction',
              meets: null,
              at: 'directions/tsd-writing.yaml',
              uses: [],
            },
          ],
        },
        by: nanda,
        reason: null,
        under: new Map(),
        when: at(2),
        at: 2,
      },
    ],
    [
      'v2' as ReviewId,
      {
        id: 'v2' as RejectId,
        _tag: 'Reject',
        of: {
          _tag: 'Result',
          id: r1,
          points: [{ text: 'cites ABC-2964', breaks: { _tag: 'Rule', rule } }],
        },
        by: a1,
        under: new Map([[tsd, 1 as PositiveInt]]),
        when: at(8),
        at: 8,
      },
    ],
  ]),
  questions: new Map(),
  notes: new Map(),
  exhaustions: new Map(),
  evaluations: new Map([
    [
      'ev1' as EvaluationId,
      {
        id: 'ev1' as EvaluationId,
        answers: { _tag: 'Exhaustion', id: 'ex1' as ExhaustionId },
        by: a1,
        wrong: 'r1 cites the ticket',
        why: 'the facts name it first',
        improve: ['ids are not facts', 'say it in a standard'],
        level: 'principle',
        after: { _tag: 'FirstTry' },
        when: at(9),
        at: 9,
      },
    ],
  ]),
  permissions: new Map(),
  checkpoints: new Map(),
  meta: new Map(),
  forwards: new Map(),
  sources: new Map(),
  resultFiles: new Map([[r1, ['docs/tsd.md']]]),
  after: new Map(),
  runs: new Map([
    [
      h1,
      {
        _tag: 'Host',
        id: h1,
        session: 's-host' as SessionId,
        terminal: { _tag: 'Window' },
        formerSessions: [],
        startedAt: at(0),
        end: { _tag: 'Closed', at: at(30) },
      },
    ],
  ]),
  sessions: new Map([
    [a1, { assignment: a1, session: 's-host' as SessionId, at: at(5) }],
    [a2, { assignment: a2, session: 's-writer' as SessionId, at: at(6) }],
  ]),
  taskDrafts: new Map([
    [
      'td1' as TaskDraftId,
      {
        id: 'td1' as TaskDraftId,
        run: h1,
        task: {
          name: 'The Introduction',
          text: 'Write the Introduction.',
          directions: [tsd],
          context: {},
          needs: [],
          from: null,
          workspace: [],
          references: [],
        },
        role: 'architect',
        at: at(1),
        opened: { _tag: 'Opened', task: t1 },
      },
    ],
  ]),
  problems: new Map([
    [
      'sp1' as ProblemId,
      {
        id: 'sp1' as ProblemId,
        stopped: t1,
        says: 'the cluster is down',
        recordedBy: { _tag: 'Host', assignment: a1 },
        at: at(10),
        fixed: { _tag: 'Fixed', by: nanda, at: at(11) },
      },
    ],
  ]),
  terminalEvents: [
    {
      session: 's-writer' as SessionId,
      report: { _tag: 'Failed', why: 'silent', lastLines: 'no output' },
      at: at(12),
    },
    { session: 's-host' as SessionId, report: { _tag: 'Closed' }, at: at(31) },
  ],
  sends: [],
  hostWords: new Map(),
  events: [],
  counters: noCounters,
  clock: 31,
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
        by: 'a1',
        why: 'Correct the standard',
        at: at(1),
      },
    ])
    expect(rowsIn('answer')).toEqual([{ project: DIR, draft: 'd2', answers: 'v2.1' }])
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
      ['s1', 'suggestion'],
      ['v2.1', 'reason'],
    ])
  })

  test('suggestions, reviews and their evidence', () => {
    expect(rowsIn('suggestion')).toEqual([
      { project: DIR, id: 's1', about: standard, says: 'Shorter.', by: 'Nanda', at: at(3) },
    ])
    expect(rowsIn('review')).toEqual([
      {
        project: DIR,
        id: 'v1',
        of: 'd1',
        decision: 'Accept',
        reason: null,
        breaks: null,
        by: 'Nanda',
        at: at(2),
      },
      {
        project: DIR,
        id: 'v2.1',
        of: 'r1',
        decision: 'Reject',
        reason: 'cites ABC-2964',
        breaks: rule,
        by: 'a1',
        at: at(8),
      },
    ])
    expect(rowsIn('evidence')).toEqual([
      {
        project: DIR,
        review: 'v1',
        n: 0,
        rule: null,
        place: 'directions/tsd-writing.yaml',
        says: 'the whole direction',
      },
    ])
  })

  test('tasks, assignments, results and an evaluation', () => {
    expect(rowsIn('task')).toEqual([
      {
        project: DIR,
        id: 't1',
        name: 'The Introduction',
        text: 'Write the Introduction.',
        serves: null,
        owner: 'Nanda',
      },
    ])
    expect(rowsIn('task_direction')).toEqual([
      { project: DIR, task: 't1', direction: 'tsd-writing' },
    ])
    expect(rowsIn('task_closed')).toEqual([
      { project: DIR, task: 't1', reason: 'the scope grew', replaced_by: 't2', at: at(20) },
    ])
    expect(rowsIn('assignment')).toEqual([
      { project: DIR, id: 'a1', task: 't1', role: 'architect', parent: null, at: at(5) },
      { project: DIR, id: 'a2', task: 't1', role: 'writer', parent: 'a1', at: at(6) },
    ])
    expect(rowsIn('assignment_finished')).toEqual([{ project: DIR, assignment: 'a1' }])
    expect(rowsIn('brief')).toEqual([{ project: DIR, assignment: 'a1', version: 'tsd-writing@1' }])
    expect(rowsIn('result')).toEqual([
      {
        project: DIR,
        id: 'r1',
        task: 't1',
        assignment: 'a2',
        output: 'docs/tsd.md#introduction',
        at: at(7),
      },
    ])
    expect(rowsIn('result_version')).toEqual([
      { project: DIR, result: 'r1', version: 'tsd-writing@1' },
    ])
    expect(rowsIn('result_file')).toEqual([{ project: DIR, result: 'r1', file: 'docs/tsd.md' }])
    expect(rowsIn('task_before')).toEqual([
      { project: DIR, task: 't1', file: 'docs/tsd.md', text: '# TSD\n' },
    ])
    expect(rowsIn('evaluation')).toEqual([
      {
        project: DIR,
        id: 'ev1',
        answers: 'ex1',
        wrong: 'r1 cites the ticket',
        why: 'the facts name it first',
        improve: 'ids are not facts\nsay it in a standard',
        level: 'principle',
        by: 'a1',
        at: at(9),
      },
    ])
  })

  test('the UI: a run, its task draft, a problem, terminal events and a session', () => {
    expect(rowsIn('run')).toEqual([
      { project: DIR, id: 'h1', kind: 'host', session: 's-host', at: at(0) },
    ])
    expect(rowsIn('run_closed')).toEqual([{ project: DIR, run: 'h1', at: at(30) }])
    expect(rowsIn('run_task')).toEqual([{ project: DIR, run: 'h1', task: 't1' }])
    expect(rowsIn('task_draft')).toEqual([
      {
        project: DIR,
        id: 'td1',
        run: 'h1',
        name: 'The Introduction',
        text: 'Write the Introduction.',
        role: 'architect',
        opened_as: 't1',
        at: at(1),
      },
    ])
    expect(rowsIn('problem')).toEqual([
      {
        project: DIR,
        id: 'sp1',
        task: 't1',
        stopped: 't1',
        says: 'the cluster is down',
        by: 'a1',
        at: at(10),
      },
    ])
    expect(rowsIn('problem_fixed')).toEqual([
      { project: DIR, problem: 'sp1', by: 'Nanda', at: at(11) },
    ])
    expect(rowsIn('terminal_event')).toEqual([
      { project: DIR, on_id: 'a2', kind: 'silent', tries: 3, text: 'no output', at: at(12) },
      { project: DIR, on_id: 'h1', kind: 'closed', tries: 0, text: '', at: at(31) },
    ])
    expect(rowsIn('assignment_session')).toEqual([
      { project: DIR, assignment: 'a1', session: 's-host', at: at(5) },
      { project: DIR, assignment: 'a2', session: 's-writer', at: at(6) },
    ])
  })
})
