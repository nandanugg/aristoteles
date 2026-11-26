// The commands init, config, role, skill.
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { staticFit } from '../../../core/actions/config.ts'
import {
  type Author,
  create,
  NonBlank,
  PositiveInt,
  OutsideFailed,
  Refused,
  refuse,
  RoleName,
  type RoleFile,
} from '../../../core/schema/index.ts'
import {
  ASSESS,
  CONFIG,
  readConfigText,
  DRAFT,
  Dir,
  Files,
  mergeDraft,
  Now,
  onboardingExists,
  readConfig,
  refusing,
  roleHash,
  Store,
} from '../../../core/services/index.ts'
import { configProblems } from '../../live/config-problems.ts'
import { installSkill, SKILL_FILE } from '../../live/skill-install.ts'
import { textOf } from '../args.ts'
import { isPerson, personAuthor } from '../caller.ts'
import type { Command, Commands } from '../command.ts'
import { GUIDES } from '../lookups.ts'
import { act, peekWork, readWork } from '../runtime.ts'

const roleIn = (roles: Readonly<Record<string, RoleFile>>, name: string): RoleFile | undefined =>
  Object.hasOwn(roles, name) ? roles[name] : undefined

// One dir has one way to start: while onboarding files are here, the store starts from them.
const init: Command = () =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    if (yield* onboardingExists(cwd)) {
      return yield* refuse(
        `onboarding files are in this dir (${ASSESS}/ or ${DRAFT})`,
        'accept the journal onboarding proposals before activating',
      )
    }
    const by = yield* personAuthor(undefined)
    const done = yield* act(by, { _tag: 'DefineWorkflow', target: {}, content: { directions: [] } })
    const { config } = done.work
    const roles = Object.keys(config.roles)
    const withModel = roles.filter((r) => config.roles[r]?.kind !== 'program')
    return [
      `store made for ${config.project} in aristoteles: ${roles.length} roles, and no direction yet.`,
      `next: work role fit <role> for each role (${withModel.join(', ')}); ` +
        'a model drafts each direction (work direction new --file=<direction.yaml> --by=<model>), and you accept it; ' +
        'then the person opens a top: work top open --name= --goal= --sections=a,b',
    ]
  })

// work config check (Nanda, 2026-11-13): what the store start of onboarding would write, read the
// same way (the draft merged into aristoteles.yaml, the git user in the people), and the checks
// of the words of each agent role. Anyone may run it, the host too: it writes nothing.
const checkConfig = Effect.gen(function* () {
  const { cwd } = yield* Dir
  const files = yield* Files
  const file = yield* files.read(join(cwd, CONFIG))
  const draft = yield* files.read(join(cwd, DRAFT))
  if (draft === null && file === null) return yield* refuse(`no ${DRAFT} and no ${CONFIG} in ${cwd}`)
  const name = draft === null ? CONFIG : DRAFT
  const { config } = yield* refusing(() =>
    draft === null ? (file ?? '') : mergeDraft(file ?? '', draft),
  ).pipe(
    Effect.flatMap((text) => readConfigText(cwd, text)),
    Effect.mapError((e) => new Refused({ message: `${name}: ${e.message}`, next: e.next })),
  )
  const problems = yield* configProblems(config)
  const agents = Object.entries(config.roles).filter(([, r]) => r.kind !== 'program')
  if (problems.length) {
    return yield* refuse(
      `${name}: ${problems.join('; ')}`,
      `change ${name}, then run work config check again`,
    )
  }
  const merged =
    draft === null
      ? ''
      : `, merged into ${CONFIG} for the config check`
  return [
    `${name} reads${merged}; nothing was written.`,
    `the static fit checks pass for ${agents.map(([role]) => role).join(', ')}.`,
  ]
})


const config: Command = (call) =>
  Effect.gen(function* () {
    const sub = call.args.positional[0]
    if (sub === 'check') return yield* checkConfig
    if (sub === 'restore') {
      const { work } = yield* peekWork
      const files = Object.keys(work.texts)
      const by = yield* personAuthor(work, {
        word: 'restore',
        show: `restore ${files.join(', ')} to the stored text`,
      })
      yield* act(by, { _tag: 'RestoreConfig', target: {}, content: {} })
      return [`restored ${files.join(', ')}.`]
    }
    if (sub !== 'apply') return yield* refuse('use work config check|apply|restore')
    const by = yield* personAuthor(undefined, { word: 'apply' })
    const done = yield* act(by, { _tag: 'ApplyConfig', target: {}, content: {} })
    const stored = done.work.events.at(-1)?.recorded.event
    const changed =
      stored?._tag === 'Workflow' && 'move' in stored && stored.move._tag === 'RoleWordsChanged'
        ? Object.keys(stored.move.roles)
        : []
    return [
      `applied: ${changed.length ? changed.join(', ') : 'no role words changed'}; each changed role needs a new work role fit.`,
    ]
  })

const Fitness = Schema.Struct({
  questions: Schema.Array(
    Schema.Struct({ id: Schema.Number, short: Schema.String, ask: Schema.String }),
  ),
})

