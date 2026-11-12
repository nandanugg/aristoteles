// The page's links to the server: the JSON routes (fetch, in Effect), the one websocket, the
// acts of the person, and the toast at the bottom of the page.
import { Data, Effect, Schema } from 'effect'
import {
  ActAnswer,
  ApiError as ApiErrorBody,
  type PageAct,
  PageMessage,
  ServerMessage,
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
        message: refused._tag === 'Some' ? refused.value.error : res.statusText,
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

// An act of the person: the server runs the CLI on the ui channel, or a method of the terminals.
export const post = (act: PageAct): Promise<ActOut> =>
  run(
    request('/api/act', ActAnswer, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(act),
    }),
  )

// What the page hears: a server message, or its own "open" when the socket connects.
export type Heard = typeof ServerMessage.Type | { readonly type: 'open' }
const decodeMessage = Schema.decodeUnknownOption(ServerMessage)
type Listener = (message: Heard) => void

// One websocket for the page. A lost socket connects again; a message sent before it opens waits.
const createSocket = () => {
  const listeners = new Set<Listener>()
  let ws: WebSocket
  let queue: string[] = []
  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
    ws.onopen = () => {
      for (const m of queue) ws.send(m)
      queue = []
      for (const fn of listeners) fn({ type: 'open' })
    }
    ws.onmessage = (m) => {
      const message = decodeMessage(JSON.parse(String(m.data)))
      if (message._tag === 'None') return
      for (const fn of listeners) fn(message.value)
    }
    ws.onclose = () => setTimeout(connect, 1000)
  }
  connect()
  return {
    listen(fn: Listener): () => void {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    send(message: typeof PageMessage.Type): void {
      const text = JSON.stringify(message)
      if (ws.readyState === 1) ws.send(text)
      else queue.push(text)
    },
  }
}
export const socket = createSocket()

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
