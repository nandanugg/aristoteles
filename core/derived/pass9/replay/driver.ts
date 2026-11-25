// The runtime driver gets inputs, never a target state. It steps the implementation to the
// projected boundary and reads observations there. A single model step can span several durable
// runtime events, e.g. fresh helper report followed by confirmed process end.
import { diff } from '../../c16/replay/replay.ts'
import type { ModelAct } from '../../c16/replay/acts.ts'
import {
  type Identity, type JobPhase, type Witness, admissionOf, input, permitsOf, protocolAct, workerOf,
} from './model.ts'
import {
  type AdmissionRead, type PermitsRead, type WorkerObservation, admissionProjector, permitsProject, workerProjector,
} from './project.ts'

export type WorkerCommand =
  | { readonly kind: 'offer' | 'withdraw'; readonly identity: Identity }
  | { readonly kind: 'printOldest' | 'submit' | 'park' | 'exit' | 'relaunch' }
export type AdmissionCommand =
  | { readonly kind: 'startPipe' | 'yieldPipe' | 'handToPerson' | 'finishPipe'; readonly job: number }
  | { readonly kind: 'decide'; readonly job: number; readonly outcome: Extract<JobPhase, 'Owed' | 'Closed'> }
  | { readonly kind: 'openMake' | 'reviewFails'; readonly task: number }
  | { readonly kind: 'endMaker'; readonly task: number; readonly outcome: 'Checking' | 'MakerDown' }
  | { readonly kind: 'releaseAttempt'; readonly task: number; readonly outcome: 'Finished' | 'Queued' }
  | { readonly kind: 'startRecheck' | 'finishRecheck' | 'waitPipe' }
export type PermitsCommand =
  | { readonly kind: 'act'; readonly act: ModelAct }
  | { readonly kind: 'routeRecheck' | 'requestPark' | 'confirmPark' | 'failPark' | 'capacityOffered'
      | 'startFresh' | 'helperReports' | 'resumeParent' }

export interface RuntimeDriver<Command, Observation> {
  readonly read: () => Promise<Observation>
  readonly step: (command: Command) => Promise<Observation>
}

type Frame = Witness['frames'][number]
const unrecognized = (family: string, action: string): never => {
  throw new Error(`${family}: unknown Quint action ${action}`)
}
const workerCommand = (frame: Frame): WorkerCommand => {
  const kind = frame.action
  switch (kind) {
    case 'offer':
    case 'withdraw':
      return { kind, identity: input(frame, 'identity') as Identity }
    case 'printOldest':
    case 'submit':
    case 'park':
    case 'exit':
    case 'relaunch':
      return { kind }
    default:
      return unrecognized('worker', kind)
  }
}
const admissionCommand = (frame: Frame): AdmissionCommand => {
  const kind = frame.action
  switch (kind) {
    case 'startPipe':
    case 'yieldPipe':
    case 'handToPerson':
    case 'finishPipe':
      return { kind, job: Number(input(frame, 'j')) }
    case 'startRecheck':
    case 'finishRecheck':
    case 'waitPipe':
      return { kind }
    case 'decide':
      return { kind, job: Number(input(frame, 'j')), outcome: input(frame, 'outcome') as 'Owed' | 'Closed' }
    case 'openMake':
    case 'reviewFails':
      return { kind, task: Number(input(frame, 't')) }
    case 'endMaker':
      return { kind, task: Number(input(frame, 't')), outcome: input(frame, 'outcome') as 'Checking' | 'MakerDown' }
    case 'releaseAttempt':
      return { kind, task: Number(input(frame, 't')), outcome: input(frame, 'terminal') as 'Finished' | 'Queued' }
    default:
      return unrecognized('admission', kind)
  }
}
const permitsCommand = (frame: Frame): PermitsCommand => {
  const act = protocolAct(frame)
  if (act) return { kind: 'act', act }
  const kind = frame.action
  switch (kind) {
    case 'routeRecheck':
    case 'requestPark':
    case 'confirmPark':
    case 'failPark':
    case 'capacityOffered':
    case 'startFresh':
    case 'helperReports':
    case 'resumeParent':
      return { kind }
    default:
      return unrecognized('permits', kind)
  }
}

const replay = async <Command, Observation, View>(
  witness: Witness,
  runtime: RuntimeDriver<Command, Observation>,
  commandOf: (frame: Frame) => Command,
  modelOf: (frame: Frame) => View,
  project: (observation: Observation) => View,
): Promise<void> => {
  for (const [i, frame] of witness.frames.entries()) {
    try {
      // The admission model has an explicit stutter branch with no action label.
      if (i > 0 && frame.action === '' && !Bun.deepEquals(frame.values, witness.frames[i - 1]!.values)) {
        throw new Error('unlabeled model action changed state')
      }
      const observed = i === 0 || frame.action === ''
        ? await runtime.read()
        : await runtime.step(commandOf(frame))
      const problems = diff(modelOf(frame), project(observed))
      if (problems.length) throw new Error(`model | runtime\n${problems.join('\n')}`)
    } catch (error) {
      throw new Error(`${witness.name}, step ${i} (${frame.action || 'stutter'}): ${String(error)}`, { cause: error })
    }
  }
}

export const replayWorker = (trace: Witness, runtime: RuntimeDriver<WorkerCommand, WorkerObservation>) =>
  replay(trace, {
    read: runtime.read,
    step: async (command) => {
      const observation = await runtime.step(command)
      if (command.kind === 'submit' && (!observation.intake || observation.intake.outcome === 'retry')) {
        throw new Error('model submission requires a fresh intake outcome')
      }
      if (command.kind !== 'submit' && observation.intake) throw new Error('unexpected intake observation')
      return observation
    },
  }, workerCommand, workerOf, workerProjector())

export const replayAdmission = (trace: Witness, runtime: RuntimeDriver<AdmissionCommand, AdmissionRead>, cap: number) =>
  replay(trace, runtime, admissionCommand, admissionOf, admissionProjector(cap))

export const replayPermits = (trace: Witness, runtime: RuntimeDriver<PermitsCommand, PermitsRead>) =>
  replay(trace, runtime, permitsCommand, permitsOf, permitsProject)
