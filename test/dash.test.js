// The dashboard page in a real browser (DESIGN 10, 10.1; browser.qnt G4). Two stores with an open
// top are made here: one with a queued task, one with an escalation that waits for review. The
// check runs in a process group of its own (test/browser/dash.check.js), because the browser tool
// can end the whole group of the process that started it.
import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import { dispatchAct, openTop } from '../core/actions/work.ts'
import { eventsOf, h, NANDA } from '../core/actions/fixture.test.ts'
import { Dir, Env, Now, Store, StoreLive, Tokens } from '../core/services/index.ts'
import { foldWork } from '../core/state/work/fold.ts'

const PIPED = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')

const run = (p, e) => {
  let n = 0
  const layer = Layer.mergeAll(
    StoreLive.pipe(
      Layer.provide(
        Layer.succeed(Env, { vars: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') } }),
      ),
    ),
    Layer.succeed(Dir, { cwd: p.dir }),
    Layer.succeed(Now, { read: Effect.succeed(p.now()) }),
    Layer.succeed(Tokens, { random: Effect.sync(() => `k${++n}`) }),
  )
  return Effect.runPromise(Effect.scoped(e).pipe(Effect.provide(layer)))
}

// An open top; each act of `steps` on the state as it is now.
const opened = async (steps) => {
  const { p } = await h.initiated({ 'aristoteles.yaml': PIPED })
  h.git(p.dir, 'init', '-q')
  h.git(p.dir, 'config', 'user.name', 'Nanda')
  await run(p, openTop({ by: NANDA, name: 'TSD', goal: 'g', sections: ['introduction'] }))
  let id = 0
  for (const [who, what] of steps(p)) {
    const on = foldWork(eventsOf(p.dir))?.state.seq ?? null
    const act = { id: `d${++id}`, who, ep: 0, what }
    await run(p, dispatchAct({ by: NANDA, act, on, build: null, current: 'b1' }))
  }
  return p
}

const spec = {
  name: 'Intro',
  goal: 'Write the introduction.',
  sections: ['introduction'],
  role: 'section-lead',
}
const summary = 'Say it once.\nThe draft repeats a line.'
const evaluate = { _tag: 'Evaluate', task: 't1', level: 'Direct', parts: [], roleDraft: null }
const send = ['host', { _tag: 'SendTask', spec }]

test('the dashboard page, in a real browser', async () => {
  const queued = await opened(() => [send])
  const waiting = await opened((p) => {
    const dir = [...foldWork(eventsOf(p.dir)).state.items].find(([, r]) => r.kind === 'dir')
    const std = [...foldWork(eventsOf(p.dir)).state.items].find(([, r]) => r.kind === 'std')
    const rule = {
      kind: 'rule', parent: std[0], name: 'once', says: 'Say it once.', where: null,
      test: 'true', ref: null, form: 'mech', examples: [],
    }
    const items = new Set([dir[0]])
    const edited = { ...dir[1], says: `${dir[1].says} Say it once.` }
    const draft = new Map([[dir[0], edited]])
    return [
      send,
      ['role:section-lead', { _tag: 'AssignDo', task: 't1' }],
      ['maker:m1', { _tag: 'ReadBrief', maker: 'm1' }],
      ['maker:m1', { _tag: 'Report', maker: 'm1', output: 'o', files: [], caught: new Set() }],
      ['role:section-lead', { _tag: 'Review', task: 't1', v: 'RaiseNoRule', points: [] }],
      ['pipe', { ...evaluate, summary }],
      ['pipe', { _tag: 'Advance', fix: 't1' }],
      ['pipe', { _tag: 'Advance', fix: 't1' }],
      ['pipe', { _tag: 'WriteRule', fix: 't1', rule: 'rule:once', rec: rule, refOk: true }],
      ['pipe', { _tag: 'RunTest', fix: 't1', own: true, contra: [] }],
      ['pipe', { _tag: 'Ship', fix: 't1', items, draft }],
      ['pipe', { _tag: 'LoopReview', fix: 't1', toPerson: true }],
    ]
  })
  const child = spawn('bun', [join(import.meta.dir, 'browser', 'dash.check.js')], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DASH_QUEUED: queued.dir, DASH_WAITING: waiting.dir },
  })
  let out = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { out += d })
  const code = await new Promise((done) => child.on('exit', done))
  expect({ code, out }).toEqual({ code: 0, out: 'the dash check passed\n' })
}, 240000)
