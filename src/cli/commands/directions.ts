// The commands direction, suggest, grant, revoke, forward, confirm. A typed event cannot hold a
// raw value that is wrong (a bad answers id, a revise file with no standard id, an accept with
// no evidence), so each command refuses it first, with the words of the lookup or the engine.
import { Effect } from 'effect'
import { human, whoOf } from '../../domain/actor.ts'
import { fail, list, type Raw, refusing, parseYaml } from '../../config/core.ts'
import { fileHashes, readApprovedBy, readDirection } from '../../config/config.ts'
import { type Refused, refuse } from '../../domain/errors.ts'
import {
  create,
  type EvidenceData,
  type ForwardedAct,
  move,
  type PointData,
} from '../../domain/events.ts'
import type { ReviseFile, StandardFile } from '../../domain/files.ts'
import {
  DirectionId,
  type AnswerId,
  EventRef,
  isNonBlank,
  isTime,
  NonBlank,
  PermissionId,
  type RejectId,
  RoleName,
  Time,
  type TaskId,
  type ResultId,
  type RevisionId,
  type VersionId,
} from '../../domain/ids.ts'
import { oneOf, REASONS } from '../../domain/closed.ts'
import { currentVersion, officialDirections, targetOf, versionIdOf } from '../../domain/derived.ts'
import { type Found, lookup } from '../../domain/lookup.ts'
import type { Direction, Version, Why } from '../../domain/model.ts'
import type { Work } from '../../domain/work.ts'
import type { Act } from '../../engine/acts.ts'
import { checkAct } from '../../engine/acts.ts'
import { current, directionsOf, madeBy, resultsOf, within } from '../../engine/queries.ts'
import { blockerItems, taskAccepted } from '../../engine/status.ts'
import { Dir, Now } from '../../services/io.ts'
import { Files, Spawn } from '../../services/outside.ts'
import { changedSince } from '../../files/digest.ts'
import {
  draftWaitsText,
  describeInner,
  pieceNames,
  renderDirection,
  renderDraft,
  whyLines,
  renderPiece,
} from '../../words/show.ts'
import { type Args, textOf } from '../args.ts'
import { agentCallerOf, agentOf, type Caller, callerOf, needClaim, isPerson, tierOf } from '../caller.ts'
import type { Call, Command, Commands } from '../command.ts'
import { lookupKind } from '../lookups.ts'
import { followCommit } from '../refresh.ts'
import { actOf, checkContext, personAuthor, readArgFile, readWork, writeAct } from '../run.ts'

// --- the checks and readers that several commands share ---------------------------------------

// The files of the dir are the stored ones: a changed file is refused before an act is built.
// Exported for the other command files; run.ts has no such check yet.
export const checkHashes = (work: Work, token: string | null) =>
  Effect.gen(function* () {
    const { cwd } = yield* Dir
    const hashes = yield* fileHashes(cwd)
    const was = work.hashes
    const changed = Object.keys({ ...hashes, ...was })
      .filter((f) => hashes[f] !== was[f])
      .map((f) => (was[f] === undefined ? `${f} (new, not in the store: delete it)` : f))
    if (!changed.length) return
    // A token that does not verify is not a low agent; the command refuses it later.
    const low =
      token !== null &&
      (yield* agentOf(work, token).pipe(
        Effect.map((a) => tierOf(work, a) === 'low'),
        Effect.catch(() => Effect.succeed(false)),
      ))
    // A restore writes back the stored files; it does not remove a file that the store never had.
    const fresh = Object.keys(hashes).filter((f) => was[f] === undefined)
    const fix = [
      ...(fresh.length ? [`the person deletes ${fresh.join(', ')}`] : []),
      ...(fresh.length < changed.length
        ? [
            'the person runs work config restore (back to the stored files), or work config apply (role words only)',
          ]
        : []),
    ]
    const lowFix = [
      ...(fresh.length ? [`the person deletes ${fresh.join(', ')}`] : []),
      ...(fresh.length < changed.length ? ['the person restores it'] : []),
    ]
    return yield* refuse(
      `${changed.join(', ')} changed since the stored config`,
      low
        ? `work escalate ${token} --reason="${changed.join(', ')} changed; ${lowFix.join('; ')}", then STOP`
        : fix.join('; '),
    )
  })

// The yaml of a --file flag; a text that does not parse is a refusal with the parser's words.
const readYaml = (text: string): Effect.Effect<Raw, Refused> => refusing(() => parseYaml(text))

// One evidence line: <rule id> | <where> | <what>, or <where> | <what> for what no rule names.
export const evidenceOf = (
  values: ReadonlyArray<string | true>,
): Effect.Effect<ReadonlyArray<EvidenceData>, Refused> =>
  Effect.gen(function* () {
    const out: Array<EvidenceData> = []
    for (const value of values) {
      const v = String(value)
      const parts = v.split('|').map((p) => p.trim())
      if (![2, 3].includes(parts.length) || parts.some((p) => !p)) {
        return yield* refuse(
          `--evidence="${v}" needs <rule id> | <where you looked> | <what you saw>, or, with no rule, <where you looked> | <what you saw>`,
        )
      }
      const [rule, where = '', what = ''] = parts.length === 3 ? parts : ['', ...parts]
      out.push({ rule: rule || null, where, what })
    }
    return out
  })

