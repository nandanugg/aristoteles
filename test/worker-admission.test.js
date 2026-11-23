import { expect, test } from 'bun:test'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { eventsOf } from '../core/actions/fixture.test.ts'
import { foldWork } from '../core/state/c16/fold.ts'
import { foldRuntime } from '../core/state/worker-runtime.ts'
import { settleWorker } from '../core/actions/worker.ts'
import { settleGenerationChildren } from '../core/actions/child.ts'
import { init, ok, project, WORK_YAML } from './harness.js'
import { workerIn, workerRuntimeIn, workerTurn } from './worker-fixture.js'

const PROJECT = WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')
const LEAD = 'role:section-lead'
const setup = async ({ allowance = 1, concurrency = 2, background = true, pipeAllowance = 0 } = {}) => {
  const p = project({ 'aristoteles.yaml': PROJECT })
  await init(p)
  const file = '.work/staffing.yaml'
  const staffing = Bun.YAML.parse(readFileSync(join(p.dir, file), 'utf8'))
  staffing.clis.fixture.backgroundChildren = background
  staffing.roles.architect.subagentAllowance = pipeAllowance
  Object.assign(staffing.roles['section-lead'], { subagentAllowance: allowance, concurrency })
  p.write(file, Bun.YAML.stringify(staffing))
  ok(await p.run('top open --name=Test --goal=Test --sections=a,b', { tty: true, workerRuntime: true }))
  const host = await workerIn(p, 'host')
  const lead = await workerIn(p, LEAD)
  for (const section of ['a', 'b']) {
    const step = await workerTurn(p, host.credential, 'send')
    ok(await p.agent(`send ${step.token} --name=${section} --goal=test --sections=${section} --role=section-lead ${step.args}`))
  }
  const state = () => foldWork(eventsOf(p.dir))
  const runtime = () => foldRuntime(eventsOf(p.dir))
  const token = lead.token(LEAD)
  return {
    p, state, runtime, lead, token,
    assign: (task) => p.agent(`assign ${token} ${task}`),
    wait: () => p.agent(`wait ${token} --seconds=0.01`),
    ask: (kind, task) => [...state().state.asks.values()].find((a) => a.kind === kind &&
      a.about.id === task && (kind !== 'Execute' || a.to._tag === 'Maker')).id,
  }
}

