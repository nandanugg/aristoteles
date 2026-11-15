// Invariant P3: every command that the words print parses to an intent that canAct allows. The
// words of each person (work waiting) and of each open agent (work next) are cut into their
// `work ...` commands; each act command becomes the Intent that the CLI would build, for the
// actor who runs it (the person, the agent, or a model run for --by), and canAct checks it.
// A read (show, guide, ...) and a placeholder id (<task>) are no intent, so they are skipped.
import { canAct, type Derived, nextFor, waitingFor } from '../../core/derived/index.ts'
import type { Intent } from '../../core/schema/actions.ts'
import type { Author } from '../../core/schema/index.ts'
import { nextLines, waitingLines } from '../words/index.ts'
import { isToken, parseArgs } from './args.ts'

type Printed = { readonly actor: Author; readonly intent: Intent; readonly command: string }

// The commands of a line: each piece that starts with `work `, after a `, or `, a `; ` or a
// paren. A piece with no verb ("reject --reason=...") goes on with the command before it. A
// command after `, then` an act runs once that act changed the state, so it is not checked now.
export const commandsIn = (line: string): ReadonlyArray<string> => {
  const out: Array<string> = []
  let head = ''
  let act = false
  for (const piece of line.split(/(, or |; |, then |\(|\))/)) {
    if (piece === ', then ') {
      if (act) break
      continue
    }
    const at = piece.indexOf('work ')
    if (at >= 0) {
      const command = piece.slice(at).trim()
      act = !/^work (\S+ )?show\b/.test(command)
      const words = wordsOf(command).filter((w) => !isToken(w) && !/^<(.* )?token>$/.test(w))
      head = words.slice(0, words[1] === 'review' ? 3 : 2).join(' ')
      out.push(command)
    } else if (/^\s*(or )?reject\b/.test(piece) && head !== '') {
      out.push(`${head} ${piece.trim().replace(/^or /, '')}`)
    }
  }
  return out
}

// The words of a command, a quoted value kept whole.
const wordsOf = (command: string): ReadonlyArray<string> =>
  command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
// One command for each value of a|b.
const expand = (words: ReadonlyArray<string>): ReadonlyArray<ReadonlyArray<string>> => {
  const at = words.findIndex((w) => !w.includes('"') && w.includes('|') && !w.includes('<'))
  if (at < 0) return [words]
  const word = words[at] as string
  const [key, values] = word.includes('=') ? word.split('=') as [string, string] : ['', word]
  return values.split('|').flatMap((v) =>
    expand(words.map((w, i) => (i === at ? (key ? `${key}=${v}` : v) : w))),
  )
}
const placeholder = (id: string | undefined): boolean => id === undefined || id.includes('<')

