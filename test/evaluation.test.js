// A mistake is evaluated (Nanda, 2026-11-08): when a maker used its last try on a fault, or the
// person rejected the work, the high role says what is wrong, why the task cannot be done as
// asked, and what to improve; the work goes on only on inputs that differ from those that failed.
// The case is Nanda's: A1 (the request handler) keeps failing while A2 (the flag and the env vars)
// was accepted, and the evaluation finds the cause in A2's design.
import { describe, expect, test } from 'bun:test'
import { TASK_WHOLE, ok, started, tokenIn } from './harness.js'

const TSD = (handler, flags) => `# TSD\n\n## Introduction\n\n${handler}\n\n## Design\n\n${flags}\n`
const PARTS = '- { name: Flags and env, text: Write the feature flag and how the env vars are read., context: { region: design } }\n' +
  '- { name: Handler, text: Write the use case and the request handler., context: { region: introduction } }\n'
const LINT = (where) => `--evidence="no-code-proof | ${where} | no paths or hashes there" --evidence="no-ticket-ids | ${where} | no ticket ids there"`
const TYPED = (where) => `--evidence="typed-env | ${where} | the env vars are read through one typed function"`
const REPEATABLE = '--evidence="repeatable | the introduction | a reviewer can repeat the request"'
// The standard that the evaluation asks for: it applies to every region of the TSD.
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
  test('Nanda\'s case: A1 fails, the evaluation finds the cause in A2, A2 gets only a check, and A1 goes on', async () => {
    const { p, lead, handler } = await a2AcceptedA1Reported()
    const linter3 = tokenIn(ok(await p.agent(`assign ${lead} t3 --role=linter`)).out)
    ok(await p.agent(`brief ${linter3}`))
    ok(await p.agent(`review ${linter3} r2 reject --point="the handler parses a string flag by hand" --breaks=no-code-proof`))
    // The last try of a3 ended on a fault: t3 waits for an evaluation, and no new writer starts.
    expect((await p.agent(`assign ${lead} t3 --role=writer`)).err).toContain('t3 waits for an evaluation of the last try of a3')
    ok(await p.nanda('grant --act=change --on=tsd-writing,t1 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    expect(ok(await p.agent(`next ${arch}`)).out).toContain('evaluate t3: a3 used its last try on a fault (ex1: r2, the handler parses a string flag by hand)')
    ok(await p.agent(`evaluate ${arch} t3 --wrong="r2 parses the flag EXPORT_V2 by hand, and the linter rejects it" ` +
      '--why="A2 reads the env vars where they are used, with no type, so the handler cannot read the flag in a safe way" ' +
      '--improve="env vars are read through one typed function, also in A2" --level=standard'))
    // The evaluation alone does not reopen t3: the inputs of a3 are the same.
    expect((await p.agent(`brief ${handler}`)).err).toContain('has the inputs that failed in the last try of a3')
    // The person approves the standard that the evaluation asks for.
    p.write('typed.yaml', STANDARD)
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=typed.yaml`))
    ok(await p.nanda('review d2 accept --evidence="directions/tsd-writing.yaml | one typed place for config"', 'accept'))
    // A2 was accepted, and the new standard applies to it: it gets a check, and no new writer.
    const next = ok(await p.agent(`next ${lead}`)).out
    expect(next).toContain('check r1 again under the new version')
    expect(ok(await p.agent('task show t2')).out).not.toContain('Accepted')
    // A1 goes on: the change resets a3's try, and its brief shows the evaluation.
    const brief = ok(await p.agent(`brief ${handler}`)).out
    expect(brief).toContain('EVALUATION')
    expect(brief).toContain('ev1 (standard, a6) wrong: r2 parses the flag EXPORT_V2 by hand')
    expect(brief).toContain('improve: env vars are read through one typed function, also in A2')
  }, 20000)

  test('the person\'s Reject is evaluated first; then its answer rules hold as before', async () => {
    const { p, lead, linter, handler } = await a2AcceptedA1Reported()
    expect(handler).toBeDefined()
    expect(linter).toBeDefined()
    // The person criticises the accepted A2 (its deciders accepted it).
    const v = ok(await p.nanda('review r1 reject --point="the flag has no default"')).out.match(/^(v\d+): reject/)[1]
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('t2 waits for an evaluation: Nanda rejected r1 (v4): "the flag has no default"')
    ok(await p.nanda('grant --act=change --on=tsd-writing,t1 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('edit.yaml', 'add:\n  - { id: defaults, says: Every flag has a default. }\n')
    const revise = `direction revise ${arch} tsd-writing --file=edit.yaml --answers=${v}.1 --why="flags have defaults"`
    expect((await p.agent(revise)).err).toContain('"the flag has no default" waits for an evaluation of t2 first')
    ok(await p.nanda('evaluate t2 --wrong="r1 names no default for the flag" --why="no standard asks for a default" ' +
      '--improve="every flag has a default" --level=standard'))
    ok(await p.agent(revise))
    ok(await p.nanda('review d2 accept --evidence="directions/tsd-writing.yaml | flags have defaults"', 'accept'))
  }, 20000)

  test('the person\'s criticism, once evaluated and answered by a change, is checked again: no new result when the check passes', async () => {
    // Nanda (2026-10-29): the work under the change is checked again and made again only where a check finds a fault.
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', '# TSD\n\n## Introduction\n\nThe export ran twice, so the merchant got two files and paid two fees.\n\n## Design\n\nTODO\n')
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the introduction')}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    const v = ok(await p.nanda('review r1 reject --point="the introduction must name the cost to the merchant"')).out.match(/^(v\d+): reject/)[1]
    ok(await p.nanda('evaluate t1 --wrong="r1 names no cost" --why="no standard asks for the cost" --improve="a rule for the cost" --level=standard'))
    ok(await p.nanda('grant --act=change --on=tsd-writing,t1 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('cost.yaml', 'add:\n  - id: cost\n    where: { region: introduction }\n    says: The introduction names the cost.\n    rules:\n' +
      '      - { id: says-cost, says: "The introduction names the cost to the merchant", checkedBy: linter }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=cost.yaml --answers=${v}.1 --why="name the cost"`))
    ok(await p.nanda('review d2 accept --evidence="directions/tsd-writing.yaml | the cost rule"', 'accept'))
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('check r1 again under the new version')
    // r1 already names the fees: the linter checks it under the new rule, the lead decides again, and t1 is accepted.
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the introduction')} --evidence="says-cost | the introduction | it says the merchant paid two fees"`))
    ok(await p.agent(`brief ${lead}`))
    ok(await p.agent(`review ${lead} r1 accept ${REPEATABLE}`))
    expect(ok(await p.agent('task show t1')).out).toContain('Accepted')
  }, 20000)

  test('a direction or a principle: the evaluation counts after the person accepts it', async () => {
    const { p, lead } = await a2AcceptedA1Reported()
    const linter3 = tokenIn(ok(await p.agent(`assign ${lead} t3 --role=linter`)).out)
    ok(await p.agent(`brief ${linter3}`))
    ok(await p.agent(`review ${linter3} r2 reject --point="cites ABC-2964" --breaks=no-ticket-ids`))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    // A medium role does not evaluate.
    expect((await p.agent(`evaluate ${lead} t3 --wrong=x --why=y --improve=z --level=task`)).err).toContain('a high role evaluates a mistake')
    ok(await p.agent(`evaluate ${arch} t3 --wrong="r2 cites the ticket" --why="the direction asks for the facts, and the ticket is a fact" ` +
      '--improve="the spirit says that ids are not facts" --level=principle'))
    expect(ok(await p.agent(`next ${lead}`)).out).toContain('ev1 evaluates t3 at the level principle, and waits for Nanda\'s accept')
    const waiting = ok(await p.nanda('waiting')).out
    expect(waiting).toContain('ev1 evaluates t3 at the level principle, and waits for your accept')
    expect(waiting).toContain('work review ev1 accept --evidence="<where you read> | <what you saw>", or reject --reason="..." (read it in full: work evaluation show ev1)')
    ok(await p.nanda('review ev1 accept --evidence="work evaluation show ev1 | an id is a name, not a fact"', 'accept'))
    expect(ok(await p.agent(`next ${arch}`)).out).toContain('ev1 asks for: "the spirit says that ids are not facts"')
  }, 20000)

  test('every workflow has a high role, and a task file names no rounds', async () => {
    const { p } = await started()
    p.write('rounds.yaml', TASK_WHOLE + 'maxRounds: 3\n')
    expect((await p.nanda('task open --file=rounds.yaml')).err).toContain('maxRounds is gone')
    const flat = (await import('./harness.js')).WORK_YAML.replace(/ {2}architect:\n(?: {4}.*\n)+/, '')
      .replace('acts: [{ approve: [writer] }]', 'acts: [{ approve: [writer] }]')
    const q = (await import('./harness.js')).project({ 'work.yaml': flat })
    expect((await q.nanda('init')).err).toContain('the workflow has no high role; every workflow has the three tiers')
  })
})
