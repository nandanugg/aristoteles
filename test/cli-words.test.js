// The words of the CLI after the rename step (plan/types/CLI-WORDS.md, the owner's rulings of
// 2026-11-12): escalate, resolve, forward, confirm, free, the guide decision-words, the context key
// section, the exit codes, and the fixes that the skills round found. The words of work assign by
// where the assignment runs (rulings 7 and 9, onboarding 2026-11-14).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import {
  DIRECTION,
  FLOW,
  HOST,
  init,
  markedOf,
  ok,
  project,
  reported,
  solToken,
  started,
  TASK,
  TASK_WHOLE,
  tokenIn,
  withWriter,
  WORK_YAML,
} from './harness.js'

const out = async (r) => ok(await r).out

describe('escalate', () => {
  test('with --result: the result waits for the answerer, and a low agent stops', async () => {
    const { p, linter } = await reported()
    const why = 'the facts have no date for the second run'
    const r = await out(p.agent(`escalate ${linter} --result=r1 --reason="${why}"`))
    expect(r).toBe('v2 escalated to a1.\nSTOP: your parent continues.')
    const blockers = await out(p.agent('blockers r1'))
    expect(blockers).toContain(`v2 escalated on r1: "${why}" (waits for a1)`)
    expect(await out(p.agent('log --last=1'))).toContain(`escalate on r1 "${why}"`)
  })

  test('with no result: the task goes up as a question to the parent', async () => {
    const { p, writer } = await withWriter()
    ok(await p.agent(`brief ${writer}`))
    const r = await out(p.agent(`escalate ${writer} --reason="the facts file names no merchant"`))
    expect(r).toBe('q1 escalated to a1.\nSTOP: your parent continues.')
    const waiting = await out(p.agent('waiting --for=a1'))
    expect(waiting).toContain('q1 for a1: the facts file names no merchant')
  })

  test('the top agent escalates to the person, who resolves it in words', async () => {
    const { p, lead } = await reported()
    const why = '--reason="only Nanda decides the date"'
    const r = await out(p.agent(`escalate ${lead} --result=r1 ${why}`))
    expect(r).toBe(
      'v2 escalated to Nanda.\nnext: Nanda answers it; work waiting --for=Nanda shows it',
    )
    expect(await out(p.nanda('waiting'))).toContain(
      'v2 escalated on r1 by a1 for Nanda: only Nanda decides the date\n' +
        '    work resolve v2 --resolution="..."',
    )
  })

  test('an escalation needs a reason', async () => {
    const { p, linter } = await reported()
    const r = await p.agent(`escalate ${linter} --result=r1 --reason=" "`)
    expect(r.err).toStartWith('refused: an escalation needs a reason')
    expect(r.code).toBe(1)
  })
})

