// The words (package P8): the renderers that both the CLI and the page print (plan/rebuild/BUILD.md
// D1). Each reads Derived (never a state field of a record) and writes the old words, line for
// line (the golden text of the integrated tests).
import type { Refusal } from '../../core/schema/errors.ts'
import type { Logged, Work } from '../../core/schema/index.ts'
import { logLine as logLineOf } from './log.ts'

export { withBriefMeasure } from './measure.ts'
export {
  exampleLines,
  pieceNames,
  renderDirection,
  renderDraft,
  renderPiece,
  whyLines,
} from './show.ts'
export { draftWaitsText } from './shared.ts'
export {
  answersWords,
  onboardShowDirection,
  onboardShowRole,
  onboardStatus,
  startFixWords,
  startRefusal,
  waitsForHost,
} from './onboard.ts'

// The log line of one stored event: e<seq> HH:MM <who> (<channel>) <old type> <parts> -> <created>.
export type LogLine = (work: Work, logged: Logged) => string
export const logLine: LogLine = logLineOf

// The two lines of a refusal: `refused: <message>` and `next: <choice.words>`.
export const refusalLines = (refusal: Refusal): readonly [string, string] => [
  `refused: ${refusal.message}`,
  `next: ${refusal.choice.words}`,
]
