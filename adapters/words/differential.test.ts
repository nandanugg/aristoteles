// The differential test of the words (BUILD.md 4.5, P8): over the scenario stores of the integrated
// harness, each renderer of adapters/words writes the same lines that the old renderers wrote on
// the old states (pinned in differential.pins.json at the switch, 2026-11-14), or the test names
// the finding that explains the difference and checks it.
import { beforeAll, describe, expect, test } from 'bun:test'
import {
  type Derived,
  derive,
  type NextStep,
  nextFor,
  type WaitingItem,
  waitingFor,
} from '../../core/derived/index.ts'
import type { AssignmentId, Work } from '../../core/schema/index.ts'
import { momentOf, pinned, SCENARIOS, type Scenario } from '../../core/derived/support.test.ts'
import {
  briefOf,
  logLine,
  nextLines,
  pieceNames,
  renderBlockers,
  renderDirection,
  renderAssignment,
  renderDraft,
  renderPiece,
  renderQuestion,
  renderResult,
  renderStatus,
  renderTask,
  renderTaskTree,
  waitingLines,
} from './index.ts'

const old = pinned(`${import.meta.dir}/differential.pins.json`)
type Lines = ReadonlyArray<string>

interface Built {
  readonly s: Scenario
  readonly w: Work
  readonly d: Derived
}
const built: Array<Built> = []

beforeAll(async () => {
  for (const [, make] of SCENARIOS) {
    const s = await make()
    const m = momentOf(s.p.dir, s.at)
    built.push({ s, w: m.work, d: derive(m) })
  }
}, 240000)

describe('log', () => {
  test('logLine writes the old line of every stored event', () => {
    let count = 0
    for (const { s, w } of built) {
      const lines = old<Lines>(s, 'logLine')
      for (const [i, logged] of w.events.entries()) {
        expect([s.name, logLine(w, logged)]).toEqual([s.name, lines[i] ?? ''])
        count += 1
      }
    }
    expect(count).toBeGreaterThan(100)
  })
})

// The token that both renderers print into their commands.
const TOKEN = 'a0.TOKEN'
// Ruling 10.1: what the watcher typed into a terminal before is a step of nextFor now.
const NOTICES: ReadonlyArray<string> = [
  'AnswerPrompt',
  'RecordFailure',
  'WriteEndWords',
  'TestProblem',
  'WaitsForAnswer',
  'Answered',
  'Resolved',
]
const isNotice = (s: NextStep): boolean => NOTICES.includes(s.what._tag)
// The brief lines of an agent's notices (READY indents each line by two).
const noticeLinesOf = (d: Derived, a: AssignmentId, token: string): ReadonlyArray<string> =>
  nextLines(d, nextFor(d, { _tag: 'Agent', assignment: a }).filter(isNotice), token).map(
    (l) => `  ${l}`,
  )

describe('next', () => {
  test('nextLines writes the old lines of each step, but for D14 and C1', () => {
    const seen: Array<string> = []
    let compared = 0
    for (const { s, w, d } of built) {
      for (const a of w.assignments.values()) {
        if (a.end._tag !== 'NotEnded') continue
        const was = old<{ d14: boolean; lines: Lines }>(s, `nextLines ${a.id}`)
        const steps = nextFor(d, { _tag: 'Agent', assignment: a.id }).filter((x) => !isNotice(x))
        const state = d.states.assignments.get(a.id)
        if (state?._tag === 'Ended') {
          // C1: an agent of an ended task has no step, so no line; the old one was told to finish.
          expect(nextLines(d, steps, TOKEN)).toEqual([])
          seen.push(`${s.name}: C1: ${a.id}`)
          continue
        }
        if (was.d14) seen.push(`${s.name}: D14: ${a.id}`)
        const now = nextLines(d, steps, TOKEN)
        expect([s.name, a.id, now]).toEqual([s.name, a.id, was.lines])
        compared += now.length
      }
    }
    expect(compared).toBeGreaterThan(5)
    expect(seen).toContain('accepted: D14: a1')
  })
})

// The lines of `old` that `now` lacks, and the lines of `now` that `old` lacks.
// Ruling 10.1: an agent whose steps only wait holds work wait; nothing wakes it by typing.
const WAITS_OLD = '  Nothing to run now: STOP. You are woken when a step changes.'
const WAITS_NOW = '  Nothing to run now: wait for work, as YOUR TURN says.'
const changed = (now: ReadonlyArray<string>, old: ReadonlyArray<string>) => ({
  removed: old.filter((l) => !now.includes(l) && l !== WAITS_OLD),
  added: now.filter((l) => !old.includes(l) && l !== WAITS_NOW),
})

