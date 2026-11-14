// Edge cases from the evaluation (plan/types/PLAN.md section 4): each bug that the scouts found,
// seen from the outside, so that the old code and the new code must both pass it.
import { describe, expect, test } from 'bun:test'
import { HOST, INTRO_V1, INTRO_V2, TASK, TASK_WHOLE, WORK_YAML, init, ok, project, reported, solToken, started, tokenIn } from './harness.js'
import { tables } from './outside.js'


// A dir with a host run h1 whose top task t1 is open, with the architect a1 as its host.
const hosted = async (files = {}) => {
  const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n`, ...files })
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.run('run start', HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out) // ruling 10.1
  return { p, host }
}

// ... and its top task is accepted: the end of the project waits for the person.
const ending = async () => {
  const { p, host } = await hosted()
  ok(await p.run(`brief ${host}`, HOST))
  const writer = tokenIn(ok(await p.agent(`assign ${host} t1 --role=writer`)).out)
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', INTRO_V2)
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
  const linter = tokenIn(ok(await p.agent(`assign ${host} t1 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the introduction | no paths or hashes there" --evidence="no-ticket-ids | the introduction | no ticket ids there"`))
  ok(await p.agent(`review ${host} r1 accept --evidence="docs/tsd.md, the introduction | the section says what the task asks"`))
  expect(ok(await p.ui('run list')).out).toContain('h1 host · ends')
  return { p, host }
}

describe('a project ends once', () => {
  test('a done project is not closed', async () => {
    const { p } = await ending()
    ok(await p.ui('run done h1'))
    expect((await p.ui('run close h1')).err).toContain('h1 is done; a done project stays done')
  })

  test('a closed project is not done', async () => {
    const { p } = await ending()
    ok(await p.ui('run close h1'))
    expect((await p.ui('run done h1')).err).toContain('h1 is closed')
  })

  test('the draft of a closed project is not opened', async () => {
    const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.run('run start', HOST))
    ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
    ok(await p.ui('run close h1'))
    expect((await p.ui('task open td1')).err).toContain('h1 is closed; its drafts stay closed')
  })
})

describe('a system problem stays in its project', () => {
  const twoProjects = async () => {
    const { p } = await started({ 'other.yaml': TASK.replace('The Introduction', 'The Other Task') })
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    ok(await p.nanda('task open --file=other.yaml'))
    return { p, arch }
  }

  test('a host records no problem on a task of another project', async () => {
    const { p, arch } = await twoProjects()
    expect((await p.agent(`problem ${arch} t2 --says="the cluster is down"`)).err)
      .toContain('works in another project; the host of that project records its problems')
    ok(await p.agent(`problem ${arch} t1 --says="the cluster is down"`))
  })

  test('a closed task is stopped by nothing', async () => {
    const { p } = await twoProjects()
    ok(await p.nanda('task close t2 --reason="not needed"', 'close'))
    expect((await p.nanda('problem t2 --says="the cluster is down"')).err).toContain('t2 is closed; a closed task is stopped by nothing')
  })
})

describe('a remade top task stays in its run', () => {
  // Ruling 10.1: the UI types nothing; the host's work wait in the run's pane gives the new Sol its
  // token (the remake ended a1, C1, so the session of the run is free for a2).
  test('the Sol on the remake is the host of the run, in the session of the run', async () => {
    const { p } = await hosted({ 'top2.yaml': TASK_WHOLE.replace(/text: .*/, 'text: A wider introduction.') })
    ok(await p.nanda('task remake t1 --file=top2.yaml --reason="the scope grew"'))
    const out = ok(await p.nanda('assign t2 --role=architect')).out
    expect(out).toContain('a2 is the host of h1; the host gets its token from work wait.')
    const waited = ok(await p.run('wait --by=h1 --seconds=1', HOST)).out
    expect(waited).toContain('h1: its top task t2 The Introduction is open, and you are its Sol (a2)')
    ok(await p.agent(`brief ${tokenIn(waited)}`))
    const db = tables(p)
    const run = db.query("SELECT session FROM run WHERE id = 'h1'").get().session
    const a2 = db.query("SELECT session FROM assignment_session WHERE assignment = 'a2'").all()
    db.close()
    expect(a2.map((r) => r.session)).toContain(run)
  })
})

describe('a question has one answer', () => {
  test('a second answer is refused, and the first answer stays', async () => {
    const { p, lead } = await started()
    ok(await p.agent(`ask ${lead} --text="Is the retry part of the export?" --to=owner`))
    ok(await p.nanda('answer q1 --text="No: the retry is a task of its own."'))
    expect((await p.nanda('answer q1 --text="Yes."')).err).toContain('the question is answered already')
    expect(ok(await p.agent('question show q1')).out).toContain('No: the retry is a task of its own.')
  })
})

describe('the CLI refuses what nothing would read', () => {
  test('a role that makes nothing gets no limit of attempts', async () => {
    const { p, lead } = await started()
    expect((await p.agent(`assign ${lead} t1 --role=linter --max-attempts=3`)).err)
      .toContain('linter makes no result, so it has no attempts')
  })

  test('a task takes no accept: it is accepted through its results', async () => {
    const { p } = await reported()
    expect((await p.nanda('review t1 accept --evidence="repeatable | the introduction | ok"', 'accept')).err)
      .toContain('a task takes only a Reject; an Accept goes on a result of the task')
  })

  test('a flag with no value is refused as such, not failed on', async () => {
    const { p, host } = await hosted()
    ok(await p.run(`brief ${host}`, HOST))
    p.write('cost.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs. }\n')
    const draft = ok(await p.agent(`direction revise ${host} tsd-writing --file=cost.yaml`)).out.match(/(d\d+) drafted/)[1]
    const r = await p.ui(`review ${draft} reject --reason`, 'reject')
    expect(r.err).toContain('--reason needs a value: --reason="<...>"')
    expect(r.err).not.toContain('is not a function')
  })
})

describe('the attempt of a maker', () => {
  test('a maker whose only try failed is at attempt 1 of 1, never 2 of 1', async () => {
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V1)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 reject --point="cites ABC-2964" --breaks=no-ticket-ids`))
    const shown = ok(await p.agent('assignment show a2')).out
    expect(shown).toContain('attempt 1 of 1')
    expect(shown).not.toContain('attempt 2 of 1')
  })
})

describe('a person is not an agent', () => {
  test('a person with the name of an id is refused: the log would read the person as an agent', async () => {
    const p = project({ 'aristoteles.yaml': WORK_YAML.replace('- name: Nanda', '- name: a1') })
    expect((await p.nanda('init')).err).toContain('the person "a1" has the name of an id (like a1 or t2)')
  })
})

describe('one place for the token', () => {
  // I4 (N3): the harness takes the token where it stands, so the checks and the command agree on
  // who acts; the old refusal "a token goes right after work review" is gone.
  test('a token after the other words is taken where it stands: the agent of the token acts', async () => {
    const { p, linter } = await reported()
    const r = ok(await p.nanda(`review r1 reject --point="the first line cites ABC-2964" ${linter}`, 'reject'))
    expect(r.out).toStartWith('v2: your review of r1 is recorded.')
    // The token is a secret: the words do not repeat it.
    expect(r.out).not.toContain(linter)
    expect(ok(await p.agent('log --last=1')).out).toContain('a3 (agent) review r1 reject')
  })

  test('a token right after the command and its act word works', async () => {
    const { p, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 reject --point="the first line cites ABC-2964" --breaks=no-ticket-ids`))
  })
})