// A --breaks belongs to the --point before it.
export interface GivenPoint {
  readonly text: string
  readonly breaks: string | null
}
export const pointsOf = (
  flags: ReadonlyArray<readonly [string, string | true]>,
): Effect.Effect<ReadonlyArray<GivenPoint>, Refused> =>
  Effect.gen(function* () {
    const points: Array<GivenPoint> = []
    for (const [key, value] of flags) {
      if (key === 'point') points.push({ text: String(value), breaks: null })
      if (key === 'breaks') {
        const last = points.at(-1)
        if (!last) return yield* refuse('--breaks belongs to the --point before it; put the --point first')
        points[points.length - 1] = { ...last, breaks: String(value) }
      }
    }
    return points
  })

// The ids of --answers: each is a Reject point (v4.1), a Reject (v4: all its points), or a
// suggestion (s2). The words of a wrong id are lookup's.
// A review that is no Reject passes as its id: the engine's check refuses it with the old words.
const answersOf = (work: Work, text: string | undefined) =>
  Effect.gen(function* () {
    const out: Array<AnswerId> = []
    for (const id of text ? text.split(',') : []) {
      const found = yield* lookup(work, id, ['v', 's'])
      out.push(
        found._tag === 'Suggestion'
          ? found.suggestion.id
          : found._tag === 'Point'
            ? found.id
            : (id as RejectId),
      )
    }
    return out
  })

// The task that a Reject point is about; a suggestion and a draft's Reject are in no task.
const taskOfAnswer = (work: Work, found: Found): TaskId | undefined => {
  const review =
    found._tag === 'Point' ? found.reject : found._tag === 'Review' ? found.review : undefined
  const target = review ? targetOf(review) : undefined
  if (target === undefined) return undefined
  if (/^t\d+$/.test(target)) return target as TaskId
  if (/^r\d+$/.test(target)) return work.results.get(target as ResultId)?.task
  return undefined
}

// --- direction --------------------------------------------------------------------------------

// The file of a new direction: the whole direction. Each says is any markdown; headers inside it
// only divide it, so that a role can read one piece (guides/writing.md).
const DIRECTION_TEMPLATE = `write a file like this, then run the command again:
  id: <direction id>
  name: <a short name>
  owner: <a person of aristoteles.yaml; the owner accepts the first version>
  from: [<the principles that ground it: Logos, Pathos, Ethos, Mythos, Oikos, Nomos, Telos, Kairos, Mnēmē, Topoi, Aporia>]
  says: |
    <what the direction asks for, in any markdown>
  approvedBy: <optional; who accepts the next versions: roles, and the owner>
  standards:
    - id: <standard id>
      says: |
        <how the output looks, in any markdown>
      rules:
        - { id: <rule id>, says: <one check>, checkedBy: <role> }`

const REVISE_TEMPLATE =
  'write a file like this (any of the keys), then run the revise again:\n' +
  '  add:\n    - { id: <new standard id>, says: <the standard>, rules: [ { id: <new rule id>, says: <the rule>, checkedBy: <role> } ] }\n' +
  '  replace:\n    - { id: <standard id>, with: { id: <standard id>, says: <...>, rules: [ ... ] } }\n' +
  '  remove: [<standard id>]\n  says: <a new spirit needs the accept of the owner>'

// A revise file as the typed event holds it: each rule has its supersedes, a missing key is absent.
export const readRevise = (file: string, raw: unknown): Effect.Effect<ReviseFile, Refused> =>
  refusing(() => {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Raw
    const standardOf = (s: Raw, where: string): StandardFile => {
      if (typeof s?.id !== 'string' || typeof s?.says !== 'string') {
        fail(file, `${where} needs an id and says`)
      }
      const rules = list(s.rules).map((r, j) => {
        if (typeof r?.id !== 'string' || typeof r?.says !== 'string') {
          fail(file, `rule ${j + 1} of ${s.id} needs an id and says`)
        }
        return {
          id: r.id as string,
          says: r.says as string,
          ...(r.checkedBy !== undefined ? { checkedBy: RoleName.make(r.checkedBy) } : {}),
          supersedes: list(r.supersedes).map(String),
        }
      })
      return {
        id: s.id,
        says: s.says,
        ...(s.where !== undefined ? { where: s.where } : {}),
        rules,
      }
    }
    if (e.says !== undefined && typeof e.says !== 'string') fail(file, 'says is words')
    return {
      ...(e.says !== undefined ? { says: e.says as string } : {}),
      ...(e.add !== undefined
        ? { add: list(e.add).map((s, i) => standardOf(s, `standard ${i + 1}`)) }
        : {}),
      ...(e.remove !== undefined ? { remove: list(e.remove).map(String) } : {}),
      ...(e.replace !== undefined
        ? {
            replace: list(e.replace).map((r, i) => {
              if (typeof r?.id !== 'string') fail(file, `replace ${i + 1} needs an id`)
              return { id: r.id as string, with: standardOf(r.with, `the standard of replace ${i + 1}`) }
            }),
          }
        : {}),
    }
  })

