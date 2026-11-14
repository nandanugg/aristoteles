// The test support of core/derived (no tests here): the scenario stores of the integrated
// harness, the one adapter from a store to a Moment (the fold, and the readings of the rule of an
// output), and the answers that the old engine gave on those stores (pinned at the switch).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Effect, Layer } from 'effect'
import type { Time, Work } from '../schema/index.ts'
import type { Outside } from '../schema/outside.ts'
import {
  Env,
  FilesLive,
  outputsOf,
  readSettings,
  readSettingsOf,
  SpawnLive,
  Store,
  StoreLive,
} from '../services/index.ts'
import { fold, type Moment } from '../state/index.ts'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import * as harness from '../../test/harness.js'

export interface Ran {
  readonly code: number
  readonly out: string
  readonly err: string
}
type Run = (line: string, typed?: string) => Promise<Ran>
export interface Project {
  readonly dir: string
  readonly nanda: Run
  readonly agent: Run
  readonly ui: Run
  readonly run: (line: string, options?: object) => Promise<Ran>
  readonly write: (path: string, text: string) => void
  readonly now: () => string
}
interface Harness {
  readonly ok: (r: Ran) => Ran
  readonly tokenIn: (text: string) => string
  readonly solToken: (p: Project, opened: string, run?: string, where?: object) => Promise<string>
  readonly init: (p: Project) => Promise<void>
  readonly project: (files?: Record<string, string>) => Project
  readonly started: () => Promise<{ readonly p: Project; readonly lead: string }>
  readonly reported: () => Promise<{
    readonly p: Project
    readonly lead: string
    readonly writer: string
    readonly linter: string
  }>
  readonly codeStarted: () => Promise<{ readonly p: Project; readonly lead: string }>
  readonly HOST: object
  readonly INTRO_V2: string
  readonly TASK_WHOLE: string
}
const h = harness as unknown as Harness
export const { ok, tokenIn, solToken } = h

// --- the Moment of a store -----------------------------------------------------------------------

// The Work of a dir: the fold of its store.
export const workOf = (dir: string): Work => {
  const env = { ARISTOTELES_DB: join(dir, '.work', 'aristoteles.db') }
  return Effect.runSync(
    Effect.gen(function* () {
      const store = yield* Store
      const opened = yield* store.open(dir, { create: false })
      return fold(yield* opened.events)
    }).pipe(
      Effect.scoped,
      Effect.provide(StoreLive.pipe(Layer.provide(Layer.succeed(Env, { vars: env })))),
    ),
  )
}

// The readings of the outside, as the live readings make them, with no terminals.
export const outsideNow = (work: Work, dir: string): Outside => {
  const live = Layer.mergeAll(FilesLive, SpawnLive)
  const { changed, stale, onBase } = Effect.runSync(
    outputsOf(work, dir).pipe(Effect.provide(live)),
  )
  const settings = Effect.runSync(
    readSettings(dir).pipe(
      Effect.catch(() => Effect.succeed(readSettingsOf({}))),
      Effect.provide(FilesLive),
    ),
  )
  return {
    cwd: dir,
    settings: {
      hostWaitMinutes: settings.hostWaitMinutes,
      retryMinutes: settings.retryMinutes,
      outsideSourceHours: settings.outsideSourceHours,
    },
    changed,
    stale,
    onBase,
    terminals: {},
    measure: () => 0,
  }
}

export const momentOf = (dir: string, at: Time): Moment => {
  const work = workOf(dir)
  return { work, at, outside: outsideNow(work, dir) }
}

// --- the answers of the old engine ---------------------------------------------------------------

// What the old readers of src/ answered on each scenario store, written once into <test>.pins.json
// before the switch removed them (2026-11-14), and read where a test called the old code: by the
// scenario, then a key that names the old function and its ids. A text names the dir as <dir>.
export const pinned = (file: string) => {
  const table = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, unknown>>
  return <A = unknown>(s: Scenario, key: string): A => {
    const value = table[s.name]?.[key]
    if (value === undefined) throw new Error(`no pin "${s.name} ${key}" in ${file}`)
    return JSON.parse(JSON.stringify(value).replaceAll('<dir>', s.p.dir)) as A
  }
}

// --- the scenarios -------------------------------------------------------------------------------

export interface Scenario {
  readonly name: string
  readonly p: Project
  readonly at: Time
}
const scenario = (name: string, p: Project): Scenario => ({ name, p, at: p.now() as Time })

// t1 and a section lead a1 that read its brief.
const started = async (): Promise<Scenario> => scenario('started', (await h.started()).p)

// ... a writer a2 reported r1, and a linter a3 read its brief.
const reported = async (): Promise<Scenario> => scenario('reported', (await h.reported()).p)

// ... the linter rejects r1 with a rule, and the writer reports r2: r1 is superseded (S5).
const rejectedOnce = async (): Promise<Scenario> => {
  const { p, writer, linter } = await h.reported()
  ok(
    await p.agent(
      `review ${linter} r1 reject --point="ABC-2964 is a ticket id" --breaks=no-ticket-ids`,
    ),
  )
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', h.INTRO_V2.replace('twice', 'two times'))
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
  return scenario('rejectedOnce', p)
}