describe('resolve', () => {
  test('the answerer resolves an escalation of its child; the deciders still decide', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`escalate ${linter} --result=r1 --reason="is the date needed?"`))
    expect(await out(p.agent(`next ${lead}`))).toContain(
      `resolve v2 on r1: is the date needed?\n  work resolve ${lead} v2 --resolution=`,
    )
    const r = await out(p.agent(`resolve ${lead} v2 --resolution="the date is not needed"`))
    expect(r).toStartWith('v3: resolves v2 on r1.\nr1 still has ')
    // A resolve accepts and rejects nothing: the result still waits for its deciders.
    expect(await out(p.agent('blockers r1'))).not.toContain('v2 escalated on r1')
    const show = await out(p.agent('result show r1'))
    expect(show).toContain(
      'v2 escalation by a3 (linter), for a1 (section-lead): "is the date needed?" (resolved by v3)',
    )
    expect(show).toContain('v3 resolve by a1 (section-lead), resolves v2: "the date is not needed"')
    expect(show).toContain('no accept yet by a role that decides r1')
    expect(await out(p.agent('log --last=1'))).toContain('resolve v2 on r1')
    // An escalation is resolved once.
    const again = await p.agent(`resolve ${lead} v2 --resolution="again"`)
    expect(again.err).toContain('v2 is resolved already')
  })

  test('a resolve keeps its evidence; an agent names the place in the result', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`escalate ${linter} --result=r1 --reason="is the date needed?"`))
    const words = '--resolution="the date is not needed"'
    const chat = '--evidence="chat | the date is not there"'
    const vague = await p.agent(`resolve ${lead} v2 ${words} ${chat}`)
    expect(vague.err).toContain('name the place in docs/tsd.md#introduction')
    // D10, I5: the choice is what the agent writes, not "run the review again" (BUILD.md 4.4).
    expect(vague.err).toContain('next: write the place in docs/tsd.md#introduction where you looked')
    const seen = '--evidence="the introduction | it gives no date for the second run"'
    expect(await out(p.agent(`resolve ${lead} v2 ${words} ${seen}`))).toStartWith('v3: resolves v2')
    expect(await out(p.agent('result show r1'))).toContain(
      'v3 resolve by a1 (section-lead), resolves v2: "the date is not needed"\n' +
        '  the introduction | it gives no date for the second run',
    )
  })

  test('the person resolves an escalation to the person, with no token', async () => {
    const { p, lead } = await reported()
    ok(await p.agent(`escalate ${lead} --result=r1 --reason="only Nanda decides the date"`))
    const agent = await p.agent(`resolve ${lead} v2 --resolution="I decided"`)
    expect(agent.err).toContain('may not resolve "only Nanda decides the date"')
    const person = await out(p.nanda('resolve v2 --resolution="the date is not needed"'))
    expect(person).toStartWith('v3: resolves v2 on r1.')
    expect(await out(p.nanda('waiting'))).not.toContain('v2 escalated on r1')
  })

  test('a blank or missing resolution is refused, and nothing is stored', async () => {
    const { p, lead, linter } = await reported()
    ok(await p.agent(`escalate ${linter} --result=r1 --reason="is the date needed?"`))
    for (const flag of ['--resolution=" "', '']) {
      const r = await p.agent(`resolve ${lead} v2 ${flag}`)
      expect(r.err).toStartWith(
        'refused: a resolve needs its words: --resolution="<the agreement, or the direction>"',
      )
      expect(r.code).toBe(1)
    }
    expect(await out(p.agent('waiting --for=a1'))).toContain('v2 escalated on r1')
  })

  test('a resolve names an escalation', async () => {
    const { p, lead } = await reported()
    const r = await p.agent(`resolve ${lead} r1 --resolution="the date is not needed"`)
    expect(r.err).toContain('"r1" is not')
    expect(r.code).toBe(1)
  })
})

