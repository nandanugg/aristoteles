// work wait <token>: an agent or the host runs it when it has nothing to do. It blocks until the
// actor owes a step, then prints that one step (what it is about, then its command) and exits 0;
// the agent does it and runs work wait again. Nothing is typed into a terminal: this command is how
// they hear of work. While it blocks, a marker next to the store says that the actor waits, so
// that the watcher does not take it for a silent terminal (adapters/live/waiting.ts).
import type { AuthenticatedActor } from '../../../core/actions/project.ts'
import { ReadPosition as ProjectRead, Rationale, refuse as refuseProject } from '../../../core/schema/project.ts'
import { randomUUID } from 'node:crypto'
import { Effect, Fiber } from 'effect'
import { canCheckpoint, checkpointWorker, helperCredential } from '../../../core/actions/recheck.ts'
import { readyRecheck } from '../../../core/derived/c16/recheck.ts'
import { foldRechecks } from '../../../core/state/rechecks.ts'
import { acknowledgeChild, authorizeChildStart, finishReviewChild, reconcileChild, reserveReviewChild } from '../../../core/actions/child.ts'
import { admissionFor, stepDemand } from '../../../core/derived/c16/admission.ts'
import { workerSteps } from '../../../core/derived/c16/worker.ts'
import { memberSecretOf, offerWorker, workerSecretOf, workerSession } from '../../../core/actions/worker.ts'
import { childFor, foldRuntime, privateWorker } from '../../../core/state/worker-runtime.ts'
import { folding } from '../../../core/actions/dispatch.ts'
import { type WaitEnd, waitFor } from '../../../core/effects/wait.ts'
import { refuse } from '../../../core/schema/index.ts'
import { cliSession, Dir, Env, readWorkerLaunch, sha, stageWorkerLaunch, Store } from '../../../core/services/index.ts'
import { foldWork } from '../../../core/state/c16/fold.ts'
import { type Answered, actorOf } from '../../../core/state/c16/types.ts'
import { BEAT_MS, markReturned, markWaiting, type WaitPlace } from '../../live/waiting.ts'
import { buildOf } from '../../live/build.ts'
import { makerWords, stepLine, stepWords, workTokenOf } from '../../words/work.ts'
import type { Command, Commands } from '../command.ts'
import { textOf } from '../args.ts'
import { verifyWork } from '../caller.ts'

import { readOpenProject, staffAuthority } from '../../../core/actions/staff-session.ts'
import { nextStep, type Selection } from '../../../core/derived/project/next-step.ts'
import type { Of, Refusal as ProjectRefusal, SessionId } from '../../../core/schema/project.ts'
import type { Journal } from '../../../core/services/project.ts'

// Under the 10-minute limit of a command in Claude Code (onboard waits no longer than this).
export const WAIT_SECONDS = 540
const POLL_MS = 500
const BUILD_MS = 5000

const OLD_TOKEN = /^a\d+(\.|$)/

// The typed answer of a Hear step, as words (the question's own choices and rows by name).
const answerWords = (a: Answered): string => {
  const form = a.ask.question?.form
  const b = a.answer
  const text = b._tag === 'Single'
    ? b.text
    : b._tag === 'Multiple'
    ? b.texts.map((t, i) => `${i + 1}. ${t}`).join(' | ')
    : b._tag === 'Choice'
    ? b.picked.map((i) => (form?._tag === 'Choice' ? form.options[i] : undefined) ?? `${i}`)
      .join(', ')
    : b.cells.map((c, i) =>
      form?._tag === 'Matrix' ? `${form.rows[i]}: ${form.columns[c]}` : `${i}: ${c}`
    ).join(' | ')
  return `the answer to ask ${a.ask.id} (${b._tag}): ${text}`
}

// The token of the call: w.<actor>.<epoch>.<secret>, the first word.
const tokenOf = (call: Parameters<Command>[0]): string | null =>
  call.token ?? call.args.positional.find((w) => /^(w|a\d+)\./.test(w)) ?? null

