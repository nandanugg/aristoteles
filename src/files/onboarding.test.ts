// The one writer of the onboarding files (BUILD.md 1b): two writers at once lose no act, a reader
// never reads a torn file, a stale lock is broken, each act writes the fields of its owner only,
// and a New direction takes the id of its first draft. Temp dirs only.
import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect, Exit } from 'effect'
// @ts-expect-error the harness of the integrated tests is plain JavaScript with no types
import { WORK_YAML } from '../../test/harness.js'
import {
  ASSESS,
  type DirectionDraft,
  type HostAct,
  ONBOARDING_LOCK,
  type PersonAct,
  hostAct,
  personAct,
  readOnboarding,
} from './onboarding.ts'

const ROOT = join(import.meta.dir, '..', '..')
const dirOf = () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'onboard-')), 'report-export')
  mkdirSync(join(dir, 'docs'), { recursive: true })
  return dir
}
// biome-ignore lint/suspicious/noExplicitAny: loose values of a test
type Obj = any
const run = <A, E>(e: Effect.Effect<A, E>): Promise<Obj> => Effect.runPromise(e)
const exitOf = <A, E>(e: Effect.Effect<A, E>) => Effect.runPromiseExit(e)
const host = (dir: string, act: unknown) => run(hostAct(dir, act as HostAct))
const nanda = (dir: string, act: unknown) => run(personAct(dir, 'Nanda', act as PersonAct))
const read = (dir: string) => run(readOnboarding(dir))
const fileOf = async (dir: string, id: string) => {
  const file = (await read(dir)).directions.find((f: Obj) => f.id === id)
  if (file === undefined) throw new Error(`no direction ${id}`)
  return file
}

// The config draft of the harness: each role with the one line of its card.
const CONFIG = Bun.YAML.parse(WORK_YAML) as { readonly roles: Record<string, unknown> }
const NOTES = Object.fromEntries(
  Object.keys(CONFIG.roles).map((r) => [r, { summary: `the ${r}`, found: { _tag: 'New' } }]),
)
// Nanda, 2026-11-15: a case is a ladder to an output (was: a file, a line, an excerpt, a fit).
const A_CASE = {
  fit: 'Follows',
  via: [{ name: 'Template', file: 'docs/template.md', line: 1, excerpt: '## Introduction' }],
  output: { file: 'docs/tsd.md', line: 3, excerpt: '## Introduction' },
}
const draftOf = (id: string): DirectionDraft =>
  ({
    id,
    name: 'Small changes',
    from: ['Logos'],
    // Nanda, 2026-11-15: a direction has a summary.
    summary: 'A change does one thing, so a reviewer reads one reason.',
    says: 'A change does one thing.',
    standards: [
      {
        id: 'one-thing',
        says: 'One change, one reason.',
        rules: [{ id: 'says-why', says: 'The change says why.', checkedBy: 'linter', supersedes: [] }],
      },
    ],
    cases: [A_CASE, A_CASE, A_CASE],
  }) as unknown as DirectionDraft
const withConfig = async () => {
  const dir = dirOf()
  await host(dir, { _tag: 'Config', config: CONFIG, notes: NOTES })
  return dir
}

