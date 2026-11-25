import { expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { replayAdmission, replayPermits, replayWorker } from '../derived/pass9/replay/driver.ts'
import { type RuntimeRow, readJournal } from '../derived/pass9/replay/journal.ts'
import { readWitness } from '../derived/pass9/replay/model.ts'
import { type Intake, type Turn, type WorkerRead, checkIntake } from '../derived/pass9/replay/project.ts'
import { type AdmissionFixture, fixtureAdmission, fixtureWorkerPark, inProject, withPermitsFixture } from './pass9-conformance-fixtures.ts'

const traces = join(import.meta.dir, '../derived/pass9/replay/traces')
const admissions: Readonly<Record<string, AdmissionFixture>> = {
  lane: { kind: 'pipe', pipeCap: 1, childAllowance: 1 },
  'two-fixes': { kind: 'pipe', pipeCap: 2, childAllowance: 1 },
  serial: { kind: 'saturation', pipeCap: 1, childAllowance: 0 },
  owners: { kind: 'collocated', pipeCap: 1, childAllowance: 1 },
}
for (const file of readdirSync(traces).filter((name) => name.endsWith('.itf.json.gz') &&
  !['admission-wait.itf.json.gz', 'admission-shared-wait.itf.json.gz'].includes(name) && (!name.startsWith('worker-') || name === 'worker-park.itf.json.gz')).sort()) {
  const trace = readWitness(join(traces, file))
  test(`pass 9 finite replay: ${trace.name}`, async () => {
    if (trace.name === 'worker-park') return replayWorker(trace, fixtureWorkerPark())
    if (trace.name.startsWith('admission-')) {
      const options = admissions[trace.name.slice('admission-'.length)]!
      return replayAdmission(trace, fixtureAdmission(options), options.pipeCap)
    }
    const scenario = trace.name.slice('permits-'.length)
    if (scenario !== 'child' && scenario !== 'serial' && scenario !== 'admission' &&
      scenario !== 'park' && scenario !== 'defer') throw new Error(`unknown instance ${trace.name}`)
    return inProject((dir) => withPermitsFixture(dir, scenario, (runtime) => replayPermits(trace, runtime)))
  })
}

const scope: Turn = {
  worker: 'shared', generation: 3, turn: 'turn-4', actor: 'Pipe', epoch: 7,
  obligation: 'ob-5', on: 56, step: 'recheck t1',
}
const live: WorkerRead = {
  worker: scope.worker, generation: scope.generation, activeTurn: scope, session: 'Online',
  owed: [{ actor: scope.actor, obligation: scope.obligation, age: 55, ready: true }], printed: null,
}
const taken: WorkerRead = { ...live, activeTurn: null, owed: [] }
const credential = { actor: scope.actor, epoch: scope.epoch, generation: scope.generation }
const intake: Intake = { requested: scope, credential, outcome: 'taken', committed: scope, actsAppended: 1 }

test('pass 9 intake oracle requires the full scope and journal effect', () => {
  checkIntake(live, taken, intake)
  for (const altered of [
    { worker: 'other' }, { generation: 2 }, { actor: 'Host' as const }, { epoch: 6 },
    { turn: 'turn-1' }, { obligation: 'ob-4' }, { on: 55 }, { step: 'recheck t2' },
  ]) {
    const wrong = { ...scope, ...altered }
    expect(() => checkIntake(live, taken, { ...intake, committed: wrong })).toThrow('different turn')
    expect(() => checkIntake(live, taken, { ...intake, requested: wrong })).toThrow('without its selected turn')
  }
  for (const wrong of [{ actor: 'Host' as const }, { epoch: 6 }, { generation: 2 }]) {
    expect(() => checkIntake(live, taken, { ...intake, credential: { ...credential, ...wrong } }))
      .toThrow('credential outside')
  }
  const refused: Intake = { requested: null, credential: null, outcome: 'refused', refused: 'stale', committed: null, actsAppended: 0 }
  checkIntake(live, live, refused)
  expect(() => checkIntake(live, taken, refused)).toThrow('cleared the active turn')
  expect(() => checkIntake(live, live, { ...refused, actsAppended: 1 })).toThrow('wrong number')
  expect(() => checkIntake(live, taken, { ...refused, requested: scope, credential: { ...credential, actor: 'Host' } }))
    .toThrow('cleared the active turn')
  checkIntake(live, { ...live, activeTurn: null }, {
    ...refused, refused: 'basis', requested: { ...scope, on: scope.on - 1 }, credential,
  })
  checkIntake(taken, taken, { requested: scope, credential, outcome: 'retry', committed: null, actsAppended: 0 })
})

test('pass 9 journal replay holds a fenced allocation until confirmation', () => {
  const events: RuntimeRow[] = []
  const append = (event: RuntimeRow) => events.push(event)
  const observe = () => readJournal(events.map((event, i) => ({ seq: i + 1, event })))
  const w1 = { worker: 'parent', generation: 1, launch: 'first' }
  const w2 = { worker: 'parent', generation: 2, launch: 'resume' }
  append({ kind: 'WorkerReserved', ...w1, slot: 'slot-1' })
  append({ kind: 'WorkerBound', ...w1 })
  append({ kind: 'WorkerFenced', ...w1 })
  expect(observe().slots).toEqual(['slot-1'])
  append({ kind: 'WorkerEnded', ...w1 })
  expect(observe().slots).toEqual([])
  append({ kind: 'WorkerReserved', ...w2, slot: 'slot-2' })
  append({ kind: 'WorkerBound', ...w2 })
  expect(observe().slots).toEqual(['slot-2'])
  append({ kind: 'WorkerEnded', ...w1 })
  expect(observe).toThrow('stale worker observation')
})

test('pass 9 journal replay separates helper report, child release, and verdict', () => {
  const events: RuntimeRow[] = []
  const append = (event: RuntimeRow) => events.push(event)
  const observe = () => readJournal(events.map((event, i) => ({ seq: i + 1, event })))
  const parent = { worker: 'parent', generation: 1, launch: 'parent-1' }
  const child = { worker: parent.worker, generation: parent.generation, launch: 'child-1', child: 'c1' }
  append({ kind: 'WorkerReserved', ...parent, slot: 'slot-1' })
  append({ kind: 'WorkerBound', ...parent })
  append({ kind: 'RecheckQueued', job: 'job-1', target: 0, on: 50, items: [['dir:x', 2]] })
  append({ kind: 'ChildReserved', ...child, subject: 0, role: 0, job: 'job-1' })
  const bindHelper = { kind: 'RecheckHelperBound', job: 'job-1', allocation: child.child, route: 'child' } as const
  append(bindHelper)
  expect(observe).toThrow('bound fresh allocation')
  events.pop()
  append({ kind: 'ChildBound', ...child })
  append(bindHelper)
  append({ kind: 'RecheckReported', job: 'job-1', report: 'report-1', on: 49, items: [['dir:x', 2]] })
  expect(observe).toThrow('original basis or exact items')
  events.pop()
  append({ kind: 'RecheckReported', job: 'job-1', report: 'report-1', on: 50, items: [['dir:x', 3]] })
  expect(observe).toThrow('original basis or exact items')
  events.pop()
  append({ kind: 'RecheckReported', job: 'job-1', report: 'report-1', on: 50, items: [['dir:x', 2]] })
  expect(observe().job('job-1')).toMatchObject({ reported: true, helperLive: true })
  expect(observe().slots).toEqual(['slot-1'])
  append({ kind: 'ChildReleased', ...child, launch: 'wrong' })
  expect(observe().children).toHaveLength(1)
  append({ kind: 'ChildReleased', ...child })
  expect(observe().job('job-1')).toMatchObject({ reported: true, helperLive: false })
  append({ kind: 'Work.Acted', delivery: null, recheck: { job: 'job-1', report: 'report-1' } })
  expect(observe().job('job-1')).toBeNull()
})
