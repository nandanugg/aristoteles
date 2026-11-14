// The owner's rulings of 2026-11-13 (plan/rebuild/BUILD.md section 10) that are derived: each test
// builds a store with the harness (the CLI writes its events), folds it, and reads the derived
// states, nextFor and canAct. Where a fact is hard to reach with the CLI (a claim, a need), the
// test changes that one fact of the Work and says so.
import { beforeAll, describe, expect, test } from 'bun:test'
import { Exit } from 'effect'
import {
  act,
  derivedOf,
  dispatchIn,
  events,
  h,
  NANDA,
  ok,
  type Project,
  solToken,
  tokenIn,
  workOf,
} from '../actions/fixture.test.ts'
import type {
  AssignmentId,
  Author,
  Meta,
  RoleName,
  TaskId,
  Time,
  Work,
} from '../schema/index.ts'
import { canAct, type Derived, nextFor, waitingFor } from './index.ts'
import { fileTurn } from './steps.ts'

const id = <A>(x: string): A => x as A
const agentOf = (assignment: string): Author => ({
  _tag: 'Agent',
  assignment: id<AssignmentId>(assignment),
})
const tagsOf = (d: Derived, actor: Author): ReadonlyArray<string> =>
  nextFor(d, actor).map((s) => `${s._tag} ${s.what._tag}`)

const PARTS =
  '- { name: Intro, text: Write the introduction., context: { section: introduction } }\n' +
  '- { name: Design, text: Write the design., context: { section: design } }\n'
const LINT =
  '--evidence="no-code-proof | the introduction | no paths or hashes there" ' +
  '--evidence="no-ticket-ids | the introduction | no ticket ids there"'
const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat it"'

// The person splits the TSD into two parts of one file; the lead gives each part to a writer
// (a2 on t2, a3 on t3): the file docs/tsd.md has two makers (test/file-queue.test.js).
interface TwoWriters {
  readonly p: Project
  readonly lead: string
  readonly first: string
}
const twoWriters = async (): Promise<TwoWriters> => {
  // The whole TSD has no section, so the person may split it (the harness takes its files).
  const started = h.started as (files: object) => ReturnType<typeof h.started>
  const { p, lead } = await started({ 'task.yaml': h.TASK_WHOLE })
  p.write('parts.yaml', PARTS)
  ok(await p.nanda('task split t1 --file=parts.yaml'))
  const first = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
  ok(await p.agent(`assign ${lead} t3 --role=writer`))
  return { p, lead, first }
}
const derivedNow = (p: Project, work: Work = workOf(p.dir)): Derived =>
  derivedOf(work, p.now() as Time, p.dir)
const withClaim = (w: Work, a: string, claim: Meta['claim']): Work => {
  const meta = w.meta.get(id(a))
  if (meta === undefined) throw new Error(`no meta of ${a}`)
  return { ...w, meta: new Map(w.meta).set(id(a), { ...meta, claim }) }
}

