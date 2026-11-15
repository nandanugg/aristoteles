// The words of onboarding before the store (BUILD.md 1e): `work onboard status` (each direction and
// role, its state, and the command that answers it), `work onboard show` (one of them in full), and
// what `work onboard wait` waits for. They read the onboarding files only; the adapter reads the
// text of each case's file (textOf), so a stale case shows.
import { caseStateOf, onboardingStateOf } from '../../core/derived/index.ts'
import type {
  AiQuestion,
  OnboardingDirection,
  OnboardingRole,
} from '../../core/schema/index.ts'
import type { OnboardingFiles } from '../../core/services/index.ts'
import { caseLines } from './show.ts'
import { short } from './common.ts'

type TextOf = (file: string) => string | null
const countOf = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

const where = (file: OnboardingDirection): string => {
  switch (file.asked._tag) {
    case 'Found':
      return 'found in the project'
    case 'New':
      return `asked for by the person: "${short(file.asked.principle, 80)}"`
    case 'Company':
      return `a company direction: ${file.asked.path} of ${file.asked.repo}`
  }
}

// A direction by its name once it has a draft, else by its id.
const titleOf = (file: OnboardingDirection): string =>
  file.draft._tag === 'Drafted' ? `${file.draft.name} (${file.id})` : file.id

// The person's answers to the questions of a direction, each with the words of its option and its
// question: what the next draft of the direction follows.
export const answersWords = (file: OnboardingDirection): string => {
  const answers = file.questions.flatMap((q) =>
    q.answer._tag === 'Chosen'
      ? [`${q.answer.option} ("${short(q.options[q.answer.option === 'A' ? 0 : 1], 60)}") to "${short(q.says, 80)}"`]
      : [],
  )
  return `the answers of ${titleOf(file)} decide its next draft: ${answers.join('; ')}`
}

// What waits for the host in a direction: a draft to write (a new or company direction, a Revise,
// submitted answers). A topic that the host found itself and is drafting is its own work.
const hostWork = (file: OnboardingDirection): string | undefined => {
  if (file.accepted._tag === 'Accepted') return undefined
  if (file.request._tag === 'Revise') return `the person asks: "${short(file.request.words, 120)}"`
  const answered = file.questions.length > 0 && file.questions.every((q) => q.answer._tag !== 'Open')
  if (answered) return answersWords(file)
  if (file.draft._tag === 'Drafting' && file.asked._tag !== 'Found') return 'it waits for its first draft'
  return undefined
}
const roleWork = (role: OnboardingRole): string | undefined =>
  role.request._tag === 'Revise' ? `the person asks: "${short(role.request.words, 120)}"` : undefined

// Whether something waits for the host: work onboard wait ends then.
export const waitsForHost = (files: OnboardingFiles): boolean =>
  files.directions.some((f) => hostWork(f) !== undefined) ||
  files.roles.some((r) => roleWork(r) !== undefined)

const staleCount = (file: OnboardingDirection, textOf: TextOf): string => {
  if (file.draft._tag !== 'Drafted') return ''
  const { cases } = file.draft
  const stale = cases.filter((c) => caseStateOf(textOf, c)._tag === 'Stale').length
  return ` · ${countOf(cases.length, 'case')}${stale ? `, ${stale} stale` : ''}`
}

// The line of a direction and the command that answers it.
const directionLines = (file: OnboardingDirection, textOf: TextOf): ReadonlyArray<string> => {
  const id = file.id
  const state = onboardingStateOf(file)
  const name = file.draft._tag === 'Drafted' ? `${file.draft.name} · ` : ''
  const head = `  ${id} · ${state._tag} · ${name}${where(file)}${staleCount(file, textOf)}`
  const host = hostWork(file)
  switch (state._tag) {
    case 'Accepted':
      return [head]
    case 'Question':
      return [
        head,
        `    ${countOf(state.open.length, 'question')} for the person: work onboard show ${id}; ` +
          `work onboard answer ${id} --options=${state.open.map(() => 'A').join(',')}`,
      ]
    case 'Ready':
      return [
        head,
        `    the person: work onboard show ${id}; work onboard accept ${id}, ` +
          `revise ${id} --words="<what to change>", or remove ${id}`,
      ]
    case 'Loading':
      return [
        head,
        `    ${host ?? 'the host drafts it'} (the host: work onboard draft ${id} --file=<direction.yaml>` +
          `${file.draft._tag === 'Drafted' ? `, or ask ${id} --file=<questions.yaml>` : ''})`,
      ]
  }
}

