// The page sends only Human acts. Forwards use the same body and store check.
import { Schema } from 'effect'
import { BodySchema } from '../../core/schema/index.ts'
import type { Body } from '../../core/state/c16/types.ts'
import { DirectWorkPost, ForwardWorkPost, PageActBody } from './contract.ts'

export const WorkPost = Schema.Union([DirectWorkPost, ForwardWorkPost])
export type WorkPost = typeof WorkPost.Type
export const workPostOf = (body: unknown): WorkPost | undefined => {
  const decoded = Schema.decodeUnknownOption(WorkPost)(body)
  return decoded._tag === 'Some' ? decoded.value : undefined
}

export const pageBodyOf = (act: PageActBody): Body =>
  act._tag === 'Respond'
    ? { ...act, points: act.points ?? [] }
    : act

const hasPoints = (points: ReadonlyArray<string>): boolean =>
  points.length > 0 && points.every((point) => point.trim() !== '')
export const pagePointsOk = (act: PageActBody): boolean => {
  if (act._tag === 'Open') return hasPoints(act.open.points)
  return act._tag !== 'Respond' || act.reply !== 'SendItBack' || hasPoints(act.points ?? [])
}

export const forwardedPageBody = (body: Body): PageActBody | undefined => {
  const encoded = Schema.encodeSync(BodySchema)(body)
  const decoded = Schema.decodeUnknownOption(PageActBody)(encoded)
  return decoded._tag === 'Some' ? decoded.value : undefined
}
