// The measure of a brief that the limit of a tier reads (ruling 10.9). Core imports no words, so
// each adapter (the CLI, the server, the watcher) puts this measure into the Outside it reads.
import { derive, type Derived } from '../../core/derived/index.ts'
import type { AssignmentId, Time, Work } from '../../core/schema/index.ts'
import type { Outside } from '../../core/schema/outside.ts'
import { briefSizeOf } from './brief.ts'

export const withBriefMeasure = (outside: Outside, at: Time): Outside => {
  // derive measures each working assignment, so one inner derive (with no measure) per Work.
  let last: { readonly work: Work; readonly d: Derived } | undefined
  const inner = (w: Work): Derived => {
    if (last?.work !== w) {
      last = { work: w, d: derive({ work: w, at, outside: { ...outside, measure: () => 0 } }) }
    }
    return last.d
  }
  return { ...outside, measure: (w: Work, a: AssignmentId) => briefSizeOf(inner(w), a) }
}
