// The actions of reviews, escalations, questions, notes, evaluations, checkpoints and sources, with
// their content checks (the rules that the evidence and the points name, the place of the
// evidence).
import { Effect } from 'effect'
import type { Derived } from '../derived/index.ts'
import { turnOf, waitsForWords } from '../derived/deciders.ts'
import {
  actsOf,
  decidesResults,
  deciderOf,
  decidingNow,
  isOpenTask,
  roleNameOf,
  rootOf,
  rulesOf,
  sameRole,
  standardAt,
  ruleAt,
  within,
} from '../derived/reads.ts'
import type { Refusal } from '../schema/errors.ts'
import {
  type Assignment,
  type Author,
  create,
  type DeciderLeaf,
  currentVersion,
  type EvidenceData,
  move,
  type Result,
  type ResultId,
  type Rule,
  type Work,
} from '../schema/index.ts'
import {
  agentOf,
  allowed,
  blank,
  byOf,
  configUnchanged,
  current,
  no,
  type RefusalsOf,
  tierOfAgent,
} from './support.ts'
import type { Action } from './types.ts'

const EVIDENCE_FORM =
  '--evidence="<rule id> | <where you read in the result> | <what you saw there>", one for each ' +
  'rule in your checks; with no rule: --evidence="<where you read> | <what you saw there>"'

// The refusals that the reviews share: the rules that they name, the evidence, a changed work.
const REVIEW = {
  noRule: (rule: string) =>
    no(`there is no rule "${rule}" in an official version`, 'Pick', 'name a rule of a version'),
  changed: (result: string) =>
    no(
      `the work changed after ${result} was reported`,
      'Wait',
      'the maker reports it again as a new attempt; review that result',
    ),
  changedForLow: (result: string) =>
    no(
      `the work changed after ${result} was reported`,
      'Escalate',
      `escalate that the work changed after ${result} was reported`,
    ),
  evidenceWhere: (about: string, where: string, output: string) =>
    no(
      `the evidence for ${about} says where "${where}"; name the place in ${output}`,
      'Write',
      `write the place in ${output} where you looked`,
    ),
  evidenceWhat: (about: string, what: string) =>
    no(
      `the evidence for ${about} says what "${what}"; say what you saw, in a sentence of words`,
      'Write',
      'write what you saw, in a sentence',
    ),
} satisfies RefusalsOf

export const REFUSALS = {
  Accept: {
    ...REVIEW,
    outsideChecks: (named: string, checks: string) =>
      no(`${named} is not in your checks: ${checks}`, 'Pick', 'give evidence for your own checks'),
    missingChecks: (missing: string) =>
      no(`no --evidence for: ${missing}`, 'Write', `write the evidence for ${missing}`),
    noEvidence: () => no(`an accept needs ${EVIDENCE_FORM}`, 'Write', 'write the evidence'),
    draftEvidence: (draft: string) =>
      no(
        `an accept of ${draft} needs --evidence="<where you read in it> | <what you saw there>"`,
        'Write',
        `write where you read in ${draft} and what you saw there`,
      ),
  },
  Reject: {
    ...REVIEW,
    noPoint: () => no('a reject needs at least one --point', 'Write', 'write what is wrong'),
    blankPoint: () => no('a Reject needs a reason', 'Write', 'write what is wrong in each point'),
    noReason: (target: string) =>
      no(`a reject of ${target} needs --reason="<why>"`, 'Write', `write why ${target} is wrong`),
    taskRule: (rule: string) =>
      no(
        `a Reject of a task names no rule; reject a result for ${rule}, or give the point with ` +
          'no rule',
        'Pick',
        `reject a result for ${rule}, or name no rule`,
      ),
    notChecked: (task: string, rule: string, holder: string) =>
      no(
        `${task} is not checked by ${rule}` +
          (holder ? `; it is a rule of ${holder}: reject the result of ${holder}` : ''),
        'Pick',
        holder ? `reject the result of ${holder}` : 'name a rule of the task',
      ),
    notYourTurn: (role: string, waits: string) =>
      no(
        `${role} decides this result after the accept of ${waits}`,
        'Wait',
        `decide it after ${waits}, or reject it for one of your own rules`,
      ),
  },
  Recheck: {
    noReason: () => no('a Reject needs a reason', 'Write', 'write what changed outside'),
  },
  EscalateResult: {
    noReason: () =>
      no(
        'an escalation needs a reason',
        'Write',
        'write the refusal or the fact, and what you tried',
      ),
  },
  EscalateTask: {
    noReason: () =>
      no(
        'an escalation needs a reason',
        'Write',
        'write the refusal or the fact, and what you tried',
      ),
  },
  Resolve: {
    ...REVIEW,
    noResolution: () =>
      no(
        'a resolve needs its words: --resolution="<the agreement, or the direction>"',
        'Write',
        'write the agreement, or the direction',
      ),
  },
  Ask: {
    noText: () => no('a question needs its text', 'Write', 'write the question'),
  },
  Answer: {
    noText: () => no('an answer needs its text', 'Write', 'write the answer'),
  },
  Note: {
    noText: () => no('a note needs its text', 'Write', 'write the note'),
  },
  Evaluate: {
    noWrongWhy: () =>
      no(
        'an evaluation says what is wrong and why the task cannot be done as asked',
        'Write',
        'write what is wrong, and why',
      ),
    noImprove: () =>
      no(
        'an evaluation says what to improve, so that the task can continue',
        'Write',
        'write what to improve',
      ),
  },
  Checkpoint: {
    noNext: () =>
      no('a checkpoint needs --next="<what comes next>"', 'Write', 'write what comes next'),
  },
  ReadSource: {},
} satisfies Readonly<Record<string, RefusalsOf>>
const R = REFUSALS

