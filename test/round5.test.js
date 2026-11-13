import { describe, expect, test } from 'bun:test'
import { changeDirection, evaluated, init, INTRO_V2, ok, project, reported, started, TASK_WHOLE, tokenIn, withWriter, WORK_YAML } from './harness.js'

// One test for each round-5 finding that the prototype closes. The ids are those of
// thought-tests/round-5.md (R5-n from the invariant attacker, R5-Fn from the flows walker).

const TSD_TASK = 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n'
const tsd = (intro, design) => `# TSD\n\n## Introduction\n\n${intro}\n\n## Design\n\n${design}\n`
const LINT = (where) => `--evidence="no-code-proof | ${where} | no paths or hashes there" --evidence="no-ticket-ids | ${where} | no ticket ids there"`

const fresh = async (files) => {
  const p = project(files)
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  return p
}
const architect = async (p, on = 't1') => {
  ok(await p.nanda(`grant --act=change --on=${on} --to=architect --until=2026-10-26T00:00:00Z`, 'grant'))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  return arch
}
// A writer of the part reports its section with this file text, and a linter accepts it.
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
const DESIGN_PART = '- { name: Design, text: Write the design., context: { section: design } }\n'

describe('the record and the rule ids', () => {
  test('R5-1: a suggested version does not change what a rule id means', async () => {
    const { p, writer, linter } = await reported()
    const arch = await architect(p, 'tsd-writing,t1')
    p.write('edit.yaml', 'replace:\n  - id: intro-story\n    with:\n      id: intro-story\n      when: { section: introduction }\n' +
      '      says: Tell the story first, in plain words.\n      rules:\n' +
      '        - { id: repeatable, says: "A reviewer can repeat the problem without the design", checkedBy: linter }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    // The suggestion gives repeatable to the linter; the official version still gives it to the lead.
    const review = await p.agent(`review ${linter} r1 accept ${LINT('the introduction')} --evidence="repeatable | the introduction | a reader can repeat it"`)
    expect(review.err).toContain('repeatable is not in your checks')
    expect(writer).toBeDefined()
  })
})

describe('work that must not stop', () => {
  test('R5-F1 (needs model): after a part is accepted, a change of scope remakes the task, and the new tree finishes', async () => {
    const p = await fresh({ 'task.yaml': TSD_TASK, 'again.yaml': 'name: The TSD again\ntext: Write the TSD, with the design named by the date.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    const arch = await architect(p)
    p.write('parts.yaml', DESIGN_PART)
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    await partDone(p, arch, 't2', 'design', tsd('TODO', 'One file per merchant per day.'))
    expect((await p.agent(`task close ${arch} t2 --reason="the design starts again"`)).err).toContain('remake t1')
    expect(ok(await p.nanda('task remake t1 --file=again.yaml --reason="the design is named by the date"')).out).toContain('t1 is remade as t3')
    ok(await p.nanda('grant --act=change --on=t3 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
    const arch2 = tokenIn(ok(await p.nanda('assign t3 --role=architect')).out)
    ok(await p.agent(`brief ${arch2}`))
    p.write('parts2.yaml', '- { name: Design again, text: Write the design again., context: { section: design } }\n')
    ok(await p.agent(`task split ${arch2} t3 --file=parts2.yaml`))
    await partDone(p, arch2, 't4', 'design', tsd('TODO', 'One file per merchant per day, named by the date.'))
    const joiner = tokenIn(ok(await p.agent(`assign ${arch2} t3 --role=writer`)).out)
    ok(await p.agent(`brief ${joiner}`))
    p.write('docs/tsd.md', tsd('The export ran twice.', 'One file per merchant per day, named by the date.'))
    expect(ok(await p.agent(`report ${joiner} --output=docs/tsd.md`)).out).toContain('reported on t3')
    // A closed task takes no new work: no recheck of its result, and no split of it.
    expect((await p.agent(`recheck ${arch} r1 --reason="again"`)).err).toContain('t2 is closed')
    expect((await p.agent(`task split ${arch2} t2 --file=parts2.yaml`)).err).toContain('t2')
  })
})

describe('points close only the right way', () => {
  test('R5-2 (needs model): an agent\'s close or remake does not drop the person\'s open Reject', async () => {
    const p = await fresh({ 'task.yaml': TSD_TASK, 'again.yaml': 'name: The TSD again\ntext: Write the TSD, with the design named by the date.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    const arch = await architect(p)
    p.write('parts.yaml', '- { name: Body, text: Write the body. }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    p.write('sub.yaml', DESIGN_PART)
    ok(await p.agent(`task split ${arch} t2 --file=sub.yaml`))
    const writer = tokenIn(ok(await p.agent(`assign ${arch} t3 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', tsd('TODO', 'One file per merchant per day.'))
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#design`))
    // The person criticises a result after its decider accepted it.
    ok(await p.agent(`review ${arch} r1 accept --evidence="docs/tsd.md, the design | the section is there"`))
    ok(await p.nanda('review r1 reject --point="the design hides the double run"'))
    await evaluated(p, 't3')
    expect((await p.agent(`task close ${arch} t3 --reason="the join writes it"`)).err).toContain('t2 needs t3')
    expect((await p.agent(`task remake ${arch} t1 --file=again.yaml --reason="smaller"`)).err).toContain("the person's open Reject")
  })

  test('R5-F2 (needs model): an agent\'s remake does not answer the person\'s open point; the person\'s own remake does', async () => {
    const p = await fresh({ 'task.yaml': TSD_TASK, 'failure.yaml': 'name: The TSD with failures\ntext: Write the TSD, with a Failure section.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n' })
    const arch = await architect(p)
    p.write('parts.yaml', DESIGN_PART)
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    await partDone(p, arch, 't2', 'design', tsd('TODO', 'One file per merchant per day.'))
    const joiner = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${joiner}`))
    p.write('docs/tsd.md', tsd('The export ran twice.', 'One file per merchant per day.'))
    ok(await p.agent(`report ${joiner} --output=docs/tsd.md`))
    ok(await p.agent(`review ${arch} r2 accept --evidence="docs/tsd.md | the TSD has both sections"`))
    const point = ok(await p.nanda('review r2 reject --point="the TSD needs a Failure section"')).out.match(/(v\d+\.1)/)[1]
    await evaluated(p, 't1', 'task')
    const agentRemake = await p.agent(`task remake ${arch} t1 --file=failure.yaml --reason="add the failures"`)
    expect(agentRemake.err).toContain("is the person's open point on t1")
    expect(ok(await p.nanda(`task remake t1 --file=failure.yaml --reason="add the failures" --review=${point}`)).out).toContain('t1 is remade as t3')
  })
})

describe('a rule passes only with what it needs', () => {
  test('R5-3: after a standard changes, a bare accept does not stand in for its checkers', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the introduction')}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    await changeDirection(p, 'replace:\n  - id: intro-story\n    with:\n      id: intro-story\n      where: { section: introduction }\n' +
      '      says: Tell the story first, in plain words, and say who paid for the mistake.\n      rules:\n' +
      '        - { id: repeatable, says: "A reviewer can repeat the problem without the design", checkedBy: section-lead }\n',
    { flags: '--why="Correct the standard"' })
    ok(await p.agent(`brief ${lead}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="docs/tsd.md, the section | the text is still fine"`))
    expect(ok(await p.agent('task show t1')).out).not.toContain('Accepted')
    // The lead checks the rule of the changed standard again; the linter's rules did not change.
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can still repeat it"`))
    expect(ok(await p.agent('task show t1')).out).toContain('Accepted')
  })

  test('R5-4: a part with an empty workspace is refused', async () => {
    const p = await fresh({ 'task.yaml': TSD_TASK })
    const arch = await architect(p)
    p.write('parts.yaml', '- { name: Design, text: Write the design., workspace: [] }\n')
    expect((await p.agent(`task split ${arch} t1 --file=parts.yaml`)).err).toContain('empty workspace')
  })

  test('R5-5: parts that share a file all own a section, and no section lies inside another', async () => {
    const p = await fresh({ 'task.yaml': TSD_TASK })
    const arch = await architect(p)
    p.write('mixed.yaml', '- { name: Front, text: Write the front. }\n' + DESIGN_PART)
    expect((await p.agent(`task split ${arch} t1 --file=mixed.yaml`)).err).toContain('has no section; each part needs its own section of the file')
    // A section that holds the heading of another part's section would own that part's work too
    // (round 7): the split is refused.
    p.write('docs/tsd.md', '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nTODO\n\n### Data model\n\nTODO\n')
    p.write('parts.yaml', DESIGN_PART + '- { name: Data model, text: Write the data model., context: { section: data-model } }\n')
    expect((await p.agent(`task split ${arch} t1 --file=parts.yaml`)).err)
      .toContain('the section data-model of docs/tsd.md lies inside the section design')
  })

  test('R5-6: untouched work is refused for a section form', async () => {
    const p = await fresh({ 'task.yaml': TSD_TASK })
    const lead = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
    ok(await p.agent(`brief ${lead}`))
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    expect((await p.agent(`report ${writer} --output=docs/tsd.md#design`)).err).toContain('the same as before any work')

  })

  test('R5-7: after a recheck, rejected work is still refused', async () => {
    const { p, lead, writer, linter } = await withWriter().then(async (s) => {
      ok(await s.p.agent(`brief ${s.writer}`))
      s.p.write('docs/tsd.md', tsd('See the chat thread from Monday: the export ran twice.', 'TODO'))
      ok(await s.p.agent(`report ${s.writer} --output=docs/tsd.md#introduction`))
      const l = tokenIn(ok(await s.p.agent(`assign ${s.lead} t1 --role=linter`)).out)
      ok(await s.p.agent(`brief ${l}`))
      return { ...s, linter: l }
    })
    ok(await p.agent(`review ${linter} r1 reject --point="cites a chat thread" --breaks=no-ticket-ids`))
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const second = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${second}`))
    ok(await p.agent(`review ${second} r2 accept ${LINT('the introduction')}`))
    // A recheck reopens accepted work (with nothing changed outside, it would be a free try).
    ok(await p.agent(`review ${lead} r2 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    ok(await p.agent(`recheck ${lead} r2 --reason="the facts file moved"`))
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', tsd('See the chat thread from Monday: the export ran twice.', 'TODO'))
    expect((await p.agent(`report ${writer} --output=docs/tsd.md#introduction`)).err).toContain('which was rejected')
  })
})

describe('no dead ends', () => {
  test('R5-8: a replaced standard keeps its rule ids, so an added rule cannot take one', async () => {
    const { p } = await started()
    p.write('edit.yaml', 'replace:\n  - id: facts-not-proof\n    with:\n      id: facts-not-proof\n      says: The body states facts only.\n      rules:\n' +
      '        - { id: no-code-proof, says: "No file paths with line numbers, no commit hashes in the body", checkedBy: linter }\n' +
      '        - { id: no-ticket-ids, says: "No ticket ids and no chat-thread citations", checkedBy: linter }\n' +
      'add:\n  - id: headings\n    says: Headings are plain.\n    rules:\n      - { id: no-ticket-ids, says: "No ticket ids in headings either", checkedBy: linter }\n')
    expect((await p.agent(`direction revise ${await architect(p)} tsd-writing --file=edit.yaml`)).err).toContain('the rule id "no-ticket-ids" is already used')
  })

  test('R5-9: a Reject of a task names no rule, also through a forward', async () => {
    const { p, lead } = await withWriter()
    const forwarded = await p.agent(`forward ${lead} Nanda reject t1 --quote="no ticket ids in this task, ever" ` +
      '--point="no ticket ids in this task" --breaks=no-ticket-ids --channel=chat')
    expect(forwarded.err).toContain('a Reject of a task names no rule')
    expect((await p.nanda('review t1 reject --point="no ticket ids" --breaks=no-ticket-ids')).err).toContain('a Reject of a task names no rule')
  })

  test('R5-F5: a point names a rule of the reviewed task, not of one of its parts', async () => {
    const p = await fresh({ 'task.yaml': TSD_TASK })
    const arch = await architect(p)
    p.write('parts.yaml', '- { name: Intro, text: Write the intro., context: { section: introduction } }\n' + DESIGN_PART)
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml`))
    await partDone(p, arch, 't2', 'introduction', tsd('The export ran twice.', 'TODO'))
    const lead = tokenIn(ok(await p.agent(`assign ${arch} t2 --role=section-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    await partDone(p, arch, 't3', 'design', tsd('The export ran twice.', 'One file per merchant per day.'))
    const joiner = tokenIn(ok(await p.agent(`assign ${arch} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${joiner}`))
    ok(await p.agent(`report ${joiner} --output=docs/tsd.md`))
    const reject = await p.nanda('review r3 reject --point="the intro says two days; it was a week" --breaks=repeatable')
    expect(reject.err).toContain('t1 is not checked by repeatable; it is a rule of t2')
  })

  test('R5-10: an official draft that takes a rule off the task answers the points on that rule', async () => {
    const { p, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 reject --point="cites a ticket" --breaks=no-ticket-ids`))
    await changeDirection(p, 'replace:\n  - id: facts-not-proof\n    with:\n      id: facts-not-proof\n      says: The body states facts.\n      rules:\n' +
      '        - { id: no-code-proof, says: "No file paths with line numbers, no commit hashes in the body", checkedBy: linter }\n',
    { flags: '--answers=v2.1 --why="Correct the rule"' })
    // r1 stays rejected; the point is answered, so the next result does not carry it.
    const blockers = ok(await p.agent('blockers r1')).out
    expect(blockers).toContain('tsd-writing@2 answered it (no-ticket-ids left the task)')
    expect(blockers).not.toContain('breaks no-ticket-ids')
    expect(ok(await p.nanda('waiting')).out).not.toContain('v2.1')
  })

  test('R5-11: a rule names a checker whose evidence can count', async () => {
    // Here the architect approves only leads, so it decides no maker's results.
    const { p } = await started({ 'aristoteles.yaml': WORK_YAML.replace('approve: [section-lead, writer]', 'approve: [section-lead]') })
    p.write('edit.yaml', 'add:\n  - id: dates\n    says: Dates are exact.\n    rules:\n      - { id: exact-dates, says: "Every date has a day", checkedBy: architect }\n')
    expect((await p.agent(`direction revise ${await architect(p)} tsd-writing --file=edit.yaml`)).err).toContain('reviews or approves no role that does the work')
  })

  test('R5-F3: waiting shows that the person\'s own split can answer their point', async () => {
    const { p, lead } = await reported()
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    ok(await p.nanda('review r1 reject --point="the story needs the cost"'))
    await evaluated(p, 't1', 'task')
    // t1 has a section, so it is one unit: the person's own remake answers the point (a split is refused).
    expect(ok(await p.nanda('waiting')).out).toContain('work task remake t1 --file=<task.yaml> --reason="<how the scope changed>" --review=v3.1')
  })

  test('R5-F7: a maker with no attempts left takes no claim', async () => {
    const { p, lead } = await started()
    const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=1`)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    ok(await p.agent(`review ${lead} r1 reject --point="the story has no cost"`))
    // The last try ended on a fault: the brief is refused until the task is evaluated (2026-11-08).
    const brief = await p.agent(`brief ${writer}`)
    expect(brief.err).toContain('t1 waits for an evaluation of the last try of a2')
    expect(brief.err).toContain('STOP and tell your parent')
    expect(ok(await p.agent(`next ${lead}`)).out).not.toContain('claimed since')
  })

  test('R5-F8: next says what to do when the parent lost the token of its child', async () => {
    const { p, lead, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    ok(await p.agent(`free ${lead} a2`))
    expect(ok(await p.agent(`next ${lead}`)).out).toContain(`Only if you lost that token: work finish ${lead} a2, then work assign ${lead} t1 --role=writer (a new maker; when its latest try has a fault, the task waits for an evaluation first)`)
  })

  test('R5-F9: waiting names a task that no open assignment works on', async () => {
    const p = await fresh()
    expect(ok(await p.nanda('waiting')).out).toContain('t1 The Introduction is Open, and no open assignment works on it')
  })

  test('R5-F10: an accepted result names its output', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the introduction')}`))
    ok(await p.agent(`review ${lead} r1 accept --evidence="repeatable | the introduction | a reviewer can repeat it"`))
    expect(ok(await p.agent('blockers r1')).out).toContain('r1 (docs/tsd.md#introduction) has no blockers')
  })
})

describe('the record and the words', () => {
  test('R5-12: the log and the blockers name the split that answered a point', async () => {
    const { p, linter } = await reported({ 'task.yaml': TASK_WHOLE })
    ok(await p.agent(`review ${linter} r1 reject --point="too much for one section; it needs two parts"`))
    const arch = await architect(p, 't1')
    p.write('parts.yaml', '- { name: Story, text: Tell the story., context: { section: story } }\n- { name: Cost, text: Say the cost., context: { section: cost } }\n')
    ok(await p.agent(`task split ${arch} t1 --file=parts.yaml --review=v2`))
    expect(ok(await p.agent('log')).out).toContain('task.split t1 answering v2')
    expect(ok(await p.agent('blockers r1')).out).toContain('the split of t1 answered it')
  })

  test('R5-13: wrong ids and new files get a next line that works', async () => {
    const { p, lead } = await started()
    const arch = await architect(p, 'tsd-writing,t1')
    p.write('edit.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    ok(await p.agent(`review ${lead} d2 accept --evidence="edit.yaml | short is good"`))
    const revise = await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml --answers=v2 --why="Correct the standard"`)
    expect(revise.err).toContain('v2 is not a Reject point or a suggestion')
    p.write('work-notes.yaml', 'x: 1\n')
    expect((await p.agent(`brief ${lead}`)).code).toBe(0)
  })

  test('R5-F11: a missing token and a missing file say what is missing', async () => {
    const { p } = await started()
    expect((await p.nanda('next')).err).toContain('this command needs your assignment token')
    expect((await p.nanda('task open --file=nope.yaml')).err).toContain('there is no file nope.yaml')
  })
})
