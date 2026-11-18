// The fold of the scenario stores that the CLI writes through the harness (a temp dir each, never
// the real store): each event is in the Work with the ids that it created, and foldStep event by
// event gives the same Work as fold.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import {
  type Author,
  type DirectionId,
  type Draft,
  type Event,
  type FlowStep,
  type OnboardedDirection,
  type Recorded,
  type RevisionId,
  type Time,
  type Work,
} from '../schema/index.ts'
import { Env, FilesLive, readConfig, Store, StoreLive } from '../services/index.ts'
import { fold, foldStep } from './index.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harnessJs from '../../test/harness.js'

// --- the harness (the CLI, temp dirs) ------------------------------------------------------------

interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}
interface Project {
  readonly dir: string
  readonly nanda: (line: string, typed?: string) => Promise<Ran>
  readonly agent: (line: string) => Promise<Ran>
  readonly ui: (line: string, typed?: string) => Promise<Ran>
  readonly run: (line: string, options: { readonly env: Record<string, string> }) => Promise<Ran>
  readonly write: (path: string, text: string) => void
  readonly wait: (minutes: number) => void
  readonly now: () => string
}
const harness = harnessJs as {
  readonly project: (files?: Record<string, string>, name?: string) => Project
  readonly init: (p: Project) => Promise<void>
  readonly started: (files?: Record<string, string>) => Promise<{ p: Project; lead: string }>
  readonly reported: () => Promise<{ p: Project; lead: string; writer: string; linter: string }>
  readonly codeStarted: () => Promise<{ p: Project; app: string; lead: string; impl: string }>
  readonly ok: (r: Ran) => Ran
  readonly tokenIn: (text: string) => string
  readonly solToken: (p: Project, opened: string, run?: string, where?: object) => Promise<string>
  readonly git: (dir: string, ...args: ReadonlyArray<string>) => string
  readonly HOST: { readonly env: Record<string, string> }
  readonly INTRO_V1: string
  readonly INTRO_V2: string
  readonly TASK_WHOLE: string
  readonly WORK_YAML: string
  readonly DIRECTION: string
}
const { ok, git } = harness

// --- the store of a scenario ---------------------------------------------------------------------

const dbOf = (dir: string) => join(dir, '.work', 'aristoteles.db')
const storeOf = (dir: string) =>
  StoreLive.pipe(
    Layer.provide(Layer.succeed(Env, { vars: { ARISTOTELES_DB: dbOf(dir) } })),
  )
const eventsOf = (dir: string): Promise<ReadonlyArray<Recorded>> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* (yield* Store).open(dir, { create: false })
        return yield* opened.events
      }),
    ).pipe(Effect.provide(storeOf(dir))),
  )
// An event that only the long process writes (the supervisor's fate of a send, a run that the
// page starts), appended as the store appends any checked event.
const append = (dir: string, draft: Draft): Promise<number | null> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* (yield* Store).open(dir, { create: false })
        return yield* opened.write(() => Effect.succeed({ draft, rows: [] }))
      }),
    ).pipe(Effect.provide(storeOf(dir))),
  )

// The store start of onboarding (Question 20, option A): the first event holds the config of the
// file and the accepted directions. The CLI writes it in a later wave; this writes it as the
// start would.
const startStore = (dir: string, directions: ReadonlyArray<OnboardedDirection>, at: Time) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const read = yield* readConfig(dir)
        const opened = yield* (yield* Store).open(dir, { create: true })
        const event: Event = { _tag: 'Workflow', create: { _tag: 'Defined', ...read, directions } }
        const author: Author = { _tag: 'Person', name: 'Nanda', channel: 'ui' }
        return yield* opened.write(() => Effect.succeed({ draft: { at, author, event }, rows: [] }))
      }),
    ).pipe(Effect.provide(Layer.merge(storeOf(dir), FilesLive))),
  )
// An event that a later wave's command writes (the examples of a draft), appended as the store
// appends any checked event, at the time of the last act of the project.
const HOST_RUN: Author = { _tag: 'ModelRun', name: 'host', at: '2026-10-25T08:00:00.000Z' as Time }
const appendNow = (p: Project, author: Author, event: Event) =>
  append(p.dir, { at: p.now(), author, event } as Draft)

// A direction file as readDirection keeps it: each rule has its supersedes.
const withSupersedes = (standards: unknown) =>
  (standards as ReadonlyArray<{ readonly rules: ReadonlyArray<object> }>).map((x) => ({
    ...x,
    rules: x.rules.map((r) => ({ ...r, supersedes: [] })),
  }))
// The flow of the harness direction, the examples inside its marked steps (P10 rejected,
// onboarding 2026-11-14; Nanda, 2026-11-15), for the other directions of these scenarios.
const { flow: FLOW } = Bun.YAML.parse(harness.DIRECTION) as {
  readonly flow: ReadonlyArray<FlowStep>
}

// The fold of the store of the dir: every event is in the Work, and foldStep, one event at a time
// from the first, is the same fold.
const foldsAlike = async (dir: string): Promise<Work> => {
  const events = await eventsOf(dir)
  const now = fold(events)
  expect(now.events.map((l) => l.recorded)).toEqual([...events])
  const [first, ...rest] = events
  if (first === undefined) throw new Error('a scenario store has events')
  let stepped = fold([first])
  for (const r of rest) {
    const next = foldStep(stepped, r)
    expect(next.created).toEqual(now.events.find((l) => l.recorded.seq === r.seq)?.created ?? [])
    stepped = next.work
  }
  expect(stepped).toStrictEqual(now)
  return now
}

