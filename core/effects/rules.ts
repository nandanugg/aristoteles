// The harness's rule runner (DESIGN 13.1): it runs a rule's test command and checks a rule's
// reference, and fills the act fields the AI does not (WriteRule.refOk, RunTest.own and .contra,
// Report.caught, RunRule.holds). A test command runs in the project dir with the paths to check
// as its arguments; each non-empty output line is a point, the exit status is ignored.
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { Data, Effect } from 'effect'
import { appliesTo, fixOf, taskOf, testRule } from '../state/c16/reads.ts'
import type { WorkState } from '../state/c16/state.ts'
import type { DraftItems, ItemKey, ItemRec } from '../state/c16/data.ts'
import type { Recorded } from '../schema/index.ts'
import { Dir, Files, Spawn } from '../services/index.ts'

// A test command that cannot start or times out: a failure to report, never "holds".
export class RuleRunFailed extends Data.TaggedError('RuleRunFailed')<{
  readonly test: string
  readonly message: string
}> {}

const TIMEOUT_MS = 30_000

// The points a test command prints on the paths.
export const runOn = (
  test: string,
  paths: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, RuleRunFailed, Dir | Spawn> =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const spawn = yield* Spawn
    // The paths are the command's arguments; a command that places "$@" itself keeps its place.
    const script = test.includes('"$@"') ? test : `${test} "$@"`
    const r = yield* spawn
      .run(['sh', '-c', script, 'sh', ...paths], { cwd, timeoutMs: TIMEOUT_MS })
      .pipe(
        Effect.catchDefect((e) =>
          Effect.fail(new RuleRunFailed({ test, message: `cannot start: ${String(e)}` })),
        ),
      )
    if (r.timedOut) return yield* new RuleRunFailed({ test, message: 'timed out (30 s)' })
    if (r.code < 0) return yield* new RuleRunFailed({ test, message: 'cannot start' })
    return r.out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
  })

// A sample text as a file: named by its content, so a second run writes the same bytes.
const sampleFile = (sample: string): Effect.Effect<string, RuleRunFailed, Files> =>
  Effect.gen(function* () {
    const path = join(
      tmpdir(),
      'aristoteles-rules',
      `${createHash('sha1').update(sample).digest('hex')}.txt`,
    )
    yield* (yield* Files).write(path, sample).pipe(
      Effect.mapError((e) => new RuleRunFailed({ test: '', message: e.message })),
    )
    return path
  })

const printsOn = (
  test: string,
  samples: ReadonlyArray<string>,
): Effect.Effect<boolean, RuleRunFailed, Dir | Spawn | Files> =>
  Effect.gen(function* () {
    for (const sample of samples) {
      if ((yield* runOn(test, [yield* sampleFile(sample)])).length > 0) return true
    }
    return false
  })

const samplesOf = (r: ItemRec, fits: 'follows' | 'breaks'): ReadonlyArray<string> =>
  r.examples.filter((e) => e.fits === fits).map((e) => e.sample)

// The direction a rule belongs to (its standard's parent).
const dirOf = (items: ReadonlyMap<ItemKey, ItemRec>, r: ItemRec): ItemKey | null =>
  r.parent === null ? null : (items.get(r.parent)?.parent ?? null)

// The rules of a draft (applied over the store's items) with a test command: own = each one's
// test prints on every 'breaks' example and on no 'follows' one; contra = the other rules of its
// direction (the draft applied) on whose 'follows' example it prints (the cross test).
const testDraft = (
  s: WorkState,
  draft: DraftItems,
): Effect.Effect<
  { readonly own: boolean; readonly contra: ReadonlyArray<ItemKey> },
  RuleRunFailed,
  Dir | Spawn | Files
> =>
  Effect.gen(function* () {
    const items = new Map(s.items)
    for (const [x, r] of draft) {
      if (r === null) items.delete(x)
      else items.set(x, r)
    }
    const written = [...draft].filter(
      (e): e is [ItemKey, ItemRec] => e[1] !== null && e[1].kind === 'rule' && e[1].test !== null,
    )
    let own = true
    const contra = new Set<ItemKey>()
    for (const [, r] of written) {
      const test = r.test ?? ''
      for (const e of r.examples) {
        const prints = yield* printsOn(test, [e.sample])
        if (prints !== (e.fits === 'breaks')) own = false
      }
      const dir = dirOf(items, r)
      for (const [y, o] of items) {
        // Only the store's other rules: a rule of the draft is no one to contradict.
        if (draft.has(y) || o.kind !== 'rule' || dirOf(items, o) !== dir) continue
        if (yield* printsOn(test, samplesOf(o, 'follows'))) contra.add(y)
      }
    }
    return { own, contra: [...contra] }
  })

// RunTest's fields: the test of the rule the fix's draft writes.
export const runTest = (s: WorkState, fixId: string) => testDraft(s, fixOf(s, fixId).draft)

// Ship's resolvesFight for a rule with a test command: the cross test on the fix's draft with the
// drafted items on top of it finds no rule of the direction that the test contradicts.
export const resolvesFight = (
  s: WorkState,
  fixId: string,
  draft: DraftItems,
): Effect.Effect<boolean, RuleRunFailed, Dir | Spawn | Files> =>
  Effect.map(
    testDraft(s, new Map([...fixOf(s, fixId).draft, ...draft])),
    ({ contra }) => contra.length === 0,
  )

