// The commands status, waiting, blockers, next, log, search, guide, question, result, assignment,
// evaluation. Each one
// reads the state at the time of its one reading of the clock.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Effect } from 'effect'
import { refuse } from '../../domain/errors.ts'
import type { By, Review } from '../../domain/model.ts'
import { lookupAssignment, lookupResult } from '../../domain/lookup.ts'
import { evaluationCounts, evaluationDecision, stopTask } from '../../engine/queries.ts'
import { Dir } from '../../services/io.ts'
import { Files } from '../../services/outside.ts'
import { Store } from '../../services/store.ts'
import { outsideOf } from '../../words/common.ts'
import { logLine } from '../../words/log.ts'
import { renderBrief } from '../../words/brief.ts'
import { nextLines, nextSteps } from '../../words/next.ts'
import { renderBlockers, renderResult, stopIdOf } from '../../words/show.ts'
import { renderStatus, renderWaiting } from '../../words/waiting.ts'
import { textOf } from '../args.ts'
import { agentCallerOf, tierOf } from '../caller.ts'
import type { Command, Commands } from '../command.ts'
import { GUIDES } from '../guides.ts'
import { lookupKind } from '../lookups.ts'
import { readWork } from '../run.ts'

// An assignment by its id, a person or a run by its name.
const byName = (by: By): string => (typeof by === 'string' ? by : by.name)

const status: Command = () =>
  Effect.gen(function* () {
    const { work, at } = yield* readWork
    return renderStatus(work, at)
  })

const waiting: Command = (call) =>
  Effect.gen(function* () {
    const { work, at } = yield* readWork
    return renderWaiting(work, textOf(call.args.one('for')) ?? null, at)
  })

const blockers: Command = (call) =>
  Effect.gen(function* () {
    const { work, at, dir } = yield* readWork
    const result = yield* lookupResult(work, String(call.args.positional[0]))
    return renderBlockers(work, result.id, at, yield* outsideOf(work, dir, [result]))
  })

const next: Command = (call) =>
  Effect.gen(function* () {
    const { work, at, dir } = yield* readWork
    const { assignment: a, token } = yield* agentCallerOf(work, call.args.positional[0] ?? null)
    if (a.end._tag !== 'NotEnded') return [`${a.id} is finished; there is nothing more for it.`]
    if (tierOf(work, a) === 'low') return [`a low role has one unit: work brief ${token} shows it.`]
    const steps = nextSteps(work, a.id, { token, at, cwd: dir })
    const lines = nextLines(work, steps, { token, at })
    return lines.length ? lines : [`nothing is ready in ${a.task}; work waiting shows what waits.`]
  })

const log: Command = (call) =>
  Effect.gen(function* () {
    const { work } = yield* readWork
    const last = Number(call.args.one('last') ?? 30)
    return work.events.slice(-last).map((l) => logLine(l, work))
  })

const placeOf = (row: Readonly<Record<string, unknown>>) => ({
  place: String(row.place),
  kind: String(row.kind),
  text: String(row.text),
})

// A search in aristoteles (SQLite full-text search) over the words of directions, standards,
// rules, suggestions, and reasons: each match with its place, the versions that hold it, and
// the tasks that read those versions.
const search: Command = (call) =>
  Effect.gen(function* () {
    const words = call.args.positional.join(' ').trim()
    if (!words) return yield* refuse('a search needs its words: work search <words>')
    const query = words
      .split(/\s+/)
      .map((w) => `"${w.replaceAll('"', '')}"*`)
      .join(' ')
    const { cwd } = yield* Dir
    const store = yield* Store
    const opened = yield* store.open(cwd, { create: false })
    const p = opened.dir
    const found = (
      yield* opened.query(
        `SELECT place, kind, snippet(words_search, 3, '[', ']', '...', 16) AS text FROM words_search
        WHERE words_search MATCH ? AND project = ? ORDER BY rank LIMIT 20`,
        query,
        p,
      )
    ).map(placeOf)
    if (!found.length) return [`nothing in ${opened.name} says "${words}".`]
    const versionsOf = (x: ReturnType<typeof placeOf>) =>
      Effect.gen(function* () {
        const rows =
          x.kind === 'standard'
            ? yield* opened.query(
                'SELECT DISTINCT v.id FROM version v JOIN draft_standard ds ON ds.project = v.project AND ds.draft = v.draft WHERE v.project = ? AND ds.standard = ? ORDER BY v.id',
                p,
                x.place,
              )
            : x.kind === 'rule'
              ? yield* opened.query(
                  `SELECT DISTINCT v.id FROM version v JOIN draft_standard ds ON ds.project = v.project AND ds.draft = v.draft
              JOIN standard_rule sr ON sr.project = ds.project AND sr.standard = ds.standard WHERE v.project = ? AND sr.rule = ? ORDER BY v.id`,
                  p,
                  x.place,
                )
              : x.kind === 'draft'
                ? yield* opened.query('SELECT id FROM version WHERE project = ? AND draft = ?', p, x.place)
                : []
        return rows.map((v) => String(v.id))
      })
    const tasksOf = (versions: ReadonlyArray<string>) =>
      versions.length
        ? opened.query(
            `SELECT DISTINCT t.id, t.name FROM brief b
        JOIN assignment a ON a.project = b.project AND a.id = b.assignment JOIN task t ON t.project = a.project AND t.id = a.task
        WHERE b.project = ? AND b.version IN (${versions.map(() => '?').join(', ')}) ORDER BY t.id`,
            p,
            ...versions,
          )
        : Effect.succeed([])
    const last = (place: string) => place.split('/').at(-1)
    const label = (x: ReturnType<typeof placeOf>) =>
      ({
        standard: `standard ${last(x.place)}`,
        rule: `rule ${last(x.place)}`,
        draft: `what ${x.place} says`,
        suggestion: `suggestion ${x.place}`,
        reason: `the reason of ${x.place}`,
      })[x.kind as 'standard'] ?? x.place
    const lines = [`${found.length} ${found.length > 1 ? 'matches' : 'match'} for "${words}" in ${p}:`]
    for (const x of found) {
      const versions = yield* versionsOf(x)
      const tasks = yield* tasksOf(versions)
      lines.push(`  ${label(x)}: ${x.text.replaceAll('\n', ' ')}`)
      if (versions.length) {
        const pieces = x.kind === 'draft' ? versions : versions.map((v) => `${v}#${last(x.place)}`)
        const readBy = tasks.map((t) => `${String(t.id)} (${String(t.name)})`).join(', ')
        lines.push(`    in ${pieces.join(', ')}${tasks.length ? ` · read by ${readBy}` : ''}`)
      }
    }
    return lines
  })

