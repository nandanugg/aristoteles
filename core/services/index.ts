// The door of the new tree to the services, the store, the config and the files of src/ (plan/
// rebuild/BUILD.md D3), and the new service tags. Interfaces only: the adapters and the tests give
// the Layers (the live ones of src/ are re-exported for them, unchanged). The one rule here is the
// rule of an output (outputs.ts): the readings and the report both read it.
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
export { dbPath } from '../../src/store/path.ts'
export { rowsOf } from '../../src/store/rows.ts'
export {
  checkWorkspace,
  configOfText,
  fileHashes,
  readApprovedBy,
  readConfig,
  readDirection,
  readTask,
  restoreConfig,
  roleHash,
} from '../../src/config/config.ts'
export { mergeDraft, readSettings, readSettingsOf, writeSettings } from '../../src/config/settings.ts'
export { CONFIG, DRAFT, parseYaml, sha } from '../../src/config/core.ts'
export { checkOutput, sectionsInside, sectionsOf, snapshotOf } from '../../src/files/digest.ts'
export { LOCK, readLock, writeLock, fetchFolder, readFolder, localDate } from '../../src/files/company.ts'

export { commitOnBase, digestNow, outputChanged, outputsOf } from './outputs.ts'
export { pathOf } from './paths.ts'
export { Pump } from './pump.ts'
export type { PaneRef, PumpStart } from './pump.ts'
export { Readings } from './readings.ts'

// Additive (P7): what the CLI prints or reads that the doors above did not carry.
export { refusing } from '../../src/config/core.ts'
export { TASK_TEMPLATE } from '../../src/config/config.ts'
