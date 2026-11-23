// The dashboard page in a real browser (DESIGN 10, 10.1; browser.qnt G4). Two stores with an open
// top are made here: one with a queued task, one with an escalation that waits for review. The
// check runs in a process group of its own (test/browser/dash.check.js), because the browser tool
// can end the whole group of the process that started it.
import { expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import { dispatchAct, writeTop } from '../core/actions/work.ts'
import { eventsOf, h, NANDA } from '../core/actions/fixture.test.ts'
import { Dir, Env, Now, Store, StoreLive, Tokens } from '../core/services/index.ts'
import { foldWork } from '../core/state/c16/fold.ts'
import { keyOf } from '../core/state/c16/types.ts'

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
  await run(p, writeTop({ by: NANDA, name: 'TSD', goal: 'g', sections: ['introduction'] }, false))
  let id = 0
  for (const [who, next] of steps(p)) {
    const state = foldWork(eventsOf(p.dir))?.state
    const body = typeof next === 'function' ? next(state) : next
    const act = { id: `d${++id}`, who, ep: state.ep.get(keyOf(who)) ?? 0, body }
    const by = who._tag === 'Harness' ? { _tag: 'System' } : NANDA
    await run(p, dispatchAct({ by, act, on: state.seq, build: null, current: 'b1' }))
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
const host = { _tag: 'Host' }
const role = { _tag: 'Role', name: 'section-lead' }
const maker = { _tag: 'Maker', id: 'm1' }
const pipe = { _tag: 'Pipe' }
const human = { _tag: 'Human' }
const send = [host, { _tag: 'Open', open: { _tag: 'OpenSend', spec } }]
const askId = (state, kind) => [...state.asks.values()].find((ask) =>
  ask.kind === kind && (kind !== 'Execute' || ask.to._tag === 'Maker')).id

test('the dashboard page, in a real browser', async () => {
  const queued = await opened(() => [send])
  const waiting = await opened((p) => {
    const dir = [...foldWork(eventsOf(p.dir)).state.items].find(([, r]) => r.kind === 'dir')
    const std = [...foldWork(eventsOf(p.dir)).state.items].find(([, r]) => r.kind === 'std')
    const rule = {
      kind: 'rule', parent: std[0], name: 'once', says: 'Say it once.', where: null,
      test: 'true', ref: null, form: 'mech', examples: [],
    }
    const items = new Set([dir[0], 'rule:once'])
    const edited = { ...dir[1], says: `${dir[1].says} Say it once.` }
    const draft = new Map([[dir[0], edited], ['rule:once', rule]])
    return [
      send,
      [role, { _tag: 'Open', open: { _tag: 'OpenMake', task: 't1' } }],
      [maker, { _tag: 'ReadBrief', maker: 'm1' }],
      [maker, (state) => ({
        _tag: 'Report', ask: askId(state, 'Execute'), output: 'o', files: [], caught: new Set(),
      })],
      [role, (state) => ({
        _tag: 'Review', ask: askId(state, 'Check'), verdict: 'RaiseNoRule', points: [],
      })],
      [pipe, {
        _tag: 'Evaluate', fix: 't1', level: 'Direct', parts: [], roleDraft: null, summary,
      }],
      [pipe, { _tag: 'Advance', fix: 't1' }],
      [pipe, { _tag: 'Advance', fix: 't1' }],
      [pipe, {
        _tag: 'WriteRule', fix: 't1', rule: 'rule:once', rec: rule, refOk: true, fights: [],
      }],
      [pipe, { _tag: 'RunTest', fix: 't1', own: true, contra: [] }],
      [pipe, { _tag: 'Ship', fix: 't1', items, draft, resolvesFight: false }],
      [pipe, { _tag: 'LoopReview', mode: 'self-review turns', fix: 't1', toPerson: true }],
      [{ _tag: 'Harness' }, { _tag: 'Revive', actor: role }],
      [role, { _tag: 'Open', open: {
        _tag: 'OpenQuestion', to: human,
        question: { title: 'Which examples?', form: {
          _tag: 'Multiple',
          questions: [
            { description: 'First example', placeholder: 'First' },
            { description: 'Second example', placeholder: 'Second' },
          ],
        } },
      } }],
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
