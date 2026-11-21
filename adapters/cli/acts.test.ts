// The commands of the work model through the CLI, on a temp dir: the person opens the top, the host
// sends a task, the role assigns a maker, the maker reports (a test rule catches a file, then the
// fixed file), the role reviews (fail, then pass), the host returns the top, the person ends.
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Effect, Layer } from 'effect'
import { dispatchAct } from '../../core/actions/work.ts'
import { eventsOf, h, NANDA } from '../../core/actions/fixture.test.ts'
import type { Time } from '../../core/schema/index.ts'
import { Dir, Env, Now, StoreLive, Tokens } from '../../core/services/index.ts'
import { foldWork } from '../../core/state/c16/fold.ts'

const PIPED = h.WORK_YAML.replace('    icon: compass', '    pipeline: true\n    icon: compass')
const DIRECTION = h.DIRECTION.replace(
  '{ id: no-ticket-ids, ',
  "{ id: no-ticket-ids, test: 'grep -n TCK-', ",
)

const tokens = (out: string): Record<string, string> =>
  Object.fromEntries([...out.matchAll(/^ {2}(\S+): (w\.\S+)$/gm)].map((m) => [m[1], m[2]]))
const made = (out: string): string => out.match(/^ {2}maker:\S+: (w\.\S+)$/m)?.[1] ?? ''

const opened = async () => {
  const { p } = await h.initiated({
    'aristoteles.yaml': PIPED,
    'directions/tsd-writing.yaml': DIRECTION,
  })
  const top = h.ok(
    await p.nanda('top open --name=TSD --goal="Write the TSD" --sections=introduction'),
  )
  const t = tokens(top.out)
  const seq = () => foldWork(eventsOf(p.dir))?.state.seq ?? -1
  return { p, t, seq, top }
}

