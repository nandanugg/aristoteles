// The words of the work model's told steps: the command of a step (with the basis `--on <seq>`
// where the act has one), the plain lines above it, and the maker's brief. The steps come from
// core/derived/c16/obligations.ts (`dos`); this file only writes them.
import type { ContextFacts, Recorded, RecheckBrief } from '../../core/schema/index.ts'
import { recheckInput } from '../../core/derived/c16/recheck.ts'
import { take } from '../../core/state/c16/effect.ts'
import { appliesTo, depth, fixOf, uncovered } from '../../core/state/c16/reads.ts'
import { initState, type WorkState } from '../../core/state/c16/state.ts'
import type { Body, Step } from '../../core/state/c16/types.ts'
import { kindOf, type ItemKey, type Level } from '../../core/state/c16/data.ts'
import type { NewToken } from '../../core/actions/work.ts'
import { launchOpening } from '../live/markers.ts'

type Lines = ReadonlyArray<string>

export const contextWords = (facts: ContextFacts): Lines => {
  const entries = Object.entries(facts)
  return entries.length ? [`Context: ${entries.map(([key, value]) => `${key}=${value}`).join(', ')}`] : []
}

// A token of the work model: w.<actor>.<ep>.<secret>. The actor may hold dots (a role name): the
// epoch (digits) and the secret (no dots) are the last two parts.
export const workTokenOf = (who: string, ep: number, secret: string): string =>
  `w.${who}.${ep}.${secret}`

// The first prompt of a revived pane (an argument of its launch command): who it is, its token,
// and its wait. Its steps come from work wait, one at a time.
export const launchWords = (actor: string, words: string, token: NewToken): string => {
  const t = workTokenOf(actor, token.ep, token.secret)
  return [
    `${launchOpening(actor)} ${words}`,
    `Your token is ${t}.`,
    `Run \`work wait ${t}\` now: it prints your next step. Do that step with the command it`,
    `prints, then run \`work wait ${t}\` again after every act. Never act without it.`,
  ].join(' ')
}

// The first prompt of a maker, which its role starts as a subagent with exactly these words: the
// same launch opening, so the marker line covers makers too.
export const makerWords = (actor: string, token: string): string =>
  `${launchOpening(actor)} Use the work skill. Your token is ${token}. ` +
  `Run \`work wait ${token}\`, and do what it prints.`

// Ask occurrences may already be closed. Recover their subjects from the accepted history.
const historyOf = (events: ReadonlyArray<Recorded>) => {
  let state: WorkState | undefined
  return events.flatMap(({ event }) => {
    if (event._tag !== 'Work') return []
    const entry = event.create
    if (entry._tag === 'Opened') {
      state = initState(entry.top, new Map(entry.items), new Map(entry.cards), entry.maxTries)
    }
    if (entry._tag !== 'Acted' || !state) return []
    const body = entry.act.body
    const ask = 'ask' in body ? state.asks.get(body.ask) : undefined
    const subject = ask && ask.about._tag !== 'None' ? ask.about.id
      : body._tag === 'Open' && body.open._tag === 'OpenReject' ? body.open.task : null
    state = take(state, entry.act)
    return [{ body, subject }]
  })
}

export const pointsOf = (events: ReadonlyArray<Recorded>, task: string): ReadonlyArray<string> =>
  historyOf(events).flatMap(({ body, subject }) => {
    if (subject !== task) return []
    if (body._tag === 'Review' && body.verdict !== 'Pass') return body.points
    if (body._tag === 'Respond' && body.reply === 'SendItBack') return body.points
    if (body._tag === 'Open' && body.open._tag === 'OpenReject') return body.open.points
    return []
  })

const lastAct = <T extends Body['_tag']>(
  events: ReadonlyArray<Recorded>, tag: T, task: string,
): Extract<Body, { _tag: T }> | undefined =>
  historyOf(events).findLast(({ body, subject }) => body._tag === tag && subject === task)
    ?.body as Extract<Body, { _tag: T }> | undefined

const taskOf = (s: WorkState, id: string | null) => s.tasks.get(id ?? '')

// --- the command of a step -----------------------------------------------------------------------