const fail = <A = never>(r: Refusal): Effect.Effect<A, Refusal> => Effect.fail(r)

// --- the reads of a review ----------------------------------------------------------------------

// A rule by its id in the official versions now.
const findRule = (w: Work, id: string): Rule | undefined => {
  for (const d of w.directions.values()) {
    if (d._tag !== 'Official') continue
    for (const e of currentVersion(d).standards) {
      const rule = standardAt(w, e)
        .rules.map((r) => ruleAt(w, r))
        .find((r) => r.id === id)
      if (rule) return rule
    }
  }
  return undefined
}
const rulesNamed = (w: Work, ids: ReadonlyArray<string | null>): Effect.Effect<void, Refusal> => {
  const missing = ids.find((id): id is string => id !== null && findRule(w, id) === undefined)
  return missing === undefined ? Effect.void : fail(REVIEW.noRule(missing))
}
// The rules that an agent gives evidence for: a low checker's own checks, else its task's rules.
const rulesForAgent = (d: Derived, a: Assignment): ReadonlyArray<Rule> => {
  const w = d.moment.work
  const reviews = actsOf(w, a.id, d.moment.at).some(
    (x) => x._tag === 'Review' || x._tag === 'Approve',
  )
  const all = rulesOf(w, a.task)
  if (tierOfAgent(w, a) !== 'low' || !reviews) return all
  return all.filter((r) => r.checkedBy._tag === 'Role' && r.checkedBy.role === a.role)
}
// An agent's evidence names the place it looked and says what it saw in at least three words.
const checkEvidence = (result: Result, evidence: ReadonlyArray<EvidenceData>) => {
  const [file = '', section] = result.output.split(/[#@]/)
  const base = file.split('/').at(-1)
  for (const e of evidence) {
    const about = e.rule ?? 'the result'
    const where = e.where.toLowerCase()
    const places = [file, base, section].filter((x): x is string => Boolean(x))
    if (!places.some((x) => where.includes(x.toLowerCase()))) {
      return fail(REVIEW.evidenceWhere(about, e.where, result.output))
    }
    const words = e.what.split(/\s+/).filter((x) => /[a-z]{2,}/i.test(x))
    if (words.length < 3 || e.what.trim().toLowerCase() === e.where.trim().toLowerCase()) {
      return fail(REVIEW.evidenceWhat(about, e.what))
    }
  }
  return Effect.void
}
// The reviewed work must be the reported work (Outside.changed: its digest now differs).
const unchanged = (d: Derived, by: Author, result: Result) => {
  if (!d.moment.outside.changed.has(result.id)) return Effect.void
  const a = agentOf(d.moment.work, by)
  const low = a !== undefined && tierOfAgent(d.moment.work, a) === 'low'
  return fail(low ? REVIEW.changedForLow(result.id) : REVIEW.changed(result.id))
}
const nonEmpty = <A>(list: ReadonlyArray<A>): readonly [A, ...Array<A>] | undefined => {
  const [first, ...rest] = list
  return first === undefined ? undefined : [first, ...rest]
}

// --- accept and reject ---------------------------------------------------------------------------

// The config that a review reads is the stored one; the checks and the event come after it.
const configRead = (by: Author) =>
  Effect.flatMap(current, (d) => (by._tag === 'Program' ? Effect.void : configUnchanged(d, by)))

// The checks and the event of an accept, after the read of the config.
const accepted: Action<'Accept'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    const { of } = input.target
    const { evidence, reason } = input.content
    // The person's accept of a draft needs no evidence; anyone else says where it read. As in the
    // old CLI, this comes before the state checks, after the one that a low role reviews no draft.
    const a = agentOf(w, by)
    const low = a !== undefined && tierOfAgent(w, a) === 'low'
    const said = evidence.some((e) => e.where.trim() !== '' && e.what.trim() !== '')
    if (of._tag === 'Revision' && by._tag !== 'Person' && !low && !said) {
      return yield* fail(R.Accept.draftEvidence(of.id))
    }
    yield* allowed(d, by, input)
    yield* rulesNamed(
      w,
      evidence.map((e) => e.rule),
    )
    const given = nonEmpty(evidence)
    const comment = reason ?? null
    if (of._tag === 'Result') {
      const result = w.results.get(of.id)
      if (result === undefined) return yield* Effect.die('canAct names the result')
      yield* unchanged(d, by, result)
      if (a !== undefined) {
        const checks = rulesForAgent(d, a).map((r) => r.id)
        const named = evidence.flatMap((e) => (e.rule === null ? [] : [e.rule]))
        const outside = named.filter((r) => !checks.includes(r))
        if (outside.length && low) {
          return yield* fail(
            R.Accept.outsideChecks(outside.join(', '), checks.join(', ') || 'none'),
          )
        }
        const missing = low ? checks.filter((r) => !named.includes(r)) : []
        if (missing.length) return yield* fail(R.Accept.missingChecks(missing.join(', ')))
        yield* checkEvidence(result, evidence)
      }
      if (given === undefined) return yield* fail(R.Accept.noEvidence())
      const accepted = { _tag: 'Result' as const, id: of.id, evidence: given }
      return [create('Review', { _tag: 'Accept', of: accepted, reason: comment })]
    }
    if (of._tag === 'Revision') {
      const accepted = { _tag: 'Revision' as const, id: of.id, evidence }
      return [create('Review', { _tag: 'Accept', of: accepted, reason: comment })]
    }
    if (given === undefined) return yield* fail(R.Accept.noEvidence())
    const accepted = { _tag: 'Evaluation' as const, id: of.id, evidence: given }
    return [create('Review', { _tag: 'Accept', of: accepted, reason: comment })]
  })

