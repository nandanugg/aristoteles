// A project in a temporary folder, and main() with a fake terminal, clock, and tokens.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkNextCanAct, main } from './code.js'

// WORK_CHECK_NEXT=1: after each act that exits 0, every step that work next offers must pass
// canAct (BUILD.md 4.2). Without it, nothing here changes.
const CHECK_NEXT = process.env.WORK_CHECK_NEXT === '1'

// Ruling 2026-11-14 (brief limits leave room for the guide): the limits of a model sit above the
// text of its guide, which counts in the brief. Ruling 7, onboarding 2026-11-14: each agent role
// says its persistence and its icon; the leads keep their terminals, the others run as subagents.
// Owner, 2026-11-15: a role names its model, and its acts say what it may do.
export const WORK_YAML = `people:
  - name: Nanda
models:
  haiku:  { limits: { Assignment: { briefChars: 6000, attempts: 3 }, Review: { rules: 5 } } }
  sonnet: { limits: { Assignment: { briefChars: 12000 }, Review: { rules: 12 } } }
  opus:   { limits: { Assignment: { briefChars: 16000 }, Review: { rules: 20 } } }
roles:
  architect:
    model: opus
    description: Keeps the TSD on its directions - splits it and suggests direction changes.
    intro: You keep the TSD on its directions.
    responsibilities:
      - Split the TSD into sections with work task split.
      - Suggest a direction change with work direction revise when a Reject has no rule.
    acts: [{ approve: [section-lead, writer] }, { assign: [section-lead, writer, linter] }, split, direct, fit]
    persistence:
      persistent: true
      why: It holds the TSD for the whole project and starts the lower roles.
    icon: compass
  section-lead:
    model: sonnet
    description: Runs one section - assigns the writer and the linter, and decides the section.
    intro: You run one section until its rules have evidence, or you escalate.
    responsibilities:
      - Assign the writer, then the linter on each result, with work assign.
      - Escalate with work escalate when the directions do not fit.
    acts: [{ approve: [writer] }, { assign: [writer, linter] }]
    persistence:
      persistent: true
      why: It runs one section through its writers and linters until it decides the section.
    icon: layers
  writer:
    model: haiku
    description: Writes one TSD section from its brief.
    intro: You write one section under its heading.
    responsibilities:
      - Write the section under its heading in the file that WORK IN names.
      - Report it with work report as <file>#<section>.
    output: "<file>#<section>"
    acts: [{ do: write one TSD section }]
    persistence:
      persistent: false
      why: It writes one section once, from its brief.
    icon: feather
  linter:
    model: haiku
    description: Checks one section against the rules in its checks.
    intro: For each rule in your checks, say where you looked and what you saw.
    responsibilities:
      - Give one --evidence line for each rule in your checks.
      - Reject with one --point for each rule that the section breaks.
    acts: [{ review: [writer] }]
    persistence:
      persistent: false
      why: It checks one section once against the rules in its checks.
    icon: shield-check
`

