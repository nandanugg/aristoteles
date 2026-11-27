import { expect, test } from 'bun:test'
import { inProject } from '../../core/effects/pass9-conformance-fixtures.ts'
import { unit2Fixture } from './pass9-live-fixture.ts'

test('pass 9 live session capacity stays charged while a fenced process is unknown', () => inProject(async (dir) => {
  const runtime = await unit2Fixture(dir, true)
  const initial = await runtime.journal()
  expect(initial.slots).toHaveLength(1)
  expect(await runtime.reserveOther()).toBeNull()
  await runtime.fenceWithUnknownProcess()
  expect((await runtime.journal()).slots).toEqual(initial.slots)
  expect(await runtime.reserveOther()).toBeNull()
  await runtime.finishProcess()
  const returned = (await runtime.journal()).slots
  expect(returned).toHaveLength(1)
  expect(returned).not.toEqual(initial.slots)
  expect(await runtime.bindCapacityWaiter()).toBe(true)
}))

test('pass 9 live intake retries only within its authenticated generation', () => inProject(async (dir) => {
  const runtime = await unit2Fixture(dir)
  const { driver } = runtime
  await driver.step({ kind: 'offer', identity: 'Pipe' })
  await driver.step({ kind: 'printOldest' })
  const taken = await driver.step({ kind: 'submit' })
  expect(taken.intake?.outcome).toBe('taken')
  expect(taken.intake?.actsAppended).toBe(1)
  const retry = await runtime.retry()
  if (retry._tag === 'Failure') throw new Error('exact current retry was refused')
  expect(retry.success.again).toBe(true)
  await driver.step({ kind: 'exit' })
  const fenced = await runtime.retry()
  expect(fenced._tag).toBe('Failure')
  await driver.step({ kind: 'relaunch' })
  const retired = await runtime.retry()
  expect(retired._tag).toBe('Failure')
}))

test('pass 9 live intake guards the selected subject, authority, receipt and basis', () => inProject(async (dir) => {
  const { driver, refusePrinted } = await unit2Fixture(dir)
  await driver.step({ kind: 'offer', identity: 'Role' })
  const before = await driver.step({ kind: 'printOldest' })
  for (const [change, refused] of [
    ['identity', 'authority'], ['subject', 'authority'], ['receipt', 'stale'],
  ] as const) {
    const result = await refusePrinted(change)
    if (result.refused !== refused) throw new Error(`expected ${refused} refusal, got ${result.refused}`)
    expect(result.actsAppended).toBe(0)
    expect((await driver.read()).read.activeTurn).toEqual(before.read.activeTurn)
  }
  const basis = await refusePrinted('basis')
  if (basis.refused !== 'basis') throw new Error(`expected basis refusal, got ${basis.refused}`)
  expect(basis.actsAppended).toBe(0)
  if (!(await driver.read()).read.activeTurn) await driver.step({ kind: 'printOldest' })
  expect((await driver.step({ kind: 'submit' })).intake?.outcome).toBe('taken')
}))

test('pass 9 CLI takes the command printed by a live worker wait', () => inProject(async (dir) => {
  const runtime = await unit2Fixture(dir)
  const { driver } = runtime
  await driver.step({ kind: 'offer', identity: 'Role' })
  const printed = await driver.step({ kind: 'printOldest' })
  expect(printed.read.activeTurn?.actor).toBe('Role')
  expect(await runtime.submitPrintedInCli()).toBe(true)
  const { read } = await driver.read()
  expect(read.activeTurn).toBeNull()
  expect(read.owed).toEqual([])
}))
