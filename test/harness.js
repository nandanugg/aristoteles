// A project in a temporary folder, and main() with a fake terminal, clock, and tokens.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { main } from './code.js'

export const WORK_YAML = `people:
  - name: Nanda
limits:
  low:    { Assignment: { briefChars: 4000, attempts: 3 }, Review: { rules: 5 } }
  medium: { Assignment: { briefChars: 8000 }, Review: { rules: 12 } }
  high:   { Assignment: { briefChars: 12000 }, Review: { rules: 20 } }
roles:
  architect:
    tier: high
    description: Keeps the TSD on its directions - splits it and suggests direction changes.
    intro: You keep the TSD on its directions.
    responsibilities:
      - Split the TSD into sections with work task split.
      - Suggest a direction change with work direction revise when a Reject has no rule.
    acts: [{ approve: [section-lead, writer] }]
  section-lead:
    tier: medium
    description: Runs one section - assigns the writer and the linter, and decides the section.
    intro: You run one section until its rules have evidence, or you escalate.
    responsibilities:
      - Assign the writer, then the linter on each result, with work assign.
      - Escalate with work escalate when the directions do not fit.
    acts: [{ approve: [writer] }]
  writer:
    tier: low
    description: Writes one TSD section from its brief.
    intro: You write one section under its heading.
    responsibilities:
      - Write the section under its heading in the file that WORK IN names.
      - Report it with work report as <file>#<section>.
    output: "<file>#<section>"
    acts: [{ do: write one TSD section }]
  linter:
    tier: low
    description: Checks one section against the rules in its checks.
    intro: For each rule in your checks, say where you looked and what you saw.
    responsibilities:
      - Give one --evidence line for each rule in your checks.
      - Reject with one --point for each rule that the section breaks.
    acts: [{ review: [writer] }]
`

export const DIRECTION = `id: tsd-writing
name: TSD writing
owner: Nanda
from: [Pathos, Logos]
says: The reader understands and decides from the page alone.
standards:
  - id: facts-not-proof
    says: The body states facts; the proof stays in the agreed facts.
    rules:
      - { id: no-code-proof, says: "No file paths with line numbers, no commit hashes in the body", checkedBy: linter }
      - { id: no-ticket-ids, says: "No ticket ids and no chat-thread citations", checkedBy: linter }
  - id: intro-story
    where: { section: introduction }
    says: Tell the story first, in plain words.
    rules:
      - { id: repeatable, says: "A reviewer can repeat the problem without the design", checkedBy: section-lead }
`

export const TASK = `name: The Introduction
text: Write the Introduction from the agreed facts.
directions: [tsd-writing]
context: { section: introduction }
workspace:
  - { source: tsd, path: docs/tsd.md, verify: "work-lint docs/tsd.md" }
references: ["docs/facts.md#dedupe"]
`

// The same work with no section: a task with a section is one unit, so only this one splits.
export const TASK_WHOLE = TASK.replace('context: { section: introduction }\n', '')

export const FIT = [1, 2, 3, 4, 5, 6, 7].map((id) => `- { id: ${id}, yes: true, why: "seen in the Introduction run" }`).join('\n')

// The folder of a dir has the name that people read (the name of a dir is its folder name).
export function project(files = {}, name = 'report-export') {
  const dir = join(mkdtempSync(join(tmpdir(), 'work-')), name)
  mkdirSync(dir)
  const all = {
    'aristoteles.yaml': WORK_YAML, 'directions/tsd-writing.yaml': DIRECTION, 'task.yaml': TASK, 'fit.yaml': FIT,
    'docs/tsd.md': '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nTODO\n',
    'docs/facts.md': '# Facts\n\n## Dedupe\n\nThe export ran twice for one merchant.\n',
    ...files,
  }
  for (const [path, text] of Object.entries(all)) write(dir, path, text)
  let minute = 0
  // A test with the server of the UI uses the real clock, because the server acts at the real time.
  let real = false
  let tokens = 0
  const run = (line, { tty = false, typed, env = {}, channel } = {}) => {
    const out = []
    const err = []
    const io = {
      cwd: dir,
      out: (t) => out.push(t),
      err: (t) => err.push(t),
      isTTY: tty,
      channel,
      readLine: () => typed,
      now: () => (real ? new Date().toISOString() : new Date(Date.UTC(2026, 9, 25, 9, minute++)).toISOString()),
      gitUser: () => 'Nanda',
      // Each test project has its own aristoteles file, never the one in the home folder.
      env: { ARISTOTELES_DB: join(dir, '.work', 'aristoteles.db'), ...env },
      random: () => `k${String(++tokens).padStart(4, '0')}`,
    }
    const argv = split(line)
    // The project folder is new for each test; the golden text names it <project>.
    const clean = (lines) => lines.join('\n').replaceAll(dir, '<project>')
    return main(argv, io).then((code) => ({ code, out: clean(out), err: clean(err) }))
  }
  // The person at a terminal, the person on the UI, and an agent in a shell with no terminal.
  const nanda = (line, typed) => run(line, { tty: true, typed })
  const ui = (line, typed) => run(line, { channel: 'ui', typed })
  const agent = (line) => run(line)
  // wait moves the fake clock, so that a time limit (a grant) can pass in a test.
  // now is the time of its last reading (about the last act); it does not move the clock.
  const now = () => new Date(Date.UTC(2026, 9, 25, 9, Math.max(minute - 1, 0))).toISOString()
  return {
    dir, run, nanda, ui, agent, now, realTime: () => { real = true },
    write: (path, text) => write(dir, path, text), wait: (minutes) => { minute += minutes },
  }
}

