// The words of onboarding before the store (BUILD.md 1e): `work onboard status` (each direction and
// role, its state, and the command that answers it), `work onboard show` (one of them in full), and
// what `work onboard wait` waits for. They read the onboarding files only; the adapter reads the
// text of each case's file (textOf), so a stale case shows.
import { type StartFix, type StartState, startStateOf } from '../../core/actions/index.ts'
import { exampleStateOf, onboardingStateOf } from '../../core/derived/index.ts'
import type {
  AiQuestion,
  AnsweredQuestion,
  OnboardingDirection,
  OnboardingRole,
} from '../../core/schema/index.ts'
import {
  answersIn,
  draftIn,
  deviationCases,
  Refused,
  resetWords,
} from '../../core/schema/index.ts'
import { DRAFT, type OnboardingFiles } from '../../core/services/index.ts'
import { exampleOneLines, flowLines } from './show.ts'
import { short } from './common.ts'

type TextOf = (file: string) => string | null
const countOf = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

const where = (file: OnboardingDirection): string => {
  switch (file.asked._tag) {
    case 'Found':
      return 'found in the project'
    case 'New':
      return `asked for by the person: "${short(file.asked.principle, 80)}"`
    case 'AdoptedCompany':
      return `adapted from ${file.asked.path} of ${file.asked.repo}`
    case 'Company':
      return `a company direction: ${file.asked.path} of ${file.asked.repo}`
  }
}

// A direction by its name once it has a draft, else by its id.
const titleOf = (file: OnboardingDirection): string => {
  const draft = draftIn(file.stage)
  return draft ? `${draft.name} (${file.id})` : file.id
}

const optionOf = (q: AnsweredQuestion): string => typeof q.chosen === 'string' ? q.options[q.chosen === 'A' ? 0 : 1] : q.chosen.words
// The person's answers to the questions of a direction, each with the words of its option and its
// question: what the next draft of the direction follows.
export const answersWords = (file: OnboardingDirection): string => {
  const answers = answersIn(file.stage).map(
    (q) => `${typeof q.chosen === 'string' ? q.chosen : 'own words'} ("${short(optionOf(q), 60)}") to "${short(q.says, 80)}"`,
  )
  return `the answers of ${titleOf(file)} decide its next draft: ${answers.join('; ')}`
}

// What waits for the host in a direction: a draft to write (a new or company direction, a Revise,
// submitted answers). A topic that the host found itself and is drafting is its own work.
const hostWork = (file: OnboardingDirection): string | undefined => {
  const { stage } = file
  switch (stage._tag) {
    case 'Revising': {
      const asks = stage.checkerChanged ? stage.words : `the person asks: "${short(stage.words, 120)}"`
      return stage.answered.length ? `${asks}; ${answersWords(file)}` : asks
    }
    case 'Answered':
      return answersWords(file)
    case 'Reset':
      return resetWords(file.id)
    case 'Drafting':
      return file.asked._tag === 'Found' ? undefined : 'it waits for its first draft'
    default:
      return undefined
  }
}
const roleWork = (role: OnboardingRole): string | undefined =>
  role.decision._tag === 'Revising' ? `the person asks: "${short(role.decision.words, 120)}"` : undefined

// Once the host has proposed staffing, the person can work on it while the host waits for a Consult.
export const waitsForHost = (files: OnboardingFiles): boolean => {
  if (files.staffingConsult?.reply === null ||
    files.directions.some((f) => hostWork(f) !== undefined) ||
    files.roles.some((r) => roleWork(r) !== undefined)) return true
  const start = startStateOf(files)
  return start._tag === 'Blocked' && (start.fix._tag !== 'Staffing' || !files.hasStaffingProposal)
}

// --- the store start ------------------------------------------------------------------------------

// Who fixes what blocks the store start, and with which command.
export const startFixWords = (fix: StartFix): string => {
  switch (fix._tag) {
    case 'Direction':
      return (
        `the host drafts ${fix.direction} again (work onboard draft ${fix.direction} ` +
        '--file=<direction.yaml>), then the person accepts it'
      )
    case 'Role':
      return `the host writes ${fix.role} again (work onboard role ${fix.role} --file=<role.yaml>), then the person accepts it`
    case 'Staffing':
      return 'arrange staffing on the Staffing tab'
    case 'Lead':
      return (
        'the host writes a persistent role that splits (work onboard role <role> --file=<role.yaml>), ' +
        'then the person accepts it'
      )
  }
}
// The refusal of the store start: what the start waits for, from the one reader (startStateOf).
export const startRefusal = (state: StartState): Refused | undefined => {
  switch (state._tag) {
    case 'NoConfig':
      return new Refused({
        message: `there is no ${DRAFT} yet: its people and roles come first`,
        next: 'the host writes the config draft: work onboard config --file=<draft.yaml>',
      })
    case 'Blocked':
      return new Refused({
        message: `the store cannot start: ${state.refusal.message}`,
        next: startFixWords(state.fix),
      })
    case 'Waiting':
      return state.on._tag === 'Direction'
        ? new Refused({
            message: `${state.on.direction} is not accepted yet`,
            next: `resolve ${state.on.direction}, then approve the reviewed directions together (work onboard approve-directions)`,
          })
        : new Refused({
            message: `the role ${state.on.role} is not accepted yet`,
            next: `accept it or remove it (work onboard accept-role|remove-role ${state.on.role}), then approve again`,
          })
    case 'Open':
      return undefined
  }
}

