// The content checks of a draft, an import and a forward (package P5b, gap 2): the cases of the
// old engine's tests, through the actions over a scenario store of the harness. Each
// invalid input gets the old engine's words and a real choice; a valid one makes its event.
import { beforeAll, describe, expect, test } from 'bun:test'
import { Exit } from 'effect'
import { type Derived, waitingFor } from '../derived/index.ts'
import type { Author, Time } from '../schema/index.ts'
import {
  act,
  agent,
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
const SUGGESTER = (p: Project): Author => ({
  _tag: 'ModelRun',
  name: 'suggester',
  at: p.now() as Time,
})
const ASSESS = (p: Project): Author => ({ _tag: 'ModelRun', name: 'assess', at: p.now() as Time })
const realChoice = (r: Refusal): Refusal => {
  expect(r.choice.words.trim()).not.toBe('')
  return r
}
const refusedWith = (d: Derived, by: Author, input: ActionInput): string =>
  realChoice(refused(act(d, by, input))).message

const RULE_REPEATABLE = 'A reviewer can repeat the problem without the design'
const REELS = `id: reels
name: Reels
owner: Nanda
says: A reel shows one flow.
standards:
  - id: one-flow
    says: One flow per reel.
    rules:
      - { id: one-flow-only, says: "The reel shows one flow", checkedBy: section-lead }
`

// The reported scenario, with a Reject of r1 by the lead (a point with no rule, and one that
// names repeatable), three suggestions of the person, and the person's Reject of a first draft
// of a new direction, Reels.
describe('a draft of a direction', () => {
  let p: Project
  let d: Derived
  let reject = ''
  let reelsDraft = ''
  let reelsReject = ''
  beforeAll(async () => {
    const s = await h.reported()
    p = s.p
    const rejected = ok(
      await p.agent(
        `review ${s.lead} r1 reject --point="the reader cannot see the cost" ` +
          '--point="no repro steps" --breaks=repeatable',
      ),
    )
    reject = /^(v\d+): reject/m.exec(rejected.out)?.[1] ?? ''
    ok(await p.nanda('suggest repeatable --says="cannot be met"'))
    ok(await p.nanda('suggest tsd-writing --says="say the cost first"'))
    ok(await p.nanda('suggest --says="a direction for reels"'))
    p.write('reels.yaml', REELS)
    const drafted = ok(await p.agent('direction new --file=reels.yaml --by=assess')).out
    reelsDraft = /^(d\d+) drafted/m.exec(drafted)?.[1] ?? ''
    const no = ok(await p.nanda(`review ${reelsDraft} reject --reason="too thin"`))
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
    expect([reject, reelsDraft, reelsReject].map((x) => /^[vd]\d+$/.test(x))).toEqual([
      true,
      true,
      true,
    ])
  })

  test('a revise names only standards that exist, and adds none twice', () => {
    expect(refusedWith(d, SUGGESTER(p), revise('r1.yaml', 'remove: [none]\n'))).toBe(
      'TSD writing has no standard "none"',
    )
    const twice = 'add:\n  - { id: facts-not-proof, says: Facts. }\n'
    expect(refusedWith(d, SUGGESTER(p), revise('r2.yaml', twice))).toBe(
      'TSD writing already has the standard "facts-not-proof"',
    )
  })

  test('a rule id names one rule in the project', () => {
    const yaml =
      'add:\n  - id: again\n    says: Again.\n    rules:\n' +
      '      - { id: repeatable, says: Another words }\n'
    expect(refusedWith(d, SUGGESTER(p), revise('r3.yaml', yaml))).toBe(
      'the rule id "repeatable" is already used; a new rule needs a new id',
    )
  })

  test('supersedes names other rules of the current version; a person checks no rule', () => {
    const rule = (file: string, r: string) =>
      refusedWith(
        d,
        SUGGESTER(p),
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
    expect(refusedWith(d, SUGGESTER(p), revise('r7.yaml', yaml))).toBe(
      'r7.yaml: standard w1: where key "stage" is not one of system, field, language, repo, ' +
        'section, audience',
    )
  })

  test('a suggestion is answered at its level', () => {
    const other = 'add:\n  - { id: other, says: Other. }\n'
    expect(refusedWith(d, SUGGESTER(p), revise('a1.yaml', other, ['s1']))).toBe(
      `a suggestion about the rule "${RULE_REPEATABLE}" is answered by a change of its standard`,
    )
    expect(refusedWith(d, SUGGESTER(p), revise('a2.yaml', other, ['s2']))).toBe(
      '"say the cost first" is about TSD writing itself; a change of what it says answers it',
    )
    expect(refusedWith(d, SUGGESTER(p), revise('a3.yaml', other, ['s3']))).toBe(
      '"a direction for reels" asks for a new direction; a draft of TSD writing does not ' +
        'answer it',
    )
    const says = 'says: The reader understands, decides, and sees the cost first.\n'
    expect(events(act(d, SUGGESTER(p), revise('a4.yaml', says, ['s2'])))).toHaveLength(1)
  })

  test('a Reject of a result is answered only by a real change in a direction of its task', () => {
    const elsewhere =
      'add:\n  - { id: design-only, says: Design only., where: { section: design } }\n'
    expect(refusedWith(d, SUGGESTER(p), revise('b1.yaml', elsewhere, [`${reject}.1`]))).toBe(
      'this change of TSD writing says the same to t1 as before, so it cannot answer ' +
        '"the reader cannot see the cost"',
    )
    expect(refusedWith(d, SUGGESTER(p), revise('b2.yaml', 'says: Plain.\n', [`${reject}.2`]))).toBe(
      '"no repro steps" names the rule repeatable; changed work with evidence answers it, not a ' +
        'direction change',
    )
    expect(refusedWith(d, SUGGESTER(p), revise('b3.yaml', 'says: Plain.\n', ['v1']))).toBe(
      'v1 is not a Reject point or a suggestion; --answers takes points (v<n>.<m>, or v<n> for ' +
        'all of them) and suggestions (s<n>)',
    )
    const cost = 'says: The reader understands, decides, and sees the cost.\n'
    expect(events(act(d, SUGGESTER(p), revise('b4.yaml', cost, [`${reject}.1`])))).toHaveLength(1)
  })

  test('a new direction answers suggestions for it and the Rejects of its own drafts', () => {
    expect(refusedWith(d, ASSESS(p), draft('n1.yaml', REELS, [reelsReject]))).toBe(
      `this draft proposes the same as ${reelsDraft}, so it cannot answer "too thin"`,
    )
    expect(refusedWith(d, ASSESS(p), draft('n2.yaml', REELS, ['s2']))).toBe(
      '"say the cost first" is about something that exists; a new direction answers only ' +
        'suggestions that ask for a new direction',
    )
    expect(refusedWith(d, ASSESS(p), draft('n3.yaml', REELS, [`${reject}.1`]))).toBe(
      '"the reader cannot see the cost" is not a Reject of a draft of Reels; a new direction ' +
        'answers suggestions for a new direction, and the Rejects of its own drafts',
    )
    expect(refusedWith(d, ASSESS(p), draft('n4.yaml', REELS, ['v1']))).toBe(
      'a draft answers Rejects and suggestions only',
    )
    const better = REELS.replace('A reel shows one flow.', 'A reel shows one flow, end to end.')
    const made = events(act(d, ASSESS(p), draft('n5.yaml', better, [reelsReject, 's3'])))
    expect(made).toHaveLength(1)
  })

  test('a new direction keeps its limit of standards, and a rule id of another', () => {
    const big = `id: big\nname: Big\nowner: Nanda\nsays: Big.\nmaxStandards: 1\nstandards:
  - { id: one, says: One. }
  - { id: two, says: Two. }
`
    expect(refusedWith(d, ASSESS(p), draft('m1.yaml', big))).toBe(
      'Big would have 2 standards; the limit is 1: remove or merge one, or move some to a new ' +
        'direction (work guide limits)',
    )
    const twin = REELS.replace('id: reels', 'id: twin').replace('one-flow-only', 'repeatable')
    expect(refusedWith(d, ASSESS(p), draft('m2.yaml', twin))).toBe(
      'the rule id "repeatable" is already used; a new rule needs a new id',
    )
  })
})

// N8: a whole direction drafted again by a high agent is its revise, with the revise's checks.
describe('a whole direction drafted again by an agent', () => {
  test('runs the checks of a revise', async () => {
    const { p } = await h.started()
    await h.changeDirection(p, 'add:\n  - { id: short, says: Keep it short. }\n', {
      accept: false,
    })
    const arch = (p as Project & { arch: string }).arch
    p.write('again.yaml', h.DIRECTION.replace('checkedBy: section-lead }', 'checkedBy: Human }'))
    const input = {
      _tag: 'DraftDirection',
      target: {},
      content: { file: 'again.yaml', answers: [], why: NO_WHY },
    } as const
    expect(refusedWith(derivedIn(p), agent(arch), input)).toBe(
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
            content: { evidence: [], reason: null },
          }
        : {
            _tag: 'Reject',
            target: { of: { _tag: 'Revision', id: draft as never } },
            content: { points: [], reason: 'not this one' },
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
    // Official: commit 2 made version 1; the draft of commit 1 is Outdated now.
    const [second] = write(REFRESH, importOf(2))
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
    const vetoed = () =>
      waitingFor(now(), { _tag: 'Everyone' }).filter((i) => i._tag === 'DraftVetoed')
    expect(vetoed().map((i) => i.draft)).toEqual([third[0] as never])
    const [again] = write(REFRESH, importOf(3, plain))
    expect(now().states.revisions.get(again as never)?._tag).toBe('Waiting')
    expect(refusedWith(now(), REFRESH, importOf(3, plain))).toBe(
      'commit 3333333 of acme is in already',
    )
    // The new import is the refresh's new draft: the vetoed one waits no more.
    expect(vetoed()).toEqual([])
  }, 60000)
})

// The person could do a forwarded act now: the forward runs it as the person's own act, with its
// checks of state and of content (the old CLI's dry run).
describe('a forward of the person', () => {
  let p: Project
  let d: Derived
  let lead: Author
  let escalation = ''
  beforeAll(async () => {
    const s = await h.reported()
    p = s.p
    lead = agent(s.lead)
    ok(await p.agent(`ask ${s.linter} --text="which merchant is it?"`))
    ok(await p.agent(`escalate ${s.lead} --result=r1 --reason="only Nanda decides this"`))
    ok(await p.nanda('finish a2'))
    escalation = [...workOf(p.dir).reviews.values()].find((v) => v._tag === 'Escalate')?.id ?? ''
    d = derivedIn(p)
  }, 60000)
  const forward = (inner: object): ActionInput => ({
    _tag: 'Forward',
    target: { act: inner as never },
    content: { person: 'Nanda', quote: 'as Nanda said', channel: 'chat' },
  })

  test('an answer that is not the person\'s: ask the owner, then forward the answer', () => {
    const answer = { _tag: 'Question', id: 'q1', move: { _tag: 'Answered', text: 'M-104' } }
    const r = realChoice(refused(act(d, lead, forward(answer))))
    expect(r.message).toStartWith('Nanda could not answer q1 now: ')
    expect(r.message).toContain('answers this question, not Nanda')
    expect(r.choice.words).toContain('--to=owner')
  })

  test('the content of the act is checked too: the rules that its evidence names', () => {
    const resolve = (evidence: ReadonlyArray<object>) =>
      forward({
        _tag: 'Review',
        create: { _tag: 'Resolve', escalation, resolution: 'go on', evidence },
      })
    const named = [{ rule: 'nope', where: 'docs/tsd.md', what: 'the introduction reads well' }]
    expect(refusedWith(d, lead, resolve(named))).toBe(
      `Nanda could not resolve ${escalation} now: there is no rule "nope" in an official version`,
    )
    expect(events(act(d, lead, resolve([])))).toHaveLength(1)
  })

  test('a question goes to an open assignment only', () => {
    const ask = forward({
      _tag: 'Question',
      create: { _tag: 'Asked', text: 'why?', to: { _tag: 'Agent', assignment: 'a2' } },
    })
    expect(refusedWith(d, lead, ask)).toBe(
      'Nanda could not ask a2 now: a2 (writer) is finished, so it answers no question; ask an ' +
        'open assignment',
    )
  })
})