describe('forward and confirm', () => {
  const ready = async () => {
    const s = await reported()
    const evidence = '--evidence="repeatable | the introduction | a reviewer can repeat it"'
    ok(await s.p.agent(`review ${s.lead} r1 accept ${evidence}`))
    return s
  }
  const recorded = (act, id) => `Nanda's ${act} recorded -> ${id} (forwarded by a1, channel chat).`

  test('a forwarded reject, ask and comment count at once', async () => {
    const { p, lead } = await ready()
    const quote = 'the reader cannot see the cost'
    const point = `--point="no cost" --quote="${quote}"`
    const reject = await out(p.agent(`forward ${lead} Nanda reject r1 ${point}`))
    expect(reject).toBe(recorded('reject', 'v3'))
    expect(await out(p.agent('blockers r1'))).toContain(`Nanda (forwarded): "${quote}"`)
    const question = '--quote="which merchant got two files?"'
    const ask = await out(p.agent(`forward ${lead} Nanda ask a2 ${question}`))
    expect(ask).toBe(recorded('ask', 'q1'))
    const comment = await out(p.agent(`forward ${lead} Nanda comment t1 --quote="keep it short"`))
    expect(comment).toBe(recorded('comment', 'n1'))
    expect(await out(p.agent('log --last=1'))).toContain('forward')
  })

  test("a forwarded answer waits for the person's confirm", async () => {
    const { p, lead } = await ready()
    ok(await p.agent(`ask ${lead} --text="May we skip the repeatable rule?" --to=owner`))
    const answer = await out(p.agent(`forward ${lead} Nanda answer q1 --quote="no, keep it"`))
    expect(answer).toMatch(
      /^e\d+: answer q1: "no, keep it" waits until Nanda runs work confirm e\d+ at a terminal\.$/,
    )
    const id = answer.match(/^(e\d+)/)[1]
    expect(await out(p.nanda('waiting'))).toContain(
      `${id} forwarded by a1 for Nanda: answer q1: "no, keep it"`,
    )
    expect((await p.agent(`confirm ${id}`)).err).toContain('this is a person command')
    // The person types the word confirm; the old word stores nothing.
    const old = await p.nanda(`confirm ${id}`, 'ratify')
    expect(old.err).toContain('not confirmed; nothing was stored')
    // The confirm shows the act and the person's words, then stores it.
    const confirmed = await out(p.nanda(`confirm ${id}`, 'confirm'))
    expect(confirmed).toStartWith(
      `${id}: answer q1: "no, keep it"\nforwarded by a1; their words: "no, keep it"`,
    )
    expect(confirmed).toEndWith(`${id} confirmed.`)
    expect(await out(p.agent('log --last=1'))).toContain(`confirm ${id}`)
    expect((await p.nanda(`confirm ${id}`, 'confirm')).err).toContain(
      `${id} is not a forwarded act that waits for a confirm`,
    )
  })

  test('a forwarded accept of a draft waits for the confirm; then it is official', async () => {
    const { p } = await started()
    const arch = tokenIn(await out(p.nanda('assign t1 --role=architect')))
    ok(await p.agent(`brief ${arch}`))
    p.write('edit.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs. }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    const accept = await out(
      p.agent(`forward ${arch} Nanda accept d2 --evidence="chat | Nanda says yes" --quote="yes"`),
    )
    expect(accept).toMatch(
      /^e\d+: accept d2 with evidence chat \| Nanda says yes waits until Nanda runs work confirm/,
    )
    const id = accept.match(/^(e\d+)/)[1]
    const confirmed = await out(p.nanda(`confirm ${id}`, 'confirm'))
    expect(confirmed).toContain('d2 is official: tsd-writing@2.')
  })

  test("a forwarded resolve is the person's resolve in their words; it waits", async () => {
    const { p, lead } = await ready()
    ok(await p.agent(`escalate ${lead} --result=r1 --reason="only Nanda decides the date"`))
    const quote = '--quote="the date is not needed"'
    const r = await out(p.agent(`forward ${lead} Nanda resolve v3 ${quote}`))
    expect(r).toMatch(
      /^e\d+: resolve v3 on r1 waits until Nanda runs work confirm e\d+ at a terminal\.$/,
    )
    const id = r.match(/^(e\d+)/)[1]
    // Until the confirm, the escalation is open.
    const waiting = await out(p.nanda('waiting'))
    expect(waiting).toContain('v3 escalated on r1')
    expect(waiting).toContain(`${id} forwarded by a1 for Nanda: resolve v3 on r1`)
    const confirmed = await out(p.nanda(`confirm ${id}`, 'confirm'))
    expect(confirmed).toEndWith(`${id} confirmed -> v4.`)
    expect(await out(p.nanda('waiting'))).not.toContain('v3 escalated on r1')
    // A confirmed act is the person's own act at the terminal, in the words that they gave.
    expect(await out(p.agent('result show r1'))).toContain(
      'v4 resolve by Nanda, resolves v3: "the date is not needed"',
    )
  })

  test('a forwarded resolve names an escalation, and takes no --resolution', async () => {
    const { p, lead } = await ready()
    expect((await p.agent(`forward ${lead} Nanda resolve v2 --quote="fine"`)).err).toContain(
      'a resolve ends an escalation; this review is not an escalation',
    )
    const both = '--quote="fine" --resolution="fine"'
    const r = await p.agent(`forward ${lead} Nanda resolve v2 ${both}`)
    expect(r.err).toContain(
      'work forward resolve has no flag --resolution; it reads --evidence, --quote, --channel',
    )
    expect(r.code).toBe(2)
  })
})

