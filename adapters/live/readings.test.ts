// ReadingsLive on the harness scenario stores: it gives the sets that the old outsideFor gave
// (pinned at the switch, 2026-11-14), the commits on their base, and the settings of the file in
// the dir.
import { describe, expect, test } from 'bun:test'
import { Effect, Layer, Schema } from 'effect'
import {
  type MadeFrom,
  type Result,
  type ResultId,
  type Source,
  Time,
  type Work,
} from '../../core/schema/index.ts'
import { Dir, Env, Readings, StoreLive } from '../../core/services/index.ts'
import { loadWork } from '../../core/state/index.ts'
import { readingsLive, ReadingsLive } from './index.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harness from '../../test/harness.js'

interface Project {
  readonly dir: string
  readonly now: () => string
  readonly write: (path: string, text: string) => void
  readonly agent: (line: string) => Promise<{ code: number; out: string; err: string }>
}
const { started, reported, codeStarted, git } = harness as {
  started: () => Promise<{ p: Project }>
  reported: () => Promise<{ p: Project }>
  codeStarted: () => Promise<{ p: Project; app: string; impl: string }>
  git: (dir: string, ...args: ReadonlyArray<string>) => string
}

const workOf = (dir: string): Promise<Work> => {
  const env = { ARISTOTELES_DB: `${dir}/.work/aristoteles.db` }
  return Effect.runPromise(
    loadWork(dir).pipe(
      Effect.scoped,
      Effect.provide(StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env })))),
      Effect.map((c) => {
        if (c._tag === 'NoStore') throw new Error(`no store in ${dir}`)
        return c.work
      }),
    ),
  )
}

const readOf = (dir: string, work: Work, at: string) =>
  Effect.runPromise(
    Readings.use((r) => r.read(work, Schema.decodeUnknownSync(Time)(at))).pipe(
      Effect.provide(ReadingsLive.pipe(Layer.provide(Layer.succeed(Dir, { cwd: dir })))),
    ),
  )

