// The commands direction, suggest, grant, revoke, forward, confirm. The files are read by the
// actions; the adapter reads the flags, builds the typed act of a forward, and prints the words.
import { Effect } from 'effect'
import { currentOf, draftAt } from '../../../core/derived/reads.ts'
import type { PointInput, SuggestAbout } from '../../../core/schema/actions.ts'
import {
  type AnswerId,
  type Author,
  DirectionId,
  type EvidenceData,
  type EventRef,
  type ForwardedAct,
  isNonBlank,
  isTime,
  lookup,
  type Found,
  type NonBlank,
  type RevisionId,
  RoleName,
  refuse,
  Time,
  type VersionId,
  versionIdOf,
  whoOf,
  type RejectId,
  type PermissionId,
} from '../../../core/schema/index.ts'
import { Now } from '../../../core/services/index.ts'
import {
  describeInner,
  draftWaitsText,
  pieceNames,
  renderDirection,
  renderDraft,
  renderPiece,
  whyLines,
} from '../../words/index.ts'
import { type Args, textOf, wordsOf } from '../args.ts'
import { authorOf, callerOf, isPerson, personAuthor, agentCallerOf } from '../caller.ts'
import type { Call, Command, Commands } from '../command.ts'
import { lookupKind } from '../lookups.ts'
import { followCommit } from '../refresh.ts'
import { act, derivedAfter, peekWork, readWork } from '../runtime.ts'
import { afterVersion, EVIDENCE_FORM, evidenceOf, pointsOf, versionMadeBy } from '../shared.ts'


// The file of a new direction: the whole direction (guides/writing.md).
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

// <id>[@<n>] or <draft>, then [#<standard, rule, or header>[#<header>]]: one piece.
const showDirection = (rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { work, d } = yield* readWork
    const [address = '', ...keys] = String(rest[0]).split('#')
    let v: VersionId | RevisionId
    if (/^d\d+$/.test(address)) {
      const { revision } = yield* lookupKind('Revision', ['d'], work, address)
      if (!keys.length) return [renderDraft(d, revision.id), ...whyLines(revision.why)]
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
      if (!keys.length) return [renderDirection(d, versionIdOf(version))]
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

// The ids of --answers: each is a Reject point, a Reject, or a suggestion.
const answersOf = (work: Parameters<typeof lookup>[0], text: string | undefined) =>
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

// A new direction (Nanda, 2026-11-10): a model writes the whole of it, and its owner accepts it.
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
      return yield* refuse(
        '--by names a model run outside any task; an assignment is named by its token',
      )
    }
    if (token === null && !/^[a-z][a-z0-9-]*$/.test(String(runName ?? ''))) {
      return yield* refuse(
        'a model run outside any task names itself: --by=<its name in lower case>',
        `run it again with --by, for example: work direction new --file=${file} --by=assess`,
      )
    }
    // A run outside any task has no token; its id is the time of its act.
    const run = token === null ? { name: String(runName), id: yield* (yield* Now).read } : undefined
    const { work } = yield* peekWork
    const by: Author =
      token !== null
        ? authorOf(yield* agentCallerOf(work, token))
        : { _tag: 'ModelRun', name: String(run?.name), at: run?.id as Time }
    const answers = yield* answersOf(work, textOf(args.one('answers')))
    const done = yield* act(by, {
      _tag: 'DraftDirection',
      target: {},
      content: { file, answers, why: whyOf(args) },
    })
    const did = String(done.created[0])
    const after = yield* derivedAfter(done.work)
    const { revision: draft } = yield* lookupKind('Revision', ['d'], done.work, did)
    const direction = done.work.directions.get(draft.of)
    const answering = draft.answers.length ? `, answering ${draft.answers.join(', ')}` : ''
    const writer = run ? `, by ${run.name} (a model run outside any task)` : ''
    // N8: the file of a direction with a version made its revise.
    const what =
      draft._tag === 'Change'
        ? `${did} drafted, built on ${draft.base}`
        : `${did} drafted: the new direction ${draft.of} (${direction?.name})`
    return [
      `${what}${writer}${answering}; it waits for the accept of ${draftWaitsText(after, draft.id)}.`,
      `next: work direction show ${did}; ${direction?.owner.name} runs work review ${did} accept [--reason="<a comment>"], or reject --reason="<why>"`,
    ]
  })