const role: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const [sub, roleName] = args.positional
    const { cwd } = yield* Dir
    const { work } = yield* readWork
    if (sub === 'list') {
      // The name column fits the longest name; it is never narrower than the old 14 columns.
      const roles = Object.entries(work.config.roles)
      const width = Math.max(12, ...roles.map(([n]) => n.length)) + 2
      const modelOf = (r: (typeof roles)[number][1]) => (r.kind === 'program' ? 'program' : r.model)
      const column = Math.max(8, ...roles.map(([, r]) => modelOf(r).length + 1))
      return roles.map(([n, r]) => {
        const unfit = r.kind !== 'program' && work.fits.get(RoleName.make(n))?.hash !== roleHash(r)
        const fit = unfit ? '  (no fit record)' : ''
        return `${n.padEnd(width)}${modelOf(r).padEnd(column)}${r.description}${fit}`
      })
    }
    const key = String(roleName)
    if (sub === 'show') {
      const stored = roleIn(work.config.roles, key)
      if (!stored) return yield* refuse(`there is no role "${key}"`)
      return [JSON.stringify(stored, null, 2)]
    }
    if (sub !== 'fit') return yield* refuse('use work role list|show|fit')
    const file = textOf(args.one('answers'))
    if (!file) {
      // Fitness reads the role from aristoteles.yaml, so new words are fitted before config apply.
      const fromFile = roleIn((yield* readConfig(cwd)).config.roles, key)
      const wanted = fromFile ?? roleIn(work.config.roles, key)
      if (!wanted) return yield* refuse(`there is no role "${key}"`)
      if (wanted.kind === 'program') return yield* refuse(`${key} is a program; it needs no fit record`)
      const problems = staticFit(work, key, wanted)
      const files = yield* Files
      const fitness = Schema.decodeUnknownSync(Fitness)(
        Bun.YAML.parse((yield* files.read(join(GUIDES, 'fitness.yaml'))) ?? ''),
      )
      return [
        `static checks of ${key}: ${problems.length ? '' : 'pass'}`,
        ...problems.map((p) => `  - ${p}`),
        '',
        'Answer each question with yes or no, and why, in a file:',
        ...fitness.questions.map((q) => `  ${q.id}. ${q.ask}`),
        '',
        `  - { id: 1, yes: true, why: "<one real example of the role's work>" }`,
        `then: work role fit ${key} --answers=<file>`,
      ]
    }
    // Who records it: the person, or a model run outside any task (--by=<its name>), such as the
    // host that drafted the roles (Nanda, 2026-11-13).
    const runName = textOf(args.one('by'))
    let by: Author
    if (runName !== undefined && (yield* isPerson)) {
      // N6: the person's own --by is ignored; the person records the fit.
      by = yield* personAuthor(work)
    } else if (runName !== undefined) {
      if (!/^[a-z][a-z0-9-]*$/.test(runName)) {
        return yield* refuse('a model run outside any task names itself: --by=<its name in lower case>')
      }
      by = { _tag: 'ModelRun', name: runName, at: yield* (yield* Now).read }
    } else {
      by = yield* personAuthor(work)
    }
    yield* act(by, {
      _tag: 'FitRole',
      target: { role: RoleName.make(key) },
      content: { answers: file },
    })
    // The words name a model run only; the person's ignored --by (N6) names nobody.
    return [`${key} fits; recorded${by._tag === 'ModelRun' ? ` by ${by.name}` : ''}.`]
  })

// work skill install (ruling 12): the /aristoteles skill in this dir, as two local links that git
// excludes. It needs no aristoteles.yaml and no store, so it is the first act in a new dir.
const skill: Command = (call) =>
  Effect.gen(function* () {
    if (call.args.positional[0] !== 'install') return yield* refuse('use work skill install', 'work help lists the commands')
    const { cwd } = yield* Dir
    const lines = yield* Effect.try({
      try: () => installSkill(cwd),
      catch: (e) => new OutsideFailed({ system: 'files', message: String(e), next: null }),
    })
    return [
      ...lines,
      `next: read ${SKILL_FILE} and do what it says; a session started with /aristoteles reads it too`,
    ]
  })

const usage: Command = (call) => Effect.gen(function* () {
  const model = textOf(call.args.one('model'))?.trim()
  const tokens = Number(textOf(call.args.one('tokens')))
  if (!model || !Number.isSafeInteger(tokens) || tokens < 1) {
    return yield* refuse('Use work usage --model=<model> --tokens=<measured-total> for a finished single-model project.')
  }
  const { dir, work } = yield* peekWork
  const author = yield* personAuthor(work)
  const store = yield* (yield* Store).open(dir, { create: false })
  const at = yield* (yield* Now).read
  yield* store.write((events) => {
    const finished = events.some(({ event }) => event._tag === 'Work' && event.create._tag === 'Acted' &&
      event.create.act.body._tag === 'EndProject')
    if (!finished) return Effect.fail(refuse('Finish this project before recording its measured usage.'))
    const prior = events.findLast(({ event }) => event._tag === 'Runtime' && event.create._tag === 'ProjectUsageMeasured')?.event
    if (prior?._tag === 'Runtime' && prior.create._tag === 'ProjectUsageMeasured' &&
      prior.create.model === model && prior.create.tokens === tokens) return Effect.succeed(null)
    return Effect.succeed({ draft: { author, at, event: create('Runtime', {
      _tag: 'ProjectUsageMeasured', model: NonBlank.make(model), tokens: PositiveInt.make(tokens),
    }) }, rows: [] })
  })
  return [`Measured usage for the finished project: ${tokens} tokens on ${model}.`]
})

export const commands: Commands = { init, config, role, skill, usage }
