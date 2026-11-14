// The differential test of the actions (BUILD.md 4.5, P5): over the scenario stores of the
// harness, each stored act of the CLI is read back as the input of its action, and the action, run
// on the Work just before that act (the same author, the same time of the check), makes the same
// event. Two acts read the files of their time, which a store does not keep: a
// report (the digest of the work) and the snapshot of a first brief; they are named, not compared.
import { beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActionInput, WhyInput } from '../schema/actions.ts'
import type { Author, Event, Recorded, TaskData, Time, Why, Work } from '../schema/index.ts'
import { sha } from '../services/index.ts'
import { fold } from '../state/index.ts'
import { SCENARIOS } from '../derived/support.test.ts'
import {
  act,
  agent,
  derivedIn,
  derivedOf,
  events,
  eventsOf,
  h,
  ok,
  type Project,
  solToken,
  tokenIn,
} from './fixture.test.ts'

// --- the files of a stored act, written again for its action ------------------------------------

const yaml = (value: unknown): string => Bun.YAML.stringify(value)
const fileOf = (dir: string, name: string, text: string): string => {
  mkdirSync(join(dir, '.work', 'diff'), { recursive: true })
  writeFileSync(join(dir, '.work', 'diff', name), text)
  return `.work/diff/${name}`
}
type Space = TaskData['workspace'][number]
const spaceFile = (w: Space) => ({
  source: w.source,
  path: w.path,
  ...(w._tag === 'Repo' ? { base: w.base } : {}),
  ...(w.verify !== null ? { verify: w.verify } : {}),
})
const taskFile = (t: TaskData, more: Record<string, unknown> = {}) => ({
  name: t.name,
  text: t.text,
  directions: t.directions,
  context: t.context,
  needs: t.needs,
  ...(t.from !== null ? { from: t.from } : {}),
  workspace: t.workspace.map(spaceFile),
  references: t.references,
  ...more,
})
const whyInput = (why: Why): WhyInput =>
  why._tag === 'NoneGiven'
    ? { reason: null, words: null }
    : { reason: why.reason, words: why.words }

// The raw secret of a stored sha: the harness's tokens (k0001...) and the programs' words.
const CANDIDATES = [
  ...Array.from({ length: 400 }, (_, i) => `k${String(i + 1).padStart(4, '0')}`),
  ...Array.from({ length: 60 }, (_, i) => `program-r${i + 1}`),
]
const rawOf = (hash: string): string => {
  const raw = CANDIDATES.find((c) => sha(c) === hash)
  if (raw === undefined) throw new Error(`no raw secret for ${hash}`)
  return raw
}

// --- a stored act as the input of its action -----------------------------------------------------

type Read =
  | { readonly _tag: 'Input'; readonly input: ActionInput }
  | { readonly _tag: 'Skip'; readonly why: string }
const input = (x: unknown): Read => ({ _tag: 'Input', input: x as ActionInput })
const skip = (why: string): Read => ({ _tag: 'Skip', why })

