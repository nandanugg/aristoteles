import { gate } from '../../../core/actions/activation.ts'
// work onboard (BUILD.md 1e): onboarding at a terminal, before any store (ruling 1). The host (the
// AI CLI in the person's pane: no token, no store yet) drafts into the files; the person decides,
// as on the two pages of onboarding. Each act writes through src/files/onboarding.ts and stores
// nothing, until approve-roles starts the store with the accepted result only (BUILD.md 1c).
// This file reads and checks the files that the host names; the module checks the acts.
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { startStateOf } from '../../../core/actions/index.ts'
import { onboardingStateOf, spotCurrent } from '../../../core/derived/index.ts'
import {
  answersIn,
  DirectionId,
  draftIn,
  Example,
  examplesOfFlow,
  firstSentence,
  isNonBlank,
  type OnboardingDirection,
  Refused,
  refuse,
  RoleName,
  spotsOf,
  usesProblem,
} from '../../../core/schema/index.ts'
import {
  CONFIG,
  activationLock,
  draftConfigOfText,
  DRAFT,
  Dir,
  type DirectionDraft,
  Env,
  Files,
  fetchFolder,
  hostAct,
  mergeDraft,
  type OnboardingFiles,
  onboardingExists,
  type PersonAct,
  parseYaml,
  personAct,
  type QuestionDraft,
  type RoleNotes,
  readDirection,
  readFlow,
  readOnboarding,
  refusing,
} from '../../../core/services/index.ts'
import { loadWork } from '../../../core/state/index.ts'
import {
  answersWords,
  onboardShowDirection,
  onboardShowRole,
  onboardStatus,
  startRefusal,
  waitsForHost,
} from '../../words/index.ts'
import { short } from '../../words/common.ts'
import { textOf } from '../args.ts'
import { type Confirm, personChannel, personOf } from '../caller.ts'
import type { Call, Command, Commands } from '../command.ts'
import { activationEvents, markerApproval, prepareActivation, runActivation } from '../../live/activation.ts'
import { configProblems } from '../../live/config-problems.ts'
import { FLOW_FORM } from '../shared.ts'
import { WAIT_SECONDS } from './wait.ts'

const POLL_MS = 1000

const ROLE_KEYS = `      description: <what the role does, in one line>
      intro: <the first words of its brief>
      responsibilities: [<one exact output or command>]
      acts: [{ do: <its work> }] or [{ review: [<role>] }] or [{ approve: [<role>] }], with
        { assign: [<role>] } and split, direct, fit for a role that gives work, splits, directs, fits
      icon: <a role icon, such as compass>
      summary: <the one line of its card>
      found: <where the project has the role, such as .claude/agents/<role>.md; leave it out for a new role>`
const CONFIG_TEMPLATE = `write a file like this, then run the command again:
  people:
    - name: <the git user.name of each person>
  roles:
    <role>:
${ROLE_KEYS}`
const ROLE_TEMPLATE = `write a file with the keys of one role, then run the command again:
${ROLE_KEYS.replaceAll('\n      ', '\n  ').replace(/^ {6}/, '  ')}`
const FLOW = FLOW_FORM.replace(/^/gm, '  ')
const DRAFT_TEMPLATE = `write a file like this, then run the command again:
  id: <a short id; a new direction takes it from its first draft>
  name: <a short name>
  from: [<the principles that ground it, such as Logos>]
  summary: <one or two plain sentences: what the direction asks, and why it matters>
${FLOW}
  says: <what the direction asks for>
  standards:
    - id: <standard id>
      says: <how the output looks>
      rules:
        - { id: <rule id>, says: <one check>, checkedBy: <a role of ${DRAFT}> }`
const COMPANY_TEMPLATE = `write a file like this, then run the command again (the words come from the company folder):
  checkedBy: <the role that checks each rule>
  rules: { <rule id>: <the role that checks this rule> }
${FLOW}`
const QUESTIONS_TEMPLATE = `write a file like this, then run the command again:
  questions:
    - says: <what the AI must know to draft the direction>
      example: { fit: Follows | Breaks, output: { file: <path>, line: <n>, excerpt: <a short part of the file> } }   # as in a draft
      options: [<option A>, <option B>]`