// A process that does n acts of the person through the module (bun -e, from the code root).
const writer = (dir: string, n: number, act: string) =>
  Bun.spawn(
    [
      'bun',
      '-e',
      `import { Effect } from 'effect'
       const { personAct } = await import(${JSON.stringify(join(import.meta.dir, 'onboarding.ts'))})
       for (let i = 0; i < ${n}; i++) {
         await Effect.runPromise(personAct(${JSON.stringify(dir)}, 'Nanda', ${act}))
       }`,
    ],
    { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' },
  )

describe('the lock and the atomic writes', () => {
  test('two writers at once (two processes) lose no act', async () => {
    const dir = dirOf()
    const add = (who: string) => `{ act: 'add-direction', principle: '${who} ' + i }`
    const both = [writer(dir, 15, add('one')), writer(dir, 15, add('two'))]
    expect(await Promise.all(both.map((p) => p.exited))).toEqual([0, 0])
    const principles = (await read(dir)).directions.map((f: Obj) =>
      f.asked._tag === 'New' ? f.asked.principle : '',
    )
    expect(principles).toHaveLength(30)
    for (const who of ['one', 'two']) {
      for (let i = 0; i < 15; i++) expect(principles).toContain(`${who} ${i}`)
    }
  }, 30000)

  test('a reader never reads a torn file', async () => {
    const dir = await withConfig()
    await host(dir, { _tag: 'Found', direction: 'small-changes' })
    await host(dir, { _tag: 'Draft', direction: 'small-changes', draft: draftOf('small-changes') })
    // Much more than one page of the disk, and less than the 128 KiB that Linux allows for one
    // argument (the act goes to the writer process in its -e argument).
    const long = 'x'.repeat(100000)
    const act = `{ act: 'revise', direction: 'small-changes', words: i % 2 ? 'short' : '${long}' }`
    const busy = writer(dir, 40, act)
    let reads = 0
    let done = false
    busy.exited.then(() => {
      done = true
    })
    while (!done) {
      const file = await fileOf(dir, 'small-changes')
      expect(file.draft._tag).toBe('Drafted')
      reads++
      await Bun.sleep(1)
    }
    expect(await busy.exited).toBe(0)
    expect(reads).toBeGreaterThan(0)
  }, 30000)

  test('a stale lock is broken; a fresh one makes the writer wait, then refuse', async () => {
    const dir = dirOf()
    const lock = join(dir, ONBOARDING_LOCK)
    mkdirSync(join(dir, '.work'), { recursive: true })
    writeFileSync(lock, '4242 2026-01-01T00:00:00.000Z\n')
    const old = (Date.now() - 60000) / 1000
    utimesSync(lock, old, old)
    const started = Date.now()
    await nanda(dir, { act: 'add-direction', principle: 'one' })
    expect(Date.now() - started).toBeLessThan(2000)
    expect(existsSync(lock)).toBe(false)

    writeFileSync(lock, '4242 now\n')
    const exit = await exitOf(personAct(dir, 'Nanda', { act: 'add-direction', principle: 'two' } as PersonAct))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(Exit.isFailure(exit) && exit.cause)).toContain('another writer holds .work/onboarding.lock (4242 now)')
    expect(readFileSync(lock, 'utf8')).toBe('4242 now\n')
    expect((await read(dir)).directions).toHaveLength(1)
  }, 30000)
})

