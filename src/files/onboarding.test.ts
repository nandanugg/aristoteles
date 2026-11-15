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
// Nanda, 2026-11-15: an example is an output of a marked step (was: a case, a ladder to an
// output).
const OUTPUT = { file: 'docs/tsd.md', line: 3, excerpt: '## Introduction' }
const A_CASE = { fit: 'Follows', output: OUTPUT }
const A_BREAK = { fit: 'Breaks', output: { written: 'Two changes, one reason.' } }
const draftOf = (id: string): DirectionDraft =>
  ({
    id,
    name: 'Small changes',
    from: ['Logos'],
    // Nanda, 2026-11-15: a direction has a summary, and a flow (one act on its own here).
    summary: 'A change does one thing, so a reviewer reads one reason.',
    flow: [
      { from: 'Person', to: 'writer', says: 'asks for a change' },
      {
        from: 'writer',
        to: 'writer',
        says: 'names one reason',
        place: { file: 'docs/tsd.md', line: 3 },
        uses: ['small-changes', 'says-why'],
        examples: [A_CASE, A_BREAK],
      },
    ],
    says: 'A change does one thing.',
    standards: [
      {
        id: 'one-thing',
        says: 'One change, one reason.',
        rules: [{ id: 'says-why', says: 'The change says why.', checkedBy: 'linter', supersedes: [] }],
      },
    ],
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
    await host(dir, { _tag: 'Draft', direction: 'small-changes', draft: draftOf('small-changes'), reopen: false })
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
      expect(['Ready', 'Revising']).toContain(file.stage._tag)
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
    await host(dir, { _tag: 'Draft', direction: 'small-changes', draft: draftOf('small-changes'), reopen: false })
    const drafted = await fileOf(dir, 'small-changes')
    // Nanda, 2026-11-15: a direction has a flow; the file holds it as the host wrote it.
    expect(drafted.stage.draft.content.flow).toEqual(draftOf('small-changes').flow)
    // The first draft has none before it.
    expect(drafted.stage.draft.previous).toBeUndefined()
    // The person's revise: the words, never the draft.
    await nanda(dir, { act: 'revise', direction: 'small-changes', words: 'name the reviewer' })
    const revised = await fileOf(dir, 'small-changes')
    expect(revised.stage).toEqual({
      _tag: 'Revising',
      draft: drafted.stage.draft,
      words: 'name the reviewer',
      answered: [],
    })
    // The host's questions answer the request; the person's answer writes only the answers.
    const question = { says: 'Who checks it?', example: A_CASE, options: ['the linter', 'the lead'] }
    await host(dir, { _tag: 'Ask', direction: 'small-changes', questions: [question] })
    await nanda(dir, { act: 'answer', direction: 'small-changes', options: ['B'] })
    const answered = await fileOf(dir, 'small-changes')
    expect(answered.stage).toEqual({
      _tag: 'Answered',
      draft: drafted.stage.draft,
      answered: [{ ...question, chosen: 'B' }],
    })
    // The host's next draft clears the answered questions; the accept is the person's.
    const words = { ...draftOf('small-changes'), says: 'A change does one thing, and says why.' }
    await host(dir, { _tag: 'Draft', direction: 'small-changes', draft: words, reopen: false })
    // Nanda, 2026-11-15: a draft over a draft keeps what the last one said, for the diff.
    const { summary, says, standards } = drafted.stage.draft.content
    expect((await fileOf(dir, 'small-changes')).stage.draft.previous).toEqual({ summary, says, standards })
    await nanda(dir, { act: 'accept', direction: 'small-changes' })
    expect((await fileOf(dir, 'small-changes')).stage._tag).toBe('Accepted')
    // The host never writes over an accept.
    const again = await exitOf(
      hostAct(dir, { _tag: 'Draft', direction: 'small-changes', draft: draftOf('small-changes'), reopen: false } as HostAct),
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
    expect(after?.decision).toEqual(before?.decision as never)
  })

  // Nanda, 2026-11-15: the new shape is the only one. A file in an older shape (here: cases, no
  // summary and no flow, and accepted) is not read: it counts as a direction that the host drafts
  // again, with its id and where it came from, and no accept; the host's draft writes over it.
  test('a file in an older shape is reset: Loading, no accept, and the host drafts it again', async () => {
    const dir = await withConfig()
    const old = {
      id: 'small-changes',
      asked: { _tag: 'New', principle: 'a change does one thing', example: null },
      draft: {
        _tag: 'Drafted',
        name: 'Small changes',
        from: ['Logos'],
        content: { says: 'A change does one thing. It names its reason.', standards: [] },
        cases: [{ ...OUTPUT, fit: 'Follows' }],
      },
      questions: [],
      request: { _tag: 'None' },
      accepted: { _tag: 'Accepted' },
    }
    writeFileSync(join(dir, ASSESS, 'small-changes.yaml'), Bun.YAML.stringify(old, null, 2))
    const reset = await fileOf(dir, 'small-changes')
    expect(reset).toEqual({ id: 'small-changes', asked: old.asked, stage: { _tag: 'Reset' } } as never)
    const accept = await exitOf(
      personAct(dir, 'Nanda', { act: 'accept', direction: 'small-changes' } as PersonAct),
    )
    expect(String(Exit.isFailure(accept) && accept.cause)).toContain(
      'small-changes is not in the current shape: the host drafts it again',
    )
    await host(dir, { _tag: 'Draft', direction: 'small-changes', draft: draftOf('small-changes'), reopen: false })
    const drafted = await fileOf(dir, 'small-changes')
    expect(drafted.stage._tag).toBe('Ready')
    expect(drafted.stage.draft.previous).toBeUndefined()
    // A file whose asked does not read either is one that the host found.
    writeFileSync(join(dir, ASSESS, 'other.yaml'), 'id: other\nasked: { _tag: Lost }\n')
    expect((await fileOf(dir, 'other')).asked).toEqual({ _tag: 'Found' })
  })

  test('a New direction takes the id of its first draft', async () => {
    const dir = await withConfig()
    expect(await nanda(dir, { act: 'add-direction', principle: 'a change does one thing' })).toEqual(['new-1'])
    expect(await host(dir, { _tag: 'Draft', direction: 'new-1', draft: draftOf('small-changes'), reopen: false })).toEqual([
      'small-changes',
    ])
    expect(existsSync(join(dir, ASSESS, 'new-1.yaml'))).toBe(false)
    const file = await fileOf(dir, 'small-changes')
    expect(file.asked).toEqual({ _tag: 'New', principle: 'a change does one thing', example: null })
    // After its first draft the id stays.
    const renamed = await exitOf(
      hostAct(dir, { _tag: 'Draft', direction: 'small-changes', draft: draftOf('other'), reopen: false } as HostAct),
    )
    expect(String(Exit.isFailure(renamed) && renamed.cause)).toContain('small-changes keeps its id; the draft names other')
    expect(await nanda(dir, { act: 'add-direction', principle: 'another one' })).toEqual(['new-1'])
  })
})