// A draft of onboarding names no owner: readDirection checks the rest of the file with this one,
// and the person who starts the store owns each direction.
const OWNER = 'the person'
const DRAFT_KEYS = ['id', 'name', 'from', 'summary', 'flow', 'says', 'standards']
const COMPANY_KEYS = ['id', 'checkedBy', 'rules', 'flow']

const isRecord = (x: unknown): x is Readonly<Record<string, unknown>> =>
  typeof x === 'object' && x !== null && !Array.isArray(x)

// --- reading the files that the host names -------------------------------------------------------

const fileFlag = (call: Call, template: string) => {
  const file = textOf(call.args.one('file'))
  return file === undefined
    ? Effect.fail(refuse(`work onboard ${call.act} needs --file=<file>`, template))
    : Effect.succeed(file)
}
const yamlIn = (file: string) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const text = yield* (yield* Files).read(join(cwd, file))
    if (text === null) return yield* refuse(`there is no file ${file} in ${cwd}`, 'write the file first, then run the command again')
    return yield* refusing(() => parseYaml(text)).pipe(
      Effect.mapError(
        (e) => new Refused({ message: `${file}: ${e.message}`, next: `write ${file} as yaml` }),
      ),
    )
  })
const idOf = (word: string | undefined) =>
  word !== undefined && Schema.is(DirectionId)(word)
    ? Effect.succeed(word)
    : Effect.fail(
        refuse(
          `"${word ?? ''}" is not the id of a direction: lower-case words with dashes`,
          'work onboard status lists the directions',
        ),
      )
const roleOf = (word: string | undefined) =>
  word !== undefined && word !== ''
    ? Effect.succeed(RoleName.make(word))
    : Effect.fail(refuse('name a role', 'work onboard status lists the roles'))

// The one line of a role's card, and where the project has it.
const notesOf = (file: string, where: string, raw: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const { summary, found } = raw
    if (typeof summary !== 'string' || !isNonBlank(summary)) {
      return yield* refuse(`${file}: ${where}summary is required: the one line of its card`, ROLE_TEMPLATE)
    }
    if (found !== undefined && (typeof found !== 'string' || !isNonBlank(found))) {
      return yield* refuse(`${file}: ${where}found is the path where the project has the role`, ROLE_TEMPLATE)
    }
    const notes: RoleNotes = {
      summary,
      found: found === undefined ? { _tag: 'New' } : { _tag: 'InProject', path: found },
    }
    return notes
  })
const withoutNotes = ({ summary: _s, found: _f, ...role }: Readonly<Record<string, unknown>>) => role

// The checks of work config check on the draft as it would be: it reads merged into
// aristoteles.yaml, the git user is one of its people, and the words of each agent role fit.
const checkDraft = (file: string, raw: Readonly<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const now = yield* (yield* Files).read(join(cwd, CONFIG))
    const { config } = yield* refusing(() =>
      mergeDraft(now ?? '', Bun.YAML.stringify(raw, null, 2)),
    ).pipe(
      Effect.flatMap((text) => draftConfigOfText(cwd, text)),
      Effect.mapError((e) => new Refused({ message: `${file}: ${e.message}`, next: e.next })),
    )
    const problems = yield* configProblems(config)
    if (problems.length) {
      return yield* refuse(`${file}: ${problems.join('; ')}`, `change ${file}, then run it again`)
    }
  })

// A real sample of an example is real now: its excerpt is in its file. The host's own words
// (written:) name no file.
const realExamples = (file: string, examples: ReadonlyArray<Example>) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const files = yield* Files
    for (const [i, e] of examples.entries()) {
      for (const spot of spotsOf(e)) {
        if (!spotCurrent(yield* files.read(join(cwd, spot.file)), spot)) {
          return yield* refuse(
            `${file}: example ${i + 1}: "${short(spot.excerpt, 80)}" is not in ${spot.file}`,
            'a real sample is a short part of its file as it is now; with none, write the output',
          )
        }
      }
    }
  })

// The text of each file that an example names, for the stale examples of the words.
const textsOf = (files: OnboardingFiles) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const read = yield* Files
    const texts = new Map<string, string | null>()
    for (const f of files.directions) {
      const asked = f.stage._tag === 'Question' ? f.stage.open : answersIn(f.stage)
      const draft = draftIn(f.stage)
      const examples = [
        ...(draft ? examplesOfFlow(draft.content.flow) : []),
        ...asked.map((q) => q.example),
      ]
      for (const { file } of examples.flatMap(spotsOf)) {
        if (!texts.has(file)) texts.set(file, yield* read.read(join(cwd, file)))
      }
    }
    return (file: string) => texts.get(file) ?? null
  })