// A Reject of a result names its points (a point may name the rule it breaks); a Reject of a task
// names points with no rule; a Reject of a draft or an evaluation gives its reason.
// A point's rule is a rule of the result's task; another task's rule is its own result's.
const pointOffTask = (
  w: Work,
  result: ResultId,
  points: ReadonlyArray<{ readonly breaks: string | null }>,
): Refusal | undefined => {
  const task = w.results.get(result)?.task
  if (task === undefined) return undefined
  for (const p of points) {
    const rule = p.breaks === null ? undefined : findRule(w, p.breaks)
    if (rule === undefined || rulesOf(w, task).some((r) => r.entry === rule.entry)) continue
    const holder = [...w.tasks.values()].find(
      (t) =>
        isOpenTask(t) &&
        t.id !== task &&
        within(w, t.id, rootOf(w, task)) &&
        rulesOf(w, t.id).some((r) => r.entry === rule.entry),
    )
    return R.Reject.notChecked(task, rule.id, holder?.id ?? '')
  }
  return undefined
}

const rejected: Action<'Reject'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    const { of } = input.target
    const { points, reason } = input.content
    // As the old engine (round5 R5-F5): the rule of a point comes before who decides and when; a
    // low agent hears first that it reviews only the result of its brief.
    const a = agentOf(w, by)
    const low = a !== undefined && tierOfAgent(w, a) === 'low'
    const offTask = of._tag === 'Result' ? pointOffTask(w, of.id, points) : undefined
    if (offTask !== undefined && !low) return yield* fail(offTask)
    yield* allowed(d, by, input)
    if (of._tag === 'Revision' || of._tag === 'Evaluation') {
      if (blank(reason)) return yield* fail(R.Reject.noReason(of.id))
      const said = { _tag: of._tag, id: of.id, reason: reason as never }
      return [create('Review', { _tag: 'Reject', of: said } as never)]
    }
    const first = nonEmpty(points)
    if (first === undefined) return yield* fail(R.Reject.noPoint())
    yield* rulesNamed(
      w,
      points.map((p) => p.breaks),
    )
    if (points.some((p) => blank(p.text))) return yield* fail(R.Reject.blankPoint())
    if (of._tag === 'Task') {
      const ruled = points.find((p) => p.breaks !== null)
      if (ruled) return yield* fail(R.Reject.taskRule(ruled.breaks ?? ''))
      const taskPoints = first.map((p) => ({ text: p.text as never })) as never
      return [
        create('Review', { _tag: 'Reject', of: { _tag: 'Task', id: of.id, points: taskPoints } }),
      ]
    }
    const result = w.results.get(of.id)
    if (result === undefined) return yield* Effect.die('canAct names the result')
    const task = result.task
    if (offTask !== undefined) return yield* fail(offTask)
    // A decider out of its turn rejects only as a checker: a point names one of its own rules.
    const actor = byOf(w, by)
    const who = deciderOf(w, of.id)
    if (actor !== undefined && who !== undefined && decidesResults(w, actor, of.id, d.moment.at)) {
      const now = decidingNow(w, of.id)
      const inTurn = turnOf(who, { by: actor, when: d.moment.at }, now, sameRole(w))
      const role = roleNameOf(w, actor)
      const own = rulesOf(w, task).filter(
        (r) => r.checkedBy._tag === 'Role' && r.checkedBy.role === role,
      )
      const asChecker = points.some((p) => own.some((r) => r.id === p.breaks))
      if (!inTurn && own.length > 0 && !asChecker) {
        const waits = waitsForWords<DeciderLeaf>(who, now, sameRole(w))
        return yield* fail(R.Reject.notYourTurn(role ?? 'person', waits))
      }
    }
    const resultPoints = first.map((p) => ({ text: p.text as never, breaks: p.breaks })) as never
    return [
      create('Review', { _tag: 'Reject', of: { _tag: 'Result', id: of.id, points: resultPoints } }),
    ]
  })

