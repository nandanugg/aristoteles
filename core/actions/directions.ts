// The actions of directions, suggestions, permissions and forwards. The content checks of a draft
// are in drafts.ts.
import { Effect } from 'effect'
import type { Derived } from '../derived/index.ts'
import { currentOf, labelOf, ruleAt, standardAt, within } from '../derived/reads.ts'
import type { ActionInput, InputOf, WhyInput } from '../schema/actions.ts'
import type { Refusal } from '../schema/errors.ts'
import {
  type Author,
  CONTEXT_KEYS,
  create,
  type Direction,
  type DirectionFile,
  type Event,
  type ForwardedAct,
  lookup,
  move,
  oneOf,
  REASONS,
  type ReviseFile,
  type Why,
  type Work,
  whereRecord,
} from '../schema/index.ts'
import { readApprovedBy, readDirection } from '../services/index.ts'
import { decidersOf } from '../state/decisions.ts'
import {
  answersFound,
  checkDrafted,
  checkImported,
  checkRevised,
  DRAFT,
  reviseAnswersFound,
} from './drafts.ts'
import { PERSON_ACTS } from './reviews.ts'
import {
  agentOf,
  allowed,
  asPick,
  asWrite,
  blank,
  configUnchanged,
  current,
  no,
  readYaml,
  type RefusalsOf,
} from './support.ts'
import type { Action, ActionServices } from './types.ts'

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

