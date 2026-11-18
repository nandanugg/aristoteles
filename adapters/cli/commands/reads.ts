// The commands status (set), log, search, guide: the reads of the kept data. Each one reads the
// state at the time of its one reading of the clock and renders it with adapters/words.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Effect } from 'effect'
import { refuse } from '../../../core/schema/index.ts'
import { Dir, Env, Files, Now, Store } from '../../../core/services/index.ts'
import { foldWork } from '../../../core/state/work/fold.ts'
import { logLine } from '../../words/index.ts'
import { textOf } from '../args.ts'
import { verifyWork } from '../caller.ts'
import type { Command, Commands } from '../command.ts'
import { GUIDES } from '../lookups.ts'
import { readWork } from '../runtime.ts'
import { isStatusKind, STATUS_KINDS, STATUS_WORDS, writeStatus } from '../../live/status.ts'

// P8, ruling 3: work status set --kind=<kind> --text=<words> tells the person what the AI does
// on the dir view (the toast of the page). The host names itself (--by=h1, or --by=host before the
// store); an agent passes its token.
const setStatus = (call: Parameters<Command>[0]) =>
  Effect.gen(function* () {
    const kind = String(textOf(call.args.one('kind')) ?? '')
    const text = textOf(call.args.one('text'))?.trim() ?? ''
    const by = textOf(call.args.one('by'))
    const usage = `work status set --kind=${STATUS_KINDS.join('|')} --text="<what you do now>" --by=<run>`
    if (!isStatusKind(kind)) return yield* refuse(`--kind is one of ${STATUS_KINDS.join(', ')}`, usage)
    if (!text) return yield* refuse('a status needs --text="<what you do now>"', usage)
    const { cwd } = yield* Dir
    let actor: string
    if (call.token !== null) {
      const store = yield* (yield* Store).open(cwd, { create: false })
      const folded = foldWork(yield* store.events)
      if (folded === null) return yield* refuse('no top is open yet', 'the person opens it')
      actor = (yield* verifyWork(folded, call.token)).who
    } else if (by !== undefined && /^[a-z][a-z0-9-]*$/.test(by)) actor = by
    else return yield* refuse('a status names its AI: --by=<run> (the host), or the token first', usage)
    const { vars } = yield* Env
    const at = Date.parse(yield* (yield* Now).read)
    writeStatus(vars, cwd, { by: actor, kind, text, at })
    return [`the page shows: ${STATUS_WORDS[kind]}: ${text}`]
  })

const status: Command = (call) =>
  call.args.positional[0] === 'set'
    ? setStatus(call)
    : refuse('use work status set --kind=<kind> --text="<what you do now>"')

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
// rules, suggestions, and reasons: each match with its place and the versions that hold it.
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
      lines.push(`  ${label(x)}: ${x.text.replaceAll('\n', ' ')}`)
      if (versions.length) {
        const pieces = x.kind === 'draft' ? versions : versions.map((v) => `${v}#${last(x.place)}`)
        lines.push(`    in ${pieces.join(', ')}`)
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

export const commands: Commands = { status, log, search, guide }
