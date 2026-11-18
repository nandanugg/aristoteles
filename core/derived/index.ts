// The derived catalog (plan/rebuild/BUILD.md 3.4, 3.5): one function per state, canAct, and the
// selector that DeliverSends watches. Pure: a function reads only its arguments (the Moment holds
// the outside readings, D4). This file is the export surface; each name lives in the file of its
// part.
//
// No code outside core/derived and core/state reads a state field of a record (end, opened,
// status, fixed, revoked, claim, untouched, state): it reads the states here (BUILD.md 4.1).
export * from './types.ts'
export { derive } from './catalog.ts'
export { canAct } from './can.ts'
export { exampleStateOf, type ExampleState, onboardingStateOf, spotCurrent } from './onboarding.ts'
export { sendsPending } from './selectors.ts'
