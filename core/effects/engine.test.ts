// The engine's tick on a temp store with a fake pump: the revive is recorded, then its pane
// started (the prompt an argument); an actor up with no live pane exits, then is revived at the
// next epoch; a revive recorded and never launched is found the same way; a done task with a
// pending test rule gets its RunRule with the harness's holds.
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Layer, type Scope } from 'effect'
import { dispatchAct, openTop } from '../actions/work.ts'
import { h, NANDA, eventsOf } from '../actions/fixture.test.ts'
import { OutsideFailed, type Time } from '../schema/index.ts'
import type { TerminalReading } from '../schema/outside.ts'
import { Dir, Env, FilesLive, Now, Pump, SpawnLive, StoreLive, Tokens } from '../services/index.ts'
import { foldWork } from '../state/c16/fold.ts'
import { epochOf } from '../state/c16/reads.ts'
import { actorOf, type Body } from '../state/c16/types.ts'
import type { ItemRec } from '../state/c16/data.ts'
import { stopHookSettings } from '../../adapters/live/stop-hook.ts'
import { backoffMemory, engineTick, sessionOf } from './engine.ts'

const CONFIG = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')
  .replace('  opus:   {', '  opus:   { launch: "fake {session} {prompt}",')
  .replace('  sonnet: {', '  sonnet: { launch: "fake {session}",')

const LEAD = 'role:section-lead'

