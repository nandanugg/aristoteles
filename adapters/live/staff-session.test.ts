import { startWork } from '../../src/store/project-activation.probe.ts'
import { expect, test } from 'bun:test'
import { dirname } from 'node:path'
import { Effect } from 'effect'
import { acceptStaffing, cliProposal } from '../../src/store/proposal.probe.ts'
import { readOpenProject } from '../../core/actions/staff-session.ts'
import { staffedIn, PaneAddress, ProposalKey, Rationale, StaffSessionKey, TaskKey, refuse, type Of, type Project } from '../../core/schema/project.ts'
import { open, staff, withJournal } from '../../src/store/project.probe.ts'
import { activateTasks, boundHost, send } from '../../src/store/task.probe.ts'
import { initialStaffing, sharedStaffing } from '../../src/store/staff-session.probe.ts'
import { staffSessionOperations, type Sessions } from './staff-session.ts'

const pane = { address: PaneAddress.make('%7') }
const missing = refuse('Unavailable', Rationale.make('Provider has not confirmed the stop.'))

test('concurrent launches use one lifetime, and unknown observations leave it live', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = yield* sharedStaffing(journal)
    const launched: Of<typeof StaffSessionKey>[] = []
    let observed: 'Unknown' | 'Ended' = 'Unknown'
    const provider: Sessions = {
      stop: () => Effect.void,
      reconcile: () => Effect.void,
      launch: (_staff, key) => Effect.sync(() => { launched.push(key); return pane }),
      observe: () => Effect.sync(() => observed),
      child: () => Effect.void,
    }
    const first = staffSessionOperations(dirname(path), journal, provider)
    const other = staffSessionOperations(dirname(path), journal, provider)
    const key = StaffSessionKey.make('session:actual')
    const second = StaffSessionKey.make('session:duplicate')
    const outcomes = yield* Effect.all([
      Effect.result(first.launch(staff.key, key, staffedIn(project))),
      Effect.result(other.launch(staff.key, second, staffedIn(project))),
    ], { concurrency: 'unbounded' })
    expect(outcomes.map(({ _tag }) => _tag).sort()).toEqual(['Failure', 'Success'])
    expect(launched).toHaveLength(1)
    const address = launched[0]!
    expect(yield* first.observe(address)).toBeNull()
    expect((yield* readOpenProject(journal)).sessions.get(address)?._tag).toBe('Live')
    observed = 'Ended'
    yield* first.observe(address)
    expect((yield* readOpenProject(journal)).sessions.get(address)?._tag).toBe('Ended')
  }))),
))

test('a failed spawn keeps its reservation until retirement is confirmed', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = yield* sharedStaffing(journal)
    const failed = StaffSessionKey.make('session:failed')
    const replacement = StaffSessionKey.make('session:replacement')
    let canStop = false
    const provider: Sessions = {
      stop: () => canStop ? Effect.void : Effect.fail(missing),
      reconcile: () => Effect.void,
      launch: (_staff, key) => Effect.gen(function* () {
        expect((yield* readOpenProject(journal)).sessions.get(key)?._tag).toBe('Starting')
        if (key === failed) return yield* Effect.fail(missing)
        return pane
      }),
      observe: () => Effect.sync(() => canStop ? 'Ended' : 'Running'),
      child: () => Effect.void,
    }
    const operations = staffSessionOperations(dirname(path), journal, provider)
    expect(yield* Effect.result(operations.launch(staff.key, failed, staffedIn(project))))
      .toMatchObject({ _tag: 'Failure', failure: { code: 'Unavailable' } })
    expect((yield* readOpenProject(journal)).sessions.get(failed)?._tag).toBe('Starting')
    expect(yield* Effect.result(operations.launch(staff.key, replacement, staffedIn(project))))
      .toMatchObject({ _tag: 'Failure', failure: { code: 'Unavailable' } })
    canStop = true
    yield* operations.launch(staff.key, replacement, staffedIn(project))
    const current = yield* readOpenProject(journal)
    expect(current.sessions.get(failed)?._tag).toBe('Ended')
    expect(current.sessions.get(replacement)?._tag).toBe('Live')
  }))),
))

