// The commands direction and source. The files are read by the actions; the adapter reads the
// flags and prints the words.
import { join } from 'node:path'
import { Effect } from 'effect'
import { currentOf, draftAt, versionAt, versionNumberOf } from '../../../core/derived/reads.ts'
import {
  type AnswerId,
  type Author,
  DirectionId,
  type FlowStep,
  lookup,
  type RevisionId,
  refuse,
  type VersionId,
  versionIdOf,
  type RejectId,
  spotsOf,
  examplesOfFlow,
} from '../../../core/schema/index.ts'
import { Dir, Files, Now, Store } from '../../../core/services/index.ts'
import { foldWork } from '../../../core/state/work/fold.ts'
import {
  exampleLines,
  draftWaitsText,
  pieceNames,
  renderDirection,
  renderDraft,
  renderPiece,
  whyLines,
} from '../../words/index.ts'
import { type Args, textOf, wordsOf } from '../args.ts'
import { isPerson, personAuthor, verifyWork } from '../caller.ts'
import type { Call, Command, Commands } from '../command.ts'
import { lookupKind } from '../lookups.ts'
import { followCommit } from '../refresh.ts'
import { act, derivedAfter, peekWork, readWork } from '../runtime.ts'
import {
  FLOW_FORM,
} from '../shared.ts'

// The file of a new direction: the whole direction (guides/writing.md).
const DIRECTION_TEMPLATE = `write a file like this, then run the command again:
  id: <direction id>
  name: <a short name>
  owner: <a person of aristoteles.yaml; the owner accepts the first version>
  from: [<the principles that ground it: Logos, Pathos, Ethos, Mythos, Oikos, Nomos, Telos, Kairos, Mnēmē, Topoi, Aporia>]
  summary: <one or two plain sentences: what the direction asks, and why it matters>
  says: |
    <what the direction asks for, in any markdown>
  approvedBy: <optional; who accepts the next versions: roles, and the owner>
  standards:
    - id: <standard id>
      says: |
        <how the output looks, in any markdown>
      rules:
        - { id: <rule id>, says: <one check>, checkedBy: <role> }`

const FLOW_TEMPLATE = `write a file like this, then run the command again:
${FLOW_FORM.replace(/^/gm, '  ')}`

const REVISE_TEMPLATE =
  'write a file like this (any of the keys), then run the revise again:\n' +
  '  add:\n    - { id: <new standard id>, says: <the standard>, rules: [ { id: <new rule id>, says: <the rule>, checkedBy: <role> } ] }\n' +
  '  replace:\n    - { id: <standard id>, with: { id: <standard id>, says: <...>, rules: [ ... ] } }\n' +
  '  remove: [<standard id>]\n  says: <a new spirit needs the accept of the owner>\n' +
  '  summary: <one or two plain sentences: what the direction asks, and why it matters>'

// The examples of a direction or of a new draft, by the step of its flow, each with its state
// (ruling 4): the adapter reads the text of each file now, so an excerpt that left its file shows
// stale.
const examplesOf = (flow: ReadonlyArray<FlowStep>) =>
  Effect.gen(function* () {
    const examples = examplesOfFlow(flow)
    if (examples.length === 0) return []
    const { cwd } = yield* Dir
    const files = yield* Files
    const texts = new Map<string, string | null>()
    for (const { file } of examples.flatMap(spotsOf)) {
      if (!texts.has(file)) texts.set(file, yield* files.read(join(cwd, file)))
    }
    return ['examples:', ...exampleLines(flow, (file) => texts.get(file) ?? null)]
  })

