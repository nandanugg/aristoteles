// The content checks of a draft and an import (package P5b, gap 2): the cases of the old engine's
// tests, through the actions over a scenario store of the harness. Each invalid input gets the old
// engine's words and a real choice; a valid one makes its event.
import { beforeAll, describe, expect, test } from 'bun:test'
import { Exit } from 'effect'
import type { Derived } from '../derived/index.ts'
import type { Author, Time } from '../schema/index.ts'
import {
  act,
  derivedIn,
  derivedOf,
  dispatchIn,
  events,
  h,
  NANDA,
  ok,
  type Project,
  refused,
  workOf,
} from './fixture.test.ts'
import type { ActionInput, Refusal } from './types.ts'

const NO_WHY = { reason: null, words: null }
const REVISER = (p: Project): Author => ({
  _tag: 'ModelRun',
  name: 'reviser',
  at: p.now() as Time,
})
const ASSESS = (p: Project): Author => ({ _tag: 'ModelRun', name: 'assess', at: p.now() as Time })
const realChoice = (r: Refusal): Refusal => {
  expect(r.choice.words.trim()).not.toBe('')
  return r
}
const refusedWith = (d: Derived, by: Author, input: ActionInput): string =>
  realChoice(refused(act(d, by, input))).message

// A model run outside any task: the host that adds the examples of a company draft.
const HOST_RUN = { _tag: 'ModelRun', name: 'host', at: '2026-10-25T08:00:00.000Z' } as Author
// P10 rejected, onboarding 2026-11-14: a new direction starts with its examples.
// Nanda, 2026-11-15: a direction has a summary, and a flow with the steps that it governs marked.
const REELS = `id: reels
name: Reels
owner: Nanda
summary: A reel shows one flow, so a person follows it at once.
flow:
  - from: writer
    to: docs/tsd.md
    says: writes the reel
    uses: [reels, one-flow]
says: A reel shows one flow.
standards:
  - id: one-flow
    says: One flow per reel.
    rules:
      - { id: one-flow-only, says: "The reel shows one flow", evidence: { scope: { searched: [docs/tsd.md], unknown: [] }, check: { _tag: Absent }, knownBreaks: [], cases: [ { fit: Follows, output: { file: docs/tsd.md, line: 3, excerpt: "## Introduction" } }, { fit: Breaks, output: { file: docs/tsd.md, line: 5, excerpt: TODO } } ] }, checkedBy: section-lead }
`