function write(dir, path, text) {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), text)
}

// Splits a command line like a shell: "double quotes" keep spaces.
export function split(line) {
  const out = []
  let current = ''
  let quoted = false
  let has = false
  for (const ch of line) {
    if (ch === '"') { quoted = !quoted; has = true; continue }
    if (ch === ' ' && !quoted) { if (has) out.push(current); current = ''; has = false; continue }
    current += ch
    has = true
  }
  if (has) out.push(current)
  return out
}

export const tokenIn = (text) => text.match(/work brief (a\d+\.[a-z0-9]+)/)[1]

export const INTRO_V1 = '# TSD\n\n## Introduction\n\nABC-2964: the export ran twice for one merchant.\n\n## Design\n\nTODO\n'
export const INTRO_V2 = '# TSD\n\n## Introduction\n\nThe export ran twice for one merchant, so the merchant got two files.\n\n## Design\n\nTODO\n'
export const ok = (r) => {
  if (r.code !== 0) throw new Error(`expected success, got: ${r.err}`)
  return r
}

// init, fit every role, open t1, and give it to a section lead (a1).
// The person evaluates a mistake of a task (Nanda, 2026-11-08), so that the work can go on.
export const evaluated = async (p, task, level = 'standard') => ok(await p.nanda(`evaluate ${task} --wrong="the work misses what was asked" ` +
  `--why="the directions do not say it" --improve="say it in a standard" --level=${level}`))

