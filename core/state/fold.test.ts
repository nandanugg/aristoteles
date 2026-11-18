// The fold against the old replay (BUILD.md 4.5, package P2): for each scenario store that the CLI
// writes through the harness (a temp dir each, never the real store), fold gives the Work that the
// old replay gave (pinned line by line in fold.pins.txt at the switch, 2026-11-14): the same
// records in the same order of every record map, the same created ids for each event; and
// foldStep event by event gives the same Work as fold.
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import {
  type AgentId,
  type AssignmentId,
  type Author,
  type DirectionId,
  type Draft,
  type Event,
  type EventRef,
  type FlowStep,
  kindOf,
  type OnboardedDirection,
  type Recorded,
  type RevisionId,
  type RoleName,
  type SessionId,
  type Time,
  type Work,
} from '../schema/index.ts'
import { Env, FilesLive, readConfig, Store, StoreLive } from '../services/index.ts'
import { fold, foldStep } from './index.ts'
import { modelOfAssignment } from './records.ts'
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
const { ok, tokenIn, solToken, git, HOST, TASK_WHOLE } = harness

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

// One line for each field of a Work, for each entry of its maps and lists (in the order of the
// map: the CLI lists in it), and for the ids that each event created. The dir reads <dir>, a
// company repo <company>, and each commit or patch id (12 or 40 hex digits) <h1>, <h2>, ... in
// the order that they first stand.
const linesOf = (work: Work, dir: string): ReadonlyArray<string> => {
  const json = (x: unknown) =>
    JSON.stringify(x, (_k, v) => (v instanceof Map ? { '<map>': [...v] } : v))
  const lines: Array<string> = []
  for (const [key, value] of Object.entries(work)) {
    if (key === 'events') {
      for (const l of work.events) lines.push(`created e${l.recorded.seq} ${json(l.created)}`)
    } else if (value instanceof Map) {
      for (const [k, v] of value) lines.push(`${key} ${json(k)} ${json(v)}`)
    } else if (Array.isArray(value)) {
      for (const v of value) lines.push(`${key}[] ${json(v)}`)
    } else lines.push(`${key} ${json(value)}`)
  }
  const labels = new Map<string, string>()
  return lines.map((line) =>
    line
      .replaceAll(dir, '<dir>')
      .replace(/[^"]*\/company-[A-Za-z0-9]{6}/g, '<company>')
      .replace(/\b[0-9a-f]{12}\b|\b[0-9a-f]{40}\b/g, (hex) => {
        if (!labels.has(hex)) labels.set(hex, `<h${labels.size + 1}>`)
        return labels.get(hex) ?? hex
      }),
  )
}
// The lines of the old replay's Work for a scenario: the block under `# <name>` in fold.pins.txt.
// Ruling 2026-11-14 (brief limits leave room for the guide): the pins hold the new harness limits
// (6000, 12000, 16000) and the hashes of the yaml that holds them. Ruling 7, onboarding
// 2026-11-14: each role holds its persistence and its icon (the config, the workflow, the yaml
// text, its hash and the fit hashes), each assignment where it runs (runs), and the page run has
// the agent p1 (its line, its id in created, the agent counter). P10 rejected, onboarding
// 2026-11-14: directions and drafts hold their examples, and the company scenario gives d2 its
// examples in one more event. The last three scenarios are new. Nanda, 2026-11-15: a direction has
// a summary, and a flow with the steps that it governs marked: each draft and each version holds
// both, and the examples are of those steps.
const PINS = `${import.meta.dir}/fold.pins.txt`
const pinnedLines = (name: string): ReadonlyArray<string> => {
  const text = readFileSync(PINS, 'utf8')
  const start = text.indexOf(`# ${name}\n`)
  if (start < 0) throw new Error(`no pin ${name} in ${PINS}`)
  const body = text.slice(start + name.length + 3)
  const end = body.indexOf('\n# ')
  return (end < 0 ? body.trimEnd() : body.slice(0, end)).split('\n')
}

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
// An event that a later wave's command writes (an adjustment, the examples of a draft, the start of
// an agent's terminal), appended as the store appends any checked event.
const NANDA_UI: Author = { _tag: 'Person', name: 'Nanda', channel: 'ui' }
const HOST_RUN: Author = { _tag: 'ModelRun', name: 'host', at: '2026-10-25T08:00:00.000Z' as Time }
const SUPERVISOR: Author = { _tag: 'Supervisor', name: 'Nanda' }
// At the time of the last act of the project, so that no later act of the CLI comes before it.
const appendNow = (p: Project, author: Author, event: Event) =>
  append(p.dir, { at: p.now(), author, event } as Draft)
// The ref of the event that an append stored.
const refOf = (seq: number | null) => `e${seq}` as EventRef

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

// The fold of the store of the dir gives the Work of the old replay.
const sameAsReplay = async (dir: string, name: string): Promise<Work> => {
  const events = await eventsOf(dir)
  const now = fold(events)
  expect(linesOf(now, dir)).toEqual(pinnedLines(name))
  expect(now.events.map((l) => l.recorded)).toEqual([...events])
  // foldStep, one event at a time from the first, is the same fold.
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

const PARTS =
  '- { name: Flags and env, text: Write the feature flag and how the env vars are read., ' +
  'context: { section: design } }\n' +
  '- { name: Handler, text: Write the use case and the request handler., ' +
  'context: { section: introduction } }\n'
const LINT = (where: string) =>
  `--evidence="no-code-proof | ${where} | no paths or hashes there" ` +
  `--evidence="no-ticket-ids | ${where} | no ticket ids there"`
const COSTS =
  'replace:\n  - { id: facts-not-proof, with: { id: facts-not-proof, says: "The body states ' +
  'facts, with what the problem costs.", rules: [ { id: no-code-proof, says: "No file paths ' +
  'with line numbers, no commit hashes in the body", checkedBy: linter } ] } }\n'

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

// A dir with a host run h1 whose top task t1 is open, with the architect a1 as its host.
const hosted = async () => {
  const p = harness.project({ 'top.yaml': `${TASK_WHOLE}role: architect\n` })
  await harness.init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
  ok(await p.run('run start', HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out) // ruling 10.1
  ok(await p.agent(`brief ${host}`))
  return { p, host }
}

describe('fold gives the Work of the old replay', () => {
  test('started: init, the directions, the fits, a task and its lead', async () => {
    const { p } = await harness.started()
    const work = await sameAsReplay(p.dir, 'started')
    // No run holds t1, so the persistent lead attaches to no agent: it keeps its model (P2).
    const a1 = work.assignments.get('a1' as AssignmentId)
    expect(a1?.runs).toEqual({ _tag: 'NoRun', model: 'sonnet' })
  }, 30000)

  test('a relay: forwarded acts that count at once, and confirmed ones', async () => {
    const { p, lead, linter } = await harness.reported()
    ok(await p.agent(`forward ${lead} Nanda comment t1 --quote="keep it short" --channel=chat`))
    ok(await p.agent(`review ${linter} r1 accept ${LINT('the introduction')}`))
    const decide = '--evidence="repeatable | the introduction | a reviewer can repeat it"'
    ok(await p.agent(`review ${lead} r1 accept ${decide}`))
    const reject = `forward ${lead} Nanda reject r1 --point="no need to mention the ticket" ` +
      '--quote="no need to mention the ticket" --channel=chat'
    ok(await p.agent(reject))
    ok(await p.agent(`ask ${lead} --text="May we skip the repeatable rule?" --to=owner`))
    const answer = ok(await p.agent(`forward ${lead} Nanda answer q1 --quote="no, keep it"`)).out
    ok(await p.nanda(`confirm ${answer.match(/^(e\d+):/)?.[1]}`, 'confirm'))
    const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
    ok(await p.agent(`brief ${arch}`))
    p.write('edit.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs. }\n')
    ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
    const accept = `forward ${arch} Nanda accept d2 --evidence="chat | Nanda says yes" ` +
      '--quote="yes, approve it" --channel=chat'
    const id = ok(await p.agent(accept)).out.match(/^(e\d+):/)?.[1]
    ok(await p.nanda(`confirm ${id}`, 'confirm'))
    await sameAsReplay(p.dir, 'relay')
  }, 30000)

  test('a company direction: imports of two commits, accepts, and a suggestion', async () => {
    const company = companyRepo()
    company.commit(FLAGS)
    const { p } = await harness.started()
    const lock =
      `feature-flags:\n  repo: ${company.dir}\n  path: directions/feature-flags\n` +
      '  owner: Nanda\n  checkedBy: linter\n'
    p.write('aristoteles.lock', lock)
    ok(await p.nanda('waiting'))
    // P10 rejected, onboarding 2026-11-14: the company draft of a new direction gets its flow and
    // its examples from a model before the accept (the command comes in a later wave).
    const move = { _tag: 'ExamplesAdded', flow: FLOW }
    const cases = { _tag: 'Revision', id: 'd2', move }
    await appendNow(p, HOST_RUN, cases as Event)
    const seen = '--evidence="the folder | each standard and rule reads as the company says"'
    ok(await p.nanda(`review d2 accept ${seen}`, 'accept'))
    company.commit({
      'directions/feature-flags/naming/upper-snake.md': 'The flag is FF_<P>_<F>, in capitals.\n',
    })
    p.wait(24 * 60)
    ok(await p.nanda('waiting'))
    ok(await p.nanda('review d3 accept --evidence="naming | capitals"', 'accept'))
    ok(await p.nanda('suggest naming --says="name the owner team in the flag"'))
    await sameAsReplay(p.dir, 'company')
  }, 60000)

  test('a run of the page: problems, sessions, terminal events, sends, a remake', async () => {
    const { p, host } = await hosted()
    ok(await p.agent(`assign ${host} t1 --role=section-lead`))
    // The UI starts the lead with a new token (ruling 10.1: in its launch command).
    const lead = tokenIn(ok(await p.ui('session a2 --id=s-lead --token')).out)
    ok(await p.agent(`brief ${lead}`))
    ok(await p.agent(`ask ${lead} --text="Is the retry part of the export?" --to=owner`))
    ok(await p.agent(`answer ${host} q1 --text="no"`))
    ok(await p.agent(`problem ${host} t1 --says="the cluster is down: run make up"`))
    ok(await p.agent(`note ${host} words --on=sp1 --text="The cluster is down. Start it."`))
    ok(await p.ui('problem sp1 --fixed'))
    ok(await p.ui('event a2 --kind=prompt --text="Do you want to proceed?"'))
    ok(await p.agent(`send ${host} a2 --text="1"`))
    ok(await p.agent(`send ${host} a2 --text="2"`))
    ok(await p.ui('event a2 --kind=error --text="connection error" --tries=3'))
    ok(await p.ui('event a2 --kind=stopped'))
    ok(await p.ui('event a2 --kind=resumed'))
    ok(await p.ui('event a2 --kind=closed'))
    const events = await eventsOf(p.dir)
    const sends = events.filter((r) => kindOf(r.event) === 'Send.Sent').map((r) => `e${r.seq}`)
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 25, 12, minute)).toISOString() as Time
    const supervisor = { _tag: 'Supervisor' as const, name: 'Nanda' }
    await append(p.dir, {
      at: at(0),
      author: supervisor,
      event: { _tag: 'Send', id: sends[0] as never, move: { _tag: 'Delivered' } },
    } as Draft)
    await append(p.dir, {
      at: at(1),
      author: supervisor,
      event: {
        _tag: 'Send',
        id: sends[1] as never,
        move: { _tag: 'Dropped', why: { _tag: 'TypingFailed' } },
      },
    } as Draft)
    await append(p.dir, {
      at: at(2),
      author: { _tag: 'Person', name: 'Nanda', channel: 'ui' },
      event: { _tag: 'Run', create: { _tag: 'HostStarted', session: 's-window' as SessionId } },
    } as Draft)
    p.write('costs.yaml', COSTS)
    const give = `assign ${lead} t1 --role=writer --max-attempts=3`
    const writer = tokenIn(ok(await p.agent(give)).out)
    ok(await p.agent(`brief ${writer}`))
    p.write('docs/tsd.md', harness.INTRO_V1)
    ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
    const cost = '--point="the reader cannot see the cost"'
    const reject = ok(await p.agent(`review ${lead} r1 reject ${cost}`))
    const vid = reject.out.match(/^(v\d+): reject/)?.[1]
    p.write('again.yaml', `${TASK_WHOLE.replace('agreed facts.', 'agreed facts, with the cost.')}`)
    const why = '--reason="the text asks for the cost"'
    ok(await p.agent(`direction revise ${host} tsd-writing --file=costs.yaml --answers=${vid}`))
    const hope = '--hope="The readers see first why the work matters."'
    const problem = '--text="The facts say nothing of the cost."'
    ok(await p.agent(`note ${host} words --on=d2 ${problem} ${hope}`))
    ok(await p.agent(`note ${host} words --on=h1 --text="The TSD is whole."`))
    // The remake comes last: it ends the host a1 (C1), so a1 acts before it.
    ok(await p.agent(`task remake ${host} t1 --file=again.yaml ${why}`))
    const second = { env: { ...HOST.env, TMUX_PANE: '%8' } }
    ok(await p.run('run continue h1 --quote="continue the export project"', second))
    ok(await p.run('run start', { env: { ...HOST.env, TMUX_PANE: '%7' } }))
    ok(await p.ui('run close h2'))
    await append(p.dir, {
      at: at(59),
      author: { _tag: 'Person', name: 'Nanda', channel: 'ui' },
      event: { _tag: 'Run', id: 'h3' as never, move: { _tag: 'Done' } },
    } as Draft)
    await sameAsReplay(p.dir, 'page run')
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
    await sameAsReplay(p.dir, 'role words')
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
    ok(await p.nanda('task open --file=task.yaml'))
    ok(await p.nanda('assign t1 --role=section-lead'))
    const work = await sameAsReplay(p.dir, 'onboarded start')
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

  test('persistent agents: one agent of a role in a run, its session, its model kept', async () => {
    const { p, host } = await hosted()
    p.write('parts.yaml', PARTS)
    ok(await p.nanda('task split t1 --file=parts.yaml'))
    ok(await p.agent(`assign ${host} t2 --role=section-lead`))
    ok(await p.agent(`assign ${host} t3 --role=section-lead`))
    // The supervisor starts p1's terminal (a later wave); both of its assignments take it.
    const started = { _tag: 'Agent', id: 'p1', move: { _tag: 'Started', session: 's-lead' } }
    await appendNow(p, SUPERVISOR, started as Event)
    const startedAt = p.now()
    const lead = tokenIn(ok(await p.ui('session a2 --id=s-lead --token')).out)
    ok(await p.ui('session a3 --id=s-lead --token'))
    ok(await p.agent(`brief ${lead}`))
    ok(await p.agent(`assign ${lead} t2 --role=writer`))
    // A new lead role, then another model for section-lead: its agent keeps the model it started
    // with (ruling 13).
    const editor = {
      kind: 'agent',
      model: 'sonnet',
      description: 'Edits one section.',
      intro: 'You edit one section.',
      responsibilities: ['Edit the section under its heading.'],
      acts: [{ approve: ['writer'] }],
      checks: [],
      persistence: { persistent: true, why: 'It edits the sections of the whole project.' },
      icon: 'pen-tool',
    }
    const w0 = fold(await eventsOf(p.dir))
    const kept = { hashes: w0.hashes, texts: w0.texts }
    for (const adjustment of [
      { _tag: 'AddRole', role: 'editor', file: editor },
      { _tag: 'SetModel', role: 'section-lead', model: 'opus' },
    ]) {
      const drafted = { _tag: 'Adjustment', create: { _tag: 'Drafted', adjustment } }
      const seq = await appendNow(p, HOST_RUN, drafted as Event)
      const accepted = { _tag: 'Adjustment', id: refOf(seq), move: { _tag: 'Accepted', ...kept } }
      await appendNow(p, NANDA_UI, accepted as Event)
    }
    const work = await sameAsReplay(p.dir, 'persistent agents')
    const runs = (id: string): unknown => work.assignments.get(id as AssignmentId)?.runs
    expect(runs('a1')).toEqual({ _tag: 'Host', run: 'h1' })
    expect(runs('a2')).toEqual({ _tag: 'Agent', agent: 'p1' })
    expect(runs('a3')).toEqual({ _tag: 'Agent', agent: 'p1' })
    expect(runs('a4')).toEqual({ _tag: 'Subagent', model: 'haiku' })
    expect([...work.agents.keys()]).toEqual(['p1' as AgentId])
    const p1 = work.agents.get('p1' as AgentId)
    expect<unknown>(p1?.terminal).toEqual({ _tag: 'Started', session: 's-lead', at: startedAt })
    expect(p1?.model).toBe('sonnet')
    const role = work.workflow.roles.get('section-lead' as RoleName)
    expect(role?._tag === 'Model' ? role.model : undefined).toBe('opus')
    const a2 = work.assignments.get('a2' as AssignmentId)
    expect(a2 === undefined ? null : modelOfAssignment(work, a2)).toBe('sonnet')
    expect(work.sessions.get('a3' as AssignmentId)?.session).toBe('s-lead' as SessionId)
  }, 60000)

  test('adjustments: each accepted one folds; a rejected and a replaced one change nothing', async () => {
    const { p } = await harness.started()
    const editor = {
      kind: 'agent',
      model: 'sonnet',
      description: 'Edits one section.',
      intro: 'You edit one section.',
      responsibilities: ['Edit the section under its heading.'],
      acts: [{ approve: ['writer'] }],
      checks: [],
      persistence: { persistent: true, why: 'It edits the sections of the whole project.' },
      icon: 'pen-tool',
    }
    const why = 'It writes every section of the project.'
    const w0 = fold(await eventsOf(p.dir))
    const kept = { hashes: w0.hashes, texts: w0.texts }
    const steps: ReadonlyArray<readonly [unknown, 'Accepted' | 'Rejected' | 'None']> = [
      [{ _tag: 'AddRole', role: 'editor', file: editor }, 'Accepted'],
      [{ _tag: 'SetPersistence', role: 'writer', persistence: { persistent: true, why } }, 'Accepted'],
      [{ _tag: 'SetModel', role: 'editor', model: 'haiku' }, 'None'],
      [{ _tag: 'SetModel', role: 'editor', model: 'opus' }, 'Accepted'],
      [{ _tag: 'RemoveRole', role: 'editor' }, 'Rejected'],
      [{ _tag: 'RetireDirection', direction: 'tsd-writing' }, 'Accepted'],
    ]
    for (const [adjustment, decision] of steps) {
      const drafted = { _tag: 'Adjustment', create: { _tag: 'Drafted', adjustment } }
      const seq = await appendNow(p, HOST_RUN, drafted as Event)
      if (decision === 'None') continue
      const move =
        decision === 'Accepted'
          ? { _tag: 'Accepted', ...kept }
          : { _tag: 'Rejected', reason: 'the editor stays for the next project' }
      const decided = { _tag: 'Adjustment', id: refOf(seq), move }
      await appendNow(p, NANDA_UI, decided as Event)
    }
    const work = await sameAsReplay(p.dir, 'adjustments')
    const editorNow = work.config.roles.editor
    expect(editorNow?.kind === 'agent' ? editorNow.model : undefined).toBe('opus')
    expect(work.workflow.roles.get('editor' as RoleName)?._tag).toBe('Model')
    const writer = work.workflow.roles.get('writer' as RoleName)
    expect(writer?._tag === 'Model' ? writer.persistence : undefined).toEqual({
      _tag: 'Persistent',
      why,
    })
  }, 30000)
})