// <id>[@<n>] or <draft>, then [#<standard, rule, or header>[#<header>]]: one piece, so a role
// reads only it.
const showDirection = (rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { work } = yield* readWork
    const [address = '', ...keys] = String(rest[0]).split('#')
    let v: VersionId | RevisionId
    if (/^d\d+$/.test(address)) {
      const { revision } = yield* lookupKind('Revision', ['d'], work, address)
      if (!keys.length) return [renderDraft(work, revision.id), ...whyLines(revision.why)]
      v = revision.id
    } else {
      const [id = '', number] = address.split('@')
      const directionId = DirectionId.make(id)
      const d = work.directions.get(directionId)
      if (d?._tag === 'NewDirection') {
        const last = [...work.drafts.values()].filter((x) => x.of === d.id).at(-1)
        return yield* refuse(
          `${id} has no version yet`,
          `work direction show ${last?.id} shows its draft`,
        )
      }
      if (!d) {
        return yield* refuse(`there is no direction "${id}"`, 'work status lists the directions')
      }
      const numbered = number ? d.versions[Number(number) - 1] : undefined
      if (number && !numbered) return yield* refuse(`${id} has no version ${number}`)
      const version = numbered ?? current(work, directionId)
      if (!keys.length) return [renderDirection(work, versionIdOf(version))]
      v = versionIdOf(version)
    }
    const piece = renderPiece(work, v, keys)
    if (!piece) {
      return yield* refuse(
        `${rest[0]} names no piece; after # comes one of: ${pieceNames(work, v).join(', ')}`,
      )
    }
    return [piece]
  })

// A new direction (Nanda, 2026-11-10): a model writes the whole of it, and its owner accepts it.
// The model is a high role (by its token), or a model run outside any task (--by=<its name>),
// such as the skill that reads an app. A person gives direction in words: work suggest.
const newDirection = (call: Call) =>
  Effect.gen(function* () {
    const { args, token } = call
    const runName = textOf(args.one('by'))
    if (token === null && (yield* isPerson)) {
      return yield* refuse(
        'the person gives direction in words: work suggest --says="<the direction that is missing>"; a model drafts it, and you accept or reject it',
      )
    }
    const file = textOf(args.one('file'))
    if (!file) return yield* refuse('a new direction needs --file=<direction.yaml>', DIRECTION_TEMPLATE)
    if (token !== null && runName !== undefined) {
      return yield* refuse('--by names a model run outside any task; an assignment is named by its token')
    }
    if (token === null && !/^[a-z][a-z0-9-]*$/.test(String(runName ?? ''))) {
      return yield* refuse(
        'a model run outside any task names itself: --by=<its name in lower case>',
        `run it again with --by, for example: work direction new --file=${file} --by=assess`,
      )
    }
    const raw = yield* readYaml(yield* readArgFile(file))
    // A run outside any task has no token; its id is the time of its act.
    const run =
      token === null ? { name: String(runName), id: yield* (yield* Now).read } : undefined
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        yield* checkHashes(work, token)
        let caller: Caller | undefined
        if (token !== null) {
          caller = yield* agentCallerOf(work, token)
          const tier = tierOf(work, caller.assignment)
          if (tier !== 'high') {
            return yield* refuse(
              `a ${tier} role does not draft directions; suggest it: work suggest ${token} --says="..."`,
            )
          }
        }
        const base = yield* readDirection(file, raw, work.config.people)
        const approvedBy = yield* readApprovedBy(file, raw, work.config.roles, work.config.people)
        const why = yield* whyOf(args)
        const drafted = {
          _tag: 'Drafted' as const,
          direction: approvedBy === undefined ? base : { ...base, approvedBy },
          answers: yield* answersOf(work, textOf(args.one('answers'))),
          why,
        }
        const event = create('Revision', drafted)
        // A model run outside any task is the author of its draft: its name and its time.
        return caller
          ? actOf(caller, event)
          : {
              author: { _tag: 'ModelRun' as const, name: String(run?.name), at: run?.id as Time },
              event,
            }
      }),
    )
    const did = String(done.created[0])
    const { revision: draft } = yield* lookupKind('Revision', ['d'], done.work, did)
    const direction = done.work.directions.get(draft.of)
    const answering = draft.answers.length ? `, answering ${draft.answers.join(', ')}` : ''
    const writer = run ? `, by ${run.name} (a model run outside any task)` : ''
    return [
      `${did} drafted: the new direction ${draft.of} (${direction?.name})${writer}${answering}; it waits for the accept of ${draftWaitsText(done.work, draft.id)}.`,
      `next: work direction show ${did}; ${direction?.owner.name} runs work review ${did} accept [--reason="<a comment>"], or reject --reason="<why>"`,
    ]
  })