describe('ruling 10.2: the file turn is derived', () => {
  let p: Project
  let lead = ''
  let first = ''
  beforeAll(async () => {
    ;({ p, lead, first } = await twoWriters())
  }, 60000)
  const leadOf = (): Author => agentOf(lead.split('.')[0] ?? '')

  test('the second maker waits while the first may write', () => {
    const d = derivedNow(p)
    expect(fileTurn(d, id('a3'))).toEqual({ before: id('a2'), file: 'docs/tsd.md' })
    expect(fileTurn(d, id('a2'))).toBeUndefined()
    expect(tagsOf(d, leadOf())).toContain('Wait MakerWaitsForFile')
  })

  test('first come: a maker whose brief claims the file keeps it; the later claim wins', () => {
    const w = workOf(p.dir)
    const since = (minute: number) => `2026-10-25T10:0${minute}:00.000Z` as Time
    // a3 took the file while a2 was away (a2 has no claim): a2 waits for a3 now.
    const a3First = derivedNow(p, withClaim(w, 'a3', { _tag: 'Held', since: since(1) }))
    expect(fileTurn(a3First, id('a2'))).toEqual({ before: id('a3'), file: 'docs/tsd.md' })
    expect(fileTurn(a3First, id('a3'))).toBeUndefined()
    // Both claim it: a3's claim is the later one, so a3 came while a2 was away.
    const both = withClaim(
      withClaim(w, 'a2', { _tag: 'Held', since: since(1) }),
      'a3',
      { _tag: 'Held', since: since(2) },
    )
    expect(fileTurn(derivedNow(p, both), id('a2'))?.before).toBe(id('a3'))
  })

  test('an idle holder gives up its turn at once; no step finishes it', () => {
    const w = workOf(p.dir)
    // t2 needs t3, which is not accepted (the fact is set here): a2 is idle.
    const t2 = w.tasks.get(id<TaskId>('t2'))
    if (t2 === undefined) throw new Error('no t2')
    const idle: Work = {
      ...w,
      tasks: new Map(w.tasks).set(t2.id, { ...t2, needs: [id<TaskId>('t3')] }),
    }
    const d = derivedNow(p, idle)
    expect(fileTurn(d, id('a3'))).toBeUndefined()
    expect(tagsOf(d, leadOf())).not.toContain('Wait MakerWaitsForFile')
  })

  test('a settled maker reserves no turn: the accept of t2 passes the file to a3', async () => {
    ok(await p.agent(`brief ${first}`))
    p.write('docs/tsd.md', h.INTRO_V2)
    ok(await p.agent(`report ${first} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    expect(fileTurn(derivedNow(p), id('a3'))?.before).toBe(id('a2'))
    ok(await p.agent(`review ${linter} r1 accept ${LINT}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    const d = derivedNow(p)
    expect(d.states.assignments.get(id('a2'))?._tag).toBe('Settled')
    expect(fileTurn(d, id('a3'))).toBeUndefined()
    // The lead starts a3 at once (its step changes, so work wait returns); a2 is not finished.
    const steps = tagsOf(d, leadOf())
    expect(steps).toContain('Wait GiveMakerCommand')
    expect(steps).not.toContain('Wait MakerWaitsForFile')
    expect(waitingFor(d, { _tag: 'Everyone' }).map((i) => i._tag)).not.toContain(
      'IdleAssignment',
    )
  }, 60000)
})

describe('ruling 10.3: a parent ends after its working children', () => {
  test('a working child stops the finish of its parent; a settled one ends with it', async () => {
    const s = await h.reported()
    const leadId = s.lead.split('.')[0] ?? ''
    const target = { assignment: id<AssignmentId>(leadId) }
    const finishLead = { _tag: 'Finish', target } as const
    const before = canAct(derivedNow(s.p), NANDA, finishLead)
    expect(before._tag).toBe('MayNot')
    if (before._tag !== 'MayNot') return
    expect(before.refusal.message).toBe(
      'a1 has open children: a2 (on t1), a3 (on t1); they still work on open tasks',
    )
    expect(before.refusal.choice).toEqual({
      kind: 'Wait',
      words: 'do your other steps until t1 is accepted; a settled child ends with a1',
    })
    ok(await s.p.agent(`review ${s.linter} r1 accept ${LINT}`))
    ok(await s.p.agent(`review ${s.lead} r1 accept ${REPEATABLE}`))
    const settled = derivedNow(s.p)
    expect(settled.states.assignments.get(id('a2'))?._tag).toBe('Settled')
    expect(canAct(settled, NANDA, finishLead)._tag).toBe('May')
    // The new action writes the finish (the old CLI still asks to finish the settled child).
    const finished = dispatchIn(s.p.dir, NANDA, { ...finishLead, content: {} }, s.p.now() as Time)
    expect(Exit.isSuccess(finished)).toBe(true)
    expect(derivedNow(s.p).states.assignments.get(id('a2'))).toEqual({
      _tag: 'Ended',
      why: { _tag: 'ParentEnded', parent: id('a1') },
    })
  }, 60000)
})

describe('ruling 10.9: a brief over its limit is a derived state', () => {
  // The writer's brief measures 5000 characters; the low limit of the harness is 4000.
  const over = (who: string) => (_w: Work, a: AssignmentId) => (a === who ? 5000 : 0)

  test('no high role above: the writer and its lead wait; the owner splits', async () => {
    const s = await h.withWriter()
    const d = derivedOf(workOf(s.p.dir), s.p.now() as Time, s.p.dir, { measure: over('a2') })
    const state = { _tag: 'BriefOver', size: 5000, limit: 4000 } as const
    expect(d.states.assignments.get(id('a2'))).toEqual(state)
    expect(tagsOf(d, agentOf('a2'))).toEqual(['Wait BriefOverWaits'])
    const lead = tagsOf(d, agentOf('a1'))
    expect(lead).toContain('Wait BriefOverWaits')
    expect(lead).not.toContain('Do AssignMaker')
    // No second maker while the first waits for a shorter brief.
    const target = { task: id<TaskId>('t1'), role: id<RoleName>('writer') }
    const give = { _tag: 'Give', target } as const
    expect(canAct(d, agentOf('a1'), give)._tag).toBe('MayNot')
    const [item] = waitingFor(d, { _tag: 'Person', name: 'Nanda' }).filter(
      (i) => i._tag === 'BriefOver',
    )
    expect(item?.step).toEqual({
      _tag: 'Do',
      what: { _tag: 'PersonDecides', kind: 'BriefOver', id: 'a2' },
      intents: [{ _tag: 'SplitTask', target: { task: id('t1'), answers: null } }],
    })
  }, 60000)

  test('a high role above: its next step at once is to shorten or split', async () => {
    const { p } = await h.started()
    const high = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${high}`))
    ok(await p.agent(`assign ${high} t1 --role=writer`))
    const d = derivedOf(workOf(p.dir), p.now() as Time, p.dir, { measure: over('a3') })
    expect(d.states.assignments.get(id('a3'))?._tag).toBe('BriefOver')
    const [first] = nextFor(d, agentOf('a2')).filter((x) => x.what._tag === 'ShortenOrSplit')
    expect(first?._tag).toBe('Do')
    if (first?._tag !== 'Do') return
    expect(first.intents).toContainEqual({
      _tag: 'ReviseDirection',
      target: { direction: id('tsd-writing') },
    })
    expect(waitingFor(d, { _tag: 'Everyone' }).map((i) => i._tag)).not.toContain('BriefOver')
    // The writer's brief is no refusal: the Brief action stores nothing, and the words wait.
    expect(tagsOf(d, agentOf('a3'))).toEqual(['Wait BriefOverWaits'])
    const brief = { _tag: 'Brief', target: { assignment: id<AssignmentId>('a3') }, content: {} }
    expect(events(act(d, agentOf('a3'), brief as never))).toEqual([])
    // A Give is no refusal either: the new assignment gets the state.
    const give = {
      _tag: 'Give',
      target: { task: id<TaskId>('t1'), role: id('linter') },
      content: { maxAttempts: null, secret: 'k1' },
    }
    expect(events(act(d, agentOf('a2'), give as never))).toHaveLength(1)
  }, 60000)

  test('a question routed to an agent over its limit still shows in its steps', async () => {
    const s = await h.withWriter()
    ok(await s.p.agent(`brief ${s.writer}`))
    ok(await s.p.agent(`escalate ${s.writer} --reason="the facts file names no merchant"`))
    // The lead's brief measures 9000 characters; the medium limit of the harness is 8000.
    const measure = (_w: Work, a: AssignmentId) => (a === 'a1' ? 9000 : 0)
    const d = derivedOf(workOf(s.p.dir), s.p.now() as Time, s.p.dir, { measure })
    expect(d.states.assignments.get(id('a1'))?._tag).toBe('BriefOver')
    expect(tagsOf(d, agentOf('a1'))).toEqual(['Wait BriefOverWaits', 'Do Answer'])
  }, 60000)
})

describe('ruling 10.10: the words of a direction draft go to the hosts', () => {
  const CHANGE = 'add:\n  - { id: short, says: Keep it short. }\n'
  const OTHER_PANE = { env: { TMUX: '/tmp/ar-test-person.sock,1,0', TMUX_PANE: '%8' } }
  const explains = (d: Derived, a: string): ReadonlyArray<string> =>
    nextFor(d, agentOf(a)).flatMap((s) =>
      s.what._tag === 'ExplainDraft' ? [`${s._tag} ${s.what.draft} ${s.what.dirWide}`] : [],
    )
  let p: Project
  let host1 = ''
  let draft = ''
  beforeAll(async () => {
    const top = `${h.TASK_WHOLE}role: architect\n`
    p = h.project({ 'top.yaml': top, 'top2.yaml': top.replace('The Introduction', 'Another') })
    await h.init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
      ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    }
    // Two projects in one folder: h1 hosts t1 (a1), h2 hosts t2 (a2).
    ok(await p.run('run start', h.HOST))
    ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
    host1 = await solToken(p, ok(await p.ui('task open td1')).out) // ruling 10.1
    ok(await p.agent(`brief ${host1}`))
    ok(await p.run('run start', OTHER_PANE))
    ok(await p.run('task draft --file=top2.yaml --by=h2', OTHER_PANE))
    const opened2 = ok(await p.ui('task open td2')).out
    ok(await p.agent(`brief ${await solToken(p, opened2, 'h2', OTHER_PANE)}`)) // ruling 10.1
    // A draft that answers nothing of a task: it comes from no project.
    p.write('change.yaml', CHANGE)
    const out = ok(
      await p.agent(
        `direction revise ${host1} tsd-writing --file=change.yaml --why="Correct the standard"`,
      ),
    ).out
    draft = out.match(/^(d\d+) drafted/m)?.[1] ?? ''
  }, 60000)

  test('a draft from no project: every active host gets "explain dN"', () => {
    const d = derivedNow(p)
    expect(explains(d, 'a1')).toEqual([`Do ${draft} true`])
    expect(explains(d, 'a2')).toEqual([`Do ${draft} true`])
  })

  test('the page holds a draft from no project while a host is active', () => {
    const items = waitingFor(derivedNow(p), { _tag: 'Person', name: 'Nanda' })
    const [item] = items.filter((i) => i._tag === 'DraftForPerson')
    expect(item?.hold._tag).toBe('HeldForHost')
  })

  test('an inactive host gets it when it is active again', () => {
    const w = workOf(p.dir)
    const session = (run: string) => w.runs.get(id(run))?.session ?? ''
    const reading = (live: boolean) => ({ live, ended: !live, exit: null, lastOutput: 0 })
    const terminals = { [session('h1')]: reading(true), [session('h2')]: reading(false) }
    const d = derivedOf(w, p.now() as Time, p.dir, { terminals })
    expect(explains(d, 'a1')).toEqual([`Do ${draft} true`])
    expect(explains(d, 'a2')).toEqual([])
  })

  test('the first host that writes the words ends the step for the others', async () => {
    const words = '--text="The rules are long." --hope="Shorter briefs."'
    ok(await p.agent(`note ${host1} words --on=${draft} ${words}`))
    const d = derivedNow(p)
    expect(explains(d, 'a1')).toEqual([])
    expect(explains(d, 'a2')).toEqual([])
  })
})

describe('ruling 10.10: a draft from one project goes to its host only', () => {
  test('it answers a point of t1: only the host of t1 explains it', async () => {
    const top = `${h.TASK_WHOLE}role: architect\n`
    const top2 = top.replace('The Introduction', 'Another')
    const p = h.project({ 'top.yaml': top, 'top2.yaml': top2 })
    await h.init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
      ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    }
    const other = { env: { TMUX: '/tmp/ar-test-person.sock,1,0', TMUX_PANE: '%8' } }
    ok(await p.run('run start', h.HOST))
    ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
    const host1 = await solToken(p, ok(await p.ui('task open td1')).out) // ruling 10.1
    ok(await p.agent(`brief ${host1}`))
    ok(await p.run('run start', other))
    ok(await p.run('task draft --file=top2.yaml --by=h2', other))
    const opened2 = ok(await p.ui('task open td2')).out
    ok(await p.agent(`brief ${await solToken(p, opened2, 'h2', other)}`)) // ruling 10.1
    const rejected = ok(await p.nanda('review t1 reject --point="the rules are too long"')).out
    const point = `${rejected.match(/\b(v\d+)\b/)?.[1] ?? ''}.1`
    // The person's point waits for an evaluation first (the harness writes one).
    const harness = h as unknown as { evaluated: (p: Project, task: string) => Promise<unknown> }
    await harness.evaluated(p, 't1')
    p.write('change.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
    const why = '--why="Correct the standard"'
    const out = ok(
      await p.agent(
        `direction revise ${host1} tsd-writing --file=change.yaml --answers=${point} ${why}`,
      ),
    ).out
    const draft = out.match(/^(d\d+) drafted/m)?.[1] ?? ''
    const d = derivedNow(p)
    const explains = (a: string) =>
      nextFor(d, agentOf(a)).flatMap((s) =>
        s.what._tag === 'ExplainDraft' ? [`${s.what.draft} ${s.what.dirWide}`] : [],
      )
    expect(explains('a1')).toEqual([`${draft} false`])
    expect(explains('a2')).toEqual([])
  }, 60000)
})
