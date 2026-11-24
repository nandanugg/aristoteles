// Worker launch, observation and recovery with a fake pump, and a real harness rule check.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Layer, type Scope } from 'effect'
import { dispatchAct, openTop, writeTop } from '../actions/work.ts'
import { h, NANDA, eventsOf } from '../actions/fixture.test.ts'
import { OutsideFailed, type Time } from '../schema/index.ts'
import type { TerminalReading } from '../schema/outside.ts'
import { Dir, Env, FilesLive, Now, Pump, sha, SpawnLive, stageWorkerLaunch, StoreLive, Tokens } from '../services/index.ts'
import { foldRuntime } from '../state/worker-runtime.ts'
import { foldWork } from '../state/c16/fold.ts'
import { epochOf } from '../state/c16/reads.ts'
import { actorOf, type Body } from '../state/c16/types.ts'
import type { ItemRec } from '../state/c16/data.ts'
import { backoffMemory, engineTick } from './engine.ts'

const CONFIG = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')
  .replace('  opus:   {', '  opus:   { launch: "fake {session} {prompt}",')
  .replace('  sonnet: {', '  sonnet: { launch: "fake {session}",')

const LEAD = 'role:section-lead'

// A pump that starts nothing: the test says which sessions live. start records the command.
const fakePump = () => {
  const live = new Set<string>()
  const commands = new Map<string, string>()
  const environments = new Map<string, Readonly<Record<string, string>>>()
  let observable = true
  let refuse = false
  const never = Effect.die('not used by the engine')
  const layer = Layer.succeed(Pump, {
    start: (sid, s) =>
      refuse
        ? Effect.fail(new OutsideFailed({ system: 'tmux', message: 'no tmux', next: null }))
        : Effect.sync(() => {
          live.add(sid)
          commands.set(sid, s.command)
          environments.set(sid, s.env)
        }),
    resume: () => never,
    input: () => never,
    enter: () => never,
    stop: (sid) => Effect.sync(() => void live.delete(sid)),
    forget: (sid) => Effect.sync(() => void live.delete(sid)),
    observe: (sid) => Effect.sync(() => !observable ? 'unknown' : live.has(sid) ? 'live' : 'ended'),
    status: Effect.sync(() =>
      Object.fromEntries(
        [...live].map((sid): [string, TerminalReading] => [sid, { _tag: 'Live', lastOutput: 0 }]),
      )
    ),
    tail: () => never,
    adopt: () => never,
    release: () => never,
    paneOf: () => never,
    keysAt: () => never,
  })
  return { layer, live, commands, environments, observe: (on: boolean) => void (observable = on),
    refuseStarts: (on: boolean) => void (refuse = on) }
}

const askId = (
  state: NonNullable<ReturnType<typeof foldWork>>['state'] | undefined,
  kind: 'Check' | 'Execute',
) => [...(state?.asks.values() ?? [])].find((ask) =>
  ask.kind === kind && (kind !== 'Execute' || ask.to._tag === 'Maker'))!.id