const reviseDirection = (call: Call, rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { args, token } = call
    // A model writes each draft: the person gives direction in words, then accepts or rejects.
    if (token === null) {
      return yield* refuse(
        'the person gives direction in words: work suggest <direction, standard, or rule> --says="<the change>"; ' +
          'a high role writes the draft, and you accept or reject it',
      )
    }
    const directionId = DirectionId.make(String(rest[0]))
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        yield* checkHashes(work, token)
        const caller = yield* agentCallerOf(work, token)
        const tier = tierOf(work, caller.assignment)
        if (tier !== 'high') {
          return yield* refuse(
            `a ${tier} role does not revise directions; escalate it, or suggest it: work suggest ${token} <direction, standard, or rule> --says="..."`,
          )
        }
        const file = textOf(args.one('file'))
        if (!file) return yield* refuse('a revise needs --file=<edit.yaml>', REVISE_TEMPLATE)
        const edit = yield* readRevise(file, yield* readYaml(yield* readArgFile(file)))
        const answers = yield* answersOf(work, textOf(args.one('answers')))
        for (const id of answers) {
          const task = taskOfAnswer(work, yield* lookup(work, id, ['v', 's']))
          if (task && !within(work, task, caller.assignment.task)) {
            return yield* refuse(`${id} is outside the task tree of ${caller.assignment.id}`)
          }
        }
        const why = yield* whyOf(args)
        const revised = { _tag: 'Revised' as const, direction: directionId, edit, answers, why }
        return actOf(caller, create('Revision', revised))
      }),
    )
    const did = String(done.created[0])
    const { revision: draft } = yield* lookupKind('Revision', ['d'], done.work, did)
    const direction = done.work.directions.get(draft.of)
    const answering = draft.answers.length ? `, answering ${draft.answers.join(', ')}` : ''
    if (draft._tag !== 'Change') return yield* Effect.die(`the revise ${did} changes no version`)
    return [
      `${did} drafted, built on ${draft.base}${answering}; it waits for the accept of ${draftWaitsText(done.work, draft.id)}.`,
      `next: work direction show ${did}; a decider outside the tree of its reviser runs work review [<token>] ${did} accept ` +
        `--evidence="<where you read in ${did}> | <what you saw there>" (work waiting --for=${direction?.owner.name} shows it to the owner)`,
    ]
  })

const direction: Command = (call) =>
  Effect.gen(function* () {
    const [sub, ...rest] = call.args.positional
    if (sub === 'show') return yield* showDirection(rest)
    if (sub === 'new') return yield* newDirection(call)
    if (sub !== 'revise') {
      return yield* refuse(
        'use work direction show|new|revise; a draft is accepted or rejected with work review <draft> accept|reject',
      )
    }
    return yield* reviseDirection(call, call.token === null ? rest : rest.slice(1))
  })

// --- suggest, grant, revoke -------------------------------------------------------------------

// Why a draft changes its direction (the owner's rulings, 2026-11-12, new code): --why gives one
// of the five reasons (another word is refused, with the list), and --why-words its words.
const whyOf = (args: Args): Effect.Effect<Why, Refused> => {
  const why = textOf(args.one('why'))
  const words = textOf(args.one('why-words'))
  const reasons = REASONS.join(', ')
  const again = `run the command again with --why="<one of: ${reasons}>"`
  if (why === undefined) {
    return words === undefined
      ? Effect.succeed({ _tag: 'NoneGiven' })
      : refuse(`--why-words gives the words of a reason; add --why=<one of: ${reasons}>`, again)
  }
  const reason = oneOf(REASONS, why)
  if (reason === undefined) {
    return refuse(`--why="${why}" is not a reason of a draft; it is one of: ${reasons}`, again)
  }
  if (words === undefined) return Effect.succeed({ _tag: 'Given', reason, words: null })
  return isNonBlank(words)
    ? Effect.succeed({ _tag: 'Given', reason, words })
    : refuse('--why-words has no words; give them, or leave the flag out')
}

const NEW_DIRECTION = { _tag: 'NewDirection' as const }
// What a suggestion is about, by its key: an official direction, else a standard of a current
// version, else a rule of one.
const aboutOf = (work: Work, key: string) =>
  Effect.gen(function* () {
    const official = officialDirections(work)
    if (official.some((d) => d.id === key)) {
      return { _tag: 'Direction' as const, direction: DirectionId.make(key) }
    }
    const standards = official.flatMap((d) =>
      currentVersion(d).standards.flatMap((e) => work.standards.get(e) ?? []),
    )
    if (standards.some((x) => x.id === key)) return { _tag: 'Standard' as const, key }
    const rules = standards.flatMap((x) => x.rules.flatMap((e) => work.rules.get(e) ?? []))
    if (rules.some((r) => r.id === key)) return { _tag: 'Rule' as const, key }
    return yield* refuse(`there is no rule "${key}" in an official version`)
  })

