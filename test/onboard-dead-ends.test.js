import { initializeLegacy } from './legacy-onboarding-fixture.js'
// Onboarding states that had no way out (plan/research/illegal-states 3-dead-ends.md Part 3 and
// 2-type-shapes.md section 2): an accepted file with no draft, a start that is refused while every
// card shows Accepted, a config draft that froze, refusals whose next line needs a store, a
// question on a file with no draft, and a skill that misquotes the CLI. One reader says whether
// the store can start (core/actions startStateOf): status, wait, the page and the start read it.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Effect, Exit } from 'effect'
import { personAct, readOnboarding } from '../core/services/index.ts'
import {
  ok,
  ONBOARD_CONFIG,
  ONBOARD_DIRECTION,
  ONBOARD_QUESTIONS,
  onboardingProject,
  withModels,
} from './harness.js'

const ROLES = ['architect', 'section-lead', 'writer', 'linter']
const lines = (r) => `${r.out}\n${r.err}`

async function drafted() {
  const p = onboardingProject()
  p.write('draft.yaml', ONBOARD_CONFIG)
  ok(await p.agent('onboard config --file=draft.yaml'))
  ok(await p.agent('onboard found tsd-writing'))
  p.write('tsd.yaml', ONBOARD_DIRECTION)
  ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml'))
  return p
}
const acceptRoles = async (p, roles = ROLES) => {
  for (const r of roles) ok(await p.nanda(`onboard accept-role ${r}`))
}

describe('T2: an onboarding file is one stage, so an accept always has its draft', () => {
  // The old shape let a file be Accepted with no draft: the store start then died (a bug, code 70).
  test('a file Accepted with no draft reads as Reset; the start refuses it, and never dies', async () => {
    const p = await drafted()
    ok(await p.nanda('onboard approve-directions', 'approve'))
    await acceptRoles(p)
    const old = 'id: old-one\nasked: { _tag: Found }\ndraft: { _tag: Reset }\nquestions: []\n' +
      'request: { _tag: None }\naccepted: { _tag: Accepted }\n'
    p.write('.work/assess/old-one.yaml', old)
    const status = ok(await p.agent('onboard status')).out
    expect(status).toContain('  old-one · Loading · found in the project')
    expect(status).toContain('old-one is not in the current shape: the host drafts it again')
    const start = await initializeLegacy(p)
    expect(start.code).toBe(1)
    expect(start.err).toBe(
      'refused: old-one is not accepted yet\n' +
        'next: resolve old-one, then approve the reviewed directions together (work onboard approve-directions)',
    )
  })

  // 2-type-shapes.md value 3: a Revise beside an accept. A role has one decision now, so such an
  // entry does not read (no fallback: the host writes the roles again).
  test('a role entry with a Revise beside its accept does not read', async () => {
    const p = await drafted()
    await acceptRoles(p)
    const old = (role) =>
      `${role}:\n  summary: the ${role}\n  found: { _tag: New }\n` +
      '  request: { _tag: Revise, words: shorter }\n  accepted: { _tag: Accepted }\n'
    p.write('.work/assess/roles.yaml', ROLES.map(old).join(''))
    const r = await p.agent('onboard status')
    expect(r.code).toBe(1)
    expect(r.err).toStartWith('refused: <project>/.work/assess/roles.yaml does not read: Missing key')
  })
})

describe('O1: one reader says whether the store can start', () => {
  test('a person cannot remove a role that an accepted rule names; the refusal names a revise that works', async () => {
    const p = await drafted()
    ok(await p.nanda('onboard approve-directions', 'approve'))
    const r = await p.nanda('onboard remove-role linter')
    expect(r.code).toBe(1)
    expect(r.err).toBe(
      'refused: linter checks the rule no-code-proof of tsd-writing, so the store cannot start without it\n' +
        'next: revise tsd-writing first, so that the host names another checker: work onboard ' +
        'revise tsd-writing --words="<who checks no-code-proof instead of linter>"',
    )
    ok(await p.nanda('onboard revise tsd-writing --words="the writer checks no-code-proof"'))
  })

  // Two accepted directions use one rule id: every card shows Accepted, and the start refuses.
  test('a blocked start: status names it and who fixes it, the wait wakes, the start refuses alike', async () => {
    const p = await drafted()
    ok(await p.agent('onboard found tsd-copy'))
    const copy = ONBOARD_DIRECTION.replaceAll('tsd-writing', 'tsd-copy').replace('name: TSD writing', 'name: TSD copy')
    p.write('copy.yaml', copy)
    ok(await p.agent('onboard draft tsd-copy --file=copy.yaml'))
    ok(await p.nanda('onboard approve-directions', 'approve'))
    await acceptRoles(p)
    // The ids sort tsd-copy first, so tsd-writing is the one that uses the id again.
    const blocked = 'the store cannot start: the rule id "no-code-proof" is already used; a new rule needs a new id'
    const fix = 'the host drafts tsd-writing again (work onboard draft tsd-writing --file=<direction.yaml>), then the person accepts it'
    const status = ok(await p.agent('onboard status')).out
    expect(status).not.toContain('everything is accepted')
    expect(status.split('\n').at(-1)).toStartWith(`next: ${blocked}`)
    expect(status.split('\n').at(-1)).toEndWith(fix)
    const wait = ok(await p.agent('onboard wait --seconds=1')).out
    expect(wait).not.toContain('nothing waits for the host yet')
    expect(wait).toContain(blocked)
    const start = await initializeLegacy(p)
    expect(start.code).toBe(1)
    expect(start.err).toStartWith(`refused: ${blocked}`)
    expect(start.err).toContain(`next: ${fix}`)
    // The host's step works: it drafts the accepted direction again, with its own rule ids.
    const ids = ['no-code-proof', 'no-ticket-ids', 'repeatable']
    p.write('tsd.yaml', ids.reduce((t, id) => t.replaceAll(id, `own-${id}`), ONBOARD_DIRECTION))
    expect(ok(await p.agent('onboard draft tsd-writing --file=tsd.yaml')).out).toStartWith(
      'tsd-writing: drafted, with',
    )
    ok(await p.nanda('onboard approve-directions', 'approve'))
    expect(ok(await p.agent('onboard status')).out).toContain(
      'next: accept the journal onboarding proposals to activate the project',
    )
    ok(await initializeLegacy(p))
  })

  test('the only persistent role that splits cannot go, as it has no toggle', async () => {
    const p = await drafted()
    const r = await p.nanda('onboard remove-role architect')
    expect(r.code).toBe(1)
    expect(r.err).toContain('refused: architect is the role of the top task (the only persistent role that splits)')
    expect(r.err).not.toContain('work waiting')
  })
})

