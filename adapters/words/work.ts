// The words of the work model's told steps: the command of a step (with the basis `--on <seq>`
// where the act has one), the plain lines above it, and the maker's brief. The steps come from
// core/derived/work/obligations.ts (`dos`); this file only writes them.
import type { Step } from '../../core/derived/work/obligations.ts'
import type { Recorded } from '../../core/schema/index.ts'
import { appliesTo } from '../../core/state/work/items.ts'
import { depth, fx, uncovered } from '../../core/state/work/reads.ts'
import type { Act, ItemKey, Level, What, WhatTag, WorkState } from '../../core/state/work/types.ts'
import { HOST, kindOf } from '../../core/state/work/types.ts'

type Lines = ReadonlyArray<string>

// The acts the store accepted, in order.
const actsOf = (events: ReadonlyArray<Recorded>): ReadonlyArray<Act> =>
  events.flatMap((r) =>
    r.event._tag === 'Work' && r.event.create._tag === 'Acted' ? [r.event.create.act] : []
  )

// The points of a task, in order: its failed and raised reviews, its rejects, its send-backs.
export const pointsOf = (events: ReadonlyArray<Recorded>, task: string): ReadonlyArray<string> =>
  actsOf(events).flatMap(({ what: w }) =>
    w._tag === 'Review' && w.v !== 'Pass' && w.task === task
      ? w.points
      : w._tag === 'Reject' && w.task === task
      ? w.points
      : w._tag === 'SendBack' && w.fix === task
      ? w.points
      : []
  )

const lastAct = <T extends WhatTag>(
  events: ReadonlyArray<Recorded>,
  tag: T,
  at: (w: Extract<What, { _tag: T }>) => boolean,
): Extract<What, { _tag: T }> | undefined =>
  actsOf(events).map((a) => a.what).filter(
    (w): w is Extract<What, { _tag: T }> => w._tag === tag && at(w as Extract<What, { _tag: T }>),
  ).at(-1)

const taskOf = (s: WorkState, id: string | null) => s.tasks.get(id ?? '')

// --- the command of a step -----------------------------------------------------------------------

const ON = (seq: number): string => ` --on ${seq}`
const T = '<token>'
const POINTS = '--points="<...>"'

type Line = (s: WorkState, id: string, seq: number) => string
const none: Line = () => ''
// Every act has a line: a new What tag fails to compile until it has one.
const LINES: Readonly<Record<WhatTag, Line>> = {
  EndProject: () => 'work end',
  Answer: (_s, id) => `work answer ${id} --text="<...>"`,
  Accept: (_s, id, n) => `work accept ${id}${ON(n)}`,
  SendBack: (_s, id, n) => `work send-back ${id} ${POINTS}${ON(n)}`,
  Reject: (_s, id, n) => `work reject ${id} ${POINTS}${ON(n)}`,
  Decide: (_s, id, n) => `work decide ${id} take|again${ON(n)}`,
  Revive: (_s, id) => id === HOST ? 'work run continue' : `(the harness revives ${id})`,
  SendTask: (s) =>
    `work send ${T} --name="<...>" --goal="<...>" --sections=${uncovered(s).join(',')}` +
    ` --role=${[...s.cards.keys()].join('|')}`,
  Reassign: () => `work reassign ${T}`,
  TopDone: () => `work top-done ${T}`,
  AssignDo: (_s, id) => `work assign ${T} ${id}`,
  Review: (_s, id, n) =>
    `work review ${T} ${id} pass|fail|raise-tries|raise-no-rule|raise-misses ${POINTS}${ON(n)}`,
  Resume: (_s, id) => `work resume ${T} ${id}`,
  ReadBrief: () => `work brief ${T}`,
  Report: (_s, _id, n) => `work report ${T} --output="<...>"${ON(n)}`,
  Evaluate: (_s, id, n) =>
    `work evaluate ${T} ${id} split|fit|principle|direction|standard --summary="<...>"` +
    ` [--parts=<file>] [--role-draft=<file>]${ON(n)}`,
  Advance: (_s, id, n) => `work advance ${T} ${id}${ON(n)}`,
  WriteRule: (_s, id, n) => `work rule ${T} ${id} <rule-file>${ON(n)}`,
  RunTest: (_s, id, n) => `work rule-test ${T} ${id}${ON(n)}`,
  Ship: (_s, id, n) => `work ship ${T} ${id} <draft-file>${ON(n)}`,
  LoopReview: (_s, id, n) => `work loop ${T} ${id} person|revise${ON(n)}`,
  RecheckDone: (_s, id, n) => `work recheck ${T} ${id} holds|fails${ON(n)}`,
  RunRule: (_s, id) => `(the harness runs the rule tests on ${id})`,
  MoveHost: none,
  EditDirection: none,
  Ask: none,
  Exit: none,
}

// The command of a step; seq: the seq of the state the step was derived from.
export const stepLine = (s: WorkState, step: Step, seq: number): string =>
  LINES[step.tag](s, step.target ?? '', seq)

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
  const out = lastAct(events, 'Report', (w) => taskOf(s, s.makers.get(w.maker)?.task ?? null) === t)
  const rules = rulesOfTask(s, id)
  return [
    `Review task ${id}: ${t?.goal ?? ''}`,
    'The result:',
    ...outputLines(out?.output ?? '').map((l) => `  ${l}`),
    rules.length === 0
      ? 'No rule applies.'
      : `Rules that apply: ${rules.map((x) => itemWords(s, x)).join('; ')}`,
    `Try ${(t?.tries ?? 0) + 1} of ${s.maxTries}. Pass it, fail it with points, or raise it:`,
    'raise-tries: the tries are used. raise-no-rule: nothing says what is wrong.' +
    ' raise-misses: a rule says it and the maker missed it.',
  ]
}