const staleCount = (file: OnboardingDirection, textOf: TextOf): string => {
  const draft = draftIn(file.stage)
  if (draft === undefined) return ''
  const examples = draft.content.standards.flatMap((s) => s.rules.flatMap((r) => r.evidence?.cases ?? []))
  const stale = examples.filter((e) => exampleStateOf(textOf, e)._tag === 'Stale').length
  return ` · ${countOf(examples.length, 'example')}${stale ? `, ${stale} stale` : ''}`
}

// The line of a direction, its summary once it has a draft (Nanda, 2026-11-15), and the command
// that answers it.
const directionLines = (file: OnboardingDirection, textOf: TextOf): ReadonlyArray<string> => {
  const id = file.id
  const state = onboardingStateOf(file)
  const draft = draftIn(file.stage)
  const name = draft ? `${draft.name} · ` : ''
  const summary = draft ? [draft.content.summary] : []
  const head = [
    `  ${id} · ${state._tag} · ${name}${where(file)}${staleCount(file, textOf)}`,
    ...summary.map((words) => `    summary: ${short(words, 120)}`),
  ]
  switch (state._tag) {
    case 'Accepted':
    case 'Removed':
      return head
    case 'Question':
      return [
        ...head,
        `    ${countOf(state.open.length, 'question')} for the person: work onboard show ${id}; ` +
          `work onboard answer ${id} --options=${state.open.map(() => 'A').join(',')}` +
          (file.stage._tag === 'Question' && file.stage.revision ? ` --revision=${file.stage.revision}` : ''),
      ]
    case 'Ready':
      return [
        ...head,
        `    the person: work onboard show ${id}; revise with work onboard revise ${id} --words="<what to change>" or approve all`,
      ]
    case 'Loading':
      return [
        ...head,
        `    ${hostWork(file) ?? 'the host drafts it'} (the host: work onboard draft ${id} --file=<direction.yaml>` +
          (file.stage._tag === 'Answered' && file.stage.revision ? ` --revision=${file.stage.revision}` : '') +
          `${draft ? `, or ask ${id} --file=<questions.yaml>` : ''})`,
      ]
  }
}

const persistenceOf = (role: OnboardingRole): string =>
  role.file.kind === 'program'
    ? 'program'
    : `${role.file.model}, ${role.file.persistence.persistent ? 'persistent' : 'disposable'}`
const foundOf = (role: OnboardingRole): string =>
  role.found._tag === 'InProject' ? ` (in the project: ${role.found.path})` : ''
const ROLE_STATE = { Waiting: 'Waiting', Revising: 'Revise', Accepted: 'Accepted' } as const

const roleLines = (role: OnboardingRole): ReadonlyArray<string> => {
  const name = role.role
  const state = ROLE_STATE[role.decision._tag]
  const head = `  ${name} · ${state} · ${persistenceOf(role)} · ${short(role.summary, 80)}${foundOf(role)}`
  const asked = roleWork(role)
  if (asked !== undefined) {
    return [head, `    ${asked} (the host: work onboard role ${name} --file=<role.yaml>)`]
  }
  if (role.decision._tag === 'Accepted') return [head]
  const toggle =
    role.file.kind === 'program'
      ? ''
      : `, persistence ${name} --persistent=${role.file.persistence.persistent ? 'false' : 'true'}`
  return [
    head,
    `    the person: work onboard accept-role ${name}, revise-role ${name} --words="<what to change>"` +
      `, remove-role ${name}${toggle}`,
  ]
}

// The one next act of onboarding as a whole, from the state of the store start.
const nextOf = (files: OnboardingFiles, start: StartState): string => {
  switch (start._tag) {
    case 'NoConfig':
      return 'next: the host writes the config draft: work onboard config --file=<draft.yaml>'
    case 'Blocked':
      return `next: the store cannot start: ${start.refusal.message}; ${startFixWords(start.fix)}`
    case 'Waiting': {
      if (start.on._tag === 'Role') {
        return 'next: every direction is accepted or removed; the person accepts each role'
      }
      const open = files.directions.filter((f) => f.stage._tag !== 'Accepted' && f.stage._tag !== 'Removed')
      return `next: ${countOf(open.length, 'direction')} not accepted yet; the host runs work onboard wait between its drafts`
    }
    case 'Open':
      return 'next: accept the journal onboarding proposals to activate the project'
  }
}

