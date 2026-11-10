import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { digestOf } from '../digest.js'
import { fileTurn, idleWhy, outputForm, rulesFor } from '../render.js'
import { replay } from '../state.js'
import { openStore } from '../store.js'
import { init, ok, project, TASK } from './harness.js'

// The generated invariant test. Each run starts a document project, then takes random steps:
// a random actor (the person, or an agent token that assign printed) runs a random command
// with ids from the record, or a file changes. After each step the oracles below compare
// what the CLI claims with the raw records. A run is reproducible from its seed.
//   WORK_PROPERTY_RUNS=200 WORK_PROPERTY_STEPS=120 bun test test/property.test.js
// runs a deep search; the default is small, so that the suite stays fast.

const RUNS = Number(process.env.WORK_PROPERTY_RUNS ?? 6)
const STEPS = Number(process.env.WORK_PROPERTY_STEPS ?? 40)
const FIRST = Number(process.env.WORK_PROPERTY_SEED ?? 1)

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TSD_TASK = 'name: The TSD\ntext: Write the TSD.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n'
const PARTS = {
  'p1.yaml': '- { name: Intro, text: Write the intro., context: { region: introduction } }\n- { name: Design, text: Write the design., context: { region: design } }\n',
  'p2.yaml': '- { name: Failure, text: Write the failure cases., context: { region: failure } }\n',
  'p3.yaml': '- { name: Design, text: Write the design., context: { region: design } }\n',
  'p4.yaml': '- { name: Front, text: Write the front. }\n- { name: Design, text: Write the design., context: { region: design } }\n',
  'p5.yaml': '- { name: Data model, text: Write the data model., context: { region: data-model } }\n',
  'p6.yaml': '- { name: Story, text: Tell the story. }\n',
}
const replaceStandard = (id, says, rules) => `replace:\n  - id: ${id}\n    with:\n      id: ${id}\n${id === 'intro-story' ? '      where: { region: introduction }\n' : ''}` +
  `      says: ${says}\n      rules:\n${rules.map((r) => `        - ${r}\n`).join('')}`
const NO_CODE = '{ id: no-code-proof, says: "No file paths with line numbers, no commit hashes in the body", checkedBy: linter }'
const NO_TICKET = '{ id: no-ticket-ids, says: "No ticket ids and no chat-thread citations", checkedBy: linter }'
const EDITS = {
  'e1.yaml': 'add:\n  - id: dates\n    says: Dates are exact.\n    rules:\n      - { id: exact-dates, says: "Every date has a day", checkedBy: linter }\n',
  'e2.yaml': replaceStandard('intro-story', 'Tell the story first, in plain words.', ['{ id: repeatable, says: "A reviewer can repeat the problem without the design", checkedBy: linter }']),
  'e3.yaml': replaceStandard('facts-not-proof', 'The body states facts.', [NO_CODE]),
  'e4.yaml': 'add:\n  - { id: short, says: Keep it short. }\n',
  'e5.yaml': 'says: The reader decides from the page alone.\n',
  'e6.yaml': 'add:\n  - id: headings\n    says: Headings are plain.\n    rules:\n      - { id: no-ticket-ids, says: "No ids in headings", checkedBy: linter }\n',
  'e7.yaml': replaceStandard('facts-not-proof', 'The body states facts only.', [NO_CODE, NO_TICKET]),
}
// Task files for a remake (a change of scope) and for a task that needs another one.
const REMAKES = {
  'k1.yaml': 'name: The TSD again\ntext: Write the TSD, design first.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n',
  'k2.yaml': 'name: The TSD, smaller\ntext: Write the TSD with no failure cases.\ndirections: [tsd-writing]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n',
  'k3.yaml': 'name: The whole TSD\ntext: Put the TSD together.\ndirections: [tsd-writing]\nneeds: [t1]\nworkspace: [ { source: tsd, path: docs/tsd.md } ]\n',
}
const TEXTS = ['TODO', 'The export ran twice for one merchant, so the merchant got two files.', 'One file per merchant per day.',
  'ABC-1234: the export ran twice.', 'The retry did not check the first file.', 'See worker.go:142 for the retry.']
const RULES = ['no-code-proof', 'no-ticket-ids', 'repeatable', 'exact-dates']
const ROLES = ['architect', 'region-lead', 'writer', 'linter']
const CRASH = /TypeError|ReferenceError|undefined is not|Cannot read propert|is not a function|is not iterable|ENOENT|SyntaxError|RangeError|\[object Object\]/
// An agent may grant and revoke too (decided 2026-11-08), so they are not person-only.
const PERSON_ONLY = ['init', 'ratify', 'config', 'config.text', 'role.fit', 'task.open']
// A person is { name }; a run of a model is { name, run }.
const isHuman = (actor) => typeof actor === 'object' && actor !== null && actor.run === undefined