const waitWorker = (
  store: Effect.Success<ReturnType<Effect.Success<typeof Store>['open']>>,
  worker: string,
  generation: number,
  secret: string,
  seconds: number,
  abandon: boolean,
  hostToken?: string,
  privateActor?: string,
) => Effect.gen(function* () {
  const { cwd } = yield* Dir
  const until = Date.now() + seconds * 1000
  if (abandon) {
    yield* offerWorker(worker, generation, secret, true)
    return ['The outstanding turn was abandoned.']
  }
  for (;;) {
    let observation: string[] = []
    const before = yield* store.events
    const priorRuntime = foldRuntime(before)
    const parent = priorRuntime.workers.get(worker)
    if (parent?.reservation.generation === generation && !parent.fenced && !parent.ended &&
      parent.binding?.waitVerifier === sha(secret)) {
      const job = [...foldRechecks(before).values()].find((entry) =>
        entry.queued.worker === worker && !entry.taken &&
        ((!entry.report && !entry.cancelled) || (entry.route?.kind === 'child' &&
          priorRuntime.children.get(entry.route.allocation)?.released === null)))
      if (parent.parking) return [`Worker park for ${parent.parking.job} is awaiting a confirmed stop.`]
      const route = job?.route?.kind === 'child' ? priorRuntime.children.get(job.route.allocation) : undefined
      if (job && route && !route.released) {
        const member = parent.binding.members.find(({ actor }) => actor === 'pipe')
        if (member) {
          const token = workTokenOf('pipe', member.epoch, memberSecretOf(secret, 'pipe', member.epoch))
          if (route.started && (job.report || job.cancelled || route.reservation.generation !== generation)) {
            observation = [`Confirm the native recheck child has stopped before settling ${route.reservation.child}.`,
              `work worker child-reconcile ${token} ${route.reservation.child} --observation="<native CLI outcome>"`]
          }
          if (!job.cancelled && !route.started && route.reservation.generation === generation) {
            return [`Fresh recheck for ${job.queued.task}: work worker child-start ${token} ${route.reservation.child}`]
          }
        }
      }
      if (job?.deferred && parent.binding && !parent.offer && canCheckpoint(parent) &&
        (job.checkpoint?.generation !== generation ||
          (job.park?._tag === 'WorkerParkCancelled' && job.park.checkpoint === job.checkpoint.checkpoint)) &&
        ![...priorRuntime.children.values()].some(({ reservation, released }) =>
          reservation.worker === worker && released === null)) {
        const session = parent.binding.session
        const handle = parent.reservation.checkpoint
          ? readWorkerLaunch(cwd, parent.reservation.checkpoint, 'checkpoint')
          : cliSession(session.startsWith('boot-') ? session.slice('boot-'.length) : session)
        return [job.deferred.reason,
          `After the native CLI saves its session, run work worker checkpoint ${job.queued.job} ${handle} --credential=<worker-credential>.`]
      }
    }
    yield* offerWorker(worker, generation, secret)
    const events = yield* store.events
    const folded = foldWork(events)
    const runtime = foldRuntime(events)
    const current = runtime.workers.get(worker)
    if (current?.reservation.generation !== generation || current.fenced) {
      return yield* refuse('This worker generation is no longer live.')
    }
    if (folded?.state.top.ended) return ['The project has ended.']
    const offer = current.offer
    if (offer && folded) {
      const privateSpelling = offer.actor === privateActor
      const token = offer.actor === 'host' && hostToken !== undefined ? hostToken :
        workTokenOf(offer.actor, offer.epoch, memberSecretOf(secret, offer.actor, offer.epoch))
      const shown = stepLine(folded.state, offer.step, offer.on).replaceAll('<token>', token)
      const command = !privateSpelling && offer.step.act === 'Open' && offer.actor === 'host'
        ? shown.replace(/--sections=\S+/, () => `--sections=${JSON.stringify(offer.step.task)}`)
        : shown
      const scoped = command.replace(/--on (\d+)(?=\s|$)/, '--on=$1')
      const on = /(?:^|\s)--on=/.test(scoped) ? '' : ` --on=${offer.on}`
      const job = offer.step.act === 'RecheckDone'
        ? readyRecheck(folded.state, runtime, foldRechecks(events), offer.step.task ?? '') : undefined
      const verdict = job?.report
      const payload = verdict && job
        ? `work recheck ${token} ${job.queued.task} ${verdict.findings.every((finding) => finding.outcome === 'holds') ? 'holds' : 'fails'} --items=${job.queued.items.map(([id]) => id).join(',')} --job=${job.queued.job} --report=${verdict.report}`
        : scoped
      const basis = verdict ? ` --on=${offer.on}` : on
      const heard = offer.step.act === 'Hear' ? folded.state.answered.get(offer.step.ask ?? '') : undefined
      return [
        ...observation,
        ...(job && verdict
          ? [`Helper report ${verdict.report} for ${job.queued.task} checked the exact items on basis ${job.queued.on}.`]
          : stepWords(folded.state, offer.step, events)),
        ...(heard === undefined ? [] : [answerWords(heard)]),
        privateSpelling ? `${payload}${basis}` : `${payload}${basis} --turn=${workerSecretOf(secret, offer.turn)}`,
      ]
    }
    if (observation.length) return observation
    if (Date.now() >= until) {
      const blocked = folded ? workerSteps(folded.state, current.reservation.members).flatMap(({ actor, step }) => {
        const route = admissionFor(folded, runtime, actor, stepDemand(step))
        return route.kind === 'waiting' ? [route.reason] : []
      }) : []
      const job = [...foldRechecks(events).values()].find((entry) =>
        entry.queued.worker === worker && !entry.taken && !entry.cancelled)
      return [...new Set(blocked), ...(job?.deferred ? [job.deferred.reason] : []), 'Run the worker wait again.']
    }
    yield* Effect.sleep(POLL_MS)
  }
})

