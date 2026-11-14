// New words of a role after the first start (ruling 2026-11-14): an agent that edits
// aristoteles.yaml stops every write until the person applies it, so a high role or a model run
// outside any task drafts the words with work role draft. The draft is an event
// (Role.WordsDrafted) and waits for the person in waitingFor: work waiting and the page show it.
// The person accepts it (the words go into aristoteles.yaml, and Workflow.RoleWordsChanged stores
// them) or rejects it with a reason (Role.WordsRejected), which its drafter reads in work waiting.
// A newer draft of the same role replaces a waiting one. Only the new code has the commands.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ok, project, started, tokenIn, WORK_YAML } from './harness.js'
import { act, gitPerson, panel } from './outside.js'

const INTRO = 'You write one section under its heading, from its brief alone.'
const WORDS = `intro: ${INTRO}\n`
// aristoteles.yaml after the accept of WORDS: only the intro line of the writer changes.
const WITH_INTRO = WORK_YAML.replace(
  '    intro: You write one section under its heading.\n',
  `    intro: "${INTRO}"\n`,
)

const fitted = async () => {
  const p = project({ 'words.yaml': WORDS })
  gitPerson(p)
  ok(await p.nanda('init'))
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  return p
}
const fileOf = (p) => readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8')
const draftOf = (out) => out.match(/^(e\d+): new words of/)[1]