// O2 (owner, 2026-11-15): before the store, the host edits every part of the config draft at any
// time; an edit never freezes, and it clears the accept of each role whose card it changes.
describe('a host edit of the config draft', () => {
  const ROLE_NAMES = ['architect', 'section-lead', 'writer', 'linter']
  const accepted = async (dir: string) =>
    (await read(dir)).roles.filter((r: Obj) => r.decision._tag === 'Accepted').map((r: Obj) => r.role)
  const acceptAll = async (dir: string) => {
    for (const role of ROLE_NAMES) await nanda(dir, { act: 'accept-role', role })
  }
  const edit = (dir: string, change: (c: Obj) => Obj) =>
    host(dir, { _tag: 'Config', config: change(structuredClone(CONFIG)), notes: NOTES })

  // A model's entry (its commands and its limits) is on the card of each role that names it.
  const withHaiku = (c: Obj, entry: Obj) => ({ ...c, models: { ...c.models, haiku: { ...c.models.haiku, ...entry } } })

  test('a change of a model clears the roles of that model only', async () => {
    const dir = await withConfig()
    await acceptAll(dir)
    await edit(dir, (c) => withHaiku(c, { launch: 'small --session-id {session}' }))
    expect(await accepted(dir)).toEqual(['architect', 'section-lead'])
  })

  test('the people clear nothing; the limits of a model clear the roles of that model', async () => {
    const dir = await withConfig()
    await acceptAll(dir)
    await edit(dir, (c) => ({ ...c, people: [...c.people, { name: 'Budi' }] }))
    expect(await accepted(dir)).toEqual(ROLE_NAMES)
    expect(await run(personAct(dir, 'Budi', { act: 'accept-role', role: 'writer' } as PersonAct))).toEqual([])
    await edit(dir, (c) => ({
      ...c,
      people: [...c.people, { name: 'Budi' }],
      models: { ...c.models, sonnet: { limits: { Assignment: { briefChars: 9000 } } } },
    }))
    expect(await accepted(dir)).toEqual(['architect', 'writer', 'linter'])
  })

  // The real case: the host changes the commands of a model and moves one role to another model.
  test("a role's model clears that role; the card words clear their role", async () => {
    const dir = await withConfig()
    await acceptAll(dir)
    await edit(dir, (c) => ({
      ...withHaiku(c, { launch: 'small --session-id {session}' }),
      roles: { ...c.roles, linter: { ...c.roles.linter, model: 'sonnet' } },
    }))
    // writer: the entry of its model; linter: its own model; architect, section-lead: untouched.
    expect(await accepted(dir)).toEqual(['architect', 'section-lead'])
    await acceptAll(dir)
    const notes = { ...NOTES, writer: { summary: 'writes it', found: { _tag: 'New' } } }
    const roles = { ...CONFIG.roles, linter: { ...(CONFIG.roles.linter as Obj), model: 'sonnet' } }
    const config = { ...withHaiku(CONFIG, { launch: 'small --session-id {session}' }), roles }
    await host(dir, { _tag: 'Config', config, notes })
    expect(await accepted(dir)).toEqual(['architect', 'section-lead', 'linter'])
  })
})