// work init, then each direction of the fixture: a model run outside any task (assess, as the
// skill that reads an app) drafts it, and Nanda accepts it. The directions are files of the
// fixture only: work reads none. A aristoteles.yaml names another folder with a comment line.
export async function init(p) {
  ok(await p.nanda('init'))
  const yaml = Bun.file(join(p.dir, 'aristoteles.yaml'))
  const folder = (await yaml.text()).match(/# the harness drafts the directions in (\S+)/)?.[1] ?? 'directions/*.yaml'
  for (const file of [...new Bun.Glob(folder).scanSync({ cwd: p.dir })].sort()) {
    const drafted = ok(await p.agent(`direction new --file=${file} --by=assess`)).out
    const did = drafted.match(/^(d\d+) drafted/)[1]
    ok(await p.nanda(`review ${did} accept --evidence="${file} | the whole direction, as the fixture gives it"`, 'accept'))
  }
}

export async function started(files) {
  const p = project(files)
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  const lead = tokenIn(ok(await p.nanda('assign t1 --role=section-lead')).out)
  ok(await p.agent(`brief ${lead}`))
  return { p, lead }
}
// ... and the lead assigns a writer (a2).
export async function withWriter(files) {
  const s = await started(files)
  const writer = tokenIn(ok(await s.p.agent(`assign ${s.lead} t1 --role=writer --max-attempts=3`)).out)
  return { ...s, writer }
}
// ... the writer reports the second intro as r1, and the lead assigns a linter (a3) that read its brief.
export async function reported(files) {
  const s = await withWriter(files)
  ok(await s.p.agent(`brief ${s.writer}`))
  s.p.write('docs/tsd.md', INTRO_V2)
  ok(await s.p.agent(`report ${s.writer} --output=docs/tsd.md#introduction`))
  const linter = tokenIn(ok(await s.p.agent(`assign ${s.lead} t1 --role=linter`)).out)
  ok(await s.p.agent(`brief ${linter}`))
  return { ...s, linter }
}

// A small code project: a lead, an implementer that reports <repo>@<commit>, and a gate.
export const CODE_YAML = `people:
  - name: Nanda
limits:
  low: { Assignment: { attempts: 3 } }
# the harness drafts the directions in code-directions/*.yaml
roles:
  tech-lead:
    tier: high
    description: Keeps the fixes on their directions, and evaluates a fix that fails.
    intro: You keep the fixes on their directions.
    responsibilities:
      - Evaluate a fix whose implementer used its last try on a fault, with work evaluate.
    acts: [{ approve: [lead, implementer] }]
  lead:
    tier: medium
    description: Runs one fix - assigns the implementer and decides the fix.
    intro: You run one fix.
    responsibilities:
      - Assign the implementer with work assign.
    acts: [{ approve: [implementer] }]
  implementer:
    tier: low
    description: Makes one fix as one commit in the workspace repo.
    intro: You make one fix.
    responsibilities:
      - Commit the fix in <repo> and report it as <repo>@<commit>.
    output: "<repo>@<commit>"
    acts: [{ do: make one fix }]
  gate:
    kind: program
    run: "test -f ok.txt"
    on: report
    checks: [suite-passes]
    acts: [{ review: [implementer] }]
`
export const CODE_DIRECTION = `id: fixes
name: Fixes
owner: Nanda
says: A fix is proven by a test that ran on it.
standards:
  - id: proven
    says: The suite passes on the fix.
    rules:
      - { id: suite-passes, says: "The suite passes on the reported commit", checkedBy: gate }
`
export const CODE_TASK = `name: Fix the key
text: Fix the key so that the test passes.
directions: [fixes]
workspace:
  - { source: app, path: app, base: main }
`
// env: process.env, so that git is found on the PATH of test/preload.js.
export const git = (dir, ...args) => {
  const argv = ['git', '-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]
  const run = Bun.spawnSync(argv, { env: process.env })
  return run.stdout.toString().trim()
}

// A code project with a git repo at app/: main has ok.txt; the lead (a1) and the implementer
// (a2) have read their briefs.
export async function codeStarted(files = {}) {
  const p = project({ 'aristoteles.yaml': CODE_YAML, 'code-directions/fixes.yaml': CODE_DIRECTION, 'task.yaml': CODE_TASK, 'app/ok.txt': 'ok\n', ...files }, 'code')
  const app = `${p.dir}/app`
  git(app, 'init', '-q', '-b', 'main')
  git(app, 'add', '.')
  git(app, 'commit', '-q', '-m', 'base')
  await init(p)
  for (const role of ['lead', 'implementer']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  const lead = tokenIn(ok(await p.nanda('assign t1 --role=lead')).out)
  ok(await p.agent(`brief ${lead}`))
  const impl = tokenIn(ok(await p.agent(`assign ${lead} t1 --role=implementer`)).out)
  ok(await p.agent(`brief ${impl}`))
  return { p, app, lead, impl }
}

// A change of a direction: the high role (default architect) with a change grant drafts it from
// <yaml>, and the person accepts the draft (the reviser cannot review its own draft). Returns the
// draft id and the reviser token; pass { accept: false } to leave the draft open. In a project with
// other roles, pass { role, on, fit: true } (fit the role first).
export async function changeDirection(p, yaml, opts = {}) {
  const { flags = '', accept = true, direction = 'tsd-writing', role = 'architect', on = 'tsd-writing,t1', fit = false } = opts
  if (!p.arch) {
    if (fit) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    ok(await p.nanda(`grant --act=change --on=${on} --to=${role} --until=2026-12-31T00:00:00Z`, 'grant'))
    p.arch = tokenIn(ok(await p.nanda(`assign t1 --role=${role}`)).out)
    ok(await p.agent(`brief ${p.arch}`))
  }
  p.write('change.yaml', yaml)
  const drafted = ok(await p.agent(`direction revise ${p.arch} ${direction} --file=change.yaml ${flags}`)).out
  const draft = drafted.match(/^(d\d+) drafted/m)[1]
  const out = accept ? ok(await p.nanda(`review ${draft} accept --evidence="change.yaml | the change is what was asked"`, 'accept')).out : drafted
  return { draft, arch: p.arch, out }
}