const persistenceOf = (role: OnboardingRole): string =>
  role.file.kind === 'program'
    ? 'program'
    : `${role.file.tier}, ${role.file.persistence.persistent ? 'persistent' : 'disposable'}`
const foundOf = (role: OnboardingRole): string =>
  role.found._tag === 'InProject' ? ` (in the project: ${role.found.path})` : ''

const roleLines = (role: OnboardingRole): ReadonlyArray<string> => {
  const name = role.role
  const accepted = role.accepted._tag === 'Accepted'
  const asked = roleWork(role)
  const state = asked !== undefined ? 'Revise' : accepted ? 'Accepted' : 'Waiting'
  const head = `  ${name} · ${state} · ${persistenceOf(role)} · ${short(role.summary, 80)}${foundOf(role)}`
  if (asked !== undefined) {
    return [head, `    ${asked} (the host: work onboard role ${name} --file=<role.yaml>)`]
  }
  if (accepted) return [head]
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

// The one next act of onboarding as a whole.
const nextOf = (files: OnboardingFiles): string => {
  if (files.people === null) {
    return 'next: the host writes the config draft: work onboard config --file=<draft.yaml>'
  }
  const open = files.directions.filter((f) => f.accepted._tag !== 'Accepted')
  if (open.length > 0) {
    return `next: ${countOf(open.length, 'direction')} not accepted yet; the host runs work onboard wait between its drafts`
  }
  if (files.roles.some((r) => r.accepted._tag !== 'Accepted')) {
    return 'next: every direction is accepted or removed; the person accepts each role'
  }
  return 'next: everything is accepted; the person starts the store: work onboard approve-roles'
}

export const onboardStatus = (files: OnboardingFiles, textOf: TextOf): ReadonlyArray<string> => {
  if (files.people === null && files.directions.length === 0) {
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
    `directions (${files.directions.length}):`,
    ...files.directions.flatMap((f) => directionLines(f, textOf)),
    `roles (${files.people === null ? 'no config draft yet' : files.roles.length}):`,
    ...roles.flatMap(roleLines),
    nextOf(files),
  ]
}

const questionLines = (q: AiQuestion, i: number, textOf: TextOf): ReadonlyArray<string> => [
  `  ${i + 1}. ${q.says}`,
  ...caseLines([q.case], textOf).map((l) => `  ${l}`),
  `     A: ${q.options[0]}`,
  `     B: ${q.options[1]}`,
  ...(q.answer._tag === 'Chosen' ? [`     answer: ${q.answer.option}`] : []),
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
  if (file.draft._tag === 'Drafted') {
    const { name, from, content, cases } = file.draft
    lines.push(`name: ${name}`, `from: ${from.join(', ') || 'none'}`, `says: ${content.says}`)
    for (const s of content.standards) {
      lines.push(`- ${s.id}: ${s.says}`)
      for (const r of s.rules) lines.push(`    - ${r.id} (${r.checkedBy ?? 'no checker'}): ${r.says}`)
    }
    lines.push('cases:', ...caseLines(cases, textOf))
  } else {
    lines.push('no draft yet')
  }
  if (file.questions.length > 0) {
    lines.push('questions:', ...file.questions.flatMap((q, i) => questionLines(q, i, textOf)))
  }
  if (file.request._tag === 'Revise') lines.push(`revise: ${file.request.words}`)
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
