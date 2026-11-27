import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Effect, Exit, Schema } from 'effect'
import { Authority, submit, type AuthenticatedActor } from '../../core/actions/project.ts'
import { nextStep } from '../../core/derived/project/next-step.ts'
import { readOpenProject } from '../../core/actions/staff-session.ts'
import {
  EventNumber, Human, LaunchNonce, ProjectCredential, Projection, Proposal, ProposalKey, Rationale, ReadPosition, Refusal, ReviewFacts, StaffSessionKey, StaffKey, liveSession, proposalText, refuse, staffingAt, type Of, type Project, type Submission,
} from '../../core/schema/project.ts'
import { openProjectJournal, withProjectEnv } from '../../core/services/project.ts'
import {
  activationOwner, liveProjectBootstrap, projectActivationOperations, projectDirectoryAt, resumeProjectActivation,
} from '../live/activation.ts'
import { bootstrapPane, NONCE_ENV, PROJECT_ENV } from '../live/bootstrap.ts'
import { installSkill } from '../live/skill-install.ts'
import { newStaffSession, projectRuns } from '../live/project-runs.ts'
import { liveTaskCommands } from '../live/task-commands.ts'
import {
  projectBriefCommand, projectOnboard, projectQuestionCommand, projectReportCommand, projectReviewCommand,
  projectSendCommand, waitOnProject, waitOnTaskReview,
} from './commands/project.ts'
import { acknowledgeProjectHost, collectProjectHost } from './commands/project-activation.ts'
import { projectIntroductionWords, projectQuestionWords } from '../words/project.ts'

// Raw argv stays at the CLI boundary. Each command checks its flags before decoding input.
const parseArgs = (argv: readonly string[]) => {
  const positional: string[] = []
  const flags: Array<readonly [key: string, value: string | true]> = []
  let malformed = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const match = /^--([a-z-]+)(?:=(.*))?$/su.exec(arg)
    if (arg === '--on' && /^\d+$/u.test(argv[i + 1] ?? '')) flags.push(['on', argv[++i]!])
    else if (match) flags.push([match[1]!, match[2] ?? true])
    else if (arg.startsWith('--')) malformed = true
    else positional.push(arg)
  }
  const one = (key: string) => {
    const value = flags.findLast(([name]) => name === key)?.[1]
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
  }
  return { positional, flags, malformed, one }
}

const help = [
  'work onboard open --file=project.yaml',
  'work onboard status | show <proposal>',
  'work onboard submit <token> --on=<read> --file=proposal.yaml',
  'work onboard accept|send-back|remove <proposal> --on=<read>',
  'work start [--detach]',
  'work activation resume|relaunch|rollback',
  'work project start --on=<read>',
  'work session launch <staff> | observe <session> | end <session>',
  'work wait <token> [--on=<session-start>]',
  'work send <token> --on=<read> --file=task.yaml',
  'work brief <token> <task>',
  'work report|review <token> <task> --on=<read> --file=report.yaml',
  'work question [<token>] <recipient> --on=<read> --file=question.yaml',
  'work answer [<token>] <question-address> --on=<read> --file=answer.yaml',
  'work skill install',
]

const invalid = () => refuse('InvalidInput', Rationale.make('Use the arguments and flags shown by work help.'))
const denied = () => refuse('WrongActor', Rationale.make('Use the project owner’s terminal or a current project credential.'))
const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S, value: unknown) =>
  Effect.mapError(Schema.decodeUnknownEffect(schema, { onExcessProperty: 'error' })(value), invalid)
const load = (file: string) => Effect.try({
  try: () => readFileSync(file, 'utf8'), catch: invalid,
})
const yaml = (text: string) => Effect.try({ try: (): unknown => Bun.YAML.parse(text), catch: invalid })
const words = (event: { readonly number: typeof EventNumber.Type }) =>
  'Committed event ' + event.number + '.'

const startingWords = (project: Project, key: Of<typeof StaffSessionKey>): readonly string[] => {
  const session = liveSession(project, key)
  if (!session) return []
  const selected = nextStep(project, session, [])
  return selected._tag === 'Introduction' ? [projectIntroductionWords(selected.subject, session, selected.read)] : []
}