// The intent of one command, or undefined for a read or a command with a placeholder id.
export const intentOf = (words: ReadonlyArray<string>, self: string): Intent | undefined => {
  const args = parseArgs(words.filter((w) => !isToken(w) && !/^<(.* )?token>$/.test(w)))
  const [, verb, a, b] = args.positional
  const flag = (k: string) => {
    const v = args.one(k)
    return typeof v === 'string' ? v : undefined
  }
  const t = (_tag: string, target: object) => ({ _tag, target }) as Intent
  const of = (id: string) =>
    id.startsWith('d')
      ? { _tag: 'Revision', id }
      : id.startsWith('ev')
        ? { _tag: 'Evaluation', id }
        : id.startsWith('t')
          ? { _tag: 'Task', id }
          : { _tag: 'Result', id }
  // A drafted adjustment names no record: its words (add-role <role>) are its content.
  const decide = ['accept', 'reject', 'show']
  if (verb === 'adjust' && a !== undefined && !decide.includes(a)) return t('DraftAdjustment', {})
  if ([a, b].some((x) => x !== undefined && placeholder(x))) return undefined
  switch (verb) {
    case 'assign': {
      const role = flag('role')
      return placeholder(a) || placeholder(role) ? undefined : t('Give', { task: a, role })
    }
    case 'task': {
      const answers = flag('review') ?? null
      if (a === 'split') return t('SplitTask', { task: b, answers })
      if (a === 'remake') return t('RemakeTask', { task: b, answers })
      return undefined
    }
    case 'suggest':
      return a === 'roles'
        ? t('Suggest', { about: { _tag: 'Roles' } })
        : t('Suggest', { about: { _tag: 'Direction', direction: a } })
    case 'review':
      if (b === 'accept') return t('Accept', { of: of(a as string) })
      if (b === 'reject') return t('Reject', { of: of(a as string) })
      return undefined
    case 'role':
      if (a === 'accept') return t('AcceptRoleWords', { draft: b })
      if (a === 'reject') return t('RejectRoleWords', { draft: b })
      return undefined
    case 'adjust':
      if (a === 'accept') return t('AcceptAdjustment', { draft: b })
      if (a === 'reject') return t('RejectAdjustment', { draft: b })
      return undefined
    case 'direction':
      if (a === 'new') return t('DraftDirection', {})
      return a === 'revise' ? t('ReviseDirection', { direction: b }) : undefined
    case 'answer':
      return t('Answer', { question: a })
    case 'resolve':
      return t('Resolve', { escalation: a })
    case 'confirm':
      return t('Confirm', { forward: a })
    case 'problem':
      return args.one('fixed') === true ? t('FixProblem', { problem: a }) : undefined
    case 'run':
      return a === 'done' ? t('EndRun', { run: b }) : undefined
    case 'free':
      return t('Free', { assignment: a })
    case 'recheck':
      return t('Recheck', { result: a })
    case 'finish':
      return t('Finish', { assignment: a ?? self })
    default:
      return undefined
  }
}

// What a person and an agent read: the person's work waiting, the agent's work next.
const printedOf = (
  d: Derived,
  actor: Author,
  lines: ReadonlyArray<string>,
): ReadonlyArray<Printed> => {
  const self = actor._tag === 'Agent' ? actor.assignment : ''
  return lines.flatMap(commandsIn).flatMap((command) =>
    expand(wordsOf(command)).flatMap((words) => {
      const intent = intentOf(words, self)
      if (intent === undefined) return []
      const by = parseArgs([...words]).one('by')
      // --by=<model> names no run yet, so no actor is checked.
      if (by === '<model>') return []
      const runner: Author =
        typeof by === 'string' ? { _tag: 'ModelRun', name: by, at: d.moment.at } : actor
      return [{ actor: runner, intent, command: words.join(' ') }]
    }),
  )
}

const nameOf = (actor: Author): string =>
  actor._tag === 'Agent' ? actor.assignment : actor._tag === 'Person' ? actor.name : actor._tag

// Every act command that the words print now, for each person and each open agent.
export const printedCommands = (
  d: Derived,
  people: ReadonlyArray<string>,
): ReadonlyArray<Printed> => {
  const persons = people.map((name) => {
    const actor: Author = { _tag: 'Person', name, channel: 'terminal' }
    const items = waitingFor(d, { _tag: 'Person', name })
    return printedOf(d, actor, waitingLines(d, items, name))
  })
  const agents = [...d.states.assignments]
    .filter(([, state]) => state._tag !== 'Ended')
    .map(([assignment]) => {
      const actor: Author = { _tag: 'Agent', assignment }
      return printedOf(d, actor, nextLines(d, nextFor(d, actor), `${assignment}.TOKEN`))
    })
  return [...persons, ...agents].flat()
}

// The printed commands that canAct refuses: `<actor> <command>: <refusal>`.
export const printedViolations = (
  d: Derived,
  people: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  printedCommands(d, people).flatMap(({ actor, intent, command }) => {
    const can = canAct(d, actor, intent)
    return can._tag === 'May' ? [] : [`${nameOf(actor)} ${command}: ${can.refusal.message}`]
  })