const evaluateWords = (s: WorkState, id: string, events: ReadonlyArray<Recorded>): Lines => {
  const t = taskOf(s, id)
  const r = lastAct(events, 'Review', (w) => w.task === id && w.v !== 'Pass')
  const floor = t?.floor ?? 'Split'
  const refused = LEVELS.filter(([l]) => l !== 'Fit' && depth(l) < depth(floor)).map(([l]) => l)
  return [
    `Task ${id} was raised: ${REASONS[r?.v ?? ''] ?? 'by a review'}.`,
    ...(r === undefined || r.points.length === 0 ? [] : [`Points: ${r.points.join('; ')}`]),
    'Pick the level of the cause:',
    ...LEVELS.map(([, w]) => `  ${w}`),
    refused.length === 0
      ? `The floor of this task is ${floor}: every level is open.`
      : `The floor of this task is ${floor}: ${refused.join(', ')} are refused.`,
  ]
}

const fixWords = (s: WorkState, id: string, ask: string): Lines => {
  const sum = fx(s, id).summary
  return [`Fix ${id} waits for you.`, ...(sum === '' ? [] : [sum]), ask]
}

const taskGoal = (s: WorkState, id: string): string => taskOf(s, id)?.goal ?? ''
const makerTask = (s: WorkState, m: string): string => s.makers.get(m)?.task ?? ''

const stageWords = (s: WorkState, id: string): string => {
  const st = fx(s, id).stage
  return st === 'SPrinciple'
    ? 'Assess the principle behind the cause.'
    : st === 'SDirAssess'
    ? 'Assess the direction: does it say the right thing?'
    : 'Assess the standards: does one cover this?'
}

type Words = (s: WorkState, id: string, events: ReadonlyArray<Recorded>) => Lines
const noWords: Words = () => []
const WORDS: Readonly<Record<WhatTag, Words>> = {
  EndProject: () => ['Every task is done and the host returned the top.', 'End the project.'],
  Answer: (_s, id, ev) => [
    `${id} asks you:`,
    `  ${lastAct(ev, 'Ask', (w) => w.asker === id)?.question ?? ''}`,
    'Answer it with facts.',
  ],
  Accept: (s, id) => fixWords(s, id, 'Accept the draft as it is.'),
  SendBack: (s, id) => fixWords(s, id, 'Or send it back with the points to change.'),
  Reject: noWords,
  Decide: (s, id) => [
    `Task ${id} is raised past the rules: ${taskGoal(s, id)}`,
    ...(fx(s, id).summary === '' ? [] : [fx(s, id).summary]),
    'Take the result as it is, or send it again to evaluation.',
  ],
  Revive: (_s, id) =>
    id === HOST
      ? ['The host is down.', 'Start it again to go on.']
      : [`${id} is down.`, 'The harness starts it again.'],
  SendTask: (s) => [
    `Sections no task covers yet: ${uncovered(s).join(', ')}.`,
    `Send a task for some of them. Roles: ${[...s.cards.keys()].join(', ')}.`,
  ],
  Reassign: () => ['A fix is accepted.', 'Send the work it changes again.'],
  TopDone: () => ['Every task is done.', 'Return the top to the person.'],
  AssignDo: (s, id) => [`Task ${id} is sent to you: ${taskGoal(s, id)}`, 'Assign a maker for it.'],
  Review: reviewWords,
  Resume: (s, id) => [
    `The maker ${id} of task ${makerTask(s, id)} is down.`,
    'Resume it so it goes on.',
  ],
  ReadBrief: (_s, id) => [`You are maker ${id}.`, 'Read your brief first.'],
  Report: (s, id) => [
    `Make task ${makerTask(s, id)}: ${taskGoal(s, makerTask(s, id))}`,
    'Report the output when it is done.',
  ],
  Evaluate: evaluateWords,
  Advance: (s, id) => [`Fix ${id} climbs a level.`, stageWords(s, id)],
  WriteRule: (_s, id) => [`Fix ${id} needs a rule.`, 'Write it in a file with its evidence.'],
  RunTest: (_s, id) => [`Fix ${id} has a rule to test.`, 'Run it on its examples.'],
  Ship: (_s, id) => [`Fix ${id} is ready to draft.`, 'Write the items it changes in a file.'],
  LoopReview: (_s, id) => [
    `Review the draft of fix ${id}.`,
    'Hand it to the person, or revise it once more.',
  ],
  RecheckDone: (s, id) => [
    `Task ${id} is done, but items moved: ${[...taskOf(s, id)?.pend ?? []].join(', ')}.`,
    'Check the result still holds against them.',
  ],
  RunRule: (_s, id) => [`Task ${id} has test rules to run.`, 'The harness runs them.'],
  MoveHost: noWords,
  EditDirection: noWords,
  Ask: noWords,
  Exit: noWords,
}

// What the step is about and what the actor decides: 2-6 lines above the command.
export const stepWords = (
  s: WorkState,
  step: Step,
  events: ReadonlyArray<Recorded>,
): ReadonlyArray<string> => WORDS[step.tag](s, step.target ?? '', events)

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
    `  ${stepLine(s, { tag: 'Report', target: maker }, s.seq)}`,
  ]
}
