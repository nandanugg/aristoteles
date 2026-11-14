// The actions (package P5): one per tag, and the dispatch (plan/rebuild/BUILD.md 3.6). The table
// is total, so the compile lists a tag that has no action; each module holds its acts and the
// makers of their refusals, and REFUSALS is the total table that the refusal test reads.
import * as config from './config.ts'
import { dispatchWith } from './dispatch.ts'
import * as directions from './directions.ts'
import * as report from './report.ts'
import * as reviews from './reviews.ts'
import * as runs from './runs.ts'
import type { Refusals } from './support.ts'
import * as tasks from './tasks.ts'
import type { Actions, Dispatch } from './types.ts'

export const ACTIONS: Actions = {
  ...config.ACTIONS,
  ...runs.ACTIONS,
  ...tasks.ACTIONS,
  ...report.ACTIONS,
  ...reviews.ACTIONS,
  ...directions.ACTIONS,
}

export const REFUSALS: Refusals = {
  ...config.REFUSALS,
  ...runs.REFUSALS,
  ...tasks.REFUSALS,
  ...report.REFUSALS,
  ...reviews.REFUSALS,
  ...directions.REFUSALS,
}

export const dispatch: Dispatch = dispatchWith(ACTIONS)

export { COMMON, type Maker, type Refusals, type RefusalsOf } from './support.ts'
export { STORE } from './dispatch.ts'
export { WORKSPACE } from './tasks.ts'
export { defineWorkflow } from './config.ts'
export { whyOf } from './directions.ts'
export { openAnswers } from './drafts.ts'