// The started scenario, and the person's Reject of a first draft of a new direction, Reels.
describe('a draft of a direction', () => {
  let p: Project
  let d: Derived
  let reelsDraft = ''
  let reelsReject = ''
  beforeAll(async () => {
    p = (await h.started()).p
    p.write('reels.yaml', REELS)
    const drafted = ok(await p.agent('direction new --file=reels.yaml --by=assess')).out
    reelsDraft = /^(d\d+) drafted/m.exec(drafted)?.[1] ?? ''
    const no = ok(await p.nanda(`direction reject ${reelsDraft} --reason="too thin"`))
    reelsReject = /\b(v\d+)\b/.exec(no.out)?.[1] ?? ''
    d = derivedIn(p)
  }, 60000)

  const revise = (file: string, yaml: string, answers: ReadonlyArray<string> = []) => {
    p.write(file, yaml)
    const content = { file, answers: answers as never, why: NO_WHY }
    return {
      _tag: 'ReviseDirection',
      target: { direction: 'tsd-writing' as never },
      content,
    } as const
  }
  const draft = (file: string, yaml: string, answers: ReadonlyArray<string> = []) => {
    p.write(file, yaml)
    return {
      _tag: 'DraftDirection',
      target: {},
      content: { file, answers: answers as never, why: NO_WHY },
    } as const
  }

  test('the setup has its ids', () => {
    expect([reelsDraft, reelsReject].map((x) => /^[vd]\d+$/.test(x))).toEqual([true, true])
  })

  test('a revise names only standards that exist, and adds none twice', () => {
    expect(refusedWith(d, REVISER(p), revise('r1.yaml', 'remove: [none]\n'))).toBe(
      'TSD writing has no standard "none"',
    )
    const twice = 'add:\n  - { id: facts-not-proof, says: Facts. }\n'
    expect(refusedWith(d, REVISER(p), revise('r2.yaml', twice))).toBe(
      'TSD writing already has the standard "facts-not-proof"',
    )
  })

  test('a rule id names one rule in the project', () => {
    const yaml =
      'add:\n  - id: again\n    says: Again.\n    rules:\n' +
      '      - { id: repeatable, says: Another words }\n'
    expect(refusedWith(d, REVISER(p), revise('r3.yaml', yaml))).toBe(
      'the rule id "repeatable" is already used; a new rule needs a new id',
    )
  })

  test('supersedes names other rules of the current version; a person checks no rule', () => {
    const rule = (file: string, r: string) =>
      refusedWith(
        d,
        REVISER(p),
        revise(file, `add:\n  - id: s\n    says: S.\n    rules:\n      - ${r}\n`),
      )
    expect(rule('r4.yaml', '{ id: self, says: s, supersedes: [self] }')).toBe(
      'rule self supersedes itself; a changed rule keeps its id, and supersedes names other rules',
    )
    expect(rule('r5.yaml', '{ id: g, says: s, supersedes: [nothing] }')).toBe(
      'rule g supersedes "nothing", which is not in the current version',
    )
    expect(rule('r6.yaml', '{ id: h, says: h, checkedBy: Human }')).toBe(
      'rule h is checked by Human; the person approves directions and standards, not results: ' +
        'name the role that reviews it',
    )
  })

  test('a where names the closed context keys', () => {
    const yaml = 'add:\n  - { id: w1, says: x, where: { stage: y } }\n'
    expect(refusedWith(d, REVISER(p), revise('r7.yaml', yaml))).toBe(
      'r7.yaml: standard w1: where key "stage" is not one of system, field, language, repo, ' +
        'section, audience, output',
    )
  })

  test('a Reject of a draft is answered by a draft of its own direction', () => {
    expect(refusedWith(d, REVISER(p), revise('b1.yaml', 'says: Plain.\n', [reelsReject]))).toBe(
      '"too thin" rejects a draft of Reels, not of TSD writing',
    )
    expect(refusedWith(d, REVISER(p), revise('b2.yaml', 'says: Plain.\n', ['v1']))).toBe(
      'v1 is not a Reject of a draft; --answers takes Rejects (v<n>)',
    )
  })

  test('a new direction answers the Rejects of its own drafts', () => {
    expect(refusedWith(d, ASSESS(p), draft('n1.yaml', REELS, [reelsReject]))).toBe(
      `this draft proposes the same as ${reelsDraft}, so it cannot answer "too thin"`,
    )
    expect(refusedWith(d, ASSESS(p), draft('n4.yaml', REELS, ['v1']))).toBe(
      'a draft answers Rejects of drafts only',
    )
    const better = REELS.replace('A reel shows one flow.', 'A reel shows one flow, end to end.')
    const made = events(act(d, ASSESS(p), draft('n5.yaml', better, [reelsReject])))
    expect(made).toHaveLength(1)
  })

  test('a new direction keeps its limit of standards, and a rule id of another', () => {
    const e = '[{ fit: Follows, output: { written: x } }, { fit: Breaks, output: { written: y } }]'
    const flow = 'flow: [{ from: a, to: b, says: c, uses: [big] }]'
    const evidence = `{ scope: { searched: [a], unknown: [] }, check: { _tag: Absent }, knownBreaks: [], cases: ${e} }`
    const big = `id: big\nname: Big\nowner: Nanda\nsummary: Big.\n${flow}\nsays: Big.\nmaxStandards: 1\nstandards:
  - { id: one, says: One., rules: [ { id: big-one, says: One rule., evidence: ${evidence} } ] }
  - { id: two, says: Two. }
`
    expect(refusedWith(d, ASSESS(p), draft('m1.yaml', big))).toBe(
      'Big would have 2 standards; the limit is 1: remove or merge one, or move some to a new ' +
        'direction (work guide limits)',
    )
    const twin = REELS.replace('id: reels', 'id: twin')
      .replace('uses: [reels', 'uses: [twin')
      .replace('one-flow-only', 'repeatable')
    expect(refusedWith(d, ASSESS(p), draft('m2.yaml', twin))).toBe(
      'the rule id "repeatable" is already used; a new rule needs a new id',
    )
  })
})

// N8: a whole direction drafted again by a model is its revise, with the revise's checks.
describe('a whole direction drafted again by a model', () => {
  test('runs the checks of a revise', async () => {
    const { p } = await h.started()
    p.write('again.yaml', h.DIRECTION.replace('checkedBy: section-lead }', 'checkedBy: Human }'))
    const input = {
      _tag: 'DraftDirection',
      target: {},
      content: { file: 'again.yaml', answers: [], why: NO_WHY },
    } as const
    expect(refusedWith(derivedIn(p), HOST_RUN, input)).toBe(
      'rule repeatable is checked by Human; the person approves directions and standards, not ' +
        'results: name the role that reviews it',
    )
  }, 60000)
})