// ... the linter and then the lead accept r1: t1 is Accepted, and its assignments are Settled (I2).
const accepted = async (): Promise<Scenario> => {
  const { p, lead, linter } = await h.reported()
  const at = 'docs/tsd.md#introduction'
  const checks =
    `--evidence="no-code-proof | ${at} | the body names no file path and no commit" ` +
    `--evidence="no-ticket-ids | ${at} | the body names no ticket id and no chat thread"`
  ok(await p.agent(`review ${linter} r1 accept ${checks}`))
  const repeat = `--evidence="repeatable | ${at} | a reviewer can repeat the double export"`
  ok(await p.agent(`review ${lead} r1 accept ${repeat}`))
  return scenario('accepted', p)
}

// ... the lead escalates r1 to the person (an escalation that waits: EscalationState Open).
const escalated = async (): Promise<Scenario> => {
  const { p, lead } = await h.reported()
  ok(await p.agent(`escalate ${lead} --result=r1 --reason="the rules do not say how long it is"`))
  return scenario('escalated', p)
}

// A code project: a lead a1 and an implementer a2 that read their briefs.
const code = async (): Promise<Scenario> => scenario('codeStarted', (await h.codeStarted()).p)

// An architect a2 drafts d2, and forwards Nanda's accept of it (e.. waits for her confirm).
const relay = async (decided: boolean): Promise<Scenario> => {
  const { p } = await h.started()
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  p.write('edit.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs. }\n')
  ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
  ok(
    await p.agent(
      `forward ${arch} Nanda accept d2 --evidence="chat | Nanda says yes" ` +
        '--quote="yes, approve it" --channel=chat',
    ),
  )
  // C6: the person accepts it at a terminal; the relayed accept waits for nothing now.
  if (decided) ok(await p.nanda('review d2 accept', 'accept'))
  return scenario(decided ? 'relayDecided' : 'relay', p)
}

// The architect a2 drafts d2, and Nanda, its decider, rejects it: d2 is Vetoed.
const vetoed = async (): Promise<Scenario> => {
  const { p } = await h.started()
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  p.write('edit.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs. }\n')
  ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
  ok(await p.nanda('review d2 reject --reason="the cost is in the facts already"', 'reject'))
  return scenario('vetoed', p)
}

// A host run h1 on t1 (the architect a1), a lead a2 with a terminal and a send of the host to it,
// a writer a3 whose r1 the lead rejects with a point that names no rule, a problem of the host on
// t1, and a question of the lead. remade: the host remakes t1 as t2
// (C1, C2, C3: the agents, the problem and the placement of t1's items follow the end of t1).
const uiRun = async (remade: boolean): Promise<Scenario> => {
  const top = `${h.TASK_WHOLE}role: architect\n`
  const again = top.replace('agreed facts.', 'agreed facts, with their cost.')
  const p = h.project({ 'top.yaml': top, 'again.yaml': again })
  await h.init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
  ok(await p.run('run start', h.HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out) // ruling 10.1
  ok(await p.agent(`brief ${host}`))
  ok(await p.agent(`assign ${host} t1 --role=section-lead`))
  // The UI gives the lead its terminal with a new token (ruling 10.1: in its launch command), and
  // the host types into it (a send that waits: C5).
  const lead = tokenIn(ok(await p.ui('session a2 --id=s-a2 --token')).out)
  ok(await p.agent(`brief ${lead}`))
  ok(await p.agent(`send ${host} a2 --text="go on with the writer"`))
  const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=3`)).out)
  ok(await p.agent(`brief ${writer}`))
  p.write('docs/tsd.md', h.INTRO_V2)
  ok(await p.agent(`report ${writer} --output=docs/tsd.md#introduction`))
  ok(await p.agent(`review ${lead} r1 reject --point="the reader cannot see the cost"`))
  ok(await p.agent(`problem ${host} t1 --says="the lint server is down; start it again"`))
  ok(await p.agent(`ask ${lead} --text="is the cost in the facts?"`))
  if (remade) {
    const reason = '--reason="the text asks for the cost"'
    ok(await p.agent(`task remake ${host} t1 --file=again.yaml ${reason}`))
  }
  return scenario(remade ? 'uiRunRemade' : 'uiRun', p)
}

export const SCENARIOS: ReadonlyArray<readonly [string, () => Promise<Scenario>]> = [
  ['started', started],
  ['reported', reported],
  ['rejectedOnce', rejectedOnce],
  ['accepted', accepted],
  ['escalated', escalated],
  ['codeStarted', code],
  ['relay', () => relay(false)],
  ['relayDecided', () => relay(true)],
  ['vetoed', vetoed],
  ['uiRun', () => uiRun(false)],
  ['uiRunRemade', () => uiRun(true)],
]