test('a paused assignment can move only after the owner confirms the old process stopped', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const project = yield* sharedStaffing(journal)
    const plan = initialStaffing()
    const [host, other] = [...plan.staff.values()]
    if (!host || !other) throw new Error('Expected two staff assignments')
    const expanded: typeof plan = { ...plan, staff: new Map([
      [host.key, { ...host, roles: [host.roles[0], ...host.roles.slice(1), ...other.roles] }],
    ]) }
    const key = StaffSessionKey.make('session:limited')
    let observation: 'Running' | 'Paused' | 'Ended' = 'Running'
    let stops = 0
    const operations = staffSessionOperations(dirname(path), journal, {
      reconcile: () => Effect.void,
      launch: () => Effect.succeed(pane),
      stop: () => Effect.sync(() => { stops += 1 }),
      observe: () => Effect.sync(() => observation),
      child: () => Effect.void,
    })
    const live = yield* operations.launch(host.key, key, staffedIn(project))
    const adopted = yield* acceptStaffing(journal, live.state, expanded)
    // Review the move while the host can still supply its reviewer.
    expect(yield* Effect.result(acceptStaffing(journal, adopted, plan)))
      .toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidInput' } })
    const draft = ProposalKey.make('proposal:staffing-' + adopted.read)
    const accept = (state: Project) => cliProposal(journal, state, {
      line: 'Proposal', key: draft, move: 'accept', input: {},
    })
    observation = 'Paused'
    const paused = yield* operations.observe(key)
    if (!paused) throw new Error('Expected a Paused observation')
    expect(paused.state.proposals.get(draft)?.phase._tag).toBe('WaitingForOwner')
    expect(yield* Effect.result(accept(paused.state)))
      .toMatchObject({ _tag: 'Failure', failure: { code: 'InvalidInput' } })
    expect(yield* Effect.result(operations.end(key)))
      .toMatchObject({ _tag: 'Failure', failure: { code: 'Unavailable' } })
    expect((yield* readOpenProject(journal)).sessions.get(key)?._tag).toBe('Paused')
    observation = 'Ended'
    const ended = yield* operations.end(key)
    if (!ended) throw new Error('Expected a confirmed stop')
    expect(ended.state.sessions.get(key)?._tag).toBe('Ended')
    expect(stops).toBe(2)
    const changed = yield* accept(ended.state)
    expect(changed.state.staffing._tag).toBe('StaffingAccepted')
  }))),
))

test('the live adapter serializes child starts across roles assigned to one staff', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const staffed = yield* sharedStaffing(journal)
    const { state: project } = yield* startWork(journal, yield* activateTasks(journal, staffed))
    let started = 0
    const provider: Sessions = {
      stop: () => Effect.void,
      reconcile: () => Effect.void,
      launch: () => Effect.succeed(pane),
      observe: () => Effect.succeed('Running'),
      child: () => Effect.sync(() => { started += 1 }),
    }
    const operations = staffSessionOperations(dirname(path), journal, provider)
    const key = boundHost
    const host = { _tag: 'Task', key: TaskKey.make('task:host') } as const
    const pipeline = { _tag: 'Task', key: TaskKey.make('task:pipeline') } as const
    yield* send(journal, (yield* readOpenProject(journal)).read, host.key, project.roles.host)
    yield* send(journal, (yield* readOpenProject(journal)).read, pipeline.key, project.roles.pipeline)
    const outcomes = yield* Effect.all([
      Effect.result(operations.child(key, host.key, 'Work', staffedIn(project))),
      Effect.result(operations.child(key, pipeline.key, 'Work', staffedIn(project))),
    ], { concurrency: 'unbounded' })
    expect(outcomes.map(({ _tag }) => _tag).sort()).toEqual(['Failure', 'Success'])
    expect(started).toBe(1)
  }))),
))

test('a child launched against a replaced plan is reconciled and can try again on the new basis', () => withJournal((path) =>
  Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const journal = yield* open(path)
    const staffed = yield* sharedStaffing(journal)
    const { state: project } = yield* startWork(journal, yield* activateTasks(journal, staffed))
    let pending = false
    let replace = true
    let stopped = 0
    const task = { _tag: 'Task', key: TaskKey.make('task:stale-child') } as const
    const provider: Sessions = {
      stop: () => Effect.void,
      reconcile: (current) => Effect.sync(() => {
        if (pending && current.tasks.get(task.key)?.phase._tag !== 'Working') {
          stopped += 1
          pending = false
        }
      }),
      launch: () => Effect.succeed(pane),
      observe: () => Effect.succeed('Running'),
      child: () => Effect.gen(function* () {
        pending = true
        if (replace) {
          replace = false
          const current = yield* readOpenProject(journal)
          yield* acceptStaffing(journal, current, initialStaffing(1))
        }
      }),
    }
    const operations = staffSessionOperations(dirname(path), journal, provider)
    const key = boundHost
    yield* send(journal, (yield* readOpenProject(journal)).read, task.key)
    expect(yield* Effect.result(operations.child(key, task.key, 'Work', staffedIn(project))))
      .toMatchObject({ _tag: 'Failure', failure: { code: 'Stale' } })
    expect(stopped).toBe(1)
    const current = yield* readOpenProject(journal)
    expect(current.tasks.get(task.key)?.phase._tag).toBe('Sent')
    yield* operations.child(key, task.key, 'Work', staffedIn(current))
    expect((yield* readOpenProject(journal)).tasks.get(task.key)?.phase._tag).toBe('Working')
    expect(stopped).toBe(1)
  }))),
))
