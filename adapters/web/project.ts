import { taskCommandBlock, type TaskCommands } from '../../core/effects/project-commands.ts'
import { taskBrief } from '../../core/actions/task.ts'
import { Effect, Result, Schema } from 'effect'
import { projectActivationFiles } from '../live/activation.ts'
import { readOpenProject } from '../../core/actions/staff-session.ts'
import { Authority, submit } from '../../core/actions/project.ts'
import { ApprovedFiles, approvedProposals, Projection, ReadPosition, Refusal, Rationale, StoredEvents, TaskEvent, refuse, type Of, type TaskAddress } from '../../core/schema/project.ts'
import type { Journal } from '../../core/services/project.ts'
import { fold } from '../../core/state/project.ts'

const encodeProjection = Schema.encodeSync(Projection)
const encodeEvents = Schema.encodeSync(StoredEvents)

// The server binds the journal to the authenticated project before supplying it to these handlers.
export const projectSnapshot = (journal: Journal): Effect.Effect<Response, Refusal> =>
  Effect.flatMap(journal.eventsAfter(ReadPosition.make(0)), (events) => {
    const state = fold(events)
    return Result.isFailure(state) ? Effect.fail(state.failure) : Effect.succeed(Response.json(encodeProjection(state.success)))
  })

export const projectEvents = (
  journal: Journal, after: Of<typeof ReadPosition>,
): Effect.Effect<Response, Refusal> =>
  Effect.map(journal.eventsAfter(after), (events) => Response.json(encodeEvents(events)))

// The server supplies the journal and authenticates the actor before responding to the page.
export const projectSubmission = (
  journal: Journal, request: Request, review?: Effect.Effect<unknown, Refusal>, activate?: Effect.Effect<unknown, Refusal>,
  commands?: (line: Of<typeof TaskAddress>) => Effect.Effect<unknown, Refusal>,
): Effect.Effect<Response, never, Authority> => {
  const input = Effect.tryPromise({
    try: async (): Promise<unknown> => request.json(),
    catch: () => refuse('InvalidInput', Rationale.make('Send a checked project submission.')),
  })
  return Effect.matchEffect(Effect.flatMap(input, (body) => submit(journal, body)), {
    onSuccess: ({ event }) => Effect.gen(function* () {
      if (review && event.line._tag === 'Proposal' && event.from !== null)
        yield* Effect.forkDetach(Effect.result(review))
      if (activate && event.line._tag === 'Activation' && event.from === 'Onboarding')
        yield* Effect.forkDetach(Effect.result(activate))
      if (commands && Schema.is(TaskEvent)(event) && event.from === 'Working' && event.move === 'next')
        yield* Effect.forkDetach(Effect.result(commands(event.line)))
      return Response.json(encodeEvents([event]))
    }),
    onFailure: (failure) => Effect.succeed(Response.json(Schema.encodeSync(Refusal)(failure), {
      status: failure.code === 'WrongActor' || failure.code === 'RetiredSession' ? 403
        : failure.code === 'Stale' || failure.code === 'WrongMove' ? 409 : 400,
    })),
  })
}

export const projectActivationApproval = (journal: Journal, directory: string): Effect.Effect<Response, Refusal, Authority> =>
  Effect.gen(function* () {
    const actor = yield* (yield* Authority).actor
    const project = yield* readOpenProject(journal)
    if (actor._tag !== 'Human' || actor.actor.id !== project.owner.id)
      return yield* Effect.fail(refuse('WrongActor', Rationale.make('Only the owner approves the activation files.')))
    if (project.activation._tag !== 'Onboarding' || !approvedProposals(project))
      return yield* Effect.fail(refuse('WrongMove', Rationale.make('Accept the onboarding proposals before activation.')))
    const files = yield* projectActivationFiles(directory)
    return Response.json(Schema.encodeSync(ApprovedFiles)(files))
  })

export const projectCommandStatus = (journal: Journal, line: Of<typeof TaskAddress>, commands: TaskCommands) =>
  Effect.flatMap(taskBrief(journal, line), () =>
    Effect.map(taskCommandBlock(journal, line, commands), (why) =>
      Response.json(Schema.encodeSync(Schema.NullOr(Rationale))(why))))