test('a positive saturated child allowance leaves work owed until the exact allocation settles', async () => {
  const t = await setup()
  const { p } = t
  try {
    const reserved = ok(await t.assign('t1'))
    const id = reserved.out.match(/child-\d+/)[0]
    expect(t.state().permits.roles).toEqual(new Map([['t1', LEAD]]))
    const child = t.runtime().children.get(id)
    expect(child.started).toBeNull()
    expect(t.runtime().serial.size).toBe(0)
    expect((await t.assign('t2')).err).toContain('waiting for child capacity')
    expect(ok(await t.wait()).out).toContain('waiting for child capacity')
    const launches = await Promise.all([
      p.agent(`worker child-start ${t.token} ${id}`),
      p.agent(`worker child-start ${t.token} ${id}`),
    ])
    const [maker] = launches.map(ok).flatMap((result) => result.out.match(/w\.maker:m1\.0\.[a-f0-9]+/) ?? [])
    expect(launches.filter((result) => result.out.includes(maker))).toHaveLength(1)
    expect((await p.agent(`brief ${maker}`)).err).toContain('no longer current')
    expect(ok(await p.agent(`wait ${maker}`)).out).toContain('work brief')
    ok(await p.agent(`brief ${maker}`))
    const report = `report ${maker} ${t.ask('Execute', 't1')} --output=result --on=${t.state().state.seq}`
    ok(await p.agent(report))
    expect(ok(await p.agent(report)).out).toContain('already')
    expect(t.runtime().children.get(id).released.reason).toBe('reported')
    expect(t.state().permits.roles.get('t1')).toBe(LEAD)
    expect(ok(await t.assign('t2')).out).toContain('Reserved child-')
    expect(t.state().permits.roles.size).toBe(2)
  } finally {
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test('a role attempt cap survives child reconciliation and releases at terminal review', async () => {
  const t = await setup({ concurrency: 1, allowance: 2 })
  const { p } = t
  try {
    const reservation = ok(await t.assign('t1')).out.match(/child-\d+/)[0]
    const { reservation: original } = t.runtime().children.get(reservation)
    ok(await p.agent(`worker child-reconcile ${t.token} ${reservation}`))
    expect(t.state().permits.roles.get('t1')).toBe(LEAD)
    expect((await t.assign('t2')).err).toContain('waiting for an attempt permit')
    expect(ok(await t.wait()).out).toContain('work resume')
    const resumed = ok(await p.agent(`resume ${t.token} m1`)).out.match(/child-\d+/)[0]
    expect(resumed).not.toBe(original.child)
    const launched = ok(await p.agent(`worker child-start ${t.token} ${resumed}`))
    const maker = launched.out.match(/w\.maker:m1\.1\.[a-f0-9]+/)[0]
    ok(await p.agent(`wait ${maker}`))
    ok(await p.agent(`brief ${maker}`))
    ok(await p.agent(`report ${maker} ${t.ask('Execute', 't1')} --output=made --on=${t.state().state.seq}`))
    ok(await p.agent(`review ${t.token} ${t.ask('Check', 't1')} pass --on=${t.state().state.seq}`))
    expect(t.state().permits.roles.size).toBe(0)
    expect(ok(await t.assign('t2')).out).toContain('Reserved child-')
    const worker = t.runtime().workers.get('role:section-lead').reservation
    await workerRuntimeIn(p, settleWorker(worker.worker, worker.generation, worker.launch))
    expect([...t.runtime().children.values()].filter(({ released }) => !released)).toHaveLength(1)
    await workerRuntimeIn(p, settleWorker(worker.worker, worker.generation, worker.launch, 'process ended'))
    await workerRuntimeIn(p, settleGenerationChildren(worker.worker, worker.generation))
    await workerRuntimeIn(p, settleGenerationChildren(worker.worker, worker.generation))
    expect([...t.runtime().children.values()].filter(({ released }) => !released)).toHaveLength(0)
    expect(t.state().permits.roles.get('t2')).toBe(LEAD)
  } finally {
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test.each([[0, true], [3, false]])('serial maker and review with allowance %s and background=%s',
  async (allowance, background) => {
    const t = await setup({ allowance, background })
    const { p } = t
    try {
      expect(ok(await t.assign('t1')).out).toContain('will work on this worker')
      expect(t.runtime().children.size).toBe(0)
      expect(t.runtime().serial.size).toBe(1)
      expect((await t.assign('t2')).err).toContain('serial maker')
      const brief = await workerTurn(p, t.lead.credential, 'brief')
      expect(brief.token).toMatch(/^w\.maker:m1\./)
      ok(await p.agent(`brief ${brief.token} ${brief.args}`))
      const report = await workerTurn(p, t.lead.credential, 'report')
      ok(await p.agent(`report ${report.token} ${t.ask('Execute', 't1')} --output=made ${report.args}`))
      const review = await workerTurn(p, t.lead.credential, 'review')
      expect(review.token).toBe(t.token)
      ok(await p.agent(`review ${review.token} ${t.ask('Check', 't1')} pass ${review.args}`))
      expect(t.state().permits.roles.size).toBe(0)
      expect(ok(await t.assign('t2')).out).toContain('will work on this worker')
    } finally {
      rmSync(p.dir, { recursive: true, force: true })
    }
  })

test('private direct spelling claims an owed turn atomically and rejects discretionary acts', async () => {
  const t = await setup()
  const { p } = t
  try {
    const count = eventsOf(p.dir).length
    expect((await p.agent(`ask ${t.token} human --text=unexpected`)).err).toContain('next owed step')
    expect(eventsOf(p.dir)).toHaveLength(count)
    ok(await t.assign('t1'))
    const last = eventsOf(p.dir).at(-1).event.create
    expect(last.inlineOffer).toMatchObject({ actor: LEAD, step: { task: 't1', act: 'Open' } })
    expect(last.delivery).toMatchObject({ kind: 'private', actor: LEAD })
    expect(last.childReserved).toMatchObject({ parentActor: LEAD, attempt: 't1' })
  } finally {
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test('the Pipe cap blocks younger fixes and handoff returns the permit', async () => {
  const t = await setup({ allowance: 0, pipeAllowance: 1 })
  const { p } = t
  try {
    for (const task of ['t1', 't2']) {
      ok(await t.assign(task))
      const brief = await workerTurn(p, t.lead.credential, 'brief')
      ok(await p.agent(`brief ${brief.token} ${brief.args}`))
      const report = await workerTurn(p, t.lead.credential, 'report')
      ok(await p.agent(`report ${report.token} ${t.ask('Execute', task)} --output=made ${report.args}`))
      const review = await workerTurn(p, t.lead.credential, 'review')
      ok(await p.agent(`review ${review.token} ${t.ask('Check', task)} raise-no-rule ${review.args}`))
    }
    const { admissionFor } = await import('../core/derived/c16/admission.ts')
    expect(admissionFor(t.state(), t.runtime(), 'pipe', { fix: 't2' })).toMatchObject({ kind: 'waiting' })
    const runtime = t.runtime()
    const current = runtime.workers.get('role:architect')
    const root = readFileSync(join(p.dir, '.work/runtime', `launch-${current.reservation.launch}`, 'secret'), 'utf8')
    const credential = `g.${current.reservation.launch}.${current.reservation.generation}.${root}`
    const step = await workerTurn(p, credential, 'evaluate')
    expect(step.words).toContain('t1')
    p.write('role.yaml', 'role: section-lead\nwords: Recheck the evidence.\nmodel: sonnet\n')
    ok(await p.agent(`evaluate ${step.token} t1 fit --summary=escalate --role-draft=role.yaml ${step.args}`))
    expect(t.state().permits.fixes.has('t1')).toBe(true)
    expect(admissionFor(t.state(), t.runtime(), 'pipe', { fix: 't2' }).kind).toBe('waiting')
    const loop = await workerTurn(p, credential, 'loop')
    const verdict = `loop ${loop.token} t1 person --mode="fresh subagent" ${loop.args}`
    expect((await p.agent(verdict)).err).toContain('no completed fresh review')
    const reserved = ok(await p.agent(`worker child-review ${loop.token} t1 ${loop.args}`))
    const child = reserved.out.match(/child-\d+/)[0]
    const started = ok(await p.agent(`worker child-start ${loop.token} ${child}`))
    const reviewer = started.out.match(/w\.review:child-\d+\.0\.[a-f0-9]+/)[0]
    expect((await p.agent(`worker child-review-done ${reviewer}`)).code).toBe(1)
    ok(await p.agent(`worker child-ack ${reviewer}`))
    ok(await p.agent(`worker child-review-done ${reviewer}`))
    ok(await p.agent(verdict))
    expect(t.state().permits.fixes.has('t1')).toBe(false)
    expect(admissionFor(t.state(), t.runtime(), 'pipe', { task: 't2' }).kind).toBe('ordinary')
    const second = await workerTurn(p, credential, 'evaluate')
    expect(second.words).toContain('t2')
  } finally {
    rmSync(p.dir, { recursive: true, force: true })
  }
})

test('a successor can reconcile an authorized native launch after its parent ends', async () => {
  const t = await setup({ concurrency: 1 })
  const { p } = t
  try {
    const starts = await Promise.all([t.assign('t1'), t.assign('t1')])
    expect(starts.map(ok).map(({ out }) => out.match(/child-\d+/)[0])).toEqual(
      Array(2).fill(starts[0].out.match(/child-\d+/)[0]))
    expect(t.runtime().children.size).toBe(1)
    const [id, child] = [...t.runtime().children][0]
    ok(await p.agent(`worker child-start ${t.token} ${id}`))
    const { worker, generation } = child.reservation
    const { launch } = t.runtime().workers.get(worker).reservation
    await workerRuntimeIn(p, settleWorker(worker, generation, launch))
    await workerRuntimeIn(p, settleWorker(worker, generation, launch, 'process ended'))
    await workerRuntimeIn(p, settleGenerationChildren(worker, generation))
    expect(t.runtime().children.get(id).released).toBeNull()
    const replacement = (await workerIn(p, LEAD)).token(LEAD)
    expect((await p.agent(`worker child-reconcile ${replacement} ${id}`)).err).toContain('native CLI observation')
    expect((await p.agent(`resume ${replacement} m1`)).err).toContain('child capacity')
    ok(await p.agent(`worker child-reconcile ${replacement} ${id} --observation="Native CLI confirmed no launch"`))
    expect(ok(await p.agent(`resume ${replacement} m1`)).out).toContain('Reserved child-')
    expect(t.state().permits.roles.get('t1')).toBe(LEAD)
  } finally {
    rmSync(p.dir, { recursive: true, force: true })
  }
})