// A guide in words, for a model or a person: how to write a direction (writing), and the
// questions of the review of a draft (direction-review), and the words of a decision for the
// person (decision-words). Guides are files; everything else is in aristoteles.
const guide: Command = (call) =>
  Effect.gen(function* () {
    const names = readdirSync(GUIDES)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .sort()
    const name = call.args.positional[0]
    if (name === undefined || !names.includes(name)) {
      return yield* refuse(
        `work guide <name>: the guides are ${names.join(', ')}`,
        `work guide ${names.at(-1)}`,
      )
    }
    const text = yield* (yield* Files).read(join(GUIDES, `${name}.md`))
    return [(text ?? '').trimEnd()]
  })

const question: Command = (call) =>
  Effect.gen(function* () {
    const [sub, id] = call.args.positional
    if (sub !== 'show') return yield* refuse('use work question show <question>')
    const { work } = yield* readWork
    const { question: q } = yield* lookupKind('Question', ['q'], work, String(id))
    return [
      `${String(id)} asked by ${byName(q.from)}, for ${byName(q.answerBy)}:`,
      q.text,
      '',
      q.status._tag === 'Answered' ? `answer: ${q.status.answer}` : 'no answer yet',
    ]
  })

const result: Command = (call) =>
  Effect.gen(function* () {
    const [sub, id] = call.args.positional
    if (sub !== 'show') return yield* refuse('use work result show <result>')
    const { work, at, dir } = yield* readWork
    const found = yield* lookupResult(work, String(id))
    return renderResult(work, found.id, at, yield* outsideOf(work, dir, [found]))
  })

const assignment: Command = (call) =>
  Effect.gen(function* () {
    const [sub, id] = call.args.positional
    if (sub !== 'show') return yield* refuse('use work assignment show <assignment>')
    const { work, at, dir } = yield* readWork
    const a = yield* lookupAssignment(work, String(id))
    const config = work.config.roles[a.role]
    // A program reads no brief: it runs its command on each report and records its checks.
    if (config?.kind === 'program') {
      const task = work.tasks.get(a.task)
      return [
        `${a.id} · ${a.role} (program) on ${a.task} ${task?.name ?? ''}`,
        `runs "${config.run}" on ${config.on}; checks ${config.checks.join(', ') || 'nothing'}; the CLI starts it, not a subagent`,
      ]
    }
    const brief = renderBrief(work, a.id, { token: `${a.id}.<token>`, at, cwd: dir })
    return [brief, '', '(read-only: no snapshot, no claim)']
  })

const evaluation: Command = (call) =>
  Effect.gen(function* () {
    const [sub, id] = call.args.positional
    if (sub !== 'show') {
      return yield* refuse(
        'use work evaluation show <evaluation>; the owner accepts or rejects one with work review <evaluation> accept|reject',
      )
    }
    const { work } = yield* readWork
    const { evaluation: e } = yield* lookupKind('Evaluation', ['ev'], work, String(id))
    const task = work.tasks.get(stopTask(work, e.answers))
    const decided = evaluationDecision(work, e)
    // The owner decides an evaluation with one accept, or one reject with a reason.
    const words = (r: Review) =>
      r._tag === 'Accept'
        ? (r.reason ?? r.of.evidence.map((x) => x.says).join('; '))
        : r._tag === 'Reject' && 'reason' in r.of
          ? r.of.reason
          : ''
    const tail = decided
      ? ` · ${decided._tag === 'Accept' ? 'accepted' : 'rejected'}: ${words(decided)}`
      : evaluationCounts(work, e)
        ? ''
        : ' · waits for the person'
    return [
      `${String(id)} · ${task?.id ?? ''} ${task?.name ?? ''} · answers ${stopIdOf(work, e.answers)} · level ${e.level} · by ${byName(e.by)}${tail}`,
      `wrong:   ${e.wrong}`,
      `why:     ${e.why}`,
      ...e.improve.map((x) => `improve: ${x}`),
    ]
  })

export const commands: Commands = {
  status,
  waiting,
  blockers,
  next,
  log,
  search,
  guide,
  question,
  result,
  assignment,
  evaluation,
}