// The directions and the tasks that a change act covers: an official direction by its id,
// else a task (the old grant's lookup, with its words).
const changeTargets = (work: Work, on: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const out: Array<DirectionId | TaskId> = []
    for (const id of on) {
      if (officialDirections(work).some((d) => d.id === id)) out.push(id as DirectionId)
      else out.push((yield* lookupKind('Task', ['t'], work, id)).task.id)
    }
    return out
  })

// Feedback in words, from anyone: about a direction, a standard, or a rule (by id); with
// nothing to be about, it asks for a new direction. A challenge is a suggestion that says that
// something is wrong. A high role answers it with a draft.
const suggest: Command = (call) =>
  Effect.gen(function* () {
    const rest = call.token === null ? call.args.positional : call.args.positional.slice(1)
    const about = rest[0]
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* callerOf(work, call.token)
        const says = textOf(call.args.one('says'))
        if (!isNonBlank(says)) return yield* refuse('a suggestion says something: give its words')
        const suggestion = {
          _tag: 'Suggestion' as const,
          about: about ? yield* aboutOf(work, about) : NEW_DIRECTION,
          says,
        }
        return actOf(caller, { _tag: 'Suggestion', create: suggestion })
      }),
    )
    const sid = done.created[0]
    const draft = about
      ? `work direction revise <token> <direction> --file=<edit.yaml> --answers=${sid}`
      : `work direction new <token> --file=<direction.yaml> --answers=${sid}`
    return [
      `${sid}: a suggestion ${about ? `about ${about}` : 'for a new direction'}; it stays open until an official draft answers it.`,
      `next: a high role answers it with a draft: ${draft}`,
    ]
  })

const ACTS = ['approve', 'review', 'change'] as const

// A permission: one act for a time. The person gives it at a terminal; an agent gives it
// with its token. Nobody gives more than they may do.
const grant: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const act = textOf(args.one('act'))
    const on = String(args.one('on') ?? '')
      .split(',')
      .filter(Boolean)
    const until = textOf(args.one('until'))
    const given = ACTS.find((a) => a === act)
    if (!given) return yield* refuse('--act is approve, review, or change')
    if (!on.length) {
      return yield* refuse(
        '--on names what the act covers: roles for approve and review, tasks or directions for change',
      )
    }
    // A time is an ISO date, with its time of day and zone (a stored Time holds no other form).
    if (!Number.isFinite(Date.parse(String(until))) || !isTime(String(until))) {
      return yield* refuse(`--until=${until} is not a time (2026-10-27T18:00:00Z)`)
    }
    if (Date.parse(String(until)) <= Date.parse(yield* (yield* Now).read)) {
      return yield* refuse(`--until=${until} is in the past`)
    }
    const to = RoleName.make(String(args.one('to')))
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const confirm =
          call.token === null
            ? {
                word: 'grant',
                show: `grant: ${args.one('to')} may ${act} ${on.join(', ')} until ${until}`,
              }
            : undefined
        const caller = yield* callerOf(work, call.token, confirm)
        if (caller._tag === 'Agent') yield* needClaim(work, caller.assignment, caller.token)
        // The CLI word of the act, as the act of a permission.
        const permitted =
          given === 'change'
            ? { _tag: 'Change' as const, changesOf: yield* changeTargets(work, on) }
            : {
                _tag: given === 'approve' ? ('Approve' as const) : ('Review' as const),
                resultsOf: on.map((n) => RoleName.make(n)),
              }
        const last = Time.make(String(until))
        const granted = { _tag: 'Granted' as const, act: permitted, to, until: last }
        return actOf(caller, create('Permission', granted))
      }),
    )
    return [`${done.created[0]}: ${to} may ${act} ${on.join(', ')} until ${until}.`]
  })

// The giver ends a permission early; the acts before the revoke stay.
const revoke: Command = (call) =>
  Effect.gen(function* () {
    const rest = call.token === null ? call.args.positional : call.args.positional.slice(1)
    const x = String(rest[0])
    yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* callerOf(
          work,
          call.token,
          call.token === null ? { word: 'revoke' } : undefined,
        )
        if (caller._tag === 'Agent') yield* needClaim(work, caller.assignment, caller.token)
        const { permission } = yield* lookupKind('Permission', ['x'], work, x)
        const id = PermissionId.make(permission.id)
        return actOf(caller, move('Permission', id, { _tag: 'Revoked' }))
      }),
    )
    return [`${x} revoked; the acts before it stay.`]
  })

// --- forward and confirm -----------------------------------------------------------------------