// Onboarding ends when the store starts: then a change is an adjustment (ruling 14).
const noStoreYet = Effect.gen(function* () {
  const { cwd } = yield* Dir
  if ((yield* loadWork(cwd))._tag === 'NoStore') return
  return yield* refuse(
    'the store of this dir has started, so onboarding is over',
    'a change now is a role fit: work role fit <role> --answers=<file>',
  )
})

const directionIn = (files: OnboardingFiles, id: string): OnboardingDirection | undefined =>
  files.directions.find((f) => f.id === id)
// The store start names this accepted direction, so the host drafts it again (O1).
const reopens = (files: OnboardingFiles, id: DirectionId): boolean => {
  const start = startStateOf(files)
  return start._tag === 'Blocked' && start.fix._tag === 'Direction' && start.fix.direction === id
}
// The state that the page shows for a direction now, as the reply of the host's act says it.
const shownAs = (cwd: string, id: DirectionId) =>
  Effect.map(readOnboarding(cwd), (files) => {
    const file = directionIn(files, id)
    return file === undefined ? 'Loading' : onboardingStateOf(file)._tag
  })

// --- the host's acts ---------------------------------------------------------------------------

const config = (call: Call) =>
  Effect.gen(function* () {
    const file = yield* fileFlag(call, CONFIG_TEMPLATE)
    const raw = yield* yamlIn(file)
    if (!isRecord(raw) || !isRecord(raw.roles)) {
      return yield* refuse(`${file}: roles is required`, CONFIG_TEMPLATE)
    }
    const notes: Record<string, RoleNotes> = {}
    const roles: Record<string, unknown> = {}
    for (const [name, role] of Object.entries(raw.roles)) {
      if (!isRecord(role)) return yield* refuse(`${file}: roles.${name} gives no keys`, CONFIG_TEMPLATE)
      notes[name] = yield* notesOf(file, `roles.${name}: `, role)
      roles[name] = withoutNotes(role)
    }
    const draft = { ...raw, roles }
    yield* checkDraft(file, draft)
    const { cwd } = yield* Dir
    yield* hostAct(cwd, { _tag: 'Config', config: draft, notes })
    const names = Object.keys(roles)
    return [
      `${DRAFT} holds the config draft: ${names.length} roles (${names.join(', ')}); each waits for the person on the agents page.`,
      'next: start the page (work start --detach), where the person sees each direction; then ' +
        'work onboard found <id> for each topic, and work onboard draft <id> --file=<direction.yaml>',
    ]
  })

const role = (call: Call, name: string | undefined) =>
  Effect.gen(function* () {
    const key = yield* roleOf(name)
    const file = yield* fileFlag(call, ROLE_TEMPLATE)
    const raw = yield* yamlIn(file)
    if (!isRecord(raw)) return yield* refuse(`${file}: write the keys of one role`, ROLE_TEMPLATE)
    const notes = yield* notesOf(file, '', raw)
    const { cwd } = yield* Dir
    const text = yield* (yield* Files).read(join(cwd, DRAFT))
    // With no draft yet, the module says what comes first.
    if (text !== null) {
      const draft = yield* refusing(() => parseYaml(text))
      yield* checkDraft(file, { ...draft, roles: { ...draft.roles, [key]: withoutNotes(raw) } })
    }
    yield* hostAct(cwd, { _tag: 'Role', role: key, file: withoutNotes(raw), notes })
    return [
      `${key}: written into ${DRAFT}; it waits for the person on the agents page.`,
      'next: work onboard wait, until the person accepts or revises it',
    ]
  })

const found = (id: string | undefined) =>
  Effect.gen(function* () {
    const direction = yield* idOf(id)
    const { cwd } = yield* Dir
    yield* hostAct(cwd, { _tag: 'Found', direction })
    return [
      `${direction}: a topic that the host found; it shows Loading until its draft.`,
      `next: work onboard draft ${direction} --file=<direction.yaml>`,
    ]
  })