const ON = (seq: number): string => ` --on ${seq}`
const T = '<token>'
const POINTS = '--points="<...>"'

export const stepLine = (s: WorkState, step: Step, seq: number): string => {
  const target = step.fix ?? step.task ?? step.maker ?? ''
  const ask = step.ask ?? ''
  const basis = ON(seq)
  switch (step.act) {
    case 'EndProject': return 'work end'
    case 'AnswerQuestion': {
      const text = s.asks.get(ask)?.question?.form._tag === 'Single'
      return `work answer ${T} ${ask} ${text ? '--text="<...>"' : '--file=<answer.yaml>'}`
    }
    case 'Hear': return `work hear ${T} ${ask}`
    case 'Respond': return `work respond ${ask} accept|send-back|take|again${basis}`
    case 'Revive': return step.actor === 'host' ? 'work run continue'
      : `(the harness revives ${step.actor})`
    case 'Open': return step.ask === null
      ? `work send ${T} --name="<...>" --goal="<...>" --sections=${uncovered(s).join(',')}` +
        ` --role=${[...s.cards.keys()].join('|')}`
      : `work assign ${T} ${target}`
    case 'Reassign': return `work reassign ${T}`
    case 'TopDone': return `work top-done ${T}`
    case 'Review': return `work review ${T} ${ask} ` +
      `pass|fail|raise-tries|raise-no-rule|raise-misses ${POINTS}${basis}`
    case 'Resume': return `work resume ${T} ${step.maker ?? target}`
    case 'ReadBrief': return `work brief ${T}`
    case 'Report': return `work report ${T} ${ask} --output="<...>"${basis}`
    case 'Evaluate': return `work evaluate ${T} ${target} split|fit|principle|direction|standard` +
      ` --summary="<...>" [--parts=<file>] [--role-draft=<file>]${basis}`
    case 'Advance': return `work advance ${T} ${target}${basis}`
    case 'WriteRule': return `work rule ${T} ${target} <rule-file> [--fights=rule:<id>]${basis}`
    case 'RunTest': return `work rule-test ${T} ${target}${basis}`
    case 'Ship': return `work ship ${T} ${target} <draft-file> [--resolves]${basis}`
    case 'LoopReview': return `work loop ${T} ${target} person|revise --mode="<actual mode>"${basis}`
    case 'RecheckDone': return `work recheck ${T} ${target} holds|fails --items=<inspected-item-keys>${basis}`
    case 'RunRule': return `(the harness runs the rule tests on ${target})`
    default: return ''
  }
}

// --- the words above it --------------------------------------------------------------------------

const SHOWN = 20
const outputLines = (out: string): Lines => {
  const all = out.split('\n')
  const rest = all.length - SHOWN
  return rest > 0 ? [...all.slice(0, SHOWN), `... and ${rest} more lines`] : all
}

const itemWords = (s: WorkState, x: ItemKey): string => {
  const r = s.items.get(x)
  const kind = kindOf(x) === 'dir' ? 'direction' : kindOf(x) === 'std' ? 'standard' : 'rule'
  return `${kind} "${r?.name ?? x}" (version ${s.ver.get(x) ?? 0}): ${r?.says ?? ''}`
}
const evidenceWords = (s: WorkState, x: ItemKey): string => {
  const r = s.items.get(x)
  if (r === undefined || r.form === 'none') return 'No evidence is asked.'
  const test = r.test === null ? [] : [`a test command: ${r.test}`]
  const ref = r.ref === null ? [] : [`a reference: ${r.ref}`]
  return `Evidence: ${[...test, ...ref].join(' and ')}.`
}
const rulesOfTask = (s: WorkState, id: string): ReadonlyArray<ItemKey> => {
  const t = taskOf(s, id)
  return t === undefined ? [] : appliesTo(s, t).filter((x) => kindOf(x) === 'rule')
}