const inputOf = (w: Work, r: Recorded, dir: string): Read => {
  const e = r.event as Event & Record<string, never>
  const k = `${r.seq}`
  const c = ('create' in e ? e.create : undefined) as Record<string, never> | undefined
  const m = ('move' in e ? e.move : undefined) as Record<string, never> | undefined
  const id = ('id' in e ? e.id : undefined) as string | undefined
  const tag = (c ?? m)?._tag as string | undefined
  switch (`${e._tag}.${tag}`) {
    case 'Workflow.Defined':
      return skip('work init: the first event of an empty store (dispatch.test.ts runs it)')
    case 'Workflow.RoleWordsChanged':
      return input({ _tag: 'ApplyConfig', target: {}, content: {} })
    case 'Role.Fitted': {
      const answers = fileOf(dir, `fit-${k}.yaml`, yaml(m?.answers))
      return input({ _tag: 'FitRole', target: { role: id }, content: { answers } })
    }
    case 'Run.HostJoined': {
      const pane = { session: c?.session, socket: c?.socket, pane: c?.pane }
      return input({ _tag: 'JoinRun', target: {}, content: { pane } })
    }
    case 'Run.HostMoved': {
      const pane = { session: m?.session, socket: m?.socket, pane: m?.pane }
      return input({ _tag: 'ContinueRun', target: { run: id }, content: { pane, quote: m?.words } })
    }
    case 'Run.Done':
      return input({ _tag: 'EndRun', target: { run: id }, content: {} })
    case 'Run.Closed':
      return input({ _tag: 'CloseRun', target: { run: id }, content: {} })
    case 'TaskDraft.Drafted': {
      const text = yaml(taskFile(c?.task as never, { role: c?.role }))
      return input({
        _tag: 'DraftTask',
        target: { run: c?.run },
        content: { file: fileOf(dir, `draft-${k}.yaml`, text) },
      })
    }
    case 'Problem.Recorded':
      return input({
        _tag: 'RecordProblem',
        target: { task: c?.stopped },
        content: { says: c?.says },
      })
    case 'Problem.Fixed':
      return input({ _tag: 'FixProblem', target: { problem: id }, content: {} })
    case 'Terminal.Started': {
      const secret = m?.secret === null ? null : rawOf(m?.secret as never)
      return input({
        _tag: 'StartSession',
        target: { assignment: m?.for },
        content: { session: id, secret },
      })
    }
    case 'Terminal.Failed':
    case 'Terminal.Prompted':
    case 'Terminal.Closed':
      return input({ _tag: 'ReportTerminal', target: { session: id }, content: { move: m } })
    case 'Terminal.Stopped':
      return input({ _tag: 'StopTerminal', target: { session: id }, content: {} })
    case 'Terminal.Resumed':
      return input({ _tag: 'ResumeTerminal', target: { session: id }, content: { tier: 'sol' } })
    case 'Send.Sent': {
      const from = c?.from as unknown as {
        _tag: string
        to?: { session: string }
        reason?: unknown
      }
      if (from._tag === 'Agent') {
        return input({
          _tag: 'Send',
          target: { session: from.to?.session },
          content: { keys: c?.keys },
        })
      }
      return input({
        _tag: 'SupervisorSend',
        target: { reason: from.reason },
        content: { keys: c?.keys },
      })
    }
    case 'Send.Delivered':
      return input({ _tag: 'SendDelivered', target: { send: id }, content: {} })
    case 'Send.Dropped':
      return input({ _tag: 'SendDropped', target: { send: id }, content: { why: m?.why } })
    case 'HostWords.ProblemWords':
    case 'HostWords.DraftWords':
    case 'HostWords.EndWords': {
      const hope = (c as { hope?: string | null } | undefined)?.hope ?? null
      return input({
        _tag: 'WriteHostWords',
        target: { on: c?.on },
        content: { text: c?.text, hope },
      })
    }
    case 'Task.Opened': {
      const file = fileOf(dir, `task-${k}.yaml`, yaml(taskFile(c?.task as never)))
      return input({ _tag: 'OpenTask', target: {}, content: { file } })
    }
    case 'Task.OpenedFromDraft':
      return input({ _tag: 'OpenTaskFromDraft', target: { draft: c?.draft }, content: {} })
    case 'Task.Remade': {
      const f = m?.file as unknown as Record<string, { _tag: string; value?: unknown }> & {
        name: string
        text: string
        references: ReadonlyArray<string>
        from: string | null
      }
      const set = (key: string) => (f[key]?._tag === 'Set' ? { [key]: f[key]?.value } : {})
      const space =
        f.workspace?._tag === 'Set'
          ? { workspace: (f.workspace.value as ReadonlyArray<Space>).map(spaceFile) }
          : {}
      const text = yaml({
        name: f.name,
        text: f.text,
        references: f.references,
        ...(f.from !== null ? { from: f.from } : {}),
        ...set('directions'),
        ...set('context'),
        ...set('needs'),
        ...space,
      })
      const file = fileOf(dir, `remake-${k}.yaml`, text)
      return input({
        _tag: 'RemakeTask',
        target: { task: id, answers: m?.review },
        content: { file, reason: m?.reason },
      })
    }
    case 'Task.Split': {
      const file = fileOf(dir, `parts-${k}.yaml`, yaml(m?.parts))
      return input({
        _tag: 'SplitTask',
        target: { task: id, answers: m?.review },
        content: { file },
      })
    }
    case 'Task.Closed':
      return input({ _tag: 'CloseTask', target: { task: id }, content: { reason: m?.reason } })
    case 'Task.Described':
      return input({ _tag: 'DescribeTask', target: { task: id }, content: { text: m?.text } })
    case 'Assignment.GivenMaker':
    case 'Assignment.GivenReviewer': {
      const maxAttempts = (c as { maxAttempts?: number | null } | undefined)?.maxAttempts ?? null
      const secret = rawOf(c?.secret as never)
      return input({
        _tag: 'Give',
        target: { task: c?.task, role: c?.role },
        content: { maxAttempts, secret },
      })
    }
    case 'Assignment.Briefed':
    case 'Assignment.BriefedToCheck':
    case 'Assignment.BriefedFirst':
      return input({ _tag: 'Brief', target: { assignment: id }, content: {} })
    case 'Assignment.Freed':
      return input({ _tag: 'Free', target: { assignment: id }, content: {} })
    case 'Assignment.Finished':
      return input({ _tag: 'Finish', target: { assignment: id }, content: {} })
    case 'Result.Result':
      return skip('a report: the digest of the work at its time is not in the store')
    case 'Review.Accept': {
      const of = c?.of as unknown as { _tag: string; id: string; evidence: unknown }
      const target = { of: { _tag: of._tag, id: of.id } }
      return input({
        _tag: 'Accept',
        target,
        content: { evidence: of.evidence, reason: c?.reason },
      })
    }
    case 'Review.Reject': {
      const of = c?.of as unknown as {
        _tag: string
        id: string
        points?: ReadonlyArray<{ text: string; breaks?: string | null }>
        reason?: string
      }
      const points = (of.points ?? []).map((p) => ({ text: p.text, breaks: p.breaks ?? null }))
      const target = { of: { _tag: of._tag, id: of.id } }
      return input({ _tag: 'Reject', target, content: { points, reason: of.reason ?? null } })
    }
    case 'Review.Recheck':
      return input({ _tag: 'Recheck', target: { result: c?.of }, content: { reason: c?.reason } })
    case 'Review.Escalate':
      return input({
        _tag: 'EscalateResult',
        target: { result: c?.of },
        content: { reason: c?.reason },
      })
    case 'Review.Resolve':
      return input({
        _tag: 'Resolve',
        target: { escalation: c?.escalation },
        content: { resolution: c?.resolution, evidence: c?.evidence },
      })
    case 'Question.Asked': {
      const to = (c?.to as unknown as { _tag: string })._tag
      return input({ _tag: 'Ask', target: { to }, content: { text: c?.text } })
    }
    case 'Question.Escalated': {
      const a = r.author._tag === 'Agent' ? w.assignments.get(r.author.assignment) : undefined
      return input({
        _tag: 'EscalateTask',
        target: { task: a?.task },
        content: { reason: c?.text },
      })
    }
    case 'Question.Answered':
      return input({ _tag: 'Answer', target: { question: id }, content: { text: m?.text } })
    case 'Note.Message':
    case 'Note.Finding':
      return input({
        _tag: 'Note',
        target: { task: c?.about },
        content: { kind: tag, text: c?.text },
      })
    case 'Evaluation.Evaluation':
      return input({
        _tag: 'Evaluate',
        target: { stop: c?.stop },
        content: { wrong: c?.wrong, why: c?.why, improve: c?.improve, level: c?.level },
      })
    case 'Suggestion.Suggestion':
      return input({ _tag: 'Suggest', target: { about: c?.about }, content: { says: c?.says } })
    case 'Revision.Drafted': {
      const file = fileOf(dir, `direction-${k}.yaml`, yaml(c?.direction))
      const why = whyInput(c?.why as never)
      return input({
        _tag: 'DraftDirection',
        target: {},
        content: { file, answers: c?.answers, why },
      })
    }
    case 'Revision.Revised': {
      const file = fileOf(dir, `revise-${k}.yaml`, yaml(c?.edit))
      const why = whyInput(c?.why as never)
      return input({
        _tag: 'ReviseDirection',
        target: { direction: c?.direction },
        content: { file, answers: c?.answers, why },
      })
    }
    case 'Revision.Imported':
      return input({
        _tag: 'ImportCompany',
        target: { direction: c?.direction },
        content: { source: c?.source, folder: c?.folder, owner: c?.owner, checkers: c?.checkers },
      })
    case 'Permission.Granted':
      return input({
        _tag: 'Grant',
        target: { act: c?.act, to: c?.to },
        content: { until: c?.until },
      })
    case 'Permission.Revoked':
      return input({ _tag: 'Revoke', target: { permission: id }, content: {} })
    case 'Source.Moved': {
      const s = c?.source as unknown as { name: string; revision: string }
      return input({
        _tag: 'ReadSource',
        target: { name: s.name },
        content: { revision: s.revision },
      })
    }
    case 'Source.Checked': {
      const s = w.sources.get(id ?? '') as { revision?: string } | undefined
      return input({ _tag: 'ReadSource', target: { name: id }, content: { revision: s?.revision } })
    }
    case 'Checkpoint.Checkpoint':
      return input({ _tag: 'Checkpoint', target: { task: c?.task }, content: { next: c?.next } })
    case 'Forward.Forwarded':
      return input({
        _tag: 'Forward',
        target: { act: c?.inner },
        content: { person: c?.person, quote: c?.quote, channel: c?.channel },
      })
    case 'Forward.Confirmed':
      return input({ _tag: 'Confirm', target: { forward: id }, content: {} })
    default:
      throw new Error(`no action reads ${e._tag}.${String(tag)} back`)
  }
}