export const REFUSALS = {
  DraftDirection: {
    ...WHY,
    ...DRAFT,
    company: (id: string) =>
      no(
        `${id} is a company direction; it changes in its repo`,
        'Escalate',
        `suggest the change of ${id}; its repo takes a pull request`,
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
  Suggest: {
    noWords: () =>
      no('a suggestion says something: give its words', 'Write', 'write what you suggest'),
    noKey: (key: string) =>
      no(
        `there is no rule "${key}" in an official version`,
        'Pick',
        'name a direction, a standard or a rule of a version',
      ),
  },
  Grant: {
    past: (until: string) => no(`--until=${until} is in the past`, 'Pick', 'give a time after now'),
    noTarget: (id: string) =>
      no(`there is no task ${id}`, 'Pick', 'name an official direction or a task'),
  },
  Revoke: {},
  Forward: {
    notPerson: (who: string) =>
      no(`${who} is not in the people of aristoteles.yaml`, 'Pick', 'name a person of the work'),
    noQuote: () =>
      no(
        'a forward needs --quote="<their exact words>"',
        'Write',
        "write the person's exact words",
      ),
    outsideTree: (target: string, a: string) =>
      no(`${target} is outside the task tree of ${a}`, 'Pick', 'forward an act on your own tree'),
    changed: (result: string) =>
      no(
        `the work changed after ${result} was reported`,
        'Wait',
        'the maker reports it again as a new attempt; forward the review of that result',
      ),
    could: (who: string, act: string, message: string, words: string) =>
      no(`${who} could not ${act} now: ${message}`, 'Pick', words),
    // The old next line of a forwarded answer that the person could not give.
    notTheirs: (who: string) =>
      no(
        `that question is not ${who}'s`,
        'Pick',
        `to bring ${who}'s fact to the work, ask it yourself (work ask --to=owner), then forward ` +
          `${who}'s answer to your question`,
      ),
    askEnded: (label: string) =>
      no(
        `${label} is finished, so it answers no question; ask an open assignment`,
        'Pick',
        'ask an open assignment',
      ),
  },
  Confirm: {
    could: (message: string, words: string) => no(message, 'Pick', words),
  },
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
          rules.push({
            id: r.id,
            says: r.says,
            ...(r.checkedBy !== undefined ? { checkedBy: String(r.checkedBy) } : {}),
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
    const add = []
    for (const [i, s] of list(e.add).entries()) add.push(yield* standardOf(s, `standard ${i + 1}`))
    const replace = []
    for (const [i, r] of list(e.replace).entries()) {
      if (typeof r?.id !== 'string') return yield* bad(`replace ${i + 1} needs an id`)
      const w = yield* standardOf(r.with as Raw, `the standard of replace ${i + 1}`)
      replace.push({ id: r.id, with: w })
    }
    return {
      ...(e.says !== undefined ? { says: e.says as string } : {}),
      ...(e.add !== undefined ? { add } : {}),
      ...(e.remove !== undefined ? { remove: list(e.remove).map(String) } : {}),
      ...(e.replace !== undefined ? { replace } : {}),
    } as unknown as ReviseFile
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
const asRevise = (w: Work, file: DirectionFile): ReviseFile => {
  const now = currentOf(w, file.id as never)
  const was = now.standards.map((e) => standardAt(w, e))
  const shape = (s: {
    readonly says: string
    readonly where?: unknown
    readonly rules: ReadonlyArray<{
      readonly id: string
      readonly says: string
      readonly checkedBy?: string
    }>
  }) =>
    JSON.stringify([
      s.says,
      s.where ?? null,
      s.rules.map((r) => [r.id, r.says, r.checkedBy ?? null]),
    ])
  const shapeOf = (s: (typeof was)[number]) =>
    shape({
      says: s.says,
      where: whereRecord(s.where) ?? undefined,
      rules: s.rules.map((e) => {
        const r = ruleAt(w, e)
        const checkedBy = r.checkedBy._tag === 'Role' ? r.checkedBy.role : undefined
        return { id: r.id, says: r.says, ...(checkedBy ? { checkedBy } : {}) }
      }),
    })
  const standard = (s: DirectionFile['standards'][number]) => ({
    ...s,
    rules: s.rules.map((r) => ({ ...r, supersedes: [] })),
  })
  const add = file.standards.filter((s) => !was.some((y) => y.id === s.id)).map(standard)
  const replace = file.standards
    .filter((s) => was.some((y) => y.id === s.id && shapeOf(y) !== shape(s)))
    .map((s) => ({ id: s.id, with: standard(s) }))
  const remove = was.filter((y) => !file.standards.some((s) => s.id === y.id)).map((y) => y.id)
  return {
    ...(file.says !== now.says ? { says: file.says } : {}),
    ...(add.length ? { add } : {}),
    ...(remove.length ? { remove } : {}),
    ...(replace.length ? { replace } : {}),
  } as unknown as ReviseFile
}

// The approvedBy of a file says what the direction's says: the owner (none named), or the same
// deciders.
const sameApprovedBy = (
  w: Work,
  file: Parameters<typeof decidersOf>[0] | undefined,
  now: Direction['approvedBy'],
): boolean => {
  if (file === undefined) return now._tag === 'Owner'
  if (now._tag === 'Owner') return false
  const roles = [...w.workflow.roles.keys()]
  return JSON.stringify(decidersOf(file, roles)) === JSON.stringify(now.deciders)
}

// --- drafts -------------------------------------------------------------------------------------

const DraftDirection: Action<'DraftDirection'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const { file, answers } = input.content
    const raw = yield* readYaml(d.moment.outside.cwd, file)
    const people = w.config.people
    const base = yield* readDirection(file, raw, people).pipe(Effect.mapError(asWrite(file)))
    const approvedBy = yield* readApprovedBy(file, raw, w.config.roles, people).pipe(
      Effect.mapError(asWrite(file)),
    )
    const why = yield* whyOf(input.content.why)
    const existing = w.directions.get(base.id as never)
    if (existing?.source._tag === 'External') return yield* fail(R.DraftDirection.company(base.id))
    if (existing?._tag === 'Official') {
      // N8: the whole file of a direction with a version is its revise, by an agent or by a model
      // run outside any task (a host revises a direction, ruling 2026-11-14).
      const keys = [
        ...(base.name !== existing.name ? ['name'] : []),
        ...(base.owner !== existing.owner.name ? ['owner'] : []),
        ...(sameApprovedBy(w, approvedBy, existing.approvedBy) ? [] : ['approvedBy']),
      ]
      if (keys.length) return yield* fail(R.DraftDirection.frameChanged(base.id, keys.join(', ')))
      const revise: ActionInput = {
        _tag: 'ReviseDirection',
        target: { direction: existing.id },
        content: input.content,
      }
      yield* allowed(d, by, revise)
      yield* reviseAnswersFound(w, by, answers)
      const revised = { direction: existing.id, edit: asRevise(w, base), answers, why }
      yield* checkRevised(d, by, revised)
      return [create('Revision', { _tag: 'Revised', ...revised })]
    }
    yield* answersFound(w, answers)
    const direction = approvedBy === undefined ? base : { ...base, approvedBy }
    const drafted = { direction, answers, why }
    yield* checkDrafted(d, by, drafted)
    return [create('Revision', { _tag: 'Drafted', ...drafted })]
  })

const ReviseDirection: Action<'ReviseDirection'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* configUnchanged(d, by)
    yield* allowed(d, by, input)
    const { file, answers } = input.content
    const edit = yield* readRevise(file, yield* readYaml(d.moment.outside.cwd, file))
    yield* reviseAnswersFound(d.moment.work, by, answers)
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

// --- suggestions and permissions -----------------------------------------------------------------

// What a suggestion is about, by its key: an official direction, else a standard of a current
// version, else a rule of one.
const aboutOf = (w: Work, key: string) => {
  const official = [...w.directions.values()].filter((x) => x._tag === 'Official')
  if (official.some((x) => x.id === key)) {
    return Effect.succeed({ _tag: 'Direction' as const, direction: key as never })
  }
  const standards = official.flatMap((x) =>
    currentOf(w, x.id).standards.map((e) => standardAt(w, e)),
  )
  if (standards.some((s) => s.id === key)) return Effect.succeed({ _tag: 'Standard' as const, key })
  const rules = standards.flatMap((s) => s.rules.map((e) => ruleAt(w, e)))
  if (rules.some((r) => r.id === key)) return Effect.succeed({ _tag: 'Rule' as const, key })
  return fail(R.Suggest.noKey(key))
}

const Suggest: Action<'Suggest'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { about } = input.target
    const { says } = input.content
    if (blank(says)) return yield* fail(R.Suggest.noWords())
    const key =
      about._tag === 'NewDirection'
        ? null
        : about._tag === 'Direction'
          ? about.direction
          : about.key
    const made =
      key === null ? { _tag: 'NewDirection' as const } : yield* aboutOf(d.moment.work, key)
    return [create('Suggestion', { _tag: 'Suggestion', about: made, says: says as never })]
  })

const Grant: Action<'Grant'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    yield* allowed(d, by, input)
    const { act, to } = input.target
    const { until } = input.content
    if (Date.parse(until) <= Date.parse(d.moment.at)) return yield* fail(R.Grant.past(until))
    // A change act covers official directions by their id, else tasks.
    if (act._tag === 'Change') {
      for (const id of act.changesOf) {
        const official = w.directions.get(id as never)?._tag === 'Official'
        if (!official && !w.tasks.has(id as never)) return yield* fail(R.Grant.noTarget(id))
      }
    }
    return [create('Permission', { _tag: 'Granted', act, to, until })]
  })