// <id>[@<n>] or <draft>, then [#<standard, rule, or header>[#<header>]]: one piece.
const showDirection = (rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { work, d } = yield* readWork
    const [address = '', ...keys] = String(rest[0]).split('#')
    let v: VersionId | RevisionId
    if (/^d\d+$/.test(address)) {
      const { revision } = yield* lookupKind('Revision', ['d'], work, address)
      if (!keys.length) {
        const examples = yield* examplesOf(revision.flow)
        return [renderDraft(d, revision.id), ...whyLines(revision.why), ...examples]
      }
      v = revision.id
    } else {
      const [id = '', number] = address.split('@')
      const directionId = DirectionId.make(id)
      const dir = work.directions.get(directionId)
      if (dir?._tag === 'NewDirection') {
        const last = [...d.states.revisions.keys()]
          .map((r) => draftAt(work, r))
          .filter((x) => x.of === dir.id)
          .at(-1)
        return yield* refuse(`${id} has no version yet`, `work direction show ${last?.id} shows its draft`)
      }
      if (!dir) {
        return yield* refuse(`there is no direction "${id}"`, 'work status lists the directions')
      }
      const numbered = number ? dir.versions[Number(number) - 1] : undefined
      if (number && !numbered) return yield* refuse(`${id} has no version ${number}`)
      const version = numbered ?? currentOf(work, directionId)
      if (!keys.length) {
        const examples = yield* examplesOf(currentOf(work, directionId).flow)
        return [renderDirection(d, versionIdOf(version)), ...examples]
      }
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

// Why a draft changes its direction (the owner's rulings, 2026-11-12): --why gives one of the five
// reasons and --why-words its words; the action checks them (N5: blank words are none given).
const whyOf = (args: Args) => ({
  reason: textOf(args.one('why')) ?? null,
  words: textOf(args.one('why-words')) ?? null,
})

// The ids of --answers: each is a Reject.
const answersOf = (work: Parameters<typeof lookup>[0], text: string | undefined) =>
  Effect.gen(function* () {
    const out: Array<AnswerId> = []
    for (const id of text ? text.split(',') : []) {
      yield* lookup(work, id, ['v'])
      out.push(id as RejectId)
    }
    return out
  })

// A new direction (Nanda, 2026-11-10): a model writes the whole of it, and its owner accepts it.
const newDirection = (call: Call) =>
  Effect.gen(function* () {
    const { args } = call
    const runName = textOf(args.one('by'))
    if (yield* isPerson) {
      return yield* refuse(
        'a model drafts a direction; the person accepts or rejects the draft',
      )
    }
    const file = textOf(args.one('file'))
    if (!file) return yield* refuse('a new direction needs --file=<direction.yaml>', DIRECTION_TEMPLATE)
    if (!/^[a-z][a-z0-9-]*$/.test(String(runName ?? ''))) {
      return yield* refuse(
        'a model run outside any task names itself: --by=<its name in lower case>',
        `run it again with --by, for example: work direction new --file=${file} --by=assess`,
      )
    }
    // A model run has no token; its id is the time of its act.
    const { work } = yield* peekWork
    const by: Author = { _tag: 'ModelRun', name: String(runName), at: yield* (yield* Now).read }
    const answers = yield* answersOf(work, textOf(args.one('answers')))
    const done = yield* act(by, {
      _tag: 'DraftDirection',
      target: {},
      content: { file, answers, why: whyOf(args) },
    })
    const did = String(done.created[0])
    const { revision: draft } = yield* lookupKind('Revision', ['d'], done.work, did)
    const direction = done.work.directions.get(draft.of)
    const answering = draft.answers.length ? `, answering ${draft.answers.join(', ')}` : ''
    const writer = `, by ${runName} (a model run)`
    // N8: the file of a direction with a version made its revise.
    const what =
      draft._tag === 'Change'
        ? `${did} drafted, built on ${draft.base}`
        : `${did} drafted: the new direction ${draft.of} (${direction?.name})`
    return [
      `${what}${writer}${answering}; it waits for the accept of ${draftWaitsText(done.work, draft.id)}.`,
      `next: work direction show ${did}; ${direction?.owner.name} accepts or rejects it on the page`,
    ]
  })

const reviseDirection = (call: Call, rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { args } = call
    const runName = textOf(args.one('by'))
    // A model writes each draft; the person accepts or rejects it.
    if (yield* isPerson) {
      return yield* refuse(
        'a role that directs writes the draft of a change; the person accepts or rejects the draft',
      )
    }
    const directionId = DirectionId.make(String(rest[0]))
    const { work } = yield* peekWork
    const file = textOf(args.one('file'))
    if (!file) return yield* refuse('a revise needs --file=<edit.yaml>', REVISE_TEMPLATE)
    // A host revises a direction too (ruling 2026-11-14): it names itself, as for a new direction.
    if (!/^[a-z][a-z0-9-]*$/.test(String(runName ?? ''))) {
      return yield* refuse(
        'a model run outside any task names itself: --by=<its name in lower case>',
        `run it again with --by, for example: work direction revise ${directionId} --file=${file} --by=host`,
      )
    }
    const by: Author = { _tag: 'ModelRun', name: String(runName), at: yield* (yield* Now).read }
    const answers = yield* answersOf(work, textOf(args.one('answers')))
    const done = yield* act(by, {
      _tag: 'ReviseDirection',
      target: { direction: directionId },
      content: { file, answers, why: whyOf(args) },
    })
    const did = String(done.created[0])
    const { revision: draft } = yield* lookupKind('Revision', ['d'], done.work, did)
    const direction = done.work.directions.get(draft.of)
    const answering = draft.answers.length ? `, answering ${draft.answers.join(', ')}` : ''
    if (draft._tag !== 'Change') return yield* Effect.die(`the revise ${did} changes no version`)
    // The action keeps no answer about a closed task: such a point blocks no work.
    const dropped = answers.filter((a) => !draft.answers.includes(a))
    const writer = `, by ${runName} (a model run)`
    return [
      `${did} drafted, built on ${draft.base}${writer}${answering}; it waits for the accept of ${draftWaitsText(done.work, draft.id)}.`,
      ...(dropped.length
        ? [`${dropped.join(', ')}: a point of a closed task blocks no work, so ${did} does not answer it.`]
        : []),
      `next: work direction show ${did}; ${direction?.owner.name} accepts or rejects it on the page`,
    ]
  })

// A model gives a company draft of a new direction its flow and examples before the accept (P10 rejected,
// onboarding 2026-11-14): a model run (--by).
const draftExamples = (call: Call, rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { args } = call
    const runName = textOf(args.one('by'))
    const id = String(rest[0])
    const file = textOf(args.one('file'))
    if (!file) return yield* refuse('the flow of a draft needs --file=<flow.yaml>', FLOW_TEMPLATE)
    const { work } = yield* peekWork
    let by: Author
    // The person is refused by canAct: a model drafts, the person says it in words.
    if (yield* isPerson) by = yield* personAuthor(work)
    else if (!/^[a-z][a-z0-9-]*$/.test(runName ?? '')) {
      return yield* refuse(
        'a model run outside any task names itself: --by=<its name in lower case>',
        `run it again with --by, for example: work direction examples ${id} --file=${file} --by=host`,
      )
    } else by = { _tag: 'ModelRun', name: String(runName), at: yield* (yield* Now).read }
    const { revision: draft } = yield* lookupKind('Revision', ['d'], work, id)
    const done = yield* act(by, {
      _tag: 'AddExamples',
      target: { draft: draft.id },
      content: { file },
    })
    const owner = done.work.directions.get(draft.of)?.owner.name
    return [
      `${draft.id} has its flow and examples; it waits for the accept of ${draftWaitsText(done.work, draft.id)}.`,
      `next: work direction show ${draft.id}; ${owner} accepts or rejects it on the page`,
    ]
  })