// The part of an event that the action can make again: a first brief snapshots the files now.
const comparable = (e: Event): unknown => {
  if (e._tag !== 'Assignment' || !('move' in e) || e.move._tag !== 'BriefedFirst') return e
  const before = e.move.before
  return {
    ...e,
    move: {
      _tag: 'BriefedFirst',
      untouched: Object.keys(e.move.untouched).sort(),
      before: before._tag === 'InPlace' ? Object.keys(before.texts).sort() : before._tag,
    },
  }
}

// --- the scenarios -------------------------------------------------------------------------------

// The acts that the scenarios of core/derived lack: notes, a question answered, an escalation
// resolved, a suggestion, a grant revoked, a source read twice, a checkpoint, a description, a
// free, a finish, a Reject of a task and its evaluation, and a split and a close.
const more = async (): Promise<Project> => {
  const { p, lead, writer, linter } = await h.reported()
  ok(await p.agent(`note ${lead} finding --text="the facts name one merchant"`))
  ok(await p.agent(`ask ${writer} --text="which merchant is it?"`))
  ok(await p.agent(`answer ${lead} q1 --text="the merchant m1"`))
  const up = ok(await p.agent(`escalate ${lead} --result=r1 --reason="the rules say no length"`))
  const vid = /^(v\d+) escalated/.exec(up.out)?.[1] ?? ''
  ok(await p.nanda(`resolve ${vid} --resolution="keep it to one paragraph"`))
  ok(await p.agent(`suggest ${lead} no-ticket-ids --says="name the event, not the ticket"`))
  ok(
    await p.nanda(
      'grant --act=review --on=writer --to=architect --until=2026-12-31T00:00:00Z',
      'grant',
    ),
  )
  ok(await p.nanda('revoke x1', 'revoke'))
  ok(await p.agent(`source ${lead} facts@3`))
  ok(await p.agent(`source ${lead} facts@3`))
  ok(await p.agent(`checkpoint ${lead} t1 --next="the linter checks r1"`))
  ok(await p.nanda('task describe t1 --text="The introduction of the TSD"'))
  ok(await p.agent(`free ${lead} ${linter.split('.')[0]}`))
  ok(await p.agent(`finish ${lead} ${linter.split('.')[0]}`))
  ok(await p.nanda('review t1 reject --point="the task asks for two things at once"'))
  const words = '--wrong="it asks two things" --why="the text joins them" --improve="split it"'
  ok(await p.nanda(`evaluate t1 ${words} --level=task`))
  ok(await p.nanda('task close t1 --reason="the export is out of scope"'))
  return p
}
// A split of a whole task by the person, and a remake of a part.
const split = async (): Promise<Project> => {
  const p = h.project({ 'task.yaml': h.TASK_WHOLE })
  await h.init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
  ok(await p.nanda('task open --file=task.yaml'))
  p.write(
    'parts.yaml',
    '- { name: Intro, text: Write the intro., context: { section: introduction } }\n' +
      '- { name: Design, text: Write the design., context: { section: design }, after: [Intro] }\n',
  )
  ok(await p.nanda('task split t1 --file=parts.yaml'))
  const lead = tokenIn(ok(await p.nanda('assign t2 --role=section-lead')).out)
  ok(await p.agent(`brief ${lead}`))
  p.write('again.yaml', 'name: Intro\ntext: Write the intro, with the cost.\n')
  ok(await p.nanda('task remake t2 --file=again.yaml --reason="the intro names the cost"'))
  return p
}