describe('the acts of the work model, by the CLI', () => {
  test('a whole run: send, assign, brief, report (caught, fixed), review, end', async () => {
    const { p, t, seq, top } = await opened()
    expect(top.out).toContain('Top "TSD" opened')
    expect(Object.keys(t)).toEqual(['host', 'pipe', 'role:section-lead'])

    const send = h.ok(
      await p.agent(
        `send ${t.host} --name=Intro --goal="Write the introduction" --sections=introduction ` +
          '--role=section-lead',
      ),
    )
    expect(send.out).toContain('Open taken')
    expect(send.out).toContain(`work wait ${t.host} again`)

    const lead = t['role:section-lead'] ?? ''
    const assigned = h.ok(await p.agent(`assign ${lead} t1`))
    const maker = made(assigned.out)
    expect(maker).toMatch(/^w\.maker:m1\.0\./)

    const brief = h.ok(await p.agent(`brief ${maker}`))
    expect(brief.out).toContain('Task t1: Intro')
    expect(brief.out).toContain('Goal: Write the introduction')
    expect(brief.out).toMatch(/work report <token> [0-9.]+ --output=/)

    const state = () => foldWork(eventsOf(p.dir))?.state
    const occurrence = (kind: 'Execute' | 'Check') => [...(state()?.asks.values() ?? [])]
      .find((ask) => ask.kind === kind && (kind !== 'Execute' || ask.to._tag === 'Maker'))!.id
    const firstExecute = occurrence('Execute')
    // A basis is needed: a report with no --on is refused, with words that say to copy it.
    p.write('docs/tsd.md', 'TCK-12 the export ran twice\n')
    const bare = await p.agent(`report ${maker} ${firstExecute} --output="intro" --files=docs/tsd.md`)
    expect(bare.code).toBe(1)
    expect(bare.err).toContain('needs the basis')
    const missing = await p.agent(`report ${maker} ${firstExecute} --output=x --files=nope.md --on ${seq()}`)
    expect(missing.err).toContain('nope.md is not a file of the project')

    const stale = seq()
    const first = h.ok(
      await p.agent(`report ${maker} ${firstExecute} --output="intro" --files=docs/tsd.md --on ${stale}`),
    )
    expect(first.out.split('\n')[0]).toMatch(/^Report taken \(event e\d+\)\.$/)
    // The same command is the same act: the first outcome, said to be taken already.
    const again = h.ok(
      await p.agent(`report ${maker} ${firstExecute} --output="intro" --files=docs/tsd.md --on ${stale}`),
    )
    expect(again.out.split('\n')[0]).toBe(
      first.out.split('\n')[0]?.replace('taken (event', 'was taken already (event').replace(
        /\.$/,
        '; nothing changed.',
      ),
    )
    expect(state()?.tasks.get('t1')?.caught.size).toBe(1)

    // The test rule caught the file: a pass is refused, a fail goes back to the same maker.
    const pass = await p.agent(`review ${lead} ${occurrence('Check')} pass --on ${seq()}`)
    expect(pass.code).toBe(1)
    expect(pass.err).toContain('the act is not allowed')
    h.ok(
      await p.agent(`review ${lead} ${occurrence('Check')} fail --points="drop the ticket id" --on ${seq()}`),
    )
    expect(state()?.tasks.get('t1')?.state).toBe('Working')
    expect(state()?.makers.get('m1')?.revisions).toBe(1)
    // The report that was built on the old state moved: refused as its basis.
    const old = await p.agent(`report ${maker} ${occurrence('Execute')} --output="again" --files=docs/tsd.md --on ${stale}`)
    expect(old.err).toContain('built on an older view')

    p.write('docs/tsd.md', 'The export ran twice for one merchant.\n')
    h.ok(await p.agent(`report ${maker} ${occurrence('Execute')} --output="intro v2" --files=docs/tsd.md --on ${seq()}`))
    expect(state()?.tasks.get('t1')?.caught.size).toBe(0)
    h.ok(await p.agent(`review ${lead} ${occurrence('Check')} pass --on ${seq()}`))
    expect(state()?.tasks.get('t1')?.state).toBe('Done')

    // The host returns the top, the person ends the project.
    expect((await p.nanda('end')).err).toContain('the act is not allowed')
    h.ok(await p.agent(`top-done ${t.host}`))
    const end = h.ok(await p.nanda('end'))
    expect(end.out).toContain('EndProject taken')
    expect(state()?.top.ended).toBe(true)
  }, 120000)

  test('an old epoch token is refused, and a new token comes with resume', async () => {
    const { p, t } = await opened()
    h.ok(
      await p.agent(
        `send ${t.host} --name=Intro --goal=g --sections=introduction --role=section-lead`,
      ),
    )
    const lead = t['role:section-lead'] ?? ''
    const first = made(h.ok(await p.agent(`assign ${lead} t1`)).out)

    // The harness records that the maker is down (it has no command of its own yet).
    let n = 0
    const layer = Layer.mergeAll(
      StoreLive.pipe(
        Layer.provide(
          Layer.succeed(Env, { vars: { ARISTOTELES_DB: join(p.dir, '.work', 'aristoteles.db') } }),
        ),
      ),
      Layer.succeed(Dir, { cwd: p.dir }),
      Layer.succeed(Now, { read: Effect.succeed(p.now() as Time) }),
      Layer.succeed(Tokens, { random: Effect.sync(() => `z${++n}`) }),
    )
    await Effect.runPromise(
      Effect.scoped(
        dispatchAct({
          by: NANDA,
          act: {
            id: 'down', who: { _tag: 'Harness' }, ep: 0,
            body: { _tag: 'Exit', actor: { _tag: 'Maker', id: 'm1' } },
          },
          on: null,
          build: null,
          current: 'b',
        }),
      ).pipe(Effect.provide(layer)),
    )
    const resumed = h.ok(await p.agent(`resume ${lead} m1`))
    const second = made(resumed.out)
    expect(second).toMatch(/^w\.maker:m1\.1\./)
    const refused = await p.agent(`brief ${first}`)
    expect(refused.code).toBe(1)
    expect(refused.err).toContain('this process was replaced')
    expect(h.ok(await p.agent(`brief ${second}`)).out).toContain('Task t1: Intro')
  }, 120000)

  test('question occurrences let the person answer and the maker hear', async () => {
    const { p, t, seq } = await opened()
    h.ok(
      await p.agent(
        `send ${t.host} --name=Intro --goal=g --sections=introduction --role=section-lead`,
      ),
    )
    const maker = made(h.ok(await p.agent(`assign ${t['role:section-lead'] ?? ''} t1`)).out)
    const state = () => foldWork(eventsOf(p.dir))?.state
    const question = () => [...(state()?.asks.values() ?? [])].find((a) => a.kind === 'Question')
    const bare = await p.agent(`ask ${maker}`)
    expect(bare.code).toBe(2)
    expect(bare.err).toContain('Ask needs --text')
    const none = await p.nanda(`answer ${question()?.id ?? 'missing'} --text="the second"`)
    expect(none.code).toBe(1)
    expect(question()).toBeUndefined()

    const ask = `ask ${maker} human --text="which section first?"`
    const asked = h.ok(await p.agent(ask))
    expect(asked.out).toContain('Open taken')
    expect(asked.out).toContain(`work wait ${maker} again`)
    expect(question()).toBeDefined()
    expect(h.ok(await p.agent(ask)).out).toContain('was taken already')

    expect((await p.agent(`answer ${maker} ${question()?.id ?? 'missing'} --text=x`)).code).toBe(1)
    const missing = await p.nanda(`answer ${question()?.id ?? 'missing'}`)
    expect(missing.err).toContain('work answer needs --text=')
    const answered = h.ok(await p.nanda(`answer ${question()?.id ?? 'missing'} --text="the second"`))
    expect(answered.out).toContain('AnswerQuestion taken')
    expect(question()).toBeUndefined()
    const heard = question()?.id ?? [...(state()?.answered.keys() ?? [])][0]
    h.ok(await p.agent(`hear ${maker} ${heard}`))
    const before = seq()
    expect((await p.nanda(`answer ${question()?.id ?? 'missing'} --text="again"`)).code).toBe(1)
    expect(seq()).toBe(before)
    expect(h.ok(await p.agent(ask)).out).toContain('Open taken')
    expect(question()?.id).not.toBe(heard)
  }, 120000)
})