const Revoke: Action<'Revoke'> = ({ by, input }) =>
  Effect.gen(function* () {
    yield* allowed(yield* current, by, input)
    return [move('Permission', input.target.permission, { _tag: 'Revoked' })]
  })

// --- forwards ------------------------------------------------------------------------------------

// The CLI word of a forwarded act, for the words of its refusal.
const forwardWord = (inner: ForwardedAct): string => {
  if (inner._tag === 'Note') return 'comment'
  if (inner._tag === 'Question') return 'move' in inner ? 'answer' : 'ask'
  return inner.create._tag.toLowerCase()
}
// The record that an inner act is on, and the task of it.
const innerTarget = (w: Work, inner: ForwardedAct): { id: string; task: string | undefined } => {
  if (inner._tag === 'Note') return { id: inner.create.about, task: inner.create.about }
  if (inner._tag === 'Question') {
    if ('move' in inner) return { id: inner.id, task: w.questions.get(inner.id)?.stops }
    const a = w.assignments.get(inner.create.to.assignment)
    return { id: inner.create.to.assignment, task: a?.task }
  }
  const r = inner.create
  if (r._tag === 'Resolve') {
    const e = w.reviews.get(r.escalation)
    const result = e?._tag === 'Escalate' ? w.results.get(e.of) : undefined
    return { id: r.escalation, task: result?.task }
  }
  const of = r.of
  if (of._tag === 'Revision') return { id: of.id, task: undefined }
  if (of._tag === 'Task') return { id: of.id, task: of.id }
  return { id: of.id, task: w.results.get(of.id)?.task }
}
// The person could do the forwarded act now (the old CLI's dry run, and its check at the
// confirm): the person's own act runs with its checks of state and content, and its event is
// dropped. A question to an agent is no act of the person: its agent must still be open.
const personCould = (
  d: Derived,
  by: Author,
  inner: ForwardedAct,
): Effect.Effect<ReadonlyArray<Event>, Refusal, ActionServices> => {
  const w = d.moment.work
  if (inner._tag === 'Note') {
    const { about, text } = inner.create
    return PERSON_ACTS.Note({
      by,
      input: { _tag: 'Note', target: { task: about }, content: { kind: 'Message', text } },
    })
  }
  if (inner._tag === 'Question') {
    if ('move' in inner) {
      const content = { text: inner.move.text }
      return PERSON_ACTS.Answer({
        by,
        input: { _tag: 'Answer', target: { question: inner.id }, content },
      })
    }
    const asked = inner.create.to.assignment
    return Effect.gen(function* () {
      yield* lookup(w, asked, ['a']).pipe(Effect.mapError(asPick))
      if (d.states.assignments.get(asked)?._tag !== 'Ended') return []
      return yield* fail(R.Forward.askEnded(labelOf(w, asked)))
    })
  }
  const r = inner.create
  switch (r._tag) {
    case 'Resolve': {
      const content = { resolution: r.resolution, evidence: r.evidence }
      const input = { _tag: 'Resolve', target: { escalation: r.escalation }, content } as const
      return PERSON_ACTS.Resolve({ by, input })
    }
    case 'Accept': {
      const of =
        r.of._tag === 'Result'
          ? ({ _tag: 'Result', id: r.of.id } as const)
          : ({ _tag: 'Revision', id: r.of.id } as const)
      const content = { evidence: r.of.evidence, reason: r.reason }
      return PERSON_ACTS.Accept({ by, input: { _tag: 'Accept', target: { of }, content } })
    }
    case 'Reject': {
      const of = r.of
      const reject = (target: InputOf<'Reject'>['target'], content: InputOf<'Reject'>['content']) =>
        PERSON_ACTS.Reject({ by, input: { _tag: 'Reject', target, content } })
      switch (of._tag) {
        case 'Revision':
          return reject({ of: { _tag: 'Revision', id: of.id } }, { points: [], reason: of.reason })
        case 'Task': {
          const points = of.points.map((p) => ({ text: p.text, breaks: null }))
          return reject({ of: { _tag: 'Task', id: of.id } }, { points, reason: null })
        }
        case 'Result':
          return reject({ of: { _tag: 'Result', id: of.id } }, { points: of.points, reason: null })
      }
    }
  }
}