// The acts of the UI: a run started and continued in the person's pane, a problem with the
// host's words and its fix, the moves of a terminal, a forwarded answer confirmed, an escalation
// of a task, a message, and the close of the run.
const ui = async (): Promise<Project> => {
  const top = `${h.TASK_WHOLE}role: architect\n`
  const p = h.project({ 'top.yaml': top })
  await h.init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) {
    ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  }
  ok(await p.run('run start', h.HOST))
  ok(await p.run('task draft --file=top.yaml --by=h1', h.HOST))
  const host = await solToken(p, ok(await p.ui('task open td1')).out) // ruling 10.1
  ok(await p.agent(`brief ${host}`))
  ok(await p.agent(`assign ${host} t1 --role=section-lead`))
  // The UI starts the lead with a new token (ruling 10.1: in its launch command).
  const lead = tokenIn(ok(await p.ui('session a2 --id=s-a2 --token')).out)
  ok(await p.agent(`brief ${lead}`))
  ok(await p.agent(`problem ${host} t1 --says="the lint server is down; start it again"`))
  ok(await p.agent(`note ${host} words --on=sp1 --text="the lint server stopped"`))
  ok(await p.agent(`problem ${host} sp1 --fixed`))
  ok(await p.ui('event a2 --kind=prompt --text="Do you want to proceed?"'))
  ok(await p.ui('event a2 --kind=stopped'))
  ok(await p.ui('event a2 --kind=resumed'))
  ok(await p.agent(`note ${lead} message --text="the writer starts next"`))
  const writer = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=writer --max-attempts=3`)).out)
  ok(await p.agent(`brief ${writer}`))
  ok(await p.agent(`escalate ${writer} --reason="the facts do not say the cost"`))
  ok(await p.ui('event a2 --kind=closed'))
  ok(await p.ui('run close h1'))
  return p
}

// A forwarded accept of a draft that the person confirms at a terminal.
const confirmed = async (): Promise<Project> => {
  const { p } = await h.started()
  ok(await p.nanda('role fit architect --answers=fit.yaml'))
  const arch = tokenIn(ok(await p.nanda('assign t1 --role=architect')).out)
  ok(await p.agent(`brief ${arch}`))
  p.write('edit.yaml', 'add:\n  - { id: cost-first, says: Say what the problem costs. }\n')
  ok(await p.agent(`direction revise ${arch} tsd-writing --file=edit.yaml`))
  const seen = '--evidence="chat | Nanda says yes" --quote="yes, approve it"'
  const fwd = ok(await p.agent(`forward ${arch} Nanda accept d2 ${seen}`))
  const ref = /^(e\d+):/.exec(fwd.out)?.[1] ?? ''
  ok(await p.nanda(`confirm ${ref}`, 'confirm'))
  return p
}

interface Compared {
  readonly scenario: string
  readonly seq: number
  readonly kind: string
  readonly outcome: 'same' | 'skip' | 'differs'
  readonly detail: string
}
const results: Array<Compared> = []

const replay = (name: string, p: Project) => {
  const stored = eventsOf(p.dir)
  for (const [i, r] of stored.entries()) {
    const data = ('create' in r.event ? r.event.create : r.event.move) as { _tag: string }
    const kind = `${r.event._tag}.${data._tag}`
    if (i === 0) {
      results.push({ scenario: name, seq: r.seq, kind, outcome: 'skip', detail: 'work init' })
      continue
    }
    const work = fold(stored.slice(0, i))
    const read = inputOf(work, r, p.dir)
    if (read._tag === 'Skip') {
      results.push({ scenario: name, seq: r.seq, kind, outcome: 'skip', detail: read.why })
      continue
    }
    // The old write checked at the clock reading before the time of its event.
    const at = new Date(Date.parse(r.at) - 60000).toISOString() as Time
    const d = derivedOf(work, at, p.dir)
    const o = act(d, r.author as Author, read.input)
    const made = o._tag === 'Events' ? o.events.map(comparable) : `refused: ${o.refusal.message}`
    const same = JSON.stringify(made) === JSON.stringify([comparable(r.event)])
    results.push({
      scenario: name,
      seq: r.seq,
      kind,
      outcome: same ? 'same' : 'differs',
      detail: same ? '' : `new ${JSON.stringify(made)} old ${JSON.stringify(comparable(r.event))}`,
    })
  }
}

beforeAll(async () => {
  for (const [name, make] of SCENARIOS) replay(name, (await make()).p as never)
  replay('more', await more())
  replay('split', await split())
  replay('ui', await ui())
  replay('confirmed', await confirmed())
}, 600000)

// A difference that a finding explains, by its kind; none is expected in these scenarios.
const EXPLAINED: Readonly<Record<string, string>> = {}

describe('each act of the scenarios makes the event that the CLI stored', () => {
  test('no event differs, but where a finding explains it', () => {
    const differs = results
      .filter((r) => r.outcome === 'differs' && EXPLAINED[r.kind] === undefined)
      .map((r) => `${r.scenario} e${r.seq} ${r.kind}: ${r.detail}`)
    expect(differs).toEqual([])
  })

  test('the acts compared cover the kinds of the scenarios', () => {
    const same = new Set(results.filter((r) => r.outcome === 'same').map((r) => r.kind))
    const skipped = new Set(results.filter((r) => r.outcome === 'skip').map((r) => r.kind))
    expect([...skipped].sort()).toEqual(['Result.Result', 'Workflow.Defined'])
    // 46 kinds today; the ones that no scenario writes are in the report of P5.
    expect(same.size).toBeGreaterThanOrEqual(46)
  })
})

// A report and a first brief read the files of their time: the action runs on the same files at
// the same moment as the CLI, just before it, and makes the same event.
describe('lockstep: the acts that read files make the same event', () => {
  const lastOf = (dir: string, group: string) =>
    [...eventsOf(dir)].reverse().find((r) => r.event._tag === group)?.event
  test('a first brief, and a report of a section', async () => {
    const { p, writer } = await h.withWriter()
    const brief = { _tag: 'Brief', target: { assignment: 'a2' }, content: {} }
    const briefed = events(act(derivedIn(p), agent(writer), brief as never))
    ok(await p.agent(`brief ${writer}`))
    expect(briefed).toEqual([lastOf(p.dir, 'Assignment') as Event])
    p.write('docs/tsd.md', h.INTRO_V2)
    const output = 'docs/tsd.md#introduction'
    const report = {
      _tag: 'Report',
      target: { assignment: 'a2' },
      content: { output, madeFrom: [] },
    }
    const mine = events(act(derivedIn(p), agent(writer), report as never))
    ok(await p.agent(`report ${writer} --output=${output}`))
    expect(mine).toEqual([lastOf(p.dir, 'Result') as Event])
  }, 60000)

  test('a report of a commit, with its merge base', async () => {
    const { p, app, impl } = await h.codeStarted()
    h.git(app, 'checkout', '-q', '-b', 'fix')
    p.write('app/key.txt', 'fixed\n')
    h.git(app, 'add', '.')
    h.git(app, 'commit', '-q', '-m', 'fix')
    const output = `app@${h.git(app, 'rev-parse', 'HEAD')}`
    const report = {
      _tag: 'Report',
      target: { assignment: 'a2' },
      content: { output, madeFrom: [] },
    }
    const mine = events(act(derivedIn(p), agent(impl), report as never))
    ok(await p.agent(`report ${impl} --output=${output}`))
    expect(mine).toEqual([lastOf(p.dir, 'Result') as Event])
  }, 60000)
})