const FORWARD_ACTS = ['reject', 'accept', 'resolve', 'ask', 'answer', 'comment'] as const
type ForwardWord = (typeof FORWARD_ACTS)[number]
// A reject, a question and a comment of the person count at once; the rest waits for confirm.
const FORWARD_AT_ONCE: ReadonlyArray<ForwardWord> = ['reject', 'ask', 'comment']
const FORWARD_KINDS: Readonly<Record<ForwardWord, ReadonlyArray<string>>> = {
  reject: ['r', 't', 'd'],
  accept: ['r', 't', 'd'],
  resolve: ['v'],
  ask: ['a'],
  answer: ['q'],
  comment: ['t'],
}

const forward: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const [tokenWord, who, actWord, target] = args.positional
    const quote = textOf(args.one('quote'))
    const channelWord = textOf(args.one('channel')) ?? 'chat'
    const forwarded = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const caller = yield* agentCallerOf(work, tokenWord ?? null)
        const a = caller.assignment
        if (a.parent._tag === 'Parent' || tierOf(work, a) === 'low') {
          return yield* refuse(
            'only the top agent (medium or high, with no parent) forwards the person',
            a.parent._tag === 'Parent' ? 'ask your parent' : null,
          )
        }
        if (!work.config.people.includes(String(who))) {
          return yield* refuse(`${who} is not in the people of aristoteles.yaml`)
        }
        if (!isNonBlank(quote)) {
          return yield* refuse('a forward needs --quote="<their exact words>"')
        }
        if (channelWord !== 'chat' && channelWord !== 'github') {
          return yield* refuse('--channel is chat or github')
        }
        const points = yield* pointsOf(args.flags)
        const act = FORWARD_ACTS.find((x) => x === actWord)
        if (!act) {
          return yield* refuse(
            'a forward is reject, ask, answer, comment, accept (of a result, a task, or a ' +
              'draft), or resolve (of an escalation)',
          )
        }
        const hasEvidence = act === 'accept' || act === 'resolve'
        const evidence = hasEvidence ? yield* evidenceOf(args.all('evidence')) : []
        const reason = textOf(args.one('reason'))
        const found = yield* lookup(work, String(target), FORWARD_KINDS[act])
        // A draft has no task tree: the person accepts or rejects it as its decider.
        const task = taskOfRecord(work, found)
        if (task && !within(work, task, a.task)) {
          return yield* refuse(`${target} is outside the task tree of ${a.id}`)
        }
        // Evidence is about the reported work, so that work must be unchanged.
        const lowToken = tierOf(work, a) === 'low' ? tokenWord : undefined
        if (act === 'accept' && found._tag !== 'Revision') yield* checkDigest(found, lowToken)
        if (act === 'resolve' && evidence.length && found._tag === 'Review') {
          const escalated = found.review._tag === 'Escalate' ? found.review.of : undefined
          if (escalated) yield* checkDigest(yield* lookup(work, escalated, ['r']), lowToken)
        }
        const inner = yield* innerOf({ act, found, quote, points, evidence, reason })
        // A dry run: the person's act must be possible now, or the forward is refused. The probe
        // reads its own now, then the inner act its time (two readings).
        const clock = yield* Now
        const probeNow = yield* clock.read
        const innerAt = yield* clock.read
        const { cwd } = yield* Dir
        const services = yield* Effect.context<Files | Spawn>()
        const seq = (work.events.at(-1)?.recorded.seq ?? 0) + 1
        const probe: Act = {
          event: inner,
          by: human(String(who)),
          when: innerAt,
          seq,
        }
        yield* checkAct(work, probe, checkContext(cwd, probeNow, services)).pipe(
          Effect.mapError((error) =>
            refuse(
              `${who} could not ${act} ${target} now: ${error.message}`,
              act === 'answer'
                ? `that question is not ${who}'s; to bring ${who}'s fact to the work, run work ask ${tokenWord} --to=owner --text="...", then forward ${who}'s answer to your question`
                : null,
            ),
          ),
        )
        // The person's act, with the person's exact words.
        const act_ = {
          _tag: 'Forwarded' as const,
          person: String(who),
          quote,
          channel: channelWord === 'github' ? ('github' as const) : ('chat' as const),
          inner,
        }
        return actOf(caller, create('Forward', act_))
      }),
    )
    const written = forwarded.written
    const made = forwarded.created.length ? ` -> ${forwarded.created.join(', ')}` : ''
    const stored = written?.event
    const data = stored?._tag === 'Forward' && 'create' in stored ? stored.create : undefined
    if (!written || data?._tag !== 'Forwarded') {
      return yield* Effect.die('forward: the store wrote no forward')
    }
    const word = forwardWord(data.inner)
    const by = whoOf(written.author).who
    const seq = forwarded.seq
    return FORWARD_AT_ONCE.includes(word)
      ? [`${who}'s ${word} recorded${made} (forwarded by ${by}, channel ${data.channel}).`]
      : [
          `e${seq}: ${describeInner(data.inner, forwarded.work)} waits until ${who} runs work confirm e${seq} at a terminal.`,
        ]
  })