// The text of a config with the commands of some models put into its models table: each model
// line (`  opus: { limits: ... }`) becomes a block with the commands, and keeps its limits.
export const withModels = (yaml, commands) =>
  Object.entries(commands).reduce(
    (text, [model, fields]) =>
      text.replace(new RegExp(`^  ${model}: +\\{ ?(.*?) ?\\}$`, 'm'), (_all, inner) =>
        [
          `  ${model}:`,
          ...Object.entries(fields).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`),
          ...(inner ? [`    ${inner}`] : []),
        ].join('\n'),
      ),
    yaml,
  )

// Nanda, 2026-11-15: a direction has a flow. The files of a project whose instructions reach a
// real document (an instruction, the skill of the writer, the template that it fills).
export const FLOW_FILES = {
  'CLAUDE.md': '# How we write\n\nEach TSD section says one thing.\n',
  '.claude/skills/writer/SKILL.md': '# Writer\n\nWrite one heading for each section.\n',
  'docs/template.md': '# TSD\n\n## Introduction\n\n## Design\n',
}
// How the TSD direction works, from the person's first act down to the document: five steps, one
// of them an act of the writer on its own. The direction governs two: the writer makes the
// document (step 4), the linter checks it (step 5); each uses the ids that apply there, and shows
// an output that follows and one that breaks (Nanda, 2026-11-15): the writer's output only, the
// linter's input and output; real where the project has one, else written by the host.
export const FLOW = `flow:
  - { from: Person, to: architect, says: asks for a TSD of the export }
  - { from: architect, to: writer, says: gives each section to a writer, place: { file: CLAUDE.md, line: 3 } }
  - { from: writer, to: writer, says: reads the rule of one heading for each section, place: { file: .claude/skills/writer/SKILL.md, line: 3 } }
  - from: writer
    to: docs/tsd.md
    says: fills the template one section at a time
    place: { file: docs/template.md, line: 3 }
    uses: [tsd-writing, intro-story, repeatable]
    examples:
      - fit: Follows
        output: { file: docs/tsd.md, line: 3, excerpt: "## Introduction" }
      - fit: Breaks
        output: { written: "## Introduction and design, in one section" }
  - from: linter
    to: docs/tsd.md
    says: checks that each section says one thing
    uses: [facts-not-proof, no-code-proof]
    examples:
      - fit: Follows
        input: { file: docs/tsd.md, line: 5, excerpt: TODO }
        output: { written: "Reject: the Introduction holds no words yet" }
      - fit: Breaks
        input: { file: docs/tsd.md, line: 5, excerpt: TODO }
        output: { written: "Accept: the section says one thing" }
`
// For the direction <id> of a test: a flow of one step that it governs, and an output there that
// follows it and one that breaks it.
export const markedOf = (id) => `flow:
  - from: writer
    to: docs/tsd.md
    says: writes one section
    uses: [${id}]
    examples:
      - { fit: Follows, output: { file: docs/tsd.md, line: 3, excerpt: "## Introduction" } }
      - { fit: Breaks, output: { file: docs/tsd.md, line: 5, excerpt: TODO } }
`
// The flow comes before the standards, so that a test that appends a standard to the fixture
// stays inside the standards. Nanda, 2026-11-15: a direction has a summary, before its words.
export const DIRECTION = `id: tsd-writing
name: TSD writing
owner: Nanda
from: [Pathos, Logos]
summary: A TSD lets its reader decide without a meeting, so each page stands alone.
${FLOW}says: The reader understands and decides from the page alone.
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

// Onboarding (BUILD.md 1e): the files that the host writes before any store. The config draft is
// WORK_YAML with the one line of each card, and where the project has the role (the linter).
export const ONBOARD_CONFIG = WORK_YAML
  .replace('icon: compass\n', 'icon: compass\n    summary: Keeps the TSD on its directions.\n')
  .replace('icon: layers\n', 'icon: layers\n    summary: Runs one section.\n')
  .replace('icon: feather\n', 'icon: feather\n    summary: Writes one section.\n')
  .replace('icon: shield-check\n', 'icon: shield-check\n    summary: Checks one section.\n    found: .claude/agents/linter.md\n')
// The host's draft of the direction that it found: the direction of the fixture with no owner (the
// person who starts the store owns it).
export const ONBOARD_DIRECTION = DIRECTION.replace('owner: Nanda\n', '')
// The host's draft of a new direction that the person asked for: its first draft names its id.
export const ONBOARD_NEW = `id: one-thing
name: One thing per section
from: [Logos]
summary: Each section of a TSD keeps to one topic, so a reader finds it fast.
flow:
  - from: writer
    to: docs/tsd.md
    says: writes one section
    uses: [one-thing, one-heading]
    examples:
      - { fit: Follows, output: { file: docs/tsd.md, line: 3, excerpt: "## Introduction" } }
      - { fit: Follows, output: { file: docs/tsd.md, line: 7, excerpt: "## Design" } }
      - { fit: Breaks, output: { written: "## Introduction and design, in one section" } }
says: Each section says one thing.
standards:
  - id: one-heading
    says: A section has one heading.
    rules:
      - { id: one-topic, says: "The section stays on its heading", checkedBy: linter }
`
// The host's questions about a draft: each names an example and gives two options.
export const ONBOARD_QUESTIONS = `questions:
  - says: Does a section of facts count as one thing?
    example: { fit: Follows, output: { file: docs/facts.md, line: 3, excerpt: "## Dedupe" } }
    options: ["each fact is one thing", "the facts together are one thing"]
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

// The check reads the time of the last act without moving the fake clock (io.now would move it).
async function expectNextCanAct(dir, env, real, minute) {
  const at = real ? new Date().toISOString() : new Date(Date.UTC(2026, 9, 25, 9, minute)).toISOString()
  const violations = await checkNextCanAct(dir, env, at)
  if (violations.length > 0) throw new Error(`next offers what canAct refuses:\n${violations.join('\n')}`)
}

// The documents of the fixture project: the examples of its directions point into them.
const DOCS = {
  'docs/tsd.md': '# TSD\n\n## Introduction\n\nTODO\n\n## Design\n\nTODO\n',
  'docs/facts.md': '# Facts\n\n## Dedupe\n\nThe export ran twice for one merchant.\n',
}

// The folder of a dir has the name that people read (the name of a dir is its folder name).
export function project(files = {}, name = 'report-export') {
  return projectOf({
    'aristoteles.yaml': WORK_YAML, 'directions/tsd-writing.yaml': DIRECTION, 'task.yaml': TASK, 'fit.yaml': FIT,
    ...DOCS, ...files,
  }, name)
}

// Onboarding (BUILD.md 1e): a project with no aristoteles.yaml and no store, only its own files.
// The host's drafts are the ONBOARD_* texts below; a test writes the ones that it needs.
export function onboardingProject(files = {}, name = 'report-export') {
  return projectOf({ ...DOCS, '.claude/agents/linter.md': '# Linter\n\nChecks one section.\n', ...files }, name)
}

function projectOf(all, name) {
  const dir = join(mkdtempSync(join(tmpdir(), 'work-')), name)
  mkdirSync(dir)
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
    return main(argv, io).then(async (code) => {
      if (CHECK_NEXT && code === 0) await expectNextCanAct(dir, io.env, real, Math.max(minute - 1, 0))
      return { code, out: clean(out), err: clean(err) }
    })
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

// The host is the AI CLI that the person triggered, in a pane of the person's tmux server
// (Nanda, 2026-11-13); tmux tells its shell the socket and the pane. A test of the CLI alone needs
// no real pane: the shell of such a host has these two variables, and no terminal.
export const HOST_PANE = { TMUX: '/tmp/ar-test-person.sock,1,0', TMUX_PANE: '%9' }
export const HOST = { env: HOST_PANE }

// The token of a host's assignment after the open of its top task: ruling 10.1, the host gets it from
// `work wait --by=<run>` in its pane. The words of the open (_opened) do not hold it; the callers
// pass them, so that each call shows the open that comes first.
export async function solToken(p, _opened, run = 'h1', where = HOST) {
  return tokenIn(ok(await p.run(`wait --by=${run} --seconds=1`, where)).out)
}

// The token of an agent after its assign: the assign of a disposable role prints it; a real agent
// (a persistent role in a project of the UI) gets a new token in the launch command of the
// terminal that the UI starts for it (ruling 10.1), as this does.
export async function agentToken(p, assigned) {
  if (/work brief a\d+\./.test(assigned)) return tokenIn(assigned)
  const id = assigned.match(/^(a\d+) · /m)[1]
  return tokenIn(ok(await p.ui(`session ${id} --id=s-${id} --token`)).out)
}

// A real pane of the person's tmux server, for a test of the terminals: a scratch server with no
// config of the person (-f /dev/null) and no variable of the test's own tmux, so that a theme of
// the person's tmux never sees it. kill() ends the scratch server and removes its socket file.
export function personPane(command) {
  const socket = join(tmpdir(), `ar-person-${process.pid}-${Math.random().toString(36).slice(2, 8)}.sock`)
  const { TMUX: _t, TMUX_PANE: _p, TMUX_SOCKET: _s, ...env } = process.env
  const tmux = (...args) => Bun.spawnSync(['tmux', '-f', '/dev/null', '-S', socket, ...args], { env })
  const made = tmux('new-session', '-d', '-s', 'person', '-x', '160', '-y', '48', '--', 'sh', '-c', command)
  if (made.exitCode !== 0) throw new Error(`no scratch tmux: ${made.stderr.toString()}`)
  const pane = tmux('display-message', '-p', '-t', 'person', '#{pane_id}').stdout.toString().trim()
  const kill = () => {
    tmux('kill-server')
    rmSync(socket, { force: true })
  }
  return { socket, pane, env: { TMUX: `${socket},1,0`, TMUX_PANE: pane }, kill }
}

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

// A project with a store and the roles' fits: nothing is assigned (the work model opens its own top).
export async function initiated(files) {
  const p = project(files)
  await init(p)
  for (const role of ['architect', 'section-lead', 'writer', 'linter']) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  return { p }
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

// A small code project: a lead, an implementer that reports <repo>@<commit>, and a gate. Ruling 7,
// onboarding 2026-11-14: persistence and icon, as in WORK_YAML; the gate has an icon only.
export const CODE_YAML = `people:
  - name: Nanda
models:
  haiku: { limits: { Assignment: { attempts: 3 } } }
  sonnet: {}
  opus: {}
# the harness drafts the directions in code-directions/*.yaml
roles:
  tech-lead:
    model: opus
    description: Keeps the fixes on their directions, and evaluates a fix that fails.
    intro: You keep the fixes on their directions.
    responsibilities:
      - Evaluate a fix whose implementer used its last try on a fault, with work evaluate.
    acts: [{ approve: [lead, implementer] }, { assign: [lead, implementer] }, split, direct, fit]
    persistence:
      persistent: true
      why: It keeps every fix of the project on its directions and evaluates a fix that fails.
    icon: compass
  lead:
    model: sonnet
    description: Runs one fix - assigns the implementer and decides the fix.
    intro: You run one fix.
    responsibilities:
      - Assign the implementer with work assign.
    acts: [{ approve: [implementer] }, { assign: [implementer] }]
    persistence:
      persistent: true
      why: It runs one fix through the implementer until it decides the fix.
    icon: layers
  implementer:
    model: haiku
    description: Makes one fix as one commit in the workspace repo.
    intro: You make one fix.
    responsibilities:
      - Commit the fix in <repo> and report it as <repo>@<commit>.
    output: "<repo>@<commit>"
    acts: [{ do: make one fix }]
    persistence:
      persistent: false
      why: It makes one fix once, as one commit.
    icon: wrench
  gate:
    kind: program
    run: "test -f ok.txt"
    on: report
    checks: [suite-passes]
    acts: [{ review: [implementer] }]
    icon: terminal
`
export const CODE_DIRECTION = `id: fixes
name: Fixes
owner: Nanda
summary: A fix counts only with a test that ran on it.
flow:
  - { from: implementer, to: app/ok.txt, says: fixes the key }
  - from: gate
    to: app/ok.txt
    says: runs the suite on the fix
    uses: [fixes, proven, suite-passes]
    examples:
      - { fit: Follows, input: { file: app/ok.txt, line: 1, excerpt: ok }, output: { file: aristoteles.yaml, line: 43, excerpt: 'run: "test -f ok.txt"' } }
      - { fit: Breaks, input: { file: app/ok.txt, line: 1, excerpt: ok }, output: { written: "Accept: the key is fixed, and no test ran on it." } }
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

// A change of a direction: the high role (default architect) drafts it from
// <yaml>, and the person accepts the draft (the reviser cannot review its own draft). Returns the
// draft id and the reviser token; pass { accept: false } to leave the draft open. In a project with
// other roles, pass { role, on, fit: true } (fit the role first).
export async function changeDirection(p, yaml, opts = {}) {
  const { flags = '', accept = true, direction = 'tsd-writing', role = 'architect', fit = false } = opts
  if (!p.arch) {
    if (fit) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
    p.arch = tokenIn(ok(await p.nanda(`assign t1 --role=${role}`)).out)
    ok(await p.agent(`brief ${p.arch}`))
  }
  p.write('change.yaml', yaml)
  const drafted = ok(await p.agent(`direction revise ${p.arch} ${direction} --file=change.yaml ${flags}`)).out
  const draft = drafted.match(/^(d\d+) drafted/m)[1]
  const out = accept ? ok(await p.nanda(`review ${draft} accept --evidence="change.yaml | the change is what was asked"`, 'accept')).out : drafted
  return { draft, arch: p.arch, out }
}
