// Round 8, attacker F: a report keeps the sections of the other open tasks of its tree only when
// they lie inside its own output. A part that reports its section may change a sibling's accepted
// section beside it, and a section whose heading did not exist at the split may nest inside
// another part's section later. Each test expects the CORRECT behaviour, so it fails while the
// fault is there.
import { describe, expect, test } from 'bun:test'
import { INTRO_V2, TASK_WHOLE, ok, started, tokenIn } from
  './harness.js'

// The person splits the TSD into two parts of docs/tsd.md; the lead gives each part to a writer
// (the second one waits for the file); the first part is accepted and its writer finished.
async function firstPartAccepted(parts, text, section, evidence) {
  const { p, lead } = await started({ 'task.yaml': TASK_WHOLE })
  p.write('parts.yaml', parts)
  ok(await p.nanda('task split t1 --file=parts.yaml'))
  const first = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=writer`)).out)
  const second = tokenIn(ok(await p.agent(`assign ${lead} t3 --role=writer`)).out)
  ok(await p.agent(`brief ${first}`))
  p.write('docs/tsd.md', text)
  ok(await p.agent(`report ${first} --output=docs/tsd.md#${section}`))
  const linter = tokenIn(ok(await p.agent(`assign ${lead} t2 --role=linter`)).out)
  ok(await p.agent(`brief ${linter}`))
  ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the ${section} | no paths or hashes there" ` +
    `--evidence="no-ticket-ids | the ${section} | no ticket ids there"`))
  ok(await p.agent(`review ${lead} r1 accept ${evidence}`))
  ok(await p.agent(`finish ${lead} a2`))
  ok(await p.agent(`brief ${second}`))
  return { p, lead, second }
}

describe('F-R1 a report keeps the sections of the other open tasks of its tree', () => {
  test('the Design writer puts TODO back in the accepted Introduction of t2, reports docs/tsd.md#design, and it is stored', async () => {
    const { p, second } = await firstPartAccepted(
      '- { name: Intro, text: Write the introduction., context: { section: introduction } }\n' +
      '- { name: Design, text: Write the design., context: { section: design } }\n',
      INTRO_V2, 'introduction', '--evidence="repeatable | the introduction | a reviewer can repeat it"')
    p.write('docs/tsd.md', '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nOne file per merchant per day.\n')
    const r = await p.agent(`report ${second} --output=docs/tsd.md#design`)
    // Correct: refused, as R5-5 says ("a report may not change a section that another task in the
    // tree owns"); the accepted introduction of t2 changes only through a new result of t2.
    expect(r.code).toBe(1)
    expect(r.err).toContain('introduction')
  })

  test('a part whose heading is not in the file at the split nests inside an accepted part, and its report changes that part', async () => {
    const { p, second } = await firstPartAccepted(
      '- { name: Design, text: Write the design., context: { section: design } }\n' +
      '- { name: Details, text: Write the design details., context: { section: design-details } }\n',
      '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nOne file per merchant per day.\n', 'design',
      '--evidence="docs/tsd.md#design | one file per merchant per day"')
    // The Details writer makes its heading where the design details go: under ## Design.
    p.write('docs/tsd.md', '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nOne file per merchant per day.\n\n' +
      '### Design details\n\nThe file is named by the date.\n')
    const r = await p.agent(`report ${second} --output=docs/tsd.md#design-details`)
    // Correct: refused; the section design-details lies inside the section design of t2 (round 7 D4:
    // the sections of parts do not nest), and the report changes r1 of t2 after it was accepted.
    expect(r.code).toBe(1)
    expect(r.err).toContain('design')
  })
})
