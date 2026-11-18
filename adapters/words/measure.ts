// The old measure of a brief is gone (the new brief has no limit); the callers in adapters/web
// still pass their Outside through here until the page drops them.
import type { Time } from '../../core/schema/index.ts'
import type { Outside } from '../../core/schema/outside.ts'

export const withBriefMeasure = (outside: Outside, _at: Time): Outside => outside
