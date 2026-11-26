import { Effect, Schema } from 'effect'
import { refuse } from '../../../core/schema/index.ts'
import { Dir, Env } from '../../../core/services/index.ts'
import { bootstrapRequest, runActivation } from '../../live/activation.ts'
import { bootstrapPane, NONCE_ENV, PROJECT_ENV } from '../../live/bootstrap.ts'
import { personAuthor } from '../caller.ts'
import type { Call, Commands } from '../command.ts'

import { Authority } from '../../../core/actions/project.ts'
import { readOpenProject } from '../../../core/actions/staff-session.ts'
import {
  HostCredential, LaunchNonce, ProjectId, Rationale, SessionId, refuse as refuseProject,
  type Of, type Project, type Refusal as ProjectRefusal,
} from '../../../core/schema/project.ts'
import { openProjectJournal, type Journal } from '../../../core/services/project.ts'
import { liveProjectBootstrap, resumeProjectActivation, projectActivationOperations, type ActivationOperations } from '../../live/project-activation.ts'

export const commands: Commands = {
  activation: (call) => Effect.gen(function* () {
    const { cwd } = yield* Dir
    const [action, launch] = call.args.positional
    if (action === 'ack' && launch) {
      const { vars } = yield* Env
      const result = yield* bootstrapRequest(cwd, launch, vars[NONCE_ENV], 'ack')
      return [result.line]
    }
    if (action !== 'resume' && action !== 'rollback' && action !== 'relaunch') {
      return yield* refuse('use work activation ack <id>|resume|rollback|relaunch')
    }
    if (call.token !== null) return yield* refuse('the person runs activation recovery')
    const by = yield* personAuthor(undefined)
    if (by._tag !== 'Person') return yield* refuse('the person runs activation recovery')
    return [yield* runActivation(cwd, by, action)]
  }),
}

export const projectBootstrapCommand = (call: Call) => Effect.gen(function* () {
  const { cwd } = yield* Dir
  const { vars } = yield* Env
  const project = vars[PROJECT_ENV]
  const [action, launch] = call.args.positional
  if (!Schema.is(ProjectId)(project) || !Schema.is(SessionId)(launch) ||
      !/^session:[a-f0-9]{32}$/.test(launch) || (action !== 'ack' && action !== 'collect') ||
      call.args.flags.length !== 0 || call.args.positional.length !== 2 || call.token !== null)
    return yield* Effect.fail(rejected())
  const pane = bootstrapPane(cwd, launch.slice('session:'.length))
  if (!pane || pane.pane !== vars.TMUX_PANE || pane.socket !== vars.TMUX?.split(',')[0])
    return yield* Effect.fail(rejected())
  const journal = yield* openProjectJournal(project, 'Write')
  const provider = liveProjectBootstrap(cwd, vars.ARISTOTELES_DB, project)
  const operations = projectActivationOperations(cwd, journal, provider)
  const nonce = vars[NONCE_ENV]
  if (action === 'collect') {
    const credential = yield* collectProjectHost(operations, launch, nonce)
    return [credential] as const
  }
  yield* acknowledgeProjectHost(operations, launch, nonce)
  return ['Project host acknowledged.'] as const
})

export const projectActivationCommand = (
  journal: Journal, operations: ActivationOperations, action: 'resume' | 'relaunch' | 'rollback',
): Effect.Effect<void, ProjectRefusal, Authority> => Effect.gen(function* () {
  const actor = yield* (yield* Authority).actor
  const project = yield* readOpenProject(journal)
  if (actor._tag !== 'Human' || actor.actor.id !== project.owner.id)
    return yield* Effect.fail(refuseProject('WrongActor', Rationale.make('The project owner runs activation recovery.')))
  yield* resumeProjectActivation(journal, operations, action)
})

const rejected = () => refuseProject('RetiredSession', Rationale.make('Use the current host’s private launch authority.'))
export const acknowledgeProjectHost = (
  operations: ActivationOperations, launch: unknown, nonce: unknown,
): Effect.Effect<void, ProjectRefusal> => Effect.gen(function* () {
  if (!Schema.is(SessionId)(launch) || !Schema.is(LaunchNonce)(nonce)) return yield* Effect.fail(rejected())
  yield* operations.acknowledge(launch, nonce)
  yield* operations.commit
  yield* operations.reconcile
})

export const collectProjectHost = (
  operations: ActivationOperations, launch: unknown, nonce: unknown,
): Effect.Effect<Of<typeof HostCredential>, ProjectRefusal> =>
  Schema.is(SessionId)(launch) && Schema.is(LaunchNonce)(nonce) ? operations.collect(launch, nonce) : Effect.fail(rejected())

export const authenticateProjectHost = (
  operations: ActivationOperations, launch: unknown, token: unknown,
): Effect.Effect<Project, ProjectRefusal> =>
  Schema.is(SessionId)(launch) && Schema.is(HostCredential)(token) ? operations.authenticate(launch, token) : Effect.fail(rejected())
