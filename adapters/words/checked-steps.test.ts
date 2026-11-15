// P3: the words print only the checked intents of a step. Each case was a printed command that
// canAct or the action refused (plan/research/illegal-states: F5, F6, B1, B2).
import { describe, expect, test } from 'bun:test'
import { derivedIn, h, ok, type Project } from '../../core/actions/fixture.test.ts'
import { canAct, waitingFor } from '../../core/derived/index.ts'
import type { Intent } from '../../core/schema/actions.ts'
import type { Author } from '../../core/schema/index.ts'
import { printedViolations } from '../cli/printed.ts'
import { waitingLines } from './index.ts'

const NANDA: Author = { _tag: 'Person', name: 'Nanda', channel: 'terminal' }
const ROLES = ['architect', 'section-lead', 'writer', 'linter']
// section-lead runs only as a subagent: the person may not give it a top task.
const DISPOSABLE = h.WORK_YAML.replace(
  'persistent: true\n      why: It runs one section',
  'persistent: false\n      why: It runs one section',
)
const approvedBy = (by: string) =>
  h.DIRECTION.replace('from: [Pathos, Logos]\n', `from: [Pathos, Logos]\napprovedBy: ${by}\n`)

const opened = async (files: Record<string, string> = {}): Promise<Project> => {
  const p = h.project(files)
  await h.init(p)
  for (const role of ROLES) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  return p
}
// A model run outside any task drafts a change of tsd-writing.
const modelDraft = async (p: Project): Promise<string> => {
  p.write('change.yaml', 'add:\n  - { id: short, says: Keep it short. }\n')
  const out = ok(await p.agent('direction revise tsd-writing --file=change.yaml --by=assess --why="Shorten"'))
  return out.out.match(/^(d\d+) drafted/m)?.[1] ?? ''
}
const waitingOf = (p: Project) => {
  const d = derivedIn(p)
  return { d, lines: waitingLines(d, waitingFor(d, { _tag: 'Person', name: 'Nanda' }), 'Nanda') }
}

describe('F5: the order of a draft deciders', () => {
  test('{ or: [architect, Nanda] }: the person may accept now, and the row says so', async () => {
    const p = await opened({ 'directions/tsd-writing.yaml': approvedBy('{ or: [architect, Nanda] }') })
    const draft = await modelDraft(p)
    const { d, lines } = waitingOf(p)
    const of = { _tag: 'Revision', id: draft }
    expect(canAct(d, NANDA, { _tag: 'Accept', target: { of } } as Intent)._tag).toBe('May')
    expect(lines.join('\n')).not.toContain('before yours')
    expect(lines).toContain(
      `    work direction show ${draft}; work review ${draft} accept [--reason="<a comment>"], ` +
        'or reject --reason="<why>"',
    )
  }, 120000)

  test('approvedBy: architect: no row says the person comes after the architect', async () => {
    const p = await opened({ 'directions/tsd-writing.yaml': approvedBy('architect') })
    const draft = await modelDraft(p)
    const { lines } = waitingOf(p)
    expect(lines).toContain(`${draft} waits for the accept of an architect outside the tree of its reviser`)
    expect(lines.join('\n')).not.toContain('before yours')
  }, 120000)
})

describe('F6, B2: work waiting assigns only the roles that canAct gives', () => {
  test('an idle task: no assign of a disposable role', async () => {
    const p = await opened({ 'aristoteles.yaml': DISPOSABLE })
    const { d, lines } = waitingOf(p)
    expect(lines).toContain('    work assign t1 --role=architect')
    expect(lines.join('\n')).not.toContain('section-lead')
    expect(printedViolations(d, ['Nanda'])).toEqual([])
  }, 120000)

  test('a draft waits for a disposable decider: the row names it, and assigns nothing', async () => {
    const p = await opened({
      'aristoteles.yaml': DISPOSABLE,
      'directions/tsd-writing.yaml': approvedBy('{ order: [section-lead, Nanda] }'),
    })
    const draft = await modelDraft(p)
    const { d, lines } = waitingOf(p)
    expect(lines).toContain(`${draft} waits for the accept of a section-lead outside the tree of its reviser`)
    expect(lines.join('\n')).not.toContain('--role=section-lead')
    expect(printedViolations(d, ['Nanda'])).toEqual([])
    expect((await p.nanda('waiting')).out).not.toContain('--role=section-lead')
  }, 120000)
})

describe('B1: a brief over its limit on a task with a section', () => {
  const small = h.WORK_YAML.replace(
    'medium: { Assignment: { briefChars: 12000 }',
    'medium: { Assignment: { briefChars: 300 }',
  )
  test('the brief and work waiting offer a remake, and canAct refuses the split', async () => {
    const p = await opened({ 'aristoteles.yaml': small })
    const lead = h.tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
    const brief = ok(await p.agent(`brief ${lead}`)).out
    expect(brief).toContain('Nanda shortens the directions of t1, or remakes t1.')
    const waiting = ok(await p.nanda('waiting')).out
    expect(waiting).not.toContain('task split')
    expect(waiting).toContain(
      '    work suggest tsd-writing --says="<the shorter words>", or work task remake t1 ' +
        '--file=<task.yaml> --reason="<the shorter scope>"',
    )
    // One predicate: the step leaves the split out because canAct refuses it, as the act does.
    const split = { _tag: 'SplitTask', target: { task: 't1', answers: null } } as Intent
    const can = canAct(derivedIn(p), NANDA, split)
    const message = 't1 has the section introduction, so it is one unit of work; it is not split'
    expect(can._tag === 'MayNot' && can.refusal.message).toBe(message)
    p.write('parts.yaml', '- { name: A, text: Part A. }\n- { name: B, text: Part B. }\n')
    expect((await p.nanda('task split t1 --file=parts.yaml')).err).toContain(message)
  }, 120000)
})