describe('ReadingsLive', () => {
  test('changed and stale are the sets of the old outsideFor', async () => {
    const { p } = await reported()
    p.write('docs/tsd.md', '# TSD\n\n## Introduction\n\nChanged after the report.\n')
    const work = await workOf(p.dir)
    const now = await readOf(p.dir, work, p.now())
    expect([...now.changed].map(String)).toEqual(['r1'])
    expect([...now.stale]).toEqual([])
    expect(now.terminals).toEqual({})
    expect(now.cwd).toBe(p.dir)
  }, 30000)

  test('a commit counts on its base only after the merge', async () => {
    const { p, app, impl } = await codeStarted()
    git(app, 'checkout', '-q', '-b', 'one', 'main')
    p.write('app/export.js', 'one file a day\n')
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'one')
    const sha = git(app, 'rev-parse', 'HEAD').slice(0, 12)
    git(app, 'checkout', '-q', 'main')
    expect((await p.agent(`report ${impl} --output=app@${sha}`)).code).toBe(0)
    const work = await workOf(p.dir)
    expect((await readOf(p.dir, work, p.now())).onBase.size).toBe(0)
    git(app, 'merge', '-q', '--ff-only', 'one')
    const onBase = (await readOf(p.dir, work, p.now())).onBase
    expect([...onBase].map(String)).toEqual(['r1'])
  }, 30000)

  // One rule, one reader (S14): the readings and report.ts read core/services/outputs.ts, which
  // resolves git once per repo. On each edge case of r1 the readings give the sets that the old
  // outsideFor gave (pinned), and the commits that `git merge-base --is-ancestor` gives.
  test('on each edge case, the sets of the old outsideFor', async () => {
    const { p, app, impl } = await codeStarted()
    const main = git(app, 'rev-parse', 'main')
    git(app, 'checkout', '-q', '-b', 'one', 'main')
    p.write('app/export.js', 'one file a day\n')
    git(app, 'add', '.')
    git(app, 'commit', '-q', '-m', 'one')
    const one = git(app, 'rev-parse', 'HEAD')
    git(app, 'checkout', '-q', 'main')
    expect((await p.agent(`report ${impl} --output=app@${one.slice(0, 12)}`)).code).toBe(0)
    const work = await workOf(p.dir)
    const r1 = 'r1' as ResultId
    interface Edit {
      readonly output?: string
      readonly digest?: string
      readonly madeFrom?: ReadonlyArray<{ _tag: string; name: string; [k: string]: string }>
      readonly sources?: ReadonlyArray<{ _tag: string; name: string; [k: string]: string }>
      readonly base?: string
    }
    const edited = (e: Edit): Work => {
      const r = work.results.get(r1) as Result
      const result = {
        ...r,
        output: (e.output ?? r.output) as Result['output'],
        work: { ...r.work, digest: (e.digest ?? r.work.digest) as Result['work']['digest'] },
        madeFrom: (e.madeFrom ?? r.madeFrom) as ReadonlyArray<MadeFrom>,
      }
      const sources = (e.sources ?? []) as ReadonlyArray<Source>
      const based = [...work.tasks].map(([id, t]) => {
        const workspace = t.descriptionAi.workspace.map((x) =>
          x._tag === 'Repo' && e.base !== undefined ? { ...x, base: e.base as typeof x.base } : x,
        )
        return [id, { ...t, descriptionAi: { ...t.descriptionAi, workspace } }] as const
      })
      return {
        ...work,
        results: new Map([...work.results, [r1, result]]),
        sources: e.sources ? new Map(sources.map((s) => [s.name, s])) : work.sources,
        tasks: new Map(based),
      }
    }
    const fromMain = { madeFrom: [{ _tag: 'Git', name: 'app', commit: main.slice(0, 12) }] }
    const appAt = (commit: string) => ({
      ...fromMain,
      sources: [{ _tag: 'Git', name: 'app', commit }],
    })
    const fromDoc = { madeFrom: [{ _tag: 'Outside', name: 'doc', revision: 'v1' }] }
    const docAt = (revision: string) => ({
      ...fromDoc,
      sources: [{ _tag: 'Outside', name: 'doc', revision }],
    })
    const was = main.slice(0, 12)
    const moved = (source: string, from: string, to: string) => [
      [r1, { source, was: from, now: to }],
    ]
    // name, edit of r1, then the changed results and the stale sources
    const cases: ReadonlyArray<readonly [string, Edit, ReadonlyArray<string>, unknown]> = [
      ['a source at the same commit, by its full sha', appAt(main), [], []],
      ['a source that moved', appAt(one.slice(0, 12)), [], moved('app', was, one.slice(0, 12))],
      [
        'a source at a commit that git does not know',
        appAt('deadbeef1234'),
        [],
        moved('app', was, 'deadbeef1234'),
      ],
      ['a source unknown to git, the old a prefix', appAt(`${was}ff`), [], []],
      ['an outside source that moved', docAt('v2'), [], moved('doc', 'v1', 'v2')],
      ['an outside source, one revision a prefix', docAt('v1.0'), [], []],
      ['a commit output that git does not know', { output: 'app@0000000aaaaa' }, [r1], []],
      ['a commit output with another digest', { digest: 'x' }, [r1], []],
      ['an unsafe output', { output: '../evil@abc1234' }, [r1], []],
      ['a file output with no file', { output: 'docs/none.md' }, [r1], []],
    ]
    for (const [name, edit, changed, stale] of cases) {
      const now = await readOf(p.dir, edited(edit), p.now())
      expect<unknown>({ name, changed: [...now.changed], stale: [...now.stale] }).toEqual({
        name,
        changed,
        stale,
      })
    }
    const onBase = async (base: string) =>
      [...(await readOf(p.dir, edited({ base }), p.now())).onBase].map(String)
    expect(await onBase('nobranch')).toEqual([])
    expect(await onBase('main')).toEqual([])
    expect(await onBase(one)).toEqual(['r1'])
  }, 30000)

  test('the settings come from aristoteles.yaml, else the defaults', async () => {
    const { p } = await started()
    const work = await workOf(p.dir)
    expect((await readOf(p.dir, work, p.now())).settings).toEqual({
      hostWaitMinutes: 10,
      retryMinutes: 5,
      outsideSourceHours: 72,
    })
    const yaml = await Bun.file(`${p.dir}/aristoteles.yaml`).text()
    const tuned = 'hostWaitMinutes: 3\nretryMinutes: 2\noutsideSourceHours: 9\n'
    p.write('aristoteles.yaml', tuned + yaml)
    expect((await readOf(p.dir, work, p.now())).settings).toEqual({
      hostWaitMinutes: 3,
      retryMinutes: 2,
      outsideSourceHours: 9,
    })
  }, 30000)

  // The measure of a brief is the adapters' (adapters/words withBriefMeasure): 0 here.
  test('the caller gives the terminals', async () => {
    const { p } = await started()
    const work = await workOf(p.dir)
    const terminal = { live: true, ended: false, exit: null, lastOutput: 5 }
    const layer = readingsLive({ terminals: () => ({ s1: terminal }) }).pipe(
      Layer.provide(Layer.succeed(Dir, { cwd: p.dir })),
    )
    const at = Schema.decodeUnknownSync(Time)(p.now())
    const outside = await Effect.runPromise(
      Readings.use((r) => r.read(work, at)).pipe(Effect.provide(layer)),
    )
    expect(outside.measure(work, 'a1' as never)).toBe(0)
    expect(outside.terminals).toEqual({ s1: terminal })
  }, 30000)
})