export const onboardStatus = (files: OnboardingFiles, textOf: TextOf): ReadonlyArray<string> => {
  if (files.config === null && files.directions.length === 0 && files.discovery === undefined) {
    return [
      'no onboarding files in this dir yet.',
      'next: the host writes the config draft: work onboard config --file=<draft.yaml>',
    ]
  }
  // The roles that the project has come first, as on the agents page.
  const roles = [
    ...files.roles.filter((r) => r.found._tag === 'InProject'),
    ...files.roles.filter((r) => r.found._tag === 'New'),
  ]
  return [
    ...(files.discovery ? [
      `searched: ${files.discovery.scope.searched.join(', ')}`,
      `unknown: ${files.discovery.scope.unknown.join(', ')}`,
      ...files.discovery.sources.map((s) => `source: ${s.file}:${s.line} — ${s.excerpt}`),
    ] : []),
    `directions (${files.directions.length}):`,
    ...files.directions.flatMap((f) => directionLines(f, textOf)),
    `roles (${files.config === null ? 'no config draft yet' : files.roles.length}):`,
    ...roles.flatMap(roleLines),
    nextOf(files, startStateOf(files)),
  ]
}

const questionLines = (
  q: AiQuestion | AnsweredQuestion,
  i: number,
  textOf: TextOf,
): ReadonlyArray<string> => [
  `  ${i + 1}. ${q.says}`,
  ...(q.example ? exampleOneLines(q.example, textOf).map((l) => `  ${l}`) : []),
  ...(q.target ? (q.target._tag === 'Candidates' ? [q.target.a, q.target.b] : deviationCases(q.target).flatMap((pair) => [pair.code, pair.principle]))
    .map(({ words, source }) => `     ${source.file}:${source.line} — ${words} (${source.excerpt})`) : []),
  `     A: ${q.options[0]}`,
  `     B: ${q.options[1]}`,
  ...('chosen' in q ? [`     answer: ${optionOf(q)}`] : []),
]

// work onboard show <id>: the direction in full, as the right column of the page shows it.
export const onboardShowDirection = (
  file: OnboardingDirection,
  textOf: TextOf,
): ReadonlyArray<string> => {
  const state = onboardingStateOf(file)
  const lines = [`${file.id} · ${state._tag} · ${where(file)}`]
  if (file.asked._tag === 'New' && file.asked.example !== null) {
    lines.push(`example: ${file.asked.example}`)
  }
  const draft = draftIn(file.stage)
  if (draft) {
    const { name, from, content } = draft
    lines.push(
      `name: ${name}`,
      `summary: ${content.summary}`,
      ...(content.discovery ? [
        `searched: ${content.discovery.scope.searched.join(', ')}`,
        `unknown: ${content.discovery.scope.unknown.join(', ')}`,
        ...content.discovery.sources.map((s) => `source: ${s.file}:${s.line} — ${s.excerpt}`),
      ] : []),
      ...flowLines(content.flow),
      `from: ${from.join(', ') || 'none'}`,
      `says: ${content.says}`,
    )
    for (const s of content.standards) {
      lines.push(`- ${s.id}: ${s.says}`)
      for (const r of s.rules) {
        lines.push(`    - ${r.id} (${r.checkedBy ?? 'no checker'}): ${r.says}`)
        const evidence = r.evidence
        if (evidence === undefined) continue
        lines.push(...evidence.cases.flatMap((e) => exampleOneLines(e, textOf).map((l) => `      ${l}`)))
        if (evidence.scope.searched.length && !evidence.cases.some((e) => e.fit === 'Breaks' && 'file' in e.output) &&
          !evidence.knownBreaks.length) lines.push(`      no break observed in ${evidence.scope.searched.join(', ')}`)
        lines.push(...evidence.knownBreaks.map((spot) => `      known break: ${spot.file}:${spot.line} — ${spot.excerpt}`))
      }
    }
  } else {
    lines.push('no draft yet')
  }
  const { stage } = file
  const questions = stage._tag === 'Question' ? stage.open : answersIn(stage)
  if (questions.length > 0) {
    if ('revision' in stage && stage.revision) lines.push(`revision: ${stage.revision}`)
    lines.push('questions:', ...questions.flatMap((q, i) => questionLines(q, i, textOf)))
  }
  if (stage._tag === 'Revising') lines.push(`revise: ${stage.words}`)
  return lines
}

// work onboard show <role>: its card and its words, as the window of the agents page shows them.
export const onboardShowRole = (role: OnboardingRole): ReadonlyArray<string> => {
  const r = role.file
  const lines = [
    ...roleLines(role).map((l) => l.trimStart()),
    `icon: ${r.icon}`,
    `description: ${r.description}`,
  ]
  if (r.kind === 'agent') lines.push(`persistence: ${r.persistence.why}`)
  return lines
}
