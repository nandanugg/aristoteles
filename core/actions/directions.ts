// The actions of directions and sources: the drafts before a top (drafted, revised,
// imported, with their examples), the owner's accept or reject of a draft, and what the host reads
// of an outside source. The content checks of a draft are in drafts.ts.
import { Effect, Schema } from 'effect'
import { currentOf, draftAt, ruleAt, standardAt } from '../derived/reads.ts'
import type { ActionInput, WhyInput } from '../schema/actions.ts'
import type { Refusal } from '../schema/errors.ts'
import {
  CONTEXT_KEYS,
  create,
  type DirectionFile,
  isNonBlank,
  move,
  oneOf,
  REASONS,
  ReviseFile,
  RuleEvidence,
  RuleRef,
  casesProblem,
  usesProblem,
  type Why,
  type Work,
  whereRecord,
} from '../schema/index.ts'
import { readDirection, readFlow } from '../services/index.ts'
import { answersFound, checkDrafted, checkImported, checkRevised, DRAFT } from './drafts.ts'
import {
  allowed,
  asWrite,
  blank,
  configUnchanged,
  current,
  no,
  readYaml,
  type RefusalsOf,
} from './support.ts'
import type { Action } from './types.ts'

const WHY = {
  wordsNeedReason: (reasons: string) =>
    no(
      `--why-words gives the words of a reason; add --why=<one of: ${reasons}>`,
      'Pick',
      `pick the reason of the words: one of ${reasons}`,
    ),
  notAReason: (why: string, reasons: string) =>
    no(
      `--why="${why}" is not a reason of a draft; it is one of: ${reasons}`,
      'Pick',
      `pick one of: ${reasons}`,
    ),
} satisfies RefusalsOf

const REFUSALS = {
  DraftDirection: {
    ...WHY,
    ...DRAFT,
    company: (id: string) =>
      no(
        `${id} is a company direction; it changes in its repo`,
        'Escalate',
        `change ${id} in its repo, with a pull request`,
      ),
    frameChanged: (id: string, keys: string) =>
      no(
        `${id} has a version, and this file changes its ${keys}; a revise changes only what it ` +
          'says and its standards',
        'Write',
        `keep the ${keys} of ${id} in the file`,
      ),
  },
  ReviseDirection: {
    ...WHY,
    ...DRAFT,
    badFile: (file: string, what: string) => no(`${file}: ${what}`, 'Write', `correct ${file}`),
  },
  ImportCompany: { ...DRAFT },
  AddExamples: { uses: DRAFT.uses },
  Accept: {},
  Reject: {
    noReason: (target: string) =>
      no(`a reject of ${target} needs --reason="<why>"`, 'Write', `write why ${target} is wrong`),
  },
  ReadSource: {},
} satisfies Readonly<Record<string, RefusalsOf>>
const R = REFUSALS

const fail = <A = never>(r: Refusal): Effect.Effect<A, Refusal> => Effect.fail(r)

// --- the answers and the why of a draft ---------------------------------------------------------

// N5 (I4): blank words of a reason are none given; a reason is one of the five.
export const whyOf = (input: WhyInput): Effect.Effect<Why, Refusal> => {
  const reasons = REASONS.join(', ')
  const words = blank(input.words) ? null : (input.words as never)
  if (input.reason === null) {
    return words === null
      ? Effect.succeed({ _tag: 'NoneGiven' as const })
      : fail(WHY.wordsNeedReason(reasons))
  }
  const reason = oneOf(REASONS, input.reason)
  if (reason === undefined) return fail(WHY.notAReason(input.reason, reasons))
  return Effect.succeed({ _tag: 'Given' as const, reason, words })
}

// --- the files of a draft ----------------------------------------------------------------------

type Raw = Record<string, unknown>
const list = (value: unknown): ReadonlyArray<Raw> =>
  Array.isArray(value) ? (value as ReadonlyArray<Raw>) : []