// A draft of a direction that the project has, or that the person asked for.
const localDraft = (file: string, raw: Readonly<Record<string, unknown>>, current: OnboardingDirection) =>
  Effect.gen(function* () {
    const unknown = Object.keys(raw).find((k) => !DRAFT_KEYS.includes(k))
    if (unknown !== undefined) {
      return yield* refuse(
        `${file}: ${unknown} is no key of an onboarding draft; its keys are ${DRAFT_KEYS.join(', ')}`,
        unknown === 'owner' ? 'the person who starts the store owns each direction' : DRAFT_TEMPLATE,
      )
    }
    const first = current.asked._tag === 'New' && current.stage._tag === 'Drafting'
    if (first && raw.id === undefined) {
      return yield* refuse(
        `${file}: a new direction takes its id from its first draft`,
        'write id: <a short id, such as small-changes> in the draft',
      )
    }
    const id = yield* idOf(raw.id === undefined ? current.id : String(raw.id))
    const read = yield* readDirection(file, { ...raw, id, owner: OWNER }, [OWNER])
    const draft: DirectionDraft = {
      id,
      name: read.name,
      from: read.from,
      summary: read.summary,
      flow: read.flow,
      says: read.says,
      standards: read.standards,
    }
    return draft
  })

// A draft of a company direction: its words come from the folder now (company.ts readFolder); the
// draft adds the checkers.
const companyDraft = (
  file: string,
  raw: Readonly<Record<string, unknown>>,
  current: OnboardingDirection,
  asked: { readonly repo: string; readonly path: string },
) =>
  Effect.gen(function* () {
    const unknown = Object.keys(raw).find((k) => !COMPANY_KEYS.includes(k))
    if (unknown !== undefined) {
      return yield* refuse(
        `${file}: ${unknown} is no key of a company draft; the words come from the folder`,
        COMPANY_TEMPLATE,
      )
    }
    const { checkedBy, rules } = raw
    const roleWord = (x: unknown) => typeof x === 'string' && x !== ''
    if (checkedBy !== undefined && !roleWord(checkedBy)) {
      return yield* refuse(`${file}: checkedBy names one role`, COMPANY_TEMPLATE)
    }
    if (rules !== undefined && !(isRecord(rules) && Object.values(rules).every(roleWord))) {
      return yield* refuse(`${file}: rules gives the role of each rule by its id`, COMPANY_TEMPLATE)
    }
    const checker = (rule: string): string | undefined =>
      (isRecord(rules) ? (rules[rule] as string | undefined) : undefined) ??
      (checkedBy as string | undefined)
    const id = yield* idOf(raw.id === undefined ? current.id : String(raw.id))
    const env = (yield* Env).vars
    const { folder } = yield* fetchFolder(env, { ...asked, owner: OWNER })
    // The host writes no words of a company direction: its summary is the first sentence of the
    // folder's words (Nanda, 2026-11-15).
    const summary = firstSentence(folder.says)
    if (!isNonBlank(summary)) {
      return yield* refuse(
        `the direction.md of ${asked.path} has no words under its heading, so it has no summary`,
        'ask the owner of the company repo to write what the direction asks in direction.md',
      )
    }
    // The flow is of this project, so the host writes it (Nanda, 2026-11-15).
    const flow = yield* readFlow(file, raw.flow)
    const marks = usesProblem(id, flow, folder.standards)
    if (marks !== undefined) return yield* refuse(`${file}: ${marks}`, COMPANY_TEMPLATE)
    const draft: DirectionDraft = {
      id,
      name: folder.name,
      from: [],
      summary,
      flow,
      says: folder.says,
      standards: folder.standards.map((s) => ({
        id: s.id,
        says: s.says,
        rules: s.rules.map((r) => {
          const by = checker(r.id)
          return { id: r.id, says: r.says, ...(by ? { checkedBy: RoleName.make(by) } : {}), supersedes: [] }
        }),
      })),
    }
    return draft
  })