const worker: Command = (call) => Effect.gen(function* () {
  const { cwd } = yield* Dir
  const { vars } = yield* Env
  const [action, raw] = call.args.positional
  if (action === 'checkpoint') {
    const handle = call.args.positional[2]
    const credential = textOf(call.args.one('credential')) ?? vars.ARISTOTELES_WORKER_CREDENTIAL
    if (!raw || !handle || !credential) return yield* refuse('Supply the job, native session handle and worker credential.')
    yield* checkpointWorker(raw, credential, handle)
    return ['Checkpoint saved. Wait for the worker park to reconcile.']
  }
  if (action === 'child-ack' || action === 'child-review-done') {
    if (!call.token) return yield* refuse('Supply the allocated child credential.')
    if (action === 'child-ack') yield* acknowledgeChild(call.token)
    else yield* finishReviewChild(call.token)
    return [action === 'child-ack' ? 'Child bound.' : 'Review allocation complete. Return the review to the parent.']
  }
  if (action === 'child-review') {
    const on = textOf(call.args.one('on'))
    const turn = textOf(call.args.one('turn'))
    if (!call.token || !raw || !on || !/^\d+$/.test(on) || !turn) {
      return yield* refuse('Use work worker child-review <Pipe-token> <fix> with the offered --on and --turn.')
    }
    const seq = yield* reserveReviewChild(call.token, raw, Number(on), turn)
    return [seq === null ? 'A review is already reserved or has completed for this draft.'
      : `Reserved child-${seq} for this review. Run work worker child-start ${call.token} child-${seq}.`]
  }
  if (action === 'child-start' || action === 'child-reconcile') {
    if (!raw || !call.token) return yield* refuse('Supply the child allocation ID and the parent identity credential.')
    if (action === 'child-reconcile') {
      yield* reconcileChild(raw, call.token, textOf(call.args.one('observation')) ?? '')
      return ['The child allocation is settled.']
    }
    const secret = randomUUID().replaceAll('-', '')
    const seq = yield* authorizeChildStart(raw, call.token, secret)
    if (seq === null) return ['A launch was already authorized. Check the native CLI before doing anything else.']
    const store = yield* (yield* Store).open(cwd, { create: false })
    const runtime = foldRuntime(yield* store.events)
    const child = runtime.children.get(raw)
    if (!child || child.released) return yield* refuse('This child was withdrawn.')
    const { actor, epoch, worker: workerId, generation: ownerGeneration } = child.reservation
    const owner = runtime.workers.get(workerId)
    if (!owner?.binding || owner.fenced || owner.ended || owner.reservation.generation !== ownerGeneration) {
      return yield* refuse('This child belongs to a retired worker generation.')
    }
    const token = workTokenOf(actor, epoch, secret)
    const model = owner.reservation.placement.model
    const folded = foldWork(yield* store.events)
    const comparison = folded?.state.fixes.get(child.reservation.subject)
    const draft = comparison ? JSON.stringify({
      summary: comparison.summary, role: comparison.roleDraft, items: [...comparison.draft],
    }) : '{}'
    if (child.reservation.purpose === 'recheck') {
      const helper = helperCredential(child.reservation.launch, secret)
      const job = child.reservation.job
      return [`Start one fresh background subagent using model ${model} with this prompt:`,
        `You are a fresh recheck helper of an Aristoteles project. Run work recheck-helper ack ${helper}, then work recheck-brief ${helper} ${job}. Judge the exact result. Write YAML with on and findings (item, version, outcome holds or breaks, evidence). Submit work recheck-report ${helper} ${job} --file=<report>, then stop.`]
    }
    const prompt = child.reservation.purpose === 'maker' ? makerWords(actor, token) :
      `You are a reviewer of an Aristoteles project. Acknowledge with work worker child-ack ${token}. ` +
      `Review draft ${child.reservation.subject} on basis ${child.reservation.on}. Keep the files unchanged. Draft: ${draft}\n` +
      `When finished run work worker child-review-done ${token}, then return your findings to the parent.`
    return [`Start one native background subagent for ${raw} using model ${model} with this prompt:`, prompt]
  }
  const match = /^g\.([a-f0-9]{32})\.([1-9][0-9]*)\.([a-f0-9]{32})$/.exec(raw ?? vars.ARISTOTELES_WORKER_CREDENTIAL ?? '')
  if (!match) return yield* refuse('Supply the current worker credential.')
  const [, launch, epoch, secret] = match as unknown as [string, string, string, string]
  const generation = Number(epoch)
  const store = yield* (yield* Store).open(cwd, { create: false })
  const current = [...foldRuntime(yield* store.events).workers.values()].find(
    (entry) => entry.reservation.launch === launch && entry.reservation.generation === generation &&
      !entry.fenced && !entry.ended)
  if (!current) return yield* refuse('This worker generation is no longer live.')
  if (action === 'ack') {
    if (vars.ARISTOTELES_SESSION !== workerSession(launch)) {
      return yield* refuse('This acknowledgement must come from the reserved session.')
    }
    if (readWorkerLaunch(cwd, launch, 'secret') !== secret) return yield* refuse('Wrong worker credential.')
    yield* Effect.sync(() => stageWorkerLaunch(cwd, launch, 'ack', sha(secret)))
    return []
  }
  if (action !== 'wait') return yield* refuse('Use work worker wait.')
  const seconds = Number(textOf(call.args.one('seconds')) ?? WAIT_SECONDS)
  if (!Number.isFinite(seconds) || seconds <= 0) return yield* refuse('wait needs a positive number of seconds')
  const until = Date.now() + seconds * 1000
  if (readWorkerLaunch(cwd, launch, 'secret') !== secret) return yield* refuse('Wrong worker credential.')
  for (;;) {
    const latest = foldRuntime(yield* store.events).workers.get(current.reservation.worker)
    if (latest?.reservation.launch !== launch || latest.fenced || latest.ended) {
      return yield* refuse('This worker generation is no longer live.')
    }
    if (latest.binding) break
    if (Date.now() >= until) return ['Run the worker wait again.']
    yield* Effect.sleep(POLL_MS)
  }
  const hostToken = current.reservation.members.includes('host') && generation === 1
    ? readWorkerLaunch(cwd, launch, 'host') ?? undefined : undefined
  return yield* waitWorker(store, current.reservation.worker, generation, secret,
    Math.max(0, (until - Date.now()) / 1000), call.args.one('abandon') !== undefined, hostToken)
})