// The task that a record is in: a task itself, a result's task, a question's first stop, an
// escalation's result's task.
const taskOfRecord = (work: Work, found: Found): TaskId | undefined => {
  switch (found._tag) {
    case 'Review':
      return found.review._tag === 'Escalate'
        ? work.results.get(found.review.of)?.task
        : undefined
    case 'Task':
      return found.task.id
    case 'Result':
      return found.result.task
    case 'Assignment':
      return found.assignment.task
    // A question stops one task: its asker's.
    case 'Question':
      return found.question.stops
    default:
      return undefined
  }
}

// The reviewed work must be the reported work.
const checkDigest = (found: Found, lowToken: string | undefined) =>
  Effect.gen(function* () {
    if (found._tag !== 'Result') return
    const { cwd } = yield* Dir
    if (!(yield* changedSince(cwd, found.result))) return
    const id = found.result.id
    return yield* refuse(
      `the work changed after ${id} was reported`,
      lowToken !== undefined
        ? `work escalate ${lowToken} --result=${id} --reason="the work changed after ${id} was reported", then STOP`
        : 'the maker reports it again as a new attempt; review that result',
    )
  })

export interface ForwardInput {
  readonly act: ForwardWord
  readonly found: Found
  readonly quote: NonBlank
  readonly points: ReadonlyArray<GivenPoint>
  readonly evidence: ReadonlyArray<EvidenceData>
  readonly reason: string | undefined
}

// The CLI word of a forwarded act (forward reject|accept|resolve|ask|answer|comment).
export const forwardWord = (inner: ForwardedAct): ForwardWord => {
  switch (inner._tag) {
    case 'Review':
      return inner.create._tag === 'Reject'
        ? 'reject'
        : inner.create._tag === 'Resolve'
          ? 'resolve'
          : 'accept'
    case 'Question':
      return 'create' in inner ? 'ask' : 'answer'
    case 'Note':
      return 'comment'
  }
}

// The person's act as the typed inner event. The acts that the old engine refused for their
// shape (a task takes only a Reject; an accept of a result has evidence) are refused here, as
// no typed event holds them.
export const innerOf = (input: ForwardInput): Effect.Effect<ForwardedAct, Refused> =>
  Effect.gen(function* () {
    const { act, found, quote, points, evidence, reason } = input
    switch (act) {
      case 'reject': {
        // Each point says something (the old engine's words).
        const given: ReadonlyArray<PointData> = points.length
          ? yield* Effect.forEach(points, ({ text, breaks }) =>
              isNonBlank(text)
                ? Effect.succeed({ text, breaks })
                : Effect.fail(refuse('a Reject needs a reason')),
            )
          : [{ text: quote, breaks: null }]
        const [first, ...more] = given
        if (first === undefined) return yield* Effect.die('forward reject: no point')
        if (found._tag === 'Revision') {
          // A reject of a draft has one reason: the texts of its points (none is blank).
          const reason = NonBlank.make(given.map((p) => p.text).join('; '))
          const of = { _tag: 'Revision' as const, id: found.revision.id, reason }
          return { _tag: 'Review' as const, create: { _tag: 'Reject' as const, of } }
        }
        if (found._tag === 'Task') {
          // The engine's words: a point on a task names no rule.
          const ruled = given.find((p) => p.breaks !== null)
          if (ruled) {
            return yield* refuse(
              `a Reject of a task names no rule; reject a result for ${ruled.breaks}, or give the point with no rule`,
            )
          }
          const textOf = (p: PointData) => ({ text: p.text })
          const points = [textOf(first), ...more.map(textOf)] as const
          const of = { _tag: 'Task' as const, id: found.task.id, points }
          return { _tag: 'Review' as const, create: { _tag: 'Reject' as const, of } }
        }
        const result = (found as Extract<Found, { _tag: 'Result' }>).result.id
        const of = { _tag: 'Result' as const, id: result, points: [first, ...more] as const }
        return { _tag: 'Review' as const, create: { _tag: 'Reject' as const, of } }
      }
      case 'accept': {
        if (found._tag === 'Revision') {
          const of = { _tag: 'Revision' as const, id: found.revision.id, evidence }
          const review = { _tag: 'Accept' as const, of, reason: reason ?? quote }
          return { _tag: 'Review' as const, create: review }
        }
        if (found._tag === 'Task') {
          return yield* refuse('a task takes only a Reject; an Accept goes on a result of the task')
        }
        const target = (found as Extract<Found, { _tag: 'Result' }>).result.id
        const [first, ...more] = evidence
        if (!first) {
          return yield* refuse(
            'an accept needs --evidence: <the place in the result where you read it> | <what you saw there>',
          )
        }
        const of = { _tag: 'Result' as const, id: target, evidence: [first, ...more] as const }
        const review = { _tag: 'Accept' as const, of, reason: reason ?? quote }
        return { _tag: 'Review' as const, create: review }
      }
      case 'resolve': {
        // A Resolve of the escalation, in the person's words; it waits for the confirm.
        if (found._tag !== 'Review' || found.review._tag !== 'Escalate') {
          return yield* refuse('a resolve ends an escalation; this review is not an escalation')
        }
        const escalation = found.review.id
        const review = { _tag: 'Resolve' as const, escalation, resolution: quote, evidence }
        return { _tag: 'Review' as const, create: review }
      }
      case 'ask': {
        const assignment = (found as Extract<Found, { _tag: 'Assignment' }>).assignment.id
        const to = { _tag: 'Agent' as const, assignment }
        return { _tag: 'Question' as const, create: { _tag: 'Asked' as const, text: quote, to } }
      }
      case 'answer': {
        const q = (yield* questionOf(found)).id
        const answered = { _tag: 'Answered' as const, text: quote }
        return { _tag: 'Question' as const, id: q, move: answered }
      }
      case 'comment': {
        const about = (found as Extract<Found, { _tag: 'Task' }>).task.id
        return { _tag: 'Note' as const, create: { _tag: 'Message' as const, about, text: quote } }
      }
    }
  })