const draft = (call: Call, id: string | undefined) =>
  Effect.gen(function* () {
    const direction = yield* idOf(id)
    const { cwd } = yield* Dir
    const files = yield* readOnboarding(cwd)
    const current = directionIn(files, direction)
    if (current === undefined) {
      return yield* refuse(
        `there is no direction ${direction}`,
        `work onboard status lists them; the host makes one with work onboard found ${direction}`,
      )
    }
    const template = current.asked._tag === 'Company' ? COMPANY_TEMPLATE : DRAFT_TEMPLATE
    const file = yield* fileFlag(call, template)
    const raw = yield* yamlIn(file)
    if (!isRecord(raw)) return yield* refuse(`${file}: write the keys of a draft`, template)
    const words =
      current.asked._tag === 'Company'
        ? yield* companyDraft(file, raw, current, current.asked)
        : yield* localDraft(file, raw, current)
    const examples = examplesOfFlow(words.flow)
    yield* realExamples(file, examples)
    const [made = direction] = yield* hostAct(cwd, {
      _tag: 'Draft',
      direction,
      draft: words,
      reopen: reopens(files, direction),
    })
    const state = yield* shownAs(cwd, made)
    return [
      `${made}: drafted${made === direction ? '' : ` (it was ${direction})`}, with ${examples.length} examples; it shows ${state}.`,
      'next: work onboard wait, until the person accepts, revises or removes it',
    ]
  })

const ask = (call: Call, id: string | undefined) =>
  Effect.gen(function* () {
    const direction = yield* idOf(id)
    const file = yield* fileFlag(call, QUESTIONS_TEMPLATE)
    const raw = yield* yamlIn(file)
    const list = isRecord(raw) && Array.isArray(raw.questions) ? raw.questions : []
    if (list.length === 0) return yield* refuse(`${file}: questions lists none`, QUESTIONS_TEMPLATE)
    const questions: Array<QuestionDraft> = []
    for (const [i, q] of list.entries()) {
      const at = `${file}: question ${i + 1}`
      if (!isRecord(q) || typeof q.says !== 'string' || !isNonBlank(q.says)) {
        return yield* refuse(`${at} needs says: what the AI must know`, QUESTIONS_TEMPLATE)
      }
      const read = Schema.decodeUnknownOption(Example)(q.example)
      if (read._tag === 'None') {
        return yield* refuse(
          `${at}: example is { fit: Follows | Breaks, output: { file, line, ` +
            'excerpt } or { written } }',
          QUESTIONS_TEMPLATE,
        )
      }
      const [a, b, ...more] = Array.isArray(q.options) ? q.options : []
      if (typeof a !== 'string' || !isNonBlank(a) || typeof b !== 'string' || !isNonBlank(b) || more.length > 0) {
        return yield* refuse(`${at}: options lists two options, A and B`, QUESTIONS_TEMPLATE)
      }
      questions.push({ says: q.says, example: read.value, options: [a, b] })
    }
    yield* realExamples(file, questions.map((q) => q.example))
    const { cwd } = yield* Dir
    yield* hostAct(cwd, { _tag: 'Ask', direction, questions })
    const state = yield* shownAs(cwd, direction)
    return [
      `${direction}: ${questions.length === 1 ? 'a question' : `${questions.length} questions`} for the person; it shows ${state}.`,
      'next: work onboard wait, until the person submits the answers',
    ]
  })

// The host names the id of a company direction; the person's has the name of its folder.
const company = (call: Call, id: string | undefined) =>
  Effect.gen(function* () {
    const repo = textOf(call.args.one('repo'))
    const path = textOf(call.args.one('path'))
    if (repo === undefined || path === undefined) {
      return yield* refuse(
        'a company direction needs --repo=<a git repo> and --path=<its folder of the direction>',
        'the folder holds direction.md, and a folder for each standard with its rules',
      )
    }
    const { cwd } = yield* Dir
    const [made] =
      id === undefined
        ? yield* asPerson({ act: 'add-company-direction', repo, path })
        : yield* hostAct(cwd, { _tag: 'Company', direction: yield* idOf(id), repo, path })
    return [
      `${made}: a company direction from ${path} of ${repo}; it shows Loading until the host drafts its checkers, its flow and its examples.`,
      `next: the host drafts it: work onboard draft ${made} --file=<checkers, flow and examples.yaml>`,
    ]
  })

// --- what the host and the person read -----------------------------------------------------------

const status = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const files = yield* readOnboarding(cwd)
  return onboardStatus(files, yield* textsOf(files))
})

const show = (name: string | undefined) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const files = yield* readOnboarding(cwd)
    const file = directionIn(files, name ?? '')
    if (file !== undefined) return onboardShowDirection(file, yield* textsOf(files))
    const role = files.roles.find((r) => r.role === name)
    if (role !== undefined) return onboardShowRole(role)
    return yield* refuse(`there is no direction or role "${name ?? ''}"`, 'work onboard status lists them')
  })