const LEVELS: ReadonlyArray<readonly [Level, string]> = [
  ['Split', 'split: the task is too big; cut it into parts for the roles.'],
  ['Fit', 'fit: the role has the wrong words; draft new ones.'],
  ['Principle', 'principle: the cause is a principle; the person decides.'],
  ['Direct', 'direction: the direction is wrong or silent here; amend it.'],
  ['Standard', 'standard: a standard or rule is missing or wrong; fix it.'],
]
const REASONS: Readonly<Record<string, string>> = {
  RaiseTries: 'the tries ran out',
  RaiseNoRule: 'no rule says what is wrong',
  RaiseMisses: 'a rule exists but the result missed it again',
}

const reviewWords = (s: WorkState, id: string, events: ReadonlyArray<Recorded>): Lines => {
  const t = taskOf(s, id)
  const out = lastAct(events, 'Report', id)
  const rules = rulesOfTask(s, id)
  return [
    `Review task ${id}: ${t?.goal ?? ''}`,
    'The result:',
    ...outputLines(out?.output ?? '').map((l) => `  ${l}`),
    rules.length === 0
      ? 'No rule applies.'
      : `Rules that apply: ${rules.map((x) => itemWords(s, x)).join('; ')}`,
    ...rules.flatMap((x) => (s.items.get(x)?.knownBreaks ?? []).map((spot) =>
      `Known break of ${s.items.get(x)?.name ?? x}: ${spot}. Raise it if you meet it in this review.`)),
    `Try ${(t?.tries ?? 0) + 1} of ${s.maxTries}. Pass it, fail it with points, or raise it:`,
    'raise-tries: the tries are used. raise-no-rule: nothing says what is wrong.' +
    ' raise-misses: a rule says it and the maker missed it.',
  ]
}

const evaluateWords = (s: WorkState, id: string, events: ReadonlyArray<Recorded>): Lines => {
  const t = taskOf(s, id)
  const r = lastAct(events, 'Review', id)
  const floor = t?.floor ?? 'Split'
  const refused = LEVELS.filter(([l]) => l !== 'Fit' && depth(l) < depth(floor)).map(([l]) => l)
  return [
    `Task ${id} was raised: ${REASONS[r?.verdict ?? ''] ?? 'by a review'}.`,
    ...(r === undefined || r.points.length === 0 ? [] : [`Points: ${r.points.join('; ')}`]),
    'Pick the level of the cause:',
    ...LEVELS.map(([, w]) => `  ${w}`),
    refused.length === 0
      ? `The floor of this task is ${floor}: every level is open.`
      : `The floor of this task is ${floor}: ${refused.join(', ')} are refused.`,
  ]
}

const fixWords = (s: WorkState, id: string, ask: string): Lines => {
  const sum = fixOf(s, id).summary
  return [`Fix ${id} waits for you.`, ...(sum === '' ? [] : [sum]), ask]
}

const taskGoal = (s: WorkState, id: string): string => taskOf(s, id)?.goal ?? ''
const makerTask = (s: WorkState, m: string): string => s.makers.get(m)?.task ?? ''

const stageWords = (s: WorkState, id: string): string => {
  const st = fixOf(s, id).stage
  return st === 'AtPrinciple'
    ? 'Assess the principle behind the cause.'
    : st === 'AtDirection'
    ? 'Assess the direction: does it say the right thing?'
    : 'Assess the standards: does one cover this?'
}

const draftStory = 'State what changes, why, what it affects, and one before/after example.'

export const recheckBriefWords = (id: string, on: number, brief: RecheckBrief): Lines => [
  `Recheck task ${id}: ${brief.goal}`,
  `Basis: --on ${on}`,
  `Sections: ${brief.sections.join(', ')}`,
  ...contextWords(brief.facts),
  ...(brief.output ? [`Reported result: ${brief.output}`] : []),
  ...(brief.files.length ? [`Result files: ${brief.files.join(', ')}`] : []),
  'Required items:',
  ...brief.rules.flatMap(({ item, version, says, reference, test, knownBreaks }) => [
    `  ${item} @${version}: ${says}`,
    ...(reference ? [`    Reference: ${reference}`] : []),
    ...(test ? [`    Test command: ${test}`] : []),
    ...knownBreaks.map((spot) => `    Known break: ${spot}`),
  ]),
  'Report the inspected item keys and versions with your evidence. Keep this basis.',
]

