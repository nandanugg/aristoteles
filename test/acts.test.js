// The CLI acts of the UI (plan/ui/BUILD.md part 4, Nanda 2026-11-11). A project starts with a talk:
// the host (a Sol in a run) drafts the top task, and the person opens it. Only four kinds of
// decision reach the person: a system problem, a direction problem, the end of a project, and a
// relayed act that waits for a confirm; the host handles the rest, and writes its words about
// each decision before the person sees it.
import { describe, expect, test } from 'bun:test'
import { HOST, INTRO_V2, TASK_WHOLE, init, ok, project, tokenIn } from './harness.js'
import { canvas, panel, tables } from './outside.js'

// The decisions that the person sees on the panel of a task (the server's /api/task), at the time
// of the last act. At LATE, hostWaitMinutes (10 by default) passed since every act of these
// tests, so every decision shows: also one that still waits for the host's words.
const LATE = '2026-10-25T11:00:00.000Z'
const decisions = async (p, at) => (await panel(p, 't1', at)).decisions
const summary = (list) => list.map((i) => [i.kind, i.id, i.task])

// A dir with a host run h1 whose top task t1 is open, with the architect a1 as its host.
const hosted = async () => {
  const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.run('run start', HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
  const opened = ok(await p.ui('task open td1')).out
  const host = tokenIn(opened)
  ok(await p.agent(`brief ${host}`))
  return { p, host, opened }
}

describe('the acts of the UI', () => {
  test('the host drafts the top task; only the person opens it, and the host keeps its session', async () => {
    const p = project({ 'top.yaml': `${TASK_WHOLE}role: architect\n`, 'low.yaml': `${TASK_WHOLE}role: writer\n` })
    await init(p)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.run('run start', HOST))
    expect((await p.ui('task draft --file=top.yaml --by=h1')).err).toContain('the person tells the host in words; the host drafts the top task, and you open it')
    expect((await p.run('task draft --file=low.yaml --by=h1', HOST)).err).toContain('the draft names writer, a low role; a top task goes to a high (Sol) role')
    expect((await p.run('task draft --file=top.yaml --by=h1', { env: { ...HOST.env, TMUX_PANE: '%8' } })).err)
      .toContain('a draft of h1 comes from the terminal of h1')
    expect(ok(await p.run('task draft --file=top.yaml --by=h1', HOST)).out)
      .toBe('td1 drafted by h1: The Introduction, for the role architect.\nit waits for the person to open it: work task open td1')
    expect((await p.run('task open td1', HOST)).err).toContain('this is a person command; a person runs it at a terminal')
    const opened = ok(await p.ui('task open td1')).out
    expect(opened).toStartWith('t1 opened from td1: The Introduction\na1 · architect (high) on t1 The Introduction')
    expect((await p.ui('task open td1')).err).toContain('td1 is opened as t1')
    expect((await p.run('task draft --file=top.yaml --by=h1', HOST)).err).toContain('h1 has its top task t1; a part of it comes from a split')
    expect(ok(await p.ui('run list')).out).toContain('h1 host · works · pane %9')
    const db = tables(p)
    const sessions = db.query("SELECT session FROM assignment_session WHERE assignment = 'a1'").all()
    expect(sessions).toEqual([{ session: db.query("SELECT session FROM run WHERE id = 'h1'").get().session }])
    db.close()
    // The host may split its top task.
    expect(opened).toContain('architect may change t1 (its split) until 2026-11-24T')
    p.write('parts.yaml', '- { name: Part one, text: Write part one., context: { section: introduction } }\n- { name: Part two, text: Write part two., context: { section: design } }\n')
    ok(await p.agent(`brief ${tokenIn(opened)}`))
    ok(await p.agent(`task split ${tokenIn(opened)} t1 --file=parts.yaml`))
  })

  test('a question of a model goes to the host; the host itself does not ask the person', async () => {
    const { p, host } = await hosted()
    const lead = tokenIn(ok(await p.agent(`assign ${host} t1 --role=section-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    ok(await p.agent(`ask ${lead} --text="Is the retry part of the export?" --to=owner`))
    expect(ok(await p.agent('question show q1')).out).toStartWith('q1 asked by a2, for a1:')
    expect((await p.agent(`ask ${host} --text="Is the retry part of the export?" --to=owner`)).err)
      .toContain('you are the host of this project: answer it from the directions')
  })

  test('a system problem goes on the parent of the task that it stops; the host\'s own text is its words', async () => {
    const { p, host } = await hosted()
    const lead = tokenIn(ok(await p.agent(`assign ${host} t1 --role=section-lead`)).out)
    expect((await p.agent(`problem ${lead} t1 --says="the cluster is down"`)).err).toContain('the host (a Sol) records a system problem')
    expect(ok(await p.agent(`problem ${host} t1 --says="the cluster is down: run make up, then press Fixed"`)).out)
      .toBe('sp1 recorded on t1 The Introduction; it shows to the person until a fix.')
    // The host wrote the problem itself, so its text is its words: the person sees it at once.
    expect(summary(await decisions(p))).toEqual([['system', 'sp1', 't1']])
    expect((await decisions(p))[0]).toMatchObject({ shown: true, words: 'the cluster is down: run make up, then press Fixed' })
    // Words of the host that it writes after replace them.
    ok(await p.agent(`note ${host} words --on=sp1 --text="The cluster of this machine is down, so no test of t1 can run. Start it with make up."`))
    expect((await decisions(p))[0]).toMatchObject({ shown: true, words: 'The cluster of this machine is down, so no test of t1 can run. Start it with make up.' })
    ok(await p.agent(`problem ${host} t1 --says="the VPN is not connected"`))
    expect((await decisions(p)).map((i) => i.id)).toEqual(['sp1', 'sp2'])
    expect((await p.agent(`note ${lead} words --on=sp1 --text="x"`)).err).toContain('only the host of a project writes the words of a decision')
    ok(await p.ui('problem sp1 --fixed'))
    expect((await decisions(p, LATE)).map((i) => i.id)).toEqual(['sp2'])
  })

  test('the UI records a terminal event; the host sends input only to its own children', async () => {
    const { p, host } = await hosted()
    const lead = tokenIn(ok(await p.agent(`assign ${host} t1 --role=section-lead`)).out)
    expect((await p.agent(`send ${host} a2 --text="yes"`)).err).toContain('a2 has no terminal')
    ok(await p.ui('session a2 --id=s-lead'))
    // A prompt has no tries (the owner's Prompted move holds none; the watcher writes none).
    ok(await p.ui('event a2 --kind=prompt --text="Do you want to proceed?"'))
    expect(ok(await p.agent(`send ${host} a2 --text="1"`)).out).toBe('sent to a2; the UI types it into its terminal.')
    expect((await p.agent(`send ${lead} a1 --text="1"`)).err).toContain('only the host (a Sol) sends input to the terminal of a child')
    // A failure is after three tries, and the row keeps them.
    ok(await p.ui('event a2 --kind=error --text="connection error" --tries=3'))
    const db = tables(p)
    expect(db.query('SELECT on_id, kind, tries FROM terminal_event').all())
      .toEqual([
        { on_id: 'a2', kind: 'prompt', tries: 0 },
        { on_id: 'a2', kind: 'error', tries: 3 },
      ])
    db.close()
    // Only the terminal sees the text of a send (the watcher types it); the log has one send, by a1.
    const log = ok(await p.agent('log --last=100')).out.split('\n').map((l) => l.replace(/^e\d+ \S+ /, ''))
    expect(log.filter((l) => l.endsWith(' send'))).toEqual(['a1 (agent) send'])
  })

  test('a direction problem: the host writes the problem and the hope; the decision carries the change under the title of its direction', async () => {
    const { p, host } = await hosted()
    p.write('costs.yaml', 'replace:\n  - { id: facts-not-proof, with: { id: facts-not-proof, says: "The body states facts, with what the problem costs.", rules: [ ' +
      '{ id: no-code-proof, says: "No file paths with line numbers, no commit hashes in the body", checkedBy: linter } ] } }\n')
    ok(await p.agent(`direction revise ${host} tsd-writing --file=costs.yaml`))
    expect((await p.agent(`note ${host} words --on=d2 --text="The facts say nothing of the cost."`)).err).toContain('--hope="<what you hope by this change>"')
    expect((await p.agent(`note ${host} words --on=sp1 --text="x" --hope="y"`)).err).toContain('--hope is only for the words of a direction problem')
    ok(await p.agent(`note ${host} words --on=d2 --text="The facts say nothing of the cost." --hope="The readers see first why the work matters."`))
    const [item] = await decisions(p)
    expect(item).toMatchObject({ kind: 'direction', id: 'd2', words: 'The facts say nothing of the cost.', hope: 'The readers see first why the work matters.', shown: true })
    // One diff of the whole direction: what it says, then each standard with its checks.
    expect(item.change).toEqual({
      direction: 'TSD writing',
      lines: [
        ' The reader understands and decides from the page alone.',
        ' ',
        '-The body states facts; the proof stays in the agreed facts.',
        '+The body states facts, with what the problem costs.',
        ' Check: No file paths with line numbers, no commit hashes in the body',
        '-Check: No ticket ids and no chat-thread citations',
        ' ',
        ' (only where section is introduction)',
        ' Tell the story first, in plain words.',
        ' Check: A reviewer can repeat the problem without the design',
      ],
    })
  })

  test('words on a draft: an open draft needs a hope; an official draft takes none', async () => {
    const { p, host } = await hosted()
    // d1 is official already: its words ask for no hope, and a hope is refused.
    expect((await p.agent(`note ${host} words --on=d1 --text="x" --hope="y"`)).err).toContain('d1 is already official')
    expect(ok(await p.agent(`note ${host} words --on=d1 --text="The direction is in force."`)).out).toContain('the words of d1 are written')
    p.write('costs.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs. }\n')
    ok(await p.agent(`direction revise ${host} tsd-writing --file=costs.yaml`))
    expect((await p.agent(`note ${host} words --on=d2 --text="x"`)).err).toContain('--hope="<what you hope by this change>"')
  })

  test('the person accepts a direction draft with no evidence, and the comment is optional; a model still gives evidence', async () => {
    const { p, host } = await hosted()
    p.write('costs.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs., rules: [ { id: names-cost, says: "The introduction names the cost", checkedBy: linter } ] }\n')
    ok(await p.agent(`direction revise ${host} tsd-writing --file=costs.yaml`))
    const lead = tokenIn(ok(await p.agent(`assign ${host} t1 --role=section-lead`)).out)
    ok(await p.agent(`brief ${lead}`))
    expect((await p.agent(`review ${lead} d2 accept`)).err).toContain('an accept of d2 needs --evidence')
    expect(ok(await p.ui('review d2 accept --reason="the cost comes first"', 'accept')).out).toContain('d2 is official: tsd-writing@2')
    p.write('plain.yaml', 'add:\n  - { id: plain, says: Use plain words. }\n')
    ok(await p.agent(`direction revise ${host} tsd-writing --file=plain.yaml`))
    expect(ok(await p.ui('review d3 accept', 'accept')).out).toContain('d3 is official: tsd-writing@3')
  })

  test('the end of a project: the Sol accepts the top task, the host writes its words, and the person accepts the end', async () => {
    const { p, host } = await hosted()
    const writer = tokenIn(ok(await p.agent(`assign ${host} t1 --role=writer`)).out)
    ok(await p.agent(`brief ${writer}`))
    expect((await p.ui('run done h1')).err).toContain('h1 is not done: its top task is not accepted (t1)')
    p.write('docs/tsd.md', INTRO_V2)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const linter = tokenIn(ok(await p.agent(`assign ${host} t1 --role=linter`)).out)
    ok(await p.agent(`brief ${linter}`))
    ok(await p.agent(`review ${linter} r1 accept --evidence="no-code-proof | the introduction | no paths or hashes there" --evidence="no-ticket-ids | the introduction | no ticket ids there"`))
    ok(await p.agent(`review ${host} r1 accept --evidence="docs/tsd.md, the introduction | the section says what the task asks"`))
    expect(ok(await p.ui('run list')).out).toContain('h1 host · ends')
    expect(await decisions(p)).toEqual([])
    expect(summary(await decisions(p, LATE))).toEqual([['end', 'h1', 't1']])
    // While the host writes its words, the top task stays on the canvas, with no badge yet.
    expect((await canvas(p, 'h1')).rows.map((r) => [r.task.id, r.task.badge])).toEqual([['t1', false]])
    ok(await p.agent(`note ${host} words --on=h1 --text="The TSD is whole: the linter found no ticket id, and I read it end to end."`))
    expect((await decisions(p))[0].shown).toBe(true)
    // The top task is accepted, but it stays on the canvas while the end waits for the person.
    expect((await canvas(p, 'h1')).rows.map((r) => [r.task.id, r.task.badge, r.work])).toEqual([['t1', true, []]])
    ok(await p.ui('run done h1'))
    expect(ok(await p.ui('run list')).out).toContain('h1 host · done')
    expect(await decisions(p, LATE)).toEqual([])
    expect(await canvas(p, 'h1')).toMatchObject({ state: 'done', rows: [] })
  })
})