// A revise as the typed event holds it: the Schema refuses what changes nothing.
const decodeRevise = Schema.decodeUnknownSync(ReviseFile)
const reviseOf = (file: string, built: unknown): Effect.Effect<ReviseFile, Refusal> => {
  try {
    return Effect.succeed(decodeRevise(built))
  } catch (e) {
    const what = (e as Error).message.replace(/\s*\n\s*/g, ' ')
    return fail(R.ReviseDirection.badFile(file, what))
  }
}
// A revise file as the typed event holds it: each rule has its supersedes; a missing key is absent.
const readRevise = (file: string, raw: unknown): Effect.Effect<ReviseFile, Refusal> =>
  Effect.gen(function* () {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Raw
    const bad = (what: string) => fail(R.ReviseDirection.badFile(file, what))
    const standardOf = (s: Raw, where: string) =>
      Effect.gen(function* () {
        if (typeof s?.id !== 'string' || typeof s?.says !== 'string') {
          return yield* bad(`${where} needs an id and says`)
        }
        if (s.when !== undefined) {
          return yield* bad(
            `standard ${s.id}: "when" is now "where" (the context where the standard applies)`,
          )
        }
        const wrongWhere = s.where === undefined ? undefined : whereProblem(s.id, s.where)
        if (wrongWhere !== undefined) return yield* bad(wrongWhere)
        const rules = []
        for (const [j, r] of list(s.rules).entries()) {
          if (typeof r?.id !== 'string' || typeof r?.says !== 'string') {
            return yield* bad(`rule ${j + 1} of ${s.id} needs an id and says`)
          }
          if (r.ref !== undefined && !Schema.is(RuleRef)(r.ref)) {
            return yield* bad(`rule ${r.id}: ref is file#anchor:lines, e.g. docs/x.md#tables:10-20`)
          }
          rules.push({
            id: r.id,
            says: r.says,
            ...(r.checkedBy !== undefined ? { checkedBy: String(r.checkedBy) } : {}),
            ...(r.test !== undefined ? { test: String(r.test) } : {}),
            ...(r.ref !== undefined ? { ref: String(r.ref) } : {}),
            ...(r.evidence !== undefined ? { evidence: r.evidence } : {}),
            supersedes: list(r.supersedes).map(String),
          })
        }
        return {
          id: s.id,
          says: s.says,
          ...(s.where !== undefined ? { where: s.where } : {}),
          rules,
        }
      })
    if (e.says !== undefined && typeof e.says !== 'string') return yield* bad('says is words')
    if (e.summary !== undefined && !(typeof e.summary === 'string' && e.summary.trim())) {
      return yield* bad('summary is one or two plain sentences: what the direction asks, and why')
    }
    // A new flow takes the place of the old one (Nanda, 2026-11-15: a direction has a flow).
    const flow =
      e.flow === undefined
        ? undefined
        : yield* readFlow(file, e.flow).pipe(Effect.mapError(asWrite(file)))
    const add = []
    for (const [i, s] of list(e.add).entries()) add.push(yield* standardOf(s, `standard ${i + 1}`))
    const replace = []
    for (const [i, r] of list(e.replace).entries()) {
      if (typeof r?.id !== 'string') return yield* bad(`replace ${i + 1} needs an id`)
      const w = yield* standardOf(r.with as Raw, `the standard of replace ${i + 1}`)
      replace.push({ id: r.id, with: w })
    }
    return yield* reviseOf(file, {
      ...(e.summary !== undefined ? { summary: e.summary as string } : {}),
      ...(flow !== undefined ? { flow } : {}),
      ...(e.says !== undefined ? { says: e.says as string } : {}),
      ...(e.add !== undefined ? { add } : {}),
      ...(e.remove !== undefined ? { remove: list(e.remove).map(String) } : {}),
      ...(e.replace !== undefined ? { replace } : {}),
    })
  })

// A where is a map of the closed context keys, each to a text or a list of texts (the words of
// readDirection, which reads the where of a new direction).
const whereProblem = (standard: string, where: unknown): string | undefined => {
  const at = `standard ${standard}: where`
  if (typeof where !== 'object' || where === null || Array.isArray(where)) {
    return `${at} is a map of context keys, like where: { section: introduction }`
  }
  const entries = Object.entries(where)
  if (entries.length === 0) {
    return `${at} names no key; leave it out, and the standard applies everywhere`
  }
  for (const [key, value] of entries) {
    const values: ReadonlyArray<unknown> = Array.isArray(value) ? value : [value]
    if (values.length === 0) return `${at} ${key} lists no value`
    if (!CONTEXT_KEYS.some((k) => k === key)) {
      return `${at} key "${key}" is not one of ${CONTEXT_KEYS.join(', ')}`
    }
    if (values.some((v) => typeof v !== 'string')) {
      return `${at} ${key} is a text, like ${key}: introduction`
    }
  }
  return undefined
}