describe('waiting', () => {
  test('waitingRows writes the old rows of work waiting, but for C2', () => {
    const seen: Array<string> = []
    for (const { s, w, d } of built) {
      const people = [null, ...w.config.people]
      for (const name of people) {
        const who =
          name === null ? { _tag: 'Everyone' as const } : { _tag: 'Person' as const, name }
        // Ruling 10.6: the problems and the ends are rows too (the test below); the old had none.
        const items = waitingFor(d, who).filter((i) => i._tag !== 'Problem' && i._tag !== 'RunEnd')
        const now = waitingLines(d, items, name)
        const rows = old<Lines>(s, `renderWaiting ${name ?? 'everyone'}`)
        const { removed, added } = changed(now, rows)
        if (removed.length === 0 && added.length === 0) {
          expect([s.name, name, now]).toEqual([s.name, name, rows])
          continue
        }
        // C2: the question of an ended task is Irrelevant, so no row waits for its answerer.
        expect(added).toEqual([])
        expect(removed).toEqual([
          'q1 for a1: is the cost in the facts?',
          '    work answer <a1 token> q1 --text="..."',
        ])
        expect(s.name).toBe('uiRunRemade')
        seen.push(`${s.name}: C2: q1`)
      }
    }
    expect(seen.length).toBeGreaterThan(0)
  })

  test('ruling 10.6: a system problem and the end of a project are rows of work waiting', () => {
    const ui = built.find((b) => b.s.name === 'uiRun')
    if (ui === undefined) throw new Error('no uiRun')
    const items = waitingFor(ui.d, { _tag: 'Everyone' })
    expect(waitingLines(ui.d, items, null).slice(-2)).toEqual([
      'sp1 stops t1 The Introduction (recorded by the host a1): the lint server is down; ' +
        'start it again',
      '    when it is fixed: work problem sp1 --fixed',
    ])
    // No scenario ends a project; the row of an end reads only its run and its top task.
    const [problem] = items.filter((i) => i._tag === 'Problem')
    if (problem === undefined) throw new Error('no problem in uiRun')
    const end = { ...problem, _tag: 'RunEnd', run: 'h1', top: 't1' } as unknown as WaitingItem
    expect(waitingLines(ui.d, [end], null)).toEqual([
      'h1 ends: the agent that leads t1 The Introduction accepted its result',
      '    work run done h1, or work review t1 reject --point="<your reason>"',
    ])
  })

  test('renderStatus writes the old rows of the open assignments, but for C1', () => {
    let compared = 0
    for (const { s, d } of built) {
      const now = renderStatus(d)
      const rows = old<Lines>(s, 'renderStatus')
      if (s.name === 'uiRunRemade') {
        // C1: every assignment of the remade task is Ended, so no row is open.
        expect(now).toEqual(['no open assignments.'])
        expect(rows.length).toBeGreaterThan(0)
        continue
      }
      expect([s.name, now]).toEqual([s.name, rows])
      compared += now.length
    }
    expect(compared).toBeGreaterThan(5)
  })
})

describe('brief', () => {
  test('briefOf writes the old brief of every assignment, but for D14', () => {
    const seen: Array<string> = []
    let compared = 0
    for (const { s, w, d } of built) {
      for (const a of w.assignments.values()) {
        if (w.workflow.roles.get(a.role)?._tag !== 'Model') continue
        const now = briefOf(d, a.id, TOKEN)
        const was = old<Lines>(s, `renderBrief ${a.id}`).join('\n')
        compared += 1
        if (now === was) continue
        // D14 (I2): a settled child is no step of its parent, so READY has no finish line.
        const notices = noticeLinesOf(d, a.id, TOKEN)
        const { removed, added: all } = changed(now.split('\n'), was.split('\n'))
        const added = all.filter((l) => !notices.includes(l))
        if (removed.length === 0 && added.length === 0) continue // only the lines of 10.1
        expect(added).toEqual([])
        expect(removed.length).toBeGreaterThan(0)
        for (const line of removed) expect(line).toMatch(/^ {2}finish a\d+$|^ {4}work finish /)
        seen.push(`${s.name}: D14: ${a.id}`)
      }
    }
    expect(compared).toBeGreaterThan(15)
    expect(seen).toContain('accepted: D14: a1')
  })
})

