// The differential test of the derived states (BUILD.md 4.5, P1): over the scenario stores of the
// integrated harness, each new state equals the state that the old readers gave (their status,
// runs and waiting readers, pinned in differential.pins.json at the switch, 2026-11-14), or the
// test names the finding that explains the difference and checks the condition of that finding.
import { beforeAll, describe, expect, test } from 'bun:test'
import type {
  AssignmentId,
  PermissionId,
  QuestionId,
  RevisionId,
  RunId,
  TaskDraftId,
  Work,
} from '../schema/index.ts'
import { blockersOf as blockersOfNew, type Derived, derive } from './index.ts'
import { momentOf, pinned, SCENARIOS, type Scenario } from './support.test.ts'

const old = pinned(`${import.meta.dir}/differential.pins.json`)
// The tag of an old state; the test reads no other field of it but where it says so.
type Tagged = { readonly _tag: string }

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

// Each difference that a finding explains, by scenario, for the report of the test run.
const explained = (name: string, finding: string, what: string) => `${name}: ${finding}: ${what}`

describe('the states equal the old readers, or a finding explains each change', () => {
  test('TaskState equals the old taskState', () => {
    for (const { s, w, d } of built) {
      for (const id of w.tasks.keys()) {
        const was = old(s, `taskState ${id}`)
        expect<unknown>([s.name, id, d.states.tasks.get(id)]).toEqual([s.name, id, was])
      }
    }
  })

  test('the blockers equal the old blockerItems', () => {
    for (const { s, w, d } of built) {
      for (const id of w.results.keys()) {
        const m = d.moment
        expect(blockersOfNew(m, id)).toEqual(old(s, `blockerItems ${id}`))
      }
    }
  })

  test('ResultState equals the old resultState; S5: an older result is Superseded', () => {
    const seen: Array<string> = []
    for (const { s, w, d } of built) {
      for (const r of w.results.values()) {
        const now = d.states.results.get(r.id)
        if (now?._tag === 'Superseded') {
          // S5: "is it the latest" is read once; the old word of an older result was its own.
          const latest = [...w.results.values()].filter((x) => x.task === r.task).at(-1)
          expect(latest?.id).toBe(now.by)
          expect(now.by).not.toBe(r.id)
          seen.push(explained(s.name, 'S5', `${r.id} superseded by ${now.by}`))
          continue
        }
        expect([s.name, r.id, now]).toEqual([
          s.name,
          r.id,
          old(s, `resultState ${r.id}`),
        ])
      }
    }
    expect(seen).toContain('rejectedOnce: S5: r1 superseded by r2')
  })

  test('RevisionState equals the old revisionState, or S2, S6, S7 explain it', () => {
    for (const { s, w, d } of built) {
      for (const x of w.drafts.values()) {
        const now = d.states.revisions.get(x.id as RevisionId)
        const was = old<Tagged>(s, `revisionState ${x.id}`)
        if (now?._tag === 'Conflicted') throw new Error(`${s.name}: ${x.id} is Conflicted (S7)`)
        if (now?._tag === 'Outdated' && was._tag === 'Vetoed') continue // S6: Outdated first
        if (now?._tag === 'Waiting' && now.waitsFor.some((l) => l._tag === 'OwnerAccept')) {
          // S2: the owner is a leaf of its own; the decider leaves stay as they were.
          expect(was._tag).toBe('Waiting')
          continue
        }
        expect<unknown>([s.name, x.id, now]).toEqual([s.name, x.id, was])
      }
    }
  })

  test('PermissionState and EvaluationState equal the old ones', () => {
    for (const { s, w, d } of built) {
      for (const x of w.permissions.values()) {
        const was = old(s, `permissionState ${x.id}`)
        expect<unknown>(d.states.permissions.get(x.id as PermissionId)).toEqual(was)
      }
      for (const e of w.evaluations.keys()) {
        expect(d.states.evaluations.get(e)).toEqual(
          old(s, `evaluationState ${e}`),
        )
      }
    }
  })

  test('AssignmentState equals the old makerState, or C1 and I2 explain it', () => {
    const seen: Array<string> = []
    for (const { s, w, d } of built) {
      for (const a of w.assignments.values()) {
        const now = d.states.assignments.get(a.id as AssignmentId)
        const was = old<Tagged>(s, `makerState ${a.id}`)
        if (now === undefined) throw new Error(`${s.name}: no state for ${a.id}`)
        switch (now._tag) {
          case 'Ended':
            if (now.why._tag === 'Finished') expect(was._tag).toBe('Finished')
            else if (now.why._tag === 'TaskEnded') {
              // C1: the task's end ends its assignments; the old one stayed open.
              expect(w.tasks.get(a.task)?.end._tag).not.toBe('NotEnded')
              seen.push(explained(s.name, 'C1', `${a.id} ended with ${a.task}`))
            } else {
              // C1, I2: a settled child ends when its parent ends.
              const task = old<Tagged>(s, `taskState ${a.task}`)
              expect(task._tag).toBe('Accepted')
              expect(d.states.assignments.get(now.why.parent)?._tag).toBe('Ended')
            }
            break
          case 'Settled':
            // I2: an assignment of an accepted task has no step; the old one stayed Working.
            expect(was._tag).toBe('Working')
            expect(old<Tagged>(s, `taskState ${a.task}`)._tag).toBe('Accepted')
            seen.push(explained(s.name, 'I2', `${a.id} settled`))
            break
          case 'OutOfTries':
            expect<unknown>(was).toEqual({ _tag: 'OutOfTries', used: now.used, max: now.max })
            break
          case 'Working':
            expect(was._tag).toBe('Working')
            if (now.tries._tag === 'Makes') {
              expect(now.tries.attempt).toEqual(old(s, `attemptOf ${a.id}`))
            } else expect(a._tag).toBe('Reviewer')
        }
      }
    }
    expect(seen).toContain('accepted: I2: a2 settled')
    expect(seen).toContain('uiRunRemade: C1: a2 ended with t1')
    expect(seen).toContain('uiRunRemade: C1: a3 ended with t1')
  })

  test('QuestionState equals the old status and answerer, or C1 and C2 explain it', () => {
    const seen: Array<string> = []
    for (const { s, w, d } of built) {
      for (const q of w.questions.values()) {
        const now = d.states.questions.get(q.id as QuestionId)
        if (q.status._tag === 'Answered') {
          expect(now).toEqual({ ...q.status })
          continue
        }
        if (now?._tag === 'Irrelevant') {
          // C2: the task that it stops ended; the old question stayed open.
          expect(w.tasks.get(q.stops)?.end._tag).not.toBe('NotEnded')
          seen.push(explained(s.name, 'C2', `${q.id} irrelevant`))
          continue
        }
        expect(now?._tag).toBe('Open')
        const was = old(s, `answererOf ${q.id}`)
        if (now?._tag === 'Open' && JSON.stringify(now.answerer) !== JSON.stringify(was)) {
          // C1: the old answerer is an agent whose task ended; the question goes up past it.
          const a = typeof was === 'string' ? w.assignments.get(was as AssignmentId) : undefined
          expect(a !== undefined && w.tasks.get(a.task)?.end._tag !== 'NotEnded').toBe(true)
          seen.push(explained(s.name, 'C1', `${q.id} goes past ${String(was)}`))
        }
      }
    }
    expect(seen).toContain('uiRunRemade: C2: q1 irrelevant')
  })

  test('RunState and TaskDraftState equal the old runState and taskDraftState', () => {
    for (const { s, w, d } of built) {
      for (const r of w.runs.values()) {
        const was = old(s, `runState ${r.id}`)
        expect<unknown>(d.states.runs.get(r.id as RunId)).toEqual(was)
      }
      for (const x of w.taskDrafts.keys()) {
        const was = old(s, `taskDraftState ${x}`)
        expect<unknown>(d.states.taskDrafts.get(x as TaskDraftId)).toEqual(was)
      }
    }
  })

  test('ForwardState equals the old waiting forwards, or C6 explains it', () => {
    const seen: Array<string> = []
    for (const { s, w, d } of built) {
      const refs = old<ReadonlyArray<string>>(s, 'waitingForwards')
      const waiting = new Set(refs)
      for (const f of w.forwards.values()) {
        const now = d.states.forwards.get(f.event)
        if (f._tag === 'Counted') expect(now).toEqual({ _tag: 'Counted' })
        else if (f.state._tag === 'Confirmed') expect(now).toEqual(f.state)
        else if (now?._tag === 'Waiting') expect(waiting.has(f.event)).toBe(true)
        else {
          // C6: decided already (the old list dropped the irrelevant ones it knew of).
          expect(now?._tag).toBe('Irrelevant')
          seen.push(explained(s.name, 'C6', `${f.event} irrelevant`))
        }
      }
    }
    expect(seen.some((x) => x.startsWith('relayDecided: C6'))).toBe(true)
  })

  test('ProblemState equals the stored fix, or C3 and S12 explain it', () => {
    const seen: Array<string> = []
    for (const { s, w, d } of built) {
      for (const p of w.problems.values()) {
        const now = d.states.problems.get(p.id)
        if (p.fixed._tag === 'Fixed') expect(now).toEqual({ _tag: 'Fixed', ...stripTag(p.fixed) })
        else if (now?._tag === 'Irrelevant') {
          // C3: the stopped task ended; the old problem stayed open.
          expect(w.tasks.get(p.stopped)?.end._tag).not.toBe('NotEnded')
          seen.push(explained(s.name, 'C3', `${p.id} irrelevant`))
        } else if (now?._tag === 'Recovered') {
          expect(p.recordedBy._tag).not.toBe('Host') // S12
        } else expect(now).toEqual({ _tag: 'Open' })
      }
    }
    expect(seen).toContain('uiRunRemade: C3: sp1 irrelevant')
  })

  test('SendState equals the stored state, or C5 explains it', () => {
    for (const { w, d } of built) {
      for (const send of w.sends) {
        const now = d.states.sends.get(send.id)
        if (now?._tag === 'Irrelevant') continue // C5: its owner or its decision ended
        expect(now).toEqual(send.state)
      }
    }
  })
})

const stripTag = <A extends { readonly _tag: string }>(a: A): Omit<A, '_tag'> => {
  const { _tag, ...rest } = a
  void _tag
  return rest
}
