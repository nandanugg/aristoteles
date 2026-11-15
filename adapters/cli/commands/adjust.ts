// work adjust (ruling 14): after the store starts, a role or a direction changes by an adjustment.
// A high agent (its token) or a host outside any task (--by=<its name>) drafts one change; the
// person shows it, accepts it (a role adjustment writes aristoteles.yaml) or rejects it with a
// reason. The actions read the files that a draft names and check each change.
import { Effect } from 'effect'
import { adjustmentDraftAt } from '../../../core/derived/index.ts'
import type { AdjustmentInput } from '../../../core/schema/actions.ts'
import {
  type Author,
  DirectionId,
  type EventRef,
  refuse,
  RoleName,
  type Tier,
} from '../../../core/schema/index.ts'
import { CONFIG, Now } from '../../../core/services/index.ts'
import { adjustmentWords, renderAdjustment } from '../../words/index.ts'
import { textOf, wordsOf } from '../args.ts'
import { agentCallerOf, authorOf, isPerson, personAuthor } from '../caller.ts'
import type { Call, Command, Commands } from '../command.ts'
import { act, peekWork } from '../runtime.ts'
import { EXAMPLES_FORM } from '../shared.ts'

const ROLE_FILE = `write the keys of the new role in a file, as a role of ${CONFIG} has them:
  tier: high | medium | low
  description: <what the role does, in one line>
  intro: <the first words of its brief>
  responsibilities: [<one exact output or command>]
  acts: [{ do: <its work> }]
  persistence: { persistent: true | false, why: <one line> }
  icon: <a role icon, such as compass>`
const EXAMPLES_FILE = `write the new examples in a file:
${EXAMPLES_FORM.replace(/^/gm, '  ')}`
const TIERS: ReadonlyArray<Tier> = ['low', 'medium', 'high']

// The change of each draft form, from its words and flags.
const adjustmentOf = (call: Call): Effect.Effect<AdjustmentInput, ReturnType<typeof refuse>> =>
  Effect.gen(function* () {
    const [word, name = ''] = call.args.positional
    const file = textOf(call.args.one('file'))
    switch (word) {
      case 'add-role':
        if (file === undefined) return yield* refuse('add-role needs --file=<role.yaml>', ROLE_FILE)
        return { _tag: 'AddRole', role: RoleName.make(name), file }
      case 'remove-role':
        return { _tag: 'RemoveRole', role: RoleName.make(name) }
      case 'tier': {
        const tier = TIERS.find((t) => t === textOf(call.args.one('tier')))
        if (tier === undefined) return yield* refuse('--tier is low, medium or high')
        return { _tag: 'SetTier', role: RoleName.make(name), tier }
      }
      case 'persistence': {
        const persistent = textOf(call.args.one('persistent'))
        if (persistent !== 'true' && persistent !== 'false') {
          return yield* refuse('--persistent is true or false')
        }
        return {
          _tag: 'SetPersistence',
          role: RoleName.make(name),
          persistent: persistent === 'true',
          why: wordsOf(call.args.one('why')),
        }
      }
      case 'retire':
        return { _tag: 'RetireDirection', direction: DirectionId.make(name) }
      case 'examples':
        if (file === undefined) return yield* refuse('examples needs --file=<examples.yaml>', EXAMPLES_FILE)
        return { _tag: 'SetExamples', direction: DirectionId.make(name), file }
      default:
        return yield* refuse(
          'use work adjust add-role|remove-role|tier|persistence|retire|examples, or show|accept|reject <event>',
          'work help lists the forms',
        )
    }
  })

// The drafter: a high agent by its token, or a model run outside any task that names itself. A
// person is refused by the action: the person says it in words (work suggest).
const drafterOf = (call: Call) =>
  Effect.gen(function* () {
    const runName = textOf(call.args.one('by'))
    const { work } = yield* peekWork
    if (call.token !== null) {
      if (runName !== undefined) {
        return yield* refuse('--by names a model run outside any task; an assignment is named by its token')
      }
      return authorOf(yield* agentCallerOf(work, call.token))
    }
    if (yield* isPerson) return yield* personAuthor(work)
    if (!/^[a-z][a-z0-9-]*$/.test(runName ?? '')) {
      return yield* refuse(
        'a model run outside any task names itself: --by=<its name in lower case>',
        'run it again with --by, for example: work adjust tier <role> --tier=medium --by=host',
      )
    }
    const by: Author = { _tag: 'ModelRun', name: String(runName), at: yield* (yield* Now).read }
    return by
  })

const draft = (call: Call) =>
  Effect.gen(function* () {
    const adjustment = yield* adjustmentOf(call)
    const by = yield* drafterOf(call)
    const done = yield* act(by, { _tag: 'DraftAdjustment', target: {}, content: { adjustment } })
    if (done.seq === null) return yield* Effect.die('a drafted adjustment stored no event')
    const ref = `e${done.seq}` as EventRef
    const x = adjustmentDraftAt(done.work, ref)
    if (x === undefined) return yield* Effect.die(`${ref} is no adjustment`)
    const owner = done.work.workflow.owner.name
    return [
      `${ref}: an adjustment: ${adjustmentWords(x.adjustment)}; it waits for the accept of ${owner}.`,
      `next: ${owner} accepts or rejects it on the page, or with work adjust accept|reject ${ref}`,
    ]
  })

// The person decides a drafted adjustment by its event. The accept shows it first, and asks for
// the typed word.
const decide = (call: Call, word: 'show' | 'accept' | 'reject') =>
  Effect.gen(function* () {
    const ref = String(call.args.positional[1]) as EventRef
    const { work, d } = yield* peekWork
    const shown = renderAdjustment(d, ref)
    const x = adjustmentDraftAt(work, ref)
    if (shown === undefined || x === undefined) {
      return yield* refuse(`${ref} is no drafted adjustment`, 'work waiting lists the adjustments that wait')
    }
    if (word === 'show') return shown
    if (word === 'reject') {
      yield* act(yield* personAuthor(work), {
        _tag: 'RejectAdjustment',
        target: { draft: ref },
        content: { reason: wordsOf(call.args.one('reason')) },
      })
      return [`${ref} is rejected; work waiting shows the reason to its drafter.`]
    }
    const by = yield* personAuthor(work, { word: 'accept', show: shown.join('\n') })
    yield* act(by, { _tag: 'AcceptAdjustment', target: { draft: ref }, content: {} })
    const role = 'role' in x.adjustment
    return [
      `${ref} is accepted: ${adjustmentWords(x.adjustment)}` +
        (role ? `; ${CONFIG} holds the change` : '') +
        '. Work in progress keeps what it started with.',
    ]
  })

const adjust: Command = (call) =>
  call.act === 'show' || call.act === 'accept' || call.act === 'reject'
    ? decide(call, call.act)
    : draft(call)

export const commands: Commands = { adjust }