describe('the acts', () => {
  test("each act writes the fields of its owner only", async () => {
    const dir = await withConfig()
    await host(dir, { _tag: 'Found', direction: 'small-changes' })
    await host(dir, { _tag: 'Draft', direction: 'small-changes', draft: draftOf('small-changes') })
    const drafted = await fileOf(dir, 'small-changes')
    // The person's revise: the request and the accept, never the draft.
    await nanda(dir, { act: 'revise', direction: 'small-changes', words: 'name the reviewer' })
    const revised = await fileOf(dir, 'small-changes')
    expect(revised.draft).toEqual(drafted.draft)
    expect(revised.request).toEqual({ _tag: 'Revise', words: 'name the reviewer' })
    // The host's questions answer the request; the person's answer writes only the answers.
    const question = { says: 'Who checks it?', case: A_CASE, options: ['the linter', 'the lead'] }
    await host(dir, { _tag: 'Ask', direction: 'small-changes', questions: [question] })
    await nanda(dir, { act: 'answer', direction: 'small-changes', options: ['B'] })
    const answered = await fileOf(dir, 'small-changes')
    expect(answered.questions).toEqual([{ ...question, answer: { _tag: 'Chosen', option: 'B' } }])
    expect(answered.draft).toEqual(drafted.draft)
    // The host's next draft clears the answered questions; the accept is the person's.
    await host(dir, { _tag: 'Draft', direction: 'small-changes', draft: draftOf('small-changes') })
    await nanda(dir, { act: 'accept', direction: 'small-changes' })
    const accepted = await fileOf(dir, 'small-changes')
    expect(accepted).toMatchObject({ questions: [], request: { _tag: 'None' }, accepted: { _tag: 'Accepted' } })
    // The host never writes over an accept.
    const again = await exitOf(
      hostAct(dir, { _tag: 'Draft', direction: 'small-changes', draft: draftOf('small-changes') } as HostAct),
    )
    expect(String(Exit.isFailure(again) && again.cause)).toContain('small-changes is accepted')
    // The person's toggle writes the persistence of the role, with the person's reason, and only it.
    const before = (await read(dir)).roles.find((r: Obj) => r.role === 'writer')
    await nanda(dir, { act: 'persistence', role: 'writer', persistent: true })
    const after = (await read(dir)).roles.find((r: Obj) => r.role === 'writer')
    expect(after?.file).toEqual({
      ...before?.file,
      persistence: { persistent: true, why: 'Nanda chose it on the agents page.' },
    } as never)
    expect(after?.accepted).toEqual(before?.accepted as never)
  })

  // Nanda, 2026-11-15: a case is a ladder to an output, and a direction has a summary. The file of
  // an onboarding that started before holds each case in the short form and no summary: a case
  // reads as a ladder with no rungs, the summary is the first sentence of says, and the next write
  // holds both.
  test('an older file reads: short cases as ladders, the summary from says; written back so', async () => {
    const dir = await withConfig()
    const short = { ...A_CASE.output, fit: 'Follows' }
    const old = {
      id: 'small-changes',
      asked: { _tag: 'Found' },
      draft: {
        _tag: 'Drafted',
        name: 'Small changes',
        from: ['Logos'],
        content: { says: 'A change does one thing. It names its reason.', standards: [] },
        cases: [short, short, short],
      },
      questions: [],
      request: { _tag: 'None' },
      accepted: { _tag: 'Waiting' },
    }
    writeFileSync(join(dir, ASSESS, 'small-changes.yaml'), Bun.YAML.stringify(old, null, 2))
    const ladder = { fit: 'Follows', via: [], output: A_CASE.output }
    const read = (await fileOf(dir, 'small-changes')).draft
    expect(read.cases).toEqual([ladder, ladder, ladder])
    expect(read.content.summary).toBe('A change does one thing.')
    await nanda(dir, { act: 'accept', direction: 'small-changes' })
    const text = readFileSync(join(dir, ASSESS, 'small-changes.yaml'), 'utf8')
    const written = (Bun.YAML.parse(text) as Obj).draft
    expect(written.cases).toEqual([ladder, ladder, ladder])
    expect(written.content.summary).toBe('A change does one thing.')
  })

  test('a New direction takes the id of its first draft', async () => {
    const dir = await withConfig()
    expect(await nanda(dir, { act: 'add-direction', principle: 'a change does one thing' })).toEqual(['new-1'])
    expect(await host(dir, { _tag: 'Draft', direction: 'new-1', draft: draftOf('small-changes') })).toEqual([
      'small-changes',
    ])
    expect(existsSync(join(dir, ASSESS, 'new-1.yaml'))).toBe(false)
    const file = await fileOf(dir, 'small-changes')
    expect(file.asked).toEqual({ _tag: 'New', principle: 'a change does one thing', example: null })
    // After its first draft the id stays.
    const renamed = await exitOf(
      hostAct(dir, { _tag: 'Draft', direction: 'small-changes', draft: draftOf('other') } as HostAct),
    )
    expect(String(Exit.isFailure(renamed) && renamed.cause)).toContain('small-changes keeps its id; the draft names other')
    expect(await nanda(dir, { act: 'add-direction', principle: 'another one' })).toEqual(['new-1'])
  })
})
