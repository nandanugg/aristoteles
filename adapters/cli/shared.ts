// What several commands share: the reading of the evidence and point flags (the CLI forms of
// finding I4), and the words that follow an official version.
import { Effect } from 'effect'
import { blockersOf } from '../../core/derived/index.ts'
import {
  directionIdsOf,
  resultsOf,
  versionAt,
  versionNumberOf,
  within,
} from '../../core/derived/reads.ts'
import type { Derived } from '../../core/derived/index.ts'
import type { PointInput } from '../../core/schema/actions.ts'
import {
  type Direction,
  type EvidenceData,
  refuse,
  type Refused,
  type RevisionId,
  type Version,
  type DirectionId,
  type VersionId,
} from '../../core/schema/index.ts'

// The form of the evidence of an accept, in each refusal that asks for it (Nanda, 2026-11-13).
export const EVIDENCE_FORM =
  '--evidence="<rule id> | <where you read in the result> | <what you saw there>", one for each rule in your checks; with no rule: --evidence="<where you read> | <what you saw there>"'

// The examples: key of a file, in each template that asks for examples (Nanda, 2026-11-15: an
// example is an output of a marked step). A template indents it under its own first line.
export const EXAMPLES_FORM = `examples:   # for each marked step of the flow, one that follows and one that breaks
  - step: <n>   # a marked step of the flow (one with uses); none when the flow marks none
    fit: Follows | Breaks   # the output follows the direction, or breaks it
    input: { file: <path>, line: <n>, excerpt: <a short part of it> }   # only for a step that checks or decides
    output: { file: <a real result>, line: <n>, excerpt: <a short part of it as it is now> }
  - { step: <n>, fit: Breaks, output: { written: <the output in your words, when the project has none> } }`

// One evidence line: <rule id> | <where> | <what>, or <where> | <what> for what no rule names.
export const evidenceOf = (
  values: ReadonlyArray<string | true>,
): Effect.Effect<ReadonlyArray<typeof EvidenceData.Type>, Refused> =>
  Effect.gen(function* () {
    const out: Array<typeof EvidenceData.Type> = []
    for (const v of values) {
      const parts = String(v)
        .split('|')
        .map((p) => p.trim())
      if (![2, 3].includes(parts.length) || parts.some((p) => !p)) {
        return yield* refuse(
          `--evidence="${String(v)}" does not read: an accept needs ${EVIDENCE_FORM}`,
        )
      }
      const [rule, where, what] = parts.length === 3 ? parts : [null, ...parts]
      out.push({ rule: rule ?? null, where: where ?? '', what: what ?? '' })
    }
    return out
  })

// The points of a reject, from the flags in their order: a --breaks belongs to the --point
// before it, and (I4) a leading --breaks waits for the next --point.
export const pointsOf = (
  flags: ReadonlyArray<readonly [string, string | true]>,
): ReadonlyArray<PointInput> => {
  const points: Array<PointInput> = []
  let pending: string | null = null
  for (const [key, value] of flags) {
    if (key === 'point') {
      points.push({ text: String(value), breaks: pending })
      pending = null
    }
    if (key === 'breaks') {
      const last = points.at(-1)
      if (last !== undefined && last.breaks === null && pending === null) {
        points[points.length - 1] = { ...last, breaks: String(value) }
      } else pending = String(value)
    }
  }
  return points
}

// What an official version leaves to do: the results that it makes old, and the tasks that no open
// assignment works on (no work next can show them).
export const afterVersion = (
  d: Derived,
  version: Version<Direction>,
): ReadonlyArray<string> => {
  const w = d.moment.work
  const tasks = [...w.tasks.values()].filter(
    (t) =>
      d.states.tasks.get(t.id)?._tag !== 'Closed' &&
      d.states.tasks.get(t.id)?._tag !== 'Replaced' &&
      directionIdsOf(w, t.id).includes(version.of),
  )
  const old = tasks
    .flatMap((t) => resultsOf(w, t.id).at(-1) ?? [])
    .filter((r) => blockersOf(d.moment, r.id).some((i) => i._tag === 'OldVersion'))
  const idle = tasks.filter(
    (t) =>
      d.states.tasks.get(t.id)?._tag !== 'Accepted' &&
      ![...w.assignments.values()].some(
        (x) => d.states.assignments.get(x.id)?._tag !== 'Ended' && within(w, t.id, x.task),
      ),
  )
  return [
    ...(old.length
      ? [
          `now under an old version: ${old.map((r) => `${r.id} (${r.task})`).join(', ')}; ` +
            'each needs a check under the new version (work next shows it).',
        ]
      : []),
    ...idle.map((t) => `no open assignment works on ${t.id}: work assign ${t.id} --role=<role>`),
  ]
}

// The version that a draft made official, from the state of the draft; none while it is not.
export const versionMadeBy = (
  d: Derived,
  draft: RevisionId,
): Version<Direction> | undefined => {
  const state = d.states.revisions.get(draft)
  if (state?._tag !== 'Official') return undefined
  const id: VersionId = state.version
  const direction = id.slice(0, id.lastIndexOf('@')) as DirectionId
  return versionAt(d.moment.work, direction, versionNumberOf(id))
}