const reviseDirection = (call: Call, rest: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const { args, token } = call
    const runName = textOf(args.one('by'))
    // A model writes each draft: the person gives direction in words, then accepts or rejects.
    if (token === null && (yield* isPerson)) {
      return yield* refuse(
        'the person gives direction in words: work suggest <direction, standard, or rule> --says="<the change>"; ' +
          'a high role writes the draft, and you accept or reject it',
      )
    }
    const directionId = DirectionId.make(String(rest[0]))
    const { work } = yield* peekWork
    if (token !== null && runName !== undefined) {
      return yield* refuse(
        '--by names a model run outside any task; an assignment is named by its token',
      )
    }
    const caller = token === null ? undefined : yield* agentCallerOf(work, token)
    const file = textOf(args.one('file'))
    if (!file) return yield* refuse('a revise needs --file=<edit.yaml>', REVISE_TEMPLATE)
    // A host outside any task revises a direction too (ruling 2026-11-14): it names itself, as
    // for a new direction.
    if (caller === undefined && !/^[a-z][a-z0-9-]*$/.test(String(runName ?? ''))) {
      return yield* refuse(
        'a model run outside any task names itself: --by=<its name in lower case>',
        `run it again with --by, for example: work direction revise ${directionId} --file=${file} --by=host`,
      )
    }
    const by: Author =
      caller !== undefined
        ? authorOf(caller)
        : { _tag: 'ModelRun', name: String(runName), at: yield* (yield* Now).read }
    const answers = yield* answersOf(work, textOf(args.one('answers')))
    const done = yield* act(by, {
      _tag: 'ReviseDirection',
      target: { direction: directionId },
      content: { file, answers, why: whyOf(args) },
    })
    const did = String(done.created[0])
    const after = yield* derivedAfter(done.work)
    const { revision: draft } = yield* lookupKind('Revision', ['d'], done.work, did)
    const direction = done.work.directions.get(draft.of)
    const answering = draft.answers.length ? `, answering ${draft.answers.join(', ')}` : ''
    if (draft._tag !== 'Change') return yield* Effect.die(`the revise ${did} changes no version`)
    // The action keeps no answer about a closed task: such a point blocks no work.
    const dropped = answers.filter((a) => !draft.answers.includes(a))
    const writer = caller === undefined ? `, by ${runName} (a model run outside any task)` : ''
    // A run has no task tree, so any decider may accept its draft.
    const decider = caller === undefined ? 'a decider' : 'a decider outside the tree of its reviser'
    return [
      `${did} drafted, built on ${draft.base}${writer}${answering}; it waits for the accept of ${draftWaitsText(after, draft.id)}.`,
      ...(dropped.length
        ? [`${dropped.join(', ')}: a point of a closed task blocks no work, so ${did} does not answer it.`]
        : []),
      `next: work direction show ${did}; ${decider} runs work review [<token>] ${did} accept ` +
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
    return yield* reviseDirection(call, rest)
  })

// --- suggest, grant, revoke -------------------------------------------------------------------

const suggest: Command = (call) =>
  Effect.gen(function* () {
    const about = call.args.positional[0]
    const { work } = yield* peekWork
    const caller = yield* callerOf(work, call.token)
    // The action finds what the key names: a direction, a standard, or a rule.
    const target: SuggestAbout = about ? { _tag: 'Standard', key: about } : { _tag: 'NewDirection' }
    const done = yield* act(authorOf(caller), {
      _tag: 'Suggest',
      target: { about: target },
      content: { says: wordsOf(call.args.one('says')) },
    })
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
    const actWord = textOf(args.one('act'))
    const on = String(args.one('on') ?? '')
      .split(',')
      .filter(Boolean)
    const until = textOf(args.one('until'))
    const given = ACTS.find((a) => a === actWord)
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
    const { work } = yield* peekWork
    const confirm =
      call.token === null
        ? {
            word: 'grant',
            show: `grant: ${args.one('to')} may ${actWord} ${on.join(', ')} until ${until}`,
          }
        : undefined
    const caller = yield* callerOf(work, call.token, confirm)
    const permitted =
      given === 'change'
        ? { _tag: 'Change' as const, changesOf: on as never }
        : {
            _tag: given === 'approve' ? ('Approve' as const) : ('Review' as const),
            resultsOf: on.map((n) => RoleName.make(n)),
          }
    const done = yield* act(authorOf(caller), {
      _tag: 'Grant',
      target: { act: permitted, to },
      content: { until: Time.make(String(until)) },
    })
    return [`${done.created[0]}: ${to} may ${actWord} ${on.join(', ')} until ${until}.`]
  })

