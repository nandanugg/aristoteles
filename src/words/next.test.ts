// The next steps as data: stepKey keeps the tags and the ids only (bug 13: a word or a claim time
// wakes nobody), and the step of an expired outside source (the owner's ruling, 2026-11-12) with
// its exact words, before every other step. The store is made by the CLI with the harness of the
// integrated tests.
import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { main } from '../cli.ts'
import type { AssignmentId, ResultId, TaskId, Time } from '../domain/ids.ts'
import type { Work } from '../domain/work.ts'
import { replay } from '../replay/replay.ts'
import { Env } from '../services/io.ts'
import { Store } from '../services/store.ts'
import { StoreLive } from '../store/sqlite.ts'
import { type NextStep, nextLines, nextSteps, stepKey } from './next.ts'
// @ts-expect-error the harness of the old tests is plain JavaScript with no types
import * as harness from '../../test/harness.js'

// The parts of the harness that these tests use.
const { INTRO_V2, ok, tokenIn, started } = harness as {
  readonly INTRO_V2: string
  readonly ok: (r: Ran) => Ran
  readonly tokenIn: (text: string) => string
  readonly started: (files?: Record<string, string>) => Promise<{
    readonly p: Project
    readonly lead: string
  }>
}

interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}
interface Project {
  readonly dir: string
  readonly agent: (line: string) => Promise<Ran>
  readonly write: (path: string, text: string) => void
}

const id = <A extends string>(text: string) => text as A

describe('stepKey', () => {
  test('has the tag and the ids of each step, and no words, flags, revisions or times', () => {
    const steps: ReadonlyArray<NextStep> = [
      {
        _tag: 'ReadSource',
        source: 'page',
        revision: 'v4',
        seenAt: id<Time>('2026-10-25T09:00:00.000Z'),
        hours: 72,
      },
      {
        _tag: 'GiveMakerCommand',
        maker: id<AssignmentId>('a2'),
        task: id<TaskId>('t1'),
        redo: true,
        ownChild: true,
      },
      {
        _tag: 'RecheckStaleSource',
        result: id<ResultId>('r1'),
        source: 'page',
        was: 'v1',
        now: 'v2',
      },
      { _tag: 'MakerWorking', maker: id<AssignmentId>('a2'), task: id<TaskId>('t1') },
    ]
    expect(stepKey(steps)).toBe(
      'ReadSource page\nGiveMakerCommand a2 t1\nRecheckStaleSource r1 page\nMakerWorking a2 t1',
    )
  })

  test('is the same when only a word, a flag, a revision or a time of a step changes', () => {
    const at = (time: string): NextStep => ({
      _tag: 'ReadSource',
      source: 'page',
      revision: time === '' ? 'v4' : 'v5',
      seenAt: id<Time>(time || '2026-10-25T09:00:00.000Z'),
      hours: time === '' ? 72 : 24,
    })
    expect(stepKey([at('')])).toBe(stepKey([at('2026-10-29T10:00:00.000Z')]))
    const make = (redo: boolean): NextStep => ({
      _tag: 'GiveMakerCommand',
      maker: id<AssignmentId>('a2'),
      task: id<TaskId>('t1'),
      redo,
      ownChild: !redo,
    })
    expect(stepKey([make(true)])).toBe(stepKey([make(false)]))
    expect(stepKey([])).toBe('')
  })
})

// --- the step of an expired outside source -------------------------------------------------------

// The events of a dir as the new store reads them, folded.
const workOf = (db: string, dir: string): Promise<Work> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* Store
      const opened = yield* store.open(dir, { create: false })
      return yield* replay(yield* opened.events)
    }).pipe(
      Effect.scoped,
      Effect.provide(
        StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: { ARISTOTELES_DB: db } }))),
      ),
    ),
  )

// The new CLI on a dir, at a time that the test sets (one minute later at each reading).
const newCli = (dir: string, db: string) => {
  let clock = 0
  return {
    at: (time: string) => {
      clock = Date.parse(time)
    },
    run: async (line: string) => {
      const out: Array<string> = []
      const err: Array<string> = []
      const code = await main(
        [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? ''),
        {
          cwd: dir,
          out: (t) => out.push(t),
          err: (t) => err.push(t),
          isTTY: false,
          readLine: () => undefined,
          now: () => {
            const time = new Date(clock).toISOString()
            clock += 60_000
            return time
          },
          gitUser: () => 'Nanda',
          env: { ARISTOTELES_DB: db },
          random: () => 'k9999',
        },
      )
      if (code !== 0) throw new Error(`work ${line}: ${err.join('\n')}`)
      return out.join('\n')
    },
  }
}

// The store file of a harness project.
const dbOf = (p: Project) => `${p.dir}/.work/aristoteles.db`