const projectCommand = (argv: readonly string[], io: Parameters<typeof runProjectCli>[1]) => Effect.gen(function* () {
  const env = io.env
  const parsed = parseArgs(argv)
  const explicit = parsed.positional.filter((word) => word.startsWith('run.') || word.startsWith('host.'))
  const token = explicit[0] ?? env.ARISTOTELES_TOKEN
  const [command, act, subject, ...extra] = parsed.positional.filter((word) => !explicit.includes(word))
  if (parsed.malformed || explicit.length > 1 || extra.length) return yield* Effect.fail(invalid())
  if (!command || command === 'help') return help
  if (command === 'skill' && act === 'install' && !subject && !parsed.flags.length)
    return yield* Effect.sync(() => installSkill(io.cwd))

  const ownerName = () => Effect.sync(() => io.gitUser())
  const ownerTerminal = () => !token && !env.ARISTOTELES_SESSION && !Object.keys(env).some((key) => key.startsWith('GIT_CONFIG')) && io.isTTY
  const open = command === 'onboard' && act === 'open'
  const file = () => {
    const name = parsed.one('file')
    return name ? load(resolve(io.cwd, name)) : Effect.fail(invalid())
  }
  const read = () => {
    const value = parsed.one('on')
    return decode(ReadPosition, value !== undefined && /^\d+$/u.test(value) ? Number(value) : undefined)
  }
  const known = (keys: readonly string[]) => parsed.flags.every(([key, value]) => keys.includes(key) && typeof value === 'string') &&
    new Set(parsed.flags.map(([key]) => key)).size === parsed.flags.length

  if (open) {
    if (subject || !known(['file']) || !ownerTerminal()) return yield* Effect.fail(denied())
    const input = yield* yaml(yield* file())
    if (input === null || typeof input !== 'object' || !('owner' in input)) return yield* Effect.fail(invalid())
    const owner = yield* decode(Human, input.owner)
    if (owner.name !== (yield* ownerName())) return yield* Effect.fail(denied())
    const journal = yield* openProjectJournal(projectDirectoryAt(io.cwd), 'Create')
    const actor = { _tag: 'Human', actor: { _tag: 'Human' } } as const
    const result = yield* submit(journal, { read: 0, line: 'Project', move: 'open', input }).pipe(
      Effect.provideService(Authority, { actor: Effect.succeed(actor) }),
    )
    return [words(result.event)]
  }

  const directory = projectDirectoryAt(io.cwd)
  if (command === 'activation' && (act === 'ack' || act === 'collect')) {
    if (!subject || !known([]) || !Schema.is(StaffSessionKey)(subject) || !/^session:[a-f0-9]{32}$/u.test(subject) ||
        directory.href !== env[PROJECT_ENV]) return yield* Effect.fail(denied())
    const pane = bootstrapPane(io.cwd, subject.slice(8))
    if (!pane || pane.pane !== env.TMUX_PANE || pane.socket !== env.TMUX?.split(',')[0]) return yield* Effect.fail(denied())
    const journal = yield* openProjectJournal(directory, 'Write')
    const operations = projectActivationOperations(io.cwd, journal, liveProjectBootstrap(io.cwd, env.ARISTOTELES_DB, journal.directory))
    if (act === 'collect') return [yield* collectProjectHost(operations, subject, env[NONCE_ENV])]
    const result = yield* acknowledgeProjectHost(operations, subject, env[NONCE_ENV])
    return ['Project host acknowledged.', ...startingWords(result.state, subject)]
  }

  if (command === 'session' && act === 'ack') {
    if (!subject || !known([]) || !Schema.is(StaffSessionKey)(subject) || !/^session:[a-f0-9]{32}$/u.test(subject) ||
        env.ARISTOTELES_SESSION !== subject) return yield* Effect.fail(denied())
    const pane = bootstrapPane(io.cwd, subject.slice(8))
    if (!pane || pane.pane !== env.TMUX_PANE || pane.socket !== env.TMUX?.split(',')[0]) return yield* Effect.fail(denied())
    const journal = yield* openProjectJournal(directory, 'Write')
    const nonce = yield* decode(LaunchNonce, env[NONCE_ENV])
    const result = yield* projectRuns(io.cwd, env.ARISTOTELES_DB, journal).acknowledge(subject, nonce)
    return [words(result.event), ...startingWords(result.state, subject)]
  }

  const allowed = ['onboard', 'status', 'project', 'activation', 'session', 'wait', 'send', 'brief', 'report', 'review', 'question', 'answer']
  if (!allowed.includes(command)) return yield* Effect.fail(invalid())
  const journal = yield* openProjectJournal(directory, 'Write')
  const runs = projectRuns(io.cwd, env.ARISTOTELES_DB, journal)
  const actor: Effect.Effect<AuthenticatedActor, Refusal> = token ? Effect.flatMap(decode(ProjectCredential, token), runs.authenticate)
    : ownerTerminal() ? Effect.flatMap(ownerName(), (name) => activationOwner(journal, name)) : Effect.fail(denied())
  const asActor = Effect.provideService(Authority, { actor })
  const requireOwner = Effect.flatMap(actor, (by) => by._tag === 'Human' ? Effect.void : Effect.fail(denied()))
  const project = yield* readOpenProject(journal)
  const projectCommands = liveTaskCommands(io.cwd)

  if ((command === 'status' || (command === 'onboard' && act === 'status')) && !subject && known([])) {
    yield* actor
    return [JSON.stringify(Schema.encodeSync(Projection)(project), null, 2)]
  }
  if (command === 'onboard' && act === 'show' && known([])) {
    yield* actor
    const key = yield* decode(ProposalKey, subject)
    const proposal = project.proposals.get(key)
    if (!proposal) return yield* Effect.fail(invalid())
    return ['Read ' + project.read, JSON.stringify(Schema.encodeSync(Proposal)(proposal), null, 2)]
  }
  if (command === 'session' && known([])) {
    yield* requireOwner
    if (act === 'launch') {
      const staff = yield* decode(StaffKey, subject)
      const key = newStaffSession()
      const result = yield* runs.sessions.launch(staff, key, staffingAt(project))
      return ['Staff session ' + key, words(result.event), ...startingWords(result.state, key)]
    }
    if (act === 'end') {
      const key = yield* decode(StaffSessionKey, subject)
      const result = yield* runs.sessions.end(key)
      return [result ? words(result.event) : 'The session is already ended.']
    }
    if (act === 'observe') {
      const key = yield* decode(StaffSessionKey, subject)
      const result = yield* runs.sessions.observe(key)
      return [result ? words(result.event) : 'The session is still live or its status is unknown.']
    }
    return yield* Effect.fail(invalid())
  }
  if (command === 'activation' && known([]) && !subject && (act === 'resume' || act === 'relaunch' || act === 'rollback')) {
    yield* requireOwner
    yield* resumeProjectActivation(journal,
      projectActivationOperations(io.cwd, journal, liveProjectBootstrap(io.cwd, env.ARISTOTELES_DB, journal.directory)), act)
    return ['Activation updated.']
  }
  if (command === 'wait' && !act && !subject && known(['on'])) {
    const on = parsed.flags.length ? yield* read() : undefined
    const by = yield* actor
    if (by._tag === 'Human') return ['Open the Project page to see what needs your attention.']
    if (by._tag === 'Review' && by.line === 'Proposal') {
      const proposal = project.proposals.get(by.key)
      if (!proposal) return yield* Effect.fail(invalid())
      return ['Draft for review (proposal.json)', proposalText(proposal.value),
        `work review "$ARISTOTELES_TOKEN" ${proposal.key} --on=${project.read} --file=facts.yaml`]
    }
    const selected = yield* (by._tag === 'Review'
      ? waitOnTaskReview(journal, Effect.succeed(by))
      : waitOnProject(journal, Effect.succeed(by.session.key), on))
    if (selected._tag === 'Introduction') return [projectIntroductionWords(selected.subject, by.session, selected.read)]
    if (selected._tag !== 'Available') return [by._tag === 'Host'
      ? 'The bound host can send a task. Read ' + project.read + '.' : 'Nothing is due.']
    const { subject: target, read: basis } = selected
    if (target._tag === 'Question') return projectQuestionWords(target, basis)
    if (target._tag !== 'Task') return ['Read ' + basis + '. Proposal ' + target.proposal.key + ' is due.']
    const task = target.task
    if ((by._tag === 'Staff' || by._tag === 'Host') && selected.for === 'Assign') {
      const committed = yield* runs.sessions.child(by.session.key, task.key, 'Review', staffingAt(project))
      return ['Opened a fresh task review.', words(committed.event)]
    }
    if (by._tag === 'Review') return [
      yield* projectBriefCommand(journal, task.key, projectCommands).pipe(asActor),
      JSON.stringify(task.phase, null, 2),
      `work review "$ARISTOTELES_TOKEN" ${task.key} --on=${basis} --file=facts.yaml`,
    ]
    return [yield* projectBriefCommand(journal, task.key, projectCommands).pipe(asActor),
      `work report "$ARISTOTELES_TOKEN" ${task.key} --on=${basis} --file=report.yaml`]
  }
  if (command === 'brief' && act && !subject && known([]))
    return [yield* projectBriefCommand(journal, act, projectCommands).pipe(asActor)]

  if (!known(['on', 'file', 'why'])) return yield* Effect.fail(invalid())
  const basis = yield* read()
  const write = (input: Submission) => submit(journal, input).pipe(asActor)
  if (command === 'project' && act === 'start' && !subject && known(['on']))
    return [words((yield* write({ read: basis, line: 'Activation', move: 'start', input: {} })).event)]
  if (command === 'onboard' && act === 'submit' && !subject && known(['on', 'file'])) {
    const result = yield* projectOnboard(journal, basis, yield* file(), runs.review).pipe(asActor)
    return [words(result.event)]
  }
  if (command === 'onboard' && (act === 'accept' || act === 'remove' || act === 'send-back') &&
      known(act === 'send-back' ? ['on', 'why'] : ['on'])) {
    const key = yield* decode(ProposalKey, subject)
    const proposal = { read: basis, line: 'Proposal', key } as const
    const request: Submission = act === 'send-back'
      ? { ...proposal, move: 'sendBack', input: { why: yield* decode(Rationale, parsed.one('why')) } }
      : { ...proposal, move: act, input: {} }
    return [words((yield* write(request)).event)]
  }
  if (!known(['on', 'file'])) return yield* Effect.fail(invalid())
  if (command === 'send' && !act && !subject)
    return [words((yield* projectSendCommand(journal, basis, yield* file()).pipe(asActor)).event)]
  if (command === 'report' && act && !subject)
    return [words((yield* projectReportCommand(journal, act, basis, yield* file(), projectCommands).pipe(asActor)).event)]
  if (command === 'review' && act && !subject) {
    const content = yield* file()
    if (Schema.is(ProposalKey)(act)) {
      const facts = yield* decode(ReviewFacts, yield* yaml(content))
      const result = yield* write({ read: basis, line: 'Proposal', key: act, move: 'review', input: { facts } })
      yield* Effect.result(runs.review)
      return [words(result.event)]
    }
    return [words((yield* projectReviewCommand(journal, act, basis, content).pipe(asActor)).event)]
  }
  if ((command === 'question' || command === 'answer') && act && !subject)
    return [words((yield* projectQuestionCommand(journal, command, act, basis, yield* file()).pipe(asActor)).event)]
  return yield* Effect.fail(invalid())
})

export const runProjectCli = async (argv: readonly string[], io: {
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly out: (line: string) => void
  readonly err: (line: string) => void
  readonly isTTY: boolean
  readonly gitUser: () => string
}): Promise<0 | 1 | 3> => {
  const result = await Effect.runPromiseExit(Effect.scoped(projectCommand(argv, io)).pipe(
    withProjectEnv(io.env),
    Effect.catch((failure) => Effect.sync(() => { io.err(`${failure.code} · ${failure.why}`); return null })),
  ))
  if (Exit.isFailure(result)) { io.err('The project command failed.'); return 3 }
  if (result.value === null) return 1
  io.out(result.value.join('\n'))
  return 0
}