describe('O2: the config draft never freezes before the store', () => {
  // The real case (2026-11-15): one role accepted, then the host changes the commands of a model
  // and moves a role to another model. Only the roles that the change touches wait for the person
  // again: the roles of that model, and the role that moved.
  test('staffing edits leave responsibility accepts in place', async () => {
    const p = await drafted()
    await acceptRoles(p)
    const changed = withModels(ONBOARD_CONFIG, { haiku: { launch: 'small --session-id {session}' } }).replace(
      'linter:\n    model: haiku',
      'linter:\n    model: sonnet',
    )
    p.write('draft2.yaml', changed)
    ok(await p.agent('onboard config --file=draft2.yaml'))
    const status = ok(await p.agent('onboard status')).out
    expect(status).toContain('  architect · Accepted')
    expect(status).toContain('  section-lead · Accepted')
    expect(status).toContain('  writer · Accepted')
    expect(status).toContain('  linter · Accepted · sonnet')
  })

  test('a person outside the people gets a next line that works, and the accepts stay', async () => {
    const p = await drafted()
    ok(await p.nanda('onboard accept-role writer'))
    const budi = (act) => Effect.runPromiseExit(personAct(p.dir, 'Budi', act))
    const refused = await budi({ act: 'accept-role', role: 'linter' })
    expect(JSON.stringify(Exit.isFailure(refused) && refused.cause)).toContain(
      'the host adds Budi to the people: work onboard config --file=<draft.yaml>',
    )
    p.write('draft2.yaml', ONBOARD_CONFIG.replace('people:\n  - name: Nanda\n', 'people:\n  - name: Nanda\n  - name: Budi\n'))
    ok(await p.agent('onboard config --file=draft2.yaml'))
    expect(Exit.isSuccess(await budi({ act: 'accept-role', role: 'linter' }))).toBe(true)
    const files = await Effect.runPromise(readOnboarding(p.dir))
    const decided = files.roles.filter((r) => r.decision._tag === 'Accepted').map((r) => r.role)
    expect(decided).toEqual(['writer', 'linter'])
  })
})

describe('O3: before the store, a refusal never points to a step that needs a store', () => {
  test('a refusal with no next line points to work onboard status', async () => {
    const p = await drafted()
    p.write('.work/assess/roles.yaml', 'not: [a, record\n')
    const r = await p.nanda('onboard status')
    expect(r.code).toBe(1)
    expect(r.err.split('\n').at(-1)).toBe('next: work onboard status shows what waits')
    const host = await p.agent('onboard status')
    expect(host.err.split('\n').at(-1)).toBe('next: work onboard status shows what waits')
  })
})

describe('O4: a question needs a draft', () => {
  test('ask on a file in an older shape is refused, with the draft as its next step', async () => {
    const p = await drafted()
    p.write('.work/assess/old-one.yaml', 'id: old-one\nasked: { _tag: Found }\ncase: { a: 1 }\n')
    p.write('q.yaml', ONBOARD_QUESTIONS)
    const r = await p.agent('onboard ask old-one --file=q.yaml')
    expect(r.code).toBe(1)
    expect(r.err).toBe(
      'refused: old-one is not in the current shape: the host drafts it again; a question is about a draft\n' +
        'next: draft it first: work onboard draft old-one --file=<direction.yaml>',
    )
    // On a drafted file the reply says the state that the page shows.
    expect(ok(await p.agent('onboard ask tsd-writing --file=q.yaml')).out).toStartWith(
      'tsd-writing: a question for the person; it shows Question.',
    )
  })
})

test('the assessment skill names the shipped journal onboarding commands', () => {
  const root = join(import.meta.dir, '..')
  const skill = readFileSync(join(root, 'skills', 'assess', 'SKILL.md'), 'utf8')
  const result = Bun.spawnSync([process.execPath, join(root, 'bin', 'work.js'), 'help'])
  expect(result.exitCode).toBe(0)
  const help = result.stdout.toString()
  for (const command of ['work onboard open', 'work onboard submit', 'work onboard status', 'work session launch', 'work start']) {
    expect(skill).toContain(command)
    expect(help).toContain(command)
  }
  expect(skill).toContain('ReadyToReview')
  expect(skill).not.toContain('work onboard config')
})
