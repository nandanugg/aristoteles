import { describe, expect, test } from 'bun:test'
import { init, ok, project, tokenIn, WORK_YAML } from './harness.js'

// The needs model (Nanda, 2026-10-28): a task lists the tasks that it needs and takes no result
// while one of them is not accepted; a split sets the parent's needs to its parts; every result
// needs its decider's accept; a close of a needed task is refused, and the needing task is
// remade instead; a part of the new tree can start from accepted work, and its result is new work.

const TSD_TASK = 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n'
const tsd = (intro, design, failure = 'TODO') => `# TSD\n\n## Introduction\n\n${intro}\n\n## Design\n\n${design}\n\n## Failure\n\n${failure}\n`
const LINT = (where) => `--evidence="no-code-proof | ${where} | no paths or hashes there" --evidence="no-ticket-ids | ${where} | no ticket ids there"`
const PARTS = '- { name: Design, text: Write the design., context: { section: design } }\n' +
  '- { name: Failure, text: Write the failure cases., context: { section: failure } }\n'

const fresh = async (files = {}) => {
  const p = project({ 'task.yaml': TSD_TASK, 'docs/tsd.md': tsd('TODO', 'TODO'), ...files })
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  return p
}
const architect = async (p) => {
  ok(await p.nanda('grant --act=change --on=t1 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  return arch
}
// A writer reports the section of a part; a linter gives its evidence; the architect, who
// decides the writer's results, accepts it.
const partDone = async (p, arch, part, section, text) => {
  const writer = tokenIn(ok(await p.agent(`assign ${arch} ${part} --role=writer`)).out)
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', text)
  const result = ok(await p.agent(`report ${writer} --output=docs/tsd.md#${section}`)).out.match(/^(r\d+) reported/)[1]
  const linter = tokenIn(ok(await p.agent(`assign ${arch} ${part} --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} ${result} accept ${LINT(`the ${section}`)}`))
  ok(await p.agent(`review ${arch} ${result} accept --evidence="docs/tsd.md, the section | the section says what the part asks"`))
  // One maker writes a file at a time: the part is accepted, so its writer finishes.
  ok(await p.agent(`finish ${arch} ${writer.split('.')[0]}`))
  return result
}

describe('needs', () => {
  test('a maker does not start while a task that its task needs is not accepted', async () => {
    const p = await fresh({ 'whole.yaml': 'name: The whole TSD\ntext: Put the TSD together.\ndirections: [tsd-writing]\nneeds: [t1]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    ok(await p.nanda('task open --file=whole.yaml'))
    expect(ok(await p.agent('task show t2')).out).toContain('needs: t1')
    const lead = tokenIn(ok(await p.nanda('assign t2 --role=section-lead')).out)
    ok(await p.agent(`brief ${lead}`))
    expect((await p.agent(`assign ${lead} t2 --role=writer`)).err).toContain('t2 needs t1 (The TSD), which is not accepted; its maker starts after that')
  })

  test('a split sets the needs of the parent to its parts, with no join key', async () => {
    const p = await fresh()
    const arch = await architect(p)
    p.write('parts.yaml', PARTS)
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    expect(ok(await p.agent('task show t1')).out).toContain('needs: t2, t3')
    const brief = ok(await p.agent(`assignment show a1`)).out
    expect(brief).toContain('NEEDS')
    expect(brief).not.toContain('join')
  })

  test('a part that runs after another waits for it: next says so, and its maker starts after it', async () => {
    const p = await fresh()
    const arch = await architect(p)
    p.write('bad.yaml', '- { name: Failure, text: Write the failure cases., after: [Design], context: { section: failure } }\n' +
      '- { name: Design, text: Write the design., context: { section: design } }\n')
    expect((await p.agent(`task split ${arch} t1 --file=bad.yaml`)).err).toContain('part Failure: after names "Design", which is not a part above it')
    p.write('parts.yaml', '- { name: Design, text: Write the design., context: { section: design } }\n' +
      '- { name: Failure, text: Write the failure cases of the design., after: [Design], context: { section: failure } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    expect(ok(await p.agent('task show t3')).out).toContain('needs: t2')
    expect(ok(await p.agent(`next ${arch}`)).out).toContain('t3 Failure runs after t2 Design (Open); its maker starts when t2 is accepted')
    expect((await p.agent(`assign ${arch} t3 --role=writer`)).err).toContain('t3 needs t2 (Design), which is not accepted; its maker starts after that')
    await partDone(p, arch, 't2', 'design', tsd('TODO', 'One file per merchant per day.'))
    expect(ok(await p.agent(`next ${arch}`)).out).not.toContain('runs after')
    ok(await p.agent(`assign ${arch} t3 --role=writer`))
  })

  test('a cycle of needs is refused', async () => {
    const p = await fresh({ 'whole.yaml': 'name: The whole TSD\ntext: Put the TSD together.\ndirections: [tsd-writing]\nneeds: [t1]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n',
      'again.yaml': 'name: The TSD again\ntext: Write the TSD.\ndirections: [tsd-writing]\nneeds: [t2]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    ok(await p.nanda('task open --file=whole.yaml'))
    expect((await p.nanda('task remake t1 --file=again.yaml --reason="narrower"')).err).toContain('a cycle of needs')
  })
})

describe('the decider decides', () => {
  test('a result with all rule evidence still waits for its decider, who may accept or reject', async () => {
    const p = await fresh()
    const arch = await architect(p)
    p.write('parts.yaml', PARTS)
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    const writer = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', tsd('TODO', 'One file per merchant per day.'))
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#design`))
    const linter = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the design')}`))
    expect(ok(await p.agent('blockers r1')).out).toContain('no accept yet by a role that decides r1')
    ok(await p.agent(`review ${arch} r1 accept --evidence="docs/tsd.md, the section | the design says what the part asks"`))
    expect(ok(await p.agent('task show t2')).out).toContain('Accepted')
  })

  test('a role assigns a maker only when it, or a role above it, decides that maker', async () => {
    const p = await fresh({ 'aristoteles.yaml': WORK_YAML.replace('acts: [{ approve: [section-lead, writer] }]', 'acts: [{ approve: [section-lead] }]') })
    const arch = await architect(p)
    expect((await p.agent(`assign ${arch} t1 --role=writer`)).err).toContain('decides no writer results')
  })
})

describe('close and remake', () => {
  test('a close of a needed task is refused: the scope changed, so the needing task is remade', async () => {
    const p = await fresh()
    const arch = await architect(p)
    p.write('parts.yaml', PARTS)
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    const close = await p.agent(`task close ${arch} t3 --reason="the failure cases are in another TSD"`)
    expect(close.err).toContain('t1 needs t3; without it the scope of t1 changes: remake t1')
    expect(close.err).toContain(`work task remake ${arch} t1 --file=<task.yaml>`)
  })

  test('a remake keeps accepted work as the starting point of a new part, and its result is new work', async () => {
    const p = await fresh({ 'narrow.yaml': 'name: The TSD, design only\ntext: Write the design of the export.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    const arch = await architect(p)
    p.write('parts.yaml', PARTS)
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    await partDone(p, arch, 't2', 'design', tsd('TODO', 'One file per merchant per day.'))
    const remake = ok(await p.nanda('task remake t1 --file=narrow.yaml --reason="the failure cases are in another TSD"')).out
    expect(remake).toContain('t1 is remade as t4')
    expect(remake).toContain('closed as replaced: t1, t2, t3')
    expect(ok(await p.agent('task show t4')).out).toContain('replaces t1')
    // The old writer's task is closed: its brief tells it to stop.
    const closed = ok(await p.agent('assignment show a2')).out
    expect(closed).toContain('t2 was closed when t1 was remade as t4')
    // It says only that: no command of the closed task is offered.
    expect(closed).toContain('Run no work command for this task.')
    expect(closed).not.toContain('YOUR TURN')
    const grant = ok(await p.nanda('grant --act=change --on=t4 --to=architect --until=2026-12-31T00:00:00Z', 'grant')).out
    expect(grant).toContain('t4')
    const arch2 = tokenIn(ok(await p.nanda('assign t4 --role=architect')).out)
    ok(await p.agent(`brief ${arch2}`))
    p.write('design.yaml', '- { name: Design, text: Write the design of the export., context: { section: design }, from: r1 }\n')
    ok(await p.agent(`task split ${arch2} t4 --file=design.yaml`))
    const writer = tokenIn(ok(await p.agent(`assign ${arch2} t5 --role=writer`)).out)
    expect(ok(await p.agent(`brief ${writer}`)).out).toContain('FROM     r1 of t2 Design: docs/tsd.md#design')
    expect((await p.agent(`report ${writer} --output=docs/tsd.md#design`)).err).toContain('is the starting point of t5 (r1); a report is new work')
    p.write('docs/tsd.md', tsd('TODO', 'One file per merchant per day, for one merchant.'))
    const id = ok(await p.agent(`report ${writer} --output=docs/tsd.md#design`)).out.match(/^(r\d+) reported/)[1]
    expect(ok(await p.agent(`blockers ${id}`)).out).toContain(`no evidence on ${id} for no-code-proof`)
  })
})
