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

  test('a cycle of needs is refused', async () => {
    const p = await fresh({ 'whole.yaml': 'name: The whole TSD\ntext: Put the TSD together.\ndirections: [tsd-writing]\nneeds: [t1]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n',
      'again.yaml': 'name: The TSD again\ntext: Write the TSD.\ndirections: [tsd-writing]\nneeds: [t2]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    ok(await p.nanda('task open --file=whole.yaml'))
    expect((await p.nanda('task remake t1 --file=again.yaml --reason="narrower"')).err).toContain('a cycle of needs')
  })
})

describe('the decider decides', () => {
})

describe('close and remake', () => {
})