const wait: Command = (call) =>
  Effect.gen(function* () {
    if (textOf(call.args.one('launch')) !== undefined)
      return yield* refuse('The project bootstrap collects its credential with work activation collect.')
    const token = tokenOf(call)
    if (token === null) {
      return yield* refuse(
        'work wait needs your token (w.<actor>.<epoch>.<secret>); the person has no work wait',
        'the page shows the person what is theirs to do',
      )
    }
    if (OLD_TOKEN.test(token) || call.args.one('by') !== undefined) {
      return yield* refuse(
        'this store is new: the old tokens and work wait --by do not work in it',
        'restart this terminal, so that it gets the token of the new store',
      )
    }
    const { cwd } = yield* Dir
    const { vars } = yield* Env
    const store = yield* (yield* Store).open(cwd, { create: false })
    let events = yield* store.events
    const maker = /^w\.(maker:[^.]+)\./.exec(token)?.[1]
    if (maker && childFor(foldRuntime(events), maker)) {
      yield* acknowledgeChild(token)
      events = yield* store.events
    }
    const folded = yield* folding(() => foldWork(events))
    if (folded === null) return yield* refuse(`no top is open in ${cwd}`, 'the person opens it')
    const { who, ep } = yield* verifyWork(folded, token)
    const placement = foldRuntime(events).placements.find((entry) => entry.members.includes(who))
    if (placement) {
      if (ep !== (folded.state.ep.get(who) ?? 0)) {
        return [`this terminal's token is old: ${who} is at a newer epoch. STOP: do nothing more in this terminal.`]
      }
      const current = foldRuntime(yield* store.events).workers.get(placement.worker)
      if (current?.fenced) return ["this terminal's token is old. STOP: do nothing more in this terminal."]
      if (!current?.binding) return ['The worker is starting. Run the wait again.']
      if (!privateWorker(placement) &&
        !(who === 'host' && current.reservation.generation === 1 && current.binding.session === folded.hostSession)) {
        return yield* refuse('Use work worker wait with the worker credential.')
      }
      const secret = readWorkerLaunch(cwd, current.reservation.launch, 'secret')
      if (!secret) return yield* refuse('The worker launch credential is unavailable.')
      if (!privateWorker(placement)) {
        yield* Effect.sync(() => stageWorkerLaunch(cwd, current.reservation.launch, 'host', token))
        return [`Run work worker wait g.${current.reservation.launch}.${current.reservation.generation}.${secret}`]
      }
      const seconds = Number(textOf(call.args.one('seconds')) ?? WAIT_SECONDS)
      if (!Number.isFinite(seconds) || seconds <= 0) return yield* refuse('wait needs a positive number of seconds')
      return yield* waitWorker(store, placement.worker, current.reservation.generation, secret, seconds,
        false, who === 'host' ? token : undefined, privateWorker(placement) ? who : undefined)
    }
    const actor = actorOf(who)
    if (actor._tag === 'Harness' || actor._tag === 'Human') {
      return yield* refuse(`${who} does not wait`, 'work wait is for the agents and the host')
    }
    const place: WaitPlace = { env: vars, cwd, actor: who }
    // The marker is renewed while the wait blocks; it is never renewed after the return.
    let beat: Fiber.Fiber<never> | undefined
    const blocking = Effect.gen(function* () {
      yield* markWaiting(place, null)
      beat = yield* Effect.forkDetach(
        Effect.forever(Effect.andThen(Effect.sleep(BEAT_MS), markWaiting(place, null))),
      )
    })
    const end: WaitEnd = yield* waitFor(store, {
      actor,
      ep,
      pollMs: POLL_MS,
      blocking,
      build: Effect.sync(() => buildOf(vars)),
      buildMs: BUILD_MS,
    }).pipe(
      // A wait that blocked waits no more, also when it fails.
      Effect.ensuring(
        Effect.suspend(() =>
          beat === undefined
            ? Effect.void
            : Effect.andThen(Fiber.interrupt(beat), markReturned(place, null)),
        ),
      ),
    )
    switch (end._tag) {
      case 'Step':
        return [
          ...stepWords(end.folded.state, end.step, end.events),
          ...(end.heard === null ? [] : [answerWords(end.heard)]),
          stepLine(end.folded.state, end.step, end.folded.state.seq).replaceAll('<token>', token),
        ]
      case 'Old':
        return [
          `this terminal's token is old: ${who} is at epoch ${end.now} and your token is of ` +
            `epoch ${ep}. STOP: do nothing more in this terminal.`,
        ]
      case 'Ended':
        return ['the project has ended; there is nothing more for you.']
      case 'Updated':
        return [`aristoteles was updated; run work wait ${token} again.`]
      case 'NoTop':
        return yield* refuse(`no top is open in ${cwd}`, 'the person opens it')
    }
  })