// The daily refresh: each commit of a company folder comes in as a draft of the whole direction.
describe('an import of a company commit', () => {
  const REFRESH: Author = { _tag: 'Refresh' }
  const FOLDER = {
    name: 'Acme',
    says: 'Acme writes plainly.',
    standards: [{ id: 'plain', says: 'Plain words.', rules: [{ id: 'short', says: 'Short' }] }],
  }
  const commitOf = (n: number) => `${n}`.repeat(40)
  const importOf = (n: number, more: { owner?: string; folder?: object; id?: string } = {}) =>
    ({
      _tag: 'ImportCompany',
      target: { direction: (more.id ?? 'acme') as never },
      content: {
        source: {
          repo: 'git@example:acme/directions',
          path: 'acme',
          ref: { _tag: 'DefaultBranch' },
          commit: commitOf(n),
        },
        folder: (more.folder ?? FOLDER) as never,
        owner: more.owner ?? 'Nanda',
        checkers: {},
      },
    }) as const

  test('a local id, an owner, a rule id, and a commit that is in already (S8)', async () => {
    const { p } = await h.started()
    let minute = 0
    const at = () => new Date(Date.parse(p.now()) + ++minute * 60000).toISOString() as Time
    const now = () => derivedOf(workOf(p.dir), at(), p.dir)
    const write = (by: Author, input: ActionInput) => {
      const exit = dispatchIn(p.dir, by, input, at())
      if (!Exit.isSuccess(exit)) throw new Error(`refused: ${String(exit.cause)}`)
      return exit.value.created
    }
    const review = (draft: string, accept: boolean): ActionInput =>
      accept
        ? {
            _tag: 'Accept',
            target: { of: { _tag: 'Revision', id: draft as never } },
            content: { reason: null },
          }
        : {
            _tag: 'Reject',
            target: { of: { _tag: 'Revision', id: draft as never } },
            content: { reason: 'not this one' },
          }
    expect(refusedWith(now(), REFRESH, importOf(1, { id: 'tsd-writing' }))).toBe(
      'tsd-writing is a direction of this dir; a company direction needs another id',
    )
    const rules = [{ id: 'repeatable', says: 'R' }]
    const twin = { ...FOLDER, standards: [{ id: 'x', says: 'X.', rules }] }
    expect(refusedWith(now(), REFRESH, importOf(1, { folder: twin }))).toBe(
      'the rule id "repeatable" is already used; a new rule needs a new id',
    )
    // Waiting: the draft of commit 1 waits for the owner.
    const [first] = write(REFRESH, importOf(1))
    expect(refusedWith(now(), REFRESH, importOf(1))).toBe('commit 1111111 of acme is in already')
    expect(refusedWith(now(), REFRESH, importOf(2, { owner: 'Kai' }))).toBe(
      "Acme is Nanda's; another draft of it keeps its owner",
    )
    // Official: commit 2 made version 1; the draft of commit 1 is Outdated now. P10 rejected,
    // onboarding 2026-11-14: a model gives the company draft its flow and its examples before
    // the accept.
    const [second] = write(REFRESH, importOf(2))
    // pass 3b: the flow marks where the rules apply; each rule's evidence holds its cases
    const output = '{ file: docs/tsd.md, line: 5, excerpt: TODO }'
    const examples = ['Follows', 'Breaks'].map((fit) => `        - { fit: ${fit}, output: ${output} }`)
    const step = '  - from: writer\n    to: docs/tsd.md\n    says: writes\n    uses: [acme]\n'
    p.write('cases.yaml', `flow:\n${step}rules:\n  short:\n    scope: { searched: [docs/tsd.md], unknown: [] }\n` +
      `    check: { _tag: Absent }\n    knownBreaks: []\n    cases:\n${examples.join('\n')}\n`)
    const cases = { _tag: 'AddExamples', target: { draft: second }, content: { file: 'cases.yaml' } }
    write(HOST_RUN, cases as ActionInput)
    write(NANDA, review(String(second), true))
    expect(refusedWith(now(), REFRESH, importOf(2))).toBe('commit 2222222 of acme is in already')
    expect(now().states.revisions.get(first as never)?._tag).toBe('Outdated')
    expect(events(act(now(), REFRESH, importOf(1)))).toHaveLength(1)
    // Ruling 10.4 (S8): the owner rejected the draft of commit 3; the refresh offers it again
    // until it is accepted or the repo moves on, and the new draft is in already while it waits.
    const plain = { folder: { ...FOLDER, says: 'Acme is plain.' } }
    const third = write(REFRESH, importOf(3, plain))
    write(NANDA, review(String(third[0]), false))
    expect(now().states.revisions.get(third[0] as never)?._tag).toBe('Vetoed')
    const [again] = write(REFRESH, importOf(3, plain))
    expect(now().states.revisions.get(again as never)?._tag).toBe('Waiting')
    expect(refusedWith(now(), REFRESH, importOf(3, plain))).toBe(
      'commit 3333333 of acme is in already',
    )
  }, 60000)
})
