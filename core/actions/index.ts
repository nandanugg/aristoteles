// The actions (package P5): one per tag, and the dispatch (plan/rebuild/BUILD.md 3.6). The table
// is total, so the compile lists a tag that has no action; each module holds its acts and the
// makers of their refusals.
import * as config from './config.ts'
import { dispatchWith } from './dispatch.ts'
import * as directions from './directions.ts'
import * as sends from './sends.ts'
import type { Actions, Dispatch } from './types.ts'

export const ACTIONS: Actions = {
  ...config.ACTIONS,
  ...sends.ACTIONS,
  ...directions.ACTIONS,
}

export const dispatch: Dispatch = dispatchWith(ACTIONS)

export { STORE } from './dispatch.ts'
export { type StartFix, type StartState, startStateOf } from './config.ts'