const Recheck: Action<'Recheck'> = ({ by, input }) =>
  Effect.gen(function* () {
    yield* allowed(yield* current, by, input)
    const { reason } = input.content
    if (blank(reason)) return yield* fail(R.Recheck.noReason())
    return [create('Review', { _tag: 'Recheck', of: input.target.result, reason: reason as never })]
  })

// --- escalations ---------------------------------------------------------------------------------

// N11 (B6): a second escalation of a result while the agent's own one is open makes no event.
const EscalateResult: Action<'EscalateResult'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    const { result } = input.target
    const a = agentOf(w, by)
    const open = [...w.reviews.values()].some(
      (v) =>
        v._tag === 'Escalate' &&
        v.of === result &&
        a !== undefined &&
        v.by === a.id &&
        d.states.escalations.get(v.id as never)?._tag === 'Open',
    )
    if (open) return []
    yield* allowed(d, by, input)
    const { reason } = input.content
    if (blank(reason)) return yield* fail(R.EscalateResult.noReason())
    return [create('Review', { _tag: 'Escalate', of: result, reason: reason as never })]
  })

// A maker sends its blocked task up as a question. N11: while its own question on the task is
// open, a second one makes no event.
const EscalateTask: Action<'EscalateTask'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    const a = agentOf(w, by)
    const open =
      a !== undefined &&
      [...w.questions.values()].some(
        (q) =>
          q.from === a.id && q.stops === a.task && d.states.questions.get(q.id)?._tag === 'Open',
      )
    if (open) return []
    yield* allowed(d, by, input)
    const { reason } = input.content
    if (blank(reason)) return yield* fail(R.EscalateTask.noReason())
    return [create('Question', { _tag: 'Escalated', text: reason as never })]
  })

// The answerer of an escalation resolves it in words; evidence is about the reported work.
const resolved: Action<'Resolve'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    yield* allowed(d, by, input)
    const { escalation } = input.target
    const { resolution, evidence } = input.content
    if (blank(resolution)) return yield* fail(R.Resolve.noResolution())
    yield* rulesNamed(
      w,
      evidence.map((e) => e.rule),
    )
    const escalated = w.reviews.get(escalation)
    const result = escalated?._tag === 'Escalate' ? w.results.get(escalated.of) : undefined
    if (evidence.length > 0 && result !== undefined) {
      yield* unchanged(d, by, result)
      if (agentOf(w, by) !== undefined) yield* checkEvidence(result, evidence)
    }
    const resolve = {
      _tag: 'Resolve' as const,
      escalation,
      resolution: resolution as never,
      evidence,
    }
    return [create('Review', resolve)]
  })