// A question by its found record (the lookup of ['q']).
const questionOf = (found: Found) =>
  found._tag === 'Question'
    ? Effect.succeed(found.question)
    : Effect.die(`forward answer: ${found._tag} is not a question`)

// What an official version leaves to do: the results that it makes old, and the tasks that no open
// assignment works on (no work next can show them). Exported for the review command of P6b.
export const afterVersion = (
  work: Work,
  version: Version<Direction>,
  at: Time,
): ReadonlyArray<string> => {
  const tasks = [...work.tasks.values()].filter(
    (t) =>
      t.end._tag === 'NotEnded' && directionsOf(work, t.id).some((d) => d.id === version.of),
  )
  const old = tasks
    .flatMap((t) => resultsOf(work, t.id).at(-1) ?? [])
    .filter((r) => blockerItems(work, r.id, at).some((i) => i._tag === 'OldVersion'))
  const idle = tasks.filter(
    (t) =>
      !taskAccepted(work, t.id, at) &&
      ![...work.assignments.values()].some(
        (x) => x.end._tag === 'NotEnded' && within(work, t.id, x.task),
      ),
  )
  return [
    ...(old.length
      ? [
          `now under an old version: ${old.map((r) => `${r.id} (${r.task})`).join(', ')}; ` +
            'each needs a check under the new version (work next shows it).',
        ]
      : []),
    ...idle.map((t) => `no open assignment works on ${t.id}: work assign ${t.id} --role=<role>`),
  ]
}

// The draft that a forwarded accept accepts, if it is one.
const draftOf = (inner: ForwardedAct | undefined): RevisionId | undefined =>
  inner?._tag === 'Review' && inner.create._tag === 'Accept' && inner.create.of._tag === 'Revision'
    ? inner.create.of.id
    : undefined

// The person confirms a forward that waits.
const confirm: Command = (call) =>
  Effect.gen(function* () {
    const id = String(call.args.positional[0])
    let forwardedInner: ForwardedAct | undefined
    const done = yield* writeAct(call, (work) =>
      Effect.gen(function* () {
        const forward = work.forwards.get(id as EventRef)
        const recorded = work.events.find((l) => `e${l.recorded.seq}` === id)?.recorded
        const stored = recorded?.event
        const forwarded = stored?._tag === 'Forward' && 'create' in stored ? stored.create : undefined
        if (
          forward?._tag !== 'Confirmable' ||
          forward.state._tag !== 'Waiting' ||
          !recorded ||
          !forwarded
        ) {
          return yield* refuse(
            `${id} is not a forwarded act that waits for a confirm; work waiting --for=<you> lists them`,
          )
        }
        const inner = forward.inner
        forwardedInner = inner
        const show = [
          `${id}: ${describeInner(inner, work)}`,
          `forwarded by ${whoOf(recorded.author).who}; their words: "${forwarded.quote}"`,
        ]
        const draft = draftOf(inner)
        if (draft) show.push(renderDraft(work, draft))
        const author = yield* personAuthor(work, { word: 'confirm', show: show.join('\n') })
        return { ...author, event: move('Forward', EventRef.make(id), { _tag: 'Confirmed' }) }
      }),
    )
    const draft = draftOf(forwardedInner)
    const version = draft ? madeBy(done.work, draft) : undefined
    return [
      `${id} confirmed${done.created.length ? ` -> ${done.created.join(', ')}` : ''}.`,
      ...(draft && version
        ? [
            `${draft} is official: ${versionIdOf(version)}.`,
            ...(yield* followCommit(done.work, version)),
            ...afterVersion(done.work, version, done.at),
          ]
        : []),
    ]
  })

export const commands: Commands = { direction, suggest, grant, revoke, forward, confirm }