export const commands: Commands = { wait, worker }

// The credential adapter resolves a token to its lifetime before using the shared selection.
export const waitOnProject = (
  journal: Journal, authenticate: Effect.Effect<Of<typeof SessionId>, ProjectRefusal>,
): Effect.Effect<Selection, ProjectRefusal> => Effect.gen(function* () {
  const id = yield* authenticate
  const project = yield* readOpenProject(journal)
  const session = yield* staffAuthority(project, id)
  const events = yield* journal.eventsAfter(ProjectRead.make(0))
  return nextStep(project, session, events.filter((event) => event.number <= project.read))
})

export const waitOnTaskReview = (
  journal: Journal, authenticate: Effect.Effect<AuthenticatedActor, ProjectRefusal>,
): Effect.Effect<Selection, ProjectRefusal> => Effect.gen(function* () {
  const actor = yield* authenticate
  const project = yield* readOpenProject(journal)
  if (actor._tag === 'Review' && actor.line._tag === 'Task') {
    const session = yield* staffAuthority(project, actor.session.id)
    const task = project.tasks.get(actor.line.id)
    if (task?.phase._tag === 'Reviewing' && task.phase.assignment._tag === 'Assigned' &&
        task.phase.assignment.by.id === session.staff.id && actor.session.staff.id === session.staff.id &&
        task.phase.assignment.review === actor.review) {
      return { _tag: 'Available', subject: { _tag: 'Task', task }, for: 'Review', read: project.read }
    }
  }
  return yield* Effect.fail(refuseProject('RetiredSession', Rationale.make('Use the current child assigned to review this task.')))
})
