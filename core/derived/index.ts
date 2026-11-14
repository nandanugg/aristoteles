// The derived catalog (plan/rebuild/BUILD.md 3.4, 3.5): one function per state, the three
// cross-cutting functions (waitingFor, nextFor, canAct), and the selectors that the effects
// watch. Pure: a function reads only its arguments (the Moment holds the outside readings, D4).
// This file is the export surface; each name lives in the file of its part.
//
// No code outside core/derived and core/state reads a state field of a record (end, opened,
// status, fixed, revoked, claim, untouched, state): it reads the states here (BUILD.md 4.1).
export * from './types.ts'
export {
  answererNow,
  assignmentStateOf,
  attemptOf,
  blockersOf,
  derive,
  directionStateOf,
  escalationStateOf,
  evaluationStateOf,
  forwardStateOf,
  hostOf,
  permissionStateOf,
  placementOf,
  problemStateOf,
  questionStateOf,
  resultStateOf,
  revisionStateOf,
  runStateOf,
  sendStateOf,
  sourceStatesOf,
  taskDraftStateOf,
  taskStateOf,
} from './catalog.ts'

export { canAct } from './can.ts'
export {
  type RoleWords,
  type RoleWordsDraft,
  type RoleWordsState,
  roleWordsDraftAt,
} from './role-words.ts'
export { nextFor, stepKey } from './steps.ts'
export { waitingFor } from './waiting.ts'

export {
  hostPanesOf,
  sendsPending,
  terminalsToClose,
  terminalsToStart,
  terminalsToWatch,
} from './selectors.ts'