// The lead reads the page at v1 and records it; the writer reports r1 made from page@v1.
const fromPage = async () => {
  const { p, lead } = await started()
  const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer`)).out)
  ok(await p.agent(`brief ${writer}`))
  ok(await p.agent(`source ${lead} page@v1`))
  p.write('docs/tsd.md', INTRO_V2)
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction --made-from=page@v1`))
  // When the lead read the page: the time of the Source event.
  const db = new Database(dbOf(p), { readonly: true })
  const row = db.query<{ at: string }, []>("SELECT at FROM event WHERE record = 'Source'").get()
  db.close()
  if (row === null) throw new Error('the store has no Source event')
  return { p, lead, seenAt: row.at }
}
const hoursAfter = (time: string, hours: number) =>
  new Date(Date.parse(time) + hours * 3_600_000).toISOString()

describe('the step of an expired outside source', () => {
  test('comes first when work of the tree was made from it: its words, its key', async () => {
    const { p, lead, seenAt } = await fromPage()
    const cli = newCli(p.dir, dbOf(p))
    cli.at(hoursAfter(seenAt, 71))
    expect(await cli.run(`next ${lead}`)).not.toContain('read page again')
    cli.at(hoursAfter(seenAt, 73))
    const lines = (await cli.run(`next ${lead}`)).split('\n')
    expect(lines[0]).toBe(
      `read page again: page@v1 was read at ${seenAt}, more than 72 hours ago; ` +
        `then run work source ${lead} page@<its revision now>`,
    )
    expect(lines.slice(1).join('\n')).not.toContain('read page again')
    // The same step in the READY of the lead's brief.
    expect(await cli.run(`assignment show a1`)).toContain(`READY\n  read page again: page@v1`)
    const work = await workOf(dbOf(p), p.dir)
    const at = hoursAfter(seenAt, 74) as Time
    const steps = nextSteps(work, 'a1' as AssignmentId, { token: lead, at, cwd: p.dir })
    expect(stepKey(steps).split('\n')[0]).toBe('ReadSource page')
    expect(nextLines(work, steps, { token: lead, at })[0]).toBe(lines[0])
  }, 60000)

  test('the same revision renews it; a new one moves it, and r1 is checked again', async () => {
    const { p, lead, seenAt } = await fromPage()
    const cli = newCli(p.dir, dbOf(p))
    cli.at(hoursAfter(seenAt, 73))
    expect(await cli.run(`source ${lead} page@v1`)).toBe('page is still at v1; seen now.')
    expect(await cli.run(`next ${lead}`)).not.toContain('read page again')
    // Read 73 hours ago again: expired again.
    cli.at(hoursAfter(seenAt, 147))
    expect((await cli.run(`next ${lead}`)).split('\n')[0]).toStartWith('read page again: page@v1')
    expect(await cli.run(`source ${lead} page@v2`)).toBe('page is at v2.')
    const next = await cli.run(`next ${lead}`)
    expect(next).not.toContain('read page again')
    expect(next).toContain('r1 was built on page@v1; page is now at v2')
  }, 60000)

  test('holds for outsideSourceHours of aristoteles.yaml', async () => {
    const { p, lead, seenAt } = await fromPage()
    const cli = newCli(p.dir, dbOf(p))
    cli.at(hoursAfter(seenAt, 1))
    await cli.run(`next ${lead}`)
    const work = await workOf(dbOf(p), p.dir)
    const yaml = await Bun.file(`${p.dir}/aristoteles.yaml`).text()
    p.write('aristoteles.yaml', `${yaml}outsideSourceHours: 24\n`)
    const stepsAt = (hours: number) =>
      nextSteps(work, 'a1' as AssignmentId, {
        token: lead,
        at: hoursAfter(seenAt, hours) as Time,
        cwd: p.dir,
      })
    expect(stepsAt(23).some((s) => s._tag === 'ReadSource')).toBe(false)
    const [first] = stepsAt(25)
    expect(first).toEqual({
      _tag: 'ReadSource',
      source: 'page',
      revision: 'v1',
      seenAt: seenAt as Time,
      hours: 24,
    })
  }, 60000)

  test('a finished assignment, and a tree with no work from the source, get none', async () => {
    const { p, lead, seenAt } = await fromPage()
    const cli = newCli(p.dir, dbOf(p))
    cli.at(hoursAfter(seenAt, 73))
    await cli.run(`next ${lead}`)
    const work = await workOf(dbOf(p), p.dir)
    const at = hoursAfter(seenAt, 80) as Time
    // The writer's own tree holds r1 too, but a low role has no next steps: its assignment is
    // open, so nextSteps would give the step; the finished one gives none.
    const finished = { ...work, assignments: new Map(work.assignments) }
    const a1 = work.assignments.get('a1' as AssignmentId)
    if (a1 === undefined) throw new Error('no a1')
    finished.assignments.set(a1.id, { ...a1, end: { _tag: 'Finished', when: at } })
    expect(
      nextSteps(finished, a1.id, { token: lead, at, cwd: p.dir }).some(
        (s) => s._tag === 'ReadSource',
      ),
    ).toBe(false)
    // No result of the tree names the page: no step, even when it expired.
    const none = { ...work, results: new Map() }
    expect(
      nextSteps(none, a1.id, { token: lead, at, cwd: p.dir }).some((s) => s._tag === 'ReadSource'),
    ).toBe(false)
  }, 60000)
})
