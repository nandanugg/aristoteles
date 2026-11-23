import { Effect, Schema } from 'effect'
import { join } from 'node:path'
import {
  acknowledgeRecheckChild, helperMayRead, helperProof, reportRecheck,
} from '../../../core/actions/recheck.ts'
import { workerSession } from '../../../core/actions/worker.ts'
import { currentRecheck } from '../../../core/derived/c16/recheck.ts'
import { RecheckFinding, refuse } from '../../../core/schema/index.ts'
import { Dir, Env, Files, readWorkerLaunch, sha, stageWorkerLaunch, Store } from '../../../core/services/index.ts'
import { foldWork } from '../../../core/state/c16/fold.ts'
import { foldRechecks } from '../../../core/state/rechecks.ts'
import { foldRuntime } from '../../../core/state/worker-runtime.ts'
import { recheckBriefWords } from '../../words/work.ts'
import { textOf } from '../args.ts'
import type { Command, Commands } from '../command.ts'

const read = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const store = yield* (yield* Store).open(cwd, { create: false })
  return { cwd, events: yield* store.events }
}).pipe(Effect.scoped)

const credentials = (words: readonly string[], env: string | undefined) =>
  helperProof(words[0] ?? '') ? { token: words[0], job: words[1] } : { token: env, job: words[0] }

export const helperBrief: Command = (call) => Effect.gen(function* () {
  const { vars } = yield* Env
  const { job: id, token } = credentials(call.args.positional, vars.ARISTOTELES_RECHECK_CREDENTIAL)
  const proof = helperProof(token ?? '')
  if (!id || !token || !proof) return yield* refuse('The current helper credential is required for this job.')
  const until = Date.now() + 10_000
  for (;;) {
    const { cwd, events } = yield* read
    const job = foldRechecks(events).get(id)
    const folded = foldWork(events)
    const runtime = foldRuntime(events)
    if (!job || !folded || !currentRecheck(folded.state, job)) break
    if (helperMayRead(job, runtime, token)) return recheckBriefWords(job.queued.task, job.queued.on, job.queued.brief)
    const route = job.route
    const worker = route?.kind === 'session' ? runtime.workers.get(route.allocation) : undefined
    if (job.cancelled || job.taken || job.helper || !route || route.launch !== proof[1] ||
      !worker || worker.fenced || worker.ended || readWorkerLaunch(cwd, route.launch, 'secret') !== proof[2]) break
    if (Date.now() >= until) return yield* refuse('The helper is awaiting supervisor acknowledgement.', 'Retry work recheck-brief.')
    yield* Effect.sleep(200)
  }
  return yield* refuse('The current helper credential is required for this job.')
})

const helper: Command = (call) => Effect.gen(function* () {
  const { vars } = yield* Env
  const [action, raw] = call.args.positional
  const token = raw ?? vars.ARISTOTELES_RECHECK_CREDENTIAL ?? ''
  const proof = helperProof(token)
  if (action !== 'ack' || !proof) return yield* refuse('Use work recheck-helper ack with the helper credential.')
  const { cwd, events } = yield* read
  const launch = proof[1]!
  const secret = proof[2]!
  const job = [...foldRechecks(events).values()].find((candidate) => candidate.route?.launch === launch)
  if (!job?.route || job.cancelled || job.taken || job.report) return yield* refuse('This helper allocation is no longer current.')
  if (job.route.kind === 'child') {
    yield* acknowledgeRecheckChild(token)
  } else {
    const worker = foldRuntime(events).workers.get(job.route.allocation)
    if (!worker || worker.fenced || worker.ended || worker.reservation.launch !== launch ||
      vars.ARISTOTELES_SESSION !== workerSession(launch) || readWorkerLaunch(cwd, launch, 'secret') !== secret) {
      return yield* refuse('The helper acknowledgement must come from its reserved session.')
    }
    yield* Effect.sync(() => stageWorkerLaunch(cwd, launch, 'ack', sha(secret)))
  }
  return ['Recheck helper acknowledged.']
})

const Report = Schema.Struct({ on: Schema.Int, findings: Schema.Array(RecheckFinding) })
const report: Command = (call) => Effect.gen(function* () {
  const { vars } = yield* Env
  const { job, token } = credentials(call.args.positional, vars.ARISTOTELES_RECHECK_CREDENTIAL)
  const file = textOf(call.args.one('file'))
  if (!job || !token || !file) return yield* refuse('Use work recheck-report <helper-credential> <job> --file=<report>.')
  const { cwd } = yield* Dir
  const text = yield* (yield* Files).read(join(cwd, file))
  if (!text) return yield* refuse('No recheck report file was found.')
  let payload: typeof Report.Type
  try {
    payload = Schema.decodeUnknownSync(Report, { onExcessProperty: 'error' })(Bun.YAML.parse(text))
  } catch {
    return yield* refuse('The report needs an original on and findings of item, version, outcome and evidence.')
  }
  const id = yield* reportRecheck(job, token, payload)
  return [`Recheck ${job} accepted report ${id}.`]
})

export const commands: Commands = { 'recheck-helper': helper, 'recheck-report': report }