describe('free', () => {
  test('a parent frees its child, and the person frees any assignment', async () => {
    const { p, lead, writer } = await withWriter()
    const freed = 'a2 is freed; the next work brief claims it.'
    ok(await p.agent(`brief ${writer}`))
    expect(await out(p.agent(`free ${lead} a2`))).toBe(freed)
    ok(await p.agent(`brief ${writer}`))
    expect(await out(p.nanda('free a2'))).toBe(freed)
    expect(await out(p.agent('log --last=1'))).toContain('free a2')
  })
})

describe('the guide decision-words', () => {
  test('work guide decision-words prints the words of a decision; item-words is gone', async () => {
    const p = project()
    expect(await out(p.agent('guide decision-words'))).toStartWith(
      '# The words of a decision for the person',
    )
    const old = await p.agent('guide item-words')
    expect(old.err).toContain(
      'work guide <name>: the guides are decision-words, direction-review, limits, roles, writing',
    )
    expect(old.code).toBe(1)
  })
})

describe('the context key section', () => {
  test('a where with section selects the standard of that section only', async () => {
    const { p, lead } = await started()
    // t1 has context { section: introduction }: the intro-story standard and its rule apply.
    expect(await out(p.agent(`brief ${lead}`))).toContain('repeatable')
    const design = TASK.replace('The Introduction', 'The Design')
      .replace('section: introduction', 'section: design')
    p.write('design.yaml', design)
    ok(await p.nanda('task open --file=design.yaml'))
    const other = tokenIn(await out(p.nanda('assign t2 --role=section-lead')))
    expect(await out(p.agent(`brief ${other}`))).not.toContain('repeatable')
  })

  test('a where with a list of sections selects the standard of each of them', async () => {
    const { p } = await started({
      'directions/tsd-writing.yaml': DIRECTION.replace(
        'where: { section: introduction }',
        'where: { section: [introduction, design] }',
      ),
    })
    const opened = (name, section) => {
      p.write(`${section}.yaml`, TASK.replace('The Introduction', name).replace('section: introduction', `section: ${section}`))
      return p.nanda(`task open --file=${section}.yaml`)
    }
    ok(await opened('The Design', 'design'))
    expect(await out(p.agent(`brief ${tokenIn(await out(p.nanda('assign t2 --role=section-lead')))}`))).toContain('repeatable')
    ok(await opened('The Risks', 'risks'))
    expect(await out(p.agent(`brief ${tokenIn(await out(p.nanda('assign t3 --role=section-lead')))}`))).not.toContain('repeatable')
    p.write('empty.yaml', DIRECTION.replace('id: tsd-writing', 'id: empty-where').replace('where: { section: introduction }', 'where: { section: [] }'))
    expect((await p.agent('direction new --file=empty.yaml --by=assess')).err).toContain('where section lists no value')
  })

  test('the old key region is refused in a task and in a where', async () => {
    const { p } = await started()
    p.write('old.yaml', TASK.replace('section: introduction', 'region: introduction'))
    const task = await p.nanda('task open --file=old.yaml')
    expect(task.err).toStartWith('refused: old.yaml: context key "region"')
    expect(task.code).toBe(1)
    const old = DIRECTION.replace('{ section: introduction }', '{ region: introduction }')
    const q = project({ 'directions/tsd-writing.yaml': old })
    ok(await q.nanda('init'))
    expect((await q.agent('direction new --file=directions/tsd-writing.yaml --by=assess')).err)
      .toContain('where key "region" is not one of system, field, language, repo, section')
  })

  test('an output form fills <section> with the section of the task', async () => {
    const { p, writer } = await withWriter()
    const brief = await out(p.agent(`brief ${writer}`))
    // The writer's output form is "<file>#<section>".
    expect(brief).toContain(`work report ${writer} --output=docs/tsd.md#introduction`)
    expect(brief).not.toContain('<section>')
  })
})