const setup = async (managed = false, sessionLimit?: number) => {
  const { p } = await h.started({ 'aristoteles.yaml': CONFIG })
  if (sessionLimit !== undefined) {
    const file = '.work/staffing.yaml'
    const staffing = Bun.YAML.parse(readFileSync(join(p.dir, file), 'utf8')) as {
      accounts: { fixture: { sessionLimit?: number } }
    }
    staffing.accounts.fixture.sessionLimit = sessionLimit
    p.write(file, Bun.YAML.stringify(staffing))
  }
  const pump = fakePump()
  const clock = { ms: Date.parse(p.now()) }
  let n = 0
  const layer = Layer.mergeAll(
    StoreLive.pipe(
      Layer.provide(
        Layer.succeed(Env, { vars: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') } }),
      ),
    ),
    Layer.succeed(Dir, { cwd: p.dir }),
    Layer.succeed(Now, { read: Effect.sync(() => new Date(clock.ms).toISOString() as Time) }),
    Layer.succeed(Tokens, { random: Effect.sync(() => `k${++n}`) }),
    FilesLive,
    SpawnLive,
    pump.layer,
  )
  const run = <A, E>(e: Effect.Effect<A, E, Layer.Success<typeof layer> | Scope.Scope>) =>
    Effect.runPromise(Effect.scoped(e).pipe(Effect.provide(layer)))
  const top = { by: NANDA, name: 'T', goal: 'g', sections: ['a', 'b'] }
  await run(managed ? openTop(top) : writeTop(top, false))
  const memory = Effect.runSync(backoffMemory)
  const tick = () =>
    run(engineTick({}, memory))
  const state = () => foldWork(eventsOf(p.dir))?.state
  const acts = (tag: string) =>
    eventsOf(p.dir).filter((r) =>
      r.event._tag === 'Work' && r.event.create._tag === 'Acted' &&
      r.event.create.act.body._tag === tag
    ).length
  let x = 0
  // An act of an actor on the state as it is now.
  const go = (who: string, body: Body) => {
    const s = state()
    return run(dispatchAct({
      by: NANDA,
      act: { id: `t${++x}`, who: actorOf(who), ep: s === undefined ? 0 : epochOf(s, actorOf(who)), body },
      on: s?.seq ?? null,
      build: null,
      current: 'b',
    }))
  }
  const later = (ms: number) => void (clock.ms += ms)
  const runtime = () => foldRuntime(eventsOf(p.dir))
  const ack = (session: string) => {
    const [, launch, , root] = pump.environments.get(session)!.ARISTOTELES_WORKER_CREDENTIAL!.split('.')
    stageWorkerLaunch(p.dir, launch!, 'ack', sha(root!))
  }
  return { p, pump, tick, later, state, acts, go, runtime, ack }
}

describe('engineTick', () => {
  test('work init uses one launch per worker and waits for exact acknowledgement', async () => {
    const t = await setup(true)
    await t.tick()
    expect([...t.runtime().workers.keys()].sort()).toEqual(['role:architect', 'role:section-lead'])
    expect(t.pump.live.size).toBe(2)
    expect(t.acts('Revive')).toBe(0)
    const parent = t.runtime().workers.get('role:architect')!
    expect([...parent.reservation.members].sort()).toEqual(['host', 'pipe'])
    const sid = `worker-${parent.reservation.launch}`
    expect(t.pump.commands.get(sid)).toContain('worker ack')
    await t.tick()
    expect(t.runtime().workers.get('role:architect')?.binding).toBeNull()
    t.ack(sid)
    await t.tick()
    expect(t.runtime().workers.get('role:architect')?.binding?.session).toBe(sid)
    await t.tick()
    expect(t.pump.live.size).toBe(2)
  })

  test('a session cap holds through uncertain loss and reopens after a confirmed end', async () => {
    const t = await setup(true, 1)
    await t.tick()
    const current = t.runtime().workers.get('role:architect')!
    const sid = `worker-${current.reservation.launch}`
    t.ack(sid)
    await t.tick()
    t.pump.live.delete(sid)
    t.pump.observe(false)
    await t.tick()
    expect(t.runtime().workers.get('role:architect')?.ended).toBe(false)
    expect(t.runtime().workers.has('role:section-lead')).toBe(false)
    t.pump.observe(true)
    await t.tick()
    expect(t.runtime().workers.get('role:architect')?.ended).toBe(true)
    expect(t.runtime().workers.get('role:section-lead')?.reservation.generation).toBe(1)
    expect(t.pump.live.size).toBe(1)
  })

  test('failed group launches back off and a retry uses a fresh reservation', async () => {
    const t = await setup(true)
    t.pump.refuseStarts(true)
    expect((await t.tick()).length).toBe(2)
    const first = t.runtime().workers.get('role:architect')!.reservation
    await t.tick()
    expect(t.runtime().workers.get(first.worker)?.ended).toBe(true)
    expect(t.runtime().workers.get(first.worker)?.reservation.generation).toBe(1)
    t.pump.refuseStarts(false)
    t.later(2001)
    await t.tick()
    const next = t.runtime().workers.get(first.worker)!.reservation
    expect(next.generation).toBe(2)
    expect(next.launch).not.toBe(first.launch)
    expect(t.pump.live.size).toBe(2)
  })

  test('RunRule: a done task with a pending test rule gets the holds of the test', async () => {
    const t = await setup()
    await t.go('harness', { _tag: 'Revive', actor: { _tag: 'Pipe' } })
    await t.go('harness', { _tag: 'Revive', actor: actorOf(LEAD) })
    t.p.write('docs/tsd.md', '# TSD\n\nBAD line\n')
    const spec = (name: string, section: string): Body => ({
      _tag: 'Open', open: { _tag: 'OpenSend',
        spec: { name, goal: 'g', sections: [section], facts: {}, role: 'section-lead' } },
    })
    const make = async (task: string, maker: string) => {
      await t.go(LEAD, { _tag: 'Open', open: { _tag: 'OpenMake', task } })
      await t.go(`maker:${maker}`, { _tag: 'ReadBrief', maker })
      await t.go(`maker:${maker}`, {
        _tag: 'Report', ask: askId(t.state(), 'Execute'), output: 'o', files: ['docs/tsd.md'], caught: new Set(),
      })
    }
    await t.go('host', spec('one', 'a'))
    await t.go('host', spec('two', 'b'))
    await make('t2', 'm1')
    await t.go(LEAD, { _tag: 'Review', ask: askId(t.state(), 'Check'), verdict: 'Pass', points: [] })
    await make('t1', 'm2')
    await t.go(LEAD, { _tag: 'Review', ask: askId(t.state(), 'Check'), verdict: 'RaiseNoRule', points: [] })
    await t.go('pipe', {
      _tag: 'Evaluate', fix: 't1', level: 'Standard', parts: [], roleDraft: null, summary: 's',
    })
    await t.go('pipe', { _tag: 'Advance', fix: 't1' })
    const std = [...(t.state()?.items.keys() ?? [])].find((x) => x.startsWith('std:')) ?? ''
    const rec: ItemRec = {
      kind: 'rule', parent: std, name: 'r9', says: 's', where: null, test: 'grep -n BAD',
      ref: null, form: 'mech', examples: [],
    }
    await t.go('pipe', { _tag: 'WriteRule', fix: 't1', rule: 'rule:r9', rec, refOk: true, fights: [] })
    await t.go('pipe', { _tag: 'RunTest', fix: 't1', own: true, contra: [] })
    await t.go('pipe', {
      _tag: 'Ship', fix: 't1', items: new Set(['rule:r9']), draft: new Map([['rule:r9', rec]]), resolvesFight: false,
    })
    expect([...(t.state()?.tasks.get('t2')?.pending ?? [])]).toEqual(['rule:r9'])
    expect(await t.tick()).toEqual([])
    expect(t.acts('RunRule')).toBe(1)
    const ran = eventsOf(t.p.dir).flatMap((r) =>
      r.event._tag === 'Work' && r.event.create._tag === 'Acted' &&
        r.event.create.act.body._tag === 'RunRule'
        ? [r.event.create.act.body]
        : []
    )
    expect(ran).toEqual([{ _tag: 'RunRule', task: 't2', holds: false }])
    expect(t.state()?.tasks.get('t2')?.pending.size).toBe(0)
  }, 90000)
})
