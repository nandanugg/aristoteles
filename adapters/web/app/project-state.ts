import { Result, Schema } from 'effect'
import {
  Projection, Refusal, StoredEvents, Rationale, refuse, type Project, type StoredEvent,
} from '../../../core/schema/project.ts'
import { fold, readPosition } from '../../../core/state/project.ts'

const decodeSnapshot = Schema.decodeUnknownResult(Projection, { onExcessProperty: 'error' })
const decodeEvents = Schema.decodeUnknownResult(StoredEvents, { onExcessProperty: 'error' })
const invalidPayload = () => refuse('InvalidInput', Rationale.make('The page received an invalid project payload.'))

export interface PageProject {
  readonly current: () => Projection
  readonly replace: (state: Projection) => Result.Result<Project, Refusal>
  readonly receive: (events: readonly StoredEvent[]) => Result.Result<Projection, Refusal>
}

export const openPageProject = (
  payload: unknown, changed: (state: Projection) => void,
): Result.Result<PageProject, Refusal> => {
  const snapshot = decodeSnapshot(payload)
  if (Result.isFailure(snapshot)) return Result.fail(invalidPayload())
  let state = snapshot.success
  const receive = (events: readonly StoredEvent[]): Result.Result<Projection, Refusal> => {
    const after = readPosition(state)
    const fresh = events.filter((event) => event.number > after)
    if (fresh.length === 0) return Result.succeed(state)
    const next = fold(fresh, state)
    if (Result.isSuccess(next)) {
      state = next.success
      changed(state)
    }
    return next
  }
  return Result.succeed({
    current: () => state, receive,
    replace: (fresh) => {
      if (!fresh || (state && fresh.read < state.read)) return Result.fail(invalidPayload())
      if (!state || fresh.read > state.read) {
        state = fresh
        changed(state)
      }
      return Result.succeed(state)
    },
  })
}

export const receiveProjectPayload = (page: PageProject, payload: unknown): Result.Result<Projection, Refusal> => {
  const events = decodeEvents(payload)
  return Result.isFailure(events) ? Result.fail(invalidPayload()) : page.receive(events.success)
}

export const replaceProjectSnapshot = (page: PageProject, payload: unknown): Result.Result<Project, Refusal> => {
  const state = decodeSnapshot(payload)
  return Result.isFailure(state) ? Result.fail(invalidPayload()) : page.replace(state.success)
}
