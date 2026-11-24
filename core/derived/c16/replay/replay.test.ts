// The replay of the stored model traces (gen.sh) on the TS core: refusal accepts every act the
// model took, the state after take projects to the model's, and dos is the model's told steps.
import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { readTrace } from './itf.ts'
import { replay } from './replay.ts'

const DIR = `${import.meta.dir}/traces`
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.itf.json.gz')).sort()

describe('the stored traces replay on the TS core', () => {
  test('there are twenty per instance', () => {
    for (const instance of ['coreTwo', 'coreTwoExit', 'coreLoops', 'coreAsks', 'coreAskRogue', 'coreWhereContext']) {
      expect(FILES.filter((file) => file.startsWith(`${instance}-`))).toHaveLength(20)
    }
  })
  for (const file of FILES) {
    test(file, () => {
      const r = replay(readTrace(`${DIR}/${file}`))
      expect(r.steps).toBeGreaterThan(0)
    })
  }
})