// The giver ends a permission early; the acts before the revoke stay.
const revoke: Command = (call) =>
  Effect.gen(function* () {
    const x = String(call.args.positional[0])
    const { work } = yield* peekWork
    const caller = yield* callerOf(
      work,
      call.token,
      call.token === null ? { word: 'revoke' } : undefined,
    )
    const { permission } = yield* lookupKind('Permission', ['x'], work, x)
    yield* act(authorOf(caller), {
      _tag: 'Revoke',
      target: { permission: permission.id as PermissionId },
      content: {},
    })
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

// The CLI word of a forwarded act.
const forwardWord = (inner: ForwardedAct): ForwardWord => {
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

// The person's act as the typed inner event.
const innerOf = (input: {
  readonly act: ForwardWord
  readonly found: Found
  readonly quote: NonBlank
  readonly points: ReadonlyArray<PointInput>
  readonly evidence: ReadonlyArray<typeof EvidenceData.Type>
  readonly reason: string | undefined
}): Effect.Effect<ForwardedAct, ReturnType<typeof refuse>> =>
  Effect.gen(function* () {
    const { act: word, found, quote, points, evidence, reason } = input
    switch (word) {
      case 'reject': {
        const given = points.length ? points : [{ text: quote, breaks: null }]
        for (const p of given) if (!isNonBlank(p.text)) return yield* refuse('a Reject needs a reason')
        const typed = given.map((p) => ({ text: p.text as NonBlank, breaks: p.breaks as never }))
        const [first, ...more] = typed
        if (first === undefined) return yield* Effect.die('forward reject: no point')
        if (found._tag === 'Revision') {
          const why = typed.map((p) => p.text).join('; ') as NonBlank
          return {
            _tag: 'Review',
            create: { _tag: 'Reject', of: { _tag: 'Revision', id: found.revision.id, reason: why } },
          }
        }
        if (found._tag === 'Task') {
          const ruled = typed.find((p) => p.breaks !== null)
          if (ruled) {
            return yield* refuse(
              `a Reject of a task names no rule; reject a result for ${ruled.breaks}, or give the point with no rule`,
            )
          }
          const own = (p: { readonly text: NonBlank }) => ({ text: p.text })
          return {
            _tag: 'Review',
            create: {
              _tag: 'Reject',
              of: { _tag: 'Task', id: found.task.id, points: [own(first), ...more.map(own)] },
            },
          }
        }
        const result = (found as Extract<Found, { _tag: 'Result' }>).result.id
        return {
          _tag: 'Review',
          create: { _tag: 'Reject', of: { _tag: 'Result', id: result, points: [first, ...more] } },
        }
      }
      case 'accept': {
        if (found._tag === 'Revision') {
          return {
            _tag: 'Review',
            create: {
              _tag: 'Accept',
              of: { _tag: 'Revision', id: found.revision.id, evidence },
              reason: (reason ?? quote) as NonBlank,
            },
          }
        }
        if (found._tag === 'Task') {
          return yield* refuse('a task takes only a Reject; an Accept goes on a result of the task')
        }
        const target = (found as Extract<Found, { _tag: 'Result' }>).result.id
        const [first, ...more] = evidence
        if (!first) return yield* refuse(`an accept needs ${EVIDENCE_FORM}`)
        return {
          _tag: 'Review',
          create: {
            _tag: 'Accept',
            of: { _tag: 'Result', id: target, evidence: [first, ...more] },
            reason: (reason ?? quote) as NonBlank,
          },
        }
      }
      case 'resolve': {
        if (found._tag !== 'Review' || found.review._tag !== 'Escalate') {
          return yield* refuse('a resolve ends an escalation; this review is not an escalation')
        }
        return {
          _tag: 'Review',
          create: {
            _tag: 'Resolve',
            escalation: found.review.id,
            resolution: quote,
            evidence,
          },
        }
      }
      case 'ask': {
        const assignment = (found as Extract<Found, { _tag: 'Assignment' }>).assignment.id
        return {
          _tag: 'Question',
          create: { _tag: 'Asked', text: quote, to: { _tag: 'Agent', assignment } },
        } as never
      }
      case 'answer': {
        if (found._tag !== 'Question') return yield* Effect.die(`forward answer: ${found._tag}`)
        return {
          _tag: 'Question',
          id: found.question.id,
          move: { _tag: 'Answered', text: quote },
        } as never
      }
      case 'comment': {
        const about = (found as Extract<Found, { _tag: 'Task' }>).task.id
        return { _tag: 'Note', create: { _tag: 'Message', about, text: quote } }
      }
    }
  })

const forward: Command = (call) =>
  Effect.gen(function* () {
    const { args } = call
    const [who, actWord, target] = args.positional
    const quote = wordsOf(args.one('quote'))
    const channelWord = textOf(args.one('channel')) ?? 'chat'
    const { work } = yield* peekWork
    const caller = yield* agentCallerOf(work, call.token)
    if (!isNonBlank(quote)) return yield* refuse('a forward needs --quote="<their exact words>"')
    if (channelWord !== 'chat' && channelWord !== 'github') {
      return yield* refuse('--channel is chat or github')
    }
    const word = FORWARD_ACTS.find((x) => x === actWord)
    if (!word) {
      return yield* refuse(
        'a forward is reject, ask, answer, comment, accept (of a result, a task, or a ' +
          'draft), or resolve (of an escalation)',
      )
    }
    const hasEvidence = word === 'accept' || word === 'resolve'
    const evidence = hasEvidence ? yield* evidenceOf(args.all('evidence')) : []
    const found = yield* lookup(work, String(target), FORWARD_KINDS[word])
    const inner = yield* innerOf({
      act: word,
      found,
      quote,
      points: pointsOf(args.flags),
      evidence,
      reason: textOf(args.one('reason')),
    })
    const done = yield* act(authorOf(caller), {
      _tag: 'Forward',
      target: { act: inner },
      content: { person: String(who), quote, channel: channelWord },
    })
    const made = done.created.length ? ` -> ${done.created.join(', ')}` : ''
    const stored = done.work.events.at(-1)?.recorded
    const data = stored?.event._tag === 'Forward' && 'create' in stored.event ? stored.event.create : undefined
    if (!stored || data?._tag !== 'Forwarded') {
      return yield* Effect.die('forward: the store wrote no forward')
    }
    const by = whoOf(stored.author).who
    return FORWARD_AT_ONCE.includes(forwardWord(data.inner))
      ? [
          `${who}'s ${forwardWord(data.inner)} recorded${made} (forwarded by ${by}, channel ${data.channel}).`,
        ]
      : [
          `e${done.seq}: ${describeInner(data.inner, done.work)} waits until ${who} runs work confirm e${done.seq} at a terminal.`,
        ]
  })

// The draft that a forwarded accept accepts, if it is one.
const draftOf = (inner: ForwardedAct | undefined): RevisionId | undefined =>
  inner?._tag === 'Review' && inner.create._tag === 'Accept' && inner.create.of._tag === 'Revision'
    ? inner.create.of.id
    : undefined

const IRRELEVANT_WORDS = {
  QuestionAnswered: 'its question was answered',
  QuestionIrrelevant: 'its question ended with its task',
  DraftDecided: 'its draft was decided',
  PersonAccepted: 'the person accepted its draft',
  ResultNotCurrent: 'its result is not the current one',
  ResultAccepted: 'its result was accepted',
  EscalationClosed: 'its escalation was closed',
} as const

// The person confirms a forward that waits.
const confirm: Command = (call) =>
  Effect.gen(function* () {
    const id = String(call.args.positional[0])
    const { work, d } = yield* peekWork
    const forward = work.forwards.get(id as EventRef)
    const state = d.states.forwards.get(id as EventRef)
    const recorded = work.events.find((l) => `e${l.recorded.seq}` === id)?.recorded
    const stored = recorded?.event
    const forwarded = stored?._tag === 'Forward' && 'create' in stored ? stored.create : undefined
    if (forward?._tag !== 'Confirmable' || !recorded || !forwarded || state === undefined) {
      return yield* refuse(
        `${id} is not a forwarded act that waits for a confirm; work waiting --for=<you> lists them`,
      )
    }
    if (state._tag === 'Irrelevant') {
      return [`${id} is irrelevant: ${IRRELEVANT_WORDS[state.why._tag]}; nothing was stored.`]
    }
    if (state._tag !== 'Waiting') {
      return yield* refuse(
        `${id} is not a forwarded act that waits for a confirm; work waiting --for=<you> lists them`,
      )
    }
    const inner = forward.inner
    const show = [
      `${id}: ${describeInner(inner, work)}`,
      `forwarded by ${whoOf(recorded.author).who}; their words: "${forwarded.quote}"`,
    ]
    const draft = draftOf(inner)
    if (draft) show.push(renderDraft(d, draft))
    const by = yield* personAuthor(work, { word: 'confirm', show: show.join('\n') })
    const done = yield* act(by, {
      _tag: 'Confirm',
      target: { forward: id as EventRef },
      content: {},
    })
    const after = yield* derivedAfter(done.work)
    const version = draft ? versionMadeBy(after, draft) : undefined
    return [
      `${id} confirmed${done.created.length ? ` -> ${done.created.join(', ')}` : ''}.`,
      ...(draft && version
        ? [
            `${draft} is official: ${versionIdOf(version)}.`,
            ...(yield* followCommit(done.work, version)),
            ...afterVersion(after, version),
          ]
        : []),
    ]
  })

export const commands: Commands = { direction, suggest, grant, revoke, forward, confirm }
