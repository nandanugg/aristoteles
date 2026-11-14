// The commands init, config, role.
import { join } from 'node:path'
import { Effect, Schema } from 'effect'
import { staticFit, wordsFit } from '../../../core/actions/config.ts'
import { roleWordsDraftAt } from '../../../core/derived/index.ts'
import {
  type Author,
  type EventRef,
  Refused,
  refuse,
  RoleName,
  type RoleFile,
} from '../../../core/schema/index.ts'
import {
  CONFIG,
  configOfText,
  DRAFT,
  Dir,
  Files,
  GitUser,
  mergeDraft,
  Now,
  readConfig,
  refusing,
  roleHash,
} from '../../../core/services/index.ts'
import { renderRoleWords } from '../../words/index.ts'
import { textOf, wordsOf } from '../args.ts'
import { agentCallerOf, callerOf, authorOf, isPerson, personAuthor } from '../caller.ts'
import type { Call, Command, Commands } from '../command.ts'
import { GUIDES } from '../lookups.ts'
import { act, peekWork, readWork } from '../runtime.ts'

const roleIn = (roles: Readonly<Record<string, RoleFile>>, name: string): RoleFile | undefined =>
  Object.hasOwn(roles, name) ? roles[name] : undefined

const init: Command = () =>
  Effect.gen(function* () {
    const by = yield* personAuthor(undefined)
    const done = yield* act(by, { _tag: 'DefineWorkflow', target: {}, content: {} })
    const { config } = done.work
    const roles = Object.keys(config.roles)
    const withModel = roles.filter((r) => config.roles[r]?.kind !== 'program')
    return [
      `store made for ${config.project} in aristoteles: ${roles.length} roles, and no direction yet.`,
      `next: work role fit <role> for each role (${withModel.join(', ')}); ` +
        'a model drafts each direction (work direction new --file=<direction.yaml> --by=<model>), and you accept it; ' +
        'then work task open --file=<task.yaml>',
    ]
  })

// work config check (Nanda, 2026-11-13): what Accept the roles on the page would store, read the
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
    Effect.flatMap((text) => configOfText(cwd, text)),
    Effect.mapError((e) => new Refused({ message: `${name}: ${e.message}`, next: e.next })),
  )
  const problems: Array<string> = []
  const user = yield* (yield* GitUser).name
  if (!config.people.includes(user)) problems.push(`${user} (git user.name) is not in the people`)
  const agents = Object.entries(config.roles).filter(([, r]) => r.kind !== 'program')
  for (const [role, r] of agents) {
    // The static fit of a role with no work behind it: its own words only.
    problems.push(...wordsFit(r).map((p) => `${role}: ${p}`))
  }
  if (problems.length) {
    return yield* refuse(
      `${name}: ${problems.join('; ')}`,
      `change ${name}, then run work config check again`,
    )
  }
  const merged = draft === null ? '' : `, merged into ${CONFIG} as Accept the roles does`
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

// The file of new words of a role (ruling 2026-11-14).
const WORDS_TEMPLATE = `write a file like this (any of the keys), then run the draft again:
  description: <what the role does, in one line>
  intro: <the first words of its brief>
  responsibilities:
    - <one exact output or command>
  output: <the output form of a maker>`

// work role draft (ruling 2026-11-14): a high role (its token) or a model run outside any task
// (--by) drafts new words of a role. The draft waits in the store for the person, so
// aristoteles.yaml stays as stored and no write stops.
const draftRole = (call: Call, key: string) =>
  Effect.gen(function* () {
    const { args, token } = call
    const runName = textOf(args.one('by'))
    if (token === null && (yield* isPerson)) {
      return yield* refuse(
        `the person writes the words of ${key} in ${CONFIG}, then runs work config apply`,
        `change the words of ${key} in ${CONFIG}; work config apply stores them`,
      )
    }
    const file = textOf(args.one('file'))
    if (!file) {
      return yield* refuse('a draft of role words needs --file=<words.yaml>', WORDS_TEMPLATE)
    }
    if (token !== null && runName !== undefined) {
      return yield* refuse(
        '--by names a model run outside any task; an assignment is named by its token',
      )
    }
    if (token === null && !/^[a-z][a-z0-9-]*$/.test(runName ?? '')) {
      return yield* refuse(
        'a model run outside any task names itself: --by=<its name in lower case>',
        `run it again with --by, for example: work role draft ${key} --file=${file} --by=host`,
      )
    }
    const { work } = yield* peekWork
    const by: Author =
      token !== null
        ? authorOf(yield* agentCallerOf(work, token))
        : { _tag: 'ModelRun', name: String(runName), at: yield* (yield* Now).read }
    const done = yield* act(by, {
      _tag: 'DraftRoleWords',
      target: { role: RoleName.make(key) },
      content: { file },
    })
    if (done.seq === null) return yield* Effect.die('a draft of role words stored no event')
    const draft = `e${done.seq}`
    const owner = work.workflow.owner.name
    const fitter = token !== null ? '--as=<your token>' : `--by=${runName}`
    return [
      `${draft}: new words of ${key}; they wait for the accept of ${owner}.`,
      `next: ${owner} accepts or rejects them on the page, or with work role accept|reject ` +
        `${draft}; after an accept, record the fit of the new words: ` +
        `work role fit ${key} --answers=<file> ${fitter}`,
    ]
  })