// C2: a question of an ended task is Irrelevant: no line of the task or its result says it waits.
const sameButC2 = (name: string, now: ReadonlyArray<string>, old: ReadonlyArray<string>): void => {
  const { removed, added } = changed(now, old)
  if (removed.length === 0 && added.length === 0) {
    expect(now).toEqual(old)
    return
  }
  expect(name).toBe('uiRunRemade')
  expect(added).toEqual([])
  for (const line of removed) expect(line).toMatch(/^ *q\d+ waits for /)
  c2Seen += 1
}
let c2Seen = 0

describe('show views', () => {
  test('the result, its blockers and the task tree are the old lines, but for C2', () => {
    let results = 0
    for (const { s, w, d } of built) {
      for (const r of w.results.values()) {
        const result = old<Lines>(s, `renderResult ${r.id}`)
        sameButC2(s.name, renderResult(d, r.id), result)
        const blockers = old<Lines>(s, `renderBlockers ${r.id}`)
        sameButC2(s.name, renderBlockers(d, r.id), blockers)
        results += 1
      }
      for (const t of w.tasks.values()) {
        expect([s.name, t.id, renderTaskTree(d, t.id)]).toEqual([
          s.name,
          t.id,
          old(s, `renderTaskTree ${t.id}`),
        ])
      }
    }
    expect(results).toBeGreaterThan(5)
    expect(c2Seen).toBeGreaterThan(0)
  })

  test('the direction, the draft and the pieces are the old words', () => {
    let drafts = 0
    let pieces = 0
    for (const { s, w, d } of built) {
      for (const dir of w.directions.values()) {
        if (dir._tag !== 'Official') continue
        for (const v of dir.versions) {
          const id = `${dir.id}@${v.number}` as never
          expect([s.name, id, renderDirection(d, id)]).toEqual([
            s.name,
            id,
            old(s, `renderDirection ${id}`),
          ])
          const names = old<Lines>(s, `pieceNames ${id}`)
          for (const name of names) {
            const piece = old<Lines>(s, `renderPiece ${id} ${name}`)
            expect<unknown>(renderPiece(w, id, [name])).toEqual(piece)
            pieces += 1
          }
          expect(pieceNames(w, id)).toEqual(names)
        }
      }
      for (const x of w.drafts.values()) {
        expect([s.name, x.id, renderDraft(d, x.id)]).toEqual([
          s.name,
          x.id,
          old(s, `renderDraft ${x.id}`),
        ])
        drafts += 1
      }
    }
    expect(drafts).toBeGreaterThan(2)
    expect(pieces).toBeGreaterThan(2)
  })
})

describe('the views of a question, an assignment and a task', () => {
  test('a question reads as the old command printed it, and C2 closes it with its task', () => {
    let seen = 0
    for (const { s, w, d } of built) {
      for (const q of w.questions.values()) {
        const by = (x: unknown) => (typeof x === 'string' ? x : (x as { name: string }).name)
        const answered = d.states.questions.get(q.id)?._tag === 'Answered'
        const text = q.status._tag === 'Answered' ? `answer: ${q.status.answer}` : 'no answer yet'
        expect([s.name, renderQuestion(d, q.id)]).toEqual([
          s.name,
          [
            `${q.id} asked by ${by(q.from)}, for ${by(q.answerBy)}:`,
            q.text,
            '',
            answered ? text : 'no answer yet',
          ],
        ])
        seen += 1
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  test('an assignment shows its brief with no claim, and a task its words', () => {
    for (const { s, w, d } of built) {
      for (const a of w.assignments.values()) {
        if (w.config.roles[a.role]?.kind === 'program') continue
        const lines = renderAssignment(d, a.id)
        // The old brief names its token only where the token stands (checked at the pin).
        const brief = old<Lines>(s, `renderBrief ${a.id}`)
          .join('\n')
          .replaceAll(TOKEN, `${a.id}.<token>`)
        // D14: the only lines that the brief may lose are the bookkeeping finishes.
        const notices = noticeLinesOf(d, a.id, `${a.id}.<token>`)
        const { removed, added } = changed(lines[0]?.split('\n') ?? [], brief.split('\n'))
        expect(added.filter((l) => !notices.includes(l))).toEqual([])
        for (const line of removed) expect(line).toMatch(/^ {2}finish a\d+$|^ {4}work finish /)
        expect(lines.slice(1)).toEqual(['', '(read-only: no snapshot, no claim)'])
      }
      for (const t of w.tasks.values()) {
        const lines = renderTask(d, t.id)
        const word = renderTaskTree(d, t.id)[0]?.split(' · ')[1]?.replace(/ \(.*$/, '')
        expect(lines[0]).toBe(`${t.id} ${t.name} · ${word} · owner ${t.owner.name}`)
        expect(lines[1]).toBe(`text: ${t.descriptionAi.text}`)
      }
    }
  })
})
