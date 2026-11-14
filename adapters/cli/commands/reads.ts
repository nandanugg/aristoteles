// The commands status, waiting, blockers, next, log, search, guide, question, result, assignment,
// evaluation. Each one reads the state at the time of its one reading of the clock and renders
// it with adapters/words.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Effect } from 'effect'
import { nextFor, waitingFor } from '../../../core/derived/index.ts'
import {
  type AssignmentId,
  lookupAssignment,
  lookupResult,
  refuse,
} from '../../../core/schema/index.ts'
import { Dir, Files, Store } from '../../../core/services/index.ts'
import {
  logLine,
  nextLines,
  renderAssignment,
  renderBlockers,
  renderEvaluation,
  renderQuestion,
  renderResult,
  renderStatus,
  waitingLines,
} from '../../words/index.ts'
import { textOf } from '../args.ts'
import { agentCallerOf, tierOfAssignment, tokenOfCall } from '../caller.ts'
import type { Command, Commands } from '../command.ts'
import { GUIDES, lookupKind } from '../lookups.ts'
import { readWork } from '../runtime.ts'

const status: Command = () =>
  Effect.gen(function* () {
    const { d } = yield* readWork
    return renderStatus(d)
  })

const waiting: Command = (call) =>
  Effect.gen(function* () {
    const { d } = yield* readWork
    const forWho = textOf(call.args.one('for')) ?? null
    // --for names a person, or an assignment (aN): the list of that actor's own items.
    const items =
      forWho === null
        ? waitingFor(d, { _tag: 'Everyone' })
        : /^a\d+$/.test(forWho)
          ? waitingFor(d, { _tag: 'Everyone' }).filter(
              (i) => i.for._tag === 'Assignment' && i.for.assignment === forWho,
            )
          : waitingFor(d, { _tag: 'Person', name: forWho })
    return waitingLines(d, items, forWho)
  })

const blockers: Command = (call) =>
  Effect.gen(function* () {
    const { work, d } = yield* readWork
    const result = yield* lookupResult(work, String(call.args.positional[0]))
    return renderBlockers(d, result.id)
  })

const next: Command = (call) =>
  Effect.gen(function* () {
    const { work, d } = yield* readWork
    const caller = yield* agentCallerOf(work, tokenOfCall(call))
    const { assignment: a, token } = caller
    const task = work.assignments.get(a)?.task ?? ''
    if (d.states.assignments.get(a)?._tag === 'Ended') {
      return [`${a} is finished; there is nothing more for it.`]
    }
    if (tierOfAssignment(work, a) === 'low') {
      return [`a low role has one unit: work brief ${token} shows it.`]
    }
    const actor = { _tag: 'Agent', assignment: a } as const
    const lines = nextLines(d, nextFor(d, actor), token)
    return lines.length ? lines : [`nothing is ready in ${task}; work waiting shows what waits.`]
  })

const log: Command = (call) =>
  Effect.gen(function* () {
    const { work } = yield* readWork
    const last = Number(call.args.one('last') ?? 30)
    return work.events.slice(-last).map((l) => logLine(work, l))
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
                ? yield* opened.query(
                    'SELECT id FROM version WHERE project = ? AND draft = ?',
                    p,
                    x.place,
                  )
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
    const lines = [
      `${found.length} ${found.length > 1 ? 'matches' : 'match'} for "${words}" in ${p}:`,
    ]
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

// A guide in words, for a model or a person; guides are files of the tool.
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
    const { work, d } = yield* readWork
    const { question: q } = yield* lookupKind('Question', ['q'], work, String(id))
    return renderQuestion(d, q.id)
  })

const result: Command = (call) =>
  Effect.gen(function* () {
    const [sub, id] = call.args.positional
    if (sub !== 'show') return yield* refuse('use work result show <result>')
    const { work, d } = yield* readWork
    const found = yield* lookupResult(work, String(id))
    return renderResult(d, found.id)
  })

const assignment: Command = (call) =>
  Effect.gen(function* () {
    const [sub, id] = call.args.positional
    if (sub !== 'show') return yield* refuse('use work assignment show <assignment>')
    const { work, d } = yield* readWork
    const a = yield* lookupAssignment(work, String(id))
    return renderAssignment(d, a.id as AssignmentId)
  })

const evaluation: Command = (call) =>
  Effect.gen(function* () {
    const [sub, id] = call.args.positional
    if (sub !== 'show') {
      return yield* refuse(
        'use work evaluation show <evaluation>; the owner accepts or rejects one with work review <evaluation> accept|reject',
      )
    }
    const { work, d } = yield* readWork
    const { evaluation: e } = yield* lookupKind('Evaluation', ['ev'], work, String(id))
    return renderEvaluation(d, e.id)
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