// work role accept|reject <draft> (ruling 2026-11-14): the person decides new words of a role.
// The accept writes them into aristoteles.yaml, so the person reads them and types the word.
const decideRole = (call: Call, word: string, ref: string) =>
  Effect.gen(function* () {
    const { work, d } = yield* peekWork
    const draft = roleWordsDraftAt(work, ref as EventRef)
    if (draft === undefined) {
      return yield* refuse(`${ref} is no draft of the words of a role`, 'work waiting lists them')
    }
    if (word === 'reject') {
      yield* act(yield* personAuthor(work), {
        _tag: 'RejectRoleWords',
        target: { draft: draft.ref },
        content: { reason: wordsOf(call.args.one('reason')) },
      })
      return [`${draft.ref} is rejected; work waiting shows the reason to its drafter.`]
    }
    const show = (renderRoleWords(d, draft.ref) ?? []).join('\n')
    const by = yield* personAuthor(work, { word: 'accept', show })
    yield* act(by, { _tag: 'AcceptRoleWords', target: { draft: draft.ref }, content: {} })
    return [
      `${draft.ref} is accepted: the new words of ${draft.role} are in ${CONFIG}; ` +
        `${draft.role} needs a new work role fit.`,
    ]
  })

const role: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const [sub, roleName] = args.positional
    if (sub === 'draft') return yield* draftRole(call, String(roleName))
    if (sub === 'accept' || sub === 'reject') return yield* decideRole(call, sub, String(roleName))
    const { cwd } = yield* Dir
    const { work, d } = yield* readWork
    if (sub === 'list') {
      // The name column fits the longest name; it is never narrower than the old 14 columns.
      const roles = Object.entries(work.config.roles)
      const width = Math.max(12, ...roles.map(([n]) => n.length)) + 2
      return roles.map(([n, r]) => {
        const tier = r.kind === 'program' ? 'program' : (r.tier ?? '')
        const unfit = r.kind !== 'program' && work.fits.get(RoleName.make(n))?.hash !== roleHash(r)
        const fit = unfit ? '  (no fit record)' : ''
        return `${n.padEnd(width)}${tier.padEnd(8)}${r.description}${fit}`
      })
    }
    const key = String(roleName)
    if (sub === 'show') {
      // A draft of new words, by its event (ruling 2026-11-14).
      const draft = /^e\d+$/.test(key) ? renderRoleWords(d, key as EventRef) : undefined
      if (draft !== undefined) return draft
      const stored = roleIn(work.config.roles, key)
      if (!stored) return yield* refuse(`there is no role "${key}"`)
      return [JSON.stringify(stored, null, 2)]
    }
    if (sub !== 'fit') return yield* refuse('use work role list|show|fit|draft|accept|reject')
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
    // Who records it: the person, a high role (--as=<its token>), or a model run outside any
    // task (--by=<its name>), such as the host that drafted the roles (Nanda, 2026-11-13).
    const token = textOf(args.one('as')) ?? null
    const runName = textOf(args.one('by'))
    let by: Author
    if (runName !== undefined && token !== null) {
      return yield* refuse(
        '--by names a model run outside any task; a high role passes only --as=<its token>',
      )
    }
    if (runName !== undefined && (yield* isPerson)) {
      // N6: the person's own --by is ignored; the person records the fit.
      by = yield* personAuthor(work)
    } else if (runName !== undefined) {
      if (!/^[a-z][a-z0-9-]*$/.test(runName)) {
        return yield* refuse('a model run outside any task names itself: --by=<its name in lower case>')
      }
      by = { _tag: 'ModelRun', name: runName, at: yield* (yield* Now).read }
    } else {
      by = authorOf(yield* callerOf(work, token))
    }
    yield* act(by, {
      _tag: 'FitRole',
      target: { role: RoleName.make(key) },
      content: { answers: file },
    })
    // The words name a model run only; the person's ignored --by (N6) names nobody.
    return [`${key} fits; recorded${by._tag === 'ModelRun' ? ` by ${by.name}` : ''}.`]
  })

export const commands: Commands = { init, config, role }