describe('a draft of the words of a role', () => {
  test('a model run drafts them; no write stops; the person accepts them at a terminal', async () => {
    const p = await fitted()
    const drafted = ok(await p.agent('role draft writer --file=words.yaml --by=host')).out
    const draft = draftOf(drafted)
    expect(drafted).toBe(`${draft}: new words of writer; they wait for the accept of Nanda.\n` +
      `next: Nanda accepts or rejects them on the page, or with work role accept|reject ${draft}; ` +
      'after an accept, record the fit of the new words: work role fit writer --answers=<file> --by=host')
    // aristoteles.yaml stays as stored, so the work goes on.
    expect(fileOf(p)).toBe(WORK_YAML)
    ok(await p.agent('direction new --file=directions/tsd-writing.yaml --by=assess'))
    expect(ok(await p.nanda('waiting --for=Nanda')).out).toContain(
      `${draft} new words of writer, drafted by host, a model run outside any task\n` +
        `    work role show ${draft}; work role accept ${draft}, or reject ${draft} --reason="<why>"`)
    expect(ok(await p.nanda(`role show ${draft}`)).out).toBe(
      `${draft} new words of writer, drafted by host, a model run outside any task · waits for the accept of Nanda\n` +
        '- intro: You write one section under its heading.\n' +
        `+ intro: ${INTRO}`)

    // The accept shows the draft, and the person types the word.
    const accepted = ok(await p.nanda(`role accept ${draft}`, 'accept')).out.split('\n')
    expect(accepted[0]).toStartWith(`${draft} new words of writer`)
    expect(accepted.at(-1)).toBe(
      `${draft} is accepted: the new words of writer are in aristoteles.yaml; writer needs a new work role fit.`)
    expect(fileOf(p)).toBe(WITH_INTRO)
    expect(ok(await p.nanda('waiting --for=Nanda')).out).not.toContain(draft)
    expect(ok(await p.nanda(`role show ${draft}`)).out).toStartWith(
      `${draft} new words of writer, drafted by host, a model run outside any task · accepted (e`)
    expect(ok(await p.agent('log')).out).toMatch(new RegExp(`^${draft} .* host run \\S+ \\(run\\) role\\.draft writer$`, 'm'))
    expect(ok(await p.agent('log')).out).toMatch(/^e\d+ .* Nanda \(terminal\) config\.text$/m)
    expect(ok(await p.agent('role list')).out).toMatch(/^writer .*\(no fit record\)$/m)
    ok(await p.agent('role fit writer --answers=fit.yaml --by=host'))
    // A second accept of the same draft names the real choice.
    expect((await p.nanda(`role accept ${draft}`, 'accept')).err).toContain(`${draft} is accepted already`)
  })

  test('the person accepts them on the page; a list word and a missing word change in place', async () => {
    const { p } = await started({
      'words.yaml': 'responsibilities:\n  - Give one --evidence line for each rule.\n' +
        'output: "a list of rules with evidence"\n',
    })
    gitPerson(p)
    const draft = draftOf(ok(await p.agent('role draft linter --file=words.yaml --by=host')).out)
    const shown = (await panel(p, 't1')).decisions.find((x) => x.id === draft)
    expect(shown).toMatchObject({
      kind: 'roleWords',
      role: 'linter',
      text: 'New words of the role "linter", drafted by host, a model run outside any task, wait for your decision.',
    })
    expect(shown.lines).toEqual([
      '- responsibilities:',
      '-   - Give one --evidence line for each rule in your checks.',
      '-   - Reject with one --point for each rule that the section breaks.',
      '+ responsibilities:',
      '+   - Give one --evidence line for each rule.',
      '+ output: a list of rules with evidence',
    ])
    p.realTime()
    expect((await act(p, 'accept-words', { draft })).out).toBe(
      `${draft} accepted: the new words are in aristoteles.yaml; record the fit again.`)
    expect(fileOf(p)).toBe(WORK_YAML.replace(
      '      - Give one --evidence line for each rule in your checks.\n' +
        '      - Reject with one --point for each rule that the section breaks.\n' +
        '    acts: [{ review: [writer] }]\n',
      '      - Give one --evidence line for each rule.\n' +
        '    acts: [{ review: [writer] }]\n    output: a list of rules with evidence\n'))
    expect((await panel(p, 't1')).decisions.some((x) => x.id === draft)).toBe(false)
  })

  test('the person rejects them with a reason; the drafter reads it; a newer draft replaces it', async () => {
    const p = await fitted()
    const first = draftOf(ok(await p.agent('role draft writer --file=words.yaml --by=host')).out)
    expect((await p.nanda(`role reject ${first}`)).err).toContain('a reject of new words needs a reason')
    expect(ok(await p.nanda(`role reject ${first} --reason="keep the heading rule"`)).out)
      .toBe(`${first} is rejected; work waiting shows the reason to its drafter.`)
    expect(ok(await p.nanda('waiting')).out).toContain(
      `${first} (new words of writer) is rejected: "keep the heading rule"; ` +
        'its drafter host, a model run outside any task, drafts new words that answer it\n' +
        '    work role draft writer --file=<words.yaml> --by=host')
    expect(fileOf(p)).toBe(WORK_YAML)
    // A newer draft: the reject is answered, and a waiting draft of the role is replaced.
    p.write('words.yaml', 'intro: You write one section under its heading, and keep it.\n')
    const second = draftOf(ok(await p.agent('role draft writer --file=words.yaml --by=host')).out)
    p.write('words.yaml', 'intro: You write one section under its heading; you keep the heading.\n')
    const third = draftOf(ok(await p.agent('role draft writer --file=words.yaml --by=host')).out)
    const waiting = ok(await p.nanda('waiting')).out
    expect(waiting).not.toContain(`${first} (new words`)
    expect(waiting).not.toContain(`${second} new words`)
    expect(waiting).toContain(`${third} new words of writer`)
    expect((await p.nanda(`role accept ${second}`, 'accept')).err)
      .toContain(`${second} is replaced by ${third}, a newer draft of the role`)
  })

  test('a high role drafts them with its token; a lower role, the person, and a bad file do not', async () => {
    const { p, lead } = await started({ 'words.yaml': WORDS })
    expect((await p.nanda('role draft writer --file=words.yaml')).err).toBe(
      'refused: the person writes the words of writer in aristoteles.yaml, then runs work config apply\n' +
        'next: change the words of writer in aristoteles.yaml; work config apply stores them')
    expect((await p.agent(`role draft ${lead} writer --file=words.yaml`)).err).toBe(
      'refused: a medium role does not draft the words of a role; escalate them\n' +
        'next: escalate the new words of the role to your parent')
    expect((await p.agent('role draft writer --file=words.yaml')).err)
      .toContain('a model run outside any task names itself: --by=<its name in lower case>')
    const refused = async (file, words, role = 'writer') => {
      p.write(file, words)
      const { code, err } = await p.agent(`role draft ${role} --file=${file} --by=host`)
      expect(code).not.toBe(0)
      return err
    }
    expect(await refused('acts.yaml', 'acts: [{ do: write two sections }]\n')).toBe(
      'refused: acts.yaml: acts: only the words of a role change after the first start ' +
        '(description, intro, responsibilities, output); a new act or tier needs a new store\n' +
        'next: give only the new words of the role in acts.yaml')
    expect(await refused('same.yaml', 'intro: You write one section under its heading.\n'))
      .toContain('same.yaml gives the words that writer has now')
    expect(await refused('vague.yaml', 'responsibilities: [Handle the section.]\n'))
      .toContain('writer with these words fails the static checks: "Handle the section." uses the vague verb "handle"')
    expect(await refused('words.yaml', WORDS, 'nobody')).toContain('there is no role "nobody"')
    expect(ok(await p.nanda('waiting')).out).not.toContain('new words of')

    const sol = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${sol}`))
    const drafted = ok(await p.agent(`role draft ${sol} writer --file=words.yaml`)).out
    expect(drafted).toContain('work role fit writer --answers=<file> --as=<your token>')
    const draft = draftOf(drafted)
    // An agent's reject reaches its drafter by its assignment.
    ok(await p.nanda(`role reject ${draft} --reason="say where the section is"`))
    const id = sol.split('.')[0]
    expect(ok(await p.nanda(`waiting --for=${id}`)).out).toContain(
      `${draft} (new words of writer) is rejected: "say where the section is"; ` +
        `its drafter ${id} drafts new words that answer it\n` +
        '    work role draft <token> writer --file=<words.yaml>')
  })
})