// N8 (I8): a whole direction drafted again on a direction with a version is its revise, as an
// import is: a standard with other words is replaced, a new one added, a gone one removed.
const asRevise = (w: Work, file: DirectionFile, name: string): Effect.Effect<ReviseFile, Refusal> => {
  const now = currentOf(w, file.id as never)
  const was = now.standards.map((e) => standardAt(w, e))
  const shape = (s: {
    readonly says: string
    readonly where?: unknown
    readonly rules: ReadonlyArray<{
      readonly id: string
      readonly says: string
      readonly checkedBy?: string
      readonly test?: string
      readonly ref?: string
    }>
  }) =>
    JSON.stringify([
      s.says,
      s.where ?? null,
      s.rules.map((r) => [r.id, r.says, r.checkedBy ?? null, r.test ?? null, r.ref ?? null]),
    ])
  const shapeOf = (s: (typeof was)[number]) =>
    shape({
      says: s.says,
      where: whereRecord(s.where) ?? undefined,
      rules: s.rules.map((e) => {
        const r = ruleAt(w, e)
        const checkedBy = r.checkedBy._tag === 'Role' ? r.checkedBy.role : undefined
        return {
          id: r.id,
          says: r.says,
          ...(checkedBy ? { checkedBy } : {}),
          ...(r.test === undefined ? {} : { test: r.test }),
          ...(r.ref === undefined ? {} : { ref: r.ref }),
        }
      }),
    })
  const standard = (s: DirectionFile['standards'][number]) => ({
    ...s,
    rules: s.rules.map((r) => ({ ...r, supersedes: [] })),
  })
  const add = file.standards.filter((s) => !was.some((y) => y.id === s.id)).map(standard)
  const evidenceChanged = (before: (typeof was)[number], after: DirectionFile['standards'][number]) => {
    const rules = new Map(before.rules.map((e) => {
      const rule = ruleAt(w, e)
      return [rule.id, rule.evidence] as const
    }))
    return after.rules.some((r) => r.evidence !== undefined && !Bun.deepEquals(r.evidence, rules.get(r.id)))
  }
  const replace = file.standards
    .filter((s) => was.some((y) => y.id === s.id && (shapeOf(y) !== shape(s) || evidenceChanged(y, s))))
    .map((s) => ({ id: s.id, with: standard(s) }))
  const remove = was.filter((y) => !file.standards.some((s) => s.id === y.id)).map((y) => y.id)
  const flow = file.flow
  return reviseOf(name, {
    ...(file.summary !== now.summary ? { summary: file.summary } : {}),
    ...(JSON.stringify(flow) !== JSON.stringify(now.flow) ? { flow } : {}),
    ...(file.says !== now.says ? { says: file.says } : {}),
    ...(add.length ? { add } : {}),
    ...(remove.length ? { remove } : {}),
    ...(replace.length ? { replace } : {}),
  })
}

// --- drafts -------------------------------------------------------------------------------------

const DraftDirection: Action<'DraftDirection'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    yield* configUnchanged(d)
    yield* allowed(d, by, input)
    const { file, answers } = input.content
    const raw = yield* readYaml(d.moment.outside.cwd, file)
    const people = w.config.people
    const base = yield* readDirection(file, raw, people).pipe(Effect.mapError(asWrite(file)))
    const why = yield* whyOf(input.content.why)
    const existing = w.directions.get(base.id as never)
    if (existing?.source._tag === 'External') return yield* fail(R.DraftDirection.company(base.id))
    if (existing?._tag === 'Official') {
      // N8: the whole file of a direction with a version is its revise, by a model run (a host
      // revises a direction, ruling 2026-11-14).
      const keys = [
        ...(base.name !== existing.name ? ['name'] : []),
        ...(base.owner !== existing.owner.name ? ['owner'] : []),
      ]
      if (keys.length) return yield* fail(R.DraftDirection.frameChanged(base.id, keys.join(', ')))
      const revise: ActionInput = {
        _tag: 'ReviseDirection',
        target: { direction: existing.id },
        content: input.content,
      }
      yield* allowed(d, by, revise)
      yield* answersFound(w, answers)
      const revised = { direction: existing.id, edit: yield* asRevise(w, base, file), answers, why }
      yield* checkRevised(d, by, revised)
      return [create('Revision', { _tag: 'Revised', ...revised })]
    }
    // A newly drafted live direction needs both fits. Existing versions use the revise check.
    const cases = casesProblem(base.id, base.flow, base.standards)
    if (cases !== undefined) return yield* Effect.fail(DRAFT.cases(`${file}: ${cases}`))
    yield* answersFound(w, answers)
    const drafted = { direction: base, answers, why }
    yield* checkDrafted(d, by, drafted)
    return [create('Revision', { _tag: 'Drafted', ...drafted })]
  })