const Forward: Action<'Forward'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    yield* allowed(d, by, input)
    const { act } = input.target
    const { person, quote, channel } = input.content
    const a = agentOf(w, by)
    if (!w.config.people.includes(person)) return yield* fail(R.Forward.notPerson(person))
    if (blank(quote)) return yield* fail(R.Forward.noQuote())
    const target = innerTarget(w, act)
    if (a !== undefined && target.task !== undefined && !within(w, target.task as never, a.task)) {
      return yield* fail(R.Forward.outsideTree(target.id, a.id))
    }
    // Evidence is about the reported work, so that work must be unchanged.
    const accepted =
      act._tag === 'Review' && act.create._tag === 'Accept' ? act.create.of : undefined
    if (accepted?._tag === 'Result' && d.moment.outside.changed.has(accepted.id)) {
      return yield* fail(R.Forward.changed(accepted.id))
    }
    const asPerson: Author = { _tag: 'Person', name: person, channel: 'ui' }
    const what = `${forwardWord(act)} ${target.id}`
    // An answer that the person could not give is asked of the owner, then forwarded.
    const choiceOf = (r: Refusal) =>
      forwardWord(act) === 'answer' ? R.Forward.notTheirs(person).choice.words : r.choice.words
    yield* personCould(d, asPerson, act).pipe(
      Effect.mapError((r) => R.Forward.could(person, what, r.message, choiceOf(r))),
    )
    return [
      create('Forward', { _tag: 'Forwarded', person, quote: quote as never, channel, inner: act }),
    ]
  })

// N10 (C6): a confirm of a forward whose target was decided makes no event.
const Confirm: Action<'Confirm'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const { forward } = input.target
    if (d.states.forwards.get(forward)?._tag === 'Irrelevant') return []
    yield* allowed(d, by, input)
    const f = d.moment.work.forwards.get(forward)
    if (f?._tag === 'Confirmable' && by._tag === 'Person') {
      yield* personCould(d, by, f.inner).pipe(
        Effect.mapError((r) => R.Confirm.could(r.message, r.choice.words)),
      )
    }
    return [move('Forward', forward, { _tag: 'Confirmed' })]
  })

export const ACTIONS = {
  DraftDirection,
  ReviseDirection,
  ImportCompany,
  Suggest,
  Grant,
  Revoke,
  Forward,
  Confirm,
}
