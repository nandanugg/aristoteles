// work adjust (rulings 13 and 14, onboarding 2026-11-14): after the store starts, a role or a
// direction changes by an adjustment. A high agent or a host drafts it, the person shows it and
// accepts or rejects it, and a newer draft about the same role or direction replaces one that
// waits. A role adjustment writes aristoteles.yaml, so config apply finds no change after it.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ok, started, tokenIn } from './harness.js'

const yamlOf = (p) => Bun.YAML.parse(readFileSync(join(p.dir, 'aristoteles.yaml'), 'utf8'))
const EDITOR = `tier: low
description: Checks the words of one section.
intro: You check the words of one section.
responsibilities:
  - Give one --evidence line for each rule in your checks.
acts: [{ review: [writer] }]
persistence: { persistent: false, why: It checks one section once. }
icon: eye
`
const drafted = (out) => out.match(/^(e\d+): an adjustment: /)[1]

describe('an adjustment of a role', () => {
  test('a high agent drafts it; the person shows and accepts it; aristoteles.yaml holds it', async () => {
    const { p } = await started()
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    const out = ok(await p.agent(`adjust ${arch} persistence writer --persistent=true --why="It keeps one section across its tries."`)).out
    const e = drafted(out)
    expect(out).toContain(`${e}: an adjustment: writer becomes persistent: "It keeps one section across its tries."; it waits for the accept of Nanda.`)
    expect(ok(await p.nanda('waiting')).out).toContain(
      `${e} an adjustment: writer becomes persistent: "It keeps one section across its tries.", drafted by ${arch.split('.')[0]}\n` +
        `    work adjust show ${e}; work adjust accept ${e}, or reject ${e} --reason="<why>"`,
    )
    expect(ok(await p.nanda(`adjust show ${e}`)).out).toContain(`${e} writer becomes persistent`)
    expect(ok(await p.nanda(`adjust accept ${e}`, 'accept')).out).toContain(
      `${e} is accepted: writer becomes persistent: "It keeps one section across its tries."; aristoteles.yaml holds the change.`,
    )
    expect(yamlOf(p).roles.writer.persistence).toEqual({ persistent: true, why: 'It keeps one section across its tries.' })
    expect(ok(await p.nanda('config apply', 'apply')).out).toContain('applied: no role words changed')
  })

  test('a host adds a role and removes it; a tier changes; each accept writes aristoteles.yaml', async () => {
    const { p } = await started()
    p.write('editor.yaml', EDITOR)
    const add = drafted(ok(await p.agent('adjust add-role editor --file=editor.yaml --by=host')).out)
    expect(ok(await p.nanda(`adjust show ${add}`)).out).toContain(`${add} add the role editor (low, disposable), drafted by host, a model run outside any task`)
    ok(await p.nanda(`adjust accept ${add}`, 'accept'))
    expect(yamlOf(p).roles.editor.icon).toBe('eye')
    expect(ok(await p.nanda('role list')).out).toContain('editor')
    const tier = drafted(ok(await p.agent('adjust tier editor --tier=medium --by=host')).out)
    ok(await p.nanda(`adjust accept ${tier}`, 'accept'))
    expect(yamlOf(p).roles.editor.tier).toBe('medium')
    const gone = drafted(ok(await p.agent('adjust remove-role editor --by=host')).out)
    ok(await p.nanda(`adjust accept ${gone}`, 'accept'))
    expect(yamlOf(p).roles.editor).toBeUndefined()
    expect(ok(await p.nanda('config apply', 'apply')).out).toContain('applied: no role words changed')
  })

  test('a newer draft about the same role replaces the one that waits', async () => {
    const { p } = await started()
    const first = drafted(ok(await p.agent('adjust tier writer --tier=medium --by=host')).out)
    const second = drafted(ok(await p.agent('adjust persistence writer --persistent=true --why="It keeps its section." --by=host')).out)
    expect(ok(await p.nanda(`adjust show ${first}`)).out).toContain(`· replaced by ${second}`)
    expect((await p.nanda(`adjust accept ${first}`, 'accept')).err).toContain(`refused: ${first} is replaced by the newer draft ${second}`)
  })

  test('refused: a remove of a role in use, a draft of the person, and a draft of a medium agent', async () => {
    const { p, lead } = await started()
    expect((await p.agent('adjust remove-role section-lead --by=host')).err).toContain('refused: section-lead is in use: a1 plays it')
    expect((await p.nanda('adjust tier writer --tier=medium')).err).toContain(
      'refused: a model drafts an adjustment; the person says it in words',
    )
    expect((await p.agent(`adjust ${lead} tier writer --tier=medium`)).err).toContain(
      'refused: a high role drafts an adjustment; this assignment is medium',
    )
  })

  test('the person says it in words: work suggest roles reaches a high role', async () => {
    const { p } = await started()
    expect(ok(await p.nanda('suggest roles --says="the writer keeps its section across tries"')).out).toContain(
      's1: a suggestion about the roles; it stays open until an adjustment of a role answers it.',
    )
  })
})

describe('an adjustment of a direction', () => {
  test('a retire is rejected, and its drafter sees why', async () => {
    const { p } = await started()
    const retire = drafted(ok(await p.agent('adjust retire tsd-writing --by=host')).out)
    expect(ok(await p.nanda(`adjust reject ${retire} --reason="the task still follows it"`)).out).toContain(
      `${retire} is rejected; work waiting shows the reason to its drafter.`,
    )
    expect(ok(await p.nanda('waiting')).out).toContain(
      `${retire} (an adjustment: retire the direction tsd-writing) is rejected: "the task still follows it"; ` +
        'its drafter host, a model run outside any task, drafts a new one that answers it\n' +
        '    work adjust <change> --by=host',
    )
  })
})
