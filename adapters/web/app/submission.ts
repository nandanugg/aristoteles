import { useRef, useState } from 'preact/hooks'
import type { PageActJson } from '../contract.ts'
import type { ActView, PageSubmission, WorkSender } from './api.ts'

const actId = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
  byte.toString(16).padStart(2, '0')).join('')

// A form submits against its opening view. A network retry preserves the whole request.
// After a definite refusal, the next click uses the refreshed view and a fresh id.
export function useSubmission(send: WorkSender, view: ActView) {
  const basis = useRef(view)
  const refresh = useRef(false)
  const retry = useRef<{ readonly key: string; readonly request: PageSubmission }>()
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [words, setWords] = useState<string | null>(null)
  const submit = async (act: PageActJson): Promise<boolean> => {
    if (inFlight.current) return false
    const key = JSON.stringify(act)
    if (refresh.current) {
      basis.current = view
      refresh.current = false
    }
    const request = retry.current?.key === key
      ? retry.current.request
      : { act, on: basis.current.seq, build: basis.current.build, id: actId() }
    inFlight.current = true
    setBusy(true)
    let complete = false
    try {
      const out = await send(request)
      if ('ok' in out) {
        complete = true
        retry.current = undefined
        setWords(null)
        return true
      }
      retry.current = out.refused === 'network' ? { key, request } : undefined
      refresh.current = out.refused !== 'network'
      setWords([out.words, out.next].filter(Boolean).join(' '))
      return false
    } finally {
      if (!complete) {
        inFlight.current = false
        setBusy(false)
      }
    }
  }
  return { submit, busy, words }
}