// It blocks until something waits for the host (a draft to write, a Revise, submitted answers, a
// new or company direction, a role to revise), then prints the status. 540 s at most, as work wait.
const wait = (call: Call) =>
  Effect.gen(function* () {
    const given = call.args.one('seconds')
    const n = Number(given)
    if (given !== undefined && !(typeof given === 'string' && Number.isFinite(n) && n > 0)) {
      return yield* refuse('--seconds is a number of seconds above 0', 'run it again, such as work onboard wait --seconds=540')
    }
    const seconds = Math.min(given === undefined ? WAIT_SECONDS : n, WAIT_SECONDS)
    const { cwd } = yield* Dir
    for (let left = seconds * 1000; ; left -= POLL_MS) {
      if (!(yield* onboardingExists(cwd))) {
        return [
          'onboarding is over: the onboarding files are gone (the store started, or nothing began).',
          'next: work status shows the store; with no store, the host starts with work onboard config --file=<draft.yaml>',
        ]
      }
      const files = yield* readOnboarding(cwd)
      if (waitsForHost(files)) return onboardStatus(files, yield* textsOf(files))
      if (left <= 0) {
        return [
          'nothing waits for the host yet; run work onboard wait again.',
          ...onboardStatus(files, yield* textsOf(files)),
        ]
      }
      yield* Effect.sleep(POLL_MS)
    }
  })

// --- the person's acts --------------------------------------------------------------------------

const asPerson = (onboarding: PersonAct, confirm?: Confirm) =>
  Effect.gen(function* () {
    const name = yield* personOf(undefined, confirm)
    const { cwd } = yield* Dir
    return yield* personAct(cwd, name, onboarding)
  })

const wordsFlag = (call: Call, flag: string, what: string) => {
  const words = textOf(call.args.one(flag))
  return words !== undefined && isNonBlank(words)
    ? Effect.succeed(words)
    : Effect.fail(refuse(
          `work onboard ${call.act} needs --${flag}="<${what}>"`,
          'run it again with the flag',
        ))
}

const add = (call: Call) =>
  Effect.gen(function* () {
    const principle = yield* wordsFlag(call, 'principle', 'the idea of the direction, in your words')
    const example = textOf(call.args.one('example'))
    const [made] = yield* asPerson({
      act: 'add-direction',
      principle,
      ...(example === undefined ? {} : { example }),
    })
    return [
      `${made}: a new direction, "${short(principle, 80)}"; it shows Loading until the host drafts it.`,
      'next: work onboard status shows it; the host drafts it with its examples',
    ]
  })

const answer = (call: Call, id: string | undefined) =>
  Effect.gen(function* () {
    const direction = yield* idOf(id)
    const options = (textOf(call.args.one('options')) ?? '').split(',').map((o) => o.trim())
    const chosen = options.filter((o): o is 'A' | 'B' => o === 'A' || o === 'B')
    const [first, ...rest] = chosen
    if (first === undefined || chosen.length !== options.length) {
      return yield* refuse(
        '--options gives A or B for each question, in order, such as --options=A,B',
        `work onboard show ${direction} shows the questions`,
      )
    }
    yield* asPerson({ act: 'answer', direction, options: [first, ...rest] })
    const { cwd } = yield* Dir
    const answered = directionIn(yield* readOnboarding(cwd), direction)
    const words = answered === undefined ? `the answers of ${direction} are in` : answersWords(answered)
    return [`${words}; it shows Loading until the host drafts it again.`]
  })

const decide = (word: 'accept' | 'remove', id: string | undefined) =>
  Effect.gen(function* () {
    const direction = yield* idOf(id)
    yield* asPerson({ act: word, direction })
    return [word === 'accept' ? `${direction} is accepted.` : `${direction} is removed; nothing keeps it.`]
  })

const revise = (call: Call, id: string | undefined) =>
  Effect.gen(function* () {
    const direction = yield* idOf(id)
    const words = yield* wordsFlag(call, 'words', 'what to change')
    yield* asPerson({ act: 'revise', direction, words })
    return [`${direction}: the host drafts it again from your words; it shows Loading until then.`]
  })

