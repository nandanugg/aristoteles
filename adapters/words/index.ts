// The words (package P8): the renderers that both the CLI and the page print (plan/rebuild/BUILD.md
// D1). Each reads Derived (never a state field of a record) and writes the old words, line for
// line (the golden text of the integrated tests). The package adds the renderers of every view
// (status, blockers, task tree, result, direction, draft, evaluation) behind this index.
import type { Derived, NextStep, WaitingItem } from '../../core/derived/index.ts'
import type { Refusal } from '../../core/schema/errors.ts'
import type { AssignmentId, Logged, Work } from '../../core/schema/index.ts'
import { briefOf as briefOfImpl } from './brief.ts'
import { logLine as logLineOf } from './log.ts'
import { nextLines as nextLinesOf } from './next.ts'
import { waitingRows as waitingRowsOf } from './waiting.ts'

export { renderStatus, waitingLines } from './waiting.ts'

export { outputForm, rulesFor } from './brief.ts'
export { withBriefMeasure } from './measure.ts'
export { blockerLines, renderBlockers, taskLines } from './blockers.ts'
export {
  an,
  briefWords,
  checkerOf,
  clock,
  describeInner,
  headerName,
  headersOf,
  indented,
  short,
  stateWord,
  taskStateWord,
  who,
} from './common.ts'
export {
  pieceNames,
  renderAssignment,
  renderDirection,
  renderDraft,
  renderEvaluation,
  renderPiece,
  renderQuestion,
  renderResult,
  renderTask,
  renderTaskTree,
  whyLines,
} from './show.ts'
export {
  aboutId,
  answerText,
  draftWaitsText,
  drafterOf,
  reviseAgain,
  reviseAgainOf,
  stopIdOf,
  tierOfRole,
} from './shared.ts'
export { touchedIds } from './log.ts'
export { drafterWords, renderRoleWords, roleWordsChange } from './role-words.ts'

// The lines of `work next <token>`: the token goes into the commands that the lines print.
export type NextLines = (
  d: Derived,
  steps: ReadonlyArray<NextStep>,
  token: string,
) => ReadonlyArray<string>
export const nextLines: NextLines = nextLinesOf

// The rows of `work waiting` (only the kinds that SURFACES shows on the CLI).
export type WaitingRows = (d: Derived, items: ReadonlyArray<WaitingItem>) => ReadonlyArray<string>
export const waitingRows: WaitingRows = waitingRowsOf

// The brief of an assignment, as `work brief` prints it; its length is Outside.measure.
export type BriefOf = (d: Derived, assignment: AssignmentId, token: string) => string
export const briefOf: BriefOf = briefOfImpl

// The log line of one stored event: e<seq> HH:MM <who> (<channel>) <old type> <parts> -> <created>.
export type LogLine = (work: Work, logged: Logged) => string
export const logLine: LogLine = logLineOf

// The two lines of a refusal: `refused: <message>` and `next: <choice.words>`.
export const refusalLines = (refusal: Refusal): readonly [string, string] => [
  `refused: ${refusal.message}`,
  `next: ${refusal.choice.words}`,
]
