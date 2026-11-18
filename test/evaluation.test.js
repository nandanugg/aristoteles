// A mistake is evaluated (Nanda, 2026-11-08): when a maker used its last try on a fault, or the
// person rejected the work, the high role says what is wrong, why the task cannot be done as
// asked, and what to improve; the work goes on only on inputs that differ from those that failed.
// The case is Nanda's: A1 (the request handler) keeps failing while A2 (the flag and the env vars)
// was accepted, and the evaluation finds the cause in A2's design.
import { describe, expect, test } from 'bun:test'
import { TASK_WHOLE, ok, started, tokenIn } from './harness.js'

const TSD = (handler, flags) => `# TSD\n\n## Introduction\n\n${handler}\n\n## Design\n\n${flags}\n`
const PARTS = '- { name: Flags and env, text: Write the feature flag and how the env vars are read., context: { section: design } }\n' +
  '- { name: Handler, text: Write the use case and the request handler., context: { section: introduction } }\n'
const LINT = (where) => `--evidence="no-code-proof | ${where} | no paths or hashes there" --evidence="no-ticket-ids | ${where} | no ticket ids there"`
const TYPED = (where) => `--evidence="typed-env | ${where} | the env vars are read through one typed function"`
const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat the request"'
// The standard that the evaluation asks for: it applies to every section of the TSD.
const STANDARD = 'add:\n  - id: typed-config\n    says: Configuration is read in one typed place.\n    rules:\n' +
  '      - { id: typed-env, says: "Env vars are read through one typed function", checkedBy: linter }\n'

// t2 (A2, the flags) is accepted and its writer finished; t3 (A1, the handler) has a writer with
// one try, which reported r2.
async function a2AcceptedA1Reported() {
  const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
  p.write('parts.yaml', PARTS)
  ok(await p.nanda('task split t1 --file=parts.yaml'))
  const flags = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
  const handler = tokenIn(ok(await p.agent(`assign ${lead} t3 --role=writer --max-attempts=1`)).out)
  ok(await p.agent(`brief ${flags}`))
  p.write('docs/tsd.md', TSD('TODO', 'The flag export_v2 is read from the env var EXPORT_V2 where it is used.'))
  ok(await p.agent(`report ${flags} --output=docs/tsd.md#design`))
  const linter = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} r1 accept ${LINT('the design')}`))
  ok(await p.agent(`review ${lead} r1 accept --evidence="docs/tsd.md#design | the flag and the env var are named"`))
  expect(ok(await p.agent('task show t2')).out).toContain('Accepted')
  ok(await p.agent(`finish ${lead} a2`))
  ok(await p.agent(`brief ${handler}`))
  p.write('docs/tsd.md', TSD('The handler reads EXPORT_V2 as a string and compares it with "true".', 'The flag export_v2 is read from the env var EXPORT_V2 where it is used.'))
  ok(await p.agent(`report ${handler} --output=docs/tsd.md#introduction`))
  return { p, lead, linter, handler }
}

describe('a mistake is evaluated, not tried again', () => {
  test('a direction or a principle: the evaluation counts after the person accepts it', async () => {
    const { p, lead } = await a2AcceptedA1Reported()
    const linter3 = tokenIn(ok(await p.agent(`assign ${lead} t3 --role=linter`)).out)
    ok(await p.agent(`brief ${linter3}`))
    ok(await p.agent(`review ${linter3} r2 reject --point="cites ABC-2964" --breaks=no-ticket-ids`))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    // A role with no split act does not evaluate.
    expect((await p.agent(`evaluate ${lead} t3 --wrong=x --why=y --improve=z --level=task`)).err).toContain('a1 (section-lead) has no split act; only a role that splits evaluates a stop')
    ok(await p.agent(`evaluate ${arch} t3 --wrong="r2 cites the ticket" --why="the direction asks for the facts, and the ticket is a fact" ` +
      '--improve="the spirit says that ids are not facts" --level=principle'))
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('ev1 evaluates t3 at the level principle, and waits for Nanda\'s accept')
    const waiting = ok(await p.nanda('waiting')).out
    expect(waiting).toContain('ev1 evaluates t3 at the level principle, and waits for your accept')
    expect(waiting).toContain('work review ev1 accept --evidence="<where you read> | <what you saw>", or reject --reason="..." (read it in full: work evaluation show ev1)')
    ok(await p.nanda('review ev1 accept --evidence="work evaluation show ev1 | an id is a name, not a fact"', 'accept'))
    expect(ok(await p.agent(`next ${arch}`)).out).toContain('ev1 asks for: "the spirit says that ids are not facts"')
  }, 20000)

  test('every workflow has a role that splits, and a task file names no rounds', async () => {
    const { p } = await started()
    p.write('rounds.yaml', TASK_WHOLE + 'maxRounds: 3\n')
    expect((await p.nanda('task open --file=rounds.yaml')).err).toContain('maxRounds is gone')
    const flat = (await import('./harness.js')).WORK_YAML.replace(/ {2}architect:\n(?: {4}.*\n)+/, '')
      .replace('acts: [{ approve: [writer] }]', 'acts: [{ approve: [writer] }]')
    const q = (await import('./harness.js')).project({ 'aristoteles.yaml': flat })
    expect((await q.nanda('init')).err).toContain('no role splits; a role with the split act hosts each project and evaluates a mistake')
  })
})