// work direction accept|reject <draft>: before a top is open, the owner (the person) decides a
// draft directly (Nanda's ruling Q6a). An accept makes it official.
const decideDraft = (call: Call, word: 'accept' | 'reject', ref: string) =>
  Effect.gen(function* () {
    const { work, d } = yield* peekWork
    const { revision } = yield* lookupKind('Revision', ['d'], work, ref)
    const reason = textOf(call.args.one('reason'))
    const by = yield* personAuthor(
      work,
      word === 'accept'
        ? { word, show: `accept ${ref}:\n${renderDraft(d, revision.id)}` }
        : undefined,
    )
    const of = { _tag: 'Revision', id: revision.id } as const
    const done = yield* act(
      by,
      word === 'accept'
        ? { _tag: 'Accept', target: { of }, content: { reason: reason ?? null } }
        : { _tag: 'Reject', target: { of }, content: { reason: wordsOf(call.args.one('reason')) } },
    )
    const w = done.work
    const vid = String(done.created[0])
    const state = (yield* derivedAfter(w)).states.revisions.get(revision.id)
    if (word === 'reject') return [`${vid}: reject of ${ref}; ${ref} is ended.`]
    if (state?._tag !== 'Official') return [`${vid}: accept of ${ref}.`]
    const version = versionAt(w, revision.of, versionNumberOf(state.version))
    return [
      `${vid}: accept of ${ref}. ${ref} is official: ${state.version}.`,
      ...(yield* followCommit(w, version)),
    ]
  })

const direction: Command = (call) =>
  Effect.gen(function* () {
    const [sub, ...rest] = call.args.positional
    if (sub === 'show') return yield* showDirection(rest)
    if (sub === 'new') return yield* newDirection(call)
    if (sub === 'examples') return yield* draftExamples(call, rest)
    if (sub === 'accept' || sub === 'reject') return yield* decideDraft(call, sub, String(rest[0]))
    if (sub !== 'revise') {
      return yield* refuse(
        'use work direction show|new|revise|examples|accept|reject',
      )
    }
    return yield* reviseDirection(call, rest)
  })

// --- source -------------------------------------------------------------------

// work source <token> <source>@<revision>: the host read an outside source again.
const source: Command = (call) =>
  Effect.gen(function* () {
    const [name = '', revision] = String(call.args.positional[0] ?? '').split('@')
    if (!revision) return yield* refuse('use work source <token> <source>@<revision>')
    const { cwd } = yield* Dir
    const store = yield* (yield* Store).open(cwd, { create: false })
    const folded = foldWork(yield* store.events)
    if (folded === null) return yield* refuse(`no top is open in ${cwd}`, 'the person opens it')
    yield* verifyWork(folded, call.token)
    const by: Author = { _tag: 'System' }
    const done = yield* act(by, { _tag: 'ReadSource', target: { name }, content: { revision } })
    const event = done.work.events.at(-1)?.recorded.event
    const checked = event?._tag === 'Source' && 'move' in event
    return [checked ? `${name} is still at ${revision}; seen now.` : `${name} is at ${revision}.`]
  })

export const commands: Commands = { direction, source }