// --- the scenarios -------------------------------------------------------------------------------

// A company repo with the direction feature-flags in directions/feature-flags.
const companyRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'company-'))
  git(dir, 'init', '-q', '-b', 'main')
  return {
    dir,
    commit(files: Record<string, string>) {
      for (const [path, text] of Object.entries(files)) {
        const full = join(dir, path)
        Bun.spawnSync(['mkdir', '-p', full.slice(0, full.lastIndexOf('/'))])
        writeFileSync(full, text)
      }
      git(dir, 'add', '-A')
      git(dir, 'commit', '-q', '-m', 'change')
      return git(dir, 'rev-parse', 'HEAD')
    },
  }
}
const FLAGS = {
  'directions/feature-flags/direction.md': '# Feature flags\n\nEach critical change is flagged.\n',
  'directions/feature-flags/naming/standard.md': 'The flag name tells the project.\n',
  'directions/feature-flags/naming/upper-snake.md': 'The flag is FF_<PROJECT>_<FEATURE>.\n',
  'directions/feature-flags/removable/standard.md': 'The flag is read in one place.\n',
  'directions/feature-flags/removable/one-read.md': 'Each flag is read in one if.\n',
}

describe('fold gives the Work of a store', () => {
  test('started: init, the directions and the fits', async () => {
    const { p } = await harness.started()
    const work = await foldsAlike(p.dir)
    expect([...work.directions.keys()]).toEqual(['tsd-writing' as DirectionId])
    expect(work.directions.get('tsd-writing' as DirectionId)?._tag).toBe('Official')
  }, 30000)

  test('a company direction: imports of two commits, accepts, and a suggestion', async () => {
    const company = companyRepo()
    company.commit(FLAGS)
    const { p } = await harness.started()
    const lock =
      `feature-flags:\n  repo: ${company.dir}\n  path: directions/feature-flags\n` +
      '  owner: Nanda\n  checkedBy: linter\n'
    p.write('aristoteles.lock', lock)
    ok(await p.nanda('log'))
    // P10 rejected, onboarding 2026-11-14: the company draft of a new direction gets its flow and
    // its examples from a model before the accept (the command comes in a later wave).
    const move = { _tag: 'ExamplesAdded', flow: FLOW }
    const cases = { _tag: 'Revision', id: 'd2', move }
    await appendNow(p, HOST_RUN, cases as Event)
    ok(await p.nanda('direction accept d2', 'accept'))
    company.commit({
      'directions/feature-flags/naming/upper-snake.md': 'The flag is FF_<P>_<F>, in capitals.\n',
    })
    p.wait(24 * 60)
    ok(await p.nanda('log'))
    ok(await p.nanda('direction accept d3', 'accept'))
    ok(await p.nanda('suggest naming --says="name the owner team in the flag"'))
    await foldsAlike(p.dir)
  }, 60000)

  test('the role words change; the store keeps the new words', async () => {
    const { p } = await harness.started()
    const yaml = harness.WORK_YAML.replace(
      'Writes one TSD section from its brief.',
      'Writes one TSD section from its brief, in plain words.',
    )
    p.write('aristoteles.yaml', yaml)
    ok(await p.nanda('config apply', 'apply'))
    ok(await p.nanda('role fit writer --answers=fit.yaml'))
    await foldsAlike(p.dir)
  }, 30000)

  test('onboarded start: the first event holds two directions, each at version 1', async () => {
    const p = harness.project()
    const tsd = Bun.YAML.parse(harness.DIRECTION) as Record<string, unknown>
    const { examples: _, ...file } = tsd
    const flags = {
      id: 'feature-flags',
      name: 'Feature flags',
      owner: 'Nanda',
      from: ['Oikos'],
      // Nanda, 2026-11-15: a direction has a summary.
      summary: 'A critical change is flagged, so it can be turned off.',
      says: 'Each critical change is flagged.',
      standards: [
        {
          id: 'naming',
          says: 'The flag name tells the project.',
          rules: [{ id: 'upper-snake', says: 'The flag is FF_<PROJECT>_<FEATURE>.', supersedes: [] }],
        },
      ],
    }
    const external = {
      _tag: 'External',
      repo: 'company-repo',
      path: 'directions/feature-flags',
      ref: { _tag: 'DefaultBranch' },
      commit: 'c'.repeat(40),
    }
    const directions = [
      { direction: { ...file, standards: withSupersedes(file.standards) }, source: { _tag: 'Local' } },
      { direction: { ...flags, flow: FLOW }, source: external },
    ] as unknown as ReadonlyArray<OnboardedDirection>
    await startStore(p.dir, directions, p.now() as Time)
    for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
      ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    }
    const work = await foldsAlike(p.dir)
    expect<unknown>(work.events[0]?.created).toEqual(['d1', 'tsd-writing@1', 'd2', 'feature-flags@1'])
    for (const [id, source] of [
      ['tsd-writing', { _tag: 'Local' }],
      ['feature-flags', { _tag: 'External', repo: external.repo, path: external.path }],
    ] as const) {
      const d = work.directions.get(id as DirectionId)
      if (d?._tag !== 'Official') throw new Error(`${id} is not official`)
      expect(d.versions.map((v) => v.number)).toEqual([1] as never)
      // The examples came with the flow of each version.
      expect(d.versions[0].flow.flatMap((s) => s.examples ?? [])).toHaveLength(4)
      expect(d.source).toEqual(source)
      const draft = work.drafts.get(d.versions[0].revision as RevisionId)
      expect<unknown>(draft?.origin).toEqual({ _tag: 'Onboarded', event: 'e1' })
    }
  }, 30000)
})