export const recheckBriefOf = (s: WorkState, id: string): Lines | undefined => {
  const input = recheckInput(s, id)
  return input ? recheckBriefWords(id, input.on, input.brief) : undefined
}

export const stepWords = (s: WorkState, step: Step, events: ReadonlyArray<Recorded>): Lines => {
  const id = step.fix ?? step.task ?? ''
  switch (step.act) {
    case 'Open': return step.ask === null
      ? [`Sections no task covers yet: ${uncovered(s).join(', ')}.`]
      : [`Task ${id} is sent to you: ${taskGoal(s, id)}`, 'Assign a maker for it.']
    case 'AnswerQuestion': {
      const a = s.asks.get(step.ask ?? '')
      const q = a?.question
      return q ? [`Question ${a?.id}: ${q.title}`, JSON.stringify(q.form)] : []
    }
    case 'Respond': return fixWords(s, id, 'Review the draft.')
    case 'Review': return reviewWords(s, id, events)
    case 'Evaluate': return [...evaluateWords(s, id, events), draftStory]
    case 'Advance': return [`Fix ${id} climbs a level.`, stageWords(s, id)]
    case 'ReadBrief': return [`You are maker ${step.maker}. Read your brief first.`]
    case 'Report': return [`Make task ${id}: ${taskGoal(s, id)}`]
    case 'Resume': return [`The maker ${step.maker} is down.`]
    case 'RecheckDone': return [
      `Task ${id} owes a recheck. Read work recheck-brief ${id} --on ${s.seq} before dispatching it.`,
    ]
    case 'Revive': return [`${step.actor} is down.`]
    case 'EndProject': return ['Every task is done and the host returned the top.']
    case 'TopDone': return ['Every task is done. Return the top to the person.']
    case 'Reassign': return ['A fix is accepted. Send the affected work again.']
    case 'WriteRule': return [`Fix ${id} needs a rule with evidence.`]
    case 'RunTest': return [`Fix ${id} has a rule to test.`]
    case 'Ship': return [`Fix ${id} is ready to draft.`, draftStory]
    case 'LoopReview': return [`Review the draft of fix ${id}.`, draftStory]
    default: return []
  }
}

// --- the maker's brief ---------------------------------------------------------------------------

// The brief of a maker: the task, what applies, every earlier point (newest last), the command.
export const briefOf = (
  s: WorkState,
  events: ReadonlyArray<Recorded>,
  maker: string,
): ReadonlyArray<string> => {
  const t = taskOf(s, makerTask(s, maker))
  if (t === undefined) return [`There is no maker ${maker}.`]
  const items = appliesTo(s, t)
  const points = pointsOf(events, t.id)
  return [
    `Task ${t.id}: ${t.name}`,
    `Goal: ${t.goal}`,
    `Sections: ${t.sections.join(', ')}`,
    ...contextWords(t.facts),
    ...(items.length === 0 ? ['No direction, standard or rule applies.'] : ['What applies:']),
    ...items.flatMap((x) => [
      `  ${itemWords(s, x)}`,
      ...(kindOf(x) === 'rule' ? [`    ${evidenceWords(s, x)}`] : []),
    ]),
    ...(points.length === 0
      ? []
      : [
        'Points of the earlier reviews, newest last:',
        ...points.map((p, n) => `  ${n + 1}. ${p}`),
      ]),
    'Report when done:',
    `  work report ${T} ${[...s.asks.values()].find((a) =>
      a.kind === 'Execute' && a.to._tag === 'Maker' && a.to.id === maker)?.id ?? '<ask>'}
      --output="<...>"${ON(s.seq)}`.replace(/\n\s+/g, ' '),
  ]
}

// The host's first words after the person ran `work run continue`: what the host does.
export const hostWords = (s: WorkState, token: string): Lines => [
  `You are the host of "${s.top.name}": ${s.top.goal}`,
  `Sections of the top: ${s.top.sections.join(', ')}.`,
  ...contextWords(s.top.facts),
  'You send the tasks that cover the sections of the top, one `work send` for each part; you',
  'reassign a task after the person accepts a change; you return the top when every task is done.',
  `Run work wait ${token} now, and again after every act: it prints your next step.`,
]