const ReviseDirection: Action<'ReviseDirection'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d)
    yield* allowed(d, by, input)
    const { file, answers } = input.content
    const edit = yield* readRevise(file, yield* readYaml(d.moment.outside.cwd, file))
    yield* answersFound(d.moment.work, answers)
    const why = yield* whyOf(input.content.why)
    const revised = { direction: input.target.direction, edit, answers, why }
    yield* checkRevised(d, by, revised)
    return [create('Revision', { _tag: 'Revised', ...revised })]
  })

// The daily refresh: a commit of a company folder comes in as a draft of the whole direction.
const ImportCompany: Action<'ImportCompany'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const imported = { direction: input.target.direction, ...input.content }
    yield* checkImported(d, imported)
    return [create('Revision', { _tag: 'Imported', ...imported })]
  })

// A model gives a company draft of a new direction its flow in this project (its steps marked) and
// each rule's evidence with its cases (pass 3b: cases live on rules), before the accept (P10
// rejected, onboarding 2026-11-14); the latest counts. The file: { flow, rules: { <rule id>:
// <evidence> } }.
const AddExamples: Action<'AddExamples'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    yield* allowed(d, by, input)
    const { file } = input.content
    const raw = yield* readYaml(d.moment.outside.cwd, file)
    const given = (raw as { readonly flow?: unknown } | null)?.flow
    const flow = yield* readFlow(file, given).pipe(Effect.mapError(asWrite(file)))
    const x = draftAt(w, input.target.draft)
    const standards = x.standards.map((e) => {
      const s = standardAt(w, e)
      return { id: s.id, rules: s.rules.map((r) => ruleAt(w, r)) }
    })
    const marks = usesProblem(x.of, flow, standards)
    if (marks !== undefined) return yield* Effect.fail(DRAFT.uses(`${file}: ${marks}`))
    const givenRules = (raw as { readonly rules?: unknown } | null)?.rules ?? {}
    if (typeof givenRules !== 'object' || givenRules === null || Array.isArray(givenRules)) {
      return yield* Effect.fail(DRAFT.cases(`${file}: rules is a map of rule id to its evidence`))
    }
    const ids = new Set(standards.flatMap((s) => s.rules.map((r) => r.id)))
    const evidence: Array<readonly [string, RuleEvidence]> = []
    for (const [id, value] of Object.entries(givenRules)) {
      if (!ids.has(id)) return yield* Effect.fail(DRAFT.cases(`${file}: ${id} is not a rule of the draft`))
      const decoded = Schema.decodeUnknownResult(RuleEvidence)(value)
      if (decoded._tag === 'Failure') {
        return yield* Effect.fail(DRAFT.cases(`${file}: rules.${id}: ${String(decoded.failure)}`))
      }
      evidence.push([id, decoded.success])
    }
    const given2 = new Map(evidence)
    const withCases = standards.map((s) => ({
      id: s.id,
      rules: s.rules.map((r) => {
        const e = given2.get(r.id) ?? r.evidence
        return e === undefined ? { id: r.id } : { id: r.id, evidence: e }
      }),
    }))
    const cases = casesProblem(x.of, flow, withCases)
    if (cases !== undefined) return yield* Effect.fail(DRAFT.cases(`${file}: ${cases}`))
    return [move('Revision', input.target.draft, { _tag: 'ExamplesAdded', flow, evidence })]
  })

// --- the owner's decision, sources -------------------------------------------------------

// The owner (the person) accepts or rejects a draft; the fold makes the version of an accept.
const Accept: Action<'Accept'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d)
    yield* allowed(d, by, input)
    const { reason } = input.content
    const comment = reason !== null && isNonBlank(reason) ? reason : null
    const of = { _tag: 'Revision' as const, id: input.target.of.id, evidence: [] }
    return [create('Review', { _tag: 'Accept', of, reason: comment })]
  })

const Reject: Action<'Reject'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d)
    yield* allowed(d, by, input)
    const { id } = input.target.of
    const { reason } = input.content
    if (blank(reason)) return yield* fail(R.Reject.noReason(id))
    const of = { _tag: 'Revision' as const, id, reason: reason as never }
    return [create('Review', { _tag: 'Reject', of })]
  })

// An outside source that the host read: a new revision moves it; the same one only renews it.
const ReadSource: Action<'ReadSource'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { name } = input.target
    const { revision } = input.content
    const now = d.moment.work.sources.get(name)
    if (now?._tag === 'Outside' && now.revision === revision) {
      return [move('Source', name as never, { _tag: 'Checked' })]
    }
    const source = { _tag: 'Outside' as const, name, revision }
    return [create('Source', { _tag: 'Moved', source })]
  })

export const ACTIONS = {
  DraftDirection,
  ReviseDirection,
  ImportCompany,
  AddExamples,
  Accept,
  Reject,
  ReadSource,
}