// --- questions and notes -------------------------------------------------------------------------

const Ask: Action<'Ask'> = ({ by, input }) =>
  Effect.gen(function* () {
    yield* allowed(yield* current, by, input)
    const { text } = input.content
    if (blank(text)) return yield* fail(R.Ask.noText())
    const to = input.target.to === 'Owner' ? { _tag: 'Owner' as const } : { _tag: 'Above' as const }
    return [create('Question', { _tag: 'Asked', text: text as never, to })]
  })

// N12 (C2): an answer to a question whose task ended makes no event.
const Answer: Action<'Answer'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const { question } = input.target
    if (d.states.questions.get(question)?._tag === 'Irrelevant') return []
    yield* allowed(d, by, input)
    const { text } = input.content
    if (blank(text)) return yield* fail(R.Answer.noText())
    return [move('Question', question, { _tag: 'Answered', text: text as never })]
  })

const Note: Action<'Note'> = ({ by, input }) =>
  Effect.gen(function* () {
    yield* allowed(yield* current, by, input)
    const { kind, text } = input.content
    if (blank(text)) return yield* fail(R.Note.noText())
    return [create('Note', { _tag: kind, about: input.target.task, text: text as never })]
  })

const Evaluate: Action<'Evaluate'> = ({ by, input }) =>
  Effect.gen(function* () {
    yield* allowed(yield* current, by, input)
    const { wrong, why, improve, level } = input.content
    if (blank(wrong) || blank(why)) return yield* fail(R.Evaluate.noWrongWhy())
    if (improve.some((x) => blank(x))) return yield* fail(R.Evaluate.noImprove())
    const evaluation = {
      _tag: 'Evaluation' as const,
      stop: input.target.stop,
      wrong: wrong as never,
      why: why as never,
      improve: improve as never,
      level,
    }
    return [create('Evaluation', evaluation)]
  })

const Checkpoint: Action<'Checkpoint'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    yield* allowed(d, by, input)
    const { task } = input.target
    const { next } = input.content
    if (blank(next)) return yield* fail(R.Checkpoint.noNext())
    return [create('Checkpoint', { _tag: 'Checkpoint', task, next: next as never })]
  })

// An outside source that an agent read: a new revision moves it; the same one only renews when
// it was seen. N4 (I4): a git source's revision is git's, so naming it makes no event.
const ReadSource: Action<'ReadSource'> = ({ by, input }) =>
  Effect.gen(function* () {
    const d = yield* current
    const w = d.moment.work
    yield* allowed(d, by, input)
    const { name } = input.target
    const { revision } = input.content
    const git = [...w.tasks.values()].some((t) =>
      t.descriptionAi.workspace.some((x) => x._tag === 'Repo' && x.source === name),
    )
    if (git) return []
    const now = w.sources.get(name)
    if (now?._tag === 'Outside' && now.revision === revision) {
      return [move('Source', name as never, { _tag: 'Checked' })]
    }
    const source = { _tag: 'Outside' as const, name, revision }
    return [create('Source', { _tag: 'Moved', source })]
  })

const Accept: Action<'Accept'> = (call) => Effect.andThen(configRead(call.by), accepted(call))
const Reject: Action<'Reject'> = (call) => Effect.andThen(configRead(call.by), rejected(call))
const Resolve: Action<'Resolve'> = (call) =>
  Effect.andThen(
    Effect.flatMap(current, (d) => configUnchanged(d, call.by)),
    resolved(call),
  )

// The acts that a forward carries for the person, with no read of the config: the forward's dry
// run and the confirm check them as the person's own act now (the old checkAct of the inner act).
export const PERSON_ACTS = {
  Accept: accepted,
  Reject: rejected,
  Resolve: resolved,
  Answer,
  Note,
}

export const ACTIONS = {
  Accept,
  Reject,
  Recheck,
  EscalateResult,
  EscalateTask,
  Resolve,
  Ask,
  Answer,
  Note,
  Evaluate,
  Checkpoint,
  ReadSource,
}