// `file#anchor:lines` (lines `n` or `n-m`).
const REF = /^([^#:]+)#([^:]+):(\d+)(?:-(\d+))?$/

const slug = (heading: string): string =>
  heading.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-')

export const ruleRefLocation = (ref: string) => {
  const match = REF.exec(ref)
  if (match === null) return undefined
  const [, file = '', anchor = '', from = '', to = from] = match
  if (isAbsolute(file) || file.split('/').includes('..')) return undefined
  return { file, anchor, from: Number(from), to: Number(to) }
}

export const ruleRefText = (text: string, { anchor, from, to }: NonNullable<ReturnType<typeof ruleRefLocation>>) => {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  if (from < 1 || to < from || to > lines.length) return undefined
  const anchored = lines.some((line) => {
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    return (heading !== null && slug(heading[1] ?? '') === anchor) || line.includes(anchor)
  })
  return anchored ? lines.slice(from - 1, to).join('\n') : undefined
}

// The reference is real: a file under the project dir, the anchor in it, the lines within it.
export const refExists = (dir: string, ref: string): Effect.Effect<boolean, never, Files> =>
  Effect.gen(function* () {
    const location = ruleRefLocation(ref)
    if (!location) return false
    const text = yield* (yield* Files).read(join(dir, location.file))
    return text !== null && ruleRefText(text, location) !== undefined
  })

// The sections of a markdown text: each heading (any level) whose text or slug is a name, with
// its body up to the next heading of the same or a higher level (subsections stay inside).
const sectionsOf = (text: string, names: ReadonlyArray<string>): ReadonlyArray<string> => {
  const lines = text.split('\n')
  // The heading level of each line; 0 for a plain line or a line inside a code fence.
  let fenced = false
  const levels = lines.map((l) => {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced
    return fenced ? 0 : (/^(#{1,6})\s/.exec(l)?.[1]?.length ?? 0)
  })
  const out: string[] = []
  lines.forEach((l, i) => {
    const level = levels[i] ?? 0
    if (level === 0) return
    const title = l.replace(/^#+\s+/, '').trim()
    if (!names.includes(title) && !names.includes(slug(title))) return
    const end = levels.findIndex((m, j) => j > i && m > 0 && m <= level)
    out.push(lines.slice(i, end < 0 ? lines.length : end).join('\n'))
  })
  return out
}

// The paths a test command gets: a temp file per section of the task in each file; a file with
// none of them (not a sectioned document) whole.
const checkPaths = (
  s: WorkState,
  taskId: string,
  paths: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, RuleRunFailed, Files> =>
  Effect.gen(function* () {
    const names = taskOf(s, taskId).sections
    const out: string[] = []
    for (const p of paths) {
      const text = yield* (yield* Files).read(p)
      const found = text === null ? [] : sectionsOf(text, names)
      if (found.length === 0) out.push(p)
      else for (const f of found) out.push(yield* sampleFile(f))
    }
    return out
  })

// The rules that apply to the task, with a test command, that print on the paths' sections.
export const caughtOn = (
  s: WorkState,
  taskId: string,
  paths: ReadonlyArray<string>,
): Effect.Effect<ReadonlySet<ItemKey>, RuleRunFailed, Dir | Spawn | Files> =>
  Effect.gen(function* () {
    const checked = yield* checkPaths(s, taskId, paths)
    const caught = new Set<ItemKey>()
    for (const x of appliesTo(s, taskOf(s, taskId))) {
      const r = s.items.get(x)
      if (r === undefined || r.kind !== 'rule' || !testRule(s, x) || r.test === null) continue
      if ((yield* runOn(r.test, checked)).length > 0) caught.add(x)
    }
    return caught
  })

// RunRule: the pending test rules of the task print nothing on the paths.
export const pendingHold = (
  s: WorkState,
  taskId: string,
  paths: ReadonlyArray<string>,
): Effect.Effect<boolean, RuleRunFailed, Dir | Spawn | Files> =>
  Effect.gen(function* () {
    const checked = yield* checkPaths(s, taskId, paths)
    for (const x of taskOf(s, taskId).pending) {
      const test = s.items.get(x)?.test ?? null
      if (!testRule(s, x) || test === null) continue
      if ((yield* runOn(test, checked)).length > 0) return false
    }
    return true
  })

// The paths of the last Report of a task.
export const filesOfLast = (
  s: WorkState,
  events: ReadonlyArray<Recorded>,
  task: string,
): ReadonlyArray<string> =>
  events.flatMap((r) =>
    r.event._tag === 'Work' && r.event.create._tag === 'Acted' &&
      r.event.create.act.body._tag === 'Report' && r.event.create.act.who._tag === 'Maker' &&
      s.makers.get(r.event.create.act.who.id)?.task === task
      ? [r.event.create.act.body.files]
      : []
  ).at(-1) ?? []

// RunRule's `holds` as the harness fills it: true when the task has no report with files.
export const ruleHolds = (
  s: WorkState,
  events: ReadonlyArray<Recorded>,
  task: string,
): Effect.Effect<boolean, RuleRunFailed, Dir | Spawn | Files> => {
  const files = filesOfLast(s, events, task)
  return files.length === 0 || !s.tasks.has(task)
    ? Effect.succeed(true)
    : pendingHold(s, task, files)
}