describe('exit codes (card 8)', () => {
  test('0 success, 1 a refusal, 2 a mistake in the command line', async () => {
    const { p, lead } = await reported()
    expect((await p.agent(`next ${lead}`)).code).toBe(0)
    expect((await p.agent(`finish ${lead}`)).code).toBe(1)
    expect((await p.agent('frobnicate')).code).toBe(2)
    expect((await p.agent(`review ${lead} r1 accept --settles=v2`)).code).toBe(2)
    expect((await p.agent(`next ${lead} --verbose`)).code).toBe(2)
    expect((await p.agent(`review ${lead} r1 accept --reason`)).code).toBe(2)
  })

  test('3 an outside failure: a file that is not a store', async () => {
    const p = project()
    mkdirSync(join(p.dir, '.work'), { recursive: true })
    writeFileSync(join(p.dir, '.work', 'aristoteles.db'), 'only words, not a database\n')
    const r = await p.nanda('status')
    expect(r.err).toStartWith(
      'refused: the file <project>/.work/aristoteles.db is not a store of this work',
    )
    expect(r.code).toBe(3)
  })
})


describe('the fixes of the skills round', () => {
  test('role fit reads only official directions: a draft-only one has no rules yet', async () => {
    const { p } = await started()
    p.write(
      'hld.yaml',
      'id: hld-writing\nname: HLD writing\nowner: Nanda\nfrom: [Logos]\n' +
        // Nanda, 2026-11-15: a direction has a summary.
        'summary: An HLD shows the whole system on one page.\n' +
        'says: The reader sees the whole system on one page.\nstandards:\n  - id: one-page\n' +
        '    says: Keep it to one page.\n    rules:\n' +
        '      - { id: one-page-only, says: "The HLD fits one page", checkedBy: linter }\n' +
        markedOf('hld-writing'),
    )
    ok(await p.agent('direction new --file=hld.yaml --by=assess'))
    // Before the fix, role fit exited 70: "the work has no official direction hld-writing".
    const fit = await p.nanda('role fit writer')
    expect(fit.code).toBe(0)
    expect(fit.out).toStartWith('static checks of writer: pass')
    const fitted = await out(p.nanda('role fit writer --answers=fit.yaml'))
    expect(fitted).toBe('writer fits; recorded.')
  })

  test('a task opens while a new direction has only a draft; the task cannot name that one', async () => {
    const { p } = await started()
    p.write(
      'hld.yaml',
      'id: hld-writing\nname: HLD writing\nowner: Nanda\nfrom: [Logos]\n' +
        // Nanda, 2026-11-15: a direction has a summary.
        'summary: An HLD shows the whole system on one page.\n' +
        'says: The reader sees the whole system on one page.\nstandards:\n  - id: one-page\n' +
        '    says: Keep it to one page.\n    rules:\n' +
        '      - { id: one-page-only, says: "The HLD fits one page", checkedBy: linter }\n' +
        markedOf('hld-writing'),
    )
    ok(await p.agent('direction new --file=hld.yaml --by=assess'))
    // Before the fix, task open and task draft exited 70: "the work has no official direction
    // hld-writing" (a host on a real dir, 2026-11-13).
    expect(ok(await p.nanda('task open --file=task.yaml')).out).toStartWith('t2 opened')
    p.write('hld-task.yaml', 'name: The HLD\ntext: Write the HLD.\ndirections: [hld-writing]\n')
    expect((await p.nanda('task open --file=hld-task.yaml')).code).toBe(1)
  })

  test('role list keeps its columns with a long role name', async () => {
    const long = 'introduction-section-lead'
    const p = project({
      'aristoteles.yaml': WORK_YAML.replaceAll('section-lead', long),
      'directions/tsd-writing.yaml': DIRECTION.replace(
        'checkedBy: section-lead',
        `checkedBy: ${long}`,
      ),
    })
    ok(await p.nanda('init'))
    const lines = (await out(p.agent('role list'))).split('\n')
    const modelAt = lines.map((l) => l.search(/(opus|sonnet|haiku) /))
    expect(new Set(modelAt).size).toBe(1)
    expect(lines.find((l) => l.startsWith(long))).toMatch(
      /^introduction-section-lead {2}sonnet {2}Runs one section/,
    )
  })

  test('a --why that is not one of the five reasons names the five in its next line', async () => {
    const { p } = await started()
    const arch = tokenIn(await out(p.nanda('assign t1 --role=architect')))
    ok(await p.agent(`brief ${arch}`))
    p.write('edit.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs. }\n')
    const why = '--why="the cost was missing"'
    const r = await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml ${why}`)
    expect(r.err).toContain('refused: --why="the cost was missing" is not a reason of a draft')
    // D10, I5: the choice names the five, not "run the command again" (BUILD.md 4.4).
    expect(r.err).toContain(
      'next: pick one of: Correct the rule, ' +
        'Correct the standard, Correct the direction, Correct the reviewer, Shorten',
    )
    expect(r.err).not.toContain('check the ids with work status')
  })

  // P1 (D3): the next line names the one that drafts it; here no high role works yet.
  test('the next line of a suggestion names who drafts it', async () => {
    const { p } = await started()
    const next = 'next: no agent can draft it now; give a role that directs work, and it drafts it: ' +
      'work assign t1 --role=architect'
    expect(await out(p.nanda('suggest --says="a direction for the HLD"'))).toContain(next)
    expect(await out(p.nanda('suggest tsd-writing --says="say the cost first"'))).toContain(next)
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    expect(await out(p.nanda('suggest --says="a direction for the API"'))).toContain('next: a2 (architect) drafts it')
  })
})

// A project of the UI: the host of h1 (a1) briefed on its top task t1. settings: lines before the
// config; roles: the rest of aristoteles.yaml.
const hostedRun = async ({ settings = '', roles = WORK_YAML } = {}) => {
  const top = `${TASK_WHOLE}role: architect\n`
  const p = project({ 'aristoteles.yaml': settings + roles, 'top.yaml': top })
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
  ok(await p.run('run start', HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
  const opened = await out(p.ui('task open td1'))
  const host = await solToken(p, opened)
  ok(await p.agent(`brief ${host}`))
  return { p, opened, host }
}
const PROMPT = (a) => `  Use the work skill. In <project>, run: work brief ${a}.`

// Nanda, 2026-11-15: a direction has a summary: one or two plain sentences for a person who reads
// it the first time. It shows before the words, and a revise may change it.
describe('the summary of a direction', () => {
  test('direction show gives the summary first; a revise changes it, and the draft shows the old one', async () => {
    const { p } = await started()
    expect(await out(p.nanda('direction show tsd-writing'))).toContain(
      'summary: A TSD lets its reader decide without a meeting, so each page stands alone.\n' +
        'flow:\n',
    )
    const arch = tokenIn(await out(p.nanda('assign t1 --role=architect')))
    ok(await p.agent(`brief ${arch}`))
    p.write('edit.yaml', 'summary: A TSD shows its reader the cost of each choice.\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    const draft = await out(p.nanda('direction show d2'))
    expect(draft).toContain('summary: A TSD shows its reader the cost of each choice.\n')
    expect(draft).toContain(
      'summary was: A TSD lets its reader decide without a meeting, so each page stands alone.',
    )
    ok(await p.nanda('review d2 accept --evidence="the draft, its summary | it names the cost"', 'accept'))
    expect(await out(p.nanda('direction show tsd-writing'))).toContain(
      'summary: A TSD shows its reader the cost of each choice.\n',
    )
  })

  // Nanda, 2026-11-15: a direction has a flow, the steps that it governs marked. A revise gives
  // it another one; direction show prints it after the summary, each marked step with its ids,
  // and the draft shows the flow that it had before. A mark names ids of the direction only.
  test('a revise gives a direction another flow; direction show prints its marked steps', async () => {
    const { p } = await started()
    expect(await out(p.nanda('direction show tsd-writing'))).toContain(
      '  4. writer -> docs/tsd.md: fills the template one section at a time (docs/template.md:3) ' +
        '[uses tsd-writing, intro-story, repeatable]\n',
    )
    const arch = tokenIn(await out(p.nanda('assign t1 --role=architect')))
    ok(await p.agent(`brief ${arch}`))
    const flow = (uses) =>
      'flow:\n  - from: writer\n    to: docs/tsd.md\n    says: writes the TSD\n' +
      `    uses: [${uses}]\n    examples:\n` +
      '      - { fit: Follows, output: { written: one section }  }\n' +
      '      - { fit: Breaks, output: { written: two sections in one } }\n'
    p.write('ghost.yaml', flow('ghost'))
    expect((await p.agent(`direction revise ${arch} tsd-writing --file=ghost.yaml`)).err).toContain(
      'refused: flow step 1 uses "ghost", which is not tsd-writing or a standard or rule of it',
    )
    p.write('edit.yaml', flow('tsd-writing'))
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    const draft = await out(p.nanda('direction show d2'))
    expect(draft).toContain('  1. writer -> docs/tsd.md: writes the TSD [uses tsd-writing]\n')
    expect(draft).toContain('flow was:\n  1. Person -> architect: asks for a TSD of the export\n')
    ok(await p.nanda('review d2 accept --evidence="the draft, its flow | it shows the steps"', 'accept'))
    expect(await out(p.nanda('direction show tsd-writing'))).toContain(
      'summary: A TSD lets its reader decide without a meeting, so each page stands alone.\n' +
        'flow:\n' +
        '  1. writer -> docs/tsd.md: writes the TSD [uses tsd-writing]\n',
    )
  })
})

describe('the work assign words, by where the assignment runs', () => {
  test('Host: the host gets its token from work wait', async () => {
    const { opened } = await hostedRun()
    expect(opened).toContain('a1 is the host of h1; the host gets its token from work wait.')
  })

  test('Agent: a persistent role runs in its agent, whose terminal the UI starts', async () => {
    const { p, host } = await hostedRun()
    expect(await out(p.agent(`assign ${host} t1 --role=section-lead`))).toBe(
      [
        'a2 · section-lead (sonnet) on t1 The Introduction',
        'a2 runs in p1, the persistent section-lead agent of h1 (sonnet). Its terminal ' +
          'gets a2 through work wait --by=p1; the UI starts that terminal when it has none. ' +
          'Do not start it yourself.',
        `Then run work wait ${host}: it returns when you have work.`,
      ].join('\n'),
    )
  })

  test('Subagent: a disposable role starts as a subagent on the model of its role', async () => {
    const { p, host } = await hostedRun()
    const words = await out(p.agent(`assign ${host} t1 --role=writer`))
    expect(words).toContain(
      'Start a subagent on haiku with this prompt, and nothing else:',
    )
    expect(words).toContain(PROMPT('a2'))
    // P9: the model that the role names, by its name in the models table.
    const small = WORK_YAML.replace('  haiku:  {', '  small-model: {').replaceAll('model: haiku', 'model: small-model')
    const named = await hostedRun({ roles: small })
    const withModel = await out(named.p.agent(`assign ${named.host} t1 --role=writer`))
    expect(withModel).toContain(
      'Start a subagent on small-model with this prompt, and nothing else:',
    )
  })

  // Ruling 10: a role of any model can be persistent. A persistent writer runs in its agent, so its parent
  // gives it no command: the agent's wait gives it its token.
  test('Agent of a role of one unit: the parent waits for the terminal of the agent', async () => {
    const lasting = WORK_YAML.replace(
      'persistent: false\n      why: It writes one section once, from its brief.',
      'persistent: true\n      why: It writes every section, so it keeps what it read.',
    )
    const { p, host } = await hostedRun({ roles: lasting })
    ok(await p.agent(`assign ${host} t1 --role=section-lead`))
    // The UI records the lead's terminal, as the supervisor does for the agent p1.
    const lead = tokenIn(await out(p.ui('session a2 --id=s-lead --token')))
    ok(await p.agent(`brief ${lead}`))
    expect(await out(p.agent(`assign ${lead} t1 --role=writer`))).toContain(
      'a3 runs in p2, the persistent writer agent of h1 (haiku).',
    )
    expect(await out(p.agent(`next ${lead}`))).toBe(
      'make t1: a3 runs in p2, a persistent agent: its terminal gets a3 through work wait ' +
        '--by=p2, and the UI starts that terminal when it has none (attempt 1 of 3)',
    )
  })

  test('NoRun: a persistent role on a task with no run keeps the words of before', async () => {
    const p = project()
    await init(p)
    ok(await p.nanda('role fit section-lead --answers=fit.yaml'))
    ok(await p.nanda('task open --file=task.yaml'))
    const words = await out(p.nanda('assign t1 --role=section-lead'))
    expect(words).toContain('Start a subagent on sonnet with this prompt, and nothing else:')
    expect(words).toContain(PROMPT('a1'))
  })
})