const approveDirections = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const files = yield* readOnboarding(cwd)
  const ready = files.directions.filter((f) => onboardingStateOf(f)._tag === 'Ready')
  if (ready.length === 0) {
    return yield* refuse('no direction is ready; approve all accepts each ready one', 'work onboard status shows what waits')
  }
  const show = `approve all accepts: ${ready.map((f) => f.id).join(', ')}`
  const accepted = yield* asPerson({ act: 'approve-all-directions' }, { word: 'approve', show })
  const waiting = files.directions.filter((f) => !accepted.includes(f.id) && f.stage._tag !== 'Accepted')
  return [
    `accepted: ${accepted.join(', ')}.`,
    ...(waiting.length
      ? [`still waiting: ${waiting.map((f) => `${f.id} (${onboardingStateOf(f)._tag})`).join(', ')}.`]
      : ['every direction is accepted or removed: the roles come next (work onboard status).']),
  ]
})

const roleAct = (call: Call, name: string | undefined) =>
  Effect.gen(function* () {
    const key = yield* roleOf(name)
    switch (call.act) {
      case 'accept-role':
        yield* asPerson({ act: 'accept-role', role: key })
        return [`${key} is accepted.`]
      case 'remove-role':
        yield* asPerson({ act: 'remove-role', role: key })
        return [`${key} is removed from ${DRAFT}; nothing keeps it.`]
      case 'revise-role': {
        const words = yield* wordsFlag(call, 'words', 'what to change')
        yield* asPerson({ act: 'revise-role', role: key, words })
        return [`${key}: the host writes it again from your words.`]
      }
      default: {
        const word = textOf(call.args.one('persistent'))
        if (word !== 'true' && word !== 'false') {
          return yield* refuse('--persistent is true or false', 'run it again with --persistent=true or --persistent=false')
        }
        yield* asPerson({ act: 'persistence', role: key, persistent: word === 'true' })
        return [
          `${key} is ${word === 'true' ? 'persistent: it gets a terminal of its own' : 'disposable: it runs as a subagent of a terminal'}.`,
        ]
      }
    }
  })

// The store start (BUILD.md 1c): after the typed approve, the lock is taken, aristoteles.yaml is
// written from the draft, and the person stores the start; a refusal writes the files back.
const approveRoles = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const approval = yield* markerApproval(cwd)
  const show = 'Start an inactive workflow and mark these approved instruction files:' +
    `\n${approval.entries.map((entry) => entry.path).join('\n') || '(none)'}` +
    (approval.reported.length ? `\nOther loaded instructions: ${approval.reported.join(', ')}` : '')
  const name = yield* personOf(undefined, { word: 'approve', show })
  const by = { _tag: 'Person' as const, name, channel: yield* personChannel }
  yield* prepareActivation(cwd, by, approval.entries, (f) => startRefusal(startStateOf(f)))
  return [yield* runActivation(cwd, by, 'resume')]
})

const ACTS: Readonly<Record<string, (call: Call, word: string | undefined) => ReturnType<Command>>> = {
  config: (call) => config(call),
  role: (call, word) => role(call, word),
  found: (_call, word) => found(word),
  draft: (call, word) => draft(call, word),
  ask: (call, word) => ask(call, word),
  company: (call, word) => company(call, word),
  add: (call) => add(call),
  answer: (call, word) => answer(call, word),
  accept: (_call, word) => decide('accept', word),
  remove: (_call, word) => decide('remove', word),
  revise: (call, word) => revise(call, word),
  'approve-directions': () => approveDirections,
  'accept-role': (call, word) => roleAct(call, word),
  'revise-role': (call, word) => roleAct(call, word),
  'remove-role': (call, word) => roleAct(call, word),
  persistence: (call, word) => roleAct(call, word),
  'approve-roles': () => approveRoles,
}

const onboard: Command = (call) =>
  Effect.gen(function* () {
    const [, word] = call.args.positional
    if (call.act === 'status') return yield* status
    if (call.act === 'show') return yield* show(word)
    if (call.act === 'wait') return yield* wait(call)
    const run = call.act === null ? undefined : ACTS[call.act]
    if (run === undefined) {
      return yield* refuse(
        `use work onboard ${['status', 'show', 'wait', ...Object.keys(ACTS)].join('|')}`,
        'work help lists the forms',
      )
    }
    const { cwd } = yield* Dir
    if (call.act !== 'approve-roles') yield* activationLock(cwd)
    yield* gate(yield* activationEvents(cwd))
    yield* noStoreYet
    return yield* run(call, word)
  })

export const commands: Commands = { onboard }
