// The page's links to the server: the JSON routes (fetch, in Effect), the one websocket, the
// acts of the person, and the toast at the bottom of the page.
import { Data, Effect, Schema } from 'effect'
import type { OnboardingAct } from '../../../src/domain/onboarding.ts'
import { pipeOutbox } from './pipe-outbox.ts'
import { createSocket } from './pipe-socket.ts'
import type { What } from '../../../src/domain/work-acts.ts'
import {
  ActAnswer,
  ApiError as ApiErrorBody,
  type Dash,
  type PageAct,
} from '../contract.ts'

// The server refused, the network failed, or the answer did not match its Schema; the message
// is the server's own words when it gave any.
export class ApiError extends Data.TaggedError('ApiError')<{ readonly message: string }> {}

export type ActOut = typeof ActAnswer.Type

const errorBody = Schema.decodeUnknownOption(ApiErrorBody)

// Fetch a route and decode its JSON with the Schema of the contract: the page only works on
// decoded values.
const request = <S extends Schema.Top & { readonly DecodingServices: never }>(
  path: string,
  schema: S,
  init?: RequestInit,
): Effect.Effect<S['Type'], ApiError> =>
  Effect.gen(function* () {
    const res = yield* Effect.tryPromise({
      try: () => fetch(path, { credentials: 'same-origin', ...init }),
      catch: (e) => new ApiError({ message: e instanceof Error ? e.message : String(e) }),
    })
    const body: unknown = yield* Effect.promise(() => res.json().catch(() => ({})))
    if (!res.ok) {
      const refused = errorBody(body)
      return yield* new ApiError({
        message:
          refused._tag === 'Some'
            ? [refused.value.error, ...(refused.value.next ? [`next: ${refused.value.next}`] : [])].join('\n')
            : res.statusText,
      })
    }
    return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
      Effect.mapError((e) => new ApiError({ message: `the answer is not as expected: ${e}` })),
    )
  })

// Runs a request; a failure rejects with a plain Error that holds the server's words only.
const run = async <A>(effect: Effect.Effect<A, ApiError>): Promise<A> => {
  const result = await Effect.runPromise(Effect.result(effect))
  if (result._tag === 'Failure') throw new Error(result.failure.message)
  return result.success
}

// GET a route.
export const api = <S extends Schema.Top & { readonly DecodingServices: never }>(
  path: string,
  schema: S,
): Promise<S['Type']> => run(request(path, schema))

// An act of the gear: the settings.
export const post = (act: PageAct): Promise<ActOut> =>
  run(
    request('/api/act', ActAnswer, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(act),
    }),
  )

// An act of the work model (POST /api/act): the person's act on the seq and the build of the
// Dash that showed it. A refusal (the words say why) means the page reads the Dash again.
export type WorkOut =
  | { readonly ok: true }
  | { readonly refused: string; readonly words: string }
const WorkAnswer = Schema.Struct({
  ok: Schema.optionalKey(Schema.Boolean),
  refused: Schema.optionalKey(Schema.String),
  words: Schema.optionalKey(Schema.String),
  error: Schema.optionalKey(Schema.String),
})
export type WhatJson = (typeof What)['Encoded']
const postAct = async (body: object): Promise<WorkOut> => {
  try {
    const res = await fetch('/api/act', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const answer = Schema.decodeUnknownOption(WorkAnswer)(await res.json().catch(() => ({})))
    const a = answer._tag === 'Some' ? answer.value : {}
    if (res.ok && a.ok) return { ok: true }
    return { refused: a.refused ?? 'refused', words: a.words ?? a.error ?? res.statusText }
  } catch (e) {
    return { refused: 'network', words: e instanceof Error ? e.message : String(e) }
  }
}
export const postWork = (what: WhatJson, dash: Dash): Promise<WorkOut> =>
  postAct({ act: what, on: dash.header.seq, build: dash.header.build })
// The person confirms a forwarded act (on the page's build) or drops it.
export const postForward = (op: 'confirm' | 'drop', id: string, dash: Dash): Promise<WorkOut> =>
  postAct(op === 'confirm' ? { confirm: id, build: dash.header.build } : { drop: id })

// An act of the onboarding pages (POST /api/onboarding): it writes the files, or approve all roles
// starts the store. The page sends the plain JSON; the server decodes it.
export type OnboardingActJson = (typeof OnboardingAct)['Encoded']
export const postOnboarding = (act: OnboardingActJson): Promise<ActOut> =>
  run(
    request('/api/onboarding', ActAnswer, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(act),
    }),
  )

const browserOutbox = () => {
  try {
    const navigation = performance.getEntriesByType('navigation')[0] as
      PerformanceNavigationTiming | undefined
    return pipeOutbox(sessionStorage, navigation?.type === 'reload')
  } catch {
    return undefined
  }
}
const outbox = browserOutbox()
export const socket = createSocket({
  ...(outbox ? { outbox } : {}),
  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return new WebSocket(`${protocol}//${location.host}/ws`)
  },
  retry: (fn) => { setTimeout(fn, 1000) },
  reload: () => location.reload(),
  notice: (words) => toast(words),
})

// A short message at the bottom of the page.
export const toast = (text: string): void => {
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = text
  document.body.append(el)
  setTimeout(() => el.remove(), 5000)
}

// Wraps an act: its first line shows as a toast, a refusal shows as a toast too.
export const attempt =
  <Args extends unknown[]>(fn: (...args: Args) => Promise<ActOut | undefined>) =>
  async (...args: Args): Promise<ActOut | undefined> => {
    try {
      const out = await fn(...args)
      if (out?.out) toast(out.out.split('\n')[0] ?? '')
      return out
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error))
      return undefined
    }
  }

// A soft sound when a new badge shows, if the settings ask for it (the UI is silent by default).
export const chime = (): void => {
  try {
    const ctx = new AudioContext()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = 660
    g.gain.setValueAtTime(0.08, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.4)
  } catch {
    // No audio in this browser: the badge still shows.
  }
}
