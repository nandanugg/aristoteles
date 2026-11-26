// The door of the new tree to the services, the store, the config and the files of src/ (plan/
// rebuild/BUILD.md D3), and the new service tags. Interfaces only: the adapters and the tests give
// the Layers (the live ones of src/ are re-exported for them, unchanged).
export {
  Dir,
  Env,
  GitUser,
  layerOfIo,
  Now,
  Terminal,
  Tokens,
} from '../../src/services/io.ts'
export type { IoServices, WorkIo } from '../../src/services/io.ts'
export { Files, FilesLive, Spawn, SpawnLive } from '../../src/services/outside.ts'
export type { Spawned } from '../../src/services/outside.ts'
export { Store } from '../../src/services/store.ts'
export type { DirStore, ReaderRow, Written } from '../../src/services/store.ts'
export { StoreLive } from '../../src/store/sqlite.ts'
export { readProjectUsage } from '../../src/store/sqlite.ts'
export { dbPath } from '../../src/store/path.ts'
export { rowsOf } from '../../src/store/rows.ts'
export {
  readConfigText,
  draftConfigOfText,
  fileHashes,
  readConfig,
  readDirection,
  readFlow,
  restoreConfig,
  roleHash,
} from '../../src/config/config.ts'
export { mergeDraft, readSettings, readSettingsOf, writeSettings } from '../../src/config/settings.ts'
export { CONFIG, DRAFT, parseYaml, sha } from '../../src/config/core.ts'
export { LOCK, readLock, writeLock, fetchFolder, readFolder, localDate } from '../../src/files/company.ts'
// The one writer of the onboarding files, before any store (BUILD.md 1b).
export {
  ASSESS,
  finishOnboardingStart,
  directionReview,
  directionRevision,
  hostAct,
  onboardedOf,
  onboardingExists,
  personAct,
  prepareStart,
  readOnboarding,
} from '../../src/files/onboarding.ts'
export type {
  DirectionDraft,
  HostAct,
  OnboardingFiles,
  PersonAct,
  QuestionDraft,
  RoleNotes,
  Start,
} from '../../src/files/onboarding.ts'

export { pathOf } from './paths.ts'
export { Pump } from './pump.ts'
export type { PaneRef, PumpStart } from './pump.ts'
export { Readings } from './readings.ts'

// Additive (P7): what the CLI prints or reads that the doors above did not carry.
export { refusing } from '../../src/config/core.ts'
export { readStaffing } from '../../src/config/staffing.ts'
export type { Staffing } from '../../src/config/staffing.ts'
export { acceptStaffArrangement, applyStaffingReview, consultStaffing, previewStaffingReview, readStaffingReview,
  staffingConfirmed, STAFFING_CONSULT, STAFFING_PROPOSAL }
  from '../../src/files/onboarding.ts'
export { staffingPreview, staffingView } from '../../src/config/staffing-view.ts'
export type {
  ArrangedRole, LimitConsequence, ReviewMode, StaffingPreview, StaffingView, StaffingWarning,
} from '../../src/config/staffing-view.ts'
export { activationId, activationLock } from '../../src/files/activation.ts'

export { cliSession, readWorkerLaunch, stageWorkerLaunch } from '../../src/files/worker-runtime.ts'