// The file of the run, by region; data-model is a sub-heading of design when it is there.
const render = (r) => `# TSD\n\n## Introduction\n\n${r.introduction}\n\n## Design\n\n${r.design}\n` +
  `${r['data-model'] ? `\n### Data model\n\n${r['data-model']}\n` : ''}\n## Failure\n\n${r.failure}\n`
// The region of a heading slug in a file: its first and last line (an own small parser).
function regionLines(text, slug) {
  const lines = text.split('\n')
  const heads = lines.flatMap((l, i) => (/^#+ /.test(l) ? [{ i, level: l.match(/^#+/)[0].length,
    slug: l.replace(/^#+ /, '').toLowerCase().trim().replace(/[^a-z0-9 -]/g, '').replace(/ +/g, '-') }] : []))
  const h = heads.find((x) => x.slug === slug)
  if (!h) return undefined
  return { start: h.i, end: heads.find((x) => x.i > h.i && x.level <= h.level)?.i ?? lines.length }
}

async function runOne(seed) {
  const rnd = mulberry32(seed)
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)]
  const chance = (x) => rnd() < x
  const regions = { introduction: 'TODO', design: 'TODO', failure: 'TODO', 'data-model': undefined }
  const p = project({ 'task.yaml': chance(0.75) ? TSD_TASK : TASK, 'docs/tsd.md': render(regions), ...PARTS, ...EDITS, ...REMAKES })
  if (!readFileSync(join(p.dir, 'task.yaml'), 'utf8')) throw new Error('no task file')
  const violations = []
  const history = []
  const counts = {}
  const checked = new Set()
  const tokens = new Map()
  const harvest = (text) => { for (const m of text.matchAll(/work brief (a\d+)\.([a-z0-9]+)/g)) tokens.set(m[1], `${m[1]}.${m[2]}`) }
  const rows = () => { const s = openStore({ cwd: p.dir, env: { ARISTOTELES_DB: `${p.dir}/.work/aristoteles.db` } }); try { return s.events() } finally { s.close() } }
  const state = () => replay(rows())
  const fail = (what) => violations.push(`seed ${seed} step ${history.length} (${p.dir}): ${what}\n  last steps:\n    ${history.slice(-12).join('\n    ')}`)
  const look = (r, line) => { if (CRASH.test(r.out) || CRASH.test(r.err)) fail(`crash text in "${line}": ${(r.err || r.out).slice(0, 300)}`) }

  await init(p)
  for (const role of ROLES) ok(await p.nanda(`role fit ${role} --answers=fit.yaml`))
  ok(await p.nanda('task open --file=task.yaml'))
  ok(await p.nanda('grant --act=change --on=tsd-writing,t1 --to=architect --until=2026-12-31T00:00:00Z', 'grant'))
  harvest(ok(await p.nanda(`assign t1 --role=${chance(0.6) ? 'architect' : 'region-lead'}`)).out)

  for (let step = 0; step < STEPS; step++) {
    const before = rows()
    const S = replay(rows())
    const read = S.engine.read
    const id = (x) => S.idOf.get(x)
    const open = read.assignments.filter((a) => !a.finished && tokens.has(id(a)))
    const known = read.assignments.filter((a) => tokens.has(id(a)))
    const me = chance(0.85) && open.length ? pick(open) : known.length ? pick(known) : undefined
    const tk = me && tokens.get(id(me))
    const inTree = (task) => me && read.within(task, me.task)
    const results = read.results.filter((r) => !me || chance(0.2) || inTree(r.task))
    // Reviews aim at the work as it is now: the latest result of a task, mostly.
    const latest = results.filter((r) => read.resultsOf(r.task).at(-1) === r)
    const R = results.length ? id(pick(chance(0.85) && latest.length ? latest : results.slice(-4))) : 'r1'
    const tasks = read.tasks.filter((t) => !me || inTree(t))
    const T = tasks.length ? id(pick(tasks)) : 't1'
    const points = read.reviews.filter((r) => r.decision === 'Reject').map(id).filter(Boolean)
    const V = points.length ? pick(points) : 'v1'
    const versions = S.directions['tsd-writing'].versions.map((v) => `tsd-writing@${v.number}`)
    const VER = pick(versions.slice(-2))
    const qs = read.notes.filter((n) => n.kind === 'Question' && n.answer === undefined).map(id).filter(Boolean)
    const Q = qs.length ? pick(qs) : 'q1'
    const A = known.length ? id(pick(known)) : 'a1'
    const region = me?.task.aiDescription.context.region
    // The maker reports the form that its brief names; a free region is picked at random.
    const form = me ? outputForm(S, me) : 'docs/tsd.md'
    const output = chance(0.1) ? pick(['docs/tsd.md', 'docs/tsd.md#introduction', 'docs/tsd.md#design'])
      : form.replace(/^<file>/, 'docs/tsd.md').replace(/#<[^>]+>/, `#${pick(['introduction', 'design', 'failure'])}`)
    const evidence = (place) => RULES.filter(() => chance(0.6))
      .map((r) => `--evidence="${r} | the text in ${place} | I read each line and saw nothing against it"`).join(' ')
    const point = () => `--point="${pick(['cites a ticket', 'names a file path', 'the story needs the cost', 'needs two parts'])}"${chance(0.5) ? ` --breaks=${pick(RULES)}` : ''}`
    const resultOf = S.byId.get(R)
    const place = resultOf?.output ?? 'docs/tsd.md'

    // Acts are chosen by role, as real agents act; the acts that end work are rare, so that
    // runs reach deep states. Wrong ids and acts still come, at a lower rate.
    const weighted = (choices) => {
      const live = choices.filter(([w]) => w > 0)
      let x = rnd() * live.reduce((s, [w]) => s + w, 0)
      return live.find(([w]) => (x -= w) < 0)[1]()
    }
    const edit = (key, work) => {
      regions[key] = key === 'data-model' && regions[key] && chance(0.3) ? undefined
        : pick(work ? TEXTS.filter((x) => x !== regions[key] && x !== 'TODO') : TEXTS)
      p.write('docs/tsd.md', render(regions))
      history.push(`(file) ${key} = ${regions[key]}`)
    }
    const leaves = read.tasks.filter((t) => !t.closed && (!me || inTree(t)) && !read.tasks.some((x) => x.serves === t && !x.closed))
    const L = leaves.length ? id(pick(leaves)) : T
    const notRoot = read.tasks.filter((t) => t.serves && !t.closed).map(id)
    const claim = me && S.meta.get(me)?.claim
    const children = me ? read.assignments.filter((a) => a.parent === me && !a.finished).map(id) : []
    // A low checker names its own checks, as its brief lists them (sometimes one is missing).
    const lowEvidence = (at) => rulesFor(S, me).map((r) => r.id).filter(() => chance(0.95))
      .map((r) => `--evidence="${r} | the text in ${at} | I read each line and saw nothing against it"`).join(' ')
    // A lead gives a task a checker when it has work to check, and a maker when it has none.
    const work = (t) => { const last = read.resultsOf(t).at(-1); return last && !S.engine.accepted(last, S.now) && !read.reviewsOf(last).some((v) => v.decision === 'Reject') }
    const roleFor = (tid) => (work(S.byId.get(tid)) ? (chance(0.8) ? 'linter' : 'writer') : (chance(0.85) ? 'writer' : pick(['linter', 'region-lead'])))
    // The drafts that wait (no version made yet); a draft of a config file has no id.
    const waitingDrafts = read.drafts.filter((d) => !read.madeBy(d)).map(id).filter(Boolean)
    const DRAFT = waitingDrafts.length ? pick(waitingDrafts) : 'd1'
    const SUG = DRAFT
    const ACCEPT = (place) => `--evidence="the draft | I read ${place} and it says what to check"`
    // The top agent relays the person's words; each act takes its own target and flags.
    const relay = () => `relay ${tk} Nanda ` + weighted([
      [1, () => `reject ${chance(0.9) ? R : T} --quote="this is wrong" ${point()}`],
      [3, () => `accept ${R} --quote="yes, this is right" --evidence="repeatable | the introduction in ${place} | a reviewer can repeat it"`],
      [1, () => `comment ${pick([R, T])} --quote="keep it short"`],
      [2, () => `accept ${DRAFT} --quote="yes, change it" ${ACCEPT('d')}`],
      [qs.length ? 2 : 0, () => `answer ${Q} --quote="it was M-104" --text="It was M-104."`],
    ]) + ' --channel=chat'

    // The commands that a view printed, filled in as an agent fills them: a child's token, a
    // file, one of the alternatives, a place in the result, words for the reasons.
    const printed = (text) => text.split('\n').flatMap((l) => l.trim().split(', then '))
      .filter((l) => l.startsWith('work ') && !/<a\d+ token>/.test(l))
      .map((l) => {
        const at = S.byId.get(l.match(/ (r\d+) /)?.[1])?.output ?? place
        return l.slice(5)
          .replace(/(a\d+)\.<[^>]*>/g, (m, aid) => tokens.get(aid) ?? '<no token>')
          .replace(/=([a-z-]+(?:\|[a-z-]+)+)/g, (m, alts) => `=${pick(alts.split('|'))}`)
          .replace(/ ([a-z-]+(?:\|[a-z-]+)+) /g, (m, alts) => ` ${pick(alts.split('|'))} `)
          .replace(/<parts\.yaml>/g, () => pick(Object.keys(PARTS))).replace(/<edit\.yaml>/g, () => pick(Object.keys(EDITS)))
          .replace(/<task\.yaml>/g, () => pick(Object.keys(REMAKES)))
          .replace(/<suggestion>/g, SUG).replace(/<draft>/g, DRAFT)
          .replace(/@<n>/g, `@${S.directions['tsd-writing'].versions.length}`)
          .replace(/--evidence="<rule id> \| <where> \| <what>"/g, '--reason="the evidence of the checkers is in"')
          .replace(/<where[^>]*>/g, `the text in ${at}`).replace(/<what[^>]*>/g, 'I read each line and saw nothing against it')
          .replace(/<[^>]+>/g, 'it holds, as the record shows')
      })
      .filter((c) => !c.includes('<no token>'))

    // The tasks that wait for an evaluation, and the words of one.
    const stopped = read.tasks.filter((t) => !t.closed && read.evaluationWaits(t)).map(id)
    const EVAL = () => `--wrong="the work fails its rule" --why="the rule does not say what it needs" --improve="say it in the rule" ` +
      `--level=${pick(['task', 'standard', 'direction', 'principle'])}`
    let line
    let who = 'agent'
    let typed
    const roll = rnd()
    if (roll < 0.04) {
      // A file changes outside any act: a region gets new words.
      edit(pick(['introduction', 'design', 'failure', 'data-model']))
      continue
    } else if (roll < 0.33 || !tk) {
      who = 'person'
      // The person often does what waiting lists; else a random act.
      const follow = chance(0.45) && printed((await p.nanda('waiting')).out)
      if (follow?.length) {
        line = pick(follow.slice(0, 4))
        typed = /^review \S+ accept/.test(line) ? 'accept' : line.startsWith('ratify') ? 'ratify' : undefined
      } else line = weighted([
        [open.length ? 1 : 14, () => `assign ${pick(leaves.length ? leaves.map(id) : ['t1'])} --role=${pick(['architect', 'region-lead'])}`],
        [read.results.length ? 8 : 0.3, () => `review ${R} accept --evidence="repeatable | the introduction in ${place} | a reviewer can repeat the problem"`],
        [read.results.length ? 1.5 : 0.3, () => `review ${R} reject ${point()}`], [0.2, () => `review ${T} reject ${point()}`],
        [2, () => `task split ${L} --file=${pick(Object.keys(PARTS))}${chance(0.4) ? ` --review=${V}` : ''}`],
        [notRoot.length ? 1 : 0.1, () => `task close ${notRoot.length && chance(0.95) ? pick(notRoot) : T} --reason="not needed"`],
        [1, () => `task remake ${pick(leaves.length ? leaves.map(id) : ['t1'])} --file=${pick(Object.keys(REMAKES))} --reason="the scope changed"${chance(0.4) ? ` --review=${V}` : ''}`],
        [0.4, () => 'task open --file=k3.yaml'],
        [3, () => `direction revise tsd-writing --file=${pick(Object.keys(EDITS))}${chance(0.5) ? ` --answers=${V} --why="it answers the point"` : ''}`],
        [3, () => { typed = 'accept'; return `review ${DRAFT} accept ${ACCEPT('the draft')}` }],
        [0.5, () => `review ${DRAFT} reject --reason="it is not precise"`],
        [0.5, () => { typed = 'grant'; return `grant --act=change --on=tsd-writing,t1 --to=architect --until=2026-12-31T00:00:00Z` }],
        [0.3, () => `suggest tsd-writing --says="the direction needs a rule for dates"`],
        [S.pending.size ? 6 : 1, () => { typed = 'ratify'; return `ratify ${pick([...S.pending.keys(), 'e1'])}` }],
        [0.5, () => `finish ${A}`], [1, () => `release ${A}`], [qs.length ? 4 : 0.5, () => `answer ${Q} --text="yes, go on"`],
        [1, () => `waive ${R} --rules=${pick(RULES)} --reason="urgent" --until=2026-10-27T00:00:00Z`],
        [2, () => 'waiting'], [1, () => `blockers ${R}`],
        [stopped.length ? 3 : 0.2, () => `evaluate ${stopped.length ? pick(stopped) : T} ${EVAL()}`],
        [read.evaluations.length ? 1.5 : 0.1, () => {
          const ev = `ev${1 + Math.floor(rnd() * Math.max(1, read.evaluations.length))}`
          if (chance(0.7)) { typed = 'accept'; return `review ${ev} accept --evidence="evaluation show ${ev} | I read it in full"` }
          return `review ${ev} reject --reason="I read it"`
        }],
      ])
    } else if (read.isDo(me.role)) {
      // A maker: brief, change its region, report.
      line = weighted([
        [claim ? 1 : 8, () => `brief ${tk}`],
        [claim ? 12 : 2, () => { edit(region ?? output.split('#')[1] ?? pick(['introduction', 'design', 'failure']), true); return `report ${tk} --output=${output}` }],
        [claim ? 2 : 0.5, () => `report ${tk} --output=${output}`],
        [1.5, () => `raise ${tk} --reason="I need help"`], [0.5, () => `suggest ${tk} ${pick(RULES)} --says="it cannot be met"`],
      ])
    } else if (me.role.tier === 'low') {
      // A low checker: brief (it claims the latest result), then one review.
      const target = claim?.result ?? R
      const at = S.byId.get(target)?.output ?? place
      line = weighted([
        [claim?.result ? 1 : 8, () => `brief ${tk}`],
        [claim?.result ? 8 : 1, () => `review ${tk} ${target} accept ${lowEvidence(at)}`],
        [claim?.result ? 2 : 0.5, () => `review ${tk} ${target} reject ${point()}`], [1.5, () => `raise ${tk} --reason="the brief is not enough"`],
      ])
    } else {
      // A medium or high agent runs its tree: often by a command that its next printed.
      const follow = claim && chance(0.5) && printed((await p.agent(`next ${tk}`)).out)
      if (follow?.length) line = pick(follow.slice(0, 3))
      else line = weighted([
        [claim ? 2 : 14, () => `brief ${tk}`], [3, () => `next ${tk}`],
        [12, () => `assign ${tk} ${L} --role=${roleFor(L)}${chance(0.15) ? ' --max-attempts=1' : ''}`],
        [read.results.length ? 6 : 0.3, () => `review ${tk} ${R} accept ${evidence(place) || '--reason="it holds"'}`],
        [read.results.length ? 1 : 0.3, () => `review ${tk} ${R} reject ${point()}`], [0.2, () => `review ${tk} ${T} reject ${point()}`],
        [3, () => `recheck ${tk} ${R} --reason="the facts moved"`],
        [2, () => `raise ${tk} --reason="I need help"${chance(0.5) ? ` --result=${R}` : ''}`],
        [me.role.tier === 'high' ? 5 : 1, () => `task split ${tk} ${L} --file=${pick(Object.keys(PARTS))}${chance(0.4) ? ` --review=${V}` : ''}`],
        [notRoot.length ? 1 : 0.1, () => `task close ${tk} ${notRoot.length && chance(0.95) ? pick(notRoot) : T} --reason="not needed"`],
        [me.role.tier === 'high' ? 1 : 0.2, () => `task remake ${tk} ${L} --file=${pick(Object.keys(REMAKES))} --reason="the scope changed"`],
        [2, () => `direction revise ${tk} tsd-writing --file=${pick(Object.keys(EDITS))}${chance(0.5) ? ` --answers=${V} --why="better"` : ''}`],
        [2, () => `review ${tk} ${DRAFT} accept ${ACCEPT('the draft')}`],
        [1, () => `review ${tk} ${DRAFT} reject --reason="I read it"`],
        [0.5, () => `grant ${tk} --act=change --on=tsd-writing,t1 --to=architect --until=2026-12-31T00:00:00Z`],
        [1, () => `waive ${tk} ${R} --rules=${pick(RULES)} --reason="urgent" --until=2026-10-27T00:00:00Z`],
        [children.length ? 1.5 : 0, () => `finish ${tk} ${pick(children)}`], [children.length ? 1.5 : 0, () => `release ${tk} ${pick(children)}`],
        [0.3, () => `finish ${tk}`], [me.parent ? 0.5 : 6, relay],
        [1, () => `ask ${tk} --text="Which merchant was it?"${chance(0.5) ? ' --to=owner' : ''}`],
        [qs.length ? 3 : 0.3, () => `answer ${tk} ${Q} --text="It was M-104."`],
        [0.5, () => `suggest ${tk} ${pick(RULES)} --says="it cannot be met"`],
        [1, () => `checkpoint ${tk} ${T} --next="go on"`], [1, () => `resume ${tk} ${T}`],
        [me.role.tier === 'high' ? (stopped.length ? 6 : 0.5) : 0.2, () => `evaluate ${tk} ${stopped.length ? pick(stopped) : T} ${EVAL()}`],
      ])
    }
    const r = who === 'person' ? await p.nanda(line, typed) : await p.agent(line)
    const family = line.split(' ').slice(0, line.startsWith('task ') || line.startsWith('direction ') ? 2 : 1).join(' ')
    counts[family] ??= { ok: 0, refused: 0 }
    counts[family][r.code === 0 ? 'ok' : 'refused'] += 1
    if (r.code !== 0) { const why = r.err.split('\n')[0].replace(/[art]\d+(\.[a-z0-9]+)?/g, 'X').slice(0, 70); counts[family][why] = (counts[family][why] ?? 0) + 1 }
    history.push(`${who === 'person' ? '(person) ' : ''}work ${line} -> ${r.code === 0 ? 'ok' : `refused: ${r.err.split('\n')[0].slice(0, 120)}`}`)
    harvest(r.out)
    look(r, line)

    // O2: the log only grows, and a refused command writes nothing.
    const after = rows()
    if (before.some((e, i) => JSON.stringify(e) !== JSON.stringify(after[i]))) fail('an earlier event changed')
    if (r.code !== 0 && after.length !== before.length) fail(`a refused command wrote ${after.length - before.length} event(s)`)
    checkRecord(after, after.length > before.length ? after.at(-1) : undefined)
    if (step % 4 === 3) await views()
  }
  await views()
  await deadEnds()
  if (process.env.WORK_PROPERTY_HISTORY) console.log(history.join("\n"))
  const end = state()
  const er = end.engine.read
  counts.depth = { tasks: er.tasks.length, accepted: er.tasks.filter((x) => end.engine.taskAccepted(x, end.now)).length,
    joins: er.results.filter((x) => er.tasks.some((y) => y.serves === x.task)).length, results: er.results.length,
    answered: er.reviews.filter((x) => x.decision === 'Reject' && er.answered(x)).length,
    approvals: end.directions['tsd-writing'].versions.length - 1, splits: er.changes.filter((c) => !c.to).length,
    ratified: rows().filter((e) => e.type === 'ratify').length, everAccepted: checked.size,
    remade: er.tasks.filter((x) => x.replaces).length }
  return { violations, counts, events: rows() }

  // Every view prints, for every record, with no crash.
  async function views() {
    const S = state()
    const read = S.engine.read
    const lines = ['status', 'log', 'task tree t1', ...read.results.slice(-6).map((r) => `blockers ${S.idOf.get(r)}`),
      ...read.assignments.map((a) => `assignment show ${S.idOf.get(a)}`),
      ...read.assignments.filter((a) => !a.finished && tokens.has(S.idOf.get(a))).map((a) => `next ${tokens.get(S.idOf.get(a))}`)]
    for (const l of lines) look(await p.agent(l), l)
    look(await p.nanda('waiting'), 'waiting')
    for (const a of read.assignments.filter((x) => !x.finished && x.task.closed && !x.role.config?.kind)) {
      const show = await p.agent(`assignment show ${S.idOf.get(a)}`)
      if (!show.out.includes('CLOSED')) fail(`${S.idOf.get(a)} on the closed task ${S.idOf.get(a.task)} is not told to stop`)
    }
  }

  // The oracles on the record, from the raw rows (O3 to O8).
  function checkRecord(events, last) {
    const S = replay(structuredClone(events))
    const again = replay(structuredClone(events))
    const read = S.engine.read
    const id = (x) => S.idOf.get(x)
    // O3: two replays of the same log say the same.
    const summary = (st) => JSON.stringify(st.engine.read.tasks.map((t) => st.engine.Task.state(t, st.now)).concat(
      st.engine.read.results.map((x) => st.engine.accepted(x, st.now)), [st.pending.size]))
    if (summary(S) !== summary(again)) fail('two replays of one log differ')
    // O4 (invariant 1): person-only events come from the person; an accept by the person comes
    // from the person's own terminal or from a ratify.
    for (const e of events) {
      if (/^a\d+$/.test(e.who) && PERSON_ONLY.includes(e.type)) fail(`agent ${e.who} wrote the person-only event ${e.type} (e${e.id})`)
    }
    for (const v of read.reviews.filter((x) => isHuman(x.by?.actor) && x.decision === 'Accept')) {
      const from = S.events.find((e) => e.created?.includes(id(v)))
      if (!from || !((from.who === 'Nanda' && from.channel === 'terminal') || from.type === 'ratify')) {
        fail(`the person's accept ${id(v)} came from ${from ? `${from.who} ${from.channel} ${from.type}` : 'no event'}`)
      }
    }
    // Invariant 5: an assignment acts no more after its finish.
    for (const f of events.filter((e) => e.type === 'finish')) {
      const late = events.find((e) => e.id > f.id && e.who === f.data.a)
      if (late) fail(`${f.data.a} wrote ${late.type} (e${late.id}) after its finish (e${f.id})`)
    }
    // O5 (invariant 2): an accepted result has, for each rule of its task, evidence on that
    // result from an accept by the rule's checker, or a waiver.
    for (const result of read.results.filter((x) => S.engine.accepted(x, S.now))) {
      checked.add(id(result))
      if (read.reviews.some((v) => v.of === result && v.decision === 'Reject')) fail(`${id(result)} is accepted but has a Reject`)
      for (const rule of read.rulesOf(result.task).filter((x) => x.checkedBy !== undefined)) {
        const good = read.reviews.filter((v) => v.of === result && v.decision === 'Accept' && !v.settles &&
          (rule.checkedBy === 'Human' ? isHuman(v.by.actor) : v.by.role?.role === rule.checkedBy.role) &&
          v.evidence.some((e) => e.meets === rule && e.at))
        const waived = read.notes.some((n) => n.kind === 'Finding' && n.about === result && (n.notChecked ?? []).includes(rule))
        if (!good.length && !waived) fail(`${id(result)} is accepted with no evidence from ${rule.checkedBy === 'Human' ? 'the person' : rule.checkedBy.role} for ${rule.id}`)
      }
    }
    // The decider decides: an accepted result has an accept by its task's owner, or by a role
    // that approves the maker's role in work.yaml.
    for (const result of read.results.filter((x) => S.engine.accepted(x, S.now))) {
      const approves = (role) => (S.config.roles[role]?.acts ?? []).some((x) => (x.approve ?? []).includes(result.by.role.role))
      const decided = read.reviews.some((v) => v.of === result && v.decision === 'Accept' && !v.settles &&
        (isHuman(v.by?.actor) ? v.by.actor.name === result.task.owner.name : approves(v.by.role?.role)))
      if (!decided) fail(`${id(result)} is accepted with no accept by a role that decides it`)
    }
    // Needs: no open task needs a closed task, and no result was reported while a need of its
    // task was not accepted.
    for (const t of read.tasks.filter((x) => !x.closed)) {
      const closed = t.needs.find((n) => n.closed)
      if (closed) fail(`${id(t)} needs ${id(closed)}, which is closed`)
    }
    if (last?.type === 'report') {
      const before = replay(structuredClone(events.slice(0, -1)))
      const task = before.byId.get(S.idOf.get(S.byId.get(S.events.at(-1).created[0]).task))
      const open = task.needs.find((n) => !before.engine.taskAccepted(n, before.now))
      if (open) fail(`a result was reported on ${S.idOf.get(task)} while it needed ${before.idOf.get(open)}, which was not accepted`)
    }
    // O6 (invariant 3): an answered Reject was answered by a change or an official draft that lists it, by a
    // later result (a redo), or by later changed work with evidence for its rule.
    for (const v of read.reviews.filter((x) => x.decision === 'Reject' && read.answered(x))) {
      const task = v.of.task ?? v.of
      const listed = read.changes.some((c) => c.answers.includes(v)) ||
        read.drafts.some((d) => d.answers.includes(v) && read.madeBy(d))
      const later = read.results.filter((x) => x.task === task && x.at > v.at)
      const changedWork = v.breaks && later.some((x) => x.digest !== v.of.digest && read.reviews.some((a) => a.of === x &&
        a.decision === 'Accept' && !a.settles && a.evidence.some((e) => e.meets === v.breaks && e.at)))
      if (!(listed || (v.redo && later.length) || changedWork)) fail(`${id(v)} counts as answered with no change, redo, or changed work`)
    }
    // O7 (invariant 4): a rule id names one rule in the official versions.
    const ids = read.directions.flatMap((d) => read.current(d).standards.flatMap((s) => (s.rules ?? []).map((x) => x.id)))
    const twin = ids.find((x, i) => ids.indexOf(x) !== i)
    if (twin) fail(`the rule id ${twin} is twice in the official versions`)
    // O8 (invariant 6): a new report is on an open task, and keeps the regions of the other
    // open tasks of its tree that lie inside it.
    if (last?.type === 'report') {
      const result = S.byId.get(S.events.at(-1).created[0])
      if (result.task.closed) fail(`${id(result)} was reported on the closed task ${id(result.task)}`)
      const [file, slug] = result.output.split('#')
      const text = readFileSync(join(p.dir, file), 'utf8')
      const mine = slug ? regionLines(text, slug) : { start: 0, end: Infinity }
      let top = result.task
      while (top.serves) top = top.serves
      for (const u of read.tasks.filter((x) => x !== result.task && !x.closed && read.within(x, top) && !read.within(result.task, x))) {
        const theirs = read.resultsOf(u).at(-1)
        const [theirFile, theirSlug] = theirs?.output.split('#') ?? []
        if (!theirs || theirFile !== file || /@/.test(theirs.output)) continue
        const at = theirSlug ? regionLines(text, theirSlug) : undefined
        const inside = theirSlug ? at && at.start > (slug ? mine.start : -1) && at.start < mine.end : u.serves === result.task
        let now
        try { now = digestOf(p.dir, theirs.output).digest } catch { now = undefined }
        if (inside && now !== theirs.digest) fail(`${id(result)} changed ${theirs.output} of ${id(u)} (${id(theirs)})`)
      }
    }
  }

  // At the end, every open task with no open parts has a printed command that moves it.
  async function deadEnds() {
    const S = state()
    const read = S.engine.read
    const id = (x) => S.idOf.get(x)
    const texts = [(await p.nanda('waiting')).out]
    for (const a of read.assignments.filter((x) => !x.finished && tokens.has(id(x)))) texts.push((await p.agent(`next ${tokens.get(id(a))}`)).out)
    const lines = texts.join('\n').split('\n')
    const moved = (ref) => lines.some((l, i) => new RegExp(`\\b${ref}\\b`).test(l) && (l.includes('work ') || lines[i + 1]?.trim().startsWith('work ')))
    for (const t of read.tasks.filter((x) => !x.closed && !S.engine.taskAccepted(x, S.now))) {
      // A Reject of the task itself must be named by a printed command, also while parts are open.
      // While the task waits for an evaluation, the printed evaluate of that stop moves it first.
      const stop = read.evaluationWaits(t)
      for (const r of read.reviews.filter((x) => x.of === t && x.decision === 'Reject' && !x.redo && !read.answered(x))) {
        if (stop && moved(id(stop).split('.')[0])) continue
        // The stop of a Reject is its first point, named by the id of the whole Reject (v5, not v5.1).
        if (!moved(id(r)) && !moved(id(r).split('.')[0])) fail(`dead end: no printed command answers ${id(r)}, the Reject of ${id(t)}`)
      }
      if (read.tasks.some((y) => y.serves === t && !y.closed) || t.needs.some((n) => !S.engine.taskAccepted(n, S.now))) continue
      // A maker that waits for a file moves when the maker before it finishes: that maker's own
      // task moves (this loop checks it), or a printed command finishes it.
      const maker = read.assignments.find((x) => x.task === t && !x.finished && read.openDo(x))
      const waits = maker && fileTurn(S, maker)
      if (waits) {
        const x = waits.before
        if (idleWhy(S, x) && !moved(id(x))) fail(`dead end: ${id(maker)} waits for ${waits.path}, and no printed command finishes ${id(x)}`)
        continue
      }
      const latest = read.resultsOf(t).at(-1)
      const refs = [id(t), ...(latest ? [id(latest), ...S.engine.blockerItems(latest, S.now).map((i) => id(i.ref)).filter(Boolean)] : []),
        ...read.openQuestions(t).map(id)]
      if (!refs.some(moved)) fail(`dead end: no printed command moves ${id(t)} (${S.engine.Task.state(t, S.now)})`)
    }
  }
}

const seeds = Array.from({ length: RUNS }, (_, i) => FIRST + i)
const totals = {}
for (const seed of seeds) {
  test(`seed ${seed}: the invariants hold after every step`, async () => {
    const { violations, counts, events } = await runOne(seed)
    // Coverage: per command, how many passed and why the others were refused.
    for (const [k, v] of Object.entries(counts)) {
      totals[k] ??= {}
      for (const [why, n] of Object.entries(v)) totals[k][why] = (totals[k][why] ?? 0) + n
    }
    totals.events = (totals.events ?? 0) + events.length
    if (process.env.WORK_PROPERTY_REPORT) console.log(JSON.stringify(totals))
    expect(violations).toEqual([])
  }, 600000)
}