// A pump that starts nothing: the test says which sessions live. start records the command.
const fakePump = () => {
  const live = new Set<string>()
  const commands = new Map<string, string>()
  let refuse = false
  const never = Effect.die('not used by the engine')
  const layer = Layer.succeed(Pump, {
    start: (sid, s) =>
      refuse
        ? Effect.fail(new OutsideFailed({ system: 'tmux', message: 'no tmux', next: null }))
        : Effect.sync(() => {
          live.add(sid)
          commands.set(sid, s.command)
        }),
    resume: () => never,
    input: () => never,
    enter: () => never,
    stop: (sid) => Effect.sync(() => void live.delete(sid)),
    forget: (sid) => Effect.sync(() => void live.delete(sid)),
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
  return { layer, live, commands, refuseStarts: (on: boolean) => void (refuse = on) }
}

const askId = (
  state: NonNullable<ReturnType<typeof foldWork>>['state'] | undefined,
  kind: 'Check' | 'Execute',
) => [...(state?.asks.values() ?? [])].find((ask) =>
  ask.kind === kind && (kind !== 'Execute' || ask.to._tag === 'Maker'))!.id

const setup = async (sections = ['a', 'b']) => {
  const { p } = await h.started({ 'aristoteles.yaml': CONFIG })
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
  await run(openTop({ by: NANDA, name: 'T', goal: 'g', sections }))
  const memory = Effect.runSync(backoffMemory)
  const tick = () =>
    run(engineTick({
      prompt: (actor, words, t) => `${actor}|${t.ep}|${t.secret}|${words}`,
      hook: (actor, t) => stopHookSettings(`${actor}.${t.ep}.${t.secret}`),
    }, memory))
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
  return { p, pump, tick, later, state, acts, go }
}

describe('engineTick', () => {
  test('a new top: pipe and role are revived, their panes started with the prompt as argument',
    async () => {
      const t = await setup()
      expect(t.state()?.down.size).toBe(3)
      const lines = await t.tick()
      expect(lines).toEqual([
        'pipe: revived in pipe-e1',
        `${LEAD}: revived in ${sessionOf(LEAD, 1)}`,
      ])
      expect(t.acts('Revive')).toBe(2)
      expect([...(t.state()?.down ?? [])]).toEqual(['host'])
      expect([...t.pump.live].sort()).toEqual(['pipe-e1', 'role-section-lead-e1'])
      const pipe = t.pump.commands.get('pipe-e1') ?? ''
      expect(pipe).toMatch(/^fake [0-9a-f-]{36} 'pipe\|1\|k\d+\|You keep/)
      expect(pipe).toMatch(/ --settings '.*work hook stopped pipe\.1\.k\d+.*'$/)
      expect(pipe).toContain('You keep the TSD on its directions.')
      const lead = t.pump.commands.get('role-section-lead-e1') ?? ''
      expect(lead).toContain(`'${LEAD}|1|k`)
      expect(lead).toContain('You run one section')
      expect(lead).toContain(`work hook stopped ${LEAD}.1.k`)
    }, 90000)

  test('a role-specific local launch takes its effective model from staffing', async () => {
    const t = await setup()
    const binding = {
      account: 'primary', cli: 'agent', allowedModels: ['new'], model: 'new',
      persistent: true, concurrency: 1, subagentAllowance: 0,
      launch: 'staffed {model} {session}',
    }
    t.p.write('.work/staffing.yaml', Bun.YAML.stringify({
      clis: { agent: { backgroundChildren: false, canPark: false } },
      accounts: { primary: { limits: {} } },
      roles: { architect: binding, 'section-lead': binding },
    }))
    await t.tick()
    expect(t.pump.commands.get('pipe-e1')).toStartWith('staffed new ')
    expect(t.pump.commands.get('role-section-lead-e1')).toStartWith('staffed new ')
  }, 90000)

  test('both alive: the tick does nothing', async () => {
    const t = await setup()
    await t.tick()
    const stored = eventsOf(t.p.dir).length
    expect(await t.tick()).toEqual([])
    expect(eventsOf(t.p.dir).length).toBe(stored)
  }, 90000)

  test('a pane gone: its exit is recorded, then it is revived at the next epoch', async () => {
    const t = await setup()
    await t.tick()
    t.later(61_000)
    t.pump.live.delete('pipe-e1')
    expect(await t.tick()).toEqual([
      'pipe: no live pane pipe-e1; its exit is recorded',
      'pipe: revived in pipe-e2',
    ])
    expect(t.acts('Exit')).toBe(1)
    expect(epochOf(t.state()!, { _tag: 'Pipe' })).toBe(2)
    expect(t.pump.live.has('pipe-e2')).toBe(true)
    expect(t.pump.commands.get('pipe-e2')).toContain('pipe|2|')
  }, 90000)

  test('a revive recorded and never launched: exit, then revive again', async () => {
    const t = await setup()
    await t.go('harness', { _tag: 'Revive', actor: { _tag: 'Pipe' } })
    await t.go('harness', { _tag: 'Revive', actor: actorOf(LEAD) })
    t.pump.live.add(sessionOf(LEAD, 1))
    const lines = await t.tick()
    expect(lines).toEqual([
      'pipe: no live pane pipe-e1; its exit is recorded',
      'pipe: revived in pipe-e2',
    ])
    expect(t.acts('Revive')).toBe(3)
    expect(t.acts('Exit')).toBe(1)
  }, 90000)

  test('a failed start backs off 2 s, 4 s, ...; a pane that lives 60 s resets it', async () => {
    const t = await setup()
    t.pump.refuseStarts(true)
    const said = (lines: ReadonlyArray<string>) => lines.filter((l) => l.includes('waits'))
    expect(said(await t.tick()).map((l) => l.slice(0, 5))).toEqual(['pipe:', 'role:'])
    // Waiting: no Exit, no Revive, no line, tick after tick.
    const stored = eventsOf(t.p.dir).length
    t.later(1900)
    expect(await t.tick()).toEqual([])
    expect(eventsOf(t.p.dir).length).toBe(stored)
    // 2 s passed: Exit and Revive again; the start fails and the wait doubles.
    t.later(200)
    expect(said(await t.tick())[0]).toContain('waits 4 s')
    expect(t.acts('Exit')).toBe(2)
    t.later(3900)
    expect(await t.tick()).toEqual([])
    t.pump.refuseStarts(false)
    t.later(200)
    await t.tick()
    expect(t.pump.live.has('pipe-e3')).toBe(true)
    // It dies at once: the wait doubles again (8 s); after 60 s of life it is reset.
    t.pump.live.delete('pipe-e3')
    expect(said(await t.tick())[0]).toContain('waits 8 s')
    t.later(8100)
    await t.tick()
    expect(t.pump.live.has('pipe-e4')).toBe(true)
    t.later(61_000)
    expect(await t.tick()).toEqual([])
    t.pump.live.delete('pipe-e4')
    expect(said(await t.tick())).toEqual([])
    expect(t.pump.live.has('pipe-e5')).toBe(true)
  }, 90000)

  test('the end of the project closes the live panes', async () => {
    const t = await setup(['a'])
    await t.tick()
    const spec = { name: 'n', goal: 'g', sections: ['a'], role: 'section-lead' }
    await t.go('host', { _tag: 'Open', open: { _tag: 'OpenSend', spec } })
    await t.go(LEAD, { _tag: 'Open', open: { _tag: 'OpenMake', task: 't1' } })
    await t.go('maker:m1', { _tag: 'ReadBrief', maker: 'm1' })
    await t.go('maker:m1', {
      _tag: 'Report', ask: askId(t.state(), 'Execute'), output: 'o', files: [], caught: new Set(),
    })
    await t.go(LEAD, { _tag: 'Review', ask: askId(t.state(), 'Check'), verdict: 'Pass', points: [] })
    await t.go('host', { _tag: 'TopDone' })
    await t.go('human', { _tag: 'EndProject' })
    expect(await t.tick()).toEqual([])
    expect([...t.pump.live]).toEqual([])
  }, 90000)

  test('RunRule: a done task with a pending test rule gets the holds of the test', async () => {
    const t = await setup()
    await t.tick()
    t.p.write('docs/tsd.md', '# TSD\n\nBAD line\n')
    const spec = (name: string, section: string): Body => ({
      _tag: 'Open', open: { _tag: 'OpenSend',
        spec: { name, goal: 'g', sections: [section], role: 'section-lead' } },
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
